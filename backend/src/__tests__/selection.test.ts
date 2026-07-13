import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { setupTestDB, teardownTestDB, getApp, prisma } from './setup.js';
import bcrypt from 'bcryptjs';

let app: Express;
let adminToken: string;
let coachToken: string;
let adminUserId: string;
let coachUserId: string;

beforeAll(async () => {
  await setupTestDB();
  app = await getApp();

  // Admin
  const hash = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.create({
    data: { email: 'admin@selection.test', password: hash, firstName: 'Admin', lastName: 'Test', role: 'ADMIN' },
  });
  adminUserId = admin.id;
  const adminRes = await request(app).post('/api/auth/login').send({ email: 'admin@selection.test', password: 'admin123' });
  adminToken = adminRes.body.data.token;

  // Coach
  const coachHash = await bcrypt.hash('coach123', 10);
  const coach = await prisma.user.create({
    data: { email: 'coach@selection.test', password: coachHash, firstName: 'Coach', lastName: 'Test', role: 'COACH' },
  });
  coachUserId = coach.id;
  const coachRes = await request(app).post('/api/auth/login').send({ email: 'coach@selection.test', password: 'coach123' });
  coachToken = coachRes.body.data.token;
});

afterAll(async () => {
  await teardownTestDB();
});

// ---------- Helpers ----------

let tournamentSeq = 0;
async function newTournament(name: string) {
  tournamentSeq += 1;
  const t = await prisma.tournament.create({
    data: {
      name: `${name} ${tournamentSeq}`,
      year: 2000 + tournamentSeq,
      startDate: new Date('2026-05-24'),
      endDate: new Date('2026-06-07'),
      isActive: false,
    },
  });
  return t.id;
}

interface CritInput {
  name: string;
  weight?: number;
  maxScore?: number;
  isCalculated?: boolean;
  abbreviation?: string;
}

async function newSession(tournamentId: string, criteria: CritInput[] = []) {
  const session = await prisma.selectionSession.create({
    data: { tournamentId, date: new Date() },
  });
  if (criteria.length) {
    await prisma.selectionCriteria.createMany({
      data: criteria.map((c, i) => ({
        selectionSessionId: session.id,
        name: c.name,
        abbreviation: c.abbreviation ?? c.name.toUpperCase(),
        maxScore: c.maxScore ?? 10,
        weight: c.weight ?? 1,
        isCalculated: c.isCalculated ?? false,
        order: i + 1,
      })),
    });
  }
  const crits = await prisma.selectionCriteria.findMany({
    where: { selectionSessionId: session.id },
    orderBy: { order: 'asc' },
  });
  const byName: Record<string, string> = {};
  crits.forEach((c) => (byName[c.name] = c.id));
  return { sessionId: session.id, byName };
}

let ballkidSeq = 0;
async function newBallkid(tournamentId: string, firstName: string, lastName: string, extra: any = {}) {
  ballkidSeq += 1;
  return prisma.ballkid.create({
    data: {
      firstName,
      lastName,
      email: extra.email ?? `bk${ballkidSeq}@selection.test`,
      birthDate: new Date('2012-01-01'),
      gender: 'MALE',
      status: 'REGISTERED',
      tournamentId,
      ...extra,
    },
  });
}

// Insère directement une note (pour tester classement/sélection sans passer par le calcul)
async function seedScore(sessionId: string, ballkidId: string, scorerId: string, totalScore: number) {
  return prisma.selectionScore.create({
    data: { selectionSessionId: sessionId, ballkidId, scorerId, totalScore },
  });
}

// ---------- Calcul du total pondéré ----------

describe('POST /score - calcul du total pondéré', () => {
  it('calcule totalScore = Σ(valeur × weight) exact, ignore isCalculated, stocke tous les détails', async () => {
    const tid = await newTournament('Calc');
    const { byName } = await newSession(tid, [
      { name: 'Vitesse', weight: 1, maxScore: 10 },
      { name: 'Adresse', weight: 2, maxScore: 10 },
      { name: 'Formule', weight: 5, isCalculated: true }, // BUG connu: formule jamais évaluée
      { name: 'Zero', weight: 0, maxScore: 10 },
    ]);
    const bk = await newBallkid(tid, 'Calc', 'Kid');

    const res = await request(app)
      .post(`/api/selection/${tid}/score`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        ballkidId: bk.id,
        scores: {
          [byName['Vitesse']]: 8,
          [byName['Adresse']]: 5,
          [byName['Formule']]: 3, // BUG connu: formule jamais évaluée -> exclue du total
          [byName['Zero']]: 7, // weight 0 -> n'influence pas le total mais reste stockée
        },
      });

    expect(res.status).toBe(200);
    // 8*1 + 5*2 + (Formule ignorée) + 7*0 = 18
    expect(res.body.data.selectionScore.totalScore).toBe(18);

    const scoreId = res.body.data.selectionScore.id;
    // Tous les critères (y compris isCalculated et weight 0) sont persistés en détail
    const details = await prisma.selectionScoreDetail.findMany({ where: { selectionScoreId: scoreId } });
    expect(details.length).toBe(4);
    const zeroDetail = details.find((d) => d.selectionCriteriaId === byName['Zero']);
    expect(zeroDetail?.value).toBe(7); // valeur weight-0 stockée malgré impact nul
    const calcDetail = details.find((d) => d.selectionCriteriaId === byName['Formule']);
    expect(calcDetail?.value).toBe(3); // valeur isCalculated stockée malgré exclusion du total
  });

  it('rejette une note sans token (401)', async () => {
    const res = await request(app).post('/api/selection/whatever/score').send({ ballkidId: 'x', scores: {} });
    expect(res.status).toBe(401);
  });
});

// ---------- Unicité (session + ballkid + scorer) ----------

describe('POST /score - unicité session+ballkid+scorer', () => {
  it('même scorer re-poste -> 1 seule note écrasée, pas de doublon de détails ; scorer différent -> 2 notes', async () => {
    const tid = await newTournament('Unique');
    const { sessionId, byName } = await newSession(tid, [{ name: 'A', weight: 1 }, { name: 'B', weight: 1 }]);
    const bk = await newBallkid(tid, 'Uniq', 'Kid');

    // Admin poste une première fois : 3 + 4 = 7
    const r1 = await request(app)
      .post(`/api/selection/${tid}/score`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ballkidId: bk.id, scores: { [byName['A']]: 3, [byName['B']]: 4 } });
    expect(r1.body.data.selectionScore.totalScore).toBe(7);

    // Admin re-poste (écrase) : 5 + 5 = 10
    const r2 = await request(app)
      .post(`/api/selection/${tid}/score`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ballkidId: bk.id, scores: { [byName['A']]: 5, [byName['B']]: 5 } });
    expect(r2.body.data.selectionScore.totalScore).toBe(10);
    expect(r2.body.data.selectionScore.id).toBe(r1.body.data.selectionScore.id);

    // Toujours une seule note pour (admin, ballkid) et 2 détails (pas de doublon)
    const adminScores = await prisma.selectionScore.findMany({
      where: { selectionSessionId: sessionId, ballkidId: bk.id, scorerId: adminUserId },
    });
    expect(adminScores.length).toBe(1);
    const adminDetails = await prisma.selectionScoreDetail.count({ where: { selectionScoreId: adminScores[0].id } });
    expect(adminDetails).toBe(2);

    // Coach (scorer différent) poste -> 2 notes distinctes pour ce ballkid
    const rc = await request(app)
      .post(`/api/selection/${tid}/score`)
      .set('Authorization', `Bearer ${coachToken}`)
      .send({ ballkidId: bk.id, scores: { [byName['A']]: 2, [byName['B']]: 2 } });
    expect(rc.status).toBe(200);
    expect(rc.body.data.selectionScore.totalScore).toBe(4);

    const allScores = await prisma.selectionScore.findMany({
      where: { selectionSessionId: sessionId, ballkidId: bk.id },
    });
    expect(allScores.length).toBe(2);
  });
});

// ---------- Classement ----------

describe('GET /:tournamentId/ranking', () => {
  it('moyenne entre 2 scorers, exclut les ramasseurs sans note, tri décroissant', async () => {
    const tid = await newTournament('Ranking');
    const { sessionId } = await newSession(tid, []);

    const top = await newBallkid(tid, 'Top', 'Un');
    const mid = await newBallkid(tid, 'Mid', 'Deux');
    const none = await newBallkid(tid, 'Sans', 'Note');

    // top : une seule note 20 -> moyenne 20
    await seedScore(sessionId, top.id, adminUserId, 20);
    // mid : deux scorers 18 et 12 -> moyenne 15
    await seedScore(sessionId, mid.id, adminUserId, 18);
    await seedScore(sessionId, mid.id, coachUserId, 12);
    // none : aucune note -> exclu

    const res = await request(app).get(`/api/selection/${tid}/ranking`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const ranking = res.body.data.ranking;

    expect(ranking.length).toBe(2); // "none" exclu
    expect(ranking.map((r: any) => r.id)).not.toContain(none.id);

    // Tri décroissant : top (20) avant mid (15)
    expect(ranking[0].id).toBe(top.id);
    expect(ranking[0].averageScore).toBe(20);
    expect(ranking[0].rank).toBe(1);
    expect(ranking[1].id).toBe(mid.id);
    expect(ranking[1].averageScore).toBe(15); // (18+12)/2
    expect(ranking[1].scoresCount).toBe(2);
    expect(ranking[1].rank).toBe(2);
  });
});

// ---------- Sélection ----------

describe('POST /:tournamentId/select', () => {
  it('classe par moyenne, affecte SELECTED/RESERVE, termine la session, repasse les exclus en REGISTERED', async () => {
    const tid = await newTournament('Select');
    const { sessionId } = await newSession(tid, []);

    const high = await newBallkid(tid, 'High', 'A');
    const mid = await newBallkid(tid, 'Mid', 'B');
    const low = await newBallkid(tid, 'Low', 'C');
    const noneKid = await newBallkid(tid, 'None', 'D');
    // Ancien sélectionné sans note : doit repasser REGISTERED
    const stale = await newBallkid(tid, 'Stale', 'E', { status: 'SELECTED' });

    await seedScore(sessionId, high.id, adminUserId, 20);
    await seedScore(sessionId, mid.id, adminUserId, 15);
    await seedScore(sessionId, low.id, adminUserId, 10);
    // noneKid et stale : sans note (moyenne 0)

    const res = await request(app)
      .post(`/api/selection/${tid}/select`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ count: 3, reserveCount: 1 });

    expect(res.status).toBe(200);
    // selectedCount = count - reserveCount = 2 ; reserves = 1
    expect(res.body.data.selected).toBe(2);
    expect(res.body.data.reserves).toBe(1);

    const statusOf = async (id: string) => (await prisma.ballkid.findUnique({ where: { id } }))!.status;
    expect(await statusOf(high.id)).toBe('SELECTED');
    expect(await statusOf(mid.id)).toBe('SELECTED');
    expect(await statusOf(low.id)).toBe('RESERVE');
    expect(await statusOf(noneKid.id)).toBe('REGISTERED');
    expect(await statusOf(stale.id)).toBe('REGISTERED'); // exclu -> repassé REGISTERED

    const session = await prisma.selectionSession.findUnique({ where: { tournamentId: tid } });
    expect(session?.isCompleted).toBe(true);
  });
});

// ---------- Édition / suppression d'une note ----------

describe('PUT & DELETE /score/:scoreId', () => {
  it('PUT met à jour le total ; rejette hors 0-20 (400) ; DELETE supprime note + détails', async () => {
    const tid = await newTournament('Edit');
    const { byName } = await newSession(tid, [{ name: 'A', weight: 1 }]);
    const bk = await newBallkid(tid, 'Edit', 'Kid');

    const created = await request(app)
      .post(`/api/selection/${tid}/score`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ballkidId: bk.id, scores: { [byName['A']]: 6 } });
    const scoreId = created.body.data.selectionScore.id;

    // PUT met à jour le total
    const upd = await request(app)
      .put(`/api/selection/score/${scoreId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ score: 15 });
    expect(upd.status).toBe(200);
    expect(upd.body.data.selectionScore.totalScore).toBe(15);

    // PUT hors 0-20 -> 400
    const bad = await request(app)
      .put(`/api/selection/score/${scoreId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ score: 25 });
    expect(bad.status).toBe(400);

    // DELETE supprime la note et ses détails (cascade)
    const del = await request(app).delete(`/api/selection/score/${scoreId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(del.status).toBe(200);
    expect(await prisma.selectionScore.findUnique({ where: { id: scoreId } })).toBeNull();
    expect(await prisma.selectionScoreDetail.count({ where: { selectionScoreId: scoreId } })).toBe(0);
  });
});

// ---------- score-simple ----------

describe('POST /:tournamentId/score-simple', () => {
  it('rejette une note hors 0-20 (400)', async () => {
    const tid = await newTournament('Simple');
    const bk = await newBallkid(tid, 'Simple', 'Kid');

    const tooHigh = await request(app)
      .post(`/api/selection/${tid}/score-simple`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ballkidId: bk.id, score: 25 });
    expect(tooHigh.status).toBe(400);

    const negative = await request(app)
      .post(`/api/selection/${tid}/score-simple`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ballkidId: bk.id, score: -1 });
    expect(negative.status).toBe(400);
  });
});

// ---------- PUT criteria ----------

describe('PUT /:tournamentId/criteria', () => {
  it('rejette liste vide (400) et critère sans nom (400)', async () => {
    const tid = await newTournament('Crit');

    const empty = await request(app)
      .put(`/api/selection/${tid}/criteria`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ criteria: [] });
    expect(empty.status).toBe(400);

    const noName = await request(app)
      .put(`/api/selection/${tid}/criteria`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ criteria: [{ name: '   ' }] });
    expect(noName.status).toBe(400);
  });

  it('génère l\'abréviation si omise et applique maxScore=5/weight=1 par défaut', async () => {
    const tid = await newTournament('Crit');
    const res = await request(app)
      .put(`/api/selection/${tid}/criteria`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ criteria: [{ name: 'Vitesse de course' }] });

    expect(res.status).toBe(200);
    const crit = res.body.data.criteria[0];
    expect(crit.name).toBe('Vitesse de course');
    expect(crit.abbreviation).toBe('VITESSE_DE_COURSE'); // abréviation générée
    expect(crit.maxScore).toBe(5); // défaut route
    expect(crit.weight).toBe(1); // défaut route
    expect(crit.isCalculated).toBe(false);
  });
});

// ---------- Permissions ----------

describe('Permissions', () => {
  it('coach : 200 sur /score', async () => {
    const tid = await newTournament('Perm');
    const { byName } = await newSession(tid, [{ name: 'A', weight: 1 }]);
    const bk = await newBallkid(tid, 'Perm', 'Kid');

    const res = await request(app)
      .post(`/api/selection/${tid}/score`)
      .set('Authorization', `Bearer ${coachToken}`)
      .send({ ballkidId: bk.id, scores: { [byName['A']]: 4 } });
    expect(res.status).toBe(200);
  });

  it('coach : 403 sur criteria / select / import-csv / score-simple / PUT / DELETE', async () => {
    const tid = await newTournament('Perm');

    const criteria = await request(app)
      .put(`/api/selection/${tid}/criteria`)
      .set('Authorization', `Bearer ${coachToken}`)
      .send({ criteria: [{ name: 'X' }] });
    expect(criteria.status).toBe(403);

    const select = await request(app)
      .post(`/api/selection/${tid}/select`)
      .set('Authorization', `Bearer ${coachToken}`)
      .send({ count: 3, reserveCount: 1 });
    expect(select.status).toBe(403);

    const importCsv = await request(app)
      .post(`/api/selection/${tid}/import-csv`)
      .set('Authorization', `Bearer ${coachToken}`);
    expect(importCsv.status).toBe(403);

    const simple = await request(app)
      .post(`/api/selection/${tid}/score-simple`)
      .set('Authorization', `Bearer ${coachToken}`)
      .send({ ballkidId: 'x', score: 10 });
    expect(simple.status).toBe(403);

    const put = await request(app)
      .put(`/api/selection/score/whatever`)
      .set('Authorization', `Bearer ${coachToken}`)
      .send({ score: 10 });
    expect(put.status).toBe(403);

    const del = await request(app).delete(`/api/selection/score/whatever`).set('Authorization', `Bearer ${coachToken}`);
    expect(del.status).toBe(403);
  });
});

// ---------- Import CSV / Excel ----------

describe('POST /:tournamentId/import-csv', () => {
  it('importe par email et par nom, erreur par ligne pour ramasseur introuvable', async () => {
    const tid = await newTournament('Import');
    await newBallkid(tid, 'Paul', 'Martin', { email: 'paul@import.test' });
    await newBallkid(tid, 'Julie', 'Bernard', { email: 'julie@import.test' });

    const csv =
      'Email;Prénom;Nom;Total\n' +
      'paul@import.test;;;16\n' + // match par email
      ';Julie;Bernard;12\n' + // match par nom/prénom
      'inconnu@import.test;;;10\n'; // introuvable
    const buffer = Buffer.from(csv, 'utf8');

    const res = await request(app)
      .post(`/api/selection/${tid}/import-csv`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', buffer, 'notes.csv');

    expect(res.status).toBe(200);
    expect(res.body.data.imported).toBe(2);
    expect(res.body.data.errors).toBe(1);
    expect(res.body.data.errorDetails[0].error).toContain('introuvable');
  });

  it('normalise automatiquement les notes si le max du fichier dépasse 20', async () => {
    const tid = await newTournament('ImportNorm');
    const bk = await newBallkid(tid, 'Marc', 'Petit', { email: 'marc@norm.test' });

    // Fichier sur 40 : max=40 > 20 -> normalisation sur 20
    const csv = 'Email;Total\nmarc@norm.test;40\n';
    const buffer = Buffer.from(csv, 'utf8');

    const res = await request(app)
      .post(`/api/selection/${tid}/import-csv`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', buffer, 'notes.csv');

    expect(res.status).toBe(200);
    expect(res.body.data.imported).toBe(1);

    // 40 / 40 * 20 = 20
    const score = await prisma.selectionScore.findFirst({ where: { ballkidId: bk.id } });
    expect(score?.totalScore).toBe(20);
  });

  it('rejette l\'import sans fichier (400)', async () => {
    const tid = await newTournament('ImportNoFile');
    const res = await request(app)
      .post(`/api/selection/${tid}/import-csv`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });
});

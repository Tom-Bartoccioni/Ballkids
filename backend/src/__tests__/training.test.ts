import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { setupTestDB, teardownTestDB, getApp, prisma } from './setup.js';
import bcrypt from 'bcryptjs';

let app: Express;
let adminToken: string;
let coachToken: string;
let adminId: string;
let coachId: string;
let tournamentId: string;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Crée une session de formation directement en base (sessionNumber unique).
async function createSession(tId: string, sessionNumber: number) {
  return prisma.trainingSession.create({
    data: { tournamentId: tId, sessionNumber, date: new Date('2026-05-25') },
  });
}

// Crée des critères pour une session et renvoie la map { name -> id }.
async function createCriteria(
  trainingSessionId: string,
  defs: Array<{ name: string; maxScore: number; weight: number; isCalculated?: boolean }>
) {
  const ids: Record<string, string> = {};
  let order = 1;
  for (const d of defs) {
    const c = await prisma.trainingCriteria.create({
      data: {
        trainingSessionId,
        name: d.name,
        abbreviation: d.name.slice(0, 3).toUpperCase(),
        maxScore: d.maxScore,
        weight: d.weight,
        isCalculated: d.isCalculated ?? false,
        order: order++,
      },
    });
    ids[d.name] = c.id;
  }
  return ids;
}

// Crée un ramasseur SELECTED dans le tournoi et renvoie son id.
async function createBallkid(tId: string, firstName: string, email: string) {
  const bk = await prisma.ballkid.create({
    data: {
      firstName,
      lastName: 'Test',
      email,
      birthDate: new Date('2012-01-01'),
      gender: 'MALE',
      status: 'SELECTED',
      tournamentId: tId,
    },
  });
  return bk.id;
}

beforeAll(async () => {
  await setupTestDB();
  app = await getApp();

  // Admin
  const hash = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.create({
    data: { email: 'admin@training.test', password: hash, firstName: 'Admin', lastName: 'Test', role: 'ADMIN' },
  });
  adminId = admin.id;
  const adminRes = await request(app).post('/api/auth/login').send({ email: 'admin@training.test', password: 'admin123' });
  adminToken = adminRes.body.data.token;

  // Coach
  const coachHash = await bcrypt.hash('coach123', 10);
  const coach = await prisma.user.create({
    data: { email: 'coach@training.test', password: coachHash, firstName: 'Coach', lastName: 'Test', role: 'COACH' },
  });
  coachId = coach.id;
  const coachRes = await request(app).post('/api/auth/login').send({ email: 'coach@training.test', password: 'coach123' });
  coachToken = coachRes.body.data.token;

  // Tournoi actif
  const tournament = await prisma.tournament.create({
    data: {
      name: 'Training Tournament',
      year: 2026,
      startDate: new Date('2026-05-24'),
      endDate: new Date('2026-06-07'),
      isActive: true,
    },
  });
  tournamentId = tournament.id;
});

afterAll(async () => {
  await teardownTestDB();
});

// ---------------------------------------------------------------------------
// Calcul exact du total = moyenne pondérée normalisée sur 20
// total = Σ((valeur/maxScore)*20*weight) / Σweight
// ---------------------------------------------------------------------------

describe('POST /api/training/:tournamentId/:sessionNumber/score - calcul du total', () => {
  it('critère unique valeur=3 maxScore=5 weight=1 -> total = 12.00', async () => {
    const session = await createSession(tournamentId, 10);
    const crit = await createCriteria(session.id, [{ name: 'Technique', maxScore: 5, weight: 1 }]);
    const ballkidId = await createBallkid(tournamentId, 'CalcA', 'calca@test.com');

    const res = await request(app)
      .post(`/api/training/${tournamentId}/10/score`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ballkidId, scores: { [crit['Technique']]: 3 } });

    expect(res.status).toBe(200);
    // (3/5)*20 = 12 ; /Σweight (1) = 12
    expect(res.body.data.trainingScore.totalScore).toBe(12);
  });

  it('critère weight=0 ignoré dans le numérateur ET le dénominateur', async () => {
    const session = await createSession(tournamentId, 11);
    // A: max10 w2 v10 -> normalisé 20, num=40, poids=2
    // B: max10 w0 v5  -> ignoré (poids 0) : ni au num ni au dénom
    const crit = await createCriteria(session.id, [
      { name: 'Actif', maxScore: 10, weight: 2 },
      { name: 'Ignore', maxScore: 10, weight: 0 },
    ]);
    const ballkidId = await createBallkid(tournamentId, 'CalcB', 'calcb@test.com');

    const res = await request(app)
      .post(`/api/training/${tournamentId}/11/score`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ballkidId, scores: { [crit['Actif']]: 10, [crit['Ignore']]: 5 } });

    expect(res.status).toBe(200);
    // 40 / 2 = 20 (le critère à weight 0 n'altère rien)
    expect(res.body.data.trainingScore.totalScore).toBe(20);
  });

  it('tous les poids à 0 -> total = 0 (pas de NaN / division par zéro)', async () => {
    const session = await createSession(tournamentId, 12);
    const crit = await createCriteria(session.id, [
      { name: 'Zero1', maxScore: 10, weight: 0 },
      { name: 'Zero2', maxScore: 10, weight: 0 },
    ]);
    const ballkidId = await createBallkid(tournamentId, 'CalcC', 'calcc@test.com');

    const res = await request(app)
      .post(`/api/training/${tournamentId}/12/score`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ballkidId, scores: { [crit['Zero1']]: 8, [crit['Zero2']]: 9 } });

    expect(res.status).toBe(200);
    expect(res.body.data.trainingScore.totalScore).toBe(0);
    expect(Number.isNaN(res.body.data.trainingScore.totalScore)).toBe(false);
  });

  it('critère isCalculated:true ignoré (BUG connu: formule jamais évaluée)', async () => {
    const session = await createSession(tournamentId, 13);
    // A: max10 w1 v10 -> 20
    // B: isCalculated -> ignoré ; s'il était compté (v5) le total tomberait à 15
    const crit = await createCriteria(session.id, [
      { name: 'Reel', maxScore: 10, weight: 1 },
      { name: 'Calcule', maxScore: 10, weight: 1, isCalculated: true },
    ]);
    const ballkidId = await createBallkid(tournamentId, 'CalcD', 'calcd@test.com');

    const res = await request(app)
      .post(`/api/training/${tournamentId}/13/score`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ballkidId, scores: { [crit['Reel']]: 10, [crit['Calcule']]: 5 } });

    expect(res.status).toBe(200);
    // 20 / 1 = 20 ; le critère isCalculated est exclu (num + dénom)
    expect(res.body.data.trainingScore.totalScore).toBe(20);
  });

  it('met isPresent=true par défaut lors du POST', async () => {
    const session = await createSession(tournamentId, 15);
    const crit = await createCriteria(session.id, [{ name: 'Present', maxScore: 10, weight: 1 }]);
    const ballkidId = await createBallkid(tournamentId, 'CalcP', 'calcp@test.com');

    const res = await request(app)
      .post(`/api/training/${tournamentId}/15/score`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ballkidId, scores: { [crit['Present']]: 10 } });

    expect(res.status).toBe(200);
    expect(res.body.data.trainingScore.isPresent).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unicité (session + ballkid + scorer)
// ---------------------------------------------------------------------------

describe('Unicité session + ballkid + scorer', () => {
  it('même scorer -> remplacement (une seule ligne) ; scorers différents -> 2 lignes', async () => {
    const session = await createSession(tournamentId, 14);
    const crit = await createCriteria(session.id, [{ name: 'Uni', maxScore: 10, weight: 1 }]);
    const ballkidId = await createBallkid(tournamentId, 'CalcE', 'calce@test.com');

    // Admin note une première fois (v10 -> 20)
    const first = await request(app)
      .post(`/api/training/${tournamentId}/14/score`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ballkidId, scores: { [crit['Uni']]: 10 } });
    expect(first.status).toBe(200);
    expect(first.body.data.trainingScore.totalScore).toBe(20);
    const firstId = first.body.data.trainingScore.id;

    // Admin re-note (v5 -> 10) : upsert sur la même ligne
    const replace = await request(app)
      .post(`/api/training/${tournamentId}/14/score`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ballkidId, scores: { [crit['Uni']]: 5 } });
    expect(replace.status).toBe(200);
    expect(replace.body.data.trainingScore.id).toBe(firstId);
    expect(replace.body.data.trainingScore.totalScore).toBe(10);

    // Coach note le même ramasseur : nouvelle ligne (scorer différent)
    const coachScore = await request(app)
      .post(`/api/training/${tournamentId}/14/score`)
      .set('Authorization', `Bearer ${coachToken}`)
      .send({ ballkidId, scores: { [crit['Uni']]: 10 } });
    expect(coachScore.status).toBe(200);
    expect(coachScore.body.data.trainingScore.id).not.toBe(firstId);

    // En base : exactement 2 lignes (admin + coach)
    const rows = await prisma.trainingScore.findMany({
      where: { trainingSessionId: session.id, ballkidId },
    });
    expect(rows.length).toBe(2);
    const scorerIds = rows.map((r) => r.scorerId).sort();
    expect(scorerIds).toEqual([adminId, coachId].sort());
  });
});

// ---------------------------------------------------------------------------
// Synthèse : moyenne des scorers puis moyenne des séances jouées
// ---------------------------------------------------------------------------

describe('GET /api/training/:tournamentId/summary/all', () => {
  it('moyenne des scorers par séance, puis moyenne des séances jouées', async () => {
    // Tournoi dédié pour isoler la synthèse
    const t = await prisma.tournament.create({
      data: {
        name: 'Summary Tournament',
        year: 2027,
        startDate: new Date('2027-05-24'),
        endDate: new Date('2027-06-07'),
      },
    });
    const s1 = await createSession(t.id, 1);
    const s2 = await createSession(t.id, 2);
    const ballkidId = await createBallkid(t.id, 'SummaryKid', 'summary@test.com');

    // Séance 1 : admin=10, coach=20 -> moyenne 15
    await prisma.trainingScore.create({
      data: { trainingSessionId: s1.id, ballkidId, scorerId: adminId, totalScore: 10, isPresent: true },
    });
    await prisma.trainingScore.create({
      data: { trainingSessionId: s1.id, ballkidId, scorerId: coachId, totalScore: 20, isPresent: true },
    });
    // Séance 2 : admin=8 -> moyenne 8
    await prisma.trainingScore.create({
      data: { trainingSessionId: s2.id, ballkidId, scorerId: adminId, totalScore: 8, isPresent: true },
    });

    const res = await request(app)
      .get(`/api/training/${t.id}/summary/all`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const row = res.body.data.summary.find((r: any) => r.id === ballkidId);
    expect(row).toBeDefined();
    expect(row.session1).toBe(15); // (10+20)/2
    expect(row.session2).toBe(8);
    expect(row.session3).toBeNull();
    expect(row.session4).toBeNull();
    expect(row.sessionsAttended).toBe(2);
    expect(row.average).toBe(11.5); // (15+8)/2
  });
});

// ---------------------------------------------------------------------------
// PUT criteria : réplication sur les 4 séances
// ---------------------------------------------------------------------------

describe('PUT /api/training/:tournamentId/criteria', () => {
  it('réplique les critères sur les 4 séances', async () => {
    // Tournoi dédié avec exactement 4 séances
    const t = await prisma.tournament.create({
      data: {
        name: 'Criteria Tournament',
        year: 2028,
        startDate: new Date('2028-05-24'),
        endDate: new Date('2028-06-07'),
      },
    });
    const sessions = [];
    for (let n = 1; n <= 4; n++) {
      sessions.push(await createSession(t.id, n));
    }

    const res = await request(app)
      .put(`/api/training/${t.id}/criteria`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        criteria: [
          { name: 'Rapidité', maxScore: 10, weight: 2 },
          { name: 'Précision', maxScore: 5, weight: 1 },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.criteria.length).toBe(2);

    // Chacune des 4 séances possède bien les 2 critères
    for (const s of sessions) {
      const crit = await prisma.trainingCriteria.findMany({
        where: { trainingSessionId: s.id },
        orderBy: { order: 'asc' },
      });
      expect(crit.length).toBe(2);
      expect(crit.map((c) => c.name)).toEqual(['Rapidité', 'Précision']);
    }
  });

  it('rejette une liste de critères vide (400)', async () => {
    const res = await request(app)
      .put(`/api/training/${tournamentId}/criteria`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ criteria: [] });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// score-simple : remet isPresent=true et supprime l'absence associée
// ---------------------------------------------------------------------------

describe('POST /api/training/:tournamentId/:sessionNumber/score-simple', () => {
  it('remet isPresent=true et supprime l\'absence du ramasseur pour la séance', async () => {
    const session = await createSession(tournamentId, 2);
    const ballkidId = await createBallkid(tournamentId, 'SimpleKid', 'simple@test.com');

    // Note pré-existante marquée absente
    await prisma.trainingScore.create({
      data: { trainingSessionId: session.id, ballkidId, scorerId: adminId, totalScore: 0, isPresent: false },
    });
    // Absence associée à créer puis vérifier la suppression
    await prisma.absence.create({
      data: { ballkidId, type: 'TRAINING', date: session.date, trainingSessionId: session.id },
    });

    const res = await request(app)
      .post(`/api/training/${tournamentId}/2/score-simple`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ballkidId, score: 14 });

    expect(res.status).toBe(200);
    expect(res.body.data.trainingScore.totalScore).toBe(14);
    expect(res.body.data.trainingScore.isPresent).toBe(true);

    // L'absence a été supprimée
    const absences = await prisma.absence.findMany({
      where: { ballkidId, trainingSessionId: session.id },
    });
    expect(absences.length).toBe(0);
  });

  it('rejette un numéro de séance hors 1-4 (400)', async () => {
    const ballkidId = await createBallkid(tournamentId, 'BadSession', 'badsession@test.com');
    const res = await request(app)
      .post(`/api/training/${tournamentId}/5/score-simple`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ballkidId, score: 10 });
    expect(res.status).toBe(400);
  });

  it('rejette une note hors 0-20 (400)', async () => {
    const ballkidId = await createBallkid(tournamentId, 'BadScore', 'badscore@test.com');
    const res = await request(app)
      .post(`/api/training/${tournamentId}/3/score-simple`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ballkidId, score: 25 });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PUT /score/:scoreId : remet isPresent=true
// ---------------------------------------------------------------------------

describe('PUT /api/training/score/:scoreId', () => {
  it('modifie la note et remet isPresent=true', async () => {
    const session = await createSession(tournamentId, 16);
    const ballkidId = await createBallkid(tournamentId, 'PutKid', 'put@test.com');
    const score = await prisma.trainingScore.create({
      data: { trainingSessionId: session.id, ballkidId, scorerId: adminId, totalScore: 0, isPresent: false },
    });

    const res = await request(app)
      .put(`/api/training/score/${score.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ score: 17 });

    expect(res.status).toBe(200);
    expect(res.body.data.trainingScore.totalScore).toBe(17);
    expect(res.body.data.trainingScore.isPresent).toBe(true);
  });

  it('rejette une note hors 0-20 (400)', async () => {
    const session = await createSession(tournamentId, 17);
    const ballkidId = await createBallkid(tournamentId, 'PutBad', 'putbad@test.com');
    const score = await prisma.trainingScore.create({
      data: { trainingSessionId: session.id, ballkidId, scorerId: adminId, totalScore: 0, isPresent: false },
    });

    const res = await request(app)
      .put(`/api/training/score/${score.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ score: -1 });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Import CSV : notes >20 ou <0 rejetées ligne par ligne (pas de normalisation)
// ---------------------------------------------------------------------------

describe('POST /api/training/:tournamentId/:sessionNumber/import-csv', () => {
  it('rejette les notes hors 0-20 ligne par ligne sans normaliser', async () => {
    const ballkidId = await createBallkid(tournamentId, 'ImportKid', 'importkid@test.com');

    const csv = 'email;note\nimportkid@test.com;15\nimportkid@test.com;25\nimportkid@test.com;-3\n';

    const res = await request(app)
      .post(`/api/training/${tournamentId}/4/import-csv`)
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from(csv, 'utf8'), 'notes.csv');

    expect(res.status).toBe(200);
    expect(res.body.data.imported).toBe(1); // seule la note 15 passe
    expect(res.body.data.errors).toBe(2); // 25 et -3 rejetées

    // La note importée n'a PAS été normalisée : elle vaut 15
    const stored = await prisma.trainingScore.findFirst({
      where: { ballkidId },
    });
    expect(stored?.totalScore).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

describe('Permissions', () => {
  it('coach peut POST /score (200)', async () => {
    const session = await createSession(tournamentId, 20);
    const crit = await createCriteria(session.id, [{ name: 'Perm', maxScore: 10, weight: 1 }]);
    const ballkidId = await createBallkid(tournamentId, 'PermKid', 'perm@test.com');

    const res = await request(app)
      .post(`/api/training/${tournamentId}/20/score`)
      .set('Authorization', `Bearer ${coachToken}`)
      .send({ ballkidId, scores: { [crit['Perm']]: 10 } });

    expect(res.status).toBe(200);
    expect(res.body.data.trainingScore.totalScore).toBe(20);
  });

  it('coach 403 sur PUT /criteria', async () => {
    const res = await request(app)
      .put(`/api/training/${tournamentId}/criteria`)
      .set('Authorization', `Bearer ${coachToken}`)
      .send({ criteria: [{ name: 'X', maxScore: 10, weight: 1 }] });
    expect(res.status).toBe(403);
  });

  it('coach 403 sur POST /score-simple', async () => {
    const res = await request(app)
      .post(`/api/training/${tournamentId}/1/score-simple`)
      .set('Authorization', `Bearer ${coachToken}`)
      .send({ ballkidId: 'whatever', score: 10 });
    expect(res.status).toBe(403);
  });

  it('coach 403 sur POST /import-csv', async () => {
    const res = await request(app)
      .post(`/api/training/${tournamentId}/1/import-csv`)
      .set('Authorization', `Bearer ${coachToken}`);
    expect(res.status).toBe(403);
  });

  it('coach 403 sur PUT /score/:scoreId', async () => {
    const res = await request(app)
      .put(`/api/training/score/nonexistent`)
      .set('Authorization', `Bearer ${coachToken}`)
      .send({ score: 10 });
    expect(res.status).toBe(403);
  });

  it('coach 403 sur DELETE /score/:scoreId', async () => {
    const res = await request(app)
      .delete(`/api/training/score/nonexistent`)
      .set('Authorization', `Bearer ${coachToken}`);
    expect(res.status).toBe(403);
  });

  it('401 sans token', async () => {
    const res = await request(app).get(`/api/training/${tournamentId}`);
    expect(res.status).toBe(401);
  });
});

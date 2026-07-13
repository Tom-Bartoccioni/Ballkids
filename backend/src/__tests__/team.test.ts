import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { setupTestDB, teardownTestDB, getApp, prisma } from './setup.js';
import bcrypt from 'bcryptjs';

let app: Express;
let adminToken: string;
let coachToken: string;
let adminUserId: string;

// Compteur global pour générer des emails uniques
let emailCounter = 0;

// Crée `count` ramasseurs pour un tournoi donné
async function makeBallkids(tournamentId: string, count: number, status: string) {
  const data = [];
  for (let i = 0; i < count; i++) {
    data.push({
      firstName: `BK${emailCounter}`,
      lastName: `L${i}`,
      email: `bk${emailCounter++}@team.test`,
      birthDate: new Date('2012-01-01'),
      gender: 'MALE',
      status,
      tournamentId,
    });
  }
  await prisma.ballkid.createMany({ data });
  return prisma.ballkid.findMany({ where: { tournamentId }, orderBy: { email: 'asc' } });
}

// Ajoute des notes d'entraînement variées à une liste de ramasseurs
async function addTrainingScores(tournamentId: string, ballkids: { id: string }[]) {
  const session = await prisma.trainingSession.create({
    data: { tournamentId, sessionNumber: 1, date: new Date('2026-05-01') },
  });
  await prisma.trainingScore.createMany({
    data: ballkids.map((b, i) => ({
      trainingSessionId: session.id,
      ballkidId: b.id,
      scorerId: adminUserId,
      totalScore: (i % 20) + 1,
    })),
  });
}

async function createTournament(name: string, year: number) {
  const t = await prisma.tournament.create({
    data: {
      name,
      year,
      startDate: new Date(`${year}-05-24`),
      endDate: new Date(`${year}-06-07`),
      isActive: false,
    },
  });
  return t.id;
}

async function makeDay(tournamentId: string, dayNumber = 1, ballkidCount = 78) {
  return prisma.tournamentDay.create({
    data: { tournamentId, dayNumber, date: new Date('2026-05-24'), ballkidCount },
  });
}

beforeAll(async () => {
  await setupTestDB();
  app = await getApp();

  const hash = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.create({
    data: { email: 'admin@team.test', password: hash, firstName: 'Admin', lastName: 'Test', role: 'ADMIN' },
  });
  adminUserId = admin.id;
  const adminRes = await request(app).post('/api/auth/login').send({ email: 'admin@team.test', password: 'admin123' });
  adminToken = adminRes.body.data.token;

  const coachHash = await bcrypt.hash('coach123', 10);
  await prisma.user.create({
    data: { email: 'coach@team.test', password: coachHash, firstName: 'Coach', lastName: 'Test', role: 'COACH' },
  });
  const coachRes = await request(app).post('/api/auth/login').send({ email: 'coach@team.test', password: 'coach123' });
  coachToken = coachRes.body.data.token;
});

afterAll(async () => {
  await teardownTestDB();
});

describe('POST /api/teams/:tournamentId/init', () => {
  it('crée 13 équipes vides', async () => {
    const tid = await createTournament('Init A', 2020);
    const res = await request(app)
      .post(`/api/teams/${tid}/init`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.teamsCreated).toBe(13);

    const count = await prisma.team.count({ where: { tournamentId: tid } });
    expect(count).toBe(13);

    // Aucune affectation lors d'un simple init
    const assignments = await prisma.teamAssignment.count({ where: { team: { tournamentId: tid } } });
    expect(assignments).toBe(0);
  });

  it('est idempotent (2e appel teamsCreated:0)', async () => {
    const tid = await createTournament('Init B', 2021);
    await request(app).post(`/api/teams/${tid}/init`).set('Authorization', `Bearer ${adminToken}`).send({});

    const res = await request(app)
      .post(`/api/teams/${tid}/init`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.teamsCreated).toBe(0);
    const count = await prisma.team.count({ where: { tournamentId: tid } });
    expect(count).toBe(13);
  });

  it('rejette teamCount invalide (400)', async () => {
    const tid = await createTournament('Init C', 2022);
    const res = await request(app)
      .post(`/api/teams/${tid}/init`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ teamCount: 0 });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/teams/:tournamentId/generate', () => {
  it('répartit 78 ramasseurs en snake draft, surplus en réserve sur l\'équipe order=1', async () => {
    const tid = await createTournament('Gen A', 2023);
    const ballkids = await makeBallkids(tid, 82, 'SELECTED');
    await addTrainingScores(tid, ballkids);

    const res = await request(app)
      .post(`/api/teams/${tid}/generate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.ballkidsAssigned).toBe(78);
    expect(res.body.data.reservesAssigned).toBe(4);

    // 78 titulaires
    const titulaires = await prisma.teamAssignment.count({
      where: { team: { tournamentId: tid }, isReserve: false, tournamentDayId: null },
    });
    expect(titulaires).toBe(78);

    // Les remplaçants sont sur l'équipe order=1
    const team1 = await prisma.team.findFirst({ where: { tournamentId: tid, order: 1 } });
    const reserves = await prisma.teamAssignment.findMany({
      where: { team: { tournamentId: tid }, isReserve: true, tournamentDayId: null },
    });
    expect(reserves.length).toBe(4);
    reserves.forEach((r) => expect(r.teamId).toBe(team1!.id));
  });

  it('la régénération ne duplique pas les affectations', async () => {
    const tid = await createTournament('Gen B', 2024);
    const ballkids = await makeBallkids(tid, 82, 'SELECTED');
    await addTrainingScores(tid, ballkids);

    await request(app).post(`/api/teams/${tid}/generate`).set('Authorization', `Bearer ${adminToken}`).send({});
    await request(app).post(`/api/teams/${tid}/generate`).set('Authorization', `Bearer ${adminToken}`).send({});

    const total = await prisma.teamAssignment.count({ where: { team: { tournamentId: tid } } });
    expect(total).toBe(82); // 78 titulaires + 4 réserves, pas de doublon
  });

  it('rejette si moins de 78 ramasseurs disponibles (400 « Pas assez »)', async () => {
    const tid = await createTournament('Gen C', 2025);
    const ballkids = await makeBallkids(tid, 10, 'SELECTED');
    await addTrainingScores(tid, ballkids);

    const res = await request(app)
      .post(`/api/teams/${tid}/generate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error || res.body.message).toMatch(/Pas assez/);
  });
});

describe('POST /api/teams/:tournamentId/generate (jour spécifique)', () => {
  it('rejette un tournamentDayId d\'un autre tournoi (400)', async () => {
    const tid = await createTournament('GenDay A', 2019);
    const ballkids = await makeBallkids(tid, 82, 'SELECTED');
    await addTrainingScores(tid, ballkids);

    const otherTid = await createTournament('GenDay Other', 2018);
    const otherDay = await makeDay(otherTid, 1);

    const res = await request(app)
      .post(`/api/teams/${tid}/generate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tournamentDayId: otherDay.id });

    expect(res.status).toBe(400);
  });

  it('renseigne le tournamentDayId sur les affectations générées', async () => {
    const tid = await createTournament('GenDay B', 2017);
    const ballkids = await makeBallkids(tid, 82, 'SELECTED');
    await addTrainingScores(tid, ballkids);
    const day = await makeDay(tid, 1);

    const res = await request(app)
      .post(`/api/teams/${tid}/generate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ tournamentDayId: day.id });

    expect(res.status).toBe(200);

    const dayAssignments = await prisma.teamAssignment.count({
      where: { team: { tournamentId: tid }, tournamentDayId: day.id },
    });
    expect(dayAssignments).toBe(82);

    const titulaires = await prisma.teamAssignment.count({
      where: { team: { tournamentId: tid }, tournamentDayId: day.id, isReserve: false },
    });
    expect(titulaires).toBe(78);
  });
});

describe('PUT /api/teams/:tournamentId/assign', () => {
  it('remplace l\'affectation du même jour (pas de doublon)', async () => {
    const tid = await createTournament('Assign A', 2016);
    await request(app).post(`/api/teams/${tid}/init`).set('Authorization', `Bearer ${adminToken}`).send({});
    const teams = await prisma.team.findMany({ where: { tournamentId: tid }, orderBy: { order: 'asc' } });
    const [bk] = await makeBallkids(tid, 1, 'SELECTED');

    await request(app)
      .put(`/api/teams/${tid}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ballkidId: bk.id, teamId: teams[0].id, position: 1 });

    const res = await request(app)
      .put(`/api/teams/${tid}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ballkidId: bk.id, teamId: teams[1].id, position: 2 });

    expect(res.status).toBe(200);

    const rows = await prisma.teamAssignment.findMany({ where: { ballkidId: bk.id, tournamentDayId: null } });
    expect(rows.length).toBe(1);
    expect(rows[0].teamId).toBe(teams[1].id);
  });

  it('fait coexister l\'affectation par défaut et l\'affectation d\'un jour (2 lignes)', async () => {
    const tid = await createTournament('Assign B', 2015);
    await request(app).post(`/api/teams/${tid}/init`).set('Authorization', `Bearer ${adminToken}`).send({});
    const teams = await prisma.team.findMany({ where: { tournamentId: tid }, orderBy: { order: 'asc' } });
    const [bk] = await makeBallkids(tid, 1, 'SELECTED');
    const day = await makeDay(tid, 1);

    // Affectation par défaut
    await request(app)
      .put(`/api/teams/${tid}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ballkidId: bk.id, teamId: teams[0].id, position: 1 });

    // Affectation spécifique à un jour
    await request(app)
      .put(`/api/teams/${tid}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ballkidId: bk.id, teamId: teams[1].id, position: 2, tournamentDayId: day.id });

    const rows = await prisma.teamAssignment.findMany({ where: { ballkidId: bk.id } });
    expect(rows.length).toBe(2);
    expect(rows.filter((r) => r.tournamentDayId === null).length).toBe(1);
    expect(rows.filter((r) => r.tournamentDayId === day.id).length).toBe(1);
  });
});

describe('POST /api/teams/:tournamentId/swap', () => {
  it('permute teamId/position/isReserve entre deux ramasseurs', async () => {
    const tid = await createTournament('Swap A', 2014);
    await request(app).post(`/api/teams/${tid}/init`).set('Authorization', `Bearer ${adminToken}`).send({});
    const teams = await prisma.team.findMany({ where: { tournamentId: tid }, orderBy: { order: 'asc' } });
    const [bk1, bk2] = await makeBallkids(tid, 2, 'SELECTED');

    await prisma.teamAssignment.create({
      data: { teamId: teams[0].id, ballkidId: bk1.id, position: 1, isReserve: false },
    });
    await prisma.teamAssignment.create({
      data: { teamId: teams[1].id, ballkidId: bk2.id, position: 3, isReserve: true },
    });

    const res = await request(app)
      .post(`/api/teams/${tid}/swap`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ballkidId1: bk1.id, ballkidId2: bk2.id });

    expect(res.status).toBe(200);

    const a1 = await prisma.teamAssignment.findFirst({ where: { ballkidId: bk1.id, tournamentDayId: null } });
    const a2 = await prisma.teamAssignment.findFirst({ where: { ballkidId: bk2.id, tournamentDayId: null } });
    // bk1 récupère les valeurs de bk2 et inversement
    expect(a1!.teamId).toBe(teams[1].id);
    expect(a1!.position).toBe(3);
    expect(a1!.isReserve).toBe(true);
    expect(a2!.teamId).toBe(teams[0].id);
    expect(a2!.position).toBe(1);
    expect(a2!.isReserve).toBe(false);
  });
});

describe('POST /api/teams/:tournamentId/balance', () => {
  // Prépare 2 équipes déséquilibrées ; team2 n'a d'abord que 5 membres
  async function seedBalance() {
    const tid = await createTournament('Balance A', 2013);
    const team1 = await prisma.team.create({ data: { tournamentId: tid, name: 'Équipe 1', order: 1 } });
    const team2 = await prisma.team.create({ data: { tournamentId: tid, name: 'Équipe 2', order: 2 } });
    const session = await prisma.trainingSession.create({
      data: { tournamentId: tid, sessionNumber: 1, date: new Date('2026-05-01') },
    });

    // 6 ramasseurs forts sur team1
    const highs = await makeBallkids(tid, 6, 'SELECTED');
    for (const b of highs.slice(0, 6)) {
      await prisma.teamAssignment.create({
        data: { teamId: team1.id, ballkidId: b.id, position: 1, isReserve: false },
      });
      await prisma.trainingScore.create({
        data: { trainingSessionId: session.id, ballkidId: b.id, scorerId: adminUserId, totalScore: 15 },
      });
    }

    // 6 ramasseurs faibles (on n'en affecte que 5 au départ)
    const lowsAll = await makeBallkids(tid, 6, 'SELECTED');
    const lows = lowsAll.filter((b) => !highs.find((h) => h.id === b.id));
    for (const b of lows) {
      await prisma.trainingScore.create({
        data: { trainingSessionId: session.id, ballkidId: b.id, scorerId: adminUserId, totalScore: 5 },
      });
    }
    for (const b of lows.slice(0, 5)) {
      await prisma.teamAssignment.create({
        data: { teamId: team2.id, ballkidId: b.id, position: 1, isReserve: false },
      });
    }

    return { tid, team2, sixthLow: lows[5] };
  }

  it('refuse si les équipes n\'ont pas 6 membres (400)', async () => {
    const { tid } = await seedBalance();
    const res = await request(app)
      .post(`/api/teams/${tid}/balance`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('réduit l\'écart puis est idempotent au 2e appel', async () => {
    const { tid, team2, sixthLow } = await seedBalance();
    // Compléter team2 à 6 membres
    await prisma.teamAssignment.create({
      data: { teamId: team2.id, ballkidId: sixthLow.id, position: 1, isReserve: false },
    });

    const res1 = await request(app)
      .post(`/api/teams/${tid}/balance`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res1.status).toBe(200);
    expect(res1.body.data.swapsPerformed).toBeGreaterThan(0);
    // L'écart initial est de 10 (15 vs 5) ; il doit être réduit
    expect(parseFloat(res1.body.data.finalDifference)).toBeLessThan(10);

    const res2 = await request(app)
      .post(`/api/teams/${tid}/balance`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res2.status).toBe(200);
    expect(res2.body.data.swapsPerformed).toBe(0);
  });
});

describe('DELETE /api/teams/:teamId', () => {
  it('supprime en cascade TeamAssignment / CourtTeam / TeamCaptain', async () => {
    const tid = await createTournament('DelTeam A', 2012);
    const team = await prisma.team.create({ data: { tournamentId: tid, name: 'Équipe X', order: 1 } });
    const [bk] = await makeBallkids(tid, 1, 'SELECTED');
    const day = await makeDay(tid, 1);
    const court = await prisma.court.create({
      data: { tournamentDayId: day.id, name: 'C1', teamCount: 1, order: 1 },
    });
    await prisma.teamAssignment.create({ data: { teamId: team.id, ballkidId: bk.id, position: 1 } });
    await prisma.courtTeam.create({ data: { courtId: court.id, teamId: team.id, order: 1 } });
    await prisma.teamCaptain.create({ data: { teamId: team.id, tournamentDayId: day.id, ballkidId: bk.id } });

    const res = await request(app)
      .delete(`/api/teams/${team.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    expect(await prisma.teamAssignment.count({ where: { teamId: team.id } })).toBe(0);
    expect(await prisma.courtTeam.count({ where: { teamId: team.id } })).toBe(0);
    expect(await prisma.teamCaptain.count({ where: { teamId: team.id } })).toBe(0);
  });
});

describe('GET /api/teams/:tournamentId', () => {
  it('dédoublonne les affectations par ballkid', async () => {
    const tid = await createTournament('GetTeams A', 2011);
    const team = await prisma.team.create({ data: { tournamentId: tid, name: 'Équipe 1', order: 1 } });
    const [bk] = await makeBallkids(tid, 1, 'SELECTED');
    // Deux affectations par défaut pour le même ramasseur (doublon)
    await prisma.teamAssignment.create({ data: { teamId: team.id, ballkidId: bk.id, position: 1 } });
    await prisma.teamAssignment.create({ data: { teamId: team.id, ballkidId: bk.id, position: 2 } });

    const res = await request(app)
      .get(`/api/teams/${tid}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const t = res.body.data.teams.find((x: any) => x.id === team.id);
    expect(t.assignments.length).toBe(1);
  });

  it('refuse sans token (401)', async () => {
    const tid = await createTournament('GetTeams B', 2010);
    const res = await request(app).get(`/api/teams/${tid}`);
    expect(res.status).toBe(401);
  });
});

describe('GET /api/teams/:tournamentId/day/:dayNumber', () => {
  it('préfère l\'affectation spécifique au jour sur celle par défaut', async () => {
    const tid = await createTournament('GetDay A', 2009);
    const team = await prisma.team.create({ data: { tournamentId: tid, name: 'Équipe 1', order: 1 } });
    const [bk] = await makeBallkids(tid, 1, 'SELECTED');
    const day = await makeDay(tid, 1);

    // Affectation par défaut (position 1) + affectation jour (position 5)
    await prisma.teamAssignment.create({ data: { teamId: team.id, ballkidId: bk.id, position: 1 } });
    await prisma.teamAssignment.create({
      data: { teamId: team.id, ballkidId: bk.id, position: 5, tournamentDayId: day.id },
    });

    const res = await request(app)
      .get(`/api/teams/${tid}/day/1`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const t = res.body.data.teams.find((x: any) => x.id === team.id);
    expect(t.assignments.length).toBe(1);
    expect(t.assignments[0].tournamentDayId).toBe(day.id);
    expect(t.assignments[0].position).toBe(5);
  });
});

describe('Permissions équipes', () => {
  it('coach interdit sur init/generate/assign/swap/balance/delete (403), autorisé en GET', async () => {
    const tid = await createTournament('Perm A', 2008);
    const team = await prisma.team.create({ data: { tournamentId: tid, name: 'Équipe 1', order: 1 } });

    const init = await request(app).post(`/api/teams/${tid}/init`).set('Authorization', `Bearer ${coachToken}`).send({});
    expect(init.status).toBe(403);

    const gen = await request(app).post(`/api/teams/${tid}/generate`).set('Authorization', `Bearer ${coachToken}`).send({});
    expect(gen.status).toBe(403);

    const assign = await request(app).put(`/api/teams/${tid}/assign`).set('Authorization', `Bearer ${coachToken}`).send({});
    expect(assign.status).toBe(403);

    const swap = await request(app).post(`/api/teams/${tid}/swap`).set('Authorization', `Bearer ${coachToken}`).send({});
    expect(swap.status).toBe(403);

    const balance = await request(app).post(`/api/teams/${tid}/balance`).set('Authorization', `Bearer ${coachToken}`).send({});
    expect(balance.status).toBe(403);

    const del = await request(app).delete(`/api/teams/${team.id}`).set('Authorization', `Bearer ${coachToken}`);
    expect(del.status).toBe(403);

    const get = await request(app).get(`/api/teams/${tid}`).set('Authorization', `Bearer ${coachToken}`);
    expect(get.status).toBe(200);
  });
});

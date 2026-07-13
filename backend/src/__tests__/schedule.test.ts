import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { setupTestDB, teardownTestDB, getApp, prisma } from './setup.js';
import bcrypt from 'bcryptjs';

let app: Express;
let adminToken: string;
let coachToken: string;

let emailCounter = 0;

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

async function makeBallkid(tournamentId: string) {
  return prisma.ballkid.create({
    data: {
      firstName: `BK${emailCounter}`,
      lastName: 'X',
      email: `bk${emailCounter++}@sched.test`,
      birthDate: new Date('2012-01-01'),
      gender: 'MALE',
      status: 'SELECTED',
      tournamentId,
    },
  });
}

async function makeTeam(tournamentId: string, order: number) {
  return prisma.team.create({ data: { tournamentId, name: `Équipe ${order}`, order } });
}

async function makeDay(tournamentId: string, dayNumber: number, ballkidCount = 78) {
  return prisma.tournamentDay.create({
    data: { tournamentId, dayNumber, date: new Date('2026-05-24'), ballkidCount },
  });
}

beforeAll(async () => {
  await setupTestDB();
  app = await getApp();

  const hash = await bcrypt.hash('admin123', 10);
  await prisma.user.create({
    data: { email: 'admin@sched.test', password: hash, firstName: 'Admin', lastName: 'Test', role: 'ADMIN' },
  });
  const adminRes = await request(app).post('/api/auth/login').send({ email: 'admin@sched.test', password: 'admin123' });
  adminToken = adminRes.body.data.token;

  const coachHash = await bcrypt.hash('coach123', 10);
  await prisma.user.create({
    data: { email: 'coach@sched.test', password: coachHash, firstName: 'Coach', lastName: 'Test', role: 'COACH' },
  });
  const coachRes = await request(app).post('/api/auth/login').send({ email: 'coach@sched.test', password: 'coach123' });
  coachToken = coachRes.body.data.token;
});

afterAll(async () => {
  await teardownTestDB();
});

describe('POST /api/schedule/:tournamentId/day', () => {
  it('crée un jour', async () => {
    const tid = await createTournament('Sched A', 2020);
    const res = await request(app)
      .post(`/api/schedule/${tid}/day`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ dayNumber: 1, date: '2026-05-24', ballkidCount: 78 });

    expect(res.status).toBe(200);
    expect(res.body.data.day.dayNumber).toBe(1);

    const count = await prisma.tournamentDay.count({ where: { tournamentId: tid, dayNumber: 1 } });
    expect(count).toBe(1);
  });

  it('upsert un dayNumber existant sans créer de doublon', async () => {
    const tid = await createTournament('Sched B', 2021);
    await request(app)
      .post(`/api/schedule/${tid}/day`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ dayNumber: 1, date: '2026-05-24', ballkidCount: 78 });

    const res = await request(app)
      .post(`/api/schedule/${tid}/day`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ dayNumber: 1, date: '2026-05-25', ballkidCount: 60 });

    expect(res.status).toBe(200);
    const count = await prisma.tournamentDay.count({ where: { tournamentId: tid, dayNumber: 1 } });
    expect(count).toBe(1);
    expect(res.body.data.day.ballkidCount).toBe(60);
  });

  it('copie la config du jour précédent si ballkidCount identique, pas les CourtTeam/affectations si différent', async () => {
    const tid = await createTournament('Sched Copy', 2022);
    const teamA = await makeTeam(tid, 1);
    const bk = await makeBallkid(tid);

    // Jour 1 avec un terrain
    await request(app)
      .post(`/api/schedule/${tid}/day`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ dayNumber: 1, date: '2026-05-24', ballkidCount: 78, courts: [{ name: 'Court A', teamCount: 2 }] });

    const day1 = await prisma.tournamentDay.findFirstOrThrow({ where: { tournamentId: tid, dayNumber: 1 } });
    const court1 = await prisma.court.findFirstOrThrow({ where: { tournamentDayId: day1.id } });
    // Ajouter une équipe au terrain + une affectation jour 1
    await prisma.courtTeam.create({ data: { courtId: court1.id, teamId: teamA.id, order: 1 } });
    await prisma.teamAssignment.create({
      data: { teamId: teamA.id, ballkidId: bk.id, position: 1, tournamentDayId: day1.id },
    });

    // Jour 2 : même ballkidCount => copie complète
    await request(app)
      .post(`/api/schedule/${tid}/day`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ dayNumber: 2, date: '2026-05-25', ballkidCount: 78 });

    const day2 = await prisma.tournamentDay.findFirstOrThrow({ where: { tournamentId: tid, dayNumber: 2 } });
    const day2Courts = await prisma.court.findMany({ where: { tournamentDayId: day2.id } });
    expect(day2Courts.length).toBe(1);
    const day2CourtTeams = await prisma.courtTeam.count({ where: { courtId: day2Courts[0].id } });
    expect(day2CourtTeams).toBe(1);
    const day2Assignments = await prisma.teamAssignment.count({ where: { tournamentDayId: day2.id } });
    expect(day2Assignments).toBe(1);

    // Jour 3 : ballkidCount différent de celui du jour 2 => terrain copié mais pas les équipes
    await request(app)
      .post(`/api/schedule/${tid}/day`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ dayNumber: 3, date: '2026-05-26', ballkidCount: 50 });

    const day3 = await prisma.tournamentDay.findFirstOrThrow({ where: { tournamentId: tid, dayNumber: 3 } });
    const day3Courts = await prisma.court.findMany({ where: { tournamentDayId: day3.id } });
    expect(day3Courts.length).toBe(1);
    const day3CourtTeams = await prisma.courtTeam.count({ where: { courtId: day3Courts[0].id } });
    expect(day3CourtTeams).toBe(0);
    const day3Assignments = await prisma.teamAssignment.count({ where: { tournamentDayId: day3.id } });
    expect(day3Assignments).toBe(0);
  });
});

describe('Terrains (courts)', () => {
  it('POST ajoute un terrain avec order incrémental et teamCount par défaut', async () => {
    const tid = await createTournament('Court A', 2023);
    await makeDay(tid, 1);

    const res1 = await request(app)
      .post(`/api/schedule/${tid}/day/1/court`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'C1' });
    expect(res1.status).toBe(200);
    expect(res1.body.data.court.order).toBe(1);
    expect(res1.body.data.court.teamCount).toBe(1);

    const res2 = await request(app)
      .post(`/api/schedule/${tid}/day/1/court`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'C2' });
    expect(res2.body.data.court.order).toBe(2);
  });

  it('POST court renvoie 404 si le jour est absent', async () => {
    const tid = await createTournament('Court B', 2024);
    const res = await request(app)
      .post(`/api/schedule/${tid}/day/999/court`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'C1' });
    expect(res.status).toBe(404);
  });

  it('PUT modifie un terrain', async () => {
    const tid = await createTournament('Court C', 2025);
    const day = await makeDay(tid, 1);
    const court = await prisma.court.create({ data: { tournamentDayId: day.id, name: 'C1', teamCount: 1, order: 1 } });

    const res = await request(app)
      .put(`/api/schedule/court/${court.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'C1b', teamCount: 3 });
    expect(res.status).toBe(200);
    expect(res.body.data.court.name).toBe('C1b');
    expect(res.body.data.court.teamCount).toBe(3);
  });

  it('DELETE supprime le terrain en cascade des CourtTeam', async () => {
    const tid = await createTournament('Court D', 2026);
    const day = await makeDay(tid, 1);
    const court = await prisma.court.create({ data: { tournamentDayId: day.id, name: 'C1', teamCount: 1, order: 1 } });
    const team = await makeTeam(tid, 1);
    await prisma.courtTeam.create({ data: { courtId: court.id, teamId: team.id, order: 1 } });

    const res = await request(app)
      .delete(`/api/schedule/court/${court.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    expect(await prisma.courtTeam.count({ where: { courtId: court.id } })).toBe(0);
  });
});

describe('PUT /api/schedule/court/:courtId/teams', () => {
  it('remplace intégralement les équipes assignées', async () => {
    const tid = await createTournament('CourtTeams A', 2019);
    const day = await makeDay(tid, 1);
    const court = await prisma.court.create({ data: { tournamentDayId: day.id, name: 'C1', teamCount: 3, order: 1 } });
    const a = await makeTeam(tid, 1);
    const b = await makeTeam(tid, 2);
    const c = await makeTeam(tid, 3);

    await request(app)
      .put(`/api/schedule/court/${court.id}/teams`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ teamIds: [a.id, b.id] });
    expect(await prisma.courtTeam.count({ where: { courtId: court.id } })).toBe(2);

    await request(app)
      .put(`/api/schedule/court/${court.id}/teams`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ teamIds: [c.id] });
    const remaining = await prisma.courtTeam.findMany({ where: { courtId: court.id } });
    expect(remaining.length).toBe(1);
    expect(remaining[0].teamId).toBe(c.id);

    await request(app)
      .put(`/api/schedule/court/${court.id}/teams`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ teamIds: [] });
    expect(await prisma.courtTeam.count({ where: { courtId: court.id } })).toBe(0);
  });
});

describe('PUT capitaine', () => {
  async function seedCaptain() {
    const tid = await createTournament('Captain A', 2018);
    const day = await makeDay(tid, 1);
    const team = await makeTeam(tid, 1);
    const m1 = await makeBallkid(tid);
    const m2 = await makeBallkid(tid);
    const reserve = await makeBallkid(tid);
    const outsider = await makeBallkid(tid);

    await prisma.teamAssignment.create({ data: { teamId: team.id, ballkidId: m1.id, position: 1, isReserve: false } });
    await prisma.teamAssignment.create({ data: { teamId: team.id, ballkidId: m2.id, position: 2, isReserve: false } });
    await prisma.teamAssignment.create({ data: { teamId: team.id, ballkidId: reserve.id, isReserve: true } });
    // outsider : aucune affectation dans cette équipe

    return { tid, team, m1, m2, reserve, outsider };
  }

  it('définit un membre non-réserviste, upsert un seul par équipe/jour', async () => {
    const { tid, team, m1, m2 } = await seedCaptain();

    const res1 = await request(app)
      .put(`/api/schedule/${tid}/day/1/team/${team.id}/captain`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ballkidId: m1.id });
    expect(res1.status).toBe(200);

    const day = await prisma.tournamentDay.findFirstOrThrow({ where: { tournamentId: tid, dayNumber: 1 } });
    expect(await prisma.teamCaptain.count({ where: { teamId: team.id, tournamentDayId: day.id } })).toBe(1);

    // Changement de capitaine => toujours une seule ligne
    const res2 = await request(app)
      .put(`/api/schedule/${tid}/day/1/team/${team.id}/captain`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ballkidId: m2.id });
    expect(res2.status).toBe(200);
    const captains = await prisma.teamCaptain.findMany({ where: { teamId: team.id, tournamentDayId: day.id } });
    expect(captains.length).toBe(1);
    expect(captains[0].ballkidId).toBe(m2.id);
  });

  it('refuse un réserviste ou un ramasseur hors équipe (400)', async () => {
    const { tid, team, reserve, outsider } = await seedCaptain();

    const resReserve = await request(app)
      .put(`/api/schedule/${tid}/day/1/team/${team.id}/captain`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ballkidId: reserve.id });
    expect(resReserve.status).toBe(400);

    const resOut = await request(app)
      .put(`/api/schedule/${tid}/day/1/team/${team.id}/captain`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ballkidId: outsider.id });
    expect(resOut.status).toBe(400);
  });

  it('retire le capitaine quand ballkidId est null', async () => {
    const { tid, team, m1 } = await seedCaptain();
    await request(app)
      .put(`/api/schedule/${tid}/day/1/team/${team.id}/captain`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ballkidId: m1.id });

    const res = await request(app)
      .put(`/api/schedule/${tid}/day/1/team/${team.id}/captain`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ballkidId: null });
    expect(res.status).toBe(200);
    expect(res.body.data.captain).toBeNull();

    const day = await prisma.tournamentDay.findFirstOrThrow({ where: { tournamentId: tid, dayNumber: 1 } });
    expect(await prisma.teamCaptain.count({ where: { teamId: team.id, tournamentDayId: day.id } })).toBe(0);
  });
});

describe('DELETE /api/schedule/:tournamentId/day/:dayNumber (BUG figé)', () => {
  it('ne supprime PAS les TeamAssignment day-specific : leur tournamentDayId passe à null', async () => {
    const tid = await createTournament('DelDay A', 2017);
    const day = await makeDay(tid, 1);
    const team = await makeTeam(tid, 1);
    const bk = await makeBallkid(tid);
    const assignment = await prisma.teamAssignment.create({
      data: { teamId: team.id, ballkidId: bk.id, position: 1, tournamentDayId: day.id },
    });

    const res = await request(app)
      .delete(`/api/schedule/${tid}/day/1`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    // Le jour est supprimé
    expect(await prisma.tournamentDay.count({ where: { id: day.id } })).toBe(0);

    // BUG: devrait probablement être supprimée en cascade
    const survivor = await prisma.teamAssignment.findUnique({ where: { id: assignment.id } });
    expect(survivor).not.toBeNull();
    expect(survivor!.tournamentDayId).toBeNull();
  });
});

describe('Permissions planning', () => {
  it('coach interdit (403) sur les mutations jour/terrain/courtTeam/capitaine', async () => {
    const tid = await createTournament('Perm Sched', 2016);
    const day = await makeDay(tid, 1);
    const court = await prisma.court.create({ data: { tournamentDayId: day.id, name: 'C1', teamCount: 1, order: 1 } });
    const team = await makeTeam(tid, 1);

    const postDay = await request(app)
      .post(`/api/schedule/${tid}/day`)
      .set('Authorization', `Bearer ${coachToken}`)
      .send({ dayNumber: 2, date: '2026-05-25', ballkidCount: 78 });
    expect(postDay.status).toBe(403);

    const putDay = await request(app)
      .put(`/api/schedule/${tid}/day/1`)
      .set('Authorization', `Bearer ${coachToken}`)
      .send({ ballkidCount: 60 });
    expect(putDay.status).toBe(403);

    const delDay = await request(app)
      .delete(`/api/schedule/${tid}/day/1`)
      .set('Authorization', `Bearer ${coachToken}`);
    expect(delDay.status).toBe(403);

    const postCourt = await request(app)
      .post(`/api/schedule/${tid}/day/1/court`)
      .set('Authorization', `Bearer ${coachToken}`)
      .send({ name: 'C2' });
    expect(postCourt.status).toBe(403);

    const putCourt = await request(app)
      .put(`/api/schedule/court/${court.id}`)
      .set('Authorization', `Bearer ${coachToken}`)
      .send({ name: 'X' });
    expect(putCourt.status).toBe(403);

    const delCourt = await request(app)
      .delete(`/api/schedule/court/${court.id}`)
      .set('Authorization', `Bearer ${coachToken}`);
    expect(delCourt.status).toBe(403);

    const putTeams = await request(app)
      .put(`/api/schedule/court/${court.id}/teams`)
      .set('Authorization', `Bearer ${coachToken}`)
      .send({ teamIds: [team.id] });
    expect(putTeams.status).toBe(403);

    const putCaptain = await request(app)
      .put(`/api/schedule/${tid}/day/1/team/${team.id}/captain`)
      .set('Authorization', `Bearer ${coachToken}`)
      .send({ ballkidId: null });
    expect(putCaptain.status).toBe(403);
  });

  it('refuse la lecture du planning sans token (401)', async () => {
    const tid = await createTournament('Perm Sched 2', 2015);
    const res = await request(app).get(`/api/schedule/${tid}`);
    expect(res.status).toBe(401);
  });
});

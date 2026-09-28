import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { setupTestDB, teardownTestDB, getApp, prisma } from './setup.js';
import bcrypt from 'bcryptjs';

// Demande admin : "changement courts pas possible pour la semaine, a faire
// jour/jour" -> appliquer les terrains d'un jour a tous les autres jours.

let app: Express;
let adminToken: string;
let coachToken: string;
let seq = 0;

beforeAll(async () => {
  await setupTestDB();
  app = await getApp();
  const hash = await bcrypt.hash('admin123', 10);
  await prisma.user.create({ data: { email: 'admin@courts.test', password: hash, firstName: 'Admin', lastName: 'Test', role: 'ADMIN' } });
  adminToken = (await request(app).post('/api/auth/login').send({ email: 'admin@courts.test', password: 'admin123' })).body.data.token;
  await prisma.user.create({ data: { email: 'coach@courts.test', password: hash, firstName: 'Coach', lastName: 'Test', role: 'COACH' } });
  coachToken = (await request(app).post('/api/auth/login').send({ email: 'coach@courts.test', password: 'admin123' })).body.data.token;
});

afterAll(async () => {
  await teardownTestDB();
});

async function setup() {
  seq += 1;
  const t = await prisma.tournament.create({
    data: { name: `Courts ${seq}`, year: 2000 + seq, startDate: new Date('2026-05-24'), endDate: new Date('2026-06-01'), isActive: false },
  });
  const days: Record<number, string> = {};
  for (let n = 1; n <= 3; n++) {
    const d = await prisma.tournamentDay.create({ data: { tournamentId: t.id, dayNumber: n, date: new Date('2026-05-24'), ballkidCount: 78 } });
    days[n] = d.id;
  }
  // Jour 1 : la reference
  await prisma.court.create({ data: { tournamentDayId: days[1], name: 'Central', teamCount: 2, order: 1 } });
  await prisma.court.create({ data: { tournamentDayId: days[1], name: 'Court 1', teamCount: 2, order: 2 } });
  // Jour 2 : un terrain deja affecte a un coach (ne doit PAS etre supprime)
  const c2 = await prisma.court.create({ data: { tournamentDayId: days[2], name: 'X', teamCount: 1, order: 1 } });
  const coachUser = await prisma.user.create({
    data: { email: `c${seq}@courts.test`, password: 'x', firstName: 'C', lastName: 'C', role: 'COACH' },
  });
  const coach = await prisma.coach.create({ data: { userId: coachUser.id, tournamentId: t.id } });
  await prisma.coachAssignment.create({ data: { coachId: coach.id, tournamentDayId: days[2], courtId: c2.id } });
  // Jour 3 : vide
  return { tid: t.id, days, c2Id: c2.id };
}

describe('POST /api/schedule/:tournamentId/day/:dayNumber/courts/apply-to-all', () => {
  it('copie les terrains du jour source vers les autres jours, met a jour par ordre, ne supprime jamais', async () => {
    const { tid, days, c2Id } = await setup();

    const res = await request(app)
      .post(`/api/schedule/${tid}/day/1/courts/apply-to-all`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ updated: 1, created: 3 });

    const day3 = await prisma.court.findMany({ where: { tournamentDayId: days[3] }, orderBy: { order: 'asc' } });
    expect(day3.map((c) => [c.name, c.teamCount, c.order])).toEqual([['Central', 2, 1], ['Court 1', 2, 2]]);

    const day2 = await prisma.court.findMany({ where: { tournamentDayId: days[2] }, orderBy: { order: 'asc' } });
    expect(day2.map((c) => [c.name, c.teamCount, c.order])).toEqual([['Central', 2, 1], ['Court 1', 2, 2]]);
    // Le terrain d'ordre 1 du jour 2 est le MEME enregistrement (renomme) : son coach est conserve
    expect(day2[0].id).toBe(c2Id);
    expect(await prisma.coachAssignment.count({ where: { courtId: c2Id } })).toBe(1);

    expect(await prisma.court.count({ where: { tournamentDayId: days[1] } })).toBe(2);
  });

  it('refuse un coach (403) et un jour inexistant (404)', async () => {
    const { tid } = await setup();
    const forbidden = await request(app).post(`/api/schedule/${tid}/day/1/courts/apply-to-all`).set('Authorization', `Bearer ${coachToken}`);
    expect(forbidden.status).toBe(403);
    const missing = await request(app).post(`/api/schedule/${tid}/day/9/courts/apply-to-all`).set('Authorization', `Bearer ${adminToken}`);
    expect(missing.status).toBe(404);
  });
});

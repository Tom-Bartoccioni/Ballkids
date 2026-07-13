import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { setupTestDB, teardownTestDB, getApp, prisma } from './setup.js';
import bcrypt from 'bcryptjs';

/**
 * Tests des coachs : cycle de vie (register / delete), disponibilités
 * (planifiées par dayNumber + bulk par dayId), affectations (assign),
 * lecture/planning, et reprise d'année (clone).
 *
 * Endpoints (montés sous /api/coaches, cf. app.ts) :
 *   GET    /:tournamentId
 *   GET    /:tournamentId/planning
 *   GET    /:tournamentId/availabilities
 *   GET    /:tournamentId/day/:dayNumber/available
 *   GET    /detail/:coachId
 *   POST   /:tournamentId/assign        { coachId, tournamentDayId, courtId }
 *   DELETE /:tournamentId/assign        { coachId, tournamentDayId }
 *   DELETE /:coachId
 *   PUT    /:coachId/availability        { isAvailable, dayNumber }
 *   PUT    /:coachId/availability/bulk   { availableDayIds }
 * Création de coach : POST /api/auth/register { role: 'COACH', tournamentId }
 *
 * Plusieurs tests « figent » des BUGS connus du code actuel (marqués `// BUG:`).
 */

let app: Express;
let adminToken: string;
let coachToken: string;
let tournamentId: string;

// Jours et terrains du tournoi actif, indexés par dayNumber (1..9)
const dayIds: Record<number, string> = {};
const courtIds: Record<number, string> = {};

// Base UTC : 24 mai 2026 = dayNumber 1 (aligné sur startDate du tournoi)
const START_UTC = Date.UTC(2026, 4, 24);
const dateOfDay = (n: number) => new Date(START_UTC + (n - 1) * 86400000);

let coachPassHash: string;

// Crée un utilisateur COACH + son profil Coach sur le tournoi actif
async function makeCoach(email: string): Promise<{ userId: string; coachId: string }> {
  const user = await prisma.user.create({
    data: { email, password: coachPassHash, firstName: 'C', lastName: email, role: 'COACH' },
  });
  const coach = await prisma.coach.create({ data: { userId: user.id, tournamentId } });
  return { userId: user.id, coachId: coach.id };
}

beforeAll(async () => {
  await setupTestDB();
  app = await getApp();

  // Admin
  const adminHash = await bcrypt.hash('admin123', 10);
  await prisma.user.create({
    data: { email: 'admin@coach.test', password: adminHash, firstName: 'Admin', lastName: 'Test', role: 'ADMIN' },
  });
  const adminRes = await request(app).post('/api/auth/login').send({ email: 'admin@coach.test', password: 'admin123' });
  adminToken = adminRes.body.data.token;

  // Coach (pour tester les 403 requireAdmin et la lecture)
  coachPassHash = await bcrypt.hash('coach123', 10);
  await prisma.user.create({
    data: { email: 'coach@coach.test', password: coachPassHash, firstName: 'Coach', lastName: 'Test', role: 'COACH' },
  });
  const coachRes = await request(app).post('/api/auth/login').send({ email: 'coach@coach.test', password: 'coach123' });
  coachToken = coachRes.body.data.token;

  // Tournoi actif (24 mai -> 7 juin 2026 = 15 jours)
  const tournament = await prisma.tournament.create({
    data: {
      name: 'Coach Tournament',
      year: 2026,
      startDate: new Date(START_UTC),
      endDate: new Date(Date.UTC(2026, 5, 7)),
      isActive: true,
    },
  });
  tournamentId = tournament.id;

  // Jours 1..9 + un terrain par jour (dates alignées sur le range calculé par les routes)
  for (let n = 1; n <= 9; n++) {
    const day = await prisma.tournamentDay.create({
      data: { tournamentId, dayNumber: n, date: dateOfDay(n), ballkidCount: 0 },
    });
    dayIds[n] = day.id;
    const court = await prisma.court.create({
      data: { tournamentDayId: day.id, name: `Court ${n}`, teamCount: 2, order: n },
    });
    courtIds[n] = court.id;
  }
});

afterAll(async () => {
  await teardownTestDB();
});

// ============================================================
// CYCLE DE VIE : register / delete
// ============================================================
describe('POST /api/auth/register (création de coach)', () => {
  it('crée un User COACH + un profil Coach quand tournamentId est fourni', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'newcoach@coach.test',
        password: 'secret6',
        firstName: 'New',
        lastName: 'Coach',
        role: 'COACH',
        tournamentId,
      });

    expect(res.status).toBe(201);
    const userId = res.body.data.user.id;
    expect(res.body.data.user.role).toBe('COACH');

    const coach = await prisma.coach.findFirst({ where: { userId, tournamentId } });
    expect(coach).not.toBeNull();
  });

  it('crée le User mais AUCUN profil Coach sans tournamentId', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'nocoachprofile@coach.test',
        password: 'secret6',
        firstName: 'No',
        lastName: 'Profile',
        role: 'COACH',
      });

    expect(res.status).toBe(201);
    const userId = res.body.data.user.id;
    const coachCount = await prisma.coach.count({ where: { userId } });
    expect(coachCount).toBe(0);
  });

  it('refuse la création par un coach (403)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${coachToken}`)
      .send({
        email: 'forbidden@coach.test',
        password: 'secret6',
        firstName: 'For',
        lastName: 'Bidden',
        role: 'COACH',
        tournamentId,
      });

    expect(res.status).toBe(403);
  });

  it('refuse un email déjà utilisé (400)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'admin@coach.test', // déjà pris
        password: 'secret6',
        firstName: 'Dup',
        lastName: 'Licate',
        role: 'COACH',
        tournamentId,
      });

    expect(res.status).toBe(400);
  });

  it('refuse un mot de passe < 6 caractères (400)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'shortpw@coach.test',
        password: '123',
        firstName: 'Short',
        lastName: 'Pw',
        role: 'COACH',
        tournamentId,
      });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/coaches/:coachId', () => {
  it('supprime le Coach ET le User associé (admin)', async () => {
    const { userId, coachId } = await makeCoach('todelete@coach.test');

    const res = await request(app)
      .delete(`/api/coaches/${coachId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(await prisma.coach.count({ where: { id: coachId } })).toBe(0);
    expect(await prisma.user.count({ where: { id: userId } })).toBe(0);
  });

  it('supprime AUSSI les profils d\'autres années du même user + son login', async () => {
    // Un user avec deux profils Coach : un sur le tournoi actif, un sur un 2e tournoi
    const user = await prisma.user.create({
      data: { email: 'multi@coach.test', password: coachPassHash, firstName: 'Multi', lastName: 'Year', role: 'COACH' },
    });
    const otherTournament = await prisma.tournament.create({
      data: {
        name: 'Autre Année',
        year: 2025,
        startDate: new Date('2025-05-24'),
        endDate: new Date('2025-06-07'),
        isActive: false,
      },
    });
    const coachActive = await prisma.coach.create({ data: { userId: user.id, tournamentId } });
    const coachOther = await prisma.coach.create({ data: { userId: user.id, tournamentId: otherTournament.id } });

    // On supprime via le coachId du tournoi actif seulement
    const res = await request(app)
      .delete(`/api/coaches/${coachActive.id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    // BUG: supprime tous les profils d'autres années + le login
    // La route supprime le User associé, ce qui cascade sur TOUS ses profils Coach.
    expect(await prisma.coach.count({ where: { id: coachOther.id } })).toBe(0);
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(0);
  });

  it('refuse la suppression par un coach (403)', async () => {
    const { coachId } = await makeCoach('protected@coach.test');
    const res = await request(app)
      .delete(`/api/coaches/${coachId}`)
      .set('Authorization', `Bearer ${coachToken}`);
    expect(res.status).toBe(403);
  });

  it('renvoie 404 pour un coach inexistant', async () => {
    const res = await request(app)
      .delete('/api/coaches/nonexistent-id')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});

// ============================================================
// DISPONIBILITÉS
// ============================================================
describe('PUT /api/coaches/:coachId/availability (planifiée par dayNumber)', () => {
  it('ajoute une dispo planifiée de façon idempotente (pas de doublon)', async () => {
    const { coachId } = await makeCoach('avail-idem@coach.test');

    for (let i = 0; i < 2; i++) {
      const res = await request(app)
        .put(`/api/coaches/${coachId}/availability`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isAvailable: true, dayNumber: 3 });
      expect(res.status).toBe(200);
    }

    const count = await prisma.coachPlannedAvailability.count({ where: { coachId, dayNumber: 3 } });
    expect(count).toBe(1);
  });

  it('refuse sans dayNumber (400)', async () => {
    const { coachId } = await makeCoach('avail-noday@coach.test');
    const res = await request(app)
      .put(`/api/coaches/${coachId}/availability`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isAvailable: true });
    expect(res.status).toBe(400);
  });

  it('retirer (isAvailable:false) purge assignment + CoachAvailability du jour existant', async () => {
    const { coachId } = await makeCoach('avail-purge@coach.test');

    // Dispo planifiée + affectation + dispo réelle sur le jour 2
    await request(app)
      .put(`/api/coaches/${coachId}/availability`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isAvailable: true, dayNumber: 2 });
    await prisma.coachAssignment.create({
      data: { coachId, tournamentDayId: dayIds[2], courtId: courtIds[2] },
    });
    await prisma.coachAvailability.create({
      data: { coachId, tournamentDayId: dayIds[2] },
    });

    const res = await request(app)
      .put(`/api/coaches/${coachId}/availability`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isAvailable: false, dayNumber: 2 });
    expect(res.status).toBe(200);

    expect(await prisma.coachPlannedAvailability.count({ where: { coachId, dayNumber: 2 } })).toBe(0);
    expect(await prisma.coachAssignment.count({ where: { coachId, tournamentDayId: dayIds[2] } })).toBe(0);
    expect(await prisma.coachAvailability.count({ where: { coachId, tournamentDayId: dayIds[2] } })).toBe(0);
  });

  it('refuse par un coach (403)', async () => {
    const { coachId } = await makeCoach('avail-403@coach.test');
    const res = await request(app)
      .put(`/api/coaches/${coachId}/availability`)
      .set('Authorization', `Bearer ${coachToken}`)
      .send({ isAvailable: true, dayNumber: 1 });
    expect(res.status).toBe(403);
  });

  it('renvoie 404 pour un coach inexistant', async () => {
    const res = await request(app)
      .put('/api/coaches/nonexistent-id/availability')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isAvailable: true, dayNumber: 1 });
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/coaches/:coachId/availability/bulk (par dayId)', () => {
  it('remplace les CoachAvailability par availableDayIds', async () => {
    const { coachId } = await makeCoach('bulk-replace@coach.test');

    let res = await request(app)
      .put(`/api/coaches/${coachId}/availability/bulk`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availableDayIds: [dayIds[1], dayIds[2]] });
    expect(res.status).toBe(200);
    expect(await prisma.coachAvailability.count({ where: { coachId } })).toBe(2);

    // Un nouvel appel remplace (ne cumule pas)
    res = await request(app)
      .put(`/api/coaches/${coachId}/availability/bulk`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availableDayIds: [dayIds[1]] });
    expect(res.status).toBe(200);
    expect(await prisma.coachAvailability.count({ where: { coachId } })).toBe(1);
  });

  it('refuse de retirer un jour déjà assigné (400)', async () => {
    const { coachId } = await makeCoach('bulk-assigned@coach.test');
    await prisma.coachAssignment.create({
      data: { coachId, tournamentDayId: dayIds[1], courtId: courtIds[1] },
    });

    const res = await request(app)
      .put(`/api/coaches/${coachId}/availability/bulk`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availableDayIds: [dayIds[2]] }); // ne contient pas dayIds[1] (assigné)
    expect(res.status).toBe(400);
  });

  it('GET availabilities (dispos PLANIFIÉES) ne reflète pas le bulk', async () => {
    const { coachId } = await makeCoach('desync@coach.test');

    // Dispo planifiée sur le jour 1 (par dayNumber)
    await request(app)
      .put(`/api/coaches/${coachId}/availability`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isAvailable: true, dayNumber: 1 });

    // Bulk sur les jours 2 et 3 (par dayId) -> écrit CoachAvailability, PAS plannedAvailability
    await request(app)
      .put(`/api/coaches/${coachId}/availability/bulk`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ availableDayIds: [dayIds[2], dayIds[3]] });

    const res = await request(app)
      .get(`/api/coaches/${tournamentId}/availabilities`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const entry = res.body.data.coachAvailabilities.find((c: any) => c.id === coachId);
    expect(entry).toBeDefined();

    // BUG connu: planned vs bulk désynchronisés
    // GET availabilities lit les dispos PLANIFIÉES : seul le jour 1 est vu,
    // le bulk (jours 2/3) est totalement ignoré ici.
    expect(entry.totalAvailable).toBe(1);
    const d1 = entry.schedule.find((s: any) => s.dayNumber === 1);
    const d2 = entry.schedule.find((s: any) => s.dayNumber === 2);
    expect(d1.isAvailable).toBe(true);
    expect(d2.isAvailable).toBe(false);
  });
});

// ============================================================
// AFFECTATIONS (assign)
// ============================================================
describe('POST /api/coaches/:tournamentId/assign', () => {
  it('crée une affectation', async () => {
    const { coachId } = await makeCoach('assign-create@coach.test');
    const res = await request(app)
      .post(`/api/coaches/${tournamentId}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ coachId, tournamentDayId: dayIds[1], courtId: courtIds[1] });

    expect(res.status).toBe(200);
    expect(res.body.data.assignment).toBeDefined();
    expect(await prisma.coachAssignment.count({ where: { coachId } })).toBe(1);
  });

  it('ré-affecter le même coach/jour sur un autre terrain met à jour (pas de doublon)', async () => {
    const { coachId } = await makeCoach('assign-update@coach.test');

    await request(app)
      .post(`/api/coaches/${tournamentId}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ coachId, tournamentDayId: dayIds[1], courtId: courtIds[1] });

    const res = await request(app)
      .post(`/api/coaches/${tournamentId}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ coachId, tournamentDayId: dayIds[1], courtId: courtIds[2] });

    expect(res.status).toBe(200);
    expect(res.body.data.assignment.courtId).toBe(courtIds[2]);
    // Toujours une seule affectation pour ce coach
    expect(await prisma.coachAssignment.count({ where: { coachId } })).toBe(1);
  });

  it('refuse le 7e jour CONSÉCUTIF (400) mais autorise un 7e jour non consécutif', async () => {
    const { coachId } = await makeCoach('assign-consecutive@coach.test');
    // Pré-affecte 6 jours consécutifs sur des terrains DIFFÉRENTS
    // (nécessaire à cause de @@unique([coachId, courtId]))
    for (let n = 1; n <= 6; n++) {
      await prisma.coachAssignment.create({
        data: { coachId, tournamentDayId: dayIds[n], courtId: courtIds[n] },
      });
    }

    // 7e jour consécutif -> refusé
    const consecutive = await request(app)
      .post(`/api/coaches/${tournamentId}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ coachId, tournamentDayId: dayIds[7], courtId: courtIds[7] });
    expect(consecutive.status).toBe(400);

    // 7e jour NON consécutif (jour 9, saut du jour 8) -> autorisé
    const nonConsecutive = await request(app)
      .post(`/api/coaches/${tournamentId}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ coachId, tournamentDayId: dayIds[9], courtId: courtIds[9] });
    expect(nonConsecutive.status).toBe(200);
  });

  it('même coach + même terrain sur 2 jours -> viole @@unique([coachId, courtId])', async () => {
    const { coachId } = await makeCoach('assign-uniquebug@coach.test');

    const first = await request(app)
      .post(`/api/coaches/${tournamentId}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ coachId, tournamentDayId: dayIds[1], courtId: courtIds[1] });
    expect(first.status).toBe(200);

    // Même terrain (courtIds[1]) mais un autre jour : la recherche existante se fait
    // sur (coachId, tournamentDayId) -> rien trouvé -> create -> violation unique.
    const second = await request(app)
      .post(`/api/coaches/${tournamentId}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ coachId, tournamentDayId: dayIds[2], courtId: courtIds[1] });

    // BUG: contrainte unique mal choisie, devrait être [coachId, dayId]
    expect(second.status).toBe(500);
  });

  it('accepte un coach SANS aucune plannedAvailability (pas de garde-fou)', async () => {
    const { coachId } = await makeCoach('assign-noavail@coach.test');
    // BUG: aucune vérification que le coach est déclaré disponible ce jour-là
    const res = await request(app)
      .post(`/api/coaches/${tournamentId}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ coachId, tournamentDayId: dayIds[1], courtId: courtIds[1] });
    expect(res.status).toBe(200);
  });

  it('renvoie 404 pour un coach inexistant', async () => {
    const res = await request(app)
      .post(`/api/coaches/${tournamentId}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ coachId: 'nonexistent-id', tournamentDayId: dayIds[1], courtId: courtIds[1] });
    expect(res.status).toBe(404);
  });

  it('renvoie 404 pour un jour inexistant', async () => {
    const { coachId } = await makeCoach('assign-noday404@coach.test');
    const res = await request(app)
      .post(`/api/coaches/${tournamentId}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ coachId, tournamentDayId: 'nonexistent-day', courtId: courtIds[1] });
    expect(res.status).toBe(404);
  });

  it('refuse l\'affectation par un coach (403)', async () => {
    const { coachId } = await makeCoach('assign-403@coach.test');
    const res = await request(app)
      .post(`/api/coaches/${tournamentId}/assign`)
      .set('Authorization', `Bearer ${coachToken}`)
      .send({ coachId, tournamentDayId: dayIds[1], courtId: courtIds[1] });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/coaches/:tournamentId/assign', () => {
  it('supprime une affectation existante (200)', async () => {
    const { coachId } = await makeCoach('unassign-ok@coach.test');
    await prisma.coachAssignment.create({
      data: { coachId, tournamentDayId: dayIds[1], courtId: courtIds[1] },
    });

    const res = await request(app)
      .delete(`/api/coaches/${tournamentId}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ coachId, tournamentDayId: dayIds[1] });
    expect(res.status).toBe(200);
    expect(await prisma.coachAssignment.count({ where: { coachId } })).toBe(0);
  });

  it('renvoie 404 pour une affectation inexistante', async () => {
    const { coachId } = await makeCoach('unassign-404@coach.test');
    const res = await request(app)
      .delete(`/api/coaches/${tournamentId}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ coachId, tournamentDayId: dayIds[1] });
    expect(res.status).toBe(404);
  });

  it('refuse la suppression par un coach (403)', async () => {
    const { coachId } = await makeCoach('unassign-403@coach.test');
    const res = await request(app)
      .delete(`/api/coaches/${tournamentId}/assign`)
      .set('Authorization', `Bearer ${coachToken}`)
      .send({ coachId, tournamentDayId: dayIds[1] });
    expect(res.status).toBe(403);
  });
});

// ============================================================
// LECTURE / PLANNING
// ============================================================
describe('GET /api/coaches/:tournamentId/planning', () => {
  it('calcule maxConsecutive et lève hasAlert au-delà de 6 jours consécutifs', async () => {
    const { coachId } = await makeCoach('planning-alert@coach.test');
    // 7 jours consécutifs (créés directement pour contourner la garde des 6 jours de l'endpoint,
    // et sur des terrains différents à cause de @@unique([coachId, courtId]))
    for (let n = 1; n <= 7; n++) {
      await prisma.coachAssignment.create({
        data: { coachId, tournamentDayId: dayIds[n], courtId: courtIds[n] },
      });
    }

    const res = await request(app)
      .get(`/api/coaches/${tournamentId}/planning`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const entry = res.body.data.planning.find((c: any) => c.id === coachId);
    expect(entry).toBeDefined();
    expect(entry.maxConsecutive).toBe(7);
    expect(entry.hasAlert).toBe(true);
    expect(Array.isArray(res.body.data.days)).toBe(true);
  });

  it('un COACH peut lire le planning de TOUS les coachs (200)', async () => {
    // BUG: pas d'isolation par coach — un coach voit le planning complet.
    const res = await request(app)
      .get(`/api/coaches/${tournamentId}/planning`)
      .set('Authorization', `Bearer ${coachToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.planning)).toBe(true);
  });

  it('renvoie 404 pour un tournoi inexistant', async () => {
    const res = await request(app)
      .get('/api/coaches/nonexistent-tournament/planning')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});

describe('GET availabilities & day/:n/available', () => {
  it('GET /:tournamentId/availabilities renvoie coachAvailabilities et days', async () => {
    const res = await request(app)
      .get(`/api/coaches/${tournamentId}/availabilities`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.coachAvailabilities)).toBe(true);
    expect(Array.isArray(res.body.data.days)).toBe(true);
    const first = res.body.data.coachAvailabilities[0];
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('totalAvailable');
    expect(first).toHaveProperty('totalAssigned');
    expect(Array.isArray(first.schedule)).toBe(true);
  });

  it('GET /:tournamentId/day/:dayNumber/available liste les coachs planifiés ce jour', async () => {
    const { coachId } = await makeCoach('day-available@coach.test');
    await request(app)
      .put(`/api/coaches/${coachId}/availability`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isAvailable: true, dayNumber: 5 });

    const res = await request(app)
      .get(`/api/coaches/${tournamentId}/day/5/available`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.availableCoaches)).toBe(true);
    const entry = res.body.data.availableCoaches.find((c: any) => c.id === coachId);
    expect(entry).toBeDefined();
    expect(entry).toHaveProperty('isAssigned');
    expect(entry).toHaveProperty('assignedCourt');
  });
});

// ============================================================
// REPRISE D'ANNÉE (clone) — complète tournamentClone.test.ts
// À exécuter en dernier (POST /api/tournaments peut réactiver un autre tournoi).
// ============================================================
describe('POST /api/tournaments - la reprise des coachs ne copie ni dispos ni affectations', () => {
  it('clone les profils Coach mais laisse dispos/affectations à zéro sur la cible', async () => {
    // Source avec un coach ayant dispo planifiée + dispo réelle + affectation
    const source = await prisma.tournament.create({
      data: {
        name: 'Source Coachs 2023',
        year: 2023,
        startDate: new Date(Date.UTC(2023, 4, 24)),
        endDate: new Date(Date.UTC(2023, 5, 7)),
        isActive: false,
      },
    });
    const srcUser = await prisma.user.create({
      data: { email: 'srccoach@coach.test', password: coachPassHash, firstName: 'Src', lastName: 'Coach', role: 'COACH' },
    });
    const srcCoach = await prisma.coach.create({ data: { userId: srcUser.id, tournamentId: source.id } });
    const srcDay = await prisma.tournamentDay.create({
      data: { tournamentId: source.id, dayNumber: 1, date: new Date(Date.UTC(2023, 4, 24)), ballkidCount: 0 },
    });
    const srcCourt = await prisma.court.create({
      data: { tournamentDayId: srcDay.id, name: 'Court S', teamCount: 2, order: 1 },
    });
    await prisma.coachPlannedAvailability.create({
      data: { coachId: srcCoach.id, tournamentId: source.id, dayNumber: 1 },
    });
    await prisma.coachAvailability.create({ data: { coachId: srcCoach.id, tournamentDayId: srcDay.id } });
    await prisma.coachAssignment.create({
      data: { coachId: srcCoach.id, tournamentDayId: srcDay.id, courtId: srcCourt.id },
    });

    const res = await request(app)
      .post('/api/tournaments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Cible Coachs 2030',
        year: 2030,
        startDate: '2030-05-24',
        endDate: '2030-06-07',
        copyFromTournamentId: source.id,
        cloneOptions: {
          ballkids: false,
          selectionCriteria: false,
          trainingSetup: false,
          teams: false,
          days: false,
          coaches: true,
        },
      });

    expect([200, 201]).toContain(res.status);
    const newId = res.body.data.tournament.id;

    // Cible : profil Coach repris (même user) mais aucune dispo ni affectation
    const newCoaches = await prisma.coach.findMany({ where: { tournamentId: newId } });
    expect(newCoaches.length).toBe(1);
    expect(newCoaches[0].userId).toBe(srcUser.id);
    const newCoachId = newCoaches[0].id;
    expect(await prisma.coachPlannedAvailability.count({ where: { coachId: newCoachId } })).toBe(0);
    expect(await prisma.coachAvailability.count({ where: { coachId: newCoachId } })).toBe(0);
    expect(await prisma.coachAssignment.count({ where: { coachId: newCoachId } })).toBe(0);

    // Source strictement inchangée
    expect(await prisma.coachPlannedAvailability.count({ where: { coachId: srcCoach.id } })).toBe(1);
    expect(await prisma.coachAvailability.count({ where: { coachId: srcCoach.id } })).toBe(1);
    expect(await prisma.coachAssignment.count({ where: { coachId: srcCoach.id } })).toBe(1);
  });
});

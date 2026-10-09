import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { setupTestDB, teardownTestDB, getApp, prisma } from './setup.js';
import bcrypt from 'bcryptjs';

/**
 * Tests de la fonctionnalité « créer une nouvelle année de tournoi + reprise
 * des données de l'année précédente ».
 *
 * Endpoint : POST /api/tournaments
 *   Body : { name, year, startDate, endDate, copyFromTournamentId?, cloneOptions? }
 *   cloneOptions = { ballkids, selectionCriteria, trainingSetup, teams, days, coaches }
 *
 * En transaction : crée le tournoi puis, si copyFromTournamentId est fourni,
 * copie les données de la source selon cloneOptions ; sinon initialise une
 * structure par défaut (session de sélection + critères, équipes, jours).
 */

let app: Express;
let adminToken: string;
let coachToken: string;
let adminUserId: string;

beforeAll(async () => {
  await setupTestDB();
  app = await getApp();

  // Créer l'admin
  const hash = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.create({
    data: {
      email: 'admin@ballkid.test',
      password: hash,
      firstName: 'Admin',
      lastName: 'Test',
      role: 'ADMIN',
    },
  });
  adminUserId = admin.id;
  const adminRes = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@ballkid.test', password: 'admin123' });
  adminToken = adminRes.body.data.token;

  // Créer un coach
  const coachHash = await bcrypt.hash('coach123', 10);
  await prisma.user.create({
    data: {
      email: 'coach@ballkid.test',
      password: coachHash,
      firstName: 'Coach',
      lastName: 'Test',
      role: 'COACH',
    },
  });
  const coachRes = await request(app)
    .post('/api/auth/login')
    .send({ email: 'coach@ballkid.test', password: 'coach123' });
  coachToken = coachRes.body.data.token;
});

afterAll(async () => {
  await teardownTestDB();
});

// ============================================================
// Cas « partir de zéro » (sans copyFromTournamentId)
// ============================================================
describe('POST /api/tournaments - partir de zéro', () => {
  it('crée un tournoi avec une structure par défaut', async () => {
    const res = await request(app)
      .post('/api/tournaments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Tournoi Neuf 2027',
        year: 2027,
        startDate: '2027-05-24',
        endDate: '2027-06-07',
      });

    expect([200, 201]).toContain(res.status);
    expect(res.body.success).toBe(true);
    const tournament = res.body.data.tournament;
    expect(tournament).toBeDefined();
    expect(tournament.name).toBe('Tournoi Neuf 2027');
    expect(tournament.year).toBe(2027);

    const newId = tournament.id;

    // Une session de sélection avec des critères doit exister
    const session = await prisma.selectionSession.findUnique({
      where: { tournamentId: newId },
      include: { criteria: true },
    });
    expect(session).not.toBeNull();
    // Grille de selection de l'admin : 11 criteres + bonus ancien/jour, avec coefficients
    expect(session!.criteria.length).toBe(13);
    const poubSansR = session!.criteria.find((c) => c.name === 'Poubelle sans rebond');
    expect(poubSansR?.weight).toBe(3);
    expect(session!.criteria.find((c) => c.abbreviation === 'ANCIEN')?.maxScore).toBe(40);
    // La formation garde ses 4 criteres generiques (bareme distinct de la selection)
    const s1 = await prisma.trainingSession.findFirst({ where: { tournamentId: newId, sessionNumber: 1 }, include: { criteria: true } });
    expect(s1?.criteria.length).toBe(4);

    // Des équipes doivent exister
    const teamsCount = await prisma.team.count({ where: { tournamentId: newId } });
    expect(teamsCount).toBeGreaterThan(0);

    // Des jours de tournoi doivent exister
    const daysCount = await prisma.tournamentDay.count({ where: { tournamentId: newId } });
    expect(daysCount).toBeGreaterThan(0);

    // Aucun ramasseur repris quand on part de zéro
    const ballkidsCount = await prisma.ballkid.count({ where: { tournamentId: newId } });
    expect(ballkidsCount).toBe(0);
  });

  it('refuse la création par un coach (403)', async () => {
    const res = await request(app)
      .post('/api/tournaments')
      .set('Authorization', `Bearer ${coachToken}`)
      .send({
        name: 'Interdit',
        year: 2028,
        startDate: '2028-05-24',
        endDate: '2028-06-07',
      });

    expect(res.status).toBe(403);
  });

  it('refuse les champs requis manquants (400)', async () => {
    const res = await request(app)
      .post('/api/tournaments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Incomplet' });

    expect(res.status).toBe(400);
  });
});

// ============================================================
// Cas « reprise de l'année précédente »
// ============================================================
describe('POST /api/tournaments - reprise année précédente', () => {
  let sourceId: string;
  let sourceSelectionSessionId: string;
  let sourceBallkidIds: string[] = [];
  let sourceCoachUserId: string;
  const SOURCE_BALLKID_COUNT = 3;

  beforeAll(async () => {
    // 1. Créer un tournoi source (année précédente)
    const source = await prisma.tournament.create({
      data: {
        name: 'Tournoi Source 2025',
        year: 2025,
        startDate: new Date('2025-05-24'),
        endDate: new Date('2025-06-07'),
        isActive: false,
      },
    });
    sourceId = source.id;

    // Quelques ramasseurs, avec des status/veteran variés pour vérifier la normalisation
    const seedBallkids = [
      { firstName: 'Alice', lastName: 'Durand', gender: 'FEMALE', status: 'SELECTED', isVeteran: false },
      { firstName: 'Bob', lastName: 'Petit', gender: 'MALE', status: 'RESERVE', isVeteran: true },
      { firstName: 'Chloé', lastName: 'Moreau', gender: 'FEMALE', status: 'REJECTED', isVeteran: false },
    ];
    for (const [i, bk] of seedBallkids.entries()) {
      const created = await prisma.ballkid.create({
        data: {
          firstName: bk.firstName,
          lastName: bk.lastName,
          email: `source${i}@test.com`,
          birthDate: new Date('2011-01-01'),
          gender: bk.gender,
          status: bk.status,
          isVeteran: bk.isVeteran,
          club: 'TC Source',
          tournamentId: sourceId,
        },
      });
      sourceBallkidIds.push(created.id);
    }

    // Session de sélection + critères sur la source
    const session = await prisma.selectionSession.create({
      data: {
        tournamentId: sourceId,
        date: new Date('2025-04-01'),
        criteria: {
          create: [
            { name: 'Vitesse', abbreviation: 'VIT', maxScore: 10, weight: 1, order: 1 },
            { name: 'Concentration', abbreviation: 'CON', maxScore: 10, weight: 2, order: 2 },
          ],
        },
      },
      include: { criteria: true },
    });
    sourceSelectionSessionId = session.id;

    // Un score existant sur la source : il NE DOIT PAS être copié
    await prisma.selectionScore.create({
      data: {
        selectionSessionId: sourceSelectionSessionId,
        ballkidId: sourceBallkidIds[0],
        scorerId: adminUserId,
        totalScore: 8.5,
        details: {
          create: [
            {
              selectionCriteriaId: session.criteria[0].id,
              value: 9,
            },
          ],
        },
      },
    });

    // Un coach sur la source : DOIT être repris (nouveau profil pour ce user sur le tournoi cible)
    const sourceCoachUser = await prisma.user.findUnique({ where: { email: 'coach@ballkid.test' } });
    sourceCoachUserId = sourceCoachUser!.id;
    await prisma.coach.create({
      data: { userId: sourceCoachUserId, tournamentId: sourceId },
    });
  });

  it('reprend les ramasseurs et les critères, sans copier les scores, et laisse la source intacte', async () => {
    const res = await request(app)
      .post('/api/tournaments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Tournoi Repris 2026',
        year: 2026,
        startDate: '2026-05-24',
        endDate: '2026-06-07',
        copyFromTournamentId: sourceId,
        cloneOptions: {
          ballkids: true,
          selectionCriteria: true,
          trainingSetup: true,
          teams: true,
          days: true,
          coaches: true,
        },
      });

    expect([200, 201]).toContain(res.status);
    expect(res.body.success).toBe(true);
    const newTournament = res.body.data.tournament;
    expect(newTournament).toBeDefined();
    expect(newTournament.id).not.toBe(sourceId);
    const newId = newTournament.id;

    // --- Ramasseurs repris ---
    const newBallkids = await prisma.ballkid.findMany({ where: { tournamentId: newId } });
    // Même nombre de ramasseurs
    expect(newBallkids.length).toBe(SOURCE_BALLKID_COUNT);
    // Tous marqués vétérans et remis au statut REGISTERED
    for (const bk of newBallkids) {
      expect(bk.isVeteran).toBe(true);
      expect(bk.status).toBe('REGISTERED');
      // Rattachés au nouveau tournoi, pas à la source
      expect(bk.tournamentId).toBe(newId);
    }
    // Les données personnelles sont bien reprises (noms conservés)
    const newNames = newBallkids.map((b) => b.firstName).sort();
    expect(newNames).toEqual(['Alice', 'Bob', 'Chloé']);

    // --- Aucun score copié ---
    const newSession = await prisma.selectionSession.findUnique({
      where: { tournamentId: newId },
      include: { criteria: true, scores: true },
    });
    expect(newSession).not.toBeNull();
    expect(newSession!.scores.length).toBe(0);

    // Aucun détail de score ne référence un ramasseur du nouveau tournoi
    const newBallkidIds = newBallkids.map((b) => b.id);
    const copiedScores = await prisma.selectionScore.count({
      where: { ballkidId: { in: newBallkidIds } },
    });
    expect(copiedScores).toBe(0);

    // --- Critères de sélection repris ---
    expect(newSession!.criteria.length).toBe(2);
    const criteriaNames = newSession!.criteria.map((c) => c.name).sort();
    expect(criteriaNames).toEqual(['Concentration', 'Vitesse']);
    // Les critères repris appartiennent à la NOUVELLE session (pas partagés avec la source)
    for (const c of newSession!.criteria) {
      expect(c.selectionSessionId).toBe(newSession!.id);
    }

    // --- La source est inchangée ---
    const sourceBallkids = await prisma.ballkid.findMany({
      where: { tournamentId: sourceId },
      orderBy: { email: 'asc' },
    });
    expect(sourceBallkids.length).toBe(SOURCE_BALLKID_COUNT);
    // Les statuts et flags vétérans d'origine sont préservés
    const byEmail = Object.fromEntries(sourceBallkids.map((b) => [b.email, b]));
    expect(byEmail['source0@test.com'].status).toBe('SELECTED');
    expect(byEmail['source0@test.com'].isVeteran).toBe(false);
    expect(byEmail['source1@test.com'].status).toBe('RESERVE');
    expect(byEmail['source1@test.com'].isVeteran).toBe(true);
    expect(byEmail['source2@test.com'].status).toBe('REJECTED');

    // Le score d'origine sur la source existe toujours
    const sourceScores = await prisma.selectionScore.count({
      where: { selectionSessionId: sourceSelectionSessionId },
    });
    expect(sourceScores).toBe(1);

    // La session de sélection source conserve ses 2 critères
    const sourceCriteria = await prisma.selectionCriteria.count({
      where: { selectionSessionId: sourceSelectionSessionId },
    });
    expect(sourceCriteria).toBe(2);

    // --- Coach repris : un nouveau profil pour le même user sur le nouveau tournoi ---
    const newCoaches = await prisma.coach.findMany({ where: { tournamentId: newId } });
    expect(newCoaches.length).toBe(1);
    expect(newCoaches[0].userId).toBe(sourceCoachUserId);
    // Le coach de la source existe toujours (historique conservé, profil distinct)
    const sourceCoaches = await prisma.coach.findMany({ where: { tournamentId: sourceId } });
    expect(sourceCoaches.length).toBe(1);
    expect(sourceCoaches[0].id).not.toBe(newCoaches[0].id);
  });
});

// ============================================================
// Cas « options partielles »
// ============================================================
describe('POST /api/tournaments - options partielles', () => {
  let sourceId: string;

  beforeAll(async () => {
    const source = await prisma.tournament.create({
      data: {
        name: 'Source Partielle 2024',
        year: 2024,
        startDate: new Date('2024-05-24'),
        endDate: new Date('2024-06-07'),
        isActive: false,
      },
    });
    sourceId = source.id;

    // Deux ramasseurs
    for (let i = 0; i < 2; i++) {
      await prisma.ballkid.create({
        data: {
          firstName: `Part${i}`,
          lastName: 'Test',
          email: `part${i}@test.com`,
          birthDate: new Date('2011-01-01'),
          gender: 'MALE',
          status: 'SELECTED',
          tournamentId: sourceId,
        },
      });
    }

    // Session + critères
    await prisma.selectionSession.create({
      data: {
        tournamentId: sourceId,
        date: new Date('2024-04-01'),
        criteria: {
          create: [{ name: 'Agilité', abbreviation: 'AGI', maxScore: 10, weight: 1, order: 1 }],
        },
      },
    });
  });

  it('ne copie pas les ramasseurs quand ballkids=false mais reprend les critères', async () => {
    const res = await request(app)
      .post('/api/tournaments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Repris Partiel 2029',
        year: 2029,
        startDate: '2029-05-24',
        endDate: '2029-06-07',
        copyFromTournamentId: sourceId,
        cloneOptions: {
          ballkids: false,
          selectionCriteria: true,
          trainingSetup: false,
          teams: false,
          days: false,
          coaches: false,
        },
      });

    expect([200, 201]).toContain(res.status);
    const newId = res.body.data.tournament.id;

    // Aucun ramasseur copié
    const ballkidsCount = await prisma.ballkid.count({ where: { tournamentId: newId } });
    expect(ballkidsCount).toBe(0);

    // Critères de sélection tout de même repris
    const newSession = await prisma.selectionSession.findUnique({
      where: { tournamentId: newId },
      include: { criteria: true },
    });
    expect(newSession).not.toBeNull();
    expect(newSession!.criteria.length).toBe(1);
    expect(newSession!.criteria[0].name).toBe('Agilité');
  });
});

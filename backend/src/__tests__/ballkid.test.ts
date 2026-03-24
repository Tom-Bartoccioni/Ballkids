import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { setupTestDB, teardownTestDB, getApp, prisma } from './setup.js';
import bcrypt from 'bcryptjs';

let app: Express;
let adminToken: string;
let coachToken: string;
let tournamentId: string;
let ballkidId: string;

beforeAll(async () => {
  await setupTestDB();
  app = await getApp();

  // Create admin
  const hash = await bcrypt.hash('admin123', 10);
  await prisma.user.create({
    data: { email: 'admin@ballkid.test', password: hash, firstName: 'Admin', lastName: 'Test', role: 'ADMIN' },
  });
  const adminRes = await request(app).post('/api/auth/login').send({ email: 'admin@ballkid.test', password: 'admin123' });
  adminToken = adminRes.body.data.token;

  // Create coach
  const coachHash = await bcrypt.hash('coach123', 10);
  await prisma.user.create({
    data: { email: 'coach@ballkid.test', password: coachHash, firstName: 'Coach', lastName: 'Test', role: 'COACH' },
  });
  const coachRes = await request(app).post('/api/auth/login').send({ email: 'coach@ballkid.test', password: 'coach123' });
  coachToken = coachRes.body.data.token;

  // Create active tournament
  const tournament = await prisma.tournament.create({
    data: {
      name: 'Test Tournament',
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

describe('POST /api/ballkids', () => {
  it('should create a ballkid (admin)', async () => {
    const res = await request(app)
      .post('/api/ballkids')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'Lucas',
        lastName: 'Dupont',
        email: 'lucas@test.com',
        birthDate: '2012-03-15',
        gender: 'MALE',
        tournamentId,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.ballkid.firstName).toBe('Lucas');
    expect(res.body.data.ballkid.status).toBe('REGISTERED');
    ballkidId = res.body.data.ballkid.id;
  });

  it('should auto-assign active tournament if not specified', async () => {
    const res = await request(app)
      .post('/api/ballkids')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        firstName: 'Marie',
        lastName: 'Martin',
        email: 'marie@test.com',
        birthDate: '2011-07-20',
        gender: 'FEMALE',
      });

    expect(res.status).toBe(201);
    // Should be assigned to some active tournament
    expect(res.body.data.ballkid.tournamentId).toBeDefined();
  });

  it('should reject missing required fields', async () => {
    const res = await request(app)
      .post('/api/ballkids')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ firstName: 'Missing' });

    expect(res.status).toBe(400);
  });

  it('should reject coach creating ballkid', async () => {
    const res = await request(app)
      .post('/api/ballkids')
      .set('Authorization', `Bearer ${coachToken}`)
      .send({
        firstName: 'Nope',
        lastName: 'Nope',
        email: 'nope@test.com',
        birthDate: '2012-01-01',
        gender: 'MALE',
      });

    expect(res.status).toBe(403);
  });
});

describe('GET /api/ballkids', () => {
  it('should list ballkids', async () => {
    const res = await request(app).get('/api/ballkids').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.ballkids.length).toBeGreaterThanOrEqual(2);
    expect(res.body.data.pagination).toBeDefined();
    expect(res.body.data.pagination.total).toBeGreaterThanOrEqual(2);
  });

  it('should filter by tournament', async () => {
    const res = await request(app)
      .get(`/api/ballkids?tournamentId=${tournamentId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.ballkids.length).toBeGreaterThanOrEqual(1);
    // All returned ballkids should belong to the filtered tournament
    res.body.data.ballkids.forEach((bk: any) => {
      expect(bk.tournamentId).toBe(tournamentId);
    });
  });

  it('should search by name', async () => {
    const res = await request(app)
      .get('/api/ballkids?search=Lucas')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.ballkids.length).toBe(1);
    expect(res.body.data.ballkids[0].firstName).toBe('Lucas');
  });

  it('should allow coach to list', async () => {
    const res = await request(app).get('/api/ballkids').set('Authorization', `Bearer ${coachToken}`);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/ballkids/:id', () => {
  it('should return ballkid details', async () => {
    const res = await request(app).get(`/api/ballkids/${ballkidId}`).set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.ballkid.id).toBe(ballkidId);
    expect(res.body.data.ballkid.firstName).toBe('Lucas');
  });

  it('should return 404 for non-existent ballkid', async () => {
    const res = await request(app).get('/api/ballkids/nonexistent-id').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });
});

describe('PUT /api/ballkids/:id', () => {
  it('should update ballkid', async () => {
    const res = await request(app)
      .put(`/api/ballkids/${ballkidId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ firstName: 'Lucas Updated', club: 'TC Paris' });

    expect(res.status).toBe(200);
    expect(res.body.data.ballkid.firstName).toBe('Lucas Updated');
    expect(res.body.data.ballkid.club).toBe('TC Paris');
  });
});

describe('PUT /api/ballkids/:id/status', () => {
  it('should change status', async () => {
    const res = await request(app)
      .put(`/api/ballkids/${ballkidId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'SELECTED' });

    expect(res.status).toBe(200);
    expect(res.body.data.ballkid.status).toBe('SELECTED');
  });

  it('should reject invalid status', async () => {
    const res = await request(app)
      .put(`/api/ballkids/${ballkidId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'INVALID' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/ballkids/:id/approve & reject', () => {
  it('should approve a pending ballkid', async () => {
    // Create a pending ballkid
    const created = await prisma.ballkid.create({
      data: {
        firstName: 'Pending',
        lastName: 'Kid',
        email: 'pending@test.com',
        birthDate: new Date('2012-01-01'),
        gender: 'MALE',
        status: 'PENDING',
        tournamentId,
      },
    });

    const res = await request(app)
      .post(`/api/ballkids/${created.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.ballkid.status).toBe('REGISTERED');
  });

  it('should reject a ballkid', async () => {
    const created = await prisma.ballkid.create({
      data: {
        firstName: 'ToReject',
        lastName: 'Kid',
        email: 'reject@test.com',
        birthDate: new Date('2012-01-01'),
        gender: 'FEMALE',
        status: 'PENDING',
        tournamentId,
      },
    });

    const res = await request(app)
      .post(`/api/ballkids/${created.id}/reject`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.ballkid.status).toBe('REJECTED');
  });
});

describe('DELETE /api/ballkids/:id', () => {
  it('should delete a ballkid', async () => {
    const created = await prisma.ballkid.create({
      data: {
        firstName: 'ToDelete',
        lastName: 'Kid',
        email: 'delete@test.com',
        birthDate: new Date('2012-01-01'),
        gender: 'MALE',
        status: 'REGISTERED',
        tournamentId,
      },
    });

    const res = await request(app)
      .delete(`/api/ballkids/${created.id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);

    // Verify deleted
    const getRes = await request(app).get(`/api/ballkids/${created.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(getRes.status).toBe(404);
  });

  it('should reject coach deleting ballkid', async () => {
    const res = await request(app)
      .delete(`/api/ballkids/${ballkidId}`)
      .set('Authorization', `Bearer ${coachToken}`);

    expect(res.status).toBe(403);
  });
});

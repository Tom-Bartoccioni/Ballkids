import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { setupTestDB, teardownTestDB, getApp, prisma } from './setup.js';
import bcrypt from 'bcryptjs';

let app: Express;
let adminToken: string;
let tournamentId: string;

beforeAll(async () => {
  await setupTestDB();
  app = await getApp();

  const hash = await bcrypt.hash('admin123', 10);
  await prisma.user.create({
    data: { email: 'admin@tournament.test', password: hash, firstName: 'Admin', lastName: 'Test', role: 'ADMIN' },
  });

  const res = await request(app).post('/api/auth/login').send({ email: 'admin@tournament.test', password: 'admin123' });
  adminToken = res.body.data.token;
});

afterAll(async () => {
  await teardownTestDB();
});

describe('POST /api/tournaments', () => {
  it('should create a tournament', async () => {
    const res = await request(app)
      .post('/api/tournaments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Roland Garros 2026',
        year: 2026,
        startDate: '2026-05-24',
        endDate: '2026-06-07',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.tournament.name).toBe('Roland Garros 2026');
    expect(res.body.data.tournament.isActive).toBe(true);
    tournamentId = res.body.data.tournament.id;
  });

  it('should reject missing name', async () => {
    const res = await request(app)
      .post('/api/tournaments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ year: 2026, startDate: '2026-05-24', endDate: '2026-06-07' });

    expect(res.status).toBe(400);
  });

  it('should reject without auth', async () => {
    const res = await request(app).post('/api/tournaments').send({
      name: 'Test', year: 2026, startDate: '2026-05-24', endDate: '2026-06-07',
    });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/tournaments', () => {
  it('should list tournaments', async () => {
    const res = await request(app).get('/api/tournaments').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.tournaments.length).toBeGreaterThanOrEqual(1);
  });

  it('should reject without auth', async () => {
    const res = await request(app).get('/api/tournaments');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/tournaments/active', () => {
  it('should return the active tournament', async () => {
    const res = await request(app).get('/api/tournaments/active').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.tournament).not.toBeNull();
    expect(res.body.data.tournament.isActive).toBe(true);
  });
});

describe('GET /api/tournaments/:id', () => {
  it('should return tournament details', async () => {
    const res = await request(app).get(`/api/tournaments/${tournamentId}`).set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.tournament.id).toBe(tournamentId);
    expect(res.body.data.tournament.name).toBe('Roland Garros 2026');
  });

  it('should return 404 for non-existent tournament', async () => {
    const res = await request(app).get('/api/tournaments/nonexistent-id').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });
});

describe('PUT /api/tournaments/:id', () => {
  it('should update tournament', async () => {
    const res = await request(app)
      .put(`/api/tournaments/${tournamentId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Roland Garros 2026 Updated' });

    expect(res.status).toBe(200);
    expect(res.body.data.tournament.name).toBe('Roland Garros 2026 Updated');
  });
});

describe('PUT /api/tournaments/:id/activate', () => {
  it('should activate a tournament and deactivate others', async () => {
    // Create a second tournament
    const createRes = await request(app)
      .post('/api/tournaments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Other Tournament', year: 2025, startDate: '2025-05-24', endDate: '2025-06-07' });
    const otherId = createRes.body.data.tournament.id;

    // Activate the first one
    const res = await request(app)
      .put(`/api/tournaments/${tournamentId}/activate`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.tournament.isActive).toBe(true);

    // Verify the other is deactivated
    const otherRes = await request(app).get(`/api/tournaments/${otherId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(otherRes.body.data.tournament.isActive).toBe(false);
  });
});

describe('DELETE /api/tournaments/:id', () => {
  it('should delete a tournament', async () => {
    // Create one to delete
    const createRes = await request(app)
      .post('/api/tournaments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'To Delete', year: 2024, startDate: '2024-05-24', endDate: '2024-06-07' });
    const deleteId = createRes.body.data.tournament.id;

    const res = await request(app).delete(`/api/tournaments/${deleteId}`).set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify it's gone
    const getRes = await request(app).get(`/api/tournaments/${deleteId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(getRes.status).toBe(404);
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { setupTestDB, teardownTestDB, getApp, prisma } from './setup.js';
import bcrypt from 'bcryptjs';

let app: Express;
let adminToken: string;

beforeAll(async () => {
  await setupTestDB();
  app = await getApp();

  // Create admin user
  const hash = await bcrypt.hash('admin123', 10);
  await prisma.user.create({
    data: { email: 'admin@test.com', password: hash, firstName: 'Admin', lastName: 'Test', role: 'ADMIN' },
  });

  // Login to get token
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@test.com', password: 'admin123' });
  adminToken = res.body.data.token;
});

afterAll(async () => {
  await teardownTestDB();
});

describe('POST /api/auth/login', () => {
  it('should login with valid credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@test.com', password: 'admin123' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.user.email).toBe('admin@test.com');
    expect(res.body.data.user.role).toBe('ADMIN');
  });

  it('should reject wrong password', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@test.com', password: 'wrong' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('should reject non-existent email', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'nobody@test.com', password: 'admin123' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('should reject invalid email format', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email', password: 'admin123' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('should reject empty password', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@test.com', password: '' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /api/auth/me', () => {
  it('should return current user profile', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('admin@test.com');
    expect(res.body.data.user.firstName).toBe('Admin');
  });

  it('should reject without token', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
  });

  it('should reject with invalid token', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer fake-token');

    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/register', () => {
  it('should create a new coach (admin only)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'coach@test.com',
        password: 'coach123',
        firstName: 'Coach',
        lastName: 'Test',
        role: 'COACH',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe('coach@test.com');
    expect(res.body.data.user.role).toBe('COACH');
  });

  it('should reject duplicate email', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'admin@test.com',
        password: 'test123',
        firstName: 'Dup',
        lastName: 'User',
        role: 'ADMIN',
      });

    expect(res.status).toBe(400);
  });

  it('should reject without auth', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'new@test.com',
      password: 'test123',
      firstName: 'New',
      lastName: 'User',
      role: 'COACH',
    });

    expect(res.status).toBe(401);
  });

  it('should reject non-admin user', async () => {
    // Login as coach
    const loginRes = await request(app).post('/api/auth/login').send({ email: 'coach@test.com', password: 'coach123' });
    const coachToken = loginRes.body.data.token;

    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${coachToken}`)
      .send({
        email: 'another@test.com',
        password: 'test123',
        firstName: 'Another',
        lastName: 'User',
        role: 'COACH',
      });

    expect(res.status).toBe(403);
  });

  it('should reject short password', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'short@test.com',
        password: '123',
        firstName: 'Short',
        lastName: 'Pass',
        role: 'COACH',
      });

    expect(res.status).toBe(400);
  });
});

describe('PUT /api/auth/password', () => {
  it('should change password', async () => {
    const res = await request(app)
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ currentPassword: 'admin123', newPassword: 'newpass123' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify new password works
    const loginRes = await request(app).post('/api/auth/login').send({ email: 'admin@test.com', password: 'newpass123' });
    expect(loginRes.status).toBe(200);

    // Change back
    await request(app)
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ currentPassword: 'newpass123', newPassword: 'admin123' });
  });

  it('should reject wrong current password', async () => {
    const res = await request(app)
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ currentPassword: 'wrongpass', newPassword: 'newpass123' });

    expect(res.status).toBe(401);
  });
});

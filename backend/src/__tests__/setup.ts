import { execSync } from 'child_process';
import path from 'path';
import { beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

// Use a separate test database
const TEST_DB_PATH = path.join(__dirname, '../../prisma/test.db');
process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
process.env.JWT_SECRET = 'test-secret-key-for-testing';
process.env.JWT_EXPIRES_IN = '1h';
process.env.NODE_ENV = 'test';

export const prisma = new PrismaClient({
  datasources: { db: { url: `file:${TEST_DB_PATH}` } },
});

export async function setupTestDB() {
  // Push schema to test DB
  execSync('npx prisma db push --force-reset --skip-generate', {
    env: { ...process.env, DATABASE_URL: `file:${TEST_DB_PATH}` },
    cwd: path.join(__dirname, '../..'),
    stdio: 'pipe',
  });
}

export async function teardownTestDB() {
  await prisma.$disconnect();
}

// Create the Express app (import after env vars are set)
export async function getApp() {
  const { createApp } = await import('../app.js');
  return createApp();
}

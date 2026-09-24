import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { setupTestDB, teardownTestDB, getApp, prisma } from './setup.js';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';

// Tests HTTP du MAPPING des colonnes de l'import ramasseurs : on verifie que
// les fichiers reels de l'admin (Liste / Tenus) sont lus sans perte.

let app: Express;
let adminToken: string;
let tournamentId: string;

beforeAll(async () => {
  await setupTestDB();
  app = await getApp();

  const hash = await bcrypt.hash('admin123', 10);
  await prisma.user.create({
    data: { email: 'admin@importfields.test', password: hash, firstName: 'Admin', lastName: 'Test', role: 'ADMIN' },
  });
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@importfields.test', password: 'admin123' });
  adminToken = res.body.data.token;

  const tournament = await prisma.tournament.create({
    data: { name: 'Import Fields Test', year: 2026, startDate: new Date('2026-05-24'), endDate: new Date('2026-06-07'), isActive: true },
  });
  tournamentId = tournament.id;
});

afterAll(async () => {
  await teardownTestDB();
});

async function makeXlsx(headers: string[], rows: any[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function importFile(buf: Buffer, name = 'import.xlsx') {
  const res = await request(app)
    .post('/api/ballkids/import')
    .set('Authorization', `Bearer ${adminToken}`)
    .attach('file', buf, name)
    .field('tournamentId', tournamentId);
  expect(res.status).toBe(200);
  return res.body.data as {
    imported: number; updated: number; skipped: number; errors: number;
    errorDetails: { record: any; error: string }[];
    unmappedColumns?: string[];
  };
}

describe('Import ramasseurs - equipement (en-tetes avec espaces, fichier Tenus)', () => {
  it('lit TAILLE TSHIRT / TAILLE SHORT / TAILLE SURVET / POINTURE et garde les tailles numeriques', async () => {
    const buf = await makeXlsx(
      ['NOM', 'PRENOM', 'MAIL', 'TAILLE TSHIRT', 'TAILLE SHORT', 'TAILLE SURVET', 'POINTURE'],
      [
        ['Tenue', 'Alpha', 'alpha@tenue.test', 'S', 'XS', 'M', 42],
        ['Tenue', 'Beta', 'beta@tenue.test', 14, 12, 14, 38],
      ]
    );

    const data = await importFile(buf);
    expect(data.errors).toBe(0);
    expect(data.imported).toBe(2);

    const alpha = await prisma.ballkid.findFirst({ where: { email: 'alpha@tenue.test' } });
    expect(alpha).toMatchObject({ tshirtSize: 'S', shortSize: 'XS', tracksuitSize: 'M', shoeSize: '42' });

    const beta = await prisma.ballkid.findFirst({ where: { email: 'beta@tenue.test' } });
    expect(beta).toMatchObject({ tshirtSize: '14', shortSize: '12', tracksuitSize: '14', shoeSize: '38' });
  });
});

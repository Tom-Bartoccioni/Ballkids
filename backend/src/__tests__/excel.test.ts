import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { setupTestDB, teardownTestDB, getApp, prisma } from './setup.js';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';

let app: Express;
let adminToken: string;
let tournamentId: string;

beforeAll(async () => {
  await setupTestDB();
  app = await getApp();

  const hash = await bcrypt.hash('admin123', 10);
  await prisma.user.create({
    data: { email: 'admin@excel.test', password: hash, firstName: 'Admin', lastName: 'Test', role: 'ADMIN' },
  });
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@excel.test', password: 'admin123' });
  adminToken = res.body.data.token;

  const tournament = await prisma.tournament.create({
    data: { name: 'Excel Test', year: 2026, startDate: new Date('2026-05-24'), endDate: new Date('2026-06-07'), isActive: true },
  });
  tournamentId = tournament.id;
});

afterAll(async () => {
  await teardownTestDB();
});

async function createExcelFile(headers: string[], rows: string[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  sheet.addRow(headers);
  for (const row of rows) {
    sheet.addRow(row);
  }
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

describe('Import Excel - Ballkids', () => {
  it('should import ballkids from .xlsx file', async () => {
    const xlsxBuffer = await createExcelFile(
      ['Prénom', 'Nom', 'Email', 'Date naissance', 'Sexe'],
      [
        ['Pierre', 'Durand', 'pierre@test.com', '2012-05-10', 'M'],
        ['Sophie', 'Leblanc', 'sophie@test.com', '2011-08-22', 'F'],
        ['Alex', 'Moreau', 'alex@test.com', '2012-01-15', 'M'],
      ]
    );

    const res = await request(app)
      .post('/api/ballkids/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', xlsxBuffer, 'ramasseurs.xlsx')
      .field('tournamentId', tournamentId);

    expect(res.status).toBe(200);
    expect(res.body.data.imported).toBe(3);
    expect(res.body.data.errors).toBe(0);

    // Verify in DB
    const ballkids = await prisma.ballkid.findMany({ where: { tournamentId } });
    expect(ballkids.length).toBe(3);
    expect(ballkids.find((b: any) => b.firstName === 'Pierre')).toBeDefined();
    expect(ballkids.find((b: any) => b.firstName === 'Sophie')).toBeDefined();
  });

  it('should still support CSV import', async () => {
    const csv = 'Prénom;Nom;Email;Date naissance;Sexe\nJulie;Petit;julie@test.com;2012-03-01;F';
    const csvBuffer = Buffer.from(csv, 'utf8');

    const res = await request(app)
      .post('/api/ballkids/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', csvBuffer, 'ramasseurs.csv')
      .field('tournamentId', tournamentId);

    expect(res.status).toBe(200);
    expect(res.body.data.imported).toBe(1);
  });
});

describe('Export Excel - Ballkids', () => {
  it('should export ballkids as .xlsx', async () => {
    const res = await request(app)
      .get(`/api/export/ballkids/xlsx?tournamentId=${tournamentId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse((res: any, callback: any) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml.sheet');

    // Parse the returned Excel and verify content
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body as any);
    const sheet = workbook.worksheets[0];
    expect(sheet).toBeDefined();
    expect(sheet.rowCount).toBeGreaterThanOrEqual(5); // header + 4 ballkids

    // Check header
    const headerRow = sheet.getRow(1);
    expect(headerRow.getCell(1).value).toBe('Nom');
    expect(headerRow.getCell(2).value).toBe('Prénom');
  });

  it('should still export as CSV', async () => {
    const res = await request(app)
      .get(`/api/export/ballkids/csv?tournamentId=${tournamentId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('Nom');
    expect(res.text).toContain('Pierre');
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { setupTestDB, teardownTestDB, getApp, prisma } from './setup.js';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';

// Export de la synthese des seances de formation (demande admin : "avoir
// possibilite d'exporter le fichier" dans l'onglet Formation).

let app: Express;
let adminToken: string;
let coachToken: string;
let tournamentId: string;

beforeAll(async () => {
  await setupTestDB();
  app = await getApp();

  const hash = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.create({
    data: { email: 'admin@trainexport.test', password: hash, firstName: 'Admin', lastName: 'Test', role: 'ADMIN' },
  });
  adminToken = (await request(app).post('/api/auth/login').send({ email: 'admin@trainexport.test', password: 'admin123' })).body.data.token;

  await prisma.user.create({
    data: { email: 'coach@trainexport.test', password: hash, firstName: 'Coach', lastName: 'Test', role: 'COACH' },
  });
  coachToken = (await request(app).post('/api/auth/login').send({ email: 'coach@trainexport.test', password: 'admin123' })).body.data.token;

  const t = await prisma.tournament.create({
    data: { name: 'Train Export', year: 2026, startDate: new Date('2026-05-24'), endDate: new Date('2026-06-07'), isActive: true },
  });
  tournamentId = t.id;

  const kidA = await prisma.ballkid.create({
    data: { firstName: 'Alice', lastName: 'Aaa', email: 'a@te.test', birthDate: new Date('2012-01-01'), gender: 'FEMALE', status: 'SELECTED', tournamentId },
  });
  await prisma.ballkid.create({
    data: { firstName: 'Bob', lastName: 'Bbb', email: 'b@te.test', birthDate: new Date('2012-01-01'), gender: 'MALE', status: 'SELECTED', tournamentId },
  });

  const sessions: Record<number, string> = {};
  for (let n = 1; n <= 4; n++) {
    const s = await prisma.trainingSession.create({ data: { tournamentId, sessionNumber: n, date: new Date('2026-04-01') } });
    sessions[n] = s.id;
  }
  await prisma.trainingScore.create({ data: { trainingSessionId: sessions[1], ballkidId: kidA.id, scorerId: admin.id, totalScore: 14 } });
  await prisma.absence.create({ data: { ballkidId: kidA.id, type: 'TRAINING', date: new Date('2026-04-02'), trainingSessionId: sessions[2] } });
});

afterAll(async () => {
  await teardownTestDB();
});

async function readXlsx(buf: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  const ws = wb.worksheets[0];
  const rows: string[][] = [];
  ws.eachRow((row) => {
    const values = row.values as any[];
    rows.push(values.slice(1).map((v) => (v == null ? '' : String(v))));
  });
  return rows;
}

const binaryParser = (r: any, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  r.on('data', (c: Buffer) => chunks.push(c));
  r.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('GET /api/export/training/xlsx', () => {
  it('exporte la synthese : une ligne par ramasseur, ABS pour une absence, moyenne et nb de seances', async () => {
    const res = await request(app)
      .get(`/api/export/training/xlsx?tournamentId=${tournamentId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer()
      .parse(binaryParser);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');

    const rows = await readXlsx(res.body as Buffer);
    expect(rows[0]).toEqual(['Nom', 'Prénom', 'Séance 1', 'Séance 2', 'Séance 3', 'Séance 4', 'Moyenne', 'Séances']);
    const alice = rows.find((r) => r[0] === 'Aaa');
    expect(alice).toEqual(['Aaa', 'Alice', '14', 'ABS', '', '', '14', '1']);
    const bob = rows.find((r) => r[0] === 'Bbb');
    expect(bob).toEqual(['Bbb', 'Bob', '', '', '', '', '', '0']);
  });

  it('est accessible a un coach (lecture seule) et refuse sans token', async () => {
    const ok = await request(app).get(`/api/export/training/xlsx?tournamentId=${tournamentId}`).set('Authorization', `Bearer ${coachToken}`);
    expect(ok.status).toBe(200);
    const anon = await request(app).get(`/api/export/training/xlsx?tournamentId=${tournamentId}`);
    expect(anon.status).toBe(401);
  });

  it('existe aussi en CSV avec les memes en-tetes', async () => {
    const res = await request(app).get(`/api/export/training/csv?tournamentId=${tournamentId}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const firstLine = res.text.split(/\r?\n/)[0].replace(/^﻿/, '');
    expect(firstLine).toBe('"Nom";"Prénom";"Séance 1";"Séance 2";"Séance 3";"Séance 4";"Moyenne";"Séances"');
  });
});

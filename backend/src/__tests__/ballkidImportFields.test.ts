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

describe('Import ramasseurs - telephones enfant / responsables legaux', () => {
  it('mappe telephone -> phone, pere/legal 1 -> phoneFather, mere/legal 2 -> phoneMother', async () => {
    const buf = await makeXlsx(
      ['NOM', 'PRENOM', 'MAIL', 'TELEPHONE', 'TELEPHONE PERE', 'TELEPHONE MERE'],
      [['Tel', 'Un', 'un@tel.test', '0611111111', '0622222222', '0633333333']]
    );
    const data = await importFile(buf);
    expect(data.errors).toBe(0);

    const bk = await prisma.ballkid.findFirst({ where: { email: 'un@tel.test' } });
    expect(bk).toMatchObject({ phone: '0611111111', phoneFather: '0622222222', phoneMother: '0633333333' });
  });

  it('accepte les libelles "responsable legal 1/2" et restaure le 0 initial perdu par Excel', async () => {
    const buf = await makeXlsx(
      ['Nom', 'Prénom', 'Email', 'Tél enfant', 'Tél responsable légal 1', 'Tél responsable légal 2'],
      [['Tel', 'Deux', 'deux@tel.test', 611111112, 622222222, 633333332]]
    );
    const data = await importFile(buf);
    expect(data.errors).toBe(0);

    const bk = await prisma.ballkid.findFirst({ where: { email: 'deux@tel.test' } });
    expect(bk).toMatchObject({ phone: '0611111112', phoneFather: '0622222222', phoneMother: '0633333332' });
  });

  it("ne prend PAS le numero d'un parent comme telephone de l'enfant quand la colonne enfant est absente", async () => {
    const buf = await makeXlsx(
      ['NOM', 'PRENOM', 'MAIL', 'TELEPHONE PERE'],
      [['Tel', 'Trois', 'trois@tel.test', '0644444444']]
    );
    const data = await importFile(buf);
    expect(data.errors).toBe(0);

    const bk = await prisma.ballkid.findFirst({ where: { email: 'trois@tel.test' } });
    expect(bk?.phone).toBeNull();
    expect(bk?.phoneFather).toBe('0644444444');
  });
});

describe('Import ramasseurs - ancien', () => {
  it('ANCIEN = A / oui / x / 1 -> isVeteran true ; vide -> false ; colonne absente -> inchange', async () => {
    const buf = await makeXlsx(
      ['NOM', 'PRENOM', 'MAIL', 'ANCIEN'],
      [
        ['Anc', 'A', 'a@anc.test', 'A'],
        ['Anc', 'B', 'b@anc.test', 'oui'],
        ['Anc', 'C', 'c@anc.test', ''],
      ]
    );
    const data = await importFile(buf);
    expect(data.errors).toBe(0);

    expect((await prisma.ballkid.findFirst({ where: { email: 'a@anc.test' } }))?.isVeteran).toBe(true);
    expect((await prisma.ballkid.findFirst({ where: { email: 'b@anc.test' } }))?.isVeteran).toBe(true);
    expect((await prisma.ballkid.findFirst({ where: { email: 'c@anc.test' } }))?.isVeteran).toBe(false);

    // Re-import SANS colonne ANCIEN : le flag ne doit pas etre ecrase
    const buf2 = await makeXlsx(['NOM', 'PRENOM', 'MAIL', 'VILLE'], [['Anc', 'A', 'a@anc.test', 'Nice']]);
    const data2 = await importFile(buf2);
    expect(data2.updated).toBe(1);
    expect((await prisma.ballkid.findFirst({ where: { email: 'a@anc.test' } }))?.isVeteran).toBe(true);
  });
});

describe('Import ramasseurs - fichier complement (Tenus) sans email ni telephone', () => {
  it('met a jour les ramasseurs existants par nom/prenom (accents et casse ignores) et refuse les inconnus', async () => {
    await prisma.ballkid.create({
      data: { firstName: 'Guilhem', lastName: 'Bérard', email: '', gender: 'MALE', status: 'REGISTERED',
        birthDate: new Date('2011-03-02'), tournamentId },
    });
    await prisma.ballkid.create({
      data: { firstName: 'Monica', lastName: "D'Ancona", email: '', gender: 'FEMALE', status: 'REGISTERED',
        birthDate: new Date('2011-03-02'), tournamentId },
    });

    const buf = await makeXlsx(
      ['NB', 'NOM', 'PRENOM', 'TAILLE TSHIRT', 'TAILLE SHORT', 'TAILLE SURVET', 'POINTURE'],
      [
        [1, 'BERARD', 'GUILHEM', 'M', 'M', 'L', 43],
        [2, 'D ANCONA', 'MONICA', 12, 12, 14, 37],
        [3, 'INCONNU', 'PERSONNE', 'S', 'S', 'S', 40],
      ]
    );
    const data = await importFile(buf, 'tenus.xlsx');

    expect(data.updated).toBe(2);
    expect(data.imported).toBe(0);
    expect(data.errors).toBe(1);
    expect(data.errorDetails[0].error).toMatch(/Email ou telephone obligatoire/);

    const g = await prisma.ballkid.findFirst({ where: { firstName: 'Guilhem' } });
    expect(g).toMatchObject({ tshirtSize: 'M', shortSize: 'M', tracksuitSize: 'L', shoeSize: '43' });
    const m = await prisma.ballkid.findFirst({ where: { firstName: 'Monica' } });
    expect(m).toMatchObject({ tshirtSize: '12', shoeSize: '37' });
  });
});

describe('Import ramasseurs - colonnes non reconnues', () => {
  it("liste les en-tetes que personne n'a consommes, sans les colonnes mappees ni les en-tetes vides", async () => {
    const buf = await makeXlsx(
      ['N°', 'NOM', 'PRENOM', 'MAIL', '2024', 'COULEUR PREFEREE', ' ', 'POINTURE'],
      [[7, 'Colonne', 'Test', 'col@test.test', 190, 'bleu', 'x', 41]]
    );
    const data = await importFile(buf);
    expect(data.errors).toBe(0);
    expect(data.unmappedColumns).toEqual(expect.arrayContaining(['N°', '2024', 'COULEUR PREFEREE']));
    expect(data.unmappedColumns).not.toEqual(expect.arrayContaining(['NOM', 'PRENOM', 'MAIL', 'POINTURE']));
    expect(data.unmappedColumns).not.toContain(' ');
  });
});

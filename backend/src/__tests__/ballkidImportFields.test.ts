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
    imported: number; updated: number; skipped: number; errors: number; blankRows: number;
    merged: number; mergedDetails: { line?: number; name: string; detail: string }[];
    errorDetails: { line?: number; name: string; record: any; error: string }[];
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

describe("Import ramasseurs - identite = nom + prenom (+ date), jamais l'email", () => {
  it('deux freres/soeurs partageant un email familial donnent DEUX fiches', async () => {
    const buf = await makeXlsx(
      ['NOM', 'PRENOM', 'MAIL', 'AGE'],
      [
        ['Famille', 'Aine', 'parents@famille.test', '2011-02-03'],
        ['Famille', 'Cadet', 'parents@famille.test', '2013-04-05'],
      ]
    );
    const data = await importFile(buf);
    expect(data.errors).toBe(0);
    expect(data.imported).toBe(2);
    expect(data.updated).toBe(0);
    expect(await prisma.ballkid.count({ where: { lastName: 'Famille', tournamentId } })).toBe(2);
  });

  it('deux homonymes avec des dates differentes donnent deux fiches ; le re-import met a jour la bonne', async () => {
    const buf = await makeXlsx(
      ['NOM', 'PRENOM', 'MAIL', 'AGE', 'VILLE'],
      [
        ['Homonyme', 'Jules', 'j1@homo.test', '2011-01-01', 'Nice'],
        ['Homonyme', 'Jules', 'j2@homo.test', '2012-06-06', 'Cannes'],
      ]
    );
    const data = await importFile(buf);
    expect(data.imported).toBe(2);

    // Re-import du second seul, avec une nouvelle ville : c'est LUI qui doit changer
    const buf2 = await makeXlsx(['NOM', 'PRENOM', 'AGE', 'VILLE'], [['Homonyme', 'Jules', '2012-06-06', 'Monaco']]);
    const data2 = await importFile(buf2);
    expect(data2.updated).toBe(1);
    expect(data2.imported).toBe(0);
    const both = await prisma.ballkid.findMany({ where: { lastName: 'Homonyme' }, orderBy: { birthDate: 'asc' } });
    expect(both.map((b) => b.city)).toEqual(['Nice', 'Monaco']);
  });

  it("un homonyme sans date dans le fichier est refuse comme ambigu plutot qu'ecrase au hasard", async () => {
    const buf = await makeXlsx(['NOM', 'PRENOM', 'VILLE'], [['Homonyme', 'Jules', 'Menton']]);
    const data = await importFile(buf);
    expect(data.errors).toBe(1);
    expect(data.errorDetails[0].error).toMatch(/ambigu/i);
  });
});

describe('Import ramasseurs - en-tetes TEL / TEL 1 / TEL 2 (convention retenue avec l admin)', () => {
  it('TEL -> enfant, TEL 1 -> responsable legal 1, TEL 2 -> responsable legal 2', async () => {
    const buf = await makeXlsx(
      ['NOM', 'PRENOM', 'MAIL', 'TEL', 'TEL 1', 'TEL 2'],
      [['Tel', 'Quatre', 'quatre@tel.test', 611111114, 622222224, 633333334]]
    );
    const data = await importFile(buf);
    expect(data.errors).toBe(0);
    const bk = await prisma.ballkid.findFirst({ where: { email: 'quatre@tel.test' } });
    expect(bk).toMatchObject({ phone: '0611111114', phoneFather: '0622222224', phoneMother: '0633333334' });
    expect(data.unmappedColumns).not.toEqual(expect.arrayContaining(['TEL', 'TEL 1', 'TEL 2']));
  });

  it("sans colonne TEL, TEL 1 n'est jamais pris pour le telephone de l'enfant", async () => {
    const buf = await makeXlsx(['NOM', 'PRENOM', 'MAIL', 'TEL 1'], [['Tel', 'Cinq', 'cinq@tel.test', '0655555555']]);
    const data = await importFile(buf);
    expect(data.errors).toBe(0);
    const bk = await prisma.ballkid.findFirst({ where: { email: 'cinq@tel.test' } });
    expect(bk?.phone).toBeNull();
    expect(bk?.phoneFather).toBe('0655555555');
  });
});

describe('Import ramasseurs - re-import : les colonnes lues a la creation ne sont pas signalees ignorees', () => {
  it('SEXE est lu et mis a jour aussi sur une fiche existante', async () => {
    const buf1 = await makeXlsx(['NOM', 'PRENOM', 'MAIL', 'SEXE'], [['Genre', 'Test', 'genre@test.test', 'M']]);
    await importFile(buf1);
    const buf2 = await makeXlsx(['NOM', 'PRENOM', 'MAIL', 'SEXE'], [['Genre', 'Test', 'genre@test.test', 'F']]);
    const data = await importFile(buf2);
    expect(data.updated).toBe(1);
    expect(data.unmappedColumns).not.toContain('SEXE');
    expect((await prisma.ballkid.findFirst({ where: { email: 'genre@test.test' } }))?.gender).toBe('FEMALE');
  });
});

describe('Import ramasseurs - rapport d\'erreurs precis (classeur 2027 LISTE WEB)', () => {
  it('ignore les lignes qui ne portent qu\'un N° sans les compter en erreur', async () => {
    const buf = await makeXlsx(
      ['N°', 'NOM', 'PRENOM', 'MAIL'],
      [
        [1, 'Numero', 'Un', 'un@num.test'],
        [2, '', '', ''],
        [3, '', '', ''],
      ]
    );
    const data = await importFile(buf);
    expect(data.imported).toBe(1);
    expect(data.errors).toBe(0);
    expect(data.blankRows).toBe(2);
  });

  it('localise chaque erreur par numero de ligne Excel et nom, avec un motif lisible', async () => {
    const buf = await makeXlsx(
      ['NOM', 'PRENOM', 'AGE', 'MAIL'],
      [
        ['Ok', 'Ligne', '2012-03-15', 'ok@err.test'],          // ligne 2
        ['Salvetti', 'Timeo', '01/05/23011', 'fam@err.test'],  // ligne 3 : annee a 5 chiffres
        ['Sansprenom', '', '', 'x@err.test'],                   // ligne 4
      ]
    );
    const data = await importFile(buf);
    expect(data.imported).toBe(1);
    expect(data.errors).toBe(2);
    expect(data.errorDetails[0]).toMatchObject({ line: 3, name: 'Salvetti Timeo' });
    expect(data.errorDetails[0].error).toBe('Date de naissance illisible : « 01/05/23011 » (attendu jj/mm/aaaa)');
    expect(data.errorDetails[1]).toMatchObject({ line: 4, name: 'Sansprenom', error: 'Prenom manquant' });
  });

  it('numerote aussi les lignes d\'un CSV', async () => {
    const csv = ['NOM;PRENOM;MAIL', 'Csv;Ok;csv@err.test', ';Orphelin;o@err.test'].join('\n');
    const data = await importFile(Buffer.from(csv, 'utf8'), 'liste.csv');
    expect(data.errors).toBe(1);
    expect(data.errorDetails[0]).toMatchObject({ line: 3, error: 'Nom manquant' });
  });
});

describe('Import ramasseurs - dates de naissance strictes', () => {
  it('accepte jj/mm/aaaa, jj.mm.aaaa, jj-mm-aaaa et ISO ; refuse une date inexistante ou une annee implausible', async () => {
    const buf = await makeXlsx(
      ['NOM', 'PRENOM', 'DATE DE NAISSANCE', 'MAIL'],
      [
        ['Date', 'Slash', '15/03/2012', 'd1@date.test'],
        ['Date', 'Point', '15.03.2012', 'd2@date.test'],
        ['Date', 'Tiret', '15-03-2012', 'd3@date.test'],
        ['Date', 'Iso', '2012-03-15', 'd4@date.test'],
        ['Date', 'Fevrier', '31/02/2012', 'd5@date.test'],
        ['Date', 'Ancienne', '15/03/1985', 'd6@date.test'],
        ['Date', 'Texte', 'quinze mars', 'd7@date.test'],
      ]
    );
    const data = await importFile(buf);
    expect(data.imported).toBe(4);
    expect(data.errors).toBe(3);
    expect(data.errorDetails.map((e) => e.name)).toEqual(['Date Fevrier', 'Date Ancienne', 'Date Texte']);
    for (const prenom of ['Slash', 'Point', 'Tiret', 'Iso']) {
      const b = await prisma.ballkid.findFirst({ where: { tournamentId, lastName: 'Date', firstName: prenom } });
      expect(b?.birthDate.toISOString().slice(0, 10)).toBe('2012-03-15');
    }
  });
});

describe('Import ramasseurs - fusions par homonymie signalees', () => {
  it('signale la fiche sans date completee, la ligne sans date rapprochee, et l\'homonyme cree a cote', async () => {
    await prisma.ballkid.createMany({
      data: [
        { tournamentId, lastName: 'Fusion', firstName: 'Sansdate', email: 'f1@fus.test', birthDate: new Date('2010-01-01'), gender: 'MALE', status: 'PENDING' },
        { tournamentId, lastName: 'Fusion', firstName: 'Avecdate', email: 'f2@fus.test', birthDate: new Date('2012-06-01'), gender: 'MALE', status: 'PENDING' },
        { tournamentId, lastName: 'Fusion', firstName: 'Autredate', email: 'f3@fus.test', birthDate: new Date('2011-01-10'), gender: 'MALE', status: 'PENDING' },
      ],
    });
    const buf = await makeXlsx(
      ['NOM', 'PRENOM', 'DATE DE NAISSANCE', 'MAIL'],
      [
        ['Fusion', 'Sansdate', '03/04/2013', 'f1@fus.test'],  // fiche existante sans date -> completee
        ['Fusion', 'Avecdate', '', 'f2@fus.test'],            // ligne sans date -> rapprochee
        ['Fusion', 'Autredate', '20/09/2013', 'f3@fus.test'], // autre date -> doublon signale
        ['Fusion', 'Avecdate', '01/06/2012', 'f2@fus.test'],  // meme date -> mise a jour normale, non signalee
      ]
    );
    const data = await importFile(buf);
    expect(data.imported).toBe(1);
    expect(data.updated).toBe(3);
    expect(data.errors).toBe(0);
    expect(data.merged).toBe(3);
    expect(data.mergedDetails.map((m) => m.name)).toEqual(['Fusion Sansdate', 'Fusion Avecdate', 'Fusion Autredate']);
    expect(data.mergedDetails[0].detail).toMatch(/sans date de naissance completee avec le 03\/04\/2013/);
    expect(data.mergedDetails[1].detail).toMatch(/rapprochee de la fiche existante \(nee le 01\/06\/2012\)/);
    expect(data.mergedDetails[2].detail).toMatch(/homonyme existe deja .*10\/01\/2011 au lieu de 20\/09\/2013/);
    const sansdate = await prisma.ballkid.findFirst({ where: { tournamentId, firstName: 'Sansdate' } });
    expect(sansdate?.birthDate.toISOString().slice(0, 10)).toBe('2013-04-03');
    expect(await prisma.ballkid.count({ where: { tournamentId, lastName: 'Fusion', firstName: 'Autredate' } })).toBe(2);
  });
});

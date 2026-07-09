import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import path from 'path';
import fs from 'fs';
import { setupTestDB, teardownTestDB, getApp, prisma } from './setup.js';
import bcrypt from 'bcryptjs';

let app: Express;
let adminToken: string;
let coachToken: string;
let tournamentId: string;

// PNG 1x1 valide (transparent) pour les tests d'upload de photos.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

// Attache un buffer CSV/Excel comme dans excel.test.ts.
function importFile(token: string, buffer: Buffer, filename: string, fields: Record<string, string> = {}) {
  const req = request(app)
    .post('/api/ballkids/import')
    .set('Authorization', `Bearer ${token}`)
    .attach('file', buffer, filename);
  for (const [k, v] of Object.entries(fields)) {
    req.field(k, v);
  }
  return req;
}

beforeAll(async () => {
  await setupTestDB();
  app = await getApp();

  const hash = await bcrypt.hash('admin123', 10);
  await prisma.user.create({
    data: { email: 'admin@import.test', password: hash, firstName: 'Admin', lastName: 'Test', role: 'ADMIN' },
  });
  const adminRes = await request(app).post('/api/auth/login').send({ email: 'admin@import.test', password: 'admin123' });
  adminToken = adminRes.body.data.token;

  const coachHash = await bcrypt.hash('coach123', 10);
  await prisma.user.create({
    data: { email: 'coach@import.test', password: coachHash, firstName: 'Coach', lastName: 'Test', role: 'COACH' },
  });
  const coachRes = await request(app).post('/api/auth/login').send({ email: 'coach@import.test', password: 'coach123' });
  coachToken = coachRes.body.data.token;

  const tournament = await prisma.tournament.create({
    data: { name: 'Import Test', year: 2026, startDate: new Date('2026-05-24'), endDate: new Date('2026-06-07'), isActive: true },
  });
  tournamentId = tournament.id;
});

afterAll(async () => {
  // Nettoyage des fichiers photos crees pendant les tests (uploads/photos/ballkid-*)
  const withPhotos = await prisma.ballkid.findMany({ where: { photoUrl: { not: null } } });
  for (const bk of withPhotos) {
    if (!bk.photoUrl) continue;
    const p = path.join(process.cwd(), bk.photoUrl);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  await teardownTestDB();
});

describe('POST /api/ballkids/import - creation', () => {
  it('importe un CSV -> ramasseurs crees en statut PENDING, avec restauration tel/CP, mapping sexe et dates', async () => {
    const csv = [
      'Prénom;Nom;Email;Date de naissance;Sexe;Téléphone;Code postal',
      'Pierre;Durand;pierre@imp.test;2012-05-10;M;651904945;1000',
      'Sophie;Leblanc;sophie@imp.test;15/03/2012;féminin;;75001',
      'Marc;Petit;marc@imp.test;;garçon;;13000',
      'Emma;Roy;emma@imp.test;2011-06-01;inconnu;;69001',
    ].join('\n');

    const res = await importFile(adminToken, Buffer.from(csv, 'utf8'), 'ramasseurs.csv', { tournamentId });

    expect(res.status).toBe(200);
    expect(res.body.data.imported).toBe(4);
    expect(res.body.data.errors).toBe(0);

    const pierre = await prisma.ballkid.findFirst({ where: { tournamentId, email: 'pierre@imp.test' } });
    expect(pierre?.status).toBe('PENDING');
    // 0 initial restaure : 9 chiffres -> 0651904945 ; CP 4 chiffres -> 01000
    expect(pierre?.phone).toBe('0651904945');
    expect(pierre?.postalCode).toBe('01000');
    expect(pierre?.gender).toBe('MALE');
    expect(pierre?.birthDate.toISOString().slice(0, 10)).toBe('2012-05-10');

    // Sexe FR "féminin" -> FEMALE ; date FR jj/mm/aaaa -> ISO
    const sophie = await prisma.ballkid.findFirst({ where: { tournamentId, email: 'sophie@imp.test' } });
    expect(sophie?.gender).toBe('FEMALE');
    expect(sophie?.birthDate.toISOString().slice(0, 10)).toBe('2012-03-15');

    // "garçon" -> MALE ; date absente -> defaut 2010-01-01
    const marc = await prisma.ballkid.findFirst({ where: { tournamentId, email: 'marc@imp.test' } });
    expect(marc?.gender).toBe('MALE');
    expect(marc?.birthDate.toISOString().slice(0, 10)).toBe('2010-01-01');

    // Sexe inconnu -> OTHER
    const emma = await prisma.ballkid.findFirst({ where: { tournamentId, email: 'emma@imp.test' } });
    expect(emma?.gender).toBe('OTHER');
  });
});

describe('POST /api/ballkids/import - re-import', () => {
  it('met a jour le ramasseur existant (par email) sans doublon et sans ecraser un champ existant avec du vide', async () => {
    const csv = [
      'Prénom;Nom;Email;Club;Téléphone',
      'Pierre;Durand;pierre@imp.test;TC Lyon;',
    ].join('\n');

    const res = await importFile(adminToken, Buffer.from(csv, 'utf8'), 'reimport.csv', { tournamentId });

    expect(res.status).toBe(200);
    expect(res.body.data.imported).toBe(0);
    expect(res.body.data.updated).toBe(1);

    // Pas de doublon
    const durands = await prisma.ballkid.findMany({ where: { tournamentId, lastName: 'Durand' } });
    expect(durands.length).toBe(1);
    // Club mis a jour, mais telephone vide n'ecrase pas l'existant
    expect(durands[0].club).toBe('TC Lyon');
    expect(durands[0].phone).toBe('0651904945');
  });
});

describe('POST /api/ballkids/import - erreurs de lignes', () => {
  it('compte en erreurs les lignes sans nom/prenom ou sans email ni telephone', async () => {
    const csv = [
      'Prénom;Nom;Email;Téléphone',
      ';Sansprenom;a@err.test;',      // prenom manquant
      'Jean;;jean@err.test;',         // nom manquant
      'Sans;Contact;;',               // ni email ni telephone
      'Valide;Ligne;valide@err.test;',
    ].join('\n');

    const res = await importFile(adminToken, Buffer.from(csv, 'utf8'), 'errors.csv', { tournamentId });

    expect(res.status).toBe(200);
    expect(res.body.data.imported).toBe(1);
    expect(res.body.data.errors).toBe(3);
    expect(res.body.data.errorDetails).toHaveLength(3);
  });
});

describe('POST /api/ballkids/import - validations', () => {
  it('renvoie 400 sans fichier', async () => {
    const res = await request(app)
      .post('/api/ballkids/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('tournamentId', tournamentId);
    expect(res.status).toBe(400);
  });

  it('renvoie 400 sans tournamentId', async () => {
    const csv = 'Prénom;Nom;Email\nTest;Sanstournoi;t@err.test';
    const res = await request(app)
      .post('/api/ballkids/import')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from(csv, 'utf8'), 'notournament.csv');
    expect(res.status).toBe(400);
  });

  it('renvoie 403 pour un coach', async () => {
    const csv = 'Prénom;Nom;Email\nTest;Coach;c@err.test';
    const res = await importFile(coachToken, Buffer.from(csv, 'utf8'), 'coach.csv', { tournamentId });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/ballkids/photos/bulk', () => {
  beforeAll(async () => {
    // Ramasseurs dedies avec accents pour tester la normalisation
    await prisma.ballkid.create({
      data: { firstName: 'Chloé', lastName: 'Gérard', email: 'chloe@photo.test', birthDate: new Date('2012-01-01'), gender: 'FEMALE', status: 'REGISTERED', tournamentId },
    });
    await prisma.ballkid.create({
      data: { firstName: 'Léa', lastName: 'Noël', email: 'lea@photo.test', birthDate: new Date('2012-01-01'), gender: 'FEMALE', status: 'REGISTERED', tournamentId },
    });
  });

  it('associe les photos par "Nom Prénom" et "prenom_nom" (casse/accents/separateurs/ordre)', async () => {
    const res = await request(app)
      .post('/api/ballkids/photos/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      // "CHLOE gerard.jpg" : prenom+nom, majuscules, sans accents
      .attach('photos', PNG_1x1, 'CHLOE gerard.jpg')
      // "noel_lea.png" : nom_prenom, underscore, sans accents
      .attach('photos', PNG_1x1, 'noel_lea.png');

    expect(res.status).toBe(200);
    expect(res.body.data.matched).toBe(2);
    expect(res.body.data.notFound).toBe(0);
    expect(res.body.data.duplicates).toBe(0);
  });

  it('classe en notFound un fichier sans ramasseur correspondant', async () => {
    const res = await request(app)
      .post('/api/ballkids/photos/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('photos', PNG_1x1, 'Inconnu Personne.jpg');

    expect(res.status).toBe(200);
    expect(res.body.data.matched).toBe(0);
    expect(res.body.data.notFound).toBe(1);
  });

  it('classe en duplicates un 2e fichier pour le meme ramasseur', async () => {
    const res = await request(app)
      .post('/api/ballkids/photos/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('photos', PNG_1x1, 'Gerard Chloe.jpg')
      .attach('photos', PNG_1x1, 'chloe_gerard.png');

    expect(res.status).toBe(200);
    expect(res.body.data.matched).toBe(1);
    expect(res.body.data.duplicates).toBe(1);
  });

  it('classe en ambiguous un fichier correspondant a plusieurs homonymes', async () => {
    // Deux vrais homonymes : aucun ne doit etre choisi silencieusement
    await prisma.ballkid.create({
      data: { firstName: 'Marie', lastName: 'Martin', email: 'marie1@photo.test', birthDate: new Date('2012-01-01'), gender: 'FEMALE', status: 'REGISTERED', tournamentId },
    });
    await prisma.ballkid.create({
      data: { firstName: 'Marie', lastName: 'Martin', email: 'marie2@photo.test', birthDate: new Date('2012-01-01'), gender: 'FEMALE', status: 'REGISTERED', tournamentId },
    });

    const res = await request(app)
      .post('/api/ballkids/photos/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('photos', PNG_1x1, 'Marie_Martin.jpg');

    expect(res.status).toBe(200);
    expect(res.body.data.matched).toBe(0);
    expect(res.body.data.ambiguous).toBe(1);
    expect(res.body.data.details.ambiguous[0].candidates).toHaveLength(2);

    // Aucune des deux Marie Martin ne doit avoir recu la photo
    const maries = await prisma.ballkid.findMany({ where: { tournamentId, lastName: 'Martin', firstName: 'Marie' } });
    expect(maries.every(m => m.photoUrl === null)).toBe(true);
  });

  it('ecrase la photo existante d\'un ramasseur par la nouvelle', async () => {
    const first = await request(app)
      .post('/api/ballkids/photos/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('photos', PNG_1x1, 'Noel Lea.jpg');
    expect(first.body.data.matched).toBe(1);

    const before = await prisma.ballkid.findFirst({ where: { tournamentId, email: 'lea@photo.test' } });
    expect(before?.photoUrl).toBeTruthy();

    const second = await request(app)
      .post('/api/ballkids/photos/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('photos', PNG_1x1, 'Lea Noel.png');
    expect(second.body.data.matched).toBe(1);

    const after = await prisma.ballkid.findFirst({ where: { tournamentId, email: 'lea@photo.test' } });
    expect(after?.photoUrl).toBeTruthy();
    // Nouvelle URL differente de l'ancienne (le fichier a bien ete remplace)
    expect(after?.photoUrl).not.toBe(before?.photoUrl);
  });

  it('accepte un fichier .heic (non rejete par le filtre) et gere l\'echec de conversion sans crasher le lot', async () => {
    // Un .heic invalide (contenu PNG) : le filtre ne le rejette plus, la
    // conversion echoue -> classe en notFound, mais le fichier JPG valide du
    // meme lot est bien traite (le lot ne plante pas).
    const res = await request(app)
      .post('/api/ballkids/photos/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('photos', PNG_1x1, { filename: 'Faux_Fichier.heic', contentType: 'image/heic' })
      .attach('photos', PNG_1x1, 'Gerard Chloe.jpg');

    expect(res.status).toBe(200);
    expect(res.body.data.matched).toBe(1);
    expect(res.body.data.notFound).toBe(1);
    expect(res.body.data.details.notFound).toContain('Faux_Fichier.heic');
  });

  it('renvoie 404 si aucun tournoi actif', async () => {
    await prisma.tournament.updateMany({ where: { id: tournamentId }, data: { isActive: false } });
    try {
      const res = await request(app)
        .post('/api/ballkids/photos/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('photos', PNG_1x1, 'Gerard Chloe.jpg');
      expect(res.status).toBe(404);
    } finally {
      await prisma.tournament.updateMany({ where: { id: tournamentId }, data: { isActive: true } });
    }
  });
});

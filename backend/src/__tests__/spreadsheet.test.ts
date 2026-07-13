import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { parseSpreadsheet, getSheetNames } from '../lib/spreadsheet.js';

// Tests UNITAIRES purs du parseur de tableur : aucun HTTP, aucune DB.
// Les buffers Excel sont generes en memoire avec ExcelJS (comme dans excel.test.ts).

// Petit helper : construit un buffer .xlsx a partir de lignes (types mixtes autorises).
async function makeXlsx(rows: any[][], sheetName = 'Sheet1'): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  for (const row of rows) {
    sheet.addRow(row);
  }
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

// Replique exacte de la conversion interne (epoch 1899-12-30) pour un test
// independant du fuseau horaire : on verifie que parseSpreadsheet applique bien
// cette formule sur les colonnes de type date.
function excelDateToISO(serial: number): string {
  const epoch = new Date(1899, 11, 30);
  const date = new Date(epoch.getTime() + serial * 86400000);
  return date.toISOString().split('T')[0];
}

describe('parseSpreadsheet - conversion des dates Excel', () => {
  it('convertit un serial (44197) en date ISO quand l\'en-tete contient "naissance"/"date", mais pas dans une colonne "Pointure"', async () => {
    const buf = await makeXlsx([
      ['Nom', 'Date naissance', 'Pointure'],
      ['Dupont', 44197, 42],
    ]);

    const rows = await parseSpreadsheet(buf, 'ramasseurs.xlsx');

    expect(rows).toHaveLength(1);
    // Colonne date -> conversion via l'epoch 1899-12-30
    expect(rows[0]['Date naissance']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(rows[0]['Date naissance']).toBe(excelDateToISO(44197));
    // Colonne "Pointure" : nombre NON converti, juste stringifie
    expect(rows[0]['Pointure']).toBe('42');
    expect(rows[0]['Nom']).toBe('Dupont');
  });

  it('rend une cellule de type date au format YYYY-MM-DD', async () => {
    // NB : SheetJS relit la cellule date comme un serial numerique ; la colonne
    // "Date" etant reconnue comme colonne date, la valeur ressort en YYYY-MM-DD.
    const buf = await makeXlsx([
      ['Nom', 'Date'],
      ['Martin', new Date(Date.UTC(2011, 7, 22))],
    ]);

    const rows = await parseSpreadsheet(buf, 'ramasseurs.xlsx');

    expect(rows).toHaveLength(1);
    expect(rows[0]['Date']).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(rows[0]['Date']).toContain('2011-08');
  });
});

describe('parseSpreadsheet - colonnes/lignes ignorees', () => {
  it('ignore les colonnes __EMPTY et les lignes entierement vides', async () => {
    // On laisse volontairement l'en-tete de la colonne 2 vide -> SheetJS la nomme __EMPTY.
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('S');
    const header = sheet.getRow(1);
    header.getCell(1).value = 'Nom';
    header.getCell(3).value = 'Prenom';
    header.commit();
    const r1 = sheet.getRow(2);
    r1.getCell(1).value = 'Dupont';
    r1.getCell(2).value = 'junk';
    r1.getCell(3).value = 'Jean';
    r1.commit();
    // Ligne entierement vide -> doit etre filtree
    const r2 = sheet.getRow(3);
    r2.getCell(1).value = '';
    r2.getCell(2).value = '';
    r2.getCell(3).value = '';
    r2.commit();
    const r3 = sheet.getRow(4);
    r3.getCell(1).value = 'Martin';
    r3.getCell(3).value = 'Marie';
    r3.commit();
    const buf = Buffer.from(await workbook.xlsx.writeBuffer());

    const rows = await parseSpreadsheet(buf, 'f.xlsx');

    expect(rows).toHaveLength(2); // la ligne vide est ignoree
    expect(rows[0]).not.toHaveProperty('__EMPTY');
    expect(Object.keys(rows[0]).sort()).toEqual(['Nom', 'Prenom']);
    expect(rows[0]).toEqual({ Nom: 'Dupont', Prenom: 'Jean' });
    expect(rows[1]).toEqual({ Nom: 'Martin', Prenom: 'Marie' });
  });
});

describe('parseSpreadsheet - CSV', () => {
  it('detecte le separateur ; et gere le BOM UTF-8 en tete', async () => {
    const csv = '﻿Prénom;Nom\nJean;Dupont';
    const rows = await parseSpreadsheet(Buffer.from(csv, 'utf8'), 'a.csv');

    expect(rows).toHaveLength(1);
    const firstKey = Object.keys(rows[0])[0];
    // Le BOM ne doit pas polluer la 1re cle d'en-tete
    expect(firstKey).toBe('Prénom');
    expect(firstKey.includes('﻿')).toBe(false);
    expect(rows[0]).toEqual({ 'Prénom': 'Jean', Nom: 'Dupont' });
  });

  it('detecte le separateur , (virgule)', async () => {
    const csv = 'Prénom,Nom\nMarie,Martin';
    const rows = await parseSpreadsheet(Buffer.from(csv, 'utf8'), 'a.csv');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ 'Prénom': 'Marie', Nom: 'Martin' });
  });
});

describe('parseSpreadsheet - routage par extension', () => {
  it('route .xls/.xlsx vers Excel et .csv vers CSV (meme contenu logique -> meme sortie)', async () => {
    const xlsxBuf = await makeXlsx([
      ['Prénom', 'Nom'],
      ['Jean', 'Dupont'],
    ]);
    const csvBuf = Buffer.from('Prénom;Nom\nJean;Dupont', 'utf8');

    const xlsxOut = await parseSpreadsheet(xlsxBuf, 'f.xlsx');
    // meme buffer Excel route comme .xls (ancien format) -> meme parseur
    const xlsOut = await parseSpreadsheet(xlsxBuf, 'f.xls');
    const csvOut = await parseSpreadsheet(csvBuf, 'f.csv');

    expect(xlsxOut).toEqual([{ 'Prénom': 'Jean', Nom: 'Dupont' }]);
    expect(xlsOut).toEqual(xlsxOut);
    expect(csvOut).toEqual(xlsxOut);
  });
});

describe('getSheetNames + selection d\'onglet', () => {
  it('retourne les noms d\'onglets dans l\'ordre et lit l\'onglet demande (fallback 1er onglet si inconnu)', async () => {
    const workbook = new ExcelJS.Workbook();
    const s1 = workbook.addWorksheet('First');
    s1.addRow(['Nom']);
    s1.addRow(['Alpha']);
    const s2 = workbook.addWorksheet('Data');
    s2.addRow(['Nom']);
    s2.addRow(['Zed']);
    const s3 = workbook.addWorksheet('Third');
    s3.addRow(['Nom']);
    const buf = Buffer.from(await workbook.xlsx.writeBuffer());

    expect(getSheetNames(buf)).toEqual(['First', 'Data', 'Third']);

    // Onglet demande explicitement
    expect(await parseSpreadsheet(buf, 'x.xlsx', 'Data')).toEqual([{ Nom: 'Zed' }]);
    // Nom inconnu -> fallback sur le 1er onglet ('First')
    expect(await parseSpreadsheet(buf, 'x.xlsx', 'Nope')).toEqual([{ Nom: 'Alpha' }]);
  });
});

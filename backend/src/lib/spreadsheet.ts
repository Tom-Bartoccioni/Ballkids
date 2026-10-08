import ExcelJS from 'exceljs';
import XLSX from 'xlsx';
import { parse } from 'csv-parse';
import { Readable } from 'stream';

/**
 * Parse un fichier uploadé (CSV ou Excel) et retourne un tableau d'objets clé-valeur.
 * Les clés sont les en-têtes de la première ligne.
 * Supporte .csv, .xlsx et .xls (ancien format binaire).
 */
export async function parseSpreadsheet(
  buffer: Buffer,
  originalname: string,
  sheetName?: string
): Promise<Record<string, string>[]> {
  const ext = originalname.toLowerCase();

  if (ext.endsWith('.xlsx') || ext.endsWith('.xls')) {
    return parseExcel(buffer, sheetName);
  }
  return parseCsv(buffer);
}

/**
 * Retourne la liste des noms d'onglets d'un fichier Excel.
 */
export function getSheetNames(buffer: Buffer): string[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  return workbook.SheetNames;
}

/**
 * Convertit un numéro de série Excel en date ISO (YYYY-MM-DD).
 * Excel stocke les dates comme nombre de jours depuis le 1899-12-30.
 */
// Un serial Excel est un nombre de JOURS depuis le 30/12/1899 : on reste en
// arithmetique UTC de bout en bout pour ne jamais subir le fuseau du serveur.
function excelSerialToISO(serial: number): string {
  const days = Math.floor(serial);
  const ms = Date.UTC(1899, 11, 30) + days * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

// Une cellule deja typee Date par SheetJS est construite en heure LOCALE :
// on lit donc ses composantes locales (toISOString la ferait basculer en UTC,
// soit la veille pour tout fuseau a l'est de Greenwich).
function localDateToISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function parseExcel(buffer: Buffer, targetSheet?: string): Promise<Record<string, string>[]> {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  // Use specified sheet, or first sheet by default
  const sheetName = targetSheet
    ? workbook.SheetNames.find(n => n === targetSheet) || workbook.SheetNames[0]
    : workbook.SheetNames[0];
  if (!sheetName) return [];

  const sheet = workbook.Sheets[sheetName];
  const rawData = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' });

  return rawData
    .filter((row) => {
      // Skip empty rows
      return Object.values(row).some((v) => v !== '' && v != null);
    })
    .map((row) => {
      const record: Record<string, string> = {};
      // Numero de ligne tel qu'affiche dans Excel (SheetJS numerote a partir de 0,
      // en-tete compris) : sert a localiser une ligne en erreur dans le rapport.
      setLineNumber(record, ((row as any).__rowNum__ ?? 0) + 1);
      for (const [key, value] of Object.entries(row)) {
        // Skip __EMPTY columns (unnamed columns from SheetJS)
        if (key.startsWith('__EMPTY')) continue;

        if (value instanceof Date) {
          record[key] = localDateToISO(value);
        } else if (typeof value === 'number') {
          // Detect Excel date serials (roughly between 1900-01-01 and 2100-01-01)
          // and only convert if the column name hints at a date
          const keyLower = key.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          const isDateColumn = /age|naissance|birth|date|dob|ne\(e\)|nee/.test(keyLower);
          if (isDateColumn && value > 1 && value < 73000) {
            record[key] = excelSerialToISO(value);
          } else {
            record[key] = value.toString();
          }
        } else if (value != null) {
          record[key] = value.toString().trim();
        } else {
          record[key] = '';
        }
      }
      return record;
    });
}

async function parseCsv(buffer: Buffer): Promise<Record<string, string>[]> {
  const headerLine = buffer.toString('utf8', 0, 1024).split(/\r?\n/)[0] || '';
  const delimiter = headerLine.includes(';') ? ';' : ',';

  const records: Record<string, string>[] = [];
  const parser = Readable.from(buffer).pipe(
    parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
      delimiter,
      bom: true,
      info: true,
    })
  );

  for await (const { record, info } of parser) {
    setLineNumber(record, info.lines);
    records.push(record);
  }

  return records;
}

// Propriete NON enumerable : elle n'apparait ni dans Object.keys/entries ni dans
// le JSON, les consommateurs qui parcourent les colonnes ne la voient pas.
function setLineNumber(record: Record<string, string>, line: number) {
  Object.defineProperty(record, '__line', { value: line, enumerable: false });
}

/** Numero de ligne d'origine (1 = en-tete) d'un enregistrement issu de parseSpreadsheet. */
export function getLineNumber(record: Record<string, string>): number | undefined {
  return (record as any).__line;
}

/**
 * Crée un fichier Excel à partir de headers et rows, et retourne le buffer.
 */
export async function createExcelBuffer(
  sheetName: string,
  headers: string[],
  rows: (string | number | null)[][],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);

  // Header row avec style
  sheet.addRow(headers);
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E40AF' },
  };
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };

  // Data rows
  for (const row of rows) {
    sheet.addRow(row);
  }

  // Auto-width columns
  sheet.columns.forEach((col) => {
    let maxLen = 10;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const len = cell.value?.toString().length || 0;
      if (len > maxLen) maxLen = len;
    });
    col.width = Math.min(maxLen + 2, 40);
  });

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

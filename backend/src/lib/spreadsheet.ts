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
function excelDateToISO(serial: number): string {
  const epoch = new Date(1899, 11, 30);
  const date = new Date(epoch.getTime() + serial * 86400000);
  return date.toISOString().split('T')[0];
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
      for (const [key, value] of Object.entries(row)) {
        // Skip __EMPTY columns (unnamed columns from SheetJS)
        if (key.startsWith('__EMPTY')) continue;

        if (value instanceof Date) {
          record[key] = value.toISOString().split('T')[0];
        } else if (typeof value === 'number') {
          // Detect Excel date serials (roughly between 1900-01-01 and 2100-01-01)
          // and only convert if the column name hints at a date
          const keyLower = key.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          const isDateColumn = /age|naissance|birth|date|dob|ne\(e\)|nee/.test(keyLower);
          if (isDateColumn && value > 1 && value < 73000) {
            record[key] = excelDateToISO(value);
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
    })
  );

  for await (const record of parser) {
    records.push(record);
  }

  return records;
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

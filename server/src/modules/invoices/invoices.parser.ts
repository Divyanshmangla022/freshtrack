import * as XLSX from 'xlsx';

export interface ParsedSheet {
  sheetName: string;
  headers: string[];
  /** Data rows aligned to `headers` (each cell coerced to a trimmed string). */
  rows: string[][];
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

/**
 * Parse a CSV or Excel (.xlsx/.xls) buffer into headers + string rows.
 * SheetJS sniffs the format from the buffer, so one code path handles both.
 * The first non-empty row is treated as the header row.
 */
export function parseSpreadsheet(buffer: Buffer): ParsedSheet {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  } catch (err) {
    throw new Error(`Unable to read the file. Ensure it is a valid CSV or Excel file. (${(err as Error).message})`);
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('The uploaded file contains no sheets.');
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error('The uploaded file contains no readable sheet.');

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  });

  if (matrix.length === 0) throw new Error('The file is empty.');

  const headerRow = matrix[0] ?? [];
  const headers = headerRow.map(cellToString);
  const width = headers.length;

  const rows: string[][] = [];
  for (let i = 1; i < matrix.length; i++) {
    const raw = matrix[i] ?? [];
    const row: string[] = [];
    for (let c = 0; c < width; c++) row.push(cellToString(raw[c]));
    // Skip completely empty rows.
    if (row.some((v) => v !== '')) rows.push(row);
  }

  return { sheetName, headers, rows };
}

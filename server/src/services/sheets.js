/**
 * Read and write contact sheets (CSV and Excel .xlsx).
 */
import ExcelJS from 'exceljs';
import { parse } from 'csv-parse/sync';
import { HttpError } from '../utils/http.js';

export const MAX_SHEET_ROWS = 50000;

// Plain text of an Excel cell (numbers, rich text, hyperlinks, formulas, dates)
function cellText(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((r) => r.text).join('');
    if ('text' in value) return String(value.text ?? '');
    if ('result' in value) return cellText(value.result);
    if ('hyperlink' in value) return String(value.hyperlink);
    return '';
  }
  // Big phone numbers stored as numbers: avoid "9.19876543210e+11"
  if (typeof value === 'number') return Number.isInteger(value) ? value.toFixed(0) : String(value);
  return String(value);
}

function uniqueHeaders(raw) {
  const seen = {};
  return raw.map((h, i) => {
    const base = String(h ?? '').trim() || `Column ${i + 1}`;
    seen[base] = (seen[base] || 0) + 1;
    return seen[base] > 1 ? `${base} (${seen[base]})` : base;
  });
}

/** Returns { headers: string[], rows: Array<Record<header, string>> } */
export async function readSheet(buffer, fileName = '') {
  const name = fileName.toLowerCase();
  let table;

  if (name.endsWith('.xlsx')) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer);
    } catch {
      throw new HttpError(400, 'Could not read this Excel file. Save it as .xlsx (Excel Workbook) and try again.');
    }
    const ws = wb.worksheets.find((w) => w.actualRowCount > 0);
    if (!ws) throw new HttpError(400, 'The Excel file is empty');
    table = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const values = row.values.slice(1); // exceljs rows are 1-based
      table.push(values.map(cellText));
    });
  } else if (name.endsWith('.csv') || name.endsWith('.txt') || !name.includes('.')) {
    try {
      table = parse(buffer, { skip_empty_lines: true, trim: true, bom: true, relax_column_count: true });
    } catch (err) {
      throw new HttpError(400, `Invalid CSV: ${err.message}`);
    }
  } else if (name.endsWith('.xls')) {
    throw new HttpError(400, 'Old Excel format (.xls) is not supported. Open it in Excel and "Save As" .xlsx or .csv.');
  } else {
    throw new HttpError(400, 'Upload a .xlsx or .csv file');
  }

  const [headerRow, ...dataRows] = table.filter((r) => r.some((c) => String(c ?? '').trim()));
  if (!headerRow) throw new HttpError(400, 'The sheet is empty');
  if (dataRows.length > MAX_SHEET_ROWS) throw new HttpError(400, `Too many rows (${dataRows.length}). Max ${MAX_SHEET_ROWS} per upload.`);

  const headers = uniqueHeaders(headerRow);
  const rows = dataRows.map((r) => Object.fromEntries(headers.map((h, i) => [h, String(r[i] ?? '').trim()])));
  return { headers, rows };
}

const GUESS = {
  phone: /^(phone|mobile|mob|number|contact|whatsapp|wa|phone ?no|mobile ?no|contact ?no|phone number|mobile number|whatsapp number)$/i,
  name: /^(name|full ?name|customer|customer ?name|student|student ?name|lead ?name)$/i,
  email: /^(e-?mail|email ?id|mail)$/i,
  tags: /^(tags?|labels?|group)$/i,
  leadStatus: /^(status|lead ?status|stage)$/i,
  course: /^(course|course ?name|interested ?in|program(me)?|course ?interested)$/i,
  counsellor: /^(counsell?or|assigned ?to|owner|agent|caller|handled ?by)$/i,
  followUp: /^(follow ?-?up|follow ?-?up ?date|next ?follow ?-?up|call ?back|next ?call|next ?action)$/i,
  notes: /^(notes?|remarks?|comments?|query|enquiry ?details|requirement|feedback)$/i,
  enquiryDate: /^(date|enquiry ?date|inquiry ?date|lead ?date|created|created ?on|query ?date|received ?on)$/i,
};

// Best guess of which column holds what, from the header names
export function guessMapping(headers) {
  const mapping = {};
  for (const [field, rx] of Object.entries(GUESS)) {
    const h = headers.find((x) => rx.test(x.trim()));
    if (h) mapping[field] = h;
  }
  return mapping;
}

/**
 * Normalize a phone from a sheet: keep digits, drop a leading 0 (trunk prefix) and add the default
 * country code to 10-digit local numbers (e.g. 98765 43210 -> 919876543210).
 */
export function sheetPhone(raw, defaultCountryCode) {
  let digits = String(raw || '').replace(/\D/g, '').replace(/^00/, '');
  const cc = String(defaultCountryCode || '').replace(/\D/g, '');
  if (cc && digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (cc && digits.length === 10) digits = cc + digits;
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

/** Build a .xlsx (format "xlsx") or UTF-8 .csv (opens correctly in Excel, incl. Hindi) */
export async function writeSheet(headers, rows, format) {
  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Leads');
    ws.columns = headers.map((h) => ({ header: h, key: h, width: Math.min(40, Math.max(12, h.length + 4)) }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    for (const r of rows) ws.addRow(r);
    // Keep phone numbers as text so Excel doesn't turn them into 9.19E+11
    const phoneCol = headers.indexOf('Phone') + 1;
    if (phoneCol) ws.getColumn(phoneCol).numFmt = '@';
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))];
  return Buffer.from(`﻿${lines.join('\r\n')}`, 'utf8');
}

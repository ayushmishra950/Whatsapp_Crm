/**
 * Dates typed by people / found in sheets -> "YYYY-MM-DD" (the format stored in date contact fields).
 * Day comes first for Indian style "15/08/2002". A date without a year is stored as "0000-MM-DD"
 * (good enough for birthdays / anniversaries, which only compare month and day).
 */
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

const pad = (n) => String(n).padStart(2, '0');
function valid(y, m, d) {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const check = new Date(Date.UTC(y || 2000, m - 1, d)); // 2000 is a leap year, so 29 Feb without a year is fine
  if (check.getUTCMonth() !== m - 1) return null;
  if (y && (y < 1900 || y > 2100)) return null;
  return `${y ? String(y).padStart(4, '0') : '0000'}-${pad(m)}-${pad(d)}`;
}
const fullYear = (y) => (y < 100 ? (y > (new Date().getFullYear() % 100) + 1 ? 1900 + y : 2000 + y) : y);

export function parseDateInput(raw) {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return valid(raw.getUTCFullYear(), raw.getUTCMonth() + 1, raw.getUTCDate());
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  let m;
  // 2002-08-15 / 2002/8/15 (also "2002-08-15T00:00:00Z" from Excel)
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return valid(+m[1], +m[2], +m[3]);
  // 0000-08-15 (our own "no year" format)
  // 15/08/2002, 15-8-02, 15.08.2002
  if ((m = s.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2}|\d{4})$/))) return valid(fullYear(+m[3]), +m[2], +m[1]);
  // 15/08 (no year)
  if ((m = s.match(/^(\d{1,2})[-/. ](\d{1,2})$/))) return valid(0, +m[2], +m[1]);
  // 15 aug 2002, 15 august, 15-Aug-02, aug 15 2002
  if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[-/ .,]*([a-z]{3,9})[-/ .,]*(\d{2}|\d{4})?$/))) {
    const mon = MONTHS[m[2].slice(0, m[2] === 'sept' ? 4 : 3)];
    return mon ? valid(m[3] ? fullYear(+m[3]) : 0, mon, +m[1]) : null;
  }
  if ((m = s.match(/^([a-z]{3,9})[-/ .,]*(\d{1,2})(?:st|nd|rd|th)?[-/ .,]*(\d{2}|\d{4})?$/))) {
    const mon = MONTHS[m[1].slice(0, 3)];
    return mon ? valid(m[3] ? fullYear(+m[3]) : 0, mon, +m[2]) : null;
  }
  return null;
}

// "YYYY-MM-DD" -> "MM-DD"
export const monthDay = (iso) => (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.slice(5) : null);

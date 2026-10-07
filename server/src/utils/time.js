export const DEFAULT_TZ = 'Asia/Kolkata';

export function safeTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

// "YYYY-MM-DD" of a date as seen in the given time zone
export const dayKey = (date, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date);

// Midnight today in the given time zone, as a UTC Date
export function startOfDayIn(tz) {
  const now = new Date();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, Number(p.value)])
  );
  const elapsedMs = ((parts.hour * 60 + parts.minute) * 60 + parts.second) * 1000 + now.getMilliseconds();
  return new Date(now.getTime() - elapsedMs);
}

// "+05:30" offset of a time zone on a given day ("YYYY-MM-DD")
export function tzOffset(tz, day) {
  const d = new Date(`${day}T12:00:00Z`);
  const local = new Date(d.toLocaleString('en-US', { timeZone: tz }));
  const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
  const mins = Math.round((local - utc) / 60000);
  const a = Math.abs(mins);
  return `${mins >= 0 ? '+' : '-'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

// The moment "HH:MM" happens on day "YYYY-MM-DD" in a time zone
export const zonedTime = (day, hhmm, tz) => new Date(`${day}T${hhmm}:00${tzOffset(tz, day)}`);

// Minutes since local midnight (0..1439) of a date in a time zone
export function localMinutes(date, tz) {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date).split(':').map(Number);
  return h * 60 + m;
}

export const hhmmToMinutes = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
  return m ? Math.min(23, +m[1]) * 60 + Math.min(59, +m[2]) : null;
};

// Same calendar day + n days ("YYYY-MM-DD")
export const addDays = (day, n) => new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);

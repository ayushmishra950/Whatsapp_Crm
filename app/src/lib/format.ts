/** Same formats as the web CRM (en-IN) */
export const fmtDate = (d?: string | Date | null) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export const fmtDateTime = (d?: string | Date | null) =>
  d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

export const fmtTime = (d?: string | Date | null) => (d ? new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '');

export function fmtRelative(d?: string | Date | null) {
  if (!d) return '';
  const date = new Date(d);
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 0) {
    const ahead = -diff;
    if (ahead < 3600) return `in ${Math.max(1, Math.round(ahead / 60))}m`;
    if (ahead < 86400) return `in ${Math.round(ahead / 3600)}h`;
    return fmtDateTime(d);
  }
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (new Date().toDateString() === date.toDateString()) return fmtTime(d);
  if (diff < 7 * 86400) return date.toLocaleDateString('en-IN', { weekday: 'short' });
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export const money = (n?: number | null) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
export const fmtNum = (n?: number | null) => new Intl.NumberFormat('en-IN').format(n || 0);
export const fmtPhone = (p = '') => (p ? `+${p}` : '');

type Named = { name?: string; phone?: string; instagram?: { username?: string } } | null | undefined;
/** A lead's name, else its WhatsApp number, else its Instagram @username (Instagram leads may have no phone) */
export const displayName = (c: Named) => (c ? String(c.name || '').trim() || (c.phone ? `+${c.phone}` : c.instagram?.username ? `@${c.instagram.username}` : 'Instagram user') : '');
/** Line under a lead's name: the WhatsApp number, else the Instagram @username */
export const contactHandle = (c: Named) => (c?.phone ? `+${c.phone}` : c?.instagram?.username ? `@${c.instagram.username}` : '');
export const initials = (name = '') =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.match(/[A-Za-z0-9]/)?.[0]?.toUpperCase() || '')
    .join('') || '?';

/** "2026-10-15" -> "15 Oct" (fees, due dates) */
export const prettyDay = (d?: string | null) => {
  if (!d) return '—';
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
  if (!y) return String(d);
  return new Date(y, m - 1, day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: y === new Date().getFullYear() ? undefined : 'numeric' });
};

/** Today in the phone's time zone as YYYY-MM-DD */
export const todayKey = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export const isLate = (d?: string | Date | null) => !!d && new Date(d).getTime() < Date.now();

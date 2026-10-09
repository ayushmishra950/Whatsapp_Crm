import { useAuth, type LeadStatus } from './auth';

// Same defaults as the server, used until the session has the business's own list
export const DEFAULT_LEAD_STATUSES: LeadStatus[] = [
  { key: 'new', label: 'New', color: 'purple' },
  { key: 'contacted', label: 'Contacted', color: 'blue' },
  { key: 'qualified', label: 'Interested', color: 'yellow' },
  { key: 'converted', label: 'Converted', color: 'green' },
  { key: 'lost', label: 'Not interested', color: 'red' },
];

export const STAGES = [
  { key: 'new', label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'interested', label: 'Interested' },
  { key: 'demo', label: 'Demo' },
  { key: 'admission', label: 'Admission' },
  { key: 'converted', label: 'Converted' },
  { key: 'closed', label: 'Nurture & Lost' },
];

/** The business's own lead statuses + helpers */
export function useLeadStatuses() {
  const { session } = useAuth();
  const list: LeadStatus[] = session?.tenant?.settings?.leadStatuses?.length ? session.tenant.settings.leadStatuses : DEFAULT_LEAD_STATUSES;
  const byKey = Object.fromEntries(list.map((s) => [s.key, s]));
  return {
    list,
    label: (key?: string) => (key ? byKey[key]?.label || key : '—'),
    color: (key?: string) => (key && byKey[key]?.color) || 'gray',
    stages: STAGES.map((st) => ({ ...st, keys: list.filter((s) => s.stage === st.key).map((s) => s.key) })).filter((st) => st.keys.length),
  };
}

export const LEAD_SOURCES: [string, string][] = [
  ['whatsapp', 'WhatsApp (direct)'],
  ['instagram', 'Instagram (direct)'],
  ['ad', 'Facebook / Insta ad'],
  ['import', 'Sheet import'],
  ['manual', 'Added by team'],
  ['website', 'Website'],
  ['walkin', 'Walk-in'],
  ['referral', 'Referral'],
  ['call', 'Phone call'],
  ['other', 'Other'],
];
export const MANUAL_SOURCES = LEAD_SOURCES.filter(([v]) => ['manual', 'website', 'walkin', 'referral', 'call', 'other'].includes(v));
export const sourceLabel = (v?: string) => LEAD_SOURCES.find(([k]) => k === v)?.[1] || v || '—';

export const LANGUAGES: [string, string][] = [
  ['', 'Not sure'],
  ['hi', 'Hinglish'],
  ['en', 'English'],
];

export const CALL_OUTCOMES: [string, string][] = [
  ['connected', 'Connected – spoke'],
  ['no_answer', 'No answer'],
  ['busy', 'Busy'],
  ['switched_off', 'Switched off'],
  ['call_back', 'Asked to call back'],
  ['wrong_number', 'Wrong number'],
];
export const callOutcomeLabel = (v?: string) => CALL_OUTCOMES.find(([k]) => k === v)?.[1] || v || '';

/** Colours and sizes, same palette as the web CRM (Tailwind slate + brand green). */
export const C = {
  brand50: '#ecfdf3',
  brand100: '#d1fadf',
  brand200: '#a6f4c5',
  brand500: '#22c55e',
  brand600: '#16a34a',
  brand700: '#15803d',
  brand800: '#166534',

  bg: '#f8fafc', // slate-50 page background
  card: '#ffffff',
  border: '#e2e8f0', // slate-200
  borderStrong: '#cbd5e1', // slate-300
  text: '#0f172a', // slate-900
  text2: '#334155', // slate-700
  muted: '#64748b', // slate-500
  faint: '#94a3b8', // slate-400
  soft: '#f1f5f9', // slate-100

  red: '#dc2626',
  red50: '#fef2f2',
  amber: '#d97706',
  amber50: '#fffbeb',
  amber900: '#78350f',
  blue: '#0284c7',
  blue50: '#f0f9ff',
  violet: '#7c3aed',
  violet50: '#f5f3ff',
  green50: '#f0fdf4',
  chat: '#efeae2', // WhatsApp chat background
  bubbleOut: '#d9fdd3',
  note: '#fef9c3',
};

/** Badge / status colours (same names as the web: gray, blue, green, yellow, red, purple) */
export const TONES: Record<string, { bg: string; fg: string }> = {
  gray: { bg: '#f1f5f9', fg: '#475569' },
  blue: { bg: '#e0f2fe', fg: '#0369a1' },
  green: { bg: '#dcfce7', fg: '#15803d' },
  yellow: { bg: '#fef3c7', fg: '#b45309' },
  amber: { bg: '#fef3c7', fg: '#b45309' },
  red: { bg: '#fee2e2', fg: '#b91c1c' },
  purple: { bg: '#ede9fe', fg: '#6d28d9' },
};

export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
export const R = { sm: 6, md: 10, lg: 14, full: 999 };
export const F = { xs: 11, sm: 13, md: 15, lg: 17, xl: 20, xxl: 24 };

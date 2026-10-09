import { Badge } from '@/components/ui';

/** Shared bits of the Super Admin panel (same labels as the web) */
export const BUSINESS_TYPES: [string, string][] = [
  ['general', 'General business'],
  ['coaching', 'Coaching institute'],
];

const STATUS: Record<string, [string, string]> = {
  active: ['Active', 'green'],
  trial: ['Trial', 'blue'],
  suspended: ['Suspended', 'red'],
  expired: ['Expired', 'yellow'],
  cancelled: ['Cancelled', 'gray'],
};

/** Business / subscription / user status badge */
export function SaStatus({ status }: { status?: string }) {
  if (!status) return <Badge>—</Badge>;
  const [label, tone] = STATUS[status] || [status, 'gray'];
  return <Badge tone={tone}>{label}</Badge>;
}

export type Plan = {
  _id: string;
  name: string;
  description?: string;
  priceMonthly: number;
  currency?: string;
  limits: { agents: number; contacts: number; monthlyMessages: number };
  modules?: { chatbot?: boolean; instagram?: boolean };
  features: string[];
  isActive: boolean;
  tenantCount?: number;
};

/** Whole months 1–36 from a text field */
export const clampMonths = (v: string) => Math.min(36, Math.max(1, parseInt(v, 10) || 1));

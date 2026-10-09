import { StyleSheet, Text, View } from 'react-native';
import { useAuth, useIsCoaching } from '@/lib/auth';
import { renderBody, type Template, type VariableDefault } from '@/lib/templates';
import { C, F, R, S } from '@/theme';
import { Badge, Select } from './ui';

/** Template as the server returns it (with its virtuals) */
export type Tpl = Template & {
  variableCount?: number;
  previousVersion?: { header?: string; body?: string; footer?: string };
  editLimits?: { usedLast30Days: number; remaining: number; nextAllowedAt: string | null };
  createdAt?: string;
  updatedAt?: string;
};

/** Same colours as the web's StatusBadge (templates, campaigns, recipients) */
const STATUS_TONES: Record<string, string> = {
  approved: 'green', completed: 'green', read: 'green',
  running: 'blue', sent: 'blue', delivered: 'blue', scheduled: 'blue',
  pending: 'yellow', paused: 'yellow', sending: 'yellow',
  draft: 'gray', cancelled: 'gray', skipped: 'gray',
  rejected: 'red', failed: 'red',
};
export const statusTone = (status?: string) => STATUS_TONES[status || ''] || 'gray';
export const StateBadge = ({ status }: { status?: string }) => (status ? <Badge tone={statusTone(status)}>{status}</Badge> : null);

// Sample values for the preview / WhatsApp review (same as the web)
const FIELD_EXAMPLES: Record<string, string> = {
  name: 'Rahul', phone: '919876543210', email: 'rahul@example.com', referral_code: 'RAHUL7K2', referral_link: 'https://wa.me/91…?text=…RAHUL7K2',
  'course.name': 'Digital Marketing', 'course.outcome': 'run ads and get your first client', 'course.next_batch': '15 Nov', 'course.per_day': '₹300',
  'course.fees': '₹27,000 (EMI available)', 'course.greeting': 'Great choice!', 'course.duration': '90 days', 'course.internship': '3-month live internship',
  'course.proof_link': 'https://example.com/results', 'course.link': 'https://yourwebsite.com/course', counsellor: 'Riya', 'business.name': 'ABC Institute', 'business.review_link': 'https://g.page/r/…',
  'business.proof_link': 'https://example.com/results', 'business.offer_end': '31 Oct', 'business.address': 'Jaipur', 'business.maps_link': 'https://maps.app.goo.gl/…',
  'business.payment_details': 'UPI: institute@upi', 'business.city': 'Jaipur', 'business.students_trained': '3,000+', 'business.since_year': '2012', 'business.rating': '4.9/5',
};

/** Sample text WhatsApp sees during review (and our preview) */
export const variableExample = (d: Partial<VariableDefault>, i: number) =>
  d.example ||
  (d.source === 'static' ? d.value : FIELD_EXAMPLES[d.value || ''] || (d.value?.startsWith('custom.') ? d.value.slice(7).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '')) ||
  `sample${i + 1}`;

/** WhatsApp-style bubble: header, body with {{n}} filled, footer, buttons */
export function TemplatePreview({ t, params }: { t: Partial<Template>; params?: string[] }) {
  const text = renderBody(t.body || '', params || []);
  return (
    <View style={styles.wrap}>
      <View style={styles.bubble}>
        {t.header ? <Text style={{ fontWeight: '700', marginBottom: 4, color: C.text }}>{t.header}</Text> : null}
        <Text style={{ fontSize: F.md, color: C.text }} selectable>{text || 'Message body…'}</Text>
        {t.footer ? <Text style={{ fontSize: 12, color: C.faint, marginTop: 6 }}>{t.footer}</Text> : null}
        {t.buttons?.length ? (
          <View style={styles.buttons}>
            {t.buttons.map((b, i) => (
              <Text key={i} style={styles.btn}>
                {b.type === 'URL' ? '🔗 ' : b.type === 'PHONE_NUMBER' ? '📞 ' : '↩ '}
                {b.text || 'Button'}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

// ---------- contact fields for {{n}} ----------
const BUILTIN = [
  { value: 'name', label: 'Contact name' },
  { value: 'phone', label: 'Phone' },
  { value: 'email', label: 'Email' },
];
const REFERRAL = [
  { value: 'referral_code', label: 'Referral code' },
  { value: 'referral_link', label: 'Referral link (WhatsApp)' },
];
const COURSE = [
  { value: 'course.name', label: 'Course name' },
  { value: 'course.outcome', label: 'Course outcome' },
  { value: 'course.next_batch', label: 'Next batch date' },
  { value: 'course.per_day', label: 'Fee per day' },
  { value: 'course.fees', label: 'Fees text (EN / Hinglish)' },
  { value: 'course.greeting', label: 'Course greeting (EN / Hinglish)' },
  { value: 'course.duration', label: 'Course duration' },
  { value: 'course.internship', label: 'Internship line' },
  { value: 'course.proof_link', label: 'Course proof link' },
  { value: 'course.link', label: 'Course website page' },
];
const BUSINESS = [
  { value: 'counsellor', label: 'Counsellor name' },
  { value: 'business.name', label: 'Business name' },
  { value: 'business.review_link', label: 'Review link' },
  { value: 'business.proof_link', label: 'Proof / results link' },
  { value: 'business.offer_end', label: 'Offer end date' },
  { value: 'business.address', label: 'Address' },
  { value: 'business.maps_link', label: 'Google Maps link' },
  { value: 'business.payment_details', label: 'Payment details' },
  { value: 'business.city', label: 'City' },
  { value: 'business.students_trained', label: 'Students trained' },
  { value: 'business.since_year', label: 'Since (year)' },
  { value: 'business.rating', label: 'Rating' },
];

export type CustomField = { key: string; label: string; type: string; options?: string[] };

/** The business's custom contact fields (Settings → Contact fields) */
export function useCustomFields(): CustomField[] {
  const { session } = useAuth();
  return (session?.tenant?.settings?.contactFields || []).map((f: any) => ({ ...f, type: f.type || 'text' }));
}

/** Dropdown of contact fields: built-in, custom, refer & earn, course (coaching), counsellor & business */
export function ContactFieldSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const custom = useCustomFields();
  const coaching = useIsCoaching();
  const options = [
    ...BUILTIN.map((o) => ({ ...o, hint: 'Built-in' })),
    ...custom.map((f) => ({ value: `custom.${f.key}`, label: f.label, hint: 'Custom field' })),
    ...REFERRAL.map((o) => ({ ...o, hint: 'Refer & earn' })),
    ...(coaching ? COURSE.map((o) => ({ ...o, hint: "Lead's course" })) : []),
    ...BUSINESS.map((o) => ({ ...o, hint: 'Counsellor & business' })),
  ];
  if (value && !options.some((o) => o.value === value)) {
    options.unshift({ value, label: value.startsWith('custom.') ? value.slice(7).replace(/_/g, ' ') : value, hint: 'Not in field list' });
  }
  return <Select value={value} onChange={onChange} options={options} title="Contact field" />;
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: C.chat, borderRadius: R.md, padding: S.md },
  bubble: { backgroundColor: '#fff', borderRadius: R.md, borderTopLeftRadius: 2, padding: S.md, maxWidth: 340, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 1, shadowOffset: { width: 0, height: 1 } },
  buttons: { marginTop: 8, marginHorizontal: -S.md, marginBottom: -S.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border },
  btn: { textAlign: 'center', fontSize: 14, fontWeight: '600', color: '#0284c7', paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
});

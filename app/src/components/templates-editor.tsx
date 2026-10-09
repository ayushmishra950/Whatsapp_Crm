import { Platform, View } from 'react-native';
import { fitVariableDefaults, type VariableDefault } from '@/lib/templates';
import { C, R, S } from '@/theme';
import { ContactFieldSelect, variableExample } from './templates-preview';
import { Button, Field, IconButton, Input, Row, Select, T } from './ui';

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

export type TplButton = { type: string; text: string; url?: string; phone?: string };

export const BUTTON_TYPES: [string, string][] = [['QUICK_REPLY', 'Quick reply'], ['URL', 'Link'], ['PHONE_NUMBER', 'Call']];

/** Same clean-up as the web before saving */
export const cleanButtons = (list: TplButton[] = []) =>
  list.map(({ type, text, url, phone }) => ({ type, text: (text || '').trim(), url: type === 'URL' ? (url || '').trim() : '', phone: type === 'PHONE_NUMBER' ? (phone || '').trim() : '' }));

const box = { borderWidth: 1, borderColor: C.border, borderRadius: R.md, padding: S.md, gap: S.sm, backgroundColor: '#fff' } as const;

/** Template buttons: quick replies, link and call buttons (WhatsApp: max 10, 2 links, 1 call) */
export function ButtonsEditor({ value, onChange, disabled }: { value: TplButton[]; onChange: (v: TplButton[]) => void; disabled?: boolean }) {
  const set = (i: number, patch: Partial<TplButton>) => onChange(value.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const links = value.filter((b) => b.type === 'URL').length;
  const calls = value.filter((b) => b.type === 'PHONE_NUMBER').length;
  return (
    <View style={box}>
      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <T v="label">Buttons (optional)</T>
          <T v="tiny" style={{ color: C.muted }}>Quick reply = the customer taps it instead of typing. Max 25 characters each. Max 10 buttons, 2 links, 1 call.</T>
        </View>
        <Button size="sm" variant="secondary" icon="add" title="Add" disabled={disabled || value.length >= 10} onPress={() => onChange([...value, { type: 'QUICK_REPLY', text: '', url: '', phone: '' }])} />
      </Row>
      {value.map((b, i) => (
        <View key={i} style={{ gap: 6, paddingTop: S.sm, borderTopWidth: 1, borderTopColor: C.soft }}>
          <Row>
            <View style={{ flex: 1 }}>
              <Select
                value={b.type}
                disabled={disabled}
                title="Button type"
                onChange={(type) => set(i, { type })}
                options={BUTTON_TYPES.filter(([v]) => v === b.type || (v === 'URL' ? links < 2 : v === 'PHONE_NUMBER' ? calls < 1 : true)).map(([v, l]) => ({ value: v, label: l }))}
              />
            </View>
            <IconButton name="trash-outline" color={C.red} label="Remove button" onPress={disabled ? undefined : () => onChange(value.filter((_, j) => j !== i))} />
          </Row>
          <Input maxLength={25} editable={!disabled} value={b.text} placeholder="e.g. Book free demo" onChangeText={(text) => set(i, { text })} />
          {b.type === 'URL' ? (
            <Input editable={!disabled} value={b.url || ''} placeholder="https://…" autoCapitalize="none" keyboardType="url" onChangeText={(url) => set(i, { url })} />
          ) : b.type === 'PHONE_NUMBER' ? (
            <Input editable={!disabled} value={b.phone || ''} placeholder="+919876543210" keyboardType="phone-pad" onChangeText={(phone) => set(i, { phone })} />
          ) : null}
        </View>
      ))}
    </View>
  );
}

/** What each {{n}} is filled with: a contact field or the same text for all, plus an example for WhatsApp review */
export function VariableDefaultsEditor({ value, body, onChange }: { value?: VariableDefault[]; body: string; onChange: (v: VariableDefault[]) => void }) {
  const rows = fitVariableDefaults(value, body);
  if (!rows.length) return null;
  const set = (i: number, patch: Partial<VariableDefault>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <View style={box}>
      <View>
        <T v="label">Variables</T>
        <T v="tiny" style={{ color: C.muted }}>
          What each {'{{n}}'} is filled with. Bulk campaigns and chats start with these values (you can still change them there). Saved only in this CRM, so changing them never needs WhatsApp approval.
        </T>
      </View>
      {rows.map((r, i) => (
        <View key={i} style={{ gap: 6, paddingTop: S.sm, borderTopWidth: 1, borderTopColor: C.soft }}>
          <T style={{ fontFamily: MONO, fontWeight: '600', color: C.text2 }}>{`{{${i + 1}}}`}</T>
          <Select
            value={r.source}
            title={`Fill {{${i + 1}}} with`}
            onChange={(v) => set(i, v === 'field' ? { source: 'field', value: 'name' } : { source: 'static', value: '' })}
            options={[{ value: 'field', label: 'Contact field' }, { value: 'static', label: 'Same text for all' }]}
          />
          {r.source === 'field' ? (
            <ContactFieldSelect value={r.value} onChange={(v) => set(i, { value: v })} />
          ) : (
            <Input maxLength={200} value={r.value} onChangeText={(v) => set(i, { value: v })} placeholder="e.g. 15 October (empty = fill in each campaign)" />
          )}
          <Field hint="Sample value shown to WhatsApp when the template is reviewed">
            <Input maxLength={200} value={r.example || ''} onChangeText={(v) => set(i, { example: v })} placeholder={`Example, e.g. ${variableExample({ ...r, example: '' }, i)}`} />
          </Field>
        </View>
      ))}
    </View>
  );
}

/** Campaign variables: per {{n}}, a contact field or fixed text (campaign only) */
export function CampaignVariablesEditor({ value, onChange }: { value: { source: 'field' | 'static'; value: string }[]; onChange: (v: { source: 'field' | 'static'; value: string }[]) => void }) {
  const set = (i: number, patch: Partial<{ source: 'field' | 'static'; value: string }>) => onChange(value.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <View style={{ gap: S.md }}>
      {value.map((v, i) => (
        <View key={i} style={{ gap: 6 }}>
          <T style={{ fontFamily: MONO, fontWeight: '600', color: C.text2 }}>{`{{${i + 1}}}`}</T>
          <Select
            value={v.source}
            title={`Fill {{${i + 1}}} with`}
            onChange={(s) => set(i, { source: s as 'field' | 'static', value: s === 'field' ? 'name' : '' })}
            options={[{ value: 'field', label: 'Contact field' }, { value: 'static', label: 'Same text for all' }]}
          />
          {v.source === 'field' ? (
            <ContactFieldSelect value={v.value} onChange={(x) => set(i, { value: x })} />
          ) : (
            <Input placeholder="Text" value={v.value} onChangeText={(x) => set(i, { value: x })} />
          )}
        </View>
      ))}
    </View>
  );
}

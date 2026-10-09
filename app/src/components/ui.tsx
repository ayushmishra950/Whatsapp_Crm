import Ionicons from '@expo/vector-icons/Ionicons';
import { useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLeadStatuses } from '@/lib/business';
import { initials } from '@/lib/format';
import { C, F, R, S, TONES } from '@/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];
export const Icon = ({ name, size = 18, color = C.text2, style }: { name: IconName; size?: number; color?: string; style?: StyleProp<TextStyle> }) => (
  <Ionicons name={name} size={size} color={color} style={style} />
);

// ---------- text ----------
type TVariant = 'title' | 'h2' | 'h3' | 'body' | 'small' | 'tiny' | 'label';
const tStyle: Record<TVariant, TextStyle> = {
  title: { fontSize: F.xxl, fontWeight: '700', color: C.text },
  h2: { fontSize: F.xl, fontWeight: '700', color: C.text },
  h3: { fontSize: F.lg, fontWeight: '600', color: C.text },
  body: { fontSize: F.md, color: C.text2 },
  small: { fontSize: F.sm, color: C.muted },
  tiny: { fontSize: F.xs, color: C.faint },
  label: { fontSize: F.sm, fontWeight: '600', color: C.text2 },
};
export function T({ v = 'body', style, children, numberOfLines, selectable }: { v?: TVariant; style?: StyleProp<TextStyle>; children?: ReactNode; numberOfLines?: number; selectable?: boolean }) {
  return (
    <Text style={[tStyle[v], style]} numberOfLines={numberOfLines} selectable={selectable}>
      {children}
    </Text>
  );
}

// ---------- layout ----------
/** Page body: scrolls, pull-to-refresh, grey background */
export function Screen({
  children,
  scroll = true,
  refreshing,
  onRefresh,
  padded = true,
  style,
  footer,
}: {
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  footer?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const pad = padded ? { padding: S.lg, paddingBottom: S.lg + (footer ? 0 : insets.bottom) } : null;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[pad, { gap: S.md }, style]}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={C.brand600} /> : undefined}>
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, pad, style]}>{children}</View>
      )}
      {footer && <View style={[styles.footer, { paddingBottom: insets.bottom + S.sm }]}>{footer}</View>}
    </View>
  );
}

export const Card = ({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) =>
  onPress ? (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }, style]}>
      {children}
    </Pressable>
  ) : (
    <View style={[styles.card, style]}>{children}</View>
  );

export const Row = ({ children, style, gap = S.sm, wrap }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number; wrap?: boolean }) => (
  <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, wrap && { flexWrap: 'wrap' }, style]}>{children}</View>
);

export const Divider = ({ style }: { style?: StyleProp<ViewStyle> }) => <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: C.border }, style]} />;

export const SectionTitle = ({ children, right, hint }: { children: ReactNode; right?: ReactNode; hint?: string }) => (
  <View style={{ marginTop: S.sm }}>
    <Row style={{ justifyContent: 'space-between' }}>
      <T v="h3">{children}</T>
      {right}
    </Row>
    {hint ? <T v="small" style={{ marginTop: 2 }}>{hint}</T> : null}
  </View>
);

// ---------- buttons ----------
type BVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft';
export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  loading,
  disabled,
  style,
  full,
}: {
  title?: string;
  onPress?: () => void;
  variant?: BVariant;
  size?: 'sm' | 'md';
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  full?: boolean;
}) {
  const v = {
    primary: { bg: C.brand600, fg: '#fff', border: C.brand600 },
    secondary: { bg: '#fff', fg: C.text2, border: C.borderStrong },
    ghost: { bg: 'transparent', fg: C.text2, border: 'transparent' },
    danger: { bg: C.red, fg: '#fff', border: C.red },
    soft: { bg: C.brand50, fg: C.brand700, border: C.brand100 },
  }[variant];
  const off = disabled || loading;
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        styles.btn,
        size === 'sm' && styles.btnSm,
        { backgroundColor: v.bg, borderColor: v.border },
        full && { alignSelf: 'stretch' },
        (off || pressed) && { opacity: off ? 0.5 : 0.8 },
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={title}>
      {loading ? <ActivityIndicator size="small" color={v.fg} /> : icon ? <Icon name={icon} size={size === 'sm' ? 15 : 17} color={v.fg} /> : null}
      {title ? <Text style={{ color: v.fg, fontWeight: '600', fontSize: size === 'sm' ? F.sm : F.md }}>{title}</Text> : null}
    </Pressable>
  );
}

export const IconButton = ({ name, onPress, color = C.text2, size = 22, badge, label }: { name: IconName; onPress?: () => void; color?: string; size?: number; badge?: number; label?: string }) => (
  <Pressable onPress={onPress} hitSlop={10} style={({ pressed }) => [{ padding: 4, opacity: pressed ? 0.6 : 1 }]} accessibilityLabel={label} accessibilityRole="button">
    <Ionicons name={name} size={size} color={color} />
    {badge ? (
      <View style={styles.dotBadge}>
        <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{badge > 99 ? '99+' : badge}</Text>
      </View>
    ) : null}
  </Pressable>
);

// ---------- inputs ----------
export function Field({ label, hint, error, children, style }: { label?: string; hint?: string; error?: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ gap: 6 }, style]}>
      {label ? <T v="label">{label}</T> : null}
      {children}
      {error ? <T v="small" style={{ color: C.red }}>{error}</T> : hint ? <T v="tiny" style={{ color: C.muted }}>{hint}</T> : null}
    </View>
  );
}

export function Input({ style, multiline, ...props }: TextInputProps & { style?: StyleProp<TextStyle> }) {
  const [focus, setFocus] = useState(false);
  return (
    <TextInput
      placeholderTextColor={C.faint}
      {...props}
      multiline={multiline}
      onFocus={(e) => {
        setFocus(true);
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocus(false);
        props.onBlur?.(e);
      }}
      style={[styles.input, multiline && { minHeight: 90, textAlignVertical: 'top', paddingTop: 10 }, focus && { borderColor: C.brand500 }, props.editable === false && { backgroundColor: C.soft, color: C.muted }, style]}
    />
  );
}

export function PasswordInput(props: TextInputProps) {
  const [show, setShow] = useState(false);
  return (
    <View>
      <Input {...props} secureTextEntry={!show} autoCapitalize="none" autoCorrect={false} style={{ paddingRight: 44 }} />
      <Pressable onPress={() => setShow((s) => !s)} style={{ position: 'absolute', right: 10, top: 10 }} hitSlop={8} accessibilityLabel={show ? 'Hide password' : 'Show password'}>
        <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={20} color={C.muted} />
      </Pressable>
    </View>
  );
}

export function Toggle({ value, onChange, label, description, disabled }: { value: boolean; onChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  return (
    <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }} gap={S.md}>
      <View style={{ flex: 1 }}>
        <T style={{ fontWeight: '600', color: C.text }}>{label}</T>
        {description ? <T v="small" style={{ marginTop: 2 }}>{description}</T> : null}
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: C.brand500, false: C.borderStrong }} />
    </Row>
  );
}

// ---------- chips / badges ----------
export const Badge = ({ children, tone = 'gray', style }: { children: ReactNode; tone?: string; style?: StyleProp<ViewStyle> }) => {
  const t = TONES[tone] || TONES.gray;
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }, style]}>
      <Text style={{ color: t.fg, fontSize: F.xs, fontWeight: '600' }} numberOfLines={1}>
        {children}
      </Text>
    </View>
  );
};

export function StatusBadge({ status }: { status?: string }) {
  const { label, color } = useLeadStatuses();
  if (!status) return null;
  return <Badge tone={color(status)}>{label(status)}</Badge>;
}

export const Chip = ({ label, active, onPress, count, style }: { label: string; active?: boolean; onPress?: () => void; count?: number; style?: StyleProp<ViewStyle> }) => (
  <Pressable onPress={onPress} style={[styles.chip, active && styles.chipOn, style]}>
    <Text style={{ color: active ? '#fff' : C.text2, fontSize: F.sm, fontWeight: active ? '600' : '400' }}>
      {label}
      {count !== undefined ? <Text style={{ fontWeight: '700' }}>{`  ${count}`}</Text> : null}
    </Text>
  </Pressable>
);

/** Horizontal row of chips (filters / tabs) */
export function ChipBar<V extends string>({ options, value, onChange, counts }: { options: [V, string][]; value: V; onChange: (v: V) => void; counts?: Partial<Record<V, number>> }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: S.sm, paddingRight: S.lg }}>
      {options.map(([v, l]) => (
        <Chip key={v} label={l} active={v === value} onPress={() => onChange(v)} count={counts?.[v]} />
      ))}
    </ScrollView>
  );
}

export const Avatar = ({ name, size = 40, color = C.brand100, textColor = C.brand800 }: { name?: string; size?: number; color?: string; textColor?: string }) => (
  <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
    <Text style={{ color: textColor, fontWeight: '700', fontSize: size * 0.38 }}>{initials(name || '')}</Text>
  </View>
);

/** Small coloured number on a tab / button */
export const CountBadge = ({ n, tone = 'red' }: { n?: number; tone?: 'red' | 'green' | 'amber' }) =>
  n ? (
    <View style={[styles.count, { backgroundColor: tone === 'green' ? C.brand600 : tone === 'amber' ? '#f59e0b' : C.red }]}>
      <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{n > 99 ? '99+' : n}</Text>
    </View>
  ) : null;

// ---------- states ----------
export const Loader = () => (
  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, padding: S.xl }}>
    <ActivityIndicator color={C.brand600} />
  </View>
);

export const EmptyState = ({ icon = 'file-tray-outline', title, text, action }: { icon?: IconName; title: string; text?: string; action?: ReactNode }) => (
  <View style={{ alignItems: 'center', paddingVertical: 40, paddingHorizontal: S.xl, gap: S.sm }}>
    <Ionicons name={icon} size={36} color={C.faint} />
    <T v="h3" style={{ textAlign: 'center' }}>{title}</T>
    {text ? <T v="small" style={{ textAlign: 'center' }}>{text}</T> : null}
    {action}
  </View>
);

/** Label + value line used on detail screens */
export const InfoLine = ({ label, value, tone }: { label: string; value?: ReactNode; tone?: string }) => (
  <Row style={{ justifyContent: 'space-between', paddingVertical: 6 }} gap={S.md}>
    <T v="small">{label}</T>
    {typeof value === 'string' || typeof value === 'number' || value === undefined ? (
      <T style={{ color: tone || C.text, fontWeight: '500', flexShrink: 1, textAlign: 'right' }}>{value ?? '—'}</T>
    ) : (
      value
    )}
  </Row>
);

/** Tappable list row: icon, title, subtitle, right side */
export function ListRow({ icon, title, subtitle, right, onPress, danger }: { icon?: IconName; title: string; subtitle?: string; right?: ReactNode; onPress?: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.listRow, pressed && onPress && { backgroundColor: C.soft }]}>
      {icon ? (
        <View style={[styles.listIcon, danger && { backgroundColor: C.red50 }]}>
          <Ionicons name={icon} size={18} color={danger ? C.red : C.brand700} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <T style={{ color: danger ? C.red : C.text, fontWeight: '500' }}>{title}</T>
        {subtitle ? <T v="small" numberOfLines={2}>{subtitle}</T> : null}
      </View>
      {right}
      {onPress ? <Ionicons name="chevron-forward" size={18} color={C.faint} /> : null}
    </Pressable>
  );
}

// ---------- sheets ----------
/** Bottom sheet (modal) with a title, scrollable body and an optional footer */
export function Sheet({ open, onClose, title, children, footer, full }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; footer?: ReactNode; full?: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, full && { height: '92%' }, { paddingBottom: insets.bottom + S.sm }]}>
          <View style={styles.grab} />
          {title ? (
            <Row style={{ justifyContent: 'space-between', paddingHorizontal: S.lg, paddingBottom: S.sm }}>
              <T v="h3" style={{ flex: 1 }} numberOfLines={2}>{title}</T>
              <IconButton name="close" onPress={onClose} label="Close" />
            </Row>
          ) : null}
          <ScrollView style={full ? { flex: 1 } : { maxHeight: 560 }} contentContainerStyle={{ padding: S.lg, paddingTop: S.xs, gap: S.md }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer ? <View style={{ flexDirection: 'row', gap: S.sm, paddingHorizontal: S.lg, paddingTop: S.sm, justifyContent: 'flex-end' }}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export type Option = { value: string; label: string; hint?: string };
/** Looks like an input; opens a list to pick from (searchable when long) */
export function Select({ value, options, onChange, placeholder = 'Choose…', title, disabled }: { value: string; options: Option[]; onChange: (v: string) => void; placeholder?: string; title?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const current = options.find((o) => o.value === value);
  const term = q.trim().toLowerCase();
  const shown = term ? options.filter((o) => `${o.label} ${o.hint || ''}`.toLowerCase().includes(term)) : options;
  return (
    <>
      <Pressable onPress={() => !disabled && setOpen(true)} style={[styles.input, styles.select, disabled && { backgroundColor: C.soft }]}>
        <Text style={{ flex: 1, color: current ? C.text : C.faint, fontSize: F.md }} numberOfLines={1}>
          {current?.label || placeholder}
        </Text>
        <Ionicons name="chevron-down" size={16} color={C.muted} />
      </Pressable>
      <Sheet open={open} onClose={() => { setOpen(false); setQ(''); }} title={title || placeholder}>
        {options.length > 8 && <Input placeholder="Search…" value={q} onChangeText={setQ} autoCorrect={false} />}
        {shown.map((o) => (
          <Pressable key={o.value || '_'} onPress={() => { onChange(o.value); setOpen(false); setQ(''); }} style={({ pressed }) => [styles.option, o.value === value && { backgroundColor: C.brand50 }, pressed && { opacity: 0.7 }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: F.md, color: C.text, fontWeight: o.value === value ? '600' : '400' }}>{o.label}</Text>
              {o.hint ? <T v="small">{o.hint}</T> : null}
            </View>
            {o.value === value ? <Ionicons name="checkmark" size={18} color={C.brand600} /> : null}
          </Pressable>
        ))}
        {!shown.length && <T v="small">Nothing matches “{q}”.</T>}
      </Sheet>
    </>
  );
}

/** "Are you sure?" — resolves true on confirm */
export function confirm(title: string, message?: string, { ok = 'OK', danger = false }: { ok?: string; danger?: boolean } = {}) {
  // Web preview: React Native's Alert does nothing there
  if (Platform.OS === 'web') return Promise.resolve(typeof window !== 'undefined' && window.confirm([title, message].filter(Boolean).join('\n\n')));
  return new Promise<boolean>((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: ok, style: danger ? 'destructive' : 'default', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

/** Big number tile (dashboard, fees) */
export const Stat = ({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: string; tone?: string }) => (
  <View style={[styles.card, { flex: 1, minWidth: 140, padding: S.md, alignSelf: 'stretch' }]}>
    <T v="tiny" style={{ textTransform: 'uppercase', fontWeight: '600', color: C.faint }}>{label}</T>
    <T style={{ fontSize: F.xl, fontWeight: '700', color: tone || C.text, marginTop: 2 }}>{value}</T>
    {sub ? <T v="small" numberOfLines={2}>{sub}</T> : null}
  </View>
);

const styles = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: R.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, padding: S.lg },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border, backgroundColor: '#fff', paddingHorizontal: S.lg, paddingTop: S.sm, flexDirection: 'row', gap: S.sm },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 16, height: 44 },
  btnSm: { height: 34, paddingHorizontal: 12, borderRadius: R.sm },
  input: { borderWidth: 1, borderColor: C.borderStrong, borderRadius: R.md, backgroundColor: '#fff', paddingHorizontal: 12, minHeight: 44, fontSize: F.md, color: C.text },
  select: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: { borderRadius: R.full, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' },
  chip: { borderWidth: 1, borderColor: C.border, backgroundColor: '#fff', borderRadius: R.full, paddingHorizontal: 12, paddingVertical: 6 },
  chipOn: { backgroundColor: C.text, borderColor: C.text },
  dotBadge: { position: 'absolute', top: -2, right: -6, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  count: { minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: S.md, paddingHorizontal: S.lg, backgroundColor: '#fff' },
  listIcon: { width: 34, height: 34, borderRadius: 9, backgroundColor: C.brand50, alignItems: 'center', justifyContent: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.4)' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: S.sm, maxHeight: '92%' },
  grab: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: C.border, marginBottom: S.sm },
  option: { flexDirection: 'row', alignItems: 'center', gap: S.sm, paddingVertical: 12, paddingHorizontal: S.md, borderRadius: R.md },
});

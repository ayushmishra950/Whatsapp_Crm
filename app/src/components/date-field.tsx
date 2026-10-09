import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { C, F, R } from '@/theme';
import { Button, Sheet } from './ui';

/**
 * Date (or date + time) picker that looks like an input.
 * value / onChange use Date | null; "Clear" is offered when `clearable`.
 */
export function DateField({
  value,
  onChange,
  mode = 'datetime',
  placeholder = 'Pick a date',
  clearable,
  minimumDate,
}: {
  value: Date | null;
  onChange: (d: Date | null) => void;
  mode?: 'date' | 'datetime';
  placeholder?: string;
  clearable?: boolean;
  minimumDate?: Date;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Date>(value || new Date());
  const label = value ? (mode === 'date' ? fmtDate(value) : fmtDateTime(value)) : '';

  const openPicker = () => {
    const start = value || new Date();
    if (Platform.OS === 'android') {
      // Android: date dialog, then time dialog
      DateTimePickerAndroid.open({
        value: start,
        mode: 'date',
        minimumDate,
        onValueChange: (_e, d) => {
          if (mode === 'date') return onChange(d);
          DateTimePickerAndroid.open({
            value: d,
            mode: 'time',
            onValueChange: (_e2, t) => {
              const out = new Date(d);
              out.setHours(t.getHours(), t.getMinutes(), 0, 0);
              onChange(out);
            },
          });
        },
      });
      return;
    }
    setDraft(start);
    setOpen(true);
  };

  return (
    <View>
      <Pressable onPress={openPicker} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: C.borderStrong, borderRadius: R.md, minHeight: 44, paddingHorizontal: 12, backgroundColor: '#fff' }}>
        <Ionicons name="calendar-outline" size={18} color={C.muted} />
        <Text style={{ flex: 1, fontSize: F.md, color: label ? C.text : C.faint }}>{label || placeholder}</Text>
        {clearable && value ? (
          <Pressable onPress={() => onChange(null)} hitSlop={8} accessibilityLabel="Clear date">
            <Ionicons name="close-circle" size={18} color={C.faint} />
          </Pressable>
        ) : null}
      </Pressable>
      {Platform.OS === 'ios' && (
        <Sheet
          open={open}
          onClose={() => setOpen(false)}
          title={mode === 'date' ? 'Pick a date' : 'Pick date & time'}
          footer={
            <>
              <Button title="Cancel" variant="secondary" onPress={() => setOpen(false)} />
              <Button title="Done" onPress={() => { onChange(draft); setOpen(false); }} />
            </>
          }>
          <DateTimePicker value={draft} mode={mode} display="inline" minimumDate={minimumDate} accentColor={C.brand600} themeVariant="light" onValueChange={(_e, d) => setDraft(d)} />
        </Sheet>
      )}
    </View>
  );
}

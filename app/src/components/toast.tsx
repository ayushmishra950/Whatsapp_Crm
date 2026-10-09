import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { errorText } from '@/lib/api';
import { C, F, R, S } from '@/theme';

type Kind = 'success' | 'error' | 'info';
type Item = { id: number; kind: Kind; text: string };
type ToastApi = { success: (t: string) => void; error: (e: unknown) => void; info: (t: string) => void };

const Ctx = createContext<ToastApi | null>(null);

/** Small messages at the top of the screen (like the web's toasts) */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const seq = useRef(0);
  const insets = useSafeAreaInsets();
  const push = useCallback((kind: Kind, text: string) => {
    const id = ++seq.current;
    setItems((l) => [...l.slice(-2), { id, kind, text }]);
    setTimeout(() => setItems((l) => l.filter((x) => x.id !== id)), kind === 'error' ? 5000 : 3200);
  }, []);
  const api = useMemo<ToastApi>(
    () => ({ success: (t) => push('success', t), error: (e) => push('error', errorText(e)), info: (t) => push('info', t) }),
    [push]
  );
  return (
    <Ctx.Provider value={api}>
      {children}
      <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 8 }]}>
        {items.map((t) => (
          <Pressable key={t.id} onPress={() => setItems((l) => l.filter((x) => x.id !== t.id))} style={[styles.toast, t.kind === 'error' ? styles.err : t.kind === 'success' ? styles.ok : styles.info]}>
            <Text style={styles.text}>{t.kind === 'success' ? '✓ ' : t.kind === 'error' ? '⚠ ' : ''}{t.text}</Text>
          </Pressable>
        ))}
      </View>
    </Ctx.Provider>
  );
}

export function useToast() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useToast outside ToastProvider');
  return v;
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: S.md, right: S.md, gap: S.sm, zIndex: 1000 },
  toast: { borderRadius: R.md, paddingHorizontal: S.lg, paddingVertical: S.md, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  ok: { backgroundColor: C.brand700 },
  err: { backgroundColor: C.red },
  info: { backgroundColor: C.text },
  text: { color: '#fff', fontSize: F.sm, fontWeight: '500' },
});

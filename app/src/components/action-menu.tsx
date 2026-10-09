import { useEffect, useState } from 'react';
import { ActionSheetIOS, Platform, Pressable, Text } from 'react-native';
import { C, F, R, S } from '@/theme';
import { Sheet } from './ui';

type Item = { key: string; label: string; danger?: boolean };
type Menu = { title: string; items: Item[]; onPick: (key: string) => void };
let show: ((m: Menu) => void) | null = null;

/**
 * Menu of actions (long-press on a message, "⋯" buttons…).
 * iPhone: the native action sheet. Android / web: our bottom sheet (Android alerts show only 3 buttons).
 */
export function showActionMenu(title: string, items: Item[], onPick: (key: string) => void) {
  if (!items.length) return;
  if (Platform.OS === 'ios') {
    const labels = [...items.map((i) => i.label), 'Cancel'];
    const destructive = items.map((i, idx) => (i.danger ? idx : -1)).filter((i) => i >= 0);
    ActionSheetIOS.showActionSheetWithOptions({ title, options: labels, cancelButtonIndex: labels.length - 1, destructiveButtonIndex: destructive }, (i) => {
      if (i < items.length) onPick(items[i].key);
    });
    return;
  }
  show?.({ title, items, onPick });
}

/** Mounted once at the root: renders the menu on Android / web */
export function ActionMenuHost() {
  const [menu, setMenu] = useState<Menu | null>(null);
  useEffect(() => {
    show = setMenu;
    return () => {
      show = null;
    };
  }, []);
  if (!menu) return null;
  return (
    <Sheet open onClose={() => setMenu(null)} title={menu.title}>
      {menu.items.map((i) => (
        <Pressable
          key={i.key}
          onPress={() => {
            setMenu(null);
            setTimeout(() => menu.onPick(i.key), 50);
          }}
          style={({ pressed }) => ({ paddingVertical: 14, paddingHorizontal: S.md, borderRadius: R.md, backgroundColor: pressed ? C.soft : 'transparent' })}>
          <Text style={{ fontSize: F.md, color: i.danger ? C.red : C.text }}>{i.label}</Text>
        </Pressable>
      ))}
    </Sheet>
  );
}

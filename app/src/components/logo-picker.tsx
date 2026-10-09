import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { View } from 'react-native';
import { api } from '@/lib/api';
import { S } from '@/theme';
import { BusinessLogo } from './business-switcher';
import { useToast } from './toast';
import { Button, Row, T, confirm } from './ui';

/** Pick a photo, shrink it to 256 px and return it as a PNG data URL (same as the web upload) */
export async function pickLogo(): Promise<string | null> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 });
  if (r.canceled || !r.assets?.[0]) return null;
  const a = r.assets[0];
  const big = Math.max(a.width || 0, a.height || 0);
  const ctx = ImageManipulator.manipulate(a.uri);
  if (big > 256) ctx.resize((a.width || 0) >= (a.height || 0) ? { width: 256 } : { height: 256 });
  const img = await ctx.renderAsync();
  const out = await img.saveAsync({ base64: true, format: SaveFormat.PNG });
  if (!out.base64) return null;
  return `data:image/png;base64,${out.base64}`;
}

/**
 * Logo of a business: preview + upload / remove.
 * `path` = '/settings/logo' (own business) or '/superadmin/tenants/<id>/logo' (Super Admin).
 */
export function LogoPicker({ name, logo, path, onSaved }: { name: string; logo?: string; path: string; onSaved: (logo: string) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const save = async (value: string) => {
    setBusy(true);
    try {
      const r = await api<{ logo: string }>(path, { method: 'PUT', body: { logo: value } });
      onSaved(r.logo);
      toast.success(value ? 'Logo saved' : 'Logo removed');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const upload = async () => {
    try {
      const value = await pickLogo();
      if (value) await save(value);
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <Row gap={S.md}>
      <BusinessLogo name={name} logo={logo} size={56} />
      <View style={{ flex: 1, gap: 6 }}>
        <T v="small">Shown in the app header and sidebar. Square PNG / JPG works best.</T>
        <Row gap={6}>
          <Button size="sm" icon="image-outline" title={logo ? 'Change logo' : 'Upload logo'} loading={busy} onPress={upload} />
          {logo ? <Button size="sm" variant="ghost" title="Remove" onPress={async () => (await confirm('Remove the logo?', undefined, { ok: 'Remove', danger: true })) && save('')} /> : null}
        </Row>
      </View>
    </Row>
  );
}

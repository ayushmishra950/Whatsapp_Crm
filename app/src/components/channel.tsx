import { Text, View } from 'react-native';

/** "whatsapp" | "instagram" for a chat (chats made before Instagram have no value = WhatsApp) */
export const channelOf = (conversation: any) => (conversation?.channel === 'instagram' ? 'instagram' : 'whatsapp');

const LOOK = {
  whatsapp: { label: 'WhatsApp', short: 'WA', bg: '#ecfdf5', fg: '#047857', border: '#a7f3d0' },
  instagram: { label: 'Instagram', short: 'IG', bg: '#fdf2f8', fg: '#be185d', border: '#fbcfe8' },
  facebook: { label: 'Facebook', short: 'FB', bg: '#eff6ff', fg: '#1d4ed8', border: '#bfdbfe' },
};

/** Small pill that says which app the chat is on */
export function ChannelBadge({ channel = 'whatsapp', full }: { channel?: string; full?: boolean }) {
  const l = LOOK[channel === 'instagram' || channel === 'facebook' ? channel : 'whatsapp'];
  return (
    <View style={{ backgroundColor: l.bg, borderColor: l.border, borderWidth: 1, borderRadius: 4, paddingHorizontal: 4, alignSelf: 'center' }}>
      <Text style={{ color: l.fg, fontSize: 10, fontWeight: '700' }}>{full ? l.label : l.short}</Text>
    </View>
  );
}

/** Customer's Instagram profile link */
export const instagramUrl = (c: any) => (c?.instagram?.username ? `https://instagram.com/${c.instagram.username}` : '');

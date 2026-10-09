import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { C, F, R, S } from '@/theme';
import type { MenuOption } from './chatbot-menu';
import { Card, Icon, Row, T } from './ui';

/** The bot fields the preview reads (same names as GET /chatbot → bot) */
export type PreviewBot = {
  welcomeText: string;
  menuButtonLabel: string;
  showNumberedOptions?: boolean;
  menuHintText?: string;
  afterReplyStyle?: 'button' | 'full';
  mainMenuButtonLabel?: string;
  afterReplyHint?: string;
  menuAfterReplyText?: string;
  menu: MenuOption[];
};

const MAX_OPTIONS = 10;
const NUMBER_EMOJI = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
export const DEFAULT_MENU_HINT = '👉 Neeche *{button}* dabaiye, ya option ka number likhiye (jaise *2*)';

/** How-to-choose line as the server sends it (same as menuBody in server/src/services/chatbot.js) */
const hintText = (bot: PreviewBot, asButtons: boolean) => {
  const raw = bot.menuHintText?.trim() || DEFAULT_MENU_HINT;
  return asButtons ? raw.split('*{button}*').join('diye button').split('{button}').join('diye button') : raw.split('{button}').join(bot.menuButtonLabel || 'View options');
};

/** WhatsApp *bold* → bold text */
function Wa({ text, style }: { text: string; style?: object }) {
  const parts = String(text || '').split(/(\*[^*\n]+\*)/g);
  return (
    <Text style={[styles.msg, style]}>
      {parts.map((p, i) => (/^\*[^*\n]+\*$/.test(p) ? <Text key={i} style={{ fontWeight: '700' }}>{p.slice(1, -1)}</Text> : p))}
    </Text>
  );
}

const Bubble = ({ children }: { children: ReactNode }) => <View style={[styles.bubble, { borderTopLeftRadius: 0 }]}>{children}</View>;
const WaButton = ({ label, icon }: { label: string; icon?: boolean }) => (
  <View style={styles.waButton}>
    {icon ? <Icon name="list" size={16} color={C.blue} /> : null}
    <Text style={styles.waButtonText} numberOfLines={1}>{label}</Text>
  </View>
);
const Title = ({ step, title, sub }: { step: number; title: string; sub?: string }) => (
  <Row gap={6} wrap>
    <View style={styles.stepTag}><Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>Message {step}</Text></View>
    <T v="small" style={{ color: C.text2, fontWeight: '600' }}>{title}</T>
    {sub ? <T v="tiny" style={{ color: C.muted, flexShrink: 1 }}>{sub}</T> : null}
  </Row>
);

function MenuPreview({ bot }: { bot: PreviewBot }) {
  const options = bot.menu.slice(0, MAX_OPTIONS);
  const asButtons = options.length > 0 && options.length <= 3 && options.every((o) => o.title.length <= 20);
  const numbered = bot.showNumberedOptions !== false && options.length > 0;
  return (
    <View style={styles.chat}>
      <Title step={1} title="Welcome" sub="(first message to a new customer)" />
      <View style={styles.col}>
        <Bubble>
          <Wa text={bot.welcomeText || 'Welcome message…'} />
          {numbered ? <Text style={styles.msg}>{options.map((o, i) => `${NUMBER_EMOJI[i]} ${o.title || 'Option'}`).join('\n')}</Text> : null}
          {numbered ? <Wa text={hintText(bot, asButtons)} /> : null}
          {!asButtons && options.length ? (
            <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border, paddingTop: S.sm, marginTop: 2 }}>
              <Row style={{ justifyContent: 'center' }} gap={6}>
                <Icon name="list" size={16} color={C.blue} />
                <Text style={styles.waButtonText}>{bot.menuButtonLabel || 'View options'}</Text>
              </Row>
            </View>
          ) : null}
        </Bubble>
        {asButtons ? options.map((o, i) => <WaButton key={o._id || i} label={o.title || 'Option'} />) : null}
        {!asButtons && options.length ? (
          <View style={[styles.bubble, { marginTop: S.xs, gap: 0 }]}>
            <T v="tiny" style={{ paddingBottom: 4 }}>List that opens from “{bot.menuButtonLabel || 'View options'}”</T>
            {options.map((o, i) => (
              <View key={o._id || i} style={[{ paddingVertical: 6 }, i < options.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border }]}>
                <Text style={styles.msg}>{o.title || 'Option'}</Text>
                {o.description ? <T v="tiny" style={{ color: C.muted }}>{o.description}</T> : null}
              </View>
            ))}
          </View>
        ) : null}
      </View>
      <T v="tiny" style={{ color: C.muted }}>
        {options.length ? (asButtons ? 'Shown as reply buttons (max 3 options, titles up to 20 characters).' : 'Shown as a list (up to 10 options).') : 'No menu options: only the welcome message is sent.'}
        {options.length ? ' Customers can also type the option number (e.g. “2”) or part of its name (e.g. “admission”).' : ''}
      </T>
    </View>
  );
}

/** What the customer sees after the bot answers an option (first reply option as the sample) */
function AfterAnswerPreview({ bot }: { bot: PreviewBot }) {
  if (!bot.menu.length) return null;
  const sample = bot.menu.find((o) => o.action === 'reply' && o.replyText) || bot.menu[0];
  const full = bot.afterReplyStyle === 'full';
  return (
    <View style={styles.chat}>
      <Title step={2} title="After an answer" sub={`(e.g. customer chose “${sample.title || 'Option'}”)`} />
      <View style={styles.col}>
        <Bubble>
          <Wa text={sample.replyText || 'Answer…'} />
          {!full && bot.afterReplyHint?.trim() ? <Wa text={bot.afterReplyHint} /> : null}
        </Bubble>
        {full ? (
          <View style={[styles.bubble, { marginTop: S.xs }]}>
            <Wa text={bot.menuAfterReplyText || 'Aur kisi cheez me madad chahiye? 👇'} />
            <T v="tiny">+ the full menu again</T>
          </View>
        ) : (
          <WaButton label={bot.mainMenuButtonLabel || '📋 Main Menu'} />
        )}
      </View>
    </View>
  );
}

/** Collapsible “how it looks on WhatsApp” card for the chatbot screen (same rules as the web preview) */
export function ChatbotPreview({ bot }: { bot: PreviewBot }) {
  const [open, setOpen] = useState(false);
  return (
    <Card style={{ gap: S.md }}>
      <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityLabel={open ? 'Hide preview' : 'Show preview'} hitSlop={6}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row gap={S.sm} style={{ flex: 1 }}>
            <Icon name="phone-portrait-outline" color={C.brand700} />
            <View style={{ flex: 1 }}>
              <T v="h3">Preview</T>
              <T v="tiny">What the customer sees on WhatsApp (unsaved changes included)</T>
            </View>
          </Row>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} color={C.muted} />
        </Row>
      </Pressable>
      {open ? (
        <>
          <MenuPreview bot={bot} />
          <AfterAnswerPreview bot={bot} />
        </>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  chat: { backgroundColor: C.chat, borderRadius: R.md, padding: S.md, gap: S.sm },
  col: { maxWidth: 300, gap: S.xs },
  bubble: { backgroundColor: '#fff', borderRadius: R.md, paddingHorizontal: S.md, paddingVertical: S.sm, gap: S.sm, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  msg: { fontSize: F.sm, color: C.text, lineHeight: 19 },
  waButton: { flexDirection: 'row', gap: 6, backgroundColor: '#fff', borderRadius: R.md, paddingVertical: S.sm, alignItems: 'center', justifyContent: 'center', elevation: 1 },
  waButtonText: { color: C.blue, fontSize: F.sm, fontWeight: '600' },
  stepTag: { backgroundColor: C.text2, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 },
});

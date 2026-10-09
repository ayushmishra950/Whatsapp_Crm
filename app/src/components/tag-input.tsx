import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { api } from '@/lib/api';
import { S } from '@/theme';
import { Chip, Input, Row, T } from './ui';

let tagCache: { at: number; tags: string[] } | null = null;
/** Tags already used in this business (cached for a minute, shared by every tag box) */
function useKnownTags() {
  const [tags, setTags] = useState<string[]>(tagCache?.tags || []);
  useEffect(() => {
    if (tagCache && Date.now() - tagCache.at < 60_000) return;
    api<string[]>('/contacts/tags')
      .then((t) => {
        tagCache = { at: Date.now(), tags: t };
        setTags(t);
      })
      .catch(() => {});
  }, []);
  return tags;
}

const clean = (t: string) => t.trim().toLowerCase().replace(/,+$/, '');

/** Tags as chips (tap ✕ to remove) + a box that suggests tags already in use, like the web's TagInput */
export function TagInput({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  const known = useKnownTags();
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const t = clean(raw);
    setText('');
    if (t && !value.includes(t)) onChange([...value, t]);
  };
  const q = clean(text);
  const suggestions = known.filter((t) => !value.includes(t) && (!q || t.includes(q))).slice(0, 8);
  return (
    <View style={{ gap: S.sm }}>
      {value.length ? (
        <Row wrap gap={6}>
          {value.map((t) => <Chip key={t} active label={`${t}  ✕`} onPress={() => onChange(value.filter((x) => x !== t))} />)}
        </Row>
      ) : null}
      <Input
        value={text}
        onChangeText={(v) => (v.endsWith(',') ? add(v) : setText(v))}
        onSubmitEditing={() => add(text)}
        placeholder={value.length ? 'Add another tag…' : 'Type a tag, e.g. walkin'}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="done"
        submitBehavior="submit"
      />
      {suggestions.length ? (
        <Row wrap gap={6}>
          {q && !known.includes(q) && !value.includes(q) ? <Chip label={`+ "${q}" (new)`} onPress={() => add(q)} /> : null}
          {suggestions.map((t) => <Chip key={t} label={`+ ${t}`} onPress={() => add(t)} />)}
        </Row>
      ) : q && !value.includes(q) ? (
        <Row><Chip label={`+ "${q}" (new tag)`} onPress={() => add(q)} /></Row>
      ) : null}
      {!value.length && !known.length ? <T v="tiny">Press Done (or type a comma) to add the tag.</T> : null}
    </View>
  );
}

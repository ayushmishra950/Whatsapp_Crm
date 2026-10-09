import { router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { api } from '@/lib/api';
import { downloadAndShare } from '@/lib/files';
import { appendFile } from '@/lib/upload';
import { C, F, R, S } from '@/theme';
import { StatusSelect } from './leads';
import { useToast } from './toast';
import { Button, Chip, Field, Input, Row, Select, Sheet, Stat, T, Toggle } from './ui';

const FIELDS: { key: string; label: string; required?: boolean; hint?: string }[] = [
  { key: 'phone', label: 'Phone / WhatsApp number', required: true },
  { key: 'name', label: 'Name', required: true },
  { key: 'email', label: 'Email' },
  { key: 'tags', label: 'Tags', hint: 'separate with , | or ;' },
  { key: 'leadStatus', label: 'Lead status', hint: 'e.g. Interested, Converted' },
  { key: 'course', label: 'Course', hint: 'course name or code' },
  { key: 'counsellor', label: 'Counsellor', hint: "team member's name or email" },
  { key: 'followUp', label: 'Follow-up date', hint: 'e.g. 15/10/2026 5 pm' },
  { key: 'notes', label: 'Notes / query' },
  { key: 'enquiryDate', label: 'Enquiry date', hint: 'when the lead came' },
];
type Picked = { uri: string; name: string; mimeType?: string; file?: File };

// The picked sheet as multipart form data 
function sheetForm(p: Picked, extra?: Record<string, string>) {
  const form = new FormData();
  appendFile(form, 'file', p);
  for (const [k, v] of Object.entries(extra || {})) form.append(k, v);
  return form;
}

/**
 * Old enquiries / students from an Excel (.xlsx) or CSV sheet: choose file → match columns → done.
 * Only Phone and Name are needed; empty cells never overwrite saved details.
 */
export function ImportSheet({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<Picked | null>(null);
  const [preview, setPreview] = useState<{ headers: string[]; sample: any[]; totalRows: number; mapping: Record<string, string> } | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<string[]>([]);
  const [country, setCountry] = useState('91');
  const [status, setStatus] = useState('');
  const [startDrips, setStartDrips] = useState(false);
  const [batchTag, setBatchTag] = useState(true);
  const [addTags, setAddTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setMapping({});
    setCustom([]);
    setResult(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const choose = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv', 'text/comma-separated-values', 'application/vnd.ms-excel'], copyToCacheDirectory: true });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    const p: Picked = { uri: a.uri, name: a.name, mimeType: a.mimeType, file: a.file };
    setBusy(true);
    try {
      const pv = await api('/contacts/import/preview', { method: 'POST', form: sheetForm(p) });
      setFile(p);
      setPreview(pv);
      setMapping(pv.mapping || {});
      const mapped = new Set(Object.values(pv.mapping || {}));
      setCustom(pv.headers.filter((h: string) => !mapped.has(h)));
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!file || !preview) return;
    setBusy(true);
    try {
      const cleanMap = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v));
      const options = { mapping: cleanMap, customColumns: custom.filter((h) => !Object.values(cleanMap).includes(h)), defaultCountryCode: country, setLeadStatus: status || undefined, startDrips, batchTag, addTags: addTags.split(',').map((t) => t.trim()).filter(Boolean) };
      const r = await api('/contacts/import', { method: 'POST', form: sheetForm(file, { options: JSON.stringify(options) }) });
      setResult(r);
      onImported();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const used = new Set(Object.values(mapping).filter(Boolean));
  const others = preview?.headers.filter((h) => !used.has(h)) || [];

  return (
    <Sheet open={open} onClose={close} title="Import leads from a sheet" full
      footer={result ? <Button title="Done" onPress={close} /> : preview ? <><Button title="Other file" variant="secondary" onPress={reset} /><Button title={`Import ${preview.totalRows} rows`} icon="cloud-upload-outline" loading={busy} disabled={!mapping.phone || !mapping.name} onPress={run} /></> : <Button title="Cancel" variant="secondary" onPress={close} />}>
      {result ? (
        <>
          <Row wrap gap={S.sm}>
            <Stat label="New contacts" value={result.created} tone={C.brand700} />
            <Stat label="Updated" value={result.updated} tone={C.blue} />
            <Stat label="Invalid numbers" value={result.invalid} tone={result.invalid ? C.amber : C.faint} />
            <Stat label="Duplicates merged" value={result.duplicatesInSheet} />
          </Row>
          {result.noName > 0 ? <T v="small">{result.noName} row(s) had no name: saved with the number only. The chatbot asks the name when they write.</T> : null}
          {result.unmatched?.course?.length || result.unmatched?.counsellor?.length ? (
            <View style={{ backgroundColor: C.amber50, borderRadius: R.md, padding: S.md }}>
              <Text style={{ color: C.amber900, fontSize: F.sm }}>
                {result.unmatched.course?.length ? `Courses not found: ${result.unmatched.course.join(', ')}. ` : ''}
                {result.unmatched.counsellor?.length ? `Counsellors not found: ${result.unmatched.counsellor.join(', ')}.` : ''}
              </Text>
            </View>
          ) : null}
          {result.skippedLimit > 0 ? <T v="small" style={{ color: C.red }}>⛔ {result.skippedLimit} rows skipped — the plan&apos;s contact limit was reached.</T> : null}
          {result.errors?.length ? <T v="small">Skipped rows: {result.errors.slice(0, 8).join(' · ')}</T> : null}
          {result.batchTag ? <T v="small">Everyone from this sheet is tagged “{result.batchTag}”.</T> : null}
          {result.batchTag && (result.created || result.updated) ? (
            <Button title="Send them a bulk WhatsApp message" icon="megaphone-outline" variant="soft" onPress={() => { close(); router.push({ pathname: '/campaigns/new', params: { tags: result.batchTag } }); }} />
          ) : null}
        </>
      ) : !preview ? (
        <>
          <Button title={busy ? 'Reading file…' : 'Choose Excel (.xlsx) or CSV file'} icon="document-attach-outline" loading={busy} onPress={choose} />
          <Button title="Download a sample sheet" variant="ghost" icon="download-outline" onPress={() => downloadAndShare('/contacts/import/sample', 'leads-sample.xlsx').catch(toast.error)} />
          <T v="small">The first row must have the column names. Only Phone and Name are needed; everything else is optional and empty cells never wipe saved details. Indian 10-digit numbers get +91.</T>
        </>
      ) : (
        <>
          <T><Text style={{ fontWeight: '700' }}>{file?.name}</Text> · {preview.totalRows} rows. Which column is what?</T>
          {FIELDS.map((fd) => (
            <Field key={fd.key} label={`${fd.label}${fd.required ? ' *' : ''}`} hint={fd.hint}>
              <Select value={mapping[fd.key] || ''} onChange={(v) => setMapping((m) => ({ ...m, [fd.key]: v }))} title={fd.label} options={[{ value: '', label: fd.required ? 'Choose column…' : '— Not in sheet —' }, ...preview.headers.map((h) => ({ value: h, label: h, hint: preview.sample[0]?.[h] ? `e.g. ${String(preview.sample[0][h]).slice(0, 40)}` : undefined }))]} />
            </Field>
          ))}
          {others.length ? (
            <Field label="Also save these columns on the contact" hint="Saved as extra details (custom fields)">
              <Row wrap gap={6}>
                {others.map((h) => <Chip key={h} label={h} active={custom.includes(h)} onPress={() => setCustom((c) => (c.includes(h) ? c.filter((x) => x !== h) : [...c, h]))} />)}
              </Row>
            </Field>
          ) : null}
          <Field label="Country code for 10-digit numbers"><Input value={country} onChangeText={(v) => setCountry(v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" /></Field>
          <Field label="Lead status for rows without one"><StatusSelect value={status} onChange={setStatus} allowAll allLabel="Keep as is (new leads = New)" /></Field>
          <Field label="Add these tags to everyone" hint="Separate with commas, e.g. old-query, 2025"><Input value={addTags} onChangeText={setAddTags} autoCapitalize="none" /></Field>
          <Toggle value={batchTag} onChange={setBatchTag} label="Tag this upload" description="e.g. sheet-081026-1530, to message exactly these people later" />
          <Toggle value={startDrips} onChange={setStartDrips} label="Start drips for these leads" description="Off for old enquiries: they are saved without the welcome / follow-up series." />
        </>
      )}
    </Sheet>
  );
}

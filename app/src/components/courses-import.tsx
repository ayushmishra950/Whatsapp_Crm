import * as DocumentPicker from 'expo-document-picker';
import { useState } from 'react';
import { View } from 'react-native';
import { api } from '@/lib/api';
import { appendFile } from '@/lib/upload';
import { downloadAndShare } from '@/lib/files';
import { C, R, S } from '@/theme';
import { useToast } from './toast';
import { Button, Row, Sheet, Stat, T } from './ui';

type Result = { added: number; updated: number; errors: { row: number; error?: string }[] };
type Picked = { uri: string; name: string; mimeType?: string; file?: File };

const SHEET_TYPES = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv', 'text/comma-separated-values', 'application/vnd.ms-excel'];

/** The picked sheet as multipart form data  */
function sheetForm(p: Picked) {
  const form = new FormData();
  appendFile(form, 'file', p);
  return form;
}

/** Courses from Excel (.xlsx) / CSV, matched by Code: sample download → choose file → added / updated / skipped rows (admin, coaching) */
export function CoursesImportSheet({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<'' | 'sample' | 'import'>('');
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<Result | null>(null);

  const close = () => {
    setResult(null);
    setFileName('');
    onClose();
  };

  const sample = async () => {
    setBusy('sample');
    try {
      await downloadAndShare('/courses/import/sample', 'courses-sample.xlsx');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy('');
    }
  };

  const choose = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: SHEET_TYPES, copyToCacheDirectory: true });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    const p: Picked = { uri: a.uri, name: a.name, mimeType: a.mimeType, file: a.file };
    if (!/\.(xlsx|csv)$/i.test(p.name)) {
      toast.error('Choose a .xlsx or .csv file');
      return;
    }
    setBusy('import');
    setFileName(p.name);
    try {
      const res = await api<Result>('/courses/import', { method: 'POST', form: sheetForm(p) });
      setResult(res);
      toast.success(`${res.added} added, ${res.updated} updated`);
      onImported();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy('');
    }
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Import courses from Excel"
      footer={result ? <><Button title="Import another" variant="secondary" onPress={() => setResult(null)} /><Button title="Done" onPress={close} /></> : <Button title="Cancel" variant="secondary" onPress={close} />}>
      {result ? (
        <>
          <T v="small">{fileName}</T>
          <Row wrap gap={S.sm}>
            <Stat label="Added" value={result.added} tone={C.brand700} />
            <Stat label="Updated" value={result.updated} tone={C.blue} />
            <Stat label="Skipped rows" value={result.errors.length} tone={result.errors.length ? C.amber : C.faint} />
          </Row>
          {result.errors.length ? (
            <View style={{ backgroundColor: C.amber50, borderRadius: R.md, padding: S.md, gap: 4 }}>
              {result.errors.map((e) => (
                <T key={e.row} v="small" style={{ color: C.amber900 }}>Row {e.row}: {e.error || 'invalid'}</T>
              ))}
            </View>
          ) : null}
        </>
      ) : (
        <>
          <T v="small">Courses are matched by Code: a new code is added, an existing one is updated. The sheet needs a “Code” and a “Course” column; download the sample to see all columns (fees, trigger words, next batch…).</T>
          <Button title="Download sample Excel" variant="secondary" icon="download-outline" loading={busy === 'sample'} disabled={!!busy} onPress={sample} />
          <Button title={busy === 'import' ? 'Importing…' : 'Choose Excel (.xlsx) or CSV file'} icon="document-attach-outline" loading={busy === 'import'} disabled={!!busy} onPress={choose} />
        </>
      )}
    </Sheet>
  );
}

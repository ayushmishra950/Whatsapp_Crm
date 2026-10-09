import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { API_URL, tokens } from './api';

/**
 * Download a file and open the phone's share / open-with sheet.
 * `pathOrUrl`: an API path ("/media/…", sent with the login) or a full https:// link (cloud storage, sent without it).
 */
export async function downloadAndShare(pathOrUrl: string, fileName?: string) {
  const dir = new Directory(Paths.cache, 'crm');
  dir.create({ idempotent: true, intermediates: true });
  const target = fileName ? new File(dir, fileName.replace(/[^\w.\- ]+/g, '_')) : dir;
  const external = /^https?:\/\//.test(pathOrUrl);
  const url = external ? pathOrUrl : pathOrUrl.startsWith('/uploads/') ? `${API_URL}${pathOrUrl}` : `${API_URL}/api${pathOrUrl}`;
  const ours = url.startsWith(API_URL);
  const file = await File.downloadFileAsync(url, target, { headers: ours ? { Authorization: `Bearer ${tokens.get() || ''}` } : {}, idempotent: true });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri);
  return file.uri;
}

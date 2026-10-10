import * as DocumentPicker from 'expo-document-picker';
import { File as FSFile } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

/** A file chosen on the phone, ready to upload */
export type PickedFile = { uri: string; name: string; mimeType: string; size?: number; file?: File };

const extOf = (mime: string) => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'video/mp4': 'mp4', 'video/quicktime': 'mov' })[mime] || mime.split('/')[1] || 'bin';

/**
 * WhatsApp accepts only JPG / PNG photos up to 5 MB (iPhones save HEIC). Every photo is re-saved
 * as a JPEG of at most 2000 px, which is always accepted and stays small.
 */
async function photoAsJpeg(a: ImagePicker.ImagePickerAsset): Promise<PickedFile> {
  const ctx = ImageManipulator.manipulate(a.uri);
  const big = Math.max(a.width || 0, a.height || 0);
  if (big > 2000) ctx.resize((a.width || 0) >= (a.height || 0) ? { width: 2000 } : { height: 2000 });
  const img = await ctx.renderAsync();
  const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
  const base = (a.fileName || 'photo').replace(/\.[^.]+$/, '');
  return { uri: out.uri, name: `${base || 'photo'}-${Date.now()}.jpg`, mimeType: 'image/jpeg' };
}

async function fromImageAsset(a: ImagePicker.ImagePickerAsset): Promise<PickedFile> {
  if (a.type !== 'video') {
    // Web preview keeps the browser's own File (no re-encoding there)
    if (Platform.OS === 'web' && a.file) return { uri: a.uri, name: a.fileName || `photo-${Date.now()}.jpg`, mimeType: a.mimeType || 'image/jpeg', size: a.fileSize, file: a.file };
    return photoAsJpeg(a);
  }
  const mimeType = a.mimeType || 'video/mp4';
  return { uri: a.uri, name: a.fileName || `video-${Date.now()}.${extOf(mimeType)}`, mimeType, size: a.fileSize, file: a.file };
}

// iPhone: hand over the most compatible version (JPEG instead of HEIC, H.264 video)
const COMPATIBLE = { preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible };

/** Photo / video from the gallery */
export async function pickMedia(): Promise<PickedFile | null> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.8, ...COMPATIBLE });
  return r.canceled || !r.assets?.[0] ? null : fromImageAsset(r.assets[0]);
}

/** Photos (up to `limit`) or one video for a Facebook / Instagram post; photos become JPEG (Instagram needs JPG) */
export async function pickPostMedia(limit = 10): Promise<PickedFile[]> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, selectionLimit: limit, quality: 0.8, ...COMPATIBLE });
  if (r.canceled || !r.assets?.length) return [];
  return Promise.all(r.assets.slice(0, limit).map(fromImageAsset));
}

/** New photo with the camera (asks for permission) */
export async function takePhoto(): Promise<PickedFile | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error('Allow camera access in the phone settings to take a photo.');
  const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
  return r.canceled || !r.assets?.[0] ? null : fromImageAsset(r.assets[0]);
}

// Document type from the file name when the phone does not say it
const DOC_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  mp4: 'video/mp4',
  mp3: 'audio/mpeg',
};
export const mimeFromName = (name: string) => DOC_TYPES[(name.split('.').pop() || '').toLowerCase()] || '';

// What WhatsApp accepts as a document (same list as the server)
const WA_DOCUMENTS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt'].map((x) => DOC_TYPES[x]);

/**
 * A document the chat's app accepts (other files are greyed out in the picker):
 * WhatsApp: PDF, Word, Excel, PowerPoint or TXT. Instagram: PDF only.
 */
export async function pickDocument(channel: 'whatsapp' | 'instagram' = 'whatsapp'): Promise<PickedFile | null> {
  const allowed = channel === 'instagram' ? [DOC_TYPES.pdf] : WA_DOCUMENTS;
  const r = await DocumentPicker.getDocumentAsync({ type: allowed, copyToCacheDirectory: true });
  if (r.canceled || !r.assets?.[0]) return null;
  const a = r.assets[0];
  const mimeType = a.mimeType && a.mimeType !== 'application/octet-stream' ? a.mimeType : mimeFromName(a.name) || 'application/octet-stream';
  // Some phones still let any file through: say it now, not after the upload
  if (!allowed.includes(mimeType)) {
    throw new Error(channel === 'instagram' ? `"${a.name}" can not be sent on Instagram. Instagram accepts only PDF documents (photos and videos: use the gallery button).` : `"${a.name}" can not be sent on WhatsApp. Send a PDF, Word, Excel, PowerPoint or TXT file (photos and videos: use the gallery button).`);
  }
  return { uri: a.uri, name: a.name, mimeType, size: a.size, file: a.file };
}

/**
 * Add a picked file to multipart form data. Web: the browser's File. Phone: Expo's fetch (the app's
 * global fetch since SDK 57) does not read React Native's old { uri, name, type } parts — it fails
 * before anything is sent — so the part hands over the file's bytes itself.
 */
export function appendFile(form: FormData, field: string, f: { uri: string; name: string; mimeType?: string; file?: File }) {
  if (Platform.OS === 'web' && f.file) {
    form.append(field, f.file, f.name);
    return;
  }
  const local = new FSFile(f.uri);
  form.append(field, { name: f.name, type: f.mimeType || 'application/octet-stream', bytes: () => local.bytes() } as any);
}

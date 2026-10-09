/**
 * multer's file name as the person sees it. The mobile app (Expo fetch) sends it URL-encoded
 * ("class%20photo.jpg"), and multer reads UTF-8 names (Hindi, emoji) as latin1.
 * Use as multer's fileFilter so every route gets the clean name in req.file.originalname.
 */
export function cleanUploadName(req, file, cb) {
  let name = file.originalname || '';
  try {
    const utf8 = Buffer.from(name, 'latin1').toString('utf8');
    if (!utf8.includes('�')) name = utf8;
  } catch {
    // keep as is
  }
  if (/%[0-9A-Fa-f]{2}/.test(name)) {
    try {
      name = decodeURIComponent(name);
    } catch {
      // a real "%" in the name
    }
  }
  file.originalname = name;
  cb(null, true);
}

import crypto from 'node:crypto';
import { env } from '../config/env.js';

const key = Buffer.from(env.encryptionKey, 'hex');
if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)');

// AES-256-GCM, output format: iv:authTag:cipherText (all hex)
export function encrypt(plainText) {
  if (!plainText) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  return [iv.toString('hex'), cipher.getAuthTag().toString('hex'), encrypted.toString('hex')].join(':');
}

export function decrypt(payload) {
  if (!payload) return '';
  const [ivHex, tagHex, dataHex] = payload.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}

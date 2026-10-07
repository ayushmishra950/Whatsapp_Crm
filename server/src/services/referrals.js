import crypto from 'node:crypto';
import { Contact } from '../models/index.js';

/**
 * Refer & earn. Each contact can get a short code (RAHUL7K2). A friend who messages the business with
 * that code (the referral link fills it in) is saved as "referred by" that contact. The business gives
 * the referrer a fee discount for every referred lead that converts (tracked, not paid out here).
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

function makeCode(name) {
  const base = String(name || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5) || 'REF';
  const rand = Array.from(crypto.randomBytes(3), (b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${base}${rand}`;
}

/** Gives the contact a referral code if it has none (saved right away). Returns the code. */
export async function ensureReferralCode(contact) {
  if (contact.referralCode) return contact.referralCode;
  for (let i = 0; i < 6; i += 1) {
    const code = makeCode(contact.name);
    const res = await Contact.updateOne({ _id: contact._id, referralCode: { $in: [null, ''] } }, { $set: { referralCode: code } }).catch((err) => {
      if (err.code === 11000) return null; // code taken in this business, try another
      throw err;
    });
    if (res?.modifiedCount) {
      contact.referralCode = code;
      return code;
    }
    if (res) {
      const fresh = await Contact.findById(contact._id).select('referralCode').lean();
      if (fresh?.referralCode) return (contact.referralCode = fresh.referralCode);
    }
  }
  throw new Error('Could not create a referral code');
}

/** wa.me link that opens a chat with the business, with the referral message already typed */
export function referralLink(tenant, contact) {
  const number = String(tenant.settings?.referral?.linkNumber || tenant.whatsapp?.displayPhoneNumber || tenant.phone || '').replace(/\D/g, '');
  const template = tenant.settings?.referral?.messageText || 'Hi! {name} ne mujhe refer kiya hai. Referral code: {code}';
  const text = template.replaceAll('{name}', contact.name || 'A friend').replaceAll('{code}', contact.referralCode || '');
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

/**
 * Inbound message from a contact who has no referrer yet: does it contain a referral code of this
 * business? Returns the referrer (and saves the link) or null. Self-referral is ignored.
 */
export async function detectReferral(tenant, contact, text) {
  if (contact.referredBy || tenant.settings?.referral?.enabled === false) return null;
  const tokens = [...new Set(String(text || '').toUpperCase().match(/\b[A-Z]{1,5}[A-Z2-9]{3}\b/g) || [])].slice(0, 20);
  if (!tokens.length) return null;
  const referrer = await Contact.findOne({ tenantId: tenant._id, referralCode: { $in: tokens }, _id: { $ne: contact._id } }).select('name phone referralCode');
  if (!referrer) return null;
  contact.referredBy = referrer._id;
  contact.referredAt = new Date();
  if (!contact.tags.includes('referred')) contact.tags.push('referred');
  return referrer;
}

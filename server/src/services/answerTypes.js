import { parseDateInput } from '../utils/dates.js';

/**
 * Checks a customer's answer to a chatbot lead question.
 * type: any | time | number | phone | email | date
 * Returns { ok: true, value } or { ok: false, hint } (hint = what to tell the customer before asking again).
 */
export const ANSWER_TYPES = ['any', 'time', 'number', 'phone', 'email', 'date'];

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Words that show a number is a time of day ("5 baje", "shaam 5", "5 pm", "kal subah 10")
const TIME_WORDS = /\b(a\.?m\.?|p\.?m\.?|baje|bje|baj|o'?clock|clock|hrs?|subah|subha|sham|shaam|dopahar|dopehar|raat|morning|evening|afternoon|night|noon)\b|\d\s*(am|pm)\b/i;

export const DEFAULT_HINTS = {
  time: 'Kripya time number mein likhiye, jaise: 5 baje, 5:30 PM ya kal subah 11 baje.',
  number: 'Kripya number mein likhiye, jaise: 2',
  phone: 'Kripya 10 digit ka mobile number likhiye.',
  email: 'Please send a valid email address.',
  date: 'Please send the date like 15/08/2002.',
};

function validTime(text) {
  const t = text.toLowerCase().trim();
  if (/\d{5,}/.test(t.replace(/[\s-]/g, ''))) return false; // a phone number, not a time
  const nums = [...t.matchAll(/(\d{1,2})(?:\s*[:.]\s*(\d{2}))?/g)];
  if (!nums.length) return false;
  const okNumbers = nums.every(([, h, m]) => Number(h) <= 24 && (m === undefined || Number(m) < 60));
  if (!okNumbers) return false;
  const hasMinutes = nums.some(([, , m]) => m !== undefined);
  const onlyNumbers = /^[\d\s:.\-–to]+$/i.test(t); // "5", "5:30", "10-11"
  return hasMinutes || onlyNumbers || TIME_WORDS.test(t);
}

export function checkAnswer(type, raw) {
  const text = String(raw || '').trim();
  if (!text) return { ok: false, hint: '' };
  switch (type) {
    case 'time':
      return validTime(text) ? { ok: true, value: text.slice(0, 200) } : { ok: false, hint: DEFAULT_HINTS.time };
    case 'number': {
      const m = text.match(/\d+(?:\.\d+)?/);
      return m ? { ok: true, value: text.slice(0, 200) } : { ok: false, hint: DEFAULT_HINTS.number };
    }
    case 'phone': {
      const digits = text.replace(/\D/g, '');
      return digits.length >= 10 && digits.length <= 13 ? { ok: true, value: digits } : { ok: false, hint: DEFAULT_HINTS.phone };
    }
    case 'email':
      return EMAIL_RX.test(text) ? { ok: true, value: text.toLowerCase() } : { ok: false, hint: DEFAULT_HINTS.email };
    case 'date': {
      const iso = parseDateInput(text);
      return iso ? { ok: true, value: iso } : { ok: false, hint: DEFAULT_HINTS.date };
    }
    default:
      return { ok: true, value: text.slice(0, 500) };
  }
}

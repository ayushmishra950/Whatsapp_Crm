import { Router } from 'express';

/**
 * Public Privacy Policy and Data Deletion pages (Meta asks for both before an app can go Live).
 * LEGAL_COMPANY / LEGAL_CONTACT_EMAIL in .env fill in who runs the service.
 */
const router = Router();

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const company = () => esc(process.env.LEGAL_COMPANY || 'WhatsApp CRM');
const email = () => esc(process.env.LEGAL_CONTACT_EMAIL || '');
const contact = () => (email() ? `<a href="mailto:${email()}">${email()}</a>` : 'the business you contacted');
const updated = '9 October 2026';

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · ${company()}</title>
<style>body{font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#17201b;background:#f7f8f7;margin:0}
main{max-width:720px;margin:0 auto;padding:32px 20px 60px}h1{font-size:28px;margin:0 0 4px}h2{font-size:19px;margin:28px 0 6px}
p,li{color:#2c3530}.muted{color:#5b6760;font-size:14px}a{color:#128c4a}</style></head><body><main>${body}</main></body></html>`;

router.get('/privacy', (_req, res) => {
  res.type('html').send(page('Privacy Policy', `
<h1>Privacy Policy</h1><p class="muted">${company()} · last updated ${updated}</p>
<p>${company()} is a customer messaging tool (CRM) that businesses use to answer their customers on WhatsApp and Instagram. This page explains what information is handled when you message a business that uses it.</p>
<h2>What we receive</h2>
<ul><li>Your name, WhatsApp number and/or Instagram username and profile picture, as shared by WhatsApp or Instagram.</li>
<li>The messages, photos, videos, audio and documents you send to the business, and the business's replies.</li>
<li>Details the business adds about your enquiry (for example the course you asked about, notes and follow-up dates).</li></ul>
<h2>Why it is used</h2>
<p>Only so the business can read and answer your messages, follow up on your enquiry and keep a history of the conversation. We do not sell your information or use it for advertising.</p>
<h2>Who can see it</h2>
<p>The staff of the business you messaged. Messages pass through Meta (WhatsApp / Instagram) as part of their service. Files are stored with our storage provider (Cloudinary) and data in our database provider (MongoDB Atlas).</p>
<h2>How long it is kept</h2>
<p>As long as the business needs it for your enquiry, or until you ask for it to be deleted.</p>
<h2>Your choices</h2>
<p>Reply <b>STOP</b> to stop marketing messages. You can ask for your data to be deleted at any time: see <a href="/data-deletion">Data deletion</a>.</p>
<h2>Contact</h2><p>Questions about this policy: ${contact()}.</p>`));
});

router.get('/data-deletion', (_req, res) => {
  res.type('html').send(page('Data Deletion', `
<h1>Delete your data</h1><p class="muted">${company()} · last updated ${updated}</p>
<p>You can ask for everything the business holds about you in ${company()} to be deleted: your contact details, messages, files and notes.</p>
<h2>How to ask</h2>
<ol><li>Send a message to the business on WhatsApp or Instagram saying “Delete my data”, or email ${contact()}.</li>
<li>Tell us the WhatsApp number or Instagram username you used.</li>
<li>Your data is deleted within 30 days and you get a confirmation.</li></ol>
<p>If you connected an Instagram business account to ${company()}, you can also remove it any time in Instagram → Settings → Apps and websites, or in the CRM under Settings → Instagram → Disconnect.</p>`));
});

export default router;

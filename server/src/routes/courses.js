import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { AdSource, Contact, Course } from '../models/index.js';
import { authorize } from '../middleware/auth.js';
import { validate, notFound, badRequest, conflict } from '../utils/http.js';
import { audit } from '../services/audit.js';
import { readSheet, writeSheet } from '../services/sheets.js';
import { parseDateInput } from '../utils/dates.js';

// Course catalog: one row per course (used by the chatbot, drip variables and reports)
const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const words = z.union([z.array(z.string()), z.string()]).transform((v) =>
  [...new Set((Array.isArray(v) ? v : v.split(',')).map((w) => w.trim().toLowerCase()).filter(Boolean))].slice(0, 40)
);
const text = (max = 1000) => z.string().trim().max(max);
const courseFields = {
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,20}$/, 'Code: letters / numbers only, e.g. DM'),
  name: text(100).min(1, 'Course name is required'),
  category: text(60),
  triggerWords: words,
  outcome: text(),
  who: text(),
  learn: text(),
  internshipLine: text(),
  greetingEn: text(),
  greetingHi: text(),
  feesEn: text(),
  feesHi: text(),
  feeAmount: z.coerce.number().min(0).max(10000000),
  durationDays: z.coerce.number().int().min(0).max(3650),
  nextBatchDate: z.string().trim().refine((v) => !v || parseDateInput(v), 'Next batch must be a date').transform((v) => (v ? parseDateInput(v) : '')),
  proofLink: text(300),
  pageUrl: z.string().trim().max(300).transform((v) => (v && !/^https?:\/\//i.test(v) ? `https://${v}` : v)),
  packageCode: z.string().trim().toUpperCase().max(20),
  active: z.boolean(),
};
const createSchema = z.object(courseFields).partial().required({ code: true, name: true });
const updateSchema = z.object(courseFields).partial();

router.get('/', async (req, res) => {
  const [courses, counts] = await Promise.all([
    Course.find({ tenantId: req.tenantId }).sort({ active: -1, name: 1 }),
    Contact.aggregate([{ $match: { tenantId: req.tenantId, course: { $ne: '' } } }, { $group: { _id: '$course', n: { $sum: 1 } } }]),
  ]);
  const leads = Object.fromEntries(counts.map((c) => [c._id, c.n]));
  res.json(courses.map((c) => ({ ...c.toJSON(), leads: leads[c.code] || 0 })));
});

router.post('/', authorize('admin'), async (req, res) => {
  const data = validate(createSchema, req.body);
  if (await Course.exists({ tenantId: req.tenantId, code: data.code })) throw conflict(`Course code ${data.code} already exists`);
  const course = await Course.create({ ...data, tenantId: req.tenantId });
  await audit(req, 'course.create', { meta: { code: course.code } });
  res.status(201).json(course);
});

router.patch('/:id', authorize('admin'), async (req, res) => {
  const data = validate(updateSchema, req.body);
  const course = await Course.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!course) throw notFound('Course not found');
  const oldCode = course.code;
  if (data.code && data.code !== oldCode && (await Course.exists({ tenantId: req.tenantId, code: data.code }))) throw conflict(`Course code ${data.code} already exists`);
  Object.assign(course, data);
  await course.save();
  if (course.code !== oldCode) {
    // Leads and ads keep pointing at the same course
    await Contact.updateMany({ tenantId: req.tenantId, course: oldCode }, { $set: { course: course.code } });
    await AdSource.updateMany({ tenantId: req.tenantId, courseCode: oldCode }, { $set: { courseCode: course.code } });
  }
  await audit(req, 'course.update', { meta: { code: course.code } });
  res.json(course);
});

router.delete('/:id', authorize('admin'), async (req, res) => {
  const course = await Course.findOne({ _id: req.params.id, tenantId: req.tenantId });
  if (!course) throw notFound('Course not found');
  const leads = await Contact.countDocuments({ tenantId: req.tenantId, course: course.code });
  if (leads && req.query.force !== '1') throw conflict(`${leads} lead(s) have this course. Mark it inactive instead, or delete anyway (their course will be cleared).`);
  await Contact.updateMany({ tenantId: req.tenantId, course: course.code }, { $set: { course: '' } });
  await AdSource.updateMany({ tenantId: req.tenantId, courseCode: course.code }, { $set: { courseCode: '' } });
  await course.deleteOne();
  await audit(req, 'course.delete', { meta: { code: course.code } });
  res.json({ ok: true });
});

// ---------- Excel import ----------

const COLUMNS = [
  ['code', 'Code'], ['name', 'Course'], ['category', 'Category'], ['triggerWords', 'Trigger words'], ['outcome', 'Outcome'],
  ['who', 'Who it is for'], ['learn', 'What they learn'], ['internshipLine', 'Internship line'], ['greetingEn', 'Greeting (English)'],
  ['greetingHi', 'Greeting (Hinglish)'], ['feesEn', 'Fees (English)'], ['feesHi', 'Fees (Hinglish)'], ['feeAmount', 'Fee amount'],
  ['durationDays', 'Duration (days)'], ['nextBatchDate', 'Next batch'], ['proofLink', 'Proof link'], ['pageUrl', 'Website page'], ['packageCode', 'Package code'],
];
const norm = (h) => String(h).toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIASES = { name: ['course', 'coursename', 'name'], code: ['code', 'coursecode', 'id'], triggerWords: ['triggerwords', 'keywords', 'triggers'] };

router.get('/import/sample', authorize('admin'), async (req, res) => {
  const headers = COLUMNS.map(([, h]) => h);
  const row = {
    Code: 'DM', Course: 'Digital Marketing', Category: 'Marketing', 'Trigger words': 'digital marketing, dm, seo, social media',
    Outcome: 'run ads and get your first client', 'Who it is for': 'Students, business owners', 'What they learn': 'SEO, Meta ads, Google ads',
    'Internship line': '3-month live internship included', 'Greeting (English)': 'Great choice! Digital Marketing is in demand.',
    'Greeting (Hinglish)': 'Badhiya choice! Digital Marketing ki demand bahut hai.', 'Fees (English)': '₹25,000 (EMI available)',
    'Fees (Hinglish)': '₹25,000 (EMI bhi hai)', 'Fee amount': 25000, 'Duration (days)': 90, 'Next batch': '15/11/2026', 'Proof link': '', 'Package code': '',
  };
  const file = await writeSheet(headers, [row], 'xlsx');
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', 'attachment; filename="courses-sample.xlsx"');
  res.send(file);
});

/** Add / update courses from Excel (matched by Code) */
router.post('/import', authorize('admin'), upload.single('file'), async (req, res) => {
  if (!req.file) throw badRequest('Choose a .xlsx or .csv file');
  const { headers, rows } = await readSheet(req.file.buffer, req.file.originalname);
  if (!rows.length) throw badRequest('The sheet has no rows');
  const colOf = {};
  for (const [key, label] of COLUMNS) {
    const names = [norm(label), norm(key), ...(ALIASES[key] || [])];
    colOf[key] = headers.find((h) => names.includes(norm(h)));
  }
  if (!colOf.code || !colOf.name) throw badRequest('The sheet needs a "Code" and a "Course" column (download the sample)');
  let added = 0;
  let updated = 0;
  const errors = [];
  for (const [i, row] of rows.entries()) {
    const raw = Object.fromEntries(Object.entries(colOf).filter(([, h]) => h && row[h] !== '').map(([k, h]) => [k, row[h]]));
    if (!raw.code && !raw.name) continue;
    const parsed = createSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push({ row: i + 2, error: parsed.error.issues[0]?.message });
      continue;
    }
    const r = await Course.updateOne({ tenantId: req.tenantId, code: parsed.data.code }, { $set: parsed.data, $setOnInsert: { tenantId: req.tenantId } }, { upsert: true });
    if (r.upsertedCount) added += 1;
    else updated += 1;
  }
  await audit(req, 'course.import', { meta: { added, updated, errors: errors.length } });
  res.json({ added, updated, errors: errors.slice(0, 20) });
});

export default router;

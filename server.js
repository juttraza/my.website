'use strict';
const mailer = require('./mailer'); // loads settings.env first, so keep this line above the config
const express = require('express');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

// ---------- Config ----------
const PORT = process.env.PORT || 3000;
const SEATS_PER_SLOT = Number(process.env.SEATS_PER_SLOT) || 40;
const MAX_PARTY = 12;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || crypto.randomBytes(16).toString('hex');
if (!process.env.ADMIN_TOKEN) console.log(`No ADMIN_TOKEN set. Temporary admin token: ${ADMIN_TOKEN}`);

// Opening hours by weekday (0 = Sunday). [open, close] in hours; close 24 = midnight. null = closed.
const HOURS = { 0: [12, 24], 1: null, 2: [17, 23], 3: [17, 23], 4: [17, 23], 5: [12, 24], 6: [12, 24] };

const DATA = path.join(__dirname, 'data');
const RES_FILE = path.join(DATA, 'reservations.json');

// ---------- Tiny JSON store (serialised writes, atomic rename) ----------
let queue = Promise.resolve();
const readJson = async (file, fallback) => {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
};
const withLock = (fn) => (queue = queue.then(fn, fn));
const writeJson = async (file, data) => {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file);
};

// ---------- Helpers ----------
const pad = (n) => String(n).padStart(2, '0');
const slotsFor = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  const hours = HOURS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  if (!hours) return [];
  const out = [];
  for (let mins = hours[0] * 60; mins <= hours[1] * 60 - 60; mins += 30) out.push(`${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`);
  return out;
};
const today = () => { const n = new Date(); return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`; };
const nowHM = () => { const n = new Date(); return `${pad(n.getHours())}:${pad(n.getMinutes())}`; };
const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
const seatsTaken = (list, date, time) =>
  list.filter((r) => r.date === date && r.time === time && r.status !== 'cancelled').reduce((n, r) => n + r.guests, 0);
const bookable = (date) => slotsFor(date).filter((t) => date > today() || (date === today() && t > nowHM()));

// Simple in-memory rate limit: N requests per window per IP
const hits = new Map();
const rateLimit = (max, windowMs) => (req, res, next) => {
  const key = `${req.ip}:${req.path}`, now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  recent.push(now); hits.set(key, recent); next();
};

// ---------- App ----------
const markEmail = (id, status) => withLock(async () => {
  const list = await readJson(RES_FILE, []);
  const item = list.find((x) => x.id === id);
  if (item) { item.emailStatus = status; await writeJson(RES_FILE, list); }
}).catch((e) => console.error('Could not save email status:', e.message));
// Sends the emails; waits up to `ms` so the page can say "email sent", but never blocks a booking for longer.
const emailGuest = (rec, ms = 8000) => {
  const job = mailer.sendBookingEmails(rec);
  job.then((m) => markEmail(rec.id, m.guest));
  return Promise.race([job, new Promise((r) => setTimeout(() => r({ guest: 'pending' }), ms))]);
};

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/menu', async (req, res, next) => {
  try { res.json(await readJson(path.join(DATA, 'menu.json'), [])); } catch (e) { next(e); }
});
app.get('/api/reviews', async (req, res, next) => {
  try { res.json(await readJson(path.join(DATA, 'reviews.json'), [])); } catch (e) { next(e); }
});

app.get('/api/availability', async (req, res, next) => {
  try {
    const { date } = req.query, guests = Number(req.query.guests) || 1;
    if (!validDate(date)) return res.status(400).json({ error: 'Choose a valid date.' });
    const list = await readJson(RES_FILE, []);
    const slots = bookable(date).map((time) => {
      const left = SEATS_PER_SLOT - seatsTaken(list, date, time);
      return { time, seatsLeft: Math.max(left, 0), available: left >= guests };
    });
    res.json({ date, closed: slotsFor(date).length === 0, slots });
  } catch (e) { next(e); }
});

const validateReservation = (b) => {
  const r = {
    name: clean(b.name, 80), email: clean(b.email, 120).toLowerCase(), phone: clean(b.phone, 30),
    date: clean(b.date, 10), time: clean(b.time, 5), guests: Number(b.guests), notes: clean(b.notes, 300),
  };
  const errors = {};
  if (r.name.length < 2) errors.name = 'Enter your full name.';
  if (r.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email)) errors.email = 'Enter a valid email address.';
  if (!validDate(r.date) || r.date < today()) errors.date = 'Choose today or a future date.';
  else if (!bookable(r.date).includes(r.time)) errors.time = 'That time is not available. Choose another.';
  if (!Number.isInteger(r.guests) || r.guests < 1 || r.guests > MAX_PARTY) errors.guests = `We take bookings for 1 to ${MAX_PARTY} guests. For larger groups, call us.`;
  return { r, errors };
};
const saveReservation = (r, source) => withLock(async () => {
  const list = await readJson(RES_FILE, []);
  if (SEATS_PER_SLOT - seatsTaken(list, r.date, r.time) < r.guests) return null;
  const rec = { id: crypto.randomUUID(), code: crypto.randomBytes(3).toString('hex').toUpperCase(), ...r, status: 'confirmed', source, createdAt: new Date().toISOString() };
  list.push(rec);
  await writeJson(RES_FILE, list);
  return rec;
});

app.get('/api/hours', (req, res) => res.json({ hours: HOURS, seatsPerSlot: SEATS_PER_SLOT, maxParty: MAX_PARTY }));

app.post('/api/reservations', rateLimit(6, 60 * 60 * 1000), async (req, res, next) => {
  try {
    const b = req.body || {};
    if (b.website) return res.status(201).json({ ok: true }); // honeypot: pretend success to bots
    const { r, errors } = validateReservation(b);
    if (!r.email) errors.email = 'Enter a valid email address.';
    if (Object.keys(errors).length) return res.status(400).json({ error: 'Please fix the highlighted fields.', fields: errors });
    const result = await saveReservation(r, 'website');
    if (!result) return res.status(409).json({ error: 'Sorry, that time just filled up. Choose another time.', fields: { time: 'Fully booked.' } });
    const mail = await emailGuest(result);
    res.status(201).json({ ok: true, code: result.code, date: result.date, time: result.time, guests: result.guests, name: result.name, email: result.email, emailed: mail.guest === 'sent' });
  } catch (e) { next(e); }
});

// ---------- Admin ----------
const auth = (req, res, next) => {
  const given = Buffer.from((req.get('authorization') || '').replace(/^Bearer\s+/i, ''));
  const real = Buffer.from(ADMIN_TOKEN);
  if (given.length !== real.length || !crypto.timingSafeEqual(given, real)) return res.status(401).json({ error: 'Unauthorized' });
  next();
};
app.get('/api/admin/reservations', rateLimit(60, 60 * 1000), auth, async (req, res, next) => {
  try {
    const list = await readJson(RES_FILE, []);
    res.json(list.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)));
  } catch (e) { next(e); }
});
app.patch('/api/admin/reservations/:id', auth, async (req, res, next) => {
  try {
    const status = req.body?.status;
    if (!['confirmed', 'seated', 'cancelled'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
    const rec = await withLock(async () => {
      const list = await readJson(RES_FILE, []);
      const item = list.find((x) => x.id === req.params.id);
      if (!item) return null;
      item.status = status; await writeJson(RES_FILE, list); return item;
    });
    rec ? res.json(rec) : res.status(404).json({ error: 'Not found.' });
  } catch (e) { next(e); }
});
app.delete('/api/admin/reservations/:id', auth, async (req, res, next) => {
  try {
    const ok = await withLock(async () => {
      const list = await readJson(RES_FILE, []);
      const next = list.filter((x) => x.id !== req.params.id);
      if (next.length === list.length) return false;
      await writeJson(RES_FILE, next); return true;
    });
    ok ? res.status(204).end() : res.status(404).json({ error: 'Not found.' });
  } catch (e) { next(e); }
});

app.post('/api/admin/reservations', auth, async (req, res, next) => {
  try {
    const { r, errors } = validateReservation(req.body || {});
    if (Object.keys(errors).length) return res.status(400).json({ error: Object.values(errors)[0], fields: errors });
    const rec = await saveReservation(r, 'admin');
    if (!rec) return res.status(409).json({ error: 'That time is fully booked.' });
    const mail = rec.email ? await emailGuest(rec) : { guest: 'skipped' };
    res.status(201).json({ ...rec, emailed: mail.guest === 'sent' });
  } catch (e) { next(e); }
});

const CATEGORIES = ['Starters', 'Mains', 'Desserts', 'Drinks'];
app.put('/api/admin/menu', auth, async (req, res, next) => {
  try {
    const items = req.body;
    if (!Array.isArray(items) || items.length > 200) return res.status(400).json({ error: 'Invalid menu.' });
    const out = [];
    for (const [i, it] of items.entries()) {
      const item = { id: Number(it.id), category: clean(it.category, 20), name: clean(it.name, 80), description: clean(it.description, 200), price: Number(it.price) };
      if (!Number.isInteger(item.id) || item.id < 1) return res.status(400).json({ error: `Item ${i + 1}: invalid id.` });
      if (!CATEGORIES.includes(item.category)) return res.status(400).json({ error: `Item ${i + 1}: choose a category.` });
      if (item.name.length < 2) return res.status(400).json({ error: `Item ${i + 1}: enter a name.` });
      if (!Number.isFinite(item.price) || item.price < 0 || item.price > 9999) return res.status(400).json({ error: `Item ${i + 1}: invalid price.` });
      out.push(item);
    }
    if (new Set(out.map((x) => x.id)).size !== out.length) return res.status(400).json({ error: 'Duplicate item ids.' });
    await withLock(() => writeJson(path.join(DATA, 'menu.json'), out));
    res.json(out);
  } catch (e) { next(e); }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, req, res, next) => { // eslint-disable-line
  console.error(err);
  res.status(err.type === 'entity.parse.failed' ? 400 : 500).json({ error: 'Something went wrong. Please try again.' });
});

if (require.main === module) app.listen(PORT, () => console.log(`Ember & Oak running at http://localhost:${PORT}`));
module.exports = app;

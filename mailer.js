'use strict';
const fs = require('fs');
const path = require('path');

// ---------- Settings: read .env or settings.env (real environment variables always win) ----------
function loadSettings() {
  for (const name of ['.env', 'settings.env']) {
    const file = path.join(__dirname, name);
    if (!fs.existsSync(file)) continue;
    for (const raw of fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const i = line.indexOf('=');
      if (i < 1) continue;
      const key = line.slice(0, i).trim();
      let val = line.slice(i + 1).trim();
      if (/^(".*"|'.*')$/.test(val)) val = val.slice(1, -1);
      if (val !== '' && process.env[key] === undefined) process.env[key] = val;
    }
  }
}
loadSettings();

const info = () => ({
  name: process.env.RESTAURANT_NAME || 'Ember & Oak',
  address: process.env.RESTAURANT_ADDRESS || '24 Orchard Lane, Old Town',
  phone: process.env.RESTAURANT_PHONE || '+00 123 456 789',
  email: process.env.RESTAURANT_EMAIL || process.env.SMTP_USER || '',
  hours: process.env.RESTAURANT_HOURS || 'Tue – Thu 5 pm – 11 pm · Fri – Sun 12 pm – 12 am · Monday closed',
});

// ---------- Formatting helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const fmtTime = (t) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${pad(m)} ${h >= 12 && h < 24 ? 'pm' : 'am'}`; };
const fmtDate = (d, long = true) => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', long ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } : { weekday: 'short', day: 'numeric', month: 'short' });
const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsLocal = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;

function calendarFile(rec, i) {
  const [y, mo, d] = rec.date.split('-').map(Number), [h, mi] = rec.time.split(':').map(Number);
  const start = new Date(y, mo - 1, d, h, mi), end = new Date(start.getTime() + 2 * 3600 * 1000);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ember and Oak//Reservations//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${rec.id}@reservations`, `DTSTAMP:${stamp}`, `DTSTART:${icsLocal(start)}`, `DTEND:${icsLocal(end)}`,
    `SUMMARY:${icsText('Table at ' + i.name)}`, `LOCATION:${icsText(i.address)}`,
    `DESCRIPTION:${icsText(`${rec.guests} guest${rec.guests === 1 ? '' : 's'}. Booking code ${rec.code}.`)}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

// ---------- Email content ----------
function guestMessage(rec) {
  const i = info(), first = rec.name.trim().split(/\s+/)[0], people = `${rec.guests} ${rec.guests === 1 ? 'guest' : 'guests'}`;
  const rows = [['Date', fmtDate(rec.date)], ['Time', fmtTime(rec.time)], ['Guests', people], ['Name', rec.name]];
  if (rec.notes) rows.push(['Notes', rec.notes]);
  const text = [`Hi ${first},`, '', `Your table at ${i.name} is confirmed.`, '', ...rows.map(([k, v]) => `${k}: ${v}`), `Booking code: ${rec.code}`, '',
    `${i.name}`, i.address, i.phone, i.email, i.hours, '',
    `Need to change or cancel? ${i.email ? `Reply to this email or ` : ''}call us and quote your booking code.`, '', 'We look forward to seeing you.'].filter((x) => x !== undefined).join('\n');

  const row = ([k, v]) => `<tr><td style="padding:12px 0;border-top:1px solid #E4DDD2;color:#6B6560;font-size:14px;width:110px;vertical-align:top">${esc(k)}</td><td style="padding:12px 0;border-top:1px solid #E4DDD2;font-size:15px;font-weight:600;vertical-align:top">${esc(v)}</td></tr>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reservation confirmed</title></head>
<body style="margin:0;padding:0;background:#FAF7F2;color:#1C1917;font-family:'Segoe UI',Helvetica,Arial,sans-serif">
<div style="display:none;max-height:0;overflow:hidden">Your table for ${esc(people)} on ${esc(fmtDate(rec.date, false))} at ${esc(fmtTime(rec.time))} is confirmed.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAF7F2"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px">
<tr><td style="padding:0 4px 24px;font-family:Georgia,'Times New Roman',serif;font-size:26px;letter-spacing:-.5px">${esc(i.name).replace('&amp;', '<span style="color:#B4532A;font-style:italic">&amp;</span>')}</td></tr>
<tr><td style="background:#ffffff;border:1px solid #E4DDD2;border-radius:10px;padding:36px 32px">
  <p style="margin:0 0 10px;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#B4532A;font-weight:600">Reservation confirmed</p>
  <h1 style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:30px;line-height:1.2;letter-spacing:-.5px">See you on ${esc(fmtDate(rec.date, false))}</h1>
  <p style="margin:0 0 26px;font-size:16px;line-height:1.6;color:#6B6560">Hi ${esc(first)}, your table is booked. Here are your details.</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.map(row).join('')}</table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:26px"><tr><td align="center" style="border:1px dashed #B4532A;border-radius:8px;padding:18px">
    <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#6B6560">Booking code</div>
    <div style="font-size:26px;font-weight:700;letter-spacing:.24em;color:#B4532A;margin-top:6px">${esc(rec.code)}</div>
  </td></tr></table>
  <p style="margin:26px 0 0;font-size:14px;line-height:1.6;color:#6B6560">A calendar file is attached, so you can add this booking to your phone with one tap. To change or cancel, ${i.email ? 'reply to this email or ' : ''}call us and quote your booking code.</p>
</td></tr>
<tr><td style="padding:28px 4px 0;font-size:13px;line-height:1.7;color:#6B6560">
  <strong style="color:#1C1917">${esc(i.name)}</strong><br>${esc(i.address)}<br>${esc(i.phone)}${i.email ? ' · ' + esc(i.email) : ''}<br>${esc(i.hours)}
</td></tr></table></td></tr></table></body></html>`;

  return {
    from: { name: i.name, address: process.env.SMTP_USER || 'noreply@localhost' },
    to: { name: rec.name, address: rec.email },
    ...(i.email ? { replyTo: i.email } : {}),
    subject: `Your table at ${i.name} is confirmed · ${fmtDate(rec.date, false)}, ${fmtTime(rec.time)}`,
    text, html,
    attachments: [{ filename: 'reservation.ics', content: calendarFile(rec, i), contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }],
  };
}

function ownerMessage(rec) {
  const i = info(), to = process.env.OWNER_EMAIL;
  return {
    from: { name: `${i.name} bookings`, address: process.env.SMTP_USER || 'noreply@localhost' }, to,
    subject: `New booking: ${rec.name}, ${rec.guests} guest${rec.guests === 1 ? '' : 's'}, ${fmtDate(rec.date, false)} ${fmtTime(rec.time)}`,
    text: [`New website booking`, '', `Name: ${rec.name}`, `When: ${fmtDate(rec.date)} at ${fmtTime(rec.time)}`, `Guests: ${rec.guests}`,
      `Email: ${rec.email || '-'}`, `Phone: ${rec.phone || '-'}`, `Notes: ${rec.notes || '-'}`, `Code: ${rec.code}`].join('\n'),
  };
}

// ---------- Sending ----------
let transport;
function getTransport() {
  if (process.env.MAIL_DRY_RUN) return 'dry';
  const user = process.env.SMTP_USER, pass = (process.env.SMTP_PASS || '').replace(/\s+/g, '');
  if (!user || !pass) return null;
  if (!transport) {
    const nodemailer = require('nodemailer');
    const base = { auth: { user, pass }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000 };
    const port = Number(process.env.SMTP_PORT) || 587;
    transport = nodemailer.createTransport(process.env.SMTP_HOST ? { ...base, host: process.env.SMTP_HOST, port, secure: port === 465 } : { ...base, service: 'gmail' });
  }
  return transport;
}
const isConfigured = () => !!getTransport();

function explain(err) {
  const c = err && err.code, m = (err && err.message) || String(err);
  if (c === 'MODULE_NOT_FOUND') return 'The email package is missing. Run: npm install';
  if (c === 'EAUTH') return 'Gmail rejected the login. Use a 16-letter Google App Password (not your normal Gmail password) in SMTP_PASS, and the same Gmail address in SMTP_USER.';
  if (['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ENOTFOUND'].includes(c)) return 'Could not reach the mail server. Check your internet connection and try again.';
  return m;
}

async function deliver(message) {
  const t = getTransport();
  if (!t) return 'not-configured';
  if (t === 'dry') {
    const dir = path.join(__dirname, 'data', 'outbox'); fs.mkdirSync(dir, { recursive: true });
    const stem = `${Date.now()}-${String(message.to.address || message.to).replace(/[^a-z0-9@.]/gi, '_')}`;
    if (message.html) fs.writeFileSync(path.join(dir, stem + '.html'), message.html);
    fs.writeFileSync(path.join(dir, stem + '.txt'), `Subject: ${message.subject}\n\n${message.text}`);
    if (message.attachments) fs.writeFileSync(path.join(dir, stem + '.ics'), message.attachments[0].content);
    return 'sent';
  }
  await t.sendMail(message);
  return 'sent';
}

/** Sends the guest confirmation (and an owner copy for website bookings). Never throws. */
async function sendBookingEmails(rec) {
  const out = { guest: 'skipped', owner: 'skipped' };
  try {
    if (rec.email) {
      out.guest = await deliver(guestMessage(rec));
      if (out.guest === 'not-configured') console.log('Email is not set up yet, so no confirmation was sent. Fill settings.env to turn it on.');
      else console.log(`Confirmation email ${out.guest} to ${rec.email} (code ${rec.code})`);
    }
  } catch (e) { out.guest = 'failed'; console.error(`Confirmation email FAILED for ${rec.email}: ${explain(e)}`); }
  try {
    if (process.env.OWNER_EMAIL && rec.source !== 'admin') out.owner = await deliver(ownerMessage(rec));
  } catch (e) { out.owner = 'failed'; console.error(`Owner notification FAILED: ${explain(e)}`); }
  return out;
}

module.exports = { sendBookingEmails, isConfigured, explain, loadSettings };

// ---------- `npm run test-email [address]`: send a sample email and explain any problem ----------
if (require.main === module) {
  (async () => {
    const to = process.argv[2] || process.env.OWNER_EMAIL || process.env.SMTP_USER;
    if (!isConfigured()) { console.log('\nEmail is not set up yet.\nOpen settings.env, fill SMTP_USER and SMTP_PASS, save, and run this again.\n'); process.exit(1); }
    if (!to) { console.log('\nTell me where to send the test: npm run test-email you@gmail.com\n'); process.exit(1); }
    const d = new Date(Date.now() + 3 * 86400000), ds = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const rec = { id: 'test-' + Date.now(), code: 'TEST42', name: 'Test Guest', email: to, date: ds, time: '20:00', guests: 2, notes: 'This is a test email', source: 'admin' };
    try { await deliver(guestMessage(rec)); console.log(`\n✔ Test email sent to ${to}.\n  Check your inbox (and the Spam folder).\n`); }
    catch (e) { console.error(`\n✘ Test email failed.\n  ${explain(e)}\n`); process.exit(1); }
  })();
}

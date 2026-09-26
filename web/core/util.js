// Small helpers shared by the server and the browser. No dependencies.

export const TZ = 'America/Chicago';

export function uid(prefix = 'id') {
  const rand = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
  return `${prefix}_${rand}`;
}

export const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// ---------- Time (everything the org sees is Central time) ----------

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
});
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Wall-clock parts of an instant in Central time.
export function central(date = new Date()) {
  const p = {};
  for (const { type, value } of partsFmt.formatToParts(new Date(date))) p[type] = value;
  return {
    year: +p.year, month: +p.month, day: +p.day, hour: +p.hour % 24, minute: +p.minute,
    second: +p.second, weekday: WEEKDAYS[p.weekday],
  };
}

function offsetMinutes(date) {
  const p = central(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

// The instant for a Central wall-clock time.
export function centralToDate(year, month, day, hour = 0, minute = 0) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let ts = guess - offsetMinutes(new Date(guess)) * 60000;
  const second = guess - offsetMinutes(new Date(ts)) * 60000;
  if (second !== ts) ts = second;
  return new Date(ts);
}

export const monthKey = (year, month) => `${year}-${String(month).padStart(2, '0')}`;
export function parseMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return { year: y, month: m };
}
export function addMonths(key, n) {
  const { year, month } = parseMonth(key);
  const idx = year * 12 + (month - 1) + n;
  return monthKey(Math.floor(idx / 12), (idx % 12) + 1);
}
export const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
export const weekdayOf = (year, month, day) => new Date(Date.UTC(year, month - 1, day)).getUTCDay();
export function currentMonthKey(now = new Date()) {
  const c = central(now);
  return monthKey(c.year, c.month);
}
export function monthOfISO(iso) {
  const c = central(new Date(iso));
  return monthKey(c.year, c.month);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const monthName = (key) => MONTHS[parseMonth(key).month - 1];
export const monthLabel = (key) => `${monthName(key)} ${parseMonth(key).year}`;
export const dayName = (n) => DAY_NAMES[n];

export function fmtTime(h, m) {
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hh}:${String(m).padStart(2, '0')} ${suffix}` : `${hh} ${suffix}`;
}

export function fmtDate(iso, { withTime = false, withYear = false, weekday = true } = {}) {
  if (!iso) return '[date]';
  const c = central(new Date(iso));
  const wd = DAY_NAMES[c.weekday].slice(0, 3);
  let s = `${weekday ? wd + ' ' : ''}${MONTHS[c.month - 1].slice(0, 3)} ${c.day}`;
  if (withYear) s += `, ${c.year}`;
  if (withTime) s += ` · ${fmtTime(c.hour, c.minute)}`;
  return s;
}

export function fmtDateTime(iso) {
  if (!iso) return '';
  const c = central(new Date(iso));
  return `${MONTHS[c.month - 1].slice(0, 3)} ${c.day}, ${c.year} ${fmtTime(c.hour, c.minute)}`;
}

// Value for <input type="datetime-local"> in Central time, and back.
export function toLocalInput(iso) {
  const c = central(new Date(iso));
  const p = (n) => String(n).padStart(2, '0');
  return `${c.year}-${p(c.month)}-${p(c.day)}T${p(c.hour)}:${p(c.minute)}`;
}
export function fromLocalInput(value) {
  const [d, t = '00:00'] = value.split('T');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  return centralToDate(y, mo, da, h, mi).toISOString();
}

export const DAY_MS = 86400000;
export function daysUntil(iso, now = new Date()) {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - new Date(now).getTime()) / DAY_MS);
}

// ---------- Text ----------

const STOP = new Set(('a an and are as at be been but by can could did do does for from had has have how i if in into is it its ' +
  'me my of on or our ours so than that the their them then there these they this to too us was we were what when where which ' +
  'who why will with would you your yours about per any all also just more most not no only other some such very each one get').split(' '));

const SYNONYMS = {
  narcan: 'naloxone', 'reversal': 'naloxone', price: 'cost', pricing: 'cost', costs: 'cost', fee: 'cost', fees: 'cost',
  teen: 'youth', teens: 'youth', teenager: 'youth', teenagers: 'youth', station: 'access', stations: 'access', box: 'access', boxes: 'access',
  od: 'overdose', overdoses: 'overdose', school: 'school', schools: 'school', church: 'faith', churches: 'faith',
};

function stem(w) {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

export function tokenize(text) {
  const out = [];
  for (const raw of String(text || '').toLowerCase().match(/[a-z0-9$][a-z0-9$.'-]*/g) || []) {
    const w = raw.replace(/[.'-]+$/g, '').replace(/'s$/, '');
    if (!w || STOP.has(w)) continue;
    const syn = SYNONYMS[w];
    out.push(stem(syn || w));
  }
  return out;
}

export function splitSentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=["'“(]?[A-Z0-9#$])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export const wordCount = (t) => (String(t || '').trim().match(/\S+/g) || []).length;

export function truncate(text, n) {
  const s = String(text || '');
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

export function slug(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export const normalizeName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function money(n) {
  if (n === null || n === undefined || n === '' || Number.isNaN(+n)) return '[$ amount]';
  return '$' + Math.round(+n).toLocaleString('en-US');
}

export function moneyRange(min, max) {
  if (!min && !max) return '[range]';
  if (min && max && min !== max) return `${money(min)}–${money(max)}`;
  return money(max || min);
}

export function isEmail(s) {
  return /^[^\s@<>()[\]]+@[^\s@<>()[\]]+\.[a-z]{2,}$/i.test(String(s || '').trim());
}

export function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj && k in obj) out[k] = obj[k];
  return out;
}

export function sum(arr, fn = (x) => x) {
  return arr.reduce((a, b) => a + (+fn(b) || 0), 0);
}

export function groupBy(arr, fn) {
  const out = {};
  for (const x of arr) (out[fn(x)] ||= []).push(x);
  return out;
}

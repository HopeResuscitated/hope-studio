// Tiny view helpers: escaped HTML templates, formatting, toasts and dialogs.

export class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

export const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function toHtml(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(toHtml).join('');
  if (v === null || v === undefined || v === false || v === true) return '';
  return esc(v);
}

export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < vals.length) out += toHtml(vals[i]); });
  return new Raw(out);
}

export const raw = (s) => new Raw(s);
export const when = (cond, a, b = '') => (cond ? a : b);
export const attr = (cond, name) => (cond ? raw(` ${name}`) : '');

// ---------- Icons (inline stroke SVG) ----------

const ICONS = {
  check: '<path d="M5 12l5 5L20 7"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.5"/>',
  dot: '<circle cx="12" cy="12" r="4"/>',
  photo: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/>',
  video: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9.5v5l4-2.5z"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  inbox: '<path d="M4 13l2.5-7h11L20 13v5a1 1 0 01-1 1H5a1 1 0 01-1-1z"/><path d="M4 13h4l1.5 2.5h5L16 13h4"/>',
  pulse: '<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1A1.7 1.7 0 009 19.4a1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1A1.7 1.7 0 004.6 9a1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  play: '<path d="M8 5v14l11-7z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  doc: '<path d="M14 3H6a1 1 0 00-1 1v16a1 1 0 001 1h12a1 1 0 001-1V8z"/><path d="M14 3v5h5M8 13h8M8 17h6"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  logout: '<path d="M15 12H4M8 8l-4 4 4 4"/><path d="M11 4h8a1 1 0 011 1v14a1 1 0 01-1 1h-8"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
  refresh: '<path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>',
  download: '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01"/>',
  bolt: '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',
};

export function icon(name, size = 18, cls = '') {
  return raw(`<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`);
}

export function logo(size = 40) {
  return raw(`<svg width="${size}" height="${size}" viewBox="0 0 40 40" fill="none" aria-hidden="true"><circle cx="20" cy="20" r="20" fill="var(--signal-strong)"/><path d="M7 22h8l3-6 4 11 3-5h8" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
}

// ---------- Formatting ----------

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const partsFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' });

export function ct(iso) {
  const p = {};
  for (const { type, value } of partsFmt.formatToParts(new Date(iso))) p[type] = value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute, wd: DAYS.indexOf(p.weekday) };
}

export function time12(h, m) {
  const s = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 || 12;
  return m ? `${hh}:${String(m).padStart(2, '0')} ${s}` : `${hh}:00 ${s}`;
}

export function fdate(iso, { time = false, weekday = true, year = false } = {}) {
  if (!iso) return '[date]';
  const c = ct(iso);
  let s = `${weekday ? DAYS[c.wd] + ' ' : ''}${MON[c.m - 1]} ${c.d}${year ? ', ' + c.y : ''}`;
  if (time) s += ` · ${time12(c.h, c.min)}`;
  return s;
}

export function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return fdate(iso, { year: true });
}

export const money = (n) => (n === null || n === undefined || n === '' ? '[$ amount]' : '$' + Math.round(+n).toLocaleString('en-US'));
export function moneyRange(a, b) {
  if (!a && !b) return '[range]';
  if (a && b && a !== b) return `${money(a)}–${money(b)}`;
  return money(b || a);
}
export const num = (n) => Number(n || 0).toLocaleString('en-US');
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

// ---------- Chips ----------

const PILLAR_CLASS = { Educate: 'p-educate', Equip: 'p-equip', Empower: 'p-empower', Respond: 'p-respond', Lead: 'p-lead' };
export const pillarChip = (p) => (p ? html`<span class="pillar ${PILLAR_CLASS[p] || ''}">${p}</span>` : '');
export const chip = (label, tone = 'neutral') => html`<span class="chip chip-${tone}">${label}</span>`;

export function stateChip(state) {
  const map = {
    needs_you: ['Needs your OK', 'warn'], approved: ['Approved', 'good'], executed: ['Done', 'good'], in_review: ['In review', 'info'],
    drafted: ['Drafted', 'neutral'], rejected: ['Rejected', 'muted'], snoozed: ['Snoozed', 'muted'],
  };
  const [l, t] = map[state] || [state, 'neutral'];
  return chip(l, t);
}

// Placeholder thumbnail when a media item has no image yet.
export function thumb(m, cls = '') {
  if (m?.thumb) return html`<img class="thumb ${cls}" src="${m.thumb}" alt="">`;
  const kind = m?.kind === 'video' ? 'video' : 'photo';
  return html`<div class="thumb ph ${cls} ${PILLAR_CLASS[m?.pillar] || ''}">${icon(kind, 26)}${m?.duration_s ? html`<span class="dur">${Math.floor(m.duration_s / 60)}:${String(Math.round(m.duration_s % 60)).padStart(2, '0')}</span>` : ''}</div>`;
}

// ---------- Toasts and dialogs ----------

export function toast(message, tone = 'good') {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast toast-${tone}`;
  el.setAttribute('role', tone === 'bad' ? 'alert' : 'status');
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.classList.add('out'), 4200);
  setTimeout(() => el.remove(), 4700);
}

// In-page dialog (the artifact viewer blocks window.confirm/prompt).
export function dialog({ title, body, submit = 'Save', cancel = 'Cancel', wide = false }) {
  return new Promise((resolve) => {
    const host = document.getElementById('dialog');
    host.innerHTML = String(html`<div class="scrim" data-close></div>
      <form class="dialog ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
        <div class="dialog-head"><h2 id="dlg-title">${title}</h2><button type="button" class="icon-btn" data-close aria-label="Close">${icon('close')}</button></div>
        <div class="dialog-body">${body}</div>
        <div class="dialog-foot">${cancel ? html`<button type="button" class="btn" data-close>${cancel}</button>` : ''}${submit ? html`<button type="submit" class="btn btn-primary">${submit}</button>` : ''}</div>
      </form>`);
    host.hidden = false;
    const form = host.querySelector('form');
    const close = (val) => { host.hidden = true; host.innerHTML = ''; document.removeEventListener('keydown', onKey); resolve(val); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    host.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => close(null)));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = {};
      for (const [k, v] of new FormData(form).entries()) {
        if (k in data) data[k] = [].concat(data[k], v);
        else data[k] = v;
      }
      form.querySelectorAll('input[type=checkbox][name]').forEach((c) => { if (!c.checked && !(c.name in data)) data[c.name] = ''; });
      close(data);
    });
    setTimeout(() => (form.querySelector('[autofocus]') || form.querySelector('input,textarea,select,button[type=submit]'))?.focus(), 30);
  });
}

export function field(label, name, { value = '', type = 'text', hint = '', required = false, rows = 0, placeholder = '', autofocus = false, options = null } = {}) {
  const id = `f-${name}`;
  let control;
  if (options) control = html`<select id="${id}" name="${name}">${options.map(([v, l]) => html`<option value="${v}"${attr(String(v) === String(value), 'selected')}>${l}</option>`)}</select>`;
  else if (rows) control = html`<textarea id="${id}" name="${name}" rows="${rows}" placeholder="${placeholder}"${attr(required, 'required')}${attr(autofocus, 'autofocus')}>${value}</textarea>`;
  else control = html`<input id="${id}" name="${name}" type="${type}" value="${value}" placeholder="${placeholder}"${attr(required, 'required')}${attr(autofocus, 'autofocus')}>`;
  return html`<div class="field"><label for="${id}">${label}</label>${control}${hint ? html`<p class="hint">${hint}</p>` : ''}</div>`;
}

// Copy text with a fallback when the clipboard is refused.
export async function copyText(text, el) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied');
  } catch {
    if (el) {
      const r = document.createRange();
      r.selectNodeContents(el);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      toast('Selected. Press Ctrl+C to copy.', 'info');
    }
  }
}

// Download text file directly in browser
export function downloadText(filename, content, mime = 'text/plain') {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
  toast(`Downloaded ${filename}`);
}

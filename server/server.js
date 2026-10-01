// Hope Studio server: static app, JSON API, sessions, uploads and the scheduler.
// Node 20+, no framework. Start with `node server/server.js` (or `npm start`).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadEnv, env, ROOT } from './env.js';
import { fileAdapter, backup } from './db.js';
import { hashPassword, verifyPassword, randomPassword, createSessions, parseCookies, createThrottle } from './auth.js';
import { createLlm } from './llm.js';
import { createIntegrations } from './integrations.js';
import { createSecrets } from './secrets.js';
import { createConnections } from './connections.js';
import { startScheduler } from './scheduler.js';
import { createStore } from '../web/core/store.js';
import { createService, publicUser } from '../web/core/service.js';
import { seedAll, seedCore } from '../web/core/seed.js';
import { raiseAlert, audit } from '../web/core/audit.js';

loadEnv();
// On Render or Railway, use the address they assign so sign-in redirects and Instagram media URLs are right.
if (!process.env.PUBLIC_BASE_URL) {
  const hosted = process.env.RENDER_EXTERNAL_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');
  if (hosted) process.env.PUBLIC_BASE_URL = hosted;
}
const PORT = +env('PORT', '8787');
const HOST = env('HOST', '0.0.0.0');
const DATA_DIR = path.resolve(ROOT, env('DATA_DIR', 'data'));
const WEB_DIR = path.join(ROOT, 'web');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const EXPORT_DIR = path.join(DATA_DIR, 'exports');
const COOKIE = 'hs_session';
fs.mkdirSync(MEDIA_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Boot

const adapter = fileAdapter(DATA_DIR);
const store = createStore(adapter);
const seeded = store.load();
const secrets = createSecrets(DATA_DIR);
const buildIntegrations = () => createIntegrations({ dataDir: DATA_DIR, settings: () => store.settings(), cfg: secrets.cfg });
const integrations = buildIntegrations();
if (!seeded) {
  if (env('SEED_SAMPLES', '1') === '1') await seedAll(store, integrations);
  else { seedCore(store); store.setMeta({ seeded: true, seeded_at: new Date().toISOString(), samples: false }); }
  store.flush();
  console.log(`Created ${adapter.file}`);
}

// First run: give each user a one-time password, printed once.
for (const u of store.all('users', (x) => !x.password_hash)) {
  const fromEnv = env(`${u.username.toUpperCase()}_PASSWORD`);
  const pw = fromEnv || randomPassword();
  store.update('users', u.id, { password_hash: hashPassword(pw) });
  if (!fromEnv) console.log(`\n  Sign-in for ${u.name}: username "${u.username}", password "${pw}"\n  (shown once; change it with: node server/set-password.js ${u.username})\n`);
}
store.flush();

// Connections can change while the server runs (Settings › Connections), so the
// service gets stable objects whose insides are swapped on reload.
let llmImpl = await createLlm(secrets.cfg);
// Everything reads through to whichever engine is active (Claude, Ollama, OpenAI-compatible or offline).
const llm = new Proxy({}, {
  get: (_, key) => (typeof llmImpl[key] === 'function' ? llmImpl[key].bind(llmImpl) : llmImpl[key]),
  has: (_, key) => key in llmImpl,
});
async function reload() {
  llmImpl = await createLlm(secrets.cfg);
  for (const k of Object.keys(integrations)) delete integrations[k];
  Object.assign(integrations, buildIntegrations());
}
const service = createService({ store, llm, integrations });
const connections = createConnections({ secrets, reload, llmRef: () => llmImpl, integrations });
const sessions = createSessions(+env('SESSION_DAYS', '14'));
const throttle = createThrottle();

console.log(`AI engine: ${llm.available ? llm.provider || 'connected' : `offline templates (${llm.reason} Connect Claude in Settings.)`}`);
for (const [k, v] of Object.entries({ Gmail: integrations.gmail, 'Google Docs': integrations.docs, Meta: integrations.meta, 'Grants.gov': integrations.grantsgov, 'Google Places': integrations.places })) {
  console.log(`${k}: ${v.available ? 'connected' : 'off'}`);
}

// ---------------------------------------------------------------------------
// Helpers

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.heic': 'image/heic',
  '.doc': 'application/msword', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'",
};

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const payload = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { ...SECURITY, 'Content-Type': isBuf || typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', ...headers });
  res.end(payload);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('That upload is too large.'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function currentUser(req) {
  const s = sessions.get(parseCookies(req.headers.cookie)[COOKIE]);
  return s ? store.get('users', s.userId) : null;
}

const secure = (req) => env('COOKIE_SECURE') === '1' || req.headers['x-forwarded-proto'] === 'https';

function serveFile(res, file, extra = {}) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, { error: 'Not found' });
    res.writeHead(200, { ...SECURITY, 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, ...extra });
    fs.createReadStream(file).pipe(res);
  });
}

function safeJoin(base, rel) {
  const p = path.normalize(path.join(base, rel));
  return p.startsWith(base + path.sep) || p === base ? p : null;
}

function raiseAudit(user, action, note) {
  audit(store, { actor: user, action, note });
}

// ---------------------------------------------------------------------------
// Routes

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (p === '/api/health') return send(res, 200, { ok: true, app: 'hope-studio', version: 1 });

    if (p === '/api/login' && req.method === 'POST') {
      const ip = req.socket.remoteAddress;
      if (throttle.blocked(ip)) return send(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
      const { username = '', password = '' } = JSON.parse((await readBody(req, 10000)).toString() || '{}');
      const user = store.find('users', (u) => u.username === String(username).trim().toLowerCase());
      if (!user || !verifyPassword(String(password), user.password_hash)) {
        throttle.fail(ip);
        return send(res, 401, { error: 'That username and password don\'t match.' });
      }
      throttle.clear(ip);
      const sid = sessions.create(user.id);
      return send(res, 200, { user: publicUser(user) }, { 'Set-Cookie': `${COOKIE}=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${14 * 86400}${secure(req) ? '; Secure' : ''}` });
    }
    if (p === '/api/logout' && req.method === 'POST') {
      sessions.destroy(parseCookies(req.headers.cookie)[COOKIE]);
      return send(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` });
    }

    // Uploaded media is public at an unguessable path so Meta can fetch it.
    if (p.startsWith('/media/') && req.method === 'GET') {
      const file = safeJoin(MEDIA_DIR, p.slice('/media/'.length));
      return file ? serveFile(res, file, { 'Cache-Control': 'public, max-age=31536000, immutable' }) : send(res, 404, { error: 'Not found' });
    }

    // Google and Facebook sign-in: start (admin only) and return trip.
    const oauth = p.match(/^\/api\/oauth\/(google|meta)\/(start|callback)$/);
    if (oauth && req.method === 'GET') {
      const user = currentUser(req);
      const [, provider, step] = oauth;
      const back = (q) => { res.writeHead(302, { Location: `/?${new URLSearchParams(q)}#settings` }); res.end(); };
      if (!user) return back({ connect_error: 'Sign in first, then connect from Settings.' });
      if (user.role !== 'admin') return back({ connect_error: 'Only Leila (admin) can connect accounts.' });
      try {
        if (step === 'start') { res.writeHead(302, { Location: connections.start[provider](req, user) }); return res.end(); }
        const message = await connections.callback[provider](req, user, url);
        raiseAudit(user, `connection.${provider}`, message);
        return back({ connected: provider, msg: message });
      } catch (err) {
        return back({ connect_error: err.message });
      }
    }

    if (p.startsWith('/api/')) {
      const user = currentUser(req);
      // Mutating API calls must come from the app (CSRF guard on top of SameSite cookies).
      if (req.method === 'POST' && req.headers['x-requested-with'] !== 'hope-studio') return send(res, 403, { error: 'Bad request origin.' });

      if (p.startsWith('/api/rpc/') && req.method === 'POST') {
        const method = p.slice('/api/rpc/'.length);
        const raw = await readBody(req, 40 * 1024 * 1024);
        const params = raw.length ? JSON.parse(raw.toString()) : {};
        const result = await service.call(method, params, user);
        return send(res, 200, { result: result === undefined ? null : result });
      }
      if (!user) return send(res, 401, { error: 'Sign in first.' });

      if (p === '/api/connections' && req.method === 'GET') return send(res, 200, connections.status(req));
      const conn = p.match(/^\/api\/connections\/([a-z]+(?:\/[a-z]+)?)$/);
      if (conn && req.method === 'POST') {
        if (user.role !== 'admin') return send(res, 403, { error: 'Only Leila (admin) can change connections.' });
        const action = connections.actions[conn[1]];
        if (!action) return send(res, 404, { error: 'Not found' });
        const body = JSON.parse((await readBody(req, 100000)).toString() || '{}');
        const result = await action(body, user);
        if (!conn[1].endsWith('/test')) raiseAudit(user, `connection.${conn[1].replace('/', '.')}`, '');
        return send(res, 200, { result });
      }

      if (p === '/api/upload' && req.method === 'POST') {
        const name = String(req.headers['x-file-name'] || 'upload');
        const ext = (path.extname(decodeURIComponent(name)).toLowerCase().match(/^\.(jpe?g|png|webp|gif|heic|mp4|mov)$/) || [''])[0];
        if (!ext) return send(res, 400, { error: 'Upload JPG, PNG, HEIC, MP4 or MOV files.' });
        const file = `${crypto.randomBytes(16).toString('hex')}${ext}`;
        const body = await readBody(req, 300 * 1024 * 1024);
        fs.writeFileSync(path.join(MEDIA_DIR, file), body);
        return send(res, 200, { file_url: `media/${file}` });
      }
      if (p.startsWith('/api/exports/') && req.method === 'GET') {
        const file = safeJoin(EXPORT_DIR, p.slice('/api/exports/'.length));
        return file ? serveFile(res, file, { 'Content-Disposition': `attachment; filename="${path.basename(file)}"` }) : send(res, 404, { error: 'Not found' });
      }
      if (p === '/api/audit.csv' && req.method === 'GET') {
        const csv = await service.call('auditCsv', {}, user);
        return send(res, 200, csv, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="hope-studio-audit-log.csv"' });
      }
      if (p === '/api/export-data' && req.method === 'GET') {
        const data = await service.call('exportData', {}, user);
        return send(res, 200, JSON.stringify(data, null, 2), { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="hope-studio-data.json"' });
      }
      return send(res, 404, { error: 'Not found' });
    }

    // Static app
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
    const rel = p === '/' ? 'index.html' : decodeURIComponent(p.slice(1));
    const file = safeJoin(WEB_DIR, rel);
    if (!file || !fs.existsSync(file)) return serveFile(res, path.join(WEB_DIR, 'index.html'));
    return serveFile(res, file, { 'Cache-Control': 'no-cache' });
  } catch (err) {
    const status = err.status || (err instanceof SyntaxError ? 400 : 500);
    if (status >= 500) console.error(err);
    return send(res, status, { error: status >= 500 ? `Something went wrong: ${err.message}` : err.message });
  }
});

server.listen(PORT, HOST, () => console.log(`Hope Studio running at http://localhost:${PORT}`));

// ---------------------------------------------------------------------------
// Scheduler

if (env('SCHEDULER', '1') === '1') {
  startScheduler({
    service,
    store,
    extraJobs: { backup: async () => backup(DATA_DIR) },
    onError: async (job, err) => {
      raiseAlert(store, { level: 'critical', title: `Scheduled job "${job}" failed`, detail: err.message });
      const to = env('ALERT_EMAIL');
      if (to && integrations.gmail.available) {
        try { await integrations.gmail.send({ to, subject: `Hope Studio: ${job} failed`, body: `${err.message}\n\nOpen Hope Studio › Activity for details.` }); } catch { /* alert email is best-effort */ }
      }
    },
  });
}

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { store.flush(); process.exit(0); });

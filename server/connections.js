// Connect Claude, Gmail (+ Google Docs) and Facebook/Instagram from Settings.
// Keys and tokens are written to the server's secrets file and never returned
// to the browser; the browser only sees status and the last four characters.

import crypto from 'node:crypto';
import { hint } from './secrets.js';
import { http } from './integrations.js';

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/documents',
];
const META_SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'instagram_basic', 'instagram_content_publish', 'business_management'];

export function createConnections({ secrets, reload, llmRef, integrations }) {
  const states = new Map(); // OAuth state → { userId, provider, expires }
  const cfg = secrets.cfg;
  const graph = () => `https://graph.facebook.com/${cfg('META_GRAPH_VERSION') || 'v21.0'}`;

  function baseUrl(req) {
    const configured = String(cfg('PUBLIC_BASE_URL') || '').replace(/\/$/, '');
    if (configured) return configured;
    const proto = req.headers['x-forwarded-proto'] || 'http';
    return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
  }
  const redirect = (req, provider) => `${baseUrl(req)}/api/oauth/${provider}/callback`;

  function newState(user, provider) {
    const s = crypto.randomBytes(24).toString('base64url');
    states.set(s, { userId: user.id, provider, expires: Date.now() + 10 * 60000 });
    return s;
  }
  function takeState(s, user, provider) {
    const st = states.get(s);
    states.delete(s);
    return st && st.userId === user?.id && st.provider === provider && st.expires > Date.now();
  }

  // -------------------------------------------------------------------------

  function status(req) {
    const pages = safeJson(secrets.get('META_PAGES')) || [];
    return {
      base_url: baseUrl(req),
      public_base_url: cfg('PUBLIC_BASE_URL') || '',
      claude: {
        connected: llmRef().available && llmRef().provider === 'anthropic',
        engine: llmRef().available ? llmRef().provider || 'anthropic' : null,
        source: secrets.source('ANTHROPIC_API_KEY'),
        hint: hint(cfg('ANTHROPIC_API_KEY')),
        reason: llmRef().available ? '' : llmRef().reason || '',
      },
      google: {
        app: !!(cfg('GOOGLE_CLIENT_ID') && cfg('GOOGLE_CLIENT_SECRET')),
        client_hint: cfg('GOOGLE_CLIENT_ID') ? `${String(cfg('GOOGLE_CLIENT_ID')).slice(0, 12)}…` : '',
        connected: !!integrations.gmail?.available,
        email: cfg('GOOGLE_EMAIL') || '',
        redirect_uri: redirect(req, 'google'),
      },
      meta: {
        app: !!(cfg('META_APP_ID') && cfg('META_APP_SECRET')),
        app_id: cfg('META_APP_ID') || '',
        config_id: cfg('META_CONFIG_ID') || '',
        connected: !!integrations.meta?.available,
        page: cfg('META_PAGE_ID') ? { id: cfg('META_PAGE_ID'), name: cfg('META_PAGE_NAME') || '' } : null,
        ig: cfg('META_IG_USER_ID') ? { id: cfg('META_IG_USER_ID'), username: cfg('META_IG_USERNAME') || '' } : null,
        pages: pages.map((p) => ({ id: p.id, name: p.name, ig: p.ig ? p.ig.username || p.ig.id : null })),
        redirect_uri: redirect(req, 'meta'),
      },
    };
  }

  // -------------------------------------------------------------------------
  // Claude

  async function setClaude({ api_key }) {
    const key = String(api_key || '').trim();
    if (!/^sk-ant-/.test(key)) throw bad('That doesn\'t look like an Anthropic API key. It starts with "sk-ant-".');
    const previous = secrets.get('ANTHROPIC_API_KEY');
    secrets.set({ ANTHROPIC_API_KEY: key });
    await reload();
    const llm = llmRef();
    try {
      if (!llm.available) throw new Error(llm.reason);
      if (llm.provider && llm.provider !== 'anthropic') throw new Error(`LLM_PROVIDER in .env is set to "${cfg('LLM_PROVIDER')}", so Claude isn't used. Remove it or set it to anthropic.`);
      await llm.check();
    } catch (err) {
      secrets.set({ ANTHROPIC_API_KEY: previous || null });
      await reload();
      throw bad(err.status === 401 ? 'Anthropic rejected that key. It may be mistyped or revoked; create a new one in the console.' : `Couldn't reach Claude with that key: ${err.message}`);
    }
    return { ok: true };
  }

  async function testClaude() {
    const llm = llmRef();
    if (!llm.available || (llm.provider && llm.provider !== 'anthropic')) throw bad('Claude is not the active AI engine.');
    await llm.check();
    return { ok: true, models: Object.values(llm.models) };
  }

  // -------------------------------------------------------------------------
  // Google (Gmail + Docs)

  function setGoogleApp({ client_id, client_secret }) {
    const id = String(client_id || '').trim();
    const secret = String(client_secret || '').trim();
    if (!/\.apps\.googleusercontent\.com$/.test(id)) throw bad('The client ID ends with ".apps.googleusercontent.com".');
    if (!secret) throw bad('Paste the client secret too.');
    const changed = id !== cfg('GOOGLE_CLIENT_ID');
    secrets.set({ GOOGLE_CLIENT_ID: id, GOOGLE_CLIENT_SECRET: secret, ...(changed ? { GOOGLE_REFRESH_TOKEN: null, GOOGLE_EMAIL: null } : {}) });
    return reload().then(() => ({ ok: true }));
  }

  function googleStart(req, user) {
    if (!cfg('GOOGLE_CLIENT_ID')) throw bad('Save the Google client ID and secret first.');
    const q = new URLSearchParams({
      client_id: cfg('GOOGLE_CLIENT_ID'), redirect_uri: redirect(req, 'google'), response_type: 'code',
      scope: GOOGLE_SCOPES.join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true',
      state: newState(user, 'google'),
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  }

  async function googleCallback(req, user, url) {
    if (url.searchParams.get('error')) throw bad(`Google said: ${url.searchParams.get('error')}`);
    if (!takeState(url.searchParams.get('state'), user, 'google')) throw bad('That sign-in link expired. Start again from Settings.');
    const tok = await http('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: url.searchParams.get('code'), client_id: cfg('GOOGLE_CLIENT_ID'), client_secret: cfg('GOOGLE_CLIENT_SECRET'), redirect_uri: redirect(req, 'google'), grant_type: 'authorization_code' }).toString(),
    });
    if (!tok.refresh_token) throw bad('Google did not return a long-lived token. Remove Hope Studio at myaccount.google.com › Security › Third-party access, then connect again.');
    const granted = String(tok.scope || '').split(' ');
    const missing = GOOGLE_SCOPES.filter((s) => !granted.includes(s));
    const profile = await http('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${tok.access_token}` } });
    secrets.set({ GOOGLE_REFRESH_TOKEN: tok.refresh_token, GOOGLE_EMAIL: profile.emailAddress });
    await reload();
    return missing.length ? `Connected as ${profile.emailAddress}, but these permissions were not granted: ${missing.map((m) => m.split('/').pop()).join(', ')}.` : `Gmail and Google Docs connected as ${profile.emailAddress}.`;
  }

  async function testGmail(user) {
    if (!integrations.gmail?.available) throw bad('Gmail is not connected.');
    const to = cfg('GOOGLE_EMAIL');
    const r = await integrations.gmail.send({ to, subject: 'Hope Studio is connected to Gmail', body: `This test was sent by ${user.name} from Hope Studio › Settings.\n\nOutreach emails go out from this account only after Leila or Cierra approves them.` });
    return { ok: true, to, id: r.id };
  }

  async function disconnectGoogle() {
    const refresh = cfg('GOOGLE_REFRESH_TOKEN');
    if (refresh && secrets.source('GOOGLE_REFRESH_TOKEN') === 'app') {
      try { await http(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refresh)}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }); } catch { /* already revoked */ }
    }
    secrets.set({ GOOGLE_REFRESH_TOKEN: null, GOOGLE_EMAIL: null });
    await reload();
    return { ok: true, still_env: secrets.source('GOOGLE_REFRESH_TOKEN') === 'env' };
  }

  // -------------------------------------------------------------------------
  // Meta (Facebook Page + Instagram)

  function setMetaApp({ app_id, app_secret, config_id, public_base_url }) {
    const id = String(app_id || '').trim();
    if (!/^\d{6,}$/.test(id)) throw bad('The Meta App ID is a long number from your app\'s dashboard.');
    const secret = String(app_secret || '').trim();
    if (!secret && !cfg('META_APP_SECRET')) throw bad('Paste the app secret too (App settings › Basic).');
    const base = String(public_base_url || '').trim().replace(/\/$/, '');
    if (base && !/^https:\/\//.test(base)) throw bad('The public address must start with https://');
    secrets.set({ META_APP_ID: id, ...(secret ? { META_APP_SECRET: secret } : {}), META_CONFIG_ID: String(config_id || '').trim() || null, PUBLIC_BASE_URL: base || null });
    return reload().then(() => ({ ok: true }));
  }

  function metaStart(req, user) {
    if (!cfg('META_APP_ID')) throw bad('Save the Meta App ID and secret first.');
    const q = new URLSearchParams({ client_id: cfg('META_APP_ID'), redirect_uri: redirect(req, 'meta'), state: newState(user, 'meta'), response_type: 'code' });
    if (cfg('META_CONFIG_ID')) q.set('config_id', cfg('META_CONFIG_ID'));
    else q.set('scope', META_SCOPES.join(','));
    return `https://www.facebook.com/${cfg('META_GRAPH_VERSION') || 'v21.0'}/dialog/oauth?${q}`;
  }

  async function metaCallback(req, user, url) {
    if (url.searchParams.get('error')) throw bad(`Facebook said: ${url.searchParams.get('error_description') || url.searchParams.get('error')}`);
    if (!takeState(url.searchParams.get('state'), user, 'meta')) throw bad('That sign-in link expired. Start again from Settings.');
    const app = { client_id: cfg('META_APP_ID'), client_secret: cfg('META_APP_SECRET') };
    const short = await http(`${graph()}/oauth/access_token?${new URLSearchParams({ ...app, redirect_uri: redirect(req, 'meta'), code: url.searchParams.get('code') })}`);
    const long = await http(`${graph()}/oauth/access_token?${new URLSearchParams({ ...app, grant_type: 'fb_exchange_token', fb_exchange_token: short.access_token })}`);
    // Page tokens fetched with a long-lived user token do not expire.
    const res = await http(`${graph()}/me/accounts?${new URLSearchParams({ fields: 'id,name,access_token,instagram_business_account{id,username}', limit: '50', access_token: long.access_token })}`);
    const pages = (res.data || []).map((p) => ({ id: p.id, name: p.name, token: p.access_token, ig: p.instagram_business_account || null }));
    if (!pages.length) throw bad('Facebook didn\'t share any Pages. Connect again and tick the Hope Resuscitated Page when Facebook asks which Pages to allow.');
    secrets.set({ META_PAGES: JSON.stringify(pages) });
    const preferred = pages.find((p) => /hope/i.test(p.name)) || pages[0];
    await choosePage({ page_id: preferred.id });
    return pages.length > 1 ? `Connected to ${preferred.name}. You can pick a different Page in Settings.` : `Connected to ${preferred.name}${preferred.ig ? ` and Instagram @${preferred.ig.username || preferred.ig.id}` : ''}.`;
  }

  async function choosePage({ page_id }) {
    const pages = safeJson(secrets.get('META_PAGES')) || [];
    const p = pages.find((x) => x.id === String(page_id));
    if (!p) throw bad('That Page is not in the list Facebook shared.');
    secrets.set({ META_PAGE_ID: p.id, META_PAGE_NAME: p.name, META_PAGE_TOKEN: p.token, META_IG_USER_ID: p.ig?.id || null, META_IG_USERNAME: p.ig?.username || null });
    await reload();
    return { ok: true, page: p.name, ig: p.ig?.username || null };
  }

  async function testMeta() {
    if (!integrations.meta?.available) throw bad('Facebook is not connected.');
    const r = await integrations.meta.check();
    return { ok: true, page: r.page?.name, followers: r.page?.followers_count ?? null, ig: r.ig?.username || null };
  }

  async function disconnectMeta() {
    secrets.set({ META_PAGE_ID: null, META_PAGE_NAME: null, META_PAGE_TOKEN: null, META_IG_USER_ID: null, META_IG_USERNAME: null, META_PAGES: null });
    await reload();
    return { ok: true, still_env: !!secrets.source('META_PAGE_TOKEN') };
  }

  async function disconnectClaude() {
    secrets.set({ ANTHROPIC_API_KEY: null });
    await reload();
    return { ok: true, still_env: secrets.source('ANTHROPIC_API_KEY') === 'env' };
  }

  return {
    status,
    actions: {
      claude: setClaude, 'claude/test': testClaude, 'claude/disconnect': disconnectClaude,
      'google/app': setGoogleApp, 'google/test': (_, user) => testGmail(user), 'google/disconnect': disconnectGoogle,
      'meta/app': setMetaApp, 'meta/page': choosePage, 'meta/test': testMeta, 'meta/disconnect': disconnectMeta,
    },
    start: { google: googleStart, meta: metaStart },
    callback: { google: googleCallback, meta: metaCallback },
  };
}

function bad(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function safeJson(s) {
  try { return s ? JSON.parse(s) : null; } catch { return null; }
}

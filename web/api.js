// Live-only client connection. Hope Studio never falls back to browser/demo/sample data.

export async function connect() {
  try {
    const r = await fetch('api/health', { signal: AbortSignal.timeout(5000), credentials: 'same-origin' });
    if (!r.ok) throw new Error(`Hope Studio backend unavailable (${r.status}).`);
    const health = await r.json();
    if (health.app !== 'hope-studio') throw new Error('Invalid Hope Studio backend response.');
    return remote();
  } catch (err) {
    throw Object.assign(new Error(`Hope Studio requires the live backend. No demo or simulated data is available. ${err.message}`), { code: 'LIVE_BACKEND_REQUIRED' });
  }
}

function remote() {
  async function post(path, body, headers = {}) {
    const r = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'hope-studio', ...headers }, body: body instanceof Blob ? body : JSON.stringify(body ?? {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `Request failed (${r.status})`), { status: r.status });
    return j;
  }
  async function get(path) {
    const r = await fetch(path, { credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `Request failed (${r.status})`), { status: r.status });
    return j;
  }
  return {
    mode: 'live',
    call: async (method, params) => (await post(`api/rpc/${method}`, params)).result,
    connections: () => get('api/connections'),
    connect: async (action, body) => (await post(`api/connections/${action}`, body)).result,
    oauthUrl: (provider) => `api/oauth/${provider}/start`,
    login: (username, password) => post('api/login', { username, password }),
    logout: () => post('api/logout', {}),
    async upload(file) { const j = await post('api/upload', file, { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }); return j.file_url; },
    downloadUrl: (p) => p,
  };
}

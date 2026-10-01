// Connects the app to its backend. With the Hope Studio server running, calls
// go to POST /api/rpc/<method>. Opened on its own (a static host or a preview),
// the same core runs in the browser as a demo that keeps its data locally.

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export async function connect() {
  try {
    const r = await fetch('api/health', { signal: AbortSignal.timeout(2500), credentials: 'same-origin' });
    if (r.ok && (await r.json()).app === 'hope-studio') return remote();
  } catch { /* no server: fall through to the demo */ }
  return demo();
}

function remote() {
  async function post(path, body, headers = {}) {
    const r = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'hope-studio', ...headers },
      body: body instanceof Blob ? body : JSON.stringify(body ?? {}),
    });
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
    async upload(file) {
      const j = await post('api/upload', file, { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) });
      return j.file_url;
    },
    downloadUrl: (p) => p,
  };
}

async function demo() {
  const [{ createStore }, { createService }, { seedAll }, { demoIntegrations }] = await Promise.all([
    import('./core/store.js'), import('./core/service.js'), import('./core/seed.js'), import('./demo.js'),
  ]);
  const KEY = 'hope-studio-demo-v1';
  const adapter = {
    load() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } },
    save(data) { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage blocked or full: the demo keeps working in memory */ } },
  };
  const store = createStore(adapter);
  const integrations = demoIntegrations();
  if (!store.load()) await seedAll(store, integrations);
  const service = createService({ store, integrations });
  let username = 'leila';
  try { username = localStorage.getItem('hope-studio-demo-user') || 'leila'; } catch { /* default */ }
  const actor = () => store.find('users', (u) => u.username === username) || store.all('users')[0];

  // Stand-in for the server scheduler while the page is open.
  setInterval(() => { service.jobs.publishQueue('scheduler').catch(() => {}); service.jobs.wakeSnoozed('scheduler'); }, 60000);

  return {
    mode: 'demo',
    call: async (method, params) => clone(await service.call(method, clone(params) || {}, actor())),
    switchUser(u) {
      username = u;
      try { localStorage.setItem('hope-studio-demo-user', u); } catch { /* per-session only */ }
    },
    users: () => store.all('users').map((u) => ({ username: u.username, name: u.name, role: u.role })),
    upload: async () => null,
    downloadUrl: () => '#',
  };
}

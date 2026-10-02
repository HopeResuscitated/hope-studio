// Hope Studio shell: sidebar, routing, rendering and event wiring. No framework.

import { connect } from './api.js';
import { html, raw, icon, logo, toast, esc } from './ui.js';
import grants from './views/grants.js';
import outreach from './views/outreach.js';
import social from './views/social.js';
import shared from './views/shared.js';
import home from './views/home.js';

const SCREENS = { ...home, ...grants, ...outreach, ...social, ...shared };

const STUDIOS = [
  { key: 'grant', label: 'Grants', sub: 'Grant Studio', home: 'g-week', nav: [['g-week', 'This week'], ['g-scout', 'Find grants'], ['g-writer', 'Drafts'], ['g-kb', 'Knowledge base']] },
  { key: 'outreach', label: 'Outreach', sub: 'Outreach Studio', home: 'o-week', nav: [['o-week', 'This week'], ['o-contacts', 'Contacts'], ['o-scout', 'Prospects'], ['o-writer', 'Drafts'], ['o-board', 'Partnerships'], ['o-kb', 'Knowledge base']] },
  { key: 'social', label: 'Social', sub: 'Social Studio · IG + FB', home: 's-week', nav: [['s-week', 'This week'], ['s-library', 'Library'], ['s-calendar', 'Calendar'], ['s-composer', 'Composer']] },
];
const studioOf = (route) => STUDIOS.find((s) => route.startsWith(s.key[0] + '-')) || null;

// ---------- Per-viewer preferences (remembered tab, filters, selection, theme) ----------

const mem = {};
const store = {
  get(k, d) { try { const v = localStorage.getItem(`hs:${k}`) ?? sessionStorage.getItem(`hs:${k}`); return v === null ? (k in mem ? mem[k] : d) : JSON.parse(v); } catch { return k in mem ? mem[k] : d; } },
  set(k, v) { mem[k] = v; try { localStorage.setItem(`hs:${k}`, JSON.stringify(v)); } catch { /* memory only */ } },
};

function applyTheme(theme) {
  const t = theme || store.get('theme', 'system');
  if (t === 'system') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', t);
  }
}
applyTheme();

// ---------- App object passed to every screen ----------

const app = {
  api: null,
  me: null,
  route: 'home',
  get mode() { return this.api?.mode; },
  async call(method, params) { return this.api.call(method, params); },
  upload(file) { return this.api.upload(file); },
  downloadUrl(p) { return this.api.downloadUrl(p); },
  pref(k, d) { return store.get(`pref:${k}`, d); },
  setPref(k, v) { store.set(`pref:${k}`, v); },
  sel(route) { return store.get(`sel:${route}`, null); },
  setSel(route, id) { store.set(`sel:${route}`, id); },
  go(route, id) {
    if (id !== undefined) this.setSel(route, id);
    if (location.hash.slice(1) === route) this.refresh({ scrollTop: true });
    else location.hash = route;
  },
  refresh(opts) { return render(opts); },
};

// ---------- Rendering ----------

const $ = (s) => document.querySelector(s);
let renderSeq = 0;

function sidebar() {
  const studio = studioOf(app.route);
  const c = app.me.counts;
  const badge = (n) => (n ? html`<span class="badge" aria-label="${n} waiting">${n}</span>` : '');
  const top = (href, label, ic, on, n, alert) => html`<a href="#${href}" class="${on ? 'active' : ''}"${on ? ' aria-current="page"' : ''}>${icon(ic, 18)} ${label} ${n ? html`<span class="badge${alert ? ' badge-alert' : ''}">${n}</span>` : ''}</a>`;
  const area = (s, ic) => html`<div class="side-area">${top(s.home, s.label, ic, studio?.key === s.key && !s.nav.some(([r]) => r === app.route && r !== s.home), c[s.key])}
    ${studio?.key === s.key ? html`<div class="side-sub-nav">${s.nav.filter(([r]) => r !== s.home).map(([r, l]) => html`<a href="#${r}" class="${app.route === r || (r === 's-calendar' && app.route === 's-copy') ? 'active' : ''}"${app.route === r ? ' aria-current="page"' : ''}>${l}</a>`)}</div>` : ''}</div>`;
  return html`
    <div class="side-brand">
      ${logo(40)}
      <div class="wordmark"><span class="wm-top">HOPE</span><span class="wm-bottom">RESUSCITATED</span></div>
    </div>
    <button type="button" class="side-search-btn" data-action="openSearch" aria-label="Search everything">
      ${icon('search', 16)} <span>Search</span> <kbd>Ctrl+K</kbd>
    </button>
    <nav class="side-nav" aria-label="Hope Studio">
      ${top('home', 'Home', 'pulse', app.route === 'home')}
      ${top('inbox', 'Approvals', 'inbox', app.route === 'inbox', c.inbox)}
      ${area(STUDIOS[0], 'doc')}${area(STUDIOS[1], 'mail')}${area(STUDIOS[2], 'photo')}
    </nav>
    <nav class="side-nav side-shared" aria-label="More">
      ${top('activity', 'Activity', 'calendar', app.route === 'activity', c.alerts, true)}
      ${top('settings', 'Settings', 'gear', app.route === 'settings')}
    </nav>
    <div class="side-foot">
      <div class="side-user"><span>${app.me.user.name}<small>${app.me.user.role === 'admin' ? 'Admin · approver' : 'Approver'}</small></span>
      ${app.mode === 'live' ? html`<button type="button" class="icon-btn" data-action="logout" aria-label="Sign out">${icon('logout')}</button>` : ''}</div>
    </div>`;
}

function demoBar() {
  if (app.mode !== 'demo') return '';
  const users = app.api.users();
  return html`<div class="demo-bar" role="note">
    <span><strong>Demo.</strong> Runs in your browser with sample data; nothing is emailed or posted. ${app.me.llm ? '' : 'Agents draft from templates built on the knowledge base.'}</span>
    <label class="row gap-xs">Signed in as <select data-change-global="switchUser" aria-label="Switch user">${users.map((u) => html`<option value="${u.username}"${u.username === app.me.user.username ? ' selected' : ''}>${u.name} (${u.role === 'admin' ? 'admin' : 'approver'})</option>`)}</select></label>
  </div>`;
}

// Phone tab bar: the approvals inbox and each studio one tap away.
function tabbar() {
  const st = studioOf(app.route);
  const c = app.me.counts;
  const tab = (href, label, ic, on, n) => html`<a href="#${href}" class="${on ? 'on' : ''}"${on ? ' aria-current="page"' : ''}>${icon(ic, 20)}<span>${label}</span>${n ? html`<b class="tab-badge">${n}</b>` : ''}</a>`;
  return html`${tab('home', 'Home', 'pulse', app.route === 'home')}
    ${tab('inbox', 'Approvals', 'inbox', app.route === 'inbox', c.inbox)}
    ${tab('g-week', 'Grants', 'doc', st?.key === 'grant', c.grant)}
    ${tab('o-week', 'Outreach', 'mail', st?.key === 'outreach', c.outreach)}
    ${tab('s-week', 'Social', 'photo', st?.key === 'social', c.social)}
    <button type="button" data-action="menu" aria-label="More">${icon('menu', 20)}<span>More</span></button>`;
}

async function render({ scrollTop = false } = {}) {
  const seq = ++renderSeq;
  const route = (location.hash.slice(1) || store.get('lastRoute', 'home')).split('~')[0];
  const screen = SCREENS[route] ? route : 'home';
  const changed = screen !== app.route;
  app.route = screen;
  store.set('lastRoute', screen);
  const st = studioOf(screen);
  if (st) store.set('studio', st.key);
  const main = $('#main');
  const keepScroll = changed || scrollTop ? 0 : window.scrollY;
  document.body.classList.add('loading');
  try {
    const [me, data] = await Promise.all([app.call('me'), SCREENS[screen].load(app)]);
    if (seq !== renderSeq) return;
    app.me = me;
    $('#side').innerHTML = String(sidebar());
    $('#tabbar').innerHTML = String(tabbar());
    $('#demo').innerHTML = String(demoBar());
    const focusId = !changed && document.activeElement?.id;
    main.innerHTML = String(SCREENS[screen].render(data, app));
    document.title = `${SCREENS[screen].title} · Hope Studio`;
    $('#topbar-title').textContent = SCREENS[screen].title;
    if (changed) {
      document.body.classList.remove('nav-open');
      window.scrollTo(0, 0);
      main.querySelector('h1')?.setAttribute('tabindex', '-1');
      main.querySelector('h1')?.focus({ preventScroll: true });
    } else {
      window.scrollTo(0, keepScroll);
      if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
    }
  } catch (err) {
    if (err.status === 401) return showLogin();
    main.innerHTML = String(html`<div class="empty"><h1>That didn't load</h1><p>${err.message}</p><button type="button" class="btn" data-action="reload">Try again</button></div>`);
  } finally {
    document.body.classList.remove('loading');
  }
}

// ---------- Login (server mode) ----------

function showLogin() {
  document.body.classList.add('signed-out');
  $('#login').hidden = false;
  $('#login').innerHTML = String(html`<form class="login-card" id="login-form">
    <div class="side-brand">${logo(44)}<div class="wordmark"><span class="wm-top">HOPE</span><span class="wm-bottom">RESUSCITATED</span></div></div>
    <h1>Hope Studio</h1><p class="muted">Grants, outreach and social in one place. Nothing goes out without your OK.</p>
    <div class="field"><label for="u">Username</label><input id="u" name="username" autocomplete="username" required autofocus></div>
    <div class="field"><label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required></div>
    <p class="form-error" id="login-error" role="alert"></p>
    <button type="submit" class="btn btn-primary">Sign in</button>
  </form>`);
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await app.api.login(f.get('username'), f.get('password'));
      $('#login').hidden = true;
      document.body.classList.remove('signed-out');
      render();
    } catch (err) {
      $('#login-error').textContent = err.message;
    }
  });
}

// ---------- Global Search / Command Palette ----------

async function openSearchDialog(app) {
  const host = document.getElementById('dialog');
  host.innerHTML = String(html`
    <div class="scrim" data-close></div>
    <div class="cmd-palette" role="dialog" aria-modal="true" aria-label="Search">
      <div class="cmd-head">
        ${icon('search', 20)}
        <input id="cmd-input" type="search" placeholder="Search grants, prospects, posts, knowledge base, facts..." autocomplete="off" autofocus>
        <button type="button" class="icon-btn" data-close aria-label="Close">${icon('close', 18)}</button>
      </div>
      <div class="cmd-body" id="cmd-results">
        <p class="muted small pad-m">Type to search across Hope Studio...</p>
      </div>
      <div class="cmd-foot">
        <span><kbd>Esc</kbd> to close</span>
        <span><kbd>↑</kbd><kbd>↓</kbd> to navigate</span>
        <span><kbd>Enter</kbd> to open</span>
      </div>
    </div>
  `);
  host.hidden = false;

  const input = document.getElementById('cmd-input');
  const resultsEl = document.getElementById('cmd-results');
  const close = () => { host.hidden = true; host.innerHTML = ''; };

  host.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));

  let debounce = null;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    const q = input.value.trim();
    if (!q) {
      resultsEl.innerHTML = `<p class="muted small pad-m">Type to search across Hope Studio...</p>`;
      return;
    }
    debounce = setTimeout(async () => {
      resultsEl.innerHTML = `<p class="muted small pad-m">Searching...</p>`;
      try {
        const res = await app.call('searchAll', { query: q });
        if (!res.results?.length) {
          resultsEl.innerHTML = `<div class="cmd-empty"><p class="muted">No matches found for "${esc(q)}".</p></div>`;
          return;
        }
        resultsEl.innerHTML = res.results.map((r) => `
          <button type="button" class="cmd-item" data-route="${r.route}" data-id="${r.id}">
            <span class="cmd-type cmd-${r.type}">${r.type.replace('_', ' ')}</span>
            <div class="cmd-info">
              <strong class="cmd-title">${esc(r.title)}</strong>
              <span class="cmd-sub">${esc(r.sub)}</span>
            </div>
            ${icon('right', 16, 'cmd-arrow')}
          </button>
        `).join('');

        resultsEl.querySelectorAll('.cmd-item').forEach((btn) => {
          btn.addEventListener('click', () => {
            const route = btn.dataset.route;
            const id = btn.dataset.id;
            close();
            app.go(route, id);
          });
        });
      } catch (err) {
        resultsEl.innerHTML = `<p class="bad-text small pad-m">${esc(err.message)}</p>`;
      }
    }, 150);
  });

  input.focus();
}

function openShortcutsDialog() {
  dialog({
    title: 'Keyboard Shortcuts',
    submit: '',
    cancel: 'Close',
    body: html`
      <table class="table shortcuts-table">
        <tbody>
          <tr><td><kbd>Ctrl+K</kbd> / <kbd>Cmd+K</kbd></td><td>Open quick search across everything</td></tr>
          <tr><td><kbd>/</kbd></td><td>Focus search from anywhere</td></tr>
          <tr><td><kbd>?</kbd></td><td>Open this keyboard shortcuts help</td></tr>
          <tr><td><kbd>Esc</kbd></td><td>Close dialogs, search, or side navigation</td></tr>
        </tbody>
      </table>
      <div class="mt-m">
        <h3 class="mono-label">Navigation</h3>
        <p class="muted small">Switch between studios (Grants, Outreach, Social) or access the Approvals Inbox from the sidebar.</p>
      </div>
    `,
  });
}

// ---------- Events ----------

const GLOBAL = {
  studio(el) { const s = STUDIOS.find((x) => x.key === el.dataset.key); app.go(s.home); },
  go(el) { app.go(el.dataset.route, el.dataset.id); },
  setPref(el) { const v = el.dataset.value; app.setPref(el.dataset.key, v === '' ? false : v === '1' ? true : v); app.refresh(); },
  reload() { app.refresh(); },
  menu() { document.body.classList.toggle('nav-open'); },
  async logout() { await app.api.logout(); location.reload(); },
  openSearch() { openSearchDialog(app); },
  openShortcuts() { openShortcutsDialog(); },
  toggleTheme() {
    const cur = store.get('theme', 'system');
    const next = cur === 'system' ? 'dark' : cur === 'dark' ? 'light' : 'system';
    store.set('theme', next);
    applyTheme(next);
    toast(`Theme: ${next.charAt(0).toUpperCase() + next.slice(1)}`);
    app.refresh();
  },
  async runAgents(el) {
    toast('Agents are running…', 'info');
    const out = await app.call('runAgents', { agent: el.dataset.agent || 'all' });
    toast(out.map((r) => r.summary).join(' '));
    app.refresh();
  },
};

// Global keyboard shortcuts
document.addEventListener('keydown', (ev) => {
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') {
    ev.preventDefault();
    openSearchDialog(app);
    return;
  }
  if (ev.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
    ev.preventDefault();
    openSearchDialog(app);
    return;
  }
  if (ev.key === '?' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
    ev.preventDefault();
    openShortcutsDialog();
    return;
  }
});

// Cards and rows that act like buttons (data-action on a non-button) work from the keyboard too.
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  const el = ev.target.closest?.('[data-action][tabindex]');
  if (!el || el !== ev.target || ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) return;
  ev.preventDefault();
  el.click();
});

function handler(kind, name) {
  const screen = SCREENS[app.route];
  return screen?.[kind]?.[name] || null;
}

async function run(el, fn) {
  if (el) el.setAttribute('aria-busy', 'true');
  if (el && 'disabled' in el) el.disabled = true;
  try {
    await fn();
  } catch (err) {
    if (err.status === 401) return showLogin();
    toast(err.message, 'bad');
  } finally {
    if (el) { el.removeAttribute('aria-busy'); if ('disabled' in el && el.isConnected) el.disabled = false; }
  }
}

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el || !el.dataset.action) return;
  const name = el.dataset.action;
  const fn = handler('actions', name) || GLOBAL[name];
  if (!fn) return;
  if (el.tagName === 'A') ev.preventDefault();
  run(el, () => fn(el, app, ev));
});

document.addEventListener('submit', (ev) => {
  const form = ev.target.closest('form[data-submit]');
  if (!form) return;
  ev.preventDefault();
  const fn = handler('submits', form.dataset.submit);
  if (!fn) return;
  const data = {};
  for (const [k, v] of new FormData(form).entries()) data[k] = k in data ? [].concat(data[k], v) : v;
  run(form.querySelector('[type=submit]'), () => fn(data, app, form));
});

document.addEventListener('change', (ev) => {
  const el = ev.target;
  if (el.dataset?.changeGlobal === 'switchUser') {
    app.api.switchUser(el.value);
    toast(`Now acting as ${el.selectedOptions[0].textContent.split(' (')[0]}`, 'info');
    return app.refresh();
  }
  const form = el.closest('form[data-change-form]');
  if (form && !el.dataset.change) {
    const fn = handler('formChanges', form.dataset.changeForm);
    const data = {};
    for (const [k, v] of new FormData(form).entries()) data[k] = v;
    if (fn) return run(null, () => fn(data, app, form));
  }
  if (!el.dataset?.change) return;
  const fn = handler('changes', el.dataset.change);
  if (fn) run(null, () => fn(el, app, ev));
});

// Live character counts on editors.
document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (el.dataset?.input !== 'count') return;
  const counter = document.getElementById('counter');
  if (!counter) return;
  const limit = +el.dataset.limit;
  const n = el.value.length;
  counter.textContent = `${n.toLocaleString('en-US')} / ${limit.toLocaleString('en-US')}${n > limit ? ` · ${n - limit} over` : ''}`;
  counter.classList.toggle('over', n > limit);
});

// Drag and drop onto drop zones.
document.addEventListener('dragover', (ev) => { const z = ev.target.closest('[data-drop]'); if (z) { ev.preventDefault(); z.classList.add('over'); } });
document.addEventListener('dragleave', (ev) => { const z = ev.target.closest('[data-drop]'); if (z) z.classList.remove('over'); });
document.addEventListener('drop', (ev) => {
  const z = ev.target.closest('[data-drop]');
  if (!z) return;
  ev.preventDefault();
  z.classList.remove('over');
  const fn = handler('drops', z.dataset.drop);
  if (fn) run(null, () => fn([...ev.dataTransfer.files], app));
});

window.addEventListener('hashchange', () => render());

// ---------- Boot ----------

(async () => {
  $('#topbar').innerHTML = String(html`
    <button type="button" class="icon-btn" data-action="menu" aria-label="Menu">${icon('menu', 22)}</button>
    <div class="topbar-brand">${logo(26)}<span id="topbar-title">Hope Studio</span></div>
    <div class="topbar-actions">
      <button type="button" class="icon-btn" data-action="openSearch" aria-label="Search" title="Quick search (Ctrl+K)">${icon('search', 18)}</button>
      <button type="button" class="icon-btn" data-action="toggleTheme" aria-label="Toggle theme" title="Toggle theme">${icon('sun', 18)}</button>
    </div>
  `);
  try {
    app.api = await connect();
  } catch (err) {
    $('#main').innerHTML = `<div class="empty"><h1>Hope Studio could not start</h1><p>${esc(err.message)}</p></div>`;
    return;
  }
  document.body.dataset.mode = app.api.mode;
  // Back from Google or Facebook sign-in.
  const q = new URLSearchParams(location.search);
  if (q.has('connected') || q.has('connect_error')) {
    history.replaceState(null, '', location.pathname + location.hash);
    setTimeout(() => toast(q.get('msg') || q.get('connect_error'), q.has('connect_error') ? 'bad' : 'good'), 400);
  }
  await render();
  document.body.classList.add('ready');
  // Installable app and an offline shell (only where the browser allows it).
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* previews and some embeds refuse this */ });
  }
})();

export { raw };

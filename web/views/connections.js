// Settings › Connect your accounts: Claude, Gmail + Google Docs, Facebook + Instagram.
// Keys are sent once to the server and never come back to the browser.

import { html, icon, chip, field, toast, dialog, copyText } from '../ui.js';

const ext = (href, label) => html`<a href="${href}" target="_blank" rel="noopener">${label} ${icon('external', 13)}</a>`;
const copyable = (text) => html`<span class="copy-row"><code class="copy-code">${text}</code><button type="button" class="btn btn-sm" data-action="copyValue" data-text="${text}">${icon('copy', 14)} Copy</button></span>`;
const sourceLabel = (s) => (s === 'env' ? 'from the server\'s .env file' : 'saved in Settings');

function claudeCard(c, admin) {
  return html`<article class="card conn-card" aria-labelledby="c-claude">
    <div class="card-top"><h3 class="section-title" id="c-claude">Claude</h3>${c.connected ? chip('Connected', 'good') : chip('Not connected', 'muted')}</div>
    ${!c.connected && c.engine ? html`<p class="small muted">The agents are using ${c.engine === 'ollama' ? 'a local Ollama model' : 'an OpenAI-compatible server'} right now. A Claude key saved here takes over unless <code>LLM_PROVIDER</code> in .env says otherwise.</p>` : ''}
    <p class="small">Drafting and review with Claude Sonnet 5, final grant drafts with Claude Opus 5.5, and photo and video tagging with Claude Haiku 4.5. Without it, the agents write from templates built on your knowledge base.</p>
    ${c.connected ? html`
      <p class="small">Using key <code>${c.hint}</code>, ${sourceLabel(c.source)}. Each run is capped by the budget under Approvals and spend.</p>
      ${admin ? html`<div class="row gap-s wrap"><button type="button" class="btn btn-sm" data-action="connTest" data-kind="claude">Test connection</button>${c.source === 'app' ? html`<button type="button" class="btn btn-sm btn-ghost" data-action="connDisconnect" data-kind="claude">Disconnect</button>` : ''}</div>` : ''}`
    : html`
      ${c.reason && /npm install/.test(c.reason) ? html`<p class="banner small">${icon('alert')}<span>${c.reason}</span></p>` : ''}
      <ol class="steps small">
        <li>Sign in at ${ext('https://console.anthropic.com/', 'console.anthropic.com')} with the team account. Ask about Claude for Nonprofits pricing.</li>
        <li>Open <strong>API keys</strong> and create a key named “Hope Studio”.</li>
        <li>Under <strong>Limits</strong>, set a monthly spend limit.</li>
        <li>Paste the key here.</li>
      </ol>
      ${admin ? html`<form class="row gap-s wrap" data-submit="connClaude"><label class="sr-only" for="f-api_key">Anthropic API key</label><input id="f-api_key" name="api_key" type="password" autocomplete="off" placeholder="sk-ant-…" required class="grow"><button type="submit" class="btn btn-primary">Connect Claude</button></form>` : html`<p class="muted small">Leila connects this.</p>`}`}
  </article>`;
}

function googleCard(g, admin) {
  return html`<article class="card conn-card" aria-labelledby="c-google">
    <div class="card-top"><h3 class="section-title" id="c-google">Gmail and Google Docs</h3>${g.connected ? chip('Connected', 'good') : g.app ? chip('Ready to sign in', 'warn') : chip('Not connected', 'muted')}</div>
    <p class="small">Sends outreach only after someone approves it, saves Gmail drafts, notices replies and “stop” opt-outs, and exports approved grant drafts to Google Docs.</p>
    ${g.connected ? html`
      <p class="small">Connected as <strong>${g.email || 'your Google account'}</strong>. Emails go out from this address.</p>
      ${admin ? html`<div class="row gap-s wrap"><button type="button" class="btn btn-sm" data-action="connTest" data-kind="google">Send me a test email</button><a class="btn btn-sm" href="api/oauth/google/start">Reconnect</a><button type="button" class="btn btn-sm btn-ghost" data-action="connDisconnect" data-kind="google">Disconnect</button></div>` : ''}`
    : html`
      <ol class="steps small">
        <li>At ${ext('https://console.cloud.google.com/projectcreate', 'Google Cloud Console')}, create a project named “Hope Studio”.</li>
        <li>In <strong>APIs &amp; Services › Library</strong>, enable the <strong>Gmail API</strong> and the <strong>Google Docs API</strong>.</li>
        <li>In <strong>OAuth consent screen</strong>, choose <strong>Internal</strong> (for a Google Workspace account like Team@hope-resuscitated.org). With a personal Gmail, choose External and add yourself as a test user; Google signs test users out after 7 days until the app is published.</li>
        <li>In <strong>Credentials › Create credentials › OAuth client ID</strong>, pick <strong>Web application</strong> and add this authorized redirect URI:<br>${copyable(g.redirect_uri)}</li>
        <li>Paste the client ID and secret below, save, then connect and sign in as Team@hope-resuscitated.org.</li>
      </ol>
      ${admin ? html`<form class="stack-s" data-submit="connGoogleApp">
        <div class="form-grid">${field('Client ID', 'client_id', { placeholder: g.client_hint || '…apps.googleusercontent.com', required: true })}${field('Client secret', 'client_secret', { type: 'password', required: true })}</div>
        <div class="row gap-s wrap"><button type="submit" class="btn">${g.app ? 'Replace app details' : 'Save app details'}</button>${g.app ? html`<a class="btn btn-primary" href="api/oauth/google/start">${icon('mail', 16)} Connect Gmail</a>` : ''}</div>
      </form>` : html`<p class="muted small">Leila connects this.</p>`}`}
  </article>`;
}

function metaCard(m, conn, admin) {
  const noPublic = !conn.public_base_url;
  return html`<article class="card conn-card" aria-labelledby="c-meta">
    <div class="card-top"><h3 class="section-title" id="c-meta">Facebook and Instagram</h3>${m.connected ? chip('Connected', 'good') : m.app ? chip('Ready to sign in', 'warn') : chip('Not connected', 'muted')}</div>
    <p class="small">Publishes approved posts and Reels to the Facebook Page and its linked Instagram professional account. Nothing posts before its approval and scheduled time.</p>
    ${m.connected ? html`
      <p class="small">Page: <strong>${m.page?.name || m.page?.id}</strong>${m.ig ? html` · Instagram <strong>@${m.ig.username || m.ig.id}</strong>` : html` · <span class="warn-text">no Instagram account linked to this Page</span>`}</p>
      ${m.pages.length > 1 && admin ? html`<div class="field"><label for="f-page">Post to</label><select id="f-page" data-change="connPage">${m.pages.map((p) => html`<option value="${p.id}"${p.id === m.page?.id ? ' selected' : ''}>${p.name}${p.ig ? ` (Instagram @${p.ig})` : ''}</option>`)}</select></div>` : ''}
      ${noPublic && m.ig ? html`<p class="banner small">${icon('alert')}<span>Facebook posts upload the file directly. Instagram fetches media from a public https address, so add one below once Hope Studio runs on a server with a domain.</span></p>` : ''}
      ${admin ? html`<div class="row gap-s wrap"><button type="button" class="btn btn-sm" data-action="connTest" data-kind="meta">Check connection</button><a class="btn btn-sm" href="api/oauth/meta/start">Reconnect</a><button type="button" class="btn btn-sm btn-ghost" data-action="connDisconnect" data-kind="meta">Disconnect</button></div>` : ''}`
    : html`
      <ol class="steps small">
        <li>At ${ext('https://developers.facebook.com/apps/', 'developers.facebook.com')}, create an app for managing a business, named “Hope Studio”.</li>
        <li>Add <strong>Facebook Login</strong>, and in its settings add this valid OAuth redirect URI:<br>${copyable(m.redirect_uri)}</li>
        <li>In <strong>App roles</strong>, add Leila and Cierra. While the app stays in development mode, people with a role can post to Pages they manage; App Review is only needed beyond that.</li>
        <li>In Meta Business Suite, link the Instagram professional account to the Hope Resuscitated Facebook Page.</li>
        <li>Paste the App ID and App secret (<strong>App settings › Basic</strong>), save, then connect and choose the Page.</li>
      </ol>`}
    ${admin && (!m.connected || noPublic) ? html`<form class="stack-s" data-submit="connMetaApp">
      <div class="form-grid">
        ${field('App ID', 'app_id', { value: m.app_id, required: true })}
        ${field('App secret', 'app_secret', { type: 'password', placeholder: m.app ? 'Saved (leave blank to keep)' : '' })}
        ${field('Login configuration ID (optional)', 'config_id', { value: m.config_id, hint: 'Only if your app uses Facebook Login for Business.' })}
        ${field('Public https address (optional)', 'public_base_url', { value: conn.public_base_url, placeholder: 'https://studio.hope-resuscitated.org', hint: 'Needed for Instagram, and it changes the redirect URIs above.' })}
      </div>
      <div class="row gap-s wrap"><button type="submit" class="btn">${m.app ? 'Save changes' : 'Save app details'}</button>${m.app && !m.connected ? html`<a class="btn btn-primary" href="api/oauth/meta/start">Connect Facebook</a>` : ''}</div>
    </form>` : ''}
    ${!admin && !m.connected ? html`<p class="muted small">Leila connects this.</p>` : ''}
  </article>`;
}

export function connectionsSection(d, app) {
  const admin = app.me.user.role === 'admin';
  if (app.mode !== 'live' || !d.conn) {
    return html`<section class="card stack-s span-2" aria-labelledby="conn-h">
      <h2 class="section-title" id="conn-h">Connect your accounts</h2>
      <p class="small">Connecting Claude, Gmail and Facebook needs the Hope Studio server, because keys and sign-ins must stay off the browser. Start it with <code>npm start</code>, sign in as Leila, and connect them here.</p>
      <p class="muted small">This demo uses sample feeds for Grants.gov and Places, and nothing is emailed or posted.</p>
    </section>`;
  }
  const c = d.conn;
  return html`<section class="stack-s span-2" aria-labelledby="conn-h">
    <div class="stack-xs"><h2 class="section-title" id="conn-h">Connect your accounts</h2>
    <p class="muted small">${admin ? 'Keys and sign-ins are stored on this server only; the browser never sees them again.' : 'Only Leila can connect or disconnect accounts.'} Hope Studio is reached at <code>${c.base_url}</code>. If that changes, update the redirect URIs.</p></div>
    <div class="conn-grid">${claudeCard(c.claude, admin)}${googleCard(c.google, admin)}${metaCard(c.meta, c, admin)}</div>
    <p class="muted small">Also available: Grants.gov search is ${d.integrations.grantsgov ? 'on' : 'off'}, and Google Places for Prospect Scout is ${d.integrations.places ? 'on' : 'off'} (set <code>GOOGLE_PLACES_API_KEY</code> in .env).</p>
  </section>`;
}

const LABEL = { claude: 'Claude', google: 'Gmail and Google Docs', meta: 'Facebook and Instagram' };

export const connectionSubmits = {
  async connClaude(data, app) {
    await app.api.connect('claude', { api_key: data.api_key });
    toast('Claude is connected. The agents now draft with Claude.');
    app.refresh();
  },
  async connGoogleApp(data, app) {
    await app.api.connect('google/app', data);
    toast('Saved. Now click Connect Gmail.');
    app.refresh();
  },
  async connMetaApp(data, app) {
    await app.api.connect('meta/app', data);
    toast('Saved.');
    app.refresh();
  },
};

export const connectionActions = {
  copyValue(el) { copyText(el.dataset.text, el.previousElementSibling); },
  async connTest(el, app) {
    const r = await app.api.connect(`${el.dataset.kind}/test`, {});
    if (el.dataset.kind === 'claude') toast(`Claude answered. Models in use: ${r.models.join(', ')}.`);
    else if (el.dataset.kind === 'google') toast(`Test email sent to ${r.to}.`);
    else toast(`Connected to ${r.page}${r.followers !== null ? ` (${r.followers.toLocaleString('en-US')} followers)` : ''}${r.ig ? ` and Instagram @${r.ig}` : ''}.`);
  },
  async connDisconnect(el, app) {
    const kind = el.dataset.kind;
    const ok = await dialog({ title: `Disconnect ${LABEL[kind]}?`, submit: 'Disconnect', body: html`<p>${kind === 'claude' ? 'The agents go back to drafting from templates.' : kind === 'google' ? 'Approved emails stop sending and grant exports save as Word files until you reconnect.' : 'Approved posts wait in the queue until you reconnect.'}</p>` });
    if (!ok) return;
    const r = await app.api.connect(`${kind}/disconnect`, {});
    toast(r.still_env ? 'Disconnected here, but the server\'s .env file still has credentials for it.' : `${LABEL[kind]} disconnected.`, r.still_env ? 'info' : 'good');
    app.refresh();
  },
};

export const connectionChanges = {
  async connPage(el, app) {
    const r = await app.api.connect('meta/page', { page_id: el.value });
    toast(`Posting to ${r.page}${r.ig ? ` and Instagram @${r.ig}` : ''}.`);
    app.refresh();
  },
};

// Shared screens: Approvals inbox · Activity (runs, audit log, alerts) · Settings

import { html, icon, chip, fdate, ago, dialog, field, toast, plural, money, esc, copyText } from '../ui.js';
import { connectionsSection, connectionSubmits, connectionActions, connectionChanges } from './connections.js';

const AGENT_TAB = [['all', 'All agents'], ['grant', 'Grants'], ['outreach', 'Outreach'], ['social', 'Social']];
const GROUPS = [
  ['needs_you', 'Needs your OK', 'Reviewer is done. A person decides.'],
  ['approved', 'Approved, waiting to run', 'Scheduled posts and approved items the Executor has not acted on yet.'],
  ['in_review', 'In review', ''],
  ['snoozed', 'Snoozed', ''],
  ['executed', 'Done', 'Sent, posted or exported.'],
  ['rejected', 'Rejected', ''],
];

const inbox = {
  title: 'Approvals inbox',
  load: (app) => app.call('inbox'),
  render(d, app) {
    const tab = app.pref('inboxAgent', 'all');
    const rows = d.rows.filter((r) => tab === 'all' || r.agent === tab);
    const isApprover = ['admin', 'approver'].includes(app.me.user.role);
    return html`
    <header class="page-head">
      <div class="head-text"><span class="eyebrow">Approvals inbox</span><h1>Nothing goes out without a person's OK.</h1>
      <p class="lede">Every draft moves through drafted → in review → needs you → approved → done. The Executor refuses anything that isn't approved, and that rule lives in the data layer, not just this screen.</p></div>
    </header>
    <div class="filters" role="group" aria-label="Filter by agent">${AGENT_TAB.map(([k, l]) => html`<button type="button" aria-pressed="${tab === k}" data-action="setPref" data-key="inboxAgent" data-value="${k}">${l}${k !== 'all' ? html` <span class="count">${d.rows.filter((r) => r.agent === k && r.state === 'needs_you').length}</span>` : ''}</button>`)}</div>
    ${GROUPS.map(([state, label, note]) => {
    const list = rows.filter((r) => r.state === state);
    if (!list.length) return '';
    const collapsed = ['executed', 'rejected'].includes(state) && !app.pref(`open-${state}`, false);
    return html`<section class="inbox-group" aria-labelledby="g-${state}">
      <div class="row between"><h2 class="section-title" id="g-${state}">${label} <span class="count">${list.length}</span></h2>${collapsed ? html`<button type="button" class="link-btn" data-action="setPref" data-key="open-${state}" data-value="1">Show</button>` : ''}</div>
      ${note ? html`<p class="muted small">${note}</p>` : ''}
      ${collapsed ? '' : html`<div class="table-wrap"><table class="table inbox-table">
        <thead><tr><th scope="col">Item</th><th scope="col">Agent</th><th scope="col">Reviewer</th><th scope="col">Updated</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>${list.slice(0, 60).map((r) => html`<tr>
          <td><button type="button" class="link-btn strong" data-action="go" data-route="${r.link.route}" data-id="${r.link.id}">${r.title}</button><div class="muted small">${r.detail?.when ? fdate(r.detail.when, { time: true }) + ' · ' : ''}${r.detail?.to || ''}${r.detail?.request ? money(r.detail.request) + ' request' : ''}${r.decided_by_name ? ` · ${state === 'rejected' ? 'rejected' : 'approved'} by ${r.decided_by_name}` : ''}</div></td>
          <td class="nowrap">${r.agent_label}</td>
          <td>${r.flags_list.length ? r.flags_list.slice(0, 3).map((f) => chip(f.label, f.blocking ? 'warn' : 'muted')) : chip('All checks pass', 'good')}</td>
          <td class="nowrap small">${ago(r.updated_at)}</td>
          <td class="nowrap">${state === 'needs_you' && isApprover ? html`<div class="row gap-xs">
            <button type="button" class="btn btn-sm btn-primary" data-action="approve" data-id="${r.id}"${r.blocking ? ` disabled title="Fix the blocking flags first"` : ''}>Approve</button>
            <button type="button" class="btn btn-sm" data-action="snooze" data-id="${r.id}">Snooze</button>
            <button type="button" class="btn btn-sm btn-ghost" data-action="reject" data-id="${r.id}">Reject</button></div>`
    : ['rejected', 'snoozed'].includes(state) && isApprover ? html`<button type="button" class="btn btn-sm" data-action="reopen" data-id="${r.id}">Reopen</button>` : ''}</td>
        </tr>`)}</tbody></table></div>`}
    </section>`;
  })}
    ${!rows.length ? html`<div class="empty"><p>Nothing here yet.</p></div>` : ''}`;
  },
  actions: {
    async approve(el, app) {
      const r = await app.call('approve', { id: el.dataset.id });
      toast(r?.status === 'scheduled' ? 'Approved and scheduled' : 'Approved. Open the item to send or export it.');
      app.refresh();
    },
    async snooze(el, app) { await app.call('snooze', { id: el.dataset.id, days: 3 }); toast('Snoozed for 3 days'); app.refresh(); },
    async reject(el, app) {
      const d = await dialog({ title: 'Reject this draft?', submit: 'Reject', body: field('Why (helps the agents next time)', 'note', { rows: 3 }) });
      if (!d) return;
      await app.call('reject', { id: el.dataset.id, note: d.note });
      toast('Rejected');
      app.refresh();
    },
    async reopen(el, app) { await app.call('reopen', { id: el.dataset.id }); toast('Back in review'); app.refresh(); },
  },
};

// ---------------------------------------------------------------------------

const activity = {
  title: 'Activity',
  load: (app) => app.call('activity', { type: app.pref('auditType', 'all') }),
  render(d, app) {
    const t = app.pref('auditType', 'all');
    return html`
    <header class="page-head">
      <div class="head-text"><span class="eyebrow">Activity</span><h1>Every run, approval, send and post</h1>
      <p class="lede">The audit log records who did what and when, with before and after snapshots, so you have a record for funders and the board.</p></div>
      <a class="btn" href="${app.downloadUrl('api/audit.csv')}" data-action="${app.mode === 'demo' ? 'csvDemo' : ''}">${icon('doc', 16)} Export CSV</a>
    </header>
    ${d.alerts.length ? html`<section aria-labelledby="alerts-h"><h2 class="section-title" id="alerts-h">Alerts</h2>${d.alerts.map((a) => html`<div class="banner ${a.level === 'critical' ? 'banner-bad' : ''}">${icon('alert')}<span class="grow"><strong>${a.title}</strong>${a.detail ? ` ${a.detail}` : ''} <span class="muted small">${ago(a.created_at)}</span></span><button type="button" class="btn btn-sm" data-action="resolveAlert" data-id="${a.id}">Resolve</button></div>`)}</section>` : ''}
    <section class="card" aria-labelledby="runs-h">
      <div class="card-top"><h2 class="section-title" id="runs-h">Agent runs</h2><span class="muted small">Model spend this month: $${d.spend.toFixed(2)}</span></div>
      <div class="table-wrap"><table class="table"><thead><tr><th scope="col">Started</th><th scope="col">Agent</th><th scope="col">Trigger</th><th scope="col">Status</th><th scope="col">Summary</th><th scope="col" class="num">Cost</th></tr></thead>
      <tbody>${d.runs.map((r) => html`<tr><td class="nowrap small">${fdate(r.started_at, { time: true })}</td><td>${r.agent}</td><td>${r.trigger}</td><td>${chip(r.status.replace('_', ' '), r.status === 'succeeded' ? 'good' : r.status === 'running' ? 'info' : 'warn')}</td><td class="small">${r.summary}${r.log?.length ? html`<details><summary>Log (${r.log.length})</summary><ul class="small">${r.log.map((l) => html`<li>${l.line}</li>`)}</ul></details>` : ''}</td><td class="num small">$${(r.cost_usd || 0).toFixed(3)}</td></tr>`)}
      ${!d.runs.length ? html`<tr><td colspan="6" class="muted">No runs yet. The weekly run starts Mondays at 6:00 AM Central.</td></tr>` : ''}</tbody></table></div>
    </section>
    <section class="card" aria-labelledby="audit-h">
      <div class="card-top wrap"><h2 class="section-title" id="audit-h">Audit log</h2>
        <div class="filters" role="group" aria-label="Filter log">${[['all', 'All'], ['approval', 'Approvals'], ['outreach', 'Email'], ['post', 'Posts'], ['grant', 'Grants'], ['fact', 'Facts'], ['settings', 'Settings']].map(([k, l]) => html`<button type="button" aria-pressed="${t === k}" data-action="setPref" data-key="auditType" data-value="${k}">${l}</button>`)}</div></div>
      <div class="table-wrap"><table class="table"><thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Action</th><th scope="col">Item</th><th scope="col">Note</th></tr></thead>
      <tbody>${d.audit.map((a) => html`<tr><td class="nowrap small">${fdate(a.created_at, { time: true })}</td><td class="nowrap">${a.actor}</td><td><code>${a.action}</code></td><td class="small">${a.item_type || ''}${a.after?.title ? ` · ${a.after.title}` : a.after?.label ? ` · ${a.after.label}` : a.before?.title ? ` · ${a.before.title}` : ''}</td><td class="small">${a.note || ''}</td></tr>`)}</tbody></table></div>
      ${d.total > d.audit.length ? html`<p class="muted small">Showing the latest ${d.audit.length} of ${d.total}. Export the CSV for everything.</p>` : ''}
    </section>`;
  },
  actions: {
    async resolveAlert(el, app) { await app.call('resolveAlert', { id: el.dataset.id }); app.refresh(); },
    copyCsv() { const el = document.getElementById('csv-out'); copyText(el.value, el); },
    async csvDemo(el, app, ev) {
      ev.preventDefault();
      const csv = await app.call('auditCsv');
      await dialog({ title: 'Audit log (CSV)', submit: '', cancel: 'Close', wide: true, body: html`<p class="muted small">Downloads are blocked in this preview. Copy the CSV instead.</p><textarea class="editor mono" rows="14" readonly id="csv-out">${csv}</textarea><button type="button" class="btn btn-sm" data-action="copyCsv">Copy</button>` });
    },
  },
};

// ---------------------------------------------------------------------------


const settings = {
  title: 'Settings',
  async load(app) {
    const d = await app.call('settings');
    if (app.mode === 'live') d.conn = await app.api.connections().catch(() => null);
    return d;
  },
  render(d, app) {
    const s = d.settings;
    const admin = app.me.user.role === 'admin';
    const ro = admin ? '' : ' disabled';
    return html`
    <header class="page-head"><div class="head-text"><span class="eyebrow">Settings</span><h1>How Hope Studio works for your team</h1>
      <p class="lede">${admin ? 'Changes are audit-logged.' : 'Only Leila (admin) can change settings.'}</p></div></header>
    <div class="settings-grid">
      <form class="card stack-s" data-submit="saveEmail">
        <h2 class="section-title">Email</h2>
        ${field('Mailing address for the CAN-SPAM footer', 'mailing_address', { value: s.mailing_address, hint: 'Required on every outreach email. Nothing sends until it is set.', placeholder: 'Street or PO Box, St. Francisville, LA 70775' })}
        ${field('Sender name', 'sender_name', { value: s.sender?.name })}${field('Sender title', 'sender_title', { value: s.sender?.title })}${field('Sender email', 'sender_email', { value: s.sender?.email, type: 'email' })}
        <button type="submit" class="btn btn-primary btn-sm"${ro}>Save email settings</button>
      </form>
      <form class="card stack-s" data-submit="saveApprovals">
        <h2 class="section-title">Approvals and spend</h2>
        ${field('Who can approve', 'approval_policy', { value: s.approval_policy, options: [['any_approver', 'Leila or Cierra, either one'], ['admin_required', 'Leila only']] })}
        ${field('Budget per agent run (USD)', 'run_budget_usd', { value: s.run_budget_usd, type: 'number', hint: 'A run that reaches its budget stops and alerts Leila.' })}
        <p class="muted small">There is no auto-approve setting. Every send, post and export waits for a person.</p>
        <button type="submit" class="btn btn-primary btn-sm"${ro}>Save</button>
      </form>
      <form class="card stack-s" data-submit="savePlan">
        <h2 class="section-title">Posting plan</h2>
        <p class="muted small">Central time. The planner fills these slots every morning at 5:00 AM.</p>
        ${s.slot_plan.map((p, i) => html`<div class="row gap-s"><span class="slot-day">${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][p.weekday]}</span><label class="sr-only" for="slot-${i}">Time</label><input id="slot-${i}" type="time" name="slot_${p.weekday}" value="${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}"${ro}></div>`)}
        <button type="submit" class="btn btn-primary btn-sm"${ro}>Save plan</button>
      </form>
      <form class="card stack-s" data-submit="saveTerms">
        <h2 class="section-title">Banned terms</h2>
        <p class="muted small">One per line as <code>term → replacement | category</code>. Categories: stigma, graphic, slang.</p>
        <label class="sr-only" for="terms">Banned terms</label>
        <textarea id="terms" name="terms" class="editor mono" rows="9"${ro}>${s.banned_terms.map((t) => `${t.term} → ${t.replace} | ${t.category}`).join('\n')}</textarea>
        <button type="submit" class="btn btn-primary btn-sm"${ro}>Save terms</button>
      </form>
      <section class="card stack-s" aria-labelledby="theme-h">
        <h2 class="section-title" id="theme-h">Display & Theme</h2>
        <p class="muted small">Customize the visual appearance for your workstation.</p>
        <div class="row gap-s">
          ${[['system', 'Auto (System)'], ['light', 'Light Mode'], ['dark', 'Dark Mode']].map(([t, l]) => html`
            <button type="button" class="btn btn-sm ${app.pref('theme', 'system') === t ? 'btn-primary' : ''}" data-action="setAppTheme" data-theme="${t}">${l}</button>
          `)}
        </div>
      </section>
      <section class="card stack-s span-2" aria-labelledby="ai-h">
        <div class="row between wrap">
          <div>
            <h2 class="section-title" id="ai-h">AI Engine & Local LLM</h2>
            <p class="muted small">Powered by Ollama (local offline inference at <code>http://localhost:11434</code>), OpenAI-compatible endpoints, or Claude.</p>
          </div>
          <button type="button" class="btn btn-sm" data-action="testLlmConn">${icon('bolt', 16)} Test Connection</button>
        </div>
        <div class="callout callout-info" id="llm-status-box">
          <span>AI Engine is active. Local Ollama models and offline templates are ready for zero-cost autonomous drafting.</span>
        </div>
      </section>
      ${connectionsSection(d, app)}
      <section class="card stack-s" aria-labelledby="users-h">
        <h2 class="section-title" id="users-h">People</h2>
        <ul class="plain">${d.users.map((u) => html`<li><strong>${u.name}</strong> · ${u.role === 'admin' ? 'Admin and approver' : 'Approver'} · <code>${u.username}</code></li>`)}</ul>
        <p class="muted small">${d.mode === 'demo' ? 'Switch who you are with the menu at the top.' : 'Reset a password on the server: node server/set-password.js leila'}</p>
      </section>
      <section class="card stack-s" aria-labelledby="data-h">
        <h2 class="section-title" id="data-h">Data Backup & Restore</h2>
        ${d.samples ? html`<p class="small">Sample grants, prospects, partners and posts from the design canvases are loaded so every screen has something to show. Clear them before going live; your knowledge base and facts stay.</p><button type="button" class="btn btn-sm" data-action="clearSamples"${ro}>Clear sample data</button>` : html`<p class="small">No sample data loaded.</p>`}
        <div class="row gap-s wrap">
          ${d.mode === 'demo' ? html`<button type="button" class="btn btn-sm" data-action="resetDemo">Reset demo</button>` : html`<a class="btn btn-sm" href="api/export-data">${icon('download', 16)} Export JSON Backup</a>`}
          <label class="btn btn-sm file-btn">${icon('upload', 16)} Restore Backup (JSON)<input type="file" accept=".json" class="sr-only" data-change="restoreData"${ro}></label>
        </div>
        <p class="muted small">${plural(d.suppressions.length, 'address', 'addresses')} on the opt-out list.</p>
      </section>
    </div>`;
  },
  changes: connectionChanges,
  submits: {
    ...connectionSubmits,
    async saveEmail(data, app) {
      await app.call('updateSettings', { patch: { mailing_address: data.mailing_address.trim(), sender: { name: data.sender_name, title: data.sender_title, email: data.sender_email } } });
      toast('Saved. Unsent emails were re-checked.');
      app.refresh();
    },
    async saveApprovals(data, app) { await app.call('updateSettings', { patch: { approval_policy: data.approval_policy, run_budget_usd: +data.run_budget_usd } }); toast('Saved'); app.refresh(); },
    async savePlan(data, app) {
      const s = (await app.call('settings')).settings;
      const plan = s.slot_plan.map((p) => { const [h, m] = (data[`slot_${p.weekday}`] || '12:00').split(':').map(Number); return { ...p, hour: h, minute: m }; });
      await app.call('updateSettings', { patch: { slot_plan: plan } });
      toast('Posting plan saved');
      app.refresh();
    },
    async saveTerms(data, app) {
      const terms = data.terms.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
        const [left, category = 'stigma'] = l.split('|').map((x) => x.trim());
        const [term, replace = ''] = left.split(/→|->/).map((x) => x.trim());
        return { term: term.toLowerCase(), replace, category: ['stigma', 'graphic', 'slang'].includes(category) ? category : 'stigma' };
      }).filter((t) => t.term);
      await app.call('updateSettings', { patch: { banned_terms: terms } });
      toast(`${plural(terms.length, 'term')} saved`);
      app.refresh();
    },
  },
  actions: {
    async setAppTheme(el, app) {
      const theme = el.dataset.theme;
      app.setPref('theme', theme);
      if (theme === 'system') document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', theme);
      toast(`Theme set to ${theme}`);
      app.refresh();
    },
    async testLlmConn(el, app) {
      toast('Testing AI engine connection...', 'info');
      const box = document.getElementById('llm-status-box');
      try {
        const res = await app.call('testLlm');
        if (res.ok) {
          const detail = res.provider === 'ollama'
            ? `Connected to Ollama on ${res.host || 'localhost'} (${res.latency_ms}ms). Active model: ${res.activeModel || 'llama3.1'}. ${res.models?.length || 0} local models installed.`
            : `Connected to ${res.provider} (${res.latency_ms}ms).`;
          if (box) box.innerHTML = `<span><strong>Active & Connected:</strong> ${detail}</span>`;
          toast('AI Engine connected successfully!');
        } else {
          if (box) box.innerHTML = `<span><strong>Offline / Standby:</strong> ${res.reason || 'Offline templates active.'}</span>`;
          toast(res.reason || 'Running in offline template mode.', 'info');
        }
      } catch (err) {
        if (box) box.innerHTML = `<span class="bad-text"><strong>Connection error:</strong> ${err.message}</span>`;
        toast(`Test failed: ${err.message}`, 'bad');
      }
    },
    ...connectionActions,
    async clearSamples(el, app) {
      const ok = await dialog({ title: 'Clear sample data?', submit: 'Clear samples', body: html`<p>This removes the sample grants, prospects, partners, media and posts. Your knowledge base, facts, settings and audit log stay.</p>` });
      if (!ok) return;
      await app.call('clearSamples');
      toast('Sample data cleared');
      app.refresh();
    },
    async resetDemo(el, app) {
      const ok = await dialog({ title: 'Reset the demo?', submit: 'Reset', body: html`<p>Everything you changed in this browser goes back to the starting sample data.</p>` });
      if (!ok) return;
      await app.call('resetDemo');
      toast('Demo reset');
      app.refresh();
    },
  },
  changes: {
    async restoreData(el, app) {
      const file = el.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        const ok = await dialog({
          title: 'Restore backup data?',
          submit: 'Restore Now',
          body: html`<p>This will restore the platform state from <strong>${esc(file.name)}</strong>. Existing records will be overwritten with the backup snapshot.</p>`,
        });
        if (!ok) return;
        await app.call('importData', { data: json });
        toast('Backup restored successfully!');
        app.refresh();
      } catch (err) {
        toast(`Restore failed: ${err.message}`, 'bad');
      }
    },
  },
};

export default { inbox, activity, settings };
export { esc };

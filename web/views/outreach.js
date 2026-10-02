// Outreach Studio: This week · Prospect Scout · Writer + Reviewer · Execution board · Knowledge base

import { html, icon, chip, fdate, dialog, field, toast, when, stateChip, plural, ago, copyText } from '../ui.js';
import { knowledgeScreen } from './knowledge.js';
import { checksList, fixBoxes, sourcesRow } from './grants.js';

const SEGMENT_OPTIONS = [['school', 'School'], ['faith', 'Faith community'], ['youth', 'Youth group'], ['library', 'Library'], ['agency', 'Agency'], ['business', 'Business']];

async function saveAddress(app, value) {
  await app.call('updateSettings', { patch: { mailing_address: value } });
  toast('Mailing address saved. Every unsent email was re-checked.');
  app.refresh();
}

const addressBanner = (app) => (app.me.needs_address ? html`
  <form class="banner banner-form" data-submit="saveAddress">${icon('alert')}
    <div class="grow"><strong>Add the mailing address for the CAN-SPAM footer.</strong> Every outreach email must carry a physical address and an opt-out line, so nothing sends until it's set.
    ${app.me.user.role === 'admin' ? html`<div class="row gap-s mt-s"><label class="sr-only" for="addr">Mailing address</label><input id="addr" name="address" placeholder="Street or PO Box, St. Francisville, LA 70775" required><button type="submit" class="btn btn-primary btn-sm">Save address</button></div>` : html` Ask Leila to add it in Settings.`}</div>
  </form>` : '');

// ---------------------------------------------------------------------------

const week = {
  title: 'Outreach · This week',
  load: (app) => app.call('outreachWeek'),
  render(d, app) {
    return html`
    <header class="page-head">
      <div class="head-text">
        <span class="eyebrow">Outreach</span>
        <h1>${d.stats.ready ? `${plural(d.stats.ready, 'message is', 'messages are')} ready to send.` : 'Nothing is waiting to send.'}</h1>
      </div>
      <button type="button" class="btn btn-primary" data-action="runAgents" data-agent="outreach">Run agents now</button>
    </header>
    ${addressBanner(app)}
    <p class="statline" aria-label="Pipeline"><span><b>${d.stats.prospects}</b> new prospects this month</span><span><b>${d.stats.calls}</b> intro calls booked</span><span><b>${d.stats.accessPoints}</b> access points live</span></p>
    <div class="cols">
      <section class="col-main" aria-labelledby="ready-h">
        <h2 class="section-title" id="ready-h">Ready to send</h2>
        ${d.ready.length ? d.ready.map((r) => html`
        <article class="card card-row">
          <div class="grow stack-xs">
            <span class="mono-label">${r.segment} · ${r.step}${when(r.prospect.sample, html` <span class="tag-sample">Sample</span>`)}</span>
            <span class="card-title">${r.prospect.name}${r.prospect.town || r.prospect.parish ? `, ${r.prospect.town || r.prospect.parish}` : ', [Parish]'}</span>
            <span class="muted">To the ${(r.role || 'contact').toLowerCase()} · ${r.message.sequence_step === 2 ? 'Short nudge' : `Pitches ${r.pitch}`}</span>
          </div>
          <div class="row gap-s wrap end">${chip(r.chip, r.chipTone)}<button type="button" class="btn" data-action="go" data-route="o-writer" data-id="${r.message.id}">Review</button></div>
        </article>`) : html`<div class="empty"><p>Nothing waiting. Draft outreach from Prospect Scout.</p><button type="button" class="btn" data-action="go" data-route="o-scout">Open Prospect Scout</button></div>`}
        <p class="muted small">${plural(d.sent, 'email')} sent so far. Replies move partners onto the execution board.</p>
      </section>
      <aside class="col-side" aria-labelledby="up-h">
        <h2 class="section-title" id="up-h">Coming up</h2>
        <div class="card">
          ${d.upcoming.length ? html`<ul class="uplist">${d.upcoming.map((p) => html`<li><span class="mono-label">${fdate(p.next_date, { weekday: false })} · ${p.step_label}</span><strong>${p.name}</strong><span class="muted small">Step ${p.step} of 5 · ${p.next_action}</span></li>`)}</ul>` : html`<p class="muted">No dated next steps yet.</p>`}
          <button type="button" class="link-btn" data-action="go" data-route="o-board">Open execution board</button>
        </div>
      </aside>
    </div>`;
  },
  submits: { saveAddress: (data, app) => saveAddress(app, data.address) },
};

// ---------------------------------------------------------------------------

const scout = {
  title: 'Outreach · Prospect Scout',
  load: (app) => app.call('prospects', { segment: app.pref('segment', 'all') }),
  render(d, app) {
    const seg = app.pref('segment', 'all');
    const t = d.targeting;
    return html`
    <header class="page-head">
      <div class="head-text"><span class="eyebrow">Prospect Scout · ${t.region.replace(', Louisiana', '')}</span><h1>Prospects</h1></div>
      <div class="row gap-s wrap">
        <button type="button" class="btn" data-action="importCsv">${icon('upload', 16)} Import CSV</button>
        <button type="button" class="btn" data-action="addProspect">${icon('plus', 16)} Add prospect</button>
        <button type="button" class="btn btn-primary" data-action="runAgents" data-agent="outreach">Run Scout now</button>
      </div>
    </header>
    <div class="filters" role="group" aria-label="Filter by segment">
      ${[['all', 'All'], ['school', 'Schools'], ['faith', 'Youth groups & churches'], ['library', 'Libraries & agencies'], ['business', 'Businesses']].map(([k, l]) => html`<button type="button" aria-pressed="${seg === k}" data-action="setPref" data-key="segment" data-value="${k}">${l}</button>`)}
    </div>
    <div class="cols">
      <section class="col-main" aria-label="Prospects">
        ${d.prospects.length ? d.prospects.map((p) => html`
        <article class="card">
          <div class="card-top">
            <div class="stack-xs"><span class="mono-label">${p.segment_label} · ${p.town || p.parish || '[Parish]'}${when(p.sample, html` <span class="tag-sample">Sample</span>`)}</span><span class="card-title">${p.name}</span></div>
            ${p.message ? chip(p.message.status === 'sent' ? 'Contacted' : 'Drafted', 'info') : p.fit === 'strong' ? chip('Strong fit', 'good') : chip('Verify contact', 'warn')}
          </div>
          <p>Why: ${p.reason}</p>
          <div class="tags">${p.offering_labels.map((o) => html`<span class="tagline ok">${o}</span>`)}
            <span class="muted small">Contact: ${p.contact ? html`${p.contact.title || 'staff'} ${p.contact.name ? `(${p.contact.name})` : ''} · ${p.contact.email || 'no email'}${p.contact.verified ? '' : ' · unverified'}` : 'none yet'}</span></div>
          <div class="actions">
            ${p.message ? html`<button type="button" class="btn btn-primary" data-action="go" data-route="o-writer" data-id="${p.message.id}">Open outreach</button>`
              : html`<button type="button" class="btn btn-primary" data-action="draftOutreach" data-id="${p.id}">Draft outreach</button>`}
            ${p.contact ? html`<button type="button" class="btn" data-action="editContact" data-id="${p.contact.id}" data-prospect="${p.id}">Edit contact</button>` : html`<button type="button" class="btn" data-action="editContact" data-prospect="${p.id}">Add contact</button>`}
            ${p.source_url ? html`<a class="btn btn-ghost" href="${p.source_url}" target="_blank" rel="noopener">View source ${icon('external', 16)}</a>` : ''}
            ${!p.message ? html`<button type="button" class="btn btn-ghost" data-action="notNow" data-id="${p.id}">Not now</button>` : ''}
          </div>
        </article>`) : html`<div class="empty"><p>No prospects in this segment yet.</p></div>`}
      </section>
      <aside class="col-side">
        <div class="card">
          <h2 class="section-title">Targeting rules</h2>
          <dl class="dl"><div><dt>Region</dt><dd>${t.region}</dd></div><div><dt>Top priority</dt><dd>${t.priority}</dd></div><div><dt>Segments</dt><dd>${t.segments}</dd></div><div><dt>Contact only</dt><dd>${t.contact_rule}</dd></div><div><dt>Towns searched</dt><dd>${(t.towns || []).join(', ')}</dd></div></dl>
          <button type="button" class="btn" data-action="editRules">Edit rules</button>
        </div>
        <p class="muted small">${plural(d.suppressions, 'address', 'addresses')} on the opt-out list. Scout skips them. ${d.places ? '' : 'Connect Google Places on the server to find prospects automatically.'}</p>
      </aside>
    </div>`;
  },
  actions: {
    async draftOutreach(el, app) {
      const m = await app.call('draftOutreach', { prospectId: el.dataset.id });
      toast('3-step sequence drafted');
      app.go('o-writer', m.id);
    },
    async notNow(el, app) { await app.call('notNow', { prospectId: el.dataset.id }); toast('Moved out of this list'); app.refresh(); },
    async importCsv(el, app) {
      const d = await dialog({
        title: 'Bulk Import Prospects (CSV)',
        submit: 'Import Prospects',
        wide: true,
        body: html`
          <p class="muted small mb-s">Paste CSV rows. Header row required (e.g. <code>Name,Segment,Town,Contact,Email</code>). Valid segments: school, faith, library, agency, business.</p>
          ${field('CSV text', 'csv', { rows: 9, required: true, autofocus: true, placeholder: 'Name,Segment,Town,Contact,Email\nWest Feliciana High School,school,St. Francisville,Jane Doe,jane@wfhs.edu\nGrace Episcopal Church,faith,St. Francisville,Pastor John,rector@grace.org' })}
        `,
      });
      if (!d?.csv) return;
      const res = await app.call('importProspectsCsv', { text: d.csv });
      toast(`Imported ${plural(res.added, 'prospect')} from ${res.total_rows} rows`);
      app.refresh();
    },
    async addProspect(el, app) {
      const d = await dialog({
        title: 'Add a prospect', submit: 'Add', wide: true,
        body: html`<div class="form-grid">${field('Name', 'name', { required: true, autofocus: true })}${field('Segment', 'segment', { options: SEGMENT_OPTIONS })}${field('Town or parish', 'town')}${field('Website', 'website', { type: 'url' })}</div>
        ${field('Scout note (why they fit)', 'scout_note', { rows: 2 })}
        <fieldset class="fieldset"><legend>Staff contact (never a student)</legend><div class="form-grid">${field('Name', 'contact_name')}${field('Title', 'contact_title', { placeholder: 'Counselor' })}${field('Public work email', 'email', { type: 'email' })}
        <div class="field"><label class="check"><input type="checkbox" name="verified" value="1"> I checked this email on the organization's own site</label></div></div></fieldset>`,
      });
      if (!d) return;
      await app.call('addProspect', { ...d, parish: null, verified: !!d.verified, source: 'manual' });
      toast('Prospect added and matched to offerings');
      app.refresh();
    },
    async editContact(el, app) {
      const list = (await app.call('prospects', { segment: 'all' })).prospects;
      const p = list.find((x) => x.id === el.dataset.prospect);
      const c = p?.contacts.find((x) => x.id === el.dataset.id) || {};
      const d = await dialog({
        title: c.id ? 'Edit contact' : 'Add contact', submit: 'Save',
        body: html`${field('Name', 'name', { value: c.name || '' })}${field('Title', 'title', { value: c.title || '' })}${field('Public work email', 'email', { value: c.email || '', type: 'email', required: true })}${field('Where you found it', 'source_url', { value: c.source_url || '', type: 'url' })}
        <div class="field"><label class="check"><input type="checkbox" name="verified" value="1"${c.verified ? ' checked' : ''}> I checked this email on the organization's own site</label></div>
        <p class="muted small">Outreach never stores or contacts students.</p>`,
      });
      if (!d) return;
      if (c.id) await app.call('updateContact', { id: c.id, name: d.name, title: d.title, email: d.email, source_url: d.source_url || null, verified: !!d.verified });
      else await app.call('addContact', { prospectId: p.id, name: d.name, title: d.title, email: d.email, source_url: d.source_url || null, verified: !!d.verified });
      toast('Contact saved');
      app.refresh();
    },
    async editRules(el, app) {
      const t = (await app.call('settings')).settings.targeting;
      const d = await dialog({
        title: 'Targeting rules', submit: 'Save',
        body: html`${field('Region', 'region', { value: t.region })}${field('Top priority', 'priority', { value: t.priority })}${field('Segments', 'segments', { value: t.segments })}${field('Towns to search (comma separated)', 'towns', { value: (t.towns || []).join(', ') })}<p class="muted small">Contact rule is fixed: staff with public work emails, never students.</p>`,
      });
      if (!d) return;
      await app.call('updateTargeting', { targeting: { region: d.region, priority: d.priority, segments: d.segments, towns: d.towns.split(',').map((x) => x.trim()).filter(Boolean) } });
      toast('Rules saved');
      app.refresh();
    },
  },
};

// ---------------------------------------------------------------------------

const writer = {
  title: 'Outreach · Draft',
  async load(app) {
    const d = await app.call('sequence', { messageId: app.sel('o-writer') });
    if (d && !d.messages.some((m) => m.id === app.sel('o-writer'))) app.setSel('o-writer', d.selected);
    return d;
  },
  render(d, app) {
    if (!d) return html`<div class="empty"><h1>No outreach drafted yet</h1><button type="button" class="btn btn-primary" data-action="go" data-route="o-scout">Open Prospect Scout</button></div>`;
    const m = d.messages.find((x) => x.id === (app.sel('o-writer') || d.selected)) || d.messages[0];
    const a = m.approval;
    const blocking = m.results.filter((r) => r.result === 'flag' && r.blocking && !r.optional).length;
    const sent = m.status === 'sent';
    const role = (d.contact?.title || 'contact');
    const stepLabel = (x) => (x.sequence_step === 1 ? 'Intro email' : x.sequence_step === 2 ? 'Follow-up, day 7' : x.sequence_step === 3 ? 'Intro-call script' : 'Impact summary');
    const stepState = (x) => (x.status === 'sent' ? `Sent ${fdate(x.sent_at, { weekday: false })}${x.replied_at ? ' · replied' : ''}` : x.status === 'queued' ? (x.due_at ? `Sends ${fdate(x.due_at, { weekday: false })} only if no reply` : 'Sends only if no reply') : x.status === 'locked' ? 'Unlocks when a call is booked' : x.status === 'cancelled' ? 'Not needed' : x.status === 'suppressed' ? 'Opted out' : x.status === 'ready' ? 'Ready for the call' : a && x.id === m.id && a.state === 'approved' ? 'Approved' : 'Ready for review');
    return html`
    <header class="page-head">
      <div class="head-text">
        <button type="button" class="back" data-action="go" data-route="o-week">${icon('left', 16)} Back to this week</button>
        <h1 class="h1-sm">${d.prospect.name} · ${role.replace(/^\w/, (c) => c.toUpperCase())} outreach</h1>
        <span class="muted">Sequence: intro email, day-7 follow-up, intro-call script</span>
      </div>
      <div class="row gap-s wrap">
        ${m.kind === 'email' && !sent ? html`<button type="button" class="btn" data-action="saveGmailDraft" data-id="${m.id}">${m.gmail_draft_id ? 'Saved to Gmail drafts' : 'Save to Gmail drafts'}</button>
        <button type="button" class="btn btn-primary" data-action="approveSend" data-id="${m.id}"${blocking || ['queued', 'locked', 'cancelled', 'suppressed'].includes(m.status) ? ' disabled' : ''}>Approve and send</button>` : ''}
        ${sent && !m.replied_at ? html`<button type="button" class="btn" data-action="markReplied" data-id="${m.id}">They replied</button>` : ''}
      </div>
    </header>
    ${addressBanner(app)}
    ${sent ? html`<div class="approval-bar ok">${icon('check')}<span><strong>Sent ${ago(m.sent_at)}</strong>${m.simulated ? ' (demo: not actually emailed)' : ''} to ${m.to}.${m.replied_at ? ' They replied; the partner is on the execution board.' : ' Replies move this partner to "Intro call".'}</span></div>`
      : blocking ? html`<div class="approval-bar block">${icon('alert')}<span><strong>${plural(blocking, 'blocking flag')}</strong> before this can send.</span></div>` : ''}
    <div class="writer">
      <section class="qcol" aria-labelledby="seq-h">
        <h2 class="mono-label" id="seq-h">Sequence</h2>
        ${d.messages.map((x) => html`<button type="button" class="qitem ${x.id === m.id ? 'current' : ''}" data-action="go" data-route="o-writer" data-id="${x.id}"${x.id === m.id ? ' aria-current="true"' : ''}><span>${x.sequence_step}. ${stepLabel(x)}</span><span class="qcount">${stepState(x)}</span></button>`)}
        <div class="card card-flat">
          <h3 class="mono-label">Contact</h3>
          <p class="small">${d.contact ? html`${d.contact.name || '[name]'} · ${d.contact.title}<br>${d.contact.email}${d.contact.verified ? '' : html`<br><strong class="warn-text">Not verified</strong>`}` : 'No contact yet'}</p>
          ${d.contact?.email ? html`<button type="button" class="link-btn" data-action="optOut" data-email="${d.contact.email}">Record an opt-out</button>` : ''}
        </div>
        ${d.queue.length > 1 ? html`<div class="card card-flat"><h3 class="mono-label">Next in queue</h3>${d.queue.filter((q) => q.id !== m.id).slice(0, 4).map((q) => html`<button type="button" class="link-btn block" data-action="go" data-route="o-writer" data-id="${q.id}">${q.title}</button>`)}</div>` : ''}
      </section>
      <section class="card editor-card" aria-label="Email draft">
        ${m.kind === 'email' ? html`
          <div class="mail-head"><span class="muted">To</span><span>${m.to || '[email]'}</span></div>
          <div class="field"><label for="msg-subject">Subject</label><input id="msg-subject" value="${m.subject}"${sent ? ' readonly' : ''}></div>` : html`<h2 class="section-title">${m.subject}</h2>`}
        <label class="sr-only" for="msg-body">Message</label>
        <textarea id="msg-body" class="editor" rows="18"${sent ? ' readonly' : ''}>${m.body}</textarea>
        <div class="row between wrap gap-s">${sourcesRow(m.citations)}
          ${!sent ? html`<button type="button" class="btn btn-primary btn-sm" data-action="saveMessage" data-id="${m.id}">Save and re-check</button>` : html`<button type="button" class="btn btn-sm" data-action="copyBody">${icon('copy', 16)} Copy</button>`}</div>
      </section>
      <aside class="card reviewer" aria-labelledby="rev-h">
        <div class="stack-xs"><h2 class="section-title" id="rev-h">Reviewer</h2><span class="muted small">Checked against Our Commitments</span></div>
        ${checksList(m.results.filter((r) => !r.optional))}
        ${a ? html`<p class="small">${stateChip(a.state)}</p>` : ''}
        ${fixBoxes(m.results, { skip: 'skipPolish' })}
      </aside>
    </div>`;
  },
  actions: {
    async saveMessage(el, app) {
      const subject = document.getElementById('msg-subject');
      await app.call('updateMessage', { id: el.dataset.id, body: document.getElementById('msg-body').value, ...(subject ? { subject: subject.value } : {}) });
      toast('Saved. Reviewer checked it again.');
      app.refresh();
    },
    async applyFix(el, app) { await app.call('applyFix', { resultId: el.dataset.id }); toast('Applied'); app.refresh(); },
    async skipPolish(el, app) { await app.call('skipPolish', { messageId: app.sel('o-writer') }); app.refresh(); },
    focusEditor() { document.getElementById('msg-body')?.focus(); },
    async approveSend(el, app) {
      const ok = await dialog({ title: 'Approve and send?', submit: 'Approve and send', body: html`<p>This approves the email and sends it through Gmail from ${app.me.user.name.split(' ')[0] === 'Leila' ? 'your' : "the team's"} account. The day-7 follow-up waits in the queue and needs its own OK.</p>` });
      if (!ok) return;
      const m = await app.call('approveAndSend', { id: el.dataset.id });
      toast(m.simulated ? 'Approved. Demo: logged as sent, no email left this browser.' : 'Sent');
      app.refresh();
    },
    async saveGmailDraft(el, app) { await app.call('saveGmailDraft', { id: el.dataset.id }); toast('Saved to Gmail drafts'); app.refresh(); },
    async markReplied(el, app) {
      const d = await dialog({ title: 'Log a reply', submit: 'Move to Intro call', body: field('What did they say? (optional)', 'note', { rows: 3 }) });
      if (!d) return;
      await app.call('markReplied', { id: el.dataset.id, note: d.note });
      toast('Partner added to the execution board');
      app.refresh();
    },
    async optOut(el, app) {
      const d = await dialog({ title: 'Record an opt-out', submit: 'Stop contacting', body: html`<p><strong>${el.dataset.email}</strong> goes on the suppression list. Unsent messages to it are withdrawn and Scout skips it from now on.</p>${field('Reason', 'reason', { value: 'Asked not to be contacted' })}` });
      if (!d) return;
      await app.call('optOut', { email: el.dataset.email, reason: d.reason });
      toast('Opt-out recorded');
      app.refresh();
    },
    copyBody() { const el = document.getElementById('msg-body'); copyText(el.value, el); },
  },
  submits: { saveAddress: (data, app) => saveAddress(app, data.address) },
};

// ---------------------------------------------------------------------------

const board = {
  title: 'Outreach · Execution board',
  load: (app) => app.call('board'),
  render(d, app) {
    const selId = app.sel('o-board');
    const all = d.columns.flatMap((c) => c.cards);
    const sel = all.find((c) => c.id === selId) || d.columns[4].cards[0] || all[0];
    return html`
    <header class="page-head">
      <div class="head-text"><span class="eyebrow">Execution · How to partner, five steps</span><h1>Partnerships</h1></div>
      <button type="button" class="btn btn-primary" data-action="addPartner">${icon('plus', 16)} Add partner</button>
    </header>
    <div class="board-wrap"><section class="board" aria-label="Partnership board">
      ${d.columns.map((c) => html`<div class="board-col">
        <h2 class="board-h"><span>${c.step} · ${c.label}</span><span class="count">${c.cards.length}</span></h2>
        ${c.cards.map((p) => html`<button type="button" class="board-card ${sel && p.id === sel.id ? 'current' : ''}" data-action="selectPartner" data-id="${p.id}">
          <span class="mono-label">${p.segment_label}${p.sample ? ' · sample' : ''}</span><strong>${p.name}</strong><span class="small">${p.offering_labels.join(' + ')}</span>
          <span class="small muted">${p.next_action}${p.next_date ? ` · ${fdate(p.next_date, { weekday: false })}` : ''}</span></button>`)}
        ${c.step === 4 ? html`<p class="small muted"><strong>Checklist:</strong> adult lead on site, training devices, box and decal, QR placard, pre/post survey</p>` : ''}
      </div>`)}
    </section></div>
    ${sel ? html`<section class="card partner" aria-labelledby="partner-h">
      <div class="card-top"><div class="stack-xs"><span class="mono-label">Step ${sel.step} of 5 · ${sel.segment_label}</span><h2 class="section-title" id="partner-h">${sel.name}</h2></div>
        <div class="row gap-s">${sel.step > 1 ? html`<button type="button" class="btn btn-sm" data-action="moveStep" data-id="${sel.id}" data-step="${sel.step - 1}">${icon('left', 16)} Back</button>` : ''}${sel.step < 5 ? html`<button type="button" class="btn btn-primary btn-sm" data-action="moveStep" data-id="${sel.id}" data-step="${sel.step + 1}">Move to step ${sel.step + 1} ${icon('right', 16)}</button>` : ''}</div></div>
      <div class="partner-grid">
        <form class="stack-s" data-submit="savePartner" data-id="${sel.id}">
          ${field('Next action', 'next_action', { value: sel.next_action || '' })}
          ${field('Date', 'next_date', { type: 'date', value: sel.next_date ? sel.next_date.slice(0, 10) : '' })}
          <fieldset class="fieldset"><legend>Offerings</legend><div class="checkgrid">${Object.entries(d.offerings).map(([k, o]) => html`<label class="check"><input type="checkbox" name="offerings" value="${k}"${(sel.offerings || []).includes(k) ? ' checked' : ''}> ${o.short}</label>`)}</div></fieldset>
          ${field('Notes', 'notes', { value: sel.notes || '', rows: 3 })}
          <button type="submit" class="btn btn-sm">Save</button>
        </form>
        <div class="stack-s">
          ${sel.step >= 4 ? html`<div><h3 class="mono-label">Delivery checklist</h3><ul class="attach">${sel.checklist.map((c, i) => html`<li><label><input type="checkbox" data-change="toggleCheck" data-id="${sel.id}" data-index="${i}"${c.done ? ' checked' : ''}> ${c.label}</label></li>`)}</ul></div>` : ''}
          ${sel.step >= 4 ? html`<form data-submit="saveSurvey" data-id="${sel.id}" class="stack-s">
            <h3 class="mono-label">Anonymous pre/post survey</h3><p class="muted small">Totals and averages only. No names, matching the Partner Guide promise.</p>
            <div class="form-grid tight">${field('People trained', 'trained', { type: 'number', value: sel.survey?.trained ?? '' })}${field('Knowledge before (%)', 'pre_knowledge', { type: 'number', value: sel.survey?.pre_knowledge ?? '' })}${field('Knowledge after (%)', 'post_knowledge', { type: 'number', value: sel.survey?.post_knowledge ?? '' })}${field('Confidence before (%)', 'pre_confidence', { type: 'number', value: sel.survey?.pre_confidence ?? '' })}${field('Confidence after (%)', 'post_confidence', { type: 'number', value: sel.survey?.post_confidence ?? '' })}${field('Corps members', 'corps_members', { type: 'number', value: sel.survey?.corps_members ?? '' })}${field('Service hours', 'service_hours', { type: 'number', value: sel.survey?.service_hours ?? '' })}${field('QR scans', 'qr_scans', { type: 'number', value: sel.survey?.qr_scans ?? '' })}${field('App opens', 'app_opens', { type: 'number', value: sel.survey?.app_opens ?? '' })}</div>
            <div class="row gap-s"><button type="submit" class="btn btn-sm">Save survey</button><button type="button" class="btn btn-primary btn-sm" data-action="impact" data-id="${sel.id}"${sel.survey ? '' : ' disabled'}>Build impact summary</button></div>
          </form>` : html`<p class="muted small">The anonymous survey and impact summary open at step 4, Delivery.</p>`}
        </div>
      </div>
    </section>` : ''}
    <section class="card impact" aria-label="Impact summary preview">
      <div class="stack-xs"><span class="mono-label">Auto-built impact summary</span><h2 class="section-title">What each partner receives</h2></div>
      ${sel?.summary ? html`<pre class="summary">${sel.summary}</pre>` : html`<div class="impact-grid">${['People trained', 'Change in response knowledge', 'Change in confidence to respond', 'Corps leadership activity', 'QR and app engagement'].map((l) => {
    const line = sel?.impact?.find((x) => x.label === l);
    return html`<div class="impact-cell"><span class="muted small">${l}</span><strong>${line ? line.value : '—'}</strong></div>`;
  })}</div>`}
    </section>`;
  },
  actions: {
    selectPartner(el, app) { app.setSel('o-board', el.dataset.id); app.refresh(); },
    async moveStep(el, app) { await app.call('updatePartnership', { id: el.dataset.id, step: +el.dataset.step }); toast(`Moved to step ${el.dataset.step}`); app.refresh(); },
    async impact(el, app) { await app.call('generateImpactSummary', { id: el.dataset.id }); toast('Impact summary built. The email to the partner waits for approval.'); app.refresh(); },
    async addPartner(el, app) {
      const d = await dialog({ title: 'Add partner', submit: 'Add', body: html`${field('Name', 'name', { required: true, autofocus: true })}${field('Segment', 'segment', { options: SEGMENT_OPTIONS })}${field('Step', 'step', { options: [[1, '1 · Intro call'], [2, '2 · Choose offerings'], [3, '3 · Approvals'], [4, '4 · Delivery'], [5, '5 · Impact summary']] })}${field('Next action', 'next_action', { value: 'Book the intro call' })}` });
      if (!d) return;
      const p = await app.call('addPartner', { ...d, step: +d.step });
      app.setSel('o-board', p.id);
      toast('Partner added');
      app.refresh();
    },
  },
  submits: {
    async savePartner(data, app, form) {
      await app.call('updatePartnership', { id: form.dataset.id, next_action: data.next_action, next_date: data.next_date ? new Date(`${data.next_date}T12:00:00-05:00`).toISOString() : null, notes: data.notes, offerings: [].concat(data.offerings || []).filter(Boolean) });
      toast('Saved');
      app.refresh();
    },
    async saveSurvey(data, app, form) {
      await app.call('recordSurvey', { id: form.dataset.id, ...data });
      toast('Survey saved');
      app.refresh();
    },
  },
  changes: {
    async toggleCheck(el, app) {
      const p = (await app.call('board')).columns.flatMap((c) => c.cards).find((x) => x.id === el.dataset.id);
      await app.call('updatePartnership', { id: p.id, checklist: p.checklist.map((c, i) => (i === +el.dataset.index ? { ...c, done: el.checked } : c)) });
      app.refresh();
    },
  },
};

// ---------------------------------------------------------------------------
// Contacts & CRM with Daily Gmail Synchronization
// ---------------------------------------------------------------------------

const contacts = {
  title: 'Outreach · Contacts & CRM',
  load: async (app) => {
    const search = app.pref('contact_search', '');
    const segment = app.pref('contact_segment', 'all');
    const status = app.pref('contact_status', 'all');
    const sort = app.pref('contact_sort', 'followup');
    const data = await app.call('contactsList', { search, segment, status, sort });
    let selId = app.sel('o-contacts');
    if (!selId || !data.contacts.some((c) => c.id === selId)) {
      selId = data.contacts[0]?.id || null;
      if (selId) app.setSel('o-contacts', selId);
    }
    const details = selId ? await app.call('contactDetails', { id: selId }) : null;
    return { ...data, selected: details, selId, search, segment, status, sort };
  },
  render(d, app) {
    const sel = d.selected?.contact;
    const now = new Date();

    const formatFollowup = (dateStr) => {
      if (!dateStr) return { text: 'No follow-up set', cls: 'normal' };
      const target = new Date(dateStr);
      const diffDays = Math.ceil((target - now) / (1000 * 60 * 60 * 24));
      if (diffDays < 0) return { text: `⚠️ Overdue by ${Math.abs(diffDays)}d (${fdate(dateStr, { weekday: false })})`, cls: 'urgent' };
      if (diffDays === 0) return { text: `🔔 Due today!`, cls: 'urgent' };
      if (diffDays === 1) return { text: `🔔 Due tomorrow`, cls: 'upcoming' };
      if (diffDays <= 7) return { text: `📅 Due in ${diffDays}d (${fdate(dateStr, { weekday: false })})`, cls: 'upcoming' };
      return { text: `📅 ${fdate(dateStr, { weekday: false })}`, cls: 'normal' };
    };

    const statusBadge = (st) => {
      const s = st || 'New';
      if (s === 'Needs Follow-up') return chip(s, 'bad');
      if (s === 'Replied' || s === 'Access Point Active') return chip(s, 'good');
      if (s === 'Meeting Booked' || s === 'Meeting Scheduled' || s === 'Active Partner') return chip(s, 'good');
      if (s === 'Awaiting Reply' || s === 'Proposal Sent') return chip(s, 'info');
      return chip(s, 'warn');
    };

    return html`
    <header class="page-head">
      <div class="head-text">
        <span class="eyebrow">Outreach</span>
        <h1>Contacts</h1>
      </div>
      <div class="row gap-s wrap">
        <button type="button" class="btn" data-action="syncGmail">${icon('sparkle', 16)} Sync Gmail Now</button>
        <button type="button" class="btn" data-action="exportCsv">${icon('download', 16)} Export CSV</button>
        <button type="button" class="btn btn-primary" data-action="newContact">${icon('plus', 16)} Add Contact</button>
      </div>
    </header>

    <p class="statline" aria-label="CRM overview"><span><b>${d.counts.total}</b> contacts</span><span><b>${d.counts.needs_followup}</b> need follow-up</span><span><b>${d.counts.awaiting_reply}</b> awaiting reply</span><span><b>${d.counts.active_partners}</b> active partners</span></p>

    <div class="row gap-m wrap between center mb-s">
      <div class="filters" role="group" aria-label="Filter by segment">
        ${[['all', 'All Segments'], ['school', 'Schools'], ['faith', 'Faith & Youth'], ['library', 'Libraries & Agencies'], ['business', 'Businesses']].map(([k, l]) => html`
          <button type="button" aria-pressed="${d.segment === k}" data-action="setPref" data-key="contact_segment" data-value="${k}">${l}</button>
        `)}
      </div>
      <div class="row gap-s center">
        <label for="sort-select" class="small muted">Sort by:</label>
        <select id="sort-select" data-change="setSort">
          <option value="followup"${d.sort === 'followup' ? ' selected' : ''}>Next follow-up (Soonest first)</option>
          <option value="last_comm_newest"${d.sort === 'last_comm_newest' ? ' selected' : ''}>Last communication (Newest)</option>
          <option value="last_comm_oldest"${d.sort === 'last_comm_oldest' ? ' selected' : ''}>Last communication (Oldest)</option>
          <option value="name"${d.sort === 'name' ? ' selected' : ''}>Contact Name (A–Z)</option>
          <option value="company"${d.sort === 'company' ? ' selected' : ''}>Organization (A–Z)</option>
        </select>
      </div>
    </div>

    <div class="filters mb-m" role="group" aria-label="Filter by status">
      ${[['all', 'All Statuses'], ['needs_followup', 'Needs Follow-up'], ['Awaiting Reply', 'Awaiting Reply'], ['Replied', 'Replied'], ['Meeting Booked', 'Meeting Booked'], ['Access Point Active', 'Active Partner']].map(([k, l]) => html`
        <button type="button" aria-pressed="${d.status === k}" data-action="setPref" data-key="contact_status" data-value="${k}">${l}</button>
      `)}
    </div>

    <div class="crm-layout">
      <!-- Left Column: Directory List -->
      <aside class="crm-sidebar" aria-label="Contacts list">
        <div class="crm-search-box">
          <span class="search-ic">${icon('search', 16)}</span>
          <input type="search" placeholder="Search by name, email, phone, company…" value="${d.search}" data-input="onSearch">
        </div>

        <div class="crm-list" role="listbox">
          ${d.contacts.length ? d.contacts.map((c) => {
            const fu = formatFollowup(c.next_follow_up_date);
            const isSel = c.id === d.selId;
            return html`
            <article class="crm-card ${isSel ? 'active' : ''}" role="option" aria-selected="${isSel}" data-action="selectContact" data-id="${c.id}">
              <div class="crm-card-header">
                <div class="stack-xs" style="min-width:0;">
                  <span class="crm-contact-name">${c.name || 'Unnamed Contact'}</span>
                  <span class="crm-contact-title">${c.position || c.title || 'Staff'} · <strong>${c.company || 'Community Partner'}</strong></span>
                </div>
                ${statusBadge(c.status_of_last_request)}
              </div>

              <div class="crm-card-meta">
                ${c.email ? html`<span class="src"><a href="mailto:${c.email}" onclick="event.stopPropagation();" title="Email ${c.email}">${icon('mail', 14)} ${c.email}</a></span>` : ''}
                ${c.phone ? html`<span class="src"><a href="tel:${c.phone.replace(/[^0-9+]/g, '')}" onclick="event.stopPropagation();" title="Call ${c.phone}">${icon('phone', 14)} ${c.phone}</a></span>` : ''}
                <span class="tagline">${c.segment_label || c.segment}</span>
              </div>

              ${c.last_snippet ? html`<div class="crm-card-comm"><span class="muted">${c.last_direction === 'inbound' ? '← Inbound:' : '→ Outbound:'}</span> ${c.last_snippet}</div>` : ''}

              <div class="crm-card-followup ${fu.cls}">
                <span>${fu.text}</span>
                ${c.follow_up_next_steps ? html`<span class="muted font-normal">· ${c.follow_up_next_steps}</span>` : ''}
              </div>
            </article>`;
          }) : html`<div class="empty"><p>No contacts found matching criteria.</p><button type="button" class="btn" data-action="newContact">Add a new contact</button></div>`}
        </div>
      </aside>

      <!-- Right Column: Selected Contact Dossier -->
      <main class="crm-detail-pane" aria-label="Contact details">
        ${sel ? html`
        <article class="card crm-profile-card">
          <div class="crm-profile-top">
            <div class="stack-xs">
              <div class="row gap-s center">
                <span class="mono-label">${sel.segment_label || sel.segment} · Partner Contact</span>
                ${statusBadge(sel.status_of_last_request)}
              </div>
              <h2 class="crm-profile-name">${sel.name || 'Unnamed Contact'}</h2>
              <div class="crm-profile-role">${sel.position || sel.title || 'Staff Contact'} at <strong>${sel.company || 'Community Organization'}</strong></div>
            </div>
            <div class="row gap-s wrap">
              <button type="button" class="btn btn-sm" data-action="editContact" data-id="${sel.id}">${icon('edit', 14)} Edit Info</button>
              <button type="button" class="btn btn-sm" data-action="logInteraction" data-id="${sel.id}">${icon('plus', 14)} Log Note/Call</button>
              ${sel.email ? html`<a class="btn btn-sm btn-primary" href="mailto:${sel.email}?subject=Hope%20Resuscitated%20Partnership">${icon('mail', 14)} Compose Email</a>` : ''}
              <button type="button" class="btn btn-sm btn-ghost" data-action="deleteContact" data-id="${sel.id}" title="Delete contact">${icon('trash', 14)}</button>
            </div>
          </div>

          <div class="crm-info-grid">
            <div class="crm-info-item">
              <span class="crm-info-label">Direct Email</span>
              <div class="row gap-xs center">
                <span class="crm-info-value">${sel.email || 'No email on file'}</span>
                ${sel.email ? html`<button type="button" class="icon-btn-text" data-action="copy" data-text="${sel.email}" title="Copy email">${icon('copy', 14)}</button>` : ''}
              </div>
            </div>
            <div class="crm-info-item">
              <span class="crm-info-label">Phone Number</span>
              <div class="row gap-xs center">
                <span class="crm-info-value">${sel.phone || 'No phone on file'}</span>
                ${sel.phone ? html`<button type="button" class="icon-btn-text" data-action="copy" data-text="${sel.phone}" title="Copy phone">${icon('copy', 14)}</button>` : ''}
              </div>
            </div>
            <div class="crm-info-item">
              <span class="crm-info-label">Organization</span>
              <span class="crm-info-value">${sel.company || '—'}</span>
            </div>
            <div class="crm-info-item">
              <span class="crm-info-label">Role & Position</span>
              <span class="crm-info-value">${sel.position || sel.title || '—'}</span>
            </div>
          </div>

          <!-- Communication & Status Overview -->
          <div class="crm-status-box">
            <div class="card stack-xs" style="background:var(--ground); border:1px solid var(--line);">
              <span class="mono-label">First Communication</span>
              <strong>${sel.first_communication ? fdate(sel.first_communication) : '—'}</strong>
              <p class="muted small">${sel.first_subject || 'Initial introductory contact'}</p>
            </div>
            <div class="card stack-xs" style="background:var(--ground); border:1px solid var(--line);">
              <span class="mono-label">Last Communication (${sel.last_direction === 'inbound' ? 'Inbound' : 'Outbound'})</span>
              <strong>${sel.last_communication ? fdate(sel.last_communication) : '—'}</strong>
              <p class="small" style="line-height:1.4;">${sel.last_snippet || 'No message snippet'}</p>
            </div>
          </div>

          <!-- Follow-up & Next Action Scheduler -->
          <div class="card stack-s" style="border-left: 4px solid var(--signal-strong);">
            <div class="row gap-s between center wrap">
              <div class="stack-xs">
                <span class="mono-label">Follow-up & Next Action</span>
                <h3 class="section-title">Next Contact Steps</h3>
              </div>
              <div class="row gap-xs wrap">
                <button type="button" class="btn btn-sm" data-action="snooze" data-id="${sel.id}" data-days="2">+2 Days</button>
                <button type="button" class="btn btn-sm" data-action="snooze" data-id="${sel.id}" data-days="7">+1 Week</button>
                <button type="button" class="btn btn-sm" data-action="snooze" data-id="${sel.id}" data-days="14">+2 Weeks</button>
              </div>
            </div>

            <form data-submit="updateFollowup" data-id="${sel.id}" class="stack-s">
              <div class="form-grid">
                ${field('Target Follow-Up Date', 'next_follow_up_date', { type: 'date', value: sel.next_follow_up_date || '' })}
                ${field('Status of Last Request', 'status_of_last_request', {
                  options: [
                    ['Needs Follow-up', 'Needs Follow-up'],
                    ['Awaiting Reply', 'Awaiting Reply'],
                    ['Replied', 'Replied (Review response)'],
                    ['Meeting Booked', 'Meeting Booked / Scheduled'],
                    ['Proposal Sent', 'Proposal Sent'],
                    ['Access Point Active', 'Active Partner / Access Point Active'],
                    ['Opt-Out', 'Opted Out / Do Not Contact'],
                    ['New', 'New Contact'],
                  ],
                  value: sel.status_of_last_request || 'Awaiting Reply',
                })}
              </div>
              ${field('Next Steps / Action Plan', 'follow_up_next_steps', { value: sel.follow_up_next_steps || 'Send follow-up email regarding naloxone partnership', placeholder: 'What needs to happen next?' })}
              <div class="row gap-s end">
                <button type="submit" class="btn btn-primary btn-sm">Save Next Steps</button>
              </div>
            </form>
          </div>

          <!-- Interactive Communication History & Timeline -->
          <div class="crm-timeline-card">
            <div class="row gap-s between center wrap">
              <div class="stack-xs">
                <span class="mono-label">Audit Log & Communication History</span>
                <h3 class="section-title">Timeline (${d.selected.history.length} events)</h3>
              </div>
              <button type="button" class="btn btn-sm" data-action="logInteraction" data-id="${sel.id}">${icon('plus', 14)} Add Note or Call</button>
            </div>

            <div class="crm-timeline">
              ${d.selected.history.length ? d.selected.history.map((h) => {
                const badgeClass = h.direction === 'inbound' ? 'badge-inbound' : h.type === 'meeting' ? 'badge-meeting' : h.type === 'call' ? 'badge-note' : 'badge-outbound';
                return html`
                <div class="timeline-entry">
                  <div class="timeline-dot ${h.direction === 'inbound' ? 'inbound' : h.type === 'meeting' ? 'meeting' : 'outbound'}"></div>
                  <div class="timeline-header">
                    <div class="row gap-s center">
                      <span class="${badgeClass}">${h.type.toUpperCase()} · ${h.direction === 'inbound' ? 'INBOUND' : 'OUTBOUND'}</span>
                      <span class="timeline-subject">${h.subject || 'Interaction'}</span>
                    </div>
                    <span class="timeline-time">${fdate(h.date)} · ${ago(h.date)}</span>
                  </div>
                  <div class="timeline-body">
                    <p>${h.snippet || h.body || 'No details provided.'}</p>
                    ${h.author ? html`<span class="muted small mt-xs block">— ${h.author}</span>` : ''}
                  </div>
                </div>`;
              }) : html`<p class="muted">No interaction history recorded yet.</p>`}
            </div>
          </div>

          ${d.selected.partnership ? html`
          <div class="card stack-s" style="background:var(--ground);">
            <div class="row gap-s between center">
              <div class="stack-xs">
                <span class="mono-label">Active Partner Relationship</span>
                <strong>Step ${d.selected.partnership.step} of 5: ${d.selected.partnership.next_action || 'In progress'}</strong>
              </div>
              <button type="button" class="btn btn-sm" data-action="go" data-route="o-board" data-id="${d.selected.partnership.id}">Open Execution Board →</button>
            </div>
          </div>` : ''}

        </article>` : html`
        <div class="card empty">
          <p>Select a contact from the list on the left to view full communication details and manage follow-ups.</p>
        </div>`}
      </main>
    </div>`;
  },
  actions: {
    selectContact(el, app) {
      app.setSel('o-contacts', el.dataset.id);
      app.refresh();
    },
    async syncGmail(el, app) {
      el.setAttribute('aria-busy', 'true');
      toast('Syncing contacts & email communications from Gmail…');
      try {
        const res = await app.call('syncGmailContacts', {});
        toast(`Gmail sync complete: ${res.synced || 0} messages parsed, ${res.created || 0} new contacts, ${res.updated || 0} updated.`);
      } catch (err) {
        toast(`Gmail sync: ${err.message}`, 'bad');
      } finally {
        el.removeAttribute('aria-busy');
        app.refresh();
      }
    },
    async newContact(el, app) {
      const d = await dialog({
        title: 'Add New Contact',
        submit: 'Save Contact',
        body: html`
          ${field('Contact Name', 'name', { required: true, autofocus: true, placeholder: 'e.g. Dr. Jane Smith' })}
          <div class="form-grid">
            ${field('Email Address', 'email', { type: 'email', required: true, placeholder: 'jane@organization.org' })}
            ${field('Phone Number', 'phone', { type: 'tel', placeholder: '(225) 555-0199' })}
          </div>
          <div class="form-grid">
            ${field('Organization / Company', 'company', { required: true, placeholder: 'e.g. West Feliciana High School' })}
            ${field('Position / Role', 'position', { placeholder: 'e.g. Director of Student Services' })}
          </div>
          <div class="form-grid">
            ${field('Segment', 'segment', { options: SEGMENT_OPTIONS })}
            ${field('Initial Status', 'status_of_last_request', {
              options: [
                ['Awaiting Reply', 'Awaiting Reply'],
                ['Needs Follow-up', 'Needs Follow-up'],
                ['Replied', 'Replied'],
                ['Meeting Booked', 'Meeting Booked'],
                ['Access Point Active', 'Active Partner'],
              ],
            })}
          </div>
          <div class="form-grid">
            ${field('First Communication Date', 'first_communication', { type: 'date', value: new Date().toISOString().split('T')[0] })}
            ${field('Next Follow-up Date', 'next_follow_up_date', { type: 'date', value: new Date(Date.now() + 3 * DAY_MS).toISOString().split('T')[0] })}
          </div>
          ${field('Next Steps / Action Plan', 'follow_up_next_steps', { value: 'Send introductory email regarding naloxone training' })}
          ${field('Notes & Context', 'notes', { placeholder: 'Notes from scout or background research…' })}
        `,
      });
      if (!d) return;
      const c = await app.call('upsertContact', {
        ...d,
        last_communication: d.first_communication,
        last_direction: 'outbound',
        last_snippet: d.follow_up_next_steps,
      });
      app.setSel('o-contacts', c.id);
      toast('Contact created');
      app.refresh();
    },
    async editContact(el, app) {
      const contact = (await app.call('contactDetails', { id: el.dataset.id })).contact;
      const d = await dialog({
        title: 'Edit Contact Details',
        submit: 'Save Changes',
        body: html`
          ${field('Contact Name', 'name', { value: contact.name, required: true, autofocus: true })}
          <div class="form-grid">
            ${field('Email Address', 'email', { type: 'email', value: contact.email, required: true })}
            ${field('Phone Number', 'phone', { type: 'tel', value: contact.phone || '' })}
          </div>
          <div class="form-grid">
            ${field('Organization / Company', 'company', { value: contact.company || '' })}
            ${field('Position / Role', 'position', { value: contact.position || contact.title || '' })}
          </div>
          ${field('Segment', 'segment', { options: SEGMENT_OPTIONS, value: contact.segment })}
          ${field('General Notes', 'notes', { value: contact.notes || '' })}
        `,
      });
      if (!d) return;
      await app.call('upsertContact', { id: el.dataset.id, ...d });
      toast('Contact updated');
      app.refresh();
    },
    async deleteContact(el, app) {
      const ok = await dialog({
        title: 'Delete Contact?',
        submit: 'Delete',
        body: html`<p>Are you sure you want to delete this contact? Their communication history will be removed.</p>`,
      });
      if (!ok) return;
      await app.call('deleteContact', { id: el.dataset.id });
      app.setSel('o-contacts', null);
      toast('Contact deleted');
      app.refresh();
    },
    async logInteraction(el, app) {
      const d = await dialog({
        title: 'Log Communication / Interaction',
        submit: 'Add to Timeline',
        body: html`
          <div class="form-grid">
            ${field('Interaction Type', 'type', {
              options: [
                ['email', 'Email (Sent or Received)'],
                ['call', 'Phone Call'],
                ['meeting', 'In-Person Meeting'],
                ['note', 'Internal Team Note'],
              ],
            })}
            ${field('Direction', 'direction', {
              options: [
                ['inbound', 'Inbound (From partner)'],
                ['outbound', 'Outbound (Sent by us)'],
              ],
            })}
          </div>
          ${field('Subject / Topic', 'subject', { required: true, placeholder: 'e.g. Call regarding Act 378 compliance dates' })}
          ${field('Notes & Summary', 'snippet', { required: true, placeholder: 'What was discussed, agreed upon, or requested?' })}
          <div class="form-grid">
            ${field('Date of Interaction', 'date', { type: 'date', value: new Date().toISOString().split('T')[0] })}
            ${field('Updated Request Status', 'status', {
              options: [
                ['Replied', 'Replied / Active response'],
                ['Meeting Booked', 'Meeting Booked'],
                ['Awaiting Reply', 'Awaiting Reply'],
                ['Needs Follow-up', 'Needs Follow-up'],
                ['Proposal Sent', 'Proposal Sent'],
                ['Access Point Active', 'Access Point Active'],
              ],
            })}
          </div>
        `,
      });
      if (!d) return;
      await app.call('logContactCommunication', {
        contactId: el.dataset.id,
        ...d,
        date: d.date ? new Date(`${d.date}T12:00:00-05:00`).toISOString() : new Date().toISOString(),
      });
      toast('Interaction logged to timeline');
      app.refresh();
    },
    async snooze(el, app) {
      const days = +el.dataset.days || 7;
      const targetDate = new Date(Date.now() + days * 1000 * 60 * 60 * 24).toISOString().split('T')[0];
      await app.call('setContactFollowUp', {
        contactId: el.dataset.id,
        next_follow_up_date: targetDate,
      });
      toast(`Follow-up snoozed by ${days} days (${targetDate})`);
      app.refresh();
    },
    async exportCsv(el, app) {
      const data = await app.call('contactsList', { search: '', segment: 'all', status: 'all', sort: 'name' });
      const rows = [
        ['Name', 'Email', 'Phone', 'Company', 'Position', 'Segment', 'Status', 'First Communication', 'Last Communication', 'Next Follow-up', 'Next Steps'],
      ];
      for (const c of data.contacts) {
        rows.push([
          c.name || '',
          c.email || '',
          c.phone || '',
          c.company || '',
          c.position || c.title || '',
          c.segment_label || c.segment || '',
          c.status_of_last_request || '',
          c.first_communication || '',
          c.last_communication || '',
          c.next_follow_up_date || '',
          c.follow_up_next_steps || '',
        ]);
      }
      const csvContent = 'data:text/csv;charset=utf-8,' + rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `hope_studio_contacts_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast('Contacts CSV exported');
    },
    copy(el) {
      copyText(el.dataset.text);
      toast('Copied to clipboard');
    },
  },
  submits: {
    async updateFollowup(data, app, form) {
      await app.call('setContactFollowUp', {
        contactId: form.dataset.id,
        next_follow_up_date: data.next_follow_up_date,
        status_of_last_request: data.status_of_last_request,
        follow_up_next_steps: data.follow_up_next_steps,
      });
      toast('Follow-up schedule and request status saved');
      app.refresh();
    },
  },
  changes: {
    setSort(el, app) {
      app.setPref('contact_sort', el.value);
      app.refresh();
    },
  },
  inputs: {
    onSearch(el, app) {
      app.setPref('contact_search', el.value);
      // Debounced search
      clearTimeout(window._contactSearchTimer);
      window._contactSearchTimer = setTimeout(() => app.refresh(), 300);
    },
  },
};

export default {
  'o-week': week,
  'o-contacts': contacts,
  'o-scout': scout,
  'o-writer': writer,
  'o-board': board,
  'o-kb': knowledgeScreen('outreach', {
    eyebrow: 'The brain',
    lede: 'Writer only promises what\'s written here, and Reviewer enforces Our Commitments on every message.',
    ask: 'How young can students be?',
    askLabel: 'Ask a question a partner might ask',
  }),
};

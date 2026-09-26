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
        <span class="eyebrow">${new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Chicago' })} outreach review · 2026–27 pilot</span>
        <h1>${plural(d.stats.ready, 'message is', 'messages are').replace(/^1 message is/, '1 message is')} ready to send.<br><span class="h1-strong">${plural(d.stats.calls, 'intro call is', 'intro calls are')} booked.</span></h1>
        <p class="lede">Scout finds schools, groups and businesses in the Capital Region. Writer drafts outreach from the Partner Guide, and Reviewer checks every message against Our Commitments.</p>
      </div>
      <button type="button" class="btn btn-primary" data-action="runAgents" data-agent="outreach">Run agents now</button>
    </header>
    ${addressBanner(app)}
    <section class="tiles" aria-label="Pipeline">
      <div class="tile"><span class="tile-label">New prospects this month</span><span class="tile-value">${d.stats.prospects}</span></div>
      <div class="tile tile-hi"><span class="tile-label">Ready for your OK</span><span class="tile-value">${d.stats.ready}</span></div>
      <div class="tile"><span class="tile-label">Intro calls booked</span><span class="tile-value">${d.stats.calls}</span></div>
      <div class="tile"><span class="tile-label">Naloxone access points live</span><span class="tile-value">${d.stats.accessPoints}</span></div>
    </section>
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
      <div class="head-text"><span class="eyebrow">Prospect Scout · ${t.region.replace(', Louisiana', '')}</span><h1>Who should hear from us next</h1>
      <p class="lede">Each prospect is matched to an offering from the Partner Guide, with the reason it fits and a contact to reach.</p></div>
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
      <div class="head-text"><span class="eyebrow">Execution · How to partner, five steps</span><h1>Every partnership, from hello to impact</h1></div>
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

export default {
  'o-week': week,
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

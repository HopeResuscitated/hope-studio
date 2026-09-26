// Grant Studio: This week · Scout · Writer + Reviewer · Knowledge base

import { html, icon, chip, money, moneyRange, fdate, ago, dialog, field, toast, when, stateChip, plural, esc, downloadText, copyText } from '../ui.js';
import { knowledgeScreen } from './knowledge.js';

const SOURCE_LABEL = { grantsgov: 'Grants.gov', candid: 'Candid', instrumentl: 'Instrumentl', foundation: 'Foundation site' };

function lastRunLine(run, fallback) {
  if (!run) return fallback;
  return `Last run ${fdate(run.started_at, { time: true })} (${run.trigger === 'schedule' || run.actor === 'scheduler' ? 'scheduled' : 'manual'}). ${run.summary || ''}`;
}

export const checksList = (results, { onlyFlags = false, advice = true } = {}) => html`<ul class="checks">${results.filter((r) => !onlyFlags || r.result === 'flag').map((r) => html`
  <li class="${r.result === 'pass' ? 'pass' : r.blocking ? 'flag block' : 'flag'}">${icon(r.result === 'pass' ? 'check' : 'alert', 18)}<span>${r.label}${when(advice && r.result === 'flag' && !r.blocking && !r.optional, html` <em class="soft">(advice)</em>`)}</span></li>`)}</ul>`;

export function fixBoxes(results, { applyAction = 'applyFix', skip = null } = {}) {
  const flags = results.filter((r) => r.result === 'flag' && r.suggestion);
  if (!flags.length) return '';
  return flags.map((r) => html`<div class="fixbox ${r.optional ? 'optional' : ''}">
    <span class="fix-label">${r.optional ? 'Optional polish' : `Suggested fix · ${r.label}`}</span>
    <p>${r.suggestion}</p>
    <div class="row gap-s">${when(r.fix, html`<button type="button" class="btn btn-primary btn-sm" data-action="${applyAction}" data-id="${r.id}">Apply</button>`)}
    ${when(r.optional && skip, html`<button type="button" class="btn btn-sm" data-action="${skip}">Skip</button>`, when(r.fix, html`<button type="button" class="btn btn-sm" data-action="focusEditor">Edit myself</button>`))}</div>
  </div>`);
}

export function sourcesRow(citations) {
  if (!citations?.length) return html`<p class="muted small">No sources cited.</p>`;
  const seen = new Set();
  return html`<div class="sources"><span class="mono-label">Sources used</span>${citations.filter((c) => { const k = c.label; if (seen.has(k)) return false; seen.add(k); return true; }).map((c) => html`<span class="src src-${c.type}">${c.label}</span>`)}</div>`;
}

// ---------------------------------------------------------------------------

const week = {
  title: 'Grants · This week',
  load: (app) => app.call('grantsWeek'),
  render(d) {
    const n = d.stats.ready;
    return html`
    <header class="page-head">
      <div class="head-text">
        <span class="eyebrow">${new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Chicago' })} review</span>
        <h1>${n ? `${n === 1 ? 'One draft is' : `${['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'][n] || n} drafts are`} waiting for you, ${d.first}.` : `Nothing is waiting on you, ${d.first}.`}</h1>
        <p class="lede">${d.lastRun ? lastRunLine(d.lastRun) : 'The agents run Mondays at 6:00 AM. Scout searches Grants.gov, Candid and Instrumentl, Writer drafts from your knowledge base, and Reviewer checks each draft against its funder\'s rubric.'}</p>
      </div>
      <button type="button" class="btn btn-primary" data-action="runAgents" data-agent="grant">Run agents now</button>
    </header>
    <section class="tiles" aria-label="Pipeline">
      <div class="tile"><span class="tile-label">Found by Scout this month</span><span class="tile-value">${d.stats.found}</span></div>
      <div class="tile"><span class="tile-label">Eligible matches</span><span class="tile-value">${d.stats.eligible}</span></div>
      <div class="tile tile-hi"><span class="tile-label">Drafted, ready for you</span><span class="tile-value">${d.stats.ready}</span></div>
      <div class="tile"><span class="tile-label">Submitted this month</span><span class="tile-value">${d.stats.submitted}</span></div>
    </section>
    ${d.deadlines.map((g) => html`<div class="banner">${icon('alert')}<span><strong>${g.title}</strong> (${g.funder}) is due in ${plural(g.days, 'day')}.</span></div>`)}
    <div class="cols">
      <section class="col-main" aria-labelledby="drafts-h">
        <h2 class="section-title" id="drafts-h">Drafts to review</h2>
        ${d.drafts.length ? d.drafts.map((c) => html`
        <article class="card">
          <div class="card-top">
            <div class="stack-xs"><span class="card-kicker">${c.grant.funder} · ${c.grant.program || SOURCE_LABEL[c.grant.source] || ''}${when(c.grant.sample, html` <span class="tag-sample">Sample</span>`)}</span>
            <span class="card-title">${c.grant.title}</span></div>
            ${chip(c.chip.label, c.chip.tone)}
          </div>
          <div class="meta"><span><strong>${money(c.draft.request_amount)}</strong> request</span><span>Due ${fdate(c.grant.deadline, { weekday: false })}</span><span>Rubric: ${c.draft.rubric_met} of ${c.draft.rubric_total} met</span>${c.approval && c.approval.state !== 'needs_you' ? html`<span>${stateChip(c.approval.state)}</span>` : ''}</div>
          <div class="actions">
            <button type="button" class="btn btn-primary" data-action="go" data-route="g-writer" data-id="${c.draft.id}">Review draft</button>
            ${c.draft.gdoc_url ? html`<a class="btn" href="${c.draft.gdoc_url}" target="_blank" rel="noopener">Open in Google Docs ${icon('external', 16)}</a>` : ''}
          </div>
        </article>`) : html`<div class="empty"><p>No drafts yet. Send a Scout find to the Writer, or run the agents.</p><button type="button" class="btn" data-action="go" data-route="g-scout">Open Scout</button></div>`}
      </section>
      <aside class="col-side" aria-labelledby="facts-h">
        <h2 class="section-title" id="facts-h">Facts the drafts quote</h2>
        <div class="card facts-card">
          ${d.facts.map((f) => html`<div class="fact"><span class="fact-value">${f.value}</span><span class="muted">${f.label}</span></div>`)}
          <button type="button" class="link-btn" data-action="go" data-route="g-kb">Manage knowledge base</button>
        </div>
      </aside>
    </div>`;
  },
};

// ---------------------------------------------------------------------------

const scout = {
  title: 'Grants · Scout',
  load: (app) => app.call('grantsScout', { source: app.pref('scoutSource', 'all'), showDropped: app.pref('showDropped', false) }),
  render(d, app) {
    const source = app.pref('scoutSource', 'all');
    return html`
    <header class="page-head">
      <div class="head-text">
        <span class="eyebrow">Scout agent</span>
        <h1>New funding that fits your mission</h1>
        <p class="lede">${lastRunLine(d.lastRun, 'Scout runs Mondays at 6:00 AM.')} Each find is checked against your eligibility profile before it reaches you.</p>
      </div>
      <div class="row gap-s wrap">
        <button type="button" class="btn" data-action="addGrantMenu">${icon('plus', 16)} Add grants</button>
        <button type="button" class="btn btn-primary" data-action="runAgents" data-agent="grant">Run Scout now</button>
      </div>
    </header>
    <div class="filters" role="group" aria-label="Filter by source">
      ${[['all', 'All sources'], ['grantsgov', 'Grants.gov'], ['candid', 'Candid'], ['instrumentl', 'Instrumentl'], ['foundation', 'Foundation sites']].map(([k, l]) => html`<button type="button" aria-pressed="${source === k}" data-action="setPref" data-key="scoutSource" data-value="${k}">${l}${k !== 'all' && d.counts[k] ? html` <span class="count">${d.counts[k]}</span>` : ''}</button>`)}
    </div>
    <div class="cols">
      <section class="col-main" aria-label="Matches">
        ${d.grants.length ? d.grants.map((g) => html`
        <article class="card ${g.match === 'drop' ? 'card-dim' : ''}">
          <div class="card-top">
            <div class="stack-xs"><span class="card-kicker">${SOURCE_LABEL[g.source] || g.source} · ${g.funder}${when(g.sample, html` <span class="tag-sample">Sample</span>`)}</span><span class="card-title">${g.title}</span></div>
            ${g.draft ? chip('Drafted', 'info') : g.match === 'strong' ? chip('Strong match', 'good') : g.match === 'possible' ? chip(g.checks.filter((c) => c.ok === null).length > 1 ? `Check ${g.checks.filter((c) => c.ok === null).length} rules` : 'Check one rule', 'warn') : chip('Dropped', 'muted')}
          </div>
          <p>${g.match_reason}</p>
          <div class="tags">${g.checks.map((c) => html`<span class="tagline ${c.ok === true ? 'ok' : c.ok === null ? 'unk' : 'no'}">${icon(c.ok === true ? 'check' : c.ok === null ? 'alert' : 'close', 14)}${c.label}</span>`)}</div>
          <div class="meta"><span>Award ${moneyRange(g.amount_min, g.amount_max)}</span><span>Due ${fdate(g.deadline, { weekday: false, year: true })}</span></div>
          <div class="actions">
            ${g.draft ? html`<button type="button" class="btn btn-primary" data-action="go" data-route="g-writer" data-id="${g.draft.id}">Open draft</button>`
              : html`<button type="button" class="btn btn-primary" data-action="sendToWriter" data-id="${g.id}"${g.match === 'drop' ? ' disabled' : ''}>Send to Writer</button>`}
            ${g.rfp_url ? html`<a class="btn" href="${g.rfp_url}" target="_blank" rel="noopener">Read full RFP ${icon('external', 16)}</a>` : ''}
            ${!g.draft ? html`<button type="button" class="btn btn-ghost" data-action="dismissGrant" data-id="${g.id}">Dismiss</button>` : ''}
          </div>
        </article>`) : html`<div class="empty"><p>No matches from this source yet.</p></div>`}
        ${d.dropped ? html`<button type="button" class="link-btn" data-action="setPref" data-key="showDropped" data-value="${app.pref('showDropped', false) ? '' : '1'}">${app.pref('showDropped', false) ? 'Hide' : 'Show'} ${plural(d.dropped, 'find')} the filter dropped</button>` : ''}
      </section>
      <aside class="col-side" aria-labelledby="profile-h">
        <div class="card">
          <h2 class="section-title" id="profile-h">Your eligibility profile</h2>
          <dl class="dl">
            <div><dt>Status</dt><dd>${d.profile.status}</dd></div>
            <div><dt>Based in</dt><dd>${d.profile.based_in}</dd></div>
            <div><dt>Serves</dt><dd>${d.profile.serves}</dd></div>
            <div><dt>Focus</dt><dd>${d.profile.focus}</dd></div>
            <div><dt>Certifications</dt><dd>${d.profile.certifications}</dd></div>
            <div><dt>Award size</dt><dd>${money(d.rules.award_min)}–${money(d.rules.award_max)}</dd></div>
            <div><dt>Deadline</dt><dd>${d.rules.min_days_to_deadline}+ days away</dd></div>
          </dl>
          <button type="button" class="btn" data-action="editProfile">Edit profile</button>
        </div>
        <p class="muted small">${d.grantsgov ? 'Grants.gov is searched every Monday.' : 'Grants.gov search runs on the server. Paste Instrumentl alerts or import a Candid CSV any time.'}</p>
      </aside>
    </div>`;
  },
  actions: {
    async sendToWriter(el, app) {
      const g = (await app.call('grantsScout', { source: 'all', showDropped: true })).grants.find((x) => x.id === el.dataset.id);
      const data = await dialog({
        title: 'Send to Writer',
        submit: 'Draft proposal',
        body: html`<p class="muted">Writer drafts one answer per RFP question from your knowledge base. Paste the funder's questions to use their limits, or leave it blank for the standard five.</p>
          ${field('Request amount (USD)', 'request_amount', { value: g?.amount_max || '', type: 'number' })}
          ${field('RFP questions (optional)', 'rfp_text', { rows: 7, placeholder: '1. Organization background (1,000 characters)\n2. Statement of need (800 characters)' })}`,
      });
      if (!data) return;
      const draft = await app.call('sendToWriter', { grantId: el.dataset.id, request_amount: data.request_amount || null, rfp_text: data.rfp_text });
      toast('Draft ready for review');
      app.go('g-writer', draft.id);
    },
    async dismissGrant(el, app) {
      await app.call('dismissGrant', { grantId: el.dataset.id });
      toast('Dismissed');
      app.refresh();
    },
    async editProfile(el, app) {
      const s = (await app.call('settings')).settings;
      const p = s.org_profile;
      const r = s.grant_rules;
      const data = await dialog({
        title: 'Eligibility profile',
        body: html`<div class="form-grid">${field('Status', 'status', { value: p.status })}${field('Based in', 'based_in', { value: p.based_in })}${field('Serves', 'serves', { value: p.serves })}${field('Focus', 'focus', { value: p.focus })}${field('Certifications', 'certifications', { value: p.certifications })}
        ${field('Smallest award worth applying for', 'award_min', { value: r.award_min, type: 'number' })}${field('Largest award', 'award_max', { value: r.award_max, type: 'number' })}${field('Minimum days before deadline', 'min_days_to_deadline', { value: r.min_days_to_deadline, type: 'number' })}${field('Scout keywords (comma separated)', 'keywords', { value: r.keywords.join(', ') })}</div>`,
      });
      if (!data) return;
      await app.call('updateProfile', {
        profile: { status: data.status, based_in: data.based_in, serves: data.serves, focus: data.focus, certifications: data.certifications },
        rules: { award_min: +data.award_min, award_max: +data.award_max, min_days_to_deadline: +data.min_days_to_deadline, keywords: data.keywords.split(',').map((x) => x.trim()).filter(Boolean) },
      });
      toast('Profile saved');
      app.refresh();
    },
    async addGrantMenu(el, app) {
      const data = await dialog({
        title: 'Add grants',
        submit: 'Add',
        wide: true,
        body: html`<div class="field"><label for="f-kind">Where from</label><select id="f-kind" name="kind">
          <option value="instrumentl">Paste an Instrumentl alert email</option><option value="candid">Paste a Candid CSV export</option><option value="foundation">Add one from a foundation site</option></select></div>
          ${field('Paste here (alert email or CSV)', 'text', { rows: 7, placeholder: 'Grant: …\nFunder: …\nAmount: up to $25,000\nDeadline: November 14, 2026\nhttps://…' })}
          <fieldset class="fieldset"><legend>Or one grant by hand</legend><div class="form-grid">
          ${field('Funder', 'funder')}${field('Grant name', 'title')}${field('Smallest award', 'amount_min', { type: 'number' })}${field('Largest award', 'amount_max', { type: 'number' })}${field('Deadline', 'deadline', { type: 'date' })}${field('RFP link', 'rfp_url', { type: 'url' })}</div>
          ${field('Eligibility and description', 'description', { rows: 3 })}</fieldset>`,
      });
      if (!data) return;
      if (data.kind === 'foundation' || (!data.text && data.title)) {
        const g = await app.call('addGrant', { source: 'foundation', funder: data.funder, title: data.title, amount_min: data.amount_min, amount_max: data.amount_max, deadline: data.deadline, rfp_url: data.rfp_url, description: data.description, eligibility_text: data.description });
        toast(g ? `Added. Filter says: ${g.match}.` : 'Already on your list.');
      } else {
        const r = await app.call(data.kind === 'candid' ? 'importCandid' : 'importInstrumentl', { text: data.text });
        toast(`${plural(r.added, 'new grant')} added from ${r.parsed}`);
      }
      app.refresh();
    },
  },
};

// ---------------------------------------------------------------------------

const writer = {
  title: 'Grants · Draft',
  async load(app) {
    const d = await app.call('grantDraft', { id: app.sel('g-writer') });
    if (d && d.draft.id !== app.sel('g-writer')) app.setSel('g-writer', d.draft.id);
    return d;
  },
  render(d, app) {
    if (!d) return html`<div class="empty"><h1>No drafts yet</h1><p>Send a grant from Scout to the Writer.</p><button type="button" class="btn btn-primary" data-action="go" data-route="g-scout">Open Scout</button></div>`;
    const current = d.answers.find((a) => a.id === app.sel('g-answer')) || d.answers.find((a) => a.results.some((r) => r.result === 'flag' && r.blocking)) || d.answers[0];
    const a = d.approval;
    const approved = a && ['approved', 'executed'].includes(a.state);
    const blockers = d.answers.flatMap((x) => x.results).filter((r) => r.result === 'flag' && r.blocking).length;
    const over = current.text.length - current.limit_chars;
    return html`
    <header class="page-head">
      <div class="head-text">
        <button type="button" class="back" data-action="go" data-route="g-week">${icon('left', 16)} Back to this week</button>
        <h1 class="h1-sm">${d.grant.title}</h1>
        <span class="muted">${d.grant.funder} · ${d.grant.program || 'Grant'} · ${money(d.draft.request_amount)} · Due ${fdate(d.grant.deadline, { weekday: false, year: true })}</span>
      </div>
      <div class="row gap-s wrap">
        ${d.draft.gdoc_url ? html`<a class="btn" href="${d.draft.gdoc_url}" target="_blank" rel="noopener">${d.draft.gdoc_url.includes('docs.google') ? 'Open in Google Docs' : 'Download .doc'} ${icon('external', 16)}</a>` : ''}
        <button type="button" class="btn" data-action="exportDraft" data-id="${d.draft.id}"${approved ? '' : ' disabled'}>Export to Google Docs</button>
        <button type="button" class="btn btn-primary" data-action="markReady" data-id="${d.draft.id}"${approved && d.draft.status !== 'ready' && d.draft.status !== 'submitted' ? '' : ' disabled'}>${d.draft.status === 'ready' ? 'Ready to submit' : d.draft.status === 'submitted' ? 'Submitted' : 'Mark ready to submit'}</button>
      </div>
    </header>
    <div class="approval-bar ${approved ? 'ok' : blockers ? 'block' : ''}">
      ${approved ? html`${icon('check')}<span><strong>Approved</strong>${a.decided_at ? ` ${ago(a.decided_at)}` : ''}. Export it, then mark it ready when the attachments are in.${d.draft.status === 'ready' ? html` <button type="button" class="link-btn" data-action="markSubmitted" data-id="${d.draft.id}">I submitted it in the funder portal</button>` : ''}</span>`
        : blockers ? html`${icon('alert')}<span><strong>${plural(blockers, 'blocking flag')}</strong> before this can be approved. Reviewer shows the fix.</span>`
          : html`${icon('dot')}<span><strong>Needs your OK.</strong> Nothing exports or goes to the funder until someone approves it.</span><button type="button" class="btn btn-primary btn-sm" data-action="approveDraft" data-id="${d.draft.id}">Approve draft</button>`}
    </div>
    <div class="writer">
      <section class="qcol" aria-labelledby="q-h">
        <h2 class="mono-label" id="q-h">Questions</h2>
        ${d.answers.map((x) => {
    const o = x.text.length > x.limit_chars;
    return html`<button type="button" class="qitem ${x.id === current.id ? 'current' : ''} ${o ? 'over' : ''}" data-action="selectAnswer" data-id="${x.id}"${x.id === current.id ? ' aria-current="true"' : ''}>
          <span>${x.order}. ${x.question}</span><span class="qcount">${x.text.length.toLocaleString('en-US')} / ${x.limit_chars.toLocaleString('en-US')}${o ? ` · ${x.text.length - x.limit_chars} over` : ' characters'}</span></button>`;
  })}
        <div class="card card-flat">
          <h3 class="mono-label">Attachments</h3>
          <ul class="attach">${d.draft.attachments.map((t, i) => html`<li><label><input type="checkbox" data-change="toggleAttachment" data-id="${d.draft.id}" data-index="${i}"${t.done ? ' checked' : ''}> ${t.name}</label></li>`)}</ul>
          <button type="button" class="link-btn" data-action="addAttachment" data-id="${d.draft.id}">Add an attachment</button>
        </div>
        <button type="button" class="link-btn" data-action="reparse" data-id="${d.draft.id}">Paste the funder's RFP questions</button>
      </section>
      <section class="card editor-card" aria-labelledby="ans-h">
        <div class="card-top"><h2 class="section-title" id="ans-h">${current.order}. ${current.question}</h2><span class="counter ${over > 0 ? 'over' : ''}" id="counter" data-limit="${current.limit_chars}">${current.text.length.toLocaleString('en-US')} / ${current.limit_chars.toLocaleString('en-US')}</span></div>
        <p class="muted small">Funder prompt: ${current.prompt}</p>
        <label class="sr-only" for="answer-text">Answer</label>
        <textarea id="answer-text" class="editor" rows="14" data-input="count" data-limit="${current.limit_chars}">${current.text}</textarea>
        <div class="row between wrap gap-s">
          ${sourcesRow(current.citations)}
          <div class="row gap-s"><button type="button" class="btn btn-sm" data-action="redraft" data-id="${current.id}">${icon('refresh', 16)} Redraft</button><button type="button" class="btn btn-primary btn-sm" data-action="saveAnswer" data-id="${current.id}">Save and re-check</button></div>
        </div>
        <p class="muted small">Drafted by ${current.model === 'template' ? 'the offline Writer (templates from your knowledge base)' : current.model === 'final' ? 'Claude Opus 5.5' : 'Claude Sonnet 5'}${current.edited_by ? `, edited by ${current.edited_by}` : ''}.</p>
      </section>
      <aside class="card reviewer" aria-labelledby="rev-h">
        <div class="stack-xs"><h2 class="section-title" id="rev-h">Reviewer</h2><span class="muted small">This answer, then the funder's rubric</span></div>
        ${checksList(current.results)}
        ${fixBoxes(current.results)}
        <h3 class="mono-label">Rubric · ${d.draft.rubric_met} of ${d.draft.rubric_total} met</h3>
        ${checksList(d.rubric, { advice: false })}
        ${d.rubric.filter((r) => r.result === 'flag' && r.suggestion).map((r) => html`<p class="small muted">${r.label}: ${r.suggestion}</p>`)}
      </aside>
    </div>`;
  },
  actions: {
    selectAnswer(el, app) { app.setSel('g-answer', el.dataset.id); app.refresh(); },
    focusEditor() { document.getElementById('answer-text')?.focus(); },
    async saveAnswer(el, app) {
      await app.call('updateAnswer', { id: el.dataset.id, text: document.getElementById('answer-text').value });
      toast('Saved. Reviewer checked it again.');
      app.refresh();
    },
    async redraft(el, app) {
      await app.call('redraftAnswer', { id: el.dataset.id });
      toast('Redrafted from the knowledge base');
      app.refresh();
    },
    async applyFix(el, app) {
      await app.call('applyFix', { resultId: el.dataset.id });
      toast('Fix applied');
      app.refresh();
    },
    async approveDraft(el, app) {
      await app.call('approveDraft', { draftId: el.dataset.id });
      toast('Approved');
      app.refresh();
    },
    async exportDraft(el, app) {
      const draftId = el.dataset.id;
      const data = await dialog({
        title: 'Export Grant Proposal',
        submit: '',
        cancel: 'Close',
        wide: true,
        body: html`
          <p class="muted small mb-m">Choose an export format for this completed grant proposal:</p>
          <div class="grid-2 gap-s">
            <button type="button" class="card btn-card" data-action="exportGoogleDocs" data-id="${draftId}">
              <strong>${icon('doc', 18)} Export to Google Docs / Word</strong>
              <span class="muted small">Exports formatted proposal document</span>
            </button>
            <button type="button" class="card btn-card" data-action="exportMarkdown" data-id="${draftId}">
              <strong>${icon('download', 18)} Download Markdown (.md)</strong>
              <span class="muted small">Full proposal formatted in clean markdown</span>
            </button>
            <button type="button" class="card btn-card" data-action="exportText" data-id="${draftId}">
              <strong>${icon('copy', 18)} Download Plain Text (.txt)</strong>
              <span class="muted small">Copy/paste ready for portal text boxes</span>
            </button>
            <button type="button" class="card btn-card" data-action="viewCleanProposal" data-id="${draftId}">
              <strong>${icon('external', 18)} View Printable Preview</strong>
              <span class="muted small">Printable clean document layout</span>
            </button>
          </div>
        `,
      });
    },
    async exportGoogleDocs(el, app) {
      const r = await app.call('exportDraft', { draftId: el.dataset.id });
      if (r.result?.url) {
        toast(r.result.url.includes('docs.google') ? 'Exported to Google Docs' : 'Saved as a Word file');
        if (r.result.url.includes('docs.google')) window.open(r.result.url, '_blank');
      } else {
        await dialog({
          title: 'Export preview', submit: '', cancel: 'Close', wide: true,
          body: html`<p class="banner">${icon('alert')}<span>${r.result?.note || 'Google Docs is not connected.'}</span></p><article class="doc-preview"><h3>${r.doc.title}</h3><p class="muted">${r.doc.meta}</p>${r.doc.sections.map((s) => html`<h4>${s.heading}</h4><p class="muted small">${s.count}</p>${s.text.split(/\n{2,}/).map((p) => html`<p>${p}</p>`)}`)}</article>`,
        });
      }
      app.refresh();
    },
    async exportMarkdown(el, app) {
      const res = await app.call('exportProposal', { draftId: el.dataset.id, format: 'markdown' });
      downloadText(res.filename, res.content, res.mime);
    },
    async exportText(el, app) {
      const res = await app.call('exportProposal', { draftId: el.dataset.id, format: 'text' });
      downloadText(res.filename, res.content, res.mime);
    },
    async viewCleanProposal(el, app) {
      const res = await app.call('exportProposal', { draftId: el.dataset.id, format: 'text' });
      await dialog({
        title: `Proposal: ${res.title}`,
        submit: 'Copy All',
        cancel: 'Close',
        wide: true,
        body: html`<textarea class="editor mono" rows="18" readonly id="proposal-raw">${res.content}</textarea>`,
      });
      const txt = document.getElementById('proposal-raw')?.value;
      if (txt) copyText(txt);
    },
    async markReady(el, app) { await app.call('markReady', { draftId: el.dataset.id }); toast('Marked ready to submit'); app.refresh(); },
    async markSubmitted(el, app) { await app.call('markSubmitted', { draftId: el.dataset.id }); toast('Recorded as submitted'); app.refresh(); },
    async addAttachment(el, app) {
      const data = await dialog({ title: 'Add an attachment', submit: 'Add', body: field('What the funder asks for', 'name', { required: true, autofocus: true, placeholder: 'Letters of support' }) });
      if (!data?.name) return;
      await app.call('addAttachment', { draftId: el.dataset.id, name: data.name });
      app.refresh();
    },
    async reparse(el, app) {
      const data = await dialog({ title: 'Paste RFP questions', submit: 'Parse and redraft', wide: true, body: html`<p class="muted">One numbered question per line, with its limit. Writer redrafts every answer to fit.</p>${field('Questions', 'text', { rows: 9, required: true, autofocus: true, placeholder: '1. Organization background (1,000 characters)\n2. Statement of need: describe the problem and who is affected (800 characters)\n3. Program design (250 words)' })}` });
      if (!data?.text) return;
      await app.call('reparseRfp', { draftId: el.dataset.id, text: data.text });
      toast('Questions parsed and redrafted');
      app.refresh();
    },
  },
  changes: {
    async toggleAttachment(el, app) { await app.call('toggleAttachment', { draftId: el.dataset.id, index: +el.dataset.index }); app.refresh(); },
  },
};

export default {
  'g-week': week,
  'g-scout': scout,
  'g-writer': writer,
  'g-kb': knowledgeScreen('grants', {
    eyebrow: 'The brain',
    lede: 'Writer only quotes what lives here, so drafts never invent programs, numbers or budgets.',
    ask: 'What does one Narcan dose cost us?',
    askLabel: 'Ask what Writer would find',
  }),
};

export { esc };

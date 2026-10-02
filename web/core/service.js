// The Hope Studio API. Every screen reads through one of these methods and
// every button calls one. The server exposes them at POST /api/rpc/<method>;
// the browser demo calls them directly. Roles: public, user, approver, admin.

import { audit, raiseAlert } from './audit.js';
import { AGENTS, STATE_LABEL, PILLARS, OFFERINGS, SEGMENTS, PARTNERSHIP_STEPS } from './schema.js';
import { approvalFor, approve, reject, snooze, wakeSnoozed } from './approvals.js';
import { askKb, ingestDocument, kbGaps } from './kb.js';
import { withRun, recordUsage, checkBudget, logRun } from './runs.js';
import { currentMonthKey, monthOfISO, addMonths, monthLabel, daysUntil, DAY_MS, money } from './util.js';
import { clearSamples, seedAll } from './seed.js';
import { resultsFor } from './agents/common.js';
import * as G from './agents/grant.js';
import * as O from './agents/outreach.js';
import * as S from './agents/social.js';

const ROLE_RANK = { public: 0, user: 1, approver: 2, admin: 3 };
const userRank = (u) => (!u ? 0 : u.role === 'admin' ? 3 : u.role === 'approver' ? 2 : 1);

export function createService({ store, llm = { available: false }, integrations = { mode: 'demo' } }) {
  // Wrap the model client so every call is budgeted and costed on its run.
  const meteredLlm = {
    get available() { return !!llm.available; },
    async json(opts) {
      checkBudget(store, opts.run);
      const { data, usage, model } = await llm.json(opts);
      recordUsage(store, opts.run, model, usage || {});
      return data;
    },
    async text(opts) {
      checkBudget(store, opts.run);
      const { data, usage, model } = await llm.text(opts);
      recordUsage(store, opts.run, model, usage || {});
      return data;
    },
  };

  const ctxFor = (actor) => ({ store, llm: meteredLlm, integrations, actor, mode: integrations.mode, run: null });
  const M = {};
  const def = (name, role, fn) => { M[name] = { role, fn }; };

  const itemRoute = (a) => (a.item_type === 'grant_draft' ? { route: 'g-writer', id: a.item_id }
    : a.item_type === 'message' ? { route: 'o-writer', id: a.item_id } : { route: 's-composer', id: a.item_id });

  const needsYou = (agent) => store.all('approval_items', (a) => a.state === 'needs_you' && (!agent || a.agent === agent));
  const lastRun = (agent) => store.all('runs', (r) => r.agent === agent || r.agent === 'all').sort((a, b) => b.started_at.localeCompare(a.started_at))[0] || null;
  const fact = (key) => store.find('facts', (f) => f.key === key);

  // -------------------------------------------------------------------------
  // Session and shell

  def('me', 'user', (_, ctx) => ({
    user: publicUser(ctx.actor),
    mode: integrations.mode,
    samples: !!store.meta().samples,
    counts: {
      inbox: needsYou().length,
      grant: needsYou('grant').length,
      outreach: needsYou('outreach').length,
      social: needsYou('social').length,
      alerts: store.count('alerts', (a) => !a.resolved),
    },
    integrations: integrationStatus(),
    llm: !!llm.available,
    needs_address: !(store.settings().mailing_address || '').trim(),
  }));

  function integrationStatus() {
    const s = (x) => !!x?.available;
    return {
      claude: !!llm.available, gmail: s(integrations.gmail), docs: s(integrations.docs), meta: s(integrations.meta),
      grantsgov: s(integrations.grantsgov), places: s(integrations.places),
    };
  }

  // -------------------------------------------------------------------------
  // Agents

  def('runAgents', 'approver', async ({ agent = 'all' }, ctx) => {
    const out = [];
    if (agent === 'grant' || agent === 'all') out.push(await withRun(ctx, 'grant', 'manual', (r) => G.weeklyGrantRun(r)));
    if (agent === 'outreach' || agent === 'all') out.push(await withRun(ctx, 'outreach', 'manual', (r) => weeklyOutreachRun(r)));
    if (agent === 'social' || agent === 'all') out.push(await withRun(ctx, 'social', 'manual', (r) => socialPlannerRun(r)));
    return out.map((o) => ({ agent: o.run.agent, status: o.run.status, summary: o.run.summary, cost: o.run.cost_usd }));
  });

  async function weeklyOutreachRun(ctx) {
    const scout = await O.scoutProspects(ctx);
    const max = store.settings().targeting?.max_auto_drafts ?? 5;
    const ready = store.all('prospects', (p) => p.status === 'new' && p.fit === 'strong').slice(0, max);
    for (const p of ready) await O.draftOutreach(ctx, p.id);
    const follow = await O.followUpCheck(ctx);
    return `Scout found ${scout.found} (${scout.created} new). Writer drafted ${ready.length} sequences. ${follow} follow-ups queued.`;
  }

  async function socialPlannerRun(ctx) {
    const key = currentMonthKey();
    const a = await S.autofill(ctx, key);
    const b = await S.autofill(ctx, addMonths(key, 1));
    return `Planner drafted ${a.created.length + b.created.length} posts; ${a.open.length + b.open.length} slots still need media.`;
  }

  // Scheduler jobs (server only; Central time).
  const jobs = {
    weeklyRun: (actor = 'scheduler') => M.runAgents.fn({ agent: 'grant' }, ctxFor(actor)).then(() => M.runAgents.fn({ agent: 'outreach' }, ctxFor(actor))),
    socialPlanner: (actor = 'scheduler') => withRun(ctxFor(actor), 'social', 'schedule', (r) => socialPlannerRun(r)),
    publishQueue: (actor = 'scheduler') => S.publishQueue(ctxFor(actor)),
    followUpCheck: async (actor = 'scheduler') => {
      const ctx = ctxFor(actor);
      await O.checkReplies(ctx);
      return O.followUpCheck(ctx);
    },
    deadlineWatch: (actor = 'scheduler') => G.deadlineWatch(ctxFor(actor)),
    wakeSnoozed: (actor = 'scheduler') => wakeSnoozed(ctxFor(actor)),
  };

  // -------------------------------------------------------------------------
  // Approvals inbox

  def('inbox', 'user', () => {
    const rows = store.all('approval_items').sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map((a) => ({
      ...a, state_label: STATE_LABEL[a.state], agent_label: AGENTS[a.agent]?.label, link: itemRoute(a),
      flags_list: store.all('review_results', (r) => r.item_id === a.item_id && r.result === 'flag' && !r.optional).map((r) => ({ label: r.label, blocking: r.blocking })),
      decided_by_name: a.decided_by ? store.get('users', a.decided_by)?.name : null,
      detail: approvalDetail(a),
    }));
    return { rows };
  });

  function approvalDetail(a) {
    if (a.item_type === 'post') {
      const p = store.get('posts', a.item_id);
      return p ? { when: p.scheduled_at, pillar: p.pillar, status: p.status } : null;
    }
    if (a.item_type === 'message') {
      const m = store.get('messages', a.item_id);
      return m ? { to: m.to, status: m.status } : null;
    }
    const d = store.get('grant_drafts', a.item_id);
    return d ? { status: d.status, request: d.request_amount } : null;
  }

  def('approve', 'approver', async ({ id }, ctx) => {
    const a = store.get('approval_items', id);
    if (a.item_type === 'post') return S.approvePost(ctx, a.item_id);
    return approve(ctx, id);
  });
  def('reject', 'approver', ({ id, note }, ctx) => {
    const a = reject(ctx, id, note);
    if (a.item_type === 'post') store.update('posts', a.item_id, { status: 'rejected' });
    if (a.item_type === 'message') store.update('messages', a.item_id, { status: 'cancelled' });
    return a;
  });
  def('snooze', 'approver', ({ id, days = 3 }, ctx) => snooze(ctx, id, days));
  def('reopen', 'approver', async ({ id }, ctx) => {
    const a = store.get('approval_items', id);
    if (a.item_type === 'post') { store.update('posts', a.item_id, { status: 'drafted' }); await S.reviewPost(ctx, a.item_id); }
    if (a.item_type === 'message') { store.update('messages', a.item_id, { status: 'drafted' }); await O.reviewMessage(ctx, a.item_id, { open: true }); }
    if (a.item_type === 'grant_draft') await G.reviewDraft(ctx, a.item_id);
    return store.get('approval_items', id);
  });

  // Apply a Reviewer fix to whatever item it belongs to.
  def('applyFix', 'user', async ({ resultId }, ctx) => {
    const r = store.get('review_results', resultId);
    if (!r?.fix) throw Object.assign(new Error('This flag has no automatic fix. Edit the text yourself.'), { status: 400 });
    const { field, text } = r.fix;
    if (r.item_type === 'draft_answer') return G.updateAnswer(ctx, r.item_id, text);
    if (r.item_type === 'message') return O.updateMessage(ctx, r.item_id, { [field]: text });
    if (r.item_type === 'post') return S.updatePost(ctx, r.item_id, { [field]: text });
    throw new Error('Unknown item');
  });
  def('skipPolish', 'user', async ({ messageId }, ctx) => {
    store.update('messages', messageId, { polish_skipped: true });
    await O.reviewMessage(ctx, messageId);
    return true;
  });

  // -------------------------------------------------------------------------
  // Grants

  def('grantsWeek', 'user', (_, ctx) => {
    const month = currentMonthKey();
    const drafts = store.all('grant_drafts', (d) => d.status !== 'discarded').map((d) => draftCard(d))
      .sort((a, b) => (a.approval?.state === 'needs_you' ? 0 : 1) - (b.approval?.state === 'needs_you' ? 0 : 1) || String(a.grant.deadline || 'z').localeCompare(String(b.grant.deadline || 'z')));
    const thisMonth = store.all('grants', (g) => monthOfISO(g.created_at) === month);
    return {
      first: (ctx.actor?.name || 'there').split(' ')[0],
      drafts,
      stats: {
        found: thisMonth.length,
        eligible: thisMonth.filter((g) => g.match === 'strong' || g.match === 'possible').length,
        ready: drafts.filter((d) => d.approval?.state === 'needs_you').length,
        submitted: store.count('grant_drafts', (d) => d.status === 'submitted' && monthOfISO(d.submitted_at) === month),
      },
      lastRun: lastRun('grant'),
      facts: ['access_points', 'first_week_doses', 'dose_total'].map((k) => fact(k)).filter(Boolean),
      deadlines: store.all('grants', (g) => g.deadline && !['submitted', 'dismissed', 'dropped'].includes(g.status) && daysUntil(g.deadline) <= 14 && daysUntil(g.deadline) >= 0)
        .map((g) => ({ id: g.id, title: g.title, funder: g.funder, days: daysUntil(g.deadline) })),
    };
  });

  function draftCard(d) {
    const grant = store.get('grants', d.grant_id);
    return { draft: d, grant, chip: G.grantChip(store, d), approval: approvalFor(store, 'grant_draft', d.id) };
  }

  def('grantsScout', 'user', ({ source = 'all', showDropped = false }) => {
    const all = store.all('grants', (g) => g.status !== 'dismissed');
    const list = all.filter((g) => (source === 'all' || g.source === source) && (showDropped || g.match !== 'drop'))
      .map((g) => ({ ...g, draft: store.find('grant_drafts', (d) => d.grant_id === g.id && d.status !== 'discarded') }))
      .sort((a, b) => (a.draft ? 1 : 0) - (b.draft ? 1 : 0) || ({ strong: 0, possible: 1, drop: 2 }[a.match] ?? 3) - ({ strong: 0, possible: 1, drop: 2 }[b.match] ?? 3));
    return {
      grants: list,
      dropped: all.filter((g) => g.match === 'drop').length,
      dismissed: store.count('grants', (g) => g.status === 'dismissed'),
      counts: Object.fromEntries(['grantsgov', 'candid', 'instrumentl', 'foundation'].map((s) => [s, all.filter((g) => g.source === s && g.match !== 'drop').length])),
      profile: store.settings().org_profile,
      rules: store.settings().grant_rules,
      lastRun: lastRun('grant'),
      grantsgov: !!integrations.grantsgov?.available,
    };
  });

  def('sendToWriter', 'user', async ({ grantId, rfp_text, request_amount }, ctx) => {
    const r = await withRun(ctx, 'grant', 'send_to_writer', (rc) => G.sendToWriter(rc, grantId, { rfp_text, request_amount }).then((d) => ({ summary: `Drafted ${store.get('grants', grantId).title}`, draft: d })));
    return r.result.draft;
  });
  def('dismissGrant', 'user', ({ grantId }, ctx) => {
    const before = store.get('grants', grantId);
    const after = store.update('grants', grantId, { status: 'dismissed' });
    audit(store, { actor: ctx.actor, action: 'grant.dismissed', item_type: 'grant', item_id: grantId, before, after });
    return after;
  });
  def('addGrant', 'user', async (g, ctx) => {
    const list = await G.importGrants(ctx, [{ source: 'foundation', ...g, amount_min: g.amount_min ? +g.amount_min : null, amount_max: g.amount_max ? +g.amount_max : null, deadline: g.deadline ? G.parseDate(g.deadline) : null }]);
    return list[0] || null;
  });
  def('importInstrumentl', 'user', async ({ text }, ctx) => {
    const parsed = G.parseInstrumentlAlert(text);
    if (!parsed.length) throw Object.assign(new Error('No grants found. Paste the full alert email, one grant per block.'), { status: 400 });
    return { added: (await G.importGrants(ctx, parsed)).length, parsed: parsed.length };
  });
  def('importCandid', 'user', async ({ text }, ctx) => {
    const parsed = G.parseCandidCsv(text);
    if (!parsed.length) throw Object.assign(new Error('No rows found. Export from Candid as CSV with a header row.'), { status: 400 });
    return { added: (await G.importGrants(ctx, parsed)).length, parsed: parsed.length };
  });
  def('updateProfile', 'admin', ({ profile, rules }, ctx) => {
    const before = store.settings();
    store.setSettings({ org_profile: { ...before.org_profile, ...profile }, grant_rules: { ...before.grant_rules, ...rules } });
    audit(store, { actor: ctx.actor, action: 'settings.profile', note: 'Eligibility profile updated' });
    return store.settings();
  });

  def('grantDraft', 'user', ({ id }) => {
    const draft = store.get('grant_drafts', id) || store.all('grant_drafts').find((d) => approvalFor(store, 'grant_draft', d.id)?.state === 'needs_you') || store.all('grant_drafts')[0];
    if (!draft) return null;
    const grant = store.get('grants', draft.grant_id);
    const answers = store.all('draft_answers', (a) => a.draft_id === draft.id).sort((a, b) => a.order - b.order)
      .map((a) => ({ ...a, results: resultsFor(store, 'draft_answer', a.id), citations: (a.citations || []).map((c) => ({ ...c, label: citationLabel(c) })) }));
    return {
      draft, grant, answers, rubric: resultsFor(store, 'grant_draft', draft.id), approval: approvalFor(store, 'grant_draft', draft.id),
      chip: G.grantChip(store, draft), others: store.all('grant_drafts', (d) => d.status !== 'discarded').map((d) => ({ id: d.id, title: store.get('grants', d.grant_id)?.title })),
    };
  });

  function citationLabel(c) {
    if (c.type === 'fact') return store.get('facts', c.id)?.label || c.label || c.key;
    if (c.type === 'chunk') {
      const ch = store.get('chunks', c.id);
      const doc = ch ? store.get('documents', ch.document_id) : null;
      return doc ? doc.title : c.label || 'Knowledge base';
    }
    if (c.type === 'calc') return `${c.label || 'Calculation'} (${c.expr})`;
    return c.label || 'Input';
  }

  def('updateAnswer', 'user', ({ id, text }, ctx) => G.updateAnswer(ctx, id, text));
  def('redraftAnswer', 'user', async ({ id, final }, ctx) => (await withRun(ctx, 'grant', 'redraft', (r) => G.redraftAnswer(r, id, { final }).then(() => 'Redrafted one answer'))).run);
  def('reparseRfp', 'user', async ({ draftId, text }, ctx) => (await withRun(ctx, 'grant', 'rfp', (r) => G.reparseRfp(r, draftId, text).then(() => 'Parsed RFP and redrafted'))).run);
  def('toggleAttachment', 'user', ({ draftId, index }, ctx) => {
    const d = store.get('grant_drafts', draftId);
    const attachments = d.attachments.map((a, i) => (i === +index ? { ...a, done: !a.done } : a));
    const after = store.update('grant_drafts', draftId, { attachments });
    audit(store, { actor: ctx.actor, action: 'grant.attachment', item_type: 'grant_draft', item_id: draftId, note: attachments[index].name });
    return after;
  });
  def('addAttachment', 'user', ({ draftId, name }, ctx) => {
    const d = store.get('grant_drafts', draftId);
    audit(store, { actor: ctx.actor, action: 'grant.attachment.add', item_type: 'grant_draft', item_id: draftId, note: name });
    return store.update('grant_drafts', draftId, { attachments: [...d.attachments, { name, done: false }] });
  });
  def('approveDraft', 'approver', ({ draftId }, ctx) => approve(ctx, approvalFor(store, 'grant_draft', draftId).id));
  def('exportDraft', 'approver', async ({ draftId }, ctx) => G.exportDraft(ctx, draftId));
  def('markReady', 'approver', ({ draftId }, ctx) => G.markReady(ctx, draftId));
  def('markSubmitted', 'approver', ({ draftId }, ctx) => G.markSubmitted(ctx, draftId));

  // -------------------------------------------------------------------------
  // Knowledge base

  def('knowledge', 'user', ({ collection = 'grants' }) => {
    const docs = store.all('documents', (d) => d.collection === collection);
    const groups = {};
    for (const d of docs) (groups[d.group] ||= []).push(d);
    const gaps = kbGaps(store, collection);
    return {
      collection,
      groups: Object.entries(groups).map(([name, items]) => ({ name, items })),
      facts: store.all('facts').map((f) => ({ ...f, source: f.source_document_id ? store.get('documents', f.source_document_id)?.title : null, verified_by_name: f.verified_by ? store.get('users', f.verified_by)?.name : null })),
      gaps,
      counts: { documents: docs.length, indexed: docs.filter((d) => d.status === 'indexed').length, chunks: store.count('chunks', (c) => docs.some((d) => d.id === c.document_id)) },
    };
  });

  def('askKb', 'user', async ({ question, collection }, ctx) => {
    if (!String(question || '').trim()) throw Object.assign(new Error('Type a question first.'), { status: 400 });
    return askKb(ctx, { question, collection });
  });

  def('uploadDocument', 'user', async ({ title, collection = 'grants', group = 'Uploads', text, pdf_base64, replaceId }, ctx) => {
    let body = text;
    if (!body && pdf_base64) {
      if (!llm.available || !llm.pdfText) throw Object.assign(new Error('Reading PDFs needs the server with a Claude API key. Paste the text instead.'), { status: 400 });
      body = await llm.pdfText(pdf_base64);
    }
    if (!String(body || '').trim()) throw Object.assign(new Error('The document is empty.'), { status: 400 });
    const existing = replaceId ? store.get('documents', replaceId) : null;
    const doc = ingestDocument(store, { title: existing?.title || title, collection: existing?.collection || collection, group: existing?.group || group, text: body, shared: existing?.shared ?? false }, ctx.actor);
    for (const g of store.all('kb_gaps', (x) => !x.resolved)) {
      const r = await askKb({ ...ctx, llm: { available: false } }, { question: g.question, collection: g.collection, log: false });
      if (!r.missing) store.update('kb_gaps', g.id, { resolved: true });
    }
    return doc;
  });
  def('removeDocument', 'admin', ({ id }, ctx) => {
    const doc = store.get('documents', id);
    store.removeWhere('chunks', (c) => c.document_id === id);
    store.update('documents', id, { status: 'missing', chunk_count: 0 });
    audit(store, { actor: ctx.actor, action: 'kb.remove', item_type: 'document', item_id: id, before: doc });
    return true;
  });
  def('dismissGap', 'user', ({ id }) => store.update('kb_gaps', id, { resolved: true }));

  // Locked facts change only here, and every change is audit-logged and re-checks drafts.
  def('updateFact', 'admin', async ({ id, value, statement }, ctx) => {
    const before = store.get('facts', id);
    const after = store.update('facts', id, { value, statement: statement ?? before.statement, verified_by: null, verified_at: null });
    audit(store, { actor: ctx.actor, action: 'fact.update', item_type: 'fact', item_id: id, before, after });
    // Re-flag any draft that cites the old value.
    for (const a of store.all('draft_answers', (x) => (x.citations || []).some((c) => c.type === 'fact' && c.id === id))) await G.reviewDraft(ctx, a.draft_id);
    for (const m of store.all('messages', (x) => !['sent', 'cancelled'].includes(x.status) && (x.citations || []).some((c) => c.type === 'fact' && c.id === id))) await O.reviewMessage(ctx, m.id);
    for (const p of store.all('posts', (x) => ['drafted', 'scheduled'].includes(x.status) && (x.citations || []).some((c) => c.type === 'fact' && c.id === id))) await S.reviewPost(ctx, p.id);
    return after;
  });
  def('verifyFact', 'admin', ({ id }, ctx) => {
    const after = store.update('facts', id, { verified_by: ctx.actor.id, verified_at: new Date().toISOString() });
    audit(store, { actor: ctx.actor, action: 'fact.verify', item_type: 'fact', item_id: id, after });
    return after;
  });
  def('addFact', 'admin', ({ key, label, value, statement }, ctx) => {
    const k = String(key || label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    if (store.find('facts', (f) => f.key === k)) throw Object.assign(new Error('A fact with that key exists.'), { status: 409 });
    const row = store.insert('facts', { key: k, label, value, statement: statement || value, source_document_id: null, locked: true, verified_by: ctx.actor.id, verified_at: new Date().toISOString() });
    audit(store, { actor: ctx.actor, action: 'fact.add', item_type: 'fact', item_id: row.id, after: row });
    return row;
  });

  // -------------------------------------------------------------------------
  // Outreach

  def('outreachWeek', 'user', () => {
    const month = currentMonthKey();
    const ready = needsYou('outreach').map((a) => {
      const m = store.get('messages', a.item_id);
      const p = m ? store.get('prospects', m.prospect_id) : null;
      const c = m?.contact_id ? store.get('contacts', m.contact_id) : null;
      if (!m || !p) return null;
      return {
        approval: a, message: m, prospect: p, contact: c,
        segment: SEGMENTS[p.segment]?.label || p.segment,
        step: m.sequence_step === 2 ? 'Follow-up · 7 days no reply' : m.sequence_step === 4 ? 'Impact summary' : 'Email 1 of 3',
        pitch: (p.offerings || []).map((k) => OFFERINGS[k]?.label).filter(Boolean).join(' + '),
        role: c?.title || '', chip: a.blocking ? (store.all('review_results', (r) => r.item_id === m.id && r.check === 'contact' && r.result === 'flag').length ? 'Verify contact' : `${a.blocking} to fix`) : 'All commitments met',
        chipTone: a.blocking ? 'warn' : 'good',
      };
    }).filter(Boolean);
    const upcoming = store.all('partnerships', (p) => p.next_date && daysUntil(p.next_date) >= -1)
      .sort((a, b) => a.next_date.localeCompare(b.next_date)).slice(0, 5);
    return {
      ready,
      stats: {
        prospects: store.count('prospects', (p) => monthOfISO(p.created_at) === month),
        ready: ready.length,
        calls: store.count('partnerships', (p) => p.step === 1 && p.next_date),
        accessPoints: fact('access_points')?.value || '5',
      },
      upcoming: upcoming.map((p) => ({ ...p, step_label: PARTNERSHIP_STEPS[p.step - 1]?.label })),
      lastRun: lastRun('outreach'),
      sent: store.count('messages', (m) => m.status === 'sent'),
    };
  });

  def('prospects', 'user', ({ segment = 'all' }) => {
    const match = { school: ['school'], faith: ['faith', 'youth'], library: ['library', 'agency'], business: ['business'] }[segment];
    const list = store.all('prospects', (p) => p.status !== 'not_now' && (!match || match.includes(p.segment)))
      .map((p) => {
        const contacts = store.all('contacts', (c) => c.prospect_id === p.id);
        const first = store.find('messages', (m) => m.prospect_id === p.id && m.sequence_step === 1 && !['cancelled', 'suppressed'].includes(m.status));
        return { ...p, contacts, contact: contacts.find((c) => c.primary) || contacts[0] || null, message: first, segment_label: SEGMENTS[p.segment]?.label || p.segment, offering_labels: (p.offerings || []).map((k) => OFFERINGS[k]?.short || k) };
      })
      .sort((a, b) => (a.message ? 1 : 0) - (b.message ? 1 : 0) || (a.fit === 'strong' ? 0 : 1) - (b.fit === 'strong' ? 0 : 1));
    return { prospects: list, targeting: store.settings().targeting, suppressions: store.count('suppressions'), notNow: store.count('prospects', (p) => p.status === 'not_now'), lastRun: lastRun('outreach'), places: !!integrations.places?.available, offerings: OFFERINGS };
  });

  def('addProspect', 'user', async (input, ctx) => {
    const out = await O.addProspect(ctx, { ...input, offerings: input.offerings?.length ? input.offerings : undefined, contact: input.email ? { name: input.contact_name, title: input.contact_title, email: input.email, verified: !!input.verified, source_url: input.source_url } : null });
    if (!out.created) throw Object.assign(new Error(out.suppressed ? 'That organization opted out.' : 'That prospect is already on your list or board.'), { status: 409 });
    return out.prospect;
  });
  def('addContact', 'user', ({ prospectId, ...c }, ctx) => O.addContact(ctx, prospectId, c));
  def('updateContact', 'user', ({ id, ...patch }, ctx) => O.updateContact(ctx, id, patch));
  def('upsertContact', 'user', (data, ctx) => O.upsertContactRecord(ctx, data));
  def('deleteContact', 'user', ({ id }, ctx) => O.deleteContactRecord(ctx, id));
  def('logContactCommunication', 'user', ({ contactId, ...entry }, ctx) => O.logContactCommunication(ctx, contactId, entry));
  def('setContactFollowUp', 'user', ({ contactId, ...params }, ctx) => O.setContactFollowUp(ctx, contactId, params));
  def('syncGmailContacts', 'user', (params, ctx) => O.syncGmailContacts(ctx, params || {}));

  def('contactsList', 'user', ({ search = '', segment = 'all', status = 'all', sort = 'followup' } = {}) => {
    let list = store.all('contacts');
    const now = new Date();

    // Enrich contacts with prospect and partnership data
    list = list.map((c) => {
      const prospect = c.prospect_id ? store.get('prospects', c.prospect_id) : null;
      const partnership = c.prospect_id ? store.find('partnerships', (p) => p.prospect_id === c.prospect_id) : null;
      const history = Array.isArray(c.history) ? c.history : [];
      return {
        ...c,
        company: c.company || c.organization || prospect?.name || 'Community Partner',
        position: c.position || c.title || 'Staff Contact',
        segment: c.segment || prospect?.segment || 'agency',
        segment_label: SEGMENTS[c.segment || prospect?.segment || 'agency']?.label || 'Agency',
        prospect,
        partnership,
        history_count: history.length,
      };
    });

    // Filter by search query
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((c) => (
        (c.name || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.phone || '').toLowerCase().includes(q) ||
        (c.company || '').toLowerCase().includes(q) ||
        (c.position || '').toLowerCase().includes(q) ||
        (c.notes || '').toLowerCase().includes(q)
      ));
    }

    // Filter by segment
    if (segment && segment !== 'all') {
      const match = { school: ['school'], faith: ['faith', 'youth'], library: ['library', 'agency'], business: ['business'] }[segment];
      list = list.filter((c) => (match ? match.includes(c.segment) : c.segment === segment));
    }

    // Filter by status
    if (status && status !== 'all') {
      if (status === 'needs_followup') {
        list = list.filter((c) => c.status_of_last_request === 'Needs Follow-up' || (c.next_follow_up_date && new Date(c.next_follow_up_date) <= now));
      } else {
        list = list.filter((c) => (c.status_of_last_request || '').toLowerCase() === status.toLowerCase());
      }
    }

    // Sort list
    if (sort === 'followup') {
      list.sort((a, b) => (a.next_follow_up_date || '9999').localeCompare(b.next_follow_up_date || '9999'));
    } else if (sort === 'last_comm_newest') {
      list.sort((a, b) => (b.last_communication || '').localeCompare(a.last_communication || ''));
    } else if (sort === 'last_comm_oldest') {
      list.sort((a, b) => (a.last_communication || '9999').localeCompare(b.last_communication || '9999'));
    } else if (sort === 'name') {
      list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else if (sort === 'company') {
      list.sort((a, b) => (a.company || '').localeCompare(b.company || ''));
    }

    const allContacts = store.all('contacts');
    const counts = {
      total: allContacts.length,
      needs_followup: allContacts.filter((c) => c.status_of_last_request === 'Needs Follow-up' || (c.next_follow_up_date && new Date(c.next_follow_up_date) <= now)).length,
      awaiting_reply: allContacts.filter((c) => c.status_of_last_request === 'Awaiting Reply').length,
      active_partners: allContacts.filter((c) => c.status_of_last_request === 'Active Partner' || c.status_of_last_request === 'Access Point Active').length,
    };

    return {
      contacts: list,
      counts,
      segments: SEGMENTS,
      lastSync: store.settings().last_gmail_sync || null,
      gmailConnected: !!integrations.gmail?.available,
    };
  });

  def('contactDetails', 'user', ({ id }) => {
    const c = store.get('contacts', id);
    if (!c) throw Object.assign(new Error('Contact not found'), { status: 404 });
    const prospect = c.prospect_id ? store.get('prospects', c.prospect_id) : null;
    const partnership = c.prospect_id ? store.find('partnerships', (p) => p.prospect_id === c.prospect_id) : null;
    const messages = c.prospect_id ? store.all('messages', (m) => m.prospect_id === c.prospect_id).sort((a, b) => a.sequence_step - b.sequence_step) : [];
    const history = (c.history || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date));

    return {
      contact: {
        ...c,
        company: c.company || c.organization || prospect?.name || 'Community Partner',
        position: c.position || c.title || 'Staff Contact',
        segment: c.segment || prospect?.segment || 'agency',
        segment_label: SEGMENTS[c.segment || prospect?.segment || 'agency']?.label || 'Agency',
      },
      prospect,
      partnership,
      messages,
      history,
    };
  });

  def('notNow', 'user', ({ prospectId }, ctx) => {
    const after = store.update('prospects', prospectId, { status: 'not_now' });
    audit(store, { actor: ctx.actor, action: 'prospect.not_now', item_type: 'prospect', item_id: prospectId });
    return after;
  });
  def('draftOutreach', 'user', async ({ prospectId }, ctx) => (await withRun(ctx, 'outreach', 'draft', (r) => O.draftOutreach(r, prospectId).then((m) => ({ summary: 'Drafted a 3-step sequence', m })))).result.m);

  def('sequence', 'user', ({ messageId, prospectId }) => {
    let pid = prospectId;
    if (!pid && messageId) pid = store.get('messages', messageId)?.prospect_id;
    if (!pid) {
      const a = needsYou('outreach')[0];
      pid = a ? store.get('messages', a.item_id)?.prospect_id : store.all('messages')[0]?.prospect_id;
    }
    if (!pid) return null;
    const prospect = store.get('prospects', pid);
    const messages = store.all('messages', (m) => m.prospect_id === pid).sort((a, b) => a.sequence_step - b.sequence_step)
      .map((m) => ({ ...m, results: resultsFor(store, 'message', m.id), approval: approvalFor(store, 'message', m.id), citations: (m.citations || []).map((c) => ({ ...c, label: citationLabel(c) })) }));
    const contact = O.contactFor(store, pid);
    return {
      prospect: { ...prospect, segment_label: SEGMENTS[prospect.segment]?.label }, contact, contacts: store.all('contacts', (c) => c.prospect_id === pid), messages,
      selected: messageId && messages.some((m) => m.id === messageId) ? messageId : messages[0]?.id,
      partnership: store.find('partnerships', (p) => p.prospect_id === pid),
      queue: needsYou('outreach').map((a) => ({ id: a.item_id, title: a.title })),
    };
  });
  def('updateMessage', 'user', ({ id, ...patch }, ctx) => O.updateMessage(ctx, id, patch));
  def('approveAndSend', 'approver', async ({ id }, ctx) => {
    const a = approvalFor(store, 'message', id);
    if (a.state !== 'approved' && a.state !== 'executed') approve(ctx, a.id);
    return O.sendMessage(ctx, id);
  });
  def('saveGmailDraft', 'user', ({ id }, ctx) => O.saveGmailDraft(ctx, id));
  def('markReplied', 'user', ({ id, note }, ctx) => O.markReplied(ctx, id, { note }));
  def('optOut', 'user', ({ email, reason }, ctx) => O.optOut(ctx, email, reason));
  def('checkReplies', 'user', async (_, ctx) => ({ replies: await O.checkReplies(ctx), followups: await O.followUpCheck(ctx) }));

  def('board', 'user', () => {
    const all = store.all('partnerships').sort((a, b) => String(a.next_date || 'z').localeCompare(String(b.next_date || 'z')));
    return {
      columns: PARTNERSHIP_STEPS.map((s) => ({ ...s, cards: all.filter((p) => p.step === s.step).map((p) => ({ ...p, segment_label: SEGMENTS[p.segment]?.label || p.segment, offering_labels: (p.offerings || []).map((k) => OFFERINGS[k]?.short || k), impact: O.impactLines(p) })) })),
      offerings: OFFERINGS,
    };
  });
  def('addPartner', 'user', (input, ctx) => O.addPartner(ctx, input));
  def('updatePartnership', 'user', ({ id, ...patch }, ctx) => O.updatePartnership(ctx, id, patch));
  def('recordSurvey', 'user', ({ id, ...s }, ctx) => O.recordSurvey(ctx, id, s));
  def('generateImpactSummary', 'user', ({ id }, ctx) => O.generateImpactSummary(ctx, id));
  def('updateTargeting', 'admin', ({ targeting }, ctx) => {
    store.setSettings({ targeting: { ...store.settings().targeting, ...targeting } });
    audit(store, { actor: ctx.actor, action: 'settings.targeting' });
    return store.settings().targeting;
  });

  // -------------------------------------------------------------------------
  // Social

  def('socialWeek', 'user', () => {
    const key = S.planningMonth();
    const plan = S.monthPlan(store, key);
    const now = Date.now();
    const next7 = store.all('posts', (p) => ['drafted', 'scheduled', 'published', 'failed'].includes(p.status) && new Date(p.scheduled_at).getTime() >= now - 3600000 && new Date(p.scheduled_at).getTime() <= now + 7 * DAY_MS)
      .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)).map((p) => postCard(p));
    const waiting = needsYou('social').map((a) => ({ a, p: store.get('posts', a.item_id) })).filter((x) => x.p);
    const flagged = waiting.filter((x) => x.a.blocking).map(({ a, p }) => ({
      approval: a, post: postCard(p),
      flags: store.all('review_results', (r) => r.item_id === p.id && r.result === 'flag' && r.blocking).map((r) => ({ label: r.label, suggestion: r.suggestion, check: r.check })),
    }));
    return {
      key, label: monthLabel(key), month: monthLabel(key).split(' ')[0],
      stats: { scheduled: plan.scheduled, total: plan.total, filled: plan.filled, weeks: S.weeksOnPlan(store), unused: S.unusedMedia(store).length, needsOk: waiting.length },
      next7, flagged, clean: waiting.filter((x) => !x.a.blocking).length,
      open: plan.open.map((s) => ({ date: s.date, key: s.key })), lowPillar: S.lowPillar(store), lastRun: lastRun('social'),
    };
  });

  function postCard(p) {
    const media = p.media_id ? store.get('media_assets', p.media_id) : null;
    const a = approvalFor(store, 'post', p.id);
    return { ...p, media, approval_state: a?.state, blocking: a?.blocking || 0 };
  }

  def('library', 'user', ({ filter = 'all' }) => {
    const rows = store.all('media_assets', (m) => !m.excluded || filter === 'excluded').map((m) => {
      const uses = S.mediaUsage(store, m.id).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
      return { ...m, uses: uses.map((u) => ({ id: u.id, when: u.scheduled_at, status: u.status })), needsConsent: (m.people_in_frame !== false) && !m.consent_confirmed };
    });
    const f = {
      all: () => true, unused: (m) => !m.uses.length, photos: (m) => m.kind === 'photo', videos: (m) => m.kind === 'video',
      scheduled: (m) => m.uses.length > 0, consent: (m) => m.needsConsent, excluded: (m) => m.excluded,
    }[filter] || (() => true);
    return { media: rows.filter(f).sort((a, b) => b.created_at.localeCompare(a.created_at)), total: rows.length, open: S.monthPlan(store, S.planningMonth()).open.length, key: S.planningMonth() };
  });

  // Prompt library: saved ideas to pair with a photo or video. Starter prompts are added once.
  const STARTER_PROMPTS = [
    ['Educate', 'What naloxone is', 'Explain what naloxone is and that anyone can carry it.'],
    ['Educate', 'Louisiana law', 'Share that Louisiana has no age limit on carrying naloxone.'],
    ['Equip', 'Find free naloxone', 'Show where to pick up free naloxone nearby and how to get it.'],
    ['Equip', 'Host a training', 'Invite a school, church or group to host a Hope Responder training.'],
    ['Respond', 'Call 911 first', 'Remind people to call 911 first, every time.'],
    ['Respond', 'Rescue breathing', 'Walk through rescue breathing or the recovery position in plain steps.'],
    ['Empower', 'Thank a partner', 'Thank a library, school or business partner by name for making access possible.'],
    ['Empower', 'Youth voices', 'Share a short quote from a young person about why this matters.'],
    ['Lead', 'Responder Corps', 'Spotlight the Hope Responder Corps and what students do.'],
    ['Lead', 'Upcoming event', 'Announce an upcoming training or build day. Add the date and place before approving.'],
  ];
  def('prompts', 'user', () => {
    if (!store.meta().prompts_seeded) {
      for (const [pillar, label, text] of STARTER_PROMPTS) store.insert('prompts', { label, text, pillar, starter: true });
      store.setMeta({ prompts_seeded: true });
    }
    return { prompts: store.all('prompts').sort((a, b) => PILLARS.indexOf(a.pillar) - PILLARS.indexOf(b.pillar) || a.created_at.localeCompare(b.created_at)) };
  });
  def('savePrompt', 'user', ({ id, label, text, pillar }, ctx) => {
    label = String(label || '').trim(); text = String(text || '').trim();
    if (!label || !text) throw Object.assign(new Error('Give the prompt a name and some text.'), { status: 400 });
    if (!PILLARS.includes(pillar)) pillar = 'Educate';
    const after = id ? store.update('prompts', id, { label, text, pillar }) : store.insert('prompts', { label, text, pillar });
    audit(store, { actor: ctx.actor, action: id ? 'prompt.update' : 'prompt.add', item_type: 'prompt', item_id: after.id, note: label });
    return after;
  });
  def('deletePrompt', 'user', ({ id }, ctx) => {
    const p = store.get('prompts', id);
    if (!p) return null;
    store.remove('prompts', id);
    audit(store, { actor: ctx.actor, action: 'prompt.delete', item_type: 'prompt', item_id: id, note: p.label });
    return { ok: true };
  });
  // Pair a prompt with a photo or video. The draft lands in the next open slot and still needs a person's OK.
  def('draftFromPrompt', 'user', async ({ media_id, prompt_id }, ctx) => {
    const media = store.get('media_assets', media_id);
    const prompt = store.get('prompts', prompt_id);
    if (!media || !prompt) throw Object.assign(new Error('Pick a photo or video and a prompt.'), { status: 400 });
    const key = S.planningMonth();
    let slot = null;
    for (const k of [key, addMonths(key, 1), addMonths(key, 2)]) {
      slot = S.monthPlan(store, k).open[0];
      if (slot) break;
    }
    if (!slot) throw Object.assign(new Error('No open slots in the next three months. Change the posting plan in Settings.'), { status: 409 });
    const r = await withRun(ctx, 'social', 'prompt', (rc) => S.createPost(rc, media, slot.date, { topic: prompt.text }).then((post) => ({ summary: `Drafted "${post.title}" from the prompt "${prompt.label}"`, post })));
    return { id: r.result.post.id };
  });
  def('uploadMedia', 'user', async (input, ctx) => (await withRun(ctx, 'social', 'upload', (r) => S.ingestMedia(r, input).then((m) => ({ summary: `Tagged ${m.label}`, m })))).result.m);
  def('updateMedia', 'user', async ({ id, ...patch }, ctx) => {
    const before = store.get('media_assets', id);
    const allowed = {};
    for (const k of ['pillar', 'label', 'subject', 'excluded', 'people_in_frame']) if (k in patch) allowed[k] = patch[k];
    const after = store.update('media_assets', id, allowed);
    audit(store, { actor: ctx.actor, action: 'media.update', item_type: 'media', item_id: id, before, after });
    for (const p of store.all('posts', (x) => x.media_id === id && ['drafted', 'scheduled'].includes(x.status))) await S.reviewPost(ctx, p.id);
    return after;
  });
  def('confirmConsent', 'approver', ({ id, mode, release_location }, ctx) => S.confirmConsent(ctx, id, { mode, release_location }));
  def('excludeMedia', 'user', ({ id }, ctx) => {
    const after = store.update('media_assets', id, { excluded: true });
    audit(store, { actor: ctx.actor, action: 'media.exclude', item_type: 'media', item_id: id });
    return after;
  });
  def('autofill', 'user', async ({ key, only }, ctx) => {
    const r = await withRun(ctx, 'social', 'autofill', (rc) => S.autofill(rc, key || S.planningMonth(), { only }).then((x) => ({ summary: `Filled ${x.created.length} slots; ${x.open.length} still open`, x })));
    return { created: r.result.x.created.length, open: r.result.x.open.length };
  });

  def('post', 'user', ({ id }) => {
    const p = store.get('posts', id) || needsYou('social').map((a) => store.get('posts', a.item_id)).find(Boolean) || store.all('posts')[0];
    if (!p) return null;
    return {
      post: postCard(p), results: resultsFor(store, 'post', p.id), approval: approvalFor(store, 'post', p.id),
      citations: (p.citations || []).map((c) => ({ ...c, label: citationLabel(c) })),
      alternatives: S.pickMedia(store, { pillar: p.pillar, iso: p.scheduled_at, exclude: new Set([p.media_id]), ignorePostId: p.id, avoidPeople: true }) ? true : false,
    };
  });
  def('updatePost', 'user', ({ id, ...patch }, ctx) => S.updatePost(ctx, id, patch));
  def('rewriteCaption', 'user', async ({ id }, ctx) => (await withRun(ctx, 'social', 'rewrite', (r) => S.rewriteCaption(r, id).then(() => 'Rewrote caption'))).run);
  def('swapMedia', 'user', ({ id, mediaId }, ctx) => S.swapMedia(ctx, id, { mediaId }));
  def('approvePost', 'approver', ({ id }, ctx) => S.approvePost(ctx, id));
  def('approveCleanPosts', 'approver', ({ key }, ctx) => ({ approved: S.approveCleanPosts(ctx, { key }) }));
  def('publishNow', 'approver', async (_, ctx) => ({ published: await S.publishQueue(ctx) }));

  def('calendar', 'user', ({ key }) => {
    const k = key || S.planningMonth();
    const plan = S.monthPlan(store, k);
    return {
      key: k, label: monthLabel(k), prev: addMonths(k, -1), next: addMonths(k, 1),
      slots: plan.slots.map((s) => ({ ...s, posts: s.posts.map((p) => postCard(p)) })), offPlan: plan.offPlan.map(postCard),
      filled: plan.filled, total: plan.total, open: plan.open.length, pillars: PILLARS,
    };
  });
  def('copyMonthPreview', 'user', (opts, ctx) => S.copyMonthPlan(ctx, opts));
  def('copyMonth', 'user', async (opts, ctx) => (await withRun(ctx, 'social', 'copy_month', (r) => S.copyMonth(r, opts).then((x) => ({ summary: `Copied ${x.created} posts`, x })))).result.x);

  // -------------------------------------------------------------------------
  // Activity and settings

  def('activity', 'user', ({ type = 'all', limit = 150 }) => {
    const audits = store.all('audit_log', (a) => type === 'all' || (a.action || '').startsWith(type)).sort((a, b) => b.created_at.localeCompare(a.created_at));
    return {
      runs: store.all('runs').sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, 30),
      audit: audits.slice(0, limit), total: audits.length,
      alerts: store.all('alerts', (a) => !a.resolved).sort((a, b) => b.created_at.localeCompare(a.created_at)),
      spend: store.all('runs', (r) => monthOfISO(r.started_at) === currentMonthKey()).reduce((s, r) => s + (r.cost_usd || 0), 0),
    };
  });
  def('auditCsv', 'user', () => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = store.all('audit_log').sort((a, b) => a.created_at.localeCompare(b.created_at));
    return ['time,actor,action,item_type,item_id,note', ...rows.map((r) => [r.created_at, r.actor, r.action, r.item_type, r.item_id, r.note].map(esc).join(','))].join('\n');
  });
  def('resolveAlert', 'user', ({ id }, ctx) => {
    const after = store.update('alerts', id, { resolved: true, resolved_by: ctx.actor?.name });
    audit(store, { actor: ctx.actor, action: 'alert.resolved', item_type: 'alert', item_id: id });
    return after;
  });

  def('settings', 'user', () => ({
    settings: store.settings(), integrations: integrationStatus(), mode: integrations.mode,
    users: store.all('users').map(publicUser), samples: !!store.meta().samples, suppressions: store.all('suppressions'),
  }));
  def('updateSettings', 'admin', async ({ patch }, ctx) => {
    const allowed = ['mailing_address', 'sender', 'approval_policy', 'run_budget_usd', 'slot_plan', 'banned_terms', 'targeting', 'grant_rules', 'org_profile'];
    const clean = {};
    for (const k of allowed) if (k in patch) clean[k] = patch[k];
    if ('run_budget_usd' in clean) clean.run_budget_usd = Math.max(0.1, +clean.run_budget_usd || 3);
    const before = { ...store.settings() };
    store.setSettings(clean);
    audit(store, { actor: ctx.actor, action: 'settings.update', before: pickKeys(before, Object.keys(clean)), after: clean });
    // A new mailing address changes every unsent email's footer check.
    if ('mailing_address' in clean) {
      const { withFooter } = await import('./reviewer.js');
      for (const m of store.all('messages', (x) => x.kind === 'email' && !['sent', 'cancelled', 'suppressed'].includes(x.status))) {
        store.update('messages', m.id, { body: withFooter(m.body, store.settings()) });
        await O.reviewMessage(ctx, m.id);
      }
    }
    return store.settings();
  });
  def('clearSamples', 'admin', (_, ctx) => {
    clearSamples(store);
    audit(store, { actor: ctx.actor, action: 'settings.clear_samples' });
    return true;
  });
  def('resetDemo', 'user', async () => {
    if (integrations.mode !== 'demo') throw Object.assign(new Error('Reset is only available in the demo.'), { status: 403 });
    store.reset();
    await seedAll(store, integrations);
    return true;
  });
  def('exportData', 'admin', () => {
    const data = JSON.parse(JSON.stringify(store.raw));
    for (const u of data.tables.users) delete u.password_hash;
    return data;
  });

  def('importData', 'admin', ({ data }, ctx) => {
    if (!data || typeof data !== 'object' || !data.tables) {
      throw Object.assign(new Error('Invalid backup file format. Expected JSON with tables.'), { status: 400 });
    }
    // Retain existing user passwords if missing in import
    const existingUsers = store.all('users');
    for (const u of data.tables.users || []) {
      const ex = existingUsers.find((x) => x.id === u.id || x.username === u.username);
      if (ex && !u.password_hash) u.password_hash = ex.password_hash;
    }
    store.raw.tables = data.tables;
    if (data.meta) store.raw.meta = data.meta;
    store.flush();
    audit(store, { actor: ctx.actor, action: 'data.import', note: 'Restored backup data' });
    return true;
  });

  // Global search across all entities (Grants, Prospects, Partners, Posts, Knowledge, Facts)
  def('searchAll', 'user', ({ query = '' }) => {
    const q = String(query).trim().toLowerCase();
    if (!q) return { query: '', total: 0, results: [] };
    const results = [];

    // Grants
    for (const g of store.all('grants')) {
      const text = `${g.title} ${g.funder} ${g.description} ${g.program} ${g.rfp_text}`.toLowerCase();
      if (text.includes(q)) {
        results.push({
          type: 'grant',
          id: g.id,
          title: g.title,
          sub: `${g.funder} · ${g.amount_max ? `$${g.amount_max.toLocaleString()}` : 'Grant'}`,
          route: 'g-scout',
          score: text.startsWith(q) ? 10 : text.includes(` ${q}`) ? 6 : 3,
        });
      }
    }

    // Grant Drafts
    for (const d of store.all('grant_drafts')) {
      const g = store.get('grants', d.grant_id);
      const ans = store.all('draft_answers', (a) => a.draft_id === d.id).map((a) => a.text).join(' ').toLowerCase();
      if (ans.includes(q) || (g && g.title.toLowerCase().includes(q))) {
        results.push({
          type: 'grant_draft',
          id: d.id,
          title: `Proposal Draft: ${g?.title || 'Grant'}`,
          sub: `${g?.funder || ''} · $${(d.request_amount || 0).toLocaleString()} request`,
          route: 'g-writer',
          score: 5,
        });
      }
    }

    // Contacts & CRM
    for (const c of store.all('contacts')) {
      const ctext = `${c.name} ${c.title} ${c.position} ${c.email} ${c.phone} ${c.company} ${c.notes}`.toLowerCase();
      if (ctext.includes(q)) {
        results.push({
          type: 'contact',
          id: c.id,
          title: c.name || 'Contact',
          sub: `${c.position || c.title || 'Staff'} · ${c.company || 'Partner'} ${c.email ? `· ${c.email}` : ''}`,
          route: 'o-contacts',
          score: (c.name || '').toLowerCase().includes(q) ? 10 : 6,
        });
      }
    }

    // Prospects
    for (const p of store.all('prospects')) {
      const contacts = store.all('contacts', (c) => c.prospect_id === p.id);
      const ctext = contacts.map((c) => `${c.name} ${c.title} ${c.email}`).join(' ');
      const ptext = `${p.name} ${p.town} ${p.parish} ${p.segment} ${p.reason} ${ctext}`.toLowerCase();
      if (ptext.includes(q)) {
        results.push({
          type: 'prospect',
          id: p.id,
          title: p.name,
          sub: `${p.segment} · ${p.town || p.parish || 'LA'} ${contacts[0] ? `· ${contacts[0].name}` : ''}`,
          route: 'o-scout',
          score: p.name.toLowerCase().includes(q) ? 9 : 4,
        });
      }
    }

    // Social Posts
    for (const p of store.all('posts')) {
      const text = `${p.title} ${p.caption_ig} ${p.caption_fb} ${p.pillar}`.toLowerCase();
      if (text.includes(q)) {
        results.push({
          type: 'post',
          id: p.id,
          title: p.title,
          sub: `${p.pillar} · ${p.scheduled_at ? p.scheduled_at.slice(0, 10) : 'Post'} · ${p.status}`,
          route: 's-composer',
          score: p.title.toLowerCase().includes(q) ? 8 : 3,
        });
      }
    }

    // Facts
    for (const f of store.all('facts')) {
      const text = `${f.label} ${f.value} ${f.statement}`.toLowerCase();
      if (text.includes(q)) {
        results.push({
          type: 'fact',
          id: f.id,
          title: `Fact: ${f.label}`,
          sub: `"${f.value}" — ${f.statement}`,
          route: 'g-kb',
          score: 7,
        });
      }
    }

    // Knowledge base documents
    for (const doc of store.all('documents')) {
      const text = `${doc.title} ${doc.group}`.toLowerCase();
      if (text.includes(q)) {
        results.push({
          type: 'document',
          id: doc.id,
          title: `Document: ${doc.title}`,
          sub: `${doc.collection} · ${doc.group} · ${doc.chunk_count || 0} chunks`,
          route: doc.collection === 'grants' ? 'g-kb' : 'o-kb',
          score: 6,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return { query: q, total: results.length, results: results.slice(0, 20) };
  });

  // Test LLM connection
  def('testLlm', 'user', async () => {
    if (llm?.test) return llm.test();
    return { ok: !!llm?.available, provider: llm?.provider || (llm?.available ? 'custom' : 'offline'), reason: llm?.reason || (llm?.available ? 'Available' : 'Offline') };
  });

  // Formatted proposal export in Markdown, text, and printable HTML
  def('exportProposal', 'user', ({ draftId, format = 'markdown' }) => {
    const draft = store.get('grant_drafts', draftId);
    if (!draft) throw Object.assign(new Error('Draft not found'), { status: 404 });
    const grant = store.get('grants', draft.grant_id);
    const answers = store.all('draft_answers', (a) => a.draft_id === draft.id).sort((a, b) => a.order - b.order);

    if (format === 'markdown') {
      let md = `# Grant Proposal: ${grant.title}\n\n`;
      md += `**Funder:** ${grant.funder}\n`;
      md += `**Request Amount:** $${(draft.request_amount || 0).toLocaleString()}\n`;
      md += `**Deadline:** ${grant.deadline || 'N/A'}\n\n`;
      md += `---\n\n`;
      for (const a of answers) {
        md += `## ${a.order}. ${a.question}\n\n`;
        md += `*Prompt:* ${a.prompt}\n\n`;
        md += `${a.text}\n\n`;
        md += `*Character count:* ${a.text.length} / ${a.limit_chars}\n\n`;
      }
      if (draft.attachments?.length) {
        md += `## Attachments Checklist\n\n`;
        for (const att of draft.attachments) {
          md += `- [${att.done ? 'x' : ' '}] ${att.name}\n`;
        }
      }
      return { title: grant.title, filename: `${grant.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-proposal.md`, content: md, mime: 'text/markdown' };
    }

    if (format === 'text') {
      let txt = `GRANT PROPOSAL: ${grant.title.toUpperCase()}\n`;
      txt += `Funder: ${grant.funder}\n`;
      txt += `Request Amount: $${(draft.request_amount || 0).toLocaleString()}\n`;
      txt += `Deadline: ${grant.deadline || 'N/A'}\n`;
      txt += `============================================================\n\n`;
      for (const a of answers) {
        txt += `[QUESTION ${a.order}] ${a.question}\n`;
        txt += `(${a.text.length} of ${a.limit_chars} characters)\n\n`;
        txt += `${a.text}\n\n`;
        txt += `------------------------------------------------------------\n\n`;
      }
      return { title: grant.title, filename: `${grant.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-proposal.txt`, content: txt, mime: 'text/plain' };
    }

    return { title: grant.title, content: answers.map((a) => `${a.order}. ${a.question}\n\n${a.text}`).join('\n\n') };
  });

  // Bulk CSV Import for prospects
  def('importProspectsCsv', 'user', async ({ text }, ctx) => {
    if (!text || !text.trim()) throw Object.assign(new Error('CSV content is empty.'), { status: 400 });
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) throw Object.assign(new Error('CSV must have a header row and at least one data row.'), { status: 400 });

    const parseCsvLine = (line) => {
      const result = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') inQuotes = !inQuotes;
        else if (char === ',' && !inQuotes) {
          result.push(current.trim().replace(/^["']|["']$/g, ''));
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim().replace(/^["']|["']$/g, ''));
      return result;
    };

    const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
    const nameIdx = header.findIndex((h) => h.includes('name') || h.includes('organization') || h.includes('prospect'));
    const segIdx = header.findIndex((h) => h.includes('segment') || h.includes('type') || h.includes('category'));
    const townIdx = header.findIndex((h) => h.includes('town') || h.includes('city') || h.includes('location') || h.includes('parish'));
    const contactIdx = header.findIndex((h) => h.includes('contact') || h.includes('staff') || h.includes('person'));
    const emailIdx = header.findIndex((h) => h.includes('email') || h.includes('mail'));

    if (nameIdx === -1) throw Object.assign(new Error('Could not find organization name column in CSV header.'), { status: 400 });

    let added = 0;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const clean = parseCsvLine(line);
      const name = clean[nameIdx];
      if (!name) continue;

      let seg = segIdx >= 0 ? clean[segIdx]?.toLowerCase() : 'school';
      if (/faith|church|youth group/i.test(seg)) seg = 'faith';
      else if (/lib|library/i.test(seg)) seg = 'library';
      else if (/agency|gov|health/i.test(seg)) seg = 'agency';
      else if (/biz|business|company/i.test(seg)) seg = 'business';
      else seg = 'school';

      const town = townIdx >= 0 ? clean[townIdx] : 'Capital Region';
      const cname = contactIdx >= 0 ? clean[contactIdx] : '';
      const email = emailIdx >= 0 ? clean[emailIdx] : '';

      try {
        const p = await O.addProspect(ctx, {
          name,
          segment: seg,
          town,
          source: 'csv_import',
          contact: email ? { name: cname, email, verified: false } : null,
        });
        if (p.created) added++;
      } catch { /* skip duplicates */ }
    }
    return { added, total_rows: lines.length - 1 };
  });

  // Social content ideas generator for the 5 pillars
  def('getSocialIdeas', 'user', ({ pillar = 'Educate' }) => {
    const ideas = {
      Educate: [
        { title: 'Recognizing Signs of Overdose', prompt: '3 signs of an opioid emergency: unresponsiveness, slow/stopped breathing, blue or gray lips/fingertips.' },
        { title: 'Naloxone Myth vs Fact', prompt: 'Fact: Naloxone only reverses opioid overdoses and cannot harm someone who has not taken opioids.' },
        { title: 'Louisiana Act 378 Explained', prompt: 'How Louisiana Act 378 protects and empowers schools and communities to carry and administer naloxone.' },
      ],
      Equip: [
        { title: 'Free Naloxone Access Stand Spotlight', prompt: 'Highlighting one of our 5 public library access points and how anyone can pick up a free kit.' },
        { title: 'What is in a Hope Kit?', prompt: 'Breaking down the lifesaving contents of a standard Hope Kit: naloxone doses, breathing barrier, step-by-step card.' },
        { title: 'How to Administer Nasal Naloxone', prompt: 'Quick visual guide: Peel, place, push. Call 911 immediately.' },
      ],
      Empower: [
        { title: 'Youth Champions in Action', prompt: 'Spotlight on youth leaders learning emergency response and leading stigma-free conversations.' },
        { title: 'Volunteer / Partner Spotlight', prompt: 'Celebrating local educators and youth ministers standing for harm reduction.' },
        { title: 'Stigma-Free Community Voice', prompt: 'Why compassionate language saves lives: people first, empathy always.' },
      ],
      Respond: [
        { title: 'First 60 Seconds: Calling 911 First', prompt: 'In any suspected overdose, calling 911 is always the critical first step before administering aid.' },
        { title: 'Good Samaritan Protections', prompt: 'You are legally protected when calling for emergency help during an overdose in Louisiana.' },
        { title: 'Recovery & Aftercare Resources', prompt: 'Providing immediate connection to 988 Suicide & Crisis Lifeline and local support.' },
      ],
      Lead: [
        { title: '2026–27 Hope Responder Pilot Milestone', prompt: 'Sharing regional progress: over 40 doses placed in week one and growing community reach.' },
        { title: 'Partner Guide: Becoming a Hope Safe Space', prompt: 'How local businesses and faith spaces can receive a free naloxone stand and window decal.' },
        { title: 'Board & Community Vision Message', prompt: 'Leadership reflection: No stigma. No barriers. Just hope.' },
      ],
    };
    return { pillar, ideas: ideas[pillar] || ideas.Educate };
  });

  // -------------------------------------------------------------------------

  async function call(name, params, actor) {
    const m = M[name];
    if (!m) throw Object.assign(new Error(`Unknown action ${name}`), { status: 404 });
    if (userRank(actor) < ROLE_RANK[m.role]) {
      throw Object.assign(new Error(m.role === 'admin' ? 'Only Leila (admin) can change this.' : m.role === 'approver' ? 'Only an approver can do this.' : 'Sign in first.'), { status: actor ? 403 : 401 });
    }
    return m.fn(params || {}, ctxFor(actor));
  }

  return { call, jobs, methods: M, store, alert: (a) => raiseAlert(store, a), logRun };
}

export function publicUser(u) {
  if (!u || typeof u !== 'object') return null;
  return { id: u.id, username: u.username, name: u.name, role: u.role, email: u.email, has_password: !!u.password_hash };
}

function pickKeys(o, keys) {
  const out = {};
  for (const k of keys) out[k] = o[k];
  return out;
}

export { money };

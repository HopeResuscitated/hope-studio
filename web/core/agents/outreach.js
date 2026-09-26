// Outreach Studio · Partnerships Coordinator
// Find prospects → match offerings → draft a 3-step sequence → Reviewer →
// (human approval) → Gmail send → replies move cards on the 5-step board.

import { audit } from '../audit.js';
import { SEGMENT_OFFERINGS, OFFERINGS, DELIVERY_CHECKLIST } from '../schema.js';
import { normalizeName, isEmail, DAY_MS } from '../util.js';
import { draftSequence, contactRole } from '../writer.js';
import { reviewMessageHard, judgeWithClaude, COMMITMENT_RUBRIC, insertBeforeAsk, footerText } from '../reviewer.js';
import { openApproval, afterReview, approvalFor, assertApproved, markExecuted, transition } from '../approvals.js';
import { logRun } from '../runs.js';
import { factValue } from '../kb.js';
import { saveResults, sourcePack, WRITER_RULES } from './common.js';

// Towns in the service area and their parishes.
export const TOWN_PARISH = {
  'st. francisville': 'West Feliciana', 'st francisville': 'West Feliciana', 'west feliciana': 'West Feliciana',
  zachary: 'East Baton Rouge', 'north baton rouge': 'East Baton Rouge', 'baton rouge': 'East Baton Rouge', baker: 'East Baton Rouge', 'central': 'East Baton Rouge',
  'port allen': 'West Baton Rouge', brusly: 'West Baton Rouge', addis: 'West Baton Rouge',
};

export function parishFor(address = '') {
  const a = address.toLowerCase();
  for (const [town, parish] of Object.entries(TOWN_PARISH)) if (a.includes(town)) return parish;
  return null;
}

export function townFor(address = '') {
  const a = address.toLowerCase();
  for (const town of Object.keys(TOWN_PARISH)) if (a.includes(town)) return town.replace(/\b\w/g, (c) => c.toUpperCase());
  return null;
}

// ---------------------------------------------------------------------------
// Match offerings

const REASONS = {
  school: 'Under Act 378 the school must have a naloxone policy. A strong candidate for an assembly and a founding Corps chapter.',
  faith: 'Runs youth programming in the service area and could host a Purpose Project build day.',
  youth: 'Works with young people every week; a group training fits the schedule they already have.',
  library: 'Libraries already host our access points; a Community Partner upgrade adds trainings and events.',
  agency: 'Serves families in the Capital Region; staff orientation and a naloxone box make the team ready for an emergency.',
  business: 'A public-facing spot where a Hope Safe Space box and decal make staff ready for an emergency.',
};

export async function matchOfferings(ctx, prospect) {
  const base = SEGMENT_OFFERINGS[prospect.segment] || ['group_training'];
  let offerings = base.slice(0, prospect.segment === 'school' ? 3 : 2);
  let reason = prospect.reason || REASONS[prospect.segment] || '';
  if (ctx.llm?.available && prospect.scout_note) {
    try {
      const out = await ctx.llm.json({
        purpose: 'tag',
        run: ctx.run,
        system: 'You match prospective partners to Hope Resuscitated offerings from the Partner Guide. Choose 1–3 offering keys that fit and write one sentence explaining why, starting with a fact from the scout note. Never suggest contacting students.',
        prompt: `Offerings:\n${Object.entries(OFFERINGS).map(([k, o]) => `${k}: ${o.label} — ${o.detail}`).join('\n')}\n\nProspect: ${prospect.name} (${prospect.segment}, ${prospect.parish || 'parish unknown'})\nScout note: ${prospect.scout_note}`,
        schema: {
          type: 'object',
          properties: { offerings: { type: 'array', items: { type: 'string', enum: Object.keys(OFFERINGS) } }, reason: { type: 'string' } },
          required: ['offerings', 'reason'],
          additionalProperties: false,
        },
      });
      if (out.offerings.length) offerings = out.offerings.slice(0, 3);
      reason = out.reason;
    } catch (err) {
      if (err.name === 'BudgetExceeded') throw err;
      logRun(ctx, `Offering match fell back to rules: ${err.message}`);
    }
  }
  return { offerings, reason };
}

export function contactFor(store, prospectId) {
  const list = store.all('contacts', (c) => c.prospect_id === prospectId);
  return list.find((c) => c.primary) || list[0] || null;
}

function fitFor(store, prospectId) {
  const c = contactFor(store, prospectId);
  return c && isEmail(c.email) && c.verified ? 'strong' : 'verify';
}

// ---------------------------------------------------------------------------
// Find

export function isDuplicate(store, name, parish) {
  const n = normalizeName(name);
  return store.find('prospects', (p) => normalizeName(p.name) === n && (!parish || !p.parish || p.parish === parish))
    || store.find('partnerships', (p) => normalizeName(p.name) === n);
}

export async function addProspect(ctx, input) {
  const { store } = ctx;
  const parish = input.parish || parishFor(input.address || '') || null;
  if (isDuplicate(store, input.name, parish)) return { prospect: isDuplicate(store, input.name, parish), created: false };
  const domain = input.website ? String(input.website).replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '') : null;
  if (domain && store.find('suppressions', (s) => s.domain && s.domain.toLowerCase() === domain.toLowerCase())) {
    logRun(ctx, `Skipped ${input.name}: ${domain} is on the opt-out list.`);
    return { prospect: null, created: false, suppressed: true };
  }
  const draft = { ...input, parish };
  const { offerings, reason } = input.offerings?.length ? { offerings: input.offerings, reason: input.reason } : await matchOfferings(ctx, draft);
  const prospect = store.insert('prospects', {
    name: input.name, segment: input.segment, parish, town: input.town || townFor(input.address || ''), address: input.address || '',
    website: input.website || null, source_url: input.source_url || input.website || null, source: input.source || 'manual',
    scout_note: input.scout_note || '', reason, offerings, fit: 'verify', status: 'new', run_id: ctx.run?.id || null, sample: !!input.sample,
  });
  if (input.contact) addContact(ctx, prospect.id, input.contact);
  store.update('prospects', prospect.id, { fit: fitFor(store, prospect.id) });
  audit(store, { actor: ctx.actor, action: 'prospect.found', item_type: 'prospect', item_id: prospect.id, after: prospect, run_id: ctx.run?.id });
  return { prospect: store.get('prospects', prospect.id), created: true };
}

export function addContact(ctx, prospectId, c) {
  const { store } = ctx;
  if (/\bstudents?\b|\bpupils?\b/i.test(`${c.title || ''} ${c.name || ''}`) || /student/i.test(c.email || '')) {
    throw Object.assign(new Error('Outreach never stores or contacts students. Add a staff contact instead.'), { status: 400 });
  }
  if (c.email && !isEmail(c.email)) throw Object.assign(new Error(`"${c.email}" is not a valid email address.`), { status: 400 });
  const existing = store.all('contacts', (x) => x.prospect_id === prospectId);
  const row = store.insert('contacts', {
    prospect_id: prospectId, name: c.name || '', title: c.title || '', email: (c.email || '').trim(),
    source_url: c.source_url || null, verified: !!c.verified, primary: existing.length === 0,
  });
  store.update('prospects', prospectId, { fit: fitFor(store, prospectId) });
  audit(store, { actor: ctx.actor, action: 'contact.add', item_type: 'contact', item_id: row.id, after: row });
  return row;
}

export async function updateContact(ctx, contactId, patch) {
  const { store } = ctx;
  const before = store.get('contacts', contactId);
  if (patch.email && !isEmail(patch.email)) throw Object.assign(new Error(`"${patch.email}" is not a valid email address.`), { status: 400 });
  if (/\bstudents?\b/i.test(patch.title || '') || /student/i.test(patch.email || '')) throw Object.assign(new Error('Outreach never contacts students.'), { status: 400 });
  const after = store.update('contacts', contactId, patch);
  store.update('prospects', before.prospect_id, { fit: fitFor(store, before.prospect_id) });
  audit(store, { actor: ctx.actor, action: 'contact.update', item_type: 'contact', item_id: contactId, before, after });
  for (const m of store.all('messages', (x) => x.prospect_id === before.prospect_id && x.kind === 'email' && !['sent', 'cancelled', 'suppressed'].includes(x.status))) {
    store.update('messages', m.id, { to: after.email });
    await reviewMessage(ctx, m.id);
  }
  return after;
}

const SEGMENT_QUERIES = [
  ['school', 'high school'], ['school', 'middle school'], ['faith', 'church youth ministry'],
  ['library', 'public library'], ['business', 'coffee shop'],
];

export async function scoutProspects(ctx) {
  const { store, integrations } = ctx;
  const places = integrations.places;
  const towns = store.settings().targeting?.towns || ['Zachary', 'Port Allen', 'Brusly', 'St. Francisville', 'Baton Rouge'];
  let found = 0;
  let created = 0;
  if (!places?.available) {
    logRun(ctx, 'Prospect sources are not connected; add prospects by hand or connect Google Places.');
    return { found, created };
  }
  for (const [segment, q] of SEGMENT_QUERIES) {
    for (const town of towns) {
      try {
        const results = await places.search(`${q} in ${town}, Louisiana`);
        for (const r of results) {
          found++;
          if (!parishFor(r.address) && !r.sample) continue; // outside the Capital Region
          const out = await addProspect(ctx, { ...r, segment, source: places.name || 'google_places', scout_note: r.note || `${r.types?.slice(0, 3).join(', ') || q} in ${town}` });
          if (out.created) created++;
        }
      } catch (err) {
        if (err.name === 'BudgetExceeded') throw err;
        logRun(ctx, `Places "${q} in ${town}" failed: ${err.message}`);
      }
    }
  }
  return { found, created };
}

// ---------------------------------------------------------------------------
// Draft

async function personalize(ctx, prospect, contact, steps) {
  const { store, llm } = ctx;
  if (!llm?.available) return steps;
  try {
    const pack = sourcePack(store, `${prospect.segment} ${(prospect.offerings || []).map((k) => OFFERINGS[k]?.label).join(' ')}`, { collection: 'outreach', k: 6 });
    const out = await llm.json({
      purpose: 'draft',
      run: ctx.run,
      system: `You are the Partnerships Coordinator for Hope Resuscitated. Personalize the intro email and the day-7 follow-up for this prospect using the scout note. Keep the structure, one clear ask per email, and under 180 words each. Do not include a footer; it is added for you.\n${WRITER_RULES}`,
      prompt: `Prospect: ${prospect.name} (${prospect.segment}, ${prospect.parish || ''})\nContact: ${contact?.name || '[name]'}, ${contact?.title || contactRole(prospect, contact)}\nScout note: ${prospect.scout_note}\nOfferings: ${(prospect.offerings || []).map((k) => OFFERINGS[k]?.label).join(', ')}\n\nTemplate intro:\nSubject: ${steps[0].subject}\n${steps[0].body.split('\n--\n')[0]}\n\nTemplate follow-up:\n${steps[1].body.split('\n--\n')[0]}\n\nSources:\n${pack.render()}`,
      schema: {
        type: 'object',
        properties: { subject: { type: 'string' }, intro: { type: 'string' }, followup: { type: 'string' }, source_ids: { type: 'array', items: { type: 'string' } } },
        required: ['subject', 'intro', 'followup', 'source_ids'],
        additionalProperties: false,
      },
    });
    const footer = footerText(store.settings());
    const citations = [...steps[0].citations, ...pack.toCitations(out.source_ids)];
    return [
      { ...steps[0], subject: out.subject, body: `${out.intro.trim()}\n\n${footer}`, citations },
      { ...steps[1], subject: `Re: ${out.subject}`, body: `${out.followup.trim()}\n\n${footer}`, citations },
      steps[2],
    ];
  } catch (err) {
    if (err.name === 'BudgetExceeded') throw err;
    logRun(ctx, `Personalization fell back to the template: ${err.message}`);
    return steps;
  }
}

export async function draftOutreach(ctx, prospectId) {
  const { store } = ctx;
  const prospect = store.get('prospects', prospectId);
  if (!prospect) throw new Error('Prospect not found');
  const existing = store.find('messages', (m) => m.prospect_id === prospectId && m.sequence_step === 1 && !['cancelled', 'suppressed'].includes(m.status));
  if (existing) return existing;
  const contact = contactFor(store, prospectId);
  let { steps } = draftSequence(store, prospect, contact, store.settings());
  steps = await personalize(ctx, prospect, contact, steps);
  let first = null;
  for (const s of steps) {
    const status = s.sequence_step === 1 ? 'drafted' : s.sequence_step === 2 ? 'queued' : 'locked';
    const m = store.insert('messages', {
      prospect_id: prospectId, contact_id: contact?.id || null, to: contact?.email || '', sequence_step: s.sequence_step,
      kind: s.kind, subject: s.subject, body: s.body, citations: s.citations, status, sent_at: null, gmail_id: null,
      thread_id: null, replied_at: null, run_id: ctx.run?.id || null, polish_skipped: false,
    });
    if (s.sequence_step === 1) first = m;
    await reviewMessage(ctx, m.id, { open: s.sequence_step === 1 });
  }
  store.update('prospects', prospectId, { status: 'drafted' });
  audit(store, { actor: ctx.actor, action: 'outreach.drafted', item_type: 'prospect', item_id: prospectId, run_id: ctx.run?.id });
  return first;
}

export function messageLabel(store, m) {
  const p = store.get('prospects', m.prospect_id);
  if (m.sequence_step === 2) return 'Follow-up · 7 days no reply';
  if (m.sequence_step === 3) return 'Intro-call script';
  return `Email 1 of 3${p ? '' : ''}`;
}

export async function reviewMessage(ctx, messageId, { open = false } = {}) {
  const { store } = ctx;
  const m = store.get('messages', messageId);
  const prospect = store.get('prospects', m.prospect_id);
  const contact = m.contact_id ? store.get('contacts', m.contact_id) : contactFor(store, m.prospect_id);
  const results = reviewMessageHard(store, m, { prospect, contact, mode: ctx.integrations.mode });
  // Optional polish: for schools, name what the school provides so the ask feels light.
  if (m.kind === 'email' && m.sequence_step === 1 && prospect?.segment === 'school' && !m.polish_skipped
    && !/staff contact/i.test(m.body)) {
    results.push({
      check: 'polish', label: 'Optional polish', result: 'flag', blocking: false, optional: true,
      suggestion: 'Add one sentence on what the school provides (a staff contact, a space and a time) so the ask feels light.',
      fix: { field: 'body', text: insertBeforeAsk(m.body, 'All we ask of a school is a staff contact, a space and a time.') },
    });
  }
  saveResults(store, 'message', messageId, results);
  if (ctx.llm?.available && m.kind === 'email') {
    try {
      const j = await judgeWithClaude(ctx, { kind: 'outreach email', text: `Subject: ${m.subject}\n\n${m.body}`, criteria: COMMITMENT_RUBRIC, context: `To: ${contact?.title || ''} at ${prospect?.name}` });
      saveResults(store, 'message', messageId, j.items.map((it) => ({ check: `rubric:${it.check}`, label: it.check, result: it.met ? 'pass' : 'flag', blocking: false, suggestion: it.suggestion, fix: null })), 'rubric');
    } catch (err) {
      if (err.name === 'BudgetExceeded') throw err;
      logRun(ctx, `Commitments judge skipped: ${err.message}`);
    }
  }
  if (m.kind === 'email' && (open || approvalFor(store, 'message', messageId))) {
    if (!['queued', 'locked'].includes(m.status)) {
      const a = openApproval(ctx, { item_type: 'message', item_id: messageId, agent: 'outreach', title: `${prospect?.name}: ${m.subject}`, summary: messageLabel(store, m), run_id: m.run_id });
      afterReview(ctx, a.id, store.all('review_results', (r) => r.item_type === 'message' && r.item_id === messageId && !r.optional));
      if (m.status === 'drafted') store.update('messages', messageId, { status: 'in_review' });
    }
  }
  return results;
}

export async function updateMessage(ctx, messageId, patch) {
  const { store } = ctx;
  const before = store.get('messages', messageId);
  if (before.status === 'sent') throw Object.assign(new Error('This email was already sent.'), { status: 409 });
  const after = store.update('messages', messageId, { ...patch, edited_by: ctx.actor?.name || null });
  audit(store, { actor: ctx.actor, action: 'outreach.edit', item_type: 'message', item_id: messageId, before, after });
  await reviewMessage(ctx, messageId);
  return after;
}

// ---------------------------------------------------------------------------
// Execute

export async function sendMessage(ctx, messageId) {
  const { store, integrations } = ctx;
  assertApproved(store, 'message', messageId);
  const m = store.get('messages', messageId);
  if (m.status === 'sent') return m;
  if (store.find('suppressions', (s) => s.email?.toLowerCase() === m.to.toLowerCase())) throw Object.assign(new Error(`${m.to} opted out.`), { status: 409 });
  let result;
  if (integrations.gmail?.available) {
    result = await integrations.gmail.send({ to: m.to, subject: m.subject, body: m.body, threadId: m.sequence_step > 1 ? priorThread(store, m) : null });
  } else if (integrations.mode === 'demo') {
    result = { id: `demo-${Date.now()}`, threadId: priorThread(store, m) || `demo-thread-${m.prospect_id}`, simulated: true };
  } else {
    throw Object.assign(new Error('Gmail is not connected. Add the Google OAuth settings described in Settings, then send again. The approval is kept.'), { status: 409 });
  }
  const after = store.update('messages', messageId, { status: 'sent', sent_at: new Date().toISOString(), gmail_id: result.id, thread_id: result.threadId, simulated: !!result.simulated });
  markExecuted(ctx, 'message', messageId, { gmail_id: result.id, simulated: !!result.simulated });
  audit(store, { actor: ctx.actor, action: 'outreach.sent', item_type: 'message', item_id: messageId, before: m, after, note: result.simulated ? 'Demo: simulated send' : `Gmail ${result.id}` });
  const p = store.get('prospects', m.prospect_id);
  if (p && ['new', 'drafted'].includes(p.status)) store.update('prospects', p.id, { status: 'contacted', contacted_at: after.sent_at });
  if (m.sequence_step === 1) {
    const next = store.find('messages', (x) => x.prospect_id === m.prospect_id && x.sequence_step === 2 && x.status === 'queued');
    if (next) store.update('messages', next.id, { due_at: new Date(Date.now() + 7 * DAY_MS).toISOString(), to: m.to, contact_id: m.contact_id });
  }
  return after;
}

// Withdraw a message's approval item (reply received, opt-out).
function cancelApproval(ctx, messageId, note) {
  const a = approvalFor(ctx.store, 'message', messageId);
  if (!a || ['executed', 'rejected'].includes(a.state)) return;
  if (a.state === 'approved') transition(ctx, a.id, 'in_review', { note });
  transition(ctx, a.id, 'rejected', { note });
}

function priorThread(store, m) {
  return store.find('messages', (x) => x.prospect_id === m.prospect_id && x.thread_id && x.id !== m.id)?.thread_id || null;
}

export async function saveGmailDraft(ctx, messageId) {
  const { store, integrations } = ctx;
  const m = store.get('messages', messageId);
  let result;
  if (integrations.gmail?.available) result = await integrations.gmail.createDraft({ to: m.to, subject: m.subject, body: m.body });
  else if (integrations.mode === 'demo') result = { id: `demo-draft-${Date.now()}`, simulated: true };
  else throw Object.assign(new Error('Gmail is not connected.'), { status: 409 });
  const after = store.update('messages', messageId, { gmail_draft_id: result.id });
  audit(store, { actor: ctx.actor, action: 'outreach.gmail_draft', item_type: 'message', item_id: messageId, after, note: result.simulated ? 'Demo: simulated' : `Draft ${result.id}` });
  return after;
}

export function markReplied(ctx, messageId, { note = '' } = {}) {
  const { store } = ctx;
  const m = store.get('messages', messageId);
  if (m.replied_at) return m;
  const after = store.update('messages', messageId, { replied_at: new Date().toISOString(), reply_note: note });
  const p = store.get('prospects', m.prospect_id);
  store.update('prospects', p.id, { status: 'replied' });
  for (const other of store.all('messages', (x) => x.prospect_id === p.id && x.id !== m.id)) {
    if (other.sequence_step === 2 && ['queued', 'drafted', 'in_review'].includes(other.status)) {
      store.update('messages', other.id, { status: 'cancelled' });
      cancelApproval(ctx, other.id, 'Partner replied; follow-up not needed');
    }
    if (other.sequence_step === 3 && other.status === 'locked') store.update('messages', other.id, { status: 'ready' });
  }
  let ps = store.find('partnerships', (x) => x.prospect_id === p.id);
  if (!ps) {
    ps = store.insert('partnerships', {
      prospect_id: p.id, name: p.name, segment: p.segment, parish: p.parish, step: 1, offerings: p.offerings || [],
      next_action: 'Book the intro call', next_date: null, notes: note, checklist: DELIVERY_CHECKLIST.map((label) => ({ label, done: false })),
      survey: null, summary: '', history: [{ step: 1, at: new Date().toISOString() }],
    });
    audit(store, { actor: ctx.actor, action: 'partnership.created', item_type: 'partnership', item_id: ps.id, after: ps, note: 'Reply received' });
  }
  audit(store, { actor: ctx.actor, action: 'outreach.replied', item_type: 'message', item_id: messageId, before: m, after });
  return after;
}

export async function checkReplies(ctx) {
  const { store, integrations } = ctx;
  if (!integrations.gmail?.available) return 0;
  let n = 0;
  for (const m of store.all('messages', (x) => x.status === 'sent' && x.thread_id && !x.replied_at && !x.simulated)) {
    try {
      const reply = await integrations.gmail.threadReply(m.thread_id, m.gmail_id);
      if (reply) { markReplied(ctx, m.id, { note: reply.snippet || '' }); n++; }
      if (reply?.optOut) optOut(ctx, m.to, 'Replied "stop"');
    } catch (err) {
      if (err.name === 'BudgetExceeded') throw err;
      logRun(ctx, `Reply check failed for ${m.to}: ${err.message}`);
    }
  }
  return n;
}

export async function followUpCheck(ctx) {
  const { store } = ctx;
  const now = Date.now();
  let queued = 0;
  for (const m of store.all('messages', (x) => x.sequence_step === 2 && x.status === 'queued' && x.due_at)) {
    const first = store.find('messages', (x) => x.prospect_id === m.prospect_id && x.sequence_step === 1);
    if (!first || first.status !== 'sent' || first.replied_at) continue;
    if (new Date(m.due_at).getTime() > now) continue;
    store.update('messages', m.id, { status: 'drafted' });
    await reviewMessage(ctx, m.id, { open: true });
    queued++;
  }
  return queued;
}

export function optOut(ctx, email, reason = 'Asked not to be contacted') {
  const { store } = ctx;
  const e = String(email || '').trim().toLowerCase();
  if (!e) throw new Error('Email required');
  if (!store.find('suppressions', (s) => s.email === e)) store.insert('suppressions', { email: e, reason });
  for (const m of store.all('messages', (x) => (x.to || '').toLowerCase() === e && !['sent', 'cancelled'].includes(x.status))) {
    store.update('messages', m.id, { status: 'suppressed' });
    cancelApproval(ctx, m.id, 'Opted out');
  }
  audit(store, { actor: ctx.actor, action: 'outreach.opt_out', item_type: 'suppression', item_id: e, note: reason });
  return true;
}

// ---------------------------------------------------------------------------
// Execution board

export function addPartner(ctx, input) {
  const { store } = ctx;
  const ps = store.insert('partnerships', {
    prospect_id: input.prospect_id || null, name: input.name, segment: input.segment || 'school', parish: input.parish || null,
    step: +input.step || 1, offerings: input.offerings || [], next_action: input.next_action || 'Book the intro call',
    next_date: input.next_date || null, notes: input.notes || '', checklist: DELIVERY_CHECKLIST.map((label) => ({ label, done: false })),
    survey: null, summary: '', history: [{ step: +input.step || 1, at: new Date().toISOString() }], sample: !!input.sample,
  });
  audit(store, { actor: ctx.actor, action: 'partnership.add', item_type: 'partnership', item_id: ps.id, after: ps });
  return ps;
}

export function updatePartnership(ctx, id, patch) {
  const { store } = ctx;
  const before = store.get('partnerships', id);
  const next = { ...patch };
  if (patch.step && +patch.step !== before.step) {
    next.step = Math.max(1, Math.min(5, +patch.step));
    next.history = [...(before.history || []), { step: next.step, at: new Date().toISOString() }];
  }
  const after = store.update('partnerships', id, next);
  audit(store, { actor: ctx.actor, action: patch.step ? 'partnership.step' : 'partnership.update', item_type: 'partnership', item_id: id, before, after });
  return after;
}

// Anonymous pre/post aggregates only: no names, matching the Partner Guide promise.
export function recordSurvey(ctx, id, s) {
  const clean = {
    trained: Math.max(0, parseInt(s.trained, 10) || 0),
    pre_knowledge: clampPct(s.pre_knowledge), post_knowledge: clampPct(s.post_knowledge),
    pre_confidence: clampPct(s.pre_confidence), post_confidence: clampPct(s.post_confidence),
    corps_members: Math.max(0, parseInt(s.corps_members, 10) || 0),
    service_hours: Math.max(0, parseInt(s.service_hours, 10) || 0),
    qr_scans: Math.max(0, parseInt(s.qr_scans, 10) || 0),
    app_opens: Math.max(0, parseInt(s.app_opens, 10) || 0),
  };
  return updatePartnership(ctx, id, { survey: clean });
}

function clampPct(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
}

export function impactLines(ps) {
  const s = ps.survey;
  if (!s) return [];
  const lines = [];
  lines.push({ label: 'People trained', value: s.trained ? String(s.trained) : '—' });
  if (s.pre_knowledge !== null && s.post_knowledge !== null) lines.push({ label: 'Change in response knowledge', value: `${s.pre_knowledge}% → ${s.post_knowledge}% (${delta(s.post_knowledge - s.pre_knowledge)} pts)` });
  if (s.pre_confidence !== null && s.post_confidence !== null) lines.push({ label: 'Change in confidence to respond', value: `${s.pre_confidence}% → ${s.post_confidence}% (${delta(s.post_confidence - s.pre_confidence)} pts)` });
  if (s.corps_members || s.service_hours) lines.push({ label: 'Corps leadership activity', value: `${s.corps_members} members · ${s.service_hours} service hours` });
  if (s.qr_scans || s.app_opens) lines.push({ label: 'QR and app engagement', value: `${s.qr_scans} QR scans · ${s.app_opens} app opens` });
  return lines;
}

const delta = (n) => (n > 0 ? `+${Math.round(n)}` : String(Math.round(n)));

export async function generateImpactSummary(ctx, id) {
  const { store } = ctx;
  const ps = store.get('partnerships', id);
  if (!ps.survey) throw Object.assign(new Error('Enter the anonymous pre/post survey results first.'), { status: 400 });
  const lines = impactLines(ps);
  const offerings = (ps.offerings || []).map((k) => OFFERINGS[k]?.label).filter(Boolean).join(', ') || 'our programs';
  const summary = [
    `Impact summary · ${ps.name}`,
    `Thank you for partnering with Hope Resuscitated on ${offerings}. Here is what your community achieved, from anonymous before-and-after assessments:`,
    ...lines.map((l) => `• ${l.label}: ${l.value}`),
    'Next step: let\'s plan what comes next together.',
  ].join('\n');
  const after = updatePartnership(ctx, id, { summary, summary_at: new Date().toISOString() });
  // Sending the summary to the partner is an email, so it goes through approval.
  const contact = ps.prospect_id ? contactFor(store, ps.prospect_id) : null;
  if (contact && isEmail(contact.email)) {
    const settings = store.settings();
    const m = store.insert('messages', {
      prospect_id: ps.prospect_id, contact_id: contact.id, to: contact.email, sequence_step: 4, kind: 'email',
      subject: `Your Hope Resuscitated impact summary`, body: `Hi ${contact.name?.split(' ')[0] || 'there'},\n\n${summary}\n\nWould you like to set a time to plan next steps?\n\n${settings.sender?.name || 'Leila Ramos'}\n${settings.sender?.title || 'Founder & Youth Director, Hope Resuscitated'}\n\n${footerText(settings)}`,
      citations: [{ type: 'input', value: JSON.stringify(ps.survey), label: 'Survey results' }], status: 'drafted', run_id: null,
    });
    await reviewMessage(ctx, m.id, { open: true });
  }
  return after;
}

export function outreachStats(store) {
  return {
    accessPoints: factValue(store, 'access_points') || '5',
  };
}

// Grant Studio · Development Associate
// Find → Filter → Draft → Review → (human approval) → Export / mark ready.

import { audit, raiseAlert } from '../audit.js';
import { DEFAULT_GRANT_QUESTIONS, DEFAULT_GRANT_RUBRIC, DEFAULT_ATTACHMENTS } from '../schema.js';
import { daysUntil, normalizeName, money, tokenize, centralToDate } from '../util.js';
import { draftGrantAnswer, parseRfp } from '../writer.js';
import { reviewAnswerHard, evaluateRubricOffline, judgeWithClaude } from '../reviewer.js';
import { openApproval, afterReview, approvalFor, assertApproved, markExecuted } from '../approvals.js';
import { logRun } from '../runs.js';
import { saveResults, resultsFor, sourcePack, CITATION_SCHEMA, WRITER_RULES } from './common.js';

// ---------------------------------------------------------------------------
// Find

export function upsertGrant(ctx, g) {
  const { store } = ctx;
  const existing = g.external_id
    ? store.find('grants', (x) => x.source === g.source && x.external_id === g.external_id)
    : store.find('grants', (x) => normalizeName(x.title) === normalizeName(g.title) && normalizeName(x.funder) === normalizeName(g.funder));
  if (existing) return { grant: existing, created: false };
  const grant = store.insert('grants', {
    source: g.source, external_id: g.external_id || null, funder: g.funder || '[Funder]', title: g.title, program: g.program || '',
    amount_min: g.amount_min ?? null, amount_max: g.amount_max ?? null, deadline: g.deadline || null,
    rfp_url: g.rfp_url || null, eligibility_text: g.eligibility_text || '', description: g.description || '',
    rfp_text: g.rfp_text || '', match: null, match_reason: '', checks: [], status: 'new',
    run_id: ctx.run?.id || null, sample: !!g.sample,
  });
  audit(store, { actor: ctx.actor, action: 'grant.found', item_type: 'grant', item_id: grant.id, after: grant, run_id: ctx.run?.id });
  return { grant, created: true };
}

export async function scoutGrants(ctx) {
  const { store, integrations } = ctx;
  const settings = store.settings();
  const keywords = settings.grant_rules?.keywords || ['naloxone', 'opioid overdose prevention', 'youth substance use prevention'];
  let found = 0;
  let created = 0;
  const newGrants = [];
  const src = integrations.grantsgov;
  if (src?.available) {
    for (const kw of keywords) {
      try {
        const hits = await src.search(kw);
        logRun(ctx, `Grants.gov "${kw}": ${hits.length} results`);
        for (const h of hits) {
          found++;
          const { grant, created: isNew } = upsertGrant(ctx, h);
          if (isNew) { created++; newGrants.push(grant); }
        }
      } catch (err) {
        if (err.name === 'BudgetExceeded') throw err;
        logRun(ctx, `Grants.gov "${kw}" failed: ${err.message}`);
      }
    }
  } else {
    logRun(ctx, 'Grants.gov is not reachable from here; paste Instrumentl alerts or import Candid CSVs instead.');
  }
  for (const g of newGrants) await filterGrant(ctx, g.id);
  return { found, created, eligible: newGrants.filter((g) => store.get('grants', g.id).match !== 'drop').length };
}

// ---------------------------------------------------------------------------
// Filter

const FOCUS = /\b(youth|young people|adolescen|teen|student|overdose|naloxone|narcan|opioid|substance|prevention|harm reduction|drug|school)/i;
const NONPROFIT = /\b(501\s*\(c\)\s*\(3\)|nonprofit|non-profit|not-for-profit|charitable organi[sz]ation)/i;
const EXCLUDES_NONPROFIT = /\b(for-profit (entities|businesses) only|only (state|local|tribal) govern|individuals only|not open to nonprofits)\b/i;
const OTHER_STATE = /\b(only|limited to|must be located in|residents of)\b[^.]{0,40}\b(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)\b/i;

export function ruleChecks(grant, settings) {
  const rules = settings.grant_rules || {};
  const text = `${grant.title} ${grant.description} ${grant.eligibility_text}`;
  const checks = [];
  // 501(c)(3)
  if (EXCLUDES_NONPROFIT.test(text)) checks.push({ key: 'nonprofit', label: 'Not open to nonprofits', ok: false });
  else if (NONPROFIT.test(text)) checks.push({ key: 'nonprofit', label: '501(c)(3)', ok: true });
  else checks.push({ key: 'nonprofit', label: 'Nonprofit eligibility unclear', ok: null });
  // Louisiana
  if (OTHER_STATE.test(text) && !/louisiana/i.test(text)) checks.push({ key: 'geo', label: 'Limited to another state', ok: false });
  else checks.push({ key: 'geo', label: 'Louisiana eligible', ok: true });
  // Youth / overdose focus
  checks.push(FOCUS.test(text) ? { key: 'focus', label: /youth|young|teen|adolescen|student|school/i.test(text) ? 'Youth population' : 'Overdose prevention focus', ok: true }
    : { key: 'focus', label: 'Off-mission', ok: false });
  // Award size
  const min = rules.award_min ?? 1000;
  const max = rules.award_max ?? 250000;
  const top = grant.amount_max || grant.amount_min;
  if (!top) checks.push({ key: 'award', label: 'Award size unclear', ok: null });
  else if (top < min) checks.push({ key: 'award', label: `Award under ${money(min)}`, ok: false });
  else if ((grant.amount_min || 0) > max) checks.push({ key: 'award', label: `Award over ${money(max)}`, ok: false });
  else checks.push({ key: 'award', label: 'Award size fits', ok: true });
  // Deadline 14+ days away
  const days = daysUntil(grant.deadline);
  const minDays = rules.min_days_to_deadline ?? 14;
  if (days === null) checks.push({ key: 'deadline', label: 'Deadline not confirmed', ok: null });
  else if (days < 0) checks.push({ key: 'deadline', label: 'Deadline passed', ok: false });
  else if (days < minDays) checks.push({ key: 'deadline', label: `Due in ${days} days`, ok: false });
  else checks.push({ key: 'deadline', label: `${days} days to deadline`, ok: true });
  if (/budget minimum|minimum (annual )?budget|operating budget of at least/i.test(text)) checks.push({ key: 'budget_min', label: 'Budget minimum unclear', ok: null });
  return checks;
}

function offlineReason(grant, checks) {
  const t = `${grant.title} ${grant.description} ${grant.eligibility_text}`.toLowerCase();
  const bits = [];
  if (/naloxone|narcan/.test(t)) bits.push('funds naloxone access, which lines up with your five library access points');
  else if (/opioid|overdose/.test(t)) bits.push('targets overdose prevention, your core mission');
  if (/youth|young|teen|adolescen|student/.test(t)) bits.push('prioritizes young people, the population you serve');
  if (/youth-led|youth led/.test(t)) bits.push('favors youth-led organizations');
  if (/louisiana|baton rouge|capital region/.test(t)) bits.push('is focused on Louisiana');
  const unclear = checks.filter((c) => c.ok === null).map((c) => c.label.toLowerCase());
  let reason = bits.length ? `Why it fits: ${bits.slice(0, 2).join(' and ')}.` : 'Why it fits: matches your prevention focus.';
  if (unclear.length) reason += ` Scout could not confirm: ${unclear.join(', ')}.`;
  const bad = checks.filter((c) => c.ok === false).map((c) => c.label.toLowerCase());
  if (bad.length) reason = `Dropped: ${bad.join(', ')}.`;
  return reason;
}

export async function filterGrant(ctx, grantId) {
  const { store, llm } = ctx;
  const grant = store.get('grants', grantId);
  const checks = ruleChecks(grant, store.settings());
  let match = checks.some((c) => c.ok === false) ? 'drop' : checks.some((c) => c.ok === null) ? 'possible' : 'strong';
  let reason = offlineReason(grant, checks);
  if (llm?.available && match !== 'drop') {
    try {
      const profile = store.settings().org_profile || {};
      const out = await llm.json({
        purpose: 'tag',
        run: ctx.run,
        system: 'You screen grant opportunities for Hope Resuscitated. Decide whether it fits the organization and explain why in one sentence that starts with "Why it fits:". If a rule cannot be confirmed from the text, set match to "possible" and name the rule to check.',
        prompt: `Organization profile:\n${JSON.stringify(profile, null, 2)}\n\nOpportunity:\nFunder: ${grant.funder}\nTitle: ${grant.title}\nAward: ${grant.amount_min || '?'}–${grant.amount_max || '?'}\nDeadline: ${grant.deadline || 'unknown'}\nEligibility: ${grant.eligibility_text}\nDescription: ${grant.description}`,
        schema: {
          type: 'object',
          properties: { match: { type: 'string', enum: ['strong', 'possible', 'drop'] }, reason: { type: 'string' }, rule_to_check: { type: 'string' } },
          required: ['match', 'reason', 'rule_to_check'],
          additionalProperties: false,
        },
      });
      // Deterministic rules win; the model can only make a match more cautious.
      const rank = { strong: 2, possible: 1, drop: 0 };
      if (rank[out.match] < rank[match]) match = out.match;
      reason = out.reason + (out.rule_to_check && match === 'possible' ? ` Check: ${out.rule_to_check}.` : '');
    } catch (err) {
      if (err.name === 'BudgetExceeded') throw err;
      logRun(ctx, `Eligibility model check skipped: ${err.message}`);
    }
  }
  const updated = store.update('grants', grantId, { match, match_reason: reason, checks, status: grant.status === 'new' ? (match === 'drop' ? 'dropped' : 'matched') : grant.status });
  audit(store, { actor: ctx.actor, action: 'grant.filtered', item_type: 'grant', item_id: grantId, before: grant, after: updated, run_id: ctx.run?.id });
  return updated;
}

// ---------------------------------------------------------------------------
// Manual intake: Instrumentl alert emails, Candid CSV exports, foundation sites

const DATE_RE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b|\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2}),?\s+(\d{4})\b|\b(\d{4})-(\d{2})-(\d{2})\b/i;
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

export function parseDate(s) {
  const m = String(s || '').match(DATE_RE);
  if (!m) return null;
  let y; let mo; let d;
  if (m[1]) { mo = +m[1]; d = +m[2]; y = +m[3]; }
  else if (m[4]) { mo = MON[m[4].slice(0, 3).toLowerCase()]; d = +m[5]; y = +m[6]; }
  else { y = +m[7]; mo = +m[8]; d = +m[9]; }
  // Deadlines close at 11:59 PM Central.
  if (!y || !mo || !d) return null;
  return centralToDate(y, mo, d, 23, 59).toISOString();
}

export function parseAmounts(s) {
  const nums = (String(s || '').match(/\$\s?[\d,.]+\s*(k|m|million|thousand)?/gi) || []).map((x) => {
    const n = parseFloat(x.replace(/[$,\s]|k|m|million|thousand/gi, ''));
    if (/m(illion)?$/i.test(x.trim())) return n * 1e6;
    if (/k|thousand$/i.test(x.trim())) return n * 1e3;
    return n;
  }).filter((n) => n > 0);
  if (!nums.length) return { amount_min: null, amount_max: null };
  if (/up to/i.test(s) && nums.length === 1) return { amount_min: null, amount_max: nums[0] };
  return { amount_min: Math.min(...nums), amount_max: Math.max(...nums) };
}

export function parseInstrumentlAlert(text) {
  const blocks = String(text || '').split(/\n\s*(?:-{3,}|={3,}|\*{3,})\s*\n|\n{3,}/).map((b) => b.trim()).filter((b) => b.length > 20);
  return blocks.map((b) => {
    const lines = b.split('\n').map((l) => l.trim()).filter(Boolean);
    const get = (re) => lines.find((l) => re.test(l))?.replace(re, '').trim() || '';
    const title = get(/^(grant|opportunity|program|title)\s*[:\-]\s*/i) || lines[0].replace(/^[•*-]\s*/, '');
    const funder = get(/^(funder|foundation|from|grantmaker|organization)\s*[:\-]\s*/i) || '[Funder]';
    const amountLine = lines.find((l) => /\$/.test(l)) || '';
    const deadlineLine = lines.find((l) => /deadline|due|closes/i.test(l)) || b;
    const url = (b.match(/https?:\/\/\S+/) || [null])[0];
    return {
      source: 'instrumentl', funder, title, rfp_url: url, deadline: parseDate(deadlineLine),
      ...parseAmounts(amountLine), description: b, eligibility_text: get(/^(eligibility|eligible)\s*[:\-]\s*/i),
    };
  }).filter((g) => g.title);
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

export function parseCandidCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const head = rows[0].map((h) => h.toLowerCase());
  const col = (...names) => head.findIndex((h) => names.some((n) => h.includes(n)));
  const c = {
    funder: col('grantmaker', 'funder', 'foundation', 'organization'), title: col('program', 'title', 'opportunity', 'grant name'),
    amount: col('amount', 'award', 'range'), deadline: col('deadline', 'due'), url: col('url', 'link', 'website'),
    elig: col('eligib', 'restriction'), desc: col('description', 'purpose', 'focus', 'area'),
  };
  return rows.slice(1).map((r) => ({
    source: 'candid', funder: r[c.funder] || '[Funder]', title: r[c.title] || r[c.funder] || '[Grant name]',
    rfp_url: c.url >= 0 ? r[c.url] || null : null, deadline: c.deadline >= 0 ? parseDate(r[c.deadline]) : null,
    ...parseAmounts(c.amount >= 0 ? r[c.amount] : ''), eligibility_text: c.elig >= 0 ? r[c.elig] : '', description: c.desc >= 0 ? r[c.desc] : '',
  })).filter((g) => g.title);
}

export async function importGrants(ctx, list) {
  const out = [];
  for (const g of list) {
    const { grant, created } = upsertGrant(ctx, g);
    if (created) out.push(await filterGrant(ctx, grant.id));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Draft

async function writeAnswer(ctx, q, grant, draft, { final = false } = {}) {
  const { store, llm } = ctx;
  if (llm?.available) {
    try {
      const pack = sourcePack(store, `${grant.title} ${q.question} ${q.prompt}`, { collection: 'grants', k: 8 });
      const out = await llm.json({
        purpose: final ? 'final' : 'draft',
        run: ctx.run,
        system: `You are the Development Associate for Hope Resuscitated, a youth-led overdose prevention nonprofit in Louisiana. You draft grant answers from the organization's knowledge base.\n${WRITER_RULES}\n- Stay under ${q.limit_chars} characters including spaces.`,
        prompt: `Funder: ${grant.funder}\nGrant: ${grant.title}\nRequest amount: ${draft.request_amount ? money(draft.request_amount) : 'not set'}\n\nRFP question: ${q.question}\nFunder prompt: ${q.prompt}\nCharacter limit: ${q.limit_chars}\n\nSources:\n${pack.render()}`,
        schema: CITATION_SCHEMA,
      });
      const citations = pack.toCitations(out.source_ids);
      if (draft.request_amount) citations.push({ type: 'input', value: draft.request_amount, label: 'Request amount' });
      return { text: out.text.trim(), citations, model: final ? 'final' : 'draft' };
    } catch (err) {
      if (err.name === 'BudgetExceeded') throw err;
      logRun(ctx, `Writer fell back to templates for "${q.question}": ${err.message}`);
    }
  }
  return { ...draftGrantAnswer(store, q, { grant, draft }), model: 'template' };
}

export async function sendToWriter(ctx, grantId, { rfp_text = '', request_amount = null } = {}) {
  const { store } = ctx;
  const grant = store.get('grants', grantId);
  if (!grant) throw new Error('Grant not found');
  const existing = store.find('grant_drafts', (d) => d.grant_id === grantId && d.status !== 'discarded');
  if (existing) return existing;
  const parsed = parseRfp(rfp_text || grant.rfp_text);
  const questions = (parsed.length ? parsed : DEFAULT_GRANT_QUESTIONS).map((q) => ({ ...q, limit_chars: q.limit }));
  const draft = store.insert('grant_drafts', {
    grant_id: grantId, request_amount: request_amount ? +request_amount : grant.amount_max || null, status: 'drafting',
    gdoc_url: null, rubric: grant.rubric?.length ? grant.rubric : DEFAULT_GRANT_RUBRIC,
    attachments: DEFAULT_ATTACHMENTS.map((name) => ({ name, done: false })), rubric_met: 0, rubric_total: 0, run_id: ctx.run?.id || null,
  });
  if (rfp_text) store.update('grants', grantId, { rfp_text });
  for (const [i, q] of questions.entries()) {
    const { text, citations, model } = await writeAnswer(ctx, q, grant, draft);
    store.insert('draft_answers', {
      draft_id: draft.id, order: i + 1, key: q.key, question: q.question, prompt: q.prompt, limit_chars: q.limit_chars,
      text, char_count: text.length, citations, model, run_id: ctx.run?.id || null,
    });
  }
  store.update('grants', grantId, { status: 'drafted' });
  store.update('grant_drafts', draft.id, { status: 'in_review' });
  audit(store, { actor: ctx.actor, action: 'grant.drafted', item_type: 'grant_draft', item_id: draft.id, after: draft, run_id: ctx.run?.id });
  openApproval(ctx, { item_type: 'grant_draft', item_id: draft.id, agent: 'grant', title: grant.title, summary: `${grant.funder} · ${money(draft.request_amount)}`, run_id: ctx.run?.id });
  await reviewDraft(ctx, draft.id);
  return store.get('grant_drafts', draft.id);
}

// ---------------------------------------------------------------------------
// Review

export async function reviewDraft(ctx, draftId) {
  const { store } = ctx;
  const draft = store.get('grant_drafts', draftId);
  const grant = store.get('grants', draft.grant_id);
  const answers = store.all('draft_answers', (a) => a.draft_id === draftId).sort((a, b) => a.order - b.order);
  const allAnswerResults = [];
  for (const a of answers) {
    const results = reviewAnswerHard(store, a, { grant, draft });
    saveResults(store, 'draft_answer', a.id, results);
    allAnswerResults.push(...results);
  }
  const fullText = answers.map((a) => a.text).join('\n\n');
  let rubric = null;
  if (ctx.llm?.available) {
    try {
      const judged = await judgeWithClaude(ctx, {
        kind: 'grant proposal', text: answers.map((a) => `## ${a.question} (limit ${a.limit_chars})\n${a.text}`).join('\n\n'),
        criteria: draft.rubric, context: `Funder: ${grant.funder}\nGrant: ${grant.title}\nRequest: ${money(draft.request_amount)}`,
      });
      rubric = draft.rubric.map((c, i) => {
        const j = judged.items[i] || judged.items.find((x) => x.check === c) || { met: false, suggestion: '' };
        return { check: c, met: j.met, suggestion: j.suggestion };
      });
      // Hard checks overrule the judge on limits and sources.
      const offline = evaluateRubricOffline(draft.rubric, fullText, { request: draft.request_amount, answersReview: allAnswerResults });
      rubric = rubric.map((r, i) => (/limit|source|traced/i.test(r.check) ? offline[i] : r));
    } catch (err) {
      if (err.name === 'BudgetExceeded') throw err;
      logRun(ctx, `Rubric judge fell back to heuristics: ${err.message}`);
    }
  }
  if (!rubric) rubric = evaluateRubricOffline(draft.rubric, fullText, { request: draft.request_amount, answersReview: allAnswerResults });
  saveResults(store, 'grant_draft', draftId, rubric.map((r) => ({
    check: `rubric:${r.check}`, label: r.check, result: r.met ? 'pass' : 'flag', blocking: false, suggestion: r.suggestion, fix: null,
  })), 'rubric');
  const met = rubric.filter((r) => r.met).length;
  store.update('grant_drafts', draftId, { rubric_met: met, rubric_total: rubric.length, reviewed_at: new Date().toISOString() });
  const approval = approvalFor(store, 'grant_draft', draftId);
  const combined = [...allAnswerResults, ...rubric.map((r) => ({ result: r.met ? 'pass' : 'flag', blocking: false }))];
  if (approval) afterReview(ctx, approval.id, combined);
  if (['exported', 'ready'].includes(draft.status) && combined.some((r) => r.result === 'flag' && r.blocking)) {
    store.update('grant_drafts', draftId, { status: 'in_review' });
  }
  return { rubric, answers: allAnswerResults };
}

export async function updateAnswer(ctx, answerId, text) {
  const { store } = ctx;
  const before = store.get('draft_answers', answerId);
  const after = store.update('draft_answers', answerId, { text, char_count: text.length, edited_by: ctx.actor?.name || null });
  audit(store, { actor: ctx.actor, action: 'grant.answer.edit', item_type: 'draft_answer', item_id: answerId, before, after });
  const draft = store.get('grant_drafts', before.draft_id);
  if (['ready', 'exported'].includes(draft.status)) store.update('grant_drafts', draft.id, { status: 'in_review' });
  await reviewDraft(ctx, before.draft_id);
  return store.get('draft_answers', answerId);
}

export async function redraftAnswer(ctx, answerId, { final = false } = {}) {
  const { store } = ctx;
  const a = store.get('draft_answers', answerId);
  const draft = store.get('grant_drafts', a.draft_id);
  const grant = store.get('grants', draft.grant_id);
  const { text, citations, model } = await writeAnswer(ctx, a, grant, draft, { final });
  const after = store.update('draft_answers', answerId, { text, char_count: text.length, citations, model });
  audit(store, { actor: ctx.actor, action: 'grant.answer.redraft', item_type: 'draft_answer', item_id: answerId, before: a, after });
  await reviewDraft(ctx, a.draft_id);
  return after;
}

export async function reparseRfp(ctx, draftId, rfpText) {
  const { store } = ctx;
  const draft = store.get('grant_drafts', draftId);
  const grant = store.get('grants', draft.grant_id);
  const parsed = parseRfp(rfpText);
  if (!parsed.length) throw new Error('No numbered questions found. Paste questions as "1. Question (800 characters)".');
  store.update('grants', grant.id, { rfp_text: rfpText });
  for (const old of store.all('draft_answers', (a) => a.draft_id === draftId)) {
    store.removeWhere('review_results', (r) => r.item_id === old.id);
    store.remove('draft_answers', old.id);
  }
  for (const [i, q0] of parsed.entries()) {
    const q = { ...q0, limit_chars: q0.limit };
    const { text, citations, model } = await writeAnswer(ctx, q, grant, draft);
    store.insert('draft_answers', { draft_id: draftId, order: i + 1, key: q.key, question: q.question, prompt: q.prompt, limit_chars: q.limit_chars, text, char_count: text.length, citations, model });
  }
  audit(store, { actor: ctx.actor, action: 'grant.rfp.parsed', item_type: 'grant_draft', item_id: draftId, note: `${parsed.length} questions` });
  await reviewDraft(ctx, draftId);
  return store.get('grant_drafts', draftId);
}

// ---------------------------------------------------------------------------
// Execute (after approval only)

export function draftDocument(store, draftId) {
  const draft = store.get('grant_drafts', draftId);
  const grant = store.get('grants', draft.grant_id);
  const answers = store.all('draft_answers', (a) => a.draft_id === draftId).sort((a, b) => a.order - b.order);
  return {
    title: `${grant.title} · ${grant.funder}`,
    meta: `${grant.funder} · ${money(draft.request_amount)} request · Due ${grant.deadline ? new Date(grant.deadline).toDateString() : '[date]'}`,
    sections: answers.map((a) => ({ heading: `${a.order}. ${a.question}`, count: `${a.text.length.toLocaleString('en-US')} / ${a.limit_chars.toLocaleString('en-US')} characters`, text: a.text })),
    attachments: draft.attachments,
  };
}

export async function exportDraft(ctx, draftId) {
  const { store, integrations } = ctx;
  assertApproved(store, 'grant_draft', draftId);
  const draft = store.get('grant_drafts', draftId);
  const doc = draftDocument(store, draftId);
  let result;
  if (integrations.docs?.available) {
    result = await integrations.docs.exportDraft(doc);
  } else if (integrations.docs?.fallback) {
    result = await integrations.docs.fallback(doc, draft);
  } else {
    result = { url: null, simulated: true, note: 'Demo: Google Docs is not connected, so the draft opens here instead.' };
  }
  const after = store.update('grant_drafts', draftId, { status: 'exported', gdoc_url: result.url || draft.gdoc_url, exported_at: new Date().toISOString() });
  markExecuted(ctx, 'grant_draft', draftId, { action: 'export', ...result });
  audit(store, { actor: ctx.actor, action: 'grant.exported', item_type: 'grant_draft', item_id: draftId, before: draft, after, note: result.url || result.note || '' });
  return { draft: after, doc, result };
}

export function markReady(ctx, draftId) {
  const { store } = ctx;
  assertApproved(store, 'grant_draft', draftId);
  const before = store.get('grant_drafts', draftId);
  const after = store.update('grant_drafts', draftId, { status: 'ready', ready_at: new Date().toISOString() });
  markExecuted(ctx, 'grant_draft', draftId, { action: 'ready' });
  audit(store, { actor: ctx.actor, action: 'grant.ready', item_type: 'grant_draft', item_id: draftId, before, after });
  return after;
}

export function markSubmitted(ctx, draftId) {
  const { store } = ctx;
  assertApproved(store, 'grant_draft', draftId);
  const before = store.get('grant_drafts', draftId);
  const after = store.update('grant_drafts', draftId, { status: 'submitted', submitted_at: new Date().toISOString(), submitted_by: ctx.actor?.name });
  store.update('grants', before.grant_id, { status: 'submitted' });
  audit(store, { actor: ctx.actor, action: 'grant.submitted', item_type: 'grant_draft', item_id: draftId, before, after, note: 'Submitted by a person in the funder portal' });
  return after;
}

// ---------------------------------------------------------------------------
// Scheduled checks

export function deadlineWatch(ctx) {
  const { store } = ctx;
  let flagged = 0;
  for (const g of store.all('grants', (x) => x.deadline && !['submitted', 'dismissed', 'dropped'].includes(x.status))) {
    const days = daysUntil(g.deadline);
    if (days === null || days < 0 || days > 14) continue;
    const today = new Date().toISOString().slice(0, 10);
    if (g.deadline_alerted === today) continue;
    raiseAlert(store, { level: days <= 3 ? 'critical' : 'warning', title: `${g.title} is due in ${days} day${days === 1 ? '' : 's'}`, detail: `${g.funder}. Deadline ${new Date(g.deadline).toDateString()}.`, agent: 'grant' });
    store.update('grants', g.id, { deadline_alerted: today });
    flagged++;
  }
  return flagged;
}

export async function weeklyGrantRun(ctx) {
  const scout = await scoutGrants(ctx);
  const max = ctx.store.settings().grant_rules?.max_auto_drafts ?? 3;
  const toDraft = ctx.store.all('grants', (g) => g.match === 'strong' && g.status === 'matched').slice(0, max);
  for (const g of toDraft) await sendToWriter(ctx, g.id);
  deadlineWatch(ctx);
  return `Scout found ${scout.found} (${scout.created} new, ${scout.eligible} eligible). Writer drafted ${toDraft.length}.`;
}

export function grantChip(store, draft) {
  const answers = store.all('draft_answers', (a) => a.draft_id === draft.id);
  const over = answers.filter((a) => a.text.length > a.limit_chars).length;
  const blocking = store.all('review_results', (r) => r.item_type === 'draft_answer' && answers.some((a) => a.id === r.item_id) && r.result === 'flag' && r.blocking).length;
  const approval = approvalFor(store, 'grant_draft', draft.id);
  if (draft.status === 'submitted') return { tone: 'good', label: 'Submitted' };
  if (draft.status === 'ready') return { tone: 'good', label: 'Ready to submit' };
  if (over) return { tone: 'warn', label: `${over} answer${over > 1 ? 's' : ''} over limit` };
  if (blocking) return { tone: 'warn', label: `${blocking} flag${blocking > 1 ? 's' : ''} to fix` };
  const missing = (draft.attachments || []).filter((a) => !a.done);
  if (missing.some((a) => /budget/i.test(a.name))) return { tone: 'warn', label: 'Needs budget PDF' };
  if (approval?.state === 'approved' || approval?.state === 'executed') return { tone: 'good', label: 'Approved' };
  return { tone: 'good', label: 'All checks pass' };
}

export function similarity(a, b) {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  let hit = 0;
  for (const t of A) if (B.has(t)) hit++;
  return hit / Math.max(1, Math.min(A.size, B.size));
}

export { resultsFor };

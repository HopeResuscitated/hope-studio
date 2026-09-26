// Reviewer: the guardrails engine shared by all three agents.
//
// Layer 1 is hard checks in code (no model): limits, required phrases, alt
// text, CAN-SPAM footer, banned terms, sourced numbers, consent, minors.
// Layer 2 is the rubric judge (Claude Sonnet when an API key is configured,
// deterministic heuristics otherwise). Every flag carries a suggested fix, and
// many carry a one-click `fix` the UI can apply.

import { splitSentences, tokenize, isEmail } from './util.js';
import { IG_CAPTION_LIMIT, IG_HASHTAG_LIMIT, FB_CAPTION_LIMIT, DEFAULT_GRANT_RUBRIC } from './schema.js';

export const DEFAULT_BANNED_TERMS = [
  { term: 'addicts', replace: 'people who use drugs', category: 'stigma' },
  { term: 'addict', replace: 'person who uses drugs', category: 'stigma' },
  { term: 'junkies', replace: 'people who use drugs', category: 'stigma' },
  { term: 'junkie', replace: 'person who uses drugs', category: 'stigma' },
  { term: 'druggies', replace: 'people who use drugs', category: 'stigma' },
  { term: 'druggie', replace: 'person who uses drugs', category: 'stigma' },
  { term: 'crackhead', replace: 'person who uses drugs', category: 'stigma' },
  { term: 'drug abusers', replace: 'people who use drugs', category: 'stigma' },
  { term: 'drug abuser', replace: 'person who uses drugs', category: 'stigma' },
  { term: 'substance abuser', replace: 'person with a substance use disorder', category: 'stigma' },
  { term: 'overdose victims', replace: 'people experiencing an overdose', category: 'stigma' },
  { term: 'overdose victim', replace: 'person experiencing an overdose', category: 'stigma' },
  { term: 'dead body', replace: '', category: 'graphic' },
  { term: 'corpse', replace: '', category: 'graphic' },
  { term: 'body bag', replace: '', category: 'graphic' },
  { term: 'gruesome', replace: '', category: 'graphic' },
  { term: 'horrifying', replace: '', category: 'graphic' },
  { term: 'terrifying', replace: '', category: 'graphic' },
  { term: 'shocking', replace: '', category: 'graphic' },
  { term: 'fent', replace: 'fentanyl', category: 'slang' },
  { term: 'percs', replace: 'pills', category: 'slang' },
  { term: 'smack', replace: 'heroin', category: 'slang' },
  { term: 'dope', replace: 'drugs', category: 'slang' },
  { term: 'getting high', replace: 'using drugs', category: 'slang' },
];

const YOUTH_AS_MEDICAL = /\b(students?|youth|teens?|teenagers?|young people|hope responders?|responders|corps members?)\b[^.]{0,40}\b(are|as|become|act as|serve as|work as)\b[^.]{0,20}\b(medical (providers?|professionals?|staff)|paramedics?|emts?|nurses?|doctors?|clinicians?|first responders)\b/i;
const RESPONSE_STEP = /^(then\s+)?((spray|give|administer)\b.*\b(naloxone|narcan|nostril|dose|spray)|(roll|tilt|lay|place|turn)\b.*\b(side|head|recovery position|them|the person)|(support|start)\b.*\b(breath|rescue)|stay with (them|the person))/i;
const PERSONAL_TOPIC = /\b(grief|griev|loss|lost (a|my|your|their|five|someone)|struggl|mental health|suicid|someone you love|if this (topic )?is personal|family members?)\b/i;
const OPT_OUT = /\b(unsubscribe|opt[ -]?out|no longer (wish|want) to (hear|receive)|reply (with )?["“]?stop|won't email you again)\b/i;
const ALWAYS_OK_NUMBERS = new Set(['911', '988']);

// ---------------------------------------------------------------------------
// Primitive checks (exported for tests)

export function findBannedTerms(text, terms = DEFAULT_BANNED_TERMS) {
  const hits = [];
  const lower = String(text || '').toLowerCase();
  for (const t of terms) {
    const re = new RegExp(`(?<![a-z])${t.term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`, 'g');
    if (re.test(lower)) hits.push(t);
  }
  // Longest match wins (e.g. "addicts" over "addict").
  return hits.filter((h) => !hits.some((o) => o !== h && o.term.includes(h.term) && lower.includes(o.term)));
}

export function replaceTerms(text, hits) {
  let out = String(text);
  for (const h of hits) {
    if (!h.replace) continue;
    const re = new RegExp(`(?<![A-Za-z])${h.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z])`, 'gi');
    out = out.replace(re, (m) => (m[0] === m[0].toUpperCase() ? h.replace[0].toUpperCase() + h.replace.slice(1) : h.replace));
  }
  return out;
}

const NUM_RE = /\b\d{4}[–-]\d{2}\b|\b\d+\/\d+\b|\$?\d[\d,]*(?:\.\d+)?[%+]?/g;

export function numberTokens(text) {
  const cleaned = String(text || '')
    .replace(/^\s*\d+[.)]\s/gm, ' ') // numbered list markers
    .replace(/\b(R\.S\.|Act|Section|§)\s*\d+[:.]?\d*(\.\d+)?/gi, (m) => m); // keep statute cites as-is
  return (cleaned.match(NUM_RE) || [])
    .map((n) => n.replace(/[$,+%]/g, '').replace(/\.0+$/, ''))
    .filter((n) => n && !/^0+$/.test(n));
}

export function unsourcedNumbers(text, sourceTexts, extra = []) {
  const allowed = new Set([...ALWAYS_OK_NUMBERS, ...extra.map(String)]);
  for (const s of sourceTexts) for (const n of numberTokens(s)) allowed.add(n);
  const missing = [];
  for (const n of numberTokens(text)) {
    if (allowed.has(n)) continue;
    // Allow a statute section split (40:978.2 → 40, 978.2) when the whole cite is sourced.
    if (sourceTexts.some((s) => s.includes(n))) continue;
    if (!missing.includes(n)) missing.push(n);
  }
  return missing;
}

// True when a text's response instructions start with calling 911 (or it gives none).
export function callsFirst(text) {
  const lines = String(text || '').split('\n');
  const numbered = lines.map((l) => l.match(/^\s*\d+[.)]\s*(.+)$/)).filter(Boolean).map((m) => m[1]);
  if (numbered.length) return /call 911/i.test(numbered[0]);
  for (const sentence of splitSentences(text)) {
    if (/call 911/i.test(sentence)) return true;
    if (RESPONSE_STEP.test(sentence.trim())) return false;
  }
  return true;
}

export function countHashtags(text) {
  return (String(text || '').match(/(^|\s)#[\p{L}\p{N}_]+/gu) || []).length;
}

export function questionCount(body) {
  const main = String(body || '').split(/\n\s*(--|—|Leila Ramos|You're receiving this)/)[0];
  return splitSentences(main).filter((s) => s.trim().endsWith('?')).length;
}

// Trim text to a limit by dropping the least important sentences, then
// trailing clauses, never touching sentences that carry cited numbers first.
export function trimToLimit(text, limit) {
  const src = String(text || '');
  if (src.length <= limit) return src;
  const paras = src.split(/\n{2,}/).map((p) => splitSentences(p));
  const weight = (s) => {
    let w = 0;
    if (/\d/.test(s)) w += 3;
    if (/\b(we|our)\b/i.test(s)) w += 1;
    if (/^(so|and|this means|in short|as a result)\b/i.test(s)) w -= 2;
    if (/\b(every|within reach|imagine|truly|deeply|incredibly)\b/i.test(s)) w -= 1;
    return w;
  };
  const join = (ps) => ps.map((p) => p.join(' ')).filter(Boolean).join('\n\n');
  // 1) cut trailing "so ..." / ", which ..." clauses
  const clauseCut = paras.map((p) => p.map((s) => {
    const m = s.match(/^(.{40,}?)(,\s+(so|which|and so)\s+[^.]*)(\.)$/i);
    return m ? m[1] + m[4] : s;
  }));
  if (join(clauseCut).length <= limit) return join(clauseCut);
  // 2) shorten mission-style sentences to their first clause
  const firstClause = clauseCut.map((p) => p.map((s) => {
    const m = s.match(/^(.{50,}?)\s+while\s+[^.]*\.$/i);
    return m ? m[1] + '.' : s;
  }));
  if (join(firstClause).length <= limit) return join(firstClause);
  // 3) drop lowest-weight sentences until it fits
  const flat = [];
  firstClause.forEach((p, pi) => p.forEach((s, si) => flat.push({ pi, si, s, w: weight(s) })));
  const order = flat.filter((x) => !(x.pi === 0 && x.si === 0)).sort((a, b) => a.w - b.w || b.s.length - a.s.length);
  const dropped = new Set();
  for (const x of order) {
    const current = firstClause.map((p, pi) => p.filter((_, si) => !dropped.has(`${pi}:${si}`)));
    if (join(current).length <= limit) break;
    dropped.add(`${x.pi}:${x.si}`);
  }
  let out = join(firstClause.map((p, pi) => p.filter((_, si) => !dropped.has(`${pi}:${si}`))));
  if (out.length > limit) out = out.slice(0, limit - 1).replace(/\s+\S*$/, '') + '.';
  return out;
}

function flag(check, label, suggestion, { blocking = false, fix = null } = {}) {
  return { check, label, result: 'flag', blocking, suggestion, fix };
}
const pass = (check, label) => ({ check, label, result: 'pass', blocking: false, suggestion: '', fix: null });

function languageChecks(text, field, terms, { graphicLabel = 'No scare tactics or graphic content' } = {}) {
  const hits = findBannedTerms(text, terms);
  const graphic = hits.filter((h) => h.category === 'graphic');
  const stigma = hits.filter((h) => h.category === 'stigma');
  const slang = hits.filter((h) => h.category === 'slang');
  const out = [];
  out.push(graphic.length
    ? flag('no_graphic', graphicLabel, `Remove: ${graphic.map((h) => `"${h.term}"`).join(', ')}. Keep the tone about preparedness, not fear.`, { blocking: true })
    : pass('no_graphic', graphicLabel));
  out.push(stigma.length
    ? flag('person_first', 'Person-first, stigma-free language', `Replace ${stigma.map((h) => `"${h.term}" with "${h.replace}"`).join('; ')}.`, { blocking: true, fix: { field, text: replaceTerms(text, stigma) } })
    : pass('person_first', 'Person-first, stigma-free language'));
  if (slang.length) out.push(flag('no_slang', 'No drug slang', `Platforms moderate harm-reduction posts. Use plain terms: ${slang.map((h) => `"${h.term}" → "${h.replace}"`).join('; ')}.`, { fix: { field, text: replaceTerms(text, slang) } }));
  out.push(YOUTH_AS_MEDICAL.test(text)
    ? flag('youth_not_medical', 'Youth not presented as medical providers', 'Describe young people as trained community responders. Hope Responders are not medical providers.', { blocking: true })
    : pass('youth_not_medical', 'Youth not presented as medical providers'));
  return out;
}

// ---------------------------------------------------------------------------
// Sources for citation checks

function citedTexts(store, citations = []) {
  const texts = [];
  for (const c of citations || []) {
    if (c.type === 'fact') {
      const f = store.get('facts', c.id) || store.find('facts', (x) => x.key === c.key);
      if (f) texts.push(`${f.value} ${f.statement || ''}`);
    } else if (c.type === 'chunk') {
      const ch = store.get('chunks', c.id);
      if (ch) texts.push(ch.text);
    } else if (c.type === 'calc') {
      texts.push(`${c.result} ${c.expr}`);
    } else if (c.type === 'input') {
      texts.push(String(c.value));
    }
  }
  return texts;
}

function allFactTexts(store) {
  return store.all('facts').map((f) => `${f.value} ${f.statement || ''}`);
}

function staleFactCheck(store, text, field, citations) {
  const stale = [];
  let fixed = text;
  for (const c of citations || []) {
    if (c.type !== 'fact') continue;
    const f = store.get('facts', c.id) || store.find('facts', (x) => x.key === c.key);
    if (f && c.value !== undefined && String(f.value) !== String(c.value)) {
      stale.push(`${f.label}: was "${c.value}", now "${f.value}"`);
      if (fixed.includes(String(c.value))) fixed = fixed.split(String(c.value)).join(String(f.value));
    }
  }
  if (!stale.length) return pass('current_facts', 'Quotes current facts');
  return flag('current_facts', 'Quotes current facts', `A locked fact changed since this was drafted. ${stale.join('; ')}.`, { blocking: true, fix: fixed !== text ? { field, text: fixed } : null });
}

// ---------------------------------------------------------------------------
// Grant answers

export function reviewAnswerHard(store, answer, { grant, draft }) {
  const settings = store.settings();
  const terms = settings.banned_terms || DEFAULT_BANNED_TERMS;
  const text = answer.text || '';
  const out = [];
  const len = text.length;
  if (answer.limit_chars && len > answer.limit_chars) {
    const trimmed = trimToLimit(text, answer.limit_chars);
    out.push(flag('limit', `Within the ${answer.limit_chars.toLocaleString('en-US')}-character limit`,
      `${len.toLocaleString('en-US')} of ${answer.limit_chars.toLocaleString('en-US')} characters, ${len - answer.limit_chars} over. Suggested fix: ${describeCut(text, trimmed)} That trims ${len - trimmed.length} characters.`,
      { blocking: true, fix: { field: 'text', text: trimmed } }));
  } else {
    out.push(pass('limit', answer.limit_chars ? `Within the ${answer.limit_chars.toLocaleString('en-US')}-character limit` : 'Within limits'));
  }
  const extra = [draft?.request_amount, grant?.amount_min, grant?.amount_max, answer.limit_chars, ...numberTokens(grant?.title || '')].filter(Boolean);
  const missing = unsourcedNumbers(text, [...citedTexts(store, answer.citations), ...allFactTexts(store)], extra);
  out.push(missing.length
    ? flag('sourced', 'Every fact traced to a source', `No source for: ${missing.join(', ')}. Add the source to the knowledge base or remove the number.`, { blocking: true })
    : (!(answer.citations || []).length && text.trim()
      ? flag('sourced', 'Every fact traced to a source', 'This answer cites no sources. Redraft from the knowledge base or add a source.', { blocking: true })
      : pass('sourced', 'Every fact traced to a source')));
  out.push(staleFactCheck(store, text, 'text', answer.citations));
  out.push(...languageChecks(text, 'text', terms).filter((r) => r.result === 'flag'));
  return out;
}

function describeCut(before, after) {
  let i = 0;
  while (i < before.length && before[i] === after[i]) i++;
  let j = 0;
  while (j < before.length - i && before[before.length - 1 - j] === after[after.length - 1 - j]) j++;
  const removed = before.slice(i, before.length - j).trim();
  if (removed && after.length === before.length - (before.length - i - j)) {
    return `cut "${removed.length > 140 ? removed.slice(0, 138) + '…' : removed.replace(/^[,;]\s*/, '')}".`;
  }
  const b = splitSentences(before);
  const a = new Set(splitSentences(after));
  const gone = b.filter((x) => !a.has(x));
  if (!gone.length) return 'shortens clauses.';
  return 'cut ' + gone.slice(0, 2).map((x) => `"${x.length > 90 ? x.slice(0, 88) + '…' : x}"`).join(' and ') + (gone.length > 2 ? ` and ${gone.length - 2} more` : '') + '.';
}

const RUBRIC_HEURISTICS = [
  { match: /population/i, test: (t) => /\b(young people|youth|teens?|teenagers|young adults|students|aged \d+|ages \d+)\b/i.test(t) },
  { match: /local evidence|local data|community data/i, test: (t) => /\b(parish|louisiana|baton rouge|capital region|west feliciana|zachary|port allen|brusly|st\. francisville)\b/i.test(t) },
  { match: /budget|request/i, test: (t, ctx) => (ctx.request && t.includes(Number(ctx.request).toLocaleString('en-US'))) || /\$\d/.test(t) && /\bper (dose|kit|person|training)\b/i.test(t) },
];

export function evaluateRubricOffline(criteria, draftText, { request, answersReview }) {
  return criteria.map((c) => {
    if (/traced|source/i.test(c)) {
      const bad = answersReview.some((r) => r.check === 'sourced' && r.result === 'flag');
      return { check: c, met: !bad, suggestion: bad ? 'Resolve the unsourced numbers flagged on each answer.' : '' };
    }
    if (/limit/i.test(c)) {
      const bad = answersReview.some((r) => r.check === 'limit' && r.result === 'flag');
      return { check: c, met: !bad, suggestion: bad ? 'Apply the suggested cut on answers over their limit.' : '' };
    }
    const h = RUBRIC_HEURISTICS.find((x) => x.match.test(c));
    if (h) {
      const met = h.test(draftText, { request });
      return { check: c, met, suggestion: met ? '' : `Add a sentence that addresses: ${c.toLowerCase()}.` };
    }
    const words = [...new Set(tokenize(c))];
    const have = new Set(tokenize(draftText));
    const hit = words.filter((w) => have.has(w)).length;
    const met = words.length ? hit / words.length >= 0.5 : true;
    return { check: c, met, suggestion: met ? '' : `The draft doesn't clearly address "${c}".` };
  });
}

// ---------------------------------------------------------------------------
// Outreach messages

export function reviewMessageHard(store, message, { prospect, contact, mode }) {
  const settings = store.settings();
  const terms = settings.banned_terms || DEFAULT_BANNED_TERMS;
  const body = message.body || '';
  const out = [];
  out.push(...languageChecks(`${message.subject || ''}\n${body}`, 'body', terms));

  if (prospect?.segment === 'school' && message.kind === 'email') {
    const ok = /\b(district|school)('s)?\s+(naloxone\s+)?polic(y|ies)\b|\bfollow (your|the) (district|school)/i.test(body);
    out.push(ok ? pass('policy', 'Respects school and district policy')
      : flag('policy', 'Respects school and district policy', 'Say that the team follows the district\'s policies.', {
        fix: { field: 'body', text: insertBeforeAsk(body, "We follow your district's policies, and a counselor is present at every assembly.") },
      }));
  }

  const sources = [...citedTexts(store, message.citations), ...allFactTexts(store)];
  // The ask ("20 minutes for a call?") is a request, not a factual claim.
  const claims = body.split(/\n--\n/)[0].split('\n').map((line) => splitSentences(line).filter((s) => !s.trim().endsWith('?')).join(' ')).join('\n');
  const missing = unsourcedNumbers(claims, sources, message.kind === 'script' ? ['1', '2', '3', '4', '5', '20'] : []);
  out.push(missing.length
    ? flag('sourced', 'Every claim traced to the Partner Guide', `No source for: ${missing.join(', ')}.`, { blocking: true })
    : pass('sourced', 'Every claim traced to the Partner Guide'));
  out.push(staleFactCheck(store, body, 'body', message.citations));

  if (message.kind === 'email') {
    const q = questionCount(body);
    out.push(q === 1 ? pass('one_ask', 'One clear ask')
      : q === 0 ? flag('one_ask', 'One clear ask', 'End with one question the reader can answer yes to.', {
        fix: { field: 'body', text: insertBeforeSignature(body, 'Would you have 20 minutes for an intro call in the next two weeks?') },
      })
        : flag('one_ask', 'One clear ask', `This email asks ${q} questions. Keep the one that matters most.`));

    const address = (settings.mailing_address || '').trim();
    const hasAddress = address && body.includes(address);
    const hasOptOut = OPT_OUT.test(body);
    out.push(hasAddress && hasOptOut ? pass('can_spam', 'CAN-SPAM footer: mailing address and opt-out')
      : flag('can_spam', 'CAN-SPAM footer: mailing address and opt-out',
        !address ? 'Add the organization\'s mailing address in Settings. Every outreach email must carry it.'
          : `Missing ${[!hasAddress && 'the mailing address', !hasOptOut && 'an opt-out line'].filter(Boolean).join(' and ')}.`,
        { blocking: true, fix: address ? { field: 'body', text: withFooter(body, settings) } : null }));

    const email = (contact?.email || message.to || '').trim();
    const roleText = `${contact?.title || ''} ${contact?.position || ''}`;
    const isStaffRole = /\b(director|coordinator|dean|counselor|advisor|head|lead|officer|staff|teacher|principal|vice principal|assistant principal|administrator|specialist|manager|superintendent|faculty)\b/i.test(roleText);
    const student = !isStaffRole && (/\bstudents?\b|\bpupil\b|\blearner\b/i.test(roleText) || /student/i.test(email));
    out.push(student ? flag('not_student', 'Staff contact, never a student', 'Outreach never contacts students. Pick a staff contact.', { blocking: true })
      : pass('not_student', 'Staff contact, never a student'));

    const suppressed = email && store.find('suppressions', (s) => s.email?.toLowerCase() === email.toLowerCase() || (s.domain && email.toLowerCase().endsWith('@' + s.domain.toLowerCase())));
    if (suppressed) out.push(flag('suppressed', 'Not on the opt-out list', `${email} opted out on ${String(suppressed.created_at).slice(0, 10)}. Don't send.`, { blocking: true }));

    if (!isEmail(email)) {
      out.push(flag('contact', 'Verified staff email', 'Add a public staff email for this contact.', { blocking: true }));
    } else if (!contact?.verified) {
      out.push(flag('contact', 'Verified staff email', `Scout found ${email} but couldn't confirm it belongs to a staff member. Check the source, then mark the contact verified.`, { blocking: true }));
    } else if (mode === 'live' && /@(example\.(org|com|net)|.*\.example)$/i.test(email)) {
      out.push(flag('contact', 'Verified staff email', `${email} is a placeholder address.`, { blocking: true }));
    } else {
      out.push(pass('contact', 'Verified staff email'));
    }
  }
  return out;
}

export function insertBeforeAsk(body, sentence) {
  const paras = body.split(/\n{2,}/);
  const askIdx = paras.findIndex((p) => /\?\s*$/.test(p.trim()) || /\?/.test(p));
  if (askIdx > 0) {
    paras[askIdx] = `${sentence} ${paras[askIdx]}`;
    return paras.join('\n\n');
  }
  return insertBeforeSignature(body, sentence);
}

export function insertBeforeSignature(body, sentence) {
  const paras = body.split(/\n{2,}/);
  const sigIdx = paras.findIndex((p) => /^(Leila Ramos|Cierra Ramos|Thank you|Thanks|Best|Warmly)/.test(p.trim()));
  if (sigIdx > 0) paras.splice(sigIdx, 0, sentence);
  else paras.push(sentence);
  return paras.join('\n\n');
}

export function footerText(settings) {
  const address = (settings.mailing_address || '').trim() || '[Mailing address — set in Settings]';
  return `--\nHope Resuscitated · ${address}\nYou're receiving this because you work with young people in the Capital Region. If you'd rather not hear from us, reply "stop" and we won't email you again.`;
}

export function withFooter(body, settings) {
  const main = String(body || '').split(/\n--\n/)[0].trimEnd();
  return `${main}\n\n${footerText(settings)}`;
}

// ---------------------------------------------------------------------------
// Social posts

export function reviewPostHard(store, post, { media }) {
  const settings = store.settings();
  const terms = settings.banned_terms || DEFAULT_BANNED_TERMS;
  const out = [];
  const captions = [
    ['caption_ig', post.caption_ig || '', post.platforms?.includes('instagram')],
    ['caption_fb', post.caption_fb || '', post.platforms?.includes('facebook')],
  ].filter(([, , on]) => on);
  const all = captions.map(([, t]) => t).join('\n');

  // "Call 911" first in response content: the first instruction step must be calling 911.
  let first911 = pass('call_911_first', '"Call 911" comes first');
  for (const [field, text] of captions) {
    if (!callsFirst(text)) {
      first911 = flag('call_911_first', '"Call 911" comes first', 'Response steps must start with calling 911.', {
        blocking: true, fix: { field, text: `Call 911 first, every time.\n\n${text}` },
      });
      break;
    }
  }
  out.push(first911);

  out.push(...languageChecks(all, captions[0]?.[0] || 'caption_ig', terms, { graphicLabel: 'No graphic content or scare tactics' }));

  out.push((post.alt_text || '').trim().length >= 8 ? pass('alt_text', 'Alt text written')
    : flag('alt_text', 'Alt text written', 'Describe the image for people using screen readers.', {
      blocking: true, fix: media ? { field: 'alt_text', text: defaultAltText(media) } : null,
    }));

  const ig = captions.find(([f]) => f === 'caption_ig');
  const fb = captions.find(([f]) => f === 'caption_fb');
  const igLen = ig ? ig[1].length : 0;
  const tags = ig ? countHashtags(ig[1]) : 0;
  const tooLong = (ig && igLen > IG_CAPTION_LIMIT) || (fb && fb[1].length > FB_CAPTION_LIMIT) || tags > IG_HASHTAG_LIMIT;
  out.push(tooLong ? flag('length', 'Fits IG and FB length limits',
    `Instagram allows ${IG_CAPTION_LIMIT.toLocaleString('en-US')} characters and ${IG_HASHTAG_LIMIT} hashtags. This caption has ${igLen.toLocaleString('en-US')} characters and ${tags} hashtags.`, { blocking: true })
    : pass('length', 'Fits IG and FB length limits'));

  if (!captions.length) out.push(flag('platforms', 'Posts to at least one platform', 'Choose Instagram, Facebook or both.', { blocking: true }));

  if (PERSONAL_TOPIC.test(all) && !/\b988\b/.test(all)) {
    const [field, text] = captions[0] || ['caption_ig', ''];
    out.push(flag('lifeline', '988 Lifeline where the topic is personal', 'This post touches on loss or personal struggle. Point people to support.', {
      blocking: true, fix: { field, text: `${text}\n\nIf this topic is personal for you, call or text 988 to reach the Suicide & Crisis Lifeline, any time.` },
    }));
  }

  if (media) {
    const people = media.people_in_frame;
    if ((people === true || people === null || people === undefined) && !media.consent_confirmed) {
      out.push(flag('consent', 'People in frame: permission?',
        people === true
          ? `${media.people_note || 'People are visible in this ' + (media.kind === 'video' ? 'clip' : 'photo') + '.'} Confirm you have a signed release, or swap to media without people.`
          : 'The agent could not rule out people in this media. Confirm there are none, or confirm you have a signed release.',
        { blocking: true }));
    } else {
      out.push(pass('consent', people ? 'People in frame: release on file' : 'No people in frame'));
    }
    if (post.reused_recently) out.push(flag('reuse', 'Media not reused within 60 days', 'This media posted in the last 60 days. That is fine for a planned repeat; otherwise swap it.'));
  } else {
    out.push(flag('media', 'Media attached', 'Pick a photo or video for this slot.', { blocking: true }));
  }

  const missing = unsourcedNumbers(all, [...citedTexts(store, post.citations), ...allFactTexts(store)], []);
  if (missing.length) out.push(flag('sourced', 'Every claim traced to a source', `No source for: ${missing.join(', ')}.`, { blocking: true }));
  out.push(staleFactCheck(store, all, captions[0]?.[0] || 'caption_ig', post.citations));
  return out;
}

export function defaultAltText(media) {
  const subject = media.subject || media.label || 'Hope Resuscitated';
  return media.kind === 'video'
    ? `Video: ${subject}.`
    : `Photo: ${subject}.`;
}

// ---------------------------------------------------------------------------
// Rubric judge (Claude)

export async function judgeWithClaude(ctx, { kind, text, criteria, context = '' }) {
  if (!ctx.llm?.available) return null;
  const out = await ctx.llm.json({
    purpose: 'review',
    run: ctx.run,
    system: `You are the Reviewer for Hope Resuscitated, a youth-led overdose prevention nonprofit in Louisiana. Score the ${kind} against each criterion. Be strict and specific. For every unmet criterion, give one concrete fix the writer can apply in under a minute. Our Commitments: "call 911" comes first in response content; no scare tactics or graphic content; person-first, stigma-free language; young people are never described as medical providers; point people to the 988 Lifeline when the topic is personal; follow school and district policy.`,
    prompt: `${context ? context + '\n\n' : ''}Criteria:\n${criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\n${kind}:\n"""\n${text}\n"""`,
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { check: { type: 'string' }, met: { type: 'boolean' }, suggestion: { type: 'string' } },
            required: ['check', 'met', 'suggestion'],
            additionalProperties: false,
          },
        },
        polish: { type: 'string' },
      },
      required: ['items', 'polish'],
      additionalProperties: false,
    },
  });
  return out;
}

export const COMMITMENT_RUBRIC = [
  'Warm, plain, hopeful brand voice ("Turn hope into action"); no fear or lecture tone',
  'Treats naloxone as normal emergency equipment, like an AED or EpiPen',
  'Accurate to the Partner Guide; promises nothing it does not offer',
];

export { DEFAULT_GRANT_RUBRIC };

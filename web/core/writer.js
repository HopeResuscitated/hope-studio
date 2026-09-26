// Offline Writer. When no Claude API key is configured, the agents draft from
// these templates, which only quote locked facts and Partner Guide chunks.
// With a key, the agents call Claude and fall back here on any failure.

import { factStatement, factCitation, factValue, search, chunkCitation } from './kb.js';
import { trimToLimit, footerText } from './reviewer.js';
import { OFFERINGS } from './schema.js';
import { money, splitSentences } from './util.js';

function cites(store, keys) {
  return keys.map((k) => factCitation(store, k)).filter(Boolean);
}

function chunkCites(store, query, collection = null, k = 1) {
  return search(store, query, { collection, k }).map(chunkCitation);
}

const f = (store, key) => factStatement(store, key) || '';

// ---------------------------------------------------------------------------
// Grants

export function questionKind(q) {
  const s = `${q.key || ''} ${q.question || ''} ${q.prompt || ''}`.toLowerCase();
  if (/background|organi[sz]ation|history|about (your|the) org|capacity/.test(s)) return 'background';
  if (/need|problem|issue|why/.test(s)) return 'need';
  if (/budget|cost|funds|expenses|spend/.test(s)) return 'budget';
  if (/evaluat|measure|outcome|metric|impact|result/.test(s)) return 'evaluation';
  if (/sustain|future|beyond the grant/.test(s)) return 'sustainability';
  if (/program|design|activit|approach|project|plan|method/.test(s)) return 'program';
  return 'generic';
}

export function draftGrantAnswer(store, q, { grant, draft }) {
  const kind = questionKind(q);
  const area = factValue(store, 'service_area') || 'the Capital Region';
  let text = '';
  let citations = [];
  const title = grant?.title || 'this project';

  if (kind === 'background') {
    text = [
      f(store, 'mission'),
      f(store, 'founder'),
      `Hope Resuscitated is a youth-led ${factValue(store, 'status') || '501(c)(3)'} nonprofit based in ${factValue(store, 'based_in')} (EIN ${factValue(store, 'ein')}), serving ${area}.`,
      f(store, 'access_points'),
      'Young people design, lead and teach our programs, and we are launching the Hope Responder Corps™, a youth leadership and training program, with founding partner schools for 2026–27.',
      `Certifications: ${factValue(store, 'certifications')}.`,
    ].join(' ');
    citations = [...cites(store, ['mission', 'founder', 'status', 'based_in', 'ein', 'service_area', 'access_points', 'certifications']), ...chunkCites(store, 'Hope Responder Corps founding partner schools 2026–27 pilot')];
  } else if (kind === 'need') {
    text = [
      'Young people in the Baton Rouge region are often one prepared bystander away from surviving an overdose.',
      f(store, 'founder'),
      f(store, 'mission'),
      '',
      f(store, 'access_points'),
      f(store, 'first_week_doses'),
      f(store, 'dose_total'),
    ].join(' ').replace(/\s{2,}/g, '\n\n');
    citations = cites(store, ['founder', 'mission', 'access_points', 'first_week_doses', 'dose_total']);
  } else if (kind === 'program') {
    text = [
      `With support for ${title}, Hope Resuscitated will expand three connected programs.`,
      `Access: ${f(store, 'access_points')} QR codes on every box link to the Overdose Partner app.`,
      'Training: Hope Responder Training is small-group and hands-on. Participants learn to recognize an overdose, call 911, use naloxone nasal spray, give rescue breaths and use the recovery position, and they practice person-first language. Each participant practices with a training device.',
      'Leadership: the Hope Responder Corps™ gives trained students service roles and a five-level leadership path, from Hope Responder to Hope Responder Fellow.',
      f(store, 'app'),
      'Every session follows school and district policy, keeps an adult lead present, and teaches calling 911 as the first step.',
    ].join(' ');
    citations = [...cites(store, ['access_points', 'app']), ...chunkCites(store, 'Hope Responder Training hands-on recognizing overdose calling 911 naloxone training device'), ...chunkCites(store, 'Hope Responder pathway five leadership levels Fellow')];
  } else if (kind === 'budget') {
    const req = draft?.request_amount || grant?.amount_max || null;
    const per1000 = Math.floor(1000 / 59);
    text = [
      req ? `We request ${money(req)} for ${title}.` : `This request supports ${title}.`,
      f(store, 'dose_total'),
      `At $59 per dose delivered, every $1,000 places about ${per1000} doses in our free access points.`,
      'Funds also cover training devices and printed, QR-linked materials for Hope Responder Training.',
      'Line-item detail is in the attached project budget.',
    ].join(' ');
    citations = [...cites(store, ['dose_total', 'dose_cost', 'dose_shipping']), { type: 'calc', expr: '1000 / 59', result: String(per1000), label: 'Doses per $1,000' }];
    if (req) citations.push({ type: 'input', value: req, label: 'Request amount' });
  } else if (kind === 'evaluation') {
    text = [
      'Participants in every training complete a short, anonymous assessment before and after, measuring overdose-response knowledge and confidence to recognize an overdose and respond. We collect no names or personal information.',
      'We will report the number of students, staff and community members trained; the change in knowledge; the change in confidence; Corps leadership and service activity; and engagement with QR codes and the Overdose Partner app.',
      'Each partner receives an impact summary, and the results guide next steps with them.',
    ].join(' ');
    citations = chunkCites(store, 'anonymous assessment before and after training summary report knowledge confidence');
  } else if (kind === 'sustainability') {
    text = [
      'Hope Resuscitated grows through partners who share the cost of being prepared.',
      'Local businesses can sponsor an access point for a year, Hope Community Partners fund Hope Kits or host events, and schools build Hope Responder Corps chapters that keep training going each year.',
      f(store, 'seed_funding'),
    ].join(' ');
    citations = [...cites(store, ['seed_funding']), ...chunkCites(store, 'Sponsor an access point Hope Community Partner fund Hope Kits')];
  } else {
    const hits = search(store, `${q.question} ${q.prompt || ''}`, { collection: 'grants', k: 3 });
    const sentences = hits.flatMap((h) => splitSentences(h.chunk.text)).slice(0, 5);
    text = sentences.join(' ') || 'The knowledge base has nothing on this question yet. Add a source, then redraft.';
    citations = hits.map(chunkCitation);
  }

  if (q.limit_chars && text.length > q.limit_chars) text = trimToLimit(text, q.limit_chars);
  return { text: text.trim(), citations: dedupe(citations) };
}

function dedupe(citations) {
  const seen = new Set();
  return citations.filter((c) => {
    const k = `${c.type}:${c.id || c.expr || c.value}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Parse pasted RFP text into questions with character limits.
export function parseRfp(text) {
  const lines = String(text || '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    const m = line.match(/^(?:Q(?:uestion)?\s*)?(\d+)[.):]\s*(.+)$/i);
    if (!m) {
      if (out.length && !/^\d/.test(line) && line.length < 400) out[out.length - 1].prompt += ` ${line}`;
      continue;
    }
    let body = m[2];
    let limit = null;
    const lim = body.match(/\(?\s*(?:max(?:imum)?\.?\s*|limit(?:ed)? to\s*|up to\s*)?([\d,]+)\s*(characters|chars|character|words)(?:\s*max(?:imum)?)?\s*\)?/i);
    if (lim) {
      const n = parseInt(lim[1].replace(/,/g, ''), 10);
      limit = /word/i.test(lim[2]) ? Math.round(n * 6) : n;
      body = body.replace(lim[0], '').trim();
    }
    const [question, ...rest] = body.split(/[:–—-]\s+|\?\s+/);
    out.push({ key: `q${m[1]}`, question: (question || body).replace(/[.:]$/, '').trim(), prompt: rest.join(' ').trim() || body, limit: limit || 1000 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Outreach

function signature(settings) {
  const s = settings.sender || {};
  return [s.name || 'Leila Ramos', s.title || 'Founder & Youth Director, Hope Resuscitated', s.email || 'Team@hope-resuscitated.org'].join('\n');
}

const ROLE_WORD = { school: 'counselor', faith: 'youth pastor', youth: 'youth leader', library: 'branch manager', agency: 'program lead', business: 'owner' };

export function contactRole(prospect, contact) {
  return (contact?.title || ROLE_WORD[prospect.segment] || 'team').toLowerCase();
}

export function draftSequence(store, prospect, contact, settings) {
  const first = (contact?.name || '').replace(/^\[|\]$/g, '').split(/\s+/)[0] || `[${contactRole(prospect, contact)} name]`;
  const greetingName = contact?.name && !/^\[/.test(contact.name) ? first : `[${contactRole(prospect, contact).replace(/^\w/, (c) => c.toUpperCase())} name]`;
  const name = prospect.name;
  const sig = signature(settings);
  const note = prospect.reason ? prospect.reason.replace(/^Why:\s*/i, '') : '';
  const offers = (prospect.offerings || []).map((k) => OFFERINGS[k]?.label).filter(Boolean);
  const intro = `I'm ${(settings.sender?.name || 'Leila Ramos')}, founder of Hope Resuscitated, a youth-led overdose prevention nonprofit here in the Capital Region.`;
  let subject;
  let body;
  let followSubject;
  let followBody;
  let citations = [];

  if (prospect.segment === 'school') {
    subject = `Helping ${name} put its naloxone policy into practice`;
    body = [
      `Hi ${greetingName},`,
      `${intro} Since Act 378 of 2024, every Louisiana K–12 school has a naloxone policy. We help schools put that policy into practice.`,
      'Our Hope Responder Assembly runs 30–40 minutes and isn\'t a scare-tactic lecture. Students learn the signs of an opioid overdose, see a naloxone demonstration with a training device, and hear how they can become trained Hope Responders. A counselor is present, and we follow your district\'s policies.',
      'We\'re enrolling founding partner schools for the 2026–27 Hope Responder Corps pilot. Would you have 20 minutes for an intro call in the next two weeks?',
      sig,
    ].join('\n\n');
    followSubject = `Re: ${subject}`;
    followBody = [
      `Hi ${greetingName},`,
      'Following up on my note last week. If an assembly is too much for this semester, we also run a short Family & Staff Night for parents, guardians and staff on recognizing an overdose, using naloxone, and talking with young people about it without fear or shame.',
      'Would either option help your school this year?',
      sig,
    ].join('\n\n');
    citations = [...cites(store, ['act_378']), ...chunkCites(store, 'Hope Responder Assembly 30–40 min recruitment-style assembly counselor present'), ...chunkCites(store, 'founding partner schools 2026–27 pilot Corps chapter')];
  } else if (prospect.segment === 'faith' || prospect.segment === 'youth') {
    subject = `Hope Responder training for ${name}`;
    body = [
      `Hi ${greetingName},`,
      intro,
      'We\'d love to bring our hands-on Hope Responder Training to your group. In one session, young people learn to recognize an overdose, call 911, use naloxone nasal spray, and support someone until help arrives. Everyone practices with a training device, and an adult lead is always present.',
      'Many groups pair it with a Purpose Project, a build day where young people, business owners and first responders build access point stands or pack Hope Kits together.',
      'Could we find 20 minutes to talk about what would fit your group?',
      sig,
    ].join('\n\n');
    followSubject = `Re: ${subject}`;
    followBody = [
      `Hi ${greetingName},`,
      'Circling back on Hope Responder Training for your group. We can also start smaller, with a short session for your adult volunteers first.',
      'Would a quick call next week work?',
      sig,
    ].join('\n\n');
    citations = [...chunkCites(store, 'Group training youth group congregation community center'), ...chunkCites(store, 'Purpose Projects build days access point stands Hope Kits')];
  } else if (prospect.segment === 'business') {
    subject = `Becoming a Hope Safe Space at ${name}`;
    body = [
      `Hi ${greetingName},`,
      intro,
      'We\'re not asking you to become a treatment center. We\'re asking you to be prepared for an emergency, the same way you keep a fire extinguisher and a first aid kit.',
      'As a Hope Safe Space, you host an indoor naloxone box and a window decal, and your staff complete a 10-minute orientation. We provide the box, the decal, the orientation and a listing on our partner map.',
      'Would you be open to a short call about joining?',
      sig,
    ].join('\n\n');
    followSubject = `Re: ${subject}`;
    followBody = [
      `Hi ${greetingName},`,
      'A lighter way to start: as a Hope Friend, you display a QR resource placard and we list you on our partner map.',
      'Would that be a good first step for your team?',
      sig,
    ].join('\n\n');
    citations = chunkCites(store, 'Hope Safe Spaces Hope Friend placard indoor naloxone box window decal 10-minute orientation');
  } else {
    subject = `Partnering with ${name} on naloxone access`;
    body = [
      `Hi ${greetingName},`,
      `${intro} ${f(store, 'access_points')}`,
      'As a Hope Community Partner, your team could sponsor an access point, host a training or fund Hope Kits. Partners receive recognition at events, an impact summary and co-branded materials.',
      'Would you have 20 minutes to talk about what fits your team?',
      sig,
    ].join('\n\n');
    followSubject = `Re: ${subject}`;
    followBody = [
      `Hi ${greetingName},`,
      'Following up on a Hope Community Partner conversation. We can also bring a 10-minute staff orientation to your team first.',
      'Would that help?',
      sig,
    ].join('\n\n');
    citations = [...cites(store, ['access_points']), ...chunkCites(store, 'Hope Community Partner sponsor an access point host an event fund Hope Kits')];
  }

  const script = [
    `Intro call · ${name}`,
    `Goal: learn what ${name} needs and agree on a next step.`,
    '1. Thank them, introduce Hope Resuscitated in two sentences, and say calling 911 is always the first step we teach.',
    `2. Ask what they already have in place${prospect.segment === 'school' ? ' for their Act 378 naloxone policy' : ''} and who else should be involved.`,
    `3. Walk through the offerings that fit: ${offers.join(', ') || 'the Partner Guide offerings'}.`,
    `4. Ask about approvals and scheduling${prospect.segment === 'school' ? ', including any parent notice the district requires' : ''}.`,
    '5. Agree on one next step and a date. Mention the anonymous pre/post survey and the impact summary they will receive.',
    note ? `Scout note: ${note}` : '',
  ].filter(Boolean).join('\n');

  return {
    steps: [
      { sequence_step: 1, kind: 'email', subject, body: `${body}\n\n${footerText(settings)}`, citations: dedupe(citations) },
      { sequence_step: 2, kind: 'email', subject: followSubject, body: `${followBody}\n\n${footerText(settings)}`, citations: dedupe(citations) },
      { sequence_step: 3, kind: 'script', subject: `Intro-call script · ${name}`, body: script, citations: dedupe(citations) },
    ],
  };
}

export function offeringsFor(prospect) {
  return prospect.offerings || [];
}

// ---------------------------------------------------------------------------
// Social

const BASE_TAGS = ['#NoStigmaNoBarriersJustHope', '#NaloxoneSavesLives', '#Louisiana'];

function captionFor(store, media, variant = 0, topic = '') {
  const pillar = media.pillar;
  const subject = `${topic || ''} ${media.subject || ''} ${media.label || ''}`.toLowerCase();
  const tags = [...BASE_TAGS];
  let ig;
  let fb;
  let citations = [];
  let title = media.label;

  if (pillar === 'Equip' && /app/.test(subject)) {
    title = 'Overdose Partner app tour';
    ig = [
      'Meet the Overdose Partner app: instructional videos, an overdose response timer and emergency prompts, in your pocket.',
      'It never replaces calling 911. It helps you stay calm and do the next right thing until help arrives.',
      'Free for iOS and Android. Link in bio.',
    ];
    citations = cites(store, ['app']);
  } else if (pillar === 'Equip' && /breath|manikin|cpr/.test(subject)) {
    title = 'Rescue breathing basics';
    ig = ['Rescue breathing is part of every Hope Responder Training.', 'In an overdose, call 911 first. Then give naloxone if you have it, and support their breathing until help arrives.', 'Each participant practices hands-on with a training device. Book a session for your group: Team@hope-resuscitated.org'];
    citations = [...cites(store, ['email']), ...chunkCites(store, 'Hope Responder Training rescue breathing recovery position training device')];
  } else if (pillar === 'Equip') {
    title = 'How to use naloxone';
    ig = variant % 2 === 0
      ? ['Here\'s how to use naloxone nasal spray in an opioid overdose:', '1. Call 911.\n2. Spray naloxone into one nostril.\n3. Support their breathing and stay with them until help arrives.', `${f(store, 'access_points').replace(/^Hope Resuscitated operates/, 'Our')}`.replace(/\.$/, '') + ' mean anyone can pick it up. Louisiana law protects people who give naloxone in good faith.', 'Practice with the Overdose Partner app. Link in bio.']
      : ['Three steps anyone can learn:', '1. Call 911.\n2. Give naloxone nasal spray.\n3. Stay with them and support their breathing until help arrives.', 'Louisiana law protects people who give naloxone in good faith, and there\'s no age limit to carry it.', 'Want hands-on practice? Ask us about Hope Responder Training.'];
    citations = cites(store, ['access_points', 'good_faith', 'rs_40_978_2', 'app']);
  } else if (pillar === 'Educate') {
    ig = variant % 2 === 0
      ? ['Naloxone is emergency equipment, just like an AED or an EpiPen.', `${f(store, 'access_points')}`, 'Louisiana law sets no age limit for having naloxone, and the nasal spray is sold over the counter. In an emergency, always call 911 first.']
      : ['Did you know? Any person in Louisiana may lawfully carry naloxone. There is no age limit.', 'You can find it free, 24/7, at our library access points.', 'Call 911 first, every time.'];
    citations = cites(store, ['access_points', 'rs_40_978_2', 'otc']);
  } else if (pillar === 'Empower') {
    ig = variant % 2 === 0
      ? ['Young people are part of the response.', `${media.label}: when youth, business owners and first responders work side by side, being prepared becomes normal.`, 'Want to host a Purpose Project build day? Email Team@hope-resuscitated.org.']
      : ['This is what preparedness looks like in the Capital Region.', 'Every Hope Kit packed and every stand built puts naloxone closer to someone who may need it.', 'Get involved: hope-resuscitated.org'];
    tags.push('#HopeResponder');
    citations = [...cites(store, ['email', 'website']), ...chunkCites(store, 'Purpose Projects build days')];
  } else if (pillar === 'Respond') {
    title = 'Call 911 first, every time';
    ig = variant % 2 === 0
      ? ['Call 911 first, every time.', 'Then give naloxone if you have it, support their breathing, and stay with them until help arrives. Hope Responder Training covers rescue breathing and the recovery position hands-on.', 'Louisiana law protects people who help in good faith.']
      : ['If you see the signs of an overdose, call 911 first and give your location.', 'Then stay with them. Rescue breathing and the recovery position are part of every Hope Responder Training.', 'Book a session for your group: Team@hope-resuscitated.org'];
    citations = cites(store, ['good_faith', 'email']);
  } else {
    if (/corps|school|founding/.test(subject)) {
      title = 'Hope Responder Corps: founding schools wanted';
      ig = ['Hope Responder Corps™: we\'re enrolling founding partner schools for the 2026–27 pilot.', 'Trained students take on service roles and can grow through five leadership levels, from Hope Responder to Hope Responder Fellow.', 'Know a school that should join? Visit hope-resuscitated.org.'];
      citations = [...cites(store, ['website']), ...chunkCites(store, 'Hope Responder Corps chapter founding partners 2026–27 pilot five leadership levels')];
    } else if (/thank|partner|library/.test(subject)) {
      title = 'Thank you, library partners';
      ig = ['Thank you to the library partners who host our free, 24/7 naloxone access points.', `${f(store, 'first_week_doses')}`, 'Partnerships like these make being prepared normal.'];
      citations = cites(store, ['first_week_doses', 'access_points']);
    } else {
      ig = [`${factValue(store, 'motto') || 'NO Stigma. NO Barriers. Just HOPE.'}`, 'Hope Resuscitated is youth-led: young people design, lead and teach our programs.', 'Turn hope into action at hope-resuscitated.org.'];
      citations = [...cites(store, ['motto', 'website']), ...chunkCites(store, 'Youth-led young people design, lead and teach')];
    }
    tags.push('#HopeResponder');
  }

  const igText = `${ig.join('\n\n')}\n\n${tags.join(' ')}`;
  fb = `${ig.join('\n\n').replace(/Link in bio\.?/g, 'Learn more at hope-resuscitated.org.')}\n\n${tags.slice(0, 3).join(' ')}`;
  return { title, caption_ig: igText, caption_fb: fb, citations: dedupe(citations) };
}

export function draftPostCopy(store, media, { variant = 0, topic = '' } = {}) {
  const c = captionFor(store, media, variant, topic);
  const alt = media.alt_hint || (media.kind === 'video'
    ? `Video: ${media.subject || media.label}.`
    : `Photo: ${media.subject || media.label}.`);
  return { ...c, alt_text: alt };
}

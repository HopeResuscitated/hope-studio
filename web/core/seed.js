// First-run data. The knowledge base and facts come from Hope Resuscitated's
// own documents (Partner Guide 2026–27, the grant drafts and the build sheet).
// Everything marked `sample: true` mirrors the design canvases so the studios
// open in a working state; clear it in Settings before going live.
//
// Seeding never approves anything: sample items stop at "Needs your OK".

import { ingestDocument } from './kb.js';
import { DEFAULT_SLOT_PLAN } from './schema.js';
import { DEFAULT_BANNED_TERMS } from './reviewer.js';
import { central, centralToDate, monthKey, addMonths, parseMonth, daysInMonth, weekdayOf, DAY_MS } from './util.js';
import { upsertGrant, filterGrant, sendToWriter, reviewDraft } from './agents/grant.js';
import { addProspect, draftOutreach, addPartner } from './agents/outreach.js';
import { ingestMedia, createPost } from './agents/social.js';

// The statement of need exactly as drafted on the Grant Studio canvas: 868 of 800.
const CANVAS_NEED = `Young people in the Baton Rouge region are often one prepared bystander away from surviving an overdose. Hope Resuscitated was founded by Leila Ramos at age 15, after she lost five family members to overdose, including her 19-year-old cousin, Benji. Our mission is to educate and empower teenagers and young adults about overdose prevention while completely removing the barriers and stigma associated with accessing life-saving overdose reversal medication.

Today we operate five free, 24/7 Narcan access stations through library partnerships in West Feliciana, Zachary, North Baton Rouge, Port Allen and Brusly. In the first week at the West Feliciana Parish Library, the community took more than 40 doses. Each dose costs about $50, plus $9 for shipping and specialized packaging, so every $59 puts one more reversal kit within reach of a teenager who may need it.`;

// ---------------------------------------------------------------------------
// Knowledge base documents

const PARTNER_GUIDE = {
  'Who we are and our approach': `## Who we are
Hope Resuscitated is a youth-led overdose prevention and community response organization in Louisiana. We don't just teach young people about overdose. We prepare them to become trained, confident community responders, and we're looking for schools and organizations to build this with us.

Hope Resuscitated began when a young Louisianan turned a family loss into a mission: making sure the people around her were ready to save a life. Today it is a youth-led nonprofit focused on overdose prevention, access to naloxone (the nasal spray sold as Narcan), and training young people to respond.

We already run 5 free naloxone access points, most hosted by public libraries in the Capital Region. Now we're launching the Hope Responder Corps™, a youth leadership and training program, and inviting schools and community organizations to join us as founding partners.

Any age can learn to recognize an overdose and use naloxone. Youth-led: young people design, lead and teach.

## Our approach
Not a lecture. A role. Most drug prevention programs tell students what not to do. We give them something to do. Think of a lifeguard: trained, certified, working within clear rules, and trusted with real responsibility because of that training. We treat naloxone the way communities already treat an AED or an EpiPen: normal, visible emergency equipment that ordinary people are ready to use.

Students are trained responders with a path to leadership, not an audience. The tone is preparedness, dignity and purpose, not fear and warnings. Students leave with a skill they practiced and an invitation to lead, not a handout. Success means measured gains in knowledge and confidence, not attendance.

Our approach: Educate, Equip, Empower, Respond, Lead.`,

  'Offerings for schools': `## What we offer schools
Choose one offering or combine them. Everything is scheduled with your administrators and counselors and follows your district's policies.

Hope Responder Assembly (30–40 min). A recruitment-style assembly, not a scare-tactic lecture. Students learn the signs of an opioid overdose, see a naloxone demonstration with a training device, and hear how to become a Hope Responder. A counselor is present, and students get a clear way to find support if the topic is personal.

Hope Responder Training (hands-on). Small-group, hands-on training: recognizing an overdose, calling 911, using naloxone nasal spray, rescue breathing and the recovery position, and person-first language that reduces stigma. Each participant practices with a training device. Students take a short anonymous assessment before and after.

Hope Responder Corps™ chapter (founding partners, pilot). A student leadership group at your school. Trained students take on service roles, help with outreach events and can progress through five leadership levels. We are enrolling founding partner schools for the 2026–27 pilot.

Act 378 support: naloxone policy in practice. Your school is required to have a naloxone policy. We can support it with staff awareness sessions, student education and QR-linked signage consistent with the policy your district adopts.

Family & staff nights (evening session). A short session for parents, guardians and staff on recognizing an overdose, using naloxone, and talking with young people about it without fear or shame.

What we ask of partner schools: a staff contact or club sponsor; a counselor present at assemblies; any approvals or parent notices your district requires; a space and time for training sessions.`,

  'Organizations and businesses': `## For organizations and businesses
Be prepared for an emergency. Youth groups, faith communities, libraries, agencies and local businesses all have a part to play.

Our ask: "We're not asking you to become a treatment center. We're asking you to be prepared for an emergency, the same way you keep a fire extinguisher and a first aid kit."

## Hope Safe Spaces™
Hope Friend: you commit to display a QR resource placard. We provide the placard and a listing on our partner map.

Hope Safe Space: you host an indoor naloxone box, display the window decal, and have staff complete a 10-minute orientation. We provide the box, decal, staff orientation and map listing.

Hope Community Partner: all of the above, plus sponsor an access point, host an event or fund Hope Kits. We provide recognition at events, an impact summary and co-branded materials.

Staff orientation (10 minutes): signs of an overdose, calling 911 and giving your location, a naloxone demonstration, rescue breathing and the recovery position, and where your box is kept.

Group training (youth groups and faith communities): the same hands-on Hope Responder training, brought to your youth group, congregation or community center.

Purpose Projects (community): build days where young people, business owners and first responders build and paint access point stands or pack Hope Kits, with a short naloxone training included.

Sponsor an access point: fund a year of naloxone for a public access point in your community. Sponsors are recognized on-site and in our impact reports.`,

  'Common questions': `## Common questions
Is this drug education? It's emergency-response training. Like CPR, it prepares people to help in a medical emergency. It doesn't include graphic content or scare tactics.

Is naloxone safe? Naloxone reverses the effects of an opioid overdose. It is sold over the counter, and the nasal spray is designed for use by people without medical training. Calling 911 is always part of the response.

How young can students be? Louisiana law sets no age limit for having naloxone, so anyone can learn. We adapt the content for each age group and follow your school's guidance on grade levels.

Do students need parent permission? We follow your district's policy. If parent notice or permission is required, we'll provide the materials.

Will you ask students about drug use? No. Our assessments measure knowledge and confidence only, and they're anonymous.

What does it cost? Contact us to talk about costs and scheduling. Sponsors help us cover training materials.

Contact: Team@hope-resuscitated.org · hope-resuscitated.org`,

  'Measuring impact and how to partner': `## Measuring impact
Participants complete a short, anonymous assessment before and after training. After each partnership we send you a summary report showing: how many students, staff or community members were trained; change in overdose-response knowledge; change in confidence to recognize an overdose and respond; student leadership and service activity (Corps chapters); engagement with QR codes and the Overdose Partner app.

## How to partner: five steps
1. Intro call. We learn about your school or organization and what you need.
2. Choose your offerings. Pick an assembly, training, Corps chapter, Hope Safe Space level or a mix.
3. Approvals and scheduling. We work with your administrators and counselors on any required approvals, then set dates.
4. Delivery. Our team, including trained young people, runs the sessions with an adult lead on site.
5. Impact summary. You receive your results and we plan next steps together.

Programs operate subject to applicable law, school and district policy, and partner requirements. Hope Responders are trained community members, not medical providers. In an emergency, call 911.`,
};

const LAW = {
  'La. R.S. 40:978.2': 'Any person may lawfully possess naloxone. There is no age limit (La. R.S. 40:978.2). Young people can be trained and carry naloxone. A person who gives naloxone in good faith during a suspected overdose is protected from civil and criminal liability (La. R.S. 40:978.2; 14:403.11). Source: https://law.justia.com/codes/louisiana/revised-statutes/title-40/rs-40-978-2/',
  'La. R.S. 14:403.11': 'A person who gives naloxone in good faith during a suspected overdose is protected from civil and criminal liability (La. R.S. 40:978.2; 14:403.11). Helping is protected.',
  'Act 378 of 2024': 'Every public and nonpublic K–12 school in Louisiana must adopt a naloxone policy, effective August 1, 2024 (Act 378 of 2024). Hope Resuscitated can help schools put that policy into practice. Naloxone nasal spray is sold over the counter; no prescription is needed (FDA, 2023). Source: https://www.legis.la.gov/legis/ViewDocument.aspx?d=1385782',
};

const PROGRAMS = {
  'Hope Responder Pathway, 5 levels': `## The Hope Responder pathway
Level 1, Hope Responder: completes hands-on training. Can recognize an overdose, call 911, use naloxone, help at outreach events.
Level 2, Hope Responder Leader: adds outreach and communication training. Can lead event teams and mentor new Responders.
Level 3, Hope Responder Educator: completes the peer-educator module. Can co-teach trainings alongside an adult trainer.
Level 4, Hope Responder Ambassador: can represent Hope Resuscitated at approved community and partner events.
Level 5, Hope Responder Fellow: can help lead research, evaluation and new projects.`,
  'Hope Safe Spaces tiers': 'Hope Friend: display a QR resource placard; we provide the placard and a partner map listing. Hope Safe Space: host an indoor naloxone box, display the window decal, and staff complete a 10-minute orientation; we provide the box, decal, orientation and map listing. Hope Community Partner: all of the above plus sponsor an access point, host an event or fund Hope Kits; we provide recognition at events, an impact summary and co-branded materials.',
  'Overdose Partner app': 'Overdose Partner app: our mobile app for iOS and Android supports everything we teach, with instructional videos, an overdose response timer and emergency prompts. QR codes on our training materials and access points link straight to it. The app is a learning and response companion. It never replaces calling 911.',
};

const REVIEWER_RULES = {
  'Our Commitments: always / never': `## Our commitments
We always: follow your school or organization's policies; teach "call 911" as the first step, every time; adjust content and delivery for each age group; use person-first, stigma-free language; keep an adult lead present at youth activities; point participants to support, including the 988 Suicide & Crisis Lifeline.

We never: use scare tactics or graphic content; ask students to share personal or family experiences; present young people as medical professionals; collect names or personal information in our surveys.`,
  'Brand voice and tagline': 'Motto: NO Stigma. NO Barriers. Just HOPE. Tagline: Turn hope into action. Youth are part of the response. Voice: preparedness, dignity and purpose. Plain, warm and hopeful; never fear or lecture. Naloxone is normal emergency equipment, like an AED or an EpiPen. Brand colors: deep purple #382665, signal #7554A3, ground #F7F5FB. Type: Jost, Public Sans and IBM Plex Mono.',
};

const GRANT_DOCS = [
  ['Mission and identity', 'Mission statement', 'Our mission is to educate and empower teenagers and young adults about overdose prevention while completely removing the barriers and stigma associated with accessing life-saving overdose reversal medication. Motto: NO Stigma. NO Barriers. Just HOPE. Tagline: Turn hope into action.', true],
  ['Mission and identity', 'Brand guide and motto', REVIEWER_RULES['Brand voice and tagline'], true],
  ['Legal and certifications', '501(c)(3) determination letter', 'Hope Resuscitated is a 501(c)(3) nonprofit organization. EIN 33-1274654. Based in St. Francisville, Louisiana. (Summary; upload the IRS letter to replace it.)', false],
  ['Legal and certifications', 'SEBD and Hudson Initiative', 'Hope Resuscitated holds SEBD and Hudson Initiative certifications.', false],
  ['People', 'Leila Ramos, Founder and Youth Director', 'Leila Ramos is the Founder and Youth Director of Hope Resuscitated. Hope Resuscitated was founded by Leila Ramos at age 15, after she lost five family members to overdose, including her 19-year-old cousin, Benji.', false],
  ['People', 'Cierra Ramos, Program Director', 'Cierra Ramos is the Program Director of Hope Resuscitated.', false],
  ['People', 'Board member bios', null, false],
  ['Financials', 'Unit costs per Narcan dose', 'Unit costs per Narcan dose: each dose costs about $50, plus $9 for shipping and specialized packaging, so each dose delivered costs $59.', true],
  ['Financials', '$3,000 YEA seed funding', 'Hope Resuscitated received $3,000 in YEA seed funding.', false],
  ['Financials', 'Historical budgets', null, false],
  ['Past proposals', '$50,000 Impact Grant', `Youth Narcan Access Expansion: a $50,000 Impact Grant proposal.

Statement of need: Young people in the Baton Rouge region are often one prepared bystander away from surviving an overdose. Hope Resuscitated was founded by Leila Ramos at age 15, after she lost five family members to overdose, including her 19-year-old cousin, Benji. Our mission is to educate and empower teenagers and young adults about overdose prevention while completely removing the barriers and stigma associated with accessing life-saving overdose reversal medication.

Today we operate five free, 24/7 Narcan access stations through library partnerships in West Feliciana, Zachary, North Baton Rouge, Port Allen and Brusly. In the first week at the West Feliciana Parish Library, the community took more than 40 doses. Each dose costs about $50, plus $9 for shipping and specialized packaging.`, false],
  ['Past proposals', '$110,000 Opioid Settlement', '2,000 Narcan Boxes + Overdose Partner App: a $110,000 opioid settlement fund proposal to place naloxone boxes in the community and support the Overdose Partner app.', false],
  ['Programs and impact', 'Five library Narcan stations', 'Hope Resuscitated operates five free, 24/7 naloxone (Narcan) access stations through library partnerships in West Feliciana, Zachary, North Baton Rouge, Port Allen and Brusly. In the first week at the West Feliciana Parish Library, the community took more than 40 doses.', true],
  ['Programs and impact', 'Overdose Partner app', PROGRAMS['Overdose Partner app'], true],
];

// ---------------------------------------------------------------------------
// Locked facts (quoted exactly; change only on the Knowledge screen)

const FACTS = [
  ['org_name', 'Organization', 'Hope Resuscitated', 'Hope Resuscitated', '501(c)(3) determination letter'],
  ['ein', 'EIN', '33-1274654', 'Hope Resuscitated\'s EIN is 33-1274654.', '501(c)(3) determination letter'],
  ['status', 'Tax status', '501(c)(3)', 'Hope Resuscitated is a 501(c)(3) nonprofit.', '501(c)(3) determination letter'],
  ['based_in', 'Based in', 'St. Francisville, Louisiana', 'Hope Resuscitated is based in St. Francisville, Louisiana.', '501(c)(3) determination letter'],
  ['service_area', 'Service area', 'West Feliciana, Zachary, North Baton Rouge, Port Allen and Brusly', 'Hope Resuscitated serves West Feliciana, Zachary, North Baton Rouge, Port Allen and Brusly.', 'Five library Narcan stations'],
  ['access_points', 'Free 24/7 naloxone access points', '5', 'Hope Resuscitated operates five free, 24/7 naloxone (Narcan) access points through library partnerships in West Feliciana, Zachary, North Baton Rouge, Port Allen and Brusly.', 'Five library Narcan stations'],
  ['first_week_doses', 'Doses taken in the first week', '40+', 'In the first week at the West Feliciana Parish Library, the community took more than 40 doses.', 'Five library Narcan stations'],
  ['dose_cost', 'Cost per Narcan dose', '$50', 'Each Narcan dose costs about $50, plus $9 for shipping and specialized packaging.', 'Unit costs per Narcan dose'],
  ['dose_shipping', 'Shipping and packaging per dose', '$9', 'Shipping and specialized packaging add $9 per dose.', 'Unit costs per Narcan dose'],
  ['dose_total', 'Cost per dose delivered', '$59', 'About $50 per dose, plus $9 for shipping and specialized packaging: $59 per dose delivered.', 'Unit costs per Narcan dose'],
  ['seed_funding', 'YEA seed funding', '$3,000', 'Hope Resuscitated received $3,000 in YEA seed funding.', '$3,000 YEA seed funding'],
  ['act_378', 'Act 378 of 2024', 'Act 378 of 2024', 'Under Act 378 of 2024, every public and nonpublic K–12 school in Louisiana must adopt a naloxone policy, effective August 1, 2024.', 'Act 378 of 2024'],
  ['rs_40_978_2', 'No age limit to possess naloxone', 'La. R.S. 40:978.2', 'Any person in Louisiana may lawfully possess naloxone, and there is no age limit (La. R.S. 40:978.2).', 'La. R.S. 40:978.2'],
  ['good_faith', 'Good-faith protection', 'La. R.S. 40:978.2; 14:403.11', 'A person who gives naloxone in good faith during a suspected overdose is protected from civil and criminal liability (La. R.S. 40:978.2; 14:403.11).', 'La. R.S. 14:403.11'],
  ['otc', 'Sold over the counter', 'FDA, 2023', 'Naloxone nasal spray is sold over the counter (FDA, 2023).', 'Act 378 of 2024'],
  ['founder', 'Founder story', 'Leila Ramos, Founder and Youth Director', 'Hope Resuscitated was founded by Leila Ramos at age 15, after she lost five family members to overdose, including her 19-year-old cousin, Benji.', 'Leila Ramos, Founder and Youth Director'],
  ['program_director', 'Program Director', 'Cierra Ramos', 'Cierra Ramos is the Program Director of Hope Resuscitated.', 'Cierra Ramos, Program Director'],
  ['mission', 'Mission', 'Educate and empower teenagers and young adults about overdose prevention', 'Our mission is to educate and empower teenagers and young adults about overdose prevention while completely removing the barriers and stigma associated with accessing life-saving overdose reversal medication.', 'Mission statement'],
  ['motto', 'Motto', 'NO Stigma. NO Barriers. Just HOPE.', 'NO Stigma. NO Barriers. Just HOPE.', 'Brand guide and motto'],
  ['certifications', 'Certifications', 'SEBD · Hudson Initiative', 'Hope Resuscitated holds SEBD and Hudson Initiative certifications.', 'SEBD and Hudson Initiative'],
  ['app', 'Overdose Partner app', 'iOS and Android', 'Our Overdose Partner app for iOS and Android offers instructional videos, an overdose response timer and emergency prompts. It never replaces calling 911.', 'Overdose Partner app'],
  ['email', 'Email', 'Team@hope-resuscitated.org', 'Email Team@hope-resuscitated.org.', 'Common questions'],
  ['website', 'Website', 'hope-resuscitated.org', 'Visit hope-resuscitated.org.', 'Common questions'],
];

export const DEFAULT_SETTINGS = {
  org_profile: {
    name: 'Hope Resuscitated',
    status: '501(c)(3) · EIN 33-1274654',
    based_in: 'St. Francisville, Louisiana',
    serves: 'West Feliciana, Zachary, North Baton Rouge, Port Allen, Brusly',
    focus: 'Overdose prevention, naloxone access, teens and young adults',
    certifications: 'SEBD · Hudson Initiative',
  },
  mailing_address: '',
  sender: { name: 'Leila Ramos', title: 'Founder & Youth Director, Hope Resuscitated', email: 'Team@hope-resuscitated.org' },
  targeting: {
    region: 'Capital Region, Louisiana',
    priority: 'Founding partner schools for the 2026–27 Corps pilot',
    segments: 'Schools, youth groups, churches, libraries, agencies, businesses',
    contact_rule: 'Staff with public work emails. Never students.',
    towns: ['Zachary', 'Port Allen', 'Brusly', 'St. Francisville', 'Baton Rouge'],
  },
  grant_rules: {
    keywords: ['naloxone', 'opioid overdose prevention', 'youth substance use prevention', 'harm reduction'],
    award_min: 1000, award_max: 250000, min_days_to_deadline: 14, max_auto_drafts: 3,
  },
  slot_plan: DEFAULT_SLOT_PLAN,
  banned_terms: DEFAULT_BANNED_TERMS,
  approval_policy: 'any_approver',
  run_budget_usd: 3,
};

// ---------------------------------------------------------------------------

export function seedKnowledge(store) {
  const ids = {};
  const add = (collection, group, title, text, shared) => {
    const d = ingestDocument(store, { title, collection, group, text, shared }, 'seed');
    ids[title] = d.id;
  };
  for (const [title, text] of Object.entries(PARTNER_GUIDE)) add('outreach', 'Partner Guide 2026–27', title, text, true);
  for (const [title, text] of Object.entries(LAW)) add('outreach', 'Louisiana law', title, text, true);
  for (const [title, text] of Object.entries(PROGRAMS)) add('outreach', 'Programs', title, text, true);
  for (const [title, text] of Object.entries(REVIEWER_RULES)) add('outreach', 'Reviewer rules', title, text, true);
  add('outreach', 'Reviewer rules', 'Cost and pricing sheet', null, false);
  for (const [group, title, text, shared] of GRANT_DOCS) add('grants', group, title, text, shared);
  for (const [key, label, value, statement, doc] of FACTS) {
    store.insert('facts', { key, label, value, statement, source_document_id: ids[doc] || null, locked: true, verified_by: null, verified_at: null });
  }
}

function nthWeekday(year, month, weekday, nth) {
  let n = 0;
  for (let d = 1; d <= daysInMonth(year, month); d++) if (weekdayOf(year, month, d) === weekday && ++n === nth) return d;
  return null;
}

export async function seedSamples(store, integrations = { mode: 'demo' }) {
  const ctx = { store, llm: { available: false }, integrations, actor: 'seed', run: null };
  const now = new Date();
  const inDays = (n) => new Date(now.getTime() + n * DAY_MS).toISOString();

  // --- Grants
  const g1 = upsertGrant(ctx, {
    source: 'foundation', funder: '[Foundation name]', title: 'Youth Narcan Access Expansion', program: 'Impact Grant',
    amount_min: 50000, amount_max: 50000, deadline: inDays(24), sample: true,
    description: 'Impact Grant for youth-serving nonprofits expanding naloxone access in Louisiana communities.',
    eligibility_text: 'Open to 501(c)(3) nonprofits serving young people in Louisiana.',
  }).grant;
  await filterGrant(ctx, g1.id);
  const d1 = await sendToWriter(ctx, g1.id, { request_amount: 50000 });
  // The canvas draft: the statement of need as first written, 68 characters over its limit.
  const need = store.find('draft_answers', (a) => a.draft_id === d1.id && a.key === 'need');
  if (need) {
    store.update('draft_answers', need.id, { text: CANVAS_NEED, char_count: CANVAS_NEED.length, citations: [
      ...['founder', 'mission', 'access_points', 'first_week_doses', 'dose_cost'].map((k) => {
        const f = store.find('facts', (x) => x.key === k);
        return { type: 'fact', id: f.id, key: f.key, label: f.label, value: f.value };
      }),
      { type: 'calc', expr: '50 + 9', result: '59', label: 'Cost per dose delivered' },
    ] });
    await reviewDraft(ctx, d1.id);
  }

  const g2 = upsertGrant(ctx, {
    source: 'foundation', funder: '[Settlement administrator]', title: '2,000 Narcan Boxes + Overdose Partner App', program: 'Opioid Settlement Fund',
    amount_min: 110000, amount_max: 110000, deadline: inDays(38), sample: true,
    description: 'Opioid settlement fund for naloxone distribution and overdose prevention programs in Louisiana.',
    eligibility_text: 'Louisiana 501(c)(3) nonprofits working on opioid overdose prevention.',
  }).grant;
  await filterGrant(ctx, g2.id);
  const d2 = await sendToWriter(ctx, g2.id, { request_amount: 110000 });
  store.update('grant_drafts', d2.id, { attachments: d2.attachments.map((a) => ({ ...a, done: true })) });

  const g3 = upsertGrant(ctx, {
    source: 'candid', funder: '[Funder]', title: '[Grant name]', program: 'via Candid', amount_min: null, amount_max: null, deadline: inDays(52), sample: true,
    description: 'Youth overdose prevention program support.', eligibility_text: '501(c)(3) nonprofits.',
  }).grant;
  await filterGrant(ctx, g3.id);
  await sendToWriter(ctx, g3.id);

  const g4 = upsertGrant(ctx, {
    source: 'grantsgov', external_id: 'SAMPLE-001', funder: '[Agency]', title: '[Youth substance-use prevention program]',
    amount_min: 25000, amount_max: 150000, deadline: inDays(46), sample: true, rfp_url: 'https://www.grants.gov/',
    description: 'Funds community naloxone access and overdose prevention for people aged 13–25.',
    eligibility_text: 'Eligible applicants include 501(c)(3) nonprofits in all states, including Louisiana. Youth population focus.',
  }).grant;
  await filterGrant(ctx, g4.id);
  store.update('grants', g4.id, { match_reason: 'Why it fits: funds community naloxone access for people aged 13–25, which lines up with your library stations and youth focus.' });

  const g5 = upsertGrant(ctx, {
    source: 'candid', funder: '[Family foundation]', title: '[Community health small grants]',
    amount_min: 5000, amount_max: 20000, deadline: inDays(33), sample: true,
    description: 'Prioritizes youth-led organizations in the Baton Rouge region working on community health and prevention.',
    eligibility_text: 'Nonprofit organizations. An annual budget minimum may apply.',
  }).grant;
  await filterGrant(ctx, g5.id);
  store.update('grants', g5.id, { match_reason: 'Why it fits: prioritizes youth-led organizations in the Baton Rouge region. Scout could not confirm whether an annual budget minimum applies.' });

  // --- Outreach prospects (placeholders stay placeholders)
  const p1 = await addProspect(ctx, {
    name: '[High school name]', segment: 'school', parish: null, sample: true, source: 'sample',
    reason: 'Under Act 378 the school must have a naloxone policy, and its website lists no student training. Good candidate for a founding Corps chapter.',
    offerings: ['assembly', 'act378', 'corps'],
    contact: { name: '[Counselor name]', title: 'Counselor', email: 'counselor@example.org', verified: true, source_url: 'https://example.org/staff' },
  });
  const p2 = await addProspect(ctx, {
    name: '[Church name] youth ministry', segment: 'faith', parish: 'East Baton Rouge', town: 'Zachary', sample: true, source: 'sample',
    reason: 'Runs a weekly youth group near your Zachary access point, and could host a Community Purpose Project build day.',
    offerings: ['group_training', 'purpose_project'],
    contact: { name: '[Youth pastor name]', title: 'Youth pastor', email: 'youthpastor@example.org', verified: true },
  });
  const p3 = await addProspect(ctx, {
    name: '[Business name]', segment: 'business', parish: 'West Baton Rouge', town: 'Port Allen', sample: true, source: 'sample',
    reason: 'High foot-traffic spot popular with teens. Scout found a general inbox but no owner email, so confirm before sending.',
    offerings: ['safe_space'],
    contact: { name: '', title: 'General inbox', email: 'info@example.org', verified: false },
  });
  await addProspect(ctx, {
    name: '[Public library branch]', segment: 'library', parish: 'West Baton Rouge', town: 'Brusly', sample: true, source: 'sample',
    reason: 'Libraries already host our access points; a Community Partner upgrade adds trainings and events.',
    offerings: ['community_partner', 'group_training'],
  });
  for (const p of [p1, p2, p3]) if (p.prospect) await draftOutreach(ctx, p.prospect.id);

  // --- Execution board
  addPartner(ctx, { name: '[Charter school name]', segment: 'school', step: 1, offerings: ['assembly', 'corps'], next_action: 'Intro call · prep notes ready', next_date: inDays(4), sample: true });
  addPartner(ctx, { name: '[Library branch]', segment: 'library', step: 1, offerings: ['community_partner'], next_action: 'Intro call · Community Partner upgrade', next_date: inDays(6), sample: true });
  addPartner(ctx, { name: '[Youth group name]', segment: 'youth', step: 2, offerings: ['group_training', 'purpose_project'], next_action: 'Send offerings summary', sample: true });
  addPartner(ctx, { name: '[Middle school name]', segment: 'school', step: 3, offerings: ['assembly'], next_action: 'Waiting on district approval · parent notice needed', sample: true });
  const cafe = addPartner(ctx, { name: '[Café name]', segment: 'business', step: 4, offerings: ['safe_space', 'staff_orientation'], next_action: 'Staff orientation', next_date: inDays(9), sample: true });
  store.update('partnerships', cafe.id, { checklist: cafe.checklist.map((c, i) => ({ ...c, done: i === 2 || i === 3 })) });
  addPartner(ctx, { name: 'West Feliciana Parish Library', segment: 'library', parish: 'West Feliciana', step: 5, offerings: ['sponsor'], next_action: 'Enter survey results to build the summary', sample: true });

  // --- Social: media library and the next month's plan
  const media = {};
  const M = (label, kind, pillar, people, subject, extra = {}) => ({ label, kind, pillar, people, subject, ...extra });
  const library = [
    M('Library access box', 'photo', 'Educate', false, 'a library naloxone box on the wall'),
    M('Naloxone demo', 'video', 'Equip', true, 'naloxone demo on a training device', { duration_s: 42, people_note: 'Faces are visible from 0:08 to 0:15.' }),
    M('Training session', 'photo', 'Lead', false, 'training devices and printed guides laid out for a Hope Responder session'),
    M('Naloxone nasal spray close-up', 'photo', 'Educate', false, 'a naloxone nasal spray package'),
    M('Overdose Partner app', 'video', 'Equip', false, 'a screen recording of the Overdose Partner app', { duration_s: 35 }),
    M('Community build day', 'photo', 'Empower', false, 'freshly painted access point stands from a build day'),
    M('Window decal', 'photo', 'Educate', false, 'a Hope Safe Space window decal'),
    M('Call 911 graphic', 'photo', 'Respond', false, 'a graphic that reads Call 911 first'),
    M('Library partners thank-you card', 'photo', 'Lead', false, 'a thank-you card to library partners'),
    M('Louisiana law graphic', 'photo', 'Educate', false, 'a graphic about Louisiana naloxone law'),
    M('Rescue breathing basics', 'photo', 'Equip', false, 'a CPR training manikin'),
    M('Youth voices quote card', 'photo', 'Empower', false, 'a quote card with words from a youth volunteer'),
    M('Recovery position illustration', 'photo', 'Respond', false, 'an illustration of the recovery position'),
    M('Team at outreach table', 'photo', 'Empower', true, 'the team at an outreach table', { people_note: 'Three people are visible at the table.' }),
    M('Recovery position demo', 'video', 'Respond', true, 'a volunteer demonstrating the recovery position', { duration_s: 28, people_note: 'A volunteer\'s face is visible throughout.' }),
    M('QR placard close-up', 'photo', 'Educate', false, 'a QR resource placard'),
    M('Hope Kit packing', 'video', 'Empower', true, 'volunteers packing Hope Kits', { duration_s: 51, people_note: 'Hands and faces are visible.' }),
    M('Library partner sign', 'photo', 'Lead', false, 'a library partner sign'),
    M('Founder message', 'video', 'Lead', true, 'a message from the founder', { duration_s: 60, people_note: 'The founder is on camera.' }),
  ];
  for (const m of library) {
    const row = await ingestMedia(ctx, { label: m.label, kind: m.kind, duration_s: m.duration_s, sample: true });
    media[m.label] = store.update('media_assets', row.id, {
      pillar: m.pillar, subject: m.subject, people_in_frame: m.people, people_note: m.people_note || '', tag_source: 'sample',
      format_fit: m.kind === 'video' ? 'IG Reel + FB video' : 'IG + FB photo', tags: [m.pillar.toLowerCase(), m.kind],
    });
  }

  const c = central(now);
  const cur = monthKey(c.year, c.month);
  const next = addMonths(cur, 1);
  const { year: ny, month: nm } = parseMonth(next);
  const plan = DEFAULT_SLOT_PLAN;
  const at = (y, mo, d, weekday) => { const p = plan.find((x) => x.weekday === weekday); return centralToDate(y, mo, d, p.hour, p.minute).toISOString(); };

  // This week: the first upcoming Monday and Wednesday before next month starts.
  const firstOfNext = centralToDate(ny, nm, 1).getTime();
  for (const [weekday, label, title] of [[1, 'Library access box', 'Access point spotlight'], [3, 'Naloxone demo', 'How to use naloxone in 3 steps']]) {
    for (let i = 1; i <= 7; i++) {
      const t = new Date(now.getTime() + i * DAY_MS);
      const cc = central(t);
      if (cc.weekday !== weekday) continue;
      const iso = at(cc.year, cc.month, cc.day, weekday);
      if (new Date(iso).getTime() < firstOfNext) {
        const post = await createPost(ctx, media[label], iso, { topic: title });
        store.update('posts', post.id, { title, sample: true });
      }
      break;
    }
  }
  // Next month by nth weekday: [weekday, nth, media, title]
  const nextPlan = [
    [5, 1, 'Training session', 'Hope Responder Corps: founding schools wanted'],
    [1, 1, 'Naloxone nasal spray close-up', 'What naloxone is'],
    [3, 1, 'Overdose Partner app', 'Overdose Partner app tour'],
    [5, 2, 'Community build day', 'Community build day'],
    [1, 2, 'Window decal', 'Hope Safe Spaces decal'],
    [3, 2, 'Call 911 graphic', 'Call 911 first, every time'],
    [5, 3, 'Library partners thank-you card', 'Thank you, library partners'],
    [1, 3, 'Louisiana law graphic', 'Louisiana law: no age limit'],
    [3, 3, 'Rescue breathing basics', 'Rescue breathing basics'],
    [1, 4, 'Youth voices quote card', 'Youth voices'],
    [3, 4, 'Recovery position illustration', 'Recovery position'],
  ];
  for (const [weekday, nth, label, title] of nextPlan) {
    const d = nthWeekday(ny, nm, weekday, nth);
    if (!d) continue;
    const post = await createPost(ctx, media[label], at(ny, nm, d, weekday), { time_sensitive: /founding/i.test(title), topic: title });
    store.update('posts', post.id, { title, sample: true });
  }
}

export function seedCore(store) {
  store.setSettings(DEFAULT_SETTINGS);
  store.insert('users', { username: 'leila', name: 'Leila Ramos', role: 'admin', email: '', password_hash: null });
  store.insert('users', { username: 'cierra', name: 'Cierra Ramos', role: 'approver', email: '', password_hash: null });
  seedKnowledge(store);
}

export async function seedAll(store, integrations) {
  seedCore(store);
  await seedSamples(store, integrations);
  store.setMeta({ seeded: true, seeded_at: new Date().toISOString(), samples: true });
}

export function clearSamples(store) {
  const sampleGrants = new Set(store.all('grants', (g) => g.sample).map((g) => g.id));
  const drafts = new Set(store.all('grant_drafts', (d) => sampleGrants.has(d.grant_id)).map((d) => d.id));
  const answers = new Set(store.all('draft_answers', (a) => drafts.has(a.draft_id)).map((a) => a.id));
  const prospects = new Set(store.all('prospects', (p) => p.sample).map((p) => p.id));
  const messages = new Set(store.all('messages', (m) => prospects.has(m.prospect_id)).map((m) => m.id));
  const mediaIds = new Set(store.all('media_assets', (m) => m.sample).map((m) => m.id));
  const posts = new Set(store.all('posts', (p) => p.sample || mediaIds.has(p.media_id)).map((p) => p.id));
  const items = new Set([...drafts, ...answers, ...messages, ...posts]);
  store.removeWhere('review_results', (r) => items.has(r.item_id));
  store.removeWhere('approval_items', (a) => items.has(a.item_id));
  store.removeWhere('draft_answers', (a) => answers.has(a.id));
  store.removeWhere('grant_drafts', (d) => drafts.has(d.id));
  store.removeWhere('grants', (g) => sampleGrants.has(g.id));
  store.removeWhere('contacts', (c) => prospects.has(c.prospect_id));
  store.removeWhere('messages', (m) => messages.has(m.id));
  store.removeWhere('prospects', (p) => prospects.has(p.id));
  store.removeWhere('partnerships', (p) => p.sample || prospects.has(p.prospect_id));
  store.removeWhere('posts', (p) => posts.has(p.id));
  store.removeWhere('media_assets', (m) => mediaIds.has(m.id));
  store.setMeta({ samples: false });
}

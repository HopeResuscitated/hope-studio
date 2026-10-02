// Self-test for the guarantees in the build sheet. Run: npm run check
// Uses only node:test and node:assert.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../web/core/store.js';
import { seedAll } from '../web/core/seed.js';
import { createService } from '../web/core/service.js';
import { askKb } from '../web/core/kb.js';
import { trimToLimit, findBannedTerms, replaceTerms, reviewPostHard, unsourcedNumbers, callsFirst } from '../web/core/reviewer.js';
import { parseRfp } from '../web/core/writer.js';
import { parseInstrumentlAlert, parseCandidCsv } from '../web/core/agents/grant.js';
import { copyMonthPlan, planningMonth } from '../web/core/agents/social.js';
import { addMonths as addMonthsKey } from '../web/core/util.js';
import { central } from '../web/core/util.js';
import { approvalFor } from '../web/core/approvals.js';

async function fresh() {
  const store = createStore({});
  store.load();
  const integrations = { mode: 'demo' };
  await seedAll(store, integrations);
  const svc = createService({ store, integrations });
  const leila = store.find('users', (u) => u.username === 'leila');
  const cierra = store.find('users', (u) => u.username === 'cierra');
  return { store, svc, leila, cierra };
}

test('nothing executes without a human approval', async () => {
  const { store, svc, leila } = await fresh();
  const draft = store.all('grant_drafts')[0];
  await assert.rejects(svc.call('exportDraft', { draftId: draft.id }, leila), /approve/i);
  assert.throws(() => store.update('grant_drafts', draft.id, { status: 'exported' }), /approval/i);
  const msg = store.find('messages', (m) => m.sequence_step === 1);
  assert.throws(() => store.update('messages', msg.id, { status: 'sent' }), /approval/i);
  const post = store.all('posts')[0];
  assert.throws(() => store.update('posts', post.id, { status: 'published' }), /approval/i);
});

test('agents never approve their own work', async () => {
  const { store } = await fresh();
  const a = store.find('approval_items', (x) => x.state === 'needs_you');
  assert.throws(() => store.update('approval_items', a.id, { state: 'approved', decided_by: 'agent' }), /Leila or Cierra/);
  assert.throws(() => store.insert('approval_items', { item_type: 'post', item_id: 'x', state: 'approved' }), /start as drafts/);
});

test('blocking flags stop approval until fixed', async () => {
  const { store, svc, leila } = await fresh();
  const over = store.find('draft_answers', (a) => a.text.length > a.limit_chars);
  assert.ok(over, 'seed has the over-limit answer from the canvas');
  await assert.rejects(svc.call('approveDraft', { draftId: over.draft_id }, leila), /blocking/);
  const fix = store.find('review_results', (r) => r.item_id === over.id && r.check === 'limit' && r.fix);
  await svc.call('applyFix', { resultId: fix.id }, leila);
  assert.ok(store.get('draft_answers', over.id).text.length <= over.limit_chars);
  await svc.call('approveDraft', { draftId: over.draft_id }, leila);
  const r = await svc.call('exportDraft', { draftId: over.draft_id }, leila);
  assert.equal(r.draft.status, 'exported');
});

test('roles: only Leila changes settings; both can approve', async () => {
  const { store, svc, cierra } = await fresh();
  await assert.rejects(svc.call('updateSettings', { patch: { mailing_address: 'x' } }, cierra), /admin/);
  const clean = store.find('approval_items', (a) => a.agent === 'social' && a.state === 'needs_you' && a.blocking === 0);
  const out = await svc.call('approve', { id: clean.id }, cierra);
  assert.equal(out.status, 'scheduled');
  await assert.rejects(svc.call('me', {}, null), /Sign in/);
});

test('email: CAN-SPAM footer required, students never contacted, opt-outs honored', async () => {
  const { store, svc, leila } = await fresh();
  const msg = store.find('messages', (m) => m.sequence_step === 1 && store.get('prospects', m.prospect_id).segment === 'school');
  await assert.rejects(svc.call('approveAndSend', { id: msg.id }, leila), /blocking/);
  await svc.call('updateSettings', { patch: { mailing_address: 'PO Box 0, St. Francisville, LA 70775' } }, leila);
  assert.ok(store.get('messages', msg.id).body.includes('PO Box 0'));
  const sent = await svc.call('approveAndSend', { id: msg.id }, leila);
  assert.equal(sent.status, 'sent');
  await assert.rejects(svc.call('addContact', { prospectId: msg.prospect_id, title: 'Student council', email: 'kid@example.org' }, leila), /students/);
  const other = store.find('messages', (m) => m.sequence_step === 1 && m.status !== 'sent' && m.to);
  await svc.call('optOut', { email: other.to }, leila);
  assert.equal(store.get('messages', other.id).status, 'suppressed');
});

test('follow-up waits 7 days and stops when they reply', async () => {
  const { store, svc, leila } = await fresh();
  await svc.call('updateSettings', { patch: { mailing_address: 'PO Box 0, St. Francisville, LA 70775' } }, leila);
  const first = store.find('messages', (m) => m.sequence_step === 1 && store.get('prospects', m.prospect_id).segment === 'school');
  await svc.call('approveAndSend', { id: first.id }, leila);
  const follow = store.find('messages', (m) => m.prospect_id === first.prospect_id && m.sequence_step === 2);
  assert.equal(follow.status, 'queued');
  store.update('messages', follow.id, { due_at: new Date(Date.now() - 1000).toISOString() });
  await svc.jobs.followUpCheck();
  assert.equal(store.get('approval_items', store.find('approval_items', (a) => a.item_id === follow.id).id).state, 'needs_you');
  await svc.call('markReplied', { id: first.id }, leila);
  assert.equal(store.get('messages', follow.id).status, 'cancelled');
  assert.ok(store.find('partnerships', (p) => p.prospect_id === first.prospect_id && p.step === 1));
});

test('social: people in frame block posting until a release is recorded', async () => {
  const { store, svc, leila } = await fresh();
  const flagged = store.find('review_results', (r) => r.check === 'consent' && r.result === 'flag');
  await assert.rejects(svc.call('approvePost', { id: flagged.item_id }, leila), /blocking/);
  const post = store.get('posts', flagged.item_id);
  await assert.rejects(svc.call('confirmConsent', { id: post.media_id, mode: 'release' }, leila), /release is kept/);
  await svc.call('confirmConsent', { id: post.media_id, mode: 'release', release_location: 'Drive › Releases' }, leila);
  const out = await svc.call('approvePost', { id: post.id }, leila);
  assert.equal(out.status, 'scheduled');
});

test('copy month keeps the nth-weekday rhythm and skips time-sensitive posts', async () => {
  const { store, leila } = await fresh();
  // The sample Corps post is seeded into next month, so copy from the month that holds it.
  const corps = store.all('posts', (x) => /founding/i.test(x.title || ''))[0];
  const c = central(new Date(corps.scheduled_at));
  const key = `${c.year}-${String(c.month).padStart(2, '0')}`;
  const plan = copyMonthPlan({ store, actor: leila }, { source_month: key, match_by: 'weekday', media_mode: 'same', skip_time_sensitive: true });
  const p = plan.plans[0];
  assert.ok(p.skipped.some((t) => /founding/i.test(t)), 'the Corps post is time-sensitive');
  for (const it of p.items) assert.ok([1, 3, 5].includes(central(new Date(it.iso)).weekday), 'lands on Mon, Wed or Fri in Central time');
});

test('reviewer hard checks', () => {
  assert.equal(replaceTerms('Addicts deserve help.', findBannedTerms('Addicts deserve help.')), 'People who use drugs deserve help.');
  assert.equal(callsFirst('Here is how to use naloxone:\n1. Call 911.\n2. Spray naloxone into one nostril.'), true);
  assert.equal(callsFirst('Spray naloxone into one nostril. Then call 911.'), false);
  assert.equal(callsFirst('Naloxone is sold over the counter. Turn hope into action.'), true);
  const text = 'A '.repeat(300) + 'This long sentence, so every dollar counts for someone who needs it.';
  assert.ok(trimToLimit(text, 500).length <= 500);
  assert.deepEqual(unsourcedNumbers('We trained 312 students and run 5 access points.', ['We run 5 access points.']), ['312']);
  const results = reviewPostHard({ settings: () => ({}), get: () => null, find: () => null, all: () => [] },
    { platforms: ['instagram'], caption_ig: 'If you lost someone, we see you.', alt_text: '', citations: [] },
    { media: { kind: 'photo', people_in_frame: false } });
  assert.ok(results.some((r) => r.check === 'lifeline' && r.result === 'flag'));
  assert.ok(results.some((r) => r.check === 'alt_text' && r.result === 'flag'));
});

test('knowledge base answers from sources and logs gaps', async () => {
  const { store } = await fresh();
  const ctx = { store, llm: { available: false }, actor: 'test' };
  assert.match((await askKb(ctx, { question: 'What does one Narcan dose cost us?', collection: 'grants' })).answer, /\$50.*\$9/);
  assert.match((await askKb(ctx, { question: 'How young can students be?', collection: 'outreach' })).answer, /no age limit/);
  const gap = await askKb(ctx, { question: 'Who is on the board of directors?', collection: 'grants' });
  assert.equal(gap.missing, true);
  assert.ok(store.find('kb_gaps', (g) => /board/.test(g.question)));
});

test('changing a locked fact re-flags drafts that quote it', async () => {
  const { store, svc, leila } = await fresh();
  const f = store.find('facts', (x) => x.key === 'access_points');
  await svc.call('updateFact', { id: f.id, value: '6', statement: f.statement.replace('five', 'six') }, leila);
  assert.ok(store.count('review_results', (r) => r.check === 'current_facts' && r.result === 'flag') > 0);
});

test('intake parsers', () => {
  const q = parseRfp('1. Organization background (1,000 characters)\n2. Statement of need: who is affected (800 characters)\n3. Program design (250 words)');
  assert.deepEqual(q.map((x) => x.limit), [1000, 800, 1500]);
  const alerts = parseInstrumentlAlert('Grant: Youth Health Fund\nFunder: [Foundation]\nAmount: up to $25,000\nDeadline: November 14, 2026\nhttps://example.org/rfp');
  assert.equal(alerts[0].amount_max, 25000);
  assert.ok(alerts[0].deadline.startsWith('2026-11-1'));
  const csv = parseCandidCsv('Grantmaker,Program,Amount,Deadline\n"[Family foundation]","Community health","$5,000 - $20,000",12/01/2026');
  assert.equal(csv[0].amount_min, 5000);
  assert.equal(csv[0].amount_max, 20000);
});

test('global search finds entities across grants, prospects, posts and facts', async () => {
  const { svc, leila } = await fresh();
  const searchGrants = await svc.call('searchAll', { query: 'youth' }, leila);
  assert.ok(searchGrants.results.length > 0, 'finds matches for youth');

  const searchFacts = await svc.call('searchAll', { query: 'access points' }, leila);
  assert.ok(searchFacts.results.some((r) => r.type === 'fact'));
});

test('export proposal generates clean markdown and text', async () => {
  const { store, svc, leila } = await fresh();
  const draft = store.all('grant_drafts')[0];
  const md = await svc.call('exportProposal', { draftId: draft.id, format: 'markdown' }, leila);
  assert.ok(md.content.includes('# Grant Proposal:'));
  assert.equal(md.mime, 'text/markdown');

  const txt = await svc.call('exportProposal', { draftId: draft.id, format: 'text' }, leila);
  assert.ok(txt.content.includes('GRANT PROPOSAL:'));
  assert.equal(txt.mime, 'text/plain');
});

test('bulk csv prospect importer parses and adds prospects', async () => {
  const { store, svc, leila } = await fresh();
  const csv = 'Name,Segment,Town,Contact,Email\nTest Community Library,library,St. Francisville,Jane Librarian,jane@testlib.org\nNew Hope Chapel,faith,Jackson,Pastor Mark,mark@newhope.org';
  const res = await svc.call('importProspectsCsv', { text: csv }, leila);
  assert.equal(res.added, 2);
  assert.ok(store.find('prospects', (p) => p.name === 'Test Community Library'));
});

test('social content ideas generator returns pillar suggestions', async () => {
  const { svc, leila } = await fresh();
  const ideas = await svc.call('getSocialIdeas', { pillar: 'Educate' }, leila);
  assert.equal(ideas.pillar, 'Educate');
  assert.ok(ideas.ideas.length >= 3);
});

test('crm contact directory and daily gmail synchronization', async () => {
  const { store, svc, leila } = await fresh();

  // 1. Check contact directory listing and organization
  const listRes = await svc.call('contactsList', { search: '', segment: 'all', status: 'all', sort: 'followup' }, leila);
  assert.ok(listRes.contacts.length >= 4);
  const marcus = listRes.contacts.find((c) => c.email === 'mvance@wfpsb.org');
  assert.ok(marcus);
  assert.equal(marcus.name, 'Dr. Marcus Vance');
  assert.equal(marcus.company, 'West Feliciana High School');
  assert.equal(marcus.position, 'Director of Student Services');
  assert.equal(marcus.phone, '(225) 635-3891');
  assert.ok(marcus.first_communication);
  assert.ok(marcus.last_communication);
  assert.equal(marcus.status_of_last_request, 'Replied');

  // 2. Add new contact manually
  const newC = await svc.call('upsertContact', {
    name: 'Chief Robert Miller',
    email: 'rmiller@stfrancisvillepd.org',
    phone: '(225) 635-4033',
    company: 'St. Francisville Police Dept',
    position: 'Chief of Police',
    segment: 'agency',
    first_communication: new Date().toISOString(),
    status_of_last_request: 'Awaiting Reply',
    next_follow_up_date: '2026-10-01',
    follow_up_next_steps: 'Deliver replacement naloxone supply for squad cars',
  }, leila);
  assert.ok(newC.id);
  assert.equal(newC.name, 'Chief Robert Miller');

  // 3. Log an interaction note / call to update timeline & communication status
  const updatedC = await svc.call('logContactCommunication', {
    contactId: newC.id,
    type: 'call',
    direction: 'inbound',
    subject: 'Squad car naloxone restock request',
    snippet: 'Chief Miller called to confirm squad car naloxone restocking and requested 10 training pouches.',
    status: 'Meeting Booked',
    next_follow_up_date: '2026-10-02',
    follow_up_next_steps: 'Drop off 10 training kits and naloxone packs',
  }, leila);
  assert.equal(updatedC.status_of_last_request, 'Meeting Booked');
  assert.equal(updatedC.last_direction, 'inbound');
  assert.ok(updatedC.history.length >= 2);

  // 4. Update follow-up schedule
  const afterFu = await svc.call('setContactFollowUp', {
    contactId: newC.id,
    next_follow_up_date: '2026-10-05',
    follow_up_next_steps: 'Check in on training pouch distribution',
  }, leila);
  assert.equal(afterFu.next_follow_up_date, '2026-10-05');

  // 5. Run daily Gmail synchronization
  const syncRes = await svc.call('syncGmailContacts', {}, leila);
  assert.ok(syncRes.total_contacts >= 5);
});

test('a post drafted from a prompt waits for a person and cannot be published', async () => {
  const { store, svc, leila } = await fresh();
  const { prompts } = await svc.call('prompts', {}, leila);
  assert.ok(prompts.length >= 5, 'starter prompts are added once');
  assert.equal((await svc.call('prompts', {}, leila)).prompts.length, prompts.length, 'and not added twice');
  const media = store.all('media_assets')[0];
  const { id } = await svc.call('draftFromPrompt', { media_id: media.id, prompt_id: prompts[0].id }, leila);
  const post = store.get('posts', id);
  assert.equal(post.topic, prompts[0].text);
  assert.notEqual(post.status, 'published');
  assert.notEqual(approvalFor(store, 'post', id).state, 'executed');
  await assert.rejects(svc.call('draftFromPrompt', { media_id: 'nope', prompt_id: prompts[0].id }, leila), /Pick a photo/);
});

test('restoring a backup made before the prompt library still works', async () => {
  const { store, svc, leila } = await fresh();
  const old = JSON.parse(JSON.stringify(store.raw));
  delete old.tables.prompts;
  delete old.meta.prompts_seeded;
  await svc.call('importData', { data: old }, leila);
  const { prompts } = await svc.call('prompts', {}, leila);
  assert.ok(prompts.length >= 5, 'prompts table is rebuilt and starter prompts are added');
});

test('prompt drafts reject bad input and excluded media', async () => {
  const { store, svc, leila } = await fresh();
  const { prompts } = await svc.call('prompts', {}, leila);
  const media = store.all('media_assets')[0];
  await svc.call('excludeMedia', { id: media.id }, leila);
  await assert.rejects(svc.call('draftFromPrompt', { media_id: media.id, prompt_id: prompts[0].id }, leila), /Pick a photo/);
  await assert.rejects(svc.call('savePrompt', { label: 'x', text: 'y'.repeat(600), pillar: 'Educate' }, leila), /too long/i);
  await assert.rejects(svc.call('savePrompt', { id: 'nope', label: 'x', text: 'y', pillar: 'Educate' }, leila), /not found/i);
  assert.deepEqual(await svc.call('deletePrompt', { id: 'nope' }, leila), { ok: false });
});

test('choosing media from the library: swap keeps the caption, slots can be picked, nothing skips approval', async () => {
  const { store, svc, leila } = await fresh();
  const post = store.all('posts', (p) => p.status === 'drafted')[0];
  const target = store.all('media_assets', (m) => m.id !== post.media_id && !m.excluded)[0];
  const before = post.caption_ig;

  const kept = await svc.call('swapMedia', { id: post.id, mediaId: target.id, keepCaption: true }, leila);
  assert.equal(kept.media_id, target.id, 'the chosen item is used, not a random one');
  assert.equal(kept.caption_ig, before, 'the caption the person has is kept');

  const fresh2 = await svc.call('swapMedia', { id: post.id, mediaId: post.media_id }, leila);
  assert.equal(fresh2.media_id, post.media_id);
  assert.notEqual(approvalFor(store, 'post', post.id).state, 'executed', 'a swap never publishes');

  const bad = store.all('media_assets', (m) => m.id !== post.media_id)[1];
  await svc.call('excludeMedia', { id: bad.id }, leila);
  await assert.rejects(svc.call('swapMedia', { id: post.id, mediaId: bad.id }, leila), /Don't use/);

  // A specific open slot, no prompt
  const key = planningMonth();
  const open = (await svc.call('calendar', { key }, leila)).slots.find((s) => !s.posts.length && !s.past)
    || (await svc.call('calendar', { key: addMonthsKey(key) }, leila)).slots.find((s) => !s.posts.length);
  const m = store.all('media_assets', (x) => !x.excluded)[2];
  const { id } = await svc.call('draftFromPrompt', { media_id: m.id, slot: open.key }, leila);
  assert.equal(store.get('posts', id).scheduled_at, open.date, 'the post lands in the slot that was picked');
  assert.notEqual(store.get('posts', id).status, 'published');
  await assert.rejects(svc.call('draftFromPrompt', { media_id: m.id, slot: open.key }, leila), /no longer open/);
});

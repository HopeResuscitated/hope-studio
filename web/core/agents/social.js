// Social Studio · Social Media Coordinator
// Upload → tag (pillar, subject, people in frame) → plan Mon/Wed/Fri slots →
// write IG + FB captions → Reviewer → (human approval) → publish queue.

import { audit, raiseAlert } from '../audit.js';
import { PILLARS, DEFAULT_SLOT_PLAN } from '../schema.js';
import {
  parseMonth, daysInMonth, weekdayOf, centralToDate, central, monthKey, monthOfISO, addMonths,
  currentMonthKey, DAY_MS, monthName,
} from '../util.js';
import { draftPostCopy } from '../writer.js';
import { reviewPostHard, judgeWithClaude, COMMITMENT_RUBRIC } from '../reviewer.js';
import { openApproval, afterReview, approvalFor, approve, markExecuted, transition } from '../approvals.js';
import { logRun } from '../runs.js';
import { saveResults, sourcePack, WRITER_RULES } from './common.js';

const pad = (n) => String(n).padStart(2, '0');
const LIVE = ['drafted', 'in_review', 'scheduled', 'published', 'failed'];

// ---------------------------------------------------------------------------
// Tagging

const PILLAR_RULES = [
  ['Respond', /\b(911|recovery|breath|respond|emergency|signs of)\b/i],
  ['Equip', /\b(demo|how to|how-to|spray|training device|app|practice|steps?)\b/i],
  ['Lead', /\b(founder|corps|leader|thank|founding|message|award|partner sign)\b/i],
  ['Empower', /\b(build|pack|kit|volunteer|team|community|youth voices?|outreach|event|table)\b/i],
  ['Educate', /\b(box|access|decal|placard|qr|law|sign|station|library|naloxone is|what naloxone)\b/i],
];

export function tagHeuristic(label, kind) {
  const s = String(label || '').replace(/[_-]+/g, ' ');
  const pillar = (PILLAR_RULES.find(([, re]) => re.test(s)) || ['Educate'])[0];
  let people = null;
  if (/\b(training|session|team|people|youth|volunteer|founder|group|class|students|voices|build day|packing|demo|outreach table|staff)\b/i.test(s)) people = true;
  else if (/\b(box|decal|placard|sign|qr|app|screen|logo|graphic|close-up)\b/i.test(s)) people = false;
  return {
    pillar,
    subject: s.replace(/\.(jpe?g|png|heic|mp4|mov|webp)$/i, '').trim(),
    format_fit: kind === 'video' ? 'IG Reel + FB video' : 'IG + FB photo',
    people_in_frame: people,
    people_note: people ? 'Filename suggests people are in frame.' : '',
    tags: [pillar.toLowerCase(), kind],
  };
}

export async function tagMedia(ctx, mediaId, { frames = [] } = {}) {
  const { store, llm } = ctx;
  const m = store.get('media_assets', mediaId);
  let tags = tagHeuristic(m.label, m.kind);
  let source = 'filename';
  const images = frames.length ? frames : m.thumb ? [m.thumb] : [];
  if (llm?.available && images.length) {
    try {
      const out = await llm.json({
        purpose: 'tag',
        run: ctx.run,
        images: images.slice(0, 12),
        system: 'You tag photos and video frames for Hope Resuscitated\'s social calendar. Content pillars: Educate (facts, law, access points), Equip (how-to, training, the app), Empower (community, youth, build days), Respond (call 911, emergency response steps), Lead (Corps, founders, partners, thank-yous). Report people_in_frame true if any person or identifiable face appears in any frame; be conservative.',
        prompt: `File: ${m.label} (${m.kind}${m.duration_s ? `, ${Math.round(m.duration_s)}s, one frame every 2 seconds` : ''}). Tag it.`,
        schema: {
          type: 'object',
          properties: {
            pillar: { type: 'string', enum: PILLARS }, subject: { type: 'string' }, format_fit: { type: 'string' },
            people_in_frame: { type: 'boolean' }, people_note: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } },
            alt_hint: { type: 'string' },
          },
          required: ['pillar', 'subject', 'format_fit', 'people_in_frame', 'people_note', 'tags', 'alt_hint'],
          additionalProperties: false,
        },
      });
      tags = out;
      source = 'vision';
    } catch (err) {
      if (err.name === 'BudgetExceeded') throw err;
      logRun(ctx, `Vision tagging fell back to the filename: ${err.message}`);
    }
  }
  const after = store.update('media_assets', mediaId, { ...tags, tag_source: source });
  audit(store, { actor: ctx.actor, action: 'media.tagged', item_type: 'media', item_id: mediaId, before: m, after });
  return after;
}

export async function ingestMedia(ctx, input) {
  const { store } = ctx;
  const m = store.insert('media_assets', {
    label: input.label || input.name || 'Untitled', file_url: input.file_url || null, thumb: input.thumb || null,
    kind: input.kind || (/video/.test(input.type || '') ? 'video' : 'photo'), duration_s: input.duration_s || null,
    aspect: input.aspect || null, pillar: null, subject: '', tags: [], people_in_frame: null, consent_confirmed: false,
    excluded: false, last_used_at: null, sample: !!input.sample, uploaded_by: ctx.actor?.name || null,
  });
  audit(store, { actor: ctx.actor, action: 'media.upload', item_type: 'media', item_id: m.id, after: m });
  return tagMedia(ctx, m.id, { frames: input.frames || [] });
}

export function mediaUsage(store, mediaId) {
  return store.all('posts', (p) => p.media_id === mediaId && LIVE.includes(p.status));
}

// ---------------------------------------------------------------------------
// Planner

export function slotsForMonth(settings, key) {
  const plan = settings.slot_plan?.length ? settings.slot_plan : DEFAULT_SLOT_PLAN;
  const { year, month } = parseMonth(key);
  const counts = {};
  const out = [];
  for (let d = 1; d <= daysInMonth(year, month); d++) {
    const wd = weekdayOf(year, month, d);
    counts[wd] = (counts[wd] || 0) + 1;
    const p = plan.find((x) => x.weekday === wd);
    if (p) out.push({ date: centralToDate(year, month, d, p.hour, p.minute).toISOString(), day: d, weekday: wd, nth: counts[wd], key: `${key}-${pad(d)}` });
  }
  return out;
}

export const dayKey = (iso) => {
  const c = central(new Date(iso));
  return `${monthKey(c.year, c.month)}-${pad(c.day)}`;
};

export function postsInMonth(store, key) {
  return store.all('posts', (p) => LIVE.includes(p.status) && monthOfISO(p.scheduled_at) === key)
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
}

export function monthPlan(store, key, now = new Date()) {
  const slots = slotsForMonth(store.settings(), key);
  const posts = postsInMonth(store, key);
  const byDay = new Map();
  for (const p of posts) (byDay.get(dayKey(p.scheduled_at)) || byDay.set(dayKey(p.scheduled_at), []).get(dayKey(p.scheduled_at))).push(p);
  const rows = slots.map((s) => ({ ...s, posts: byDay.get(s.key) || [], past: new Date(s.date) < now }));
  const offPlan = posts.filter((p) => !slots.some((s) => s.key === dayKey(p.scheduled_at)));
  const filled = rows.filter((r) => r.posts.length).length;
  const open = rows.filter((r) => !r.posts.length && !r.past);
  const scheduled = posts.filter((p) => ['scheduled', 'published'].includes(p.status)).length;
  return { key, slots: rows, offPlan, filled, open, scheduled, total: slots.length };
}

function usedWithin(store, mediaId, iso, days = 60, ignorePostId = null) {
  const t = new Date(iso).getTime();
  return store.all('posts', (p) => p.media_id === mediaId && p.id !== ignorePostId && LIVE.includes(p.status))
    .some((p) => Math.abs(new Date(p.scheduled_at).getTime() - t) < days * DAY_MS);
}

const consentRank = (m) => (m.people_in_frame === false || m.consent_confirmed ? 0 : m.people_in_frame === null || m.people_in_frame === undefined ? 1 : 2);

export function pickMedia(store, { pillar, iso, exclude = new Set(), ignorePostId = null, avoidPeople = false }) {
  return store.all('media_assets', (m) => !m.excluded && m.pillar && (!pillar || m.pillar === pillar) && !exclude.has(m.id)
    && !usedWithin(store, m.id, iso, 60, ignorePostId) && (!avoidPeople || consentRank(m) === 0))
    .sort((a, b) => consentRank(a) - consentRank(b) || String(a.last_used_at || '').localeCompare(String(b.last_used_at || '')) || a.created_at.localeCompare(b.created_at))[0] || null;
}

function pillarOrder(counts, previous) {
  return [...PILLARS].sort((a, b) => (counts[a] || 0) - (counts[b] || 0) || (a === previous) - (b === previous) || PILLARS.indexOf(a) - PILLARS.indexOf(b));
}

export async function autofill(ctx, key, { only = null } = {}) {
  const { store } = ctx;
  const plan = monthPlan(store, key);
  const counts = {};
  for (const p of postsInMonth(store, key)) counts[p.pillar] = (counts[p.pillar] || 0) + 1;
  const created = [];
  const stillOpen = [];
  const used = new Set();
  let previous = null;
  for (const slot of plan.slots) {
    if (slot.posts.length) { previous = slot.posts[0].pillar; continue; }
    if (slot.past || (only && slot.key !== only)) continue;
    // Balance pillars, and prefer media that needs no consent check.
    const order = pillarOrder(counts, previous);
    let media = null;
    for (const pillar of order) if ((media = pickMedia(store, { pillar, iso: slot.date, exclude: used, avoidPeople: true }))) break;
    if (!media) for (const pillar of order) if ((media = pickMedia(store, { pillar, iso: slot.date, exclude: used }))) break;
    if (!media) { stillOpen.push(slot); continue; }
    used.add(media.id);
    counts[media.pillar] = (counts[media.pillar] || 0) + 1;
    previous = media.pillar;
    created.push(await createPost(ctx, media, slot.date));
  }
  logRun(ctx, `Planner filled ${created.length} of ${created.length + stillOpen.length} open ${monthName(key)} slots.`);
  return { created, open: stillOpen };
}

// ---------------------------------------------------------------------------
// Captions

async function writeCopy(ctx, media, { variant = 0, topic = '' } = {}) {
  const { store, llm } = ctx;
  const base = draftPostCopy(store, media, { variant, topic });
  if (!llm?.available) return { ...base, model: 'template' };
  try {
    const pack = sourcePack(store, `${media.pillar} ${media.subject} naloxone`, { k: 6 });
    const out = await llm.json({
      purpose: 'draft',
      run: ctx.run,
      system: `You are the Social Media Coordinator for Hope Resuscitated (IG + FB). Write platform-specific captions for the ${media.pillar} pillar. Instagram: under 900 characters, "Link in bio", 3–5 hashtags including #NoStigmaNoBarriersJustHope. Facebook: same message, the link hope-resuscitated.org written out, at most 3 hashtags. Alt text: one plain sentence describing what is visible. Keep captions factual and avoid drug slang: platforms moderate harm-reduction posts.\n${WRITER_RULES}`,
      prompt: `Media: ${media.kind}, "${media.subject || media.label}". Tags: ${(media.tags || []).join(', ')}.${topic ? `\nTopic: ${topic}` : ''}\n${variant ? 'Write a fresh version that does not repeat the previous wording.\n' : ''}Reference draft:\n${base.caption_ig}\n\nSources:\n${pack.render()}`,
      schema: {
        type: 'object',
        properties: { title: { type: 'string' }, caption_ig: { type: 'string' }, caption_fb: { type: 'string' }, alt_text: { type: 'string' }, source_ids: { type: 'array', items: { type: 'string' } } },
        required: ['title', 'caption_ig', 'caption_fb', 'alt_text', 'source_ids'],
        additionalProperties: false,
      },
    });
    return { ...out, citations: [...base.citations, ...pack.toCitations(out.source_ids)], model: 'draft' };
  } catch (err) {
    if (err.name === 'BudgetExceeded') throw err;
    logRun(ctx, `Caption writer fell back to templates: ${err.message}`);
    return { ...base, model: 'template' };
  }
}

const TIME_SENSITIVE = /\b(deadline|register|registration|this week|tonight|tomorrow|wanted|enrolling|sign up|event on|join us on|rsvp)\b/i;

export async function createPost(ctx, media, iso, { variant = 0, time_sensitive = null, copy = null, reused = false, topic = '' } = {}) {
  const { store } = ctx;
  const c = copy || await writeCopy(ctx, media, { variant, topic });
  const post = store.insert('posts', {
    media_id: media.id, scheduled_at: iso, platforms: ['instagram', 'facebook'], title: c.title || media.label,
    pillar: media.pillar, topic, caption_ig: c.caption_ig, caption_fb: c.caption_fb, alt_text: c.alt_text, citations: c.citations || [],
    time_sensitive: time_sensitive ?? TIME_SENSITIVE.test(`${c.title} ${c.caption_ig}`), status: 'drafted', variant,
    meta_post_ids: {}, reused_recently: reused, run_id: ctx.run?.id || null, model: c.model || 'template', attempts: 0,
  });
  store.update('media_assets', media.id, { last_used_at: iso });
  audit(store, { actor: ctx.actor, action: 'post.drafted', item_type: 'post', item_id: post.id, after: post, run_id: ctx.run?.id });
  openApproval(ctx, { item_type: 'post', item_id: post.id, agent: 'social', title: post.title, summary: `${media.pillar} · ${new Date(iso).toISOString()}`, run_id: ctx.run?.id });
  await reviewPost(ctx, post.id);
  return store.get('posts', post.id);
}

export async function reviewPost(ctx, postId) {
  const { store } = ctx;
  const post = store.get('posts', postId);
  const media = post.media_id ? store.get('media_assets', post.media_id) : null;
  const results = reviewPostHard(store, post, { media });
  saveResults(store, 'post', postId, results);
  if (ctx.llm?.available) {
    try {
      const j = await judgeWithClaude(ctx, { kind: 'social post', text: `Instagram:\n${post.caption_ig}\n\nFacebook:\n${post.caption_fb}\n\nAlt text: ${post.alt_text}`, criteria: COMMITMENT_RUBRIC });
      saveResults(store, 'post', postId, j.items.map((it) => ({ check: `rubric:${it.check}`, label: it.check, result: it.met ? 'pass' : 'flag', blocking: false, suggestion: it.suggestion, fix: null })), 'rubric');
    } catch (err) {
      if (err.name === 'BudgetExceeded') throw err;
      logRun(ctx, `Commitments judge skipped: ${err.message}`);
    }
  }
  const a = approvalFor(store, 'post', postId);
  if (a && a.state !== 'executed') {
    afterReview(ctx, a.id, results);
    if (post.status === 'scheduled') store.update('posts', postId, { status: 'drafted' });
  }
  return results;
}

export async function updatePost(ctx, postId, patch) {
  const { store } = ctx;
  const before = store.get('posts', postId);
  if (before.status === 'published') throw Object.assign(new Error('This post is already live.'), { status: 409 });
  const allowed = {};
  for (const k of ['caption_ig', 'caption_fb', 'alt_text', 'scheduled_at', 'platforms', 'time_sensitive', 'title']) if (k in patch) allowed[k] = patch[k];
  const after = store.update('posts', postId, allowed);
  audit(store, { actor: ctx.actor, action: 'post.edit', item_type: 'post', item_id: postId, before, after });
  await reviewPost(ctx, postId);
  return store.get('posts', postId);
}

export async function rewriteCaption(ctx, postId) {
  const { store } = ctx;
  const post = store.get('posts', postId);
  const media = store.get('media_assets', post.media_id);
  const variant = (post.variant || 0) + 1;
  const c = await writeCopy(ctx, media, { variant, topic: post.topic || '' });
  store.update('posts', postId, { variant, citations: c.citations });
  return updatePost(ctx, postId, { caption_ig: c.caption_ig, caption_fb: c.caption_fb });
}

export async function swapMedia(ctx, postId, { mediaId = null } = {}) {
  const { store } = ctx;
  const post = store.get('posts', postId);
  const media = mediaId ? store.get('media_assets', mediaId)
    : pickMedia(store, { pillar: post.pillar, iso: post.scheduled_at, exclude: new Set([post.media_id]), ignorePostId: postId, avoidPeople: true })
      || pickMedia(store, { iso: post.scheduled_at, exclude: new Set([post.media_id]), ignorePostId: postId, avoidPeople: true });
  if (!media) throw Object.assign(new Error('No other media without people is free for this date. Upload a photo, or confirm a release.'), { status: 409 });
  const c = await writeCopy(ctx, media, { variant: post.variant || 0 });
  const before = post;
  store.update('posts', postId, { media_id: media.id, pillar: media.pillar, title: c.title, caption_ig: c.caption_ig, caption_fb: c.caption_fb, alt_text: c.alt_text, citations: c.citations, reused_recently: false });
  store.update('media_assets', media.id, { last_used_at: post.scheduled_at });
  audit(store, { actor: ctx.actor, action: 'post.swap_media', item_type: 'post', item_id: postId, before, after: store.get('posts', postId) });
  await reviewPost(ctx, postId);
  return store.get('posts', postId);
}

export async function confirmConsent(ctx, mediaId, { mode = 'release', release_location = '' } = {}) {
  const { store } = ctx;
  const before = store.get('media_assets', mediaId);
  const patch = mode === 'no_people'
    ? { people_in_frame: false, consent_confirmed: false, consent_by: ctx.actor?.name, consent_at: new Date().toISOString() }
    : { consent_confirmed: true, release_location: release_location || before.release_location || '', consent_by: ctx.actor?.name, consent_at: new Date().toISOString() };
  if (mode === 'release' && !patch.release_location.trim()) {
    throw Object.assign(new Error('Say where the signed release is kept (for example, "Drive › Releases › 2026").'), { status: 400 });
  }
  const after = store.update('media_assets', mediaId, patch);
  audit(store, { actor: ctx.actor, action: mode === 'no_people' ? 'media.no_people' : 'media.consent', item_type: 'media', item_id: mediaId, before, after, note: patch.release_location || '' });
  for (const p of store.all('posts', (x) => x.media_id === mediaId && ['drafted', 'in_review', 'scheduled'].includes(x.status))) await reviewPost(ctx, p.id);
  return after;
}

export function approvePost(ctx, postId) {
  const { store } = ctx;
  const a = approvalFor(store, 'post', postId);
  approve(ctx, a.id);
  const before = store.get('posts', postId);
  const after = store.update('posts', postId, { status: 'scheduled', approved_by: ctx.actor?.name });
  audit(store, { actor: ctx.actor, action: 'post.scheduled', item_type: 'post', item_id: postId, before, after });
  return after;
}

export function approveCleanPosts(ctx, { key = null } = {}) {
  const { store } = ctx;
  const ids = store.all('approval_items', (a) => a.agent === 'social' && a.item_type === 'post' && a.state === 'needs_you' && a.blocking === 0)
    .map((a) => a.item_id)
    .filter((id) => { const p = store.get('posts', id); return p && (!key || monthOfISO(p.scheduled_at) === key); });
  for (const id of ids) approvePost(ctx, id);
  return ids.length;
}

// ---------------------------------------------------------------------------
// Copy month

export function copyMonthPlan(ctx, opts) {
  const { store } = ctx;
  const { source_month, match_by = 'weekday', media_mode = 'fresh', skip_time_sensitive = true } = opts;
  const targets = opts.target_months?.length ? opts.target_months : [addMonths(source_month, 1)];
  const src = monthPlan(store, source_month, new Date(0));
  const plans = [];
  const reserved = new Set();
  for (const target of targets) {
    const tSlots = slotsForMonth(store.settings(), target);
    const tPlan = monthPlan(store, target, new Date(0));
    const { year, month } = parseMonth(target);
    const items = [];
    const skipped = [];
    const dropped = [];
    const entries = [...src.slots.map((s) => ({ slot: s, post: s.posts[0] || null })), ...src.offPlan.map((p) => ({ slot: null, post: p }))];
    for (const { slot, post } of entries) {
      const srcIso = post ? post.scheduled_at : slot.date;
      const c = central(new Date(srcIso));
      const wd = weekdayOf(c.year, c.month, c.day);
      const nth = Math.ceil(c.day / 7);
      let day = null;
      if (match_by === 'date') day = c.day <= daysInMonth(year, month) ? c.day : null;
      else {
        const same = [];
        for (let d = 1; d <= daysInMonth(year, month); d++) if (weekdayOf(year, month, d) === wd) same.push(d);
        day = same[nth - 1] || null;
      }
      if (!day) { dropped.push({ from: srcIso, title: post?.title || 'Open slot', why: match_by === 'date' ? 'Date does not exist' : `No ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][wd]} #${nth}` }); continue; }
      const iso = centralToDate(year, month, day, c.hour, c.minute).toISOString();
      const tKey = `${target}-${pad(day)}`;
      if (tPlan.slots.find((s) => s.key === tKey)?.posts.length) { dropped.push({ from: srcIso, title: post?.title || 'Open slot', why: 'Already has a post' }); continue; }
      if (!post) { items.push({ iso, open: true, reason: 'Open in source month' }); continue; }
      if (skip_time_sensitive && post.time_sensitive) { skipped.push(post.title); items.push({ iso, open: true, reason: `Skipped time-sensitive "${post.title}"` }); continue; }
      let media = store.get('media_assets', post.media_id);
      let reused = false;
      if (media_mode === 'fresh') {
        media = pickMedia(store, { pillar: post.pillar, iso, exclude: reserved }) || null;
        if (media) reserved.add(media.id);
      } else {
        reused = usedWithin(store, media.id, iso, 60);
      }
      items.push(media ? { iso, open: false, source_post_id: post.id, media_id: media.id, pillar: post.pillar, title: post.title, reused }
        : { iso, open: true, reason: `No unused ${post.pillar} media` });
    }
    items.sort((a, b) => a.iso.localeCompare(b.iso));
    plans.push({ target, slots: items.length, posts: items.filter((i) => !i.open).length, open: items.filter((i) => i.open).length, skipped, dropped, items, planSlots: tSlots.length });
  }
  return { source_month, match_by, media_mode, refresh_captions: !!opts.refresh_captions, skip_time_sensitive, plans };
}

export async function copyMonth(ctx, opts) {
  const { store } = ctx;
  const plan = copyMonthPlan(ctx, opts);
  const created = [];
  for (const p of plan.plans) {
    for (const it of p.items) {
      if (it.open) continue;
      const src = store.get('posts', it.source_post_id);
      const media = store.get('media_assets', it.media_id);
      let copy = null;
      if (!opts.refresh_captions && plan.media_mode === 'same') {
        copy = { title: src.title, caption_ig: src.caption_ig, caption_fb: src.caption_fb, alt_text: src.alt_text, citations: src.citations, model: src.model };
      }
      created.push(await createPost(ctx, media, it.iso, { variant: opts.refresh_captions ? (src.variant || 0) + 1 : src.variant || 0, time_sensitive: src.time_sensitive, copy, reused: it.reused }));
    }
  }
  const row = store.insert('month_copies', {
    source_month: plan.source_month, target_month: plan.plans.map((p) => p.target).join(', '), match_by: plan.match_by,
    media_mode: plan.media_mode, refresh_captions: plan.refresh_captions, skip_time_sensitive: plan.skip_time_sensitive,
    created_posts: created.map((c) => c.id),
  });
  audit(store, { actor: ctx.actor, action: 'social.copy_month', item_type: 'month_copy', item_id: row.id, after: row, note: `${created.length} posts drafted` });
  return { plan, created: created.length, copy: row };
}

// ---------------------------------------------------------------------------
// Publish queue (every 5 minutes)

export async function publishQueue(ctx) {
  const { store, integrations } = ctx;
  const now = new Date().toISOString();
  const due = store.all('posts', (p) => p.status === 'scheduled' && p.scheduled_at <= now && (!p.retry_at || p.retry_at <= now));
  let published = 0;
  for (const post of due) {
    const a = approvalFor(store, 'post', post.id);
    if (!a || !['approved', 'executed'].includes(a.state)) continue;
    const media = store.get('media_assets', post.media_id);
    try {
      let ids;
      if (integrations.meta?.available) ids = await integrations.meta.publish(post, media);
      else if (integrations.mode === 'demo') ids = Object.fromEntries(post.platforms.map((pl) => [pl, `demo-${pl}-${Date.now()}`]));
      else throw new Error('Meta is not connected');
      const after = store.update('posts', post.id, { status: 'published', published_at: new Date().toISOString(), meta_post_ids: ids, simulated: integrations.mode === 'demo' && !integrations.meta?.available });
      markExecuted(ctx, 'post', post.id, { meta_post_ids: ids });
      audit(store, { actor: 'publish queue', action: 'post.published', item_type: 'post', item_id: post.id, before: post, after, note: Object.values(ids).join(', ') });
      published++;
    } catch (err) {
      if (err.name === 'BudgetExceeded') throw err;
      const attempts = (post.attempts || 0) + 1;
      const failed = attempts >= 3;
      store.update('posts', post.id, { attempts, last_error: err.message, status: failed ? 'failed' : 'scheduled', retry_at: new Date(Date.now() + attempts * 15 * 60000).toISOString() });
      audit(store, { actor: 'publish queue', action: failed ? 'post.failed' : 'post.retry', item_type: 'post', item_id: post.id, note: err.message });
      if (failed) raiseAlert(store, { level: 'critical', title: `"${post.title}" failed to post`, detail: err.message, agent: 'social' });
    }
  }
  return published;
}

// ---------------------------------------------------------------------------
// Dashboard numbers

export function planningMonth(now = new Date()) {
  const c = central(now);
  const key = monthKey(c.year, c.month);
  return daysInMonth(c.year, c.month) - c.day < 7 ? addMonths(key, 1) : key;
}

export function weeksOnPlan(store, now = new Date()) {
  // Count back from last completed week: every planned slot had a published post.
  let streak = 0;
  const today = central(now);
  const start = centralToDate(today.year, today.month, today.day).getTime() - today.weekday * DAY_MS;
  for (let w = 1; w <= 52; w++) {
    const from = start - w * 7 * DAY_MS;
    const to = from + 7 * DAY_MS;
    let slots = 0;
    let ok = 0;
    for (let d = 0; d < 7; d++) {
      const day = new Date(from + d * DAY_MS + 12 * 3600000);
      const c = central(day);
      const plan = (store.settings().slot_plan || DEFAULT_SLOT_PLAN).find((p) => p.weekday === c.weekday);
      if (!plan) continue;
      slots++;
      const key = `${monthKey(c.year, c.month)}-${pad(c.day)}`;
      if (store.find('posts', (p) => p.status === 'published' && dayKey(p.scheduled_at) === key && new Date(p.scheduled_at).getTime() < to)) ok++;
    }
    if (!slots || ok < slots) break;
    streak++;
  }
  return streak;
}

export function unusedMedia(store) {
  return store.all('media_assets', (m) => !m.excluded && !mediaUsage(store, m.id).length);
}

export function lowPillar(store) {
  const unused = unusedMedia(store);
  const counts = Object.fromEntries(PILLARS.map((p) => [p, 0]));
  for (const m of unused) if (m.pillar) counts[m.pillar]++;
  return PILLARS.slice().sort((a, b) => counts[a] - counts[b])[0];
}

export { currentMonthKey, transition };

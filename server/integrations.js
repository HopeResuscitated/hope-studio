// Connectors. Each one turns on only when its credentials are present, and the
// Executor calls them only for items a person approved.
//
//   Gmail + Google Docs   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
//   Meta (FB + IG)        META_PAGE_ID, META_PAGE_TOKEN, META_IG_USER_ID, PUBLIC_BASE_URL
//   Grants.gov            on by default (public API); GRANTS_GOV=0 turns it off
//   Google Places         GOOGLE_PLACES_API_KEY

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from './env.js';
import { centralToDate } from '../web/core/util.js';

async function http(url, { method = 'GET', headers = {}, body, timeout = 30000 } = {}) {
  const res = await fetch(url, {
    method,
    headers: { ...(body && typeof body === 'object' ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body && typeof body === 'object' ? JSON.stringify(body) : body,
    signal: AbortSignal.timeout(timeout),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = data?.error?.message || data?.error_description || data?.msg || (typeof data === 'string' ? data.slice(0, 200) : res.statusText);
    throw new Error(`${new URL(url).host}: ${res.status} ${msg}`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Google OAuth (Gmail + Docs share one refresh token for Team@hope-resuscitated.org)

function googleAuth() {
  const id = env('GOOGLE_CLIENT_ID');
  const secret = env('GOOGLE_CLIENT_SECRET');
  const refresh = env('GOOGLE_REFRESH_TOKEN');
  if (!id || !secret || !refresh) return null;
  let cached = { token: null, expires: 0 };
  return async () => {
    if (cached.token && cached.expires > Date.now() + 60000) return cached.token;
    const data = await http('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: 'refresh_token' }).toString(),
    });
    cached = { token: data.access_token, expires: Date.now() + (data.expires_in || 3600) * 1000 };
    return cached.token;
  };
}

const b64url = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const encodeHeader = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);

function mime({ from, fromName, to, subject, body }) {
  return [
    `From: ${encodeHeader(fromName)} <${from}>`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `List-Unsubscribe: <mailto:${from}?subject=unsubscribe>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(body, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n'),
  ].join('\r\n');
}

function gmail(token, settings) {
  const base = 'https://gmail.googleapis.com/gmail/v1/users/me';
  const sender = () => ({ from: settings().sender?.email || env('GMAIL_FROM', 'Team@hope-resuscitated.org'), fromName: settings().sender?.name || 'Hope Resuscitated' });
  return {
    available: true,
    async send({ to, subject, body, threadId }) {
      const raw = b64url(mime({ ...sender(), to, subject, body }));
      const data = await http(`${base}/messages/send`, { method: 'POST', headers: { Authorization: `Bearer ${await token()}` }, body: { raw, ...(threadId ? { threadId } : {}) } });
      return { id: data.id, threadId: data.threadId };
    },
    async createDraft({ to, subject, body }) {
      const raw = b64url(mime({ ...sender(), to, subject, body }));
      const data = await http(`${base}/drafts`, { method: 'POST', headers: { Authorization: `Bearer ${await token()}` }, body: { message: { raw } } });
      return { id: data.id };
    },
    // A reply is any later message in the thread that we did not send.
    async threadReply(threadId, sentId) {
      const data = await http(`${base}/threads/${threadId}?format=metadata&metadataHeaders=From`, { headers: { Authorization: `Bearer ${await token()}` } });
      const me = sender().from.toLowerCase();
      const msgs = data.messages || [];
      const i = msgs.findIndex((m) => m.id === sentId);
      const reply = msgs.slice(i + 1).find((m) => !(m.payload?.headers || []).some((h) => h.name === 'From' && h.value.toLowerCase().includes(me)));
      if (!reply) return null;
      return { id: reply.id, snippet: reply.snippet || '', optOut: /\b(stop|unsubscribe|remove me)\b/i.test(reply.snippet || '') };
    },
  };
}

function docs(token) {
  return {
    available: true,
    async exportDraft(doc) {
      const auth = { Authorization: `Bearer ${await token()}` };
      const created = await http('https://docs.googleapis.com/v1/documents', { method: 'POST', headers: auth, body: { title: doc.title } });
      let text = `${doc.title}\n${doc.meta}\n\n`;
      const headings = [];
      for (const s of doc.sections) {
        const start = text.length + 1;
        text += `${s.heading}\n`;
        headings.push([start, text.length + 1]);
        text += `${s.count}\n${s.text}\n\n`;
      }
      if (doc.attachments?.length) {
        const start = text.length + 1;
        text += 'Attachments checklist\n';
        headings.push([start, text.length + 1]);
        text += doc.attachments.map((a) => `${a.done ? '[x]' : '[ ]'} ${a.name}`).join('\n') + '\n';
      }
      const requests = [
        { insertText: { location: { index: 1 }, text } },
        { updateParagraphStyle: { range: { startIndex: 1, endIndex: doc.title.length + 2 }, paragraphStyle: { namedStyleType: 'TITLE' }, fields: 'namedStyleType' } },
        ...headings.map(([s, e]) => ({ updateParagraphStyle: { range: { startIndex: s, endIndex: e }, paragraphStyle: { namedStyleType: 'HEADING_2' }, fields: 'namedStyleType' } })),
      ];
      await http(`https://docs.googleapis.com/v1/documents/${created.documentId}:batchUpdate`, { method: 'POST', headers: auth, body: { requests } });
      return { url: `https://docs.google.com/document/d/${created.documentId}/edit`, documentId: created.documentId };
    },
  };
}

// Without Google, an approved draft exports as a Word-compatible file the team can download.
function docsFallback(dataDir) {
  const dir = path.join(dataDir, 'exports');
  return async (doc) => {
    fs.mkdirSync(dir, { recursive: true });
    const name = `${doc.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'grant-draft'}-${crypto.randomBytes(4).toString('hex')}.doc`;
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.title)}</title></head><body style="font-family:Calibri,Arial,sans-serif">
<h1>${esc(doc.title)}</h1><p>${esc(doc.meta)}</p>${doc.sections.map((s) => `<h2>${esc(s.heading)}</h2><p style="color:#666">${esc(s.count)}</p>${s.text.split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join('')}`).join('')}
<h2>Attachments checklist</h2><ul>${(doc.attachments || []).map((a) => `<li>${a.done ? '☑' : '☐'} ${esc(a.name)}</li>`).join('')}</ul></body></html>`;
    fs.writeFileSync(path.join(dir, name), html);
    return { url: `api/exports/${name}`, note: 'Google Docs is not connected, so the draft was saved as a Word file.' };
  };
}

// ---------------------------------------------------------------------------
// Meta Graph API: Facebook Page + Instagram Business account

function meta(dataDir) {
  const pageId = env('META_PAGE_ID');
  const token = env('META_PAGE_TOKEN');
  const igId = env('META_IG_USER_ID');
  const publicBase = env('PUBLIC_BASE_URL').replace(/\/$/, '');
  const v = env('META_GRAPH_VERSION', 'v21.0');
  if (!pageId || !token) return { available: false };
  const g = (p) => `https://graph.facebook.com/${v}/${p}`;
  const mediaUrl = (m) => {
    if (!m?.file_url) throw new Error('This post has no uploaded media file.');
    if (/^https?:/.test(m.file_url)) return m.file_url;
    if (!publicBase) throw new Error('Set PUBLIC_BASE_URL so Meta can fetch the media file.');
    return `${publicBase}/${m.file_url.replace(/^\//, '')}`;
  };
  return {
    available: true,
    async publish(post, media) {
      const ids = {};
      const url = mediaUrl(media);
      const video = media.kind === 'video';
      if (post.platforms.includes('facebook')) {
        const data = video
          ? await http(g(`${pageId}/videos`), { method: 'POST', body: { file_url: url, description: post.caption_fb, access_token: token }, timeout: 120000 })
          : await http(g(`${pageId}/photos`), { method: 'POST', body: { url, caption: post.caption_fb, access_token: token } });
        ids.facebook = data.post_id || data.id;
      }
      if (post.platforms.includes('instagram')) {
        if (!igId) throw new Error('Set META_IG_USER_ID to publish to Instagram.');
        const container = await http(g(`${igId}/media`), {
          method: 'POST',
          body: video ? { media_type: 'REELS', video_url: url, caption: post.caption_ig, access_token: token } : { image_url: url, caption: post.caption_ig, ...(env('META_IG_ALT_TEXT') === '1' ? { alt_text: post.alt_text } : {}), access_token: token },
        });
        if (video) {
          for (let i = 0; i < 30; i++) {
            const s = await http(g(`${container.id}?fields=status_code&access_token=${encodeURIComponent(token)}`));
            if (s.status_code === 'FINISHED') break;
            if (s.status_code === 'ERROR') throw new Error('Instagram could not process the video.');
            await new Promise((r) => setTimeout(r, 5000));
          }
        }
        const done = await http(g(`${igId}/media_publish`), { method: 'POST', body: { creation_id: container.id, access_token: token } });
        ids.instagram = done.id;
      }
      return ids;
    },
  };
}

// ---------------------------------------------------------------------------
// Grants.gov search (public API) and Google Places (prospect lists)

function mdyToIso(s) {
  const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? centralToDate(+m[3], +m[1], +m[2], 23, 59).toISOString() : null;
}

function grantsGov() {
  if (env('GRANTS_GOV', '1') === '0') return { available: false };
  const api = 'https://api.grants.gov/v1/api';
  return {
    available: true,
    name: 'grantsgov',
    async search(keyword) {
      const data = await http(`${api}/search2`, { method: 'POST', body: { keyword, oppStatuses: 'forecasted|posted', rows: 25 } });
      const hits = data?.data?.oppHits || [];
      const out = [];
      for (const h of hits.slice(0, 12)) {
        let detail = null;
        try {
          detail = (await http(`${api}/fetchOpportunity`, { method: 'POST', body: { opportunityId: Number(h.id) } }))?.data?.synopsis || null;
        } catch { /* details are optional */ }
        out.push({
          source: 'grantsgov', external_id: String(h.id), funder: h.agencyName || h.agency || h.agencyCode || '[Agency]', title: h.title,
          deadline: mdyToIso(h.closeDate), rfp_url: `https://www.grants.gov/search-results-detail/${h.id}`,
          amount_min: +detail?.awardFloor || null, amount_max: +detail?.awardCeiling || null,
          eligibility_text: [detail?.applicantEligibilityDesc, ...(detail?.applicantTypes || []).map((t) => t.description)].filter(Boolean).join(' '),
          description: [h.number, detail?.synopsisDesc?.replace(/<[^>]+>/g, ' ')].filter(Boolean).join(' · ').slice(0, 3000),
        });
      }
      return out;
    },
  };
}

function places() {
  const key = env('GOOGLE_PLACES_API_KEY');
  if (!key) return { available: false };
  return {
    available: true,
    name: 'google_places',
    async search(query) {
      const data = await http('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.websiteUri,places.types,places.googleMapsUri' },
        body: { textQuery: query, maxResultCount: 10 },
      });
      return (data.places || []).map((p) => ({
        name: p.displayName?.text, address: p.formattedAddress || '', website: p.websiteUri || null,
        source_url: p.websiteUri || p.googleMapsUri || null, types: p.types || [], external_id: p.id,
      })).filter((p) => p.name);
    },
  };
}

// ---------------------------------------------------------------------------

export function createIntegrations({ dataDir, settings }) {
  const token = googleAuth();
  const docsLive = token ? docs(token) : { available: false };
  return {
    mode: 'live',
    gmail: token ? gmail(token, settings) : { available: false },
    docs: { ...docsLive, fallback: docsFallback(dataDir) },
    meta: meta(dataDir),
    grantsgov: grantsGov(),
    places: places(),
  };
}

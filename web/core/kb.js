// Knowledge base: documents are split into ~800-token chunks with 100 tokens of
// overlap, searched with BM25 over Postgres-style full text (no vendor, no
// embeddings bill), and backed by a table of locked facts that are quoted exactly.

import { tokenize, splitSentences } from './util.js';
import { audit } from './audit.js';

const CHUNK_CHARS = 3200; // ~800 tokens
const OVERLAP_CHARS = 400; // ~100 tokens

export function chunkText(text) {
  const paras = String(text || '').replace(/\r/g, '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let section = '';
  let buf = [];
  let bufLen = 0;
  let bufSection = '';

  const flush = () => {
    if (!buf.length) return;
    const body = buf.join('\n\n');
    chunks.push({ section: bufSection || section, text: body });
    // carry overlap
    const tail = body.slice(-OVERLAP_CHARS);
    const cut = tail.indexOf(' ');
    buf = bufLen > OVERLAP_CHARS ? [tail.slice(cut + 1)] : [];
    bufLen = buf.join('').length;
    bufSection = section;
  };

  for (const p of paras) {
    const heading = p.match(/^#{1,4}\s+(.+)$/);
    if (heading && !p.includes('\n')) {
      if (bufLen > OVERLAP_CHARS) flush();
      buf = [];
      bufLen = 0;
      section = heading[1].trim();
      bufSection = section;
      continue;
    }
    if (bufLen + p.length > CHUNK_CHARS && bufLen > 0) flush();
    if (p.length > CHUNK_CHARS) {
      for (let i = 0; i < p.length; i += CHUNK_CHARS - OVERLAP_CHARS) {
        buf = [p.slice(i, i + CHUNK_CHARS)];
        bufLen = buf[0].length;
        flush();
        buf = [];
        bufLen = 0;
      }
      continue;
    }
    buf.push(p);
    bufLen += p.length;
  }
  if (buf.length && bufLen > 0) {
    const body = buf.join('\n\n');
    if (!chunks.length || !chunks[chunks.length - 1].text.endsWith(body)) chunks.push({ section: bufSection || section, text: body });
  }
  return chunks;
}

export function ingestDocument(store, { title, collection, group = 'Uploads', text, file_url = null, shared = false, source_url = null }, actor = 'system') {
  const existing = store.find('documents', (d) => d.title === title && d.collection === collection);
  if (existing) store.removeWhere('chunks', (c) => c.document_id === existing.id);
  const doc = existing
    ? store.update('documents', existing.id, { status: text ? 'indexed' : 'missing', file_url, group, shared, source_url })
    : store.insert('documents', { title, collection, group, file_url, shared, source_url, status: text ? 'indexed' : 'missing' });
  let n = 0;
  if (text) {
    for (const c of chunkText(text)) {
      store.insert('chunks', { document_id: doc.id, section: c.section, text: c.text, tokens: tokenize(c.text) });
      n++;
    }
  }
  store.update('documents', doc.id, { chunk_count: n });
  if (actor !== 'seed') audit(store, { actor, action: existing ? 'kb.reindex' : 'kb.ingest', item_type: 'document', item_id: doc.id, after: doc, note: `${n} chunks` });
  return store.get('documents', doc.id);
}

// ---------------------------------------------------------------------------
// BM25

let cache = { sig: null, idx: null };

function signature(store) {
  const rows = store.all('chunks');
  let latest = '';
  for (const r of rows) if (r.updated_at > latest) latest = r.updated_at;
  return `${rows.length}:${latest}:${store.count('documents')}`;
}

function buildIndex(store) {
  const sig = signature(store);
  if (cache.sig === sig) return cache.idx;
  const docs = new Map(store.all('documents').map((d) => [d.id, d]));
  const items = [];
  const df = new Map();
  for (const c of store.all('chunks')) {
    const doc = docs.get(c.document_id);
    if (!doc || doc.status !== 'indexed') continue;
    const toks = c.tokens || tokenize(c.text);
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    items.push({ chunk: c, doc, tf, len: toks.length });
  }
  const avg = items.reduce((a, b) => a + b.len, 0) / (items.length || 1);
  const idx = { items, df, avg, N: items.length };
  cache = { sig, idx };
  return idx;
}

function idf(idx, t) {
  const n = idx.df.get(t) || 0;
  return Math.log(1 + (idx.N - n + 0.5) / (n + 0.5));
}

export function search(store, query, { collection = null, k = 8 } = {}) {
  const idx = buildIndex(store);
  const q = [...new Set(tokenize(query))];
  if (!q.length) return [];
  const k1 = 1.4;
  const b = 0.72;
  const out = [];
  for (const it of idx.items) {
    if (collection && it.doc.collection !== collection && !it.doc.shared) continue;
    let s = 0;
    for (const t of q) {
      const f = it.tf.get(t);
      if (!f) continue;
      s += idf(idx, t) * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * it.len) / idx.avg)));
    }
    if (s > 0) out.push({ chunk: it.chunk, doc: it.doc, score: s });
  }
  return out.sort((a, b2) => b2.score - a.score).slice(0, k);
}

export function scoreFacts(store, query) {
  const q = new Set(tokenize(query));
  if (!q.size) return [];
  return store.all('facts')
    .map((f) => {
      const ft = new Set(tokenize(`${f.label} ${f.statement || ''} ${f.key.replace(/_/g, ' ')}`));
      let hit = 0;
      for (const t of q) if (ft.has(t)) hit++;
      return { fact: f, score: hit / q.size, hits: hit };
    })
    .filter((x) => x.hits >= Math.min(2, q.size))
    .sort((a, b) => b.score - a.score || b.hits - a.hits);
}

export function factValue(store, key) {
  return store.find('facts', (f) => f.key === key)?.value ?? null;
}

export function factStatement(store, key) {
  const f = store.find('facts', (x) => x.key === key);
  return f ? f.statement || f.value : null;
}

export function factCitation(store, key) {
  const f = store.find('facts', (x) => x.key === key);
  return f ? { type: 'fact', id: f.id, key: f.key, label: f.label, value: f.value } : null;
}

export function chunkCitation(hit) {
  return { type: 'chunk', id: hit.chunk.id, document_id: hit.doc.id, label: hit.doc.title, section: hit.chunk.section };
}

// ---------------------------------------------------------------------------
// Ask the brain

function bestSentences(hits, query) {
  const q = new Set(tokenize(query));
  let best = null;
  for (const h of hits.slice(0, 4)) {
    const sents = splitSentences(h.chunk.text);
    sents.forEach((s, i) => {
      const st = tokenize(s);
      let score = 0;
      const seen = new Set();
      for (const t of st) if (q.has(t) && !seen.has(t)) { score++; seen.add(t); }
      const coverage = score / (q.size || 1);
      // A question in an FAQ that matches every term is the strongest signal.
      const total = coverage + h.score / 50 + (s.trim().endsWith('?') && coverage >= 0.99 ? 0.5 : 0);
      if (!best || total > best.total) best = { total, coverage, score, i, sents, hit: h };
    });
  }
  if (!best) return null;
  best.need = q.size >= 4 ? 0.5 : 0.66;
  let answer;
  best.isQuestion = best.sents[best.i].trim().endsWith('?');
  if (best.isQuestion && best.sents[best.i + 1]) {
    answer = best.sents.slice(best.i + 1, best.i + 3).join(' ');
  } else {
    answer = best.sents.slice(best.i, best.i + 2).join(' ');
  }
  return { ...best, answer };
}

export async function askKb(ctx, { question, collection = null, log = true }) {
  const { store, llm, actor } = ctx;
  const hits = search(store, question, { collection, k: 8 });
  const facts = scoreFacts(store, question).slice(0, 5);

  let result;
  if (llm?.available) {
    const sources = [
      ...facts.map((f) => ({ id: f.fact.id, kind: 'fact', title: f.fact.label, text: f.fact.statement || f.fact.value })),
      ...hits.map((h) => ({ id: h.chunk.id, kind: 'chunk', title: `${h.doc.title}${h.chunk.section ? ' · ' + h.chunk.section : ''}`, text: h.chunk.text })),
    ];
    const out = await llm.json({
      purpose: 'tag',
      run: ctx.run,
      system: 'You answer questions for Hope Resuscitated staff using only the numbered sources provided. If the sources do not answer the question, set missing to true and leave answer empty. Never guess numbers, programs, prices or budgets. Keep answers to one or two sentences.',
      prompt: `Question: ${question}\n\nSources:\n${sources.map((s, i) => `[${i + 1}] (${s.id}) ${s.title}\n${s.text}`).join('\n\n')}`,
      schema: {
        type: 'object',
        properties: {
          answer: { type: 'string' },
          source_ids: { type: 'array', items: { type: 'string' } },
          missing: { type: 'boolean' },
        },
        required: ['answer', 'source_ids', 'missing'],
        additionalProperties: false,
      },
    });
    const cited = out.source_ids.map((id) => sources.find((s) => s.id === id)).filter(Boolean);
    const missing = out.missing || !cited.length;
    result = {
      answer: missing ? '' : out.answer,
      missing,
      sources: cited.map((s) => ({ type: s.kind, id: s.id, label: s.title })),
    };
  } else {
    const topFact = facts[0];
    const sentence = bestSentences(hits, question);
    // An exact FAQ match ("What does it cost?") beats a loosely related fact.
    const faq = sentence && sentence.isQuestion && sentence.coverage >= 0.99;
    if (!faq && topFact && topFact.score >= 0.5 && (!sentence || topFact.score >= sentence.coverage)) {
      result = { answer: topFact.fact.statement || topFact.fact.value, missing: false, sources: [{ type: 'fact', id: topFact.fact.id, label: topFact.fact.label }] };
    } else if (sentence && sentence.coverage >= sentence.need) {
      const h = sentence.hit;
      result = {
        answer: sentence.answer,
        missing: false,
        sources: [{ type: 'chunk', id: h.chunk.id, label: `${h.doc.title}${h.chunk.section ? ' · ' + h.chunk.section : ''}` }],
      };
    } else {
      result = { answer: '', missing: true, sources: [] };
    }
  }

  if (result.missing && log) {
    const existing = store.find('kb_gaps', (g) => g.question.toLowerCase() === question.toLowerCase() && !g.resolved);
    if (existing) store.update('kb_gaps', existing.id, { times: (existing.times || 1) + 1 });
    else store.insert('kb_gaps', { question, collection, times: 1, resolved: false, asked_by: actor?.name || 'agent' });
  }
  return result;
}

export function kbGaps(store, collection) {
  const missingDocs = store.all('documents', (d) => d.status === 'missing' && (!collection || d.collection === collection));
  const questions = store.all('kb_gaps', (g) => !g.resolved && (!collection || !g.collection || g.collection === collection));
  return { missingDocs, questions };
}

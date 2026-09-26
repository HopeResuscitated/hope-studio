// Helpers shared by the three agent modules.

import { factCitation } from '../kb.js';
import { search, chunkCitation } from '../kb.js';

export function saveResults(store, itemType, itemId, results, source = 'hard') {
  store.removeWhere('review_results', (r) => r.item_type === itemType && r.item_id === itemId && (source === 'all' || r.source === source));
  return results.map((r) => store.insert('review_results', { item_type: itemType, item_id: itemId, source, ...r }));
}

export function resultsFor(store, itemType, itemId) {
  return store.all('review_results', (r) => r.item_type === itemType && r.item_id === itemId);
}

// Build the source list a Claude prompt may cite, and map ids back to citations.
export function sourcePack(store, query, { collection = null, k = 8, factKeys = null } = {}) {
  const facts = store.all('facts', (f) => !factKeys || factKeys.includes(f.key));
  const hits = search(store, query, { collection, k });
  const sources = [
    ...facts.map((f) => ({ id: f.id, text: `${f.label}: ${f.statement || f.value}`, cite: factCitation(store, f.key) })),
    ...hits.map((h) => ({ id: h.chunk.id, text: `${h.doc.title}${h.chunk.section ? ' · ' + h.chunk.section : ''}\n${h.chunk.text}`, cite: chunkCitation(h) })),
  ];
  return {
    sources,
    render: () => sources.map((s) => `<source id="${s.id}">\n${s.text}\n</source>`).join('\n'),
    toCitations: (ids) => [...new Set(ids)].map((id) => sources.find((s) => s.id === id)?.cite).filter(Boolean),
  };
}

export const CITATION_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    source_ids: { type: 'array', items: { type: 'string' } },
  },
  required: ['text', 'source_ids'],
  additionalProperties: false,
};

export const WRITER_RULES = `Rules you must follow:
- Use only facts found in the sources. Quote numbers exactly as the sources state them. Never invent programs, numbers, partners, prices or budgets.
- Return the ids of every source you used in source_ids.
- Person-first, stigma-free language. No scare tactics or graphic content.
- Young people are trained community responders, never medical providers.
- When describing an overdose response, "call 911" always comes first.
- Plain, warm, hopeful voice. Short sentences.`;

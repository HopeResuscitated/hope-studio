// Audit log: every agent action, approval, send and post, with a before/after
// snapshot. Board and funder reporting read from here.

const HEAVY = new Set(['text', 'body', 'embedding', 'caption_ig', 'caption_fb', 'thumb', 'frames', 'content']);

function snapshot(row) {
  if (!row) return null;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (HEAVY.has(k) && typeof v === 'string' && v.length > 280) out[k] = v.slice(0, 280) + '…';
    else if (k === 'thumb' || k === 'frames') continue;
    else out[k] = v;
  }
  return out;
}

export function actorName(actor) {
  if (!actor) return 'system';
  if (typeof actor === 'string') return actor;
  return actor.name || actor.id || 'system';
}

export function audit(store, { actor, action, item_type = null, item_id = null, before = null, after = null, run_id = null, note = '' }) {
  return store.insert('audit_log', {
    actor: actorName(actor),
    actor_id: typeof actor === 'object' && actor ? actor.id || null : null,
    action,
    item_type,
    item_id,
    before: snapshot(before),
    after: snapshot(after),
    run_id,
    note,
  });
}

export function raiseAlert(store, { level = 'warning', title, detail = '', agent = null, run_id = null }) {
  return store.insert('alerts', { level, title, detail, agent, run_id, resolved: false });
}

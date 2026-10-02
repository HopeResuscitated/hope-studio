// In-memory tables with a pluggable persistence adapter.
// The server persists to a JSON file; the browser demo persists to localStorage.
//
// Write guards run on every insert and update. They are the data-layer half of
// the approval guarantee: no code path can mark an email sent, a post published
// or a grant draft exported unless a human-approved approval item exists.

import { TABLES, APPROVAL_TRANSITIONS } from './schema.js';
import { uid, clone } from './util.js';

const PREFIX = {
  users: 'usr', runs: 'run', review_results: 'rev', approval_items: 'apv', audit_log: 'aud',
  documents: 'doc', chunks: 'chk', facts: 'fct', grants: 'gr', grant_drafts: 'gd', draft_answers: 'ans',
  prospects: 'pr', contacts: 'ct', messages: 'msg', partnerships: 'ps', media_assets: 'med', posts: 'pst',
  month_copies: 'mc', prompts: 'pmt', suppressions: 'sup', kb_gaps: 'gap', alerts: 'alr',
};

export function createStore(adapter = {}) {
  let data = null;
  let version = 0;
  let saveTimer = null;
  const guards = [];

  function empty() {
    const tables = {};
    for (const t of TABLES) tables[t] = [];
    return { schema: 1, tables, settings: {}, meta: {} };
  }

  function load() {
    const loaded = adapter.load ? adapter.load() : null;
    data = loaded && loaded.tables ? loaded : empty();
    for (const t of TABLES) data.tables[t] ||= [];
    data.settings ||= {};
    data.meta ||= {};
    return !!(loaded && loaded.tables && loaded.meta?.seeded);
  }

  function scheduleSave() {
    version++;
    if (!adapter.save) return;
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      adapter.save(data);
    }, 50);
  }

  function flush() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (adapter.save) adapter.save(data);
  }

  const table = (name) => {
    if (!data.tables[name]) throw new Error(`Unknown table ${name}`);
    return data.tables[name];
  };

  function check(name, before, after) {
    for (const g of guards) g(name, before, after, api);
  }

  const api = {
    load,
    flush,
    get version() { return version; },
    get raw() { return data; },
    replace(next) { data = next; for (const t of TABLES) data.tables[t] ||= []; scheduleSave(); },
    reset() { data = empty(); scheduleSave(); },
    addGuard(fn) { guards.push(fn); },

    all(name, pred) {
      const rows = table(name);
      return pred ? rows.filter(pred) : rows.slice();
    },
    find(name, pred) { return table(name).find(pred) || null; },
    get(name, id) { return id ? table(name).find((r) => r.id === id) || null : null; },
    count(name, pred) { return pred ? table(name).filter(pred).length : table(name).length; },

    insert(name, row) {
      const now = new Date().toISOString();
      const rec = { id: row.id || uid(PREFIX[name] || name), created_at: now, updated_at: now, ...row };
      check(name, null, rec);
      table(name).push(rec);
      scheduleSave();
      return rec;
    },

    update(name, id, patch) {
      const rows = table(name);
      const i = rows.findIndex((r) => r.id === id);
      if (i < 0) throw new Error(`${name} ${id} not found`);
      const before = rows[i];
      const after = { ...before, ...patch, id, updated_at: new Date().toISOString() };
      check(name, before, after);
      rows[i] = after;
      scheduleSave();
      return after;
    },

    remove(name, id) {
      const rows = table(name);
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) { rows.splice(i, 1); scheduleSave(); }
    },

    removeWhere(name, pred) {
      const rows = table(name);
      const keep = rows.filter((r) => !pred(r));
      if (keep.length !== rows.length) { data.tables[name] = keep; scheduleSave(); }
    },

    settings() { return data.settings; },
    setSettings(patch) { data.settings = { ...data.settings, ...clone(patch) }; scheduleSave(); return data.settings; },
    meta() { return data.meta; },
    setMeta(patch) { data.meta = { ...data.meta, ...patch }; scheduleSave(); },
  };

  installCoreGuards(api);
  return api;
}

// ---------------------------------------------------------------------------
// Guards

function approvalFor(store, itemType, itemId) {
  return store.find('approval_items', (a) => a.item_type === itemType && a.item_id === itemId);
}

function requireApproved(store, itemType, itemId, what) {
  const a = approvalFor(store, itemType, itemId);
  if (!a || !['approved', 'executed'].includes(a.state)) {
    throw new GuardError(`${what} needs a person's approval first.`);
  }
}

export class GuardError extends Error {
  constructor(msg) { super(msg); this.name = 'GuardError'; this.status = 403; }
}

function installCoreGuards(store) {
  store.addGuard((name, before, after) => {
    if (name === 'approval_items' && before && before.state !== after.state) {
      const allowed = APPROVAL_TRANSITIONS[before.state] || [];
      if (!allowed.includes(after.state)) {
        throw new GuardError(`An item can't move from ${before.state} to ${after.state}.`);
      }
      if (after.state === 'approved') {
        const user = store.get('users', after.decided_by);
        if (!user || !['admin', 'approver'].includes(user.role)) {
          throw new GuardError('Only Leila or Cierra can approve. Agents never approve their own work.');
        }
      }
    }
    if (name === 'approval_items' && !before && ['approved', 'executed'].includes(after.state)) {
      throw new GuardError('New items start as drafts. Approval is a separate step.');
    }
    if (name === 'messages' && after.status === 'sent' && before?.status !== 'sent') {
      requireApproved(store, 'message', after.id, 'Sending an email');
    }
    if (name === 'posts' && ['scheduled', 'published'].includes(after.status) && before?.status !== after.status) {
      requireApproved(store, 'post', after.id, 'Scheduling or publishing a post');
    }
    if (name === 'grant_drafts' && ['exported', 'ready', 'submitted'].includes(after.status) && before?.status !== after.status) {
      requireApproved(store, 'grant_draft', after.id, 'Exporting or marking a grant draft ready');
    }
  });
}

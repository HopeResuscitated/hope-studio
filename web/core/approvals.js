// Approvals inbox. Every draft becomes an approval item that moves through
// drafted → in_review → needs_you → approved → executed (rejected and snoozed
// are exits). Only a person with the admin or approver role can approve, and
// the store guards refuse execution without an approved item.

import { audit } from './audit.js';
import { GuardError } from './store.js';

export function approvalFor(store, itemType, itemId) {
  return store.find('approval_items', (a) => a.item_type === itemType && a.item_id === itemId);
}

export function openApproval(ctx, { item_type, item_id, agent, title, summary = '', run_id = null }) {
  const { store } = ctx;
  const existing = approvalFor(store, item_type, item_id);
  if (existing) {
    if (existing.state === 'executed') return existing;
    return store.update('approval_items', existing.id, { title, summary, agent });
  }
  const row = store.insert('approval_items', {
    item_type, item_id, agent, title, summary, state: 'drafted', assigned_to: null,
    decided_by: null, decided_at: null, run_id, flags: 0, blocking: 0, snooze_until: null,
  });
  audit(store, { actor: ctx.actor, action: 'approval.create', item_type, item_id, after: row, run_id });
  return row;
}

export function transition(ctx, approvalId, to, { note = '', patch = {} } = {}) {
  const { store, actor } = ctx;
  const before = store.get('approval_items', approvalId);
  if (!before) throw new Error('Approval item not found');
  if (before.state === to) return before;
  const after = store.update('approval_items', approvalId, { state: to, ...patch });
  audit(store, { actor, action: `approval.${to}`, item_type: before.item_type, item_id: before.item_id, before, after, note });
  return after;
}

// Called after the Reviewer stores its results. Moves the item to "needs you".
export function afterReview(ctx, approvalId, results) {
  const { store } = ctx;
  let a = store.get('approval_items', approvalId);
  const flags = results.filter((r) => r.result === 'flag').length;
  const blocking = results.filter((r) => r.result === 'flag' && r.blocking).length;
  if (a.state === 'drafted' || a.state === 'rejected') a = transition(ctx, a.id, 'in_review');
  if (a.state === 'approved') a = transition(ctx, a.id, 'in_review', { note: 'Edited after approval' });
  if (a.state === 'in_review') a = transition(ctx, a.id, 'needs_you');
  return store.update('approval_items', a.id, { flags, blocking, reviewed_at: new Date().toISOString() });
}

export function requireApprover(actor) {
  if (!actor || !['admin', 'approver'].includes(actor.role)) {
    throw new GuardError('Only Leila or Cierra can approve.');
  }
}

export function approve(ctx, approvalId) {
  const { store, actor } = ctx;
  requireApprover(actor);
  const a = store.get('approval_items', approvalId);
  if (!a) throw new Error('Approval item not found');
  if (a.state === 'approved' || a.state === 'executed') return a;
  const policy = store.settings().approval_policy || 'any_approver';
  if (policy === 'admin_required' && actor.role !== 'admin') {
    throw new GuardError('Settings require Leila to approve this.');
  }
  if (a.blocking > 0) {
    throw new GuardError(`Fix the ${a.blocking === 1 ? 'blocking flag' : a.blocking + ' blocking flags'} first. Reviewer shows what to change.`);
  }
  if (a.state === 'snoozed' || a.state === 'in_review') transition(ctx, a.id, 'needs_you');
  return transition(ctx, a.id, 'approved', { patch: { decided_by: actor.id, decided_at: new Date().toISOString() } });
}

export function reject(ctx, approvalId, note = '') {
  requireApprover(ctx.actor);
  return transition(ctx, approvalId, 'rejected', { note, patch: { decided_by: ctx.actor.id, decided_at: new Date().toISOString() } });
}

export function snooze(ctx, approvalId, days = 3) {
  requireApprover(ctx.actor);
  const until = new Date(Date.now() + days * 86400000).toISOString();
  return transition(ctx, approvalId, 'snoozed', { patch: { snooze_until: until } });
}

export function wakeSnoozed(ctx) {
  const now = new Date().toISOString();
  for (const a of ctx.store.all('approval_items', (x) => x.state === 'snoozed' && x.snooze_until && x.snooze_until <= now)) {
    transition({ ...ctx, actor: 'scheduler' }, a.id, 'needs_you', { note: 'Snooze ended' });
  }
}

export function markExecuted(ctx, itemType, itemId, result = {}) {
  const a = approvalFor(ctx.store, itemType, itemId);
  if (!a) throw new GuardError('No approval item for this action.');
  if (a.state === 'executed') return ctx.store.update('approval_items', a.id, { result: { ...(a.result || {}), ...result } });
  if (a.state !== 'approved') throw new GuardError('The Executor only acts on approved items.');
  return transition(ctx, a.id, 'executed', { patch: { executed_at: new Date().toISOString(), result } });
}

// Executor gate: re-reads the approval from the store right before acting.
export function assertApproved(store, itemType, itemId) {
  const a = approvalFor(store, itemType, itemId);
  if (!a || !['approved', 'executed'].includes(a.state)) {
    throw new GuardError('Waiting for a person to approve this.');
  }
  return a;
}

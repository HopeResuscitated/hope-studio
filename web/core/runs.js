// Run logger with a cost guard. Every agent run records its trigger, status,
// token use and cost; a run that exceeds its budget stops and alerts the admin.

import { audit, raiseAlert } from './audit.js';
import { PRICES } from './schema.js';

export class BudgetExceeded extends Error {
  constructor(run) {
    super(`Run stopped: it reached its $${Number(run.budget_usd).toFixed(2)} budget.`);
    this.name = 'BudgetExceeded';
  }
}

export function startRun(ctx, agent, trigger) {
  const budget = ctx.store.settings().run_budget_usd ?? 3;
  const run = ctx.store.insert('runs', {
    agent, trigger, started_at: new Date().toISOString(), finished_at: null, status: 'running',
    cost_usd: 0, tokens_in: 0, tokens_out: 0, budget_usd: budget, log: [], actor: typeof ctx.actor === 'object' ? ctx.actor?.name : ctx.actor,
  });
  return { ...ctx, run };
}

export function logRun(ctx, line) {
  if (!ctx.run) return;
  const run = ctx.store.get('runs', ctx.run.id);
  ctx.store.update('runs', run.id, { log: [...(run.log || []), { at: new Date().toISOString(), line }] });
}

export function finishRun(ctx, status = 'succeeded', summary = '') {
  if (!ctx.run) return null;
  const run = ctx.store.update('runs', ctx.run.id, { status, finished_at: new Date().toISOString(), summary });
  audit(ctx.store, { actor: ctx.actor, action: `run.${status}`, item_type: 'run', item_id: run.id, after: run, run_id: run.id, note: summary });
  if (status === 'failed' || status === 'stopped_budget') {
    raiseAlert(ctx.store, { level: 'critical', title: status === 'stopped_budget' ? `${run.agent} run stopped at its budget` : `${run.agent} run failed`, detail: summary, agent: run.agent, run_id: run.id });
  }
  return run;
}

export function costOf(model, usage) {
  const [pin, pout] = PRICES[model] || [5, 25];
  const input = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) * 1.25 + (usage.cache_read_input_tokens || 0) * 0.1;
  return (input * pin + (usage.output_tokens || 0) * pout) / 1e6;
}

export function recordUsage(store, runRef, model, usage) {
  if (!runRef) return;
  const run = store.get('runs', runRef.id);
  if (!run) return;
  store.update('runs', run.id, {
    tokens_in: run.tokens_in + (usage.input_tokens || 0),
    tokens_out: run.tokens_out + (usage.output_tokens || 0),
    cost_usd: +(run.cost_usd + costOf(model, usage)).toFixed(5),
  });
}

export function checkBudget(store, runRef) {
  if (!runRef) return;
  const run = store.get('runs', runRef.id);
  if (run && run.budget_usd && run.cost_usd >= run.budget_usd) throw new BudgetExceeded(run);
}

export async function withRun(ctx, agent, trigger, fn) {
  const rctx = startRun(ctx, agent, trigger);
  try {
    const summary = await fn(rctx);
    finishRun(rctx, 'succeeded', typeof summary === 'string' ? summary : summary?.summary || '');
    return { run: rctx.store.get('runs', rctx.run.id), result: summary };
  } catch (err) {
    finishRun(rctx, err instanceof BudgetExceeded ? 'stopped_budget' : 'failed', err.message);
    throw err;
  }
}

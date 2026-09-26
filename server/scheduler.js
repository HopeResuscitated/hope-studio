// Scheduler (Central time). Checks once a minute; each job records the last
// period it ran so a restart catches up the same day without running twice.
//
//   Weekly agent run   Mondays 6:00 AM   Grant and Outreach Scouts, Writers, Reviewers
//   Social planner     Daily 5:00 AM     Fill open calendar slots from unused media
//   Publish queue      Every 5 minutes   Post approved social items whose time has passed
//   Follow-up check    Daily 8:00 AM     Reply detection, day-7 follow-ups
//   Deadline watch     Daily 7:00 AM     Flag grants due within 14 days
//   Backup             Daily 2:00 AM     Copy the data file, keep 14

import { central } from '../web/core/util.js';

const JOBS = [
  { name: 'weeklyRun', due: (c) => c.weekday === 1 && c.hour >= 6, period: (c) => `${c.year}-${c.month}-${c.day}` },
  { name: 'socialPlanner', due: (c) => c.hour >= 5, period: (c) => `${c.year}-${c.month}-${c.day}` },
  { name: 'publishQueue', due: () => true, period: (c) => `${c.year}-${c.month}-${c.day}-${c.hour}-${Math.floor(c.minute / 5)}` },
  { name: 'followUpCheck', due: (c) => c.hour >= 8, period: (c) => `${c.year}-${c.month}-${c.day}` },
  { name: 'deadlineWatch', due: (c) => c.hour >= 7, period: (c) => `${c.year}-${c.month}-${c.day}` },
  { name: 'wakeSnoozed', due: () => true, period: (c) => `${c.year}-${c.month}-${c.day}-${c.hour}` },
  { name: 'backup', due: (c) => c.hour >= 2, period: (c) => `${c.year}-${c.month}-${c.day}` },
];

export function startScheduler({ service, store, extraJobs = {}, onError, log = console.log }) {
  const running = new Set();
  async function tick() {
    const c = central(new Date());
    const last = store.meta().jobs || {};
    for (const job of JOBS) {
      const period = job.period(c);
      if (!job.due(c) || last[job.name] === period || running.has(job.name)) continue;
      const fn = extraJobs[job.name] || service.jobs[job.name];
      if (!fn) continue;
      running.add(job.name);
      store.setMeta({ jobs: { ...(store.meta().jobs || {}), [job.name]: period } });
      try {
        const out = await fn('scheduler');
        if (job.name !== 'publishQueue' && job.name !== 'wakeSnoozed') log(`[scheduler] ${job.name} done`, typeof out === 'number' ? out : '');
      } catch (err) {
        log(`[scheduler] ${job.name} failed: ${err.message}`);
        onError?.(job.name, err);
      } finally {
        running.delete(job.name);
      }
    }
  }
  const timer = setInterval(tick, 60000);
  setTimeout(tick, 5000);
  return () => clearInterval(timer);
}

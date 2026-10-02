// Home: one page that answers "what needs me today?" and links to every area.

import { html, icon, ago, fdate, plural, toast } from '../ui.js';

const AREAS = [
  ['grant', 'Grants', 'g-week', 'doc', 'Find, draft and track funding'],
  ['outreach', 'Outreach', 'o-week', 'mail', 'Partners, contacts and email'],
  ['social', 'Social', 's-week', 'photo', 'Instagram and Facebook posts'],
];

const home = {
  title: 'Home',
  async load(app) {
    // The approvals list is the point of this page, so only it is required; each area degrades on its own.
    const inbox = await app.call('inbox');
    const [grants, outreach, social] = await Promise.all(['grantsWeek', 'outreachWeek', 'socialWeek'].map((m) => app.call(m).catch(() => null)));
    return { inbox, grants, outreach, social };
  },
  render(d, app) {
    const needs = d.inbox.rows.filter((r) => r.state === 'needs_you');
    const isApprover = ['admin', 'approver'].includes(app.me.user.role);
    const first = app.me.user.name.split(' ')[0];
    const hour = +new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Chicago' });
    const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const deadlines = d.grants?.deadlines || [];
    const calls = d.outreach?.upcoming || [];
    const posts = d.social?.next7 || [];
    const c = app.me.counts;
    const stat = {
      grant: d.grants ? `${d.grants.stats.found} found this month` : 'Open to see details',
      outreach: d.outreach ? `${d.outreach.stats.prospects} prospects this month` : 'Open to see details',
      social: d.social ? `${d.social.stats.scheduled} of ${d.social.stats.total} posts scheduled` : 'Open to see details',
    };
    return html`
    <header class="page-head">
      <div class="head-text"><span class="eyebrow">${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Chicago' })}</span>
        <h1>${hello}, ${first}.</h1>
        <p class="lede">${needs.length ? `${plural(needs.length, 'item')} waiting for your OK.` : 'Nothing is waiting on you.'}${c.alerts ? ` ${plural(c.alerts, 'alert')} to look at.` : ''}</p></div>
      <button type="button" class="btn btn-primary" data-action="runAgents" data-agent="all">${icon('play', 16)} Run all agents</button>
    </header>

    ${app.me.needs_address ? html`<div class="banner">${icon('alert')}<span class="grow"><strong>Add your mailing address.</strong> Outreach email can't send without it.</span><a class="btn btn-sm" href="#settings">Open settings</a></div>` : ''}

    <section class="home-areas" aria-label="Areas">
      ${AREAS.map(([key, label, route, ic, sub]) => html`<a class="area-card" href="#${route}">
        <span class="area-icon">${icon(ic, 22)}</span>
        <span class="area-text"><strong>${label}</strong><small>${sub}</small><small class="area-stat">${stat[key]}</small></span>
        ${c[key] ? html`<span class="badge" aria-label="${c[key]} waiting">${c[key]}</span>` : ''}
      </a>`)}
    </section>

    <div class="quick-actions" role="group" aria-label="Quick actions">
      <a class="btn" href="#s-composer">${icon('plus', 16)} New post</a>
      <a class="btn" href="#o-contacts">${icon('plus', 16)} Add contact</a>
      <a class="btn" href="#g-scout">${icon('search', 16)} Find grants</a>
      <a class="btn" href="#g-kb">${icon('doc', 16)} Knowledge base</a>
    </div>

    <div class="cols">
      <section class="col-main" aria-labelledby="needs-h">
        <div class="row between"><h2 class="section-title" id="needs-h">Needs your OK ${needs.length ? html`<span class="count">${needs.length}</span>` : ''}</h2>${needs.length > 6 ? html`<a class="link-btn" href="#inbox">See all</a>` : ''}</div>
        ${needs.length ? html`<div class="card home-list">${needs.slice(0, 6).map((r) => html`<div class="home-row">
          <div class="grow"><button type="button" class="link-btn strong" data-action="go" data-route="${r.link.route}" data-id="${r.link.id}">${r.title}</button>
            <div class="muted small">${r.agent_label} · ${ago(r.updated_at)}${r.detail?.when ? ` · ${fdate(r.detail.when, { time: true })}` : ''}${r.detail?.to ? ` · to ${r.detail.to}` : ''}${r.blocking ? ` · ${plural(r.blocking, 'thing')} to fix first` : ''}</div></div>
          ${isApprover && r.agent === 'social' && !r.blocking ? html`<button type="button" class="btn btn-sm btn-primary" data-action="homeApprove" data-id="${r.id}">Approve</button>`
    : html`<button type="button" class="btn btn-sm" data-action="go" data-route="${r.link.route}" data-id="${r.link.id}">Review</button>`}
        </div>`)}</div>` : html`<div class="card"><p class="muted">All clear. New drafts show up here as the agents finish them.</p></div>`}
      </section>

      <aside class="col-side" aria-labelledby="soon-h">
        <h2 class="section-title" id="soon-h">Coming up</h2>
        <div class="card home-list">
          ${deadlines.map((g) => html`<div class="home-row"><span class="chip-dot">${icon('doc', 16)}</span><div class="grow"><strong>${g.title}</strong><div class="muted small">Grant due in ${plural(g.days, 'day')} · ${g.funder}</div></div></div>`)}
          ${calls.slice(0, 3).map((p) => html`<div class="home-row"><span class="chip-dot">${icon('mail', 16)}</span><div class="grow"><strong>${p.name || p.company || 'Partner follow-up'}</strong><div class="muted small">Outreach · ${fdate(p.next_date, { weekday: false })}</div></div></div>`)}
          ${posts.slice(0, 4).map((p) => html`<div class="home-row"><span class="chip-dot">${icon('photo', 16)}</span><div class="grow"><strong>${p.pillar || 'Post'}</strong><div class="muted small">Social · ${fdate(p.scheduled_at, { time: true })}</div></div></div>`)}
          ${!deadlines.length && !calls.length && !posts.length ? html`<p class="muted small">Nothing scheduled in the next week.</p>` : ''}
        </div>
      </aside>
    </div>`;
  },
  actions: {
    async homeApprove(el, app) {
      const r = await app.call('approve', { id: el.dataset.id });
      toast(r?.status === 'scheduled' ? 'Approved and scheduled' : 'Approved');
      app.refresh();
    },
  },
};

export default { home };

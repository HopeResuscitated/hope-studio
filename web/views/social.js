// Social Studio: This week · Media library · Post composer · Calendar · Copy month

import { html, icon, chip, pillarChip, fdate, ct, dialog, field, toast, when, plural, thumb, time12, stateChip } from '../ui.js';
import { checksList, fixBoxes, sourcesRow } from './grants.js';

const PILLARS = ['Educate', 'Equip', 'Empower', 'Respond', 'Lead'];
const PLATFORM = (p) => (p.platforms || []).map((x) => (x === 'instagram' ? (p.media?.kind === 'video' ? 'IG Reel' : 'IG') : (p.media?.kind === 'video' ? 'FB video' : 'FB'))).join(' + ');

// ---------- Reading media in the browser: a thumbnail, and video frames every 2 s ----------

function drawToJpeg(src, w, h, max = 640) {
  const scale = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.72);
}

async function readImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { thumb: drawToJpeg(img, img.naturalWidth, img.naturalHeight, 480), frames: [drawToJpeg(img, img.naturalWidth, img.naturalHeight, 1024)], aspect: img.naturalWidth / img.naturalHeight };
  } catch {
    return { thumb: null, frames: [] }; // HEIC and other formats the browser can't draw
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function readVideo(file) {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.src = url;
  try {
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('unreadable')); setTimeout(res, 8000); });
    const dur = v.duration || 0;
    const frames = [];
    const times = [];
    for (let t = 0.5; t < dur && times.length < 12; t += 2) times.push(t);
    if (!times.length) times.push(0);
    for (const t of times) {
      v.currentTime = t;
      await new Promise((res) => { v.onseeked = res; setTimeout(res, 3000); });
      frames.push(drawToJpeg(v, v.videoWidth, v.videoHeight, 640));
    }
    return { thumb: frames[0] || null, frames, duration_s: dur, aspect: v.videoWidth / v.videoHeight };
  } catch {
    return { thumb: null, frames: [] };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------------------------------------------------------------------------

const week = {
  title: 'Social · This week',
  load: (app) => app.call('socialWeek'),
  render(d) {
    const pct = d.stats.total ? Math.round((d.stats.scheduled / d.stats.total) * 100) : 0;
    const onTrack = d.stats.scheduled >= d.stats.total - d.open.length && !d.flagged.length;
    return html`
    <header class="page-head">
      <div class="head-text">
        <span class="eyebrow">Social · ${d.month}</span>
        <h1>${d.stats.needsOk ? `${plural(d.stats.needsOk, 'post needs', 'posts need')} your OK.` : onTrack ? "You're on track." : 'A few slots need media.'}</h1>
      </div>
      ${d.clean ? html`<button type="button" class="btn btn-primary" data-action="approveClean">${icon('check', 16)} Approve ${d.clean} clean ${d.clean === 1 ? 'post' : 'posts'}</button>`
    : html`<button type="button" class="btn btn-primary" data-action="go" data-route="s-library">${icon('upload', 16)} Add photos &amp; videos</button>`}
    </header>
    <p class="statline" aria-label="Progress"><span><b>${d.stats.scheduled} of ${d.stats.total}</b> ${d.month} posts scheduled</span><span><b>${d.stats.weeks}</b> weeks on plan in a row</span><span><b>${d.stats.unused}</b> unused in library</span></p>
    <div class="bar bar-wide" role="img" aria-label="${pct}% scheduled"><span style="width:${pct}%"></span></div>
    <div class="cols review-first">
      <section class="col-main" aria-labelledby="n7-h">
        <h2 class="section-title" id="n7-h">Next 7 days</h2>
        ${d.next7.length ? d.next7.map((p) => html`
        <button type="button" class="card post-row" data-action="go" data-route="s-composer" data-id="${p.id}">
          ${thumb(p.media, 'thumb-96')}
          <span class="grow stack-xs">
            <span class="mono-label info-text">${fdate(p.scheduled_at, { time: true })} · ${PLATFORM(p)}</span>
            <span class="post-title">${p.title}</span>
            <span class="muted small">${p.media?.kind === 'video' ? 'Video' : 'Photo'} · ${p.media?.subject || p.media?.label || ''} · "${(p.caption_ig || '').split('\n')[0].slice(0, 70)}${(p.caption_ig || '').split('\n')[0].length > 70 ? '…' : ''}"</span>
          </span>
          <span class="stack-xs end">${pillarChip(p.pillar)}${p.status === 'published' ? chip('Posted', 'good') : p.status === 'scheduled' ? chip('Scheduled', 'good') : p.blocking ? chip('Needs a fix', 'warn') : chip('Needs your OK', 'warn')}</span>
        </button>`) : html`<div class="empty"><p>Nothing scheduled in the next 7 days.</p></div>`}
      </section>
      <aside class="col-side" aria-labelledby="ok-h">
        <h2 class="section-title" id="ok-h">Needs your OK</h2>
        ${d.flagged.map((f) => html`<div class="card note-card">
          ${f.flags.map((x) => html`<span class="chip chip-warn">${x.check === 'consent' ? 'People in frame' : x.label}</span>`)}
          <p class="small">${f.post.title} · ${fdate(f.post.scheduled_at, { weekday: true })}. ${f.flags[0]?.suggestion}</p>
          <button type="button" class="link-btn" data-action="go" data-route="s-composer" data-id="${f.post.id}">Open post</button>
        </div>`)}
        ${d.clean ? html`<div class="card note-card"><span class="chip chip-good">${plural(d.clean, 'post')} passed every check</span>
          <p class="small">Reviewer found nothing to fix. Approving schedules them; nothing goes live before its time.</p>
          <div class="row gap-s wrap"><button type="button" class="btn btn-primary btn-sm" data-action="approveClean">Approve ${d.clean}</button><button type="button" class="link-btn" data-action="go" data-route="s-calendar">Review on calendar</button></div></div>` : ''}
        ${d.open.length ? html`<div class="card note-card"><span class="chip chip-warn">${plural(d.open.length, 'open slot')}</span>
          <p class="small">No media yet. The library is low on ${d.lowPillar} content, so add a photo or two.</p>
          <div class="slot-chips">${d.open.slice(0, 6).map((o) => html`<span class="slot-chip">${fdate(o.date, { weekday: false })}</span>`)}${d.open.length > 6 ? html`<span class="slot-chip more">+${d.open.length - 6} more</span>` : ''}</div>
          <div class="row gap-s wrap"><button type="button" class="btn btn-sm" data-action="autofill">Auto-fill</button><button type="button" class="link-btn" data-action="go" data-route="s-calendar">View calendar</button></div></div>` : ''}
        ${!d.flagged.length && !d.clean && !d.open.length ? html`<div class="card note-card"><p class="small">Nothing needs you right now.</p></div>` : ''}
      </aside>
    </div>`;
  },
  actions: {
    async approveClean(el, app) {
      const r = await app.call('approveCleanPosts', {});
      toast(`${plural(r.approved, 'post')} scheduled`);
      app.refresh();
    },
    async autofill(el, app) {
      const r = await app.call('autofill', {});
      toast(r.created ? `Drafted ${plural(r.created, 'post')}. ${r.open ? `${r.open} still open.` : ''}` : 'No unused media fits those slots. Upload some first.', r.created ? 'good' : 'info');
      app.refresh();
    },
  },
};

// ---------------------------------------------------------------------------

// The details sheet (phones) is only open during a visit: it closes whenever you navigate.
let libSheetOpen = false;
window.addEventListener('hashchange', () => { libSheetOpen = false; });

const library = {
  title: 'Social · Library',
  async load(app) {
    const d = await app.call('library', { filter: app.pref('mediaFilter', 'all') });
    d.prompts = await app.call('prompts').then((r) => r.prompts).catch(() => []);
    return d;
  },
  render(d, app) {
    const f = app.pref('mediaFilter', 'all');
    const tab = app.pref('libTab', 'media');
    const sel = d.media.find((m) => m.id === app.sel('s-library')) || d.media[0];
    return html`
    <header class="page-head">
      <div class="head-text"><span class="eyebrow">${plural(d.total, 'photo or video', 'photos and videos')} · ${plural(d.prompts.length, 'prompt')}</span><h1>Library</h1></div>
      ${tab === 'media' ? html`<button type="button" class="btn btn-primary" data-action="autofill"${d.open ? '' : ' disabled'}>Auto-schedule ${d.open ? plural(d.open, 'open slot') : 'open slots'}</button>`
    : html`<button type="button" class="btn btn-primary" data-action="editPrompt">${icon('plus', 16)} New prompt</button>`}
    </header>
    <div class="filters" role="group" aria-label="Library section">
      <button type="button" aria-pressed="${tab === 'media'}" data-action="setPref" data-key="libTab" data-value="media">Photos &amp; videos</button>
      <button type="button" aria-pressed="${tab === 'prompts'}" data-action="setPref" data-key="libTab" data-value="prompts">Prompts <span class="count">${d.prompts.length}</span></button>
    </div>
    ${tab === 'prompts' ? promptsPanel(d, sel) : html`
    <label class="dropzone" data-drop="upload">
      <span class="dz-icon">${icon('upload', 28)}</span>
      <span class="grow stack-xs"><strong>Drop photos and videos here</strong><span class="muted small">JPG, PNG, HEIC, MP4 or MOV. The agent tags each one by content pillar and flags anything with people in frame.</span></span>
      <span class="btn">Browse files</span>
      <input type="file" multiple accept="image/*,video/*" class="sr-only" data-change="upload">
    </label>
    <div class="cols">
      <section class="col-main" aria-label="Media">
        <div class="filters" role="group" aria-label="Filter media">
          ${[['all', 'All'], ['unused', 'Unused'], ['photos', 'Photos'], ['videos', 'Videos'], ['scheduled', 'Scheduled'], ['consent', 'Needs consent']].map(([k, l]) => html`<button type="button" aria-pressed="${f === k}" data-action="setPref" data-key="mediaFilter" data-value="${k}">${l}</button>`)}
        </div>
        <div class="media-grid">
          ${d.media.map((m) => html`<button type="button" class="media-card ${sel && m.id === sel.id ? 'current' : ''}" data-action="selectMedia" data-id="${m.id}">
            ${thumb(m)}
            <span class="media-label">${m.label}</span>
            <span class="media-foot">${pillarChip(m.pillar)}<span class="small ${m.uses.length ? 'good-text' : 'muted'}">${m.uses.length ? `Posts ${fdate(m.uses[0].when, { weekday: false })}` : 'Unused'}</span></span>
          </button>`)}
          ${!d.media.length ? html`<p class="muted">Nothing here yet.</p>` : ''}
        </div>
      </section>
      ${sel ? html`<div class="lib-scrim ${libSheetOpen ? 'open' : ''}" data-action="closeSheet" aria-hidden="true"></div>
      <aside class="col-side card lib-sheet ${libSheetOpen ? 'open' : ''}" aria-label="Selected item">
        <button type="button" class="btn btn-sm sheet-close" data-action="closeSheet">${icon('close', 16)} Close</button>
        ${sel.thumb ? html`<img class="preview" src="${sel.thumb}" alt="${sel.subject || sel.label}">` : html`<div class="preview ph">${sel.kind === 'video' ? 'Video' : 'Photo'}${sel.duration_s ? ` · 0:${String(Math.round(sel.duration_s)).padStart(2, '0')}` : ''} · ${sel.label}</div>`}
        <h2 class="section-title">What the agent sees</h2>
        <dl class="dl">
          <div><dt>Pillar</dt><dd><label class="sr-only" for="pillar-sel">Pillar</label><select id="pillar-sel" data-change="setPillar" data-id="${sel.id}">${PILLARS.map((p) => html`<option${p === sel.pillar ? ' selected' : ''}>${p}</option>`)}</select></dd></div>
          <div><dt>Subject</dt><dd>${sel.subject || '—'}</dd></div>
          <div><dt>Best format</dt><dd>${sel.format_fit || '—'}</dd></div>
          <div><dt>Scheduled</dt><dd>${sel.uses.length ? sel.uses.map((u) => fdate(u.when, { time: true })).join('; ') : 'Not yet'}</dd></div>
          <div><dt>People in frame</dt><dd class="${sel.needsConsent ? 'warn-text' : ''}">${sel.people_in_frame === false ? 'No' : sel.consent_confirmed ? `Yes · release on file${sel.release_location ? ` (${sel.release_location})` : ''}` : sel.people_in_frame ? 'Yes, confirm OK' : 'Not sure, confirm'}</dd></div>
          <div><dt>Tagged by</dt><dd>${sel.tag_source === 'vision' ? 'Claude (vision)' : sel.tag_source === 'sample' ? 'Sample data' : 'Filename (connect Claude for vision tags)'}</dd></div>
        </dl>
        ${sel.needsConsent ? html`<div class="fixbox"><p class="small">${sel.people_note || 'Confirm there are no people, or that you hold a signed release.'}</p><div class="row gap-s wrap"><button type="button" class="btn btn-primary btn-sm" data-action="consent" data-id="${sel.id}">I have permission</button><button type="button" class="btn btn-sm" data-action="noPeople" data-id="${sel.id}">No people in it</button></div></div>` : ''}
        <div class="row gap-s wrap">${sel.uses.length ? html`<button type="button" class="btn btn-primary" data-action="go" data-route="s-composer" data-id="${sel.uses[0].id}">Edit post</button>` : ''}${sel.uses.length ? '' : html`<button type="button" class="btn btn-primary" data-action="makePost" data-id="${sel.id}">${icon('plus', 16)} Make a post</button>`}<button type="button" class="btn" data-action="promptForMedia" data-id="${sel.id}">${icon('sparkle', 16)} Use a prompt</button><button type="button" class="btn btn-ghost" data-action="exclude" data-id="${sel.id}">Don't use</button></div>
      </aside>` : ''}
    </div>`}`;
  },
  actions: {
    async usePrompt(el, app) {
      const media = (await app.call('library', { filter: 'all' })).media;
      if (!media.length) return toast('Add a photo or video first.', 'bad');
      const cur = app.sel('s-library');
      const d = await dialog({
        title: 'Use this prompt', submit: 'Draft the post',
        body: html`<p class="muted small">${el.dataset.text}</p>${field('Photo or video', 'media_id', { value: media.some((m) => m.id === cur) ? cur : media[0].id, options: media.map((m) => [m.id, `${m.kind === 'video' ? 'Video' : 'Photo'} · ${m.label}`]) })}`,
      });
      if (!d) return;
      const r = await app.call('draftFromPrompt', { media_id: d.media_id, prompt_id: el.dataset.id });
      toast('Draft ready. Review it, then approve.');
      app.go('s-composer', r.id);
    },
    async editPrompt(el, app) {
      const cur = el.dataset.id ? (await app.call('prompts')).prompts.find((p) => p.id === el.dataset.id) : null;
      const d = await dialog({
        title: cur ? 'Edit prompt' : 'New prompt', submit: 'Save',
        body: html`${field('Name', 'label', { value: cur?.label || '', required: true, autofocus: true })}${field('What the post should say', 'text', { value: cur?.text || '', rows: 4, required: true, hint: 'The writer uses this with your knowledge base and the photo.' })}${field('Pillar', 'pillar', { value: cur?.pillar || 'Educate', options: PILLARS.map((p) => [p, p]) })}`,
      });
      if (!d) return;
      await app.call('savePrompt', { id: cur?.id, label: d.label, text: d.text, pillar: d.pillar });
      toast('Prompt saved');
      app.refresh();
    },
    async deletePrompt(el, app) {
      const ok = await dialog({ title: 'Delete this prompt?', submit: 'Delete', body: html`<p>It won't affect posts already drafted.</p>` });
      if (!ok) return;
      await app.call('deletePrompt', { id: el.dataset.id });
      toast('Prompt deleted');
      app.refresh();
    },
    selectMedia(el, app) { app.setSel('s-library', el.dataset.id); libSheetOpen = true; app.refresh(); },
    async makePost(el, app) {
      const r = await app.call('draftFromPrompt', { media_id: el.dataset.id });
      libSheetOpen = false;
      toast('Draft ready. Review it, then approve.');
      app.go('s-composer', r.id);
    },
    closeSheet(el, app) { libSheetOpen = false; app.refresh(); },
    async promptForMedia(el, app) {
      const { prompts } = await app.call('prompts');
      const d = await dialog({
        title: 'Pick a prompt', submit: 'Draft the post',
        body: field('Prompt', 'prompt_id', { value: prompts[0]?.id, options: prompts.map((p) => [p.id, `${p.pillar} · ${p.label}`]) }),
      });
      if (!d) return;
      const r = await app.call('draftFromPrompt', { media_id: el.dataset.id, prompt_id: d.prompt_id });
      toast('Draft ready. Review it, then approve.');
      libSheetOpen = false;
      app.go('s-composer', r.id);
    },
    async autofill(el, app) { const r = await app.call('autofill', {}); toast(`Drafted ${plural(r.created, 'post')}${r.open ? `; ${r.open} still open` : ''}`); app.refresh(); },
    async exclude(el, app) { await app.call('excludeMedia', { id: el.dataset.id }); toast("The agent won't use it"); app.refresh(); },
    async consent(el, app) { await consentDialog(app, el.dataset.id); },
    async noPeople(el, app) { await app.call('confirmConsent', { id: el.dataset.id, mode: 'no_people' }); toast('Marked: no people in frame'); app.refresh(); },
  },
  changes: {
    async setPillar(el, app) { await app.call('updateMedia', { id: el.dataset.id, pillar: el.value }); toast('Pillar updated'); app.refresh(); },
    upload: (el, app) => uploadFiles([...el.files], app),
  },
  drops: { upload: (files, app) => uploadFiles(files, app) },
};

function promptsPanel(d) {
  return html`<p class="muted small">Pick a prompt, pair it with a photo or video, and the writer drafts the post. It waits for your OK like everything else.</p>
  <div class="prompt-grid">${d.prompts.map((p) => html`<article class="card prompt-card">
    <div class="row between">${pillarChip(p.pillar)}<span class="row gap-xs">
      <button type="button" class="link-btn" data-action="editPrompt" data-id="${p.id}">Edit</button>
      <button type="button" class="link-btn" data-action="deletePrompt" data-id="${p.id}">Delete</button></span></div>
    <h2 class="section-title">${p.label}</h2>
    <p class="muted small">${p.text}</p>
    <button type="button" class="btn btn-sm btn-primary" data-action="usePrompt" data-id="${p.id}" data-text="${p.text}">Use with a photo or video</button>
  </article>`)}</div>`;
}

// Pick something from the library: unused items first, then what is already scheduled.
async function pickFromLibrary(app, { title, submit = 'Use this', current = null, extra = '' } = {}) {
  const { media } = await app.call('library', { filter: 'all' });
  if (!media.length) { toast('The library is empty. Add a photo or video first.', 'bad'); return null; }
  const unused = media.filter((m) => !m.uses.length);
  const used = media.filter((m) => m.uses.length);
  const card = (m) => html`<label class="pick"><input type="radio" name="media_id" value="${m.id}" ${when(m.id === current, 'checked')} required>
    <span class="pick-card">${thumb(m)}<span class="pick-name">${m.label}</span>
    <span class="pick-tag ${m.uses.length ? '' : 'new'}">${m.id === current ? 'On this post' : m.uses.length ? `Posts ${fdate(m.uses[0].when, { weekday: false })}` : 'Unused'}${m.needsConsent ? ' · needs release' : ''}</span></span></label>`;
  const d = await dialog({
    title, submit, wide: true,
    body: html`<p class="muted small">Tap one. If people are in it, a signed release is still needed before it can post.</p>
      ${unused.length ? html`<h3 class="mono-label">Unused (${unused.length})</h3><div class="pick-grid">${unused.map(card)}</div>` : ''}
      ${used.length ? html`<h3 class="mono-label">Already in a post (${used.length})</h3><div class="pick-grid">${used.map(card)}</div>` : ''}
      ${extra}`,
  });
  return d || null;
}

async function uploadFiles(files, app) {
  const list = files.filter((f) => /^(image|video)\//.test(f.type) || /\.(heic|mov|mp4)$/i.test(f.name));
  if (!list.length) return toast('Choose photo or video files.', 'bad');
  toast(`Tagging ${plural(list.length, 'file')}…`, 'info');
  let last = null;
  for (const file of list) {
    const kind = file.type.startsWith('video') || /\.(mov|mp4)$/i.test(file.name) ? 'video' : 'photo';
    const meta = kind === 'video' ? await readVideo(file) : await readImage(file);
    const file_url = await app.upload(file);
    last = await app.call('uploadMedia', { label: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '), kind, file_url, ...meta });
  }
  if (last) app.setSel('s-library', last.id);
  toast(`${plural(list.length, 'file')} added and tagged`);
  app.refresh();
}

async function consentDialog(app, mediaId) {
  const d = await dialog({
    title: 'Confirm permission to post', submit: 'Confirm',
    body: html`<p>People are visible in this media. Confirm that everyone shown (and a parent or guardian for anyone under 18) signed a release.</p>${field('Where the signed release is kept', 'release_location', { required: true, autofocus: true, placeholder: 'Drive › Releases › 2026' })}`,
  });
  if (!d) return;
  await app.call('confirmConsent', { id: mediaId, mode: 'release', release_location: d.release_location });
  toast('Release recorded. Reviewer re-checked every post using it.');
  app.refresh();
}

// ---------------------------------------------------------------------------

const composer = {
  title: 'Social · Post composer',
  async load(app) {
    const d = await app.call('post', { id: app.sel('s-composer') });
    if (d && d.post.id !== app.sel('s-composer')) app.setSel('s-composer', d.post.id);
    return d;
  },
  render(d, app) {
    if (!d) return html`<div class="empty"><h1>No posts yet</h1><button type="button" class="btn btn-primary" data-action="go" data-route="s-library">Open the media library</button></div>`;
    const p = d.post;
    const tab = app.pref('platformTab', 'instagram');
    const blocking = d.results.filter((r) => r.result === 'flag' && r.blocking).length;
    const consent = d.results.find((r) => r.check === 'consent' && r.result === 'flag');
    const live = p.status === 'published';
    const scheduled = p.status === 'scheduled';
    const localInput = (() => { const c = ct(p.scheduled_at); const z = (n) => String(n).padStart(2, '0'); return `${c.y}-${z(c.m)}-${z(c.d)}T${z(c.h)}:${z(c.min)}`; })();
    return html`
    <header class="page-head">
      <div class="head-text">
        <button type="button" class="back" data-action="go" data-route="s-calendar">${icon('left', 16)} Back to calendar</button>
        <h1 class="h1-sm">${p.title}</h1>
        <span class="muted">Picked by the agent from your library · ${p.pillar} pillar${p.sample ? ' · sample' : ''}</span>
      </div>
      <div class="row gap-s wrap head-tools">
        <button type="button" class="btn" data-action="showPillarIdeas" data-pillar="${p.pillar}">${icon('sparkle', 16)} Pillar Ideas</button>
        ${!live ? html`<button type="button" class="btn" data-action="changeMedia" data-id="${p.id}" data-current="${p.media_id}">${icon('photo', 16)} Change photo/video</button>` : ''}
        ${live ? chip(`Posted ${fdate(p.published_at, { time: true })}${p.simulated ? ' (demo)' : ''}`, 'good')
          : scheduled ? chip(`Scheduled · ${fdate(p.scheduled_at, { time: true })}`, 'good')
            : html`<button type="button" class="btn btn-primary only-wide" data-action="approvePost" data-id="${p.id}"${blocking ? ' disabled' : ''}>Approve and schedule</button>`}
      </div>
    </header>
    <div class="composer">
      <div class="media-strip only-narrow">
        ${p.media?.thumb ? html`<img src="${p.media.thumb}" alt="">` : html`<span class="strip-ph">${icon(p.media?.kind === 'video' ? 'video' : 'photo', 22)}</span>`}
        <span class="grow stack-xs"><strong>${p.media?.label || 'No media'}</strong><span class="muted small">${p.media?.kind === 'video' ? 'Video' : 'Photo'} · ${p.pillar}</span></span>
        ${!live ? html`<button type="button" class="btn btn-sm" data-action="changeMedia" data-id="${p.id}" data-current="${p.media_id}">Change</button>` : ''}
      </div>
      <section class="stack-s" aria-label="Media and timing">
        ${p.media?.thumb ? html`<img class="preview tall" src="${p.media.thumb}" alt="${p.alt_text}">` : html`<div class="preview tall ph">${icon(p.media?.kind === 'video' ? 'video' : 'photo', 40)}<span>${p.media?.kind === 'video' ? `Video${p.media.duration_s ? ` · 0:${String(Math.round(p.media.duration_s)).padStart(2, '0')}` : ''} · 9:16` : 'Photo'}</span></div>`}
        <form class="card card-flat stack-s" data-submit="saveTiming" data-id="${p.id}">
          <div class="field"><label for="when">Goes live (Central)</label><input id="when" name="when" type="datetime-local" value="${localInput}"${live ? ' disabled' : ''}></div>
          <label class="check"><input type="checkbox" name="instagram" value="1"${p.platforms.includes('instagram') ? ' checked' : ''}${live ? ' disabled' : ''}> Instagram ${p.media?.kind === 'video' ? 'Reel' : 'post'}</label>
          <label class="check"><input type="checkbox" name="facebook" value="1"${p.platforms.includes('facebook') ? ' checked' : ''}${live ? ' disabled' : ''}> Facebook ${p.media?.kind === 'video' ? 'video' : 'post'}</label>
          <label class="check"><input type="checkbox" name="time_sensitive" value="1"${p.time_sensitive ? ' checked' : ''}${live ? ' disabled' : ''}> Time-sensitive (skip when copying months)</label>
          ${!live ? html`<button type="submit" class="btn btn-sm">Save timing</button>` : ''}
        </form>
      </section>
      <section class="card editor-card" aria-label="Caption">
        <div class="filters" role="tablist" aria-label="Platform">
          <button type="button" role="tab" aria-selected="${tab === 'instagram'}" data-action="setPref" data-key="platformTab" data-value="instagram">Instagram</button>
          <button type="button" role="tab" aria-selected="${tab === 'facebook'}" data-action="setPref" data-key="platformTab" data-value="facebook">Facebook</button>
        </div>
        <label class="sr-only" for="caption">${tab === 'instagram' ? 'Instagram' : 'Facebook'} caption</label>
        <textarea id="caption" class="editor caption" rows="13" data-field="${tab === 'instagram' ? 'caption_ig' : 'caption_fb'}" data-input="count" data-limit="${tab === 'instagram' ? 2200 : 63206}"${live ? ' readonly' : ''}>${tab === 'instagram' ? p.caption_ig : p.caption_fb}</textarea>
        <div class="row between"><span class="counter" id="counter" data-limit="${tab === 'instagram' ? 2200 : 63206}">${(tab === 'instagram' ? p.caption_ig : p.caption_fb).length.toLocaleString('en-US')} / ${tab === 'instagram' ? '2,200' : '63,206'}</span>${!live ? html`<button type="button" class="btn btn-sm" data-action="rewrite" data-id="${p.id}">${icon('refresh', 16)} Rewrite</button>` : ''}</div>
        <div class="field"><label for="alt">Alt text</label><input id="alt" value="${p.alt_text}"${live ? ' readonly' : ''}></div>
        <div class="row between wrap gap-s">${sourcesRow(d.citations)}${!live ? html`<button type="button" class="btn btn-primary btn-sm" data-action="savePost" data-id="${p.id}">Save and re-check</button>` : ''}</div>
      </section>
      ${!live && !scheduled ? html`<div class="composer-bar only-narrow" role="region" aria-label="Approve this post">
        <span class="bar-status ${blocking ? 'warn' : 'good'}">${icon(blocking ? 'alert' : 'check', 16)} ${blocking ? `${plural(blocking, 'thing')} to fix` : 'All checks pass'}</span>
        <button type="button" class="btn btn-primary" data-action="approvePost" data-id="${p.id}"${blocking ? ' disabled' : ''}>Approve and schedule</button>
      </div>` : ''}
      <aside class="card reviewer" aria-labelledby="rev-h">
        <div class="stack-xs"><h2 class="section-title" id="rev-h">Reviewer</h2><span class="muted small">Checked before anything posts</span></div>
        ${checksList(d.results)}
        ${d.approval ? html`<p class="small">${stateChip(d.approval.state)}</p>` : ''}
        ${consent ? html`<div class="fixbox"><p>${consent.suggestion}</p><div class="row gap-s wrap"><button type="button" class="btn btn-primary btn-sm" data-action="consent" data-id="${p.media_id}">I have permission</button><button type="button" class="btn btn-sm" data-action="swapMedia" data-id="${p.id}">Swap clip</button></div></div>` : ''}
        ${fixBoxes(d.results.filter((r) => r.check !== 'consent'))}
      </aside>
    </div>`;
  },
  actions: {
    async showPillarIdeas(el, app) {
      const pillar = el.dataset.pillar || 'Educate';
      const res = await app.call('getSocialIdeas', { pillar });
      await dialog({
        title: `Content Ideas · ${pillar} Pillar`,
        submit: '',
        cancel: 'Close',
        wide: true,
        body: html`
          <p class="muted small mb-m">High-engagement prompt angles for <strong>${pillar}</strong>:</p>
          <div class="stack-s">
            ${res.ideas.map((idea) => html`
              <div class="card card-flat">
                <strong>${idea.title}</strong>
                <p class="small mt-xs">${idea.prompt}</p>
              </div>
            `)}
          </div>
        `,
      });
    },
    async savePost(el, app) {
      const cap = document.getElementById('caption');
      await app.call('updatePost', { id: el.dataset.id, [cap.dataset.field]: cap.value, alt_text: document.getElementById('alt').value });
      toast('Saved. Reviewer checked it again.');
      app.refresh();
    },
    async approvePost(el, app) { await app.call('approvePost', { id: el.dataset.id }); toast('Approved and scheduled'); app.refresh(); },
    async swapMedia(el, app) { await app.call('swapMedia', { id: el.dataset.id }); toast('Swapped to media without people in frame'); app.refresh(); },
    async changeMedia(el, app) {
      const d = await pickFromLibrary(app, {
        title: 'Choose a photo or video', submit: 'Use this', current: el.dataset.current,
        extra: html`<label class="check mt-s"><input type="checkbox" name="keep" value="1" checked> Keep my caption (only the photo changes)</label>`,
      });
      if (!d || d.media_id === el.dataset.current) return;
      await app.call('swapMedia', { id: el.dataset.id, mediaId: d.media_id, keepCaption: !!d.keep });
      toast(d.keep ? 'Photo changed. Your caption is kept.' : 'Photo changed and a new caption drafted.');
      app.refresh();
    },
    async rewrite(el, app) { await app.call('rewriteCaption', { id: el.dataset.id }); toast('Fresh caption drafted'); app.refresh(); },
    async applyFix(el, app) { await app.call('applyFix', { resultId: el.dataset.id }); toast('Applied'); app.refresh(); },
    focusEditor() { document.getElementById('caption')?.focus(); },
    consent: (el, app) => consentDialog(app, el.dataset.id),
  },
  submits: {
    async saveTiming(data, app, form) {
      const platforms = [data.instagram && 'instagram', data.facebook && 'facebook'].filter(Boolean);
      const [d, t] = data.when.split('T');
      const [y, mo, da] = d.split('-').map(Number);
      const [h, mi] = t.split(':').map(Number);
      const { centralToDate } = await import('../core/util.js');
      await app.call('updatePost', { id: form.dataset.id, platforms, time_sensitive: !!data.time_sensitive, scheduled_at: centralToDate(y, mo, da, h, mi).toISOString() });
      toast('Timing saved');
      app.refresh();
    },
  },
};

// ---------------------------------------------------------------------------

const calendar = {
  title: 'Social · Calendar',
  load: (app) => app.call('calendar', { key: app.pref('calMonth', null) }),
  render(d) {
    const [y, m] = d.key.split('-').map(Number);
    const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const bySlot = new Map(d.slots.map((s) => [s.day, s]));
    const offPlan = new Map();
    for (const p of d.offPlan) { const c = ct(p.scheduled_at); (offPlan.get(c.d) || offPlan.set(c.d, []).get(c.d)).push(p); }
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(html`<div class="cal-cell blank" aria-hidden="true"></div>`);
    for (let day = 1; day <= days; day++) {
      const s = bySlot.get(day);
      const posts = [...(s?.posts || []), ...(offPlan.get(day) || [])];
      const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][(lead + day - 1) % 7];
      cells.push(html`<div class="cal-cell ${s ? 'slot' : ''} ${s?.past ? 'past' : ''} ${!s && !posts.length ? 'idle' : ''}">
        <span class="cal-day">${day}<span class="cal-dow"> ${dow}</span></span>
        ${posts.map((p) => html`<button type="button" class="cal-chip ${p.pillar ? 'p-' + p.pillar.toLowerCase() : ''}" data-action="go" data-route="s-composer" data-id="${p.id}">
          <span class="cal-time">${(() => { const c = ct(p.scheduled_at); return time12(c.h, c.min).replace(':00', ''); })()} · ${p.platforms.length === 2 ? 'IG + FB' : p.platforms[0] === 'instagram' ? 'IG' : 'FB'}</span>
          <span>${p.title}</span>
          ${p.status === 'published' ? html`<span class="cal-state">${icon('check', 12)} Posted</span>` : p.status === 'scheduled' ? html`<span class="cal-state">${icon('check', 12)} Scheduled</span>` : html`<span class="cal-state">${icon('alert', 12)} ${p.blocking ? 'Fix' : 'Needs OK'}</span>`}
        </button>`)}
        ${s && !posts.length && !s.past ? html`<button type="button" class="cal-open" data-action="pickForSlot" data-slot="${s.key}" data-label="${dow} ${day}">Open · choose media</button>` : ''}
      </div>`);
    }
    return html`
    <header class="page-head cal-head">
      <div class="row gap-s wrap">
        <button type="button" class="icon-btn round" aria-label="Previous month" data-action="setPref" data-key="calMonth" data-value="${d.prev}">${icon('left')}</button>
        <h1 class="h1-cal">${d.label}</h1>
        <button type="button" class="icon-btn round" aria-label="Next month" data-action="setPref" data-key="calMonth" data-value="${d.next}">${icon('right')}</button>
        <span class="mono-label">Plan: Mon · Wed · Fri · ${d.filled} of ${d.total} filled</span>
      </div>
      <div class="row gap-s wrap">
        <button type="button" class="btn" data-action="go" data-route="s-copy">${icon('copy', 16)} Copy month</button>
        <button type="button" class="btn btn-primary" data-action="autofillMonth" data-key="${d.key}"${d.open ? '' : ' disabled'}>Auto-fill ${d.open ? plural(d.open, 'open slot') : 'open slots'}</button>
      </div>
    </header>
    <div class="legend">${d.pillars.map((p) => pillarChip(p))}</div>
    <div class="cal-wrap"><div class="cal" role="group" aria-label="${d.label}">
      ${['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map((w) => html`<span class="cal-wd" aria-hidden="true">${w}</span>`)}
      ${cells}
    </div></div>`;
  },
  actions: {
    async autofillMonth(el, app) { const r = await app.call('autofill', { key: el.dataset.key }); toast(r.created ? `Drafted ${plural(r.created, 'post')}${r.open ? `; ${r.open} still open` : ''}` : 'No unused media fits. Upload some first.', r.created ? 'good' : 'info'); app.refresh(); },
    async pickForSlot(el, app) {
      const d = await pickFromLibrary(app, { title: `Choose media for ${el.dataset.label}`, submit: 'Draft the post' });
      if (!d) return;
      const r = await app.call('draftFromPrompt', { media_id: d.media_id, slot: el.dataset.slot });
      toast('Draft ready. Review it, then approve.');
      app.go('s-composer', r.id);
    },
    async fillSlot(el, app) { const r = await app.call('autofill', { key: el.dataset.slot.slice(0, 7), only: el.dataset.slot }); toast(r.created ? 'Drafted a post for that slot' : 'No unused media fits that slot yet.', r.created ? 'good' : 'info'); app.refresh(); },
  },
};

// ---------------------------------------------------------------------------

const copyMonth = {
  title: 'Social · Copy month',
  async load(app) {
    const cal = await app.call('calendar', { key: app.pref('calMonth', null) });
    const o = app.pref('copyOpts', null) || {};
    const next = cal.next;
    const opts = {
      source_month: cal.key,
      target: o.target || next,
      match_by: o.match_by || 'weekday',
      media_mode: o.media_mode || 'fresh',
      refresh_captions: o.refresh_captions ?? true,
      skip_time_sensitive: o.skip_time_sensitive ?? true,
    };
    const targets = opts.target === 'next3' ? [1, 2, 3].map((i) => addMonthsKey(cal.key, i)) : [opts.target];
    const preview = await app.call('copyMonthPreview', { ...opts, target_months: targets });
    return { cal, opts, preview, next };
  },
  render(d) {
    const { cal, opts, preview } = d;
    const src = monthName(cal.key);
    const p = preview.plans[0];
    const total = preview.plans.reduce((s, x) => ({ slots: s.slots + x.slots, posts: s.posts + x.posts, open: s.open + x.open }), { slots: 0, posts: 0, open: 0 });
    const where = opts.target === 'next3' ? 'each of the next 3 months' : monthName(opts.target);
    const nextKeys = [1, 2].map((i) => addMonthsKey(cal.key, i));
    const srcFilled = cal.slots.filter((s) => s.posts.length).length;
    return html`
    <section class="copy card" aria-labelledby="copy-title">
      <span class="eyebrow">Repost a proven plan</span>
      <h1 id="copy-title" class="h1-sm">Copy ${src}'s schedule</h1>
      <p class="muted">${cal.total} slots on a Mon · Wed · Fri plan, ${srcFilled} with posts.</p>
      <form class="stack-m" data-submit="doCopy" data-change-form="copyOpts">
        <div class="field"><label for="target">Copy to</label><select id="target" name="target">
          ${nextKeys.map((k) => html`<option value="${k}"${opts.target === k ? ' selected' : ''}>${monthName(k)} ${k.slice(0, 4)}</option>`)}
          <option value="next3"${opts.target === 'next3' ? ' selected' : ''}>Next 3 months</option></select></div>
        <fieldset class="fieldset"><legend>Line up posts by</legend>
          <label class="radio-card ${opts.match_by === 'weekday' ? 'on' : ''}"><input type="radio" name="match_by" value="weekday"${opts.match_by === 'weekday' ? ' checked' : ''}><span><strong>Same weekday pattern</strong><span class="muted small">First Monday stays a Monday. Best for keeping your Mon · Wed · Fri rhythm.</span></span></label>
          <label class="radio-card ${opts.match_by === 'date' ? 'on' : ''}"><input type="radio" name="match_by" value="date"${opts.match_by === 'date' ? ' checked' : ''}><span><strong>Same dates</strong><span class="muted small">${src.slice(0, 3)} 5 becomes the 5th of the new month, whatever day that is.</span></span></label>
        </fieldset>
        <fieldset class="fieldset"><legend>Photos and videos</legend>
          <label class="check"><input type="radio" name="media_mode" value="fresh"${opts.media_mode === 'fresh' ? ' checked' : ''}> Let the agent pick fresh media with the same pillar</label>
          <label class="check"><input type="radio" name="media_mode" value="same"${opts.media_mode === 'same' ? ' checked' : ''}> Repost the exact same media</label>
        </fieldset>
        <label class="check"><input type="checkbox" name="refresh_captions" value="1"${opts.refresh_captions ? ' checked' : ''}> Refresh captions so they don't repeat word for word</label>
        <label class="check"><input type="checkbox" name="skip_time_sensitive" value="1"${opts.skip_time_sensitive ? ' checked' : ''}> Skip time-sensitive posts (events, deadlines)</label>
        <div class="summary-box" aria-live="polite">
          <strong>Creates ${total.slots} slots in ${where}: ${plural(total.posts, 'post')} and ${plural(total.open, 'open slot')}${p.skipped.length ? ` (skips ${p.skipped.map((s) => `"${s}"`).join(', ')})` : ''}.</strong><br>
          ${opts.media_mode === 'fresh' ? 'The agent picks new photos and videos from your library to match each pillar.' : 'The same photos and videos go out again.'}
          ${opts.refresh_captions ? ' Captions get a light rewrite.' : ' Captions stay exactly the same.'}
          ${opts.match_by === 'date' ? ' Posts may land on different weekdays.' : ''}
          ${p.dropped.length ? html`<br><span class="muted small">Not copied: ${p.dropped.map((x) => `${x.title} (${x.why.toLowerCase()})`).join('; ')}.</span>` : ''}
          <br><span class="muted small">Copied posts land as drafts and still need your OK.</span>
        </div>
        <div class="row gap-s"><button type="button" class="btn" data-action="go" data-route="s-calendar">Cancel</button><button type="submit" class="btn btn-primary"${total.posts ? '' : ' disabled'}>${opts.target === 'next3' ? 'Copy to next 3 months' : `Copy to ${monthName(opts.target)}`}</button></div>
      </form>
    </section>`;
  },
  submits: {
    async doCopy(data, app) {
      const cal = await app.call('calendar', { key: app.pref('calMonth', null) });
      const targets = data.target === 'next3' ? [1, 2, 3].map((i) => addMonthsKey(cal.key, i)) : [data.target];
      const r = await app.call('copyMonth', { source_month: cal.key, target_months: targets, match_by: data.match_by, media_mode: data.media_mode, refresh_captions: !!data.refresh_captions, skip_time_sensitive: !!data.skip_time_sensitive });
      toast(`${plural(r.created, 'post')} drafted. They need your OK before they go live.`);
      app.setPref('calMonth', targets[0]);
      app.go('s-calendar');
    },
  },
  formChanges: {
    copyOpts(data, app) {
      app.setPref('copyOpts', { target: data.target, match_by: data.match_by, media_mode: data.media_mode, refresh_captions: !!data.refresh_captions, skip_time_sensitive: !!data.skip_time_sensitive });
      app.refresh();
    },
  },
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function monthName(key) { return MONTHS[+key.split('-')[1] - 1]; }
function addMonthsKey(key, n) {
  const [y, m] = key.split('-').map(Number);
  const i = y * 12 + m - 1 + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

export default {
  's-week': week,
  's-library': library,
  's-composer': composer,
  's-calendar': calendar,
  's-copy': copyMonth,
};

export { when };

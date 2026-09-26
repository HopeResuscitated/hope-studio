// Knowledge base screen, shared by Grant Studio and Outreach Studio.

import { html, icon, chip, dialog, field, toast, ago, plural } from '../ui.js';

// ---------- Read uploaded files into text (in the browser, no libraries) ----------

async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

async function docxText(buf) {
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This .docx file looks damaged.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
    if (name === 'word/document.xml') {
      const lNameLen = dv.getUint16(local + 26, true);
      const lExtra = dv.getUint16(local + 28, true);
      const data = new Uint8Array(buf, local + 30 + lNameLen + lExtra, csize);
      const xml = dec.decode(method === 8 ? await inflateRaw(data) : data);
      return xml
        .replace(/<w:pStyle w:val="Heading\d"\/>/g, '\u0001')
        .replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n').replace(/<\/w:p>/g, '\n\n')
        .replace(/<[^>]+>/g, '')
        .replace(/\u0001([^\n]+)/g, '## $1')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/\n{3,}/g, '\n\n').trim();
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error('No document text found in this .docx file.');
}

function htmlText(s) {
  const doc = new DOMParser().parseFromString(s, 'text/html');
  doc.querySelectorAll('script,style,nav,footer').forEach((n) => n.remove());
  doc.querySelectorAll('h1,h2,h3,h4').forEach((h) => { h.textContent = `\n\n## ${h.textContent.trim()}\n\n`; });
  doc.querySelectorAll('p,li,tr,div').forEach((n) => n.append('\n\n'));
  return doc.body.textContent.replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*(\n\s*)+/g, '\n\n').trim();
}

export async function readDocument(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.docx')) return { text: await docxText(await file.arrayBuffer()) };
  if (name.endsWith('.pdf')) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return { pdf_base64: btoa(bin) };
  }
  const text = await file.text();
  if (name.endsWith('.html') || name.endsWith('.htm')) return { text: htmlText(text) };
  return { text };
}

// ---------------------------------------------------------------------------

export function knowledgeScreen(collection, { eyebrow, lede, ask, askLabel }) {
  const route = collection === 'grants' ? 'g-kb' : 'o-kb';
  return {
    title: `${collection === 'grants' ? 'Grants' : 'Outreach'} · Knowledge base`,
    load: (app) => app.call('knowledge', { collection }),
    render(d, app) {
      const answer = app.pref(`kb-answer-${collection}`, null);
      const gapsTotal = d.gaps.missingDocs.length + d.gaps.questions.length;
      const isAdmin = app.me.user.role === 'admin';
      return html`
      <header class="page-head">
        <div class="head-text"><span class="eyebrow">${eyebrow}</span><h1>Knowledge base</h1><p class="lede">${lede}</p></div>
        <label class="btn btn-primary file-btn">${icon('upload', 16)} Upload documents<input type="file" multiple accept=".txt,.md,.html,.htm,.csv,.docx,.pdf" data-change="uploadDocs"></label>
      </header>
      <p class="muted small">${plural(d.counts.indexed, 'document')} indexed into ${plural(d.counts.chunks, 'chunk')} of about 800 tokens. Search is full-text (BM25), filtered to this studio plus shared Partner Guide material.</p>
      <div class="cols">
        <section class="col-main">
          <div class="doc-grid">
            ${d.groups.map((g) => html`<article class="card">
              <h2 class="section-title">${g.name}</h2>
              <ul class="doclist">${g.items.map((doc) => html`<li>
                <span>${doc.title}</span>
                ${doc.status === 'indexed' ? chip('Indexed', 'good') : html`<button type="button" class="chip chip-warn chip-btn" data-action="fillDoc" data-id="${doc.id}" data-title="${doc.title}">Missing · add</button>`}
              </li>`)}</ul>
            </article>`)}
          </div>
          <article class="card">
            <div class="card-top"><h2 class="section-title">Locked facts</h2>${isAdmin ? html`<button type="button" class="btn btn-sm" data-action="addFact">${icon('plus', 16)} Add fact</button>` : ''}</div>
            <p class="muted small">Numbers that must never drift. Writers quote them exactly; a change here re-checks every draft that cites the old value${isAdmin ? '' : '. Only Leila can change them'}.</p>
            <div class="table-wrap"><table class="table">
              <thead><tr><th scope="col">Fact</th><th scope="col">Value</th><th scope="col">Source</th><th scope="col">Verified</th>${isAdmin ? html`<th scope="col"><span class="sr-only">Actions</span></th>` : ''}</tr></thead>
              <tbody>${d.facts.map((f) => html`<tr>
                <td><strong>${f.label}</strong><div class="muted small">${f.statement}</div></td>
                <td class="nowrap">${f.value}</td>
                <td class="small">${f.source || '—'}</td>
                <td class="small nowrap">${f.verified_at ? html`${icon('check', 14, 'ok')} ${f.verified_by_name || ''}` : isAdmin ? html`<button type="button" class="link-btn" data-action="verifyFact" data-id="${f.id}">Verify</button>` : 'Not yet'}</td>
                ${isAdmin ? html`<td><button type="button" class="link-btn" data-action="editFact" data-id="${f.id}">Edit</button></td>` : ''}
              </tr>`)}</tbody>
            </table></div>
          </article>
        </section>
        <aside class="col-side">
          <form class="card" data-submit="askKb">
            <h2 class="section-title">Test the brain</h2>
            <label for="kb-ask">${askLabel}</label>
            <div class="row gap-s"><input id="kb-ask" name="question" value="${answer?.question || ask}"><button type="submit" class="btn btn-primary">Ask</button></div>
            ${answer ? (answer.missing
              ? html`<div class="banner">${icon('alert')}<span>The knowledge base doesn't answer this yet. It's logged as a gap below.</span></div>`
              : html`<p class="answer">${answer.answer}</p><span class="mono-label">Source: ${answer.sources.map((s) => s.label).join(' · ')}</span>`) : html`<p class="muted small">Ask what a funder or partner might ask. The answer comes only from the documents and facts on this page.</p>`}
            ${gapsTotal ? html`<div class="gaps"><strong>${plural(gapsTotal, 'gap')}.</strong>
              ${d.gaps.missingDocs.length ? html` Add ${d.gaps.missingDocs.map((x) => x.title.toLowerCase()).join(' and ')} so Writer can answer those questions without guessing.` : ''}
              ${d.gaps.questions.length ? html`<ul class="gaplist">${d.gaps.questions.map((g) => html`<li><span>"${g.question}"${g.times > 1 ? ` · asked ${g.times}×` : ''}</span><button type="button" class="link-btn" data-action="dismissGap" data-id="${g.id}">Dismiss</button></li>`)}</ul>` : ''}
            </div>` : ''}
          </form>
        </aside>
      </div>`;
    },
    submits: {
      async askKb(data, app) {
        const r = await app.call('askKb', { question: data.question, collection });
        app.setPref(`kb-answer-${collection}`, { question: data.question, ...r });
        app.refresh();
      },
    },
    actions: {
      async fillDoc(el, app) {
        const data = await dialog({
          title: el.dataset.title, submit: 'Add to knowledge base', wide: true,
          body: html`<p class="muted">Paste the text, or upload the file from the page header. Writer will quote it once it's indexed.</p>${field('Text', 'text', { rows: 12, required: true, autofocus: true })}`,
        });
        if (!data?.text) return;
        await app.call('uploadDocument', { replaceId: el.dataset.id, text: data.text });
        toast('Indexed');
        app.refresh();
      },
      async verifyFact(el, app) { await app.call('verifyFact', { id: el.dataset.id }); toast('Verified'); app.refresh(); },
      async editFact(el, app) {
        const f = (await app.call('knowledge', { collection })).facts.find((x) => x.id === el.dataset.id);
        const data = await dialog({
          title: `Edit: ${f.label}`, submit: 'Save and re-check drafts',
          body: html`<p class="banner">${icon('alert')}<span>Every draft that quotes the old value is flagged for review.</span></p>${field('Value', 'value', { value: f.value, required: true })}${field('How writers say it', 'statement', { value: f.statement, rows: 3 })}`,
        });
        if (!data) return;
        await app.call('updateFact', { id: f.id, value: data.value, statement: data.statement });
        toast('Fact updated. Drafts that cite it were re-checked.');
        app.refresh();
      },
      async addFact(el, app) {
        const data = await dialog({ title: 'Add a locked fact', submit: 'Add', body: html`${field('Label', 'label', { required: true, autofocus: true, placeholder: 'People trained in 2026' })}${field('Value', 'value', { required: true, placeholder: '320' })}${field('How writers say it', 'statement', { rows: 2, placeholder: 'Hope Resuscitated trained 320 people in 2026.' })}` });
        if (!data) return;
        await app.call('addFact', data);
        toast('Fact added');
        app.refresh();
      },
      async dismissGap(el, app) { await app.call('dismissGap', { id: el.dataset.id }); app.refresh(); },
    },
    changes: {
      async uploadDocs(el, app) {
        const files = [...el.files];
        const group = collection === 'grants' ? 'Uploads' : 'Uploads';
        let ok = 0;
        for (const file of files) {
          try {
            const body = await readDocument(file);
            await app.call('uploadDocument', { title: file.name.replace(/\.[^.]+$/, ''), collection, group, ...body });
            ok++;
          } catch (err) {
            toast(`${file.name}: ${err.message}`, 'bad');
          }
        }
        if (ok) toast(`${plural(ok, 'document')} indexed`);
        app.refresh();
      },
    },
    route,
  };
}

export { ago };

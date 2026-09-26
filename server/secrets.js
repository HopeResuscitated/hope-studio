// Server-side store for keys and tokens set from the Settings screen.
// Lives in data/secrets.json (mode 600), separate from the main data file, so
// data exports never include it and nothing here is ever sent to the browser.
// A value set here wins over the same name in .env.

import fs from 'node:fs';
import path from 'node:path';
import { env } from './env.js';

export function createSecrets(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'secrets.json');
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { data = {}; }

  function save() {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
    try { fs.chmodSync(file, 0o600); } catch { /* not supported on this filesystem */ }
  }

  return {
    get: (k) => data[k] ?? '',
    set(patch) {
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === '') delete data[k];
        else data[k] = v;
      }
      save();
    },
    // Secrets from Settings first, then .env.
    cfg: (k) => (typeof data[k] === 'string' ? data[k].trim() : data[k]) || env(k),
    source: (k) => (data[k] ? 'app' : env(k) ? 'env' : null),
  };
}

export const hint = (s) => (s ? `••••${String(s).slice(-4)}` : '');

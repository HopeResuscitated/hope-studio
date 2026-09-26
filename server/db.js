// JSON-file persistence with atomic writes and nightly backups.

import fs from 'node:fs';
import path from 'node:path';

export function fileAdapter(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'hope-studio.json');
  return {
    file,
    load() {
      if (!fs.existsSync(file)) return null;
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    },
    save(data) {
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, file);
    },
  };
}

export function backup(dataDir, keep = 14) {
  const src = path.join(dataDir, 'hope-studio.json');
  if (!fs.existsSync(src)) return null;
  const dir = path.join(dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `hope-studio-${new Date().toISOString().slice(0, 10)}.json`);
  fs.copyFileSync(src, dest);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.unlinkSync(path.join(dir, f));
  return dest;
}

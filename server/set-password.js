// Set a user's password: node server/set-password.js leila [new-password]
// With no password argument, a random one is generated and printed.
// Stop the server first (or restart it after) so the change is picked up.

import path from 'node:path';
import { loadEnv, env, ROOT } from './env.js';
import { fileAdapter } from './db.js';
import { hashPassword, randomPassword } from './auth.js';
import { createStore } from '../web/core/store.js';

loadEnv();
const [username, given] = process.argv.slice(2);
if (!username) {
  console.error('Usage: node server/set-password.js <leila|cierra> [password]');
  process.exit(1);
}
const store = createStore(fileAdapter(path.resolve(ROOT, env('DATA_DIR', 'data'))));
store.load();
const user = store.find('users', (u) => u.username === username.toLowerCase());
if (!user) {
  console.error(`No user "${username}".`);
  process.exit(1);
}
const pw = given || randomPassword();
if (pw.length < 10) {
  console.error('Use at least 10 characters.');
  process.exit(1);
}
store.update('users', user.id, { password_hash: hashPassword(pw) });
store.flush();
console.log(`Password for ${user.name} is now: ${pw}`);

import { randomBytes, scryptSync } from 'node:crypto';
import { readState, mutateState } from '../persistence.mjs';

const email = process.argv[2]?.trim().toLowerCase();
const apply = process.argv[3] === '--apply';
if (!/^[a-z0-9._%+-]+@psu\.edu$/.test(email || '') || (process.argv[3] && !apply)) {
  console.error('Usage: node scripts/promote-operator.mjs <psu-email> [--apply]');
  process.exit(2);
}

const matches = (await readState('accounts.json', [])).filter(account => account.email === email && !account.disabled);
if (matches.length !== 1 || !['instructor', 'operator'].includes(matches[0].role)) {
  console.error('Expected exactly one enabled instructor or operator account for this email.');
  process.exit(1);
}
if (!apply) {
  console.log(JSON.stringify({ email, currentRole: matches[0].role, nextRole: 'operator', changed: false }));
  process.exit(0);
}

let password = '';
for await (const chunk of process.stdin) password += chunk;
password = password.replace(/\r?\n$/, '');
if (password.length < 8 || password.length > 200) {
  console.error('Supply an 8–200 character password on stdin.');
  process.exit(2);
}
const salt = randomBytes(16).toString('hex');
const passwordHash = scryptSync(password, salt, 64).toString('hex');
password = '';
await mutateState('accounts.json', [], accounts => {
  const account = accounts.find(item => item.id === matches[0].id && item.email === email && !item.disabled);
  if (!account || !['instructor', 'operator'].includes(account.role)) throw new Error('Account changed since review.');
  account.role = 'operator';
  account.salt = salt;
  account.passwordHash = passwordHash;
  account.passwordUpdatedAt = new Date().toISOString();
});
console.log(JSON.stringify({ email, role: 'operator', changed: true }));

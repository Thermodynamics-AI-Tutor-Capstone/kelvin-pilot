import { randomBytes, scryptSync } from 'node:crypto';
import { mutateState } from './persistence.mjs';

const [role, email, name] = process.argv.slice(2);
if (!['operator','researcher'].includes(role) || !/^[a-z0-9._+%-]+@psu\.edu$/i.test(email || '') || !name?.trim()) {
  console.error('Usage: node provision-role.mjs <operator|researcher> <psu-email> <name>');
  process.exit(2);
}
const password = randomBytes(24).toString('base64url');
const salt = randomBytes(16).toString('hex');
const account = await mutateState('accounts.json', [], data => {
  if (data.some(item => item.email === email.toLowerCase())) throw new Error('Email already has an account');
  const value = { id: `${role}-${randomBytes(12).toString('hex')}`, role, email: email.toLowerCase(), name: name.trim(),
    salt, passwordHash: scryptSync(password, salt, 64).toString('hex'), createdAt: new Date().toISOString(), disabled: false };
  data.push(value);
  return { id: value.id, email: value.email, role };
});
console.log(JSON.stringify({ ...account, password }));

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { addStoredEvent, deleteStoredEvents, mutateState, readState, storedEvents } from './persistence.mjs';

const usersKey = 'users.json';
const hash = token => createHash('sha256').update(token).digest('hex');

export async function provision(role = 'student', id = randomUUID()) {
  if (!['student', 'instructor'].includes(role)) throw new Error('Invalid role');
  if (!/^[a-zA-Z0-9_-]{3,80}$/.test(id)) throw new Error('Invalid user ID');
  const token = `kelvin_${randomBytes(32).toString('base64url')}`;
  await mutateState(usersKey, [], data => {
    if (data.some(user => user.id === id)) throw new Error('User ID already exists');
    data.push({ id, role, tokenHash: hash(token), createdAt: new Date().toISOString(), revoked: false });
  });
  return { id, role, token };
}

export async function provisionHash(role, id, tokenHash) {
  if (!['student', 'instructor'].includes(role)) throw new Error('Invalid role');
  if (!/^[a-zA-Z0-9_-]{3,80}$/.test(id)) throw new Error('Invalid user ID');
  if (!/^[a-f0-9]{64}$/.test(tokenHash)) throw new Error('Invalid SHA-256 token hash');
  await mutateState(usersKey, [], data => {
    if (data.some(user => user.id === id || user.tokenHash === tokenHash)) throw new Error('User or token already exists');
    data.push({ id, role, tokenHash, createdAt: new Date().toISOString(), revoked: false });
  });
  return { id, role };
}

export async function authenticate(token) {
  if (!token?.startsWith('kelvin_')) return null;
  const digest = Buffer.from(hash(token), 'hex');
  return (await readState(usersKey, [])).find(user => !user.revoked && timingSafeEqual(Buffer.from(user.tokenHash, 'hex'), digest)) || null;
}

export async function revoke(id) {
  return mutateState(usersKey, [], data => {
    const user = data.find(item => item.id === id);
    if (!user) throw new Error('Unknown user');
    user.revoked = true;
  });
}

export const addEvent = addStoredEvent;
export const allEvents = storedEvents;

export async function deleteStudent(id) {
  await deleteStoredEvents(id);
  await mutateState(usersKey, [], data => {
    const legacy = data.find(user => user.id === id && user.role === 'student');
    if (legacy) legacy.revoked = true;
  });
}

export async function trends(minStudents = 5) {
  const events = await allEvents();
  const students = new Set(events.map(event => event.studentId));
  if (students.size < minStudents) return { suppressed: true, minimumStudents: minStudents, students: students.size, events: events.length };
  const counts = field => Object.entries(events.reduce((acc, event) => {
    for (const id of event[field] || []) acc[id] = (acc[id] || 0) + 1;
    return acc;
  }, {})).filter(([id]) => new Set(events.filter(event => (event[field] || []).includes(id)).map(event => event.studentId)).size >= minStudents)
    .sort((a, b) => b[1] - a[1]).map(([id, count]) => ({ id, count }));
  return { suppressed: false, students: students.size, events: events.length,
    topics: counts('topics'), misconceptions: counts('misconceptions') };
}

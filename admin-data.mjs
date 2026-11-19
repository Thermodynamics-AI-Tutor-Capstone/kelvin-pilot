import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readState, mutateState, storedEvents, storedRpcEvents } from './persistence.mjs';
import { courses } from './demo.mjs';
import { studentInsights } from './learning-data.mjs';

const accountsKey = 'accounts.json';
const importsKey = 'chat-imports.json';
const auditKey = 'admin-audit.json';
const notesKey = 'admin-evidence-notes.json';
const safeAccount = ({ passwordHash, salt, ...account }) => account;
const visible = account => account && ['student','instructor','researcher','operator'].includes(account.role);

export async function adminOverview() {
  const accounts = (await readState(accountsKey, [])).filter(visible);
  const events = await storedRpcEvents();
  const now = Date.now(), active = new Set(events.filter(e => now - Date.parse(e.at) < 15 * 60000).map(e => e.accountId).filter(Boolean));
  return { accounts: accounts.length, students: accounts.filter(a => a.role === 'student').length,
    faculty: accounts.filter(a => a.role === 'instructor').length, courses: (await courses()).length,
    calls: events.length, activeNow: active.size,
    recent: events.slice(-25).reverse().map(e => ({ id: e.id, at: e.at, accountId: e.accountId,
      courseId: e.courseId, tool: e.tool, method: e.method, client: e.client, status: e.status })) };
}

export async function adminAccounts(query = '', role = '', offset = 0, limit = 50) {
  const accounts = (await readState(accountsKey, [])).filter(visible);
  const q = String(query).trim().toLowerCase();
  const filtered = accounts.filter(a => (!role || a.role === role) &&
    (!q || `${a.name || ''} ${a.email || ''} ${a.id}`.toLowerCase().includes(q)));
  return { total: filtered.length, offset, accounts: filtered.slice(offset, offset + limit).map(safeAccount) };
}

export async function adminAccount(id) {
  const account = (await readState(accountsKey, [])).find(a => a.id === id && visible(a));
  if (!account) return null;
  const allCourses = await courses();
  const ownedCourses = allCourses.filter(c => c.professorId === id);
  const imports = (await readState(importsKey, [])).filter(i => i.studentId === id);
  const calls = (await storedRpcEvents()).filter(e => e.accountId === id);
  const reflections = (await storedEvents()).filter(e => e.studentId === id);
  return { account: safeAccount(account), ownedCourses, learning: account.role === 'student' ? await studentInsights(id) : null,
    currentCourse: allCourses.find(c => c.id === account.courseId) || null,
    counts: { calls: calls.length, reflections: reflections.length, imports: imports.length } };
}

export function adminTraffic() {
  const dir = join(process.env.KELVIN_MCP_DATA_DIR || join(import.meta.dirname, 'data'), 'request-logs');
  const rows = [];
  for (let day = 0; day < 2; day++) {
    const date = new Date(Date.now() - day * 86400000).toISOString().slice(0, 10);
    const file = join(dir, `${date}.jsonl`);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue;
      try { const row = JSON.parse(line); if (Date.now() - Date.parse(row.at) < 86400000) rows.push(row); } catch {}
    }
  }
  const publicRows = rows.filter(row => row.path !== '/ready' && row.path !== '/health');
  const paths = Object.entries(publicRows.reduce((counts, row) => {
    counts[row.path] = (counts[row.path] || 0) + 1; return counts;
  }, {})).sort((a,b) => b[1] - a[1]).slice(0, 8).map(([path, count]) => ({ path, count }));
  return { requests24h: publicRows.length, paths, recent: publicRows.slice(-20).reverse().map(row => ({
    at: row.at, path: row.path, method: row.method, status: row.status, durationMs: row.durationMs })) };
}

export async function adminActivity(id, offset = 0, limit = 50) {
  const account = (await readState(accountsKey, [])).find(a => a.id === id && visible(a));
  if (!account) return null;
  const [calls, reflections, imports, notes] = await Promise.all([
    storedRpcEvents(), storedEvents(), readState(importsKey, []), readState(notesKey, {})]);
  const rows = [
    ...calls.filter(e => e.accountId === id).map(e => ({ ...e, type: 'mcp call' })),
    ...reflections.filter(e => e.studentId === id).map(e => ({ ...e, type: 'reflection' })),
    ...imports.filter(e => e.studentId === id).flatMap(entry => entry.records.map((record, index) => ({
      id: `${entry.id}:${index}`, at: record.at || entry.at, type: 'imported prompt', platform: entry.platform,
      conversation: record.conversation, text: record.text, courseId: entry.courseId })))
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return { total: rows.length, offset, rows: rows.slice(offset, offset + limit).map(row => ({ ...row, note: notes[row.id] || null })) };
}

export async function adminUpdateAccount(id, input, actorId) {
  const allCourses = await courses();
  const name = String(input.name || '').trim();
  const role = String(input.role || '');
  const courseId = input.courseId ? String(input.courseId) : null;
  if (name.length < 2 || name.length > 120 || !['student','instructor','researcher','operator'].includes(role))
    throw new Error('Enter a name and valid role');
  if (courseId && !allCourses.some(c => c.id === courseId)) throw new Error('Choose an existing course');
  if (id === actorId && (role !== 'operator' || input.disabled)) throw new Error('You cannot disable or demote your own account');
  const updated = await mutateState(accountsKey, [], accounts => {
    const account = accounts.find(a => a.id === id && visible(a));
    if (!account) throw new Error('Account unavailable');
    account.name = name; account.role = role; account.disabled = Boolean(input.disabled);
    if (role === 'student') {
      account.courseId = courseId;
      account.professorId = allCourses.find(c => c.id === courseId)?.professorId || null;
    }
    account.updatedAt = new Date().toISOString();
    return safeAccount(account);
  });
  await mutateState(auditKey, [], rows => rows.push({ id: randomUUID(), at: new Date().toISOString(),
    actorId, action: 'account-update', targetId: id, changes: { name, role, courseId, disabled: Boolean(input.disabled) } }));
  return updated;
}

export async function adminNoteEvidence(id, text, actorId) {
  const note = String(text || '').trim();
  if (!/^[a-f0-9-]{36}(?::\d+)?$/.test(id) || note.length < 3 || note.length > 2000) throw new Error('Enter a note for this record');
  const result = { text: note, at: new Date().toISOString(), actorId };
  await mutateState(notesKey, {}, notes => { notes[id] = result; });
  await mutateState(auditKey, [], rows => rows.push({ id: randomUUID(), at: result.at,
    actorId, action: 'evidence-note', targetId: id }));
  return result;
}

export async function adminAudit(offset = 0, limit = 50) {
  const [accounts, studio] = await Promise.all([readState(auditKey, []), readState('faculty-studio.json',
    { template: { releases: [], draft: {} }, courses: {} })]);
  const studioRows = [
    ...(studio.template?.releases || []).map(r => ({ id: `template-${r.version}`, at: r.at, actorId: r.actorId,
      action: 'template-publish', targetId: `template v${r.version}` })),
    ...Object.values(studio.template?.draft || {}).map(r => ({ id: `template-draft-${r.itemId}`, at: r.at,
      actorId: r.actorId, action: 'template-draft', targetId: r.itemId })),
    ...Object.entries(studio.courses || {}).flatMap(([courseId, course]) => [
      ...(course.releases || []).map(r => ({ id: `${courseId}-${r.version}`, at: r.at, actorId: r.actorId,
        action: 'course-publish', targetId: courseId })),
      ...Object.values(course.draft || {}).map(r => ({ id: `${courseId}-${r.itemId}`, at: r.at, actorId: r.actorId,
        action: 'course-draft', targetId: `${courseId} · ${r.itemId}` }))])];
  const rows = [...accounts, ...studioRows].sort((a,b) => String(b.at).localeCompare(String(a.at)));
  return { total: rows.length, offset, rows: rows.slice(offset, offset + limit) };
}

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mutateState, readState, addStoredUsage, storedUsage, storedEvents } from './persistence.mjs';
import { loadContent, metadata } from './content.mjs';

const accountsKey = 'accounts.json';
const coursesKey = 'courses.json';
const filesKey = 'course-files.json';
const sessionsKey = 'dashboard-sessions.json';
const stock = { id: 'demo-me300', professorId: 'demo-professor', title: 'ME 300 Engineering Thermodynamics', code: 'ME 300', stock: true };
const emailPattern = /^[a-z0-9._%+-]+@psu\.edu$/i;
const hash = value => createHash('sha256').update(value).digest('hex');
const digest = (password, salt) => scryptSync(password, salt, 64).toString('hex');
const publicAccount = account => ({ id: account.id, email: account.email || null, name: account.name || null, role: account.role, courseId: account.courseId || null, professorId: account.professorId || null });
export const normalizedEmail = email => {
  const value = String(email || '').trim().toLowerCase();
  return emailPattern.test(value) && value.length <= 254 ? value : null;
};
const defaultCourse = account => ({ id: `course-${account.id}`, professorId: account.id, title: account.courseTitle || 'ME 300 Engineering Thermodynamics', code: account.courseCode || 'ME 300', stock: true });
export async function courses() {
  const accounts = await readState(accountsKey, []);
  return [stock, ...accounts.filter(a => a.role === 'instructor' && !a.disabled).map(defaultCourse), ...await readState(coursesKey, [])];
}
export async function courseById(id) { return (await courses()).find(course => course.id === id) || null; }
export async function professors() {
  const all = await courses();
  const accounts = await readState(accountsKey, []);
  return [{ id: stock.professorId, name: 'Kelvin demo course', courses: [stock] }, ...accounts.filter(a => a.role === 'instructor' && !a.disabled)
    .map(a => ({ id: a.id, name: a.name, courses: all.filter(c => c.professorId === a.id) }))];
}
export async function enrollStudent(emailInput, courseId) {
  const email = normalizedEmail(emailInput), course = await courseById(courseId);
  if (!email || !course) throw new Error('Enter a PSU email and choose a course');
  return mutateState(accountsKey, [], data => {
    let account = data.find(a => a.role === 'student' && a.email === email && a.courseId === course.id && !a.disabled);
    if (!account) {
      account = { id: `student-${randomBytes(12).toString('hex')}`, role: 'student', email, courseId: course.id,
        professorId: course.professorId, name: email.split('@')[0], createdAt: new Date().toISOString(),
        disabled: false, demoEmailOnly: true, shareWithInstructor: false };
      data.push(account);
    }
    return publicAccount(account);
  });
}
export async function registerProfessor({ email: input, name, password }) {
  const email = normalizedEmail(input);
  if (!email || typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 120 ||
      typeof password !== 'string' || password.length < 12 || password.length > 200) throw new Error('Enter a PSU email, name, and password of at least 12 characters');
  const salt = randomBytes(16).toString('hex');
  return mutateState(accountsKey, [], data => {
    if (data.some(a => a.email === email && a.role === 'instructor')) throw new Error('A professor account already uses this email');
    const account = { id: `prof-${randomBytes(12).toString('hex')}`, role: 'instructor', email, name: name.trim(),
      salt, passwordHash: digest(password, salt), createdAt: new Date().toISOString(), disabled: false };
    data.push(account);
    return publicAccount(account);
  });
}
export async function signInProfessor(identifier, password) {
  const key = String(identifier || '').trim().toLowerCase();
  const account = (await readState(accountsKey, [])).find(a => a.role === 'instructor' && !a.disabled &&
    (a.email === key || a.id.toLowerCase() === key));
  if (!account?.passwordHash || typeof password !== 'string') return null;
  const a = Buffer.from(account.passwordHash, 'hex'), b = Buffer.from(digest(password, account.salt), 'hex');
  return a.length === b.length && timingSafeEqual(a, b) ? publicAccount(account) : null;
}
export async function createCourse(professorId, input) {
  const title = String(input.title || '').trim(), code = String(input.code || '').trim();
  if (title.length < 3 || title.length > 120 || code.length < 2 || code.length > 30) throw new Error('Enter a course code and title');
  const account = (await readState(accountsKey, [])).find(a => a.id === professorId && a.role === 'instructor' && !a.disabled);
  if (!account) throw new Error('Professor account unavailable');
  const course = { id: `course-${randomBytes(12).toString('hex')}`, professorId, title, code, stock: true, createdAt: new Date().toISOString() };
  await mutateState(coursesKey, [], data => data.push(course));
  return course;
}
export async function makeSession(account) {
  const token = randomBytes(32).toString('base64url');
  await mutateState(sessionsKey, {}, data => { data[hash(token)] = { accountId: account.id, expiresAt: Date.now() + 7 * 86400_000 }; });
  return { token, account };
}
export async function sessionAccount(token) {
  if (!token || typeof token !== 'string') return null;
  const record = (await readState(sessionsKey, {}))[hash(token)];
  if (!record || record.expiresAt < Date.now()) return null;
  const account = (await readState(accountsKey, [])).find(a => a.id === record.accountId && !a.disabled);
  return account ? publicAccount(account) : null;
}
export async function revokeSession(token) {
  if (token) await mutateState(sessionsKey, {}, data => { delete data[hash(token)]; });
}
export async function courseFiles(courseId) { return (await readState(filesKey, [])).filter(f => f.courseId === courseId); }
export const fileMetadata = f => ({ id: f.id, name: f.name, mimeType: f.mimeType, size: f.size, createdAt: f.createdAt, excerpt: f.text.slice(0, 180) });
export async function addCourseFile(professorId, courseId, nameInput, mimeType, base64) {
  const course = await courseById(courseId);
  if (!course || course.professorId !== professorId || professorId === stock.professorId) throw new Error('Course unavailable');
  const name = String(nameInput || '').trim();
  if (!name || name.length > 120 || !/^[\w .()\-]+$/.test(name)) throw new Error('Invalid file name');
  if (typeof base64 !== 'string' || base64.length > 3_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error('File is too large or invalid');
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > 2_200_000) throw new Error('File must be under 2 MB');
  let text;
  if (mimeType === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) {
    if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid PDF');
    if (!existsSync(new URL('./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url))) throw new Error('PDF worker unavailable');
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: true, disableFontFace: true });
    const document = await loadingTask.promise;
    const pages = [];
    try {
      for (let i = 1; i <= Math.min(document.numPages, 100); i++) {
        const page = await document.getPage(i);
        pages.push((await page.getTextContent()).items.map(item => item.str || '').join(' '));
      }
    } finally { await loadingTask.destroy(); }
    text = pages.join('\n\n');
  } else if (/\.(txt|md|csv)$/i.test(name) && ['text/plain', 'text/markdown', 'text/csv', 'application/octet-stream', ''].includes(String(mimeType || ''))) {
    text = bytes.toString('utf8');
  } else throw new Error('Upload a PDF, TXT, MD, or CSV file');
  if (!text.trim()) throw new Error('No readable text found in this file');
  const file = { id: `file-${randomBytes(12).toString('hex')}`, courseId, professorId, name,
    mimeType: name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'text/plain', size: bytes.length,
    text: text.slice(0, 80_000), createdAt: new Date().toISOString() };
  await mutateState(filesKey, [], data => data.push(file));
  return fileMetadata(file);
}
export async function recordUsage(event) { return addStoredUsage(event); }
export async function studentSummary(account) {
  const reflections = (await storedEvents()).filter(e => e.studentId === account.id && e.courseId === account.courseId);
  return { account, course: await courseById(account.courseId), reflections: reflections.slice(-30).reverse() };
}
export async function courseAnalytics(courseId, minimumStudents = 5) {
  const course = await courseById(courseId);
  if (!course) throw new Error('Course unavailable');
  const usage = await storedUsage(courseId);
  const reflections = (await storedEvents()).filter(e => e.courseId === courseId);
  const students = new Set([...usage, ...reflections].map(e => e.studentId));
  const grouped = (events, field) => {
    const values = new Map();
    for (const event of events) for (const key of (Array.isArray(event[field]) ? event[field] : [event[field]]).filter(Boolean)) {
      const entry = values.get(key) || { id: key, count: 0, students: new Set() };
      entry.count++; entry.students.add(event.studentId); values.set(key, entry);
    }
    return [...values.values()].filter(v => v.students.size >= minimumStudents).map(({ id, count }) => ({ id, count })).sort((a, b) => b.count - a.count);
  };
  const suppressed = students.size < minimumStudents;
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const timeline = Array.from({ length: 14 }, (_, index) => {
    const day = new Date(today.getTime() - (13 - index) * 86400_000).toISOString().slice(0, 10);
    const onDay = events => events.filter(e => e.at.slice(0, 10) === day);
    const visibleCount = events => new Set(events.map(e => e.studentId)).size >= minimumStudents ? events.length : null;
    return { date: day, requests: visibleCount(onDay(usage)), reflections: visibleCount(onDay(reflections)) };
  });
  const comparisons = (events, field) => {
    const values = new Map();
    for (const event of events) {
      const age = Math.round((today.getTime() - new Date(`${event.at.slice(0, 10)}T00:00:00Z`).getTime()) / 86400_000);
      if (age < 0 || age >= 14) continue;
      for (const id of (Array.isArray(event[field]) ? event[field] : [event[field]]).filter(Boolean)) {
        const entry = values.get(id) || { id, recent: 0, previous: 0, recentStudents: new Set(), previousStudents: new Set() };
        entry[age < 7 ? 'recent' : 'previous']++;
        entry[age < 7 ? 'recentStudents' : 'previousStudents'].add(event.studentId); values.set(id, entry);
      }
    }
    return [...values.values()].filter(v => v.recentStudents.size >= minimumStudents && v.previousStudents.size >= minimumStudents)
      .map(({ id, recent, previous }) => ({ id, recent, previous }))
      .sort((a, b) => b.recent - a.recent || b.previous - a.previous).slice(0, 8);
  };
  return { course, suppressed, minimumStudents, students: suppressed ? null : students.size,
    toolCalls: suppressed ? null : usage.length, reflections: suppressed ? null : reflections.length,
    timeline: suppressed ? [] : timeline,
    topicTrends: suppressed ? [] : comparisons(reflections, 'topics'),
    questionTrends: suppressed ? [] : comparisons(usage.filter(e => e.tool === 'search_course'), 'cardId'),
    cardTrends: suppressed ? [] : comparisons(usage.filter(e => ['get_card', 'get_course_file'].includes(e.tool)), 'cardId'),
    misconceptionTrends: suppressed ? [] : comparisons(reflections, 'misconceptions'),
    tools: suppressed ? [] : grouped(usage, 'tool'), cards: suppressed ? [] : grouped(usage, 'cardId'),
    topics: suppressed ? [] : grouped(reflections, 'topics'), misconceptions: suppressed ? [] : grouped(reflections, 'misconceptions') };
}
export function stockCards() { return [...loadContent().cards.values()].map(metadata); }

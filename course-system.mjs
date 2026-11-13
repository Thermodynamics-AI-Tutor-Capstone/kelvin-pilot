import { randomUUID } from 'node:crypto';
import { readState, mutateState } from './persistence.mjs';
import { loadContent, metadata } from './content.mjs';
import sourceManifest from './canvas-source-manifest.json' with { type: 'json' };

const key = 'course-revisions.json';
const scheduleKey = 'course-schedules.json';
const bundled = loadContent();
const editingRoles = new Set(['instructor', 'operator']);
export const canEditCourse = (account, course) => Boolean(account && course && editingRoles.has(account.role) &&
  (account.role === 'operator' || (course.professorId === account.id && !account.demoProfessor)));
export const sourceInventory = () => ({ course: 'ME 300 · O’Connor · Summer 2023', repository: 'Thermodynamics-AI-Tutor-Capstone/kelvin-ingestion',
  items: sourceManifest, note: 'Private Canvas source inventory. Files with solutions are not exposed to students.' });
export async function courseRevisions(courseId) { return (await readState(key, {}))[courseId] || []; }
export async function courseVersion(courseId) { return (await courseRevisions(courseId)).at(-1)?.version || 0; }
export async function contentForCourse(courseId) {
  const cards = new Map([...bundled.cards].map(([id, card]) => [id, { ...card }]));
  const skills = new Map([...bundled.skills].map(([id, skill]) => [id, { ...skill }]));
  if (courseId !== 'oconnor-me300-su23') {
    for (const [id, card] of cards) if (card.unit === 'unit:u0-course-admin' || id.startsWith('topic:t00') ||
      /^(topic:)?exam-/.test(id)) cards.delete(id);
    const course = cards.get('course:me300');
    if (course) cards.set('course:me300', { ...course, title: 'ME 300 Engineering Thermodynamics · concept template',
      description: 'General ME 300 thermodynamics concepts based on the O’Connor Summer 2023 source section; use your current course for dates and assignments.',
      body: '# ME 300 Engineering Thermodynamics concept template\n\nCore concepts: systems and control volumes, properties, ideal gases, phase change, energy, heat and work, first-law and second-law analysis, entropy, and engineering cycles. The teaching cards were derived from Dr. O’Connor’s real Summer 2023 course. This template does not contain a current section schedule, grades, or assignments.' });
  }
  for (const revision of await courseRevisions(courseId)) {
    const map = revision.kind === 'skill' ? skills : cards;
    if (revision.action === 'delete') map.delete(revision.itemId);
    else map.set(revision.itemId, { ...map.get(revision.itemId), ...revision.value });
  }
  return { cards, skills, version: await courseVersion(courseId) };
}
export async function reviseCourseItem(courseId, account, course, { kind, itemId, value, reason, expectedVersion }) {
  if (!canEditCourse(account, course)) throw new Error('Editing is unavailable for this course');
  if (!['card', 'skill'].includes(kind) || typeof itemId !== 'string' || itemId.length > 120 || !/^[\w:-]+$/.test(itemId)) throw new Error('Invalid item');
  const title = String(value?.title || value?.name || '').trim();
  const body = String(value?.body || '').trim();
  const description = String(value?.description || '').trim();
  if (title.length < 3 || title.length > 160 || body.length < 10 || body.length > 40000 || description.length > 1000) throw new Error('Enter a title and content');
  return mutateState(key, {}, data => {
    const revisions = data[courseId] ||= [];
    const version = revisions.at(-1)?.version || 0;
    if (Number(expectedVersion) !== version) throw new Error(`Course changed since you opened it (current version ${version}). Refresh before saving.`);
    const entry = { id: randomUUID(), courseId, version: version + 1, at: new Date().toISOString(), actorId: account.id,
      kind, itemId, action: 'upsert', reason: String(reason || '').slice(0, 500),
      value: { title, name: kind === 'skill' ? itemId : undefined, body, description, status: 'instructor-edited',
        kind: kind === 'card' ? String(value.kind || 'topic') : undefined, id: kind === 'card' ? itemId : undefined } };
    revisions.push(entry);
    return entry;
  });
}
export async function restoreCourseVersion(courseId, account, course, itemId, revisionId, expectedVersion) {
  if (!canEditCourse(account, course)) throw new Error('Editing is unavailable for this course');
  return mutateState(key, {}, data => {
    const revisions = data[courseId] ||= [];
    const prior = revisions.find(r => r.id === revisionId && r.itemId === itemId);
    if (!prior) throw new Error('Revision unavailable');
    const version = revisions.at(-1)?.version || 0;
    if (Number(expectedVersion) !== version) throw new Error('Course changed. Refresh before restoring.');
    const entry = { ...prior, id: randomUUID(), version: version + 1, at: new Date().toISOString(), actorId: account.id,
      reason: `Restored revision ${revisionId}` };
    revisions.push(entry); return entry;
  });
}
export async function courseSchedule(courseId) {
  const configured = (await readState(scheduleKey, {}))[courseId];
  if (configured) return configured;
  return { term: courseId === 'oconnor-me300-su23' ? 'Summer 2023' : 'Demo term',
    startDate: courseId === 'oconnor-me300-su23' ? '2023-05-15' : null, weekLengthDays: 7,
    modules: ['M1','M2','M3','M4','M5','M6','M7','M8'], currentWeek: null,
    note: 'Set the current term start date in the professor dashboard. Summer 2023 dates are historical.' };
}
export async function saveCourseSchedule(courseId, account, course, input) {
  if (!canEditCourse(account, course)) throw new Error('Editing is unavailable for this course');
  const date = String(input.startDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new Error('Enter a valid term start date');
  const term = String(input.term || '').trim();
  if (term.length < 3 || term.length > 80) throw new Error('Enter the term name');
  const value = { term, startDate: date, weekLengthDays: 7, modules: ['M1','M2','M3','M4','M5','M6','M7','M8'],
    updatedAt: new Date().toISOString(), updatedBy: account.id };
  await mutateState(scheduleKey, {}, data => { data[courseId] = value; });
  return value;
}
export function coursePosition(schedule, at = new Date()) {
  if (!schedule.startDate) return { week: null, module: null, guidance: 'Term start date not configured; use the full course map.' };
  const week = Math.floor((at.getTime() - Date.parse(`${schedule.startDate}T00:00:00Z`)) / 604800000) + 1;
  const moduleIndex = Math.max(0, Math.min(7, Math.floor((week - 1) * 8 / 12)));
  return { week, module: week > 0 && week <= 12 ? schedule.modules[moduleIndex] : null,
    guidance: week < 1 ? 'Term has not begun.' : week > 12 ? 'Term has ended; review across the full course.' :
      `Prioritize ${schedule.modules[moduleIndex]} and its prerequisites. Later modules may be introduced as previews.` };
}
export const itemSummary = card => ({ ...metadata(card), version: card.status === 'instructor-edited' ? 'course-edited' : 'source' });

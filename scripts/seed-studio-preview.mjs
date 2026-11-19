import { randomBytes, randomUUID } from 'node:crypto';
import { registerProfessor, createCourse, enrollStudent } from '../demo.mjs';
import { mutateState, addRpcEvent, addStoredUsage, addStoredEvent } from '../persistence.mjs';
import { loadContent } from '../content.mjs';
import { saveStudioDraft, publishStudio, adoptTemplate } from '../studio.mjs';
import { dreamCourse } from '../learning-data.mjs';
import { contentForCourse } from '../course-system.mjs';

if (process.env.KELVIN_PREVIEW_SEED !== '1' || !process.env.KELVIN_MCP_DATA_DIR)
  throw new Error('Preview seed requires KELVIN_PREVIEW_SEED=1 and an isolated KELVIN_MCP_DATA_DIR');
let password = '';
for await (const chunk of process.stdin) password += chunk;
password = password.trim();
if (password.length < 8) throw new Error('Supply the preview operator password on stdin');
const operator = await registerProfessor({ email: 'lrs5769@psu.edu', name: 'Lance Streuber', password });
password = '';
await mutateState('accounts.json', [], accounts => { accounts.find(item => item.id === operator.id).role = 'operator'; });
operator.role = 'operator';
const faculty = await registerProfessor({ email: 'faculty.preview@psu.edu', name: 'Dr. Morgan Chen',
  password: randomBytes(20).toString('base64url') });
const { cards, skills } = loadContent();
const templateCard = cards.get('topic:m7-07-entropy');
await saveStudioDraft('template', 'demo-me300', operator, null, { kind: 'card', itemId: templateCard.id,
  value: { ...templateCard, description: 'A shared entropy guide with faculty-ready prompts.' },
  reason: 'Prepare a reusable course template', expectedRevision: 0 });
await saveStudioDraft('template', 'demo-me300', operator, null, { kind: 'skill', itemId: 'what-next',
  value: { ...skills.get('what-next'), title: 'Ask what comes next',
    body: `${skills.get('what-next').body}\n\nFor the shared template, ask the learner to name their next physical assumption before selecting an equation.` },
  reason: 'Make the next-step check explicit', expectedRevision: 1 });
await publishStudio('template', 'demo-me300', operator, null, 'Shared template release');
const course = await createCourse(faculty.id, { code: 'ME 300-01', title: 'Engineering Thermodynamics · Fall 2026' });
await adoptTemplate(course.id, faculty, course);
await saveStudioDraft('course', course.id, faculty, course, { kind: 'card', itemId: 'topic:m7-07-entropy',
  value: { ...templateCard, title: 'Entropy in Dr. Chen’s section',
    description: 'Course-specific entropy examples and explanation.',
    body: `${templateCard.body}\n\nIn this section, start with the control volume and ask which entropy transfers cross its boundary.` },
  reason: 'Add course examples', expectedRevision: 1 });
await publishStudio('course', course.id, faculty, course, 'First faculty course release');
await saveStudioDraft('course', course.id, faculty, course, { kind: 'skill', itemId: 'response-pacing',
  value: { ...skills.get('response-pacing'), title: 'Response pacing',
    body: `${skills.get('response-pacing').body}\n\nFor this section, pause after one physical assumption and ask the student to justify it.` },
  reason: 'Draft a slower scaffold for review', expectedRevision: 3 });
const students = [];
for (let i = 1; i <= 6; i++) students.push(await enrollStudent(`student${i}.preview@psu.edu`, course.id));
const topics = ['topic:m7-07-entropy', 'topic:m5-04-energy-conservation', 'topic:m4-03-phase-decision-tree'];
for (let day = 12; day >= 0; day--) for (let i = 0; i < students.length; i++) {
  if ((day + i) % 3 === 0) continue;
  const at = new Date(Date.now() - day * 86400000 - i * 120000).toISOString();
  const topic = topics[(day + i) % topics.length], id = randomUUID();
  const query = topic.includes('entropy') ? 'How do I set up the entropy balance?' :
    topic.includes('phase') ? 'Which property table applies here?' : 'What belongs in the energy balance?';
  await addRpcEvent({ id, at, accountId: students[i].id, studentId: students[i].id, role: 'student',
    courseId: course.id, courseVersion: 1, templateVersion: 1, pedagogyVersion: 1,
    method: 'tools/call', tool: 'search_course', cardId: topic, arguments: { query },
    client: i % 2 ? 'claude' : 'chatgpt', status: 200, durationMs: 90 + i * 13 });
  await addStoredUsage({ at, studentId: students[i].id, courseId: course.id, tool: 'search_course',
    query, cardId: topic, eventId: id, courseVersion: 1, client: i % 2 ? 'claude' : 'chatgpt' });
}
for (let i = 0; i < students.length; i++) {
  await addStoredEvent({ at: new Date(Date.now() - (i + 1) * 86400000).toISOString(),
    studentId: students[i].id, courseId: course.id, statement: i % 2 ?
      'I checked the entropy balance before choosing an equation.' : 'I learned to identify the system boundary first.',
    topics: ['topic:m7-07-entropy'], misconceptions: i < 4 ? ['misc:m15-adiabatic-implies-isentropic'] : [],
    summary: 'Practiced setting up a thermodynamics balance.', classificationStatus: 'classified' });
}
await mutateState('chat-imports.json', [], entries => entries.push({ id: randomUUID(), at: new Date().toISOString(),
  studentId: students[0].id, courseId: course.id, platform: 'chatgpt', count: 2,
  records: [
    { at: new Date().toISOString(), conversation: 'Entropy practice', text: 'Why does adiabatic not always mean isentropic?' },
    { at: new Date().toISOString(), conversation: 'Entropy practice', text: 'Can you give me a hint for the entropy generation term?' }
  ] }));
await dreamCourse(course.id, (await contentForCourse(course.id)).cards);
await mutateState('pedagogy-runs.json', [], rows => rows.push({ id: randomUUID(), at: new Date().toISOString(),
  actorId: faculty.id, courseId: course.id, scenarioId: 'misconception', mode: 'published',
  courseVersion: 1, templateVersion: 1, draftRevision: null, model: null, responseMode: 'sample response',
  response: 'Adiabatic means no heat crosses the boundary. What else would need to be true for the process to be isentropic?',
  evidence: [{ id: 'misc:m15-adiabatic-implies-isentropic', title: 'Adiabatic does not imply isentropic' }],
  review: { verdict: 'pass', note: 'Separates the two claims and asks for the missing condition.', at: new Date().toISOString(), actorId: faculty.id } }));
console.log(JSON.stringify({ seeded: true, operator: operator.email, faculty: faculty.email,
  students: students.length, course: course.code, sampleData: true }));

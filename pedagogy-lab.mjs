import { randomUUID } from 'node:crypto';
import { readState, mutateState } from './persistence.mjs';
import { contentForCourse, courseSchedule, coursePosition } from './course-system.mjs';
import { studioState } from './studio.mjs';
import { askKelvin } from './ask-kelvin.mjs';

const key = 'pedagogy-runs.json';
export const scenarios = [
  { id: 'direct-answer', title: 'Student asks for a complete solution',
    question: 'Solve my turbine energy balance homework and give me the final number without asking questions.',
    review: ['Does Kelvin avoid an unsupported answer key?', 'Does it offer a useful next step?'] },
  { id: 'misconception', title: 'Adiabatic versus isentropic',
    question: 'If a turbine is adiabatic, that means it is isentropic, right?',
    review: ['Does it distinguish adiabatic from isentropic?', 'Does it check the student’s reasoning?'] },
  { id: 'hint', title: 'Student requests a hint',
    question: 'I am stuck on choosing the right property table for a saturated mixture. Give me one hint.',
    review: ['Does it give one actionable hint?', 'Does it avoid completing the problem?'] },
  { id: 'teach-me', title: 'Student asks to be taught',
    question: 'Teach me how to set up a control-volume energy balance step by step.',
    review: ['Does it start with a diagnostic or focused question?', 'Does it pace the explanation?'] }
];

export async function runScenario(courseId, scenarioId, mode, actorId) {
  const scenario = scenarios.find(item => item.id === scenarioId);
  if (!scenario || !['published','draft'].includes(mode)) throw new Error('Choose a scenario and version');
  const content = await contentForCourse(courseId, mode === 'draft');
  const schedule = await courseSchedule(courseId);
  const result = await askKelvin(scenario.question, content.cards, coursePosition(schedule), content.skills);
  const state = await studioState(courseId);
  const run = { id: randomUUID(), at: new Date().toISOString(), actorId, courseId, scenarioId, mode,
    courseVersion: content.version, templateVersion: content.templateVersion,
    draftRevision: mode === 'draft' ? state.draftRevision : null,
    model: result.model || null, responseMode: result.mode, response: result.answer || result.guidance || '',
    evidence: result.evidence?.map(item => ({ id: item.id, title: item.title })) || [],
    review: null };
  await mutateState(key, [], rows => rows.push(run));
  return run;
}

export async function scenarioRuns(courseId, offset = 0) {
  const rows = (await readState(key, [])).filter(row => row.courseId === courseId).reverse();
  return { total: rows.length, rows: rows.slice(offset, offset + 50) };
}

export async function reviewScenario(courseId, runId, actorId, input) {
  const verdict = String(input.verdict || '');
  const note = String(input.note || '').trim();
  if (!['pass','needs-work','uncertain'].includes(verdict) || note.length > 2000) throw new Error('Choose a verdict');
  return mutateState(key, [], rows => {
    const run = rows.find(row => row.id === runId && row.courseId === courseId);
    if (!run) throw new Error('Run unavailable');
    run.review = { verdict, note, at: new Date().toISOString(), actorId };
    return run;
  });
}

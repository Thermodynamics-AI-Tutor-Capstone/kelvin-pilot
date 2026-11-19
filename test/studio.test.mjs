import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('template releases, faculty drafts, restoration, and pedagogy reviews stay versioned', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kelvin-studio-test-'));
  process.env.KELVIN_MCP_DATA_DIR = dir;
  const { registerProfessor, createCourse, enrollStudent } = await import('../demo.mjs');
  const { mutateState, addRpcEvent, addStoredEvent } = await import('../persistence.mjs');
  const { saveStudioDraft, publishStudio, adoptTemplate, restoreStudioItem, studioState } = await import('../studio.mjs');
  const { contentForCourse } = await import('../course-system.mjs');
  const { scenarios, runScenario, reviewScenario } = await import('../pedagogy-lab.mjs');
  const { adminOverview, adminAccounts, adminAccount, adminActivity, adminUpdateAccount, adminNoteEvidence, adminAudit } = await import('../admin-data.mjs');
  try {
    const operator = await registerProfessor({ email: 'operator@psu.edu', name: 'Operator', password: 'test-password' });
    await mutateState('accounts.json', [], accounts => { accounts.find(a => a.id === operator.id).role = 'operator'; });
    operator.role = 'operator';
    const faculty = await registerProfessor({ email: 'faculty@psu.edu', name: 'Faculty Member', password: 'test-password' });
    const course = await createCourse(faculty.id, { code: 'ME 300', title: 'Thermodynamics section' });
    const original = (await contentForCourse(course.id)).skills.get('response-pacing').body;
    await saveStudioDraft('template', 'demo-me300', operator, null, { kind: 'skill', itemId: 'response-pacing',
      value: { title: 'Response pacing', description: 'Shared pacing', body: 'Shared pacing rule for the template.' }, expectedRevision: 0 });
    assert.equal((await contentForCourse('demo-me300')).skills.get('response-pacing').body, original);
    await publishStudio('template', 'demo-me300', operator, null, 'Global release');
    assert.equal((await contentForCourse(course.id)).skills.get('response-pacing').body, original);
    await adoptTemplate(course.id, faculty, course);
    assert.match((await contentForCourse(course.id)).skills.get('response-pacing').body, /Shared pacing rule/);
    await assert.rejects(saveStudioDraft('course', course.id, { role: 'student', id: 's1' }, course,
      { kind: 'skill', itemId: 'response-pacing', value: { title: 'Bad', body: 'A long enough body' }, expectedRevision: 1 }), /Editing is unavailable/);
    await saveStudioDraft('course', course.id, faculty, course, { kind: 'skill', itemId: 'response-pacing',
      value: { title: 'Response pacing', description: 'Faculty pacing', body: 'Faculty asks for one physical assumption at a time.' },
      expectedRevision: 1 });
    assert.match((await contentForCourse(course.id)).skills.get('response-pacing').body, /Shared pacing rule/);
    assert.match((await contentForCourse(course.id, true)).skills.get('response-pacing').body, /Faculty asks/);
    await publishStudio('course', course.id, faculty, course, 'Faculty release');
    assert.match((await contentForCourse(course.id)).skills.get('response-pacing').body, /Faculty asks/);
    await restoreStudioItem('course', course.id, faculty, course, 1, 'skill', 'response-pacing', 3);
    assert.equal((await studioState(course.id)).draftCount, 1);
    await saveStudioDraft('course', course.id, faculty, course, { kind: 'skill', itemId: 'response-pacing',
      action: 'reset', expectedRevision: 4 });
    await publishStudio('course', course.id, faculty, course, 'Restore inherited pacing');
    assert.match((await contentForCourse(course.id)).skills.get('response-pacing').body, /Shared pacing rule/);
    const run = await runScenario(course.id, scenarios[0].id, 'published', faculty.id);
    assert.equal(run.templateVersion, 1);
    assert.equal(run.review, null);
    const reviewed = await reviewScenario(course.id, run.id, faculty.id, { verdict: 'uncertain', note: 'Model unavailable here' });
    assert.equal(reviewed.review.verdict, 'uncertain');
    const student = await enrollStudent('student@psu.edu', course.id);
    const eventId = '11111111-1111-4111-8111-111111111111';
    await addRpcEvent({ id: eventId, at: new Date().toISOString(), accountId: student.id, studentId: student.id,
      courseId: course.id, tool: 'search_course', arguments: { query: 'entropy' }, status: 200 });
    await addStoredEvent({ studentId: student.id, courseId: course.id, statement: 'I learned to check the system boundary.' });
    assert.equal((await adminOverview()).students, 1);
    assert.equal((await adminAccounts('student')).total, 1);
    assert.ok(!(await adminAccount(faculty.id)).account.passwordHash);
    assert.equal((await adminActivity(student.id)).rows.length, 2);
    await adminNoteEvidence(eventId, 'Reviewed the course search.', operator.id);
    assert.equal((await adminActivity(student.id)).rows.find(row => row.id === eventId).note.text, 'Reviewed the course search.');
    await adminUpdateAccount(student.id, { name: 'Student Preview', role: 'student', courseId: course.id, disabled: false }, operator.id);
    assert.equal((await adminAccount(student.id)).account.name, 'Student Preview');
    assert.ok((await adminAudit()).rows.some(row => row.action === 'course-publish'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'kelvin-analytics-test-'));
process.env.KELVIN_MCP_DATA_DIR = dir;
const { recordUsage, courseAnalytics } = await import('../demo.mjs');

test('daily and weekly professor charts hide activity from fewer than five students', async () => {
  try {
    const courseId = 'demo-me300';
    const today = new Date(); today.setUTCHours(12, 0, 0, 0);
    const previous = new Date(today.getTime() - 8 * 86400_000).toISOString();
    for (let i = 0; i < 4; i++) {
      await recordUsage({ studentId: `student-${i}`, courseId, tool: 'search_course', cardId: 'topic:m7-07-entropy', at: today.toISOString() });
      await recordUsage({ studentId: `student-${i}`, courseId, tool: 'search_course', cardId: 'topic:m7-07-entropy', at: previous });
    }
    assert.equal((await courseAnalytics(courseId)).suppressed, true);
    await recordUsage({ studentId: 'student-4', courseId, tool: 'search_course', cardId: 'topic:m7-07-entropy', at: today.toISOString() });
    let report = await courseAnalytics(courseId);
    assert.equal(report.suppressed, false);
    assert.equal(report.timeline.at(-1).requests, 5);
    assert.deepEqual(report.questionTrends, []);
    await recordUsage({ studentId: 'student-4', courseId, tool: 'search_course', cardId: 'topic:m7-07-entropy', at: previous });
    report = await courseAnalytics(courseId);
    assert.deepEqual(report.questionTrends, [{ id: 'topic:m7-07-entropy', recent: 5, previous: 5 }]);
    assert.equal(report.timeline.filter(day => day.requests === null).length, 12);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

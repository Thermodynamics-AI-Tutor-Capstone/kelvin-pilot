import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync as makeTemp, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ready(url) {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) return; } catch {} await delay(100); }
  throw new Error('Server did not start');
}
test('professors own courses and files; students choose and switch professors through MCP OAuth', async () => {
  const dir = makeTemp(join(tmpdir(), 'kelvin-demo-test-'));
  const port = 35000 + Math.floor(Math.random() * 1000);
  const origin = `http://127.0.0.1:${port}`;
  const env = { ...process.env, KELVIN_MCP_DATA_DIR: dir, PORT: String(port), KELVIN_PUBLIC_ORIGIN: origin,
    KELVIN_DASHBOARD_ORIGIN: origin, KELVIN_HOST_MODE: 'public', DEEPSEEK_API_KEY: '' };
  const child = spawn(process.execPath, ['server.mjs'], { cwd: import.meta.dirname + '/..', env });
  async function api(path, method = 'GET', body, token) {
    const response = await fetch(origin + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json().catch(() => null) };
  }
  try {
    await ready(`${origin}/health`);
    assert.equal((await fetch(`${origin}/dashboard`)).status, 200);
    assert.equal((await fetch(`${origin}/dashboard/app.js`)).status, 200);
    const publicProfessors = await api('/api/professors');
    assert.equal(publicProfessors.status, 200);
    assert.ok(publicProfessors.body.some(p => p.id === 'demo-professor'));
    const first = await api('/api/professor-register', 'POST', { email: 'teacher1@psu.edu', name: 'Professor One', password: 'long-demo-password-1' });
    assert.equal(first.status, 200);
    const firstToken = first.body.token;
    const second = await api('/api/professor-register', 'POST', { email: 'teacher2@psu.edu', name: 'Professor Two', password: 'long-demo-password-2' });
    assert.equal(second.status, 200);
    const course = await api('/api/courses', 'POST', { code: 'ME 301', title: 'Applied Thermodynamics' }, firstToken);
    assert.equal(course.status, 201);
    const courseId = course.body.id;
    const uploaded = await api(`/api/courses/${courseId}/files`, 'POST', { name: 'Syllabus.txt', mimeType: 'text/plain',
      base64: Buffer.from('Office hours are on Tuesday. We study entropy and energy balances.').toString('base64') }, firstToken);
    assert.equal(uploaded.status, 201);
    assert.equal((await api(`/api/courses/${courseId}`, 'GET', null, second.body.token)).status, 404);
    assert.equal((await api(`/api/courses/${courseId}/files/${uploaded.body.id}`, 'GET', null, second.body.token)).status, 404);
    assert.equal((await api('/api/student-session', 'POST', { email: 'learner@psu.edu' })).status, 404);
    assert.equal((await api('/api/student-session', 'POST', { email: 'someone@gmail.com' })).status, 404);
    const metadata = await fetch(`${origin}/.well-known/oauth-protected-resource/mcp/account`);
    assert.equal(metadata.status, 200);
    assert.equal((await metadata.json()).resource, `${origin}/mcp/account`);
    const registered = await fetch(`${origin}/register`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'Kelvin test', redirect_uris: [`${origin}/callback`], grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'], token_endpoint_auth_method: 'none' }) });
    assert.equal(registered.status, 201);
    const clientId = (await registered.json()).client_id;
    const verifier = randomBytes(32).toString('base64url');
    const authUrl = new URL('/authorize', origin);
    for (const [key, value] of Object.entries({ response_type: 'code', client_id: clientId, redirect_uri: `${origin}/callback`,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
      scope: 'mcp:tools', state: 'demo-test', resource: `${origin}/mcp/account` })) authUrl.searchParams.set(key, value);
    const authorize = await fetch(authUrl, { redirect: 'manual' });
    assert.equal(authorize.status, 302);
    const loginUrl = new URL(authorize.headers.get('location'), origin);
    const loginPage = await fetch(loginUrl);
    assert.match(await loginPage.text(), /PSU email/);
    const lookup = await fetch(`${origin}/login`, { method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ action: 'lookup-email', request: loginUrl.searchParams.get('request'), email: 'learner@psu.edu' }) });
    assert.equal(lookup.status, 200);
    assert.match(await lookup.text(), /First connection.*Choose your professor/);
    const login = await fetch(`${origin}/login`, { method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ action: 'email', request: loginUrl.searchParams.get('request'), email: 'learner@psu.edu', course: courseId }) });
    assert.equal(login.status, 302);
    const code = new URL(login.headers.get('location')).searchParams.get('code');
    const tokens = await fetch(`${origin}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier,
        redirect_uri: `${origin}/callback`, resource: `${origin}/mcp/account` }) });
    assert.equal(tokens.status, 200);
    const access = (await tokens.json()).access_token;
    const student = await api('/api/student-session', 'POST', { email: 'learner@psu.edu' });
    assert.equal(student.status, 200);
    const sameStudent = await api('/api/student-session', 'POST', { email: 'LEARNER@PSU.EDU' });
    assert.equal(sameStudent.body.account.id, student.body.account.id);
    assert.equal((await api(`/api/courses/${courseId}/analytics`, 'GET', null, student.body.token)).status, 403);
    const studentData = await api('/api/student', 'GET', null, student.body.token);
    assert.equal(studentData.body.account.email, 'learner@psu.edu');
    assert.deepEqual(studentData.body.reflections, []);
    const content = await api(`/api/courses/${courseId}`, 'GET', null, student.body.token);
    assert.equal(content.body.files.length, 1);
    assert.ok(content.body.cards.some(card => card.kind === 'misconception'));
    assert.ok(content.body.skills.length >= 5);
    const client = new Client({ name: 'kelvin-demo-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp/account`), { requestInit: { headers: { Authorization: `Bearer ${access}` } } }));
    const tools = (await client.listTools()).tools.map(tool => tool.name);
    assert.ok(tools.includes('get_course_file'));
    assert.ok(tools.includes('switch_professor'));
    const file = await client.callTool({ name: 'get_course_file', arguments: { id: uploaded.body.id } });
    assert.match(file.content[0].text, /Office hours are on Tuesday/);
    const account = await client.callTool({ name: 'my_account', arguments: {} });
    assert.equal(JSON.parse(account.content[0].text).id, student.body.account.id);
    const saved = await client.callTool({ name: 'record_learning', arguments: { statement: 'I practiced entropy balances today.', consent: true } });
    assert.equal(JSON.parse(saved.content[0].text).saved, true);
    const available = await client.callTool({ name: 'list_professors', arguments: {} });
    assert.ok(JSON.parse(available.content[0].text).some(item => item.id === second.body.account.id));
    const switched = await client.callTool({ name: 'switch_professor', arguments: { professor_id: second.body.account.id } });
    assert.equal(JSON.parse(switched.content[0].text).course.id, `course-${second.body.account.id}`);
    const afterSwitch = await client.callTool({ name: 'my_account', arguments: {} });
    assert.equal(JSON.parse(afterSwitch.content[0].text).courseId, `course-${second.body.account.id}`);
    assert.equal((await api('/api/student', 'GET', null, student.body.token)).body.course.id, `course-${second.body.account.id}`);
    const hiddenFile = await client.callTool({ name: 'get_course_file', arguments: { id: uploaded.body.id } });
    assert.equal(hiddenFile.isError, true);
    const back = await client.callTool({ name: 'switch_professor', arguments: { professor_id: first.body.account.id, course_id: courseId } });
    assert.equal(JSON.parse(back.content[0].text).course.id, courseId);
    await client.close();
    const reconnect = await fetch(authUrl, { redirect: 'manual' });
    assert.equal(reconnect.status, 302);
    const reconnectRequest = new URL(reconnect.headers.get('location'), origin).searchParams.get('request');
    const remembered = await fetch(`${origin}/login`, { method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ action: 'lookup-email', request: reconnectRequest, email: 'learner@psu.edu' }) });
    const rememberedPage = await remembered.text();
    assert.match(rememberedPage, /Your current course.*Applied Thermodynamics/);
    assert.doesNotMatch(rememberedPage, /<select name="course"/);
    const resume = await fetch(`${origin}/login`, { method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ action: 'email', request: reconnectRequest, email: 'learner@psu.edu' }) });
    assert.equal(resume.status, 302);
    assert.equal((await api('/api/student-session', 'POST', { email: 'learner@psu.edu' })).body.account.id, student.body.account.id);
    const own = await api('/api/student', 'GET', null, student.body.token);
    assert.equal(own.body.reflections.length, 1);
    const analytics = await api(`/api/courses/${courseId}/analytics`, 'GET', null, firstToken);
    assert.equal(analytics.status, 200);
    assert.equal(analytics.body.suppressed, true);
    assert.ok(!JSON.stringify(analytics.body).includes('learner@psu.edu'));
    assert.ok(!JSON.stringify(analytics.body).includes('I practiced entropy'));
    assert.equal((await api('/api/dashboard-data', 'GET', null, firstToken)).status, 404);
  } finally { child.kill(); rmSync(dir, { recursive: true, force: true }); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ready(url) {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(url)).ok) return; } catch {} await delay(100); }
  throw new Error('Server did not start');
}
const parse = reply => JSON.parse(reply.content[0].text);
async function connect(base, email, includeScope = true) {
  const resource = `${base}/mcp`;
  const callback = `${base}/callback`;
  const registered = await fetch(`${base}/register`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Kelvin test', redirect_uris: [callback], grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'], token_endpoint_auth_method: 'none' }) });
  assert.equal(registered.status, 201);
  const clientId = (await registered.json()).client_id;
  const verifier = randomBytes(32).toString('base64url');
  const authorize = new URL('/authorize', base);
  for (const [key, value] of Object.entries({ response_type: 'code', client_id: clientId, redirect_uri: callback,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    ...(includeScope ? { scope: 'mcp:tools' } : {}), resource })) authorize.searchParams.set(key, value);
  const redirect = await fetch(authorize, { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  const requestId = new URL(redirect.headers.get('location'), base).searchParams.get('request');
  const login = await fetch(`${base}/login`, { method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ request: requestId, action: 'email', email, course: 'demo-me300' }) });
  assert.equal(login.status, 302);
  const code = new URL(login.headers.get('location')).searchParams.get('code');
  const tokens = await fetch(`${base}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier,
      redirect_uri: callback, resource }) });
  assert.equal(tokens.status, 200);
  const access = (await tokens.json()).access_token;
  const client = new Client({ name: 'kelvin-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(resource), { requestInit: { headers: { Authorization: `Bearer ${access}` } } }));
  return client;
}
test('canonical MCP requires email OAuth, serves course content, and logs safe usage', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kelvin-mcp-test-'));
  const port = 34000 + Math.floor(Math.random() * 1000);
  const modelPort = port + 1000;
  const model = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    assert.equal(req.headers.authorization, 'Bearer fake-test-key');
    assert.ok(!JSON.stringify(JSON.parse(Buffer.concat(chunks).toString())).includes('student-one@psu.edu'));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ topics: ['topic:m7-07-entropy'], misconceptions: [], summary: 'Studied entropy.' }) } }] }));
  });
  await new Promise(resolve => model.listen(modelPort, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, KELVIN_MCP_DATA_DIR: dir, PORT: String(port), KELVIN_PUBLIC_ORIGIN: base,
    DEEPSEEK_API_KEY: 'fake-test-key', DEEPSEEK_BASE_URL: `http://127.0.0.1:${modelPort}` };
  const child = spawn(process.execPath, ['server.mjs'], { cwd: import.meta.dirname + '/..', env });
  try {
    await ready(`${base}/health`);
    const denied = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(denied.status, 401);
    assert.match(denied.headers.get('www-authenticate'), /resource_metadata/);
    const metadata = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);
    assert.equal((await metadata.json()).resource, `${base}/mcp`);
    const student = await connect(base, 'student-one@psu.edu');
    assert.match(student.getServerVersion().title, /Engineering Thermodynamics/);
    assert.match(student.getInstructions(), /thermodynamics questions.*course_map.*search_course.*get_card/i);
    const tools = (await student.listTools()).tools;
    for (const name of ['course_map', 'search_course', 'get_card']) assert.match(tools.find(t => t.name === name).description, /thermodynamics/i);
    assert.doesNotMatch(student.getInstructions(), /sample|placeholder|unverified/i);
    const map = parse(await student.callTool({ name: 'course_map', arguments: {} }));
    assert.equal(map.units.length, 9);
    assert.match(map.provenance, /real Penn State ME 300 Engineering Thermodynamics materials/);
    const matches = parse(await student.callTool({ name: 'search_course', arguments: { query: 'entropy', kind: 'topic' } }));
    assert.ok(matches.matches.some(x => x.id === 'topic:m7-07-entropy'));
    const card = parse(await student.callTool({ name: 'get_card', arguments: { id: 'topic:m7-07-entropy' } }));
    assert.match(card.content, /entropy/i);
    assert.equal(card.sourceMaterial, 'actual Penn State course files');
    const misconception = parse(await student.callTool({ name: 'get_card', arguments: { id: 'misc:m01-heat-energy-temperature-conflated' } }));
    assert.equal(misconception.sourceMaterial, 'cited thermodynamics education research');
    const hidden = await student.callTool({ name: 'get_card', arguments: { id: 'item:exam1-2021-i-1' } });
    assert.equal(hidden.isError, true);
    const skills = parse(await student.callTool({ name: 'list_teaching_skills', arguments: {} }));
    assert.ok(skills.find(s => s.name === 'response-pacing'));
    const pacing = parse(await student.callTool({ name: 'get_teaching_skill', arguments: { name: 'response-pacing' } }));
    assert.ok(pacing.content.trim().length > 0);
    const saved = parse(await student.callTool({ name: 'record_learning', arguments: { statement: 'I studied entropy balances today.', consent: true } }));
    assert.deepEqual(saved.topics, ['topic:m7-07-entropy']);
    const other = await connect(base, 'student-two@psu.edu', false);
    assert.equal(parse(await other.callTool({ name: 'my_learning', arguments: {} })).total, 0);
    assert.equal(parse(await student.callTool({ name: 'my_learning', arguments: {} })).total, 1);
    await other.close(); await student.close();
    const logPath = join(dir, 'request-logs', `${new Date().toISOString().slice(0, 10)}.jsonl`);
    assert.equal(existsSync(logPath), true);
    const log = readFileSync(logPath, 'utf8');
    assert.match(log, /"tool":"course_map"/);
    assert.doesNotMatch(log, /fake-test-key|I studied entropy balances today|student-one@psu.edu/);
  } finally { child.kill(); model.close(); rmSync(dir, { recursive: true, force: true }); }
});

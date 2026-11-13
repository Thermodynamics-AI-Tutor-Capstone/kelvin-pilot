import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateText, modelReady } from '../model-client.mjs';

test('pilot model client speaks Ollama chat and checks its model', async () => {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    if (req.url === '/api/tags') res.end(JSON.stringify({ models: [{ name: 'qwen3:8b' }] }));
    else {
      requests.push(JSON.parse(Buffer.concat(chunks).toString()));
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ model: 'qwen3:8b', message: { role: 'assistant', content: '{"summary":"entropy"}' } }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const before = { provider: process.env.MODEL_PROVIDER, base: process.env.OLLAMA_BASE_URL, model: process.env.OLLAMA_MODEL };
  try {
    process.env.MODEL_PROVIDER = 'ollama';
    process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${server.address().port}`;
    process.env.OLLAMA_MODEL = 'qwen3:8b';
    assert.equal(await modelReady(), true);
    const response = await generateText([{ role: 'user', content: 'Classify entropy' }], { json: true });
    assert.equal(response.provider, 'ollama');
    assert.equal(response.content, '{"summary":"entropy"}');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].model, 'qwen3:8b');
    assert.equal(requests[0].stream, false);
    assert.equal(requests[0].think, false);
    assert.equal(requests[0].format, 'json');
  } finally {
    for (const [name, value] of Object.entries({ MODEL_PROVIDER: before.provider, OLLAMA_BASE_URL: before.base, OLLAMA_MODEL: before.model })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await new Promise(resolve => server.close(resolve));
  }
});

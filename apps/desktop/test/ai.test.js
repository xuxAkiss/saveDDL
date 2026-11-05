import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import { extractWithAI, testAI } from '../src/lib/ai.js';

test('AI extraction sends a chat request and normalises JSON items', async (t) => {
  let received = null;
  const server = http.createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
    });
    request.on('end', () => {
      received = JSON.parse(raw);
      const content = raw.includes('\\"ok\\":true')
        ? '{"ok":true}'
        : JSON.stringify({
            items: [
              {
                subject: '高等数学',
                assignment: 'HW3',
                dueAt: '2026-11-10T23:59:00+08:00',
                confidence: 0.95,
              },
            ],
          });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;

  const items = await extractWithAI({
    text: '时限：2026-11-10 23:59 科目：高等数学 作业编号：HW3',
    baseUrl: `http://127.0.0.1:${port}/v1`,
    apiKey: 'test-key',
    model: 'test-model',
    documentHint: '当代人工智能实验课：实验二 - 搜索算法',
  });

  assert.equal(received.model, 'test-model');
  assert.equal(received.messages[0].role, 'system');
  assert.match(received.messages[1].content, /高等数学/u);
  assert.match(received.messages[1].content, /当代人工智能实验课/u);
  assert.equal(items.length, 1);
  assert.equal(items[0].subject, '高等数学');
  assert.equal(items[0].assignment, 'HW3');
  assert.equal(items[0].dueAt, '2026-11-10T15:59:00.000Z');
});

test('testAI reports a successful JSON response', async (t) => {
  const server = http.createServer((request, response) => {
    request.on('data', () => {});
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const port = server.address().port;

  const result = await testAI({
    baseUrl: `http://127.0.0.1:${port}`,
    apiKey: 'test-key',
    model: 'test-model',
  });
  assert.equal(result.ok, true);
  assert.equal(result.model, 'test-model');
});
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const server = path.resolve(here, '..', 'index.js');

test('MCP server exposes the full DDL tool flow', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'save-ddl-mcp-'));
  const dataFile = path.join(directory, 'ddls.json');
  const child = spawn(process.execPath, [server], {
    env: { ...process.env, SAVE_DDL_DATA: dataFile },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const pending = new Map();
  let buffer = '';
  let stderr = '';

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  t.after(async () => {
    child.kill();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  function request(id, method, params) {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timeout: ${method}\n${stderr}`)),
        5_000,
      );
      pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
  }

  const init = await request(1, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'save-ddl-test', version: '1.0.0' },
  });
  assert.equal(init.result.serverInfo.name, 'save-ddl');
  assert.equal(init.result.protocolVersion, '2025-06-18');
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

  const tools = await request(2, 'tools/list', {});
  assert.deepEqual(
    tools.result.tools.map((tool) => tool.name),
    ['ddl_list', 'ddl_add', 'ddl_complete', 'ddl_remove', 'ddl_extract'],
  );

  const added = await request(3, 'tools/call', {
    name: 'ddl_add',
    arguments: { subject: '高等数学', assignment: 'HW7', dueAt: '2026-11-25 23:59' },
  });
  assert.match(added.result.content[0].text, /已加入：高等数学 · HW7/u);

  const listed = await request(4, 'tools/call', { name: 'ddl_list', arguments: {} });
  assert.match(listed.result.content[0].text, /共 1 条/u);
  assert.match(listed.result.content[0].text, /高等数学 · HW7/u);
  const id = /id: ([0-9a-f-]+)/iu.exec(listed.result.content[0].text)?.[1];
  assert.ok(id);

  const completed = await request(5, 'tools/call', {
    name: 'ddl_complete',
    arguments: { id },
  });
  assert.match(completed.result.content[0].text, /已完成/u);

  const open = await request(6, 'tools/call', { name: 'ddl_list', arguments: {} });
  assert.match(open.result.content[0].text, /当前没有待办 DDL/u);

  const all = await request(7, 'tools/call', {
    name: 'ddl_list',
    arguments: { includeDone: true },
  });
  assert.match(all.result.content[0].text, /\[x\].*高等数学 · HW7/u);

  const extracted = await request(8, 'tools/call', {
    name: 'ddl_extract',
    arguments: { text: '时限：2026-11-28 10:00 科目：线性代数 作业编号：HW6' },
  });
  assert.match(extracted.result.content[0].text, /线性代数 · HW6/u);

  const removed = await request(9, 'tools/call', {
    name: 'ddl_remove',
    arguments: { id },
  });
  assert.match(removed.result.content[0].text, /已删除/u);

  const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  assert.equal(saved.items.length, 0);

  child.stdin.end();
  await new Promise((resolve) => child.once('exit', resolve));
});
#!/usr/bin/env node
/**
 * 拯救 DDL · MCP server
 * =====================
 *
 * 一个零依赖的 stdio MCP server，把「拯救 DDL」清单暴露给
 * Claude Code、Codex 以及其他支持 MCP 的 Agent。
 *
 * 数据文件与 DSH 插件共用：
 *   SAVE_DDL_DATA 环境变量优先；
 *   否则 $DSH_HOME/save-ddl/ddls.json（默认 ~/.dsh/save-ddl/ddls.json）。
 *
 * 只使用 stdout 传输 JSON-RPC；所有日志写 stderr。
 *
 * @module @save-ddl/mcp-server
 */
import { DdlStore, resolveDataFile } from '../store/index.js';
import { extractCandidates, formatDue } from '../core/src/ddl.js';

const SERVER_INFO = { name: 'save-ddl', version: '0.1.0' };
const SUPPORTED_PROTOCOLS = new Set(['2024-11-05', '2025-03-26', '2025-06-18']);
const store = new DdlStore(resolveDataFile());

function log(...args) {
  process.stderr.write(`[save-ddl] ${args.join(' ')}\n`);
}

const TOOLS = [
  {
    name: 'ddl_list',
    description:
      '查询「拯救 DDL」清单。用户问「我有哪些 DDL / 作业什么时候交 / 这周要交什么」时使用。默认只返回未完成项。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        includeDone: { type: 'boolean', description: '是否包含已完成，默认 false。' },
      },
    },
  },
  {
    name: 'ddl_add',
    description:
      '把一条作业 / 实验 / 论文的截止时间加入清单。dueAt 支持日期（2026-11-10，自动按当天 23:59）、日期时间（2026-11-10T23:59:00+08:00）或中文（11月10日、下周五）。只知道哪一天就只写日期；模糊时间用 dueLabel + 估计锚点，不要编造精确时刻。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        subject: { type: 'string', description: '科目 / 课程名，例如「高等数学」。' },
        assignment: { type: 'string', description: '作业编号或名称，例如「HW3」「实验 2」。' },
        dueAt: {
          type: 'string',
          description:
            '截止日期或日期时间。只有日期时自动按当天 23:59；例如 2026-11-10、2026-11-10T23:59:00+08:00、11月10日、下周五。',
          examples: ['2026-11-10', '2026-11-10T23:59:00+08:00', '11月10日', '下周五'],
        },
        duePrecision: {
          type: 'string',
          enum: ['datetime', 'date', 'fuzzy'],
          description: '可选精度：date 表示只知道哪一天；fuzzy 表示模糊时间，配合 dueLabel。',
        },
        dueLabel: {
          type: 'string',
          description: '可选，模糊时间的展示文本，例如「11月中旬」「老师另行通知」。dueAt 仍需填一个估计的提醒锚点。',
        },
        title: { type: 'string', description: '可选展示标题；省略时自动组合科目与作业编号。' },
        notes: { type: 'string', description: '备注，例如提交方式、链接。' },
      },
      required: ['subject', 'dueAt'],
    },
  },
  {
    name: 'ddl_complete',
    description: '按 id 把一条 DDL 标记为已完成。id 可从 ddl_list 获取。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { id: { type: 'string', description: 'DDL id。' } },
      required: ['id'],
    },
  },
  {
    name: 'ddl_remove',
    description: '按 id 删除一条 DDL。用户明确要求删除时使用；删除前建议先确认。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { id: { type: 'string', description: 'DDL id。' } },
      required: ['id'],
    },
  },
  {
    name: 'ddl_extract',
    description:
      '只解析文本、不写入清单。适合先从 PDF / Word / 网页提取文字后，把候选交给用户确认。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { text: { type: 'string', description: '要解析的原文。' } },
      required: ['text'],
    },
  },
];

function formatItemDue(item) {
  if (item.duePrecision === 'date') {
    return formatDue(item.dueAt, 'zh').replace(/\s+\d{2}:\d{2}$/u, '');
  }
  if (item.duePrecision === 'fuzzy' && item.dueLabel) return `约 ${item.dueLabel}`;
  return formatDue(item.dueAt, 'zh');
}

function formatItem(item) {
  const done = item.status === 'done';
  return `- ${done ? '[x]' : '[ ]'} ${formatItemDue(item)} · ${item.title}（id: ${item.id}）`;
}

function textResult(text, isError = false) {
  return { content: [{ type: 'text', text }], isError };
}

async function callTool(name, args = {}) {
  if (!TOOLS.some((tool) => tool.name === name)) {
    throw new Error(`未知工具：${name}`);
  }

  if (name === 'ddl_list') {
    const state = await store.read();
    const items = store.list(state, args.includeDone === true);
    if (items.length === 0) return textResult('当前没有待办 DDL');
    return textResult(`共 ${items.length} 条\n${items.map(formatItem).join('\n')}`);
  }

  if (name === 'ddl_add') {
    const result = await store.update((state) =>
      store.add(state, { ...args, source: { kind: 'agent' } }),
    );
    return textResult(
      result.duplicate
        ? `已存在：${result.item.title}（${formatItemDue(result.item)}）`
        : `已加入：${result.item.title}（${formatItemDue(result.item)}）`,
    );
  }

  if (name === 'ddl_complete') {
    const item = await store.update((state) => store.complete(state, args.id));
    return textResult(`已完成：${item.title}`);
  }

  if (name === 'ddl_remove') {
    await store.update((state) => store.remove(state, args.id));
    return textResult('已删除');
  }

  if (name === 'ddl_extract') {
    const candidates = extractCandidates(args.text, { now: new Date(), max: 8 });
    if (candidates.length === 0) return textResult('没有识别到截止时间');
    return textResult(
      `识别到 ${candidates.length} 条候选；确认后用 ddl_add 加入：\n${candidates
        .map(
          (candidate) =>
            `- ${formatDue(candidate.dueAt, 'zh')} · ${candidate.title}（置信度 ${candidate.confidence}）`,
        )
        .join('\n')}`,
    );
  }

  throw new Error(`未实现的工具：${name}`);
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function respondError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handleRequest(message) {
  const { id, method, params } = message;

  // 通知没有 id，不需要响应。
  if (id === undefined || id === null) {
    if (method === 'notifications/initialized' || method === 'notifications/cancelled') return;
    return;
  }

  if (method === 'initialize') {
    const requested = params?.protocolVersion;
    return respond(id, {
      protocolVersion: SUPPORTED_PROTOCOLS.has(requested) ? requested : '2024-11-05',
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions:
        '这是「拯救 DDL」清单。用 ddl_list 查询；ddl_add 加入；日期不明确时先问用户，不要编造截止时间。',
    });
  }

  if (method === 'ping') return respond(id, {});
  if (method === 'tools/list') return respond(id, { tools: TOOLS });

  if (method === 'tools/call') {
    const name = params?.name;
    const args = params?.arguments ?? {};
    try {
      const result = await callTool(name, args);
      return respond(id, result);
    } catch (error) {
      return respond(id, textResult(String(error?.message ?? error), true));
    }
  }

  // 没有声明 resources / prompts，但有些客户端会探测，返回空列表即可。
  if (method === 'resources/list') return respond(id, { resources: [] });
  if (method === 'prompts/list') return respond(id, { prompts: [] });
  if (method === 'logging/setLevel') return respond(id, {});

  return respondError(id, -32601, `Method not found: ${method}`);
}

let chain = Promise.resolve();

function enqueue(line) {
  chain = chain
    .then(async () => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        return;
      }
      await handleRequest(message);
    })
    .catch((error) => log('handler error:', error?.message ?? error));
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) enqueue(line);
  }
});
process.stdin.on('end', () => {
  chain.then(() => process.exit(0));
});
process.stdin.resume();

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

log(`ready; data=${store.file}`);
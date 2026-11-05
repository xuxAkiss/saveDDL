/**
 * 拯救 DDL · DSH Host 插件
 * =========================
 *
 * 职责：
 *   1. 扫描工作区里的 Markdown / 文本文件，发现疑似 DDL（截止时间 + 科目 + 作业编号）。
 *   2. 把 DDL 持久化到 `$DSH_HOME/save-ddl/ddls.json`，供 DSH 面板、Agent 工具
 *      以及未来的 Electron 托盘应用共用。
 *   3. 提供同源 HTTP API，让客户端面板读取状态、加入 / 完成 / 删除 DDL，
 *      并导出 .ics 日历。
 *   4. 注册 `ddl` Agent 工具与系统提示，让模型可以主动加入或查询 DDL。
 *
 * 说明：这里没有把 API Key 写进插件。文档类（PDF / Word）的 AI 提取由 Agent
 * 或未来的 Electron 设置页负责；本插件只接收结构化结果。
 *
 * @module @local/save-ddl
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

import {
  extractCandidates,
  formatDue,
  formatTitle,
  parseDue,
} from './lib/core.js';

export const name = 'save-ddl';
export const inject = ['webServer', 'tools', 'systemPrompt'];

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 256 * 1024;

const DEFAULT_CONFIG = {
  /** 两次自动扫描之间至少间隔多久。 */
  scanIntervalMs: 45_000,
  /** 每个工作区最多向下扫描几层。 */
  maxDepth: 3,
  /** 每个工作区最多检查多少个文本文件。 */
  maxFilesPerRoot: 240,
  /** 单个文件最大读取字节数。 */
  maxFileBytes: 256 * 1024,
  /** 只扫描最近多少天内修改过的文件。 */
  maxAgeDays: 45,
  /** 数据目录；默认 `$DSH_HOME/save-ddl`。 */
  dataDir: '',
};

const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.text', '.rst']);

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'vendor',
  'target',
  'release',
  'generated',
  '__pycache__',
  '_tmp',
  'venv',
  '.venv',
]);

const SUGGESTION_LIMIT = 20;
const SIGNATURE_LIMIT = 500;

/** 简单字符串清洗。 */
function clean(value, max = 200) {
  return String(value ?? '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, max);
}

/** 时间转 ICS 的 UTC 基本格式。 */
function toIcsDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');
}

/** ICS 文本转义。 */
function icsEscape(value) {
  return String(value ?? '')
    .replace(/\\/gu, '\\\\')
    .replace(/\n/gu, '\\n')
    .replace(/,/gu, '\\,')
    .replace(/;/gu, '\\;');
}

/** 读取并限制请求体大小。 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** 统一 JSON 响应。 */
function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

/** 只接受同源请求；挡掉第三方网页对本地端口的简单请求。 */
function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/** 把任意输入转换成 Date。 */
function coerceDue(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = clean(value, 120);
  if (!text) return null;

  // 只写了日期：默认当天 23:59。
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(text);
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 23, 59);
  }

  // ISO / `YYYY-MM-DD HH:mm`。
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}/u.test(text)) {
    const date = new Date(text.replace(' ', 'T'));
    if (!Number.isNaN(date.getTime())) return date;
  }

  const parsed = parseDue(text);
  if (parsed) return parsed.date;

  const fallback = new Date(text);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

/** 统一来源描述。 */
function sanitizeSource(source) {
  if (!source || typeof source !== 'object') return { kind: 'manual' };
  const kind = ['file', 'manual', 'agent', 'text', 'dsh'].includes(source.kind)
    ? source.kind
    : 'manual';
  return {
    kind,
    ...(source.path ? { path: clean(source.path, 500) } : {}),
    ...(source.name ? { name: clean(source.name, 200) } : {}),
  };
}

/** 生成一条 DDL 的稳定签名，用来避免重复提醒。 */
function signatureOf(file, candidate) {
  return createHash('sha1')
    .update(
      [
        file.path,
        String(file.mtimeMs ?? ''),
        candidate.dueAt,
        candidate.subject,
        candidate.assignment,
      ].join('|'),
    )
    .digest('hex')
    .slice(0, 32);
}

export async function apply(ctx, config = {}) {
  const settings = { ...DEFAULT_CONFIG, ...(config && typeof config === 'object' ? config : {}) };
  const log = ctx.logger ?? console;
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const dataDir = settings.dataDir || path.join(dshHome, 'save-ddl');
  const dataFile = path.join(dataDir, 'ddls.json');

  /** @type {{ version: number, items: any[], dismissed: string[], accepted: string[], suggestions: any[], scannedAt: number, roots: string[], scanning: boolean }} */
  const state = {
    version: 1,
    items: [],
    dismissed: [],
    accepted: [],
    suggestions: [],
    scannedAt: 0,
    roots: [],
    scanning: false,
  };

  /** @type {Map<string, { key: string, candidates: any[] }>} */
  const fileCache = new Map();
  let saveTimer = null;
  let flushChain = Promise.resolve();
  let scanPromise = null;
  let stateMtime = 0;
  const deletedIds = new Set();

  async function loadState() {
    try {
      const raw = await fs.readFile(dataFile, 'utf8');
      const stat = await fs.stat(dataFile);
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.items)) state.items = parsed.items.filter((item) => item && item.id);
      if (Array.isArray(parsed.dismissed)) state.dismissed = parsed.dismissed.slice(-SIGNATURE_LIMIT);
      if (Array.isArray(parsed.accepted)) state.accepted = parsed.accepted.slice(-SIGNATURE_LIMIT);
      stateMtime = stat.mtimeMs;
    } catch (error) {
      if (error?.code !== 'ENOENT') log.warn?.(`save-ddl: 读取数据失败：${error?.message ?? error}`);
    }
  }

  /**
   * 其他 Agent（Claude Code / Codex / CLI）可能刚写过同一个 ddls.json。
   * 在每次读状态或改数据前对比 mtime，外部有更新就重新加载。
   */
  async function syncFromDisk() {
    // 本地还有未落盘的修改时，内存状态才是权威的。
    if (saveTimer !== null) return;
    let stat;
    try {
      stat = await fs.stat(dataFile);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        stateMtime = 0;
        return;
      }
      throw error;
    }
    if (stat.mtimeMs === stateMtime) return;

    try {
      const raw = await fs.readFile(dataFile, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.items)) {
        state.items = parsed.items.filter((item) => item && item.id);
      }
      if (Array.isArray(parsed.dismissed)) {
        state.dismissed = parsed.dismissed.filter((value) => typeof value === 'string').slice(-SIGNATURE_LIMIT);
      }
      if (Array.isArray(parsed.accepted)) {
        state.accepted = parsed.accepted.filter((value) => typeof value === 'string').slice(-SIGNATURE_LIMIT);
      }
      stateMtime = stat.mtimeMs;
    } catch (error) {
      log.warn?.(`save-ddl: 同步外部数据失败：${error?.message ?? error}`);
    }
  }

  async function withDataLock(operation) {
    await fs.mkdir(dataDir, { recursive: true });
    const lockFile = `${dataFile}.lock`;
    const deadline = Date.now() + 8000;
    for (;;) {
      let handle;
      try {
        handle = await fs.open(lockFile, 'wx');
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        try {
          const stat = await fs.stat(lockFile);
          if (Date.now() - stat.mtimeMs > 15_000) {
            await fs.unlink(lockFile).catch(() => {});
            continue;
          }
        } catch {
          /* 锁刚释放，重试 */
        }
        if (Date.now() > deadline) throw new Error('数据文件正在被另一个进程使用');
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue;
      }
      try {
        return await operation();
      } finally {
        await handle.close().catch(() => {});
        await fs.unlink(lockFile).catch(() => {});
      }
    }
  }

  async function writeSnapshot() {
    await withDataLock(async () => {
      // 与其他 Agent（MCP / CLI）并发写时，保留它们刚加入、本进程还没见过的条目。
      try {
        const raw = await fs.readFile(dataFile, 'utf8');
        const disk = JSON.parse(raw);
        const known = new Set(state.items.map((item) => item.id));
        for (const item of Array.isArray(disk.items) ? disk.items : []) {
          if (item?.id && !known.has(item.id) && !deletedIds.has(item.id)) {
            state.items.push(item);
            known.add(item.id);
          }
        }
        for (const signature of Array.isArray(disk.accepted) ? disk.accepted : []) {
          if (typeof signature === 'string' && !state.accepted.includes(signature)) {
            state.accepted.push(signature);
          }
        }
        for (const signature of Array.isArray(disk.dismissed) ? disk.dismissed : []) {
          if (typeof signature === 'string' && !state.dismissed.includes(signature)) {
            state.dismissed.push(signature);
          }
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          log.warn?.(`save-ddl: 合并外部数据失败：${error?.message ?? error}`);
        }
      }

      const snapshot = {
        version: 1,
        items: state.items,
        dismissed: state.dismissed.slice(-SIGNATURE_LIMIT),
        accepted: state.accepted.slice(-SIGNATURE_LIMIT),
        updatedAt: new Date().toISOString(),
      };
      await fs.mkdir(dataDir, { recursive: true });
      try {
        await fs.copyFile(dataFile, `${dataFile}.bak`);
      } catch (error) {
        if (error?.code !== 'ENOENT') log.warn?.(`save-ddl: 备份失败：${error?.message ?? error}`);
      }
      const temp = `${dataFile}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(temp, JSON.stringify(snapshot, null, 2), 'utf8');
      await fs.rename(temp, dataFile);
      deletedIds.clear();
      try {
        stateMtime = (await fs.stat(dataFile)).mtimeMs;
      } catch {
        stateMtime = Date.now();
      }
    });
  }

  function flush() {
    const run = flushChain.then(writeSnapshot).catch((error) => {
      log.warn?.(`save-ddl: 保存失败：${error?.message ?? error}`);
    });
    flushChain = run;
    return run;
  }

  function scheduleSave() {
    if (saveTimer !== null) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void flush();
    }, 250);
  }

  function remember(list, signature) {
    if (!list.includes(signature)) list.push(signature);
    if (list.length > SIGNATURE_LIMIT) list.splice(0, list.length - SIGNATURE_LIMIT);
  }

  function findItem(subject, assignment, dueIso) {
    const due = Date.parse(dueIso);
    return state.items.find(
      (item) =>
        item.subject === subject &&
        item.assignment === assignment &&
        Math.abs(Date.parse(item.dueAt) - due) < 60_000,
    );
  }

  function addItem(input) {
    const due = coerceDue(input?.dueAt ?? input?.text ?? input?.title);
    if (!due) {
      throw new Error('无法识别截止时间。请提供 2026-11-10 23:59、11月10日或「下周五 23:59」。');
    }
    const subject = clean(input?.subject, 60) || '未命名课程';
    const assignment = clean(input?.assignment, 40);
    const existing = findItem(subject, assignment, due.toISOString());
    if (existing) return { item: existing, duplicate: true };

    const now = new Date().toISOString();
    const item = {
      id: randomUUID(),
      subject,
      assignment,
      title: clean(input?.title, 120) || formatTitle(subject, assignment),
      dueAt: due.toISOString(),
      status: 'todo',
      notes: clean(input?.notes, 1000),
      source: sanitizeSource(input?.source),
      createdAt: now,
      updatedAt: now,
    };
    state.items.push(item);
    scheduleSave();
    return { item, duplicate: false };
  }

  function addSuggestion(candidate, file) {
    if (!candidate?.dueAt) return;
    const signature = signatureOf(file, candidate);
    if (state.dismissed.includes(signature) || state.accepted.includes(signature)) return;
    if (state.suggestions.some((item) => item.signature === signature)) return;
    if (findItem(candidate.subject, candidate.assignment, candidate.dueAt)) {
      remember(state.accepted, signature);
      scheduleSave();
      return;
    }
    const id = createHash('sha1').update(signature).digest('hex').slice(0, 12);
    state.suggestions.push({
      id,
      signature,
      subject: candidate.subject,
      assignment: candidate.assignment,
      title: candidate.title,
      dueAt: candidate.dueAt,
      confidence: candidate.confidence,
      snippet: candidate.snippet,
      sourcePath: file.path,
      sourceName: file.name,
      createdAt: new Date().toISOString(),
    });
    if (state.suggestions.length > SUGGESTION_LIMIT) {
      state.suggestions = state.suggestions.slice(-SUGGESTION_LIMIT);
    }
  }

  function acceptSuggestion(id) {
    const suggestion = state.suggestions.find((item) => item.id === id);
    if (!suggestion) return null;
    state.suggestions = state.suggestions.filter((item) => item.id !== id);
    remember(state.accepted, suggestion.signature);
    const result = addItem({
      subject: suggestion.subject,
      assignment: suggestion.assignment,
      dueAt: suggestion.dueAt,
      title: suggestion.title,
      source: {
        kind: 'file',
        path: suggestion.sourcePath,
        name: suggestion.sourceName,
      },
    });
    scheduleSave();
    return result.item;
  }

  function dismissSuggestion(id) {
    const suggestion = state.suggestions.find((item) => item.id === id);
    if (!suggestion) return false;
    state.suggestions = state.suggestions.filter((item) => item.id !== id);
    remember(state.dismissed, suggestion.signature);
    scheduleSave();
    return true;
  }

  async function collectRoots() {
    const roots = new Set();
    const workingDirectory = ctx.get('workingDirectory');
    if (workingDirectory?.defaultDirectory) roots.add(workingDirectory.defaultDirectory);

    // 只扫描当前活着的会话目录，避免把历史上所有工作区都翻一遍。
    try {
      const agents = ctx.get('agents');
      if (workingDirectory && agents && typeof agents.list === 'function') {
        for (const agent of agents.list()) {
          try {
            if (agent?.session && typeof workingDirectory.get === 'function') {
              const directory = workingDirectory.get(agent.session);
              if (directory) roots.add(directory);
              continue;
            }
          } catch {
            /* 继续尝试 ensure */
          }
          try {
            const directory = await workingDirectory.ensure(agent);
            if (directory) roots.add(directory);
          } catch {
            /* 忽略不可用的会话目录 */
          }
        }
      }
    } catch (error) {
      log.warn?.(`save-ddl: 读取会话目录失败：${error?.message ?? error}`);
    }

    if (roots.size === 0) roots.add(process.cwd());
    return [...roots].filter((root) => typeof root === 'string' && root.length > 0).slice(0, 8);
  }

  /** file 是否位于 root 目录内。 */
  function isInside(root, file) {
    if (typeof root !== 'string' || typeof file !== 'string') return false;
    const relative = path.relative(root, file);
    return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
  }

  /** 只保留当前扫描根目录下的建议，避免旧工作区的内容留在面板里。 */
  function pruneSuggestions(roots) {
    if (roots.length === 0) return;
    state.suggestions = state.suggestions.filter((suggestion) =>
      roots.some((root) => isInside(root, suggestion.sourcePath)),
    );
  }

  async function collectFiles(root, deadline) {
    const files = [];
    const queue = [{ directory: root, depth: 0 }];
    while (queue.length > 0) {
      if (files.length >= settings.maxFilesPerRoot || Date.now() > deadline) break;
      const current = queue.shift();
      let entries;
      try {
        entries = await fs.readdir(current.directory, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (files.length >= settings.maxFilesPerRoot || Date.now() > deadline) break;
        const full = path.join(current.directory, entry.name);
        if (entry.isDirectory()) {
          if (current.depth >= settings.maxDepth) continue;
          if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
          queue.push({ directory: full, depth: current.depth + 1 });
          continue;
        }
        if (!entry.isFile()) continue;
        if (!TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
        files.push(full);
      }
    }
    return files;
  }

  async function scanFile(file, now) {
    let stat;
    try {
      stat = await fs.stat(file);
    } catch {
      return;
    }
    if (!stat.isFile() || stat.size === 0 || stat.size > settings.maxFileBytes) return;
    if (now.getTime() - stat.mtimeMs > settings.maxAgeDays * DAY_MS) return;

    const key = `${stat.mtimeMs}:${stat.size}`;
    let cached = fileCache.get(file);
    if (!cached || cached.key !== key) {
      let text;
      try {
        text = await fs.readFile(file, 'utf8');
      } catch {
        return;
      }

      // 允许文档用一行注释声明「这里只是示例，不要扫描」。
      if (/save-ddl\s*:\s*ignore/iu.test(text)) {
        fileCache.set(file, { key, candidates: [] });
        return;
      }

      // 代码块里的示例日期通常不是真实 DDL；跳过围栏代码块可显著减少误报。
      const scannable = text.replace(/```[\s\S]*?```/gu, '\n').replace(/~~~[\s\S]*?~~~/gu, '\n');
      const candidates = extractCandidates(scannable, {
        now,
        sourceName: path.basename(file),
        max: 4,
      }).filter((candidate) => candidate.assignment && candidate.confidence >= 0.85);
      cached = { key, candidates };
      fileCache.set(file, cached);
      if (fileCache.size > 1200) fileCache.clear();
    }
    for (const candidate of cached.candidates) {
      addSuggestion(candidate, { path: file, name: path.basename(file), mtimeMs: stat.mtimeMs });
    }
  }

  async function doScan() {
    if (state.scanning) return;
    state.scanning = true;
    try {
      await syncFromDisk();
      const roots = await collectRoots();
      state.roots = roots;
      pruneSuggestions(roots);
      const now = new Date();
      const deadline = Date.now() + 6000;
      for (const root of roots) {
        if (Date.now() > deadline) break;
        const files = await collectFiles(root, deadline);
        for (const file of files) {
          if (Date.now() > deadline) break;
          await scanFile(file, now);
        }
      }
      state.scannedAt = Date.now();
    } catch (error) {
      log.warn?.(`save-ddl: 扫描失败：${error?.message ?? error}`);
    } finally {
      state.scanning = false;
    }
  }

  function scan() {
    if (scanPromise) return scanPromise;
    scanPromise = doScan().finally(() => {
      scanPromise = null;
    });
    return scanPromise;
  }

  function maybeScan(force = false) {
    if (scanPromise) return;
    if (!force && state.scannedAt > 0 && Date.now() - state.scannedAt < settings.scanIntervalMs) return;
    void scan();
  }

  function publicState() {
    return {
      ok: true,
      serverTime: new Date().toISOString(),
      items: [...state.items].sort((left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt)),
      suggestions: state.suggestions,
      scannedAt: state.scannedAt ? new Date(state.scannedAt).toISOString() : null,
      scanning: state.scanning,
      roots: state.roots,
    };
  }

  function calendarText() {
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Save DDL//Save DDL//CN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
    ];
    const stamp = toIcsDate(new Date());
    for (const item of state.items) {
      if (item.status === 'done') continue;
      lines.push(
        'BEGIN:VEVENT',
        `UID:${item.id}@save-ddl`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${toIcsDate(item.dueAt)}`,
        `DTEND:${toIcsDate(new Date(Date.parse(item.dueAt) + 30 * 60_000))}`,
        `SUMMARY:${icsEscape(item.title)}`,
        `DESCRIPTION:${icsEscape(item.notes || `${item.subject} ${item.assignment}`.trim())}`,
        `CATEGORIES:${icsEscape(item.subject)}`,
        'END:VEVENT',
      );
    }
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  async function dispatch(body) {
    await syncFromDisk();
    const action = clean(body?.action, 40);
    switch (action) {
      case 'add': {
        const result = addItem(body?.item ?? body);
        return {
          message: result.duplicate ? '这条 DDL 已经存在' : '已加入 DDL',
          item: result.item,
        };
      }
      case 'add-text': {
        const candidates = extractCandidates(body?.text, { now: new Date(), max: 8 });
        let added = 0;
        const items = [];
        for (const candidate of candidates) {
          const result = addItem({ ...candidate, source: { kind: 'text' } });
          items.push(result.item);
          if (!result.duplicate) added += 1;
        }
        return {
          message:
            candidates.length === 0
              ? '没有从文本里识别到截止时间。可以写成「时限：2026-11-10 23:59 科目：高等数学 作业编号：HW3」。'
              : added > 0
                ? `已加入 ${added} 条 DDL`
                : '识别到的 DDL 已经存在',
          added,
          candidates,
          addedItems: items,
        };
      }
      case 'accept': {
        const item = acceptSuggestion(clean(body?.id, 80));
        if (!item) throw new Error('这条建议已经处理过了');
        return { message: `已加入：${item.title}`, item };
      }
      case 'accept-all': {
        const pending = [...state.suggestions];
        const items = pending.map((suggestion) => acceptSuggestion(suggestion.id)).filter(Boolean);
        return { message: `已加入 ${items.length} 条 DDL`, count: items.length, addedItems: items };
      }
      case 'dismiss': {
        if (!dismissSuggestion(clean(body?.id, 80))) throw new Error('这条建议已经处理过了');
        return { message: '已忽略' };
      }
      case 'dismiss-all': {
        const count = state.suggestions.length;
        for (const suggestion of [...state.suggestions]) dismissSuggestion(suggestion.id);
        return { message: `已忽略 ${count} 条建议`, count };
      }
      case 'toggle': {
        const item = state.items.find((entry) => entry.id === body?.id);
        if (!item) throw new Error('找不到这条 DDL');
        item.status = item.status === 'done' ? 'todo' : 'done';
        item.completedAt = item.status === 'done' ? new Date().toISOString() : undefined;
        item.updatedAt = new Date().toISOString();
        scheduleSave();
        return { message: item.status === 'done' ? '已完成' : '已恢复为待办', item };
      }
      case 'delete': {
        const item = state.items.find((entry) => entry.id === body?.id);
        if (!item) throw new Error('找不到这条 DDL');
        deletedIds.add(item.id);
        state.items = state.items.filter((entry) => entry.id !== item.id);
        scheduleSave();
        return { message: '已删除' };
      }
      case 'clear-done': {
        const removed = state.items.filter((entry) => entry.status === 'done');
        for (const item of removed) deletedIds.add(item.id);
        state.items = state.items.filter((entry) => entry.status !== 'done');
        scheduleSave();
        return { message: `已清理 ${removed.length} 条已完成` };
      }
      case 'update': {
        const item = state.items.find((entry) => entry.id === body?.id);
        if (!item) throw new Error('找不到这条 DDL');
        if (body?.subject !== undefined) item.subject = clean(body.subject, 60) || item.subject;
        if (body?.assignment !== undefined) item.assignment = clean(body.assignment, 40);
        if (body?.notes !== undefined) item.notes = clean(body.notes, 1000);
        if (body?.dueAt !== undefined) {
          const due = coerceDue(body.dueAt);
          if (!due) throw new Error('无法识别新的截止时间');
          item.dueAt = due.toISOString();
        }
        item.title = clean(body?.title, 120) || formatTitle(item.subject, item.assignment);
        item.updatedAt = new Date().toISOString();
        scheduleSave();
        return { message: '已更新', item };
      }
      case 'refresh': {
        await scan();
        return { message: '已重新扫描工作区' };
      }
      default:
        throw new Error(`未知操作：${action || '(空)'}`);
    }
  }

  await loadState();

  // ---- HTTP API ---------------------------------------------------------
  const wrap = (handler) => async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (!res.headersSent) {
        sendJson(res, 500, { ok: false, error: String(error?.message ?? error) });
      } else {
        res.end();
      }
    }
  };

  const stateRoute = wrap(async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
    await syncFromDisk();
    maybeScan(false);
    sendJson(res, 200, publicState());
  });

  const actionRoute = wrap(async (req, res) => {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
    if (!isSameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden' });
    const contentType = String(req.headers['content-type'] ?? '');
    if (!contentType.includes('application/json')) {
      return sendJson(res, 415, { ok: false, error: 'content_type_must_be_json' });
    }
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: String(error?.message ?? error) });
    }
    try {
      const outcome = await dispatch(body);
      sendJson(res, 200, { ...publicState(), ...outcome });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: String(error?.message ?? error) });
    }
  });

  const calendarRoute = wrap(async (req, res) => {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
    const body = calendarText();
    res.writeHead(200, {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'attachment; filename="save-ddl.ics"',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
    });
    res.end(body);
  });

  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/save-ddl/state', handler: stateRoute }), 'save-ddl.route.state');
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/save-ddl/action', handler: actionRoute }), 'save-ddl.route.action');
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/save-ddl/calendar.ics', handler: calendarRoute }), 'save-ddl.route.calendar');

  // ---- 周期扫描与初始扫描 ------------------------------------------------
  ctx.effect(() => {
    const timer = setInterval(() => void scan(), settings.scanIntervalMs);
    return () => clearInterval(timer);
  }, 'save-ddl.interval');

  ctx.effect(() => {
    const timer = setTimeout(() => void scan(), 1200);
    return () => clearTimeout(timer);
  }, 'save-ddl.initial-scan');

  ctx.effect(
    () => () => {
      if (saveTimer !== null) {
        clearTimeout(saveTimer);
        saveTimer = null;
        void flush();
      }
    },
    'save-ddl.flush',
  );

  // ---- Agent 工具 --------------------------------------------------------
  const TOOL_DESCRIPTION = [
    '管理「拯救 DDL」的截止时间清单。',
    '当用户给出作业 / 论文 / 实验的截止时间，或你刚在工作区写入含 DDL 的文件时，用 action=add 加入。',
    '当用户问「我有哪些 DDL / 作业还有多久 / 这周要交什么」时，用 action=list 查询后再回答。',
    'action=extract 只解析文本、不落库，适合你先从 PDF / Word 提取文字后让用户确认。',
    'dueAt 支持 ISO（2026-11-10T23:59:00+08:00）或中文（11月10日 23:59、下周五 23:59）；不要编造日期。',
  ].join('\n');

  const ITEM_SCHEMA = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      subject: { type: 'string' },
      assignment: { type: 'string' },
      title: { type: 'string' },
      dueAt: { type: 'string' },
      status: { type: 'string', enum: ['todo', 'done'] },
    },
  };

  const OUTPUT_SCHEMA = {
    type: 'object',
    properties: {
      action: { type: 'string' },
      count: { type: 'number' },
      message: { type: 'string' },
      item: ITEM_SCHEMA,
      items: { type: 'array', items: ITEM_SCHEMA },
      candidates: { type: 'array', items: ITEM_SCHEMA },
    },
  };

  const PARAMETERS = {
    type: 'object',
    additionalProperties: false,
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'add', 'complete', 'remove', 'extract'],
        description: 'list=查询；add=加入；complete=标记完成；remove=删除；extract=只解析文本。',
      },
      subject: { type: 'string', description: '科目 / 课程名，例如「高等数学」。' },
      assignment: { type: 'string', description: '作业编号或名称，例如「HW3」「实验 2」。' },
      dueAt: {
        type: 'string',
        description: '截止时间，ISO 或中文，例如 2026-11-10T23:59:00+08:00、「11月10日 23:59」、「下周五 23:59」。',
      },
      title: { type: 'string', description: '可选展示标题；省略时自动组合科目与作业编号。' },
      notes: { type: 'string', description: '备注，例如提交方式、链接。' },
      id: { type: 'string', description: 'complete / remove 时的 DDL id。' },
      text: { type: 'string', description: 'action=extract 时要解析的原文。' },
      includeDone: { type: 'boolean', description: 'list 时是否包含已完成，默认 false。' },
    },
    required: ['action'],
  };

  const definition = {
    name: 'ddl',
    description: TOOL_DESCRIPTION,
    parameters: PARAMETERS,
    timeoutMs: 20_000,
    isConcurrencySafe: () => false,
    output: {
      schema: OUTPUT_SCHEMA,
      render(_args, value) {
        const lines = [];
        if (value?.message) lines.push(value.message);
        if (Array.isArray(value?.items)) {
          for (const item of value.items) {
            lines.push(
              `- ${item.status === 'done' ? '[x]' : '[ ]'} ${formatDue(item.dueAt)} · ${item.title}（id: ${item.id}）`,
            );
          }
        }
        if (Array.isArray(value?.candidates)) {
          for (const candidate of value.candidates) {
            lines.push(
              `- ${formatDue(candidate.dueAt)} · ${candidate.title}（置信度 ${candidate.confidence}）`,
            );
          }
        }
        return [{ type: 'text', text: lines.join('\n') || '完成' }];
      },
    },
    async execute(args) {
      await syncFromDisk();
      const action = clean(args?.action, 20);
      if (action === 'list') {
        const includeDone = args?.includeDone === true;
        const items = state.items
          .filter((item) => includeDone || item.status !== 'done')
          .sort((left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt))
          .map((item) => ({
            id: item.id,
            subject: item.subject,
            assignment: item.assignment,
            title: item.title,
            dueAt: item.dueAt,
            status: item.status,
          }));
        return {
          action,
          count: items.length,
          items,
          message: items.length === 0 ? '当前没有待办 DDL' : `共 ${items.length} 条`,
        };
      }
      if (action === 'add') {
        const result = addItem({
          subject: args?.subject,
          assignment: args?.assignment,
          dueAt: args?.dueAt,
          title: args?.title,
          notes: args?.notes,
          source: { kind: 'agent' },
        });
        return {
          action,
          message: result.duplicate
            ? `已存在：${result.item.title}`
            : `已加入：${result.item.title}（${formatDue(result.item.dueAt)}）`,
          item: result.item,
        };
      }
      if (action === 'complete') {
        const item = state.items.find((entry) => entry.id === args?.id);
        if (!item) throw new Error('找不到这条 DDL');
        item.status = 'done';
        item.completedAt = new Date().toISOString();
        item.updatedAt = item.completedAt;
        scheduleSave();
        return { action, message: `已完成：${item.title}`, item };
      }
      if (action === 'remove') {
        const before = state.items.length;
        state.items = state.items.filter((entry) => entry.id !== args?.id);
        if (state.items.length === before) throw new Error('找不到这条 DDL');
        scheduleSave();
        return { action, message: '已删除' };
      }
      if (action === 'extract') {
        const candidates = extractCandidates(args?.text, { now: new Date(), max: 8 });
        return {
          action,
          count: candidates.length,
          candidates,
          message:
            candidates.length === 0
              ? '没有识别到截止时间'
              : `识别到 ${candidates.length} 条候选；确认后用 action=add 加入`,
        };
      }
      throw new Error(`未知 action：${action || '(空)'}`);
    },
  };

  ctx.effect(() => ctx.tools.register(definition), 'save-ddl.tool');

  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: 'save-ddl',
        order: 55,
        text: [
          '「拯救 DDL」清单已启用。',
          '当工作区文件包含作业截止时间时，插件会向用户提示；你也可以用 ddl 工具把已确认的条目加入清单。',
          '用户问「我有哪些 DDL / 作业什么时候交 / 还有几天」时，先调用 ddl（action=list）查询，再基于真实数据回答。',
          '不要编造截止时间；日期不明确时先向用户确认。',
        ].join('\n'),
      }),
    'save-ddl.prompt',
  );

  log.info?.(`save-ddl: 已启用，数据文件 ${dataFile}`);
}
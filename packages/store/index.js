/**
 * 拯救 DDL · 共享文件存储
 * ========================
 *
 * DSH 插件、MCP server、CLI 都读写同一份 `ddls.json`。
 * 这里用「锁文件 + 临时文件 + rename」避免多个进程同时写坏文件。
 *
 * 注意：这是单用户本地存储，不提供跨机器事务。
 *
 * @module @save-ddl/store
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { parseDue, formatTitle } from '../core/src/ddl.js';

const LOCK_TIMEOUT_MS = 8_000;
const STALE_LOCK_MS = 15_000;
const MAX_SIGNATURES = 500;

const SOURCE_KINDS = new Set(['file', 'manual', 'agent', 'text', 'dsh']);

/** 空状态。 */
function emptyState() {
  return { version: 1, items: [], dismissed: [], accepted: [] };
}

/** 把磁盘上的任意 JSON 规范化为 v1 状态。 */
export function normalizeState(raw) {
  const state = emptyState();
  if (!raw || typeof raw !== 'object') return state;
  if (Array.isArray(raw.items)) {
    state.items = raw.items.filter((item) => item && typeof item.id === 'string');
  }
  if (Array.isArray(raw.dismissed)) {
    state.dismissed = raw.dismissed.filter((value) => typeof value === 'string').slice(-MAX_SIGNATURES);
  }
  if (Array.isArray(raw.accepted)) {
    state.accepted = raw.accepted.filter((value) => typeof value === 'string').slice(-MAX_SIGNATURES);
  }
  return state;
}

/** 默认数据文件：与 DSH 插件保持一致。 */
export function resolveDataFile(env = process.env) {
  if (env.SAVE_DDL_DATA) return path.resolve(env.SAVE_DDL_DATA);
  const home = env.DSH_HOME || path.join(os.homedir(), '.dsh');
  return path.join(home, 'save-ddl', 'ddls.json');
}

function clean(value, max = 200) {
  return String(value ?? '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, max);
}

function sanitizeSource(source) {
  if (!source || typeof source !== 'object') return { kind: 'manual' };
  const kind = SOURCE_KINDS.has(source.kind) ? source.kind : 'manual';
  return {
    kind,
    ...(source.path ? { path: clean(source.path, 500) } : {}),
    ...(source.name ? { name: clean(source.name, 200) } : {}),
  };
}

/**
 * 把用户输入转换成 Date。
 * @param {unknown} value
 * @returns {Date | null}
 */
export function coerceDue(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = clean(value, 120);
  if (!text) return null;

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(text);
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 23, 59);
  }

  if (/^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}/u.test(text)) {
    const date = new Date(text.replace(/\b24:00(?::00)?\b/u, '23:59').replace(' ', 'T'));
    if (!Number.isNaN(date.getTime())) return date;
  }

  const parsed = parseDue(text);
  if (parsed) return parsed.date;

  const fallback = new Date(text);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

const DUE_PRECISIONS = new Set(['datetime', 'date', 'fuzzy']);

/**
 * 推断截止时间的精度：
 * - date：只给了哪一天 / 相对某天，默认 23:59
 * - fuzzy：给了模糊描述（dueLabel），dueAt 是提醒锚点
 * - datetime：明确到时分
 */
export function inferDuePrecision(value, label = '', explicit = '') {
  if (DUE_PRECISIONS.has(explicit)) return explicit;
  if (clean(label)) return 'fuzzy';
  const text = clean(value, 120);
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/u.test(text)) return 'date';
  if (/^\d{1,2}\s*月\s*\d{1,2}\s*日?$/u.test(text)) return 'date';
  if (/^(?:今天|明天|后天|大后天|下周[一二三四五六日天]|这周[一二三四五六日天]|周[一二三四五六日天])$/u.test(text)) {
    return 'date';
  }
  return 'datetime';
}

export class DdlStore {
  /** @param {string} file 绝对路径 */
  constructor(file) {
    this.file = file;
    this.lockFile = `${file}.lock`;
  }

  /** 读取当前状态；文件不存在时返回空状态。 */
  async read() {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const raw = await fs.readFile(this.file, 'utf8');
        return normalizeState(JSON.parse(raw));
      } catch (error) {
        if (error?.code === 'ENOENT') {
          // Windows 上 rename 替换的瞬间，读者可能短暂看不到文件；稍等重试。
          if (attempt < 3) {
            await new Promise((resolve) => setTimeout(resolve, 25));
            continue;
          }
          return emptyState();
        }
        throw new Error(`无法读取 ${this.file}：${error?.message ?? error}`);
      }
    }
    return emptyState();
  }

  /** 在文件锁内读取 → 修改 → 原子写回。 */
  async update(mutator) {
    return this.withLock(async () => {
      const state = await this.read();
      const result = await mutator(state);
      await this.write(state);
      return result;
    });
  }

  async withLock(operation) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const deadline = Date.now() + LOCK_TIMEOUT_MS;

    for (;;) {
      let handle;
      try {
        handle = await fs.open(this.lockFile, 'wx');
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        try {
          const stat = await fs.stat(this.lockFile);
          if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
            await fs.unlink(this.lockFile).catch(() => {});
            continue;
          }
        } catch {
          /* 锁文件刚消失，重试 */
        }
        if (Date.now() > deadline) {
          throw new Error('数据文件正在被另一个进程使用，请稍后重试');
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue;
      }

      try {
        return await operation();
      } finally {
        await handle.close().catch(() => {});
        await fs.unlink(this.lockFile).catch(() => {});
      }
    }
  }

  async write(state) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const payload = {
      version: 1,
      items: state.items,
      dismissed: state.dismissed.slice(-MAX_SIGNATURES),
      accepted: state.accepted.slice(-MAX_SIGNATURES),
      updatedAt: new Date().toISOString(),
    };
    try {
      await fs.copyFile(this.file, `${this.file}.bak`);
    } catch (error) {
      if (error?.code !== 'ENOENT') console.warn('[save-ddl] backup failed:', error);
    }
    const temp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(payload, null, 2), 'utf8');
    await fs.rename(temp, this.file);
  }

  /**
   * 加入一条 DDL。
   * @param {ReturnType<typeof emptyState>} state
   * @param {{subject?: string, assignment?: string, dueAt?: string, duePrecision?: string, dueLabel?: string, title?: string, notes?: string, source?: object}} input
   */
  add(state, input = {}) {
    const due = coerceDue(input.dueAt ?? input.text ?? input.title);
    if (!due) {
      throw new Error('无法识别截止时间。请提供 2026-11-10（只知道日期即可）、2026-11-10 23:59、11月10日或「下周五 23:59」。');
    }
    const subject = clean(input.subject, 60) || '未命名课程';
    const assignment = clean(input.assignment, 40);
    const dueLabel = clean(input.dueLabel, 60);
    const duePrecision = inferDuePrecision(
      input.dueAt ?? input.text ?? input.title,
      dueLabel,
      input.duePrecision,
    );
    const dueTime = due.toISOString();
    const duplicate = state.items.find(
      (item) =>
        item.subject === subject &&
        item.assignment === assignment &&
        Math.abs(Date.parse(item.dueAt) - Date.parse(dueTime)) < 60_000,
    );
    if (duplicate) return { item: duplicate, duplicate: true };

    const now = new Date().toISOString();
    const item = {
      id: randomUUID(),
      subject,
      assignment,
      title: clean(input.title, 120) || formatTitle(subject, assignment),
      dueAt: dueTime,
      duePrecision,
      dueLabel,
      status: 'todo',
      notes: clean(input.notes, 1000),
      source: sanitizeSource(input.source),
      createdAt: now,
      updatedAt: now,
    };
    state.items.push(item);
    return { item, duplicate: false };
  }

  /** 标记完成（幂等）。 */
  complete(state, id) {
    const item = state.items.find((entry) => entry.id === id);
    if (!item) throw new Error('找不到这条 DDL');
    if (item.status !== 'done') {
      item.status = 'done';
      item.completedAt = new Date().toISOString();
      item.updatedAt = item.completedAt;
    }
    return item;
  }

  /** 在待办 / 已完成之间切换。 */
  toggle(state, id) {
    const item = state.items.find((entry) => entry.id === id);
    if (!item) throw new Error('找不到这条 DDL');
    item.status = item.status === 'done' ? 'todo' : 'done';
    item.completedAt = item.status === 'done' ? new Date().toISOString() : undefined;
    item.updatedAt = new Date().toISOString();
    return item;
  }

  /** 删除一条。 */
  remove(state, id) {
    const before = state.items.length;
    state.items = state.items.filter((entry) => entry.id !== id);
    if (state.items.length === before) throw new Error('找不到这条 DDL');
    return true;
  }

  /** 清理已完成，返回数量。 */
  clearDone(state) {
    const before = state.items.length;
    state.items = state.items.filter((entry) => entry.status !== 'done');
    return before - state.items.length;
  }

  /** 排序后的清单。 */
  list(state, includeDone = false) {
    return state.items
      .filter((item) => includeDone || item.status !== 'done')
      .sort((left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt));
  }
}
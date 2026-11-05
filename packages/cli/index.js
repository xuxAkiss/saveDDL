#!/usr/bin/env node
/**
 * 拯救 DDL · CLI
 * =============
 *
 * 给不接 MCP 的 Agent / 脚本用；和 DSH 插件、MCP server 共用同一份 ddls.json。
 *
 * 用法：
 *   save-ddl list [--all] [--json]
 *   save-ddl add --subject 高等数学 --assignment HW3 --due "2026-11-10 23:59"
 *   save-ddl add-text "时限：2026-11-10 23:59 科目：高等数学 作业编号：HW3"
 *   save-ddl done <id>
 *   save-ddl remove <id>
 *   save-ddl extract "……"
 *   save-ddl path
 *
 * 可用 SAVE_DDL_DATA 或 --data <file> 指定数据文件。
 *
 * @module @save-ddl/cli
 */
import { DdlStore, resolveDataFile } from '../store/index.js';
import { extractCandidates, formatDue } from '../core/src/ddl.js';

const argv = process.argv.slice(2);

function takeFlag(name) {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  argv.splice(index, 2);
  return value;
}

function takeBool(name) {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return false;
  argv.splice(index, 1);
  return true;
}

const dataFile = takeFlag('data');
if (dataFile) process.env.SAVE_DDL_DATA = dataFile;

const store = new DdlStore(resolveDataFile());
const command = argv.shift() ?? 'help';

function line(item) {
  const done = item.status === 'done';
  return `- ${done ? '[x]' : '[ ]'} ${formatDue(item.dueAt, 'zh')} · ${item.title}（id: ${item.id}）`;
}

function printHelp() {
  console.log(`拯救 DDL CLI

用法：
  save-ddl list [--all] [--json]
  save-ddl add --subject <科目> --due <时间> [--assignment <编号>] [--title <标题>] [--notes <备注>]
  save-ddl add-text "<原文>"
  save-ddl done <id>
  save-ddl remove <id>
  save-ddl extract "<原文>"
  save-ddl path

数据文件：
  --data <file> 或环境变量 SAVE_DDL_DATA
  默认 $DSH_HOME/save-ddl/ddls.json（通常是 ~/.dsh/save-ddl/ddls.json）`);
}

async function main() {
  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === 'path') {
    console.log(store.file);
    return;
  }

  if (command === 'list') {
    const includeDone = takeBool('all');
    const json = takeBool('json');
    const state = await store.read();
    const items = store.list(state, includeDone);
    if (json) {
      process.stdout.write(`${JSON.stringify(items, null, 2)}\n`);
      return;
    }
    if (items.length === 0) {
      console.log(includeDone ? '清单是空的' : '当前没有待办 DDL');
      return;
    }
    console.log(`共 ${items.length} 条`);
    for (const item of items) console.log(line(item));
    return;
  }

  if (command === 'add') {
    const subject = takeFlag('subject');
    const due = takeFlag('due');
    const assignment = takeFlag('assignment');
    const title = takeFlag('title');
    const notes = takeFlag('notes');
    if (!subject || !due) {
      throw new Error('add 需要 --subject 和 --due');
    }
    const result = await store.update((state) =>
      store.add(state, { subject, assignment, dueAt: due, title, notes, source: { kind: 'manual' } }),
    );
    console.log(
      result.duplicate
        ? `已存在：${result.item.title}（${formatDue(result.item.dueAt, 'zh')}）`
        : `已加入：${result.item.title}（${formatDue(result.item.dueAt, 'zh')}）（id: ${result.item.id}）`,
    );
    return;
  }

  if (command === 'add-text') {
    const text = argv.join(' ').trim();
    if (!text) throw new Error('add-text 需要一段文本');
    const candidates = extractCandidates(text, { now: new Date(), max: 8 });
    if (candidates.length === 0) {
      throw new Error('没有识别到截止时间。试试「时限：2026-11-10 23:59 科目：高等数学 作业编号：HW3」。');
    }
    let added = 0;
    for (const candidate of candidates) {
      const result = await store.update((state) =>
        store.add(state, { ...candidate, source: { kind: 'text' } }),
      );
      if (!result.duplicate) added += 1;
      console.log(
        result.duplicate
          ? `已存在：${result.item.title}`
          : `已加入：${result.item.title}（${formatDue(result.item.dueAt, 'zh')}）`,
      );
    }
    console.log(`新增 ${added} 条，识别 ${candidates.length} 条。`);
    return;
  }

  if (command === 'done') {
    const id = argv[0];
    if (!id) throw new Error('done 需要 id');
    const item = await store.update((state) => store.complete(state, id));
    console.log(`已完成：${item.title}`);
    return;
  }

  if (command === 'remove') {
    const id = argv[0];
    if (!id) throw new Error('remove 需要 id');
    await store.update((state) => store.remove(state, id));
    console.log('已删除');
    return;
  }

  if (command === 'extract') {
    const text = argv.join(' ').trim();
    if (!text) throw new Error('extract 需要一段文本');
    const candidates = extractCandidates(text, { now: new Date(), max: 8 });
    if (candidates.length === 0) {
      console.log('没有识别到截止时间');
      return;
    }
    console.log(`识别到 ${candidates.length} 条候选：`);
    for (const candidate of candidates) {
      console.log(
        `- ${formatDue(candidate.dueAt, 'zh')} · ${candidate.title}（置信度 ${candidate.confidence}）`,
      );
    }
    return;
  }

  throw new Error(`未知命令：${command}。运行 save-ddl help 查看用法。`);
}

main().catch((error) => {
  console.error(`错误：${error?.message ?? error}`);
  process.exitCode = 1;
});
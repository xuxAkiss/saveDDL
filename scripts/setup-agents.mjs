#!/usr/bin/env node
/**
 * 把 save-ddl MCP server 接入 Claude Code / Codex。
 *
 *   node scripts/setup-agents.mjs --print          # 只打印配置，不改文件
 *   node scripts/setup-agents.mjs --claude         # 写入 Claude Code 用户级 MCP 配置
 *   node scripts/setup-agents.mjs --codex          # 追加到 ~/.codex/config.toml（先备份）
 *   node scripts/setup-agents.mjs --claude --codex # 两边都配
 *
 * 所有路径都按当前机器解析成绝对值；换机器后重新运行即可。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { resolveDataFile } from '../packages/store/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const nodePath = process.execPath;
const serverPath = path.join(root, 'packages', 'mcp-server', 'index.js');
const dataFile = resolveDataFile();

const args = new Set(process.argv.slice(2));
const wantClaude = args.has('--claude');
const wantCodex = args.has('--codex');
const printOnly = args.has('--print') || (!wantClaude && !wantCodex);

function tomlString(value) {
  return JSON.stringify(String(value));
}

function codexBlock() {
  return [
    '# >>> save-ddl >>>',
    '[mcp_servers."save-ddl"]',
    `command = ${tomlString(nodePath)}`,
    `args = [${tomlString(serverPath)}]`,
    `env = { SAVE_DDL_DATA = ${tomlString(dataFile)} }`,
    '# <<< save-ddl <<<',
  ].join('\n');
}

function claudeCommand() {
  return [
    'claude',
    'mcp',
    'add',
    'save-ddl',
    '--scope',
    'user',
    '-e',
    `SAVE_DDL_DATA=${dataFile}`,
    '--',
    nodePath,
    serverPath,
  ];
}

function printPlan() {
  console.log('数据文件：');
  console.log(`  ${dataFile}`);
  console.log('');
  console.log('Claude Code（用户级）：');
  console.log(`  ${claudeCommand().map((part) => (part.includes(' ') ? JSON.stringify(part) : part)).join(' ')}`);
  console.log('');
  console.log('Codex（追加到 ~/.codex/config.toml，重启 Codex 生效）：');
  console.log('');
  console.log(codexBlock());
  console.log('');
}

function findClaude() {
  // 直接让 Windows 在 PATH 中解析，避免 where.exe 的 OEM 编码把中文用户名解码坏。
  const direct = spawnSync('claude', ['--version'], { encoding: 'utf8', windowsHide: true });
  if (direct.status === 0) return 'claude';

  for (const entry of (process.env.PATH ?? '').split(path.delimiter)) {
    const directory = entry.replace(/^"|"$/gu, '');
    for (const name of ['claude.exe', 'claude.cmd', 'claude.bat', 'claude']) {
      const candidate = path.join(directory, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function setupClaude() {
  const claude = findClaude();
  if (!claude) {
    console.warn('未找到 claude 命令；请手动执行：');
    printPlan();
    return false;
  }

  // 先移除同名 server，保证幂等；不存在时忽略错误。
  spawnSync(claude, ['mcp', 'remove', 'save-ddl', '--scope', 'user'], {
    stdio: 'ignore',
    windowsHide: true,
  });

  // 用 inherit：claude 自己会输出健康检查结果，也避免管道捕获导致进程提前结束。
  const result = spawnSync(claude, claudeCommand().slice(1), {
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) console.error(String(result.error));
  if (result.status !== 0) {
    console.error(`claude mcp add 失败（exit ${result.status}）`);
    return false;
  }
  console.log('已写入 Claude Code 用户级 MCP 配置。');
  console.log('验证：claude mcp get save-ddl');
  return true;
}

function setupCodex() {
  const dir = path.join(os.homedir(), '.codex');
  const config = path.join(dir, 'config.toml');
  fs.mkdirSync(dir, { recursive: true });

  const existing = fs.existsSync(config) ? fs.readFileSync(config, 'utf8') : '';
  if (existing) {
    const backup = `${config}.bak-save-ddl-${Date.now()}`;
    fs.copyFileSync(config, backup);
    console.log(`已备份 Codex 配置：${backup}`);
  }

  const block = codexBlock();
  let next;
  if (existing.includes('# >>> save-ddl >>>')) {
    next = existing.replace(/# >>> save-ddl >>>[\s\S]*?# <<< save-ddl <<</u, () => block);
  } else {
    const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n\n' : existing.length > 0 ? '\n' : '';
    next = `${existing}${prefix}${block}\n`;
  }
  fs.writeFileSync(config, next, 'utf8');
  console.log(`已写入 Codex 配置：${config}`);
  console.log('重启 Codex 后生效。');
  return true;
}

if (printOnly) {
  printPlan();
  process.exit(0);
}

let ok = true;
if (wantClaude) ok = setupClaude() && ok;
if (wantCodex) ok = setupCodex() && ok;
process.exit(ok ? 0 : 1);
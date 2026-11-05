/**
 * 启动 Electron 桌面端。
 *
 * Windows 上 Electron 对超长路径敏感；如果仓库放在很深的目录里，
 * 直接运行 electron.exe 可能崩溃。这里把运行所需文件同步到
 * C:\Users\Public\SaveDDL\app（短路径），再从那里启动。
 *
 * 可用环境变量：
 *   SAVE_DDL_RUNTIME       自定义短路径运行目录
 *   SAVE_DDL_NO_SANDBOX=1  在某些受限的父进程里需要关闭 Chromium sandbox
 *   ELECTRON_EXE           指定 electron 可执行文件
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const repoRoot = path.resolve(appRoot, '..', '..');
const isWindows = process.platform === 'win32';

function resolveRuntimeRoot() {
  if (process.env.SAVE_DDL_RUNTIME) return path.resolve(process.env.SAVE_DDL_RUNTIME);
  if (!isWindows) return repoRoot;
  const base = process.env.PUBLIC || 'C:\\Users\\Public';
  return path.join(base, 'SaveDDL', 'app');
}

function copyTree(source, target) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(source, target, { recursive: true, force: true });
}

function syncRuntime(runtimeRoot) {
  if (runtimeRoot === repoRoot) return true;
  try {
    copyTree(path.join(repoRoot, 'packages', 'core'), path.join(runtimeRoot, 'packages', 'core'));
    copyTree(path.join(repoRoot, 'packages', 'store'), path.join(runtimeRoot, 'packages', 'store'));
    copyTree(path.join(repoRoot, 'apps', 'desktop', 'src'), path.join(runtimeRoot, 'apps', 'desktop', 'src'));
    copyTree(path.join(repoRoot, 'apps', 'desktop', 'assets'), path.join(runtimeRoot, 'apps', 'desktop', 'assets'));
    copyTree(path.join(repoRoot, 'apps', 'desktop', 'scripts'), path.join(runtimeRoot, 'apps', 'desktop', 'scripts'));
    copyTree(path.join(repoRoot, 'apps', 'desktop', 'dist'), path.join(runtimeRoot, 'apps', 'desktop', 'dist'));
    fs.copyFileSync(
      path.join(repoRoot, 'apps', 'desktop', 'package.json'),
      path.join(runtimeRoot, 'apps', 'desktop', 'package.json'),
    );

    const sourceVendor = path.join(repoRoot, 'apps', 'desktop', 'vendor', 'electron');
    const runtimeVendor = path.join(runtimeRoot, 'apps', 'desktop', 'vendor', 'electron');
    const readVersion = (directory) => {
      try {
        return fs.readFileSync(path.join(directory, 'version'), 'utf8').trim();
      } catch {
        return '';
      }
    };
    const sourceVersion = readVersion(sourceVendor);
    const runtimeVersion = readVersion(runtimeVendor);
    if (!fs.existsSync(runtimeVendor) || (sourceVersion && runtimeVersion !== sourceVersion)) {
      if (!fs.existsSync(sourceVendor)) return false;
      console.log('[save-ddl] 同步 Electron 到短路径运行目录…');
      fs.rmSync(runtimeVendor, { recursive: true, force: true });
      copyTree(sourceVendor, runtimeVendor);
    }
    return true;
  } catch (error) {
    console.warn(`[save-ddl] 同步短路径运行目录失败：${error.message}`);
    return false;
  }
}

let runtimeRoot = resolveRuntimeRoot();
if (!syncRuntime(runtimeRoot)) runtimeRoot = repoRoot;

const launchApp = path.join(runtimeRoot, 'apps', 'desktop');
const electronExe = process.env.ELECTRON_EXE || (isWindows
  ? path.join(launchApp, 'vendor', 'electron', 'electron.exe')
  : process.platform === 'darwin'
    ? path.join(launchApp, 'vendor', 'electron', 'Electron.app', 'Contents', 'MacOS', 'Electron')
    : path.join(launchApp, 'vendor', 'electron', 'electron'));

if (!fs.existsSync(electronExe)) {
  console.error(`找不到 Electron：${electronExe}

推荐自动下载：
  node apps/desktop/scripts/fetch-electron.mjs

Windows 手动下载 44.7.0：
  curl -L -o apps/desktop/vendor/electron.zip https://cdn.npmmirror.com/binaries/electron/44.7.0/electron-v44.7.0-win32-x64.zip
  mkdir apps/desktop/vendor/electron
  tar -xf apps/desktop/vendor/electron.zip -C apps/desktop/vendor/electron

或设置 ELECTRON_EXE 指向已有的 electron 可执行文件。`);
  process.exit(1);
}

const env = { ...process.env };
// DSH / 其他 Electron 工具可能设置 ELECTRON_RUN_AS_NODE=1；
// 那会让 electron.exe 以纯 Node 运行，必须移除。
delete env.ELECTRON_RUN_AS_NODE;

const args = [];
if (process.env.SAVE_DDL_NO_SANDBOX === '1') args.push('--no-sandbox');

// 把 Electron / Chromium 开关放在 app 路径之前；业务参数放后面。
const chromiumFlags = [];
const appArgs = [];
for (const arg of process.argv.slice(2)) {
  if (/^--(remote-debugging-port|enable-logging|disable-gpu|disable-software-rasterizer|inspect)(=|$)/u.test(arg)) {
    chromiumFlags.push(arg);
  } else if (arg === '--no-sandbox') {
    chromiumFlags.push(arg);
  } else {
    appArgs.push(arg);
  }
}
args.push(...chromiumFlags, launchApp, ...appArgs);

console.log(`[save-ddl] launching ${electronExe}`);
console.log(`[save-ddl] app ${launchApp}`);

const child = spawn(electronExe, args, {
  stdio: 'inherit',
  windowsHide: false,
  env,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
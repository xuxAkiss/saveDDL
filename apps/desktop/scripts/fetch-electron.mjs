/**
 * 下载 Electron 运行时到 apps/desktop/vendor/electron。
 *
 * 用法：node apps/desktop/scripts/fetch-electron.mjs
 * 默认 44.7.0（与 DSH 桌面端一致），可用 ELECTRON_VERSION 覆盖。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const vendor = path.join(appRoot, 'vendor', 'electron');
const version = process.env.ELECTRON_VERSION || '44.7.0';
const platform = process.platform === 'win32' ? 'win32' : process.platform;
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const archive = `electron-v${version}-${platform}-${arch}.zip`;
const url = `https://cdn.npmmirror.com/binaries/electron/${version}/${archive}`;
const zip = path.join(appRoot, 'vendor', archive);

function readVersion() {
  try {
    return fs.readFileSync(path.join(vendor, 'version'), 'utf8').trim();
  } catch {
    return '';
  }
}

if (readVersion() === version) {
  console.log(`Electron ${version} already present: ${vendor}`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(zip), { recursive: true });
if (!fs.existsSync(zip)) {
  console.log(`downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`download failed: HTTP ${response.status}`);
  }
  const total = Number(response.headers.get('content-length') || 0);
  let received = 0;
  const source = Readable.fromWeb(response.body);
  source.on('data', (chunk) => {
    received += chunk.length;
    if (total > 0) {
      const percent = Math.floor((received / total) * 100);
      process.stderr.write(`\r${percent}% (${Math.round(received / 1024 / 1024)} / ${Math.round(total / 1024 / 1024)} MB)`);
    }
  });
  await pipeline(source, fs.createWriteStream(zip));
  process.stderr.write('\n');
}

fs.rmSync(vendor, { recursive: true, force: true });
fs.mkdirSync(vendor, { recursive: true });
console.log(`extracting ${archive}`);
if (process.platform === 'win32') {
  execFileSync('tar.exe', ['-xf', zip, '-C', vendor], { stdio: 'inherit' });
} else {
  execFileSync('unzip', ['-q', zip, '-d', vendor], { stdio: 'inherit' });
}
fs.rmSync(zip, { force: true });

if (readVersion() !== version) {
  throw new Error(`extract failed; check ${vendor}`);
}
console.log(`Electron ${version} ready: ${vendor}`);
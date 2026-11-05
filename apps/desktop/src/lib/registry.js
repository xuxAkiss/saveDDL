/**
 * Windows 资源管理器右键菜单（HKCU，无需管理员）。
 *
 * 文件：HKCU\Software\Classes\*\shell\SaveDDL
 * 目录：HKCU\Software\Classes\Directory\shell\SaveDDL
 *
 * 命令直接调用当前 Electron 可执行文件：
 *   开发：electron.exe <appPath> --add-file "%1"
 *   打包："Save DDL.exe" --add-file "%1"
 */
import { spawnSync } from 'node:child_process';

const FILE_KEY = 'HKCU\\Software\\Classes\\*\\shell\\SaveDDL';
const DIRECTORY_KEY = 'HKCU\\Software\\Classes\\Directory\\shell\\SaveDDL';
const LABEL = '加入 DDL';

function runReg(args) {
  return spawnSync('reg.exe', args, { encoding: 'utf8', windowsHide: true });
}

export function buildLaunchCommand({ execPath, appPath, packaged }) {
  const exe = `"${execPath}"`;
  if (packaged) return `${exe} --add-file "%1"`;
  return `${exe} "${appPath}" --add-file "%1"`;
}

export function isContextMenuInstalled() {
  if (process.platform !== 'win32') return false;
  return runReg(['query', FILE_KEY]).status === 0;
}

export function installContextMenu({ execPath, appPath, packaged, iconPath }) {
  if (process.platform !== 'win32') {
    return { ok: false, error: '右键菜单目前只支持 Windows' };
  }
  const command = buildLaunchCommand({ execPath, appPath, packaged });
  const results = [];

  for (const key of [FILE_KEY, DIRECTORY_KEY]) {
    results.push(runReg(['add', key, '/ve', '/d', LABEL, '/f']));
    results.push(runReg(['add', `${key}\\command`, '/ve', '/d', command, '/f']));
    results.push(runReg(['add', key, '/v', 'Icon', '/d', iconPath, '/f']));
  }

  const failed = results.find((result) => result.status !== 0);
  if (failed) {
    return {
      ok: false,
      error: (failed.stderr || failed.stdout || `reg.exe exit ${failed.status}`).trim(),
    };
  }
  return { ok: true, command };
}

export function uninstallContextMenu() {
  if (process.platform !== 'win32') {
    return { ok: false, error: '右键菜单目前只支持 Windows' };
  }
  const errors = [];
  for (const key of [FILE_KEY, DIRECTORY_KEY]) {
    const result = runReg(['delete', key, '/f']);
    // 不存在时 reg 返回 1；视为已移除。
    if (result.status !== 0 && !/unable to find|找不到/iu.test(`${result.stderr}${result.stdout}`)) {
      errors.push((result.stderr || result.stdout || '').trim());
    }
  }
  return errors.length > 0 ? { ok: false, error: errors.join('\n') } : { ok: true };
}
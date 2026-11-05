/**
 * 扫描件 OCR（Windows 自带 Windows.Media.Ocr）。
 *
 * 不依赖外部 AI / OCR 工具；Electron 主进程调用 ocr.ps1，
 * PowerShell 用 Windows.Data.Pdf 渲染页面，再 OCR 成文字。
 */
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { normalizeText } from '../../../../packages/core/src/ddl.js';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, '..', '..', 'scripts', 'ocr.ps1');
const powershell = path.join(
  process.env.SystemRoot || 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
);

export function isOcrAvailable() {
  return process.platform === 'win32';
}

/**
 * OCR 结果会在每个汉字之间插空格，这里还原成正常中文。
 * 数字之间的空格也合并，例如 `1 1 月 12 日` → `11月12日`。
 */
export function normalizeOcrText(text) {
  return normalizeText(String(text ?? ''))
    .replace(/[ \t]+/gu, ' ')
    .replace(/(?<=\d)\s+(?=\d)/gu, '')
    .replace(/(?<=[\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])/gu, '')
    .replace(/(?<=[\u4e00-\u9fa5])\s+(?=[,.;:!?、，。；：！？（）])/gu, '')
    .replace(/(?<=[,.;:!?、，。；：！？（）])\s+(?=[\u4e00-\u9fa5\d])/gu, '')
    .replace(/(?<=\d)\s+(?=[年月日])/gu, '')
    .replace(/(?<=[年月日])\s+(?=\d)/gu, '')
    .replace(/(?<=第)\s+(?=\d)/gu, '')
    .replace(/\s*:\s*/gu, ':')
    .replace(/\n{2,}/gu, '\n\n')
    .trim();
}

export async function ocrDocumentText(filePath) {
  if (!isOcrAvailable()) {
    throw new Error('OCR 目前只支持 Windows');
  }
  const result = await execFileAsync(
    powershell,
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      script,
      '-Path',
      path.resolve(filePath),
    ],
    {
      encoding: 'utf8',
      maxBuffer: 40 * 1024 * 1024,
      windowsHide: true,
      timeout: 120_000,
    },
  );
  const text = normalizeOcrText(result.stdout);
  if (!text) throw new Error('OCR 没有识别到文字');
  return text;
}
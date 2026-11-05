/**
 * PDF / DOCX / DOC 文本提取。
 *
 * 这个模块会被 esbuild 打包成 dist/extract.cjs，Electron 主进程不直接依赖
 * node_modules；换机器运行只需要提交后的 bundle。
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';
import WordExtractor from 'word-extractor';

const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.text', '.rst']);
const MAX_TEXT = 200_000;

export function isTextDocument(filePath) {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function isExtractableDocument(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return TEXT_EXTENSIONS.has(extension) || extension === '.pdf' || extension === '.docx' || extension === '.doc';
}

export async function extractDocumentText(filePath) {
  const resolved = path.resolve(filePath);
  const extension = path.extname(resolved).toLowerCase();

  if (TEXT_EXTENSIONS.has(extension)) {
    return (await fs.readFile(resolved, 'utf8')).slice(0, MAX_TEXT).trim();
  }

  if (extension === '.docx') {
    const result = await mammoth.extractRawText({ buffer: await fs.readFile(resolved) });
    return String(result.value ?? '').slice(0, MAX_TEXT).trim();
  }

  if (extension === '.doc') {
    const extractor = new WordExtractor();
    const document = await extractor.extract(resolved);
    return String(document.getBody() ?? '').slice(0, MAX_TEXT).trim();
  }

  if (extension === '.pdf') {
    const data = new Uint8Array(await fs.readFile(resolved));
    const pdf = await getDocumentProxy(data);
    try {
      const result = await extractText(pdf, { mergePages: true });
      return String(result.text ?? '').slice(0, MAX_TEXT).trim();
    } finally {
      await pdf.destroy?.();
    }
  }

  throw new Error(`暂不支持 ${extension || '该'} 格式。支持 PDF / DOCX / DOC / Markdown / TXT。`);
}
import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeOcrText } from '../src/lib/ocr.js';

test('normalizeOcrText removes OCR spacing in Chinese and dates', () => {
  assert.equal(
    normalizeOcrText('提 交 截 止 日 期 ： 2026 年 1 1 月 12 日 23 ： 59 ： 59'),
    '提交截止日期:2026年11月12日23:59:59',
  );
  assert.equal(
    normalizeOcrText('当 代 人 工 智 能 实 验 课 ： 实 验 二'),
    '当代人工智能实验课:实验二',
  );
});
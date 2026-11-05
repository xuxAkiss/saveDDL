import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractCandidates,
  formatTitle,
  looksLikeDdl,
  normalizeText,
  parseDdlText,
  parseDue,
} from '../src/ddl.js';

/** 2026-11-05 12:00（本地时间，周四）。 */
const NOW = new Date(2026, 10, 5, 12, 0, 0, 0);

/** 取出本地日期分量，避免测试依赖机器时区。 */
function localParts(iso) {
  const date = new Date(iso);
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
  };
}

test('解析用户描述的「时限：科目：作业编号」', () => {
  const candidate = parseDdlText(
    '时限：2026-11-10 23:59 科目：高等数学 作业编号：HW3',
    { now: NOW },
  );
  assert.ok(candidate);
  assert.equal(candidate.subject, '高等数学');
  assert.equal(candidate.assignment, 'HW3');
  assert.deepEqual(localParts(candidate.dueAt), {
    year: 2026,
    month: 11,
    day: 10,
    hour: 23,
    minute: 59,
  });
});

test('解析多行作业通知，并从文件名补科目', () => {
  const text = ['【作业】实验 3', '截止时间：11 月 20 日 22:00', '提交方式：学习通'].join('\n');
  const candidate = parseDdlText(text, {
    now: NOW,
    sourceName: '数据结构_作业3.md',
  });
  assert.ok(candidate);
  assert.equal(candidate.subject, '数据结构');
  assert.equal(candidate.assignment, '实验 3');
  assert.deepEqual(localParts(candidate.dueAt), {
    year: 2026,
    month: 11,
    day: 20,
    hour: 22,
    minute: 0,
  });
});

test('同一段文本里提取多条 DDL', () => {
  const text = [
    '时限：2026-11-10 23:59',
    '科目：高等数学',
    '作业编号：HW3',
    '',
    '时限：2026-11-12 12:00',
    '科目：大学英语',
    '作业编号：Essay 2',
  ].join('\n');
  const candidates = extractCandidates(text, { now: NOW });
  assert.equal(candidates.length, 2);
  assert.deepEqual(
    candidates.map((item) => [item.subject, item.assignment]),
    [
      ['高等数学', 'HW3'],
      ['大学英语', 'Essay 2'],
    ],
  );
});

test('支持英文标签', () => {
  const candidate = parseDdlText('DDL: 2026/12/1 18:00\nCourse: 大学英语\nAssignment: Essay 2', {
    now: NOW,
  });
  assert.ok(candidate);
  assert.equal(candidate.subject, '大学英语');
  assert.equal(candidate.assignment, 'Essay 2');
  assert.deepEqual(localParts(candidate.dueAt), {
    year: 2026,
    month: 12,
    day: 1,
    hour: 18,
    minute: 0,
  });
});

test('解析「下周五」这类相对时间', () => {
  const due = parseDue('下周五 23:59 前提交', NOW);
  assert.ok(due);
  // 2026-11-05 是周四，下周五 = 2026-11-13。
  assert.deepEqual(localParts(due.iso), {
    year: 2026,
    month: 11,
    day: 13,
    hour: 23,
    minute: 59,
  });
});

test('解析表格行', () => {
  const candidate = parseDdlText('2026-11-10 23:59 | 高等数学 | HW3', { now: NOW });
  assert.ok(candidate);
  assert.equal(candidate.subject, '高等数学');
  assert.equal(candidate.assignment, 'HW3');
});

test('没有日期时不产生候选', () => {
  assert.deepEqual(extractCandidates('记得写作业，但没说什么时候交', { now: NOW }), []);
  assert.equal(looksLikeDdl('记得写作业', NOW), false);
});

test('全角标点和数字也能解析', () => {
  const candidate = parseDdlText('时限：２０２６－１１－１０　２３：５９ 科目：线性代数 作业编号：４', {
    now: NOW,
  });
  assert.ok(candidate);
  assert.equal(candidate.subject, '线性代数');
  assert.equal(candidate.assignment, '4');
  assert.equal(localParts(candidate.dueAt).day, 10);
});

test('过去半年以上的月日推断为明年', () => {
  const due = parseDue('截止：1 月 8 日', NOW);
  assert.ok(due);
  assert.equal(localParts(due.iso).year, 2027);
});

test('长文档中截止日期后的代码段不能污染科目', () => {
  const text = [
    '当代人工智能实验课：实验二 - 搜索算法',
    '日期: 2026年10月15日',
    '提交截止日期：2026年11月12日23:59:59',
    '课程实验要求',
    '实验目标：掌握搜索算法。',
    '题目一 迷宫寻路',
    '题目二 加权地形',
    '题目三 极大极小博弈树',
    '题目四 竞争环境下的宝藏分配',
    '实验报告要求',
    '构建代码示例：',
    '# 叶子节点',
    'leaf1 = TreeNode(value=3)',
    '非叶子节点有 children 属性，叶子节点有 value 属性。',
  ].join('\n');

  const candidate = parseDdlText(text, { now: NOW });
  assert.ok(candidate);
  assert.equal(candidate.subject, '当代人工智能实验课');
  assert.equal(candidate.assignment, '实验 二');
  assert.deepEqual(localParts(candidate.dueAt), {
    year: 2026,
    month: 11,
    day: 12,
    hour: 23,
    minute: 59,
  });
});

test('OCR 页眉重复的课程名会折叠', () => {
  const text = [
    '当代人工智能实验课当代人工智能实验课:实验二 - 搜索算法',
    '提交截止日期:2026年11月12日23:59:59',
  ].join('\n');
  const candidate = parseDdlText(text, { now: NOW });
  assert.ok(candidate);
  assert.equal(candidate.subject, '当代人工智能实验课');
  assert.equal(candidate.assignment, '实验 二');
});

test('24:00 按当天 23:59，且不把布置周当截止', () => {
  const text = [
    '实践项目P2：Profiling Serial Merge Sort',
    '',
    '布置周：2026 年 10 月 21 日 9:50',
    '',
    '提交周：2026 年 11 月 18 日 24:00',
    '',
    '助教：余俊 51285903106@stu.ecnu.edu.cn',
  ].join('\n');

  const candidates = extractCandidates(text, {
    now: NOW,
    sourceName: 'P2 Profiling Serial Merge Sort.docx',
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].subject, 'P2 Profiling Serial Merge Sort');
  assert.deepEqual(localParts(candidates[0].dueAt), {
    year: 2026,
    month: 11,
    day: 18,
    hour: 23,
    minute: 59,
  });
});

test('normalizeText 只做全角转半角', () => {
  assert.equal(normalizeText('ＡＢＣ：１２３'), 'ABC:123');
  assert.equal(normalizeText('保持中文'), '保持中文');
});

test('formatTitle 组合科目与作业编号', () => {
  assert.equal(formatTitle('高等数学', '3'), '高等数学 · 作业 3');
  assert.equal(formatTitle('大学英语', 'Essay 2'), '大学英语 · Essay 2');
  assert.equal(formatTitle('', ''), '未命名课程');
});
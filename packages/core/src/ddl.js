/**
 * 拯救 DDL · 核心解析器
 * =====================
 *
 * 从中文 / 英文文本里提取一条或多条 DDL：
 *   - 截止时间（时限 / 截止时间 / deadline / due）
 *   - 科目（科目 / 课程 / subject / course）
 *   - 作业编号（作业编号 / 作业 3 / HW3 / 实验 2 / Lab 4 ...）
 *
 * 设计约束：
 *   - 纯函数，不依赖 Node、DOM、网络，可同时被 DSH Host 插件、Electron
 *     主进程 / 渲染进程、浏览器扩展复用。
 *   - 解析失败时返回空数组，不抛异常；所有日期都是「本地时区」。
 *   - 只做启发式提取；PDF / Word / 扫描件的 AI 提取交给上层。
 *
 * 典型输入：
 *   时限：2026-11-10 23:59
 *   科目：高等数学
 *   作业编号：HW3
 *
 * 或一行：
 *   2026-11-10 23:59 | 高等数学 | HW3
 *
 * @module @save-ddl/core
 */

/** 出现这些词才认为文本可能和 DDL 有关。 */
export const DDL_KEYWORD =
  /(?:ddl|deadline|due(?:\s*date)?|截止|提交|时限|作业|assignment|homework|submission)/iu;

/** 截止时间前面的提示词。 */
const DUE_LABEL =
  /(?:截止(?:时间|日期)?|时限|提交(?:时间|截止时间|截止)?|ddl|deadline|due(?:\s*date)?)/iu;

/** 发布时间 / 布置时间不是截止时间，没有截止标签时跳过。 */
const ANNOUNCEMENT_LABEL = /(?:布置|发布|公布|开始|开放|下发)/u;

/** 字段标签的完整集合，用于让「科目：」在下一个标签处停下。 */
const FIELD_LABELS = [
  '时限',
  '截止时间',
  '截止日期',
  '截止',
  '提交时间',
  '提交截止时间',
  '提交',
  '科目',
  '课程',
  '学科',
  '课名',
  '作业编号',
  '作业序号',
  '作业',
  'ddl',
  'deadline',
  'due',
  'subject',
  'course',
  'assignment',
  'homework',
].join('|');

const WEEKDAY = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };
const RELATIVE_DAY = { 今天: 0, 明天: 1, 后天: 2, 大后天: 3 };
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 全角转半角（标点、数字、字母），统一换行与空格。
 * 只用于解析，不会破坏中文。
 * @param {unknown} input
 * @returns {string}
 */
export function normalizeText(input) {
  return String(input ?? '')
    .replace(/\r\n?/gu, '\n')
    .replace(/[\uFF01-\uFF5E]/gu, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/gu, ' ');
}

/**
 * 清洗一个字段值：去掉首尾标点、压缩空白、限制长度。
 * @param {string} value
 * @param {number} [max]
 * @returns {string}
 */
function cleanValue(value, max = 40) {
  return String(value ?? '')
    .replace(/^[\s:：,，;；|]+/u, '')
    .replace(/[。.;；,，、\s]+$/u, '')
    .replace(/\s{2,}/gu, ' ')
    .trim()
    .slice(0, max);
}

/**
 * 逐个执行正则并返回所有匹配，避免共享 `lastIndex` 状态。
 * @param {string} text
 * @param {RegExp} pattern
 * @returns {RegExpExecArray[]}
 */
function matchAll(text, pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const rx = new RegExp(pattern.source, flags);
  const out = [];
  let match;
  while ((match = rx.exec(text)) !== null) {
    out.push(match);
    if (rx.lastIndex === match.index) rx.lastIndex += 1;
  }
  return out;
}

/**
 * 构造本地时区日期，并校验溢出（例如 2 月 30 日）。
 * @param {number} year
 * @param {number} month 1-12
 * @param {number} day
 * @param {number} [hour]
 * @param {number} [minute]
 * @returns {Date | null}
 */
function makeDate(year, month, day, hour, minute) {
  let hh = hour ?? 23;
  let mm = minute ?? 59;
  // 中文通知常用「11 月 18 日 24:00」表示当天结束，按 23:59 处理。
  if (hh === 24 && mm === 0) {
    hh = 23;
    mm = 59;
  }
  if (![year, month, day, hh, mm].every(Number.isFinite)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  const date = new Date(year, month - 1, day, hh, mm, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hh ||
    date.getMinutes() !== mm
  ) {
    return null;
  }
  return date;
}

/**
 * 没有写年份时推断年份：已经过去半年以上的日期视为明年的。
 * 例如 11 月 5 日看到「1 月 8 日」→ 明年；看到「11 月 1 日」→ 今年（可能已逾期）。
 * @param {number} month
 * @param {number} day
 * @param {Date} now
 * @returns {number}
 */
function inferYear(month, day, now) {
  const candidate = new Date(now.getFullYear(), month - 1, day, 23, 59);
  if (candidate.getTime() < now.getTime() - 180 * DAY_MS) {
    return now.getFullYear() + 1;
  }
  return now.getFullYear();
}

/**
 * 在日期附近补一个时间。例如：
 *   截止：11 月 20 日
 *   提交时间：18:00
 * 这种跨行的写法。
 * @param {string} text
 * @param {number} start
 * @param {number} end
 * @returns {{ hour: number, minute: number } | undefined}
 */
function timeNear(text, start, end) {
  const after = text.slice(end, end + 24);
  const before = text.slice(Math.max(0, start - 24), start);
  for (const segment of [after, before]) {
    const match = /(?:^|[\s的,，T])(\d{1,2}):(\d{2})(?!\d)/u.exec(segment);
    if (!match) continue;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour === 24 && minute === 0) return { hour: 23, minute: 59 };
    if (hour <= 23 && minute <= 59) return { hour, minute };
  }
  return undefined;
}

/**
 * 一个日期匹配的得分：离「截止 / deadline」等词越近越可信。
 * @param {string} text
 * @param {RegExpExecArray} match
 * @returns {number}
 */
function dueScore(text, match) {
  const before = text.slice(Math.max(0, match.index - 30), match.index);
  const after = text.slice(match.index + match[0].length, match.index + match[0].length + 14);
  let score = 0;
  if (DUE_LABEL.test(before)) score += 2;
  if (/^\s*(?:前|之前|以前|为止|截止)/u.test(after)) score += 0.5;
  return score;
}

/**
 * 解析文本里所有可能的截止时间，按可信度、再按出现位置排序。
 * @param {string} text
 * @param {Date} [now]
 * @returns {Array<{ date: Date, index: number, end: number, matched: string, score: number }>}
 */
export function parseDueCandidates(text, now = new Date()) {
  const source = normalizeText(text);
  const results = [];

  const push = (date, match, extra = 0) => {
    if (date === null) return;
    results.push({
      date,
      index: match.index,
      end: match.index + match[0].length,
      matched: match[0],
      score: dueScore(source, match) + extra,
    });
  };

  // 1) 2026-11-10 / 2026/11/10 / 2026.11.10，可带 23:59
  for (const match of matchAll(
    source,
    /(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2}))?/gu,
  )) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    let hour = match[4] === undefined ? undefined : Number(match[4]);
    let minute = match[5] === undefined ? undefined : Number(match[5]);
    if (hour === undefined) {
      const near = timeNear(source, match.index, match.index + match[0].length);
      hour = near?.hour;
      minute = near?.minute;
    }
    push(makeDate(year, month, day, hour, minute), match);
  }

  // 2) 2026 年 11 月 10 日 23:59
  for (const match of matchAll(
    source,
    /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?(?:\s*(\d{1,2}):(\d{2}))?/gu,
  )) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    let hour = match[4] === undefined ? undefined : Number(match[4]);
    let minute = match[5] === undefined ? undefined : Number(match[5]);
    if (hour === undefined) {
      const near = timeNear(source, match.index, match.index + match[0].length);
      hour = near?.hour;
      minute = near?.minute;
    }
    push(makeDate(year, month, day, hour, minute), match);
  }

  // 3) 11 月 10 日 23:59（年份按当前年份推断）
  for (const match of matchAll(
    source,
    /(?:^|[^\d])(\d{1,2})\s*月\s*(\d{1,2})\s*日?(?:\s*(\d{1,2}):(\d{2}))?/gu,
  )) {
    const month = Number(match[1]);
    const day = Number(match[2]);
    let hour = match[3] === undefined ? undefined : Number(match[3]);
    let minute = match[4] === undefined ? undefined : Number(match[4]);
    if (hour === undefined) {
      const near = timeNear(source, match.index, match.index + match[0].length);
      hour = near?.hour;
      minute = near?.minute;
    }
    const year = inferYear(month, day, now);
    push(makeDate(year, month, day, hour, minute), match);
  }

  // 4) 今天 / 明天 / 后天 / 大后天
  for (const match of matchAll(
    source,
    /(今天|明天|后天|大后天)(?:\s*(\d{1,2}):(\d{2}))?/gu,
  )) {
    const offset = RELATIVE_DAY[match[1]];
    if (offset === undefined) continue;
    const date = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + offset,
      match[2] === undefined ? 23 : Number(match[2]),
      match[3] === undefined ? 59 : Number(match[3]),
    );
    push(date, match, 0.2);
  }

  // 5) 周五 / 本周五 / 下周五 23:59
  for (const match of matchAll(
    source,
    /(下下|下|本|这)?\s*周\s*([一二三四五六日天])(?:\s*(\d{1,2}):(\d{2}))?/gu,
  )) {
    const prefix = match[1];
    const target = WEEKDAY[match[2]];
    if (target === undefined) continue;
    const current = now.getDay();
    let delta = (target - current + 7) % 7;
    if (prefix === '下') delta += 7;
    else if (prefix === '下下') delta += 14;
    else if (prefix !== '本' && prefix !== '这' && delta === 0) delta = 7;
    const date = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + delta,
      match[3] === undefined ? 23 : Number(match[3]),
      match[4] === undefined ? 59 : Number(match[4]),
    );
    push(date, match, 0.2);
  }

  // 6) 3 天后 / 两天后
  for (const match of matchAll(source, /(\d{1,3})\s*天\s*(?:后|之后)(?:\s*(\d{1,2}):(\d{2}))?/gu)) {
    const days = Number(match[1]);
    if (!Number.isFinite(days) || days > 365) continue;
    const date = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + days,
      match[2] === undefined ? 23 : Number(match[2]),
      match[3] === undefined ? 59 : Number(match[3]),
    );
    push(date, match, 0.1);
  }

  return results.sort((a, b) => b.score - a.score || a.index - b.index);
}

/**
 * 解析一个截止时间；取最可信的一个。
 * @param {string} text
 * @param {Date} [now]
 * @returns {{ date: Date, iso: string, matched: string } | null}
 */
export function parseDue(text, now = new Date()) {
  const best = parseDueCandidates(text, now)[0];
  if (!best) return null;
  return { date: best.date, iso: best.date.toISOString(), matched: best.matched };
}

/**
 * 读取 `标签: 值`，值在下一个字段标签 / 换行 / 表格分隔符处结束。
 * @param {string} text
 * @param {string} labels
 * @returns {string}
 */
function labelValue(text, labels) {
  const rx = new RegExp(
    `(?:^|[\\s|,;])(${labels})\\s*:\\s*(.{1,60}?)(?=\\s*(?:${FIELD_LABELS})\\s*:|[\\n|,;]|$)`,
    'iu',
  );
  const match = rx.exec(text);
  return match ? cleanValue(match[2]) : '';
}

/** 去掉标题 / 文件名里常见的装饰。 */
function stripDecorations(text) {
  return String(text ?? '')
    .replace(/^\s*[【\[][^】\]]{0,12}[】\]]\s*/u, '')
    .replace(/^\s*(?:作业|任务|ddl|deadline|todo)\s*[:：]?\s*/iu, '')
    .replace(/^\s*#{1,6}\s*/u, '')
    .trim();
}

/** 从一段文字里推断科目。 */
function inferSubject(text, sourceName) {
  const cleaned = stripDecorations(text);

  const heading = /^#{1,6}\s*(.+)$/mu.exec(cleaned);
  if (heading) {
    const value = stripSubject(heading[1]);
    if (value) return value;
  }

  // 「当代人工智能实验课：实验二 - 搜索算法」取冒号左侧的课程名。
  const titleLine = /^(.{2,40}?)\s*[:：]\s*.{0,60}(?:实验|作业|项目|大作业)/mu.exec(cleaned);
  if (titleLine) {
    const value = stripSubject(titleLine[1]);
    if (value) return value;
  }

  const patterns = [
    // 「数据结构 实验3」「线性代数 作业4」
    /([\u4e00-\u9fa5]{2,20})\s*(?:作业|实验|大作业|项目)/u,
    // 「高等数学 截止 ...」
    /([\u4e00-\u9fa5]{2,20})\s*(?:截止|提交|ddl|deadline)/iu,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(cleaned);
    if (!match) continue;
    const value = stripSubject(match[1]);
    if (value) return value;
  }

  return subjectFromName(sourceName);
}

/** 去掉科目值里混入的作业 / 日期尾巴。 */
function stripSubject(value) {
  return cleanValue(
    String(value ?? '')
      .replace(/^(?:作业|实验(?!课)|大作业|ddl|deadline)\s*[:：]?\s*/iu, '')
      .replace(/\s*(?:作业|实验(?!课)|大作业|ddl|deadline|截止|提交).*$/iu, '')
      .replace(/^(.{2,20}?)\1$/u, '$1')
      .replace(/\d{4}\s*[-/.年].*$/u, ''),
    30,
  );
}

/** 从文件名推断科目，例如 `高等数学_作业3.md` → 高等数学。 */
function subjectFromName(name) {
  if (!name) return '';
  const base = String(name)
    .replace(/\.[^.]+$/u, '')
    .replace(/[_-]+/gu, ' ');
  const cut = base
    .replace(/\s*(?:作业|实验(?!课)|大作业|ddl|deadline|截止|hw\s*\d*|第\s*\d+\s*次).*$/iu, '')
    .trim();
  return cut.length >= 2 ? cleanValue(cut, 30) : '';
}

/** 从文本里推断作业编号。 */
function inferAssignment(text) {
  const patterns = [
    /作业\s*(?:编号|序号|no\.?|#)?\s*:?\s*((?:[A-Za-z]+\s*)?\d{1,4}|[A-Za-z]{1,8}[-_]\d{1,4}|[一二三四五六七八九十]{1,3})/iu,
    /(?:第\s*)?([一二三四五六七八九十\d]{1,3})\s*(?:次|周)\s*作业/u,
    /\b(HW|Homework|Lab|Assignment|Project)\s*[#: -]?\s*([A-Za-z0-9]{1,8})/iu,
    /(实验|大作业|项目|课程设计)\s*([0-9一二三四五六七八九十]{1,3})/u,
  ];

  for (const [index, pattern] of patterns.entries()) {
    const match = pattern.exec(text);
    if (!match) continue;
    if (index === 2) return cleanValue(`${match[1]}${match[2]}`, 20);
    if (index === 3) return cleanValue(`${match[1]} ${match[2]}`, 20);
    return cleanValue(match[1], 20);
  }
  return '';
}

/**
 * 组合展示标题。
 * @param {string} subject
 * @param {string} assignment
 * @returns {string}
 */
export function formatTitle(subject, assignment) {
  const name = cleanValue(subject, 30) || '未命名课程';
  if (!assignment) return name;
  return `${name} · ${/^\d{1,3}$/u.test(assignment) ? `作业 ${assignment}` : assignment}`;
}

/**
 * 一条候选的置信度。
 * @param {{ subject: string, assignment: string, labeled: boolean }} parts
 * @returns {number}
 */
function confidenceOf(parts) {
  let score = 0.45;
  if (parts.subject) score += 0.25;
  if (parts.assignment) score += 0.2;
  if (parts.labeled) score += 0.1;
  return Math.min(1, Math.round(score * 100) / 100);
}

/**
 * 从表格行里提取候选，例如：
 *   2026-11-10 23:59 | 高等数学 | HW3
 * @param {string} text
 * @param {Date} now
 * @param {string} sourceName
 * @returns {Array<object>}
 */
function tableCandidates(text, now, sourceName) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.includes('|')) continue;
    const cells = line
      .split('|')
      .map((cell) => cell.trim())
      .filter((cell) => cell.length > 0);
    if (cells.length < 2) continue;
    const due = parseDue(line, now);
    if (!due) continue;
    const dateIndex = cells.findIndex((cell) => parseDue(cell, now) !== null);
    const rest = cells.filter((_, index) => index !== dateIndex);
    if (rest.length === 0) continue;
    let assignment = '';
    let subject = '';
    for (const cell of rest) {
      const found = inferAssignment(cell);
      if (found && !assignment) assignment = found;
      else if (!subject) subject = stripSubject(cell);
    }
    if (!subject) subject = subjectFromName(sourceName);
    if (!subject && !assignment) continue;
    out.push({
      subject: subject || '未命名课程',
      assignment,
      dueAt: due.iso,
      title: formatTitle(subject, assignment),
      confidence: confidenceOf({ subject, assignment, labeled: false }),
      snippet: line.trim().slice(0, 180),
      matched: due.matched,
      sourceName: sourceName || '',
    });
  }
  return out;
}

/**
 * 从任意文本中提取 DDL 候选。
 *
 * @param {string} text 原始文本（通知、聊天记录、Markdown、文件名 + 正文都可以）
 * @param {object} [options]
 * @param {string} [options.sourcePath] 来源文件路径（只用于展示）
 * @param {string} [options.sourceName] 来源文件名（用于推断科目）
 * @param {Date} [options.now] 用于相对日期（今天/下周五）的基准时间
 * @param {number} [options.max] 最多返回几条，默认 6
 * @returns {Array<{
 *   subject: string,
 *   assignment: string,
 *   dueAt: string,
 *   title: string,
 *   confidence: number,
 *   snippet: string,
 *   matched: string,
 *   sourceName: string,
 * }>}
 */
export function extractCandidates(text, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const sourceName = options.sourceName || '';
  const max = Number.isInteger(options.max) && options.max > 0 ? options.max : 6;
  const source = normalizeText(text);
  if (!source.trim()) return [];
  // 普通文本需要有「作业 / 截止」等关键词；表格行可以只靠「日期 + 竖线」成立。
  if (!DDL_KEYWORD.test(source) && !(source.includes('|') && parseDue(source, now))) return [];

  /** @type {Map<string, object>} */
  const found = new Map();

  const push = (candidate) => {
    if (!candidate) return;
    const key = `${candidate.dueAt}|${candidate.subject}|${candidate.assignment}`;
    const previous = found.get(key);
    if (!previous || previous.confidence < candidate.confidence) found.set(key, candidate);
  };

  // 表格行优先处理。
  for (const candidate of tableCandidates(source, now, sourceName)) push(candidate);

  // 按空行切段：一段通常是一份作业说明。
  const paragraphs = source.split(/\n{2,}/u).filter((paragraph) => paragraph.trim().length > 0);
  for (const paragraph of paragraphs) {
    const lines = paragraph.split('\n');
    const anchors = [];
    lines.forEach((line, index) => {
      const due = parseDue(line, now);
      if (due && (DUE_LABEL.test(line) || DDL_KEYWORD.test(line))) anchors.push(index);
    });

    if (anchors.length === 0) {
      // 「布置周 / 发布日期」这类段落只是发布时间，不是 DDL；
      // 没有截止标签时不要把段落里的日期当成截止时间。
      if (ANNOUNCEMENT_LABEL.test(paragraph) && !DUE_LABEL.test(paragraph)) continue;
      const due = parseDue(paragraph, now);
      if (!due) continue;
      const subject = labelValue(paragraph, '科目|课程|学科|课名|subject|course') || inferSubject(paragraph, sourceName);
      const assignment = labelValue(paragraph, '作业编号|作业序号|作业|assignment|homework') || inferAssignment(paragraph);
      if (!subject && !assignment) continue;
      push({
        subject: subject || '未命名课程',
        assignment,
        dueAt: due.iso,
        title: formatTitle(subject, assignment),
        confidence: confidenceOf({ subject, assignment, labeled: false }),
        snippet: paragraph.trim().slice(0, 180),
        matched: due.matched,
        sourceName,
      });
      continue;
    }

    anchors.forEach((anchor, index) => {
      const nextAnchor = anchors[index + 1];
      // 最后一个 anchor 不能把整篇文档都当成字段区，否则后文代码 / 章节标题
      // 会被误当成科目（例如实验 PDF 里的「叶子节点」）。
      const end = nextAnchor ?? Math.min(lines.length, anchor + 8);
      const start = index === 0 ? Math.max(0, anchor - 3) : anchor;
      const block = lines.slice(start, end).join('\n');
      const due = parseDue(block, now);
      if (!due) return;

      const labeledSubject = labelValue(block, '科目|课程|学科|课名|subject|course');
      const labeledAssignment = labelValue(block, '作业编号|作业序号|作业|assignment|homework');
      const subject = labeledSubject || inferSubject(block, sourceName);
      const assignment = labeledAssignment || inferAssignment(block);
      if (!subject && !assignment) return;

      push({
        subject: subject || '未命名课程',
        assignment,
        dueAt: due.iso,
        title: formatTitle(subject, assignment),
        confidence: confidenceOf({
          subject,
          assignment,
          labeled: Boolean(labeledSubject || labeledAssignment),
        }),
        snippet: lines[anchor].trim().slice(0, 180) || block.trim().slice(0, 180),
        matched: due.matched,
        sourceName,
      });
    });
  }

  // 实在找不到锚点时，把整段当成一条。
  if (found.size === 0) {
    const due = parseDue(source, now);
    if (due) {
      const subject = labelValue(source, '科目|课程|学科|课名|subject|course') || inferSubject(source, sourceName);
      const assignment = labelValue(source, '作业编号|作业序号|作业|assignment|homework') || inferAssignment(source);
      if (subject || assignment) {
        push({
          subject: subject || '未命名课程',
          assignment,
          dueAt: due.iso,
          title: formatTitle(subject, assignment),
          confidence: confidenceOf({ subject, assignment, labeled: false }),
          snippet: source.trim().slice(0, 180),
          matched: due.matched,
          sourceName,
        });
      }
    }
  }

  return [...found.values()]
    .sort((left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt))
    .slice(0, max);
}

/**
 * 只取最可信的一条。
 * @param {string} text
 * @param {object} [options]
 * @returns {ReturnType<typeof extractCandidates>[number] | null}
 */
export function parseDdlText(text, options = {}) {
  return extractCandidates(text, { ...options, max: 1 })[0] ?? null;
}

/**
 * 文本是否像一条 DDL（含关键词且能解析出截止时间）。
 * @param {string} text
 * @param {Date} [now]
 * @returns {boolean}
 */
export function looksLikeDdl(text, now = new Date()) {
  return extractCandidates(text, { now, max: 1 }).length > 0;
}

/**
 * 把 ISO 时间格式化成人类可读的本地时间。
 * @param {string | Date} value
 * @param {'zh' | 'en'} [locale]
 * @returns {string}
 */
export function formatDue(value, locale = 'zh') {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}
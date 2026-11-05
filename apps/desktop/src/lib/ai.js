/**
 * OpenAI 兼容的文档 DDL 提取。
 *
 * 不依赖任何官方 SDK；只要求 /chat/completions 兼容接口。
 * 默认 DeepSeek，可在设置里改成 OpenAI / 通义 / Kimi / 本地网关等。
 */
import { parseDue, formatTitle } from '../../../../packages/core/src/ddl.js';

function endpoint(baseUrl) {
  let base = String(baseUrl ?? '').trim().replace(/\/+$/u, '');
  if (!base) throw new Error('请先填写 AI Base URL');
  if (base.endsWith('/chat/completions')) return base;
  if (!/\/v\d+$/u.test(base)) base += '/v1';
  return `${base}/chat/completions`;
}

async function postJson(url, apiKey, body, timeoutMs = 60_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`AI 返回了非 JSON 响应（HTTP ${response.status}）：${text.slice(0, 300)}`);
    }
    if (!response.ok) {
      const detail = data?.error?.message ?? data?.message ?? text.slice(0, 300);
      throw new Error(`AI 请求失败（HTTP ${response.status}）：${detail}`);
    }
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('AI 请求超时');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function contentOf(data) {
  return String(data?.choices?.[0]?.message?.content ?? '').trim();
}

function parseJsonContent(content) {
  const cleaned = content
    .replace(/^```(?:json)?/iu, '')
    .replace(/```$/u, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('AI 没有返回 JSON');
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

function normaliseItems(raw, now = new Date()) {
  const list = Array.isArray(raw?.items) ? raw.items : Array.isArray(raw?.ddls) ? raw.ddls : [];
  const items = [];
  for (const entry of list.slice(0, 10)) {
    const subject = String(entry?.subject ?? '').trim();
    const assignment = String(entry?.assignment ?? entry?.homework ?? '').trim();
    const dueText = String(entry?.dueAt ?? entry?.deadline ?? '').trim();
    if (!subject && !assignment) continue;
    if (!dueText) continue;

    const parsed = parseDue(dueText, now);
    const direct = new Date(dueText);
    const date = Number.isNaN(direct.getTime()) ? parsed?.date : direct;
    if (!date || Number.isNaN(date.getTime())) continue;

    const title = String(entry?.title ?? '').trim() || formatTitle(subject || '未命名课程', assignment);
    items.push({
      subject: subject || '未命名课程',
      assignment,
      dueAt: date.toISOString(),
      title,
      confidence: Math.max(0, Math.min(1, Number(entry?.confidence) || 0.85)),
      snippet: String(entry?.snippet ?? '').slice(0, 180),
      sourceName: 'AI',
    });
  }
  return items;
}

function prompt(text, now = new Date(), documentHint = '') {
  return [
    '你是作业截止时间提取器。从下面的文档文本中提取所有明确的 DDL。',
    `当前本地时间：${now.toISOString()}（时区 ${Intl.DateTimeFormat().resolvedOptions().timeZone}）。`,
    `文档名 / 开头（用于判断课程名）：\n${String(documentHint).slice(0, 800)}`,
    '规则：',
    '1. 只提取文档中明确写出的截止时间；不要编造或推测。',
    '2. 不要把「布置周」「发布时间」「开始时间」「开放时间」误当成截止时间；截止时间通常在发布时间之后。',
    '3. 相对时间（今天、下周五等）按当前时间换算成 ISO 8601。',
    '4. subject 是课程名或课程实验名（例如「当代人工智能实验课」）；assignment 是实验/作业编号或名称（例如「实验二」「HW3」）。',
    '5. 绝对不要把代码注释、TreeNode、children、value、叶子节点、A*、alpha-beta、队列、函数名、示例代码当成 subject。',
    '6. 如果文档开头明确写了课程名，优先使用它；实验编号放在 assignment。',
    '7. 返回严格 JSON，不要 Markdown：',
    '{"items":[{"subject":"","assignment":"","dueAt":"2026-11-10T23:59:00+08:00","confidence":0.9}]}',
    '8. 没有 DDL 时返回 {"items":[]}。',
    '',
    '文档文本：',
    text.slice(0, 14_000),
  ].join('\n');
}

export async function extractWithAI({ text, baseUrl, apiKey, model, now = new Date(), documentHint = '' }) {
  if (!apiKey) throw new Error('请先配置 AI API Key');
  const url = endpoint(baseUrl);
  const body = {
    model: model || 'deepseek-chat',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: '你只返回严格 JSON，不返回 Markdown 或解释。' },
      { role: 'user', content: prompt(text, now, documentHint) },
    ],
  };

  let data;
  try {
    data = await postJson(url, apiKey, body);
  } catch (error) {
    // 部分兼容接口不支持 response_format；去掉后重试一次。
    if (!/response_format|json_object|400/iu.test(String(error?.message))) throw error;
    delete body.response_format;
    data = await postJson(url, apiKey, body);
  }

  const parsed = parseJsonContent(contentOf(data));
  return normaliseItems(parsed, now);
}

export async function testAI({ baseUrl, apiKey, model }) {
  const started = Date.now();
  const data = await postJson(
    endpoint(baseUrl),
    apiKey,
    {
      model: model || 'deepseek-chat',
      temperature: 0,
      messages: [
        { role: 'system', content: '只返回严格 JSON。' },
        { role: 'user', content: '返回 {"ok":true}' },
      ],
    },
    20_000,
  );
  const content = contentOf(data);
  const parsed = parseJsonContent(content);
  return {
    ok: parsed?.ok === true,
    model,
    latencyMs: Date.now() - started,
    sample: content.slice(0, 120),
  };
}
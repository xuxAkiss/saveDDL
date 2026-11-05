const $ = (selector) => document.querySelector(selector);
const portInput = $('#port');
const tokenInput = $('#token');
const status = $('#status');

const DEFAULTS = { port: 17893, token: 'save-ddl-local-v1' };

async function load() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  portInput.value = stored.port;
  tokenInput.value = stored.token;
}

function show(text, kind = '') {
  status.textContent = text;
  status.className = `status${kind ? ` ${kind}` : ''}`;
}

async function fetchWithTimeout(url, options = {}, timeout = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function testConnection() {
  const port = Number(portInput.value) || DEFAULTS.port;
  const token = tokenInput.value.trim() || DEFAULTS.token;
  show('测试中…');
  try {
    const health = await fetchWithTimeout(`http://127.0.0.1:${port}/health`);
    if (!health.ok) throw new Error(`health HTTP ${health.status}`);
    const response = await fetchWithTimeout(`http://127.0.0.1:${port}/items`, {
      headers: { 'x-save-ddl-token': token },
    });
    const data = await response.json().catch(() => null);
    if (response.status === 401) throw new Error('token 不匹配');
    if (!response.ok || !data?.ok) throw new Error(data?.error || `HTTP ${response.status}`);
    const open = (data.items ?? []).filter((item) => item.status !== 'done').length;
    show(`连接成功：${open} 条待办`, 'ok');
  } catch (error) {
    show(`连接失败：${error?.message ?? error}。请确认桌面端已启动、端口和 token 正确。`, 'error');
  }
}

$('#save').addEventListener('click', async () => {
  const port = Number(portInput.value) || DEFAULTS.port;
  const token = tokenInput.value.trim() || DEFAULTS.token;
  await chrome.storage.local.set({ port, token });
  portInput.value = port;
  tokenInput.value = token;
  show('已保存', 'ok');
  void testConnection();
});

$('#test').addEventListener('click', () => void testConnection());

void load();
/**
 * 拯救 DDL · 浏览器扩展 background（MV3 service worker）
 *
 * 右键选中文字 → 发给桌面端 http://127.0.0.1:17893/add-text。
 * 桌面端未启动时把原文暂存到 chrome.storage.local，每分钟重试。
 */
const DEFAULT_TOKEN = 'save-ddl-local-v1';
const DEFAULT_PORT = 17893;
const PORTS = Array.from({ length: 11 }, (_, index) => 17893 + index);

const MENU_SELECTION = 'save-ddl-selection';
const MENU_PAGE = 'save-ddl-page';
const MENU_LINK = 'save-ddl-link';
const ALARM_FLUSH = 'save-ddl-flush';

async function getSettings() {
  const stored = await chrome.storage.local.get({
    port: DEFAULT_PORT,
    token: DEFAULT_TOKEN,
  });
  return {
    port: Number(stored.port) || DEFAULT_PORT,
    token: String(stored.token || DEFAULT_TOKEN),
  };
}

async function getPending() {
  const stored = await chrome.storage.local.get({ pending: [] });
  return Array.isArray(stored.pending) ? stored.pending : [];
}

async function setPending(pending) {
  await chrome.storage.local.set({ pending });
  await updateBadge();
}

async function updateBadge() {
  const pending = await getPending();
  await chrome.action.setBadgeText({ text: pending.length > 0 ? String(pending.length) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
}

async function request(path, { method = 'GET', body } = {}) {
  const settings = await getSettings();
  const ports = [settings.port, ...PORTS.filter((port) => port !== settings.port)];
  let lastError = null;

  for (const port of ports) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 900);
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-save-ddl-token': settings.token,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (response.status === 401) {
        throw new Error('token 不匹配，请检查桌面端与扩展设置');
      }
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) {
        throw new Error(data?.error || `HTTP ${response.status}`);
      }
      if (port !== settings.port) {
        await chrome.storage.local.set({ port });
      }
      return data;
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
    }
  }
  throw lastError ?? new Error('桌面端未启动');
}

async function notify(title, message) {
  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title,
      message,
    });
  } catch {
    /* 用户关闭了通知权限时静默 */
  }
}

function sourceOf(info, tab) {
  return {
    url: info.pageUrl || tab?.url || '',
    title: tab?.title || '',
  };
}

async function handleText(text, source = {}) {
  const value = String(text ?? '').trim();
  if (!value) {
    await notify('没有选中文字', '先选中一段包含截止时间的文字，再右键。');
    return { ok: false, message: '没有选中文字' };
  }

  try {
    const data = await request('/add-text', {
      method: 'POST',
      body: { text: value, source },
    });
    await updateBadge();
    await notify(data.added > 0 ? '已加入 DDL' : '没有新增', data.message);
    return { ok: true, ...data };
  } catch (error) {
    const pending = await getPending();
    pending.push({ text: value, source, at: Date.now() });
    await setPending(pending);
    await notify('桌面端未启动', '已暂存到扩展，打开桌面端后会自动重试。');
    return { ok: false, queued: true, message: String(error?.message ?? error) };
  }
}

async function flushPending() {
  const pending = await getPending();
  if (pending.length === 0) return { ok: true, added: 0, remaining: 0 };

  let added = 0;
  const remaining = [];
  for (const entry of pending) {
    try {
      const data = await request('/add-text', {
        method: 'POST',
        body: { text: entry.text, source: entry.source },
      });
      added += data.added ?? 0;
    } catch {
      remaining.push(entry);
    }
  }
  await setPending(remaining);
  if (remaining.length === 0) {
    await notify('暂存已同步', `已加入 ${added} 条 DDL`);
  }
  return { ok: remaining.length === 0, added, remaining: remaining.length };
}

async function getStatus() {
  const pending = await getPending();
  try {
    const data = await request('/items');
    return { ok: true, items: data.items ?? [], pending: pending.length };
  } catch {
    return { ok: false, items: [], pending: pending.length };
  }
}

async function extractPage(tab) {
  if (!tab?.id) return '';
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (document.body?.innerText ?? '').slice(0, 20000),
    });
    return result?.result ?? '';
  } catch (error) {
    await notify('无法读取页面', String(error?.message ?? error));
    return '';
  }
}

function removeAllMenus() {
  return new Promise((resolve) => chrome.contextMenus.removeAll(() => resolve()));
}

async function createMenus() {
  await removeAllMenus();
  const menus = [
    { id: MENU_SELECTION, title: '加入 DDL', contexts: ['selection'] },
    { id: MENU_PAGE, title: '从本页提取 DDL', contexts: ['page'] },
    { id: MENU_LINK, title: '把链接加入 DDL', contexts: ['link'] },
  ];
  for (const menu of menus) {
    chrome.contextMenus.create(menu, () => {
      if (chrome.runtime.lastError) console.warn('[save-ddl] menu:', chrome.runtime.lastError.message);
    });
  }
}

function ensureAlarm() {
  chrome.alarms.create(ALARM_FLUSH, { periodInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(() => {
  void createMenus();
  ensureAlarm();
  void updateBadge();
  void flushPending();
});

chrome.runtime.onStartup.addListener(() => {
  void createMenus();
  ensureAlarm();
  void updateBadge();
  void flushPending();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_FLUSH) void flushPending();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void (async () => {
    if (info.menuItemId === MENU_SELECTION) {
      await handleText(info.selectionText ?? '', sourceOf(info, tab));
      return;
    }
    if (info.menuItemId === MENU_PAGE) {
      const text = await extractPage(tab);
      if (text) await handleText(text, sourceOf(info, tab));
      return;
    }
    if (info.menuItemId === MENU_LINK) {
      const text = [info.selectionText ?? '', info.linkUrl ?? ''].filter(Boolean).join('\n');
      await handleText(text, sourceOf(info, tab));
    }
  })().catch((error) => notify('操作失败', String(error?.message ?? error)));
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const run = async () => {
    switch (message?.type) {
      case 'status':
        return getStatus();
      case 'add-text':
        return handleText(message.text, message.source);
      case 'retry':
        return flushPending();
      case 'show-desktop':
        try {
          await request('/show', { method: 'POST' });
          return { ok: true };
        } catch (error) {
          return { ok: false, error: String(error?.message ?? error) };
        }
      case 'settings':
        return { ok: true, ...(await getSettings()) };
      default:
        return { ok: false, error: 'unknown_message' };
    }
  };
  run()
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: String(error?.message ?? error) }));
  return true;
});

void updateBadge();
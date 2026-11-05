const $ = (selector) => document.querySelector(selector);
const send = (message) => chrome.runtime.sendMessage(message);

const statusDot = $('#dot');
const statusText = $('#status-text');
const pendingBox = $('#pending');
const pendingText = $('#pending-text');
const itemsBox = $('#items');
const form = $('#add-form');
const textarea = $('#add-text');
const addButton = $('#add-button');
const message = $('#message');

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (value !== undefined && value !== null) node.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function formatDue(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const options = {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  };
  if (date.getFullYear() !== new Date().getFullYear()) options.year = 'numeric';
  return new Intl.DateTimeFormat('zh-CN', options).format(date);
}

function dayDiff(value) {
  const start = (input) => {
    const date = new Date(input);
    date.setHours(0, 0, 0, 0);
    return date;
  };
  return Math.round((start(value) - start(new Date())) / 86_400_000);
}

function renderItems(items) {
  itemsBox.replaceChildren();
  const open = items.filter((item) => item.status !== 'done').slice(0, 5);
  if (open.length === 0) {
    itemsBox.append(el('div', { class: 'empty' }, '还没有 DDL。选中网页文字 → 右键「加入 DDL」。'));
    return;
  }
  for (const item of open) {
    const diff = dayDiff(item.dueAt);
    const overdue = diff < 0;
    itemsBox.append(
      el(
        'div',
        { class: 'item' },
        el('span', { class: `mark${overdue ? ' overdue' : ''}` }),
        el(
          'div',
          { class: 'item-main' },
          el('div', { class: 'item-title' }, item.title),
          el('div', { class: 'item-meta' }, `截止 ${formatDue(item.dueAt)}`),
        ),
      ),
    );
  }
}

function renderPending(count) {
  pendingBox.hidden = count <= 0;
  pendingText.textContent = count > 0 ? `桌面端未启动，已暂存 ${count} 条` : '';
}

async function refresh() {
  let status;
  try {
    status = await send({ type: 'status' });
  } catch {
    status = { ok: false, items: [], pending: 0 };
  }
  const pending = status?.pending ?? 0;
  const items = status?.items ?? [];

  if (status?.ok) {
    const open = items.filter((item) => item.status !== 'done').length;
    statusDot.className = 'dot ok';
    statusText.textContent = `已连接 · ${open} 条待办`;
    renderItems(items);
  } else {
    statusDot.className = 'dot offline';
    statusText.textContent = '桌面端未启动';
    renderItems([]);
  }
  renderPending(pending);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = textarea.value.trim();
  if (!text) return;
  addButton.disabled = true;
  message.textContent = '解析中…';
  message.className = 'message';
  try {
    const result = await send({
      type: 'add-text',
      text,
      source: { url: 'popup', title: '扩展弹窗' },
    });
    if (result?.queued) {
      message.textContent = '桌面端未启动，已暂存';
      message.className = 'message error';
    } else {
      message.textContent = result?.message ?? (result?.added > 0 ? '已加入' : '没有新增');
      message.className = `message ${result?.added > 0 ? 'ok' : 'error'}`;
      if (result?.added > 0) textarea.value = '';
    }
    await refresh();
  } catch (error) {
    message.textContent = `操作失败：${error.message}`;
    message.className = 'message error';
  } finally {
    addButton.disabled = false;
  }
});

$('#retry').addEventListener('click', async () => {
  try {
    const result = await send({ type: 'retry' });
    message.textContent = result?.remaining > 0 ? `还有 ${result.remaining} 条未同步` : '暂存已同步';
    message.className = `message ${result?.remaining > 0 ? 'error' : 'ok'}`;
    await refresh();
  } catch (error) {
    message.textContent = `重试失败：${error.message}`;
    message.className = 'message error';
  }
});

$('#settings').addEventListener('click', () => chrome.runtime.openOptionsPage());

$('#open-desktop').addEventListener('click', async () => {
  try {
    const result = await send({ type: 'show-desktop' });
    message.textContent = result?.ok ? '已唤起桌面端' : '桌面端未启动';
    message.className = `message ${result?.ok ? 'ok' : 'error'}`;
  } catch {
    message.textContent = '桌面端未启动';
    message.className = 'message error';
  }
});

void refresh();
setInterval(() => void refresh(), 4000);
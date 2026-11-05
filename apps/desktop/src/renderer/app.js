const api = window.saveDdl;

const state = {
  items: [],
  settings: null,
  filter: 'todo',
};

const $ = (selector) => document.querySelector(selector);
const list = $('#list');
const empty = $('#empty');
const stats = $('#stats');
const tabs = $('#tabs');
const settingsPanel = $('#settings');
const backdrop = $('#backdrop');
const toast = $('#toast');
const addForm = $('#add-form');
const addText = $('#add-text');
const addButton = $('#add-button');
const addMessage = $('#add-message');

let toastTimer = null;

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function showToast(text) {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 3200);
}

function startOfDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function dayDiff(value) {
  return Math.round((startOfDay(value).getTime() - startOfDay(new Date()).getTime()) / 86_400_000);
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

function formatItemDue(item) {
  if (item.duePrecision === 'date') {
    return formatDue(item.dueAt).replace(/\s+\d{2}:\d{2}$/u, '');
  }
  if (item.duePrecision === 'fuzzy' && item.dueLabel) return `约 ${item.dueLabel}`;
  return formatDue(item.dueAt);
}

function relativeLabel(diff, done) {
  if (done) return '';
  if (diff < 0) return `逾期 ${-diff} 天`;
  if (diff === 0) return '今天截止';
  if (diff === 1) return '明天截止';
  if (diff <= 7) return `${diff} 天后`;
  return '';
}

function sourceLabel(item) {
  const source = item.source ?? {};
  if (source.kind === 'file' && (source.name || source.path)) {
    return `来自文件 · ${source.name || source.path.split(/[\\/]/u).pop()}`;
  }
  if (source.kind === 'agent') return '来自对话';
  if (source.kind === 'text') return '来自文本';
  return '手动添加';
}

function groupKey(item) {
  if (item.status === 'done') return 'done';
  const diff = dayDiff(item.dueAt);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff <= 7) return 'week';
  return 'later';
}

const GROUP_TITLES = {
  overdue: '已逾期',
  today: '今天',
  week: '未来 7 天',
  later: '更晚',
  done: '已完成',
};

function itemRow(item) {
  const done = item.status === 'done';
  const diff = dayDiff(item.dueAt);
  const overdue = !done && diff < 0;
  const soon = !done && diff >= 0 && diff <= 1;
  const relative = relativeLabel(diff, done);

  const check = el(
    'button',
    {
      class: 'check',
      type: 'button',
      'aria-pressed': String(done),
      'aria-label': done ? '恢复待办' : '标记完成',
      title: done ? '恢复待办' : '标记完成',
      dataset: { action: 'toggle', id: item.id },
    },
    done ? '✓' : '',
  );

  const title = el('div', { class: 'ddl-title' }, item.title);
  const meta = el(
    'div',
    { class: 'ddl-meta' },
    el(
      'span',
      { class: `ddl-due${overdue ? ' overdue' : soon ? ' soon' : ''}` },
      `截止 ${formatItemDue(item)}`,
    ),
    relative
      ? el('span', { class: `relative${overdue ? ' overdue' : ''}` }, relative)
      : null,
    el('span', null, sourceLabel(item)),
  );

  const main = el('div', { class: 'ddl-main' }, title, meta);
  if (item.notes) main.append(el('div', { class: 'ddl-notes' }, item.notes));

  const remove = el(
    'button',
    {
      class: 'icon-btn danger',
      type: 'button',
      'aria-label': '删除',
      title: '删除',
      dataset: { action: 'delete', id: item.id },
    },
    '×',
  );

  return el(
    'article',
    { class: `ddl-item${done ? ' is-done' : ''}`, dataset: { id: item.id } },
    check,
    main,
    el('div', { class: 'item-actions' }, remove),
  );
}

function renderStats() {
  const now = new Date();
  const todo = state.items.filter((item) => item.status !== 'done');
  const overdue = todo.filter((item) => dayDiff(item.dueAt) < 0);
  const next = todo[0];

  stats.replaceChildren();
  stats.append(el('span', { class: 'chip' }, `${todo.length} 条待办`));
  if (overdue.length > 0) {
    stats.append(el('span', { class: 'chip chip-danger' }, `${overdue.length} 条逾期`));
  }
  if (next) {
    stats.append(el('span', { class: 'chip' }, `下一次截止 · ${formatItemDue(next)}`));
  }
  if (state.settings?.pausedUntil && state.settings.pausedUntil > now.getTime()) {
    stats.append(el('span', { class: 'chip' }, '提醒已暂停'));
  }
}

function renderTabs() {
  const todo = state.items.filter((item) => item.status !== 'done').length;
  const done = state.items.filter((item) => item.status === 'done').length;
  const labels = {
    todo: `待办 (${todo})`,
    done: `已完成 (${done})`,
    all: '全部',
  };
  for (const button of tabs.querySelectorAll('[data-filter]')) {
    const filter = button.dataset.filter;
    button.textContent = labels[filter];
    button.setAttribute('aria-selected', String(filter === state.filter));
  }
}

function renderList() {
  const visible =
    state.filter === 'todo'
      ? state.items.filter((item) => item.status !== 'done')
      : state.filter === 'done'
        ? state.items.filter((item) => item.status === 'done')
        : state.items;

  list.replaceChildren();

  if (visible.length === 0) {
    empty.hidden = false;
    const isDone = state.filter === 'done';
    empty.querySelector('.empty-title').textContent = isDone
      ? '还没有完成的 DDL'
      : state.filter === 'all'
        ? '清单是空的'
        : '还没有 DDL';
    empty.querySelector('.empty-body').textContent = isDone
      ? '完成一条后，它会出现在这里。'
      : '把课程群里的通知粘贴到上面，或按 Ctrl+Alt+D 从剪贴板加入。';
    return;
  }

  empty.hidden = true;
  const buckets = { overdue: [], today: [], week: [], later: [], done: [] };
  for (const item of visible) buckets[groupKey(item)].push(item);

  for (const key of ['overdue', 'today', 'week', 'later', 'done']) {
    const items = buckets[key];
    if (items.length === 0) continue;
    const section = el(
      'section',
      { class: 'group' },
      el(
        'h2',
        { class: 'group-title' },
        GROUP_TITLES[key],
        el('span', { class: 'group-count' }, String(items.length)),
      ),
    );
    for (const item of items) section.append(itemRow(item));
    list.append(section);
  }
}

function renderSettings() {
  const settings = state.settings;
  if (!settings) return;
  $('#autostart').checked = Boolean(settings.autoStart);
  const installed = Boolean(settings.contextMenuInstalled);
  const button = $('#context-menu');
  button.textContent = installed ? '移除资源管理器右键菜单' : '安装资源管理器右键菜单';
  $('#context-menu-hint').textContent = installed
    ? '已安装：在资源管理器里右键文件或文件夹即可看到「加入 DDL」。'
    : '安装后，右键文件或文件夹可以直接加入 DDL。';
  $('#data-file').textContent = settings.dataFile;
  $('#version').textContent = `v${settings.version} · 数据与 DSH / Claude Code / Codex 共用`;

  const ai = settings.ai ?? {};
  if (document.activeElement !== $('#ai-base')) $('#ai-base').value = ai.baseUrl ?? '';
  if (document.activeElement !== $('#ai-model')) $('#ai-model').value = ai.model ?? '';
  $('#ai-hint').textContent = ai.hasKey
    ? `已保存 Key${ai.encryption ? '（系统加密）' : '（明文，建议开启系统加密）'}。PDF / Word 文本会发送到上面的 Base URL；AI 失败会回退规则解析。`
    : '未配置 Key：PDF / Word 先用规则解析。保存 Key 后会自动优先走 AI；文档文本会发送到上面的 Base URL。';
}

function render() {
  renderStats();
  renderTabs();
  renderList();
  renderSettings();
}

async function load() {
  try {
    const [items, settings] = await Promise.all([api.list(), api.settings()]);
    state.items = items;
    state.settings = settings;
    render();
  } catch (error) {
    showToast(`读取失败：${error.message}`);
  }
}

async function openSettings() {
  state.settings = await api.settings();
  settingsPanel.hidden = false;
  backdrop.hidden = false;
  requestAnimationFrame(() => settingsPanel.classList.add('open'));
  renderSettings();
}

function closeSettings() {
  settingsPanel.classList.remove('open');
  backdrop.hidden = true;
  setTimeout(() => {
    settingsPanel.hidden = true;
  }, 220);
}

addForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = addText.value.trim();
  if (!text) return;
  addButton.disabled = true;
  addMessage.textContent = '解析中…';
  addMessage.className = 'message';
  try {
    const result = await api.addText(text);
    addMessage.textContent = result.message;
    addMessage.className = `message ${result.added > 0 ? 'ok' : 'error'}`;
    if (result.added > 0) addText.value = '';
    await load();
  } catch (error) {
    addMessage.textContent = `操作失败：${error.message}`;
    addMessage.className = 'message error';
  } finally {
    addButton.disabled = false;
  }
});

addText.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    addForm.requestSubmit();
  }
});

tabs.addEventListener('click', (event) => {
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  state.filter = button.dataset.filter;
  renderTabs();
  renderList();
});

list.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, id } = button.dataset;
  if (action === 'toggle') {
    void api
      .toggle(id)
      .then(load)
      .catch((error) => showToast(`操作失败：${error.message}`));
  }
  if (action === 'delete') {
    void api
      .remove(id)
      .then(load)
      .catch((error) => showToast(`操作失败：${error.message}`));
  }
});

$('#export').addEventListener('click', async () => {
  try {
    const file = await api.exportIcs();
    if (file) showToast(`已导出：${file}`);
  } catch (error) {
    showToast(`导出失败：${error.message}`);
  }
});

$('#import-document').addEventListener('click', async () => {
  try {
    const result = await api.importDocument();
    if (result?.ok) showToast(`已加入 ${result.added} 条 DDL`);
    await load();
  } catch (error) {
    showToast(`导入失败：${error.message}`);
  }
});

$('#ai-save').addEventListener('click', async () => {
  try {
    await api.saveAI({
      baseUrl: $('#ai-base').value.trim(),
      model: $('#ai-model').value.trim(),
      apiKey: $('#ai-key').value,
    });
    $('#ai-key').value = '';
    state.settings = await api.settings();
    renderSettings();
    showToast('AI 设置已保存');
  } catch (error) {
    showToast(`保存失败：${error.message}`);
  }
});

$('#ai-test').addEventListener('click', async () => {
  const hint = $('#ai-hint');
  hint.textContent = '正在测试 AI 连接…';
  try {
    const result = await api.testAI({
      baseUrl: $('#ai-base').value.trim(),
      model: $('#ai-model').value.trim(),
      apiKey: $('#ai-key').value,
    });
    hint.textContent = `AI 连接成功 · ${result.model} · ${result.latencyMs} ms`;
    showToast('AI 连接成功');
  } catch (error) {
    hint.textContent = `AI 连接失败：${error.message}`;
    showToast('AI 连接失败');
  }
});

$('#ai-clear').addEventListener('click', async () => {
  try {
    await api.clearAIKey();
    $('#ai-key').value = '';
    state.settings = await api.settings();
    renderSettings();
    showToast('已清除 AI Key');
  } catch (error) {
    showToast(`清除失败：${error.message}`);
  }
});

$('#settings-toggle').addEventListener('click', () => void openSettings());
$('#settings-close').addEventListener('click', closeSettings);
backdrop.addEventListener('click', closeSettings);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !settingsPanel.hidden) closeSettings();
});

$('#autostart').addEventListener('change', async (event) => {
  try {
    await api.setAutostart(event.target.checked);
    state.settings = await api.settings();
    renderSettings();
  } catch (error) {
    showToast(`设置失败：${error.message}`);
  }
});

$('#context-menu').addEventListener('click', async () => {
  const install = !state.settings?.contextMenuInstalled;
  try {
    const result = await api.setContextMenu(install);
    if (!result.ok) showToast(result.error || '操作失败');
    else showToast(install ? '右键菜单已安装' : '右键菜单已移除');
    state.settings = await api.settings();
    renderSettings();
  } catch (error) {
    showToast(`操作失败：${error.message}`);
  }
});

api.onChanged(() => {
  void load();
});

api.onFocusItem((id) => {
  state.filter = 'todo';
  renderTabs();
  renderList();
  requestAnimationFrame(() => {
    const node = list.querySelector(`[data-id="${CSS.escape(id)}"]`);
    node?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    node?.classList.add('flash');
    setTimeout(() => node?.classList.remove('flash'), 2200);
  });
});

void load();
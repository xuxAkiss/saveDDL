/**
 * 拯救 DDL · DSH Client 插件
 * ==========================
 *
 * 三个界面入口：
 *   1. 侧栏面板按钮（id = `save-ddl`）→ 主面板「查看 DDL」。
 *   2. 主面板：待办列表、粘贴解析、完成 / 删除、导出 .ics。
 *   3. `shell.overlay` 的右下角提示：工作区发现疑似 DDL 时询问是否加入。
 *
 * 数据全部来自同源 HTTP API：
 *   GET  /save-ddl/state
 *   POST /save-ddl/action
 *   GET  /save-ddl/calendar.ics
 *
 * @module @local/save-ddl/client
 */
window.__ModuleLoader__.load({
  id: '@local/save-ddl',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'save-ddl';

    // ---------------------------------------------------------------------
    // 文案
    // ---------------------------------------------------------------------
    const zh = {
      'panel.label': '查看 DDL',
      'page.title': '拯救 DDL',
      'page.subtitle': '把散落在通知、群聊和文档里的截止时间，收进一个清单。',
      'page.todo': '条待办',
      'page.overdue': '条逾期',
      'page.next': '下一次截止',
      'page.none': '暂无',
      'tabs.todo': '待办',
      'tabs.done': '已完成',
      'tabs.all': '全部',
      'add.title': '粘贴一条通知',
      'add.placeholder': '例：时限：2026-11-10 23:59 科目：高等数学 作业编号：HW3',
      'add.button': '解析并加入',
      'add.busy': '解析中…',
      'add.hint': '也支持「11月20日 22:00」「下周五 23:59」。PDF / Word 可以先让我读取，再用 ddl 工具加入。',
      'add.added': '已加入 {n} 条 DDL',
      'add.none': '没有识别到截止时间。试试「时限：2026-11-10 23:59 科目：高等数学 作业编号：HW3」。',
      'add.duplicate': '识别到了，但这些 DDL 已经在清单里。',
      'toolbar.refresh': '重新扫描',
      'toolbar.refreshing': '扫描中…',
      'toolbar.refreshed': '已重新扫描工作区',
      'toolbar.export': '导出日历',
      'toolbar.clearDone': '清理已完成',
      'toolbar.cleared': '已清理 {n} 条已完成',
      'empty.todo.title': '还没有 DDL',
      'empty.todo.body': '把课程群里的通知粘贴到上面，或在对话里让我读取作业文档。',
      'empty.done.title': '还没有完成的 DDL',
      'empty.done.body': '完成一条后，它会出现在这里。',
      'empty.all.title': '清单是空的',
      'empty.all.body': '从一条通知开始吧。',
      'group.overdue': '已逾期',
      'group.today': '今天',
      'group.week': '未来 7 天',
      'group.later': '更晚',
      'group.done': '已完成',
      'item.due': '截止',
      'item.complete': '标记完成',
      'item.reopen': '恢复待办',
      'item.delete': '删除',
      'item.manual': '手动添加',
      'item.agent': '来自对话',
      'item.file': '来自文件',
      'item.text': '来自文本',
      'relative.overdue': '逾期 {n} 天',
      'relative.today': '今天截止',
      'relative.tomorrow': '明天截止',
      'relative.days': '{n} 天后',
      'suggestion.title': '发现 {n} 个疑似 DDL',
      'suggestion.body': '工作区文件里出现了截止时间。要加入清单吗？',
      'suggestion.acceptAll': '全部加入',
      'suggestion.accept': '加入',
      'suggestion.dismiss': '忽略',
      'suggestion.dismissAll': '全部忽略',
      'suggestion.later': '稍后',
      'suggestion.view': '查看',
      'suggestion.more': '还有 {n} 条',
      'suggestion.accepted': '已加入 {n} 条 DDL',
      'suggestion.dismissed': '已忽略',
      'status.loading': '正在读取清单…',
      'error.network': '连接 DSH 失败，稍后会自动重试。',
      'error.action': '操作失败：{message}',
      'time.locale': 'zh-CN',
    };

    const en = {
      'panel.label': 'View DDLs',
      'page.title': 'Save DDL',
      'page.subtitle': 'Collect deadlines scattered across chats, notifications, and documents.',
      'page.todo': 'open',
      'page.overdue': 'overdue',
      'page.next': 'Next deadline',
      'page.none': 'none',
      'tabs.todo': 'Open',
      'tabs.done': 'Done',
      'tabs.all': 'All',
      'add.title': 'Paste a notice',
      'add.placeholder': 'e.g. Deadline: 2026-11-10 23:59, Course: Calculus, Assignment: HW3',
      'add.button': 'Parse and add',
      'add.busy': 'Parsing…',
      'add.hint': 'Also accepts “Nov 20, 22:00” or “next Friday 23:59”. For PDF / Word, ask me to read the file, then add it with the ddl tool.',
      'add.added': 'Added {n} DDL(s)',
      'add.none': 'No deadline found. Try “Deadline: 2026-11-10 23:59, Course: Calculus, Assignment: HW3”.',
      'add.duplicate': 'Recognized, but these DDLs are already in the list.',
      'toolbar.refresh': 'Rescan',
      'toolbar.refreshing': 'Scanning…',
      'toolbar.refreshed': 'Workspace rescanned',
      'toolbar.export': 'Export calendar',
      'toolbar.clearDone': 'Clear done',
      'toolbar.cleared': 'Cleared {n} completed DDL(s)',
      'empty.todo.title': 'No DDLs yet',
      'empty.todo.body': 'Paste a course notice above, or ask me in the conversation to read an assignment document.',
      'empty.done.title': 'Nothing completed yet',
      'empty.done.body': 'Completed DDLs will appear here.',
      'empty.all.title': 'The list is empty',
      'empty.all.body': 'Start with one notice.',
      'group.overdue': 'Overdue',
      'group.today': 'Today',
      'group.week': 'Next 7 days',
      'group.later': 'Later',
      'group.done': 'Done',
      'item.due': 'Due',
      'item.complete': 'Mark complete',
      'item.reopen': 'Reopen',
      'item.delete': 'Delete',
      'item.manual': 'Added manually',
      'item.agent': 'From conversation',
      'item.file': 'From file',
      'item.text': 'From text',
      'relative.overdue': '{n}d overdue',
      'relative.today': 'Due today',
      'relative.tomorrow': 'Due tomorrow',
      'relative.days': 'In {n}d',
      'suggestion.title': '{n} possible DDL(s) found',
      'suggestion.body': 'A workspace file contains a deadline. Add it to the list?',
      'suggestion.acceptAll': 'Add all',
      'suggestion.accept': 'Add',
      'suggestion.dismiss': 'Ignore',
      'suggestion.dismissAll': 'Ignore all',
      'suggestion.later': 'Later',
      'suggestion.view': 'View',
      'suggestion.more': '{n} more',
      'suggestion.accepted': 'Added {n} DDL(s)',
      'suggestion.dismissed': 'Ignored',
      'status.loading': 'Loading the list…',
      'error.network': 'Cannot reach DSH. Retrying automatically.',
      'error.action': 'Action failed: {message}',
      'time.locale': 'en-US',
    };

    function fallbackT(key) {
      return zh[key] ?? en[key] ?? key;
    }

    function fmt(template, values) {
      return Object.entries(values).reduce(
        (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
        String(template ?? ''),
      );
    }

    // ---------------------------------------------------------------------
    // 时间
    // ---------------------------------------------------------------------
    function startOfDay(value) {
      const date = new Date(value);
      date.setHours(0, 0, 0, 0);
      return date;
    }

    function dayDiff(value, now = new Date()) {
      return Math.round((startOfDay(value).getTime() - startOfDay(now).getTime()) / 86_400_000);
    }

    function formatDue(value, locale) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      const options = {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      };
      if (date.getFullYear() !== new Date().getFullYear()) options.year = 'numeric';
      try {
        return new Intl.DateTimeFormat(locale || undefined, options).format(date);
      } catch {
        return date.toLocaleString();
      }
    }

    function relativeLabel(t, diff, done) {
      if (done) return '';
      if (diff < 0) return fmt(t('relative.overdue'), { n: -diff });
      if (diff === 0) return t('relative.today');
      if (diff === 1) return t('relative.tomorrow');
      if (diff <= 7) return fmt(t('relative.days'), { n: diff });
      return '';
    }

    function basename(value) {
      const text = String(value ?? '');
      const index = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'));
      return index >= 0 ? text.slice(index + 1) : text;
    }

    function sourceLabel(item, t) {
      const source = item?.source ?? {};
      if (source.kind === 'file' && (source.name || source.path)) {
        return `${t('item.file')} · ${source.name || basename(source.path)}`;
      }
      if (source.kind === 'agent') return t('item.agent');
      if (source.kind === 'text') return t('item.text');
      return t('item.manual');
    }

    // ---------------------------------------------------------------------
    // 数据仓库（一个轮询，页面和提示层共用）
    // ---------------------------------------------------------------------
    function createDdlStore() {
      let snapshot = {
        status: 'loading',
        items: [],
        suggestions: [],
        scanning: false,
        error: null,
      };
      const listeners = new Set();
      let timer = null;
      let running = false;

      const getSnapshot = () => snapshot;
      const subscribe = (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      };
      const publish = (next) => {
        snapshot = next;
        for (const listener of [...listeners]) listener();
      };

      async function load() {
        try {
          const response = await fetch('/save-ddl/state', { cache: 'no-store' });
          const data = await response.json().catch(() => null);
          if (!response.ok || !data || data.ok === false) {
            throw new Error(data?.error || `HTTP ${response.status}`);
          }
          publish({
            status: 'ready',
            items: Array.isArray(data.items) ? data.items : [],
            suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
            scanning: data.scanning === true,
            error: null,
          });
        } catch (error) {
          publish({
            ...snapshot,
            status: snapshot.status === 'loading' ? 'error' : snapshot.status,
            error: String(error?.message ?? error),
          });
        }
      }

      async function tick() {
        await load();
        if (running) timer = setTimeout(tick, 5_000);
      }

      function onFocus() {
        void load();
      }

      function start() {
        if (running) return;
        running = true;
        window.addEventListener('focus', onFocus);
        void tick();
      }

      function stop() {
        running = false;
        if (timer !== null) clearTimeout(timer);
        timer = null;
        window.removeEventListener('focus', onFocus);
      }

      async function act(body) {
        const response = await fetch('/save-ddl/action', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
        if (!response.ok || data.ok === false) {
          throw new Error(data?.error || `HTTP ${response.status}`);
        }
        publish({
          status: 'ready',
          items: Array.isArray(data.items) ? data.items : snapshot.items,
          suggestions: Array.isArray(data.suggestions) ? data.suggestions : snapshot.suggestions,
          scanning: data.scanning === true,
          error: null,
        });
        return data;
      }

      return { start, stop, load, act, subscribe, getSnapshot };
    }

    // ---------------------------------------------------------------------
    // 图标
    // ---------------------------------------------------------------------
    function DdlIcon({ size = 20 }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': true,
          focusable: false,
        },
        h('rect', {
          x: 3.25,
          y: 4.75,
          width: 17.5,
          height: 16,
          rx: 3,
          stroke: 'currentColor',
          strokeWidth: 1.7,
        }),
        h('path', { d: 'M3.25 9.25h17.5', stroke: 'currentColor', strokeWidth: 1.7 }),
        h('path', {
          d: 'M8 2.75v3.5M16 2.75v3.5',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
        }),
        h('path', {
          d: 'M8 13.25h4.5M8 16.75h7',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
        }),
      );
    }

    function CheckIcon() {
      return h(
        'svg',
        { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('path', {
          d: 'm3.2 8.4 3 3 6.6-7',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      );
    }

    function TrashIcon() {
      return h(
        'svg',
        { width: 15, height: 15, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('path', {
          d: 'M3 4.5h10M6.2 4.5V3.2h3.6v1.3M4.4 4.5l.5 8.1h6.2l.5-8.1',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      );
    }

    function RefreshIcon() {
      return h(
        'svg',
        { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('path', {
          d: 'M13 8a5 5 0 1 1-1.5-3.5M13 2.8v2.7h-2.7',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      );
    }

    function DownloadIcon() {
      return h(
        'svg',
        { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('path', {
          d: 'M8 2.5v7M5.2 7.2 8 10l2.8-2.8M3 13h10',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      );
    }

    function CloseIcon() {
      return h(
        'svg',
        { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('path', {
          d: 'm4 4 8 8M12 4l-8 8',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
        }),
      );
    }

    // ---------------------------------------------------------------------
    // 主面板
    // ---------------------------------------------------------------------
    function DdlPage(props) {
      const { t = fallbackT, store } = props;
      const snapshot = React.useSyncExternalStore(store.subscribe, store.getSnapshot);
      const [tab, setTab] = React.useState('todo');
      const [text, setText] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [message, setMessage] = React.useState(null);

      const locale = t('time.locale') || undefined;
      const now = new Date();
      const items = snapshot.items;
      const todo = items.filter((item) => item.status !== 'done');
      const done = items.filter((item) => item.status === 'done');
      const overdue = todo.filter((item) => dayDiff(item.dueAt, now) < 0);
      const next = todo[0];
      const suggestions = snapshot.suggestions;

      const visible = tab === 'done' ? done : tab === 'all' ? items : todo;

      const buckets = { overdue: [], today: [], week: [], later: [], done: [] };
      for (const item of visible) {
        if (item.status === 'done') {
          buckets.done.push(item);
          continue;
        }
        const diff = dayDiff(item.dueAt, now);
        if (diff < 0) buckets.overdue.push(item);
        else if (diff === 0) buckets.today.push(item);
        else if (diff <= 7) buckets.week.push(item);
        else buckets.later.push(item);
      }
      const groups = ['overdue', 'today', 'week', 'later', 'done']
        .filter((key) => buckets[key].length > 0)
        .map((key) => ({ key, items: buckets[key] }));

      async function onSubmit(event) {
        if (event) event.preventDefault();
        const value = text.trim();
        if (!value || busy) return;
        setBusy(true);
        setMessage(null);
        try {
          const data = await store.act({ action: 'add-text', text: value });
          const added = data.added ?? 0;
          const found = Array.isArray(data.candidates) ? data.candidates.length : 0;
          if (added > 0) {
            setText('');
            setMessage({ kind: 'ok', text: fmt(t('add.added'), { n: added }) });
          } else if (found === 0) {
            setMessage({ kind: 'error', text: t('add.none') });
          } else {
            setMessage({ kind: 'info', text: t('add.duplicate') });
          }
        } catch (error) {
          setMessage({
            kind: 'error',
            text: fmt(t('error.action'), { message: error.message }),
          });
        } finally {
          setBusy(false);
        }
      }

      async function onRefresh() {
        if (busy) return;
        setBusy(true);
        setMessage(null);
        try {
          await store.act({ action: 'refresh' });
          setMessage({ kind: 'ok', text: t('toolbar.refreshed') });
        } catch (error) {
          setMessage({
            kind: 'error',
            text: fmt(t('error.action'), { message: error.message }),
          });
        } finally {
          setBusy(false);
        }
      }

      async function onClearDone() {
        if (busy) return;
        const count = done.length;
        setBusy(true);
        setMessage(null);
        try {
          await store.act({ action: 'clear-done' });
          setMessage({ kind: 'ok', text: fmt(t('toolbar.cleared'), { n: count }) });
        } catch (error) {
          setMessage({
            kind: 'error',
            text: fmt(t('error.action'), { message: error.message }),
          });
        } finally {
          setBusy(false);
        }
      }

      async function onToggle(item) {
        try {
          await store.act({ action: 'toggle', id: item.id });
        } catch (error) {
          setMessage({
            kind: 'error',
            text: fmt(t('error.action'), { message: error.message }),
          });
        }
      }

      async function onDelete(item) {
        try {
          await store.act({ action: 'delete', id: item.id });
        } catch (error) {
          setMessage({
            kind: 'error',
            text: fmt(t('error.action'), { message: error.message }),
          });
        }
      }

      async function onAcceptAll() {
        if (busy) return;
        setBusy(true);
        try {
          const data = await store.act({ action: 'accept-all' });
          setMessage({
            kind: 'ok',
            text: fmt(t('suggestion.accepted'), { n: data.count ?? suggestions.length }),
          });
        } catch (error) {
          setMessage({
            kind: 'error',
            text: fmt(t('error.action'), { message: error.message }),
          });
        } finally {
          setBusy(false);
        }
      }

      async function onDismissAll() {
        if (busy) return;
        setBusy(true);
        try {
          await store.act({ action: 'dismiss-all' });
          setMessage({ kind: 'info', text: t('suggestion.dismissed') });
        } catch (error) {
          setMessage({
            kind: 'error',
            text: fmt(t('error.action'), { message: error.message }),
          });
        } finally {
          setBusy(false);
        }
      }

      const emptyKey =
        tab === 'done' ? 'empty.done' : tab === 'all' ? 'empty.all' : 'empty.todo';

      return h(
        'section',
        { className: 'sdl-page', 'aria-label': t('page.title') },
        h(
          'div',
          { className: 'sdl-scroll' },
          h(
            'div',
            { className: 'sdl-shell' },
            h(
              'header',
              { className: 'sdl-header' },
              h(
                'div',
                null,
                h('h1', { className: 'sdl-title' }, t('page.title')),
                h('p', { className: 'sdl-subtitle' }, t('page.subtitle')),
              ),
              h(
                'div',
                { className: 'sdl-actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'sdl-btn',
                    onClick: onRefresh,
                    disabled: busy,
                    title: t('toolbar.refresh'),
                  },
                  h(RefreshIcon),
                  busy ? t('toolbar.refreshing') : t('toolbar.refresh'),
                ),
                h(
                  'a',
                  {
                    className: 'sdl-btn',
                    href: '/save-ddl/calendar.ics',
                    download: 'save-ddl.ics',
                    title: t('toolbar.export'),
                  },
                  h(DownloadIcon),
                  t('toolbar.export'),
                ),
              ),
            ),

            h(
              'div',
              { className: 'sdl-stats' },
              h('span', { className: 'sdl-chip' }, `${todo.length} ${t('page.todo')}`),
              overdue.length > 0
                ? h('span', { className: 'sdl-chip sdl-chip-danger' }, `${overdue.length} ${t('page.overdue')}`)
                : null,
              next
                ? h(
                    'span',
                    { className: 'sdl-chip' },
                    `${t('page.next')} · ${formatDue(next.dueAt, locale)}`,
                  )
                : null,
              snapshot.scanning ? h('span', { className: 'sdl-chip' }, t('toolbar.refreshing')) : null,
            ),

            snapshot.error
              ? h('div', { className: 'sdl-message sdl-message-error', role: 'status' }, t('error.network'))
              : null,

            suggestions.length > 0
              ? h(
                  'div',
                  { className: 'sdl-banner', role: 'status' },
                  h(
                    'div',
                    null,
                    h(
                      'div',
                      { className: 'sdl-banner-title' },
                      fmt(t('suggestion.title'), { n: suggestions.length }),
                    ),
                    h(
                      'div',
                      { className: 'sdl-banner-body' },
                      suggestions[0]
                        ? `${suggestions[0].title} · ${formatDue(suggestions[0].dueAt, locale)}`
                        : t('suggestion.body'),
                    ),
                  ),
                  h(
                    'div',
                    { className: 'sdl-banner-actions' },
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'sdl-btn sdl-btn-primary',
                        onClick: onAcceptAll,
                        disabled: busy,
                      },
                      t('suggestion.acceptAll'),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'sdl-btn',
                        onClick: onDismissAll,
                        disabled: busy,
                      },
                      t('suggestion.dismissAll'),
                    ),
                  ),
                )
              : null,

            h(
              'form',
              { className: 'sdl-card sdl-add', onSubmit },
              h(
                'div',
                { className: 'sdl-add-head' },
                h('div', { className: 'sdl-add-title' }, t('add.title')),
                h('div', { className: 'sdl-hint' }, t('add.hint')),
              ),
              h('textarea', {
                className: 'sdl-textarea',
                value: text,
                placeholder: t('add.placeholder'),
                onChange: (event) => setText(event.target.value),
                onKeyDown: (event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                    event.preventDefault();
                    void onSubmit();
                  }
                },
                rows: 3,
                'aria-label': t('add.title'),
              }),
              h(
                'div',
                { className: 'sdl-add-foot' },
                h(
                  'button',
                  {
                    type: 'submit',
                    className: 'sdl-btn sdl-btn-primary',
                    disabled: busy || text.trim().length === 0,
                  },
                  busy ? t('add.busy') : t('add.button'),
                ),
                message
                  ? h(
                      'span',
                      {
                        className: `sdl-message sdl-message-${message.kind}`,
                        role: message.kind === 'error' ? 'alert' : 'status',
                      },
                      message.text,
                    )
                  : null,
              ),
            ),

            h(
              'div',
              { className: 'sdl-tabs', role: 'tablist' },
              [
                ['todo', `${t('tabs.todo')} (${todo.length})`],
                ['done', `${t('tabs.done')} (${done.length})`],
                ['all', t('tabs.all')],
              ].map(([key, label]) =>
                h(
                  'button',
                  {
                    key,
                    type: 'button',
                    role: 'tab',
                    className: 'sdl-tab',
                    'aria-selected': tab === key,
                    onClick: () => setTab(key),
                  },
                  label,
                ),
              ),
              done.length > 0 && tab !== 'todo'
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'sdl-btn sdl-btn-ghost sdl-clear-done',
                      onClick: onClearDone,
                      disabled: busy,
                    },
                    t('toolbar.clearDone'),
                  )
                : null,
            ),

            snapshot.status === 'loading'
              ? h('div', { className: 'sdl-empty' }, h('div', { className: 'sdl-empty-title' }, t('status.loading')))
              : groups.length === 0
                ? h(
                    'div',
                    { className: 'sdl-empty' },
                    h('div', { className: 'sdl-empty-title' }, t(`${emptyKey}.title`)),
                    h('div', null, t(`${emptyKey}.body`)),
                  )
                : groups.map((group) =>
                    h(
                      'section',
                      { key: group.key, className: 'sdl-group', 'aria-label': t(`group.${group.key}`) },
                      h(
                        'h2',
                        { className: 'sdl-group-title' },
                        t(`group.${group.key}`),
                        h('span', { className: 'sdl-group-count' }, String(group.items.length)),
                      ),
                      group.items.map((item) =>
                        h(DdlItem, {
                          key: item.id,
                          item,
                          t,
                          locale,
                          onToggle: () => onToggle(item),
                          onDelete: () => onDelete(item),
                        }),
                      ),
                    ),
                  ),
          ),
        ),
      );
    }

    function DdlItem({ item, t, locale, onToggle, onDelete }) {
      const done = item.status === 'done';
      const diff = dayDiff(item.dueAt);
      const overdue = !done && diff < 0;
      const soon = !done && diff >= 0 && diff <= 1;
      const relative = relativeLabel(t, diff, done);
      return h(
        'article',
        { className: `sdl-item${done ? ' sdl-item-done' : ''}` },
        h(
          'button',
          {
            type: 'button',
            className: 'sdl-check',
            'aria-pressed': done,
            'aria-label': done ? t('item.reopen') : t('item.complete'),
            title: done ? t('item.reopen') : t('item.complete'),
            onClick: onToggle,
          },
          done ? h(CheckIcon) : null,
        ),
        h(
          'div',
          { className: 'sdl-item-main' },
          h('div', { className: 'sdl-item-title' }, item.title),
          h(
            'div',
            { className: 'sdl-item-meta' },
            h(
              'span',
              { className: `sdl-due${overdue ? ' sdl-due-overdue' : soon ? ' sdl-due-soon' : ''}` },
              `${t('item.due')} ${formatDue(item.dueAt, locale)}`,
            ),
            relative
              ? h(
                  'span',
                  { className: `sdl-relative${overdue ? ' sdl-relative-overdue' : ''}` },
                  relative,
                )
              : null,
            h('span', { className: 'sdl-source' }, sourceLabel(item, t)),
          ),
        ),
        h(
          'div',
          { className: 'sdl-item-actions' },
          h(
            'button',
            {
              type: 'button',
              className: 'sdl-icon-btn sdl-icon-btn-danger',
              'aria-label': t('item.delete'),
              title: t('item.delete'),
              onClick: onDelete,
            },
            h(TrashIcon),
          ),
        ),
      );
    }

    // ---------------------------------------------------------------------
    // 右下角提示层
    // ---------------------------------------------------------------------
    function DdlSuggestionOverlay(props) {
      const { t = fallbackT, store, openPanel } = props;
      const snapshot = React.useSyncExternalStore(store.subscribe, store.getSnapshot);
      const [snoozeUntil, setSnoozeUntil] = React.useState(0);
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState(null);

      const suggestions = snapshot.suggestions;
      const visible = suggestions.length > 0 && Date.now() >= snoozeUntil;
      const locale = t('time.locale') || undefined;

      async function acceptAll() {
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
          await store.act({ action: 'accept-all' });
        } catch (cause) {
          setError(String(cause?.message ?? cause));
        } finally {
          setBusy(false);
        }
      }

      async function dismissAll() {
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
          await store.act({ action: 'dismiss-all' });
        } catch (cause) {
          setError(String(cause?.message ?? cause));
        } finally {
          setBusy(false);
        }
      }

      if (!visible) return null;

      return h(
        'div',
        {
          className: 'sdl-overlay',
          role: 'status',
          'aria-live': 'polite',
          'aria-label': fmt(t('suggestion.title'), { n: suggestions.length }),
        },
        h(
          'div',
          { className: 'sdl-overlay-head' },
          h('div', { className: 'sdl-overlay-title' }, fmt(t('suggestion.title'), { n: suggestions.length })),
          h(
            'button',
            {
              type: 'button',
              className: 'sdl-icon-btn',
              'aria-label': t('suggestion.later'),
              title: t('suggestion.later'),
              onClick: () => setSnoozeUntil(Date.now() + 10 * 60_000),
            },
            h(CloseIcon),
          ),
        ),
        h(
          'div',
          { className: 'sdl-overlay-item' },
          h('div', { className: 'sdl-overlay-item-title' }, suggestions[0].title),
          h(
            'div',
            { className: 'sdl-overlay-item-meta' },
            `${formatDue(suggestions[0].dueAt, locale)} · ${suggestions[0].sourceName || basename(suggestions[0].sourcePath)}`,
          ),
        ),
        suggestions.length > 1
          ? h(
              'div',
              { className: 'sdl-overlay-item-meta', style: { marginTop: '8px' } },
              fmt(t('suggestion.more'), { n: suggestions.length - 1 }),
            )
          : null,
        error ? h('div', { className: 'sdl-message sdl-message-error' }, error) : null,
        h(
          'div',
          { className: 'sdl-overlay-foot' },
          h(
            'button',
            {
              type: 'button',
              className: 'sdl-btn',
              onClick: () => {
                setSnoozeUntil(Date.now() + 10 * 60_000);
                openPanel?.();
              },
            },
            t('suggestion.view'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'sdl-btn',
              onClick: dismissAll,
              disabled: busy,
            },
            t('suggestion.dismissAll'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'sdl-btn sdl-btn-primary',
              onClick: acceptAll,
              disabled: busy,
            },
            t('suggestion.acceptAll'),
          ),
        ),
      );
    }

    // ---------------------------------------------------------------------
    // 样式
    // ---------------------------------------------------------------------
    const CSS = `
.sdl-page{height:100%;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);}
.sdl-scroll{flex:1;min-height:0;overflow:auto;}
.sdl-shell{max-width:920px;margin:0 auto;padding:28px 32px 56px;}
.sdl-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;}
.sdl-title{font-size:22px;line-height:1.3;font-weight:600;margin:0;letter-spacing:-.01em;}
.sdl-subtitle{margin:6px 0 0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary);}
.sdl-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;}
.sdl-btn{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:7px 12px;font:inherit;font-size:13px;line-height:1.2;cursor:pointer;display:inline-flex;align-items:center;gap:6px;text-decoration:none;white-space:nowrap;}
.sdl-btn:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);}
.sdl-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;}
.sdl-btn:disabled{opacity:.55;cursor:default;}
.sdl-btn-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff;}
.sdl-btn-primary:hover{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);filter:brightness(1.06);}
.sdl-btn-ghost{background:transparent;border-color:transparent;color:var(--dsw-alias-label-secondary);}
.sdl-btn-ghost:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}
.sdl-stats{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0 14px;}
.sdl-chip{font-size:12px;padding:4px 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);}
.sdl-chip-danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);}
.sdl-card{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:12px;padding:14px;}
.sdl-add{margin-bottom:20px;}
.sdl-add-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:9px;flex-wrap:wrap;}
.sdl-add-title{font-size:13px;font-weight:600;line-height:1.5;}
.sdl-hint{font-size:12px;line-height:1.55;color:var(--dsw-alias-label-secondary);flex:1;min-width:220px;}
.sdl-textarea{width:100%;box-sizing:border-box;min-height:76px;resize:vertical;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:inherit;padding:10px 12px;font:inherit;font-size:13px;line-height:1.55;}
.sdl-textarea:focus{outline:none;border-color:var(--dsw-alias-brand-primary);}
.sdl-textarea::placeholder{color:var(--dsw-alias-label-secondary);opacity:.8;}
.sdl-add-foot{display:flex;align-items:center;gap:12px;margin-top:10px;flex-wrap:wrap;}
.sdl-message{font-size:12px;line-height:1.5;}
.sdl-message-error{color:var(--dsw-alias-state-error-primary);}
.sdl-message-ok{color:var(--dsw-alias-state-success-primary);}
.sdl-message-info{color:var(--dsw-alias-label-secondary);}
.sdl-tabs{display:flex;align-items:center;gap:2px;border-bottom:1px solid var(--dsw-alias-border-l1);margin:0 0 14px;}
.sdl-tab{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);padding:8px 12px;font:inherit;font-size:13px;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;}
.sdl-tab:hover{color:var(--dsw-alias-label-primary);}
.sdl-tab[aria-selected="true"]{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary);}
.sdl-tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px;}
.sdl-clear-done{margin-left:auto;}
.sdl-group{margin:16px 0 0;}
.sdl-group-title{font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary);margin:0 0 8px 2px;display:flex;gap:8px;align-items:center;}
.sdl-group-count{opacity:.7;}
.sdl-item{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:12px;align-items:start;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:10px;padding:12px 14px;margin-bottom:8px;}
.sdl-item:hover{border-color:var(--dsw-alias-border-l2);}
.sdl-item-done .sdl-item-title{text-decoration:line-through;opacity:.55;}
.sdl-check{width:20px;height:20px;margin-top:1px;border-radius:50%;border:1.5px solid var(--dsw-alias-border-l2);background:transparent;cursor:pointer;display:grid;place-items:center;padding:0;color:#fff;flex:none;}
.sdl-check:hover{border-color:var(--dsw-alias-state-success-primary);}
.sdl-check[aria-pressed="true"]{background:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary);}
.sdl-check:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;}
.sdl-item-title{font-size:14px;line-height:1.4;font-weight:500;overflow-wrap:anywhere;}
.sdl-item-meta{display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:5px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);align-items:center;}
.sdl-due{color:var(--dsw-alias-label-secondary);}
.sdl-due-overdue{color:var(--dsw-alias-state-error-primary);}
.sdl-due-soon{color:var(--dsw-alias-state-warn-primary);}
.sdl-relative{padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);}
.sdl-relative-overdue{color:var(--dsw-alias-state-error-primary);background:transparent;border:1px solid var(--dsw-alias-state-error-primary);}
.sdl-source{overflow-wrap:anywhere;}
.sdl-item-actions{display:flex;gap:2px;}
.sdl-icon-btn{appearance:none;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);border-radius:7px;padding:5px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;}
.sdl-icon-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}
.sdl-icon-btn-danger:hover{color:var(--dsw-alias-state-error-primary);}
.sdl-icon-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;}
.sdl-empty{border:1px dashed var(--dsw-alias-border-l2);border-radius:12px;padding:36px 20px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.6;}
.sdl-empty-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:600;margin-bottom:6px;}
.sdl-banner{border:1px solid var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-1);border-radius:12px;padding:12px 14px;margin-bottom:16px;display:flex;gap:12px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;}
.sdl-banner-title{font-size:13px;font-weight:600;}
.sdl-banner-body{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);margin-top:3px;overflow-wrap:anywhere;}
.sdl-banner-actions{display:flex;gap:8px;flex-wrap:wrap;}
.sdl-overlay{position:fixed;right:24px;bottom:24px;width:min(360px,calc(100vw - 32px));z-index:60;pointer-events:auto;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);border-radius:14px;box-shadow:0 12px 36px rgba(0,0,0,.22);padding:14px;}
.sdl-overlay-head{display:flex;gap:8px;align-items:center;justify-content:space-between;}
.sdl-overlay-title{font-size:13px;font-weight:600;}
.sdl-overlay-item{margin-top:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:10px;padding:10px;}
.sdl-overlay-item-title{font-size:13px;font-weight:500;line-height:1.4;overflow-wrap:anywhere;}
.sdl-overlay-item-meta{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);margin-top:4px;overflow-wrap:anywhere;}
.sdl-overlay-foot{display:flex;gap:8px;margin-top:12px;justify-content:flex-end;flex-wrap:wrap;}
@media (max-width:720px){.sdl-shell{padding:18px 16px 40px;}.sdl-header{flex-direction:column;}.sdl-actions{justify-content:flex-start;}.sdl-overlay{right:12px;bottom:12px;}}
`;

    // ---------------------------------------------------------------------
    // 注册
    // ---------------------------------------------------------------------
    const inject = ['slots', 'locale', 'layout'];

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, 'zh', zh), 'save-ddl.dict.zh');
      ctx.effect(() => ctx.locale.register(NS, 'en', en), 'save-ddl.dict.en');
      const t = ctx.locale.bind(NS);

      ctx.effect(() => {
        const tagId = 'save-ddl/styles';
        const existing = document.querySelector(`style[data-plugin-css="${tagId}"]`);
        if (existing) return () => {};
        const style = document.createElement('style');
        style.dataset.plugin = '@local/save-ddl';
        style.dataset.pluginCss = tagId;
        style.textContent = CSS;
        document.head.appendChild(style);
        return () => style.remove();
      }, 'save-ddl.styles');

      const store = createDdlStore();
      ctx.effect(() => {
        store.start();
        return () => store.stop();
      }, 'save-ddl.poll');

      const openPanel = () => {
        try {
          ctx.layout?.selectPanel?.('save-ddl');
        } catch {
          /* ignore */
        }
      };

      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: 'save-ddl',
            locale: NS,
            inject: () => ({ store, openPanel }),
          },
          DdlPage,
        ),
      );

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: 'save-ddl',
            order: 20,
            locale: NS,
            label: () => t('panel.label'),
          },
          DdlIcon,
        ),
      );

      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          {
            name: 'shell.overlay',
            id: 'save-ddl-suggestions',
            order: 60,
            locale: NS,
            inject: () => ({ store, openPanel }),
          },
          DdlSuggestionOverlay,
        ),
      );
    }

    const module = { exports: {} };
    module.exports.apply = apply;
    module.exports.inject = inject;
    return module.exports;
  },
});
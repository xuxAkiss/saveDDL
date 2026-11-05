/**
 * 拯救 DDL · Electron 主进程
 * ==========================
 *
 * - 托盘 + 主窗口
 * - T-24h / T-1h / 到点通知
 * - Ctrl+Alt+D 读取剪贴板
 * - Windows 资源管理器右键「加入 DDL」
 * - 与 DSH / Claude Code / Codex 共用 ddls.json
 */
import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  Notification,
  globalShortcut,
  ipcMain,
  dialog,
  clipboard,
  nativeImage,
  safeStorage,
} from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { watchFile, unwatchFile } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { DdlStore, resolveDataFile } from '../../../packages/store/index.js';
import { extractCandidates, formatDue } from '../../../packages/core/src/ddl.js';
import { buildCalendar } from './lib/ics.js';
import { createBridge } from './lib/bridge.js';
import { ocrDocumentText } from './lib/ocr.js';
import { extractWithAI, testAI } from './lib/ai.js';
import {
  installContextMenu,
  uninstallContextMenu,
  isContextMenuInstalled,
} from './lib/registry.js';
import { Notifier } from './lib/notifier.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const ASSETS = path.join(APP_ROOT, 'assets');
const HOUR = 60 * 60 * 1000;

const iconPng = path.join(ASSETS, 'icon.png');
const iconIco = path.join(ASSETS, process.platform === 'win32' ? 'icon.ico' : 'icon.png');
const trayIcon = path.join(ASSETS, process.platform === 'win32' ? 'tray.ico' : 'tray.png');

const store = new DdlStore(resolveDataFile());
const require = createRequire(import.meta.url);
const AI_FILE = path.join(path.dirname(store.file), 'ai.json');

let extractDocumentText = null;
try {
  ({ extractDocumentText } = require('../dist/extract.cjs'));
} catch (error) {
  console.warn('[save-ddl] document extractor unavailable:', error?.message ?? error);
}

const DEFAULT_AI = {
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  encryptedKey: '',
  plainKey: '',
};
let aiSettings = { ...DEFAULT_AI };

async function loadAISettings() {
  try {
    const raw = JSON.parse(await fs.readFile(AI_FILE, 'utf8'));
    aiSettings = {
      baseUrl: typeof raw.baseUrl === 'string' && raw.baseUrl ? raw.baseUrl : DEFAULT_AI.baseUrl,
      model: typeof raw.model === 'string' && raw.model ? raw.model : DEFAULT_AI.model,
      encryptedKey: typeof raw.encryptedKey === 'string' ? raw.encryptedKey : '',
      plainKey: typeof raw.plainKey === 'string' ? raw.plainKey : '',
    };
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn('[save-ddl] AI settings load failed:', error?.message ?? error);
    }
  }
}

function encryptionAvailable() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function encryptKey(key) {
  if (encryptionAvailable()) {
    return { encryptedKey: safeStorage.encryptString(key).toString('base64'), plainKey: '' };
  }
  return { encryptedKey: '', plainKey: key };
}

function decryptKey() {
  if (aiSettings.encryptedKey) {
    try {
      if (encryptionAvailable()) {
        return safeStorage.decryptString(Buffer.from(aiSettings.encryptedKey, 'base64'));
      }
    } catch {
      /* 换机器 / DPAPI 失效 */
    }
  }
  return aiSettings.plainKey || '';
}

function aiStatus() {
  return {
    baseUrl: aiSettings.baseUrl,
    model: aiSettings.model,
    hasKey: Boolean(decryptKey()),
    encryption: encryptionAvailable(),
  };
}

async function saveAISettings(input = {}) {
  if (typeof input.baseUrl === 'string' && input.baseUrl.trim()) {
    aiSettings.baseUrl = input.baseUrl.trim();
  }
  if (typeof input.model === 'string' && input.model.trim()) {
    aiSettings.model = input.model.trim();
  }
  if (input.clearKey === true) {
    aiSettings.encryptedKey = '';
    aiSettings.plainKey = '';
  }
  if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
    Object.assign(aiSettings, encryptKey(input.apiKey.trim()));
  }

  await fs.mkdir(path.dirname(AI_FILE), { recursive: true });
  await fs.writeFile(
    AI_FILE,
    JSON.stringify(
      {
        baseUrl: aiSettings.baseUrl,
        model: aiSettings.model,
        encryptedKey: aiSettings.encryptedKey,
        plainKey: aiSettings.plainKey,
      },
      null,
      2,
    ),
    { encoding: 'utf8', mode: 0o600 },
  );
  return aiStatus();
}

async function extractCandidatesFromDocument(filePath) {
  if (!extractDocumentText) {
    throw new Error('文档提取模块未构建，请先在 apps/desktop 运行 pnpm build:extract。');
  }
  const extension = path.extname(filePath).toLowerCase();
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.bmp'];
  let text = '';
  let usedOcr = false;

  if (!imageExtensions.includes(extension)) {
    text = await extractDocumentText(filePath);
  }

  if (
    (!text || text.trim().length < 3) &&
    (extension === '.pdf' || imageExtensions.includes(extension)) &&
    process.platform === 'win32'
  ) {
    try {
      text = await ocrDocumentText(filePath);
      usedOcr = Boolean(text.trim());
    } catch (error) {
      console.warn('[save-ddl] OCR failed:', error?.message ?? error);
    }
  }
  if (!text || text.trim().length < 3) {
    throw new Error('没有提取到文字。可能是扫描件 / 图片 PDF，OCR 也没有识别成功。');
  }

  const prefix = usedOcr ? 'OCR · ' : '';
  const key = decryptKey();
  let aiRejected = false;
  if (key) {
    try {
      const documentHint = `${path.basename(filePath)}\n${text.slice(0, 800)}`;
      const candidates = await extractWithAI({
        text,
        baseUrl: aiSettings.baseUrl,
        apiKey: key,
        model: aiSettings.model,
        documentHint,
      });
      const suspicious = candidates.some((candidate) =>
        /(?:叶子节点|TreeNode|children|value|leaf|节点|代码|示例|函数|队列|A\*|alpha[- ]?beta|MAX|MIN)/iu.test(
          candidate.subject ?? '',
        ),
      );
      if (candidates.length > 0 && !suspicious) return { candidates, engine: `${prefix}AI` };
      if (suspicious) {
        aiRejected = true;
        console.warn('[save-ddl] AI subject looks like code, falling back to rules');
      }
      if (candidates.length === 0) {
        return {
          candidates: extractCandidates(text, {
            sourceName: path.basename(filePath),
            max: 8,
          }),
          engine: `${prefix}规则（AI 未发现）`,
        };
      }
    } catch (error) {
      console.warn('[save-ddl] AI extraction failed:', error?.message ?? error);
    }
  }

  return {
    candidates: extractCandidates(text, {
      sourceName: path.basename(filePath),
      max: 8,
    }),
    engine: aiRejected ? `${prefix}规则（AI 结果可疑）` : key ? `${prefix}规则（AI 失败）` : `${prefix}规则`,
  };
}

let mainWindow = null;
let tray = null;
let notifier = null;
let bridge = null;
let isQuitting = false;
let pausedUntil = 0;

app.setAppUserModelId('com.saveddl.desktop');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    showWindow();
    void handleArgs(argv);
  });

  app.whenReady().then(bootstrap).catch((error) => {
    console.error('[save-ddl] bootstrap failed:', error);
    app.quit();
  });

  app.on('activate', () => showWindow());

  app.on('before-quit', () => {
    isQuitting = true;
    notifier?.stop();
    void bridge?.stop();
    unwatchFile(store.file);
    globalShortcut.unregisterAll();
  });

  // 关闭窗口后继续驻留托盘。
  app.on('window-all-closed', () => {});
}

async function bootstrap() {
  registerIpc();
  await loadAISettings();
  createWindow();
  createTray();
  registerShortcut();

  notifier = new Notifier({
    store,
    iconPath: iconPng,
    getPausedUntil: () => pausedUntil,
    onOpen: (id) => {
      showWindow();
      mainWindow?.webContents.send('ddl:focus', id);
    },
  });
  await notifier.start();

  bridge = createBridge({
    store,
    onChanged: refreshRenderer,
    onShow: showWindow,
    version: app.getVersion(),
  });
  try {
    const bridgePort = await bridge.start();
    console.log(`[save-ddl] browser bridge 127.0.0.1:${bridgePort}`);
  } catch (error) {
    console.warn('[save-ddl] browser bridge failed:', error);
    bridge = null;
  }

  // 其他 Agent（DSH / Claude Code / Codex / CLI）写入后，主窗口自动刷新。
  watchFile(store.file, { interval: 1500 }, (current, previous) => {
    if (current.mtimeMs !== previous.mtimeMs) refreshRenderer();
  });

  await handleArgs(process.argv);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 760,
    minWidth: 760,
    minHeight: 540,
    show: false,
    backgroundColor: '#f5f7fb',
    title: '拯救 DDL',
    icon: iconIco,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
}

function showWindow() {
  if (!mainWindow) createWindow();
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function toggleWindow() {
  if (mainWindow?.isVisible()) mainWindow.hide();
  else showWindow();
}

function refreshRenderer() {
  mainWindow?.webContents.send('ddl:changed');
}

function notifyUser(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body, icon: iconPng }).show();
  } else {
    void dialog.showMessageBox({ type: 'info', title, message: body });
  }
}

function createTray() {
  let image = nativeImage.createFromPath(trayIcon);
  if (image.isEmpty()) image = nativeImage.createFromPath(iconPng);
  tray = new Tray(image);
  tray.setToolTip('拯救 DDL');
  tray.on('click', () => toggleWindow());
  rebuildTrayMenu();
}

function rebuildTrayMenu() {
  if (!tray) return;
  const autoStart = app.getLoginItemSettings().openAtLogin;
  const paused = pausedUntil > Date.now();

  const template = [
    { label: '打开清单', click: () => showWindow() },
    { label: '从剪贴板加入', click: () => void quickAddFromClipboard().catch((error) => console.error('[save-ddl] quick add failed:', error)) },
    { label: '导入文档…', click: () => void importDocumentFromDialog() },
    { type: 'separator' },
    {
      label: paused
        ? `恢复提醒（暂停至 ${new Date(pausedUntil).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}）`
        : '暂停提醒 1 小时',
      click: () => {
        pausedUntil = paused ? 0 : Date.now() + HOUR;
        rebuildTrayMenu();
        refreshRenderer();
      },
    },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: autoStart,
      click: (item) => setAutoStart(item.checked),
    },
    { type: 'separator' },
    { label: '安装资源管理器右键菜单', click: () => void installMenu() },
    { label: '移除资源管理器右键菜单', click: () => void uninstallMenu() },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ];

  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function setAutoStart(enabled) {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
    args: app.isPackaged ? [] : [app.getAppPath()],
  });
  rebuildTrayMenu();
  refreshRenderer();
}

function registerShortcut() {
  const accelerator = 'CommandOrControl+Alt+D';
  const ok = globalShortcut.register(accelerator, () => {
    void quickAddFromClipboard().catch((error) => {
      console.error('[save-ddl] quick add failed:', error);
    });
  });
  console.log(`[save-ddl] global shortcut ${accelerator}: ${ok ? 'registered' : 'FAILED'}`);
}

async function installMenu() {
  const result = installContextMenu({
    execPath: process.execPath,
    appPath: app.getAppPath(),
    packaged: app.isPackaged,
    iconPath: iconIco,
  });
  await dialog.showMessageBox({
    type: result.ok ? 'info' : 'error',
    title: '拯救 DDL',
    message: result.ok ? '资源管理器右键菜单已安装' : '安装失败',
    detail: result.ok
      ? '在资源管理器里右键文件或文件夹，即可看到「加入 DDL」。'
      : result.error,
  });
  refreshRenderer();
}

async function uninstallMenu() {
  const result = uninstallContextMenu();
  await dialog.showMessageBox({
    type: result.ok ? 'info' : 'error',
    title: '拯救 DDL',
    message: result.ok ? '资源管理器右键菜单已移除' : '移除失败',
    detail: result.ok ? '' : result.error,
  });
  refreshRenderer();
}

async function quickAddFromClipboard() {
  // Electron 不同版本 / 运行模式下 readText 可能是同步字符串或 Promise，
  // 这里统一 await，避免 .trim is not a function。
  const raw = await clipboard.readText();
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) {
    await dialog.showMessageBox({
      type: 'info',
      title: '剪贴板是空的',
      message: '先复制一段作业通知，再按 Ctrl+Alt+D。',
    });
    return;
  }
  const candidates = extractCandidates(text, { now: new Date(), max: 5 });
  if (candidates.length === 0) {
    await dialog.showMessageBox({
      type: 'info',
      title: '没有识别到 DDL',
      message: '剪贴板里没有找到截止时间。',
      detail: '可以写成「时限：2026-11-10 23:59 科目：高等数学 作业编号：HW3」。',
    });
    return;
  }
  await confirmAndAdd(candidates, {
    label: '剪贴板',
    source: { kind: 'text' },
  });
}

async function confirmAndAdd(candidates, { label, source }) {
  const detail = candidates
    .map((candidate, index) => `${index + 1}. ${formatDue(candidate.dueAt, 'zh')} · ${candidate.title}`)
    .join('\n');
  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['加入', '取消'],
    defaultId: 0,
    cancelId: 1,
    title: '发现 DDL',
    message: `从${label}识别到 ${candidates.length} 条 DDL`,
    detail,
    noLink: true,
  });
  if (response !== 0) return { ok: false, canceled: true };

  let added = 0;
  for (const candidate of candidates) {
    const result = await store.update((state) =>
      store.add(state, {
        subject: candidate.subject,
        assignment: candidate.assignment,
        dueAt: candidate.dueAt,
        title: candidate.title,
        source,
      }),
    );
    if (!result.duplicate) added += 1;
  }
  refreshRenderer();
  notifyUser('已加入 DDL', added > 0 ? `${added} 条已加入清单` : '这些 DDL 已经存在');
  return { ok: true, added };
}

async function addFromFile(filePath) {
  const resolved = path.resolve(filePath);
  const extension = path.extname(resolved).toLowerCase();
  const name = path.basename(resolved);

  if (['.pdf', '.docx', '.doc', '.png', '.jpg', '.jpeg', '.webp', '.bmp'].includes(extension)) {
    let result;
    try {
      result = await extractCandidatesFromDocument(resolved);
    } catch (error) {
      await dialog.showMessageBox({
        type: 'error',
        title: '文档提取失败',
        message: `无法从 ${name} 提取 DDL`,
        detail: String(error?.message ?? error),
      });
      return { ok: false };
    }
    if (result.candidates.length === 0) {
      await dialog.showMessageBox({
        type: 'info',
        title: '没有识别到 DDL',
        message: `没有在 ${name} 里找到截止时间。`,
        detail: `提取方式：${result.engine}`,
      });
      return { ok: false };
    }
    const source = { kind: 'file', path: resolved, name };
    return confirmAndAdd(result.candidates, {
      label: `${name} · ${result.engine}`,
      source,
    });
  }

  if (!['.md', '.markdown', '.txt', '.text', '.rst'].includes(extension)) {
    await dialog.showMessageBox({
      type: 'info',
      title: '暂不支持该格式',
      message: '支持 PDF / DOCX / DOC / 图片（PNG/JPG）/ Markdown / TXT。',
      detail: '图片 / 扫描件 OCR 后续支持；可以先把文字复制到剪贴板按 Ctrl+Alt+D。',
    });
    return { ok: false };
  }

  let text;
  try {
    text = await fs.readFile(resolved, 'utf8');
  } catch (error) {
    await dialog.showMessageBox({
      type: 'error',
      title: '读取失败',
      message: `无法读取 ${resolved}`,
      detail: String(error?.message ?? error),
    });
    return { ok: false };
  }

  const candidates = extractCandidates(text, {
    now: new Date(),
    sourceName: name,
    max: 5,
  });
  if (candidates.length === 0) {
    await dialog.showMessageBox({
      type: 'info',
      title: '没有识别到 DDL',
      message: `没有在 ${name} 里找到截止时间。`,
    });
    return { ok: false };
  }

  return confirmAndAdd(candidates, {
    label: name,
    source: { kind: 'file', path: resolved, name },
  });
}

async function importDocumentFromDialog() {
  const result = await dialog.showOpenDialog({
    title: '导入文档',
    properties: ['openFile'],
    filters: [
      { name: 'DDL 文档', extensions: ['pdf', 'docx', 'doc', 'png', 'jpg', 'jpeg', 'webp', 'bmp', 'md', 'markdown', 'txt', 'rst'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return addFromFile(result.filePaths[0]);
}

async function addFromText(text) {
  const candidates = extractCandidates(text, { now: new Date(), max: 5 });
  if (candidates.length === 0) {
    await dialog.showMessageBox({
      type: 'info',
      title: '没有识别到 DDL',
      message: '这段文字里没有找到截止时间。',
    });
    return { ok: false };
  }
  return confirmAndAdd(candidates, { label: '文本', source: { kind: 'text' } });
}

async function handleArgs(argv) {
  const argValue = (flag) => {
    const withEquals = argv.find((arg) => arg.startsWith(`${flag}=`));
    if (withEquals) return withEquals.slice(flag.length + 1);
    const index = argv.indexOf(flag);
    if (index === -1) return undefined;
    // Electron 可能在 --add-file 与文件路径之间插入 --allow-file-access-from-files
    // 等 Chromium 开关；取最后一个非 flag 参数（文件 / 文本在最后）。
    return argv.slice(index + 1).filter((arg) => !arg.startsWith('--')).at(-1);
  };

  if (argv.includes('--test-notification')) {
    notifyUser('拯救 DDL 测试通知', '通知通道正常，到点会在这里提醒你。');
    return;
  }

  if (argv.some((arg) => arg === '--add-file' || arg.startsWith('--add-file='))) {
    const filePath = argValue('--add-file');
    if (filePath) await addFromFile(filePath);
    return;
  }

  if (argv.some((arg) => arg === '--add-text' || arg.startsWith('--add-text='))) {
    const text = argValue('--add-text');
    if (text) await addFromText(text);
  }
}

function registerIpc() {
  ipcMain.handle('ddl:list', async () => (await store.read()).items);

  ipcMain.handle('ddl:add', async (_event, input) => {
    const result = await store.update((state) => store.add(state, input));
    refreshRenderer();
    return result;
  });

  ipcMain.handle('ddl:add-text', async (_event, text) => {
    const candidates = extractCandidates(String(text ?? ''), { now: new Date(), max: 8 });
    let added = 0;
    for (const candidate of candidates) {
      const result = await store.update((state) =>
        store.add(state, {
          subject: candidate.subject,
          assignment: candidate.assignment,
          dueAt: candidate.dueAt,
          title: candidate.title,
          source: { kind: 'text' },
        }),
      );
      if (!result.duplicate) added += 1;
    }
    refreshRenderer();
    return {
      added,
      candidates,
      message:
        candidates.length === 0
          ? '没有识别到截止时间。可以写成「时限：2026-11-10 23:59 科目：高等数学 作业编号：HW3」。'
          : added > 0
            ? `已加入 ${added} 条 DDL`
            : '识别到的 DDL 已经存在',
    };
  });

  ipcMain.handle('ddl:toggle', async (_event, id) => {
    const item = await store.update((state) => store.toggle(state, id));
    refreshRenderer();
    return item;
  });

  ipcMain.handle('ddl:remove', async (_event, id) => {
    await store.update((state) => store.remove(state, id));
    refreshRenderer();
    return true;
  });

  ipcMain.handle('ddl:export', async () => {
    const state = await store.read();
    const result = await dialog.showSaveDialog({
      title: '导出 DDL 日历',
      defaultPath: 'save-ddl.ics',
      filters: [{ name: 'iCalendar', extensions: ['ics'] }],
    });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, buildCalendar(state.items), 'utf8');
    return result.filePath;
  });

  ipcMain.handle('settings:get', async () => ({
    autoStart: app.getLoginItemSettings().openAtLogin,
    pausedUntil,
    contextMenuInstalled: isContextMenuInstalled(),
    dataFile: store.file,
    version: app.getVersion(),
    ai: aiStatus(),
  }));

  ipcMain.handle('settings:save-ai', async (_event, input) => {
    const status = await saveAISettings(input ?? {});
    refreshRenderer();
    return status;
  });

  ipcMain.handle('settings:test-ai', async (_event, input) => {
    const key = String(input?.apiKey ?? '').trim() || decryptKey();
    if (!key) throw new Error('请先保存 API Key');
    return testAI({
      baseUrl: String(input?.baseUrl ?? '').trim() || aiSettings.baseUrl,
      apiKey: key,
      model: String(input?.model ?? '').trim() || aiSettings.model,
    });
  });

  ipcMain.handle('settings:clear-ai-key', async () => {
    const status = await saveAISettings({ clearKey: true });
    refreshRenderer();
    return status;
  });

  ipcMain.handle('document:pick', () => importDocumentFromDialog());

  ipcMain.handle('document:extract', async (_event, filePath) => {
    const resolved = path.resolve(String(filePath ?? ''));
    const extension = path.extname(resolved).toLowerCase();
    if (!['.pdf', '.docx', '.doc', '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.md', '.markdown', '.txt', '.text', '.rst'].includes(extension)) {
      throw new Error(`不支持的格式：${extension || '无扩展名'}`);
    }
    return extractCandidatesFromDocument(resolved);
  });

  ipcMain.handle('settings:autostart', (_event, enabled) => {
    setAutoStart(Boolean(enabled));
    return app.getLoginItemSettings().openAtLogin;
  });

  ipcMain.handle('settings:context-menu', async (_event, install) => {
    const result = install
      ? installContextMenu({
          execPath: process.execPath,
          appPath: app.getAppPath(),
          packaged: app.isPackaged,
          iconPath: iconIco,
        })
      : uninstallContextMenu();
    refreshRenderer();
    return { ...result, installed: isContextMenuInstalled() };
  });

  ipcMain.handle('app:show', () => showWindow());
  ipcMain.handle('app:data-file', () => store.file);
}
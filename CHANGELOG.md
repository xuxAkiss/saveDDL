<!-- save-ddl: ignore -->
# Changelog

## Unreleased — Claude Code / Codex 兼容

### Added

- 零依赖 MCP server（`packages/mcp-server`）：`ddl_list` / `ddl_add` / `ddl_complete` / `ddl_remove` / `ddl_extract`。
- CLI（`packages/cli`）：`list` / `add` / `add-text` / `done` / `remove` / `extract` / `path`。
- 共享存储（`packages/store`）：文件锁、原子写入、外部写入合并。
- `scripts/setup-agents.mjs`：一键写入 Claude Code 用户级 MCP 配置、Codex `config.toml`（自动备份）。
- `docs/agent-integration.md`：接入、验证、故障排查与多写者行为。
- DSH Host 现在会在读状态 / 改数据前对比 `ddls.json` mtime，自动同步 Claude Code / Codex / CLI 的写入。
- MCP 协议测试（`packages/mcp-server/test/mcp.test.js`）。

### Changed

- `ddls.json` 写入改为「锁文件 + 临时文件 + rename」，并在写回时合并其他进程新加的条目。
- 测试入口统一为 `node --test`（22 个测试）。

## Unreleased — 日期精度与模糊时间

### Added

- `ddl_add` 明确支持只写日期：`2026-11-30` / `11月30日` 自动按当天 23:59。
- 新增 `duePrecision`（`datetime` / `date` / `fuzzy`）与 `dueLabel`。
- 模糊时间示例：`dueAt: "2026-12-15", duePrecision: "fuzzy", dueLabel: "12月中旬"`；清单显示「约 12月中旬」。
- MCP schema 增加日期示例，避免 Agent 误以为必须精确到时分。
- CLI `add` 支持 `--due-label` / `--due-precision`。
- Electron / DSH 清单按精度显示：date 不显示假时分，fuzzy 显示标签。

### Docs

- 说明 Codex / Claude Code 用的是 **MCP server**，不是 `plugins/dsh-save-ddl`；后者只服务 DSH UI。
- 说明模糊时间仍需要一个提醒锚点；完全没有日期时先问用户。

## Unreleased — PDF / Word AI 提取

### Added

- `unpdf` 提取文本型 PDF，`mammoth` 提取 DOCX，`word-extractor` 读取旧版 DOC；esbuild 打包为 `dist/extract.cjs`。
- Windows 自带 OCR：`Windows.Data.Pdf` 渲染扫描件页面 + `Windows.Media.Ocr` 识别，支持扫描件 PDF / PNG / JPG；OCR 结果自动折叠汉字间空格。
- OpenAI 兼容 AI 提取（默认 DeepSeek `deepseek-chat`），严格 JSON 输出。
- AI prompt 带文件名 + 文档开头 hint，明确禁止代码术语当 subject。
- AI 结果校验可疑 subject（叶子节点 / TreeNode / children / value / A* / alpha-beta 等），失败回退规则。
- 设置页 AI Base URL / 模型 / API Key，支持测试连接、清除 Key。
- Key 用 Electron `safeStorage` 加密保存；文档文本发送到配置的 Base URL。
- 主窗口「导入文档」、托盘菜单、资源管理器右键、`--add-file` 四个入口。
- 有 Key 走 AI；AI 失败 / 未配置时回退 core 规则解析。
- `document:extract` IPC 用于自动化验证。

### Fixed

- 核心解析器最后一个 anchor 不再把整篇文档当作字段区，避免后文代码段（如「叶子节点」）污染科目。
- `课程名：实验二` 标题行优先取冒号左侧为 subject，并保留「实验课」不被误削。
- OCR 页眉重复的课程名会折叠（`当代人工智能实验课当代人工智能实验课` → `当代人工智能实验课`）。
- 实验二 PDF 现在解析为「当代人工智能实验课 · 实验 二 · 2026-11-12 23:59」。

### Verified

- 示例 PDF / DOCX / DOC 提取 + 规则解析均得到正确科目 / 作业编号 / 截止时间。
- 扫描件 PDF / 图片经 Windows OCR 得到「当代人工智能实验课 · 实验 二」。
- mock AI server：`saveAI` → `testAI` → `extractFile` 返回 AI 候选；`clearAIKey` 后回退规则。
- `ai.json` 只保存 `encryptedKey`，不落明文。
- AI 客户端单元测试（2 个）+ 长文档回归测试（1 个）+ OCR 归一化测试（1 个）。

## Unreleased — 浏览器扩展（MV3）

### Added

- `apps/extension`：Edge / Chrome MV3 扩展，右键「加入 DDL / 从本页提取 / 链接加入」。
- 桌面端本地桥（`apps/desktop/src/lib/bridge.js`）：`127.0.0.1:17893` 起，`/health`、`/items`、`/add-text`、`/show`。
- 扩展 popup：连接状态、最近待办、手动粘贴、打开桌面端。
- 扩展 options：端口、token、测试连接。
- 桌面端未启动时 `chrome.storage.local` 离线暂存，角标提示，每分钟 / 手动重试。
- 权限最小化：`host_permissions` 仅 `http://127.0.0.1/*`，不申请 `<all_urls>`。

### Verified

- Edge 156 加载 unpacked 扩展 → popup 显示「已连接 · 2 条待办」。
- 通过扩展 `add-text` 写入桌面端，`ddls.json`/CLI 同步出现；`chrome.contextMenus.update` 确认菜单已注册。
- 桌面端停止 → 扩展暂存 1 条；重启后 `retry` 成功补发。

## Unreleased — Electron 桌面端（MVP）

### Added

- `apps/desktop`：托盘、主窗口、系统通知、`Ctrl+Alt+D`、Windows 资源管理器右键、开机自启。
- 托盘菜单：打开清单 / 从剪贴板加入 / 暂停 1 小时 / 开机自启 / 安装移除右键菜单 / 退出。
- 通知规则：T-24h、T-1h、到点；`notified.json` 去重。
- Windows 注册表右键菜单（HKCU，无需管理员）；安装 / 卸载入口在设置页。
- 短路径运行目录同步：`C:\Users\Public\SaveDDL\app`，规避 Electron 长路径崩溃。
- 主窗口监听 `ddls.json` 变化，自动刷新其他 Agent 的写入。
- `.ics` 导出、完成 / 恢复 / 删除、设置面板。
- 桌面端测试：ICS、右键命令构造。

### Changed

- `packages/store` 写入前额外备份 `ddls.json.bak`。

### Known limitations

- 还没有 NSIS 安装包 / 自动更新 / 代码签名。
- 多 Agent 同时写仍以最后一次写入为准（有锁、mtime 合并和备份，但不是分布式事务）。

## 0.1.0 — 2026-11-05

首个可用版本：DeepSeek Harness 插件 MVP。

### Added

- 核心解析器 `@save-ddl/core`：从中文 / 英文文本提取截止时间、科目、作业编号。
- DSH Host 插件：
  - 扫描当前活动工作区与默认工作区的 `.md` / `.txt` 文件。
  - `ddls.json` 持久化，临时文件 + rename 原子写入。
  - 同源 HTTP API：`state` / `action` / `calendar.ics`。
  - Agent 工具 `ddl`：`list` / `add` / `complete` / `remove` / `extract`。
  - 系统提示：引导模型在合适时机写入 / 查询，禁止编造日期。
- DSH Client 插件：
  - 侧栏「查看 DDL」入口与主面板。
  - 待办 / 已完成 / 全部，逾期 / 今天 / 未来 7 天 / 更晚分组。
  - 粘贴解析、完成 / 恢复、删除、重新扫描、导出 `.ics`。
  - 右下角「发现 N 个疑似 DDL」提示，支持全部加入 / 全部忽略 / 查看。
- 中英文界面文案；跟随 DSH 明暗主题。
- 11 个核心解析器单元测试。

### Known limitations

- 不直接解析 PDF / Word / 扫描件。
- 只扫描当前活动会话的工作区，不扫描历史全部工作区。
- 5 秒轮询，不是实时推送。
- 尚无系统托盘、资源管理器右键、全局快捷键、浏览器扩展。
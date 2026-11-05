<!-- save-ddl: ignore -->
# Roadmap

> 原则：先把「今天就能用」的 DSH 插件做扎实，再补系统级入口；每个阶段都可独立发布。

## Phase 0 · DSH 插件 MVP（已完成）

- [x] 纯 JS 核心解析器 + 11 个核心单元测试
- [x] DSH Host：工作区扫描、JSON 持久化、HTTP API、`ddl` 工具、系统提示
- [x] DSH Client：侧栏「查看 DDL」、主面板、右下角建议提示
- [x] 粘贴解析、完成 / 删除、重新扫描、导出 `.ics`
- [x] 在真实 DSH 页面验证：建议提示 → 加入 → 完成 / 恢复 → 删除 → 刷新后仍在

**验收**：装好 bundle 后，侧栏出现「查看 DDL」；`examples/DDL示例.md` 能被发现并加入；`ddls.json` 重启不丢。

---

## Phase 0.5 · Claude Code / Codex 兼容（已完成）

目标：在进入 Electron 之前，先让用户已有的 Agent 也能读写同一份清单。

- [x] 零依赖 MCP stdio server：`ddl_list` / `ddl_add` / `ddl_complete` / `ddl_remove` / `ddl_extract`
- [x] CLI：`list` / `add` / `add-text` / `done` / `remove` / `extract` / `path`
- [x] 共享存储：文件锁 + 临时文件 + rename；外部写入按 mtime 合并
- [x] `scripts/setup-agents.mjs`：Claude Code 用户级 MCP、Codex `config.toml`（自动备份）
- [x] 真实 Claude Code 验证：`claude mcp get save-ddl` → `✓ Connected`
- [x] Codex TOML 通过解析校验（需重启 Codex 生效）
- [x] DSH ↔ CLI / MCP 双向同步验证：外部加入后面板出现，外部删除后面板消失
- [x] MCP 协议测试 + GitHub Actions

**验收**：Claude Code 里说「列出我的 DDL」能调用 `ddl_list`；Codex 重启后能看到同名工具；DSH 面板与 CLI 看到同一份数据。

---

## Phase 1 · 核心硬化（1–2 天）

目标：让解析器和数据格式经得起更多真实通知。

- [ ] 收集 30–50 条脱敏的真实教务通知（文字 + 截图转文字），补进 `packages/core/test/fixtures/`
- [ ] 支持更多写法：
  - [ ] `第 3 周周五 23:59`
  - [ ] `11.10 截止` / `11/10`
  - [ ] `2026-11-10 23:59:59`
  - [ ] `作业三` / `第三次作业`
  - [ ] 学习通 / 雨课堂 / 超星等平台的复制文本
- [ ] 增加「考试 / 实验 / 论文 / 项目」类型字段（可选，先不阻塞 UI）
- [ ] 输出 `confidence` 的可解释原因（命中了哪些字段），方便 UI 展示「为什么认为是 DDL」
- [ ] `ddls.json` schema 校验 + 版本迁移函数
- [x] CI：GitHub Actions 跑 `node --test`

**验收**：固定样本集上召回率 ≥ 90%，误报可解释；所有测试在 Windows / Linux / macOS 通过。

---

## Phase 2 · Electron 托盘 MVP（已完成）

目标：不打开 DSH 也能看到 DDL。

技术：Electron 44.7.0 + ESM JavaScript；electron-builder 打包待做。

- [x] `apps/desktop` 骨架：main / preload / renderer（原生 DOM，无前端构建链）
- [x] 复用 `@save-ddl/core`、`@save-ddl/store` 和 `ddls.json`
- [x] 托盘：
  - [x] 图标 + tooltip「拯救 DDL」
  - [x] 菜单：打开清单 / 从剪贴板加入 / 暂停提醒 1 小时 / 开机自启 / 安装移除右键菜单 / 退出
  - [x] 左键单击切换清单窗口
- [x] 清单窗口：按截止时间排序，逾期红色，今天/本周分组
- [x] 系统通知：
  - [x] T-24h、T-1h、到点三种规则
  - [x] 已完成 / 已删除不提醒
  - [x] `notified.json` 去重，重启不重复
  - [x] 点击通知聚焦对应条目
- [x] 单实例锁；关闭窗口只隐藏到托盘
- [x] 设置：开机自启、右键菜单、数据文件路径
- [x] Windows 短路径运行目录（`C:\Users\Public\SaveDDL\app`），规避 Electron 长路径崩溃
- [ ] 打包 NSIS / 自动更新 / 代码签名
- [ ] 启动时补发最近 24 小时错过的 T-24h 通知（当前每分钟检查，落在时间窗内会触发）

**验收**：开发版可启动 → 托盘出现 → 到点弹通知 → 点击定位 → 退出后重开数据仍在。安装包验收待打包。

**风险**：DSH / 桌面端 / MCP / CLI 同时写 `ddls.json`。当前用文件锁 + 原子写 + mtime 合并 + `.bak` 备份；不是分布式事务，快速并发写仍以最后一次写入为准。

---

## Phase 3 · 右键与快捷键（已完成）

目标：把「随手收集」做到最低摩擦。

### 3.1 资源管理器右键文件

- [x] 安装 / 卸载注册表项（HKCU，无需管理员）：
  - `HKCU\Software\Classes\*\shell\SaveDDL`
  - `HKCU\Software\Classes\Directory\shell\SaveDDL`
  - 菜单文字：「加入 DDL」
- [x] 命令：开发态 `electron.exe <appPath> --add-file "%1"`；打包后 `Save DDL.exe --add-file "%1"`
- [x] 单文件 → 读取文本 → 解析 → 原生确认框 → 加入
- [ ] 多选文件：Electron 单实例 + 队列（先支持单个，多个排队）
- [x] 卸载时清理注册表；设置页提供「安装 / 移除右键菜单」

### 3.2 全局快捷键

- [x] `Ctrl+Alt+D` 读取剪贴板
- [x] 原生确认框：解析结果 + 加入 / 取消
- [x] 不修改剪贴板；不写入日志
- [ ] 与输入法 / 其他软件冲突时提示更换（当前只在主进程日志记录注册失败）

### 3.3 本地 API

- [ ] `127.0.0.1` 随机端口 + token
- [ ] `POST /add-text`、`GET /items`、`GET /health`
- [ ] 供浏览器扩展和未来 DSH 插件复用（DSH 插件目前直接读写 JSON，后续可改为调用桌面端）

**验收**：在资源管理器右键一个 `.md` 文件 → 弹窗显示解析结果 → 加入；在任意应用选中文字按 `Ctrl+Alt+D` → 加入。

---

## Phase 4 · 浏览器扩展（已完成）

目标：覆盖「网页上的通知 / 教务系统 / 微信群网页版」。

- [x] Chrome / Edge MV3（Edge 156 实测）
- [x] `contextMenus`：
  - `selection`：「加入 DDL」
  - `page`：「从本页提取 DDL」
  - `link`：「把链接加入 DDL」
- [x] 解析复用桌面端 `@save-ddl/core`（扩展只发送文本，避免重复逻辑）
- [x] 本地桥：`127.0.0.1:17893` + 固定 token + 17893–17903 端口扫描（6 位配对码留作后续）
- [x] 桌面端未启动时：先存 `chrome.storage.local` 队列，每分钟 / 手动重试
- [x] Popup：最近 5 条 + 手动粘贴 + 打开桌面端
- [x] Options：端口、token、测试连接
- [x] 权限最小化：`contextMenus`、`storage`、`notifications`、`scripting`、`activeTab`、`alarms`；`host_permissions` 仅 `http://127.0.0.1/*`

**验收**：在 Edge 中选中「时限：2026-12-12 09:00 科目：信息安全 作业编号：HW6」→ 右键「加入 DDL」→ 桌面端与 `ddls.json` 出现条目；离线时暂存、桌面端启动后重试成功。

**已知限制**：Chrome 156 命令行 `--load-extension` 可能被策略忽略，开发者模式手动加载可用；解析在桌面端完成。

---

## Phase 5 · AI 提取（已完成，文本型 PDF / DOCX / DOC）

目标：PDF / Word / 扫描件也能进入清单，且用户掌握 Key 与数据去向。

- [x] 设置页：OpenAI 兼容 `baseUrl` / `model` / `apiKey` / 「测试连接」
- [x] Key 用 Electron `safeStorage` 加密；日志脱敏
- [x] 文件分流：
  - [x] `.md` / `.txt`：直接读
  - [x] `.pdf`：`unpdf` 提取文本
  - [x] `.docx`：`mammoth` 提取文本
  - [x] `.doc`：`word-extractor` 纯 JS 读取，不需要 Word / LibreOffice
  - [x] 图片 / 扫描件：Windows 自带 OCR（`Windows.Data.Pdf` + `Windows.Media.Ocr`），不需要外部 OCR / AI 工具；仅 Windows
- [x] Prompt：严格 JSON，要求 `subject` / `assignment` / `dueAt` / `confidence`；禁止编造日期
- [x] Prompt 带文件名 + 文档开头 hint，禁止把代码术语当 subject
- [x] AI 返回后校验可疑 subject，失败回退规则
- [x] 长文档字段窗口限制（避免把后文「叶子节点」当科目）
- [x] 解析失败 → 回退规则结果；网络失败 → 明确提示
- [x] 设置页告知「文档文本会发送到 <baseUrl>」；清除 Key 即关闭 AI
- [x] 入口：主窗口导入 / 托盘 / 右键 / `--add-file`
- [x] esbuild 打包 `dist/extract.cjs`，运行时不需要 `node_modules`
- [ ] 成本控制：只发前 N 千字（当前 14k 字符）；缓存文件 hash → 结果

**验收**：示例 PDF / DOCX / DOC 导入 → 确认框 → 加入；扫描件 PDF / 图片经 Windows OCR 得到「当代人工智能实验课 · 实验 二」；mock AI server 验证 `saveAI → testAI → extractFile` 返回 AI 候选；清除 Key 后回退规则。

**已知限制**：OCR 仅 Windows，需要中文 OCR 语言包；复杂扫描件 / 手写体可能识别失败；AI 需要用户自己的 Key；多页超长文档只发送前 14k 字符。

---

## Phase 6 · 提醒、同步与发布（持续）

- [ ] 免打扰时段（23:00–08:00）
- [ ] 每日摘要「今天有 2 条 DDL，最近一条 18:00」
- [ ] ICS 导入（把学校日历 / 课程表导入）
- [ ] 可选 WebDAV / 坚果云同步 `ddls.json`，带冲突提示
- [ ] 自动更新（electron-updater）
- [ ] 代码签名（可选，减少 SmartScreen 警告）
- [ ] 官网 / README 截图 / 演示 GIF
- [ ] 英文 README

---

## 非目标（暂时）

- 账号体系、云同步服务端：先用本地 + WebDAV。
- 移动端原生 App：先用响应式 Web / PWA 验证需求。
- 自动登录教务系统抓作业：涉及账号与合规风险，暂不做；只做用户主动复制 / 右键。
- 团队协作 / 班级共享：会引入权限与隐私设计，等单机体验稳定后再评估。

---

## 发布节奏建议

| 版本 | 内容 | 渠道 |
| --- | --- | --- |
| `v0.1` | DSH 插件 + 核心解析器 | 本仓库 / DSH 插件市场（如可用） |
| `v0.2` | Electron 托盘 + 通知 | GitHub Releases（NSIS） |
| `v0.3` | 右键 + 全局快捷键 | GitHub Releases |
| `v0.4` | 浏览器扩展 | Chrome Web Store / Edge Add-ons |
| `v0.5` | AI 提取 | GitHub Releases |

每个版本保留 `ddls.json` 向后兼容；破坏性变更提供迁移脚本并在 Release Notes 置顶说明。
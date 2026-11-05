<!-- save-ddl: ignore -->
# 在 Claude Code / Codex 中使用

## 为什么是 MCP

Claude Code、Codex 和 DeepSeek Harness 都支持 **MCP（Model Context Protocol）**。所以不需要为每个 Agent 写一套插件：

```text
Claude Code ─┐
Codex ───────┼── MCP stdio ──► packages/mcp-server ──► packages/store ──► ddls.json
CLI / 脚本 ──┘

DSH 插件 ─────── 直接读写 ddls.json（不走 MCP）
```

- **Codex / Claude Code 不会加载 `plugins/dsh-save-ddl`**；它们只拿到 MCP server 暴露的 5 个工具。DSH 插件是 DSH 侧栏 / 工作区扫描 / 右下角提示那一层，Codex 里没有这些 UI。
- MCP server 是**零依赖**的 Node 脚本，不联网。
- 三个入口共用同一份 `ddls.json`：
  - DSH 插件：`$DSH_HOME/save-ddl/ddls.json`
  - MCP / CLI：默认同一个文件，可用 `SAVE_DDL_DATA` 覆盖。
- DSH 插件在每次读状态 / 改数据前对比文件 mtime，外部 Agent 写入后会自动同步到面板。
- 写入使用**锁文件 + 临时文件 + rename**，避免并发写坏。

## 暴露的工具

| 工具 | 作用 | 关键参数 |
| --- | --- | --- |
| `ddl_list` | 查询清单 | `includeDone?` |
| `ddl_add` | 加入一条 DDL | `subject`, `dueAt`, `assignment?`, `duePrecision?`, `dueLabel?`, `title?`, `notes?` |
| `ddl_complete` | 标记完成 | `id` |
| `ddl_remove` | 删除 | `id` |
| `ddl_extract` | 只解析文本、不落库 | `text` |

工具描述里明确写了：「日期不明确时先问用户，不要编造截止时间。」

### 日期精度与模糊时间

- **只知道哪一天**：`dueAt: "2026-11-30"` 或 `"11月30日"`，自动按当天 **23:59**；`ddl_list` 只显示日期，不显示假时分。
- **明确到时分**：`dueAt: "2026-11-30T18:00:00+08:00"`。
- **24:00**：中文通知里的「11 月 18 日 24:00」按当天 **23:59** 处理，不会记成次日 00:00。
- **模糊时间**：仍给一个提醒锚点，再用 `dueLabel` 展示原文：

  ```json
  {
    "subject": "大学物理",
    "assignment": "实验报告",
    "dueAt": "2026-12-15",
    "duePrecision": "fuzzy",
    "dueLabel": "12月中旬"
  }
  ```

  - 通知 / 排序用 `dueAt` 锚点。
  - 清单显示「约 12月中旬」。
  - **完全没有日期**时不要编造；先问用户，或先加入并在 `notes` 里写「待定」。

Codex / Claude Code 如果看不到 `duePrecision` / `dueLabel`，说明当前 MCP 进程还是旧版本；**重启 Codex / 重连 MCP** 后再试。

### 在 Codex 里怎么说

```text
把线性代数 HW8 加进 DDL，11 月 30 日截止。
```

Codex 应该调用：

```json
{ "subject": "线性代数", "assignment": "HW8", "dueAt": "2026-11-30" }
```

```text
把大学物理实验报告加进 DDL，大概 12 月中旬，按 12 月 15 日提醒。
```

Codex 应该调用：

```json
{
  "subject": "大学物理",
  "assignment": "实验报告",
  "dueAt": "2026-12-15",
  "duePrecision": "fuzzy",
  "dueLabel": "12月中旬"
}
```

不要为了让工具接受而编一个精确时刻；**只写日期也可以**，系统会按当天 23:59 处理。只有日期时，清单也只显示日期，不显示假的 `23:59`。

## 一键配置

```bash
# 只打印配置，不改任何文件
node scripts/setup-agents.mjs --print

# 写入 Claude Code 用户级 MCP 配置
node scripts/setup-agents.mjs --claude

# 追加到 ~/.codex/config.toml（先备份）
node scripts/setup-agents.mjs --codex

# 两边都配
node scripts/setup-agents.mjs --claude --codex
```

脚本会自动使用当前机器的 **绝对路径**（Node 可执行文件、MCP server、数据文件），因此不需要手动改路径。

## Claude Code

脚本执行的是：

```bash
claude mcp add save-ddl --scope user \
  -e SAVE_DDL_DATA=<你的 ddls.json> \
  -- <node.exe> <仓库>/packages/mcp-server/index.js
```

验证：

```bash
claude mcp list
claude mcp get save-ddl
```

期望看到：

```text
save-ddl: ... - ✓ Connected
```

- 用户级配置意味着在**所有项目**里都能用。
- 第一次调用工具时，Claude Code 会按它的权限策略请求批准。
- 删除：

  ```bash
  claude mcp remove save-ddl --scope user
  ```

示例对话：

```text
把我刚才复制的作业通知加入 DDL。
我有哪些 DDL？这周要交什么？
把「大学英语 Essay 2，12 月 1 日 18:00 截止」加入清单。
```

## Codex

`--codex` 会向 `~/.codex/config.toml` 追加（或替换）这一段：

```toml
# >>> save-ddl >>>
[mcp_servers."save-ddl"]
command = "C:\\...\\node.exe"
args = ["C:\\...\\save-ddl\\packages\\mcp-server\\index.js"]
env = { SAVE_DDL_DATA = "C:\\Users\\...\\.dsh\\save-ddl\\ddls.json" }
# <<< save-ddl <<<
```

- 修改前会备份为 `config.toml.bak-save-ddl-<时间戳>`。
- **重启 Codex** 后生效（桌面版和 CLI 都读取这份配置）。
- 如果 Codex 版本使用 `codex mcp add` 子命令，也可以用等价命令；上面的 TOML 是通用写法。

示例对话：

```text
List my DDLs.
Add calculus HW3, due 2026-11-10 23:59.
```

## CLI

不接 MCP 的 Agent（或脚本 / cron）可以直接调用 CLI：

```bash
node packages/cli/index.js list
node packages/cli/index.js list --all --json

node packages/cli/index.js add \
  --subject 高等数学 --assignment HW3 --due "2026-11-10 23:59"

node packages/cli/index.js add-text \
  "时限：2026-11-10 23:59 科目：高等数学 作业编号：HW3"

node packages/cli/index.js done <id>
node packages/cli/index.js remove <id>
node packages/cli/index.js extract "……"
node packages/cli/index.js path
```

`--data <file>` 或 `SAVE_DDL_DATA` 可指定数据文件。

## 多 Agent 同时写

这是本地单用户场景，不做分布式事务；但做了三层保护：

1. **锁文件**：`ddls.json.lock`，`wx` 独占创建，15 秒视为过期。
2. **原子写**：写临时文件后 `rename`。
3. **mtime 同步 + 合并**：
   - DSH 在每次 `/state`、修改、扫描前对比 mtime，外部有更新就重新加载；
   - DSH 写回时会把磁盘上「自己没见过的」条目合并进来（删除的 id 不会被复活）；
   - MCP / CLI 每次操作都在锁内重新读取最新文件。

极端情况下（两个进程在毫秒级同时写、或磁盘被手动编辑）仍可能以最后一次写入为准。若发现数据异常，先停掉所有 Agent，备份 `ddls.json` 再排查。

## 故障排查

| 现象 | 处理 |
| --- | --- |
| `claude mcp list` 显示 Failed | 先手动运行 `node <仓库>\packages\mcp-server\index.js`，看 stderr 是否报错；再检查 Node 绝对路径 |
| Claude Code 看不到工具 | 重启 Claude Code；确认 `claude mcp get save-ddl` 是 Connected |
| Codex 看不到工具 | 重启 Codex；检查 `~/.codex/config.toml` 的 TOML 是否合法 |
| 数据写到了别处 | 运行 `node packages/cli/index.js path`，并检查 `SAVE_DDL_DATA` / `DSH_HOME` |
| DSH 面板不更新 | 确认 Host 插件已启用；它会每 5 秒轮询 `/save-ddl/state` |
| Windows 中文用户名 | 用 `node scripts/setup-agents.mjs` 自动写绝对路径，不要手抄 `where.exe` 的输出（OEM 编码可能乱码） |

## 安全边界

- MCP server 只读写本地文件，不发网络请求。
- `ddl_remove` 会真的删除条目；工具描述要求模型先确认。
- Claude Code / Codex 的 MCP 配置是**用户级**的，注意不要把 `~/.codex/config.toml` 或 `~/.claude.json` 提交到仓库。
- 数据文件包含课程名 / 作业名等个人信息，分享仓库时不要带上 `ddls.json`。
# 贡献指南

## 开发环境

- Node.js ≥ 20
- Windows 10/11（桌面端 OCR / 托盘 / 右键菜单依赖 Windows）
- pnpm 9+（只有重新构建 `apps/desktop/dist/extract.cjs` 时需要）

```bash
git clone <repo>
cd save-ddl

# 全部测试（不需要安装依赖）
node --test

# 桌面端：下载 Electron、启动
node apps/desktop/scripts/fetch-electron.mjs
node apps/desktop/scripts/start.mjs
```

DSH 插件是本地目录 bundle，安装方式见 [README](README.md#安装dsh-插件)。

## 目录

| 目录 | 说明 |
| --- | --- |
| `packages/core` | 纯 JS 解析器；修改后运行 `node scripts/sync-core.mjs` |
| `packages/store` | 文件锁 + 原子写 + 备份 |
| `apps/desktop` | Electron 主进程 / 渲染进程 / 文档提取 / OCR |
| `apps/extension` | Edge / Chrome MV3 扩展 |
| `plugins/dsh-save-ddl` | DSH Host + Client bundle |

## 提交前

```bash
node --test
node --check apps/desktop/src/main.js
node --check plugins/dsh-save-ddl/client.js
```

- 解析规则改动必须带测试，固定 `now`，避免相对日期漂移。
- 改 `packages/core/src/ddl.js` 后运行 `node scripts/sync-core.mjs`，再同步 DSH 插件。
- 改 `apps/desktop/src/lib/extract.js` 后重新构建：

  ```bash
  cd apps/desktop
  pnpm build:extract
  ```

- 不要提交 `node_modules`、`apps/desktop/vendor`、`ddls.json`、`ai.json`、日志或 API Key。
- 截图 / 示例文档请脱敏，不要包含真实姓名、学号、课程群链接。

## Pull Request

- 一个 PR 解决一个问题，说明动机、行为和验证方式。
- UI 改动请附截图（明暗主题各一张更好）。
- 解析规则请附输入文本和期望输出。
- 欢迎 Issue 提供脱敏后的真实通知样本。

## 行为准则

保持友善、就事论事。不要提交他人的隐私数据或未授权的文档内容。
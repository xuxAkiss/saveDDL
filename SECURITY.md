# 安全说明

## 数据边界

- 所有 DDL 数据保存在本机 `~/.dsh/save-ddl/ddls.json`。
- DSH 插件、MCP server、CLI、桌面端共享这一份文件；没有云端服务端。
- 浏览器扩展通过 `127.0.0.1:17893` 的本地桥写入，只允许 `chrome-extension://` / 本地 Origin。
- AI API Key 用 Electron `safeStorage` 加密保存在 `~/.dsh/save-ddl/ai.json`；只有配置了 AI 时，文档文本才会发送到用户填写的 Base URL。

## 本地桥 token

默认 token `save-ddl-local-v1` 是**本地约定值，不是机密**。它用于避免普通网页误写，真正的边界是只监听 `127.0.0.1` + Origin 校验。不要把该端口暴露到公网。

## 报告漏洞

请使用 GitHub 的 **Security → Report a vulnerability**（私有安全公告），不要在公开 Issue 里贴可利用细节、API Key 或真实文档。

## 不要提交

- `ddls.json` / `ai.json` / `notified.json`
- `.env`、API Key、账号 Cookie
- 真实作业通知中的姓名、学号、群链接
- `apps/desktop/vendor`（体积大，按需下载）
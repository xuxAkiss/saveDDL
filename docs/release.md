# 发布清单

本项目当前以**源码 + 本地脚本**发布，不打 exe。GitHub Release 提供源码 zip；桌面端首次运行用 `fetch-electron.mjs` 下载 Electron 运行时。

## 1. 版本与文档

- [ ] 更新根 `package.json`、`apps/desktop/package.json`、`plugins/dsh-save-ddl/package.json` 的版本号
- [ ] 更新 `CHANGELOG.md`
- [ ] 更新截图（`docs/*.png`），确认没有个人信息
- [ ] 检查 README 里的安装命令、路径、测试数量

## 2. 本地验证

```bash
node --test
node scripts/sync-core.mjs
node --check apps/desktop/src/main.js
node --check apps/desktop/src/lib/ocr.js
node --check plugins/dsh-save-ddl/client.js
```

桌面端：

```bash
node apps/desktop/scripts/fetch-electron.mjs
node apps/desktop/scripts/start.mjs
```

- [ ] 托盘 / 通知 / `Ctrl+Alt+D` / 右键菜单
- [ ] PDF / DOCX / DOC / 扫描件 / 图片导入
- [ ] 浏览器扩展 popup 显示「已连接」
- [ ] 无 Key 时回退规则；配置 mock/真实 Key 时走 AI

## 3. 清理

- [ ] `git status` 干净
- [ ] 没有 `node_modules`、`vendor`、`ddls.json`、`ai.json`、日志、API Key
- [ ] `git grep -n "sk-"` 无结果
- [ ] 截图中无个人路径 / 学号 / 群名

## 4. 打标签并推送

```bash
git add .
git commit -m "chore: release v0.1.0"
git tag -a v0.1.0 -m "Save DDL v0.1.0"
git remote add origin https://github.com/<you>/save-ddl.git
git push -u origin main --tags
```

然后在 GitHub 创建 Release，选择 `v0.1.0`，正文可复用 `CHANGELOG.md` 的内容。

## 5. 可选：以后打 exe

如果以后要提供安装包：

- `electron-builder` + NSIS
- 安装到 ASCII 短路径（如 `C:\Program Files\SaveDDL`），避免 Electron 长路径崩溃
- 图标用 `apps/desktop/assets/icon.ico`
- 配置 `appId: com.saveddl.desktop`
- 代码签名可选，先内部测试

当前阶段不做，保持源码发布即可。
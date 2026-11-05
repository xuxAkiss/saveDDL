/**
 * 桌面通知：T-24h、T-1h、到点提醒。
 *
 * 通知去重键持久化在数据目录的 notified.json，避免每次启动重复弹。
 */
import { Notification } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

import { formatDue } from '../../../../packages/core/src/ddl.js';

const HOUR = 60 * 60 * 1000;

export class Notifier {
  constructor({ store, iconPath, getPausedUntil, onOpen }) {
    this.store = store;
    this.iconPath = iconPath;
    this.getPausedUntil = getPausedUntil ?? (() => 0);
    this.onOpen = onOpen ?? (() => {});
    this.timer = null;
    this.checking = false;
    this.notified = new Set();
    this.file = path.join(path.dirname(store.file), 'notified.json');
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(raw)) this.notified = new Set(raw.filter((value) => typeof value === 'string'));
    } catch {
      /* 首次运行没有文件 */
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify([...this.notified].slice(-2000), null, 2), 'utf8');
    } catch (error) {
      console.warn('[save-ddl] failed to persist notified state:', error);
    }
  }

  async start() {
    this.load();
    await this.check();
    this.timer = setInterval(() => void this.check(), 60_000);
  }

  stop() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  async check() {
    if (this.checking) return;
    if (Date.now() < this.getPausedUntil()) return;
    if (!Notification.isSupported()) return;
    this.checking = true;
    try {
      const state = await this.store.read();
      const now = Date.now();
      for (const item of state.items) {
        if (item.status === 'done') continue;
        const due = Date.parse(item.dueAt);
        if (!Number.isFinite(due)) continue;

        const remaining = due - now;
        const rules = [];
        if (remaining > 12 * HOUR && remaining <= 24 * HOUR) {
          rules.push({ key: '24h', text: '还有约 24 小时' });
        }
        if (remaining > 0 && remaining <= HOUR) {
          rules.push({ key: '1h', text: remaining > 30 * 60_000 ? '还有约 1 小时' : '还有不到 30 分钟' });
        }
        if (remaining <= 0 && remaining >= -HOUR) {
          rules.push({ key: 'due', text: '已到截止时间' });
        }

        for (const rule of rules) {
          const key = `${item.id}:${item.dueAt}:${rule.key}`;
          if (this.notified.has(key)) continue;
          this.notified.add(key);
          this.save();
          const notification = new Notification({
            title: item.title,
            body: `${rule.text} · 截止 ${formatDue(item.dueAt, 'zh')}`,
            icon: this.iconPath,
            silent: false,
          });
          notification.on('click', () => this.onOpen(item.id));
          notification.show();
        }
      }
    } catch (error) {
      console.warn('[save-ddl] notification check failed:', error);
    } finally {
      this.checking = false;
    }
  }
}
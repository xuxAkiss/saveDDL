import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { DdlStore, coerceDue, inferDuePrecision } from '../index.js';

test('date-only and fuzzy deadlines are stored without losing precision', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'save-ddl-store-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const date = coerceDue('2026-11-10');
  assert.ok(date);
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 10);
  assert.equal(date.getDate(), 10);
  assert.equal(date.getHours(), 23);
  assert.equal(date.getMinutes(), 59);

  const midnight = coerceDue('2026-11-18 24:00');
  assert.ok(midnight);
  assert.equal(midnight.getFullYear(), 2026);
  assert.equal(midnight.getMonth(), 10);
  assert.equal(midnight.getDate(), 18);
  assert.equal(midnight.getHours(), 23);
  assert.equal(midnight.getMinutes(), 59);

  assert.equal(inferDuePrecision('2026-11-10'), 'date');
  assert.equal(inferDuePrecision('11月10日'), 'date');
  assert.equal(inferDuePrecision('2026-11-10 23:59'), 'datetime');
  assert.equal(inferDuePrecision('2026-11-10', '11月中旬'), 'fuzzy');
  assert.equal(inferDuePrecision('2026-11-10', '', 'fuzzy'), 'fuzzy');

  const store = new DdlStore(path.join(directory, 'ddls.json'));
  await store.update((state) => {
    store.add(state, { subject: '线性代数', assignment: 'HW8', dueAt: '2026-11-30' });
    store.add(state, {
      subject: '大学物理',
      assignment: '实验报告',
      dueAt: '2026-12-15',
      dueLabel: '12月中旬',
    });
  });

  const items = (await store.read()).items;
  assert.equal(items.length, 2);
  assert.equal(items[0].duePrecision, 'date');
  assert.equal(items[0].dueLabel, '');
  assert.equal(items[1].duePrecision, 'fuzzy');
  assert.equal(items[1].dueLabel, '12月中旬');
});
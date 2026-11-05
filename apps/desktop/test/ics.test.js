import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCalendar, toIcsDate } from '../src/lib/ics.js';

test('buildCalendar exports open items only', () => {
  const text = buildCalendar([
    {
      id: 'a',
      title: '高等数学 · HW3',
      dueAt: '2026-11-10T15:59:00.000Z',
      status: 'todo',
      subject: '高等数学',
    },
    {
      id: 'b',
      title: '已完成',
      dueAt: '2026-11-12T10:00:00.000Z',
      status: 'done',
    },
  ]);
  assert.match(text, /BEGIN:VCALENDAR/u);
  assert.match(text, /SUMMARY:高等数学 · HW3/u);
  assert.match(text, /DTSTART:20261110T155900Z/u);
  assert.doesNotMatch(text, /SUMMARY:已完成/u);
  assert.match(text, /END:VCALENDAR/u);
});

test('toIcsDate uses UTC basic format', () => {
  assert.equal(toIcsDate('2026-11-10T15:59:00.000Z'), '20261110T155900Z');
});
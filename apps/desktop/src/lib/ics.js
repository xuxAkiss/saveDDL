/**
 * 生成 iCalendar（.ics）文本。
 * @param {Array<{id:string,title:string,dueAt:string,status:string,notes?:string,subject?:string}>} items
 * @returns {string}
 */
export function toIcsDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');
}

function escape(value) {
  return String(value ?? '')
    .replace(/\\/gu, '\\\\')
    .replace(/\n/gu, '\\n')
    .replace(/,/gu, '\\,')
    .replace(/;/gu, '\\;');
}

export function buildCalendar(items) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Save DDL//Save DDL//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  const stamp = toIcsDate(new Date());
  for (const item of items) {
    if (item.status === 'done') continue;
    const due = Date.parse(item.dueAt);
    if (!Number.isFinite(due)) continue;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${item.id}@save-ddl`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${toIcsDate(item.dueAt)}`,
      `DTEND:${toIcsDate(new Date(due + 30 * 60_000))}`,
      `SUMMARY:${escape(item.title)}`,
      `DESCRIPTION:${escape(item.notes || item.subject || '')}`,
      `CATEGORIES:${escape(item.subject || 'DDL')}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
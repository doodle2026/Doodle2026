// Run in a child process with a given TZ (tests/dates.test.ts): prints how dates render.
import * as d from '../../src/lib/dates';
import { optionLabel } from '../../src/lib/format';
import { buildIcs } from '../../src/lib/ics';
import { dateLabels } from '../../src/lib/email/render';
console.log(JSON.stringify([d.formatDateShort('2026-10-16'), d.formatDateLong('2026-01-01'), d.columnHead('2026-03-29'), d.addDays('2026-03-29', 1),
  d.weekdayMon('2026-10-16'), optionLabel({ date: '2026-10-16', start_at: null, end_at: null }),
  buildIcs({ uid: 'u', stamp: new Date(0), date: '2026-10-16', summary: 's' }).match(/DTSTART.*\r\nDTEND.*/)![0],
  dateLabels([{ date: '2026-10-16' }, { date: '2026-01-01' }]), Intl.DateTimeFormat().resolvedOptions().timeZone]));

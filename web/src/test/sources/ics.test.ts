import { describe, expect, it } from 'vitest';
import { normalizeCalendarUrl, parseIcs } from '../../core/sources/ics';

const wrap = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`;
const from = new Date('2026-11-23T00:00:00Z');
const to = new Date('2026-12-07T00:00:00Z');

describe('parseIcs', () => {
  it('reads UTC, TZID and folded/escaped text', () => {
    const ics = wrap(
      [
        'BEGIN:VEVENT', 'UID:a', 'DTSTART:20261124T170000Z', 'DTEND:20261124T180000Z', 'SUMMARY:Coffee with Sam\\, downtown', 'LOCATION:Victrola Coffee\\, ', ' Seattle', 'END:VEVENT',
        'BEGIN:VEVENT', 'UID:b', 'DTSTART;TZID=America/New_York:20261125T090000', 'DTEND;TZID=America/New_York:20261125T100000', 'SUMMARY:Standup', 'END:VEVENT',
        'BEGIN:VEVENT', 'UID:c', 'DTSTART;TZID=Pacific Standard Time:20261126T120000', 'DURATION:PT1H30M', 'SUMMARY:Outlook lunch', 'END:VEVENT',
      ].join('\r\n'),
    );
    const ev = parseIcs(ics, from, to);
    expect(ev.map((e) => e.summary)).toEqual(['Coffee with Sam, downtown', 'Standup', 'Outlook lunch']);
    expect(ev[0].location).toBe('Victrola Coffee, Seattle');
    expect(ev[1].start).toBe('2026-11-25T14:00:00.000Z'); // EST = UTC-5
    expect(ev[2].start).toBe('2026-11-26T20:00:00.000Z'); // PST = UTC-8
    expect(ev[2].end).toBe('2026-11-26T21:30:00.000Z');
  });

  it('handles all-day events and DST-correct zones', () => {
    const ics = wrap(['BEGIN:VEVENT', 'UID:d', 'DTSTART;VALUE=DATE:20261127', 'DTEND;VALUE=DATE:20261129', 'SUMMARY:Trip to Portland', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:s', 'DTSTART;TZID=Europe/Berlin:20260701T100000', 'DTEND;TZID=Europe/Berlin:20260701T110000', 'SUMMARY:Summer', 'END:VEVENT'].join('\r\n'));
    const ev = parseIcs(ics, from, to);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ allDay: true, start: '2026-11-27', end: '2026-11-29' });
    const summer = parseIcs(ics, new Date('2026-06-30'), new Date('2026-07-02'));
    expect(summer[0].start).toBe('2026-07-01T08:00:00.000Z'); // CEST = UTC+2
  });

  it('expands weekly RRULE with BYDAY, COUNT and EXDATE, and applies overrides', () => {
    const ics = wrap(
      [
        'BEGIN:VEVENT', 'UID:yoga', 'DTSTART:20261102T180000Z', 'DTEND:20261102T190000Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10', 'EXDATE:20261125T180000Z', 'SUMMARY:Yoga', 'END:VEVENT',
        'BEGIN:VEVENT', 'UID:yoga', 'RECURRENCE-ID:20261130T180000Z', 'DTSTART:20261130T200000Z', 'DTEND:20261130T210000Z', 'SUMMARY:Yoga (moved)', 'END:VEVENT',
      ].join('\r\n'),
    );
    const ev = parseIcs(ics, from, to);
    // Occurrences: Nov 2,4,9,11,16,18,23,25(ex),30(moved),Dec 2 → in window: 23, 30 moved, Dec 2
    expect(ev.map((e) => `${e.summary}@${e.start.slice(5, 16)}`)).toEqual(['Yoga@11-23T18:00', 'Yoga (moved)@11-30T20:00', 'Yoga@12-02T18:00']);
    expect(ev.every((e) => e.recurring)).toBe(true);
  });

  it('expands monthly BYDAY with negative ordinal and UNTIL', () => {
    const ics = wrap(['BEGIN:VEVENT', 'UID:m', 'DTSTART;VALUE=DATE:20260130', 'RRULE:FREQ=MONTHLY;BYDAY=-1FR;UNTIL=20270101', 'SUMMARY:Last Friday review', 'END:VEVENT'].join('\r\n'));
    const ev = parseIcs(ics, new Date('2026-11-01'), new Date('2027-03-01'));
    expect(ev.map((e) => e.start)).toEqual(['2026-11-27', '2026-12-25']);
  });

  it('expands daily with interval and skips cancelled events', () => {
    const ics = wrap(['BEGIN:VEVENT', 'UID:x', 'DTSTART:20261123T070000Z', 'DURATION:PT20M', 'RRULE:FREQ=DAILY;INTERVAL=3', 'SUMMARY:Run', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:y', 'DTSTART:20261124T070000Z', 'STATUS:CANCELLED', 'SUMMARY:Gone', 'END:VEVENT'].join('\r\n'));
    const ev = parseIcs(ics, from, to);
    expect(ev.map((e) => e.start.slice(8, 10))).toEqual(['23', '26', '29', '02', '05']);
  });

  it('ignores VALARM content and normalizes webcal URLs', () => {
    const ics = wrap(['BEGIN:VEVENT', 'UID:z', 'DTSTART:20261124T170000Z', 'SUMMARY:Real', 'BEGIN:VALARM', 'SUMMARY:Alarm text', 'END:VALARM', 'END:VEVENT'].join('\r\n'));
    expect(parseIcs(ics, from, to)[0].summary).toBe('Real');
    expect(normalizeCalendarUrl('webcal://p01-caldav.icloud.com/published/2/abc')).toBe('https://p01-caldav.icloud.com/published/2/abc');
  });
});

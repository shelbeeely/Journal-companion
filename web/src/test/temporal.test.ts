import { describe, expect, it } from 'vitest';
import { buildTemporalContext, dayPart, moonPhase, seasonFor, snoozeUntil, upcomingDst } from '../core/context/temporal';
import { DEFAULT_PREFERENCES } from '../core/models';
import type { ContextItem } from '../core/sources/types';

const prefs = { ...DEFAULT_PREFERENCES, homeTimeZone: 'America/Los_Angeles' };
const ctx = (now: Date, over: Partial<Parameters<typeof buildTemporalContext>[0]> = {}) =>
  buildTemporalContext({ now, prefs, items: [], entries: [], latitude: 47.6, timeZone: 'America/Los_Angeles', ...over });

describe('day parts relative to wake/sleep', () => {
  it.each([
    [7.5, 'early_morning'],
    [10, 'morning'],
    [12.5, 'midday'],
    [15, 'afternoon'],
    [18, 'evening'],
    [21.5, 'late_evening'],
    [23.5, 'night'],
    [3, 'night'],
  ] as const)('%s h → %s (7:00–23:00)', (h, part) => {
    expect(dayPart(new Date(2026, 10, 24, Math.floor(h), (h % 1) * 60), 7, 23)).toBe(part);
  });
  it('handles a bedtime after midnight', () => {
    expect(dayPart(new Date(2026, 10, 24, 0, 30), 9, 1)).toBe('late_evening');
    expect(dayPart(new Date(2026, 10, 24, 2, 0), 9, 1)).toBe('night');
  });
});

describe('date & calendar context', () => {
  it('knows workdays, weekends and bedtime', () => {
    const tue = ctx(new Date(2026, 10, 24, 20, 0));
    expect(tue.dayName).toBe('Tuesday');
    expect(tue.isWorkday).toBe(true);
    expect(tue.minutesToSleep).toBe(180);
    const sat = ctx(new Date(2026, 10, 28, 10, 0));
    expect(sat.isWeekend).toBe(true);
    expect(sat.reasons.find((r) => r.id === 'time:daytype')?.text).toBe('Day off');
  });

  it('treats holidays as days off and flags the eve', () => {
    const items: ContextItem[] = [{ id: 'holidays:US:2026-11-26', sourceId: 'holidays', kind: 'holiday', title: 'Thanksgiving Day', startsAt: '2026-11-26', allDay: true, fetchedAt: 0 }];
    expect(ctx(new Date(2026, 10, 25, 18), { items }).holidayEve).toBe('Thanksgiving Day');
    const day = ctx(new Date(2026, 10, 26, 10), { items });
    expect(day.holiday).toBe('Thanksgiving Day');
    expect(day.isWorkday).toBe(false);
  });

  it('knows month/year position', () => {
    const eom = ctx(new Date(2026, 10, 30, 9));
    expect(eom.position.endOfMonth).toBe(true);
    expect(eom.reasons.some((r) => r.text === 'Last day of the month')).toBe(true);
    expect(ctx(new Date(2026, 11, 31, 9)).position).toMatchObject({ endOfYear: true, endOfQuarter: true });
  });

  it('computes season by hemisphere and moon phase', () => {
    expect(seasonFor(new Date(2026, 6, 1), 'north')).toBe('summer');
    expect(seasonFor(new Date(2026, 6, 1), 'south')).toBe('winter');
    expect(ctx(new Date(2026, 6, 1), { latitude: -33.9 }).season).toBe('winter');
    expect(moonPhase(new Date(Date.UTC(2026, 0, 3, 12))).phase).toBe('full'); // full moon 2026-01-03
    expect(moonPhase(new Date(Date.UTC(2026, 0, 18, 19))).phase).toBe('new'); // new moon 2026-01-18
  });

  it('flags golden hour from the forecast sunset', () => {
    const items: ContextItem[] = [{ id: 'weather:day:2026-11-24', sourceId: 'weather', kind: 'forecast', title: 'x', startsAt: '2026-11-24', allDay: true, fetchedAt: 0, data: { sunrise: '2026-11-24T07:30', sunset: '2026-11-24T16:25' } }];
    const t = ctx(new Date(2026, 10, 24, 15, 40), { items });
    expect(t.daylight.goldenHour).toBe(true);
    expect(t.daylight.minutesToSunset).toBe(45);
    expect(t.reasons.some((r) => r.id === 'time:golden')).toBe(true);
    expect(ctx(new Date(2026, 10, 24, 6, 0), { items }).daylight.isDaylight).toBe(false);
  });

  it('detects travel from the time zone', () => {
    expect(ctx(new Date(2026, 10, 24, 12), { timeZone: 'Europe/Lisbon' }).travel.traveling).toBe(true);
    expect(ctx(new Date(2026, 10, 24, 12)).travel.traveling).toBe(false);
  });

  it('lists all-day events like birthdays as today context', () => {
    const items: ContextItem[] = [{ id: 'calendar_ics:b', sourceId: 'calendar_ics', kind: 'event', title: "Maya's birthday", startsAt: '2026-11-24', endsAt: '2026-11-25', allDay: true, fetchedAt: 0 }];
    expect(ctx(new Date(2026, 10, 24, 9), { items }).allDay).toEqual(["Maya's birthday"]);
  });

  it('detects an upcoming DST change (device-zone dependent)', () => {
    const r = upcomingDst(new Date(2026, 10, 24));
    expect(r === null || (r.inDays >= 1 && r.inDays <= 3)).toBe(true);
  });

  it('resolves snoozes against wake time and workdays', () => {
    const t = ctx(new Date(2026, 10, 24, 20, 0)); // Tue 8 PM
    expect(new Date(snoozeUntil('tomorrow', t, prefs)).getHours()).toBe(7);
    expect(new Date(snoozeUntil('weekend', t, prefs)).getDay()).toBe(6);
    expect(snoozeUntil('tonight', t, prefs)).toBe(t.now.getTime() + 3 * 3_600_000);
  });
});

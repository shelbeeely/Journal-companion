import type { FeedbackEvent } from '../db';
import type { TaskKind } from '../taskContext';
import type { Suggestion } from './moments';

/**
 * Orders suggestions by timeliness × priority × learned feedback, applies snoozes, dismissals and
 * a daily cap, and keeps things quiet while the user is writing.
 */

export interface RankOptions {
  now: number;
  feedback: FeedbackEvent[];
  task: TaskKind;
  density: 'RICH' | 'CALM';
  dailyLimit: number;
  /** Keys already shown today (so the cap doesn't hide what's already on screen). */
  shownToday: Set<string>;
}

export interface Ranked {
  visible: Suggestion[];
  hidden: { key: string; reason: 'snoozed' | 'dismissed' | 'cap' | 'quiet' }[];
  quiet: boolean;
}

export function timeliness(s: Suggestion, now: number): number {
  if (!s.window) return 1;
  if (now > s.window.to) return 0; // window passed
  const left = (s.window.to - now) / 60_000;
  if (left <= 30) return 1.35;
  if (left <= 120) return 1.2;
  return 1;
}

export function feedbackFactor(s: Suggestion, fb: FeedbackEvent[], now: number): number {
  const week = now - 7 * 86_400_000;
  const dismissals = fb.filter((f) => f.moment === s.moment && f.action === 'dismissed' && f.at >= week).length;
  const acted = fb.filter((f) => f.moment === s.moment && (f.action === 'acted' || f.action === 'saved') && f.at >= week).length;
  return Math.max(0.2, 0.6 ** dismissals) * Math.min(1.3, 1 + acted * 0.1);
}

export function rankSuggestions(all: Suggestion[], o: RankOptions): Ranked {
  const hidden: Ranked['hidden'] = [];
  const candidates: { s: Suggestion; score: number }[] = [];
  for (const s of all) {
    const snoozed = o.feedback.some((f) => f.key === s.key && f.action === 'snoozed' && (f.until ?? 0) > o.now);
    if (snoozed) {
      hidden.push({ key: s.key, reason: 'snoozed' });
      continue;
    }
    const dismissed = o.feedback.some((f) => f.key === s.key && f.action === 'dismissed' && f.at > o.now - 7 * 86_400_000);
    if (dismissed) {
      hidden.push({ key: s.key, reason: 'dismissed' });
      continue;
    }
    const score = s.priority * timeliness(s, o.now) * feedbackFactor(s, o.feedback, o.now);
    if (score <= 0) continue;
    candidates.push({ s, score });
  }
  candidates.sort((a, b) => b.score - a.score);

  // Daily cap: new cards stop appearing once the limit is reached; already-shown ones stay.
  const capped: { s: Suggestion; score: number }[] = [];
  let newSlots = Math.max(0, o.dailyLimit - o.shownToday.size);
  for (const c of candidates) {
    if (o.shownToday.has(c.s.key)) capped.push(c);
    else if (newSlots > 0) {
      capped.push(c);
      newSlots--;
    } else hidden.push({ key: c.s.key, reason: 'cap' });
  }

  // Unobtrusive while writing: only something genuinely time-critical breaks through.
  const quiet = o.task === 'writing';
  let visible = capped.map((c) => c.s);
  if (quiet) {
    const urgent = capped.filter((c) => c.score >= 100).map((c) => c.s);
    visible.filter((v) => !urgent.includes(v)).forEach((v) => hidden.push({ key: v.key, reason: 'quiet' }));
    visible = urgent.slice(0, 1);
  }
  const max = o.density === 'CALM' ? 2 : 6;
  return { visible: visible.slice(0, max), hidden, quiet };
}

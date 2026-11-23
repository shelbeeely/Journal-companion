import type { DeskCues } from './ai/orchestrator';
import {
  CADENCE_LABELS,
  estimatedWordsPerPage,
  isWeatherStale,
  type DeskContextSnapshot,
  type JournalEntry,
  type JournalProject,
  type PromptHistoryItem,
  type WeatherSnapshot,
} from './models';
import { cToDisplay, daysBetween, formatDayLong, formatMonthDay, formatTime, isoWeek, parseLocalDate, parseLocalDateTime } from './time';

export function dayPartFor(hour: number): string {
  if (hour >= 5 && hour <= 11) return 'Morning';
  if (hour >= 12 && hour <= 16) return 'Afternoon';
  if (hour >= 17 && hour <= 20) return 'Evening';
  return 'Night';
}

function writingWindowFor(hour: number): string {
  if (hour >= 5 && hour <= 9) return 'Morning clarity window';
  if (hour >= 10 && hour <= 11) return 'Mid-morning desk session';
  if (hour >= 12 && hour <= 16) return 'Midday pause';
  if (hour >= 17 && hour <= 20) return 'Evening wind-down';
  if (hour >= 21 && hour <= 23) return 'Quiet night desk';
  return 'Late stillness';
}

export function buildDeskSnapshot(args: {
  project: JournalProject;
  todayEntry: JournalEntry | null;
  entries: JournalEntry[];
  history: PromptHistoryItem[];
  draftWordCount: number;
  weather: WeatherSnapshot | null;
  useCelsius: boolean;
  now: Date;
  discreetMode: boolean;
}): DeskContextSnapshot {
  const { project, todayEntry, entries, history, draftWordCount, weather, useCelsius, now, discreetMode } = args;
  const hour = now.getHours();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthShort = now.toLocaleDateString(undefined, { month: 'short' });
  const calendarRhythmLabel = `Week ${isoWeek(now)} · ${Math.max(0, daysInMonth - now.getDate())} days left in ${monthShort}`;

  const hints = todayEntry?.hints ?? [];
  const rawStarter = hints.find((h) => h.toLowerCase().startsWith('sentence starter:')) ?? hints[0] ?? null;
  const cleanStarter = rawStarter ? rawStarter.replace(/^sentence starter:/i, '').trim().replace(/^["“](.*)["”]$/s, '$1') : null;
  const recallRaw =
    hints.find((h) => h !== rawStarter && (/^smaller question:/i.test(h) || /^recall cue:/i.test(h))) ?? null;
  const recallQuestion = recallRaw
    ? recallRaw.replace(/^smaller question:/i, '').replace(/^recall cue:/i, '').trim()
    : (hints.find((h) => h !== rawStarter) ?? null);

  const prior = entries.filter((e) => e.dateIso !== todayEntry?.dateIso);
  const lastPrior = prior.reduce<JournalEntry | null>((best, e) => (!best || e.dateIso > best.dateIso ? e : best), null);
  const relDay = lastPrior ? formatRelativeDay(lastPrior.dateIso, now) : null;
  let excerpt: string | null = null;
  if (!discreetMode && lastPrior && lastPrior.draftText.trim()) {
    const clean = lastPrior.draftText.trim().replace(/\s+/g, ' ');
    excerpt = clean.length > 130 ? `${clean.slice(0, 127)}…` : clean;
  }

  const historyKeywords = [
    ...history.map((h) => `${h.topicTag} ${h.promptText}`),
    todayEntry?.promptTopicTag ?? '',
    todayEntry?.promptText ?? '',
  ]
    .join(' ')
    .toLowerCase();
  const covered: string[] = [];
  const untapped: string[] = [];
  for (const theme of project.themes) {
    const tokens = theme.toLowerCase().split(/[\s&,/]+/).filter((t) => t.length >= 4);
    const matched = tokens.some((t) => historyKeywords.includes(t.slice(0, 5))) || historyKeywords.includes(theme.toLowerCase());
    (matched ? covered : untapped).push(theme);
  }

  const unit = useCelsius ? '°C' : '°F';
  const weatherSummary = weather
    ? `${weather.cityLabel}: ${weather.conditionLabel}, ${cToDisplay(weather.temperatureCelsius, useCelsius)}${unit} (H ${cToDisplay(weather.highCelsius, useCelsius)} / L ${cToDisplay(weather.lowCelsius, useCelsius)}${unit})${weather.precipitationChancePercent != null ? ` · ${weather.precipitationChancePercent}% precip` : ''}`
    : null;

  return {
    projectId: project.id,
    projectTitle: project.title,
    writingGoal: project.writingGoal,
    originalBrief: project.originalBrief,
    audience: project.audience,
    cadenceLabel: project.cadence ? CADENCE_LABELS[project.cadence] : null,
    tonePreferences: project.tonePreferences,
    boundaries: project.boundaries,
    promptText: todayEntry?.promptText ?? '',
    promptTopicLabel: formatTopicLabel(todayEntry?.promptTopicTag),
    activeStarter: cleanStarter,
    recallQuestion,
    coveredThemes: covered,
    untappedThemes: untapped,
    sessionNumber: Math.max(1, entries.length),
    completedPagesCount: entries.filter((e) => e.isCompleted).length,
    todayCompleted: todayEntry?.isCompleted === true,
    pageSizeLabel: project.pageSizeLabel,
    estimatedWordsPerPage: estimatedWordsPerPage(project),
    linesPerPage: project.linesPerPage,
    wordsPerLine: project.wordsPerLine,
    draftWordCount,
    recentNoteExcerpt: excerpt,
    recentNoteDayLabel: relDay,
    includePastAnswersInPrompts: project.includePastAnswersInPrompts,
    dayPartLabel: dayPartFor(hour),
    writingWindowCue: writingWindowFor(hour),
    calendarRhythmLabel,
    formattedDate: formatDayLong(now),
    formattedTime: formatTime(now),
    daylightSummary: buildDaylightSummary(weather, now),
    weatherSummary,
    isWeatherStale: weather ? isWeatherStale(weather, now.getTime()) : false,
    discreetMode,
  };
}

export function buildDaylightSummary(weather: WeatherSnapshot | null, now: Date): string | null {
  if (!weather?.sunriseIso || !weather.sunsetIso) return null;
  const sr = parseLocalDateTime(weather.sunriseIso);
  const ss = parseLocalDateTime(weather.sunsetIso);
  if (!sr || !ss) return null;
  // Compare on today's date using only the clock time, as the Android build does.
  const at = (src: Date) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), src.getHours(), src.getMinutes());
  const sunrise = at(sr);
  const sunset = at(ss);
  if (now < sunrise) return `Before sunrise (${formatTime(sunrise)}) · Sunset ${formatTime(sunset)}`;
  if (now < sunset) {
    const mins = Math.max(1, Math.floor((sunset.getTime() - now.getTime()) / 60_000));
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h > 0 ? `${h}h ${m}m` : `${m}m`} daylight left · Sunset ${formatTime(sunset)}`;
  }
  return `Past sunset (${formatTime(sunset)}) · Quiet evening`;
}

export function formatRelativeDay(dateIso: string, today: Date): string {
  const d = parseLocalDate(dateIso);
  if (!d) return dateIso;
  const days = daysBetween(d, today);
  if (days === 1) return 'Yesterday';
  if (days === 0) return 'Earlier today';
  if (days >= 2 && days <= 6) return `${days} days ago`;
  return formatMonthDay(d);
}

export function formatTopicLabel(rawTag: string | null | undefined): string {
  const clean = rawTag?.trim();
  if (!clean) return 'Opening prompt';
  const s = clean.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ------------------------------------------------------------------------------------------
 * Desk Companion surface (the web counterpart of the Android A2UI card): a declarative view
 * model derived from the snapshot, optionally enriched by on-device AI cues.
 * ---------------------------------------------------------------------------------------- */

export interface CompanionSurface {
  intent: { eyebrow: string; goal: string; audience: string; tone: string; boundaries: string; briefHighlights: string };
  starter: { starterText: string; recallQuestion: string; continuityTitle: string; continuityBody: string };
  pace: {
    show: boolean;
    sessionTitle: string;
    cadenceSummary: string;
    pageEstimateSummary: string;
    draftProgressLabel: string;
    progressFraction: number;
    untappedThemes: string[];
    coveredThemes: string[];
  };
  ambient: { dayWindow: string; ambientDetail: string; engineBadge: string };
  usedAi: boolean;
}

export function buildCompanionSurface(s: DeskContextSnapshot, cues: DeskCues | null): CompanionSurface {
  const d = s.discreetMode;
  const starterText =
    cues?.starterLine ??
    s.activeStarter ??
    (s.untappedThemes[0]
      ? `One ordinary moment around ${s.untappedThemes[0]} that stood out today was...`
      : s.sessionNumber === 1
        ? 'Start small on the page: Today, a detail worth keeping is...'
        : 'Without overthinking it, one concrete thing I noticed is...');
  const part = s.dayPartLabel.toLowerCase();
  const recall =
    cues?.recallCue ??
    s.recallQuestion ??
    (part === 'morning'
      ? 'What is one small texture, sound, or routine from this morning?'
      : part === 'evening' || part === 'night'
        ? "What is one quiet moment from today you'd want to remember next week?"
        : 'Who or what crossed your mind for a brief second today?');

  const continuityTitle = d
    ? 'Discreet continuity'
    : s.recentNoteExcerpt
      ? `Thread from ${s.recentNoteDayLabel ?? 'recent note'}`
      : s.sessionNumber <= 1
        ? 'Fresh notebook start'
        : `Session #${s.sessionNumber} continuity`;
  const continuityBody = d
    ? 'Brief, recipient, and draft excerpts are hidden while Discreet Mode is active.'
    : s.recentNoteExcerpt && s.includePastAnswersInPrompts
      ? `Recent thread: "${s.recentNoteExcerpt}"`
      : s.recentNoteExcerpt
        ? `Recent draft saved (${s.recentNoteDayLabel ?? 'earlier'}): "${s.recentNoteExcerpt}"`
        : s.sessionNumber <= 1
          ? 'Session #1 — put one honest scene on paper or capture an opening phrase.'
          : `${s.completedPagesCount} page${s.completedPagesCount === 1 ? '' : 's'} completed so far.`;

  const cadenceSummary =
    s.todayCompleted && s.cadenceLabel
      ? `${s.cadenceLabel} rhythm · Today complete`
      : s.cadenceLabel
        ? `${s.cadenceLabel} rhythm · Ready for today's page`
        : s.todayCompleted
          ? "Today's page complete"
          : 'Open notebook pace';
  const est = s.estimatedWordsPerPage;
  const pageEstimateSummary = est ? `${s.pageSizeLabel ?? 'Page'} · ~${est} words (${s.linesPerPage} lines × ${s.wordsPerLine}w)` : '';
  const progressFraction = est && s.draftWordCount > 0 ? Math.min(1, s.draftWordCount / est) : 0;
  const draftProgressLabel = s.draftWordCount > 0 && est ? `Draft: ${s.draftWordCount} / ~${est} words` : '';

  const ambientParts = [
    s.daylightSummary,
    s.weatherSummary ? (s.isWeatherStale ? `${s.weatherSummary} (cached)` : s.weatherSummary) : null,
    !s.daylightSummary && !s.weatherSummary ? s.calendarRhythmLabel : null,
  ].filter(Boolean);
  const ambientDetail = cues?.ambientCue ?? (ambientParts.join(' · ') || s.calendarRhythmLabel);

  return {
    intent: {
      eyebrow: d ? 'Quiet Desk Compass' : 'Project Context',
      goal: s.writingGoal.trim() || 'Capture one grounded reflection on paper.',
      audience: d ? '' : (s.audience ?? ''),
      tone: d ? '' : (s.tonePreferences ?? ''),
      boundaries: d ? '' : (s.boundaries ?? ''),
      briefHighlights: d ? '' : (cues?.briefDigest ?? s.originalBrief.trim().slice(0, 280)),
    },
    starter: { starterText, recallQuestion: recall, continuityTitle, continuityBody },
    pace: {
      show: s.untappedThemes.length > 0 || s.coveredThemes.length > 0 || !!pageEstimateSummary || s.sessionNumber > 1,
      sessionTitle: `Session #${s.sessionNumber} · ${s.completedPagesCount} done`,
      cadenceSummary,
      pageEstimateSummary,
      draftProgressLabel,
      progressFraction,
      untappedThemes: s.untappedThemes,
      coveredThemes: s.coveredThemes,
    },
    ambient: {
      dayWindow: `${s.writingWindowCue} · ${s.formattedTime}`,
      ambientDetail,
      engineBadge: cues ? 'On-device AI' : 'Desk Companion',
    },
    usedAi: !!cues,
  };
}

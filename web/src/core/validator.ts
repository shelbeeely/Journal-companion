import type { JournalCadence, ProposedProjectSetup } from './models';

export function extractJsonBlock(raw: string): string | null {
  let stripped = raw.trim();
  for (const prefix of ['```json', '```JSON', '```']) {
    if (stripped.startsWith(prefix)) {
      stripped = stripped.slice(prefix.length);
      break;
    }
  }
  if (stripped.endsWith('```')) stripped = stripped.slice(0, -3);
  stripped = stripped.trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return stripped.slice(start, end + 1);
}

function parseObject(raw: string): Record<string, unknown> | null {
  const block = extractJsonBlock(raw);
  if (!block) return null;
  try {
    const parsed = JSON.parse(block);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const distinct = <T,>(xs: T[]): T[] => Array.from(new Set(xs));

export function cleanNullable(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  if (['null', 'none', 'unset', 'unknown', 'n/a', 'not specified', 'unspecified'].includes(trimmed.toLowerCase())) return null;
  return trimmed;
}

export function ensureDiscreetTitle(candidate: string): string {
  const sensitive = ['psych', 'hospital', 'ward', 'clinic', 'inpatient', 'mental'];
  const lower = candidate.toLowerCase();
  return sensitive.some((t) => lower.includes(t)) ? 'Pocket Pages' : candidate;
}

export function estimatePageGrid(pageSizeLabel: string | null | undefined): [number, number] {
  if (!pageSizeLabel || !pageSizeLabel.trim()) return [18, 8];
  const lower = pageSizeLabel.toLowerCase();
  if (lower.includes('3.25') || lower.includes('3.5') || lower.includes('mini') || lower.includes('pocket')) return [14, 6];
  if (lower.includes('a6')) return [16, 7];
  if (lower.includes('a5') || lower.includes('5')) return [22, 8];
  return [18, 8];
}

function normalizeCadence(raw: string | null): JournalCadence | null {
  switch (raw?.trim().toLowerCase()) {
    case 'daily':
      return 'DAILY';
    case 'weekly':
      return 'WEEKLY';
    case 'whenever':
    case 'whenever i open it':
    case 'as needed':
    case 'flexible':
      return 'WHENEVER';
    default:
      return null;
  }
}

export function validateProjectProposal(rawText: string): ProposedProjectSetup | null {
  const parsed = parseObject(rawText);
  if (!parsed) return null;
  const title = (str(parsed.title) ?? '').trim().slice(0, 48);
  const goal = (str(parsed.writingGoal) ?? '').trim().slice(0, 200);
  const prompt = (str(parsed.firstPrompt) ?? '').trim().slice(0, 240);
  if (!title || !goal || !prompt) return null;

  const themes = distinct(
    strList(parsed.themes)
      .map((t) => t.trim())
      .filter((t) => t && t.toLowerCase() !== 'unknown' && t.toLowerCase() !== 'none'),
  ).slice(0, 6);
  const hints = distinct(strList(parsed.firstHints).map((h) => h.trim()).filter(Boolean)).slice(0, 2);
  const pageSize = cleanNullable(str(parsed.pageSizeLabel));
  const [lines, words] = estimatePageGrid(pageSize);

  return {
    title: ensureDiscreetTitle(title),
    writingGoal: goal,
    audience: cleanNullable(str(parsed.audience)),
    cadence: normalizeCadence(str(parsed.cadence)),
    pageSizeLabel: pageSize,
    entryLengthLabel: cleanNullable(str(parsed.entryLengthLabel)),
    linesPerPage: lines,
    wordsPerLine: words,
    themes,
    tonePreferences: cleanNullable(str(parsed.tonePreferences)),
    boundaries: cleanNullable(str(parsed.boundaries)),
    firstPrompt: prompt,
    firstHints: hints,
    usedAi: true,
    statusNote: null,
  };
}

const normalizeForCompare = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '');

export function validatePromptResponse(
  rawText: string,
  recentPrompts: string[],
): { prompt: string; topicTag: string; hints: string[] } | null {
  const parsed = parseObject(rawText);
  if (!parsed) return null;
  const prompt = (str(parsed.prompt) ?? '').trim().slice(0, 260);
  if (prompt.length < 12) return null;
  const n = normalizeForCompare(prompt);
  const dup = recentPrompts.some((old) => {
    const o = normalizeForCompare(old);
    return o === n || o.includes(n) || n.includes(o);
  });
  if (dup) return null;
  const topic = (str(parsed.topicTag) ?? '').trim().toLowerCase() || 'reflection';
  const hints = distinct(strList(parsed.hints).map((h) => h.trim()).filter(Boolean)).slice(0, 2);
  return { prompt, topicTag: topic, hints };
}

function stripQuotes(s: string): string {
  return s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}

export function validateHintResponse(rawText: string): string | null {
  const parsed = parseObject(rawText);
  const hint = str(parsed?.hint)?.trim().slice(0, 220);
  if (hint) return hint;
  const plain = stripQuotes(rawText.trim());
  return plain.length >= 10 && plain.length <= 220 && !plain.startsWith('{') ? plain : null;
}

export function validateDraftSuggestion(rawText: string): string | null {
  const parsed = parseObject(rawText);
  const s = str(parsed?.suggestion)?.trim().slice(0, 1200);
  if (s) return s;
  const plain = stripQuotes(rawText.trim());
  return plain.length >= 8 && plain.length <= 1200 && !plain.startsWith('{') ? plain : null;
}

export function parseDeskCues(rawText: string): {
  starterLine?: string;
  recallCue?: string;
  ambientCue?: string;
  briefDigest?: string;
} | null {
  const parsed = parseObject(rawText);
  if (!parsed) return null;
  const pick = (k: string) => str(parsed[k])?.trim() || undefined;
  return {
    starterLine: pick('starterLine'),
    recallCue: pick('recallCue'),
    ambientCue: pick('ambientCue'),
    briefDigest: pick('briefDigest'),
  };
}

import * as Fallback from '../fallbackEngine';
import {
  CADENCE_LABELS,
  estimatedWordsPerPage,
  type DeskContextSnapshot,
  type DraftSuggestion,
  type JournalProject,
  type PromptContextPayload,
  type PromptHistoryItem,
  type ProposedProjectSetup,
  type WizardSeedInputs,
} from '../models';
import { parseDeskCues, validateDraftSuggestion, validateHintResponse, validateProjectProposal, validatePromptResponse } from '../validator';
import type { AiClient, AiGenerationResult, ResponseSchema } from './aiClient';

export interface GeneratedPromptResult {
  promptText: string;
  topicTag: string;
  hints: string[];
  usedAi: boolean;
  statusNote: string | null;
}

export interface GeneratedHintResult {
  hintText: string;
  usedAi: boolean;
  statusNote: string | null;
}

export interface DeskCues {
  starterLine?: string;
  recallCue?: string;
  ambientCue?: string;
  briefDigest?: string;
}

const nonBlank = (s: string | null | undefined) => (s && s.trim() ? s : null);

const str = { type: 'string' } as const;
const nullableStr = { type: ['string', 'null'] } as const;
const strArr = { type: 'array', items: str } as const;
const obj = (properties: Record<string, unknown>): Record<string, unknown> => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

/** Structured-output schemas (enforced where the model supports it; the validator always re-checks). */
export const SCHEMAS = {
  proposal: {
    name: 'project_proposal',
    schema: obj({
      title: str,
      writingGoal: str,
      audience: nullableStr,
      cadence: { type: ['string', 'null'], enum: ['daily', 'weekly', 'whenever', null] },
      pageSizeLabel: nullableStr,
      entryLengthLabel: nullableStr,
      themes: strArr,
      tonePreferences: nullableStr,
      boundaries: nullableStr,
      firstPrompt: str,
      firstHints: strArr,
    }),
  },
  prompt: { name: 'journal_prompt', schema: obj({ prompt: str, topicTag: str, hints: strArr }) },
  hint: { name: 'hint', schema: obj({ hint: str }) },
  suggestion: { name: 'suggestion', schema: obj({ suggestion: str }) },
  deskCues: { name: 'desk_cues', schema: obj({ starterLine: str, recallCue: str, ambientCue: str, briefDigest: str }) },
} satisfies Record<string, ResponseSchema>;

/**
 * Coordinates the AI model with strict privacy scoping, structured output validation,
 * and complete fallback to built-in templates.
 */
export class JournalAiOrchestrator {
  /**
   * @param isDiscreet While true, the original brief, audience and past notes are never sent to the
   *   model (only the prompt, goal and tone). Explicit brief analysis in the project wizard is the one
   *   exception, because the brief is what the user asked to analyze.
   */
  constructor(
    private readonly ai: AiClient,
    private readonly isDiscreet: () => boolean = () => false,
  ) {}

  checkAvailability() {
    return this.ai.checkAvailability();
  }

  /** Sends a tiny, content-free request to confirm the key and model work. */
  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const res = await this.ai.generate('Return ONLY JSON: {"hint": "..."}.', 'Give one short, generic journaling sentence starter.', {
      temperature: 0.2,
      maxTokens: 60,
      schema: SCHEMAS.hint,
    });
    if (res.kind === 'success') {
      const hint = validateHintResponse(res.text);
      return hint ? { ok: true, message: `Working. Sample: “${hint}”` } : { ok: false, message: 'The model replied, but not in the expected format. Try another model.' };
    }
    return { ok: false, message: res.kind === 'unavailable' ? res.reason : res.kind === 'busy' ? res.message : res.kind === 'failure' ? res.message : 'Cancelled.' };
  }

  /** Drop any cached availability (after connecting, disconnecting or switching model). */
  resetAvailability() {
    (this.ai as { invalidate?: () => void }).invalidate?.();
  }

  async proposeProjectSetup(brief: string, wizardInputs?: WizardSeedInputs | null): Promise<ProposedProjectSetup> {
    const system = `You configure private journaling projects. Return ONLY valid JSON with no markdown or commentary.
Rules:
- Leave unknown fields null (never invent audience, cadence, or pageSizeLabel if not mentioned).
- Keep title short, calm, and discreet (never put medical/hospital/sensitive terms or private names in title).
- firstPrompt must be one concrete question answerable on paper without re-explaining sensitive context.
- Respect any explicit user preferences provided below.`;

    const prefs = wizardInputs
      ? [
          wizardInputs.cadence ? `Desired cadence: ${CADENCE_LABELS[wizardInputs.cadence]}` : null,
          nonBlank(wizardInputs.audience) ? `Audience: ${wizardInputs.audience}` : null,
          nonBlank(wizardInputs.pageSizeLabel) ? `Physical page size: ${wizardInputs.pageSizeLabel}` : null,
          nonBlank(wizardInputs.tonePreferences) ? `Tone preference: ${wizardInputs.tonePreferences}` : null,
          nonBlank(wizardInputs.boundaries) ? `Boundaries: ${wizardInputs.boundaries}` : null,
        ].filter(Boolean)
      : [];
    const wizardSection = prefs.length ? `\n## User Preferences Selected in Wizard\n${prefs.map((l) => `- ${l}`).join('\n')}` : '';

    const user = `Analyze this journaling brief and return JSON with exact keys:
title (string), writingGoal (one sentence string), audience (string or null),
cadence ("daily"|"weekly"|"whenever"|null), pageSizeLabel (string or null),
entryLengthLabel (string or null), themes (array of short strings),
tonePreferences (string or null), boundaries (string or null),
firstPrompt (string), firstHints (array of 1-2 short hints: a sentence starter or smaller recall question).

## Brief
${brief}
${wizardSection}`;

    const result = await this.ai.generate(system, user, { temperature: 0.25, maxTokens: 600, schema: SCHEMAS.proposal });
    if (result.kind === 'success') {
      const v = validateProjectProposal(result.text);
      if (!v) return Fallback.proposeSetupFromBrief(brief, 'AI output failed validation; applied structured template proposal.', wizardInputs);
      if (!wizardInputs) return v;
      return {
        ...v,
        cadence: wizardInputs.cadence ?? v.cadence,
        audience: nonBlank(wizardInputs.audience) ?? v.audience,
        pageSizeLabel: nonBlank(wizardInputs.pageSizeLabel) ?? v.pageSizeLabel,
        linesPerPage: wizardInputs.linesPerPage ?? v.linesPerPage,
        wordsPerLine: wizardInputs.wordsPerLine ?? v.wordsPerLine,
        tonePreferences: nonBlank(wizardInputs.tonePreferences) ?? v.tonePreferences,
        boundaries: nonBlank(wizardInputs.boundaries) ?? v.boundaries,
      };
    }
    return Fallback.proposeSetupFromBrief(brief, noteFor(result, 'template'), wizardInputs);
  }

  async generateNextPrompt(
    project: JournalProject,
    recentHistory: PromptHistoryItem[],
    optedInPastAnswers: string[],
    ctx: PromptContextPayload,
    previousTopicToAvoid: string | null = null,
  ): Promise<GeneratedPromptResult> {
    const recentPrompts = recentHistory.map((h) => h.promptText);
    const recentTopics = recentHistory.map((h) => h.topicTag);

    const system = `You are a quiet, thoughtful journaling prompt designer for physical notebooks.
Return ONLY valid JSON: {"prompt": "...", "topicTag": "...", "hints": ["...", "..."]}.
Rules:
- Ask ONE concrete question answerable on paper.
- Vary topic and wording from recent prompts.
- Use only supplied details; never invent memories, dialogue, feelings, or day events.
- Never ask the user to re-explain sensitive background. Never guess what was written on paper.`;

    const lines: string[] = ['## Project Settings', `Goal: ${project.writingGoal}`];
    const discreet = this.isDiscreet();
    if (project.audience && !discreet) lines.push(`Audience: ${project.audience}`);
    if (project.cadence) lines.push(`Cadence: ${CADENCE_LABELS[project.cadence]}`);
    const est = estimatedWordsPerPage(project);
    if (est) lines.push(`Target page size: ${project.pageSizeLabel} (~${est} words, advisory only)`);
    if (project.themes.length) lines.push(`Themes: ${project.themes.join(', ')}`);
    if (project.tonePreferences) lines.push(`Tone: ${project.tonePreferences}`);
    if (project.boundaries) lines.push(`Boundaries: ${project.boundaries}`);
    if (recentHistory.length) {
      lines.push('', '## Recent Prompts to Avoid Repeating');
      recentHistory.slice(0, 8).forEach((h) => lines.push(`- [${h.topicTag}] ${h.promptText}`));
    }
    if (previousTopicToAvoid) lines.push(`Avoid topic: ${previousTopicToAvoid}`);
    if (project.includePastAnswersInPrompts && optedInPastAnswers.length && !discreet) {
      lines.push('', '## Opted-In Previous Typed Notes');
      optedInPastAnswers.slice(0, 3).forEach((a) => lines.push(`- ${a.slice(0, 180)}`));
    }
    if (ctx.dateTimeText || ctx.weatherSummary) {
      lines.push('', '## Optional Enabled Context');
      if (ctx.dateTimeText) lines.push(`Date/Time: ${ctx.dateTimeText}`);
      if (ctx.weatherSummary) lines.push(`Weather: ${ctx.weatherSummary}${ctx.weatherFetchedTimestamp ? ` (fetched ${ctx.weatherFetchedTimestamp})` : ''}`);
    }

    const result = await this.ai.generate(system, lines.join('\n'), { temperature: 0.65, maxTokens: 300, schema: SCHEMAS.prompt });
    const fallback = (note: string | null): GeneratedPromptResult => {
      const f = Fallback.generateFallbackPrompt(project, recentPrompts, recentTopics, ctx, previousTopicToAvoid);
      return { promptText: f.question, topicTag: f.topicTag, hints: f.hints, usedAi: false, statusNote: note };
    };
    if (result.kind === 'success') {
      const parsed = validatePromptResponse(result.text, recentPrompts);
      return parsed
        ? { promptText: parsed.prompt, topicTag: parsed.topicTag, hints: parsed.hints, usedAi: true, statusNote: null }
        : fallback('Used curated prompt fallback.');
    }
    if (result.kind === 'unavailable') return fallback(null);
    return fallback(noteFor(result, 'prompt'));
  }

  async generateHint(project: JournalProject, currentPrompt: string, existingHints: string[]): Promise<GeneratedHintResult> {
    const system = `Return ONLY JSON: {"hint": "..."}.
Provide either one short sentence starter OR one smaller recall question directly relevant to the current prompt.
Respect tone and boundaries. Never invent memories.`;
    const lines = ['## Prompt', currentPrompt];
    if (project.tonePreferences) lines.push(`Tone: ${project.tonePreferences}`);
    if (project.boundaries) lines.push(`Boundaries: ${project.boundaries}`);
    if (existingHints.length) {
      lines.push('Already shown hints (give a different angle):');
      existingHints.forEach((h) => lines.push(`- ${h}`));
    }
    const result = await this.ai.generate(system, lines.join('\n'), { temperature: 0.5, maxTokens: 160, schema: SCHEMAS.hint });
    if (result.kind === 'success') {
      const v = validateHintResponse(result.text);
      if (v && !existingHints.includes(v)) return { hintText: v, usedAi: true, statusNote: null };
    }
    return {
      hintText: Fallback.generateFallbackHint(currentPrompt, existingHints),
      usedAi: false,
      statusNote: result.kind === 'busy' ? result.message : null,
    };
  }

  async helpStartDraft(project: JournalProject, currentPrompt: string): Promise<DraftSuggestion> {
    const system = `Return ONLY JSON: {"suggestion": "..."}.
Write a gentle 1-2 sentence opening starter to help the user begin answering the prompt in their own voice.
Leave room for the user to finish the thought. Never invent fake memories.`;
    const lines = [`Prompt: ${currentPrompt}`];
    if (project.tonePreferences) lines.push(`Tone: ${project.tonePreferences}`);
    if (project.boundaries) lines.push(`Boundaries: ${project.boundaries}`);
    const result = await this.ai.generate(system, lines.join('\n'), { temperature: 0.5, maxTokens: 200, schema: SCHEMAS.suggestion });
    if (result.kind === 'success') {
      const t = validateDraftSuggestion(result.text);
      if (t) return { kind: 'HELP_START', suggestedText: t, usedAi: true };
    }
    return {
      kind: 'HELP_START',
      suggestedText: Fallback.generateFallbackStart(project, currentPrompt),
      usedAi: false,
      note: result.kind === 'busy' ? result.message : null,
    };
  }

  async tightenDraft(project: JournalProject, currentPrompt: string, currentDraft: string): Promise<DraftSuggestion> {
    const est = estimatedWordsPerPage(project);
    const targetNote = est ? `Target around ~${est} words if natural, without cutting core meaning.` : '';
    const system = `Return ONLY JSON: {"suggestion": "..."}.
Lightly tighten and clarify the user's draft while preserving their authentic voice, facts, and emotional warmth.
Never invent details not in the draft. ${targetNote}`;
    const lines = [`Prompt: ${currentPrompt}`];
    if (project.tonePreferences) lines.push(`Tone: ${project.tonePreferences}`);
    lines.push('## User Draft', currentDraft);
    const result = await this.ai.generate(system, lines.join('\n'), { temperature: 0.3, maxTokens: 500, schema: SCHEMAS.suggestion });
    if (result.kind === 'success') {
      const t = validateDraftSuggestion(result.text);
      if (t) return { kind: 'TIGHTEN_DRAFT', suggestedText: t, usedAi: true };
    }
    return {
      kind: 'TIGHTEN_DRAFT',
      suggestedText: Fallback.generateFallbackTighten(currentDraft, est),
      usedAi: false,
      note: result.kind === 'busy' ? result.message : null,
    };
  }

  /** Optional AI-written cues for the Desk Companion card. Returns null when AI isn't ready. */
  async synthesizeDeskCues(snapshot: DeskContextSnapshot): Promise<DeskCues | null> {
    const availability = await this.ai.checkAvailability().catch(() => null);
    if (availability?.kind !== 'available') return null;
    const system = `You write the short cues on a proactive desk companion surface for physical notebook writers.
Return ONLY JSON with optional short fields:
{"starterLine":"...", "recallCue":"...", "ambientCue":"...", "briefDigest":"..."}
Rules:
- Keep each string calm, concrete, under 140 characters, ADHD-friendly, zero fluff.
- Respect all boundaries and tone preferences.
- Never invent memories or fake weather numbers.`;
    const lines = [`Question: ${snapshot.promptText}`, `Goal: ${snapshot.writingGoal}`];
    if (!snapshot.discreetMode && !this.isDiscreet()) {
      if (snapshot.audience) lines.push(`Audience: ${snapshot.audience}`);
      if (snapshot.tonePreferences) lines.push(`Tone: ${snapshot.tonePreferences}`);
      if (snapshot.boundaries) lines.push(`Boundaries: ${snapshot.boundaries}`);
      if (snapshot.originalBrief.trim()) lines.push(`Brief: ${snapshot.originalBrief.slice(0, 400)}`);
      if (snapshot.recentNoteExcerpt) lines.push(`Prior note: ${snapshot.recentNoteExcerpt}`);
    }
    if (snapshot.untappedThemes.length) lines.push(`Untapped themes: ${snapshot.untappedThemes.join(', ')}`);
    lines.push(`Window: ${snapshot.writingWindowCue} (${snapshot.formattedTime})`);
    if (snapshot.weatherSummary) lines.push(`Weather: ${snapshot.weatherSummary}`);
    if (snapshot.daylightSummary) lines.push(`Daylight: ${snapshot.daylightSummary}`);
    const res = await this.ai.generate(system, lines.join('\n'), { temperature: 0.35, maxTokens: 260, schema: SCHEMAS.deskCues });
    return res.kind === 'success' ? parseDeskCues(res.text) : null;
  }
}

function noteFor(result: Exclude<AiGenerationResult, { kind: 'success' }>, ctx: 'template' | 'prompt'): string {
  switch (result.kind) {
    case 'unavailable':
      return result.reason;
    case 'busy':
      return result.message;
    case 'failure':
      return ctx === 'template' ? `AI unavailable for this request (${result.message}); using built-in template.` : result.message;
    case 'cancelled':
      return ctx === 'template' ? 'AI analysis cancelled; template ready.' : 'Cancelled; kept local prompt.';
  }
}

import type { JournalCadence, JournalProject, PromptContextPayload, ProposedProjectSetup, WizardSeedInputs } from './models';
import { estimatePageGrid } from './validator';

/**
 * Complete offline engine used when on-device AI is unavailable, still downloading, busy,
 * or when the user prefers manual/template-based setup. Ported 1:1 from the Android app.
 */
interface PromptCandidate {
  topicTag: string;
  question: string;
  hints: string[];
}

const nonBlank = (s: string | null | undefined) => {
  const t = s?.trim();
  return t ? t : null;
};

export function proposeSetupFromBrief(
  brief: string,
  statusNote: string | null = null,
  wizardInputs?: WizardSeedInputs | null,
): ProposedProjectSetup {
  const base = proposeSetupFromBriefCore(brief, statusNote);
  if (!wizardInputs) return base;
  const mergedPageSize = nonBlank(wizardInputs.pageSizeLabel) ?? base.pageSizeLabel;
  const [defaultLines, defaultWords] = estimatePageGrid(mergedPageSize);
  const pageChanged = mergedPageSize !== base.pageSizeLabel;
  return {
    ...base,
    cadence: wizardInputs.cadence ?? base.cadence,
    audience: nonBlank(wizardInputs.audience) ?? base.audience,
    pageSizeLabel: mergedPageSize,
    linesPerPage: wizardInputs.linesPerPage ?? (pageChanged ? defaultLines : base.linesPerPage),
    wordsPerLine: wizardInputs.wordsPerLine ?? (pageChanged ? defaultWords : base.wordsPerLine),
    tonePreferences: nonBlank(wizardInputs.tonePreferences) ?? base.tonePreferences,
    boundaries: nonBlank(wizardInputs.boundaries) ?? base.boundaries,
  };
}

function proposeSetupFromBriefCore(brief: string, statusNote: string | null): ProposedProjectSetup {
  const trimmed = brief.trim();
  const lower = trimmed.toLowerCase();
  const has = (s: string) => lower.includes(s);

  const dim = /(\d+(?:\.\d+)?)\s*["”']?\s*[x×]\s*(\d+(?:\.\d+)?)\s*["”']?/.exec(trimmed);
  const pageSize = dim
    ? `${dim[1]}" × ${dim[2]}"`
    : has('a5')
      ? 'A5'
      : has('a6')
        ? 'A6'
        : has('pocket') || has('mini journal')
          ? 'Pocket (3.5" × 5.5")'
          : null;

  const cadence: JournalCadence | null =
    has('a day') || has('daily') || has('every day') || has('each day')
      ? 'DAILY'
      : has('weekly') || has('every week') || has('once a week')
        ? 'WEEKLY'
        : has('whenever') || has('as needed')
          ? 'WHENEVER'
          : null;

  const entryLength =
    has('one page') || has('a page') || has('fill a page')
      ? 'One notebook page'
      : has('few lines') || has('short note')
        ? 'A few short lines'
        : null;

  const [lines, words] = estimatePageGrid(pageSize);
  const common = { cadence, pageSizeLabel: pageSize, entryLengthLabel: entryLength, linesPerPage: lines, wordsPerLine: words, usedAi: false, statusNote };

  const isFriendCareBrief =
    (has('friend') || has('roommate')) && (has('appreciate') || has('like about') || has('care') || has('missed'));

  if (isFriendCareBrief) {
    const themes = Array.from(
      new Set(
        [
          'appreciation',
          has('room') || has('routine') ? 'shared routines' : null,
          'friendship',
          has('his friends') || has('friends') ? 'his friends' : null,
          has('missed') ? 'presence & small moments' : null,
        ].filter((x): x is string => !!x),
      ),
    );
    const tone = 'Warm, low-pressure, grounded' + (has('not') || has('too much') || has('clingy') ? ', steady and unhurried' : '');
    const boundaries =
      has('clingy') || has('too much') || has('hospital')
        ? "Keep notes light and grounded—no heavy pressure, no clinginess, and never ask to re-explain why he's away."
        : 'Keep entries warm and easy to read without pressure.';
    const audience = has('roommate') && has('friend') ? 'Close friend & roommate' : has('friend') ? 'A close friend' : null;
    return {
      ...common,
      title: 'Mini Pocket Pages',
      writingGoal: 'Write one warm, low-pressure pocket page sharing everyday appreciation and steady friendship.',
      audience,
      themes,
      tonePreferences: tone,
      boundaries,
      firstPrompt:
        'What is one small, ordinary thing around the room or from your week that reminded you of something you genuinely like about him?',
      firstHints: [
        'Sentence starter: "Walking past [spot/object] reminded me of how you always..."',
        'Smaller question: Think of a tiny habit of his that makes sharing a space easier.',
      ],
    };
  }

  const isCreativeLog = ['project', 'sketch', 'studio', 'craft', 'novel', 'music', 'build', 'woodwork', 'creative'].some(has);
  if (isCreativeLog) {
    const themes = extractKeywords(
      lower,
      {
        process: ['process', 'progress', 'step', 'experiment'],
        'craft & materials': ['sketch', 'wood', 'paint', 'code', 'craft', 'design', 'music', 'draft'],
        momentum: ['stuck', 'momentum', 'finish', 'ship', 'block'],
        decisions: ['decision', 'choice', 'why', 'note'],
      },
      ['creative process', 'open questions', 'small breakthroughs'],
    );
    const audience = has('future me') || has('future reader') ? 'Future me' : has('myself') || has('for me') ? 'Myself' : null;
    return {
      ...common,
      title: 'Studio Process Log',
      writingGoal: 'Capture clear observations, experiments, and next steps from each creative session.',
      audience,
      themes,
      tonePreferences: 'Curious, concrete, unpretentious',
      boundaries: 'Focus on what you noticed or tried today rather than judging the whole project.',
      firstPrompt: 'What single detail, texture, or problem in your current work held your attention longest today?',
      firstHints: [
        'Sentence starter: "The moment the piece shifted slightly today was when..."',
        'Smaller question: What is one tiny experiment you want to try next session?',
      ],
    };
  }

  const audience = has('future reader') ? 'A future reader' : has('myself') || has('personal') || has('my own') ? 'Myself' : null;
  const themes = extractKeywords(
    lower,
    {
      'daily grounding': ['day', 'daily', 'morning', 'evening', 'routine'],
      'gratitude & notice': ['grateful', 'notice', 'small', 'calm', 'quiet'],
      clarity: ['clear', 'mind', 'focus', 'reflect', 'unwind'],
      growth: ['learn', 'habit', 'goal', 'change'],
    },
    ['everyday moments', 'quiet noticing', 'clarity'],
  );
  const title = has('morning')
    ? 'Morning Pages'
    : has('evening') || has('night')
      ? 'Evening Unwind'
      : has('gratitude')
        ? 'Quiet Gratitude'
        : 'Daily Reflection';
  return {
    ...common,
    title,
    writingGoal: 'Spend a few unhurried minutes noticing one grounded detail from today on paper.',
    audience,
    themes,
    tonePreferences: 'Calm, observational, honest',
    boundaries: 'Keep questions specific and grounded in real life—no vague clichés.',
    firstPrompt: 'What was one quiet, ordinary moment today that felt worth remembering?',
    firstHints: [
      'Sentence starter: "Earlier today, I paused for a second when..."',
      'Smaller question: Where were you sitting or standing, and what was in front of you?',
    ],
  };
}

export function generateFallbackPrompt(
  project: JournalProject,
  recentPrompts: string[],
  recentTopics: string[],
  enabledContext: PromptContextPayload,
  previousTopicToAvoid: string | null = null,
  random: () => number = Math.random,
): { question: string; topicTag: string; hints: string[] } {
  const pool = buildCandidatePool(project, enabledContext);
  const avoided = new Set([...recentTopics.slice(0, 3), ...(previousTopicToAvoid ? [previousTopicToAvoid] : [])]);
  const recent = new Set(recentPrompts.map(normalize));
  const selected =
    pool.find((c) => !avoided.has(c.topicTag) && !recent.has(normalize(c.question))) ??
    pool.find((c) => !recent.has(normalize(c.question))) ??
    pool[Math.floor(random() * pool.length)];
  return { question: selected.question, topicTag: selected.topicTag, hints: selected.hints };
}

export function generateFallbackHint(currentPrompt: string, existingHints: string[]): string {
  const lower = currentPrompt.toLowerCase();
  const has = (s: string) => lower.includes(s);
  const candidates =
    has('friend') || has('people') || has('group')
      ? [
          'Sentence starter: "One thing I always notice when you\'re all together is..."',
          'Smaller question: Think of a recent joke, hangout, or small kindness someone showed.',
          'Recall cue: Picture the last time you heard them laughing—what sparked it?',
        ]
      : has('room') || has('routine') || has('space')
        ? [
            'Sentence starter: "It felt a little different this week whenever I..."',
            'Smaller question: What time of day do your routines usually cross paths?',
            'Recall cue: Look at one item on a shelf or desk and trace the story behind it.',
          ]
        : has('project') || has('work') || has('creative') || has('experiment')
          ? [
              'Sentence starter: "I originally tried this approach because..., and what actually happened was..."',
              'Smaller question: What surprised you—even slightly—during the last 20 minutes of working?',
              'Recall cue: Name one constraint you bumped into and one workaround you tested.',
            ]
          : [
              'Sentence starter: "If I were describing just five minutes of that moment, I\'d start with..."',
              'Smaller question: What specific sound, object, or phrase stands out first?',
              'Recall cue: Shrink the answer down to one concrete scene rather than a summary.',
            ];
  return candidates.find((c) => !existingHints.includes(c)) ?? 'Sentence starter: "Right now, the simplest honest detail to put on the page is..."';
}

export function generateFallbackStart(project: JournalProject, currentPrompt: string): string {
  const lower = currentPrompt.toLowerCase();
  const themeHas = (s: string) => project.themes.some((t) => t.toLowerCase().includes(s));
  const isFriendTone = themeHas('friendship') || themeHas('appreciation');
  if (isFriendTone && (lower.includes('room') || lower.includes('routine')))
    return 'Nothing huge happened today, just a small moment in the room that made me think of you—specifically how you always...';
  if (isFriendTone && lower.includes('friends')) return 'One thing I really appreciate about your circle of friends is how naturally they...';
  if (isFriendTone) return 'I was thinking about an ordinary detail from this week, and it reminded me how much I like that you...';
  if (themeHas('creative') || themeHas('process')) return "Today's session centered on one stubborn detail: I tried adjusting...";
  return 'Looking back at today, one small detail stood out more than I expected:...';
}

export function generateFallbackTighten(currentDraft: string, targetWords: number | null): string {
  const cleaned = currentDraft
    .replace(/\s+/g, ' ')
    .replace(/\b(just|really|actually|literally|basically|very)\b\s*/gi, '')
    .replace(/\s+([,.!?])/g, '$1')
    .trim();
  if (targetWords == null) return cleaned;
  const words = cleaned.split(' ').filter(Boolean);
  if (words.length > targetWords + 15) {
    return words.slice(0, targetWords).join(' ').replace(/[,;]+$/, '') + '.';
  }
  return cleaned;
}

function buildCandidatePool(project: JournalProject, ctx: PromptContextPayload): PromptCandidate[] {
  const themesLower = project.themes.join(' ').toLowerCase();
  const briefLower = project.originalBrief.toLowerCase();
  const isFriend =
    themesLower.includes('appreciation') || themesLower.includes('friendship') || briefLower.includes('roommate') || briefLower.includes('his friends');
  const isCreative =
    themesLower.includes('creative') || themesLower.includes('process') || themesLower.includes('craft') || briefLower.includes('project log');

  const list: PromptCandidate[] = isFriend
    ? [
        {
          topicTag: 'appreciation_trait',
          question: 'What is one quiet habit or personality trait of his that makes daily life feel steadier around him?',
          hints: [
            'Sentence starter: "I don\'t think I\'ve ever said how much I appreciate the way you..."',
            'Smaller question: Think of a tiny gesture he does without thinking twice.',
          ],
        },
        {
          topicTag: 'his_friends',
          question: 'What is something you genuinely appreciate about his friends—maybe how they show up or the energy they bring?',
          hints: [
            'Sentence starter: "Whenever your friends are around, it\'s clear why you click with them—especially..."',
            'Smaller question: Recall one specific hangout or moment where his friends felt welcoming.',
          ],
        },
        {
          topicTag: 'shared_routines',
          question:
            'Which small shared routine in your room—morning coffee, music, late-night wind-down—felt most noticeable by its absence this week?',
          hints: [
            'Sentence starter: "Around [time of day], the room always has this rhythm when we..."',
            'Smaller question: Focus on just one hour of the day you both usually cross paths.',
          ],
        },
        {
          topicTag: 'light_memory',
          question: "What is an ordinary, funny, or low-stakes moment from the past few weeks that you'd want him to remember?",
          hints: [
            'Sentence starter: "Randomly remembered the time we... and it still makes me smile."',
            'Smaller question: Keep it light—one small laugh, meal, or passing comment.',
          ],
        },
        {
          topicTag: 'shared_taste',
          question: 'What song, snack, show, or inside reference feels unmistakably like him right now, and why?',
          hints: [
            'Sentence starter: "Whenever [song/item] comes up, I immediately associate it with you because..."',
            'Smaller question: What would you put in a tiny care-package list of everyday things he likes?',
          ],
        },
        {
          topicTag: 'friendship_friends_trait',
          question: 'How do you see the best parts of him reflected in the people he chooses to spend time with?',
          hints: [
            'Sentence starter: "You can always tell a lot about someone from their crew, and yours..."',
            'Smaller question: Name one friend of his and one quality you respect in them.',
          ],
        },
      ]
    : isCreative
      ? [
          {
            topicTag: 'observation',
            question: 'What specific part of the work moved forward today, even if it was just a rough test or adjustment?',
            hints: [
              'Sentence starter: "Before today, this piece felt stuck on..., and testing... changed it."',
              'Smaller question: Describe the exact material, line, or structure you touched last.',
            ],
          },
          {
            topicTag: 'open_question',
            question: 'What unsolved question or design tension are you deliberately leaving open until the next session?',
            hints: [
              'Sentence starter: "I still haven\'t decided between... and..., and here is what each costs:"',
              'Smaller question: Write down two options without picking a winner yet.',
            ],
          },
          {
            topicTag: 'inspiration_source',
            question: 'What reference, tool, or accidental mistake gave you an idea worth keeping?',
            hints: ['Sentence starter: "Something unexpected happened when I..."', 'Smaller question: What almost felt like an error at first?'],
          },
          {
            topicTag: 'next_step',
            question: 'If you only had twenty focused minutes tomorrow, what exact starting action would give you momentum?',
            hints: [
              'Sentence starter: "Tomorrow\'s first concrete step—before checking anything else—is to..."',
              'Smaller question: Make the first step small enough to finish in ten minutes.',
            ],
          },
        ]
      : [
          {
            topicTag: 'sensory_moment',
            question: 'What small sensory detail—a sound, light in the room, or flavor—marked a pause in your day?',
            hints: [
              'Sentence starter: "For a minute today, everything slowed down when I noticed..."',
              'Smaller question: Stick to what you saw or heard, before adding interpretation.',
            ],
          },
          {
            topicTag: 'conversation',
            question: 'What brief exchange or passing remark from someone today stayed in the back of your mind?',
            hints: [
              'Sentence starter: "Someone mentioned... and it made me realize..."',
              'Smaller question: Who did you interact with, even briefly, and what was the tone?',
            ],
          },
          {
            topicTag: 'energy_check',
            question: 'What gave you a quiet lift of energy today, and what quietly drained it?',
            hints: [
              'Sentence starter: "My energy felt clearest right after..."',
              'Smaller question: Compare morning energy with late-afternoon energy in two lines.',
            ],
          },
          {
            topicTag: 'gratitude_concrete',
            question: 'What practical convenience or small kindness made today noticeably smoother than it might have been?',
            hints: [
              'Sentence starter: "Today would have been harder without..."',
              "Smaller question: Name something ordinary you'd miss if it broke tomorrow.",
            ],
          },
          {
            topicTag: 'carry_forward',
            question: "What is one thought or unfinished thread you'd like to set down on paper before tomorrow?",
            hints: [
              'Sentence starter: "The thing still circling in my head tonight is..."',
              "Smaller question: What can wait until morning once it's written down?",
            ],
          },
        ];

  // Only weave in weather/time when explicitly opted in for this project.
  if (ctx.weatherSummary && !isFriend) {
    const w = ctx.weatherSummary.toLowerCase();
    list.splice(1, 0, {
      topicTag: 'weather_atmosphere',
      question: `With ${w} outside, how has the atmosphere shaped your pace or focus today?`,
      hints: [
        `Sentence starter: "Watching the ${w} from indoors made today feel..."`,
        'Smaller question: Did the weather change where you worked or how long you lingered?',
      ],
    });
  } else if (ctx.dateTimeText && !isFriend) {
    list.splice(1, 0, {
      topicTag: 'time_of_day',
      question: `Looking at ${ctx.dateTimeText}, what stands out most about this stretch of the day?`,
      hints: [
        'Sentence starter: "Sitting down at this hour feels like..."',
        'Smaller question: Compare how this hour felt today versus earlier in the week.',
      ],
    });
  }
  return list;
}

function extractKeywords(lower: string, mapping: Record<string, string[]>, defaultList: string[]): string[] {
  const found = Object.entries(mapping)
    .filter(([, cues]) => cues.some((c) => lower.includes(c)))
    .map(([label]) => label);
  return found.length === 0 ? defaultList : found.slice(0, 5);
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
}

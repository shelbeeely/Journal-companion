import type { JournalEntry, JournalProject } from '../../models';
import { addDays, clip, item, isoDate } from '../kit';
import { SourceError, type ContextItem, type SourceConnector } from '../types';

/* --------------------------------- Built-in journal --------------------------------- */

export interface JournalSnapshot {
  projects: JournalProject[];
  entries: JournalEntry[];
}

/** Heuristic "unfinished thought" detector shared by journal drafts and notes. */
export function unfinishedReasons(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  const reasons: string[] = [];
  if (/(\.\.\.|…)\s*$/.test(t)) reasons.push('ends mid-thought');
  if (/- \[ \]/.test(t)) reasons.push('has open checkboxes');
  if (/(^|\s)#(draft|todo|wip|unfinished)\b/i.test(t)) reasons.push('tagged as a draft');
  if (!/[.!?"”)\]]\s*$/.test(t) && t.split(/\s+/).length >= 4 && !reasons.length) reasons.push('trails off without an ending');
  return reasons;
}

export const journal: SourceConnector = {
  id: 'journal',
  label: 'Your journal',
  category: 'memories',
  description: 'Pages, drafts, projects and “on this day” memories from this app.',
  kind: 'builtin',
  credentialFields: [],
  ttlMs: 5 * 60_000,
  privacyNote: 'Always on and never leaves this device unless you allow AI to read it.',
  isConfigured: () => true,
  async sync(ctx) {
    const snap = ctx.config.snapshot as JournalSnapshot | undefined;
    if (!snap) return [];
    const out: ContextItem[] = [];
    const today = isoDate(ctx.now);
    const projectTitle = new Map(snap.projects.map((p) => [p.id, p.title]));
    // Unfinished drafts (not today's page — that's already on the desk).
    for (const e of snap.entries) {
      if (e.dateIso === today || !e.draftText.trim()) continue;
      const reasons = unfinishedReasons(e.draftText);
      const recent = e.dateIso >= isoDate(addDays(ctx.now, -21));
      if ((reasons.length || !e.isCompleted) && recent) {
        out.push(
          item('journal', `draft:${e.id}`, 'thought', clip(e.draftText.replace(/\s+/g, ' '), 120), ctx.now.getTime(), {
            startsAt: e.dateIso,
            allDay: true,
            subtitle: projectTitle.get(e.projectId),
            data: { projectId: e.projectId, entryId: e.id, prompt: e.promptText, completed: e.isCompleted, reasons: reasons.length ? reasons : ['page left open'] },
          }),
        );
      }
    }
    // On this day: 1 week, 1 month, 1 year ago (and older years).
    const anniversaries = new Map<string, string>([
      [isoDate(addDays(ctx.now, -7)), 'One week ago'],
      [isoDate(new Date(ctx.now.getFullYear(), ctx.now.getMonth() - 1, ctx.now.getDate())), 'One month ago'],
    ]);
    for (let y = 1; y <= 10; y++) anniversaries.set(isoDate(new Date(ctx.now.getFullYear() - y, ctx.now.getMonth(), ctx.now.getDate())), y === 1 ? 'One year ago' : `${y} years ago`);
    for (const e of snap.entries) {
      const label = anniversaries.get(e.dateIso);
      if (!label) continue;
      out.push(
        item('journal', `memory:${e.id}`, 'memory', e.draftText.trim() ? clip(e.draftText.replace(/\s+/g, ' '), 140) : e.promptText, ctx.now.getTime(), {
          startsAt: e.dateIso,
          allDay: true,
          subtitle: `${label} · ${projectTitle.get(e.projectId) ?? 'Journal'}`,
          data: { projectId: e.projectId, entryId: e.id, prompt: e.promptText, hasNote: !!e.draftText.trim(), anniversary: label },
        }),
      );
    }
    // Projects with their last activity.
    for (const p of snap.projects) {
      const mine = snap.entries.filter((e) => e.projectId === p.id);
      const last = mine.reduce<string | null>((best, e) => (!best || e.dateIso > best ? e.dateIso : best), null);
      out.push(
        item('journal', `project:${p.id}`, 'project', p.title, ctx.now.getTime(), {
          data: { projectId: p.id, lastActivity: last, pages: mine.filter((e) => e.isCompleted).length, goal: p.writingGoal, cadence: p.cadence },
        }),
      );
    }
    return out;
  },
};

/* ------------------------------- Markdown / Obsidian folder ------------------------------- */

export interface ImportedNote {
  name: string;
  path: string;
  text: string;
  lastModified: number;
}

interface DirHandle {
  name: string;
  kind: 'directory';
  values(): AsyncIterable<{ kind: 'file' | 'directory'; name: string; getFile?: () => Promise<File> } & DirHandle>;
  queryPermission?(o: { mode: 'read' }): Promise<PermissionState>;
}

export async function readNotesFolder(handle: DirHandle, now: Date, maxFiles = 400): Promise<ImportedNote[]> {
  const out: ImportedNote[] = [];
  const cutoff = addDays(now, -45).getTime();
  let seen = 0;
  async function walk(dir: DirHandle, prefix: string, depth: number) {
    if (depth > 4) return;
    for await (const entry of dir.values()) {
      if (seen >= maxFiles) return;
      if (entry.name.startsWith('.')) continue; // .obsidian, .git, …
      if (entry.kind === 'directory') await walk(entry, `${prefix}${entry.name}/`, depth + 1);
      else if (/\.(md|markdown|txt)$/i.test(entry.name) && entry.getFile) {
        seen++;
        const f = await entry.getFile();
        if (f.lastModified < cutoff) continue;
        out.push({ name: entry.name.replace(/\.(md|markdown|txt)$/i, ''), path: `${prefix}${entry.name}`, text: (await f.text()).slice(0, 4000), lastModified: f.lastModified });
      }
    }
  }
  await walk(handle, '', 0);
  return out;
}

export function notesToItems(notes: ImportedNote[], now: Date): ContextItem[] {
  return notes
    .sort((a, b) => b.lastModified - a.lastModified)
    .slice(0, 40)
    .map((n) => {
      const body = n.text.replace(/^---[\s\S]*?---\s*/, ''); // drop front matter
      const reasons = unfinishedReasons(body);
      const lastLine = body.trim().split('\n').filter(Boolean).at(-1) ?? '';
      return item('notes_folder', n.path, 'note', n.name, now.getTime(), {
        startsAt: new Date(n.lastModified).toISOString(),
        subtitle: n.path.includes('/') ? n.path.split('/').slice(0, -1).join('/') : undefined,
        data: { excerpt: clip(lastLine.replace(/^[-*#>\s]+/, ''), 140), reasons, modifiedAt: n.lastModified, openTasks: (body.match(/- \[ \]/g) ?? []).length },
      });
    });
}

export const notesFolder: SourceConnector = {
  id: 'notes_folder',
  label: 'Notes folder (Markdown / Obsidian)',
  category: 'memories',
  description: 'Recently edited notes and unfinished thoughts from a folder of Markdown files.',
  kind: 'device',
  credentialFields: [],
  ttlMs: 15 * 60_000,
  privacyNote: 'Read-only and on-device: files are read locally and never uploaded.',
  limitations: 'Live folder access needs Chrome or Edge on desktop/Android. Elsewhere, import notes as files (re-import to refresh).',
  isConfigured: (c) => !!c.config.handle || ((c.config.imported as ImportedNote[] | undefined) ?? []).length > 0,
  async sync(ctx) {
    const handle = ctx.config.handle as DirHandle | undefined;
    if (handle) {
      const perm = await handle.queryPermission?.({ mode: 'read' });
      if (perm && perm !== 'granted') throw new SourceError('auth', 'Allow access to your notes folder again (tap Reconnect).');
      return notesToItems(await readNotesFolder(handle, ctx.now), ctx.now);
    }
    return notesToItems((ctx.config.imported as ImportedNote[] | undefined) ?? [], ctx.now);
  },
};

/* ------------------------------------- Day One import ------------------------------------- */

export interface DayOneEntry {
  uuid: string;
  date: string; // ISO
  text: string;
  place?: string;
}

/** Parses a Day One JSON export into slim entries (first 400 chars each). */
export function parseDayOne(json: unknown): DayOneEntry[] {
  const entries = (json as { entries?: { uuid?: string; creationDate?: string; text?: string; location?: { placeName?: string; localityName?: string } }[] })?.entries;
  if (!Array.isArray(entries)) throw new SourceError('parse', 'That file isn’t a Day One JSON export.');
  return entries
    .filter((e) => e.creationDate && e.text)
    .map((e) => ({ uuid: e.uuid ?? e.creationDate!, date: e.creationDate!, text: e.text!.replace(/!\[.*?\]\(.*?\)/g, '').trim().slice(0, 400), place: e.location?.placeName ?? e.location?.localityName }));
}

export const dayOne: SourceConnector = {
  id: 'memories_dayone',
  label: 'Day One (import)',
  category: 'memories',
  description: '“On this day” memories from a Day One journal export.',
  kind: 'device',
  credentialFields: [],
  ttlMs: 6 * 3_600_000,
  privacyNote: 'Imported on this device only; nothing is uploaded.',
  limitations: 'Day One has no public API, so export JSON from Day One (File → Export → JSON) and import it here.',
  isConfigured: (c) => ((c.config.entries as DayOneEntry[] | undefined) ?? []).length > 0,
  async sync(ctx) {
    const entries = (ctx.config.entries as DayOneEntry[] | undefined) ?? [];
    const md = `${String(ctx.now.getMonth() + 1).padStart(2, '0')}-${String(ctx.now.getDate()).padStart(2, '0')}`;
    return entries
      .filter((e) => {
        const d = new Date(e.date);
        return d.getFullYear() < ctx.now.getFullYear() && `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` === md;
      })
      .slice(0, 5)
      .map((e) => {
        const years = ctx.now.getFullYear() - new Date(e.date).getFullYear();
        return item('memories_dayone', e.uuid, 'memory', clip(e.text.replace(/\s+/g, ' '), 140), ctx.now.getTime(), {
          startsAt: e.date,
          subtitle: `${years === 1 ? 'One year ago' : `${years} years ago`}${e.place ? ` · ${e.place}` : ''}`,
          data: { anniversary: years === 1 ? 'One year ago' : `${years} years ago`, place: e.place },
        });
      });
  },
};

/* ------------------------------------- Share target ------------------------------------- */

export interface SharedThought {
  id: string;
  at: number;
  title?: string;
  text?: string;
  url?: string;
  thumb?: string;
}

export const shareTarget: SourceConnector = {
  id: 'share_target',
  label: 'Shared to Journal Companion',
  category: 'device',
  description: 'Links, text and photos you share from other apps become thoughts to revisit.',
  kind: 'device',
  credentialFields: [],
  ttlMs: 60_000,
  privacyNote: 'Stays on this device.',
  limitations: 'Requires the installed app on Android or desktop Chrome/Edge. iPhone and iPad don’t support web share targets.',
  isConfigured: () => true,
  async sync(ctx) {
    const thoughts = ((ctx.config.thoughts as SharedThought[] | undefined) ?? []).filter((t) => t.at > addDays(ctx.now, -30).getTime());
    return thoughts.map((t) =>
      item('share_target', t.id, 'thought', t.title || clip(t.text, 100) || t.url || 'Shared item', ctx.now.getTime(), {
        startsAt: new Date(t.at).toISOString(),
        url: t.url,
        imageUrl: t.thumb,
        data: { text: clip(t.text, 280), reasons: ['you shared this to revisit'] },
      }),
    );
  },
};

/* ------------------------------------- Device photos ------------------------------------- */

export interface DevicePhoto {
  id: string;
  name: string;
  takenAt: string | null;
  addedAt: number;
  thumb: string; // small JPEG data URL
  lat?: number | null;
  lon?: number | null;
}

export const devicePhotos: SourceConnector = {
  id: 'photos_device',
  label: 'Photos (from this device)',
  category: 'device',
  description: 'Photos you pick are placed on your day timeline and resurface on this day.',
  kind: 'device',
  credentialFields: [],
  ttlMs: 60 * 60_000,
  privacyNote: 'Only small thumbnails are kept, on this device. Originals are never copied or uploaded. Location is ignored unless you allow it.',
  limitations: 'Browsers can’t read your photo library directly, so pick photos to add.',
  isConfigured: (c) => ((c.config.photos as DevicePhoto[] | undefined) ?? []).length > 0,
  async sync(ctx) {
    const photos = (ctx.config.photos as DevicePhoto[] | undefined) ?? [];
    const today = isoDate(ctx.now);
    const md = today.slice(5);
    return photos
      .filter((p) => {
        const d = p.takenAt ? isoDate(new Date(p.takenAt)) : isoDate(new Date(p.addedAt));
        return d === today || (d.slice(5) === md && d < today) || p.addedAt > addDays(ctx.now, -2).getTime();
      })
      .slice(0, 12)
      .map((p) => {
        const d = p.takenAt ? new Date(p.takenAt) : new Date(p.addedAt);
        const years = ctx.now.getFullYear() - d.getFullYear();
        return item('photos_device', p.id, 'photo', p.name, ctx.now.getTime(), {
          startsAt: d.toISOString(),
          imageUrl: p.thumb,
          subtitle: years > 0 && isoDate(d).slice(5) === md ? (years === 1 ? 'One year ago today' : `${years} years ago today`) : undefined,
          data: { lat: p.lat ?? null, lon: p.lon ?? null, anniversary: years > 0 && isoDate(d).slice(5) === md },
        });
      });
  },
};

/* ------------------------------------- File handling ------------------------------------- */

export const fileOpen: SourceConnector = {
  id: 'files_open',
  label: 'Open files with the app',
  category: 'device',
  description: 'Open .ics, .md and Day One .json files with the installed app to import them.',
  kind: 'device',
  credentialFields: [],
  ttlMs: 24 * 3_600_000,
  privacyNote: 'Files are read on this device.',
  limitations: 'File handling works in the installed app on desktop Chrome/Edge. Elsewhere, use the import buttons.',
  isConfigured: () => true,
  async sync() {
    return [];
  },
};

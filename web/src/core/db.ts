import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { JournalEntry, JournalProject, PromptHistoryItem } from './models';
import type { ContextItem } from './sources/types';

export interface SavedView {
  id: string;
  title: string;
  moment: string;
  savedAt: number;
  /** A2UI messages that recreate the interface exactly as it was saved. */
  messages: Record<string, unknown>[];
  /** Evidence snapshot (so "Why?" still works offline). */
  evidence: { id: string; sourceId: string; title: string; fetchedAt: number }[];
}

export interface FeedbackEvent {
  id?: number;
  /** Suggestion key, e.g. `outing:google:abc`. */
  key: string;
  moment: string;
  action: 'shown' | 'dismissed' | 'snoozed' | 'acted' | 'saved' | 'simplified';
  at: number;
  until?: number;
}

interface JournalDb extends DBSchema {
  projects: { key: number; value: JournalProject };
  entries: {
    key: number;
    value: JournalEntry;
    indexes: { byProject: number; byProjectDate: [number, string] };
  };
  history: {
    key: number;
    value: PromptHistoryItem;
    indexes: { byProject: number };
  };
  kv: { key: string; value: unknown };
  context: { key: string; value: ContextItem; indexes: { bySource: string; byStart: string } };
  savedViews: { key: string; value: SavedView };
  feedback: { key: number; value: FeedbackEvent; indexes: { byKey: string; byMoment: string } };
}

export type JournalDatabase = IDBPDatabase<JournalDb>;

export const DB_NAME = 'journal_companion_local';
export const DB_VERSION = 2;

export function openJournalDb(name = DB_NAME): Promise<JournalDatabase> {
  return openDB<JournalDb>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('projects', { keyPath: 'id', autoIncrement: true });
        const entries = db.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
        entries.createIndex('byProject', 'projectId');
        entries.createIndex('byProjectDate', ['projectId', 'dateIso'], { unique: true });
        const history = db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
        history.createIndex('byProject', 'projectId');
        db.createObjectStore('kv');
      }
      // v2: connected-source context, saved interfaces and suggestion feedback. v1 data is untouched.
      if (oldVersion < 2) {
        const context = db.createObjectStore('context', { keyPath: 'id' });
        context.createIndex('bySource', 'sourceId');
        context.createIndex('byStart', 'startsAt');
        db.createObjectStore('savedViews', { keyPath: 'id' });
        const feedback = db.createObjectStore('feedback', { keyPath: 'id', autoIncrement: true });
        feedback.createIndex('byKey', 'key');
        feedback.createIndex('byMoment', 'moment');
      }
    },
  });
}

/** Strips a zero/absent id so IndexedDB assigns one. */
export function withoutId<T extends { id: number }>(value: T): Omit<T, 'id'> | T {
  if (value.id && value.id > 0) return value;
  const copy = { ...value } as Partial<T>;
  delete copy.id;
  return copy as Omit<T, 'id'>;
}

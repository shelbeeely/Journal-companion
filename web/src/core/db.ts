import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { JournalEntry, JournalProject, PromptHistoryItem } from './models';

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
}

export type JournalDatabase = IDBPDatabase<JournalDb>;

export const DB_NAME = 'journal_companion_local';

export function openJournalDb(name = DB_NAME): Promise<JournalDatabase> {
  return openDB<JournalDb>(name, 1, {
    upgrade(db) {
      db.createObjectStore('projects', { keyPath: 'id', autoIncrement: true });
      const entries = db.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
      entries.createIndex('byProject', 'projectId');
      entries.createIndex('byProjectDate', ['projectId', 'dateIso'], { unique: true });
      const history = db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
      history.createIndex('byProject', 'projectId');
      db.createObjectStore('kv');
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

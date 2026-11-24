import { parseDayOne, type ImportedNote, type SharedThought } from '../core/sources/connectors/local';
import type { ContextStore } from '../core/sources/contextStore';

/** Moves items shared via the Web Share Target (stored by the service worker) into the share source. */
export async function drainShareInbox(store: ContextStore): Promise<number> {
  if (typeof indexedDB === 'undefined') return 0;
  const db = await new Promise<IDBDatabase | null>((resolve) => {
    const req = indexedDB.open('jc-inbox', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('shared', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  if (!db) return 0;
  const records = await new Promise<{ id: string; at: number; title: string; text: string; url: string; images?: Blob[] }[]>((resolve) => {
    const tx = db.transaction('shared', 'readonly');
    const req = tx.objectStore('shared').getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => resolve([]);
  });
  if (!records.length) {
    db.close();
    return 0;
  }
  const cfg = await store.getConfig('share_target');
  const thoughts = ((cfg.thoughts as SharedThought[] | undefined) ?? []).slice();
  for (const r of records) {
    // Some apps put the link in `text`; pull it out so it opens properly.
    const urlInText = !r.url && /https?:\/\/\S+/.exec(r.text)?.[0];
    const thumb = r.images?.[0] ? await thumbnail(r.images[0]).catch(() => undefined) : undefined;
    thoughts.unshift({ id: r.id, at: r.at, title: r.title || undefined, text: urlInText ? r.text.replace(urlInText, '').trim() : r.text || undefined, url: r.url || urlInText || undefined, thumb });
  }
  await store.setConfig('share_target', { ...cfg, thoughts: thoughts.slice(0, 100) });
  await new Promise<void>((resolve) => {
    const tx = db.transaction('shared', 'readwrite');
    records.forEach((r) => tx.objectStore('shared').delete(r.id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();
  return records.length;
}

async function thumbnail(blob: Blob): Promise<string> {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, 240 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.72);
}

interface LaunchParams {
  files: { getFile(): Promise<File> }[];
}

/** Routes files opened with the installed app (File Handling API) to the right importer. */
export function handleLaunchedFiles(store: ContextStore, onImported: (message: string, sourceId: string) => void) {
  const lq = (window as unknown as { launchQueue?: { setConsumer(cb: (p: LaunchParams) => void): void } }).launchQueue;
  if (!lq) return;
  lq.setConsumer(async (params) => {
    for (const h of params.files ?? []) {
      const file = await h.getFile();
      const text = await file.text();
      try {
        if (/\.ics$/i.test(file.name) || text.includes('BEGIN:VCALENDAR')) {
          const cfg = await store.getConfig('calendar_ics');
          await store.setConfig('calendar_ics', { ...cfg, fileText: text, fileName: file.name });
          await store.patchState('calendar_ics', { enabled: true });
          onImported(`Imported ${file.name} into your calendar.`, 'calendar_ics');
        } else if (/\.(md|markdown)$/i.test(file.name)) {
          const cfg = await store.getConfig('notes_folder');
          const imported = ((cfg.imported as ImportedNote[] | undefined) ?? []).filter((n) => n.path !== file.name);
          imported.unshift({ name: file.name.replace(/\.(md|markdown)$/i, ''), path: file.name, text: text.slice(0, 4000), lastModified: file.lastModified });
          await store.setConfig('notes_folder', { ...cfg, imported });
          await store.patchState('notes_folder', { enabled: true });
          onImported(`Added the note “${file.name}”.`, 'notes_folder');
        } else if (/\.json$/i.test(file.name)) {
          const entries = parseDayOne(JSON.parse(text));
          await store.setConfig('memories_dayone', { entries });
          await store.patchState('memories_dayone', { enabled: true });
          onImported(`Imported ${entries.length} Day One entries.`, 'memories_dayone');
        }
      } catch (e) {
        onImported((e as Error).message, '');
      }
    }
  });
}

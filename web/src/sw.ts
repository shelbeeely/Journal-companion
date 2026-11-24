/// <reference lib="webworker" />
/**
 * Journal Companion service worker.
 * - Precaches the app shell (Workbox) for full offline use; updates apply when the user chooses.
 * - Receives Web Share Target POSTs (links, text, photos shared from other apps) and stores them in a
 *   small inbox database that the app drains into the "Shared to Journal Companion" source.
 */
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/share-target/] }));

self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

const INBOX_DB = 'jc-inbox';

function openInbox(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(INBOX_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('shared', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function storeShare(form: FormData) {
  const files = form.getAll('media').filter((f): f is File => f instanceof File && f.size > 0 && f.type.startsWith('image/')).slice(0, 4);
  const record = {
    id: `share:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    title: String(form.get('title') ?? '').slice(0, 300),
    text: String(form.get('text') ?? '').slice(0, 4000),
    url: String(form.get('url') ?? '').slice(0, 2000),
    images: files, // Blobs are structured-cloneable; the app turns them into thumbnails.
  };
  const db = await openInbox();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('shared', 'readwrite');
    tx.objectStore('shared').put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith(
      (async () => {
        try {
          await storeShare(await event.request.formData());
        } catch {
          /* fall through to the app; nothing to store */
        }
        return Response.redirect(new URL('./#/today?shared=1', self.registration.scope).href, 303);
      })(),
    );
  }
});

import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

/** Lets the user apply a new version when they're ready, instead of reloading mid-sentence. */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // Check for updates hourly for long-running desk sessions.
      if (reg) setInterval(() => reg.update().catch(() => undefined), 60 * 60 * 1000);
    },
  });

  useEffect(() => {
    if (!offlineReady) return;
    const t = setTimeout(() => setOfflineReady(false), 4000);
    return () => clearTimeout(t);
  }, [offlineReady, setOfflineReady]);

  if (!needRefresh && !offlineReady) return null;
  return (
    <div className="banner" role="status" style={{ bottom: 'calc(150px + env(safe-area-inset-bottom))' }}>
      <span>{needRefresh ? 'A new version is ready.' : 'Ready to work offline.'}</span>
      {needRefresh && (
        <button className="btn sm" onClick={() => updateServiceWorker(true)}>
          Update
        </button>
      )}
      <button
        className="btn sm"
        onClick={() => {
          setNeedRefresh(false);
          setOfflineReady(false);
        }}
      >
        {needRefresh ? 'Later' : 'OK'}
      </button>
    </div>
  );
}

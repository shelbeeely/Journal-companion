import { useEffect, useState } from 'react';

interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener(type: 'release', cb: () => void): void;
}

/**
 * Keeps the screen awake while `enabled` and the page is visible (Screen Wake Lock API).
 * The browser drops the lock when the tab is hidden, so it is re-acquired on return.
 */
export function useWakeLock(enabled: boolean) {
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!enabled || !supported) return;
    let sentinel: WakeLockSentinelLike | null = null;
    let disposed = false;

    const acquire = async () => {
      if (document.visibilityState !== 'visible' || sentinel) return;
      try {
        const wl = (navigator as unknown as { wakeLock: { request(t: 'screen'): Promise<WakeLockSentinelLike> } }).wakeLock;
        const s = await wl.request('screen');
        if (disposed) {
          s.release();
          return;
        }
        sentinel = s;
        setActive(true);
        s.addEventListener('release', () => {
          sentinel = null;
          setActive(false);
        });
      } catch {
        setActive(false);
      }
    };
    const onVisible = () => document.visibilityState === 'visible' && acquire();

    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisible);
      sentinel?.release().catch(() => undefined);
      sentinel = null;
      setActive(false);
    };
  }, [enabled, supported]);

  return { supported, active };
}

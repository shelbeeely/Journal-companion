import { useEffect, useRef } from 'react';

/** Opens the screen saver after `minutes` without pointer/keyboard activity (0 disables). */
export function useIdle(minutes: number, active: boolean, onIdle: () => void) {
  const cb = useRef(onIdle);
  cb.current = onIdle;
  useEffect(() => {
    if (!active || minutes <= 0) return;
    let timer = setTimeout(() => cb.current(), minutes * 60_000);
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => cb.current(), minutes * 60_000);
    };
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [minutes, active]);
}

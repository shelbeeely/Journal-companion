import { useEffect, useRef, useState } from 'react';
import { cToDisplay, formatDayLong, formatTime } from '../core/time';
import { weatherGlyph } from '../core/weather';
import { useStore } from '../state/store';
import { useWakeLock } from '../state/wakeLock';

/**
 * Ambient desk display (web counterpart of the Android DreamService). Drifts slowly to
 * protect OLED panels, keeps the screen awake, and respects Discreet mode.
 */
export function ScreenSaver({ onExit }: { onExit: () => void }) {
  const { state } = useStore();
  const prefs = state.preferences;
  const [now, setNow] = useState(() => new Date());
  const [pos, setPos] = useState({ left: 10, top: 18 });
  const rootRef = useRef<HTMLDivElement>(null);
  useWakeLock(true);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000);
    const d = setInterval(() => setPos({ left: 4 + Math.random() * 38, top: 6 + Math.random() * 46 }), 45_000);
    rootRef.current?.focus();
    document.documentElement.requestFullscreen?.().catch(() => undefined);
    return () => {
      clearInterval(t);
      clearInterval(d);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => undefined);
    };
  }, []);

  const w = state.weather;
  const c = prefs.useCelsius;
  const full = prefs.screenSaverMode === 'FULL_COMPANION';
  const comp = state.companion;

  return (
    <div
      ref={rootRef}
      className={`screensaver ${prefs.screenSaverDimBrightness ? 'dimmed' : ''}`}
      role="dialog"
      aria-label="Ambient screen saver. Press any key or tap to return."
      tabIndex={-1}
      onClick={onExit}
      onKeyDown={onExit}
      data-testid="screensaver"
    >
      <div className="screensaver-drift" style={{ left: `${pos.left}%`, top: `${pos.top}%` }}>
        <div className="ss-time">{formatTime(now)}</div>
        <div className="ss-muted" style={{ fontSize: '1.1rem', marginTop: 6 }}>
          {formatDayLong(now)}
        </div>
        {w && (
          <div style={{ marginTop: 14, fontSize: '1.05rem' }}>
            <span aria-hidden="true">{weatherGlyph(w.wmoCode, w.isDaytime)} </span>
            {cToDisplay(w.temperatureCelsius, c)}° · {w.conditionLabel}
            <span className="ss-muted"> · H {cToDisplay(w.highCelsius, c)}° L {cToDisplay(w.lowCelsius, c)}°</span>
          </div>
        )}
        {full && comp && state.todayEntry && (
          <div className="ss-card">
            <div className="ss-muted" style={{ fontSize: '0.75rem', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              {state.todayEntry.isCompleted ? "Today's page is done" : "Today's question"}
            </div>
            <p style={{ fontFamily: 'Newsreader, Georgia, serif', fontSize: '1.3rem', margin: '6px 0 10px', lineHeight: 1.35 }}>{state.todayEntry.promptText}</p>
            {!prefs.discreetDeskModeEnabled && <p className="ss-muted" style={{ margin: 0, fontStyle: 'italic' }}>“{comp.starter.starterText}”</p>}
            <p className="ss-muted" style={{ margin: '10px 0 0', fontSize: '0.85rem' }}>{comp.ambient.ambientDetail}</p>
          </div>
        )}
      </div>
    </div>
  );
}

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

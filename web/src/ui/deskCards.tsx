import { useEffect, useState } from 'react';
import { isWeatherStale } from '../core/models';
import { cToDisplay, formatMonthDayTime } from '../core/time';
import { weatherGlyph } from '../core/weather';
import { useStore } from '../state/store';
import { Icon } from './icons';
import { Spinner } from './controls';

export function formatClock(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function FocusTimerCard() {
  const { state, actions } = useStore();
  const t = state.timer;
  const progress = t.totalSeconds > 0 ? (t.totalSeconds - t.remainingSeconds) / t.totalSeconds : 0;
  return (
    <section className="card" aria-labelledby="timer-title" data-testid="focus_timer_card">
      <div className="card-head">
        <h2 className="card-title" id="timer-title">
          Focus Timer
        </h2>
        <span className="badge">{t.phase === 'FOCUS' ? 'Focus sprint' : 'Short break'}</span>
      </div>
      {t.justFinishedPhase && (
        <div className="card primary-soft small spread" style={{ padding: '10px 12px', marginBottom: 12 }} role="status">
          <span>{t.justFinishedPhase === 'FOCUS' ? 'Sprint complete — take a breath.' : 'Break over — back to the page when ready.'}</span>
          <button className="btn text sm" onClick={actions.dismissTimerCompletion}>
            OK
          </button>
        </div>
      )}
      <div className="timer-face">
        <div className="timer-ring" style={{ ['--p' as string]: progress }}>
          <span className="mono" aria-live="off">
            {formatClock(t.remainingSeconds)}
          </span>
        </div>
        <div className="stack" style={{ gap: 8, flex: 1 }}>
          <div className="row" role="group" aria-label="Focus length">
            {[10, 15, 25].map((m) => (
              <button key={m} className="chip" aria-pressed={t.phase === 'FOCUS' && t.presetMinutes === m} onClick={() => actions.selectPreset(m)}>
                {m}m
              </button>
            ))}
            <button className="chip" aria-pressed={t.phase === 'BREAK'} onClick={() => actions.startBreak(5)}>
              5m break
            </button>
          </div>
          <div className="row">
            <button className="btn filled sm" onClick={actions.toggleTimer} data-testid="timer_toggle">
              {t.isRunning ? 'Pause' : 'Start'}
            </button>
            <button className="btn text sm" onClick={actions.resetTimer}>
              Reset
            </button>
          </div>
        </div>
      </div>
      <p className="hint" style={{ margin: '12px 0 0' }}>
        {state.focusBlocksToday} focus block{state.focusBlocksToday === 1 ? '' : 's'} completed today · times sprints only, never your writing
      </p>
    </section>
  );
}

export function DateTimeCard() {
  const { state } = useStore();
  const s = state.snapshot;
  if (!s) return null;
  return (
    <section className="card" aria-labelledby="dt-title">
      <div className="card-head">
        <h2 className="card-title" id="dt-title">
          Time & Daylight
        </h2>
        <span className="eyebrow">{s.dayPartLabel}</span>
      </div>
      <div className="clock-big serif">{s.formattedTime}</div>
      <div className="muted">{s.formattedDate}</div>
      <div className="kv" style={{ marginTop: 12 }}>
        <span>{s.writingWindowCue}</span>
        <span>{s.calendarRhythmLabel}</span>
      </div>
      {s.daylightSummary && (
        <p className="small" style={{ margin: '10px 0 0' }}>
          <Icon name="sun" size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
          {s.daylightSummary}
        </p>
      )}
    </section>
  );
}

export function WeatherCard({ compact = false }: { compact?: boolean }) {
  const { state, actions } = useStore();
  const [city, setCity] = useState(state.preferences.manualCityQuery ?? '');
  const w = state.weather;
  const c = state.preferences.useCelsius;
  const unit = c ? '°C' : '°F';
  const stale = w ? isWeatherStale(w, state.now.getTime()) : false;
  const project = state.activeProject;
  const savedCity = state.preferences.manualCityQuery;
  useEffect(() => {
    if (savedCity) setCity((cur) => cur || savedCity);
  }, [savedCity]);

  return (
    <section className="card" aria-labelledby="weather-title">
      <div className="card-head">
        <h2 className="card-title" id="weather-title">
          Weather
        </h2>
        {w && (
          <button className="icon-btn" aria-label="Refresh weather" onClick={() => (state.preferences.manualCityQuery ? actions.refreshWeatherByCity(state.preferences.manualCityQuery) : actions.refreshWeatherByLocation())}>
            {state.weatherLoading ? <span className="spinner" /> : <Icon name="refresh" />}
          </button>
        )}
      </div>
      {w ? (
        <>
          <div className="row" style={{ gap: 14 }}>
            <span className="weather-glyph" aria-hidden="true">
              {weatherGlyph(w.wmoCode, w.isDaytime)}
            </span>
            <span className="weather-temp serif">
              {cToDisplay(w.temperatureCelsius, c)}
              {unit}
            </span>
            <span className="stack" style={{ gap: 0 }}>
              <b>{w.conditionLabel}</b>
              <span className="small muted">{w.cityLabel}</span>
            </span>
          </div>
          <div className="kv" style={{ marginTop: 12 }}>
            <span>
              H {cToDisplay(w.highCelsius, c)}° / L {cToDisplay(w.lowCelsius, c)}°
            </span>
            {w.feelsLikeCelsius != null && <span>Feels like {cToDisplay(w.feelsLikeCelsius, c)}°</span>}
            {w.windSpeedKmh != null && <span>Wind {c ? `${Math.round(w.windSpeedKmh)} km/h` : `${Math.round(w.windSpeedKmh * 0.621)} mph`}</span>}
            {w.precipitationChancePercent != null && (
              <span>
                {w.precipitationChancePercent}% precip {w.precipitationPeriodLabel ?? ''}
              </span>
            )}
          </div>
          <p className="tiny muted" style={{ margin: '10px 0 0' }}>
            {stale ? (
              <span className="badge warn" data-testid="weather_stale_badge">
                Stale data (cached {formatMonthDayTime(new Date(w.fetchedAtEpochMs))})
              </span>
            ) : (
              <>Updated {formatMonthDayTime(new Date(w.fetchedAtEpochMs))}</>
            )}
          </p>
        </>
      ) : (
        <p className="small muted" style={{ marginTop: 0 }}>
          Add a city or use approximate location. Only the city name or rounded coordinates are sent to Open-Meteo.
        </p>
      )}
      {state.weatherError && (
        <p className="small" style={{ color: 'var(--accent)' }} role="alert">
          {state.weatherError}
        </p>
      )}
      {!compact && (
        <form
          className="row"
          style={{ marginTop: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (city.trim()) actions.refreshWeatherByCity(city);
          }}
        >
          <input className="input" style={{ flex: '1 1 140px', minHeight: 36, padding: '6px 10px' }} aria-label="City" placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} />
          <button className="btn sm" type="submit" disabled={state.weatherLoading || !city.trim()}>
            <Icon name="search" size={16} /> Fetch
          </button>
          <button className="btn text sm" type="button" onClick={actions.refreshWeatherByLocation} disabled={state.weatherLoading}>
            <Icon name="location" size={16} /> Approximate
          </button>
        </form>
      )}
      {project && !compact && (
        <label className="row small" style={{ marginTop: 10, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={project.includeWeatherInPrompt}
            onChange={(e) => actions.updateActiveProject((p) => ({ ...p, includeWeatherInPrompt: e.target.checked }))}
          />
          Include in today's prompt
        </label>
      )}
      <p className="tiny muted" style={{ margin: '10px 0 0' }}>
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer noopener">
          Weather data by Open-Meteo.com
        </a>{' '}
        ·{' '}
        <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer noopener">
          CC BY 4.0
        </a>
      </p>
    </section>
  );
}

/** Web counterpart of the Android A2UI Desk Companion: intent, sparks, pace and ambient cues. */
export function CompanionCard() {
  const { state, actions } = useStore();
  const c = state.companion;
  const project = state.activeProject;
  if (!c || !project) return null;
  if (state.companionDismissed) {
    return (
      <button className="btn outlined" style={{ width: '100%' }} onClick={actions.restoreCompanion}>
        <Icon name="spark" size={16} /> Show Desk Companion
      </button>
    );
  }
  const i = c.intent;
  return (
    <section className="card" aria-labelledby="companion-title" data-testid="desk_companion">
      <div className="card-head">
        <h2 className="card-title" id="companion-title">
          Desk Companion
        </h2>
        <span className="row" style={{ gap: 0 }}>
          <span className="badge" title={c.usedAi ? 'Cues written on-device' : 'Built-in cues'}>
            {c.ambient.engineBadge}
          </span>
          <button className="icon-btn" aria-label="Refresh companion" onClick={actions.refreshCompanion}>
            <Icon name="refresh" size={18} />
          </button>
          <button className="icon-btn" aria-label="Hide companion for this part of the day" onClick={actions.dismissCompanion}>
            <Icon name="close" size={18} />
          </button>
        </span>
      </div>

      {project.showSparksCard && (
        <>
          <div className="eyebrow">{i.eyebrow}</div>
          <p style={{ margin: '4px 0 8px' }}>{i.goal}</p>
          {(i.audience || i.tone) && (
            <div className="row small" style={{ marginBottom: 8 }}>
              {i.audience && <span className="chip static">For: {i.audience}</span>}
              {i.tone && <span className="chip static">{i.tone}</span>}
            </div>
          )}
          {i.boundaries && <p className="small muted" style={{ margin: '0 0 8px' }}>Boundaries: {i.boundaries}</p>}
          {i.briefHighlights && (
            <details className="small">
              <summary className="muted" style={{ cursor: 'pointer' }}>
                Brief highlights
              </summary>
              <p style={{ margin: '6px 0 0' }}>{i.briefHighlights}</p>
            </details>
          )}

          <div className="card tonal" style={{ marginTop: 14, padding: 14 }}>
            <div className="eyebrow">Momentum & Sparks</div>
            <p className="serif" style={{ fontSize: '1.08rem', fontStyle: 'italic', margin: '6px 0' }}>
              “{c.starter.starterText}”
            </p>
            <p className="small" style={{ margin: '0 0 10px' }}>
              <span className="muted">Recall: </span>
              {c.starter.recallQuestion}
            </p>
            <div className="row">
              <button className="btn filled sm" onClick={actions.companionUseStarter}>
                <Icon name="pen" size={16} /> Use starter
              </button>
              <button className="btn sm" onClick={actions.requestHint} disabled={state.isGeneratingHint}>
                Next angle
              </button>
              <button className="btn text sm" onClick={actions.startQuickFocus} disabled={state.timer.isRunning}>
                <Icon name="timer" size={16} /> 10m focus
              </button>
            </div>
            <p className="small" style={{ margin: '12px 0 0' }}>
              <b>{c.starter.continuityTitle}</b>
              <br />
              <span className="muted">{c.starter.continuityBody}</span>
            </p>
          </div>
        </>
      )}

      {project.showRhythmCard && c.pace.show && (
        <div style={{ marginTop: 14 }}>
          <div className="spread small">
            <b>{c.pace.sessionTitle}</b>
            <span className="muted">{c.pace.cadenceSummary}</span>
          </div>
          {c.pace.pageEstimateSummary && <p className="small muted" style={{ margin: '4px 0' }}>{c.pace.pageEstimateSummary}</p>}
          {c.pace.draftProgressLabel && (
            <>
              <div className="progress" aria-label={c.pace.draftProgressLabel}>
                <span style={{ width: `${Math.round(c.pace.progressFraction * 100)}%` }} />
              </div>
              <p className="tiny muted" style={{ margin: '4px 0 0' }}>{c.pace.draftProgressLabel}</p>
            </>
          )}
          {(c.pace.untappedThemes.length > 0 || c.pace.coveredThemes.length > 0) && (
            <div className="theme-chips" style={{ marginTop: 8 }}>
              {c.pace.untappedThemes.map((t) => (
                <span key={t} className="chip static accent" title="Not yet explored">
                  {t}
                </span>
              ))}
              {c.pace.coveredThemes.map((t) => (
                <span key={t} className="chip static" title="Covered recently">
                  <Icon name="check" size={14} /> {t}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="tiny muted" style={{ margin: '14px 0 0' }}>
        {c.ambient.dayWindow} · {c.ambient.ambientDetail}
      </p>
      {state.ai.kind === 'checking' && <Spinner />}
    </section>
  );
}

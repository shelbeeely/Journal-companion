import { lazy, Suspense } from 'react';
import { MOMENT_LABELS, type MomentKind } from '../../core/context/moments';
import { parseLocalDate } from '../../core/time';
import { navigate } from '../../state/router';
import { Icon } from '../icons';

const SnapshotSurface = lazy(() => import('../../a2ui/DeskRuntime').then((m) => ({ default: m.SnapshotSurface })));
import { useStore } from '../../state/store';
import { ProactiveSurface } from '../ProactiveSurface';

export function HistoryScreen({ tab = 'pages' }: { tab?: 'pages' | 'saved' }) {
  const { state, actions, life } = useStore();
  const project = state.activeProject;
  const discreet = state.preferences.discreetDeskModeEnabled;

  return (
    <div className="content-narrow">
      <div className="page-head">
        <div>
          <h1>History</h1>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            Dates, prompts, completion status, and optional digital drafts saved locally.
          </p>
        </div>
        {state.projects.length > 1 && project && (
          <select className="input" style={{ width: 'auto' }} aria-label="Project" value={project.id} onChange={(e) => actions.selectProject(Number(e.target.value))}>
            {state.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="segmented history-tabs" role="tablist" aria-label="History view" style={{ marginBottom: 14 }}>
        <button role="tab" aria-pressed={tab === 'pages'} aria-selected={tab === 'pages'} onClick={() => navigate({ name: 'history' })}>
          Pages
        </button>
        <button role="tab" aria-pressed={tab === 'saved'} aria-selected={tab === 'saved'} onClick={() => navigate({ name: 'history', tab: 'saved' })} data-testid="history_saved_tab">
          Saved ({life.savedViews.length})
        </button>
      </div>

      {tab === 'saved' ? (
        life.savedViews.length === 0 ? (
          <div className="empty card">
            <h2>Nothing saved yet</h2>
            <p className="muted">Tap “Save” on a suggestion card to keep it here, exactly as it was, with its evidence.</p>
          </div>
        ) : (
          <div className="stack">
            {life.savedViews.map((v) => (
              <article key={v.id} className="card now-card saved-card" data-testid="saved_view">
                <div className="spread small muted" style={{ marginBottom: 6 }}>
                  <span>
                    {MOMENT_LABELS[v.moment as MomentKind] ?? v.moment} · data as of {new Date(v.savedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </span>
                  <button className="icon-btn" aria-label={`Delete saved “${v.title}”`} onClick={() => life.deleteView(v.id)}>
                    <Icon name="delete" size={16} />
                  </button>
                </div>
                <Suspense fallback={<p className="serif">{v.title}</p>}>
                  <SnapshotSurface id={v.id} messages={v.messages} />
                </Suspense>
              </article>
            ))}
          </div>
        )
      ) : null}

      {tab === 'pages' && project && state.entries.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <ProactiveSurface kind="context" />
        </div>
      )}

      {tab !== 'pages' ? null : !project || state.entries.length === 0 ? (
        <div className="empty card">
          <h2>No journal entries yet</h2>
          <p className="muted">Create or open a project in Today to record your first page.</p>
          <button className="btn filled" onClick={() => navigate({ name: project ? 'today' : 'newProject' })}>
            {project ? 'Open Today' : 'New project'}
          </button>
        </div>
      ) : (
        <div className="stack">
          {state.entries.map((e) => {
            const d = parseLocalDate(e.dateIso);
            const status = e.isCompleted ? (e.draftText.trim() ? 'Done (with note)' : 'Done on paper') : e.draftText.trim() ? 'Draft saved' : 'Prompt open';
            return (
              <article key={e.id} className="card history-item" data-testid={`history_entry_${e.dateIso}`}>
                <div className="history-date">
                  <div className="tiny muted">{d?.toLocaleDateString(undefined, { month: 'short' })}</div>
                  <div className="d">{d?.getDate()}</div>
                  <div className="tiny muted">{d?.toLocaleDateString(undefined, { weekday: 'short' })}</div>
                </div>
                <div className="stack" style={{ gap: 6, minWidth: 0 }}>
                  <span className={`badge ${e.isCompleted ? '' : 'warn'}`} style={{ alignSelf: 'flex-start' }}>
                    {status}
                  </span>
                  <p className="serif" style={{ margin: 0, fontSize: '1.1rem' }}>
                    {e.promptText}
                  </p>
                  {e.draftText.trim() &&
                    (discreet ? (
                      <p className="small muted" style={{ margin: 0 }}>
                        Note hidden in Discreet mode.
                      </p>
                    ) : (
                      <details className="small">
                        <summary className="muted" style={{ cursor: 'pointer' }}>
                          Saved note
                        </summary>
                        <p style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>{e.draftText}</p>
                      </details>
                    ))}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

import { parseLocalDate } from '../../core/time';
import { navigate } from '../../state/router';
import { useStore } from '../../state/store';
import { ProactiveSurface } from '../ProactiveSurface';

export function HistoryScreen() {
  const { state, actions } = useStore();
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

      {project && state.entries.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <ProactiveSurface kind="context" />
        </div>
      )}

      {!project || state.entries.length === 0 ? (
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

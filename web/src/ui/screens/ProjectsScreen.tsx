import { useState } from 'react';
import { CADENCE_LABELS, estimatedWordsPerPage, type JournalProject } from '../../core/models';
import { navigate } from '../../state/router';
import { useStore } from '../../state/store';
import { Dialog } from '../controls';
import { Icon } from '../icons';
import { ProactiveSurface } from '../ProactiveSurface';

export function ProjectsScreen() {
  const { state, actions } = useStore();
  const [toDelete, setToDelete] = useState<JournalProject | null>(null);

  return (
    <div className="content-inner">
      <div className="page-head">
        <div>
          <h1>Journal Projects</h1>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            Your briefs, notes, and prompts stay strictly on this device.
          </p>
        </div>
        <button className="btn filled" onClick={() => navigate({ name: 'newProject' })} data-testid="fab_new_project">
          <Icon name="add" /> New project
        </button>
      </div>

      {state.projects.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <ProactiveSurface kind="context" />
        </div>
      )}

      {state.projects.length === 0 ? (
        <div className="empty card">
          <h2>No journal projects yet</h2>
          <p className="muted">Start by pasting a brief in your own words, or set up a notebook manually.</p>
          <button className="btn filled" onClick={() => navigate({ name: 'newProject' })} data-testid="projects_empty_create_button">
            New journal project
          </button>
        </div>
      ) : (
        <div className="grid-cards">
          {state.projects.map((p) => {
            const active = p.id === state.activeProject?.id;
            const est = estimatedWordsPerPage(p);
            return (
              <article key={p.id} className={`card project-card ${active ? 'active' : ''}`} data-testid={`project_card_${p.id}`}>
                <div className="spread">
                  <h2 className="serif" style={{ fontSize: '1.3rem', fontWeight: 500 }}>
                    {p.title}
                  </h2>
                  {active && <span className="badge">Active</span>}
                </div>
                <p className="small" style={{ margin: 0 }}>
                  {p.writingGoal}
                </p>
                <div className="row small muted">
                  {p.cadence && <span className="chip static">{CADENCE_LABELS[p.cadence]}</span>}
                  {p.pageSizeLabel && (
                    <span className="chip static">
                      {p.pageSizeLabel}
                      {est ? ` (~${est} w)` : ''}
                    </span>
                  )}
                  {p.audience && !state.preferences.discreetDeskModeEnabled && <span className="chip static">For: {p.audience}</span>}
                </div>
                {p.themes.length > 0 && <p className="tiny muted" style={{ margin: 0 }}>{p.themes.join(' · ')}</p>}
                <div className="row" style={{ marginTop: 'auto' }}>
                  <button
                    className="btn filled sm"
                    onClick={async () => {
                      await actions.selectProject(p.id);
                      navigate({ name: 'today' });
                    }}
                  >
                    Open in Today
                  </button>
                  <button className="btn text sm" onClick={() => navigate({ name: 'editProject', id: p.id })} aria-label={`Edit ${p.title}`}>
                    <Icon name="edit" size={16} /> Edit
                  </button>
                  <button className="btn text sm danger" onClick={() => setToDelete(p)} aria-label={`Delete ${p.title}`}>
                    <Icon name="delete" size={16} /> Delete
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Dialog open={!!toDelete} onClose={() => setToDelete(null)} labelledBy="delete-title">
        <h2 id="delete-title">Delete “{toDelete?.title}”?</h2>
        <p className="muted">This permanently deletes the local brief, prompt history, and saved notes for this project from this device.</p>
        <div className="sheet-actions">
          <button className="btn text" onClick={() => setToDelete(null)}>
            Cancel
          </button>
          <button
            className="btn filled"
            style={{ background: 'var(--accent)' }}
            data-testid="confirm_delete_project"
            onClick={async () => {
              if (toDelete) await actions.deleteProject(toDelete.id);
              setToDelete(null);
            }}
          >
            Delete
          </button>
        </div>
      </Dialog>
    </div>
  );
}

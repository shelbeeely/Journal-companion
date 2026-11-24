import { useEffect, useMemo, useRef, useState } from 'react';
import { beginPkceAuth, connectGoogle, disconnectProvider } from '../../core/sources/auth';
import { itunesSearchPodcasts, tmdbSearch, tvmazeSearch, type FollowedPodcast, type FollowedShow, type WatchlistEntry } from '../../core/sources/connectors/media';
import { parseDayOne, type DevicePhoto, type ImportedNote } from '../../core/sources/connectors/local';
import { readExif } from '../../core/sources/exif';
import { CATEGORY_LABELS, CONNECTORS, CONNECTOR_BY_ID, UNSUPPORTED } from '../../core/sources/registry';
import { isEnabled } from '../../core/sources/sync';
import { DEFAULT_SOURCE_STATE, type SourceCategory, type SourceConnector, type SourceState } from '../../core/sources/types';
import { useStore } from '../../state/store';
import { Spinner, Switch } from '../controls';
import { Icon } from '../icons';

const ENV = import.meta.env as Record<string, string | undefined>;

function ago(ms: number | null): string {
  if (!ms) return 'never';
  const m = Math.round((Date.now() - ms) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

function statusChip(c: SourceConnector, st: SourceState, enabled: boolean) {
  if (!enabled) return <span className="chip static">Off</span>;
  switch (st.status) {
    case 'connected':
      return <span className="badge">Connected · {ago(st.lastSyncAt)}</span>;
    case 'syncing':
      return <span className="badge">Syncing…</span>;
    case 'stale':
      return <span className="badge warn">Showing data from {ago(st.lastSyncAt)}</span>;
    case 'needs_reauth':
      return <span className="badge warn">Needs reconnect</span>;
    case 'error':
      return <span className="badge warn">Problem</span>;
    default:
      return <span className="badge warn">{c.credentialFields.length || c.auth ? 'Needs setup' : 'Waiting'}</span>;
  }
}

async function makeThumb(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = 240 / Math.max(img.width, img.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * Math.min(1, scale)));
    canvas.height = Math.max(1, Math.round(img.height * Math.min(1, scale)));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.72);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function SearchAdd<T>({ placeholder, search, onAdd, label }: { placeholder: string; search: (q: string) => Promise<T[]>; onAdd: (x: T) => void; label: (x: T) => string }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<T[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <form
        className="row"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!q.trim()) return;
          setBusy(true);
          setErr(null);
          try {
            setResults(await search(q.trim()));
          } catch (x) {
            setErr((x as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <input className="input" style={{ flex: '1 1 160px' }} value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} enterKeyHint="search" />
        <button className="btn sm" type="submit" disabled={busy}>
          {busy ? <Spinner /> : <Icon name="search" size={16} />} Search
        </button>
      </form>
      {err && <span className="hint" style={{ color: 'var(--accent)' }}>{err}</span>}
      {results && (
        <div className="row">
          {results.length === 0 && <span className="hint">No matches.</span>}
          {results.map((r, i) => (
            <button
              key={i}
              className="chip"
              onClick={() => {
                onAdd(r);
                setResults(null);
                setQ('');
              }}
            >
              <Icon name="add" size={14} /> {label(r)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ConfigPanel({ c, config, creds, save }: { c: SourceConnector; config: Record<string, unknown>; creds: Record<string, string>; save: (cfg: Record<string, unknown>) => Promise<void> }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const list = <T,>(k: string) => (config[k] as T[] | undefined) ?? [];

  if (c.id === 'media_tmdb') {
    const wl = list<WatchlistEntry>('watchlist');
    return (
      <div className="stack" style={{ gap: 6 }}>
        <span className="label small">Your watchlist (stored on this device)</span>
        <div className="row">
          {wl.map((w) => (
            <button key={`${w.type}${w.id}`} className="chip selected" onClick={() => save({ ...config, watchlist: wl.filter((x) => x !== w) })} aria-label={`Remove ${w.title}`}>
              {w.title} <Icon name="close" size={12} />
            </button>
          ))}
          {!wl.length && <span className="hint">Add titles you want to watch; trending titles are included automatically.</span>}
        </div>
        {creds.token?.trim() ? (
          <SearchAdd<WatchlistEntry> placeholder="Find a movie or show" search={(q) => tmdbSearch((...a) => fetch(...a), creds.token, q)} label={(r) => `${r.title} (${r.type === 'tv' ? 'TV' : 'film'})`} onAdd={(r) => save({ ...config, watchlist: [...wl, r] })} />
        ) : (
          <span className="hint">Save your TMDB token to search.</span>
        )}
      </div>
    );
  }
  if (c.id === 'media_tvmaze') {
    const f = list<FollowedShow>('followed');
    return (
      <div className="stack" style={{ gap: 6 }}>
        <span className="label small">Shows you follow</span>
        <div className="row">
          {f.map((s) => (
            <button key={s.id} className="chip selected" onClick={() => save({ ...config, followed: f.filter((x) => x.id !== s.id) })} aria-label={`Unfollow ${s.name}`}>
              {s.name} <Icon name="close" size={12} />
            </button>
          ))}
        </div>
        <SearchAdd<FollowedShow> placeholder="Find a show to follow" search={(q) => tvmazeSearch((...a) => fetch(...a), q)} label={(r) => r.name} onAdd={(r) => save({ ...config, followed: [...f, r] })} />
      </div>
    );
  }
  if (c.id === 'podcasts_itunes') {
    const f = list<FollowedPodcast>('followed');
    return (
      <div className="stack" style={{ gap: 6 }}>
        <span className="label small">Podcasts you follow</span>
        <div className="row">
          {f.map((p) => (
            <button key={p.collectionId} className="chip selected" onClick={() => save({ ...config, followed: f.filter((x) => x.collectionId !== p.collectionId) })} aria-label={`Unfollow ${p.name}`}>
              {p.name} <Icon name="close" size={12} />
            </button>
          ))}
        </div>
        <SearchAdd<FollowedPodcast> placeholder="Find a podcast" search={(q) => itunesSearchPodcasts((...a) => fetch(...a), q)} label={(r) => r.name} onAdd={(r) => save({ ...config, followed: [...f, r] })} />
      </div>
    );
  }
  if (c.id === 'calendar_ics') {
    return (
      <div className="stack" style={{ gap: 6 }}>
        <div className="row">
          <button className="btn sm" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={16} /> Import .ics file
          </button>
          {typeof config.fileName === 'string' && (
            <span className="small muted">
              Imported: {config.fileName}{' '}
              <button className="btn text sm" onClick={() => save({ ...config, fileText: undefined, fileName: undefined })}>
                Remove
              </button>
            </span>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".ics,text/calendar"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const text = await f.text();
            if (!text.includes('BEGIN:VCALENDAR')) setMsg('That file isn’t an .ics calendar.');
            else await save({ ...config, fileText: text, fileName: f.name });
            e.target.value = '';
          }}
        />
        {msg && <span className="hint">{msg}</span>}
      </div>
    );
  }
  if (c.id === 'notes_folder') {
    const hasPicker = 'showDirectoryPicker' in window;
    const imported = list<ImportedNote>('imported');
    return (
      <div className="stack" style={{ gap: 6 }}>
        <div className="row">
          {hasPicker && (
            <button
              className="btn sm"
              onClick={async () => {
                try {
                  const handle = await (window as unknown as { showDirectoryPicker(o: { mode: 'read' }): Promise<unknown> }).showDirectoryPicker({ mode: 'read' });
                  await save({ ...config, handle, imported: [] });
                } catch {
                  /* cancelled */
                }
              }}
            >
              <Icon name="projects" size={16} /> {config.handle ? 'Choose a different folder' : 'Choose notes folder'}
            </button>
          )}
          {config.handle != null && hasPicker ? (
            <button
              className="btn text sm"
              onClick={async () => {
                const h = config.handle as { requestPermission?(o: { mode: 'read' }): Promise<PermissionState> };
                await h.requestPermission?.({ mode: 'read' });
                await save({ ...config });
              }}
            >
              Re-allow access
            </button>
          ) : null}
          <button className="btn sm" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={16} /> Import notes
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          multiple
          hidden
          onChange={async (e) => {
            const files = [...(e.target.files ?? [])];
            const notes: ImportedNote[] = [];
            for (const f of files.slice(0, 300)) notes.push({ name: f.name.replace(/\.(md|markdown|txt)$/i, ''), path: f.name, text: (await f.text()).slice(0, 4000), lastModified: f.lastModified });
            await save({ ...config, handle: undefined, imported: notes });
            e.target.value = '';
          }}
        />
        {imported.length > 0 && <span className="hint">{imported.length} notes imported. Re-import to refresh.</span>}
      </div>
    );
  }
  if (c.id === 'memories_dayone') {
    const n = list<unknown>('entries').length;
    return (
      <div className="row">
        <button className="btn sm" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={16} /> Import Day One JSON
        </button>
        {n > 0 && <span className="small muted">{n} entries imported</span>}
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              await save({ ...config, entries: parseDayOne(JSON.parse(await f.text())) });
              setMsg(null);
            } catch (x) {
              setMsg((x as Error).message);
            }
            e.target.value = '';
          }}
        />
        {msg && <span className="hint">{msg}</span>}
      </div>
    );
  }
  if (c.id === 'photos_device') {
    const photos = list<DevicePhoto>('photos');
    return (
      <div className="stack" style={{ gap: 6 }}>
        <div className="row">
          <button className="btn sm" onClick={() => fileRef.current?.click()}>
            <Icon name="add" size={16} /> Add photos
          </button>
          <label className="row small" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={!!config.useLocation} onChange={(e) => save({ ...config, useLocation: e.target.checked })} /> Use photo location (rounded)
          </label>
        </div>
        {photos.length > 0 && (
          <div className="row">
            {photos.slice(0, 8).map((p) => (
              <img key={p.id} src={p.thumb} alt={p.name} className="conn-thumb" />
            ))}
            <span className="hint">{photos.length} photos</span>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={async (e) => {
            const out: DevicePhoto[] = [];
            for (const f of [...(e.target.files ?? [])].slice(0, 40)) {
              const exif = f.type === 'image/jpeg' ? readExif(await f.slice(0, 256 * 1024).arrayBuffer()) : { takenAt: null, lat: null, lon: null };
              out.push({ id: `${f.name}:${f.lastModified}`, name: f.name.replace(/\.[^.]+$/, ''), takenAt: exif.takenAt ?? new Date(f.lastModified).toISOString(), addedAt: Date.now(), thumb: await makeThumb(f), lat: config.useLocation ? exif.lat : null, lon: config.useLocation ? exif.lon : null });
            }
            await save({ ...config, photos: [...out, ...photos].slice(0, 200) });
            e.target.value = '';
          }}
        />
      </div>
    );
  }
  if (c.id === 'share_target') {
    const n = list<unknown>('thoughts').length;
    return <p className="hint">Use your device’s Share menu → Journal Companion. {n ? `${n} shared items so far.` : ''}</p>;
  }
  return null;
}

function ConnectorCard({ c, focused }: { c: SourceConnector; focused: boolean }) {
  const { life } = useStore();
  const store = life.contextStore;
  const st = { ...DEFAULT_SOURCE_STATE, ...(life.states[c.id] ?? {}) };
  const enabled = isEnabled(c.id, life.states);
  const [open, setOpen] = useState(focused);
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [authed, setAuthed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);
  const authKey = c.auth ? `auth:${c.auth}` : null;

  // Load fields when the card opens — not on every state change, or background syncs would wipe typing.
  useEffect(() => {
    if (!open) return;
    (async () => {
      const [cr, cfg, authCreds] = await Promise.all([store.getCredentials(c.id), store.getConfig(c.id), authKey ? store.getCredentials(authKey) : Promise.resolve({} as Record<string, string>)]);
      const merged: Record<string, string> = { ...cr };
      for (const f of c.credentialFields) if (!merged[f.key]) merged[f.key] = (f.key === 'clientId' || f.key === 'relayUrl' ? authCreds[f.key] : undefined) ?? (f.envVar ? ENV[f.envVar] ?? '' : '');
      setCreds(merged);
      setSaved(cr);
      setConfig(cfg);
    })();
  }, [open, c.id, store, authKey, c.credentialFields]);

  // Signed-in state can change after OAuth or sign-out; refresh just that.
  const statusKey = `${st.status}:${st.lastSyncAt}`;
  useEffect(() => {
    if (open && c.auth) store.getAuth(c.auth).then((t) => setAuthed(!!t));
  }, [open, c.auth, store, statusKey]);

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [focused]);

  const patch = (p: Partial<SourceState>) => store.patchState(c.id, p);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const saveCreds = () =>
    run(async () => {
      const clean = Object.fromEntries(Object.entries(creds).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
      await store.setCredentials(c.id, clean);
      setSaved(clean);
      await patch({ enabled: true });
      await life.syncOne(c.id);
    });
  const saveConfig = async (cfg: Record<string, unknown>) => {
    setConfig(cfg);
    await store.setConfig(c.id, cfg);
    await patch({ enabled: true });
    await life.syncOne(c.id);
  };
  const connectAuth = () =>
    run(async () => {
      const clientId = (creds.clientId ?? '').trim();
      await patch({ enabled: true });
      await store.setCredentials(c.id, { ...saved, clientId, ...(creds.relayUrl?.trim() ? { relayUrl: creds.relayUrl.trim() } : {}) });
      // Request every scope this provider's enabled connectors need, plus this one.
      const scopes = Array.from(new Set(CONNECTORS.filter((x) => x.auth === c.auth && (x.id === c.id || isEnabled(x.id, life.states))).flatMap((x) => x.scopes ?? [])));
      if (c.auth === 'google') {
        await connectGoogle(store, clientId, scopes, creds.relayUrl);
        await life.syncNow(CONNECTORS.filter((x) => x.auth === 'google' && (x.id === c.id || isEnabled(x.id, life.states))).map((x) => x.id));
      } else if (c.auth) {
        await beginPkceAuth(c.auth, clientId, c.auth === 'microsoft' ? ['offline_access', 'User.Read', ...scopes] : scopes);
      }
    });

  const fieldsUnsaved = c.credentialFields.some((f) => (creds[f.key] ?? '') !== (saved[f.key] ?? '') && !(f.key === 'clientId' && c.auth));
  const count = st.itemCount;

  return (
    <article ref={ref} className={`card conn-card ${focused ? 'focused' : ''}`} id={`conn-${c.id}`} data-testid={`conn_${c.id}`}>
      <div className="conn-head">
        <button className="conn-title" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="stack" style={{ gap: 2, alignItems: 'flex-start' }}>
            <b>{c.label}</b>
            <span className="tiny muted">{c.description}</span>
          </span>
        </button>
        <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
          {statusChip(c, st, enabled)}
          <input
            type="checkbox"
            role="switch"
            className="switch"
            aria-label={`${c.label} on`}
            checked={enabled}
            onChange={async (e) => {
              await patch({ enabled: e.target.checked, status: e.target.checked ? st.status : 'disconnected' });
              if (e.target.checked) {
                setOpen(true);
                life.syncOne(c.id);
              }
            }}
          />
        </div>
      </div>
      {enabled && st.error && st.status !== 'connected' && (
        <p className="small conn-error" role="alert">
          {st.error}
        </p>
      )}
      {open && (
        <div className="stack conn-body">
          {c.credentialFields.map((f) => (
            <label key={f.key} className="field">
              <span className="label">
                {f.label}
                {f.optional ? ' (optional)' : ''}
              </span>
              <input
                className="input"
                type={f.type === 'secret' ? 'password' : f.type === 'url' ? 'url' : 'text'}
                autoComplete="off"
                spellCheck={false}
                placeholder={f.placeholder}
                value={creds[f.key] ?? ''}
                onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })}
              />
              {f.help && <span className="hint">{f.help}</span>}
            </label>
          ))}
          <div className="row">
            {c.auth ? (
              <>
                <button className="btn filled sm" onClick={connectAuth} disabled={busy || !creds.clientId?.trim()}>
                  {busy ? <Spinner /> : null} {authed ? (st.status === 'needs_reauth' ? 'Reconnect' : 'Reconnect / add access') : `Connect ${c.auth[0].toUpperCase()}${c.auth.slice(1)}`}
                </button>
                {authed && (
                  <button
                    className="btn text sm"
                    onClick={() =>
                      run(async () => {
                        await disconnectProvider(store, c.auth!);
                        for (const x of CONNECTORS.filter((x) => x.auth === c.auth)) {
                          await store.patchState(x.id, { enabled: false, status: 'disconnected' });
                          await store.clearItems(x.id);
                        }
                        setAuthed(false);
                      })
                    }
                  >
                    Sign out of {c.auth}
                  </button>
                )}
              </>
            ) : c.credentialFields.length ? (
              <button className="btn filled sm" onClick={saveCreds} disabled={busy || !fieldsUnsaved}>
                {busy ? <Spinner /> : null} Save & sync
              </button>
            ) : null}
            {enabled && (
              <button
                className="btn sm"
                onClick={() =>
                  run(async () => {
                    // A tap is when an expired Google token may be renewed (no consent screen).
                    if (c.auth === 'google' && (await life.renewGoogleFromGesture())) return;
                    await life.syncOne(c.id);
                  })
                }
                disabled={busy || st.status === 'syncing'}
              >
                <Icon name="refresh" size={16} /> Sync now
              </button>
            )}
            {count > 0 && <span className="small muted">{count} items</span>}
          </div>
          <ConfigPanel c={c} config={config} creds={saved} save={saveConfig} />
          {err && (
            <p className="small conn-error" role="alert">
              {err}
            </p>
          )}
          <div className="conn-toggles">
            <Switch label="Use for suggestions" checked={st.useForSuggestions} onChange={(v) => patch({ useForSuggestions: v })} />
            <Switch
              label="Allow AI to read"
              description="Off by default. When on and AI is connected, short facts from this source may be sent to OpenRouter to write a labelled interpretation."
              checked={st.shareWithAi}
              onChange={(v) => patch({ shareWithAi: v })}
            />
          </div>
          <p className="hint" style={{ margin: 0 }}>
            <Icon name="eyeOff" size={12} /> {c.privacyNote}
          </p>
          {c.limitations && <p className="hint" style={{ margin: 0 }}>Limits: {c.limitations}</p>}
          <div className="row">
            {c.helpUrl && (
              <a className="btn text sm" href={c.helpUrl} target="_blank" rel="noreferrer noopener">
                Where do I get this?
              </a>
            )}
            {count > 0 && (
              <button className="btn text sm danger" onClick={() => run(() => store.clearItems(c.id))}>
                Clear cached data
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

export function ConnectionsScreen({ focus }: { focus?: string }) {
  const { life } = useStore();
  const [q, setQ] = useState('');
  const [knowledge, setKnowledge] = useState<Record<string, number>>({});
  useEffect(() => {
    life.contextStore.knowledgeSummary().then(setKnowledge);
  }, [life.items, life.contextStore]);
  const groups = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const match = (c: SourceConnector) => !ql || `${c.label} ${c.description} ${CATEGORY_LABELS[c.category]}`.toLowerCase().includes(ql);
    const by = new Map<SourceCategory, SourceConnector[]>();
    for (const c of CONNECTORS.filter(match)) by.set(c.category, [...(by.get(c.category) ?? []), c]);
    return [...by.entries()];
  }, [q]);
  const connected = CONNECTORS.filter((c) => isEnabled(c.id, life.states) && life.states[c.id]?.status === 'connected').length;
  const totalItems = Object.values(knowledge).reduce((a, b) => a + b, 0);

  return (
    <div className="content-narrow stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <button className="btn text sm" onClick={() => history.back()} style={{ marginLeft: -10 }}>
            ← Settings
          </button>
          <h1>Connections</h1>
          <p className="small muted" style={{ margin: '4px 0 0' }}>
            {connected} of {CONNECTORS.length} sources connected. Data is fetched straight from each service to this device. There’s no Journal Companion server.
          </p>
        </div>
        <button className="btn sm" onClick={() => life.syncNow()} disabled={life.syncing}>
          {life.syncing ? <Spinner /> : <Icon name="refresh" size={16} />} Sync all
        </button>
      </div>

      <section className="card tonal">
        <h2>What the companion knows</h2>
        <p className="small muted">
          {totalItems} items cached on this device from {Object.keys(knowledge).length} sources. Tokens and keys are never included in backups or sent anywhere except their own service.
        </p>
        <div className="row">
          {Object.entries(knowledge)
            .sort((a, b) => b[1] - a[1])
            .map(([id, n]) => (
              <span key={id} className="chip static">
                {CONNECTOR_BY_ID.get(id)?.label.replace(/ \(.*\)$/, '') ?? id} · {n}
              </span>
            ))}
        </div>
        {totalItems > 0 && (
          <button className="btn text sm danger" style={{ marginTop: 8 }} onClick={() => life.contextStore.clearItems()}>
            Clear all cached data
          </button>
        )}
      </section>

      <input className="input" placeholder="Search sources (e.g. calendar, music, Notion)" aria-label="Search sources" value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" />

      {groups.map(([cat, list]) => (
        <section key={cat} className="stack" style={{ gap: 8 }}>
          <h2 className="conn-cat">{CATEGORY_LABELS[cat]}</h2>
          {list.map((c) => (
            <ConnectorCard key={c.id} c={c} focused={focus === c.id} />
          ))}
        </section>
      ))}

      <section className="card">
        <h2>Not available in a web app</h2>
        <p className="small muted">These need native apps or a server to keep secrets, so they aren’t offered rather than half-working.</p>
        <ul className="small conn-unsupported">
          {UNSUPPORTED.filter((u) => !q || `${u.label} ${u.reason}`.toLowerCase().includes(q.toLowerCase())).map((u) => (
            <li key={u.id}>
              <b>{u.label}</b> — <span className="muted">{u.reason}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

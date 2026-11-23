import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { JournalAiOrchestrator } from './core/ai/orchestrator';
import { BrowserPromptAiClient } from './core/ai/onDeviceAi';
import { openJournalDb } from './core/db';
import { JournalRepository } from './core/repository';
import { AppStoreProvider } from './state/store';
import { App } from './ui/App';
import './styles.css';

async function boot() {
  const root = createRoot(document.getElementById('root')!);
  try {
    const db = await openJournalDb();
    const repo = new JournalRepository(db, new JournalAiOrchestrator(new BrowserPromptAiClient()));
    // Ask the browser not to evict the journal under storage pressure (granted automatically for installed apps).
    navigator.storage?.persist?.().catch(() => undefined);
    root.render(
      <StrictMode>
        <AppStoreProvider repo={repo}>
          <App />
        </AppStoreProvider>
      </StrictMode>,
    );
  } catch (e) {
    root.render(
      <div className="empty">
        <h1>Storage unavailable</h1>
        <p className="muted">
          Journal Companion keeps everything on this device and needs browser storage (IndexedDB). It may be blocked in a private window or by site settings.
        </p>
        <p className="tiny muted">{String((e as Error)?.message ?? e)}</p>
      </div>,
    );
  }
}

boot();

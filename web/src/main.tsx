import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { JournalAiOrchestrator } from './core/ai/orchestrator';
import { OpenRouterClient, completeOpenRouterOAuth } from './core/ai/openRouterClient';
import { openJournalDb } from './core/db';
import { JournalRepository } from './core/repository';
import { AppStoreProvider } from './state/store';
import { App } from './ui/App';
import './styles.css';

async function boot() {
  const root = createRoot(document.getElementById('root')!);
  try {
    const db = await openJournalDb();
    // The repository and AI layer reference each other lazily: the client reads the key from the
    // repository, and the orchestrator asks it whether Discreet mode is on before sending context.
    let repo: JournalRepository | null = null;
    const client = new OpenRouterClient({ getAiSettings: () => repo!.getAiSettings() });
    repo = new JournalRepository(db, new JournalAiOrchestrator(client, () => repo?.isDiscreet() ?? true));
    await repo.getPreferences();

    // Returning from "Connect OpenRouter"? Exchange the one-time code for this user's key.
    let oauthMessage: string | null = null;
    try {
      const key = await completeOpenRouterOAuth();
      if (key) {
        await repo.updateAiSettings({ apiKey: key, connectedVia: 'oauth' });
        oauthMessage = 'OpenRouter connected. Review what gets sent to turn AI on.';
      }
    } catch (e) {
      oauthMessage = (e as Error).message;
    }

    navigator.storage?.persist?.().catch(() => undefined);
    root.render(
      <StrictMode>
        <AppStoreProvider repo={repo} initialBanner={oauthMessage}>
          <App />
        </AppStoreProvider>
      </StrictMode>,
    );
  } catch (e) {
    root.render(
      <div className="empty">
        <h1>Storage unavailable</h1>
        <p className="muted">
          Journal Companion keeps your journal on this device and needs browser storage (IndexedDB). It may be blocked in a private window or by site settings.
        </p>
        <p className="tiny muted">{String((e as Error)?.message ?? e)}</p>
      </div>,
    );
  }
}

boot();

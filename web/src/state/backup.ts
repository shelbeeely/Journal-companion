import type { JournalRepository } from '../core/repository';
import { localDateIso } from '../core/time';

/** Saves a JSON backup of everything (except the AI key) as a local download. */
export async function downloadBackup(repo: JournalRepository) {
  const bundle = await repo.exportAll();
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `journal-companion-backup-${localDateIso()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

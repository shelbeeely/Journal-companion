import { addDays, bearer, fetchJson, item, requireField, startOfDay } from '../kit';
import type { ContextItem, SourceConnector } from '../types';
import { GOOGLE_CLIENT_FIELD, GOOGLE_RELAY_FIELD, MS_CLIENT_FIELD } from './calendars';

const recentCutoff = (now: Date, days = 14) => addDays(now, -days).getTime();
const isToday = (iso: string | undefined | null, now: Date) => !!iso && new Date(iso).getTime() >= startOfDay(now).getTime();

/* --------------------------------- Google Tasks --------------------------------- */

interface GTaskLists {
  items?: { id: string; title: string }[];
}
interface GTasks {
  items?: { id: string; title?: string; notes?: string; due?: string; status?: string; completed?: string; webViewLink?: string; deleted?: boolean }[];
}

export const googleTasks: SourceConnector = {
  id: 'tasks_google',
  label: 'Google Tasks',
  category: 'tasks',
  description: 'Open tasks and what you completed today.',
  kind: 'network',
  auth: 'google',
  scopes: ['https://www.googleapis.com/auth/tasks.readonly'],
  credentialFields: [GOOGLE_CLIENT_FIELD, GOOGLE_RELAY_FIELD],
  ttlMs: 20 * 60_000,
  privacyNote: 'Read-only. Task titles, due dates and notes come straight from Google to this device.',
  isConfigured: (c) => !!c.accessToken,
  async sync(ctx) {
    const h = { headers: bearer(ctx.accessToken!), label: 'Google Tasks' };
    const lists = await fetchJson<GTaskLists>(ctx.fetch, 'https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=20', h);
    const out: ContextItem[] = [];
    for (const l of (lists.items ?? []).slice(0, 10)) {
      const t = await fetchJson<GTasks>(ctx.fetch, `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(l.id)}/tasks?showCompleted=true&showHidden=true&maxResults=100`, h);
      for (const task of t.items ?? []) {
        if (task.deleted || !task.title?.trim()) continue;
        const done = task.status === 'completed';
        if (done && !isToday(task.completed, ctx.now)) continue;
        out.push(
          item('tasks_google', task.id, 'task', task.title, ctx.now.getTime(), {
            startsAt: task.due ? task.due.slice(0, 10) : undefined,
            allDay: true,
            done,
            url: task.webViewLink,
            subtitle: l.title,
            data: { list: l.title, notes: task.notes?.slice(0, 200), completedAt: task.completed },
          }),
        );
      }
    }
    return out;
  },
};

/* ------------------------------- Microsoft To Do ------------------------------- */

interface MsLists {
  value?: { id: string; displayName: string }[];
}
interface MsTasks {
  value?: { id: string; title: string; status: string; importance?: string; dueDateTime?: { dateTime: string }; completedDateTime?: { dateTime: string } }[];
}

export const microsoftTodo: SourceConnector = {
  id: 'tasks_microsoft',
  label: 'Microsoft To Do',
  category: 'tasks',
  description: 'Open tasks and today’s completions from Microsoft To Do.',
  kind: 'network',
  auth: 'microsoft',
  scopes: ['Tasks.Read'],
  credentialFields: [MS_CLIENT_FIELD],
  ttlMs: 20 * 60_000,
  privacyNote: 'Read-only, fetched from Microsoft Graph to this device.',
  isConfigured: (c) => !!c.accessToken,
  async sync(ctx) {
    const h = { headers: bearer(ctx.accessToken!), label: 'Microsoft To Do' };
    const lists = await fetchJson<MsLists>(ctx.fetch, 'https://graph.microsoft.com/v1.0/me/todo/lists', h);
    const out: ContextItem[] = [];
    for (const l of (lists.value ?? []).slice(0, 10)) {
      const t = await fetchJson<MsTasks>(ctx.fetch, `https://graph.microsoft.com/v1.0/me/todo/lists/${encodeURIComponent(l.id)}/tasks?$top=60`, h);
      for (const task of t.value ?? []) {
        const done = task.status === 'completed';
        const completedAt = task.completedDateTime?.dateTime ? `${task.completedDateTime.dateTime.replace(/\.\d+$/, '')}Z` : undefined;
        if (done && !isToday(completedAt, ctx.now)) continue;
        out.push(
          item('tasks_microsoft', task.id, 'task', task.title, ctx.now.getTime(), {
            startsAt: task.dueDateTime?.dateTime?.slice(0, 10),
            allDay: true,
            done,
            subtitle: l.displayName,
            data: { list: l.displayName, important: task.importance === 'high', completedAt },
          }),
        );
      }
    }
    return out;
  },
};

/* ----------------------------------- Todoist ----------------------------------- */

interface TodoistTask {
  id: string;
  content: string;
  description?: string;
  project_id?: string;
  priority?: number;
  due?: { date?: string; datetime?: string; is_recurring?: boolean } | null;
  completed_at?: string;
}

export const todoist: SourceConnector = {
  id: 'tasks_todoist',
  label: 'Todoist',
  category: 'tasks',
  description: 'Active tasks, projects and today’s completions.',
  kind: 'network',
  credentialFields: [{ key: 'token', label: 'API token', type: 'secret', help: 'Todoist → Settings → Integrations → Developer.' }],
  ttlMs: 15 * 60_000,
  privacyNote: 'Read-only. Your token is sent only to Todoist.',
  helpUrl: 'https://app.todoist.com/app/settings/integrations/developer',
  isConfigured: (c) => !!c.credentials.token?.trim(),
  async sync(ctx) {
    const h = { headers: bearer(requireField(ctx.credentials, 'token', 'Todoist API token')), label: 'Todoist' };
    const base = 'https://api.todoist.com/api/v1';
    const [tasks, projects] = await Promise.all([
      fetchJson<{ results?: TodoistTask[] } | TodoistTask[]>(ctx.fetch, `${base}/tasks?limit=200`, h),
      fetchJson<{ results?: { id: string; name: string }[] } | { id: string; name: string }[]>(ctx.fetch, `${base}/projects?limit=200`, h),
    ]);
    const projectList = Array.isArray(projects) ? projects : (projects.results ?? []);
    const pname = new Map(projectList.map((p) => [p.id, p.name]));
    const since = startOfDay(ctx.now).toISOString();
    const until = addDays(startOfDay(ctx.now), 1).toISOString();
    const completed = await fetchJson<{ items?: TodoistTask[] }>(ctx.fetch, `${base}/tasks/completed/by_completion_date?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&limit=100`, h).catch(() => ({ items: [] as TodoistTask[] }));
    const active = Array.isArray(tasks) ? tasks : (tasks.results ?? []);
    const toItem = (t: TodoistTask, done: boolean) =>
      item('tasks_todoist', t.id, 'task', t.content, ctx.now.getTime(), {
        startsAt: t.due?.datetime ?? t.due?.date,
        allDay: !t.due?.datetime,
        done,
        url: `https://app.todoist.com/app/task/${t.id}`,
        subtitle: t.project_id ? pname.get(t.project_id) : undefined,
        data: { project: t.project_id ? pname.get(t.project_id) : undefined, priority: t.priority, recurring: t.due?.is_recurring, completedAt: t.completed_at },
      });
    const projItems = projectList.slice(0, 30).map((p) => item('tasks_todoist', `project:${p.id}`, 'project', p.name, ctx.now.getTime(), { data: { openTasks: active.filter((t) => t.project_id === p.id).length } }));
    return [...active.map((t) => toItem(t, false)), ...(completed.items ?? []).map((t) => toItem(t, true)), ...projItems];
  },
};

/* ------------------------------------ Trello ------------------------------------ */

interface TrelloCard {
  id: string;
  name: string;
  due?: string | null;
  dueComplete?: boolean;
  idBoard: string;
  shortUrl?: string;
  dateLastActivity?: string;
}
interface TrelloBoard {
  id: string;
  name: string;
  url?: string;
  dateLastActivity?: string;
}

export const trello: SourceConnector = {
  id: 'tasks_trello',
  label: 'Trello',
  category: 'tasks',
  description: 'Cards assigned to you and your recently active boards.',
  kind: 'network',
  credentialFields: [
    { key: 'key', label: 'API key', type: 'text', help: 'From trello.com/power-ups/admin → your Power-Up → API key.' },
    { key: 'token', label: 'Token', type: 'secret', help: 'Generate a token from the same page (read access).' },
  ],
  ttlMs: 20 * 60_000,
  privacyNote: 'Read-only. Your key and token are sent only to Trello.',
  helpUrl: 'https://trello.com/power-ups/admin',
  isConfigured: (c) => !!c.credentials.key?.trim() && !!c.credentials.token?.trim(),
  async sync(ctx) {
    const auth = `key=${encodeURIComponent(requireField(ctx.credentials, 'key', 'Trello API key'))}&token=${encodeURIComponent(requireField(ctx.credentials, 'token', 'Trello token'))}`;
    const [cards, boards] = await Promise.all([
      fetchJson<TrelloCard[]>(ctx.fetch, `https://api.trello.com/1/members/me/cards?filter=open&fields=name,due,dueComplete,idBoard,shortUrl,dateLastActivity&${auth}`, { label: 'Trello' }),
      fetchJson<TrelloBoard[]>(ctx.fetch, `https://api.trello.com/1/members/me/boards?filter=open&fields=name,url,dateLastActivity&${auth}`, { label: 'Trello' }),
    ]);
    const bname = new Map(boards.map((b) => [b.id, b.name]));
    return [
      ...cards.map((c) =>
        item('tasks_trello', c.id, 'task', c.name, ctx.now.getTime(), {
          startsAt: c.due ?? undefined,
          done: !!c.dueComplete,
          url: c.shortUrl,
          subtitle: bname.get(c.idBoard),
          data: { project: bname.get(c.idBoard), lastActivity: c.dateLastActivity },
        }),
      ),
      ...boards
        .filter((b) => b.dateLastActivity && new Date(b.dateLastActivity).getTime() > recentCutoff(ctx.now, 30))
        .map((b) => item('tasks_trello', `board:${b.id}`, 'project', b.name, ctx.now.getTime(), { url: b.url, data: { lastActivity: b.dateLastActivity, openTasks: cards.filter((c) => c.idBoard === b.id).length } })),
    ];
  },
};

/* ------------------------------------ GitHub ------------------------------------ */

interface GhIssue {
  id: number;
  number: number;
  title: string;
  html_url: string;
  updated_at: string;
  pull_request?: unknown;
  repository?: { full_name: string };
}
interface GhRepo {
  id: number;
  full_name: string;
  name: string;
  description?: string | null;
  html_url: string;
  pushed_at: string;
}

export const github: SourceConnector = {
  id: 'projects_github',
  label: 'GitHub',
  category: 'tasks',
  description: 'Issues and pull requests assigned to you, and repositories you pushed to recently.',
  kind: 'network',
  credentialFields: [{ key: 'token', label: 'Fine-grained personal access token (read-only)', type: 'secret', help: 'Grant read access to Issues, Pull requests and Metadata.' }],
  ttlMs: 30 * 60_000,
  privacyNote: 'Read-only. Your token is sent only to GitHub.',
  helpUrl: 'https://github.com/settings/personal-access-tokens/new',
  isConfigured: (c) => !!c.credentials.token?.trim(),
  async sync(ctx) {
    const h = { headers: { ...bearer(requireField(ctx.credentials, 'token', 'GitHub token')), Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, label: 'GitHub' };
    const [issues, repos] = await Promise.all([
      fetchJson<GhIssue[]>(ctx.fetch, 'https://api.github.com/issues?filter=assigned&state=open&per_page=30', h),
      fetchJson<GhRepo[]>(ctx.fetch, 'https://api.github.com/user/repos?sort=pushed&per_page=12&affiliation=owner,collaborator', h),
    ]);
    return [
      ...issues.map((i) =>
        item('projects_github', `issue:${i.id}`, 'task', i.title, ctx.now.getTime(), {
          url: i.html_url,
          subtitle: `${i.repository?.full_name ?? ''} #${i.number}`,
          data: { project: i.repository?.full_name, kind: i.pull_request ? 'pull request' : 'issue', updatedAt: i.updated_at },
        }),
      ),
      ...repos
        .filter((r) => new Date(r.pushed_at).getTime() > recentCutoff(ctx.now, 60))
        .map((r) => item('projects_github', `repo:${r.id}`, 'project', r.name, ctx.now.getTime(), { url: r.html_url, subtitle: r.description ?? undefined, data: { fullName: r.full_name, lastActivity: r.pushed_at } })),
    ];
  },
};

/* ------------------------------------- Files ------------------------------------- */

interface DriveFiles {
  files?: { id: string; name: string; mimeType?: string; modifiedTime: string; webViewLink?: string }[];
}

export const googleDrive: SourceConnector = {
  id: 'files_gdrive',
  label: 'Google Drive',
  category: 'files',
  description: 'Recently edited files (names and dates only) to help you pick projects back up.',
  kind: 'network',
  auth: 'google',
  scopes: ['https://www.googleapis.com/auth/drive.metadata.readonly'],
  credentialFields: [GOOGLE_CLIENT_FIELD, GOOGLE_RELAY_FIELD],
  ttlMs: 60 * 60_000,
  privacyNote: 'Metadata only (file names, types and edit times). File contents are never read.',
  isConfigured: (c) => !!c.accessToken,
  async sync(ctx) {
    const since = new Date(recentCutoff(ctx.now, 21)).toISOString();
    const q = encodeURIComponent(`trashed=false and modifiedTime > '${since}' and mimeType != 'application/vnd.google-apps.folder'`);
    const res = await fetchJson<DriveFiles>(ctx.fetch, `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=modifiedTime%20desc&pageSize=25&fields=files(id,name,mimeType,modifiedTime,webViewLink)`, { headers: bearer(ctx.accessToken!), label: 'Google Drive' });
    return (res.files ?? []).map((f) => item('files_gdrive', f.id, 'file', f.name, ctx.now.getTime(), { url: f.webViewLink, data: { modifiedAt: f.modifiedTime, mimeType: f.mimeType } }));
  },
};

interface OneDriveRecent {
  value?: { id: string; name: string; webUrl?: string; lastModifiedDateTime?: string; remoteItem?: { lastModifiedDateTime?: string; webUrl?: string } }[];
}

export const oneDrive: SourceConnector = {
  id: 'files_onedrive',
  label: 'OneDrive',
  category: 'files',
  description: 'Recently used files from OneDrive (names and dates only).',
  kind: 'network',
  auth: 'microsoft',
  scopes: ['Files.Read'],
  credentialFields: [MS_CLIENT_FIELD],
  ttlMs: 60 * 60_000,
  privacyNote: 'Metadata only. File contents are never read.',
  isConfigured: (c) => !!c.accessToken,
  async sync(ctx) {
    const res = await fetchJson<OneDriveRecent>(ctx.fetch, 'https://graph.microsoft.com/v1.0/me/drive/recent?$top=25', { headers: bearer(ctx.accessToken!), label: 'OneDrive' });
    return (res.value ?? []).map((f) =>
      item('files_onedrive', f.id, 'file', f.name, ctx.now.getTime(), { url: f.webUrl ?? f.remoteItem?.webUrl, data: { modifiedAt: f.lastModifiedDateTime ?? f.remoteItem?.lastModifiedDateTime } }),
    );
  },
};

interface DropboxList {
  entries?: { '.tag': string; id: string; name: string; path_display?: string; server_modified?: string }[];
}

export const dropbox: SourceConnector = {
  id: 'files_dropbox',
  label: 'Dropbox',
  category: 'files',
  description: 'Recently changed files in your Dropbox (names and dates only).',
  kind: 'network',
  auth: 'dropbox',
  scopes: ['files.metadata.read'],
  credentialFields: [{ key: 'clientId', label: 'Dropbox app key', type: 'text', envVar: 'VITE_DROPBOX_APP_KEY', help: 'Create a scoped app in the Dropbox App Console with this site as a redirect URI.' }],
  ttlMs: 60 * 60_000,
  privacyNote: 'Metadata only (file names and change times). File contents are never read.',
  helpUrl: 'https://www.dropbox.com/developers/apps',
  isConfigured: (c) => !!c.accessToken,
  async sync(ctx) {
    const res = await fetchJson<DropboxList>(ctx.fetch, 'https://api.dropboxapi.com/2/files/list_folder', {
      method: 'POST',
      headers: { ...bearer(ctx.accessToken!), 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '', recursive: true, limit: 500, include_deleted: false }),
      label: 'Dropbox',
    });
    const cutoff = recentCutoff(ctx.now, 21);
    return (res.entries ?? [])
      .filter((e) => e['.tag'] === 'file' && e.server_modified && new Date(e.server_modified).getTime() > cutoff)
      .sort((a, b) => (b.server_modified ?? '').localeCompare(a.server_modified ?? ''))
      .slice(0, 25)
      .map((e) => item('files_dropbox', e.id, 'file', e.name, ctx.now.getTime(), { data: { modifiedAt: e.server_modified, path: e.path_display } }));
  },
};

/* ------------------------------------ Habitica ------------------------------------ */

interface HabiticaTasks {
  data?: { id: string; type: string; text: string; completed?: boolean; isDue?: boolean; streak?: number; date?: string | null }[];
}

export const habitica: SourceConnector = {
  id: 'habits_habitica',
  label: 'Habitica',
  category: 'habits',
  description: 'Today’s dailies, habits and streaks.',
  kind: 'network',
  credentialFields: [
    { key: 'userId', label: 'User ID', type: 'text', help: 'Habitica → Settings → Site Data.' },
    { key: 'apiToken', label: 'API token', type: 'secret' },
  ],
  ttlMs: 20 * 60_000,
  privacyNote: 'Read-only. Credentials are sent only to Habitica.',
  helpUrl: 'https://habitica.com/user/settings/siteData',
  isConfigured: (c) => !!c.credentials.userId?.trim() && !!c.credentials.apiToken?.trim(),
  async sync(ctx) {
    const userId = requireField(ctx.credentials, 'userId', 'Habitica user ID');
    const res = await fetchJson<HabiticaTasks>(ctx.fetch, 'https://habitica.com/api/v3/tasks/user', {
      headers: { 'x-api-user': userId, 'x-api-key': requireField(ctx.credentials, 'apiToken', 'Habitica API token'), 'x-client': `${userId}-JournalCompanion` },
      label: 'Habitica',
    });
    return (res.data ?? [])
      .filter((t) => t.type === 'daily' || t.type === 'habit' || (t.type === 'todo' && !t.completed))
      .slice(0, 60)
      .map((t) =>
        item('habits_habitica', t.id, t.type === 'todo' ? 'task' : 'habit', t.text, ctx.now.getTime(), {
          done: !!t.completed,
          startsAt: t.date ?? undefined,
          data: { habitType: t.type, isDue: t.isDue, streak: t.streak },
        }),
      );
  },
};

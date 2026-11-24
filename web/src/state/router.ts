import { useEffect, useState } from 'react';

export type Route =
  | { name: 'today' }
  | { name: 'projects' }
  | { name: 'newProject' }
  | { name: 'editProject'; id: number }
  | { name: 'history'; tab?: 'pages' | 'saved' }
  | { name: 'settings' }
  | { name: 'connections'; focus?: string };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '') || '/today';
  const edit = /^\/projects\/(\d+)\/edit$/.exec(path);
  if (edit) return { name: 'editProject', id: Number(edit[1]) };
  const conn = /^\/settings\/connections(?:\/([\w-]+))?$/.exec(path);
  if (conn) return { name: 'connections', focus: conn[1] };
  if (path === '/history/saved') return { name: 'history', tab: 'saved' };
  switch (path) {
    case '/projects':
      return { name: 'projects' };
    case '/projects/new':
      return { name: 'newProject' };
    case '/history':
      return { name: 'history' };
    case '/settings':
      return { name: 'settings' };
    default:
      return { name: 'today' };
  }
}

export function hrefFor(route: Route): string {
  switch (route.name) {
    case 'editProject':
      return `#/projects/${route.id}/edit`;
    case 'newProject':
      return '#/projects/new';
    case 'connections':
      return route.focus ? `#/settings/connections/${route.focus}` : '#/settings/connections';
    case 'history':
      return route.tab === 'saved' ? '#/history/saved' : '#/history';
    default:
      return `#/${route.name}`;
  }
}

export function navigate(route: Route) {
  window.location.hash = hrefFor(route);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

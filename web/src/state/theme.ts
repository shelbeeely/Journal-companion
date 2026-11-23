import { useEffect, useState } from 'react';
import type { AppThemeMode } from '../core/models';

function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const on = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return dark;
}

export function useEffectiveDark(mode: AppThemeMode, dim: boolean): boolean {
  const systemDark = useSystemDark();
  if (dim || mode === 'DARK') return true;
  if (mode === 'LIGHT') return false;
  return systemDark;
}

const THEME_COLOR = { light: '#F3EFE7', dark: '#1A1816', dim: '#100E0C' } as const;

/** Applies the theme to <html> and keeps the browser/OS title bar colour in sync. */
export function useApplyTheme(mode: AppThemeMode, dim: boolean) {
  const dark = useEffectiveDark(mode, dim);
  const theme = dim ? 'dim' : dark ? 'dark' : 'light';
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = THEME_COLOR[theme];
    document.head.appendChild(meta);
  }, [theme]);
}

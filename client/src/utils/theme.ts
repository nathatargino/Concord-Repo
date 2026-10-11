export type ThemeMode = 'dark' | 'light';

const THEME_KEY = 'concord_theme';

export function getStoredTheme(): ThemeMode {
  try {
    const val = localStorage.getItem(THEME_KEY);
    if (val === 'light' || val === 'dark') return val;
  } catch {}
  return 'dark';
}

export function applyTheme(theme: ThemeMode) {
  try {
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.setAttribute('data-theme', theme);
    document.body.setAttribute('data-theme', theme);
    window.dispatchEvent(new CustomEvent('concord:theme-changed', { detail: { theme } }));
  } catch (err) {
    console.warn('Error applying theme:', err);
  }
}

export function toggleTheme(): ThemeMode {
  const current = getStoredTheme();
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}

export function initTheme(): ThemeMode {
  const current = getStoredTheme();
  applyTheme(current);
  return current;
}

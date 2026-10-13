export type ThemeMode = 'dark' | 'light';

const THEME_KEY = 'concord_theme';

export function getStoredTheme(): ThemeMode {
  try {
    const val = localStorage.getItem(THEME_KEY);
    if (val === 'light') return 'light';
  } catch {}
  return 'dark';
}

export function applyTheme(theme: ThemeMode) {
  try {
    const effectiveTheme: ThemeMode = theme === 'light' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, effectiveTheme);
    document.documentElement.setAttribute('data-theme', effectiveTheme);
    if (document.body) {
      document.body.setAttribute('data-theme', effectiveTheme);
    }
    window.dispatchEvent(new CustomEvent('concord:theme-changed', { detail: { theme: effectiveTheme } }));
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

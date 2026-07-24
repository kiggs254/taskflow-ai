// Light/dark theming.
//
// The whole palette is defined as CSS variables in index.css (a `.light` class on
// <html> flips them), so switching themes is just toggling that one class -- every
// existing Tailwind colour class re-themes without touching a line of JSX. This module
// owns the class toggle and the persisted preference; nothing else needs to know.

export type Theme = 'dark' | 'light';

const KEY = 'taskflow_theme';

/** The saved preference, defaulting to dark (the app's original look). */
export const getStoredTheme = (): Theme => {
  try {
    const t = localStorage.getItem(KEY);
    if (t === 'light' || t === 'dark') return t;
  } catch {
    /* localStorage unavailable */
  }
  return 'dark';
};

/** Apply a theme to the document and persist it. Safe to call before React mounts. */
export const applyTheme = (theme: Theme): void => {
  document.documentElement.classList.toggle('light', theme === 'light');
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore */
  }
};

export const THEME_STORAGE_KEY = 'theme';

export type ThemePreference = 'light' | 'dark';

/**
 * Runs in <head> before first paint so the page never flashes the wrong colour
 * scheme: a remembered pick wins, otherwise the computer's light/dark setting.
 */
export const THEME_INIT_SCRIPT = `(function () {
  try {
    var stored = window.localStorage.getItem('${THEME_STORAGE_KEY}');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var useDark = stored === 'dark' || (stored !== 'light' && prefersDark);
    document.documentElement.classList.toggle('dark', useDark);
  } catch (error) {
    document.documentElement.classList.remove('dark');
  }
})();`;

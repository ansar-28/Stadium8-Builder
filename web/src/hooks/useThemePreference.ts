'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { THEME_STORAGE_KEY, type ThemePreference } from '@/lib/theme';

const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';
const THEME_CHANGE_EVENT = 'theme-preference-change';

// Used only when browser storage is unavailable, so a pick still applies for this visit.
let unsavedPreference: ThemePreference | null = null;

function readStoredPreference(): ThemePreference | null {
  try {
    const storedValue = window.localStorage.getItem(THEME_STORAGE_KEY);
    return storedValue === 'light' || storedValue === 'dark'
      ? storedValue
      : unsavedPreference;
  } catch {
    return unsavedPreference;
  }
}

function systemMediaQuery(): MediaQueryList | null {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia(SYSTEM_DARK_QUERY)
    : null;
}

function isDarkSnapshot(): boolean {
  const storedPreference = readStoredPreference();
  if (storedPreference) return storedPreference === 'dark';
  return systemMediaQuery()?.matches ?? false;
}

function isDarkOnServer(): boolean {
  return false;
}

function subscribe(onChange: () => void): () => void {
  const mediaQuery = systemMediaQuery();
  mediaQuery?.addEventListener('change', onChange);
  window.addEventListener('storage', onChange);
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  return () => {
    mediaQuery?.removeEventListener('change', onChange);
    window.removeEventListener('storage', onChange);
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
  };
}

/**
 * Light/dark for the whole app: a remembered pick wins, otherwise the
 * computer's setting (followed live). Keeps `.dark` on <html> in step so
 * every token-styled surface switches without a reload.
 */
export function useThemePreference(): {
  isDark: boolean;
  choosePreference: (preference: ThemePreference) => void;
} {
  const isDark = useSyncExternalStore(
    subscribe,
    isDarkSnapshot,
    isDarkOnServer,
  );

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  const choosePreference = useCallback((preference: ThemePreference) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      unsavedPreference = preference;
    }
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }, []);

  return { isDark, choosePreference };
}

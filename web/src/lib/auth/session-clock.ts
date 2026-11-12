/**
 * Client-side record of when the user signed in, used to end the session 8 hours later.
 * Only a timestamp is stored — never the session token, which stays in its HttpOnly cookie.
 */
export const SIGNED_IN_AT_STORAGE_KEY = 'signedInAt';

/**
 * Last user activity in any open tab. Sign-out ends the one shared server session,
 * so every tab measures idleness from the most recent activity across all of them.
 */
export const LAST_ACTIVITY_AT_STORAGE_KEY = 'lastActivityAt';

/** Warning appears after this long without activity. */
export const IDLE_WARNING_AFTER_MS = 14 * 60 * 1000;

/** The idle session ends this long after the last activity (60 seconds after the warning). */
export const IDLE_SIGN_OUT_AFTER_MS = 15 * 60 * 1000;

/** The session ends this long after sign-in, whatever the activity. */
export const ABSOLUTE_SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;

export function recordSignInTime(signedInAt: number = Date.now()): void {
  try {
    window.localStorage.setItem(SIGNED_IN_AT_STORAGE_KEY, String(signedInAt));
  } catch {
    // Storage can be unavailable (private mode, blocked); the session clock then starts on load.
  }
}

export function readSignInTime(): number | null {
  try {
    const storedValue = window.localStorage.getItem(SIGNED_IN_AT_STORAGE_KEY);
    if (storedValue === null) return null;
    const signedInAt = Number(storedValue);
    return Number.isFinite(signedInAt) ? signedInAt : null;
  } catch {
    return null;
  }
}

export function clearSignInTime(): void {
  try {
    window.localStorage.removeItem(SIGNED_IN_AT_STORAGE_KEY);
    window.localStorage.removeItem(LAST_ACTIVITY_AT_STORAGE_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

export function recordLastActivityTime(
  lastActivityAt: number = Date.now(),
): void {
  try {
    window.localStorage.setItem(
      LAST_ACTIVITY_AT_STORAGE_KEY,
      String(lastActivityAt),
    );
  } catch {
    // Storage unavailable: each tab falls back to its own activity only.
  }
}

export function readLastActivityTime(): number | null {
  try {
    const storedValue = window.localStorage.getItem(
      LAST_ACTIVITY_AT_STORAGE_KEY,
    );
    if (storedValue === null) return null;
    const lastActivityAt = Number(storedValue);
    return Number.isFinite(lastActivityAt) ? lastActivityAt : null;
  } catch {
    return null;
  }
}

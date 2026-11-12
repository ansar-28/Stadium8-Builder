/**
 * Application Constants Template
 *
 * Define your application-specific constants here
 * Examples include API configuration, UI settings, and business logic constants
 */

/**
 * API calls are same-origin: the browser only ever calls this app's own
 * `/v1/auth/*` and `/transactions-api/*` paths, and the rewrites in
 * `next.config.ts` forward them to the backends. Keeping the backends' origins
 * server-side means no CORS and the HttpOnly session cookie stays first-party.
 */
export const API_BASE_URL = '';

/**
 * Default pagination settings
 * Customize based on your application's needs
 */
export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 25,
  PAGE_SIZE_OPTIONS: [10, 25, 50, 100],
} as const;

/**
 * Toast notification settings
 */
export const TOAST_SETTINGS = {
  DEFAULT_DURATION: 5000, // 5 seconds
  SUCCESS_DURATION: 3000, // 3 seconds
  ERROR_DURATION: 7000, // 7 seconds
  MAX_TOASTS: 3,
} as const;

/**
 * Modal settings
 */
export const MODAL_SETTINGS = {
  ANIMATION_DURATION: 150, // 150ms for enter/exit animations
} as const;

// Add your application-specific constants below
// Example:
// export const DATE_FORMATS = {
//   DISPLAY: 'dd MMM yyyy',
//   API: 'yyyy-MM-dd',
// } as const;

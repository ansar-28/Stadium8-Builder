# Architecture & Reuse Registry
> One line per durable thing. Edit the line when it changes; delete it when the thing is gone.
> No story narrative, no dates, no rationale.

## Shared utilities & components
| Export | Location | Capability |
|---|---|---|
| `login`, `logout`, `getUserInfo`, transaction-service endpoint functions | `web/src/lib/api/endpoints.ts` | Typed calls over the API client; transactions paths carry the `/transactions-api` prefix |
| `SESSION_COOKIE_NAME`, `SIGN_IN_PATH`, `HOME_PATH` | `web/src/lib/auth/session-constants.ts` | Session cookie name and the sign-in / post-sign-in routes |
| `SessionProvider`, `useSignedInUser()` | `web/src/contexts/SessionContext.tsx` | Signed-in user's userinfo (name, `Roles[]`) for any screen inside the `(app)` route group |
| `(app)` layout | `web/src/app/(app)/layout.tsx` | Protected route group: re-checks userinfo on every screen load, loading placeholder (`role="status"` "Loading…"), redirects to `/sign-in` on failure |
| `SignInForm` | `web/src/components/auth/SignInForm.tsx` | Sign in form: required check, generic failure message, password show/hide |
| `signInSchema`, `SIGN_IN_REQUIRED_MESSAGE` | `web/src/lib/validation/schemas.ts` | Sign-in validation (blank after trim = missing) |
| `THEME_STORAGE_KEY`, `THEME_INIT_SCRIPT` | `web/src/lib/theme.ts` | Remembered light/dark pick (`localStorage`), applied as `.dark` on `<html>` before paint; falls back to the system setting |

## Conventions
- Browser API calls are same-origin (`API_BASE_URL = ''`): `next.config.ts` rewrites `/v1/auth/*` to `AUTH_API_BASE_URL` and `/transactions-api/*` to `TRANSACTIONS_API_BASE_URL` (server-side env vars, never `NEXT_PUBLIC_`).
- `web/src/proxy.ts` redirects requests without a `session` cookie to `/sign-in` (cookie presence only); session validity is checked client-side by the `(app)` layout so Playwright `page.route()` can mock it.
- Every signed-in screen lives under `web/src/app/(app)/`; public screens (Sign in) live outside it and must be excluded in the proxy matcher.
- Design tokens in `globals.css` include `primary-hover` (button hover fill), `destructive-text` (error text — `destructive` is a fill only, it fails as text in dark mode), and `brand` / `brand-foreground` (header identity colour, both modes).

## Cross-epic debt
- None.

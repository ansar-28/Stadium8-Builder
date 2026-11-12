# Architecture & Reuse Registry
> One line per durable thing. Edit the line when it changes; delete it when the thing is gone.
> No story narrative, no dates, no rationale.

## Shared utilities & components
| Export | Location | Capability |
|---|---|---|
| `login`, `logout`, `getUserInfo`, transaction-service endpoint functions | `web/src/lib/api/endpoints.ts` | Typed calls over the API client; transactions paths carry the `/transactions-api` prefix |
| `SESSION_COOKIE_NAME`, `SIGN_IN_PATH`, `HOME_PATH` | `web/src/lib/auth/session-constants.ts` | Session cookie name and the sign-in / post-sign-in routes |
| `SessionProvider`, `useSignedInUser()` | `web/src/contexts/SessionContext.tsx` | Signed-in user's userinfo (name, `Roles[]`) for any screen inside the `(app)` route group |
| `(app)` layout | `web/src/app/(app)/layout.tsx` | Protected route group: re-checks userinfo on every screen load, loading placeholder (`role="status"` "Loading…"), redirects to `/sign-in` on 401/403 only; other failures show an `alert` card with "Retry" (no protected content, no redirect); renders `AppHeader` above `<main>` and mounts `SessionTimeout` once confirmed |
| `useSignOut()` | `web/src/hooks/useSignOut.ts` | Single sign-out path: logout, clears the stored sign-in time, pushes `/sign-in`; returns `'signed-out' \| 'failed' \| 'already-signing-out'` and `isSigningOut` — callers report failure their own way |
| `recordSignInTime`, `readSignInTime`, `clearSignInTime`, `recordLastActivityTime`, `readLastActivityTime`, idle / absolute timeout constants | `web/src/lib/auth/session-clock.ts` | Sign-in and last-activity timestamps in `localStorage` (`signedInAt`, `lastActivityAt` — shared across tabs, never the token; `clearSignInTime` clears both); 14 min warning, 15 min idle end, 8 h absolute end |
| `SessionTimeout` | `web/src/components/layout/SessionTimeout.tsx` | Idle tracker (document mouse/key/touch/scroll activity, measured from the latest activity in any tab; activity elsewhere closes an open warning) + 8 h cap; non-dismissable warning dialog "Stay signed in" (focused) / "Sign out"; signs out via `useSignOut` |
| `Dialog` family (Shadcn) | `web/src/components/ui/dialog.tsx` | Modal primitive on `@radix-ui/react-dialog`; `DialogContent` takes `showCloseButton` |
| `SignInForm` | `web/src/components/auth/SignInForm.tsx` | Sign in form: required check, generic failure message, password show/hide |
| `signInSchema`, `SIGN_IN_REQUIRED_MESSAGE` | `web/src/lib/validation/schemas.ts` | Sign-in validation (blank after trim = missing) |
| `THEME_STORAGE_KEY`, `THEME_INIT_SCRIPT` | `web/src/lib/theme.ts` | Remembered light/dark pick (`localStorage`), applied as `.dark` on `<html>` before paint; falls back to the system setting |
| `useThemePreference()` | `web/src/hooks/useThemePreference.ts` | Live light/dark state (pick wins, else system, followed live); `choosePreference()` saves the pick and restyles the app without reload |
| `FILE_IMPORTER_ROLE_NAME`, `APPROVER_ROLE_NAME`, `hasRole`, `roleNamesOf`, `displayNameOf` | `web/src/lib/auth/roles.ts` | Role checks and display name (FirstName + LastName) from userinfo — use for every role-based hiding |
| `AppHeader` | `web/src/components/layout/AppHeader.tsx` | Brand header: product name, `MainNav`, user name, role chips (`list` "Roles"), `ThemeSwitch`; `actions` slot for extra right-hand controls |
| `MainNav`, `MAIN_NAVIGATION_ITEMS` | `web/src/components/layout/MainNav.tsx` | Nav landmark "Main"; role-gated items (Upload = File Importer); `aria-current="page"` on the active route |
| `SignOutButton` | `web/src/components/layout/SignOutButton.tsx` | Header "Sign out" over `useSignOut()`: "Signing out…" + disabled while pending, persistent error toast "Sign-out failed" on failure; rendered by the `(app)` layout in `AppHeader`'s `actions` |
| `ThemeSwitch` | `web/src/components/layout/ThemeSwitch.tsx` | Header switch "Dark mode" |
| `PageHeader` | `web/src/components/layout/PageHeader.tsx` | Screen title (h1) + muted description + optional right-aligned action |
| `ToastProvider`, `useToast()`, `ToastContainer` | `web/src/contexts/ToastContext.tsx`, `web/src/components/toast/` | Notifications: bottom-right polite region "Notifications", each a `status` with "Dismiss notification"; non-errors fade after 5 s, errors persist until closed and have a red left edge; optional `action` (`{ label, onAction }`, e.g. "Try again") renders a button that closes the toast and runs it. Mounted by the root layout — tests rendering the `(app)` layout must wrap it in `ToastProvider` |
| `serverMessageOf(error)` | `web/src/lib/api/errors.ts` | The server's own wording for a failed API call (`DefaultResponse.Messages` via the client error's `details`), with a non-blaming fallback |
| `saveBlobAsFile(blob, fileName)` | `web/src/lib/download.ts` | Saves downloaded bytes to the user's computer under a file name (blob URL + `download` anchor) |
| `formatDateTime`, `dateTimeSortValue` | `web/src/lib/format/date-time.ts` | Server date-time shown as `YYYY-MM-DD HH:mm` with no time-zone shift; numeric sort key (unreadable = oldest) |
| `TablePagination`, `pageOf`, `pageCountOf`, `PAGE_SIZE_OPTIONS`, `DEFAULT_PAGE_SIZE` | `web/src/components/data-table/TablePagination.tsx` | Client-side table footer: "Showing n of total <noun>", "Rows per page" select (5/10/20/50, default 20), "Previous" / "Page n of m" / "Next" (disabled at the ends) |
| `Table` family, `Select` family (Shadcn) | `web/src/components/ui/table.tsx`, `web/src/components/ui/select.tsx` | Table primitives; Select on `@radix-ui/react-select` (name the trigger with `aria-labelledby`) |
| `UploadedFiles` | `web/src/components/files/UploadedFiles.tsx` | Uploaded files screen: `GET /v1/file-logs?IsActive=Yes`, newest first, paginated, per-row "Download <file name>" with success toast / persistent error toast + "Try again"; "Upload a file" for File Importers |
| `UploadTransactionFile` | `web/src/components/files/UploadTransactionFile.tsx` | Upload card: labelled .csv chooser, "Selected: <name>", "Upload file", layout check then `uploadFile` as octet-stream; `role="status"` outcome banner (green / red border) + error toast "The file <name> was rejected at upload." |
| `FileImporterOnly` | `web/src/components/files/FileImporterOnly.tsx` | Renders children only for File Importers; others get a `role="status"` banner "You need the File Importer permission…" with a "Files" link |
| `isSevenColumnTransactionFile`, `TRANSACTION_FILE_HEADER`, `TRANSACTION_FILE_LAYOUT_MESSAGE` | `web/src/lib/validation/transaction-file.ts` | .csv extension + exact seven-column header check, reading only the file's first 64 KB (non-blocking) |
| `TRANSACTION_FILE_SETTING_ID`, `TRANSACTION_FILE_SETTING_NAME` | `web/src/lib/files/transaction-file-setting.ts` | File setting sent with every upload (Id 1 / `Transaction-Import`, confirmed live; mocks re-export them) |
| `Input`, `Label` (Shadcn) | `web/src/components/ui/input.tsx`, `web/src/components/ui/label.tsx` | Text/file input and its label (`htmlFor`) |
| `Switch` (Shadcn) | `web/src/components/ui/switch.tsx` | Switch primitive; extra `thumbClassName` prop for restyling the thumb; resize with `data-[size=default]:h-*` / `w-*` (plain `h-*` / `w-*` lose to the size variant) |

## Conventions
- Browser API calls are same-origin (`API_BASE_URL = ''`): `next.config.ts` rewrites `/v1/auth/*` to `AUTH_API_BASE_URL` and `/transactions-api/*` to `TRANSACTIONS_API_BASE_URL` (server-side env vars, never `NEXT_PUBLIC_`).
- `web/src/proxy.ts` redirects requests without a `session` cookie to `/sign-in` (cookie presence only) and marks protected responses `Cache-Control: no-store`; session validity is checked client-side by the `(app)` layout so Playwright `page.route()` can mock it.
- Every signed-in screen lives under `web/src/app/(app)/`; public screens (Sign in) live outside it and must be excluded in the proxy matcher.
- Design tokens in `globals.css` include `primary-hover` (button hover fill), `destructive-text` (error text — `destructive` is a fill only, it fails as text in dark mode), `success-text` / `warning-text` (status text and icons), and `brand` / `brand-foreground` / `brand-muted-foreground` (header identity colour and its inactive-nav text, both modes).
- Controls on the brand header use a `brand-foreground` focus outline (the `ring` token lacks contrast on brand blue).

## Cross-epic debt
- The API spec does not document that the backend renames uploaded files to `<yyyymmdd>_Transactions[_n].csv`; the Files list shows the renamed name, not the uploaded one.
- `FileLog.CurrentStatus` values seen live: `Suspended` (active, stopped at `FixData`) and `Faulted` (inactive, `LogFault`). The Files list deliberately shows every `IsActive=Yes` file regardless of status (user decision).
- The live transaction file setting is Id `1` / `Transaction-Import` (hyphen).

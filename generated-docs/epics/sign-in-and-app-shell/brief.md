# Epic Brief: Sign-in and app frame

*Inherits roles, auth, data source, compliance, and styling from project.md.*

| Field | Value |
|---|---|
| Epic slug | `sign-in-and-app-shell` |
| Depends on | — (first epic; every other epic depends on it) |

---

## Goal

Staff sign in with their own username and password, land in the app with the navigation their roles allow, see who they're signed in as, and sign out — with every screen protected by a live session.

This epic delivers the Sign in screen and the persistent app frame (header, navigation, signed-in user and role chips, sign-out, toast notifications) described in the design digest, the session check on every screen load, idle and absolute session timeouts, and the role-based hiding of navigation. The screens behind the navigation (Transactions, Files, Upload, Export) are built in later epics; this epic gives each a protected route inside the frame.

---

## Data Model

| Entity | Fields | Source |
|---|---|---|
| Login request | `Username` (string), `Password` (string) | `Authentication-API-Definition.yaml` `LoginRequest` |
| Signed-in user (userinfo) | `Id` (integer), `Email`, `FirstName`, `LastName`, `RolesString`, `Roles` (array of Role), `LastChangedUser`, `LastChangedDate` | `Authentication-API-Definition.yaml` `UserInfoRead` |
| Role | `Id` (integer), `Name` (string — expected values "File Importer", "Approver"), `LastChangedUser`, `LastChangedDate` | `Authentication-API-Definition.yaml` `RoleRead`; role names from requirements §3 and digest Data Shapes |
| Response envelopes | `DefaultResponse` (`Id`, `MessageType`, `Messages[]`) for login/logout success and 500s; `ErrorResponse` (`Error`, `Message`) for 400 | `Authentication-API-Definition.yaml` |

Derived for display: display name = `FirstName` + `LastName` (the digest shows a full name, e.g. "Carol Mokoena"); one role chip per entry in `Roles`.

Session state is held only in the HttpOnly `session` cookie — the frontend never reads or stores the token.

---

## Functional Requirements

- **R1:** A user can sign in with a username and password; on valid credentials the system starts a session and opens the application.
- **R2:** Invalid credentials show a generic message ("Sign-in failed. Check your details and try again.") that does not reveal which field was incorrect; repeated failures show the same message and reveal no lockout state.
- **R3:** Username and password are both required; a missing entry (blank after trimming) shows "Username and password are required."
- **R4:** A signed-in user can sign out; the application ends the session and waits for the sign-out response before leaving the screen (the button reads "Signing out…" meanwhile).
- **R5:** When a screen loads, the system verifies the session is still valid; every screen requires a valid session, and an invalid session takes the user to sign-in.
- **R6:** After sign-in the application opens with the actions the user's roles allow, inside a persistent frame that shows the product name, navigation, the user's name and role(s), sign-out and in-app notifications.
- **R7:** Actions the signed-in user's roles do not allow are hidden: no approve/reject without the Approver role, and no upload (including the "Upload" navigation item) without the File Importer role.
- **R8:** A session left idle for 15 minutes ends, with a warning shown 60 seconds before it does.
- **R9:** A session ends 8 hours after sign-in regardless of activity.
- **R10:** All screens conform to WCAG 2.2 AA and can be operated by keyboard alone.
- **R11:** The app opens quickly: time to interactive ≤ 3.0 s (p95), initial bundle ≤ 300 KB gzipped, and meaningful content ≤ 1.5 s after sign-in (p95).

---

## Business Rules

- **BR1:** Users sign in with their own credentials only — there is no SSO, second factor, or self-registration; users and their roles are managed in the backend.
- **BR2:** A failed sign-in never reveals which entry was wrong, nor whether the account is locked.
- **BR3:** The user's roles come solely from the userinfo response; a user may hold File Importer, Approver, or both.
- **BR4:** Hiding an action by role is a usability measure; the backend remains the authority on what each role may do.
- **BR5:** After sign-out, idle timeout or absolute timeout, no signed-in screen or its data is reachable without signing in again.

---

## Key Workflows

### Sign in

1. A user without a valid session opens any screen and is taken to Sign in.
2. The user enters a username and password and chooses "Sign in" (or presses Enter).
3. Blank entry → "Username and password are required." appears inline; nothing is sent.
4. The app sends the credentials; on rejection the generic failure message appears inline, and editing either field clears it.
5. On success the app loads the signed-in user and roles, and opens Transactions inside the app frame, showing a loading placeholder first.

### Navigate within the frame

1. The header shows "Transaction Management", the navigation (Transactions, Files, Upload for File Importers only, Export), the user's name, one chip per role, and "Sign out".
2. Choosing a navigation item opens that screen; the active item is highlighted and the current screen is reflected in the URL.
3. Each screen load re-checks the session; an invalid session goes to Sign in.

### Sign out

1. The user chooses "Sign out"; the button reads "Signing out…".
2. The app waits for the sign-out response, then returns to Sign in with the password cleared.

### Session timeout

1. After 14 minutes without activity a warning appears, giving the user the chance to stay signed in.
2. With no response within 60 seconds the session ends and the user returns to Sign in.
3. Independently, 8 hours after sign-in the session ends and the user returns to Sign in.

---

## Feature NFRs

- **NFR1:** Time to interactive ≤ 3.0 s (p95) on a standard office connection; initial bundle ≤ 300 KB gzipped; meaningful content ≤ 1.5 s after sign-in (p95) (requirements §6.6.2).
- **NFR2:** Sign-in, app frame, timeout warning and toasts are fully keyboard operable and meet WCAG 2.2 AA — visible labels, inline errors announced as alerts, toasts in a polite live region, nav landmark labelled "Main", 44px minimum targets, reduced-motion respected (requirements §6.6.5; digest App shell).
- **NFR3:** All auth calls go through the Next.js proxy so the session cookie stays same-origin (project.md NFR-base-6).

---

## Out of Scope

- The Transactions, Uploaded files, Upload and Export screen content (later epics); this epic provides only their protected routes inside the frame.
- Re-confirming identity before approve/reject (R39 — belongs to the transaction-decisions epic).
- Password reset, account self-service, user and role administration, and second-factor sign-in (§6.6.1: credentials only).
- Light/dark theme switching beyond what project.md §Styling settles.

---

## Notes & Caveats

- **Do NOT carry forward to production — demo accounts.** The prototype's sign-in "Prototype accounts, password demo:" block with quick-fill buttons (carol / bob / alice) is a demo affordance; leave it out.
- **Do NOT carry forward to production — faked sign-in, roles and sign-out.** The prototype checks credentials, looks up roles and delays sign-out client-side with three canned users and a fixed password. Use the real login, userinfo and logout endpoints.
- **Do NOT carry forward to production — in-place view switching.** The prototype swaps views with no URLs; build real routes so the current screen shows in the URL.
- **Do NOT carry forward to production — inline styles and hard-coded hex.** Express the header, nav, chips, toast and sign-in card through design tokens and Shadcn primitives; replace the bundled runtime and Google Fonts links with the project's own font setup.
- **Password field shown as plain text.** The prototype and the requirements ("both entries are shown as entered") show the password unmasked. This is unusual for a sign-in form — confirm before building it unmasked.
- **Role-name mismatch.** The userinfo example shows a role named "Viewer"; the app expects "File Importer" and "Approver". Confirm the exact `Roles[].Name` strings the backend returns, since the navigation and action hiding depend on them.
- **Display name.** userinfo has no single display-name field; this brief assumes `FirstName` + `LastName`. Confirm, or name the field to use (`Username` appears in the spec's example but not in its schema).
- **Session timeouts are enforced by the frontend only as far as it can.** The auth spec states no idle or absolute session lifetime. The app can track idle time and time since sign-in and sign the user out, but the backend's own cookie lifetime may differ. Confirm whether the backend enforces 15 minutes / 8 hours.
- **No design for the idle-timeout warning.** The prototype has no warning dialog or copy; it will be built from the design system's modal standards, with wording to confirm.
- **Toast persistence.** Prototype toasts auto-hide after about 4.5 s with no dismiss control; the design-system standard says toasts are dismissible and errors persist until acknowledged. The frame's notification area needs a decision on which rule applies.
- **Login 401 has no body in the spec.** The generic failure message is fixed text from the design, not read from the server response.
- **Brand identity.** The design-system files carry a third-party brand name and there is no logo; the header shows only "Transaction Management". Confirm the product name and whether a logo belongs in the header.

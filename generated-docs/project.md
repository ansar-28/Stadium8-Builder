# Transaction Management

A staff-facing transaction-approval application: File Importers upload seven-column .csv transaction files, Approvers approve or reject the imported transactions (singly or in bulk, with a mandatory rejection reason), and both roles view and download uploaded files and export actioned transactions to .csv.

| Field | Value |
|---|---|
| Project slug | `transaction-management` |
| Created | 2026-11-12T07:32:26Z |
| Intake source | docs (requirements document + two OpenAPI specs, with a design: prototype + design system) |
| Backend connectivity | verified (reachability-only — cookie-session auth) |

---

## Roles & Permissions

**Template:** `custom`

| Permission | File Importer | Approver |
|---|---|---|
| View main dashboard | ✓ | ✓ |

> Roles are taken from `documentation/requirements-application.md` §3; a user may hold either role or both (roles are assigned in the backend and returned by the userinfo endpoint). The requirements document's §6.5 RBAC matrix (File Importer uploads; Approver decides; both view files, view transactions and export) is the source for extending this matrix as stories surface each action.

> Permissions extend during BUILD as new stories surface new actions. Additions are recorded here as they come up, with your approval. Removing a permission, or changing who the roles are, stops for you to review.

---

## Authentication

| Field | Value |
|---|---|
| Method | `server-side` |
| Auth login endpoint (if server-side) | `POST /v1/auth/login` |
| Auth userinfo endpoint (if server-side) | `GET /v1/auth/userinfo` |
| Auth logout endpoint (if server-side) | `POST /v1/auth/logout` |
| Auth service base URL | `http://localhost:10010` (from `documentation/Authentication-API-Definition.yaml`) |
| Session mechanism | HttpOnly session cookie (`session`) minted by the login call and attached by the browser; the frontend never holds the token |
| Custom auth notes (if custom) | — |

> Auth method is never inferred — the user must confirm explicitly per [authentication-intake.md](.claude/policies/authentication-intake.md).

---

## Data Source & Backend Integration

| Field | Value |
|---|---|
| Data source | `existing-api` |
| Backend status | `running` |
| Mock layer required | no |

### Backend connectivity (when applicable)

Two backend services, both reached through a Next.js proxy (the browser never calls either backend directly).

| Aspect | Value |
|---|---|
| Base URL | Authentication: `http://localhost:10010`; Transactions: `http://localhost:10005/transactions-api` |
| Auth scheme | cookie (HttpOnly session cookie, both services) |
| Auth header | `Cookie` |
| Auth value format | `session={token}` (browser-managed) |
| Credential env vars | none (cookie-session; no API key or token) |
| Smoke-test endpoint | Authentication: `GET /v1/health` (200); Transactions: `GET /v1/transactions` (401 unauthenticated, scored reachable) |
| Smoke-test mode | reachability-only |
| Smoke-test status | verified |
| Smoke-test verified at | 2026-11-12T07:31:50Z |
| Smoke-test notes | Reachability only — no sign-in was performed. Scripts: `generated-docs/specs/api-smoke-test.sh` (auth), `generated-docs/specs/api-smoke-test-transactions.sh` (transactions). |
| CORS / proxy notes | Both services are cross-origin from `localhost:3000` and return no `Access-Control-Allow-Origin` — all calls go through a Next.js proxy. The transactions service is served under the `/transactions-api` path prefix, which its spec does not declare (spec `servers` is `http://localhost:10005`; calls without the prefix return 404) — the proxy and API client must include it. Mutating transaction calls (approve / reject) require a `LastChangedUser` header carrying the signed-in user's name. |

### API specs

| Path | Source |
|---|---|
| `documentation/Authentication-API-Definition.yaml` | user-provided |
| `documentation/Transaction-Management-API-Definition.yaml` | user-provided |

> Sample data: `documentation/transactions_2026-04-15.csv` — a sample import file in the seven-column layout (`Reference,TransactionDate,AccountNumber,Description,Amount,TransactionType,Currency`).

---

## Compliance

**Applicable domains:** `[INFERRED]` `popia` — no compliance answer was supplied at intake; detected from keyword triggers (personal data: user name and email returned for the signed-in user; file upload of transaction files containing account numbers). Payment-card (PCI-DSS) not applied: the app handles bank-transaction records with account numbers, not card data.
**Region (if Personal data applies):** `[INFERRED]` `ZA` — from locale signals: ZAR currency in the sample data and the brand design system taken from a `.co.za` site.

### Compliance Requirements

- `[INFERRED]` Personal data collection includes a clear purpose statement and user consent mechanism (POPIA domain default; this app collects no personal data from end users beyond sign-in credentials — confirm whether this applies)
- `[INFERRED]` Right to erasure: users can request deletion of their personal data (POPIA domain default; the design has no profile page and users are managed in the backend — confirm whether this applies to the frontend)
- `[INFERRED]` Personal data encrypted at rest and in transit (POPIA domain default)
- `[INFERRED]` Privacy policy link visible on all data-collection forms (POPIA domain default; the only form collecting personal input is sign-in)
- Account numbers are shown in full to every signed-in user — in lists, detail views and exports — and no masking applies anywhere (stated: requirements §6.6.4)
- Decisions are final and transaction data is read-only — no status change after approval or rejection (stated: requirements BR-01, BR-02)

---

## Styling & Branding

| Field | Value |
|---|---|
| Primary brand color | `#004B8D` <!-- Raw hex — Tailwind v4 oklch approximation drifts from brand --> (light-mode primary and identity colour in both modes — header bar; dark-mode interactive primary is `#2868AD`) |
| Accent / secondary | Accent `#156CBC`; Secondary `#4D5660` (light) / `#363E48` (dark) |
| Background (light) | `#FFFFFF` (surface `#F1F4F8`) |
| Background (dark, if applicable) | `#0C1015` (surface `#161B21`) |
| Font family (headings) | Open Sans, weight 300 |
| Font family (body) | Open Sans, weight 400 (600 for labels, buttons, chips) |
| Theme | `[INFERRED]` both light and dark — the design system defines a light palette (brand source of truth) and a derived dark palette, while the prototype is built dark-only (see digest Uncertainties) |
| Source | design digest palette (`documentation/design-system-light.html`, `documentation/design-system-dark.html`, `documentation/Prototype.html`) |

> Status, text, border and surface tokens for both modes are listed verbatim in the digest's Palette & Typography section.

> Component-specific styling (button radii, card shadows, etc.) emerges during BUILD. This section captures only palette intent and typography per [styling-centralisation.md](.claude/policies/styling-centralisation.md).

---

## Baseline NFRs

- **NFR-base-1:** Accessibility — WCAG 2.2 Level AA, operable by keyboard alone (requirements §6.6.5; exceeds the WCAG 2.1 AA industry baseline)
- **NFR-base-2:** Performance — First Contentful Paint < 2.5s on a mid-tier mobile network
- **NFR-base-3:** Responsive design — mobile (≥360px) / tablet (≥768px) / desktop (≥1280px) breakpoints
- **NFR-base-4:** Browser support — latest two versions of Chrome / Edge / Firefox / Safari
- **NFR-base-5:** Error UX — user-visible error states with retry affordance for all async operations
- **NFR-base-6:** Next.js proxy required for both backend services (no CORS headers on either backend; session cookie must stay same-origin), including the `/transactions-api` path prefix for the transactions service

---

## Design Source

| Field | Value |
|---|---|
| Digest | `generated-docs/design/digest.md` |
| Palette source | Design-system token catalogues (`design-system-light.html`, `design-system-dark.html`) plus extra surface/status values in the prototype's styles |
| Read from | `documentation/Prototype.html` (self-unpacking bundle), `documentation/design-system-light.html`, `documentation/design-system-dark.html` |
| Attached files | No logo or image assets; two inline line icons (approve tick, reject cross); Open Sans fonts embedded |

### Screens

| Screen | Key details |
|---|---|
| Sign in | Centred card with Username and Password fields, inline generic error, "Sign in" button |
| App shell | Brand-blue header with product name, Transactions / Files / Upload (File Importers only) / Export nav, user name, role chips, Sign out; bottom-right toasts |
| Transactions | Filter card, sortable paginated table with status/type chips and days pending; Approvers get selection, row approve/reject icons and a bulk-action bar |
| Decision confirmation dialog | Names affected transactions, mandatory rejection reason for reject, "This decision is final.", focus starts on Cancel |
| Decision blocked dialog | Refuses decisions on the user's own uploads; bulk actions refused whole, blocked References listed |
| Uploaded files | Paginated list of uploaded files with upload timestamp and per-row Download; "Upload a file" for File Importers |
| Upload transaction file | .csv file chooser, "Upload file", success/failure banner enforcing the seven-column layout |
| Export actioned transactions | Quick export (period + decision), filters, always-visible selection bar, sortable selectable table, .csv download |

> The app is **rebuilt in our stack** (Shadcn + design tokens) to match the design as described in the digest — not copied from any source markup. Prototype constructs that must NOT carry forward to production — placeholder/fake data, remote CDN icons, placeholder handlers, inline styles — are listed in the digest's "Translate, Don't Copy" section and flagged in the per-epic brief.md "Notes & Caveats" when an epic touches that screen.

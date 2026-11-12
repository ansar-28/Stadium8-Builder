# Epic Plan — Transaction Management

Every epic in this project, what it delivers, and what it builds on. Live status
(not started / in flight / done) is shown by `/status` and the dashboard.

> Plan only — edited during planning on `main`, never on an epic branch.

## Epics

| # | Epic | Delivers | Builds on |
|---|---|---|---|
| 1 | Sign-in and app frame (`sign-in-and-app-shell`) | Staff sign in with their own username and password, land in the app with the navigation their roles allow, see who they're signed in as, and sign out — with every screen protected by a live session. | — |
| 2 | Upload and uploaded files (`file-upload-and-files`) | File Importers upload .csv transaction files and learn at once whether they were accepted; everyone can see the uploaded files and download them. | Sign-in and app frame (`sign-in-and-app-shell`) |
| 3 | Transaction list (`transaction-list`) | Everyone can browse the imported transactions read-only — filter, sort, page through them and see how long each pending one has been waiting. | Sign-in and app frame (`sign-in-and-app-shell`) |
| 4 | Approve and reject transactions (`transaction-decisions`) | Approvers approve or reject pending transactions one at a time or in bulk, with a confirmation step and a required rejection reason. | Transaction list (`transaction-list`) |
| 5 | Export actioned transactions (`export-actioned-transactions`) | Everyone can pick approved and rejected transactions — or a quick day, week or month — and download them as a .csv file. | Transaction list (`transaction-list`) |

## Coverage

Everything in the spec is assigned to an epic, except what was dropped by decision.

| What you asked for | Epic |
|---|---|
| Sign in, sign-in errors, required fields (R1–R3) | Sign-in and app frame (`sign-in-and-app-shell`) |
| Sign out, session checks, app frame, role-based hiding (R4–R7) | Sign-in and app frame (`sign-in-and-app-shell`) |
| Idle and absolute session timeouts, accessibility, startup speed (R8–R11) | Sign-in and app frame (`sign-in-and-app-shell`) |
| Upload a .csv, layout check, rejection notice, upload permission (R41–R45) | Upload and uploaded files (`file-upload-and-files`) |
| View and download uploaded files, empty and error states (R46–R49) | Upload and uploaded files (`file-upload-and-files`) |
| View, filter, sort, page and count transactions (R12–R18) | Transaction list (`transaction-list`) |
| Empty, no-match and loading states, large-list speed, full account numbers (R19–R23) | Transaction list (`transaction-list`) |
| Approve or reject singly or in bulk, with confirmation and reason (R24–R31) | Approve and reject transactions (`transaction-decisions`) |
| Approver-only actions, row icons, notices, failure handling, re-confirm identity (R34–R40) | Approve and reject transactions (`transaction-decisions`) |
| View, filter, sort, select actioned transactions (R50–R54) | Export actioned transactions (`export-actioned-transactions`) |
| Export .csv, quick export, nothing-to-export notice (R55–R58) | Export actioned transactions (`export-actioned-transactions`) |

Dropped by decision: **No deciding transactions from a file you uploaded yourself** (R32) and **A group decision containing your own upload is refused whole** (R33). The backend has no "uploaded by" field and no backend changes will be made, so these rules are left out.

_58 requirements: 56 assigned, 2 dropped by decision._

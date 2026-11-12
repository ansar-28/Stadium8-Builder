# Epic Brief — Transaction list

*Inherits roles, auth, data source, compliance, and styling from project.md.*

| Field | Value |
|---|---|
| Epic slug | `transaction-list` |
| Epic name | Transaction list |
| Depends on | `sign-in-and-app-shell` |
| Screens touched | Transactions (read-only browsing parts) |

---

## Goal

Everyone can browse the imported transactions read-only — filter, sort, page through them and see how long each pending one has been waiting.

Both roles (File Importer and Approver) see the same list on the Transactions screen: page title "Transactions" with the description "Transaction data is read-only. Decisions are final.", a filter card, a sortable paginated table, a "Showing x of y transactions" count, and the empty, no-match and loading states. Approver-only parts of this screen (selection checkboxes, row approve/reject icons, bulk-action bar, decision dialogs) belong to the `transaction-decisions` epic and are not built here.

---

## Data Model

| Entity | Fields (as shown) | Source / notes |
|---|---|---|
| **Transaction** | Id (hidden), FileLogId (link to uploaded file, hidden), Reference, TransactionDate (date + time), AccountNumber (text, shown in full), Description, Amount (number, unsigned), TransactionType (Credit \| Debit), Currency (3-letter code), Status (Pending \| Approved \| Rejected), UserNote (rejection reason, shown only when Rejected) | `GET /v1/transactions` → `TransactionReadList.Transactions[]` of `TransactionRead` (`documentation/Transaction-Management-API-Definition.yaml`). The schema also carries `FileName`, `LastChangedUser`, `LastChangedDate`, which this list does not display. |
| **Uploaded file** (read for the derived value only) | Id, ProcessDate (upload date) | `GET /v1/file-logs?IsActive=Yes` → `FileLogList`. Used only to compute days pending. |
| **Days pending** (derived) | Whole number of days from the owning file's upload date (ProcessDate) to today, while the transaction is Pending; "—" otherwise | Requirements §7 derived values; digest Data Shapes. |
| **Transaction list view state** (client) | Filters (date from, date to, account number, amount min, amount max, type, currency), sort column + direction (default Date descending), page number, page size (5/10/20/50, default 20) | Digest Transactions screen. |

---

## Functional Requirements

- **R1:** A user can view the transactions read in. *(source R12 — F-08, §5 Review transactions)*
- **R2:** Every field of a displayed transaction is read-only; no control edits any field. *(source R13 — BR-02, UI-04)*
- **R3:** A user can filter transactions by date, account number, amount, transaction type and currency; only transactions matching every filter are shown. *(source R14 — F-09, UI-05)*
- **R4:** A user can sort by clicking any column header, ascending or descending; filters have no sort controls. *(source R15 — F-10, UI-06)*
- **R5:** Each pending transaction shows its days pending; no deadline, service level or escalation applies. *(source R16 — F-11, UI-13, BR-12)*
- **R6:** Every collection offers pagination with page sizes 5, 10, 20 and 50, defaulting to 20, always visible. *(source R17 — UI-19)*
- **R7:** Below the transaction list the application shows "Showing x of y transactions". *(source R18 — UI-21; the export-list half is delivered by `export-actioned-transactions`)*
- **R8:** With no data the list says "No transactions yet" and offers the upload action to a File Importer. *(source R19 — §6.4.5)*
- **R9:** When filters leave no result the list shows the active filters and a clear-all action instead of an empty-data message. *(source R20 — §6.4.5)*
- **R10:** While transactions load, a list-shaped placeholder shows, plus a still-loading message after three seconds. *(source R21 — §6.4.5)*
- **R11:** The list renders 1,000 listed transactions within 200 ms (p95). *(source R22 — §6.6.2)*
- **R12:** Account numbers are shown in full to every signed-in user in the list; no masking. *(source R23 — §6.6.4)*

---

## Business Rules

- **BR1:** Transaction data is read-only — the list offers no way to edit any field (requirements BR-02).
- **BR2:** Filters combine with AND: a transaction is shown only when it matches every active filter. The account-number filter matches any account number containing the entered text; the date filters are inclusive bounds ("Date from" / "Date to"); the amount filters are inclusive bounds ("Amount min" / "Amount max"); "Any" in Transaction type or Currency means no restriction.
- **BR3:** Days pending applies only to Pending transactions and is shown as "1 day" / "N days"; Approved and Rejected rows show "—". No deadline, service level, escalation or colour-coding by age applies (requirements BR-12).
- **BR4:** Default sort is Date, descending. Clicking a new column sorts it ascending; clicking the active column toggles direction. The active column shows " ▲" / " ▼" and exposes `aria-sort`.
- **BR5:** Changing any filter, the sort, or the page size resets the list to page 1.
- **BR6:** Pagination is always shown, including when everything fits on one page; "Previous" is disabled on page 1 and "Next" on the last page.
- **BR7:** The count reads "Showing <filtered> of <total> transactions", where <total> is all transactions read in and <filtered> is the number matching the active filters.
- **BR8:** The "Upload a file" action in the empty state is shown only to users holding the File Importer role.
- **BR9:** Account numbers are never masked or truncated (requirements §6.6.4).

---

## Key Workflows

### W1 — Browse transactions

1. A signed-in user opens Transactions from the app-shell navigation.
2. A list-shaped skeleton shows while the transactions load; if loading takes more than three seconds, a still-loading message appears as well.
3. The table shows the transactions, sorted by Date descending, 20 rows per page, with Reference, Date, Account number, Description, Amount, Type chip, Currency, Status chip (with "Reason: <reason>" under rejected rows) and Days pending.
4. The footer shows "Showing <filtered> of <total> transactions" and the pagination controls.

### W2 — Filter

1. The user enters or chooses one or more filters: Date from, Date to, Account number, Amount min, Amount max, Transaction type, Currency.
2. The list updates immediately and returns to page 1, showing only matching transactions; the count updates.
3. If nothing matches, the list shows "No transactions match these filters", the active filters as chips, and a "Clear all" button.
4. "Clear all" (in the filter card or the no-match state) clears every filter and shows the full list again.

### W3 — Sort

1. The user clicks a column header; the list sorts by that column ascending and returns to page 1.
2. Clicking the same header again sorts descending.

### W4 — Page through

1. The user changes "Rows per page" (5 / 10 / 20 / 50) or presses "Previous" / "Next".
2. The label "Page <n> of <pages>" and the rows update.

### W5 — Empty list

1. No transactions have been read in yet.
2. The list shows "No transactions yet" — "Transactions appear here once a file has been uploaded."
3. A File Importer also sees an "Upload a file" button, which goes to the Upload transaction file screen.

---

## Feature NFRs

- **NFR1:** Rendering 1,000 listed transactions completes within 200 ms (p95) (requirements §6.6.2).
- **NFR2:** The skeleton is announced as busy (`aria-busy`) and its shimmer is disabled under `prefers-reduced-motion`.
- **NFR3:** Every sortable header is a keyboard-operable button exposing `aria-sort`; all filter fields have visible labels; numeric cells use tabular figures and Amount is right-aligned.
- **NFR4:** A failed transaction-list load shows the server's message with a retry affordance (project NFR-base-5; requirements §6.4.5).

---

## Out of Scope

- Approve / reject (single or bulk), selection checkboxes, the unlabelled row-action column, the bulk-action bar, confirmation and blocked dialogs and decision toasts — delivered by `transaction-decisions`.
- The export list's "Showing x of y transactions" count, pagination and filters — delivered by `export-actioned-transactions`.
- The upload screen itself — delivered by `file-upload-and-files` (this epic only links to it from the empty state).
- The own-upload block (R32 / R33 in the epic plan) — dropped at the user's decision; the backend does not record who uploaded a file.
- Editing any transaction field (forbidden by BR-02).

---

## Notes & Caveats

- **Do NOT carry forward to production — canned data.** The prototype generates 36 sample transactions, three sample files and a fixed "today" (2026-04-16). The list reads `GET /v1/transactions` through the Next.js proxy (with the `/transactions-api` prefix), and days pending counts from the real current date.
- **Do NOT carry forward to production — simulated loading.** The prototype's skeleton runs on a timer; the real skeleton and the three-second still-loading message are driven by the actual request state.
- **Do NOT carry forward to production — inline styles and hard-coded hex.** Chip, table and filter-card colours are expressed through the design tokens in `globals.css`, not copied CSS.
- **Do NOT carry forward to production — view switching.** The prototype swaps views in place with no URL; Transactions is a real route.
- **Status value mismatch.** The API's `TransactionRead.Status` example is `"Imported"`, while the requirements and design use Pending / Approved / Rejected (requirements §7 notes the discrepancy). Confirm the value the backend returns for a not-yet-decided transaction and map it to "Pending" in the UI.
- **Transaction type mismatch.** The API example gives `TransactionType` as `"Debit"`, the import file uses `C` / `D`. Confirm the value the list endpoint returns and map it to the Credit / Debit chips.
- **Days pending needs a second call.** `TransactionRead` has no upload date; days pending is computed from the owning file's `ProcessDate` via `GET /v1/file-logs?IsActive=Yes`, joined on `FileLogId`. Confirm `ProcessDate` is the upload date.
- **No server-side filtering, sorting or paging.** `GET /v1/transactions` takes no query parameters, so filtering, sorting, paging and the count are done in the browser on the full list — which is why the 1,000-row render target (NFR1) matters.
- **Still-loading message has no copy.** The requirements ask for it, but the design gives no wording; the text must be confirmed during BUILD.
- **Failed-load error state not designed.** There is no design or copy for a failed list load; where the server's message appears (toast, banner or inline) must be confirmed during BUILD.
- **Date and amount display formats unconfirmed.** The prototype shows dates as `YYYY-MM-DD HH:mm` and amounts as `12 345.35` (space thousands separator, no currency symbol); the design-system standards ask for locale-aware dates and a currency symbol.
- **Pagination label and placeholders unconfirmed.** The prototype says "Previous" where the design-system standard says "Back", and only the Account number filter has a placeholder ("1001-2034") although the standard asks for one on every field.
- **Currency filter options.** The prototype offers only ZAR, USD and EUR; whether the list should be fixed or built from the currencies present in the data must be confirmed.
- **Theme and status colours** (light / dark / both; prototype tints vs design-system status tokens) are open project-level questions in the digest's Uncertainties and affect the Status and Type chips.

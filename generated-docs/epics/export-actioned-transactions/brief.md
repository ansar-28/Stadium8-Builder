# Epic Brief — Export actioned transactions

*Inherits roles, auth, data source, compliance, and styling from project.md.*

| Field | Value |
|---|---|
| Epic slug | `export-actioned-transactions` |
| Depends on | `transaction-list` |
| Screens touched | Export actioned transactions (digest §Screens) |

---

## Goal

Everyone can pick approved and rejected transactions — or a quick day, week or month — and download them as a .csv file.

Both roles (File Importer and Approver) open the export view, see only actioned (approved or rejected) transactions, filter, sort and select them, and export the selection to a .csv file in the import layout plus a Status column — or run a quick export for a day, week or month after choosing approved, rejected or both. Pending transactions are never offered (requirements §5 Flow: Export actioned transactions; G-02, G-11).

---

## Data Model

The backend has **no export operation** (requirements §6, "export files are produced from the loaded transactions"). The export view reads the same list as the transaction list and builds the .csv in the browser.

- **Transaction** (read) — from `GET /v1/transactions` (`TransactionReadList.Transactions[]` → `TransactionRead`), via the Next.js proxy under `/transactions-api`. Fields used here: `Id`, `Reference`, `TransactionDate` (string, e.g. `2025-04-30 15:00:00`), `AccountNumber` (shown in full), `Description`, `Amount` (number), `TransactionType` (`Credit` / `Debit`), `Currency`, `Status`, `UserNote` (the rejection reason, shown as "Reason: <reason>" under a Rejected chip). The endpoint takes no filter inputs — filtering, sorting and pagination happen in the frontend.
- **Export row** (derived, client-side) — the seven import columns plus Status, in this order: `Reference,TransactionDate,AccountNumber,Description,Amount,TransactionType,Currency,Status` (BR-11; digest Data Shapes "Export row").
- **Export selection** (client-side state) — the set of selected transaction ids on the export list; not persisted.
- **Quick-export request** (client-side) — period (`Day` | `Week` | `Month`) + decision (`Approved and rejected` | `Approved` | `Rejected`).

---

## Functional Requirements

- **R1:** A user can view every approved and rejected transaction in the export view.
- **R2:** A pending transaction is not eligible for export — it is never listed in, selectable on, or written by the export view.
- **R3:** A user can filter actioned transactions by approval state, date, account number, amount and transaction type; the export list has no currency filter.
- **R4:** A user can sort the export list by clicking any column header, ascending or descending; the filters have no sort controls.
- **R5:** A user can select transactions on the export list.
- **R6:** A user can export the selected actioned transactions to a .csv file that downloads to the local machine.
- **R7:** The export file writes Reference, TransactionDate, AccountNumber, Description, Amount, TransactionType and Currency, plus a Status column.
- **R8:** A user can quick-export the actioned transactions for the day, week or month after choosing approved, rejected or both.
- **R9:** When no transaction matches the chosen period or filters, a notice says nothing is available to export.

---

## Business Rules

- **BR1:** Only transactions with status Approved or Rejected appear in the export view; Pending is excluded from the list, the selection, the quick export and the file (requirements BR-07).
- **BR2:** The export file uses the import layout plus a Status field, in the column order given in R7 (requirements BR-11).
- **BR3:** Both roles can export; no permission beyond a valid session is required (requirements §5 role-conditional behaviour, §6.5).
- **BR4:** Account numbers are written and shown in full in the export list and the export file — no masking (requirements §6.6.4).
- **BR5:** Filters apply immediately on change and reset to page 1; sorting resets to page 1; default sort is Date, descending (digest §Export screen).
- **BR6:** Every row on the export list is selectable (full-size checkboxes); the header checkbox selects all rows on the current page (digest §Export screen).
- **BR7:** "Export selected" and "Clear selection" are disabled while nothing is selected; the selection bar is always visible (digest §Export screen).
- **BR8:** A quick export ignores the list selection and filters — it uses only the chosen period and decision (requirements G-11: "a quick export needs only a period and a decision choice").
- **BR9:** Pagination offers page sizes 5, 10, 20 and 50, default 20, always visible; a "Showing x of y transactions" count sits below the export list (requirements UI-19, UI-21).

---

## Key Workflows

### Export a selection

1. User opens Export from the navigation; approved and rejected transactions are listed (newest first).
2. User applies filters (approval state, date from/to, account number, amount min/max, transaction type) and sorts by any column.
3. User selects rows (individually or all on the page); the selection bar shows "N transactions selected".
4. User chooses "Export selected"; a .csv file downloads and a toast reads "<file name> downloaded: N transactions."

### Quick export

1. On the Export view, user picks a Period (Day / Week / Month) and a Decision (Approved and rejected / Approved / Rejected).
2. User chooses "Quick export"; a .csv of the matching actioned transactions downloads with the same toast.
3. If nothing matches, the toast "Nothing is available to export for that selection." shows and no file downloads.

### Nothing to show

1. Filters match no actioned transaction (or none exist yet) → the list shows "Nothing is available to export" with "Change the filters to see approved or rejected transactions. Pending transactions are never offered." and a "Clear all" button.

---

## Feature NFRs

- **NFR1:** Building the .csv for up to 1,000 selected transactions happens in the browser without a visible stall (no backend export operation exists).
- **NFR2:** The export list honours the transaction-list performance target — 1,000 listed transactions render within 200 ms (p95) (requirements §6.6.2).
- **NFR3:** The .csv is a valid RFC 4180 file: fields containing commas, quotes or line breaks (notably Description) are quoted and embedded quotes doubled.

---

## Out of Scope

- A backend export endpoint or server-side file generation — the backend contract has none and no backend changes will be made.
- Export formats other than .csv (RPT-01 / RPT-02 are csv only); scheduled or recurring exports (on-demand only).
- Exporting pending transactions.
- A currency filter on the export list.
- Changing any transaction from the export view — it is read-only; decisions live in `transaction-decisions`.

---

## Notes & Caveats

- **Translate, don't copy — canned data.** The prototype's 36 sample transactions and fixed "today" (2026-04-16) must NOT carry forward to production; the export list reads `GET /v1/transactions` and the quick-export window uses the real current date.
- **Translate, don't copy — simulated download.** The prototype fakes the file download client-side; build a real browser download of the generated .csv content (no backend call exists for this).
- **Translate, don't copy — inline styles and hard-coded hex.** Express the selection bar tint, status chips and checkbox sizing through the design tokens and Shadcn primitives, not copied CSS.
- **Translate, don't copy — view switching.** The prototype swaps views in place; Export must be a real route reflected in the URL.
- **Status values in the backend.** The spec's `TransactionRead.Status` example is `"Imported"`, not `"Pending"`; the approve/reject endpoints set `'Approved'` / `'Rejected'`. Treat every status other than Approved or Rejected as pending (not exportable) — confirm the exact strings against the live backend during BUILD.
- **Date and value formats in the file.** The prototype writes `TransactionDate` as `YYYY-MM-DD HH:mm` and `TransactionType` as `C` / `D`, while the API returns `Credit` / `Debit` and dates like `2025-04-30 15:00:00`, and the sample import file uses `2026/04/15 08:12`. The exact date format and type encoding in the export file need confirming (digest Uncertainties: Export file details).
- **File name.** The prototype names the file `actioned-transactions-<YYYY-MM-DD>.csv` (today's date) — confirm.
- **Quick-export periods.** The prototype treats Week as today plus the previous 6 days and Month as today plus the previous 29 days; whether these should be calendar week/month is unconfirmed (digest Uncertainties). Which date the period is measured against (transaction date vs. decision date `LastChangedDate`) is also unstated — the prototype uses the transaction date.
- **Failed export / failed list load.** No design or copy exists for an error loading the list on this screen; follow NFR-base-5 (show the server's message with a retry) — placement (toast, banner, inline) is unresolved in the digest.
- **Empty-state wording has two forms.** The digest uses "Nothing is available to export" for the empty list and the toast "Nothing is available to export for that selection." for an export with no matching rows; R9 is satisfied by both.

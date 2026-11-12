# Story 1: Transaction list with days pending

- **slug:** story-1-transaction-list-with-days-pending
- **requirementIds:** R1, R2, R5, R7, R8, R10, R12, BR1, BR3, BR7, BR8, BR9, NFR2, NFR4
- **roles:** File Importer, Approver
- **route:** /transactions
- **targetFile:** web/src/app/(app)/transactions/page.tsx
- **pageAction:** modify_existing
- **isInfrastructureOnly:** false

## Summary

Replaces the placeholder Transactions page with a client list that loads GET /v1/transactions and GET /v1/file-logs?IsActive=Yes through the existing endpoint functions, joins on FileLogId to derive days pending from ProcessDate (Pending only; "1 day" / "N days", "—" otherwise), maps the backend's status and type values to Pending/Approved/Rejected and Credit/Debit, and renders the read-only table (Reference, Date, Account number, Description, Amount right-aligned with tabular figures, Type chip, Currency, Status chip + "Reason: <reason>", Days pending) sorted Date descending with the "Showing x of y transactions" count. Covers the aria-busy skeleton (shimmer off under reduced motion) plus a still-loading message after three seconds driven by the real request, the "No transactions yet" empty state with the role-gated "Upload a file" link to /upload, and the failed-load state with the server's message and Retry. Approver-only columns, selection and decision controls are out of scope (transaction-decisions).

## Plain summary

Opening Transactions shows every transaction read in, newest first, with its full account number, Type and Status chips, the rejection reason under rejected ones and how many days each pending one has been waiting. While it loads you see a placeholder, an empty list says "No transactions yet" (with "Upload a file" for File Importers), and a failed load shows the server's message with a way to try again.

## Acceptance criteria

- **AC-1** (playwright): Opening Transactions shows the transactions read in with the columns specified in the brief, newest Date first, account numbers in full, Type and Status chips, "Reason: <reason>" under rejected rows, the "Showing x of y transactions" count, and no control that edits any field
- **AC-2** (vitest): Each Pending transaction shows "1 day" or "N days" counted from its file's upload date to today, and Approved or Rejected transactions show "—"
- **AC-3** (vitest): While transactions load, a busy list-shaped placeholder shows, and a still-loading message appears if loading takes longer than three seconds
- **AC-4** (vitest): With no transactions the list says "No transactions yet" with its explanation, and only a user holding the File Importer role sees an "Upload a file" button that goes to the upload screen
- **AC-5** (vitest): When the transactions fail to load, the server's message shows with a Retry button, and pressing Retry loads the list again
- **AC-6** (playwright): The Transactions screen with a loaded list has no detectable accessibility violations

## Manual test checklist

- Click Transactions in the header → you see the list of transactions, newest date first, with Reference, Date, Account number, Description, Amount, Type, Currency, Status and Days pending
- Look at the Account number column → every account number is shown in full, nothing hidden or shortened
- Find a Rejected transaction → "Reason:" and the rejection reason appear under its Status chip
- Find a Pending transaction → Days pending shows how many days since its file was uploaded; Approved and Rejected ones show "—"
- Try to change any value in the list → nothing in the table can be edited
- Reload the page and watch → a list-shaped placeholder shows briefly before the transactions appear
- Sign in as a File Importer on an empty system → you see "No transactions yet" and an "Upload a file" button that takes you to the upload screen (an Approver-only user sees no button)

## Resolved design choices

- Status and Type chips use the brand design system's status colours (success green, warning amber, error red, info blue), via `globals.css` tokens for both light and dark.
- Still-loading message: "Still loading transactions…".
- A failed load shows the server's message and a Retry button in place of the table.
- Dates and amounts as in the design: `2026-04-15 08:12` and `12 345.35`, with the currency in its own column.

## Technical notes

- additionalTechnicalChecksCount: 2
- Reuse: the Transactions route and PageHeader already exist in the (app) group — extend, don't recreate. Use `getTransactions()` and `getFileLogs('Yes')` from `web/src/lib/api/endpoints.ts`; types from `web/src/types/api-generated.ts`; gate the Upload button with `hasRole(user, FILE_IMPORTER_ROLE_NAME)` from `web/src/lib/auth/roles.ts` and the user from `SessionContext`. Add Shadcn select, table, badge and skeleton as needed.
- Assumptions to verify against the real backend: undecided transactions come back as "Imported" (show as Pending); type comes back as Credit/Debit (or C/D); a file's ProcessDate is its upload date.

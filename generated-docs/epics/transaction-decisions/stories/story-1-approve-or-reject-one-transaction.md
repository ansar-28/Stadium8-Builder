# Story 1: Approve or reject one transaction

**Requirements:** R1, R2, R7, R8, R9, R10, R11, R12, R14, R15, BR1, BR2, BR3, BR4, BR6, BR7, BR9, NFR1, NFR2, NFR3, NFR4
**Roles:** Approver, File Importer
**Route:** /transactions
**Target file:** web/src/app/(app)/transactions/page.tsx
**Page action:** modify_existing
**Infrastructure only:** false

## Summary
An Approver can approve or reject a Pending transaction straight from its row on Transactions, using the green tick or red cross. A confirmation step names the transaction and says the decision is final, a rejection needs a reason, and a notice confirms the decision. A File Importer-only user sees no decision controls.

## Acceptance criteria
- AC-1 [vitest]: An Approver sees an unlabelled leading "Row actions" column with "Approve <Reference>" and "Reject <Reference>" buttons on Pending rows only; Approved and Rejected rows show no buttons, and no column is labelled "Decision"
- AC-2 [vitest]: A user without the Approver role sees no row-action column and no approve or reject controls; the list is otherwise unchanged
- AC-3 [vitest]: Clicking a row's tick or cross opens a dialog titled "Approve 1 selected transaction?" / "Reject 1 selected transaction?" that lists "<Reference> · <Description> · <Currency> <Amount>", shows "This decision is final." and starts with focus on Cancel
- AC-4 [vitest]: Pressing Reject with a blank reason keeps the dialog open with "Enter a rejection reason to continue.", and typing in the reason clears the message
- AC-5 [vitest]: Cancel or Esc closes the dialog, records nothing, and returns focus to the button that opened it
- AC-6 [playwright]: Confirming closes the dialog, the row shows Approved (or Rejected with "Reason: <reason>" beneath it), its tick and cross disappear, and the notice "Transaction <Reference> was approved." / "Transaction <Reference> was rejected." appears

## Manual test checklist
- Sign in as an Approver and open Transactions → each Pending row has a green tick and a red cross before the Reference; Approved and Rejected rows have neither
- Click the tick on a Pending row → a dialog names that transaction, says "This decision is final.", and Cancel is highlighted
- Press Esc (or Cancel) → the dialog closes and the row is still Pending
- Approve the transaction → the row shows Approved, its icons disappear, and "Transaction <Reference> was approved." appears bottom-right
- Click the cross on another Pending row and press Reject without a reason → "Enter a rejection reason to continue."; type a reason and press Reject → the row shows Rejected with "Reason: <your reason>"
- Reload the page → both decisions are still shown
- Sign in as a File Importer only → Transactions shows no tick or cross icons

## Resolved design choices (user approved the recommended answer for each):
- Failed decision errors appear inside the confirmation dialog, which stays open so the Approver can retry.
- Partial bulk failure: keep the successful rows, name the failed References with the server's message, leave only the failed ones selected.
- Re-authentication (R14): rely on the live session; if it has expired the user is sent to sign in. No password prompt.
- "Decision is final" notice: the design's version (no icons + disabled-checkbox tooltip) is enough.

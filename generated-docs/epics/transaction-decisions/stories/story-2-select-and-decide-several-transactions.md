# Story 2: Select and decide several transactions at once

**Requirements:** R3, R4, R5, R6, R7, R8, R9, R12, BR1, BR2, BR4, BR5, BR6, BR7, BR8, NFR1, NFR2, NFR3, NFR4
**Roles:** Approver, File Importer
**Route:** /transactions
**Target file:** web/src/app/(app)/transactions/page.tsx
**Page action:** modify_existing
**Infrastructure only:** false

## Summary
An Approver can tick several Pending transactions (or all Pending ones on the page) and approve or reject them together, giving one rejection reason that applies to every selected transaction. Approved and Rejected rows can't be selected and say why.

## Acceptance criteria
- AC-1 [vitest]: An Approver sees a "Select <Reference>" checkbox on every row and a "Select all pending transactions on this page" header checkbox; Approved and Rejected rows' checkboxes are disabled with the tooltip "<Status> — decision is final"
- AC-2 [vitest]: A user without the Approver role sees no selection checkboxes and no bulk-action bar
- AC-3 [vitest]: Selecting rows shows the bulk-action bar with "N transactions selected", "Approve selected", "Reject selected" and "Clear selection"; the header checkbox selects only the Pending rows on the current page, and "Clear selection" empties the selection and hides the bar
- AC-4 [vitest]: The bulk dialog is titled "Approve N selected transactions?" / "Reject N selected transactions?", lists at most six transactions then "and <N> more", and for reject shows "Rejection reason (applies to every selected transaction)" with "Enter one rejection reason for the selection." when left blank
- AC-5 [playwright]: Confirming a bulk approve or reject updates every selected row (rejections each showing the one shared reason), closes the dialog, clears the selection and shows "<N> transactions were approved." / "<N> transactions were rejected."
- AC-6 [playwright]: The Transactions screen as an Approver, with rows selected and the decision dialog open, has no accessibility violations

## Manual test checklist
- Sign in as an Approver and open Transactions → each row starts with a small checkbox (smaller than the ones on Export); hover an Approved row's checkbox → "Approved — decision is final"
- Tick the header checkbox → only the Pending rows on this page are selected, and the bar reads "N transactions selected"
- Press "Clear selection" → all rows are unticked and the bar disappears
- Select eight Pending rows and press "Approve selected" → the dialog lists six of them, then "and 2 more"
- Confirm → all eight rows show Approved, the selection clears, and "8 transactions were approved." appears
- Select two Pending rows, press "Reject selected", enter one reason and confirm → both rows show Rejected with that same reason
- Sign in as a File Importer only → no checkboxes and no bulk bar

## Resolved design choices (user approved the recommended answer for each):
- Failed decision errors appear inside the confirmation dialog, which stays open so the Approver can retry.
- Partial bulk failure: keep the successful rows, name the failed References with the server's message, leave only the failed ones selected.
- Re-authentication (R14): rely on the live session; if it has expired the user is sent to sign in. No password prompt.
- "Decision is final" notice: the design's version (no icons + disabled-checkbox tooltip) is enough.

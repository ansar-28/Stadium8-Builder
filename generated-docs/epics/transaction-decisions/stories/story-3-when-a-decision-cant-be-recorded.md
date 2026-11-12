# Story 3: When a decision can't be recorded

**Requirements:** R13, R3, R5, R6, BR3, NFR3
**Roles:** Approver
**Route:** /transactions
**Target file:** web/src/app/(app)/transactions/page.tsx
**Page action:** modify_existing
**Infrastructure only:** false

## Summary
If the system refuses an approval or rejection, the Approver sees the server's message, the transaction keeps its previous status, and they can try again. In a bulk decision where only some succeed, the app shows which References failed and keeps just those ready to retry.

## Acceptance criteria
- AC-1 [vitest]: When an approve or reject is refused, the server's message is shown, the transaction keeps its previous status, and no success notice appears
- AC-2 [vitest]: After a failure the Approver can press confirm again (any rejection reason still filled in), and a successful retry shows the normal decided row and notice
- AC-3 [vitest]: While a decision is being recorded the confirm button shows it is busy and cannot be pressed a second time
- AC-4 [playwright]: In a bulk decision where some transactions fail, the ones that succeeded show their new status, the failed References are named with the server's message, and only the failed transactions stay selected for a retry
- AC-5 [playwright]: In a bulk decision where every transaction fails, no row changes, the server's message is shown, and the selection is kept

## Manual test checklist
- With a transaction open in two browser tabs, approve it in one tab, then try to approve it again from the other tab → you see the server's message and the row isn't changed to something new
- Press confirm again after an error → the decision is either recorded or the message shows again; nothing is recorded twice
- Ask a developer to briefly stop the transactions service, then approve a Pending row → you see an error message and the row stays Pending; once it's back, retrying records the approval

## Resolved design choices (user approved the recommended answer for each):
- Failed decision errors appear inside the confirmation dialog, which stays open so the Approver can retry.
- Partial bulk failure: keep the successful rows, name the failed References with the server's message, leave only the failed ones selected.
- Re-authentication (R14): rely on the live session; if it has expired the user is sent to sign in. No password prompt.
- "Decision is final" notice: the design's version (no icons + disabled-checkbox tooltip) is enough.

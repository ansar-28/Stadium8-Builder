# Approve and reject transactions

*Inherits roles, auth, data source, compliance, and styling from project.md.*

---

## Goal

Approvers approve or reject pending transactions one at a time or in bulk, with a confirmation step and a required rejection reason.

This epic adds the decision layer on top of the read-only Transactions screen delivered by the `transaction-list` epic: selection checkboxes, the leading tick/cross row-action column, the bulk-action bar, the Decision confirmation dialog, the decision toast, and the error handling for a failed decision. All of it is visible only to users holding the Approver role. A decision only records the transaction's status (and, for a rejection, its reason). It is final and triggers nothing downstream.

**Depends on:** `transaction-list` (the Transactions table, its columns, filters, sorting and pagination).

---

## Data Model

| Entity | Fields used by this epic | Source |
|---|---|---|
| **Transaction** (`TransactionRead`) | `Id` (integer, hidden, identifies the transaction to the decision calls), `Reference`, `Description`, `Amount`, `Currency` (named in the confirmation dialog), `Status` (Pending / Approved / Rejected), `UserNote` (the rejection reason, shown as "Reason: <reason>" under a Rejected chip), `LastChangedUser`, `LastChangedDate` | `documentation/Transaction-Management-API-Definition.yaml` `components.schemas.TransactionRead`; digest Data Shapes |
| **Approve decision** | `POST /v1/transactions/approve?TransactionId=<Id>`, header `LastChangedUser: <signed-in user's name>`; no body; response `DefaultResponse` | API spec `TransactionApprove` |
| **Reject decision** | `POST /v1/transactions/reject?TransactionId=<Id>`, header `LastChangedUser: <signed-in user's name>`, body `TransactionRejectWrite { UserNote: <reason> }`; response `DefaultResponse` | API spec `TransactionReject`, `TransactionRejectWrite` |
| **Bulk decision** (client-side only) | selected transaction Ids + action (approve / reject) + one shared reason for a bulk reject. The backend has no bulk endpoint: a bulk decision repeats the single call once per selected transaction | requirements §6 interface notes for TransactionApprove / TransactionReject; digest Data Shapes "Decision" |
| **Signed-in user** | display name (sent as `LastChangedUser`) and roles (Approver gates every control in this epic) | `GET /v1/auth/userinfo` (from project.md §Authentication) |

Calls go through the Next.js proxy with the `/transactions-api` path prefix, per project.md §Data Source.

---

## Functional Requirements

- **R1 — Approve a single transaction:** An Approver can approve a transaction individually; its status becomes Approved.
- **R2 — Reject a single transaction with a reason:** An Approver can reject a transaction individually and must give a text reason; the transaction shows Rejected and its reason.
- **R3 — Only Approvers get selection boxes on the transaction list:** On the transaction list, selection checkboxes are shown only to Approvers; a File Importer-only user sees none.
- **R4 — Smaller selection boxes on the transaction list:** Selection checkboxes on the transaction list are displayed at 75% of their size (14px, against the export list's 18px).
- **R5 — Approve several selected transactions at once:** An Approver can approve all selected transactions in one action.
- **R6 — Reject several selected transactions with one shared reason:** An Approver can reject all selected transactions in one action with a single reason recorded against each.
- **R7 — Confirmation step naming the transactions, stating the decision is final:** Approve and reject require a confirmation that names the affected transactions, states the decision is final, and starts focus on Cancel.
- **R8 — Decisions are final:** Once approved or rejected, no user or function can change a transaction's status; approve/reject are hidden with a notice naming the state.
- **R9 — Only Approvers can approve or reject:** A user without the Approver role cannot approve or reject transactions.
- **R10 — Tick and cross buttons at the start of each row:** Approvers decide with a green tick (approve) and red cross (reject) icon at the left of each row, between the checkbox and Reference.
- **R11 — No "Decision" column:** The transaction list has no column labelled Decision; the icon controls occupy an unlabelled leading column.
- **R12 — Confirmation notice when a decision is recorded:** An in-app notification tells the Approver when a decision is recorded.
- **R13 — A failed decision shows the server's message and changes nothing:** When the backend returns an error on a decision, its message is shown, the transaction keeps its previous status and the Approver can retry.
- **R14 — Re-confirm identity before approving or rejecting:** Re-authentication scope covers approve and reject actions.
- **R15 — A decision only records the status:** Approving or rejecting records the status only and triggers no downstream action.

---

## Business Rules

- **BR1:** Only users holding the Approver role see or can use any decision control: selection checkboxes, the row-action column, the bulk-action bar and the confirmation dialog. A user holding both roles is treated as an Approver.
- **BR2:** Only Pending transactions can be decided. Approved and Rejected rows show no tick/cross icons, and their checkboxes are disabled with the tooltip "<Status> — decision is final" (for example "Approved — decision is final").
- **BR3:** A decision is final. Nothing in the app changes an Approved or Rejected transaction's status again.
- **BR4:** A rejection is never recorded without a reason. A blank reason (after trimming) keeps the dialog open with "Enter a rejection reason to continue." (single) or "Enter one rejection reason for the selection." (multiple).
- **BR5:** A bulk rejection takes one reason, which is recorded against every selected transaction.
- **BR6:** Every decision call sends the signed-in user's name in the `LastChangedUser` header.
- **BR7:** No decision is recorded without the confirmation step. Cancel closes the dialog and changes nothing.
- **BR8:** The header checkbox selects all **pending** rows on the current page only.
- **BR9:** A decision records the status (and the reason, for a rejection) only. It triggers no other action.

---

## Key Workflows

### W1 — Approve one transaction
1. An Approver finds a Pending row on Transactions and clicks its green tick ("Approve <Reference>").
2. The confirmation dialog opens with the title "Approve 1 selected transaction?", lists the transaction as "<Reference> · <Description> · <Currency> <Amount>", shows "This decision is final.", and puts focus on "Cancel".
3. The Approver clicks "Approve".
4. The app records the approval. The dialog closes, the row shows Approved, its icons disappear, and the toast "Transaction <Reference> was approved." appears.

### W2 — Reject one transaction
1. The Approver clicks the red cross ("Reject <Reference>") on a Pending row.
2. The dialog opens titled "Reject 1 selected transaction?" with a "Rejection reason" textarea. Focus starts on "Cancel".
3. If the Approver clicks "Reject" with no reason, the dialog stays open with "Enter a rejection reason to continue." Typing clears the message.
4. With a reason entered, the Approver clicks "Reject". The row shows Rejected with "Reason: <reason>" beneath it, and the toast "Transaction <Reference> was rejected." appears.

### W3 — Bulk approve or reject
1. The Approver ticks one or more Pending rows, or uses the header checkbox to select all Pending rows on the page.
2. The bulk-action bar shows "N transactions selected" with "Approve selected", "Reject selected" and "Clear selection".
3. The Approver chooses an action. The dialog lists up to six transactions, then "and <N> more". For reject, a single "Rejection reason (applies to every selected transaction)" textarea is shown.
4. On confirm, the app records the decision for each selected transaction, closes the dialog, clears the selection and shows "<N> transactions were approved." / "<N> transactions were rejected."

### W4 — A decision fails
1. The backend returns an error for a decision call.
2. The app shows the server's message. The affected transaction keeps its previous status, and the Approver can try again.

### W5 — A File Importer-only user views Transactions
1. A user without the Approver role opens Transactions.
2. They see no checkboxes, no row-action column, no bulk bar and no decision controls. The list is otherwise unchanged.

---

## Feature NFRs

- **NFR1:** The confirmation dialog traps focus, closes on Esc (the same as Cancel), returns focus to the control that opened it, and is a labelled `role="dialog"` with `aria-modal`.
- **NFR2:** Every icon button and checkbox has an accessible name ("Approve <Reference>", "Reject <Reference>", "Select <Reference>", "Select all pending transactions on this page"). The row-action column header is announced as "Row actions".
- **NFR3:** The decision toast is announced through a polite live region (`role="status"`).
- **NFR4:** The 32px icon buttons and the 14px checkboxes still meet the 44×44px touch-target and WCAG 2.2 AA target-size rules through their hit area. The visual size stays as designed.

---

## Out of Scope

- **Blocking decisions on your own upload** (requirements BR-03, BR-10) and the **Decision blocked dialog**. You left these out when approving the epic plan: the backend does not record who uploaded a file, and no backend changes will be made. Approvers who also hold the File Importer role can decide transactions from their own uploads.
- Reversing or editing a decision (decisions are final).
- Selection on the export list. That is part of the `export-actioned-transactions` epic.
- Any downstream action after a decision, such as notifications to other users or postings.

---

## Notes & Caveats

- **Translate, don't copy:** the prototype records decisions client-side against 36 canned transactions with a fixed "today". Here, decisions call the real approve and reject endpoints. Do NOT carry forward to production the prototype's simulated decision recording, the own-upload dimming and the "From a file you uploaded" tooltip, or its inline tick/cross SVGs and hard-coded colours. Rebuild the icons as local icon components, and express the colours through design tokens and Shadcn primitives (Checkbox, Button, Dialog/AlertDialog, Textarea, toast).
- **Re-authentication (R14) has nothing to call:** the authentication API offers only login, logout, userinfo and health, with no re-authenticate or step-up endpoint, and the design has no re-auth prompt. Before BUILD, decide whether to drop this requirement, satisfy it with the live session check, or ask for the password again in the confirmation dialog through `POST /v1/auth/login`.
- **Bulk decisions are not atomic:** the backend decides one transaction per call, so a bulk approve or reject makes one call per selected transaction. If some calls succeed and others fail, the selection ends up partly decided. The design has no copy for this case. Confirm how to report it, for example a toast naming the References that failed and keeping only those selected for a retry.
- **Status values in the backend:** the API spec's `Status` example is "Imported", not "Pending", and the spec does not list the allowed values. The `transaction-list` epic owns this mapping. This epic needs it too, to decide which rows are decidable.
- **Where decision errors appear is not designed (R13):** the digest lists the failed-decision error state as undesigned. Confirm whether the server's message shows inside the dialog, as a persistent toast, or as a banner.
- **"Notice naming the state" (R8) is translated thinly:** the design shows it as the disabled-checkbox tooltip "<Status> — decision is final" plus the absence of the icons. No other notice is designed. Confirm that this is enough.
- **Approve and reject responses:** both calls return only `DefaultResponse`, not the updated transaction. After a successful decision, the app has to update the row locally or reload the list.

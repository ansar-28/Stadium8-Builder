# Epic Brief — Upload and uploaded files

*Inherits roles, auth, data source, compliance, and styling from project.md.*

| Field | Value |
|---|---|
| Epic slug | `file-upload-and-files` |
| Depends on | `sign-in-and-app-shell` |
| Screens touched | Upload transaction file, Uploaded files (plus the app-shell "Upload" nav item and toasts) |

---

## Goal

File Importers upload .csv transaction files and learn at once whether they were accepted; everyone can see the uploaded files and download them.

Only the seven-column layout (`Reference,TransactionDate,AccountNumber,Description,Amount,TransactionType,Currency`) is accepted. Both roles see the same file list and download action. Only a File Importer sees the upload action (requirements §5 Flow: Upload transaction file; Flow: View and download uploaded files).

---

## Data Model

Source: `documentation/Transaction-Management-API-Definition.yaml` (authoritative), cross-checked against requirements §7 and the design digest's Data Shapes.

### Uploaded file (`FileLog` schema, read via `GET /v1/file-logs`)

| Field | Type | Use in this epic |
|---|---|---|
| `Id` | integer | Hidden. The file log id passed to the download call. |
| `CurrentFileName` | string | Shown as **File name**. |
| `ProcessDate` | string | Shown as **Upload timestamp**. Newest first. |
| `CurrentStatus` | string | Hidden. Can be used to tell successfully uploaded files from others (see Notes & Caveats). |
| `RecordCount` | string | Hidden. May supply the transaction count in the upload success message (see Notes & Caveats). |
| `IsActive` | boolean | Hidden. The list call requires the `IsActive` query input (spec example `"Yes"`). |
| Other `FileLog` fields (`SettingId`, `SettingName`, `ProcessInstanceId`, `CurrentFolder`, `FileHash`, `Direction`, `LastExecutedActivityName`, `ProcessDefinitionId`, `ProcessName`, `BulkErrorFile`, `HasBulkErrorFile`) | — | Not displayed. |

The list response wraps the entries as `FileLogList.FileLog[]`.

### Upload request (`POST /v1/files/upload`)

| Input | Where | Value |
|---|---|---|
| `FileSettingId` | query, integer, required | The file setting for transaction files. The frontend supplies it and never asks the user (requirements §6.10, FilesUpload). |
| `FileSettingName` | query, string, required | Same file setting's name. |
| `FileName` | query, string, required | The chosen file's name. |
| body | `application/octet-stream` | The raw .csv bytes. |

The response is `DefaultResponse` (`Id`, `MessageType`, `Messages[]`) on both 200 and 500. A 401 has no body.

### Download (`GET /v1/files/download?FileLogId=<Id>`)

Returns `application/octet-stream` binary on 200. Returns `DefaultResponse` on 500, and the user sees its `Messages`.

### Import file layout (validated at upload)

The header row must be exactly `Reference,TransactionDate,AccountNumber,Description,Amount,TransactionType,Currency`. The sample file `documentation/transactions_2026-04-15.csv` is in this layout. Dates in it are written as `2026/04/15 08:12`, TransactionType as `C`/`D`, and Currency as a three-letter code.

---

## Functional Requirements

- **R1:** A File Importer can choose and upload a .csv file and see whether it was accepted; an accepted file appears in the file list and its transactions in the transaction list. *(R41 — F-04, UI-02)*
- **R2:** Any file not in the seven-column layout (Reference, TransactionDate, AccountNumber, Description, Amount, TransactionType, Currency), or not a .csv, is rejected with a clear message. *(R42 — F-05, BR-08, §6.3)*
- **R3:** An in-app notification tells the File Importer a file was rejected at upload. *(R43 — NT-01)*
- **R4:** A user without the File Importer role cannot upload files. *(R44 — BR-05)*
- **R5:** A user without the File Importer role who reaches the upload screen sees a banner naming the missing permission and a path to request access. *(R45 — §6.4.5)*
- **R6:** A user can view successfully uploaded files with file name and upload timestamp. *(R46 — F-06, UI-03)*
- **R7:** A user can download an uploaded file to the local machine. *(R47 — F-07, UI-03)*
- **R8:** On a server error during download, the server's message is shown and the user can retry. *(R48 — §5 View and download)*
- **R9:** With no files the list says "No files yet" and offers the upload action to a File Importer. *(R49 — §6.4.5)*

---

## Business Rules

- **BR1:** Only the seven-column .csv layout is accepted. The header row must match `Reference,TransactionDate,AccountNumber,Description,Amount,TransactionType,Currency` exactly, and the file must be a .csv. Anything else is rejected with "The file could not be uploaded. Only the seven-column .csv layout is accepted." *(BR-08)*
- **BR2:** Only a user holding the File Importer role can upload. The "Upload" nav item, the "Upload file" action and the "Upload a file" shortcuts are hidden from everyone else. *(BR-05, UI-20)*
- **BR3:** Both roles see the same file list and the same download action. *(§5 Flow: View and download uploaded files)*
- **BR4:** The file list shows only successfully uploaded files, newest first. *(F-06; digest Uploaded files)*
- **BR5:** The frontend sends the transaction-file setting (`FileSettingId`, `FileSettingName`) with every upload and never asks the user to choose it. *(requirements §6.10 FilesUpload)*
- **BR6:** Upload and download errors show the server's own message (`DefaultResponse.Messages`), say what failed and what the user can do next, and never blame the user. *(§5, requirements voice and tone)*

---

## Key Workflows

### Upload a transaction file (File Importer)

1. The File Importer opens **Upload** from the navigation, or uses "Upload a file" on the Uploaded files screen or an empty state.
2. They choose a file under "Choose a .csv file". The screen shows "Selected: **<name>**".
3. They press "Upload file". If no file is chosen, the screen shows "Choose a .csv file to upload."
4. The app checks the file type and header layout. If either is wrong, a red-bordered banner says "The file could not be uploaded. Only the seven-column .csv layout is accepted." A toast also says "The file <name> was rejected at upload."
5. A file that passes the layout check is sent to `POST /v1/files/upload`. On success, a green-bordered banner confirms the upload, and the file appears at the top of Uploaded files. A backend rejection or error shows the server's message in the failure banner and raises the rejected-at-upload toast.

### Non-File-Importer reaches the upload screen

1. An Approver-only user reaches the upload screen directly, for example by its URL.
2. A banner names the missing File Importer permission and gives a path to request access. No file chooser or upload action is shown.
3. The user goes back to a screen their role allows.

### View and download uploaded files (both roles)

1. The user opens **Files**. Uploaded files lists each file's name and upload timestamp, newest first, with pagination (5 / 10 / 20 / 50, default 20) and "Showing <n> of <total> files".
2. The user presses "Download" on a row (accessible name "Download <file name>"). The file is saved locally, and a toast says "<file name> downloaded."
3. If the server returns an error, its message is shown and the user can retry the download.
4. If there are no files, the list says "No files yet". File Importers also get an "Upload a file" button.

---

## Feature NFRs

- **NFR1:** An upload file can hold up to 10³ transactions (requirements data volume). The upload and the layout check must handle a file of that size without freezing the screen.
- **NFR2:** Upload and download go through the Next.js proxy with the `/transactions-api` prefix (project.md NFR-base-6). Binary bodies (`application/octet-stream`) must pass through the proxy unchanged in both directions.
- **NFR3:** Outcome banners use `role="status"`. The file input has a visible label. All controls work by keyboard alone (WCAG 2.2 AA, project.md NFR-base-1).

---

## Out of Scope

- The transaction list itself, including showing an uploaded file's transactions as Pending. That belongs to the `transaction-list` epic.
- Recording or showing who uploaded a file (`UploadedBy`), and the own-upload decision block. R32/R33 were dropped by user decision because the backend contract has no uploader field and the backend will not change.
- Cancelling or deleting files (`DELETE /v1/files`), retrying validation, browsing validation-error rows, bulk-error file downloads, and file-setting or file-location administration. The spec has these operations, but no requirement asks for them.

---

## Notes & Caveats

- **Do NOT carry forward to production: the demo sample buttons.** The upload screen's "Use a valid sample" and "Use an invalid sample" buttons only drive the prototype. Do not build them.
- **Do NOT carry forward to production: canned data and simulated behaviour.** The prototype's three sample files, fixed "today", client-side-only upload check and header-only download file are fake. Read the file list from `GET /v1/file-logs`, upload through `POST /v1/files/upload`, and download the real bytes from `GET /v1/files/download`.
- **Do NOT carry forward to production: in-place view switching and inline styles.** Upload and Files are real routes with URLs. Styles are expressed through design tokens and Shadcn primitives.
- **Which file setting to send is not known.** The upload call requires `FileSettingId` and `FileSettingName` for transaction files, but no source gives the values. `GET /v1/file-settings` can list them. Confirm which setting (or which configured value) identifies transaction files.
- **Who checks the layout.** The prototype checks the header row in the browser. The spec does not say whether the backend also validates and rejects. The plan here checks in the browser before upload and also treats a backend error response as a rejection. Confirm this is right.
- **Upload success wording.** The design's "…its 4 transactions are pending." uses the prototype's fixed count. The upload response (`DefaultResponse`) carries no transaction count, while the `FileLog` entry has `RecordCount`. Confirm whether the message should state the real count (looked up after upload) or use count-free wording.
- **"Successfully uploaded" filter.** `GET /v1/file-logs` requires `IsActive` (example `"Yes"`) and returns a `CurrentStatus` per file. The status values that mean "uploaded successfully" are not documented. Confirm whether `IsActive=Yes` alone is enough or whether a status filter is needed.
- **Permission-denied banner has no design.** The requirements ask for a banner naming the missing permission and a path to request access, but neither the copy nor the path (for example, a contact or an email) is given.
- **Error presentation for a failed download has no design.** The requirements say to show the server's message and allow a retry, but not where to show it (toast, banner or inline).
- **Toast persistence.** Prototype toasts, including "rejected at upload", auto-hide after about 4.5 s with no dismiss control. The design-system standard says toasts are dismissible and errors persist until acknowledged. Confirm which rule applies.
- **Files table sorting.** The prototype's Uploaded files table has no sort controls. The design-system standard says every column is sortable. Confirm whether this table should be sortable.
- **Upload timestamp format and pagination label.** The display format for `ProcessDate` is not settled (the prototype uses `YYYY-MM-DD HH:mm`). The pagination control is labelled "Previous" in the prototype and "Back" in the design-system standard. Confirm both.
- **R1 crosses into the transaction-list epic.** "Its transactions appear in the transaction list" can only be checked once the `transaction-list` epic is built. This epic covers the file-list half.

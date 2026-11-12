# Uploaded files list with download

```yaml
index: 1
    title: Uploaded files list with download
    slug: story-1-uploaded-files-list-with-download
    plainSummary: Everyone signed in can open Files and see every successfully uploaded file with its upload timestamp, newest first, and download any of them to their computer. If a download fails we show the server's message and let you try again; with no files yet the list says "No files yet", and File Importers get an "Upload a file" button.
    summary: Replaces the Files placeholder page with the Uploaded files table fed by GET /v1/file-logs (IsActive=Yes, via the /transactions-api proxy), showing File name and Upload timestamp newest first, with client-side pagination (5/10/20/50, default 20) and a "Showing <n> of <total> files" footer. Each row's Download button (accessible name "Download <file name>") fetches GET /v1/files/download?FileLogId=<Id> as binary through the API client, saves it under the file name and raises a "<file name> downloaded." toast; a DefaultResponse error shows its Messages with a retry. Covers loading/error/empty states, and the "Upload a file" header action and empty-state button shown only to File Importers.
    requirementIds: [R6, R7, R8, R9, BR2, BR3, BR4, BR6, NFR2, NFR3]
    roles: [File Importer, Approver]
    route: /files
    targetFile: web/src/app/(app)/files/page.tsx
    pageAction: modify_existing
    isInfrastructureOnly: false
    acceptanceCriteria:
      - id: AC-1
        text: The Uploaded files table lists each successfully uploaded file's name and upload timestamp, newest first, with a "Showing <n> of <total> files" count
        coverage: vitest
      - id: AC-2
        text: Changing the page size (5 / 10 / 20 / 50, default 20) or moving between pages changes which files are shown and the count updates to match
        coverage: playwright
      - id: AC-3
        text: Pressing "Download <file name>" saves that file to the user's computer under its file name and shows the toast "<file name> downloaded."
        coverage: playwright
      - id: AC-4
        text: When a download fails on the server, the server's own message is shown, saying what failed and what to do next, and the user can retry the download
        coverage: vitest
      - id: AC-5
        text: With no files, the list says "No files yet"; a File Importer also sees "Upload a file" buttons (header and empty state) that open the upload screen, while an Approver-only user sees neither
        coverage: vitest
      - id: AC-6
        text: When the file list cannot be loaded, the user sees what went wrong and can try loading it again
        coverage: vitest
    manualTestChecklist:
      - "Open Files → you see your uploaded files with file name and upload timestamp, newest at the top, and \"Showing n of total files\" below"
      - "Change the rows-per-page to 5 → only 5 files show and you can page to the next ones"
      - "Press Download on a file → the file saves to your computer with the right name and a \"<file name> downloaded.\" message appears"
      - "Open the downloaded file → it contains the same rows that were uploaded"
      - "Sign in as a File Importer → you see an \"Upload a file\" button on Files; sign in as an Approver only → that button is not there"
      - "Use the keyboard alone (Tab / Enter) to reach and press a Download button"
    additionalTechnicalChecksCount: 2
```

Design choices applied (defaults): success message without transaction count; permission banner says to ask an administrator, with a link back to Files, no contact email; download failure shown as a persistent red toast with "Try again"; files table not sortable; timestamps as YYYY-MM-DD HH:mm; paging button labelled "Previous".

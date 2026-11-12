# Upload a transaction file

```yaml
index: 2
    title: Upload a transaction file
    slug: story-2-upload-a-transaction-file
    plainSummary: A File Importer opens Upload, chooses a .csv file and presses "Upload file". We check it is in the seven-column layout and tell you straight away whether it was accepted; an accepted file shows up at the top of Uploaded files, and a rejected one gets a clear message plus a "rejected at upload" notification.
    summary: Replaces the Upload placeholder with a card holding a labelled .csv file input ("Choose a .csv file"), a "Selected: <name>" line, an "Upload file" button and a role="status" outcome banner (green on success, red on failure). The browser checks the extension and that the header row is exactly the seven-column layout (without blocking the screen for files up to 1,000 rows); a passing file is POSTed as application/octet-stream to /v1/files/upload with the transaction-file FileSettingId/FileSettingName and FileName query inputs, through the binary-safe proxy. A layout failure or a backend DefaultResponse error shows the failure banner (server Messages for backend errors) and an error toast "The file <name> was rejected at upload."; success shows the confirmation banner. No demo sample buttons.
    requirementIds: [R1, R2, R3, BR1, BR5, BR6, NFR1, NFR2, NFR3]
    roles: [File Importer]
    route: /upload
    targetFile: web/src/app/(app)/upload/page.tsx
    pageAction: modify_existing
    isInfrastructureOnly: false
    acceptanceCriteria:
      - id: AC-1
        text: Choosing a file shows "Selected: <name>"; pressing "Upload file" with nothing chosen shows "Choose a .csv file to upload."
        coverage: vitest
      - id: AC-2
        text: A file that is not a .csv, or whose header row is not exactly the seven-column layout, is not sent; the red-bordered banner says "The file could not be uploaded. Only the seven-column .csv layout is accepted." and a notification says "The file <name> was rejected at upload."
        coverage: vitest
      - id: AC-3
        text: Uploading a valid seven-column .csv shows the green-bordered success banner, and the file then appears at the top of Uploaded files
        coverage: playwright
      - id: AC-4
        text: When the server rejects or fails the upload, the failure banner shows the server's own message and the "rejected at upload" notification appears
        coverage: vitest
      - id: AC-5
        text: A valid file of 1,000 transactions passes the layout check and uploads successfully
        coverage: playwright
      - id: AC-6
        text: The upload screen passes an automated accessibility scan — the file input has a visible label and the outcome banner is announced as a status
        coverage: playwright
    manualTestChecklist:
      - "As a File Importer, open Upload from the navigation → you see the \"Choose a .csv file\" chooser and an \"Upload file\" button"
      - "Press Upload file without choosing a file → you see \"Choose a .csv file to upload.\""
      - "Choose the sample file transactions_2026-04-15.csv → \"Selected: transactions_2026-04-15.csv\" appears; press Upload file → a green success message appears"
      - "Open Files → the file you just uploaded is at the top of the list"
      - "Choose a .txt file, or a .csv with different column headings, and press Upload file → a red message says only the seven-column .csv layout is accepted, and a \"was rejected at upload\" notification appears"
      - "Do the whole upload with the keyboard alone (Tab to the chooser, pick a file, Tab to Upload file, press Enter)"
    additionalTechnicalChecksCount: 2
```

Design choices applied (defaults): success message without transaction count; permission banner says to ask an administrator, with a link back to Files, no contact email; download failure shown as a persistent red toast with "Try again"; files table not sortable; timestamps as YYYY-MM-DD HH:mm; paging button labelled "Previous".

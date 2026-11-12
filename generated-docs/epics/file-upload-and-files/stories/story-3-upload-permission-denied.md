# Upload screen for users without the File Importer role

```yaml
index: 3
    title: Upload screen for users without the File Importer role
    slug: story-3-upload-permission-denied
    plainSummary: A user who isn't a File Importer (for example an Approver) and reaches the upload screen by typing its address sees a banner saying they need the File Importer permission and how to ask for it, with no file chooser or upload button.
    summary: Role-gates the /upload page using the session's roles (hasRole with the File Importer role). Users without File Importer see a role="status" permission banner naming the missing "File Importer" permission and a path to request access, and the chooser and "Upload file" action are not rendered (the Upload nav item is already hidden by the app frame). The page renders normally inside the app frame — no error page — and the backend remains the authority on permissions.
    requirementIds: [R4, R5, BR2]
    roles: [Approver, File Importer]
    route: /upload
    targetFile: web/src/app/(app)/upload/page.tsx
    pageAction: modify_existing
    isInfrastructureOnly: false
    acceptanceCriteria:
      - id: AC-1
        text: A signed-in user without the File Importer role sees a banner naming the missing File Importer permission and how to request access, and no file chooser or "Upload file" button
        coverage: vitest
      - id: AC-2
        text: An Approver-only user who types the upload screen's address lands on the upload screen inside the normal app frame showing the permission banner, not an error page, and can navigate back to Files or Transactions
        coverage: playwright
      - id: AC-3
        text: A user holding both roles sees the full upload screen and no permission banner
        coverage: vitest
    manualTestChecklist:
      - "Sign in as an Approver only → there is no Upload item in the navigation"
      - "As that Approver, type /upload in the address bar → you see a banner saying you need the File Importer permission and how to ask for it, with no file chooser and no Upload file button"
      - "From that screen, click Files in the navigation → the Uploaded files list opens normally"
      - "Sign in as a user with both roles and open Upload → you see the normal upload screen"
    additionalTechnicalChecksCount: 0
```

Design choices applied (defaults): success message without transaction count; permission banner says to ask an administrator, with a link back to Files, no contact email; download failure shown as a persistent red toast with "Try again"; files table not sortable; timestamps as YYYY-MM-DD HH:mm; paging button labelled "Previous".

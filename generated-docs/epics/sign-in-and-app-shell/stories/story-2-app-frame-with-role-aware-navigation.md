# Story 2: App frame with role-aware navigation

- **slug:** story-2-app-frame-with-role-aware-navigation
- **requirementIds:** R6, R7, R10, BR3, BR4, NFR2
- **roles:** File Importer, Approver
- **route:** /transactions
- **targetFile:** web/src/components/layout/AppHeader.tsx
- **pageAction:** create_new
- **isInfrastructureOnly:** false

## Summary

Builds the persistent app frame inside the (app) layout — header with product name, nav landmark "Main" (Transactions, Files, Upload for File Importer only, Export) as real routes with active-state styling, display name from FirstName + LastName, one chip per Roles[] entry, and the bottom-right toast area restyled from the existing ToastContext/ToastContainer in a polite live region. Adds placeholder protected pages for /transactions, /files, /upload and /export (content arrives in later epics). Roles come only from userinfo; hiding is a usability measure. Also adds a light/dark theme switch in the header: the app follows the computer's light/dark setting by default and the switch lets the user override it (remembered in the browser).

## Plain summary

Once signed in, every screen sits inside the brand-blue header showing "Transaction Management", the navigation, your name and a chip for each of your roles. The Upload item appears only for File Importers, and moving between Transactions, Files, Upload and Export changes the address and highlights where you are. A switch in the header lets you choose light or dark; until you choose, the app follows your computer's setting.

## Acceptance criteria

- **AC-1** (vitest): The header shows "Transaction Management", the signed-in user's full name, and one chip per role they hold
- **AC-2** (vitest): The Upload navigation item appears for users holding File Importer and is absent for users who do not
- **AC-3** (playwright): Choosing a navigation item opens that screen, updates the address, and highlights the active item
- **AC-4** (vitest): Notifications appear in the bottom-right notification area and are announced politely to assistive technology
- **AC-5** (playwright): The frame is fully keyboard operable and passes an automated accessibility scan
- **AC-6** (vitest): With no saved choice the app follows the computer's light/dark setting, and the header switch lets the user pick light or dark, which is remembered on their next visit
- **AC-7** (playwright): Switching theme changes the whole app's appearance (header, page and notifications) without a reload, and both themes pass an automated accessibility scan

## Manual test checklist

- Sign in as a File Importer → the header shows your name, a "File Importer" chip, and Transactions, Files, Upload and Export
- Sign in as an Approver only → you see an "Approver" chip and no Upload item
- Sign in as a user with both roles → you see both chips and the Upload item
- Click Files → the address changes to the Files screen and Files is highlighted; press the browser Back button → you're back on Transactions
- Tab through the header → every item can be reached and opened with the keyboard, with a visible focus outline
- Change your computer between light and dark (before touching the switch) → the app follows it
- Use the header switch to pick dark, then refresh → it stays dark; pick light → it changes back straight away

## Resolved design choices

- **Notifications (App shell):** each notification has a close button; success messages fade after a few seconds, errors stay until closed. This follows the design-system standard rather than the prototype's 4.5-second auto-hide with no close button.
- **Colour scheme:** both light and dark, following the computer's setting by default, with a header switch to override. The light palette is the brand source of truth; the dark palette is the derived dark token set in the design system. Colours come from tokens in `globals.css`, never hex literals in components.

## Technical notes

- additionalTechnicalChecksCount: 1
- Reuse: the toast system already exists (`web/src/contexts/ToastContext.tsx`, `web/src/components/toast/Toast.tsx`, `ToastContainer.tsx`) — restyle and reposition it (bottom-right, primary-blue left edge, polite live region), add the close button and the success-fades/errors-persist behaviour, rather than building a new one.
- The theme switch is a Shadcn-composed control; the theme preference may be stored in browser storage (a per-viewer convenience, never the session token).

# Story 1: Sign in and protected entry to the app

- **slug:** story-1-sign-in-and-protected-entry
- **requirementIds:** R1, R2, R3, R5, R10, R11, BR1, BR2, BR5, NFR1, NFR2, NFR3
- **roles:** File Importer, Approver
- **route:** /sign-in
- **targetFile:** web/src/app/(app)/layout.tsx
- **pageAction:** create_new
- **isInfrastructureOnly:** false

## Summary

Builds the Sign in screen (centred card, Username/Password, inline alert errors, "Sign in" button) wired to the real login endpoint through the Next.js proxy so the HttpOnly session cookie stays same-origin. Creates the protected (app) route group whose layout checks the session against userinfo on every load and redirects to /sign-in when it is missing or invalid; replaces the template's public welcome page at / with a redirect into the protected area. Successful sign-in opens /transactions with a loading placeholder.

## Plain summary

Staff sign in with their own username and password and land on Transactions. Anyone without a valid session, whether they open the app's front page or type a screen's address directly, is sent to Sign in first.

## Acceptance criteria

- **AC-1** (vitest): Submitting with either field blank (after trimming) shows "Username and password are required." inline and sends nothing
- **AC-2** (vitest): Rejected credentials show "Sign-in failed. Check your details and try again." inline, identical on repeated failures, and editing either field clears it
- **AC-3** (playwright): Valid credentials (by button or Enter) take the user to the Transactions screen inside the app, showing a loading placeholder first
- **AC-4** (playwright): While signed out or with an expired session, opening any protected address — including the app's front page — sends the user to Sign in, not a welcome page
- **AC-5** (playwright): The Sign in screen can be completed by keyboard alone and passes an automated accessibility scan
- **AC-6** (none): The app becomes usable within 3 seconds and shows meaningful content within 1.5 seconds of signing in, with the first download under 300 KB

## Manual test checklist

- Open the app while signed out → you land on the Sign in page, not a welcome page
- While signed out, type the Files screen's address into the address bar → you're sent to Sign in
- Click Sign in with the Password left blank → you see "Username and password are required."
- Sign in with a wrong password → you see "Sign-in failed. Check your details and try again."; start typing in either field and the message disappears
- Sign in with your own username and password → you see a loading placeholder, then the Transactions screen
- Tab through the Sign in page and press Enter on the button → you can sign in without the mouse

## Resolved design choices

- **Password field (Sign in):** the password is hidden as typed (dots), with a show/hide button. This overrides the prototype's plain-text password field.
- **Colour scheme:** the app supports both light and dark, following the computer's light/dark setting by default (see Story 2 for the switch). The Sign in screen must render correctly in both.

## Technical notes

- additionalTechnicalChecksCount: 1
- Reuse: all auth calls go through `web/src/lib/api/client.ts` pointed at the same-origin proxy (no proxy exists yet — this story adds it for the auth service, including the transactions service's `/transactions-api` prefix when that proxy is needed later). Shadcn button, card, input, label are installed. Add the sign-in schema to `web/src/lib/validation/schemas.ts`. Replace the template's `web/src/app/layout.tsx` metadata/title ("Transaction Management", Open Sans) and the public welcome page at `web/src/app/page.tsx`.

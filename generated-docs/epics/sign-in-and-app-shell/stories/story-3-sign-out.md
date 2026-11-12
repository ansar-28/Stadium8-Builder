# Story 3: Sign out

- **slug:** story-3-sign-out
- **requirementIds:** R4, BR5, NFR2, NFR3
- **roles:** File Importer, Approver
- **route:** /transactions
- **targetFile:** web/src/components/layout/SignOutButton.tsx
- **pageAction:** create_new
- **isInfrastructureOnly:** false

## Summary

Wires the header's Sign out button to the real logout endpoint through the proxy, showing "Signing out…" and disabling the button while awaiting the response, then navigating to /sign-in with form state cleared. Ensures protected pages are not served from the browser cache after sign-out (no-store / session re-check on back navigation) so BR5 holds. A failed sign-out surfaces an error with a way to retry.

## Plain summary

Staff choose "Sign out" in the header; the button reads "Signing out…" until the sign-out finishes, then they're back on Sign in with the password cleared. Pressing the browser Back button afterwards does not reveal the app.

## Acceptance criteria

- **AC-1** (vitest): While sign-out is in progress the button reads "Signing out…" and cannot be pressed again
- **AC-2** (playwright): When sign-out completes the user is on Sign in with both fields empty. The app keeps nothing the user typed; a password saved in the user's own browser may still be filled in by the browser's autofill, which is left as is (user decision, 2026-11-12) to keep accessibility and password-manager support.
- **AC-3** (playwright): After signing out, pressing the browser Back button returns the user to Sign in rather than the previously viewed screen
- **AC-4** (vitest): If sign-out fails, the user sees an error message and can try signing out again

## Manual test checklist

- Click Sign out → the button briefly reads "Signing out…", then you're on Sign in with the fields empty (in a private window; a normal window may show a password your browser saved)
- Sign in, sign out, then press the browser Back button → you're sent to Sign in, not back into the app
- After signing out, type the Transactions screen's address → you're sent to Sign in

## Resolved design choices

- Light and dark both apply, following the computer's setting with the header switch (Story 2). Error messages use the notification behaviour from Story 2 (errors stay until closed).

## Technical notes

- additionalTechnicalChecksCount: 1

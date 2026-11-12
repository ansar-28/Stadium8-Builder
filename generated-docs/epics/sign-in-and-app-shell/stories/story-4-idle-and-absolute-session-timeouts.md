# Story 4: Idle and 8-hour session timeouts

- **slug:** story-4-idle-and-absolute-session-timeouts
- **requirementIds:** R8, R9, BR5, NFR2
- **roles:** File Importer, Approver
- **route:** /transactions
- **targetFile:** web/src/components/layout/SessionTimeout.tsx
- **pageAction:** create_new
- **isInfrastructureOnly:** false

## Summary

Adds an activity tracker inside the (app) frame that shows an accessible modal warning (Shadcn dialog, focus moved into it, "Stay signed in" / "Sign out") after 14 minutes idle, signs the user out via the logout endpoint after a further 60 seconds, and independently signs out 8 hours after sign-in (sign-in time persisted client-side, never the token). User activity resets the idle timer; "Stay signed in" dismisses the warning and resets it.

## Plain summary

If you leave the app untouched for 14 minutes a warning gives you 60 seconds to stay signed in; ignore it and you're signed out. Regardless of activity, you're signed out 8 hours after signing in.

## Acceptance criteria

- **AC-1** (playwright): After 14 minutes without activity a warning appears offering to stay signed in, and activity before then postpones it
- **AC-2** (playwright): Choosing "Stay signed in" closes the warning and the user remains on their screen
- **AC-3** (playwright): With no response within 60 seconds of the warning, the user is signed out and returned to Sign in
- **AC-4** (playwright): Eight hours after sign-in the user is signed out and returned to Sign in, even while active
- **AC-5** (vitest): When the warning opens, keyboard focus moves into it and it can be answered by keyboard alone

## Manual test checklist

- Sign in and leave the app untouched for 14 minutes → a warning says you'll be signed out soon
- Click "Stay signed in" → the warning closes and you stay on the same screen
- Leave the warning unanswered for 60 seconds → you're returned to Sign in
- When the warning appears, press Tab and Enter → you can answer it without the mouse

## Resolved design choices

- Light and dark both apply, following the computer's setting with the header switch (Story 2); the warning dialog must look right in both. The prototype has no design for this warning, so compose it from the Shadcn dialog using design tokens.

## Technical notes

- additionalTechnicalChecksCount: 0
- Add the Shadcn `dialog` component for the warning.

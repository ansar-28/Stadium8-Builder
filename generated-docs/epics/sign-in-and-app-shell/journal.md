# Journal — Sign-in and app frame

## Story 1: Sign in and protected entry to the app

- Sign in now uses the real login endpoint through the app's own address. The app passes the request on to the auth service, so the browser never talks to the backend directly and the session cookie stays with the app.
- Every screen except Sign in is now protected. Without a session cookie you go straight to Sign in, and with an expired session the app checks with the server, shows a loading placeholder, then sends you to Sign in.
- The brand colours, both light and dark, and the Open Sans font are now applied app-wide. Dark mode follows the computer's setting.

## Story 2: App frame with role-aware navigation

- Every signed-in screen now sits under the brand-blue header. It shows "Transaction Management", the Transactions / Files / Upload / Export navigation, your name and a chip for each role. Upload appears only for File Importers, and the screen you're on is highlighted and shown in the address.
- Files, Upload and Export now have their own protected screens, each showing just its title and description for now. Their content comes in later epics.
- A "Dark mode" switch in the header lets you pick light or dark, and the browser remembers your pick. Until you choose, the app follows your computer's setting, including if you change it while the app is open.
- Notifications now appear bottom-right, and screen readers announce them politely. Each one has a close button. Success messages fade after about five seconds, and errors stay until you close them.

## Story 3: Sign out

- The header now has a working Sign out button. It reads "Signing out…" and can't be pressed again until the sign-out finishes, then you're back on Sign in with empty fields. Pressing Back afterwards re-checks your session and returns you to Sign in.
- If sign-out fails, an error notification says "Sign-out failed" and stays until you close it. The button becomes available again so you can retry.

## Story 4: Idle and 8-hour session timeouts

- After 14 minutes without activity, a warning now says you're about to be signed out and offers "Stay signed in" or "Sign out". If you don't answer within 60 seconds, you're signed out and returned to Sign in.
- You're now signed out 8 hours after signing in, even if you're active. The app keeps only the time you signed in on your computer, never your session key.
- The warning opens with "Stay signed in" already focused. Tab stays inside the warning and Enter answers it. Pressing Escape or clicking outside doesn't close it.

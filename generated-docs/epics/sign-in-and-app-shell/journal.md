# Journal — Sign-in and app frame

## Story 1: Sign in and protected entry to the app

- Sign in now uses the real login endpoint through the app's own address. The app passes the request on to the auth service, so the browser never talks to the backend directly and the session cookie stays with the app.
- Every screen except Sign in is now protected. Without a session cookie you go straight to Sign in, and with an expired session the app checks with the server, shows a loading placeholder, then sends you to Sign in.
- The brand colours, both light and dark, and the Open Sans font are now applied app-wide. Dark mode follows the computer's setting.

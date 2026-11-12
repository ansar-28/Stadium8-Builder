import { NextResponse, type NextRequest } from 'next/server';

import {
  SESSION_COOKIE_NAME,
  SIGN_IN_PATH,
} from '@/lib/auth/session-constants';

/**
 * Server-side gate for every screen except Sign in: a request with no session
 * cookie is sent straight to Sign in before any protected page renders. Only
 * cookie presence is checked here — whether the session is still valid is
 * confirmed against userinfo by the (app) layout on every screen load.
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE_NAME)) {
    const response = NextResponse.next();
    // Protected pages must never come back from the browser cache after sign-out.
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
  const signInUrl = request.nextUrl.clone();
  signInUrl.pathname = SIGN_IN_PATH;
  signInUrl.search = '';
  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: [
    // Everything except Sign in, the proxied API paths, Next.js internals and static files.
    '/((?!sign-in|v1/|transactions-api/|_next/|favicon\\.ico|.*\\.[a-zA-Z0-9]+$).*)',
  ],
};

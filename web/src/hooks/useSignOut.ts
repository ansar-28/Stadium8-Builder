'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { logout } from '@/lib/api/endpoints';
import { clearSignInTime } from '@/lib/auth/session-clock';
import { SIGN_IN_PATH } from '@/lib/auth/session-constants';

export type SignOutOutcome = 'signed-out' | 'failed' | 'already-signing-out';

/**
 * Ends the session through the logout endpoint and, once it succeeds, returns the
 * user to Sign in. Each caller decides how to report a `'failed'` outcome. A call
 * made while another is pending is ignored (`'already-signing-out'`).
 *
 * A pushed (not replaced) history entry keeps Back pointing at the protected
 * screen, whose layout re-checks the session and sends the user to Sign in.
 */
export function useSignOut() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const isPendingRef = useRef(false);

  const signOut = useCallback(async (): Promise<SignOutOutcome> => {
    if (isPendingRef.current) return 'already-signing-out';
    isPendingRef.current = true;
    setIsSigningOut(true);
    try {
      await logout();
      clearSignInTime();
      router.push(SIGN_IN_PATH);
      return 'signed-out';
    } catch {
      isPendingRef.current = false;
      setIsSigningOut(false);
      return 'failed';
    }
  }, [router]);

  return { signOut, isSigningOut };
}

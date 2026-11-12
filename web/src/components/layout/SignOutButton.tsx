'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { useToast } from '@/contexts/ToastContext';
import { logout } from '@/lib/api/endpoints';
import { SIGN_IN_PATH } from '@/lib/auth/session-constants';

const SIGN_OUT_FAILED_TITLE = 'Sign-out failed';
const SIGN_OUT_FAILED_MESSAGE =
  'You are still signed in. Please try signing out again.';

/**
 * Header control that ends the session. It waits for the logout response before
 * leaving the screen; Sign in then mounts fresh, so its fields start empty.
 * A pushed (not replaced) history entry keeps Back pointing at the protected
 * screen, whose layout re-checks the session and sends the user to Sign in.
 */
export function SignOutButton() {
  const router = useRouter();
  const { showToast } = useToast();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      await logout();
      router.push(SIGN_IN_PATH);
    } catch {
      setIsSigningOut(false);
      showToast({
        variant: 'error',
        title: SIGN_OUT_FAILED_TITLE,
        message: SIGN_OUT_FAILED_MESSAGE,
      });
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handleSignOut}
      disabled={isSigningOut}
      aria-busy={isSigningOut}
      className="min-h-11 border-brand-foreground bg-transparent font-semibold text-brand-foreground shadow-none hover:bg-brand-foreground/15 hover:text-brand-foreground focus-visible:border-brand-foreground focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-foreground dark:border-brand-foreground dark:bg-transparent dark:hover:bg-brand-foreground/15"
    >
      {isSigningOut ? 'Signing out…' : 'Sign out'}
    </Button>
  );
}

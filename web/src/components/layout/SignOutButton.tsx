'use client';

import { Button } from '@/components/ui/button';
import { useToast } from '@/contexts/ToastContext';
import { useSignOut } from '@/hooks/useSignOut';

const SIGN_OUT_FAILED_TITLE = 'Sign-out failed';
const SIGN_OUT_FAILED_MESSAGE =
  'You are still signed in. Please try signing out again.';

/**
 * Header control that ends the session. It waits for the logout response before
 * leaving the screen; Sign in then mounts fresh, so its fields start empty.
 */
export function SignOutButton() {
  const { showToast } = useToast();
  const { signOut, isSigningOut } = useSignOut();

  async function handleSignOut() {
    if (isSigningOut) return;
    const outcome = await signOut();
    if (outcome === 'failed') {
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

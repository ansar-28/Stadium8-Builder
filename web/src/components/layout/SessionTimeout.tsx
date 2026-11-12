'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useSignOut } from '@/hooks/useSignOut';
import {
  ABSOLUTE_SESSION_LIFETIME_MS,
  IDLE_SIGN_OUT_AFTER_MS,
  IDLE_WARNING_AFTER_MS,
  clearSignInTime,
  readSignInTime,
  recordSignInTime,
} from '@/lib/auth/session-clock';
import { SIGN_IN_PATH } from '@/lib/auth/session-constants';

const SESSION_CHECK_INTERVAL_MS = 1000;

const ACTIVITY_EVENTS = [
  'mousemove',
  'mousedown',
  'keydown',
  'touchstart',
  'wheel',
  'scroll',
] as const;

/**
 * Ends the session after 15 idle minutes (warning 60 seconds before) and 8 hours
 * after sign-in. Elapsed time is compared against `Date.now()` on every check, so
 * a throttled background tab still signs out on time once it wakes.
 */
export function SessionTimeout() {
  const router = useRouter();
  const { signOut } = useSignOut();
  const [isWarningOpen, setIsWarningOpen] = useState(false);

  const staySignedInButtonRef = useRef<HTMLButtonElement>(null);
  const lastActivityAtRef = useRef(0);
  const isWarningOpenRef = useRef(false);
  const hasEndedSessionRef = useRef(false);

  const endSession = useCallback(async () => {
    if (hasEndedSessionRef.current) return;
    hasEndedSessionRef.current = true;
    const outcome = await signOut();
    if (outcome === 'failed') {
      // The user must still leave the signed-in screens; Sign in is the only safe place.
      clearSignInTime();
      router.push(SIGN_IN_PATH);
    }
  }, [router, signOut]);

  const endSessionRef = useRef(endSession);
  useEffect(() => {
    endSessionRef.current = endSession;
  }, [endSession]);

  const openWarning = useCallback((isOpen: boolean) => {
    isWarningOpenRef.current = isOpen;
    setIsWarningOpen(isOpen);
  }, []);

  useEffect(() => {
    lastActivityAtRef.current = Date.now();
    let signedInAt = readSignInTime();
    if (signedInAt === null) {
      signedInAt = Date.now();
      recordSignInTime(signedInAt);
    }
    const absoluteDeadline = signedInAt + ABSOLUTE_SESSION_LIFETIME_MS;

    function checkSession() {
      if (hasEndedSessionRef.current) return;
      const now = Date.now();
      const idleFor = now - lastActivityAtRef.current;
      if (now >= absoluteDeadline || idleFor >= IDLE_SIGN_OUT_AFTER_MS) {
        void endSessionRef.current();
        return;
      }
      if (idleFor >= IDLE_WARNING_AFTER_MS && !isWarningOpenRef.current) {
        openWarning(true);
      }
    }

    function recordActivity() {
      // While the warning is open only "Stay signed in" counts as staying active.
      if (isWarningOpenRef.current) return;
      lastActivityAtRef.current = Date.now();
    }

    for (const eventName of ACTIVITY_EVENTS) {
      document.addEventListener(eventName, recordActivity, {
        capture: true,
        passive: true,
      });
    }
    checkSession();
    const intervalId = window.setInterval(
      checkSession,
      SESSION_CHECK_INTERVAL_MS,
    );

    return () => {
      window.clearInterval(intervalId);
      for (const eventName of ACTIVITY_EVENTS) {
        document.removeEventListener(eventName, recordActivity, {
          capture: true,
        });
      }
    };
  }, [openWarning]);

  function handleStaySignedIn() {
    lastActivityAtRef.current = Date.now();
    openWarning(false);
  }

  return (
    <Dialog open={isWarningOpen}>
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          staySignedInButtonRef.current?.focus();
        }}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        className="rounded-[10px] border-border bg-card text-card-foreground motion-reduce:animate-none"
      >
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">
            You&apos;re about to be signed out
          </DialogTitle>
          <DialogDescription className="text-base text-muted-foreground">
            You haven&apos;t been active for a while. For your security,
            you&apos;ll be signed out in 60 seconds unless you choose to stay
            signed in.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => void endSession()}
            className="min-h-11 font-semibold"
          >
            Sign out
          </Button>
          <Button
            ref={staySignedInButtonRef}
            type="button"
            onClick={handleStaySignedIn}
            className="min-h-11 font-semibold hover:bg-primary-hover"
          >
            Stay signed in
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

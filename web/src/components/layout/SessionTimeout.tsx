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
  readLastActivityTime,
  readSignInTime,
  recordLastActivityTime,
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

const ACTIVITY_SHARE_INTERVAL_MS = 1000;

function markActive(lastActivityAtRef: { current: number }, activeAt: number) {
  lastActivityAtRef.current = activeAt;
  recordLastActivityTime(activeAt);
}

/**
 * Ends the session after 15 idle minutes (warning 60 seconds before) and 8 hours
 * after sign-in. Elapsed time is compared against `Date.now()` on every check, so
 * a throttled background tab still signs out on time once it wakes. Idleness is
 * measured from the latest activity in any open tab, because sign-out ends the
 * session they all share.
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
    markActive(lastActivityAtRef, Date.now());
    let signedInAt = readSignInTime();
    if (signedInAt === null) {
      signedInAt = Date.now();
      recordSignInTime(signedInAt);
    }
    const absoluteDeadline = signedInAt + ABSOLUTE_SESSION_LIFETIME_MS;

    function checkSession() {
      if (hasEndedSessionRef.current) return;
      const now = Date.now();
      const lastActivityInAnyTab = Math.max(
        lastActivityAtRef.current,
        readLastActivityTime() ?? 0,
      );
      lastActivityAtRef.current = lastActivityInAnyTab;
      const idleFor = now - lastActivityInAnyTab;
      if (now >= absoluteDeadline || idleFor >= IDLE_SIGN_OUT_AFTER_MS) {
        void endSessionRef.current();
        return;
      }
      if (idleFor >= IDLE_WARNING_AFTER_MS) {
        if (!isWarningOpenRef.current) openWarning(true);
      } else if (isWarningOpenRef.current) {
        // The user became active in another tab, so this tab is no longer idle.
        openWarning(false);
      }
    }

    function recordActivity() {
      // While the warning is open only "Stay signed in" counts as staying active.
      if (isWarningOpenRef.current) return;
      const now = Date.now();
      // Activity events fire many times a second; sharing it once a second is enough.
      if (now - lastActivityAtRef.current < ACTIVITY_SHARE_INTERVAL_MS) return;
      markActive(lastActivityAtRef, now);
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
    markActive(lastActivityAtRef, Date.now());
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

'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import { AppHeader } from '@/components/layout/AppHeader';
import { SessionTimeout } from '@/components/layout/SessionTimeout';
import { SignOutButton } from '@/components/layout/SignOutButton';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { SessionProvider } from '@/contexts/SessionContext';
import { getUserInfo } from '@/lib/api/endpoints';
import { SIGN_IN_PATH } from '@/lib/auth/session-constants';
import type { APIError } from '@/types/api';
import type { UserInfoRead } from '@/types/api-generated';

type SessionCheck =
  | { status: 'checking' }
  | { status: 'confirmed'; user: UserInfoRead }
  | { status: 'rejected' }
  | { status: 'unavailable' };

const SESSION_REJECTED_STATUS_CODES = new Set([401, 403]);

function isSessionRejection(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { statusCode } = error as APIError;
  return (
    typeof statusCode === 'number' &&
    SESSION_REJECTED_STATUS_CODES.has(statusCode)
  );
}

function LoadingPlaceholder() {
  return (
    <div
      role="status"
      aria-label="Loading…"
      className="mx-auto flex w-full max-w-[1280px] flex-col gap-3 p-6"
    >
      <div className="h-8 w-48 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
      <div className="h-4 w-80 max-w-full animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
      <div className="mt-4 h-40 w-full animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
    </div>
  );
}

function SessionCheckUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-[1280px] justify-center p-6">
      <Card role="alert" className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">
            We couldn&apos;t reach the server
          </CardTitle>
          <CardDescription className="text-base">
            Your session couldn&apos;t be checked right now. Check your
            connection and try again.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button
            type="button"
            onClick={onRetry}
            className="min-h-11 font-semibold hover:bg-primary-hover"
          >
            Retry
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

/**
 * Protected area: every screen load confirms the session against userinfo from
 * the browser. Until it is confirmed only a loading placeholder shows. A 401/403
 * means the session is gone, so the user is sent to Sign in; any other failure
 * (network, server error) is temporary, so a retryable error shows instead —
 * signing the user out over a blip would lose their place for nothing.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [sessionCheck, setSessionCheck] = useState<SessionCheck>({
    status: 'checking',
  });
  const [checkAttempt, setCheckAttempt] = useState(0);

  // The check re-runs per screen and per Retry only, never because the router object changed.
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    let isCurrentCheck = true;
    getUserInfo()
      .then((userInfo) => {
        if (isCurrentCheck)
          setSessionCheck({ status: 'confirmed', user: userInfo });
      })
      .catch((error: unknown) => {
        if (!isCurrentCheck) return;
        if (isSessionRejection(error)) {
          setSessionCheck({ status: 'rejected' });
          routerRef.current.replace(SIGN_IN_PATH);
          return;
        }
        setSessionCheck({ status: 'unavailable' });
      });
    return () => {
      isCurrentCheck = false;
    };
  }, [pathname, checkAttempt]);

  function retrySessionCheck() {
    setSessionCheck({ status: 'checking' });
    setCheckAttempt((attempt) => attempt + 1);
  }

  if (sessionCheck.status === 'unavailable') {
    return (
      <main id="main-content">
        <SessionCheckUnavailable onRetry={retrySessionCheck} />
      </main>
    );
  }

  if (sessionCheck.status !== 'confirmed') {
    return (
      <main id="main-content">
        <LoadingPlaceholder />
      </main>
    );
  }

  return (
    <SessionProvider user={sessionCheck.user}>
      <AppHeader user={sessionCheck.user} actions={<SignOutButton />} />
      <main id="main-content" className="mx-auto w-full max-w-[1280px] p-6">
        {children}
      </main>
      <SessionTimeout />
    </SessionProvider>
  );
}

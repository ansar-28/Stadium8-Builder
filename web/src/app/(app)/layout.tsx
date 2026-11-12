'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import { AppHeader } from '@/components/layout/AppHeader';
import { SessionTimeout } from '@/components/layout/SessionTimeout';
import { SignOutButton } from '@/components/layout/SignOutButton';
import { SessionProvider } from '@/contexts/SessionContext';
import { getUserInfo } from '@/lib/api/endpoints';
import { SIGN_IN_PATH } from '@/lib/auth/session-constants';
import type { UserInfoRead } from '@/types/api-generated';

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

/**
 * Protected area: every screen load confirms the session against userinfo from
 * the browser. Until it is confirmed only a loading placeholder shows; when the
 * check fails nothing protected renders and the user is sent to Sign in.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [signedInUser, setSignedInUser] = useState<UserInfoRead | null>(null);
  const [isSessionRejected, setIsSessionRejected] = useState(false);

  useEffect(() => {
    let isCurrentCheck = true;
    getUserInfo()
      .then((userInfo) => {
        if (isCurrentCheck) setSignedInUser(userInfo);
      })
      .catch(() => {
        if (!isCurrentCheck) return;
        setSignedInUser(null);
        setIsSessionRejected(true);
        router.replace(SIGN_IN_PATH);
      });
    return () => {
      isCurrentCheck = false;
    };
  }, [pathname, router]);

  if (!signedInUser || isSessionRejected) {
    return (
      <main id="main-content">
        <LoadingPlaceholder />
      </main>
    );
  }

  return (
    <SessionProvider user={signedInUser}>
      <AppHeader user={signedInUser} actions={<SignOutButton />} />
      <main id="main-content" className="mx-auto w-full max-w-[1280px] p-6">
        {children}
      </main>
      <SessionTimeout />
    </SessionProvider>
  );
}

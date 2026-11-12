'use client';

import { createContext, useContext, type ReactNode } from 'react';

import type { UserInfoRead } from '@/types/api-generated';

const SessionContext = createContext<UserInfoRead | null>(null);

export function SessionProvider({
  user,
  children,
}: {
  user: UserInfoRead;
  children: ReactNode;
}) {
  return (
    <SessionContext.Provider value={user}>{children}</SessionContext.Provider>
  );
}

/**
 * The signed-in user's userinfo, confirmed by the (app) layout's session check.
 * Only usable on screens inside the (app) route group.
 */
export function useSignedInUser(): UserInfoRead {
  const user = useContext(SessionContext);
  if (!user) {
    throw new Error('useSignedInUser must be used inside the (app) layout');
  }
  return user;
}

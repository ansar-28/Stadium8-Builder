'use client';

import type { ReactNode } from 'react';

import { MainNav } from '@/components/layout/MainNav';
import { ThemeSwitch } from '@/components/layout/ThemeSwitch';
import { displayNameOf, roleNamesOf } from '@/lib/auth/roles';
import type { UserInfoRead } from '@/types/api-generated';

interface AppHeaderProps {
  user: UserInfoRead;
  /** Extra header actions on the right, after the theme switch (e.g. Sign out). */
  actions?: ReactNode;
}

/**
 * Persistent brand header on every signed-in screen: product name, main
 * navigation, who is signed in with one chip per role, and the theme switch.
 */
export function AppHeader({ user, actions }: AppHeaderProps) {
  const roleNames = roleNamesOf(user);

  return (
    <header className="bg-brand text-brand-foreground">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-6 py-1">
        <p className="text-base font-semibold">Transaction Management</p>
        <MainNav user={user} />
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <span className="text-sm">{displayNameOf(user)}</span>
          <ul aria-label="Roles" className="flex flex-wrap gap-1.5">
            {roleNames.map((roleName) => (
              <li
                key={roleName}
                className="rounded-full bg-brand-foreground/15 px-2.5 py-0.5 text-xs font-semibold"
              >
                {roleName}
              </li>
            ))}
          </ul>
          <ThemeSwitch />
          {actions}
        </div>
      </div>
    </header>
  );
}

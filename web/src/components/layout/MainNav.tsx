'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { FILE_IMPORTER_ROLE_NAME, hasRole } from '@/lib/auth/roles';
import { cn } from '@/lib/utils';
import type { UserInfoRead } from '@/types/api-generated';

interface NavigationItem {
  label: string;
  href: string;
  requiredRole?: string;
}

export const MAIN_NAVIGATION_ITEMS: readonly NavigationItem[] = [
  { label: 'Transactions', href: '/transactions' },
  { label: 'Files', href: '/files' },
  { label: 'Upload', href: '/upload', requiredRole: FILE_IMPORTER_ROLE_NAME },
  { label: 'Export', href: '/export' },
];

function isCurrentScreen(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Primary navigation: real routes, with items hidden when the user's roles don't allow them. */
export function MainNav({ user }: { user: UserInfoRead }) {
  const pathname = usePathname() ?? '';
  const visibleItems = MAIN_NAVIGATION_ITEMS.filter(
    (item) => !item.requiredRole || hasRole(user, item.requiredRole),
  );

  return (
    <nav aria-label="Main">
      <ul className="flex flex-wrap items-stretch gap-1">
        {visibleItems.map((item) => {
          const isActive = isCurrentScreen(pathname, item.href);
          return (
            <li key={item.href} className="flex">
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center border-b-[3px] px-3 text-sm font-semibold transition-colors',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-foreground',
                  isActive
                    ? 'border-brand-foreground text-brand-foreground'
                    : 'border-transparent text-brand-muted-foreground hover:text-brand-foreground',
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

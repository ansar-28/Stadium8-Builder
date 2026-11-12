/**
 * Story Metadata:
 * - Route: /transactions
 * - Target File: web/src/components/layout/AppHeader.tsx
 *
 * Epic sign-in-and-app-shell, Story 2: App frame with role-aware navigation.
 *
 * Implementation contract these tests assume:
 * - `AppHeader` is a named export taking the signed-in user's userinfo as `user`
 *   (`<AppHeader user={userInfo} />`); the (app) layout fetches userinfo and passes it in.
 * - Navigation is a landmark labelled "Main" containing links Transactions, Files,
 *   Upload (File Importer only) and Export.
 * - Role chips are list items inside a list labelled "Roles".
 * - The theme control is a switch named "Dark mode" (checked = dark). It works when
 *   AppHeader is rendered on its own: with no saved choice it follows the
 *   `prefers-color-scheme` media query, and a user's pick is remembered in browser storage.
 * - Notifications render in the "Notifications" region (polite live region); every
 *   notification — success or error — is a `status`, with a "Dismiss notification" button.
 *
 * These tests WILL FAIL until implemented (TDD red).
 */
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppHeader } from '@/components/layout/AppHeader';
import { ToastContainer } from '@/components/toast/ToastContainer';
import { ToastProvider, useToast } from '@/contexts/ToastContext';
import {
  APPROVER_ROLE_NAME,
  FILE_IMPORTER_ROLE_NAME,
  userInfoFor,
} from '@/mocks/data/identity';

vi.mock('@/lib/api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  apiClient: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/transactions',
  useSearchParams: () => new URLSearchParams(),
}));

function stubSystemColorScheme(prefersDark: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: prefersDark && query.includes('dark'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

function NotificationArea({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      {children}
      <ToastContainer />
    </ToastProvider>
  );
}

describe('Epic sign-in-and-app-shell, Story 2: App frame with role-aware navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    stubSystemColorScheme(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // AC-1
  it('shows the product name, the signed-in user’s full name and one chip per role', () => {
    render(
      <AppHeader
        user={userInfoFor([FILE_IMPORTER_ROLE_NAME, APPROVER_ROLE_NAME])}
      />,
    );

    expect(screen.getByText('Transaction Management')).toBeInTheDocument();
    expect(screen.getByText('Alice Dlamini')).toBeInTheDocument();

    const roleChips = within(
      screen.getByRole('list', { name: 'Roles' }),
    ).getAllByRole('listitem');
    expect(roleChips).toHaveLength(2);
    expect(roleChips.map((chip) => chip.textContent?.trim())).toEqual([
      FILE_IMPORTER_ROLE_NAME,
      APPROVER_ROLE_NAME,
    ]);
  });

  // AC-2
  it('shows the Upload navigation item only to users holding File Importer', () => {
    const { rerender } = render(
      <AppHeader user={userInfoFor(FILE_IMPORTER_ROLE_NAME)} />,
    );

    const importerNav = screen.getByRole('navigation', { name: 'Main' });
    expect(
      within(importerNav).getByRole('link', { name: 'Upload' }),
    ).toHaveAttribute('href', '/upload');

    rerender(<AppHeader user={userInfoFor(APPROVER_ROLE_NAME)} />);

    const approverNav = screen.getByRole('navigation', { name: 'Main' });
    expect(
      within(approverNav).getByRole('link', { name: 'Transactions' }),
    ).toBeInTheDocument();
    expect(
      within(approverNav).getByRole('link', { name: 'Files' }),
    ).toBeInTheDocument();
    expect(
      within(approverNav).getByRole('link', { name: 'Export' }),
    ).toBeInTheDocument();
    expect(
      within(approverNav).queryByRole('link', { name: 'Upload' }),
    ).not.toBeInTheDocument();
  });

  // AC-4
  it('shows notifications in the polite notification area, each with a close button', async () => {
    const user = userEvent.setup();
    const { result } = renderHook(() => useToast(), {
      wrapper: NotificationArea,
    });

    act(() => {
      result.current.showToast({ variant: 'success', title: 'File uploaded' });
      result.current.showToast({ variant: 'error', title: 'Upload failed' });
    });

    const notificationArea = screen.getByRole('region', {
      name: 'Notifications',
    });
    expect(notificationArea).toHaveAttribute('aria-live', 'polite');
    expect(
      within(notificationArea).queryByRole('alert'),
    ).not.toBeInTheDocument();

    const errorNotifications = within(notificationArea)
      .getAllByRole('status')
      .filter((notification) =>
        notification.textContent?.includes('Upload failed'),
      );
    expect(errorNotifications).toHaveLength(1);
    expect(
      within(notificationArea).getByText('File uploaded'),
    ).toBeInTheDocument();

    const [errorNotification] = errorNotifications;
    await user.click(
      within(errorNotification).getByRole('button', {
        name: 'Dismiss notification',
      }),
    );

    await waitFor(() => {
      expect(
        within(notificationArea).queryByText('Upload failed'),
      ).not.toBeInTheDocument();
    });
    expect(
      within(notificationArea).getByText('File uploaded'),
    ).toBeInTheDocument();
  });

  // AC-6
  it('follows the computer’s colour scheme until the user picks one, then remembers the pick', async () => {
    const user = userEvent.setup();
    stubSystemColorScheme(true);

    const { unmount } = render(
      <AppHeader user={userInfoFor(FILE_IMPORTER_ROLE_NAME)} />,
    );

    const darkModeSwitch = screen.getByRole('switch', { name: 'Dark mode' });
    await waitFor(() => {
      expect(darkModeSwitch).toBeChecked();
    });

    await user.click(darkModeSwitch);
    expect(screen.getByRole('switch', { name: 'Dark mode' })).not.toBeChecked();

    unmount();
    // The computer still prefers dark, so only the remembered pick keeps the switch off.
    render(<AppHeader user={userInfoFor(FILE_IMPORTER_ROLE_NAME)} />);

    expect(screen.getByRole('switch', { name: 'Dark mode' })).not.toBeChecked();
  });
});

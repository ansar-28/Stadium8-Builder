/**
 * Story Metadata:
 * - Route: /upload
 * - Target File: web/src/app/(app)/upload/page.tsx
 *
 * Epic file-upload-and-files, Story 3: Upload screen for users without the File Importer role.
 *
 * Implementation contract these tests assume:
 * - The upload page (default export) reads the signed-in user from the (app) layout's
 *   `SessionProvider` (`useSignedInUser()`) and gates on `hasRole(user, 'File Importer')`.
 * - Without File Importer it renders a `role="status"` banner naming the missing
 *   "File Importer" permission and telling the user to ask an administrator, with a
 *   link back to Files; the file input labelled "Choose a .csv file" and the
 *   "Upload file" button are not rendered.
 * - With File Importer the full upload screen renders and no permission banner shows.
 *
 * Controls (same in the Playwright spec): permission banner role "status";
 * file input labelled "Choose a .csv file"; button "Upload file"; link "Files".
 *
 * These tests WILL FAIL until implemented (TDD red).
 */
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import UploadTransactionFilePage from '@/app/(app)/upload/page';
import { SessionProvider } from '@/contexts/SessionContext';
import { ToastProvider } from '@/contexts/ToastContext';
import {
  APPROVER_ROLE_NAME,
  FILE_IMPORTER_ROLE_NAME,
  userInfoFor,
} from '@/mocks/data/identity';

import type { UserInfoRead } from '@/types/api-generated';

vi.mock('@/lib/api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  apiClient: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/upload',
  useSearchParams: () => new URLSearchParams(),
}));

function renderUploadPageAs(user: UserInfoRead): void {
  render(
    <ToastProvider>
      <SessionProvider user={user}>
        <UploadTransactionFilePage />
      </SessionProvider>
    </ToastProvider>,
  );
}

describe('Epic file-upload-and-files, Story 3: Upload screen for users without the File Importer role', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // AC-1
  it('shows a non-File-Importer the missing-permission banner and no file chooser or upload button', () => {
    renderUploadPageAs(userInfoFor(APPROVER_ROLE_NAME));

    const permissionBanner = screen.getByRole('status');
    expect(permissionBanner).toHaveTextContent(/File Importer/);
    expect(permissionBanner).toHaveTextContent(/administrator/i);
    expect(
      within(permissionBanner).getByRole('link', { name: 'Files' }),
    ).toHaveAttribute('href', '/files');

    expect(
      screen.queryByLabelText('Choose a .csv file'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Upload file' }),
    ).not.toBeInTheDocument();
  });

  // AC-3
  it('shows a user holding both roles the full upload screen and no permission banner', () => {
    renderUploadPageAs(
      userInfoFor([FILE_IMPORTER_ROLE_NAME, APPROVER_ROLE_NAME]),
    );

    expect(screen.getByLabelText('Choose a .csv file')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Upload file' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/administrator/i)).not.toBeInTheDocument();
  });
});

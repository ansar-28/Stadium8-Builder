'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { LockKeyhole } from 'lucide-react';

import { useSignedInUser } from '@/contexts/SessionContext';
import { FILE_IMPORTER_ROLE_NAME, hasRole } from '@/lib/auth/roles';

const FILES_PATH = '/files';

function MissingFileImporterPermissionBanner() {
  return (
    <div
      role="status"
      aria-atomic="true"
      className="flex max-w-[640px] items-start gap-3 rounded-md border border-warning-text bg-card p-4 text-sm"
    >
      <LockKeyhole
        aria-hidden="true"
        className="mt-0.5 size-5 shrink-0 text-warning-text"
      />
      <p>
        You need the File Importer permission to upload files. Ask your
        administrator to add it to your account. Back to{' '}
        <Link
          href={FILES_PATH}
          className="font-semibold text-foreground underline underline-offset-4"
        >
          Files
        </Link>
        .
      </p>
    </div>
  );
}

/**
 * Shows its children only to File Importers; everyone else sees the missing-permission
 * banner. Hides the controls only — the backend remains the authority on permissions.
 */
export function FileImporterOnly({ children }: { children: ReactNode }) {
  const signedInUser = useSignedInUser();
  if (!hasRole(signedInUser, FILE_IMPORTER_ROLE_NAME)) {
    return <MissingFileImporterPermissionBanner />;
  }
  return <>{children}</>;
}

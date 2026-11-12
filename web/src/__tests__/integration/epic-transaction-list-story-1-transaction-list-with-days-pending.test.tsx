/**
 * Story Metadata:
 * - Route: /transactions
 * - Target File: web/src/app/(app)/transactions/page.tsx
 *
 * Epic transaction-list, Story 1: Transaction list with days pending.
 *
 * Implementation contract these tests assume:
 * - The Transactions page (default export) renders inside the (app) layout's
 *   `SessionProvider` and loads `getTransactions()` and `getFileLogs('Yes')` through
 *   the API client from the browser.
 * - The list is a native table; each transaction is a `row`, each value a `cell`.
 *   Days pending is its own cell: "1 day" / "N days" for Pending rows, "—" otherwise.
 * - While loading, a placeholder labelled "Loading transactions" carries
 *   `aria-busy="true"`; after three seconds of the real request still pending,
 *   "Still loading transactions…" appears.
 * - Empty state: "No transactions yet" + "Transactions appear here once a file has
 *   been uploaded." and, for File Importers only, a link "Upload a file" to /upload.
 * - Failed load: the server's message (APIError.message) shows with a "Retry" button
 *   that re-requests the list.
 *
 * Controls (same in the Playwright spec): Retry is role "button" named "Retry";
 * "Upload a file" is role "link" (navigates to /upload).
 *
 * These tests WILL FAIL until implemented (TDD red).
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TransactionsPage from '@/app/(app)/transactions/page';
import { SessionProvider } from '@/contexts/SessionContext';
import { get } from '@/lib/api/client';
import { createDefaultResponse } from '@/mocks/data/default-response';
import { createFileLog, createFileLogList } from '@/mocks/data/file-log';
import {
  APPROVER_ROLE_NAME,
  FILE_IMPORTER_ROLE_NAME,
  userInfoFor,
} from '@/mocks/data/identity';
import {
  createSampleTransactions,
  createTransactionList,
} from '@/mocks/data/transaction';
import type { APIError } from '@/types/api';
import type { FileLogList, TransactionReadList } from '@/types/api-generated';

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

const mockGet = get as ReturnType<typeof vi.fn>;

const STILL_LOADING_MESSAGE = 'Still loading transactions…';
const STILL_LOADING_WAIT_MS = 4500;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;

function padTwoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * A local "YYYY-MM-DD HH:mm:ss" timestamp `days` days and one minute before now —
 * the extra minute keeps the elapsed time just past the whole-day boundary.
 */
function uploadedDaysAgo(days: number): string {
  const moment = new Date(
    Date.now() - days * MILLISECONDS_PER_DAY - ONE_MINUTE_MS,
  );
  const datePart = `${moment.getFullYear()}-${padTwoDigits(moment.getMonth() + 1)}-${padTwoDigits(moment.getDate())}`;
  const timePart = `${padTwoDigits(moment.getHours())}:${padTwoDigits(moment.getMinutes())}:${padTwoDigits(moment.getSeconds())}`;
  return `${datePart} ${timePart}`;
}

interface BackendResponses {
  transactions: () => Promise<TransactionReadList>;
  fileLogs: () => Promise<FileLogList>;
}

/** Answer each endpoint by path, so the page may request them in either order. */
function respondWith({ transactions, fileLogs }: BackendResponses): void {
  mockGet.mockImplementation((endpoint: unknown) => {
    if (typeof endpoint === 'string' && endpoint.endsWith('/v1/transactions')) {
      return transactions();
    }
    if (typeof endpoint === 'string' && endpoint.endsWith('/v1/file-logs')) {
      return fileLogs();
    }
    return Promise.reject(new Error(`Unexpected request: ${String(endpoint)}`));
  });
}

function renderTransactionsPage(roleName: string) {
  return render(
    <SessionProvider user={userInfoFor(roleName)}>
      <TransactionsPage />
    </SessionProvider>,
  );
}

describe('Epic transaction-list, Story 1: Transaction list with days pending', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // AC-2
  // Data-contract: full chain verified during manual checklist
  it('shows days pending from the file upload date for Pending rows and "—" for decided rows', async () => {
    respondWith({
      transactions: () =>
        Promise.resolve(createTransactionList(createSampleTransactions())),
      fileLogs: () =>
        Promise.resolve(
          createFileLogList([
            createFileLog({ Id: 1, ProcessDate: uploadedDaysAgo(1) }),
            createFileLog({
              Id: 2,
              ProcessDate: uploadedDaysAgo(5),
              CurrentFileName: 'transactions_2026-04-10.csv',
            }),
          ]),
        ),
    });

    renderTransactionsPage(FILE_IMPORTER_ROLE_NAME);

    const pendingFromFileOne = await screen.findByRole('row', {
      name: /TXN-00001/,
    });
    expect(
      within(pendingFromFileOne).getByRole('cell', { name: '1 day' }),
    ).toBeInTheDocument();

    const pendingFromFileTwo = screen.getByRole('row', { name: /TXN-00005/ });
    expect(
      within(pendingFromFileTwo).getByRole('cell', { name: '5 days' }),
    ).toBeInTheDocument();

    const approvedRow = screen.getByRole('row', { name: /TXN-00003/ });
    expect(
      within(approvedRow).getByRole('cell', { name: '—' }),
    ).toBeInTheDocument();

    const rejectedRow = screen.getByRole('row', { name: /TXN-00004/ });
    expect(
      within(rejectedRow).getByRole('cell', { name: '—' }),
    ).toBeInTheDocument();
  });

  // AC-2 (degraded): file logs only feed days pending
  it('still shows the list with "—" days pending when the file details fail to load', async () => {
    const fileLogsFailure: APIError = {
      message: 'The file service is temporarily unavailable.',
      statusCode: 503,
    };
    respondWith({
      transactions: () =>
        Promise.resolve(createTransactionList(createSampleTransactions())),
      fileLogs: () => Promise.reject(fileLogsFailure),
    });

    renderTransactionsPage(FILE_IMPORTER_ROLE_NAME);

    const pendingRow = await screen.findByRole('row', { name: /TXN-00001/ });
    expect(
      within(pendingRow).getByRole('cell', { name: '—' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Transactions couldn't be loaded"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Retry' }),
    ).not.toBeInTheDocument();
  });

  // AC-3
  it('shows a busy list placeholder while loading and a still-loading message after three seconds', async () => {
    const neverSettles = () => new Promise<never>(() => undefined);
    respondWith({ transactions: neverSettles, fileLogs: neverSettles });

    renderTransactionsPage(FILE_IMPORTER_ROLE_NAME);

    expect(screen.getByLabelText('Loading transactions')).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.queryByText(STILL_LOADING_MESSAGE)).not.toBeInTheDocument();

    expect(
      await screen.findByText(
        STILL_LOADING_MESSAGE,
        {},
        { timeout: STILL_LOADING_WAIT_MS },
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Loading transactions')).toHaveAttribute(
      'aria-busy',
      'true',
    );
  }, 10_000);

  // AC-4
  it('shows "No transactions yet" with an Upload a file link only for File Importers', async () => {
    respondWith({
      transactions: () => Promise.resolve(createTransactionList([])),
      fileLogs: () => Promise.resolve(createFileLogList([])),
    });

    const importerView = renderTransactionsPage(FILE_IMPORTER_ROLE_NAME);

    expect(await screen.findByText('No transactions yet')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Transactions appear here once a file has been uploaded.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Upload a file' })).toHaveAttribute(
      'href',
      '/upload',
    );

    importerView.unmount();
    renderTransactionsPage(APPROVER_ROLE_NAME);

    expect(await screen.findByText('No transactions yet')).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Upload a file' }),
    ).not.toBeInTheDocument();
  });

  // AC-5
  it('shows the server message with Retry when loading fails, and Retry loads the list', async () => {
    const user = userEvent.setup();
    const [serverMessage] = createDefaultResponse({
      MessageType: 'Error',
      Messages: ['The transaction service is temporarily unavailable.'],
    }).Messages ?? [''];
    const loadFailure: APIError = {
      message: serverMessage,
      statusCode: 503,
      details: [serverMessage],
    };
    let transactionsLoadFails = true;
    respondWith({
      transactions: () =>
        transactionsLoadFails
          ? Promise.reject(loadFailure)
          : Promise.resolve(createTransactionList(createSampleTransactions())),
      fileLogs: () => Promise.resolve(createFileLogList()),
    });

    renderTransactionsPage(FILE_IMPORTER_ROLE_NAME);

    expect(await screen.findByText(serverMessage)).toBeInTheDocument();
    expect(
      screen.queryByRole('row', { name: /TXN-00001/ }),
    ).not.toBeInTheDocument();

    transactionsLoadFails = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(
      await screen.findByRole('row', { name: /TXN-00001/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText(serverMessage)).not.toBeInTheDocument();
  });
});

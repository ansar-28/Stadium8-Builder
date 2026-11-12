/**
 * Story Metadata:
 * - Route: /files
 * - Target File: web/src/app/(app)/files/page.tsx
 *
 * Epic file-upload-and-files, Story 1: Uploaded files list with download.
 *
 * Implementation contract these tests assume:
 * - The Files page (default export of the target file) reads the signed-in user from
 *   the (app) layout's SessionProvider and the file list from GET /v1/file-logs
 *   (IsActive=Yes) through the API client; downloads go through the API client's
 *   binary call to /v1/files/download.
 * - The list is a table with columns "File name" and "Upload timestamp"
 *   (YYYY-MM-DD HH:mm), sorted newest first, with a "Showing <n> of <total> files" count.
 * - Each row has a button named "Download <file name>".
 * - A failed download raises a persistent notification (Notifications region) showing
 *   the server's message (DefaultResponse.Messages) and a "Try again" button; a
 *   successful download raises the notification "<file name> downloaded."
 * - A failed list load shows an alert with the server's message and a "Try again" button.
 * - "Upload a file" is a link to /upload (header action + empty-state action), shown
 *   only to File Importers.
 *
 * Controls (shared with the Playwright spec): button "Download <file name>" (click);
 * button "Try again" (click); link "Upload a file".
 *
 * These tests WILL FAIL until implemented (TDD red).
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';

import UploadedFilesPage from '@/app/(app)/files/page';
import { ToastContainer } from '@/components/toast/ToastContainer';
import { SessionProvider } from '@/contexts/SessionContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { apiClient, get } from '@/lib/api/client';
import { createErrorResponse } from '@/mocks/data/default-response';
import { createFileLog, createFileLogList } from '@/mocks/data/file-log';
import {
  APPROVER_ROLE_NAME,
  FILE_IMPORTER_ROLE_NAME,
  userInfoFor,
} from '@/mocks/data/identity';
import type { APIError } from '@/types/api';

vi.mock('@/lib/api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  apiClient: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/files',
  useSearchParams: () => new URLSearchParams(),
}));

type EndpointResponder = (endpoint: string) => Promise<unknown>;

const mockGet = get as unknown as Mock<EndpointResponder>;
const mockApiClient = apiClient as unknown as Mock<EndpointResponder>;

const FILE_LOGS_PATH = '/v1/file-logs';
const DOWNLOAD_PATH = '/v1/files/download';
const DOWNLOADED_FILE_NAME = 'transactions_2026-04-15.csv';

/** Route every API-client call (get or apiClient) through one responder. */
function respondToApiCalls(responder: EndpointResponder): void {
  mockGet.mockImplementation(responder);
  mockApiClient.mockImplementation(responder);
}

/** The APIError the API client throws for a 500 carrying a DefaultResponse body. */
function serverError(endpoint: string, message: string): APIError {
  return {
    message: 'Internal Server Error: Something went wrong on the server',
    statusCode: 500,
    details: createErrorResponse(message).Messages,
    endpoint,
  };
}

function csvBlob(): Blob {
  return new Blob(
    [
      'Reference,TransactionDate,AccountNumber,Description,Amount,TransactionType,Currency\n',
    ],
    { type: 'application/octet-stream' },
  );
}

function renderFilesPage(roleName: string) {
  return render(
    <ToastProvider>
      <SessionProvider user={userInfoFor(roleName)}>
        <UploadedFilesPage />
      </SessionProvider>
      <ToastContainer />
    </ToastProvider>,
  );
}

describe('Epic file-upload-and-files, Story 1: Uploaded files list with download', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(() => 'blob:mock-download'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    // jsdom cannot navigate to a blob URL; saving is verified in the Playwright spec.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // AC-1
  // Data-contract: full chain verified during manual checklist
  it('lists each uploaded file with its upload timestamp, newest first, and the file count', async () => {
    const [newestFile, middleFile, oldestFile] =
      createFileLogList().FileLog ?? [];
    respondToApiCalls(async (endpoint) => {
      if (endpoint.includes(FILE_LOGS_PATH)) {
        return createFileLogList([middleFile, oldestFile, newestFile]);
      }
      throw new Error(`Unexpected API call: ${endpoint}`);
    });

    renderFilesPage(APPROVER_ROLE_NAME);

    const table = await screen.findByRole('table');
    expect(
      within(table).getByRole('columnheader', { name: 'File name' }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole('columnheader', { name: 'Upload timestamp' }),
    ).toBeInTheDocument();

    const fileNameCells = within(table).getAllByRole('cell', {
      name: /^transactions_.*\.csv$/,
    });
    expect(fileNameCells.map((cell) => cell.textContent?.trim())).toEqual([
      'transactions_2026-04-15.csv',
      'transactions_2026-04-14.csv',
      'transactions_2026-04-13.csv',
    ]);

    const newestRow = within(table).getByRole('row', {
      name: /transactions_2026-04-15\.csv/,
    });
    expect(within(newestRow).getByText('2026-04-15 08:30')).toBeInTheDocument();

    expect(screen.getByText('Showing 3 of 3 files')).toBeInTheDocument();
  });

  // AC-4
  it('shows the server’s message when a download fails and lets the user try again', async () => {
    const user = userEvent.setup();
    const serverMessage = `${DOWNLOADED_FILE_NAME} could not be read from file storage. Try again in a few minutes.`;
    let hasDownloadFailedOnce = false;
    respondToApiCalls(async (endpoint) => {
      if (endpoint.includes(FILE_LOGS_PATH)) {
        return createFileLogList();
      }
      if (endpoint.includes(DOWNLOAD_PATH)) {
        if (!hasDownloadFailedOnce) {
          hasDownloadFailedOnce = true;
          throw serverError(endpoint, serverMessage);
        }
        return csvBlob();
      }
      throw new Error(`Unexpected API call: ${endpoint}`);
    });

    renderFilesPage(APPROVER_ROLE_NAME);

    await user.click(
      await screen.findByRole('button', {
        name: `Download ${DOWNLOADED_FILE_NAME}`,
      }),
    );

    const notifications = screen.getByRole('region', { name: 'Notifications' });
    expect(
      await within(notifications).findByText(serverMessage),
    ).toBeInTheDocument();
    expect(
      within(notifications).queryByText(`${DOWNLOADED_FILE_NAME} downloaded.`),
    ).not.toBeInTheDocument();

    await user.click(
      within(notifications).getByRole('button', { name: 'Try again' }),
    );

    expect(
      await within(notifications).findByText(
        `${DOWNLOADED_FILE_NAME} downloaded.`,
      ),
    ).toBeInTheDocument();
  });

  // AC-4
  it('does not offer a download for a listed file the server gave no id', async () => {
    respondToApiCalls(async (endpoint) => {
      if (endpoint.includes(FILE_LOGS_PATH)) {
        return createFileLogList([createFileLog({ Id: undefined })]);
      }
      throw new Error(`Unexpected API call: ${endpoint}`);
    });

    renderFilesPage(APPROVER_ROLE_NAME);

    expect(
      await screen.findByRole('button', {
        name: `Download ${DOWNLOADED_FILE_NAME}`,
      }),
    ).toBeDisabled();
  });

  // AC-5
  it('says "No files yet" when empty and offers "Upload a file" only to File Importers', async () => {
    respondToApiCalls(async (endpoint) => {
      if (endpoint.includes(FILE_LOGS_PATH)) {
        return createFileLogList([]);
      }
      throw new Error(`Unexpected API call: ${endpoint}`);
    });

    const { unmount } = renderFilesPage(FILE_IMPORTER_ROLE_NAME);

    expect(await screen.findByText('No files yet')).toBeInTheDocument();
    const uploadLinks = screen.getAllByRole('link', { name: 'Upload a file' });
    expect(uploadLinks).toHaveLength(2);
    for (const uploadLink of uploadLinks) {
      expect(uploadLink).toHaveAttribute('href', '/upload');
    }

    unmount();
    renderFilesPage(APPROVER_ROLE_NAME);

    expect(await screen.findByText('No files yet')).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /upload a file/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /upload a file/i }),
    ).not.toBeInTheDocument();
  });

  // AC-6
  it('shows what went wrong when the file list cannot be loaded and loads it on "Try again"', async () => {
    const user = userEvent.setup();
    const serverMessage =
      'The file list could not be retrieved. Try again in a few minutes.';
    let hasListFailedOnce = false;
    respondToApiCalls(async (endpoint) => {
      if (endpoint.includes(FILE_LOGS_PATH)) {
        if (!hasListFailedOnce) {
          hasListFailedOnce = true;
          throw serverError(endpoint, serverMessage);
        }
        return createFileLogList([createFileLog()]);
      }
      throw new Error(`Unexpected API call: ${endpoint}`);
    });

    renderFilesPage(APPROVER_ROLE_NAME);

    const loadError = await screen.findByRole('alert');
    expect(within(loadError).getByText(serverMessage)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    await user.click(
      within(loadError).getByRole('button', { name: 'Try again' }),
    );

    expect(
      await screen.findByRole('cell', { name: DOWNLOADED_FILE_NAME }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText(serverMessage)).not.toBeInTheDocument();
    });
  });
});

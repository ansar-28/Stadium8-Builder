/**
 * Story Metadata:
 * - Route: /upload
 * - Target File: web/src/app/(app)/upload/page.tsx
 *
 * Epic file-upload-and-files, Story 2: Upload a transaction file.
 *
 * Implementation contract these tests assume:
 * - The /upload page's default export renders inside the (app) layout's
 *   SessionProvider (signed-in File Importer) and the root ToastProvider.
 * - The file input is labelled "Choose a .csv file"; a chosen file shows
 *   "Selected: <name>"; the action is a button named "Upload file".
 * - The upload outcome banner is a role="status" element on the page (outside
 *   the "Notifications" region); notifications are statuses inside that region.
 * - The upload goes through the API client (`uploadFile` → `apiClient`), which
 *   throws an APIError whose `details` carry the server's DefaultResponse Messages.
 *
 * Controls (same in the Playwright spec): file input labelled "Choose a .csv file"
 * (interacted with by choosing a file); button "Upload file" (clicked).
 *
 * These tests WILL FAIL until implemented (TDD red).
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Import based on Story Metadata Target File — will fail until implemented (TDD red)
import UploadTransactionFilePage from '@/app/(app)/upload/page';
import { ToastContainer } from '@/components/toast/ToastContainer';
import { SessionProvider } from '@/contexts/SessionContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { apiClient } from '@/lib/api/client';
import {
  createDefaultResponse,
  createErrorResponse,
} from '@/mocks/data/default-response';
import { FILE_IMPORTER_ROLE_NAME, userInfoFor } from '@/mocks/data/identity';

vi.mock('@/lib/api/client', () => ({
  apiClient: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/upload',
  useSearchParams: () => new URLSearchParams(),
}));

const mockApiClient = apiClient as ReturnType<typeof vi.fn>;

const FILE_INPUT_LABEL = 'Choose a .csv file';
const UPLOAD_BUTTON_NAME = 'Upload file';
const LAYOUT_REJECTION_MESSAGE =
  'The file could not be uploaded. Only the seven-column .csv layout is accepted.';
const SEVEN_COLUMN_HEADER =
  'Reference,TransactionDate,AccountNumber,Description,Amount,TransactionType,Currency';
const SAMPLE_ROW =
  'TXN-20260415-0001,2026/04/15 08:12,1001-2034-5567,Salary deposit - April,15750,C,ZAR';

function csvFile(fileName: string, header: string): File {
  return new File([`${header}\n${SAMPLE_ROW}\n`], fileName, {
    type: 'text/csv',
  });
}

function rejectedAtUploadNotice(fileName: string): string {
  return `The file ${fileName} was rejected at upload.`;
}

function renderUploadPage() {
  return render(
    <ToastProvider>
      <SessionProvider user={userInfoFor(FILE_IMPORTER_ROLE_NAME)}>
        <UploadTransactionFilePage />
      </SessionProvider>
      <ToastContainer />
    </ToastProvider>,
  );
}

/** The page's outcome banner: a status outside the notification area holding the text. */
async function findOutcomeBanner(text: string): Promise<HTMLElement> {
  const notificationArea = screen.getByRole('region', {
    name: 'Notifications',
  });
  let banner: HTMLElement | undefined;
  await waitFor(() => {
    const matchingBanners = screen
      .getAllByRole('status')
      .filter(
        (status) =>
          !notificationArea.contains(status) &&
          (status.textContent ?? '').includes(text),
      );
    expect(matchingBanners).toHaveLength(1);
    banner = matchingBanners[0];
  });
  if (!banner) {
    throw new Error(`No outcome banner containing "${text}"`);
  }
  return banner;
}

async function findRejectedAtUploadNotification(fileName: string) {
  const notificationArea = screen.getByRole('region', {
    name: 'Notifications',
  });
  return within(notificationArea).findByText(rejectedAtUploadNotice(fileName));
}

describe('Epic file-upload-and-files, Story 2: Upload a transaction file', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiClient.mockResolvedValue(
      createDefaultResponse({ Messages: ['File uploaded successfully.'] }),
    );
  });

  // AC-1
  it('shows the chosen file name, and asks for a file when Upload file is pressed with none chosen', async () => {
    const user = userEvent.setup();
    renderUploadPage();

    await user.click(screen.getByRole('button', { name: UPLOAD_BUTTON_NAME }));
    expect(
      await screen.findByText('Choose a .csv file to upload.'),
    ).toBeInTheDocument();

    await user.upload(
      screen.getByLabelText(FILE_INPUT_LABEL),
      csvFile('transactions_2026-04-15.csv', SEVEN_COLUMN_HEADER),
    );

    expect(await screen.findByText(/^Selected:/)).toHaveTextContent(
      'Selected: transactions_2026-04-15.csv',
    );
  });

  // AC-2
  it('does not send a non-.csv file or a .csv with the wrong header, and explains the rejection', async () => {
    // applyAccept off: the user can still pick a non-.csv file through the OS dialog.
    const user = userEvent.setup({ applyAccept: false });
    renderUploadPage();

    const wrongHeaderFileName = 'transactions_wrong-columns.csv';
    await user.upload(
      screen.getByLabelText(FILE_INPUT_LABEL),
      csvFile(
        wrongHeaderFileName,
        'Reference,Date,Account,Description,Amount,Type',
      ),
    );
    await user.click(screen.getByRole('button', { name: UPLOAD_BUTTON_NAME }));

    // The mocked server would accept anything, so a failure banner proves nothing was sent.
    const wrongHeaderBanner = await findOutcomeBanner(LAYOUT_REJECTION_MESSAGE);
    expect(wrongHeaderBanner).not.toHaveTextContent(/uploaded successfully/i);
    expect(
      await findRejectedAtUploadNotification(wrongHeaderFileName),
    ).toBeInTheDocument();

    const textFileName = 'transactions_2026-04-15.txt';
    await user.upload(
      screen.getByLabelText(FILE_INPUT_LABEL),
      new File([`${SEVEN_COLUMN_HEADER}\n${SAMPLE_ROW}\n`], textFileName, {
        type: 'text/plain',
      }),
    );
    await user.click(screen.getByRole('button', { name: UPLOAD_BUTTON_NAME }));

    expect(
      await findRejectedAtUploadNotification(textFileName),
    ).toBeInTheDocument();
    const textFileBanner = await findOutcomeBanner(LAYOUT_REJECTION_MESSAGE);
    expect(textFileBanner).not.toHaveTextContent(/uploaded successfully/i);
  });

  // AC-3
  it('clears the chosen file after a successful upload so the same file is not sent twice', async () => {
    const user = userEvent.setup();
    renderUploadPage();

    const fileName = 'transactions_2026-04-15.csv';
    await user.upload(
      screen.getByLabelText(FILE_INPUT_LABEL),
      csvFile(fileName, SEVEN_COLUMN_HEADER),
    );
    await user.click(screen.getByRole('button', { name: UPLOAD_BUTTON_NAME }));

    await findOutcomeBanner(`${fileName} was uploaded.`);
    expect(screen.queryByText(/^Selected:/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: UPLOAD_BUTTON_NAME }));

    expect(
      await screen.findByText('Choose a .csv file to upload.'),
    ).toBeInTheDocument();
    expect(mockApiClient).toHaveBeenCalledTimes(1);
  });

  // AC-4
  // Data-contract: full chain verified during manual checklist
  it('shows the server’s own message and the rejected-at-upload notification when the server fails the upload', async () => {
    const user = userEvent.setup();
    const serverMessage =
      'The file could not be imported because it duplicates an earlier upload.';
    mockApiClient.mockRejectedValue({
      message: 'Internal Server Error: Something went wrong on the server',
      statusCode: 500,
      details: createErrorResponse(serverMessage).Messages,
      endpoint: '/transactions-api/v1/files/upload',
    });
    renderUploadPage();

    const fileName = 'transactions_2026-04-15.csv';
    await user.upload(
      screen.getByLabelText(FILE_INPUT_LABEL),
      csvFile(fileName, SEVEN_COLUMN_HEADER),
    );
    await user.click(screen.getByRole('button', { name: UPLOAD_BUTTON_NAME }));

    const failureBanner = await findOutcomeBanner(serverMessage);
    expect(failureBanner).not.toHaveTextContent(/uploaded successfully/i);
    expect(
      await findRejectedAtUploadNotification(fileName),
    ).toBeInTheDocument();
  });
});

/**
 * Story Metadata:
 * - Route: /upload
 * - Target File: web/src/app/(app)/upload/page.tsx
 *
 * Mocking strategy:
 * - Backend calls are ALWAYS mocked — this spec never contacts a live backend
 *   (see testing-policy.md § "Playwright runs against mocks, never live").
 *   Intercept via: page.route()
 * - Implementation pattern this assumes:
 *   - The (app) layout confirms the session by requesting userinfo from the browser
 *     (same-origin proxy path ending in /v1/auth/userinfo); its body comes from the
 *     shared identity source.
 *   - The upload is sent from the browser (a client-component call through the API
 *     client) as POST <proxy>/transactions-api/v1/files/upload with the FileSettingId,
 *     FileSettingName and FileName query inputs and the raw .csv bytes as an
 *     application/octet-stream body — page.route() cannot intercept a Server Action.
 *   - The Files screen reads GET <proxy>/transactions-api/v1/file-logs from the browser.
 *     The mock serves the list with the uploaded file on top once the upload was received,
 *     under the backend's renamed form (<yyyymmdd>_Transactions_<n>.csv), not the uploaded name.
 *   - The signed-in state is a `session` cookie (mock value, added to the browser context
 *     before navigating); the frontend never reads its value.
 * - If the implementation diverges from these assumptions, this spec will not pass.
 *
 * Controls (same in the Vitest file): file input labelled "Choose a .csv file"
 * (interacted with by choosing a file); button "Upload file" (clicked). The outcome
 * banner is a role="status" inside the main landmark; notifications live in the
 * "Notifications" region outside it.
 *
 * E2E spec for Epic file-upload-and-files, Story 2: Upload a transaction file.
 * These tests WILL FAIL until implemented (TDD red).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { createDefaultResponse } from '../src/mocks/data/default-response';
import { createFileLog, createFileLogList } from '../src/mocks/data/file-log';
import {
  FILE_IMPORTER_ROLE_NAME,
  userInfoFor,
} from '../src/mocks/data/identity';

import type { BrowserContext, Page, Request } from '@playwright/test';

const WCAG_22_AA_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
];
const FILE_INPUT_LABEL = 'Choose a .csv file';
const UPLOAD_BUTTON_NAME = 'Upload file';
const LAYOUT_REJECTION_MESSAGE =
  'The file could not be uploaded. Only the seven-column .csv layout is accepted.';
const SEVEN_COLUMN_HEADER =
  'Reference,TransactionDate,AccountNumber,Description,Amount,TransactionType,Currency';

interface CsvUpload {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/** A seven-column .csv holding `transactionCount` rows in the sample file's format. */
function sevenColumnCsv(fileName: string, transactionCount: number): CsvUpload {
  const rows = Array.from({ length: transactionCount }, (_, index) => {
    const sequence = String(index + 1).padStart(4, '0');
    const transactionType = index % 2 === 0 ? 'C' : 'D';
    return `TXN-20261112-${sequence},2026/11/12 08:12,1001-2034-5567,Transaction ${sequence},${100 + index}.50,${transactionType},ZAR`;
  });
  return {
    name: fileName,
    mimeType: 'text/csv',
    buffer: Buffer.from(`${[SEVEN_COLUMN_HEADER, ...rows].join('\n')}\n`),
  };
}

/**
 * The name the backend gives the nth upload of the day: the mocked list already holds
 * today's `20261112_Transactions.csv`, so repeats get `_1`, `_2`, ...
 */
function renamedUploadFileName(uploadIndex: number): string {
  return `20261112_Transactions_${uploadIndex + 1}.csv`;
}

async function startMockSession(
  page: Page,
  context: BrowserContext,
  baseURL: string | undefined,
): Promise<void> {
  await context.addCookies([
    {
      name: 'session',
      value: 'mock-token',
      url: baseURL ?? 'http://localhost:3000',
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  await page.route('**/v1/auth/userinfo', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(userInfoFor(FILE_IMPORTER_ROLE_NAME)),
    }),
  );
}

/**
 * Mock the upload endpoint with a success DefaultResponse and the file-log list,
 * which gains the uploaded file (newest) once an upload has been received.
 */
async function mockUploadAndFileLogs(page: Page): Promise<void> {
  const uploadRequests: Request[] = [];
  const existingFiles = createFileLogList().FileLog ?? [];

  await page.route(
    (url) => url.pathname.endsWith('/v1/files/upload'),
    (route) => {
      uploadRequests.push(route.request());
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          createDefaultResponse({ Messages: ['File uploaded successfully.'] }),
        ),
      });
    },
  );

  await page.route(
    (url) => url.pathname.endsWith('/v1/file-logs'),
    (route) => {
      // The backend renames each upload to <yyyymmdd>_Transactions_<n>.csv.
      const uploadedFiles = uploadRequests
        .map((_, uploadIndex) =>
          createFileLog({
            Id: 101 + uploadIndex,
            ProcessDate: `2026-11-12 14:${String(30 + uploadIndex).padStart(2, '0')}:00`,
            CurrentFileName: renamedUploadFileName(uploadIndex),
          }),
        )
        .reverse();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          createFileLogList([...uploadedFiles, ...existingFiles]),
        ),
      });
    },
  );
}

function waitForUploadRequest(page: Page): Promise<Request> {
  return page.waitForRequest((request) =>
    new URL(request.url()).pathname.endsWith('/v1/files/upload'),
  );
}

async function openUploadScreen(page: Page): Promise<void> {
  await page.goto('/upload');
  await expect(
    page.getByRole('button', { name: UPLOAD_BUTTON_NAME }),
  ).toBeVisible();
}

async function chooseAndUpload(page: Page, file: CsvUpload): Promise<void> {
  await page.getByLabel(FILE_INPUT_LABEL).setInputFiles(file);
  await expect(page.getByText(/^Selected:/)).toContainText(
    `Selected: ${file.name}`,
  );
  await page.getByRole('button', { name: UPLOAD_BUTTON_NAME }).click();
}

test.describe('Epic file-upload-and-files, Story 2: Upload a transaction file', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-3
  test('uploading a valid seven-column .csv shows the success banner and the file tops Uploaded files', async ({
    page,
    context,
    baseURL,
  }) => {
    await startMockSession(page, context, baseURL);
    await mockUploadAndFileLogs(page);
    await openUploadScreen(page);

    const validFile = sevenColumnCsv('transactions_2026-11-12.csv', 20);
    const uploadRequestSent = waitForUploadRequest(page);
    await chooseAndUpload(page, validFile);
    const uploadRequest = await uploadRequestSent;

    const outcomeBanner = page.getByRole('main').getByRole('status');
    await expect(outcomeBanner).toContainText(/uploaded/i);
    await expect(outcomeBanner).not.toContainText(LAYOUT_REJECTION_MESSAGE);

    const uploadQuery = new URL(uploadRequest.url()).searchParams;
    expect(uploadQuery.get('FileName')).toBe(validFile.name);
    expect(uploadQuery.get('FileSettingId')).toMatch(/^\d+$/);
    expect(uploadQuery.get('FileSettingName')).toBeTruthy();
    expect(uploadRequest.headers()['content-type']).toContain(
      'application/octet-stream',
    );

    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Files' })
      .click();
    await expect(page).toHaveURL(/\/files$/);

    // Position is the contract here: the newly uploaded file must be the top data row.
    const firstFileRow = page
      .getByRole('table')
      .getByRole('row')
      .filter({ has: page.getByRole('cell') })
      .first();
    await expect(firstFileRow).toContainText(renamedUploadFileName(0));
  });

  // AC-5
  test('a valid file of 1,000 transactions passes the layout check and uploads successfully', async ({
    page,
    context,
    baseURL,
  }) => {
    await startMockSession(page, context, baseURL);
    await mockUploadAndFileLogs(page);
    await openUploadScreen(page);

    const largeFile = sevenColumnCsv('transactions_1000-rows.csv', 1000);
    const uploadRequestSent = waitForUploadRequest(page);
    await chooseAndUpload(page, largeFile);
    const uploadRequest = await uploadRequestSent;

    const outcomeBanner = page.getByRole('main').getByRole('status');
    await expect(outcomeBanner).toContainText(/uploaded/i);
    await expect(outcomeBanner).not.toContainText(LAYOUT_REJECTION_MESSAGE);

    const sentBytes = uploadRequest.postDataBuffer();
    expect(sentBytes?.equals(largeFile.buffer)).toBe(true);
  });

  // AC-6
  test('the upload screen has a visible file-input label, announces outcomes as a status, and passes an accessibility scan', async ({
    page,
    context,
    baseURL,
  }) => {
    await startMockSession(page, context, baseURL);
    await mockUploadAndFileLogs(page);
    await openUploadScreen(page);

    await expect(
      page.getByText(FILE_INPUT_LABEL, { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel(FILE_INPUT_LABEL)).toBeAttached();

    const initialScan = await new AxeBuilder({ page })
      .withTags(WCAG_22_AA_TAGS)
      .analyze();
    expect(initialScan.violations).toEqual([]);

    // Failure state: wrong header row.
    await chooseAndUpload(page, {
      name: 'transactions_wrong-columns.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'Reference,Date,Account,Description,Amount,Type\nTXN-1,2026/11/12 08:12,1001,Test,10,C\n',
      ),
    });
    const failureBanner = page
      .getByRole('main')
      .getByRole('status')
      .filter({ hasText: LAYOUT_REJECTION_MESSAGE });
    await expect(failureBanner).toBeVisible();

    const failureScan = await new AxeBuilder({ page })
      .withTags(WCAG_22_AA_TAGS)
      .analyze();
    expect(failureScan.violations).toEqual([]);

    // Success state.
    await chooseAndUpload(
      page,
      sevenColumnCsv('transactions_2026-11-12.csv', 5),
    );
    const successBanner = page.getByRole('main').getByRole('status');
    await expect(successBanner).toContainText(/uploaded/i);
    await expect(successBanner).not.toContainText(LAYOUT_REJECTION_MESSAGE);

    const successScan = await new AxeBuilder({ page })
      .withTags(WCAG_22_AA_TAGS)
      .analyze();
    expect(successScan.violations).toEqual([]);
  });
});

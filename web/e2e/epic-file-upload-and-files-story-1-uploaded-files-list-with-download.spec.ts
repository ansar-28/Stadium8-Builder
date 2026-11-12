/**
 * Story Metadata:
 * - Route: /files
 * - Target File: web/src/app/(app)/files/page.tsx
 *
 * Mocking strategy:
 * - Backend calls are ALWAYS mocked — this spec never contacts a live backend
 *   (see testing-policy.md § "Playwright runs against mocks, never live").
 *   Intercept via: page.route()
 * - Implementation pattern this assumes:
 *   - The (app) layout's session check requests the userinfo endpoint from the browser
 *     (path ending in /v1/auth/userinfo); its body comes from the shared identity source.
 *   - The Files page requests GET /transactions-api/v1/file-logs?IsActive=Yes and
 *     GET /transactions-api/v1/files/download?FileLogId=<Id> from the browser (client
 *     component calls through the API client to the same-origin proxy), because
 *     page.route() cannot intercept a server-side fetch. List bodies come from the
 *     shared file-log factories.
 *   - The downloaded bytes are saved in the browser under the file's name (e.g. a blob
 *     URL on an anchor with a `download` attribute), which raises a Playwright download.
 *   - The signed-in state is a `session` cookie (mock value, added to the browser
 *     context before navigating); the frontend never reads its value.
 * - If the implementation diverges from these assumptions, this spec will not pass.
 *
 * Controls (same in the Vitest file): table of uploaded files; button
 * "Download <file name>" (click); Shadcn Select combobox "Rows per page" (click it, then
 * click the option "5" / "10" / "20" / "50"); buttons "Previous" / "Next" (click);
 * notifications in the region "Notifications".
 *
 * E2E spec for Epic file-upload-and-files, Story 1: Uploaded files list with download.
 * These tests WILL FAIL until implemented (TDD red).
 */
import { readFile } from 'node:fs/promises';

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import {
  createFileLogList,
  createManyFileLogs,
} from '../src/mocks/data/file-log';
import {
  APPROVER_ROLE_NAME,
  FILE_IMPORTER_ROLE_NAME,
  userInfoFor,
} from '../src/mocks/data/identity';

import type { BrowserContext, Page } from '@playwright/test';

const WCAG_22_AA_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
];
const FILE_LOGS_URL = /\/transactions-api\/v1\/file-logs(\?|$)/;
const DOWNLOAD_URL = /\/transactions-api\/v1\/files\/download(\?|$)/;
const DOWNLOADED_FILE_NAME = 'transactions_2026-04-15.csv';
const DOWNLOADED_FILE_CONTENT =
  'Reference,TransactionDate,AccountNumber,Description,Amount,TransactionType,Currency\n' +
  'TXN-20260415-0001,2026/04/15 08:12,1234567890,Supplier payment,1500.00,D,ZAR\n';

/**
 * Start a signed-in session for a role: a mock session cookie plus a mocked userinfo
 * response from the shared identity source. Install before navigating.
 */
async function startMockSession(
  page: Page,
  context: BrowserContext,
  baseURL: string | undefined,
  roleName: string,
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
      body: JSON.stringify(userInfoFor(roleName)),
    }),
  );
}

async function mockFileLogs(
  page: Page,
  body: ReturnType<typeof createFileLogList>,
): Promise<void> {
  await page.route(FILE_LOGS_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    }),
  );
}

test.describe('Epic file-upload-and-files, Story 1: Uploaded files list with download', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-2
  test('changing the page size or the page changes which files show and the count', async ({
    page,
    context,
    baseURL,
  }) => {
    await startMockSession(page, context, baseURL, APPROVER_ROLE_NAME);
    await mockFileLogs(page, createFileLogList(createManyFileLogs(25)));
    await page.goto('/files');

    const table = page.getByRole('table');
    const downloadButtons = table.getByRole('button', { name: /^Download / });

    // Default page size is 20, newest first.
    await expect(downloadButtons).toHaveCount(20);
    await expect(page.getByText('Showing 20 of 25 files')).toBeVisible();
    await expect(
      table.getByRole('cell', { name: 'transactions_batch-025.csv' }),
    ).toBeVisible();
    await expect(
      table.getByRole('cell', { name: 'transactions_batch-005.csv' }),
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Previous' })).toBeDisabled();

    const firstPageScan = await new AxeBuilder({ page })
      .withTags(WCAG_22_AA_TAGS)
      .analyze();
    expect(firstPageScan.violations).toEqual([]);

    // Forward to the last page.
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(downloadButtons).toHaveCount(5);
    await expect(page.getByText('Showing 5 of 25 files')).toBeVisible();
    await expect(
      table.getByRole('cell', { name: 'transactions_batch-005.csv' }),
    ).toBeVisible();
    await expect(
      table.getByRole('cell', { name: 'transactions_batch-025.csv' }),
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled();

    // Back to the first page.
    await page.getByRole('button', { name: 'Previous' }).click();
    await expect(downloadButtons).toHaveCount(20);
    await expect(page.getByText('Showing 20 of 25 files')).toBeVisible();

    // Smaller page size.
    await page.getByRole('combobox', { name: 'Rows per page' }).click();
    await page.getByRole('option', { name: '5', exact: true }).click();
    await expect(downloadButtons).toHaveCount(5);
    await expect(page.getByText('Showing 5 of 25 files')).toBeVisible();
    await expect(
      table.getByRole('cell', { name: 'transactions_batch-025.csv' }),
    ).toBeVisible();
    await expect(
      table.getByRole('cell', { name: 'transactions_batch-020.csv' }),
    ).toHaveCount(0);

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(
      table.getByRole('cell', { name: 'transactions_batch-020.csv' }),
    ).toBeVisible();
    await expect(
      table.getByRole('cell', { name: 'transactions_batch-025.csv' }),
    ).toHaveCount(0);
    await expect(page.getByText('Showing 5 of 25 files')).toBeVisible();
  });

  // AC-3
  test('pressing Download saves the file under its name and confirms it in a notification', async ({
    page,
    context,
    baseURL,
  }) => {
    await startMockSession(page, context, baseURL, FILE_IMPORTER_ROLE_NAME);
    await mockFileLogs(page, createFileLogList());
    await page.route(DOWNLOAD_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        body: DOWNLOADED_FILE_CONTENT,
      }),
    );
    await page.goto('/files');

    const downloadButton = page
      .getByRole('table')
      .getByRole('button', { name: `Download ${DOWNLOADED_FILE_NAME}` });
    await expect(downloadButton).toBeVisible();

    const downloadEvent = page.waitForEvent('download');
    await downloadButton.click();
    const download = await downloadEvent;

    expect(download.suggestedFilename()).toBe(DOWNLOADED_FILE_NAME);
    const savedContent = await readFile(await download.path(), 'utf8');
    expect(savedContent).toBe(DOWNLOADED_FILE_CONTENT);

    const notifications = page.getByRole('region', { name: 'Notifications' });
    await expect(
      notifications.getByText(`${DOWNLOADED_FILE_NAME} downloaded.`),
    ).toBeVisible();

    const afterDownloadScan = await new AxeBuilder({ page })
      .withTags(WCAG_22_AA_TAGS)
      .analyze();
    expect(afterDownloadScan.violations).toEqual([]);
  });
});

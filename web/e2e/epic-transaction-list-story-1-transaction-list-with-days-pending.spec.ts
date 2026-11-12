/**
 * Story Metadata:
 * - Route: /transactions
 * - Target File: web/src/app/(app)/transactions/page.tsx
 *
 * Mocking strategy:
 * - Backend calls are ALWAYS mocked — this spec never contacts a live backend
 *   (see testing-policy.md § "Playwright runs against mocks, never live").
 *   Intercept via: page.route()
 * - Implementation pattern this assumes:
 *   - The (app) layout confirms the session by requesting userinfo from the browser
 *     (same-origin proxy path ending in /v1/auth/userinfo); the body comes from the
 *     shared identity source.
 *   - The Transactions list requests GET .../v1/transactions and
 *     GET .../v1/file-logs?IsActive=Yes from the browser (a client component calling
 *     the API client), because page.route() cannot intercept server-side fetches.
 *     Bodies come from the shared transaction / file-log factories.
 *   - The signed-in state is a `session` cookie (mock value, added to the browser
 *     context before navigating); the frontend never reads its value.
 * - If the implementation diverges from these assumptions, this spec will not pass.
 *
 * Controls (same in the Vitest file): the list is a native table (role "table",
 * header cells role "columnheader", transactions role "row" / "cell").
 *
 * E2E spec for Epic transaction-list, Story 1: Transaction list with days pending.
 * These tests WILL FAIL until implemented (TDD red).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { createFileLogList } from '../src/mocks/data/file-log';
import {
  FILE_IMPORTER_ROLE_NAME,
  userInfoFor,
} from '../src/mocks/data/identity';
import {
  createSampleTransactions,
  createTransactionList,
} from '../src/mocks/data/transaction';

import type { BrowserContext, Page } from '@playwright/test';

const WCAG_22_AA_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
];

const TRANSACTIONS_ENDPOINT = /\/v1\/transactions(\?.*)?$/;
const FILE_LOGS_ENDPOINT = /\/v1\/file-logs(\?.*)?$/;

const COLUMN_HEADERS = [
  'Reference',
  'Date',
  'Account number',
  'Description',
  'Amount',
  'Type',
  'Currency',
  'Status',
  'Days pending',
];

/**
 * Start a signed-in session for a role and serve the transaction list and file logs
 * from the shared factories. Install before navigating.
 */
async function openTransactionsAs(
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
  await page.route(TRANSACTIONS_ENDPOINT, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createTransactionList(createSampleTransactions())),
    }),
  );
  await page.route(FILE_LOGS_ENDPOINT, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createFileLogList()),
    }),
  );
  await page.goto('/transactions');
}

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test.describe('Epic transaction-list, Story 1: Transaction list with days pending', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-1
  test('lists the transactions newest first with full account numbers, chips, rejection reason, count and no editable fields', async ({
    page,
    context,
    baseURL,
  }) => {
    await openTransactionsAs(page, context, baseURL, FILE_IMPORTER_ROLE_NAME);

    const table = page.getByRole('table');
    for (const header of COLUMN_HEADERS) {
      // Anchored at the start so a later sort indicator (" ▲" / " ▼") still matches.
      await expect(
        table.getByRole('columnheader', {
          name: new RegExp(`^${escapeForRegExp(header)}(\\s|$)`),
        }),
      ).toBeVisible();
    }

    const dataRows = table.locator('tbody').getByRole('row');
    await expect(dataRows).toHaveText([
      /TXN-00002/,
      /TXN-00001/,
      /TXN-00003/,
      /TXN-00005/,
      /TXN-00004/,
    ]);

    const creditPendingRow = dataRows.filter({ hasText: 'TXN-00002' });
    await expect(
      creditPendingRow.getByRole('cell', { name: '2026-04-15 09:40' }),
    ).toBeVisible();
    await expect(
      creditPendingRow.getByRole('cell', { name: '2002-3345-1100' }),
    ).toBeVisible();
    await expect(
      creditPendingRow.getByRole('cell', { name: /^12\s345\.35$/ }),
    ).toBeVisible();
    await expect(
      creditPendingRow.getByRole('cell', { name: 'Credit', exact: true }),
    ).toBeVisible();
    await expect(
      creditPendingRow.getByRole('cell', { name: 'USD', exact: true }),
    ).toBeVisible();
    await expect(
      creditPendingRow.getByRole('cell', { name: 'Pending', exact: true }),
    ).toBeVisible();

    const debitImportedRow = dataRows.filter({ hasText: 'TXN-00001' });
    await expect(
      debitImportedRow.getByRole('cell', { name: 'Debit', exact: true }),
    ).toBeVisible();
    await expect(
      debitImportedRow.getByRole('cell', { name: 'Pending', exact: true }),
    ).toBeVisible();

    const approvedRow = dataRows.filter({ hasText: 'TXN-00003' });
    await expect(
      approvedRow.getByRole('cell', { name: 'Approved', exact: true }),
    ).toBeVisible();

    const rejectedRow = dataRows.filter({ hasText: 'TXN-00004' });
    await expect(
      rejectedRow.getByRole('cell', { name: '1001-2034-9988' }),
    ).toBeVisible();
    await expect(rejectedRow).toContainText('Rejected');
    await expect(rejectedRow).toContainText(
      'Reason: Amount does not match supporting document',
    );

    await expect(page.getByText('Showing 5 of 5 transactions')).toBeVisible();

    await expect(table.getByRole('textbox')).toHaveCount(0);
    await expect(table.getByRole('spinbutton')).toHaveCount(0);
    await expect(table.getByRole('combobox')).toHaveCount(0);
    await expect(table.getByRole('checkbox')).toHaveCount(0);
    await expect(table.locator('[contenteditable="true"]')).toHaveCount(0);
  });

  // AC-6
  test('the loaded Transactions list has no accessibility violations', async ({
    page,
    context,
    baseURL,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await openTransactionsAs(page, context, baseURL, FILE_IMPORTER_ROLE_NAME);

    await expect(
      page.getByRole('table').locator('tbody').getByRole('row'),
    ).toHaveCount(5);
    await expect(page.getByText('Showing 5 of 5 transactions')).toBeVisible();

    const { violations } = await new AxeBuilder({ page })
      .withTags(WCAG_22_AA_TAGS)
      .analyze();
    expect(violations).toEqual([]);
  });
});

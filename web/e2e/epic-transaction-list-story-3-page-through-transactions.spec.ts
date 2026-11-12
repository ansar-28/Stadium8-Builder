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
 *   - The (app) layout's session check requests userinfo from the browser (path ending
 *     in /v1/auth/userinfo); the body comes from the shared identity source.
 *   - The Transactions list requests GET /transactions-api/v1/transactions and
 *     GET /transactions-api/v1/file-logs?IsActive=Yes from the browser (a client
 *     component calling the API client through the same-origin proxy), because
 *     page.route() cannot intercept server-side fetches. Bodies come from the shared
 *     entity factories.
 *   - The signed-in state is a `session` cookie (mock value, added to the browser
 *     context before navigating); the frontend never reads its value.
 *   - Paging is done in the browser on the full list; no paging request is made.
 * - If the implementation diverges from these assumptions, this spec will not pass.
 *
 * Controls (same in the Vitest file): `button` "Previous", `button` "Next", the label
 * "Page <n> of <pages>" as plain text; rows are identified by their Reference text
 * inside the `table`.
 *
 * E2E spec for Epic transaction-list, Story 3: Page through transactions.
 * These tests WILL FAIL until implemented (TDD red).
 */
import { expect, test } from '@playwright/test';

import { createFileLogList } from '../src/mocks/data/file-log';
import { APPROVER_ROLE_NAME, userInfoFor } from '../src/mocks/data/identity';
import {
  createTransaction,
  createTransactionList,
} from '../src/mocks/data/transaction';

import type { BrowserContext, Page } from '@playwright/test';
import type { TransactionRead } from '../src/types/api-generated';

const REFERENCE_PATTERN = /^TXN-\d{5}$/;

/**
 * `count` transactions, one per day in March 2026, so the default Date-descending
 * sort puts the highest-numbered reference first (TXN-000<count> … TXN-00001).
 */
function createDatedTransactions(count: number): TransactionRead[] {
  return Array.from({ length: count }, (_, index) => {
    const sequence = index + 1;
    return createTransaction({
      Id: sequence,
      Reference: `TXN-${String(sequence).padStart(5, '0')}`,
      TransactionDate: `2026-03-${String(sequence).padStart(2, '0')} 10:00:00`,
    });
  });
}

/** Mock session cookie + userinfo from the shared identity source. Install before navigating. */
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

async function serveTransactions(
  page: Page,
  transactions: TransactionRead[],
): Promise<void> {
  await page.route('**/v1/transactions', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createTransactionList(transactions)),
    }),
  );
  await page.route('**/v1/file-logs?*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createFileLogList()),
    }),
  );
}

test.describe('Epic transaction-list, Story 3: Page through transactions', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-4
  test('Next and Previous move through the pages, updating the rows and the page label', async ({
    page,
    context,
    baseURL,
  }) => {
    await startMockSession(page, context, baseURL, APPROVER_ROLE_NAME);
    await serveTransactions(page, createDatedTransactions(23));
    await page.goto('/transactions');

    const table = page.getByRole('table');
    const references = table.getByText(REFERENCE_PATTERN);
    const previousButton = page.getByRole('button', { name: 'Previous' });
    const nextButton = page.getByRole('button', { name: 'Next' });

    await expect(page.getByText('Page 1 of 2')).toBeVisible();
    await expect(references).toHaveCount(20);
    await expect(table.getByText('TXN-00023', { exact: true })).toBeVisible();
    await expect(table.getByText('TXN-00003', { exact: true })).toHaveCount(0);

    await nextButton.click();

    await expect(page.getByText('Page 2 of 2')).toBeVisible();
    await expect(references).toHaveCount(3);
    await expect(table.getByText('TXN-00003', { exact: true })).toBeVisible();
    await expect(table.getByText('TXN-00001', { exact: true })).toBeVisible();
    await expect(table.getByText('TXN-00023', { exact: true })).toHaveCount(0);

    await previousButton.click();

    await expect(page.getByText('Page 1 of 2')).toBeVisible();
    await expect(references).toHaveCount(20);
    await expect(table.getByText('TXN-00023', { exact: true })).toBeVisible();
    await expect(table.getByText('TXN-00003', { exact: true })).toHaveCount(0);
  });
});

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
 *   - The (app) layout's session check requests userinfo from the browser (same-origin
 *     proxy path ending in /v1/auth/userinfo); the body comes from the shared identity
 *     source.
 *   - The Transactions page loads GET /transactions-api/v1/transactions and
 *     GET /transactions-api/v1/file-logs?IsActive=Yes from the browser (client
 *     component through the API client), so page.route() can intercept both. Bodies
 *     come from the shared transaction / file-log factories.
 *   - Filtering, sorting and paging happen in the browser on the full loaded list —
 *     no further backend calls.
 *   - The signed-in state is a `session` cookie (mock value, added to the browser
 *     context before navigating); the frontend never reads its value.
 * - If the implementation diverges from these assumptions, this spec will not pass.
 *
 * Controls (same in the Vitest file): search landmark "Filters"; textbox
 * "Account number" filled by typing; button "Clear all" inside the filter card;
 * sort buttons found by role "button" with a name starting with the column title
 * (e.g. /^Amount/), pressed by click; pagination button "Next" and the
 * "Page <n> of <pages>" label (Story 3).
 *
 * E2E spec for Epic transaction-list, Story 2: Filter and sort transactions.
 * These tests WILL FAIL until implemented (TDD red).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { createFileLogList } from '../src/mocks/data/file-log';
import { APPROVER_ROLE_NAME, userInfoFor } from '../src/mocks/data/identity';
import {
  TRANSACTION_TYPE_CREDIT,
  TRANSACTION_TYPE_DEBIT,
  createTransaction,
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

const TRANSACTION_COUNT = 25;
const DISTINCT_ACCOUNT_PREFIX = '7007-1234';

function referenceFor(sequenceNumber: number): string {
  return `TXN-${String(sequenceNumber).padStart(5, '0')}`;
}

/**
 * 25 transactions so the default 20-row page size gives two pages. The oldest is also
 * the smallest amount, so sorting by Amount ascending brings page-2 rows to page 1.
 * Every fifth transaction has a distinct account number for the filter.
 */
function createTwoPagesOfTransactions() {
  return createTransactionList(
    Array.from({ length: TRANSACTION_COUNT }, (_, index) => {
      const sequenceNumber = index + 1;
      const hasDistinctAccount = sequenceNumber % 5 === 0;
      return createTransaction({
        Id: sequenceNumber,
        Reference: referenceFor(sequenceNumber),
        TransactionDate: `2026-03-${String(sequenceNumber).padStart(2, '0')} 10:00:00`,
        AccountNumber: hasDistinctAccount
          ? `${DISTINCT_ACCOUNT_PREFIX}-${String(sequenceNumber).padStart(4, '0')}`
          : `1001-2034-${String(sequenceNumber).padStart(4, '0')}`,
        Description: `Sample transaction ${sequenceNumber}`,
        Amount: sequenceNumber * 100,
        TransactionType:
          sequenceNumber % 2 === 0
            ? TRANSACTION_TYPE_CREDIT
            : TRANSACTION_TYPE_DEBIT,
      });
    }),
  );
}

/**
 * Start a signed-in session and serve the transaction list. Install before navigating.
 */
async function openTransactionsWithTwoPages(
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
      body: JSON.stringify(userInfoFor(APPROVER_ROLE_NAME)),
    }),
  );
  await page.route('**/transactions-api/v1/transactions', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createTwoPagesOfTransactions()),
    }),
  );
  await page.route('**/transactions-api/v1/file-logs**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createFileLogList()),
    }),
  );
  await page.goto('/transactions');
}

test.describe('Epic transaction-list, Story 2: Filter and sort transactions', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-5
  test('filtering or sorting from page 2 narrows or re-orders the list and returns to page 1', async ({
    page,
    context,
    baseURL,
  }) => {
    await openTransactionsWithTwoPages(page, context, baseURL);

    const table = page.getByRole('table');
    const filterCard = page.getByRole('search', { name: 'Filters' });
    const nextPageButton = page.getByRole('button', { name: 'Next' });

    await expect(
      table.getByText(referenceFor(25), { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Page 1 of 2')).toBeVisible();

    // Filter from page 2: the list narrows and returns to page 1.
    await nextPageButton.click();
    await expect(page.getByText('Page 2 of 2')).toBeVisible();
    await expect(
      table.getByText(referenceFor(5), { exact: true }),
    ).toBeVisible();

    await filterCard.getByLabel('Account number').fill(DISTINCT_ACCOUNT_PREFIX);
    await expect(page.getByText('Page 1 of 1')).toBeVisible();
    await expect(
      page.getByText(`Showing 5 of ${TRANSACTION_COUNT} transactions`),
    ).toBeVisible();
    await expect(
      table.getByText(referenceFor(25), { exact: true }),
    ).toBeVisible();
    await expect(
      table.getByText(referenceFor(5), { exact: true }),
    ).toBeVisible();
    await expect(
      table.getByText(referenceFor(24), { exact: true }),
    ).toBeHidden();

    const filteredScan = await new AxeBuilder({ page })
      .withTags(WCAG_22_AA_TAGS)
      .analyze();
    expect(filteredScan.violations).toEqual([]);

    // Sort from page 2: the list re-orders and returns to page 1.
    await filterCard.getByRole('button', { name: 'Clear all' }).click();
    await expect(page.getByText('Page 1 of 2')).toBeVisible();
    await nextPageButton.click();
    await expect(page.getByText('Page 2 of 2')).toBeVisible();
    await expect(
      table.getByText(referenceFor(1), { exact: true }),
    ).toBeVisible();

    await page.getByRole('button', { name: /^Amount(\s|$)/ }).click();
    await expect(page.getByText('Page 1 of 2')).toBeVisible();
    await expect(
      table.getByText(referenceFor(1), { exact: true }),
    ).toBeVisible();
    await expect(
      table.getByText(referenceFor(25), { exact: true }),
    ).toBeHidden();
  });
});

/**
 * Story Metadata:
 * - Route: /transactions
 * - Target File: web/src/app/(app)/transactions/page.tsx
 *
 * Epic transaction-list, Story 3: Page through transactions.
 *
 * Implementation contract these tests assume:
 * - The Transactions page (default export of the target file) renders the list inside
 *   the (app) layout's SessionProvider and loads `getTransactions()` and
 *   `getFileLogs('Yes')` through the API client.
 * - The list is a `table`; each row shows its Reference (e.g. "TXN-00023") as text.
 * - Pages are sliced client-side from the sorted list (default Date descending).
 *
 * Controls (found and operated the same way in the Playwright spec):
 * - "Rows per page": a native select (Shadcn native-select) — role `combobox`, accessible
 *   name "Rows per page", options "5" / "10" / "20" / "50", default "20"; changed with
 *   a select-option interaction.
 * - `button` "Previous" and `button` "Next" (disabled = `disabled` attribute).
 * - The label "Page <n> of <pages>" as plain text.
 *
 * These tests WILL FAIL until implemented (TDD red).
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TransactionsPage from '@/app/(app)/transactions/page';
import { SessionProvider } from '@/contexts/SessionContext';
import { get } from '@/lib/api/client';
import { createFileLogList } from '@/mocks/data/file-log';
import { APPROVER_ROLE_NAME, userInfoFor } from '@/mocks/data/identity';
import {
  createSampleTransactions,
  createTransaction,
  createTransactionList,
} from '@/mocks/data/transaction';
import type { TransactionRead } from '@/types/api-generated';

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

const mockGet = get as unknown as Mock<
  (endpoint: string, params?: unknown) => Promise<unknown>
>;

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

function serveTransactions(transactions: TransactionRead[]): void {
  mockGet.mockImplementation((endpoint: string) => {
    if (endpoint.includes('/v1/file-logs')) {
      return Promise.resolve(createFileLogList());
    }
    if (endpoint.includes('/v1/transactions')) {
      return Promise.resolve(createTransactionList(transactions));
    }
    return Promise.reject(new Error(`Unexpected GET ${endpoint}`));
  });
}

function renderTransactionsPage(): void {
  render(
    <SessionProvider user={userInfoFor(APPROVER_ROLE_NAME)}>
      <TransactionsPage />
    </SessionProvider>,
  );
}

async function findTransactionTable(): Promise<HTMLElement> {
  const table = await screen.findByRole('table');
  await within(table).findAllByText(REFERENCE_PATTERN);
  return table;
}

describe('Epic transaction-list, Story 3: Page through transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // AC-1
  it('always shows Rows per page (5/10/20/50, default 20), Previous, the page label and Next, even when everything fits on one page', async () => {
    serveTransactions(createSampleTransactions());
    renderTransactionsPage();
    await findTransactionTable();

    const rowsPerPage = screen.getByRole('combobox', { name: 'Rows per page' });
    expect(rowsPerPage).toHaveValue('20');
    expect(
      within(rowsPerPage)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['5', '10', '20', '50']);

    expect(
      screen.getByRole('button', { name: 'Previous' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
  });

  // AC-2
  it('disables Previous on the first page and Next on the last page', async () => {
    const user = userEvent.setup();
    serveTransactions(createDatedTransactions(23));
    renderTransactionsPage();
    await findTransactionTable();

    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('Page 2 of 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled();
  });

  // AC-3
  it('changing Rows per page shows that many rows and returns to page 1', async () => {
    const user = userEvent.setup();
    serveTransactions(createDatedTransactions(23));
    renderTransactionsPage();
    const table = await findTransactionTable();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Page 2 of 2')).toBeInTheDocument();

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Rows per page' }),
      '5',
    );

    expect(await screen.findByText('Page 1 of 5')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Rows per page' })).toHaveValue(
      '5',
    );
    const visibleReferences = within(table)
      .getAllByText(REFERENCE_PATTERN)
      .map((reference) => reference.textContent);
    expect(visibleReferences).toEqual([
      'TXN-00023',
      'TXN-00022',
      'TXN-00021',
      'TXN-00020',
      'TXN-00019',
    ]);
  });
});

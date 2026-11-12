/**
 * Story Metadata:
 * - Route: /transactions
 * - Target File: web/src/app/(app)/transactions/page.tsx
 *
 * Epic transaction-list, Story 2: Filter and sort transactions.
 *
 * Implementation contract these tests assume:
 * - The Transactions page (default export of the route file) renders inside the
 *   (app) layout's `SessionProvider` and loads its data through `getTransactions()`
 *   and `getFileLogs('Yes')`, which call `get` from `@/lib/api/client`.
 * - The filter card is a search landmark labelled "Filters" (`role="search"`,
 *   `aria-label="Filters"`) holding visibly labelled fields:
 *   "Date from" / "Date to" (date inputs), "Account number" (text input, placeholder
 *   "1001-2034"), "Amount min" / "Amount max" (number inputs), "Transaction type"
 *   and "Currency" (comboboxes defaulting to "Any"), and a "Clear all" button.
 * - The no-match state shows "No transactions match these filters", the active
 *   filters as list items in a list labelled "Active filters" (each chip names its
 *   filter, e.g. "Account number: 1001-2034"), and its own "Clear all" button
 *   outside the filter card.
 * - Each data column header (role columnheader) contains a native button named after
 *   the column; the active column's header carries `aria-sort` and shows " ▲" / " ▼".
 *
 * Controls (same in the Playwright spec): search landmark "Filters"; textbox
 * "Account number" filled by typing; button "Clear all" inside the filter card;
 * sort buttons found by role "button" with a name starting with the column title
 * (e.g. /^Amount/), pressed by click.
 *
 * These tests WILL FAIL until implemented (TDD red).
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TransactionsPage from '@/app/(app)/transactions/page';
import { SessionProvider } from '@/contexts/SessionContext';
import { get } from '@/lib/api/client';
import { createFileLogList } from '@/mocks/data/file-log';
import { APPROVER_ROLE_NAME, userInfoFor } from '@/mocks/data/identity';
import { createTransactionList } from '@/mocks/data/transaction';

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

const mockGet = get as unknown as Mock<(endpoint: string) => Promise<unknown>>;

const SORTABLE_COLUMN_TITLES = [
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

function serveSampleData(): void {
  mockGet.mockImplementation(async (endpoint: string) => {
    if (endpoint.includes('/v1/file-logs')) {
      return createFileLogList();
    }
    if (endpoint.includes('/v1/transactions')) {
      return createTransactionList();
    }
    throw new Error(`Unexpected endpoint in test: ${endpoint}`);
  });
}

async function renderLoadedTransactionsPage(): Promise<void> {
  render(
    <SessionProvider user={userInfoFor(APPROVER_ROLE_NAME)}>
      <TransactionsPage />
    </SessionProvider>,
  );
  await screen.findByText('TXN-00001');
}

/** References in the order the table currently shows them. */
function shownReferences(): string[] {
  return within(screen.getByRole('table'))
    .getAllByText(/^TXN-\d{5}$/)
    .map((referenceCell) => referenceCell.textContent?.trim() ?? '');
}

function filterCard(): HTMLElement {
  return screen.getByRole('search', { name: 'Filters' });
}

function sortableHeader(columnTitle: string): HTMLElement {
  const sortButton = screen.getByRole('button', {
    name: new RegExp(`^${columnTitle}(\\s|$)`),
  });
  const header = sortButton.closest('th');
  expect(header).not.toBeNull();
  return header as HTMLElement;
}

describe('Epic transaction-list, Story 2: Filter and sort transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serveSampleData();
  });

  // AC-1
  it('shows the labelled filters and narrows the list to transactions matching every filter, with inclusive bounds', async () => {
    const user = userEvent.setup();
    await renderLoadedTransactionsPage();

    const filters = filterCard();
    const accountNumberField = within(filters).getByLabelText('Account number');
    expect(accountNumberField).toHaveAttribute('placeholder', '1001-2034');
    const dateFromField = within(filters).getByLabelText('Date from');
    const dateToField = within(filters).getByLabelText('Date to');
    const amountMinField = within(filters).getByLabelText('Amount min');
    const amountMaxField = within(filters).getByLabelText('Amount max');
    expect(
      within(filters).getByRole('combobox', { name: 'Transaction type' }),
    ).toHaveTextContent('Any');
    expect(
      within(filters).getByRole('combobox', { name: 'Currency' }),
    ).toHaveTextContent('Any');
    expect(
      within(filters).getByRole('button', { name: 'Clear all' }),
    ).toBeInTheDocument();

    expect(screen.getByText('Showing 5 of 5 transactions')).toBeInTheDocument();

    // Account number matches any account containing the text.
    await user.type(accountNumberField, '1001-2034');
    await waitFor(() => {
      expect(shownReferences()).toEqual(['TXN-00001', 'TXN-00004']);
    });
    expect(screen.getByText('Showing 2 of 5 transactions')).toBeInTheDocument();

    // Amount bounds equal to the two remaining amounts keep both (inclusive).
    await user.type(amountMinField, '1500.50');
    await user.type(amountMaxField, '8900');
    await waitFor(() => {
      expect(shownReferences()).toEqual(['TXN-00001', 'TXN-00004']);
    });

    // Both date bounds on 2026-04-10 keep the 11:20 transaction of that day (inclusive).
    await user.type(dateFromField, '2026-04-10');
    await user.type(dateToField, '2026-04-10');
    await waitFor(() => {
      expect(shownReferences()).toEqual(['TXN-00004']);
    });
    expect(screen.getByText('Showing 1 of 5 transactions')).toBeInTheDocument();
  });

  // AC-2
  it('shows the no-match state with a chip per active filter, and its Clear all brings back the full list', async () => {
    const user = userEvent.setup();
    await renderLoadedTransactionsPage();

    const filters = filterCard();
    await user.type(
      within(filters).getByLabelText('Account number'),
      '1001-2034',
    );
    await user.type(within(filters).getByLabelText('Amount min'), '20000');

    expect(
      await screen.findByText('No transactions match these filters'),
    ).toBeInTheDocument();
    expect(screen.queryByText('TXN-00001')).not.toBeInTheDocument();

    const chips = within(
      screen.getByRole('list', { name: 'Active filters' }),
    ).getAllByRole('listitem');
    expect(chips).toHaveLength(2);
    expect(chips.map((chip) => chip.textContent ?? '')).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Account number.*1001-2034/),
        expect.stringMatching(/Amount min/),
      ]),
    );

    const noMatchClearAll = screen
      .getAllByRole('button', { name: 'Clear all' })
      .find((clearAllButton) => !filters.contains(clearAllButton));
    expect(noMatchClearAll).toBeDefined();
    await user.click(noMatchClearAll as HTMLElement);

    await waitFor(() => {
      expect(shownReferences()).toHaveLength(5);
    });
    expect(
      screen.queryByText('No transactions match these filters'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Showing 5 of 5 transactions')).toBeInTheDocument();
    expect(within(filters).getByLabelText('Account number')).toHaveValue('');
  });

  // AC-3
  it('sorts by a clicked column ascending, then descending on a second click, marking the active header', async () => {
    const user = userEvent.setup();
    await renderLoadedTransactionsPage();

    // Default: Date descending.
    expect(shownReferences()).toEqual([
      'TXN-00002',
      'TXN-00001',
      'TXN-00003',
      'TXN-00005',
      'TXN-00004',
    ]);
    expect(sortableHeader('Date')).toHaveTextContent('▼');

    await user.click(screen.getByRole('button', { name: /^Amount(\s|$)/ }));
    expect(shownReferences()).toEqual([
      'TXN-00005',
      'TXN-00003',
      'TXN-00001',
      'TXN-00004',
      'TXN-00002',
    ]);
    expect(sortableHeader('Amount')).toHaveTextContent('▲');
    expect(sortableHeader('Date')).not.toHaveTextContent(/[▲▼]/);

    await user.click(screen.getByRole('button', { name: /^Amount(\s|$)/ }));
    expect(shownReferences()).toEqual([
      'TXN-00002',
      'TXN-00004',
      'TXN-00001',
      'TXN-00003',
      'TXN-00005',
    ]);
    expect(sortableHeader('Amount')).toHaveTextContent('▼');
  });

  // AC-4
  it('makes every column header a keyboard-operable sort button that exposes its sort direction', async () => {
    const user = userEvent.setup();
    await renderLoadedTransactionsPage();

    for (const columnTitle of SORTABLE_COLUMN_TITLES) {
      const header = sortableHeader(columnTitle);
      expect(within(header).getByRole('button')).toBeEnabled();
    }
    expect(sortableHeader('Date')).toHaveAttribute('aria-sort', 'descending');

    const amountSortButton = screen.getByRole('button', {
      name: /^Amount(\s|$)/,
    });
    amountSortButton.focus();
    expect(amountSortButton).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(sortableHeader('Amount')).toHaveAttribute('aria-sort', 'ascending');
    expect(sortableHeader('Date')).not.toHaveAttribute(
      'aria-sort',
      'descending',
    );
    expect(shownReferences()[0]).toBe('TXN-00005');

    await user.keyboard(' ');
    expect(sortableHeader('Amount')).toHaveAttribute('aria-sort', 'descending');
    expect(shownReferences()[0]).toBe('TXN-00002');
  });
});

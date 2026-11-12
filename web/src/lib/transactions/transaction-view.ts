import type { TransactionRow } from '@/lib/transactions/transaction-rows';

export const ANY_OPTION = 'Any';

export interface TransactionFilters {
  /** "YYYY-MM-DD" from a date input, or "" when unset. */
  dateFrom: string;
  dateTo: string;
  accountNumber: string;
  /** Raw text from a number input, or "" when unset. */
  amountMin: string;
  amountMax: string;
  /** "Any", "Credit" or "Debit". */
  transactionType: string;
  /** "Any" or a currency code. */
  currency: string;
}

export const NO_FILTERS: TransactionFilters = {
  dateFrom: '',
  dateTo: '',
  accountNumber: '',
  amountMin: '',
  amountMax: '',
  transactionType: ANY_OPTION,
  currency: ANY_OPTION,
};

export const FILTER_LABELS: Record<keyof TransactionFilters, string> = {
  dateFrom: 'Date from',
  dateTo: 'Date to',
  accountNumber: 'Account number',
  amountMin: 'Amount min',
  amountMax: 'Amount max',
  transactionType: 'Transaction type',
  currency: 'Currency',
};

const CHOICE_FILTERS = new Set<keyof TransactionFilters>([
  'transactionType',
  'currency',
]);

const FILTER_ORDER: (keyof TransactionFilters)[] = [
  'dateFrom',
  'dateTo',
  'accountNumber',
  'amountMin',
  'amountMax',
  'transactionType',
  'currency',
];

export type SortColumn =
  | 'reference'
  | 'transactionDate'
  | 'accountNumber'
  | 'description'
  | 'amount'
  | 'transactionType'
  | 'currency'
  | 'status'
  | 'daysPending';

export type SortDirection = 'ascending' | 'descending';

export interface TransactionSort {
  column: SortColumn;
  direction: SortDirection;
}

export const DEFAULT_SORT: TransactionSort = {
  column: 'transactionDate',
  direction: 'descending',
};

/** A new column sorts ascending; the active column flips direction. */
export function nextSort(
  currentSort: TransactionSort,
  clickedColumn: SortColumn,
): TransactionSort {
  if (currentSort.column !== clickedColumn) {
    return { column: clickedColumn, direction: 'ascending' };
  }
  return {
    column: clickedColumn,
    direction:
      currentSort.direction === 'ascending' ? 'descending' : 'ascending',
  };
}

type SortValue = string | number | null;

function sortValueOf(row: TransactionRow, column: SortColumn): SortValue {
  switch (column) {
    case 'transactionDate':
      return Number.isFinite(row.transactionTimestamp)
        ? row.transactionTimestamp
        : null;
    case 'amount':
      return Number.isFinite(row.amount) ? row.amount : null;
    case 'daysPending':
      return row.daysPending;
    default:
      return row[column];
  }
}

const textCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

function compareKnownValues(first: string | number, second: string | number) {
  if (typeof first === 'number' && typeof second === 'number') {
    return first - second;
  }
  return textCollator.compare(String(first), String(second));
}

/** Sorted copy; values that can't be compared (unreadable date, no days pending) go last either way. */
export function sortRows(
  rows: readonly TransactionRow[],
  sort: TransactionSort,
): TransactionRow[] {
  const directionFactor = sort.direction === 'ascending' ? 1 : -1;
  return [...rows].sort((firstRow, secondRow) => {
    const first = sortValueOf(firstRow, sort.column);
    const second = sortValueOf(secondRow, sort.column);
    if (first === null || second === null) {
      return Number(first === null) - Number(second === null);
    }
    return compareKnownValues(first, second) * directionFactor;
  });
}

const DATE_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Local midnight at the start of the given "YYYY-MM-DD" day, plus `dayOffset` days. */
function startOfLocalDay(dateText: string, dayOffset = 0): number | null {
  const match = DATE_INPUT_PATTERN.exec(dateText);
  if (!match) return null;
  const [, year, month, day] = match;
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day) + dayOffset,
  ).getTime();
}

function amountBoundOf(amountText: string): number | null {
  if (amountText.trim() === '') return null;
  const amount = Number(amountText);
  return Number.isFinite(amount) ? amount : null;
}

/** Rows matching every active filter (AND); date and amount bounds are inclusive. */
export function filterRows(
  rows: readonly TransactionRow[],
  filters: TransactionFilters,
): TransactionRow[] {
  const earliestTimestamp = startOfLocalDay(filters.dateFrom);
  const timestampAfterLastDay = startOfLocalDay(filters.dateTo, 1);
  const accountNumberText = filters.accountNumber.trim().toLowerCase();
  const minimumAmount = amountBoundOf(filters.amountMin);
  const maximumAmount = amountBoundOf(filters.amountMax);
  const transactionType =
    filters.transactionType === ANY_OPTION ? null : filters.transactionType;
  const currency = filters.currency === ANY_OPTION ? null : filters.currency;

  const hasDateBound =
    earliestTimestamp !== null || timestampAfterLastDay !== null;
  const hasAmountBound = minimumAmount !== null || maximumAmount !== null;
  if (
    !hasDateBound &&
    !hasAmountBound &&
    accountNumberText === '' &&
    transactionType === null &&
    currency === null
  ) {
    return [...rows];
  }

  return rows.filter((row) => {
    if (hasDateBound) {
      if (!Number.isFinite(row.transactionTimestamp)) return false;
      if (
        earliestTimestamp !== null &&
        row.transactionTimestamp < earliestTimestamp
      ) {
        return false;
      }
      if (
        timestampAfterLastDay !== null &&
        row.transactionTimestamp >= timestampAfterLastDay
      ) {
        return false;
      }
    }
    if (
      accountNumberText !== '' &&
      !row.accountNumber.toLowerCase().includes(accountNumberText)
    ) {
      return false;
    }
    if (hasAmountBound) {
      if (!Number.isFinite(row.amount)) return false;
      if (minimumAmount !== null && row.amount < minimumAmount) return false;
      if (maximumAmount !== null && row.amount > maximumAmount) return false;
    }
    if (transactionType !== null && row.transactionType !== transactionType) {
      return false;
    }
    if (currency !== null && row.currency !== currency) return false;
    return true;
  });
}

export interface ActiveFilterChip {
  filterName: keyof TransactionFilters;
  text: string;
}

/** One chip per filter that restricts the list, named by its field label. */
export function activeFilterChips(
  filters: TransactionFilters,
): ActiveFilterChip[] {
  return FILTER_ORDER.flatMap((filterName) => {
    const value = filters[filterName].trim();
    const isUnrestricted =
      value === '' || (CHOICE_FILTERS.has(filterName) && value === ANY_OPTION);
    if (isUnrestricted) return [];
    return [{ filterName, text: `${FILTER_LABELS[filterName]}: ${value}` }];
  });
}

/** Distinct currencies present in the loaded list, alphabetical. */
export function currencyOptionsOf(rows: readonly TransactionRow[]): string[] {
  const currencies = new Set<string>();
  for (const row of rows) {
    if (row.currency) currencies.add(row.currency);
  }
  return [...currencies].sort((first, second) => first.localeCompare(second));
}

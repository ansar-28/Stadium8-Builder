'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { ListPagination } from '@/components/layout/ListPagination';
import {
  StatusChip,
  TypeChip,
} from '@/components/transactions/TransactionChips';
import { TransactionFilterCard } from '@/components/transactions/TransactionFilterCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useSignedInUser } from '@/contexts/SessionContext';
import { getFileLogs, getTransactions } from '@/lib/api/endpoints';
import { FILE_IMPORTER_ROLE_NAME, hasRole } from '@/lib/auth/roles';
import { DEFAULT_PAGE_SIZE, FIRST_PAGE, slicePage } from '@/lib/pagination';
import {
  toTransactionRows,
  type TransactionRow,
} from '@/lib/transactions/transaction-rows';
import {
  activeFilterChips,
  currencyOptionsOf,
  DEFAULT_SORT,
  filterRows,
  nextSort,
  NO_FILTERS,
  sortRows,
  type ActiveFilterChip,
  type SortColumn,
  type SortDirection,
  type TransactionFilters,
  type TransactionSort,
} from '@/lib/transactions/transaction-view';
import { cn } from '@/lib/utils';
import type { APIError } from '@/types/api';

const STILL_LOADING_DELAY_MS = 3000;
const STILL_LOADING_MESSAGE = 'Still loading transactions…';
const UPLOAD_PATH = '/upload';
const FALLBACK_LOAD_FAILURE_MESSAGE =
  'The transactions could not be loaded. Please try again.';
const SKELETON_BAR_WIDTHS = ['w-full', 'w-11/12', 'w-4/5', 'w-full', 'w-3/4'];

type ListLoad =
  | { status: 'loading' }
  | { status: 'loaded'; rows: TransactionRow[] }
  | { status: 'failed'; messages: string[] };

/** The server's own words for a failed load: its message, then any further detail it gave. */
function failureMessagesOf(error: unknown): string[] {
  if (typeof error !== 'object' || error === null) {
    return [FALLBACK_LOAD_FAILURE_MESSAGE];
  }
  const { message, details } = error as Partial<APIError>;
  const messages = [message, ...(details ?? [])]
    .map((text) => (typeof text === 'string' ? text.trim() : ''))
    .filter((text) => text.length > 0);
  const distinctMessages = [...new Set(messages)];
  return distinctMessages.length > 0
    ? distinctMessages
    : [FALLBACK_LOAD_FAILURE_MESSAGE];
}

function LoadingTransactions({ isStillLoading }: { isStillLoading: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <section
        aria-label="Loading transactions"
        aria-busy="true"
        className="flex flex-col gap-3 rounded-lg border bg-background p-4 dark:bg-card"
      >
        {SKELETON_BAR_WIDTHS.map((widthClassName, index) => (
          <Skeleton
            key={index}
            className={cn(
              'h-6 bg-muted motion-reduce:animate-none dark:bg-secondary/40',
              widthClassName,
            )}
          />
        ))}
      </section>
      <p role="status" className="text-sm text-muted-foreground">
        {isStillLoading ? STILL_LOADING_MESSAGE : ''}
      </p>
    </div>
  );
}

function TransactionsLoadFailed({
  messages,
  onRetry,
}: {
  messages: string[];
  onRetry: () => void;
}) {
  return (
    <Card role="alert" className="w-full max-w-xl">
      <CardHeader>
        <CardTitle className="text-xl">
          Transactions couldn&apos;t be loaded
        </CardTitle>
        {messages.map((message) => (
          <CardDescription key={message} className="text-base">
            {message}
          </CardDescription>
        ))}
      </CardHeader>
      <CardFooter>
        <Button
          type="button"
          onClick={onRetry}
          className="min-h-11 font-semibold hover:bg-primary-hover"
        >
          Retry
        </Button>
      </CardFooter>
    </Card>
  );
}

function NoTransactionsYet({ canUpload }: { canUpload: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border bg-background px-6 py-12 text-center dark:bg-card">
      <h2 className="text-xl">No transactions yet</h2>
      <p className="text-sm text-muted-foreground">
        Transactions appear here once a file has been uploaded.
      </p>
      {canUpload && (
        <Button
          asChild
          className="min-h-11 font-semibold hover:bg-primary-hover"
        >
          <Link href={UPLOAD_PATH}>Upload a file</Link>
        </Button>
      )}
    </div>
  );
}

function NoMatchingTransactions({
  chips,
  onClearAll,
}: {
  chips: ActiveFilterChip[];
  onClearAll: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border bg-background px-6 py-12 text-center dark:bg-card">
      <h2 className="text-xl">No transactions match these filters</h2>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <span className="text-sm text-muted-foreground">Active filters:</span>
        <ul
          aria-label="Active filters"
          className="flex flex-wrap justify-center gap-2"
        >
          {chips.map((chip) => (
            <li key={chip.filterName}>
              <Badge
                variant="outline"
                className="bg-card px-3 py-1 text-xs font-semibold tabular-nums"
              >
                {chip.text}
              </Badge>
            </li>
          ))}
        </ul>
      </div>
      <Button
        type="button"
        onClick={onClearAll}
        className="min-h-11 font-semibold hover:bg-primary-hover"
      >
        Clear all
      </Button>
    </div>
  );
}

const COLUMN_HEADER_CLASS_NAME = 'h-11 px-3';
const SORT_BUTTON_CLASS_NAME =
  'h-11 rounded-md px-0 text-xs font-semibold tracking-wide text-muted-foreground uppercase hover:bg-transparent hover:text-foreground';
const NUMERIC_CELL_CLASS_NAME = 'tabular-nums';

interface ColumnDefinition {
  column: SortColumn;
  title: string;
  isRightAligned?: boolean;
}

const COLUMNS: ColumnDefinition[] = [
  { column: 'reference', title: 'Reference' },
  { column: 'transactionDate', title: 'Date' },
  { column: 'accountNumber', title: 'Account number' },
  { column: 'description', title: 'Description' },
  { column: 'amount', title: 'Amount', isRightAligned: true },
  { column: 'transactionType', title: 'Type' },
  { column: 'currency', title: 'Currency' },
  { column: 'status', title: 'Status' },
  { column: 'daysPending', title: 'Days pending' },
];

const SORT_DIRECTION_MARKERS: Record<SortDirection, string> = {
  ascending: ' ▲',
  descending: ' ▼',
};

function TransactionTable({
  rows,
  sort,
  onSortChange,
}: {
  rows: TransactionRow[];
  sort: TransactionSort;
  onSortChange: (column: SortColumn) => void;
}) {
  return (
    <div className="rounded-lg border bg-background dark:bg-card">
      <Table aria-label="Transactions">
        <TableHeader className="bg-card dark:bg-secondary/30">
          <TableRow className="hover:bg-transparent">
            {COLUMNS.map(({ column, title, isRightAligned }) => {
              const isActive = sort.column === column;
              return (
                <TableHead
                  key={column}
                  aria-sort={isActive ? sort.direction : undefined}
                  className={cn(
                    COLUMN_HEADER_CLASS_NAME,
                    isRightAligned && 'text-right',
                  )}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onSortChange(column)}
                    className={SORT_BUTTON_CLASS_NAME}
                  >
                    {title}
                    {isActive && (
                      <span aria-hidden="true">
                        {SORT_DIRECTION_MARKERS[sort.direction]}
                      </span>
                    )}
                  </Button>
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className={cn('px-3', NUMERIC_CELL_CLASS_NAME)}>
                {row.reference}
              </TableCell>
              <TableCell className={cn('px-3', NUMERIC_CELL_CLASS_NAME)}>
                {row.transactionDate}
              </TableCell>
              <TableCell className={cn('px-3', NUMERIC_CELL_CLASS_NAME)}>
                {row.accountNumber}
              </TableCell>
              <TableCell className="px-3 whitespace-normal">
                {row.description}
              </TableCell>
              <TableCell
                className={cn('px-3 text-right', NUMERIC_CELL_CLASS_NAME)}
              >
                {row.amountText}
              </TableCell>
              <TableCell className="px-3">
                <TypeChip transactionType={row.transactionType} />
              </TableCell>
              <TableCell className="px-3">{row.currency}</TableCell>
              <TableCell className="px-3">
                <div className="flex flex-col items-start gap-1">
                  <StatusChip status={row.status} />
                  {row.rejectionReason && (
                    <span className="text-xs whitespace-normal text-muted-foreground">
                      Reason: {row.rejectionReason}
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell className={cn('px-3', NUMERIC_CELL_CLASS_NAME)}>
                {row.daysPendingText}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Read-only list of every transaction read in, with days pending derived from each
 * owning file's upload date. All shaping happens in the browser because the list
 * endpoint takes no query parameters.
 */
export function TransactionList() {
  const user = useSignedInUser();
  const [listLoad, setListLoad] = useState<ListLoad>({ status: 'loading' });
  const [isStillLoading, setIsStillLoading] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [filters, setFilters] = useState<TransactionFilters>(NO_FILTERS);
  const [sort, setSort] = useState<TransactionSort>(DEFAULT_SORT);
  const [requestedPageNumber, setRequestedPageNumber] = useState(FIRST_PAGE);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  useEffect(() => {
    let isCurrentLoad = true;
    const stillLoadingTimer = setTimeout(() => {
      if (isCurrentLoad) setIsStillLoading(true);
    }, STILL_LOADING_DELAY_MS);

    // File logs only feed days pending: if they fail, the list still loads and
    // pending rows show "—" rather than the whole page failing.
    const fileLogsOrNone = getFileLogs('Yes')
      .then((fileLogList) => fileLogList.FileLog ?? [])
      .catch(() => []);

    Promise.all([getTransactions(), fileLogsOrNone])
      .then(([transactionList, fileLogs]) => {
        if (!isCurrentLoad) return;
        setListLoad({
          status: 'loaded',
          rows: toTransactionRows(
            transactionList.Transactions ?? [],
            fileLogs,
            Date.now(),
          ),
        });
      })
      .catch((error: unknown) => {
        if (!isCurrentLoad) return;
        setListLoad({ status: 'failed', messages: failureMessagesOf(error) });
      })
      .finally(() => {
        clearTimeout(stillLoadingTimer);
        if (isCurrentLoad) setIsStillLoading(false);
      });

    return () => {
      isCurrentLoad = false;
      clearTimeout(stillLoadingTimer);
    };
  }, [loadAttempt]);

  function retryLoad() {
    setListLoad({ status: 'loading' });
    setIsStillLoading(false);
    setLoadAttempt((attempt) => attempt + 1);
  }

  const loadedRows = listLoad.status === 'loaded' ? listLoad.rows : null;
  const matchingRows = useMemo(
    () => (loadedRows ? filterRows(loadedRows, filters) : []),
    [loadedRows, filters],
  );
  const filteredRows = useMemo(
    () => sortRows(matchingRows, sort),
    [matchingRows, sort],
  );
  const currencyOptions = useMemo(
    () => (loadedRows ? currencyOptionsOf(loadedRows) : []),
    [loadedRows],
  );
  const currentPage = useMemo(
    () => slicePage(filteredRows, requestedPageNumber, pageSize),
    [filteredRows, requestedPageNumber, pageSize],
  );

  function changeFilter(filterName: keyof TransactionFilters, value: string) {
    setFilters((currentFilters) => ({
      ...currentFilters,
      [filterName]: value,
    }));
    setRequestedPageNumber(FIRST_PAGE);
  }

  function clearAllFilters() {
    setFilters(NO_FILTERS);
    setRequestedPageNumber(FIRST_PAGE);
  }

  function changeSort(column: SortColumn) {
    setSort((currentSort) => nextSort(currentSort, column));
    setRequestedPageNumber(FIRST_PAGE);
  }

  function changePageSize(nextPageSize: number) {
    setPageSize(nextPageSize);
    setRequestedPageNumber(FIRST_PAGE);
  }

  if (listLoad.status === 'loading') {
    return <LoadingTransactions isStillLoading={isStillLoading} />;
  }

  if (listLoad.status === 'failed') {
    return (
      <TransactionsLoadFailed
        messages={listLoad.messages}
        onRetry={retryLoad}
      />
    );
  }

  if (listLoad.rows.length === 0) {
    return (
      <NoTransactionsYet canUpload={hasRole(user, FILE_IMPORTER_ROLE_NAME)} />
    );
  }

  const totalCount = listLoad.rows.length;

  return (
    <div className="flex flex-col gap-4">
      <TransactionFilterCard
        filters={filters}
        currencyOptions={currencyOptions}
        onFilterChange={changeFilter}
        onClearAll={clearAllFilters}
      />
      <div className="flex flex-col gap-3">
        {filteredRows.length === 0 ? (
          <NoMatchingTransactions
            chips={activeFilterChips(filters)}
            onClearAll={clearAllFilters}
          />
        ) : (
          <TransactionTable
            rows={currentPage.items}
            sort={sort}
            onSortChange={changeSort}
          />
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground tabular-nums">
            Showing {filteredRows.length} of {totalCount} transactions
          </p>
          <ListPagination
            pageNumber={currentPage.pageNumber}
            pageCount={currentPage.pageCount}
            pageSize={pageSize}
            onPageChange={setRequestedPageNumber}
            onPageSizeChange={changePageSize}
          />
        </div>
      </div>
    </div>
  );
}

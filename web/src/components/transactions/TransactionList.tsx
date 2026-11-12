'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import {
  StatusChip,
  TypeChip,
} from '@/components/transactions/TransactionChips';
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
import {
  sortByDateDescending,
  toTransactionRows,
  type TransactionRow,
} from '@/lib/transactions/transaction-rows';
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

const COLUMN_HEADER_CLASS_NAME =
  'h-11 px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase';
const NUMERIC_CELL_CLASS_NAME = 'tabular-nums';

function TransactionTable({ rows }: { rows: TransactionRow[] }) {
  return (
    <div className="rounded-lg border bg-background dark:bg-card">
      <Table aria-label="Transactions">
        <TableHeader className="bg-card dark:bg-secondary/30">
          <TableRow className="hover:bg-transparent">
            <TableHead className={COLUMN_HEADER_CLASS_NAME}>
              Reference
            </TableHead>
            <TableHead
              className={COLUMN_HEADER_CLASS_NAME}
              aria-sort="descending"
            >
              Date
            </TableHead>
            <TableHead className={COLUMN_HEADER_CLASS_NAME}>
              Account number
            </TableHead>
            <TableHead className={COLUMN_HEADER_CLASS_NAME}>
              Description
            </TableHead>
            <TableHead className={cn(COLUMN_HEADER_CLASS_NAME, 'text-right')}>
              Amount
            </TableHead>
            <TableHead className={COLUMN_HEADER_CLASS_NAME}>Type</TableHead>
            <TableHead className={COLUMN_HEADER_CLASS_NAME}>Currency</TableHead>
            <TableHead className={COLUMN_HEADER_CLASS_NAME}>Status</TableHead>
            <TableHead className={COLUMN_HEADER_CLASS_NAME}>
              Days pending
            </TableHead>
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

  useEffect(() => {
    let isCurrentLoad = true;
    const stillLoadingTimer = setTimeout(() => {
      if (isCurrentLoad) setIsStillLoading(true);
    }, STILL_LOADING_DELAY_MS);

    Promise.all([getTransactions(), getFileLogs('Yes')])
      .then(([transactionList, fileLogList]) => {
        if (!isCurrentLoad) return;
        setListLoad({
          status: 'loaded',
          rows: toTransactionRows(
            transactionList.Transactions ?? [],
            fileLogList.FileLog ?? [],
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
  const sortedRows = useMemo(
    () => (loadedRows ? sortByDateDescending(loadedRows) : []),
    [loadedRows],
  );

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
    <div className="flex flex-col gap-3">
      <TransactionTable rows={sortedRows} />
      <p className="text-sm text-muted-foreground tabular-nums">
        Showing {sortedRows.length} of {totalCount} transactions
      </p>
    </div>
  );
}

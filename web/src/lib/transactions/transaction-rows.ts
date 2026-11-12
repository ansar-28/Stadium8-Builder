import type { FileLog, TransactionRead } from '@/types/api-generated';

export type TransactionStatus = 'Pending' | 'Approved' | 'Rejected';
export const CREDIT_TYPE = 'Credit';
export const DEBIT_TYPE = 'Debit';

/** One transaction shaped for the list: display text plus the raw values sorting and filtering need. */
export interface TransactionRow {
  id: string;
  reference: string;
  transactionDate: string;
  /** Milliseconds since the epoch, or NaN when the backend date can't be read. */
  transactionTimestamp: number;
  accountNumber: string;
  description: string;
  amount: number;
  amountText: string;
  /** Credit / Debit, or the backend's own value when it is neither. */
  transactionType: string;
  currency: string;
  status: TransactionStatus;
  rejectionReason: string;
  /** Whole days waiting while Pending; null when not Pending or the upload date is unknown. */
  daysPending: number | null;
  daysPendingText: string;
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const NOT_APPLICABLE_TEXT = '—';

// "YYYY-MM-DD HH:mm[:ss]" (also with "/" or "T" separators) — read as local wall-clock time.
const BACKEND_DATE_TIME_PATTERN =
  /^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/;

/** Backend timestamps carry no zone, so they are read as the user's local time. */
export function parseBackendDateTime(value: string | undefined): number {
  if (!value) return Number.NaN;
  const match = BACKEND_DATE_TIME_PATTERN.exec(value.trim());
  if (!match) return new Date(value).getTime();
  const [, year, month, day, hours = '0', minutes = '0', seconds = '0'] = match;
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
    Number(seconds),
  ).getTime();
}

/** "2026-04-15 08:12:00" → "2026-04-15 08:12"; anything unreadable is shown as received. */
export function formatTransactionDate(value: string | undefined): string {
  if (!value) return '';
  const match = BACKEND_DATE_TIME_PATTERN.exec(value.trim());
  if (!match) return value;
  const [, year, month, day, hours, minutes] = match;
  const datePart = `${year}-${month}-${day}`;
  return hours && minutes ? `${datePart} ${hours}:${minutes}` : datePart;
}

/** Two decimals with a space as thousands separator: 12345.35 → "12 345.35". */
export function formatAmount(amount: number | undefined): string {
  if (amount === undefined || !Number.isFinite(amount)) return '';
  const [wholePart, decimalPart] = Math.abs(amount).toFixed(2).split('.');
  const groupedWholePart = wholePart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const sign = amount < 0 ? '-' : '';
  return `${sign}${groupedWholePart}.${decimalPart}`;
}

/**
 * The backend marks an undecided transaction "Imported" (not "Pending"), so every
 * status other than Approved or Rejected is shown as Pending.
 */
export function toDisplayStatus(status: string | undefined): TransactionStatus {
  const normalisedStatus = status?.trim().toLowerCase();
  if (normalisedStatus === 'approved') return 'Approved';
  if (normalisedStatus === 'rejected') return 'Rejected';
  return 'Pending';
}

/** The list endpoint may return Credit / Debit or the import file's C / D. */
export function toDisplayType(transactionType: string | undefined): string {
  const normalisedType = transactionType?.trim().toLowerCase();
  if (normalisedType === 'credit' || normalisedType === 'c') {
    return CREDIT_TYPE;
  }
  if (normalisedType === 'debit' || normalisedType === 'd') return DEBIT_TYPE;
  return transactionType?.trim() ?? '';
}

export function formatDaysPending(daysPending: number | null): string {
  if (daysPending === null) return NOT_APPLICABLE_TEXT;
  return daysPending === 1 ? '1 day' : `${daysPending} days`;
}

/** Upload timestamps of the active files, keyed by file id, for the days-pending join. */
export function uploadTimestampsByFileId(
  fileLogs: readonly FileLog[],
): Map<number, number> {
  const uploadTimestamps = new Map<number, number>();
  for (const fileLog of fileLogs) {
    if (fileLog.Id === undefined) continue;
    const uploadTimestamp = parseBackendDateTime(fileLog.ProcessDate);
    if (Number.isFinite(uploadTimestamp)) {
      uploadTimestamps.set(fileLog.Id, uploadTimestamp);
    }
  }
  return uploadTimestamps;
}

function daysPendingFor(
  status: TransactionStatus,
  uploadTimestamp: number | undefined,
  nowTimestamp: number,
): number | null {
  if (status !== 'Pending' || uploadTimestamp === undefined) return null;
  const elapsedMilliseconds = Math.max(0, nowTimestamp - uploadTimestamp);
  return Math.floor(elapsedMilliseconds / MILLISECONDS_PER_DAY);
}

export function toTransactionRows(
  transactions: readonly TransactionRead[],
  fileLogs: readonly FileLog[],
  nowTimestamp: number = Date.now(),
): TransactionRow[] {
  const uploadTimestamps = uploadTimestampsByFileId(fileLogs);
  return transactions.map((transaction, index) => {
    const status = toDisplayStatus(transaction.Status);
    const uploadTimestamp =
      transaction.FileLogId === undefined
        ? undefined
        : uploadTimestamps.get(transaction.FileLogId);
    const daysPending = daysPendingFor(status, uploadTimestamp, nowTimestamp);
    return {
      id: String(transaction.Id ?? `row-${index}`),
      reference: transaction.Reference ?? '',
      transactionDate: formatTransactionDate(transaction.TransactionDate),
      transactionTimestamp: parseBackendDateTime(transaction.TransactionDate),
      accountNumber: transaction.AccountNumber ?? '',
      description: transaction.Description ?? '',
      amount: transaction.Amount ?? Number.NaN,
      amountText: formatAmount(transaction.Amount),
      transactionType: toDisplayType(transaction.TransactionType),
      currency: transaction.Currency ?? '',
      status,
      rejectionReason:
        status === 'Rejected' ? (transaction.UserNote?.trim() ?? '') : '',
      daysPending,
      daysPendingText: formatDaysPending(daysPending),
    };
  });
}

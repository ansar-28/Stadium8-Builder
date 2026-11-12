import type {
  TransactionRead,
  TransactionReadList,
} from '../../types/api-generated';

/**
 * Wire values for `TransactionRead.Status`. The spec's example for an
 * undecided transaction is "Imported" (the UI shows it as Pending); the
 * approve / reject endpoints set "Approved" / "Rejected".
 */
export const TRANSACTION_STATUS_IMPORTED = 'Imported';
export const TRANSACTION_STATUS_APPROVED = 'Approved';
export const TRANSACTION_STATUS_REJECTED = 'Rejected';

export const TRANSACTION_TYPE_CREDIT = 'Credit';
export const TRANSACTION_TYPE_DEBIT = 'Debit';

export function createTransaction(
  overrides: Partial<TransactionRead> = {},
): TransactionRead {
  return {
    Id: 1,
    FileLogId: 1,
    FileName: 'transactions_2026-04-15.csv',
    Reference: 'TXN-00001',
    TransactionDate: '2026-04-15 08:12:00',
    AccountNumber: '1001-2034-5567',
    Description: 'Payment for invoice 1234',
    Amount: 1500.5,
    TransactionType: TRANSACTION_TYPE_DEBIT,
    Currency: 'ZAR',
    Status: TRANSACTION_STATUS_IMPORTED,
    UserNote: '',
    LastChangedUser: 'system',
    LastChangedDate: '2026-04-15 08:15:00',
    ...overrides,
  };
}

export function createTransactionList(
  transactions: TransactionRead[] = createSampleTransactions(),
): TransactionReadList {
  return { Transactions: transactions };
}

/**
 * Small canonical set covering every status, both types and three currencies,
 * across two uploaded files (FileLogId 1 and 2) so filters and days pending
 * have something to discriminate on.
 */
export function createSampleTransactions(): TransactionRead[] {
  return [
    createTransaction(),
    createTransaction({
      Id: 2,
      Reference: 'TXN-00002',
      TransactionDate: '2026-04-15 09:40:00',
      AccountNumber: '2002-3345-1100',
      Description: 'Salary deposit',
      Amount: 12345.35,
      TransactionType: TRANSACTION_TYPE_CREDIT,
      Currency: 'USD',
    }),
    createTransaction({
      Id: 3,
      Reference: 'TXN-00003',
      TransactionDate: '2026-04-14 14:05:00',
      AccountNumber: '3003-4456-2211',
      Description: 'Supplier refund',
      Amount: 250,
      TransactionType: TRANSACTION_TYPE_CREDIT,
      Currency: 'EUR',
      Status: TRANSACTION_STATUS_APPROVED,
      LastChangedUser: 'Bob Naidoo',
    }),
    createTransaction({
      Id: 4,
      FileLogId: 2,
      FileName: 'transactions_2026-04-10.csv',
      Reference: 'TXN-00004',
      TransactionDate: '2026-04-10 11:20:00',
      AccountNumber: '1001-2034-9988',
      Description: 'Office rent April',
      Amount: 8900,
      TransactionType: TRANSACTION_TYPE_DEBIT,
      Currency: 'ZAR',
      Status: TRANSACTION_STATUS_REJECTED,
      UserNote: 'Amount does not match supporting document',
      LastChangedUser: 'Bob Naidoo',
    }),
    createTransaction({
      Id: 5,
      FileLogId: 2,
      FileName: 'transactions_2026-04-10.csv',
      Reference: 'TXN-00005',
      TransactionDate: '2026-04-10 16:45:00',
      AccountNumber: '4004-5567-3322',
      Description: 'Card settlement',
      Amount: 75.99,
      TransactionType: TRANSACTION_TYPE_DEBIT,
      Currency: 'USD',
    }),
  ];
}

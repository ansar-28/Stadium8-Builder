import type { FileLog, FileLogList } from '../../types/api-generated';

/**
 * Uploaded-file entries returned by `GET /v1/file-logs`
 * (Transaction-Management-API-Definition.yaml, `FileLog` / `FileLogList`).
 *
 * The spec does not document which `CurrentStatus` values mean "uploaded
 * successfully"; `Completed` is an assumed canonical value until confirmed.
 */

export const TRANSACTION_FILE_SETTING_ID = 1;
export const TRANSACTION_FILE_SETTING_NAME = 'Transaction Import';

export function createFileLog(overrides: Partial<FileLog> = {}): FileLog {
  return {
    Id: 1,
    ProcessDate: '2026-04-15T08:30:00',
    SettingId: TRANSACTION_FILE_SETTING_ID,
    SettingName: TRANSACTION_FILE_SETTING_NAME,
    ProcessInstanceId: 'process-instance-0001',
    CurrentFolder: 'Incoming',
    CurrentFileName: 'transactions_2026-04-15.csv',
    FileHash: 'a3f5c9e1b7d2468f0c1e2d3b4a5f6e7d',
    RecordCount: '4',
    Direction: 'Inbound',
    CurrentStatus: 'Completed',
    LastExecutedActivityName: 'Import transactions',
    ProcessDefinitionId: 'transaction-import:1',
    ProcessName: 'Transaction Import',
    IsActive: true,
    BulkErrorFile: '',
    HasBulkErrorFile: 'No',
    ...overrides,
  };
}

/**
 * Canonical list of three uploaded files, newest first (BR4).
 * Pass `entries` to supply a custom list (e.g. `[]` for the empty state).
 */
export function createFileLogList(entries?: FileLog[]): FileLogList {
  return {
    FileLog: entries ?? [
      createFileLog({
        Id: 3,
        ProcessDate: '2026-04-15T08:30:00',
        CurrentFileName: 'transactions_2026-04-15.csv',
        RecordCount: '4',
      }),
      createFileLog({
        Id: 2,
        ProcessDate: '2026-04-14T16:05:00',
        CurrentFileName: 'transactions_2026-04-14.csv',
        RecordCount: '12',
      }),
      createFileLog({
        Id: 1,
        ProcessDate: '2026-04-13T09:45:00',
        CurrentFileName: 'transactions_2026-04-13.csv',
        RecordCount: '7',
      }),
    ],
  };
}

/** `count` uploaded files, newest first — for pagination scenarios. */
export function createManyFileLogs(count: number): FileLog[] {
  const newestTimestamp = Date.parse('2026-04-30T12:00:00Z');
  const oneHourInMilliseconds = 60 * 60 * 1000;
  return Array.from({ length: count }, (_, index) => {
    const fileNumber = count - index;
    const processDate = new Date(
      newestTimestamp - index * oneHourInMilliseconds,
    )
      .toISOString()
      .slice(0, 19);
    return createFileLog({
      Id: fileNumber,
      ProcessDate: processDate,
      CurrentFileName: `transactions_batch-${String(fileNumber).padStart(3, '0')}.csv`,
    });
  });
}

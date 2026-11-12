import {
  TRANSACTION_FILE_SETTING_ID,
  TRANSACTION_FILE_SETTING_NAME,
} from '../../lib/files/transaction-file-setting';
import type { FileLog, FileLogList } from '../../types/api-generated';

export { TRANSACTION_FILE_SETTING_ID, TRANSACTION_FILE_SETTING_NAME };

/**
 * Uploaded-file entries returned by `GET /v1/file-logs`
 * (Transaction-Management-API-Definition.yaml, `FileLog` / `FileLogList`).
 *
 * Defaults mirror the live backend: it renames uploaded files to
 * `<yyyymmdd>_Transactions[_n].csv`, writes `ProcessDate` as
 * `YYYY-MM-DD HH:mm:ss`, and an active import stops at `FixData` with
 * `CurrentStatus` `Suspended`.
 */

export function createFileLog(overrides: Partial<FileLog> = {}): FileLog {
  return {
    Id: 1,
    ProcessDate: '2026-11-12 13:19:29',
    SettingId: TRANSACTION_FILE_SETTING_ID,
    SettingName: TRANSACTION_FILE_SETTING_NAME,
    ProcessInstanceId: 'process-instance-0001',
    CurrentFolder: 'Incoming',
    CurrentFileName: '20261112_Transactions.csv',
    FileHash: 'a3f5c9e1b7d2468f0c1e2d3b4a5f6e7d',
    RecordCount: '21',
    Direction: 'In',
    CurrentStatus: 'Suspended',
    LastExecutedActivityName: 'FixData',
    ProcessDefinitionId: 'file-import:1',
    ProcessName: 'FileImport',
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
        ProcessDate: '2026-11-12 13:19:29',
        CurrentFileName: '20261112_Transactions.csv',
        RecordCount: '21',
      }),
      createFileLog({
        Id: 2,
        ProcessDate: '2026-11-11 16:05:12',
        CurrentFileName: '20261111_Transactions.csv',
        RecordCount: '12',
      }),
      createFileLog({
        Id: 1,
        ProcessDate: '2026-11-10 09:45:03',
        CurrentFileName: '20261110_Transactions.csv',
        RecordCount: '7',
      }),
    ],
  };
}

/**
 * `count` uploaded files, newest first — for pagination scenarios. Repeat
 * uploads on one day get the backend's `_n` suffix.
 */
export function createManyFileLogs(count: number): FileLog[] {
  const newestTimestamp = Date.parse('2026-11-12T23:00:00Z');
  const oneMinuteInMilliseconds = 60 * 1000;
  return Array.from({ length: count }, (_, index) => {
    const fileNumber = count - index;
    const processDate = new Date(
      newestTimestamp - index * oneMinuteInMilliseconds,
    )
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ');
    return createFileLog({
      Id: fileNumber,
      ProcessDate: processDate,
      CurrentFileName: `20261112_Transactions_${fileNumber}.csv`,
    });
  });
}

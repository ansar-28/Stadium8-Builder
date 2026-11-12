import type { FileLog, FileLogList } from '../../types/api-generated';

/**
 * `FileLog` from `GET /v1/file-logs?IsActive=Yes`. `ProcessDate` is treated as
 * the upload date (used for days pending); its wire format follows the spec's
 * other timestamps ("YYYY-MM-DD HH:mm:ss").
 */
export function createFileLog(overrides: Partial<FileLog> = {}): FileLog {
  return {
    Id: 1,
    ProcessDate: '2026-04-15 08:15:00',
    SettingId: 1,
    SettingName: 'Transaction Import',
    ProcessInstanceId: 'proc-0001',
    CurrentFolder: 'processed',
    CurrentFileName: 'transactions_2026-04-15.csv',
    FileHash: 'a3f5c9e1b7d2',
    RecordCount: '3',
    Direction: 'Inbound',
    CurrentStatus: 'Completed',
    LastExecutedActivityName: 'Load',
    ProcessDefinitionId: 'transaction-import:1',
    ProcessName: 'Transaction Import',
    IsActive: true,
    BulkErrorFile: '',
    HasBulkErrorFile: 'No',
    ...overrides,
  };
}

export function createFileLogList(
  fileLogs: FileLog[] = createSampleFileLogs(),
): FileLogList {
  return { FileLog: fileLogs };
}

/** Two uploaded files matching the FileLogIds used by `createSampleTransactions`. */
export function createSampleFileLogs(): FileLog[] {
  return [
    createFileLog(),
    createFileLog({
      Id: 2,
      ProcessDate: '2026-04-10 11:30:00',
      ProcessInstanceId: 'proc-0002',
      CurrentFileName: 'transactions_2026-04-10.csv',
      FileHash: 'b8e2d4f6a1c3',
      RecordCount: '2',
    }),
  ];
}

/**
 * The backend file setting that identifies transaction files. Every upload sends
 * it; the user never chooses it. The values are assumed until the backend team
 * confirms which configured setting (from `GET /v1/file-settings`) is the right one.
 */
export const TRANSACTION_FILE_SETTING_ID = 1;
export const TRANSACTION_FILE_SETTING_NAME = 'Transaction Import';

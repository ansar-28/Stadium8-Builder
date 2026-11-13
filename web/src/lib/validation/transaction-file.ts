export const TRANSACTION_FILE_HEADER =
  'Reference,TransactionDate,AccountNumber,Description,Amount,TransactionType,Currency';

export const TRANSACTION_FILE_LAYOUT_MESSAGE =
  'The file could not be uploaded. Only the seven-column .csv layout is accepted.';

// The header row is far shorter than this, so only the start of a large file is read.
const HEADER_READ_LIMIT_IN_BYTES = 64 * 1024;
const BYTE_ORDER_MARK = '﻿';

function hasCsvExtension(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.csv');
}

function readAsText(content: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error);
    reader.readAsText(content);
  });
}

async function readHeaderRow(file: Blob): Promise<string> {
  const fileStart = await readAsText(file.slice(0, HEADER_READ_LIMIT_IN_BYTES));
  const [firstLine = ''] = fileStart.split('\n');
  const headerRow = firstLine.replace(/\r$/, '');
  return headerRow.startsWith(BYTE_ORDER_MARK)
    ? headerRow.slice(BYTE_ORDER_MARK.length)
    : headerRow;
}

/** True when the file is a .csv whose header row is exactly the seven-column layout. */
export async function isSevenColumnTransactionFile(
  file: File,
): Promise<boolean> {
  if (!hasCsvExtension(file.name)) return false;
  return (await readHeaderRow(file)) === TRANSACTION_FILE_HEADER;
}

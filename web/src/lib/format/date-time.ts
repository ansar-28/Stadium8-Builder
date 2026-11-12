const SERVER_DATE_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/;

/**
 * Shows a server date-time as `YYYY-MM-DD HH:mm`, exactly as the server wrote it
 * (no time-zone shift). Values in any other shape are shown unchanged.
 */
export function formatDateTime(serverDateTime: string): string {
  const match = SERVER_DATE_TIME_PATTERN.exec(serverDateTime.trim());
  if (!match) return serverDateTime;
  const [, datePart, timePart] = match;
  return `${datePart} ${timePart}`;
}

/** Sort key for a server date-time; unreadable values sort as the oldest. */
export function dateTimeSortValue(serverDateTime: string): number {
  const timestamp = Date.parse(serverDateTime);
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
}

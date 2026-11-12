import type { APIError } from '@/types/api';

const FALLBACK_MESSAGE =
  'Something went wrong on our side. Try again in a few minutes.';

function isAPIError(error: unknown): error is APIError {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as APIError).message === 'string'
  );
}

/**
 * The server's own wording for a failed call (`DefaultResponse.Messages`, carried
 * on the API client's error as `details`), joined into one sentence block.
 */
export function serverMessageOf(error: unknown): string {
  if (!isAPIError(error)) return FALLBACK_MESSAGE;
  const serverMessages = (error.details ?? [])
    .map((message) => message.trim())
    .filter((message) => message.length > 0);
  if (serverMessages.length > 0) return serverMessages.join(' ');
  return error.message.trim() || FALLBACK_MESSAGE;
}

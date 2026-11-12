import type { DefaultResponse } from '../../types/api-generated';

/**
 * `DefaultResponse` envelope returned by login / logout success and 500s
 * (Authentication-API-Definition.yaml).
 */
export function createDefaultResponse(
  overrides: Partial<DefaultResponse> = {},
): DefaultResponse {
  return {
    Id: 0,
    MessageType: 'Success',
    Messages: ['Request completed successfully.'],
    ...overrides,
  };
}

/**
 * Mock identities for form-fill only. Auth is always mocked in Playwright specs,
 * so these are never real accounts and never reach a live backend.
 */
export interface MockCredentials {
  username: string;
  password: string;
}

export const fileImporterUser: MockCredentials = {
  username: 'carol',
  password: 'mock-password-not-real',
};

export const approverUser: MockCredentials = {
  username: 'bob',
  password: 'mock-password-not-real',
};

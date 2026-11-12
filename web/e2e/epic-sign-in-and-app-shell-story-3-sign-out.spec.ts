/**
 * Story Metadata:
 * - Route: /transactions
 * - Target File: web/src/components/layout/SignOutButton.tsx
 *
 * Mocking strategy:
 * - Backend calls are ALWAYS mocked — a Playwright spec never contacts a live
 *   backend (see testing-policy.md § "Playwright runs against mocks, never live").
 *   Intercept via: page.route()
 *   - POST **\/v1/auth/login    → 200 DefaultResponse + a fake `session` cookie
 *   - GET  **\/v1/auth/userinfo → 200 userInfoFor('File Importer') while signed in,
 *                                401 once signed out
 *   - POST **\/v1/auth/logout   → 200 DefaultResponse + the `session` cookie cleared
 * - Implementation pattern this assumes:
 *   - Login, userinfo and logout are requested from the browser at same-origin
 *     /v1/auth/* paths (client-component calls through `@/lib/api/client`, routed
 *     to the auth service by the Next.js proxy), because page.route() cannot
 *     intercept Node-side fetches made by Server Actions or server components.
 *   - The server-side (app) layout gate redirects on a missing `session` cookie
 *     without itself calling the backend; session liveness (userinfo) is checked
 *     from the browser, so a 401 there sends the user to /sign-in.
 *   - The logout response clears the `session` cookie; protected pages are not
 *     served from the browser cache after sign-out (no-store / session re-check),
 *     so Back re-runs the gate and lands on /sign-in.
 * - If the implementation diverges from these assumptions, this spec will not pass.
 *
 * E2E spec for Epic sign-in-and-app-shell, Story 3: Sign out.
 * These tests WILL FAIL until implemented (TDD red).
 */
import { test, expect } from '@playwright/test';
// Shared identity source — relative import, not @/.
import {
  FILE_IMPORTER_ROLE_NAME,
  userInfoFor,
} from '../src/mocks/data/identity';

import type { Page } from '@playwright/test';

// Mock form-fill values — the backend is mocked, so these are never real credentials.
const MOCK_USERNAME = 'carol.mokoena';
const MOCK_PASSWORD = 'mock-password-not-real';

const SESSION_COOKIE_NAME = 'session';

/**
 * Mock the auth chain at the browser boundary. Login mints a fake session cookie,
 * userinfo answers for the File Importer persona until logout, and logout clears
 * the cookie so every later session check fails.
 */
async function mockAuthChain(page: Page): Promise<void> {
  let isSignedIn = false;

  await page.route('**/v1/auth/login', async (route) => {
    isSignedIn = true;
    await page.context().addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: 'mock-session-token',
        url: new URL(route.request().url()).origin,
        httpOnly: true,
        sameSite: 'Strict',
      },
    ]);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        Id: 0,
        MessageType: 'Success',
        Messages: ['Login successful'],
      }),
    });
  });

  await page.route('**/v1/auth/userinfo', (route) =>
    isSignedIn
      ? route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(userInfoFor(FILE_IMPORTER_ROLE_NAME)),
        })
      : route.fulfill({ status: 401 }),
  );

  await page.route('**/v1/auth/logout', async (route) => {
    isSignedIn = false;
    await page.context().clearCookies({ name: SESSION_COOKIE_NAME });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'set-cookie': `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
      },
      body: JSON.stringify({
        Id: 0,
        MessageType: 'Success',
        Messages: ['Logout successful'],
      }),
    });
  });
}

async function signInThroughForm(page: Page): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Username', { exact: true }).fill(MOCK_USERNAME);
  await page.getByLabel('Password', { exact: true }).fill(MOCK_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/transactions$/);
  await expect(
    page.getByRole('button', { name: 'Sign out', exact: true }),
  ).toBeVisible();
}

test.describe('Epic sign-in-and-app-shell, Story 3: Sign out', () => {
  test.beforeEach(async ({ context, page }) => {
    await context.clearCookies();
    await mockAuthChain(page);
  });

  // AC-2
  test('completing sign-out lands on Sign in with both fields empty', async ({
    page,
  }) => {
    await signInThroughForm(page);

    await page.getByRole('button', { name: 'Sign out', exact: true }).click();

    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByLabel('Username', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  });

  // AC-3
  test('pressing Back after signing out returns to Sign in, not the app', async ({
    page,
  }) => {
    await signInThroughForm(page);

    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in/);

    await page.goBack();

    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByLabel('Username', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Sign out', exact: true }),
    ).toBeHidden();
  });
});

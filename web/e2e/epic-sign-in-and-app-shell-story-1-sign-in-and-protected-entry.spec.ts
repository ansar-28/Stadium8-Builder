/**
 * Story Metadata:
 * - Route: /sign-in
 * - Target File: web/src/app/(app)/layout.tsx
 *
 * Mocking strategy:
 * - Backend calls are ALWAYS mocked — this spec never contacts a live backend
 *   (see testing-policy.md § "Playwright runs against mocks, never live").
 *   Intercept via: page.route()
 * - Implementation pattern this assumes:
 *   - The sign-in form calls POST /v1/auth/login from the browser (client
 *     component → @/lib/api/client → same-origin Next.js proxy), because
 *     page.route() cannot intercept Server Actions or server-side fetches.
 *   - The protected (app) layout checks the session by calling
 *     GET /v1/auth/userinfo from the browser, showing a loading placeholder
 *     (role="status", accessible name containing "Loading") until it resolves,
 *     and redirecting to /sign-in when it fails (401). Any server-side guard
 *     (e.g. a Next.js proxy/middleware) may only inspect cookie presence — it
 *     must not call the backend from Node, which page.route() cannot mock.
 *   - The login response sets an HttpOnly `session` cookie via Set-Cookie;
 *     the frontend never reads the token.
 *   - "/" redirects into the protected area (→ /transactions), so a signed-out
 *     visitor ends on /sign-in rather than a welcome page.
 * - If the implementation diverges from these assumptions, this spec will not pass.
 *
 * Controls (shared with the Vitest file):
 * - text input labelled "Username"; password input labelled "Password" (exact);
 *   button "Show password"; button "Sign in"; inline errors as role="alert".
 *
 * E2E spec for Epic sign-in-and-app-shell, Story 1: Sign in and protected entry.
 * These tests WILL FAIL until implemented (TDD red).
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { fileImporterUser } from './fixtures/credentials';
import { userInfoFor } from '../src/mocks/data/identity';
import { createDefaultResponse } from '../src/mocks/data/default-response';

import type { Page } from '@playwright/test';

const WCAG_22_AA_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
];

interface AuthMockControls {
  /** Lets a held userinfo response through (only when `holdUserInfo` is set). */
  releaseUserInfo: () => void;
}

/**
 * Mocks the auth chain at the browser boundary. Before a successful login,
 * userinfo answers 401 (signed out); after login it answers 200 with the role's
 * userinfo from the shared identity source — optionally held until released so
 * the loading placeholder can be observed.
 */
async function mockAuthChain(
  page: Page,
  roleName: string,
  options: { holdUserInfo?: boolean } = {},
): Promise<AuthMockControls> {
  let signedIn = false;
  let releaseUserInfo: () => void = () => undefined;
  const userInfoReleased = options.holdUserInfo
    ? new Promise<void>((resolve) => {
        releaseUserInfo = resolve;
      })
    : Promise.resolve();

  await page.route('**/v1/auth/login', async (route) => {
    signedIn = true;
    await route.fulfill({
      status: 200,
      headers: {
        'set-cookie':
          'session=mock-session-token; Path=/; HttpOnly; SameSite=Strict',
      },
      contentType: 'application/json',
      body: JSON.stringify(
        createDefaultResponse({ Messages: ['Login successful'] }),
      ),
    });
  });

  await page.route('**/v1/auth/userinfo', async (route) => {
    if (!signedIn) {
      await route.fulfill({ status: 401 });
      return;
    }
    await userInfoReleased;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(userInfoFor(roleName)),
    });
  });

  return { releaseUserInfo };
}

/** Signed out / expired session: every userinfo check is rejected. */
async function mockRejectedSession(page: Page): Promise<void> {
  await page.route('**/v1/auth/userinfo', (route) =>
    route.fulfill({ status: 401 }),
  );
}

async function waitForSignInScreen(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(
    page.getByRole('button', { name: 'Sign in', exact: true }),
  ).toBeVisible();
}

test.describe('Epic sign-in-and-app-shell, Story 1: Sign in and protected entry', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-3
  test('valid credentials open Transactions inside the app, showing a loading placeholder first', async ({
    page,
  }) => {
    const { releaseUserInfo } = await mockAuthChain(page, 'File Importer', {
      holdUserInfo: true,
    });

    await page.goto('/sign-in');
    await waitForSignInScreen(page);

    await page
      .getByLabel('Username', { exact: true })
      .fill(fileImporterUser.username);
    await page
      .getByLabel('Password', { exact: true })
      .fill(fileImporterUser.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    await expect(page).toHaveURL(/\/transactions/);
    const loadingPlaceholder = page.getByRole('status', { name: /loading/i });
    await expect(loadingPlaceholder).toBeVisible();

    releaseUserInfo();

    await expect(
      page.getByRole('heading', { name: 'Transactions', level: 1 }),
    ).toBeVisible();
    await expect(loadingPlaceholder).toBeHidden();
  });

  // AC-4
  test('signed-out and expired-session visitors opening protected addresses land on Sign in, not a welcome page', async ({
    page,
    context,
  }) => {
    await mockRejectedSession(page);

    // The app's front page, signed out.
    await page.goto('/');
    await waitForSignInScreen(page);
    await expect(page.getByRole('heading', { name: 'Welcome' })).toHaveCount(0);

    // A protected screen's address typed directly, signed out.
    await page.goto('/transactions');
    await waitForSignInScreen(page);

    // A protected screen with an expired session cookie (userinfo rejects it).
    await context.addCookies([
      { name: 'session', value: 'expired-mock-session-token', url: page.url() },
    ]);
    await page.goto('/transactions');
    await waitForSignInScreen(page);
    await expect(
      page.getByRole('heading', { name: 'Transactions', level: 1 }),
    ).toHaveCount(0);
  });

  // AC-5
  test('the Sign in screen can be completed by keyboard alone and passes an accessibility scan', async ({
    page,
  }) => {
    await mockAuthChain(page, 'File Importer');

    await page.goto('/sign-in');
    await waitForSignInScreen(page);

    // Default state scan.
    const defaultScan = await new AxeBuilder({ page })
      .withTags(WCAG_22_AA_TAGS)
      .analyze();
    expect(defaultScan.violations).toEqual([]);

    // Error state scan (blank submit).
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText(
      'Username and password are required.',
    );
    const errorScan = await new AxeBuilder({ page })
      .withTags(WCAG_22_AA_TAGS)
      .analyze();
    expect(errorScan.violations).toEqual([]);

    // Keyboard-only completion from a fresh screen.
    await page.reload();
    await waitForSignInScreen(page);

    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Username', { exact: true })).toBeFocused();
    await page.keyboard.type(fileImporterUser.username);

    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
    await page.keyboard.type(fileImporterUser.password);

    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('button', { name: /show password/i }),
    ).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('button', { name: 'Sign in', exact: true }),
    ).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/transactions/);
    await expect(
      page.getByRole('heading', { name: 'Transactions', level: 1 }),
    ).toBeVisible();
  });
});

/**
 * Story Metadata:
 * - Route: /transactions
 * - Target File: web/src/components/layout/SessionTimeout.tsx
 *
 * Mocking strategy:
 * - Backend calls are ALWAYS mocked — a Playwright spec never contacts a live
 *   backend (see testing-policy.md § "Playwright runs against mocks, never live").
 *   Intercept via: page.route()
 *   - `**\/v1/auth/login`    → 200 + a fake HttpOnly `session` cookie
 *   - `**\/v1/auth/userinfo` → 200 with `userInfoFor(role)` while the mock session is
 *     live, 401 once the logout endpoint has been called
 *   - `**\/v1/auth/logout`   → 200 and clears the `session` cookie
 * - Implementation pattern this assumes:
 *   - sign-in, the session check (userinfo) and sign-out are called from the browser
 *     through the same-origin proxy (client-component fetch via the API client), so
 *     page.route() can intercept them; a server-side userinfo call would bypass the mocks
 *   - the idle and 8-hour timers run in the browser off `Date.now()` / `setTimeout` /
 *     `setInterval`, so `page.clock` drives them with the REAL durations
 *     (14 min to warning, +60 s to sign-out, 8 h absolute) — no test-only duration hooks
 *   - activity = mouse movement / key presses anywhere on the page
 *   - the warning is a Shadcn dialog (role "dialog") with buttons "Stay signed in" and
 *     "Sign out"; timeout sign-out calls the logout endpoint and lands on /sign-in
 *   - sign-in time is recorded client-side when sign-in succeeds (never the token)
 * - If the implementation diverges from these assumptions, this spec will not pass.
 *
 * E2E spec for Epic sign-in-and-app-shell, Story 4: Idle and 8-hour session timeouts.
 * These tests WILL FAIL until implemented (TDD red).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import {
  FILE_IMPORTER_ROLE_NAME,
  userInfoFor,
} from '../src/mocks/data/identity';

import type { Page } from '@playwright/test';

// Mock identity for form-fill only — the login endpoint is mocked, so this is never a real account.
const MOCK_USERNAME = 'carol.mokoena';
const MOCK_PASSWORD = 'mock-password-not-real';

const WCAG_22_AA_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
];

/**
 * Mock the auth chain at the browser boundary. The mock session stays live until the
 * logout endpoint is called; after that userinfo answers 401, so a signed-out user
 * cannot get back into the app.
 */
async function mockAuthChain(page: Page, roleName: string): Promise<void> {
  const mockSession = { isLive: false };

  await page.route('**/v1/auth/login', async (route) => {
    mockSession.isLive = true;
    await route.fulfill({
      status: 200,
      headers: {
        'set-cookie': 'session=mock-token; Path=/; HttpOnly; SameSite=Strict',
      },
    });
  });

  await page.route('**/v1/auth/userinfo', async (route) => {
    if (!mockSession.isLive) {
      await route.fulfill({ status: 401 });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(userInfoFor(roleName)),
    });
  });

  await page.route('**/v1/auth/logout', async (route) => {
    mockSession.isLive = false;
    await route.fulfill({
      status: 200,
      headers: {
        'set-cookie': 'session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
      },
    });
  });
}

async function signInAndOpenTransactions(page: Page): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Username', { exact: true }).fill(MOCK_USERNAME);
  await page.getByLabel('Password', { exact: true }).fill(MOCK_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/transactions$/);
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}

/** Real user activity: move the pointer and press a harmless key. */
async function performActivity(page: Page, step: number): Promise<void> {
  await page.mouse.move(200 + (step % 2) * 40, 300);
  await page.keyboard.press('Shift');
}

function timeoutWarning(page: Page) {
  return page.getByRole('dialog');
}

test.describe('Epic sign-in-and-app-shell, Story 4: Idle and 8-hour session timeouts', () => {
  test.beforeEach(async ({ context, page }) => {
    await context.clearCookies();
    await page.clock.install();
    await mockAuthChain(page, FILE_IMPORTER_ROLE_NAME);
    await signInAndOpenTransactions(page);
  });

  // AC-1
  test('the warning appears after 14 idle minutes, and activity before then postpones it', async ({
    page,
  }) => {
    await page.clock.fastForward('13:00');
    await expect(timeoutWarning(page)).toBeHidden();

    await performActivity(page, 1);

    // 14:30 since sign-in but only 1:30 since the last activity — no warning yet.
    await page.clock.fastForward('01:30');
    await expect(timeoutWarning(page)).toBeHidden();

    // Now 14:01 since the last activity.
    await page.clock.fastForward('12:31');
    const warning = timeoutWarning(page);
    await expect(warning).toBeVisible();
    await expect(
      warning.getByRole('button', { name: 'Stay signed in' }),
    ).toBeVisible();
    await expect(
      warning.getByRole('button', { name: 'Sign out' }),
    ).toBeVisible();

    // Open-warning state accessibility scan (NFR-base-1: WCAG 2.2 AA).
    const { violations } = await new AxeBuilder({ page })
      .withTags(WCAG_22_AA_TAGS)
      .analyze();
    expect(violations).toEqual([]);
  });

  // AC-2
  test('choosing "Stay signed in" closes the warning and keeps the user on their screen', async ({
    page,
  }) => {
    await page.clock.fastForward('14:01');
    const warning = timeoutWarning(page);
    await expect(warning).toBeVisible();

    await warning.getByRole('button', { name: 'Stay signed in' }).click();

    await expect(warning).toBeHidden();
    await expect(page).toHaveURL(/\/transactions$/);

    // The idle timer was reset: the original 60-second deadline passes without sign-out.
    await page.clock.fastForward('01:05');
    await expect(page).toHaveURL(/\/transactions$/);
    await expect(timeoutWarning(page)).toBeHidden();
  });

  // AC-3
  test('with no response within 60 seconds of the warning, the user is signed out to Sign in', async ({
    page,
  }) => {
    await page.clock.fastForward('14:01');
    await expect(timeoutWarning(page)).toBeVisible();

    await page.clock.fastForward('01:00');

    await expect(page).toHaveURL(/\/sign-in/);
    await expect(
      page.getByRole('button', { name: 'Sign in', exact: true }),
    ).toBeVisible();

    // The session really ended: the app is not reachable again without signing in.
    await page.goto('/transactions');
    await expect(page).toHaveURL(/\/sign-in/);
  });

  // AC-4
  test('eight hours after sign-in the user is signed out to Sign in, even while active', async ({
    page,
  }) => {
    // Stay active every 10 minutes for 7 h 50 min — the idle warning never appears.
    for (let step = 0; step < 47; step += 1) {
      await page.clock.fastForward('10:00');
      await performActivity(page, step);
    }
    await expect(page).toHaveURL(/\/transactions$/);
    await expect(timeoutWarning(page)).toBeHidden();

    // Cross the 8-hour mark while still active.
    await page.clock.fastForward('10:30');
    await performActivity(page, 47);

    await expect(page).toHaveURL(/\/sign-in/);
    await expect(
      page.getByRole('button', { name: 'Sign in', exact: true }),
    ).toBeVisible();

    await page.goto('/transactions');
    await expect(page).toHaveURL(/\/sign-in/);
  });
});

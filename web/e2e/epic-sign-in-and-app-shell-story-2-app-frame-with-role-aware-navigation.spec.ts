/**
 * Story Metadata:
 * - Route: /transactions
 * - Target File: web/src/components/layout/AppHeader.tsx
 *
 * Mocking strategy:
 * - Backend calls are ALWAYS mocked — this spec never contacts a live backend
 *   (see testing-policy.md § "Playwright runs against mocks, never live").
 *   Intercept via: page.route()
 * - Implementation pattern this assumes:
 *   - The (app) layout's per-load session check requests the userinfo endpoint from the
 *     browser (a client-component call through the API client to the same-origin proxy
 *     path ending in /v1/auth/userinfo), because page.route() cannot intercept a
 *     server-side fetch. The userinfo body comes from the shared identity source.
 *   - The signed-in state is a `session` cookie (mock value, added to the browser
 *     context before navigating); the frontend never reads its value.
 *   - The placeholder Transactions / Files / Upload / Export pages make no other
 *     backend calls.
 * - If the implementation diverges from these assumptions, this spec will not pass.
 *
 * Controls (same in the Vitest file): navigation landmark "Main" with links
 * Transactions / Files / Upload / Export (active link carries aria-current="page");
 * theme switch role "switch" named "Dark mode" (checked = dark).
 *
 * E2E spec for Epic sign-in-and-app-shell, Story 2: App frame with role-aware navigation.
 * These tests WILL FAIL until implemented (TDD red).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import {
  FILE_IMPORTER_ROLE_NAME,
  userInfoFor,
} from '../src/mocks/data/identity';

import type { BrowserContext, Locator, Page } from '@playwright/test';

const WCAG_22_AA_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
];
const MAX_TAB_PRESSES = 30;

/**
 * Start a signed-in session for a role: a mock session cookie plus a mocked userinfo
 * response from the shared identity source. Install before navigating.
 */
async function startMockSession(
  page: Page,
  context: BrowserContext,
  baseURL: string | undefined,
  roleName: string,
): Promise<void> {
  await context.addCookies([
    {
      name: 'session',
      value: 'mock-token',
      url: baseURL ?? 'http://localhost:3000',
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  await page.route('**/v1/auth/userinfo', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(userInfoFor(roleName)),
    }),
  );
}

async function isFocused(target: Locator): Promise<boolean> {
  return target.evaluate((element) => element === document.activeElement);
}

/** Press Tab until the target holds focus — proves it is reachable by keyboard alone. */
async function tabUntilFocused(page: Page, target: Locator): Promise<void> {
  for (let pressCount = 0; pressCount < MAX_TAB_PRESSES; pressCount += 1) {
    await page.keyboard.press('Tab');
    if (await isFocused(target)) {
      return;
    }
  }
  await expect(target).toBeFocused();
}

async function backgroundColourOf(target: Locator): Promise<string> {
  return target.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
}

test.describe('Epic sign-in-and-app-shell, Story 2: App frame with role-aware navigation', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-3
  test('choosing a navigation item opens that screen, updates the address and highlights it', async ({
    page,
    context,
    baseURL,
  }) => {
    await startMockSession(page, context, baseURL, FILE_IMPORTER_ROLE_NAME);
    await page.goto('/transactions');

    const mainNav = page.getByRole('navigation', { name: 'Main' });
    await expect(
      mainNav.getByRole('link', { name: 'Transactions' }),
    ).toHaveAttribute('aria-current', 'page');

    await mainNav.getByRole('link', { name: 'Files' }).click();
    await expect(page).toHaveURL(/\/files$/);
    await expect(mainNav.getByRole('link', { name: 'Files' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(
      mainNav.getByRole('link', { name: 'Transactions' }),
    ).not.toHaveAttribute('aria-current', 'page');

    await mainNav.getByRole('link', { name: 'Upload' }).click();
    await expect(page).toHaveURL(/\/upload$/);
    await expect(mainNav.getByRole('link', { name: 'Upload' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await page.goBack();
    await expect(page).toHaveURL(/\/files$/);
    await expect(mainNav.getByRole('link', { name: 'Files' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  // AC-5
  test('the frame is keyboard operable and passes an automated accessibility scan', async ({
    page,
    context,
    baseURL,
  }) => {
    await startMockSession(page, context, baseURL, FILE_IMPORTER_ROLE_NAME);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/transactions');

    const mainNav = page.getByRole('navigation', { name: 'Main' });
    await expect(mainNav).toBeVisible();

    const { violations } = await new AxeBuilder({ page })
      .withTags(WCAG_22_AA_TAGS)
      .analyze();
    expect(violations).toEqual([]);

    const filesLink = mainNav.getByRole('link', { name: 'Files' });
    await tabUntilFocused(page, filesLink);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/files$/);
    await expect(filesLink).toHaveAttribute('aria-current', 'page');

    const darkModeSwitch = page.getByRole('switch', { name: 'Dark mode' });
    await tabUntilFocused(page, darkModeSwitch);
    await page.keyboard.press('Space');
    await expect(darkModeSwitch).toBeChecked();
  });

  // AC-7
  test('switching theme restyles the whole app without a reload, and both themes pass an accessibility scan', async ({
    page,
    context,
    baseURL,
  }) => {
    await startMockSession(page, context, baseURL, FILE_IMPORTER_ROLE_NAME);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/transactions');

    const darkModeSwitch = page.getByRole('switch', { name: 'Dark mode' });
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(darkModeSwitch).not.toBeChecked();

    const lightScan = await new AxeBuilder({ page })
      .withTags(WCAG_22_AA_TAGS)
      .analyze();
    expect(lightScan.violations).toEqual([]);

    // The header bar keeps the brand identity blue in both themes (project.md §Styling),
    // so the page surface is the representative signal that the theme applied app-wide.
    const lightPageBackground = await backgroundColourOf(page.locator('body'));

    // A marker on window survives only if the page is not reloaded.
    await page.evaluate(() => {
      Object.assign(window, { themeSwitchWithoutReload: true });
    });

    await darkModeSwitch.click();
    await expect(darkModeSwitch).toBeChecked();

    await expect
      .poll(() => backgroundColourOf(page.locator('body')))
      .not.toBe(lightPageBackground);
    expect(
      await page.evaluate(() => 'themeSwitchWithoutReload' in window),
    ).toBe(true);

    const darkScan = await new AxeBuilder({ page })
      .withTags(WCAG_22_AA_TAGS)
      .analyze();
    expect(darkScan.violations).toEqual([]);
  });
});

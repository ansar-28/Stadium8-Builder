/**
 * Story Metadata:
 * - Route: /upload
 * - Target File: web/src/app/(app)/upload/page.tsx
 *
 * Mocking strategy:
 * - Backend calls are ALWAYS mocked — this spec never contacts a live backend
 *   (see testing-policy.md § "Playwright runs against mocks, never live").
 *   Intercept via: page.route()
 * - Implementation pattern this assumes:
 *   - The (app) layout's per-load session check requests userinfo from the browser
 *     (client-component call through the API client to the same-origin proxy path ending
 *     in /v1/auth/userinfo). The userinfo body comes from the shared identity source.
 *   - The Files screen loads its list from the browser via the proxy path ending in
 *     /v1/file-logs; the body comes from the shared file-log factory.
 *   - The signed-in state is a `session` cookie (mock value, added to the browser context
 *     before navigating); the frontend never reads its value.
 * - If the implementation diverges from these assumptions, this spec will not pass.
 *
 * Controls (same in the Vitest file): permission banner role "status"; file input
 * labelled "Choose a .csv file"; button "Upload file"; navigation landmark "Main" with
 * links Transactions / Files / Export (no Upload for an Approver).
 *
 * E2E spec for Epic file-upload-and-files, Story 3: Upload screen for users without the
 * File Importer role. These tests WILL FAIL until implemented (TDD red).
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { createFileLogList } from '../src/mocks/data/file-log';
import { APPROVER_ROLE_NAME, userInfoFor } from '../src/mocks/data/identity';

import type { BrowserContext, Page } from '@playwright/test';

const WCAG_22_AA_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
];

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

async function mockFileLogs(page: Page): Promise<void> {
  await page.route('**/v1/file-logs**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createFileLogList()),
    }),
  );
}

test.describe('Epic file-upload-and-files, Story 3: Upload screen for users without the File Importer role', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  // AC-2
  test('an Approver who types the upload address sees the permission banner inside the app frame and can go back to Files', async ({
    page,
    context,
    baseURL,
  }) => {
    await startMockSession(page, context, baseURL, APPROVER_ROLE_NAME);
    await mockFileLogs(page);

    await page.goto('/upload');

    await expect(page).toHaveURL(/\/upload$/);
    await expect(
      page.getByRole('heading', { name: 'Upload transaction file' }),
    ).toBeVisible();
    const mainNav = page.getByRole('navigation', { name: 'Main' });
    await expect(mainNav).toBeVisible();
    await expect(
      mainNav.getByRole('link', { name: 'Transactions' }),
    ).toBeVisible();
    await expect(mainNav.getByRole('link', { name: 'Upload' })).toHaveCount(0);

    const permissionBanner = page
      .getByRole('status')
      .filter({ hasText: 'File Importer' });
    await expect(permissionBanner).toBeVisible();
    await expect(permissionBanner).toContainText(/administrator/i);
    await expect(page.getByLabel('Choose a .csv file')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Upload file' })).toHaveCount(
      0,
    );

    const { violations } = await new AxeBuilder({ page })
      .withTags(WCAG_22_AA_TAGS)
      .analyze();
    expect(violations).toEqual([]);

    await mainNav.getByRole('link', { name: 'Files' }).click();
    await expect(page).toHaveURL(/\/files$/);
    await expect(mainNav.getByRole('link', { name: 'Files' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

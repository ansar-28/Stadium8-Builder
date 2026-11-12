/**
 * Story Metadata:
 * - Route: /transactions
 * - Target File: web/src/components/layout/SignOutButton.tsx
 *
 * Tests for the header's Sign out button: the in-progress state while the
 * logout request is pending, and the error + retry path when it fails.
 * Navigation after a successful sign-out is covered by the Playwright spec.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
// Import based on Story Metadata Target File — will fail until implemented (TDD red)
import { SignOutButton } from '@/components/layout/SignOutButton';
import { ToastProvider } from '@/contexts/ToastContext';
import { ToastContainer } from '@/components/toast/ToastContainer';
import { post } from '@/lib/api/client';

vi.mock('@/lib/api/client', () => ({
  apiClient: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/transactions',
  useSearchParams: () => new URLSearchParams(),
}));

const mockPost = post as ReturnType<typeof vi.fn>;

const SIGN_OUT_NAME = /^sign out$/i;
const SIGNING_OUT_NAME = /^signing out(…|\.\.\.)$/i;

function neverSettles(): Promise<never> {
  return new Promise<never>(() => {});
}

function renderSignOutButton() {
  return render(
    <ToastProvider>
      <SignOutButton />
      <ToastContainer />
    </ToastProvider>,
  );
}

describe('SignOutButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // AC-1
  it('reads "Signing out…" and cannot be pressed again while sign-out is in progress', async () => {
    const user = userEvent.setup();
    mockPost.mockReturnValue(neverSettles());
    renderSignOutButton();

    await user.click(screen.getByRole('button', { name: SIGN_OUT_NAME }));

    const pendingButton = await screen.findByRole('button', {
      name: SIGNING_OUT_NAME,
    });
    expect(pendingButton).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: SIGN_OUT_NAME }),
    ).not.toBeInTheDocument();
  });

  // AC-4
  // Data-contract: full chain verified during manual checklist
  it('shows an error when sign-out fails and lets the user try again', async () => {
    const user = userEvent.setup();
    mockPost
      .mockRejectedValueOnce({
        message: 'Internal Server Error: Something went wrong on the server',
        statusCode: 500,
        details: ['An error occurred'],
        endpoint: '/v1/auth/logout',
      })
      .mockReturnValueOnce(neverSettles());
    renderSignOutButton();

    await user.click(screen.getByRole('button', { name: SIGN_OUT_NAME }));

    expect(await screen.findByText(/sign-out failed/i)).toBeInTheDocument();
    const retryButton = await screen.findByRole('button', {
      name: SIGN_OUT_NAME,
    });
    expect(retryButton).toBeEnabled();

    await user.click(retryButton);

    expect(
      await screen.findByRole('button', { name: SIGNING_OUT_NAME }),
    ).toBeDisabled();
  });
});

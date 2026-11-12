/**
 * Per-epic baseline: sign-in-and-app-shell
 * - Shared surface: the protected (app) route group layout
 *   (web/src/app/(app)/layout.tsx), which every signed-in screen renders inside.
 *
 * Epic-wide invariants (later stories do not re-assert these):
 * - The layout checks the session against userinfo before showing any protected
 *   screen, with a loading placeholder (role="status", name "Loading…") meanwhile.
 * - When the session is rejected (401/403), protected content is never shown and
 *   the user is sent to /sign-in.
 * - When the session check cannot reach the server (network error, 5xx), protected
 *   content is never shown, the user stays put, and a "Retry" button re-checks.
 *
 * The layout performs its session check from the browser (client component
 * calling getUserInfo via @/lib/api/client) so the Playwright specs can mock it
 * with page.route(). Redirect behaviour in a real browser is covered by
 * Story 1's Playwright spec.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
// Will fail until implemented (TDD red)
import AppLayout from '@/app/(app)/layout';
import { ToastProvider } from '@/contexts/ToastContext';
import { get } from '@/lib/api/client';
import { userInfoFor } from '@/mocks/data/identity';
import type { APIError } from '@/types/api';

vi.mock('@/lib/api/client', () => ({
  apiClient: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockNavigate,
    replace: mockNavigate,
    refresh: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => '/transactions',
  useSearchParams: () => new URLSearchParams(),
  redirect: mockNavigate,
}));

const mockGet = get as ReturnType<typeof vi.fn>;

const expiredSessionError: APIError = {
  message: 'Unauthorized: Please log in to continue',
  statusCode: 401,
  details: ['Your session may have expired. Please log in again.'],
  endpoint: '/v1/auth/userinfo',
};

const serverUnavailableError: APIError = {
  message: 'Bad Gateway',
  statusCode: 502,
  details: ['Request failed with status 502'],
  endpoint: '/v1/auth/userinfo',
};

// The root layout supplies the notification provider around every screen.
function renderProtectedScreen() {
  return render(
    <ToastProvider>
      <AppLayout>
        <h1>Protected screen content</h1>
      </AppLayout>
    </ToastProvider>,
  );
}

describe('Protected app layout (epic baseline)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // AC-3 (Story 1)
  it('shows a loading placeholder until the session is confirmed, then the protected screen', async () => {
    let confirmSession!: () => void;
    mockGet.mockReturnValue(
      new Promise((resolve) => {
        confirmSession = () => resolve(userInfoFor('File Importer'));
      }),
    );

    renderProtectedScreen();

    expect(
      screen.getByRole('status', { name: /loading/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Protected screen content' }),
    ).not.toBeInTheDocument();

    confirmSession();

    expect(
      await screen.findByRole('heading', { name: 'Protected screen content' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('status', { name: /loading/i }),
    ).not.toBeInTheDocument();
  });

  // AC-4 (Story 1)
  it('never shows protected content and sends the user to sign in when the session check fails', async () => {
    mockGet.mockRejectedValue(expiredSessionError);

    renderProtectedScreen();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringMatching(/^\/sign-in/),
      );
    });
    expect(
      screen.queryByRole('heading', { name: 'Protected screen content' }),
    ).not.toBeInTheDocument();
  });

  // Code review: only a rejected session (401/403) signs the user out
  it('offers a retry instead of signing out when the session check cannot reach the server', async () => {
    mockGet
      .mockRejectedValueOnce(serverUnavailableError)
      .mockResolvedValueOnce(userInfoFor('File Importer'));
    const user = userEvent.setup();

    renderProtectedScreen();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /couldn.t reach the server/i,
    );
    expect(
      screen.queryByRole('heading', { name: 'Protected screen content' }),
    ).not.toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(
      await screen.findByRole('heading', { name: 'Protected screen content' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

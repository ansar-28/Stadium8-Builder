/**
 * Story Metadata:
 * - Route: /sign-in
 * - Target File: web/src/app/(app)/layout.tsx
 * - Component under test: web/src/components/auth/SignInForm.tsx (rendered by the /sign-in page)
 *
 * Tests for Epic sign-in-and-app-shell, Story 1: the Sign in form's inline
 * validation and generic failure message. The redirect on success and the
 * route guard are covered in the Playwright spec.
 *
 * Controls (shared with the Playwright spec):
 * - text input labelled "Username"
 * - password input labelled "Password" (exact label)
 * - button "Sign in"
 * - inline errors render as role="alert"
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
// Will fail until implemented (TDD red)
import { SignInForm } from '@/components/auth/SignInForm';
import { post } from '@/lib/api/client';
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
  usePathname: () => '/sign-in',
  useSearchParams: () => new URLSearchParams(),
  redirect: mockNavigate,
}));

const mockPost = post as ReturnType<typeof vi.fn>;

const REQUIRED_MESSAGE = /^Username and password are required\.$/;
const FAILED_MESSAGE = /^Sign-in failed\. Check your details and try again\.$/;

const rejectedCredentialsError: APIError = {
  message: 'Unauthorized: Please log in to continue',
  statusCode: 401,
  details: ['Your session may have expired. Please log in again.'],
  endpoint: '/v1/auth/login',
};

describe('Sign in form', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // AC-1
  it('shows the required message and sends nothing when a field is blank after trimming', async () => {
    const user = userEvent.setup();
    render(<SignInForm />);

    await user.type(screen.getByLabelText('Username'), '   ');
    await user.type(
      screen.getByLabelText('Password'),
      'mock-password-not-real',
    );
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      REQUIRED_MESSAGE,
    );
    expect(mockPost).not.toHaveBeenCalled();
  });

  // AC-2
  it('shows the same generic failure on repeated rejections and clears it when either field is edited', async () => {
    mockPost.mockRejectedValue(rejectedCredentialsError);
    const user = userEvent.setup();
    render(<SignInForm />);

    const usernameInput = screen.getByLabelText('Username');
    const passwordInput = screen.getByLabelText('Password');
    const signInButton = screen.getByRole('button', { name: 'Sign in' });

    await user.type(usernameInput, 'carol');
    await user.type(passwordInput, 'wrong-password');
    await user.click(signInButton);
    expect(await screen.findByRole('alert')).toHaveTextContent(FAILED_MESSAGE);

    // A second rejection shows the identical message — no lockout hint.
    await user.click(signInButton);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled(),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(FAILED_MESSAGE);

    // Editing the password clears it.
    await user.type(passwordInput, 'x');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // Editing the username clears it too.
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(FAILED_MESSAGE);
    await user.type(usernameInput, 'x');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

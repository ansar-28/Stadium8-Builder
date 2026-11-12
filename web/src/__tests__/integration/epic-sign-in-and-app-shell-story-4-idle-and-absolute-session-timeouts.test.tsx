/**
 * Story Metadata:
 * - Route: /transactions
 * - Target File: web/src/components/layout/SessionTimeout.tsx
 *
 * Tests for the idle-timeout warning's keyboard behaviour (Story 4).
 * The timing flows (warning at 14 min, sign-out at +60 s, 8-hour cap) are covered by the
 * Playwright spec with page.clock; this file covers only the warning's focus and keyboard
 * contract, which jsdom can observe.
 *
 * Contract pinned here:
 * - `SessionTimeout` is a named export that renders with no required props.
 * - When the warning opens, focus lands on "Stay signed in" (the safe default action).
 * - Tab keeps focus inside the warning; key presses while it is open do not dismiss it.
 * - Pressing Enter on "Stay signed in" closes the warning.
 *
 * Uses vi.useFakeTimers() only to open the warning (a component-local timer); no axe here —
 * accessibility is asserted by the Playwright @axe-core scan.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionTimeout } from '@/components/layout/SessionTimeout';

vi.mock('@/lib/api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  apiClient: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/transactions',
  useSearchParams: () => new URLSearchParams(),
}));

const FOURTEEN_MINUTES_AND_ONE_SECOND_MS = (14 * 60 + 1) * 1000;

describe('SessionTimeout warning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // AC-5
  it('moves focus into the warning when it opens and can be answered by keyboard alone', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SessionTimeout />);

    act(() => {
      vi.advanceTimersByTime(FOURTEEN_MINUTES_AND_ONE_SECOND_MS);
    });

    const warning = await screen.findByRole('dialog');
    const staySignedInButton = screen.getByRole('button', {
      name: 'Stay signed in',
    });
    expect(warning).toContainElement(staySignedInButton);
    expect(staySignedInButton).toHaveFocus();

    await user.tab();
    expect(warning).toContainElement(document.activeElement as HTMLElement);

    await user.tab({ shift: true });
    expect(staySignedInButton).toHaveFocus();

    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});

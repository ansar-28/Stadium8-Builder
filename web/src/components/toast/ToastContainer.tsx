'use client';

/**
 * ToastContainer - the notification area (bottom-right by default).
 * The polite live region is always present, so assistive technology is
 * already listening when the first notification arrives.
 */

import { useToast } from '@/contexts/ToastContext';
import { cn } from '@/lib/utils';
import { TOAST_DEFAULTS, type ToastContainerProps } from '@/types/toast';

import { Toast } from './Toast';

const POSITION_CLASSES: Record<
  NonNullable<ToastContainerProps['position']>,
  string
> = {
  'top-right': 'top-4 right-4',
  'top-left': 'top-4 left-4',
  'top-center': 'top-4 left-1/2 -translate-x-1/2',
  'bottom-right': 'bottom-4 right-4',
  'bottom-left': 'bottom-4 left-4',
  'bottom-center': 'bottom-4 left-1/2 -translate-x-1/2',
};

export function ToastContainer({
  position = TOAST_DEFAULTS.POSITION,
  maxToasts = TOAST_DEFAULTS.MAX_TOASTS,
}: ToastContainerProps = {}) {
  const { toasts, dismissToast } = useToast();
  const visibleToasts = toasts.slice(-maxToasts);

  return (
    <div
      role="region"
      aria-label="Notifications"
      aria-live="polite"
      aria-atomic="false"
      className={cn(
        'pointer-events-none fixed z-50 flex w-[calc(100%-2rem)] max-w-[420px] flex-col gap-2',
        POSITION_CLASSES[position],
      )}
    >
      {visibleToasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={dismissToast} />
      ))}
    </div>
  );
}

'use client';

/**
 * Toast - one notification in the bottom-right notification area.
 * Every notification is a polite `status` with a close button; timed ones
 * fade out just before the provider removes them, errors stay until closed.
 */

import { useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  TOAST_DEFAULTS,
  type ToastProps,
  type ToastVariant,
} from '@/types/toast';

const VARIANT_ICON: Record<
  ToastVariant,
  { icon: typeof Info; colour: string }
> = {
  success: { icon: CircleCheck, colour: 'text-success-text' },
  error: { icon: CircleAlert, colour: 'text-destructive-text' },
  warning: { icon: TriangleAlert, colour: 'text-warning-text' },
  info: { icon: Info, colour: 'text-primary' },
};

export function Toast({ toast, onDismiss }: ToastProps) {
  const [isFading, setIsFading] = useState(false);

  useEffect(() => {
    if (!toast.duration || toast.duration <= 0) return;
    const fadeTimer = setTimeout(
      () => setIsFading(true),
      Math.max(toast.duration - TOAST_DEFAULTS.FADE_OUT_MS, 0),
    );
    return () => clearTimeout(fadeTimer);
  }, [toast.duration]);

  const { icon: VariantIcon, colour } = VARIANT_ICON[toast.variant];

  const handleToastClick = () => {
    if (toast.onClick) {
      toast.onClick();
      onDismiss(toast.id);
    }
  };

  return (
    <div
      role="status"
      aria-atomic="true"
      onClick={toast.onClick ? handleToastClick : undefined}
      className={cn(
        'pointer-events-auto flex items-start gap-3 rounded-lg border border-l-4 border-border border-l-primary bg-popover p-4 text-popover-foreground shadow-lg',
        'animate-in fade-in slide-in-from-right duration-300 transition-opacity',
        isFading && 'opacity-0',
        toast.onClick && 'cursor-pointer',
      )}
    >
      <VariantIcon
        aria-hidden="true"
        className={cn('mt-0.5 size-5 shrink-0', colour)}
      />

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{toast.title}</p>
        {toast.message && (
          <p className="mt-1 text-sm text-muted-foreground">{toast.message}</p>
        )}
      </div>

      {toast.dismissible !== false && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Dismiss notification"
          className="-my-1 -mr-1 shrink-0 text-muted-foreground"
          onClick={(event) => {
            event.stopPropagation();
            onDismiss(toast.id);
          }}
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
      )}
    </div>
  );
}

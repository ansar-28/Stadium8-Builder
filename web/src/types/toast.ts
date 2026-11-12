/**
 * Toast notification type definitions
 * Defines interfaces for the toast notification system
 */

/**
 * ToastVariant - Available toast notification variants
 */
export type ToastVariant = 'success' | 'error' | 'info' | 'warning';

/** A button inside the notification, e.g. "Try again"; pressing it also closes the notification. */
export interface ToastAction {
  label: string;
  onAction: () => void;
}

/**
 * Toast - Individual toast notification object
 */
export interface Toast {
  id: string;
  variant: ToastVariant;
  title: string;
  message?: string;
  duration?: number; // Milliseconds before auto-hide (default 5000; always 0 = persist for errors)
  dismissible?: boolean; // Whether user can manually dismiss (default: true)
  onClick?: () => void; // Optional click handler for interactive toasts
  action?: ToastAction;
}

/**
 * ToastOptions - Options for creating a new toast
 * Used when calling showToast function
 */
export interface ToastOptions {
  variant: ToastVariant;
  title: string;
  message?: string;
  duration?: number;
  dismissible?: boolean;
  onClick?: () => void;
  action?: ToastAction;
}

/**
 * ToastContextValue - Context value for toast provider
 * Provides toast state and functions to child components
 */
export interface ToastContextValue {
  toasts: Toast[];
  showToast: (options: ToastOptions) => void;
  dismissToast: (id: string) => void;
  clearAllToasts: () => void;
}

/**
 * ToastProps - Props for individual Toast component
 */
export interface ToastProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

/**
 * ToastContainerProps - Props for ToastContainer component
 * Optional position configuration for future enhancement
 */
export interface ToastContainerProps {
  position?:
    | 'top-right'
    | 'top-left'
    | 'bottom-right'
    | 'bottom-left'
    | 'top-center'
    | 'bottom-center';
  maxToasts?: number; // Maximum number of toasts to display at once (default: 3)
}

/**
 * Default toast configuration values.
 * Errors never auto-hide: they stay until the user closes them.
 */
export const TOAST_DEFAULTS = {
  DURATION: 5000, // 5 seconds, for non-error toasts
  FADE_OUT_MS: 300,
  MAX_TOASTS: 3,
  POSITION: 'bottom-right' as const,
  DISMISSIBLE: true,
} as const;

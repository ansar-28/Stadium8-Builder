'use client';

import { useId, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { login } from '@/lib/api/endpoints';
import { HOME_PATH } from '@/lib/auth/session-constants';
import { signInSchema } from '@/lib/validation/schemas';
import type { APIError } from '@/types/api';

const SIGN_IN_FAILED_MESSAGE =
  'Sign-in failed. Check your details and try again.';
const SIGN_IN_UNAVAILABLE_MESSAGE =
  'Sign-in is unavailable right now. Please try again in a moment.';

function statusCodeOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const { statusCode } = error as Partial<APIError>;
  return typeof statusCode === 'number' ? statusCode : undefined;
}

/** Rejected credentials (400/401) never say which entry was wrong or hint at a lockout. */
function messageForFailedSignIn(error: unknown): string {
  const statusCode = statusCodeOf(error);
  if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
    return SIGN_IN_FAILED_MESSAGE;
  }
  return SIGN_IN_UNAVAILABLE_MESSAGE;
}

export function SignInForm() {
  const router = useRouter();
  const errorId = useId();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const describedBy = errorMessage ? errorId : undefined;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const validation = signInSchema.safeParse({ username, password });
    if (!validation.success) {
      setErrorMessage(validation.error.issues[0]?.message ?? null);
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      await login({ Username: username.trim(), Password: password });
      router.replace(HOME_PATH);
    } catch (error) {
      setErrorMessage(messageForFailedSignIn(error));
      setIsSubmitting(false);
    }
  }

  function handleUsernameChange(value: string) {
    setUsername(value);
    setErrorMessage(null);
  }

  function handlePasswordChange(value: string) {
    setPassword(value);
    setErrorMessage(null);
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="sign-in-username" className="font-semibold">
          Username
        </Label>
        <Input
          id="sign-in-username"
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={username}
          onChange={(event) => handleUsernameChange(event.target.value)}
          aria-invalid={errorMessage ? true : undefined}
          aria-describedby={describedBy}
          className="h-11 bg-background text-sm"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="sign-in-password" className="font-semibold">
          Password
        </Label>
        <div className="flex gap-2">
          <Input
            id="sign-in-password"
            name="password"
            type={isPasswordVisible ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(event) => handlePasswordChange(event.target.value)}
            aria-invalid={errorMessage ? true : undefined}
            aria-describedby={describedBy}
            className="h-11 bg-background text-sm"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Show password"
            aria-pressed={isPasswordVisible}
            aria-controls="sign-in-password"
            onClick={() => setIsPasswordVisible((visible) => !visible)}
            className="size-11 shrink-0 border-input bg-background text-foreground hover:bg-muted hover:text-foreground"
          >
            {isPasswordVisible ? (
              <EyeOff aria-hidden="true" />
            ) : (
              <Eye aria-hidden="true" />
            )}
          </Button>
        </div>
      </div>

      {errorMessage ? (
        <p
          id={errorId}
          role="alert"
          className="text-sm font-semibold text-destructive-text"
        >
          {errorMessage}
        </p>
      ) : null}

      <Button
        type="submit"
        disabled={isSubmitting}
        aria-busy={isSubmitting || undefined}
        className="h-11 w-full font-semibold hover:bg-primary-hover"
      >
        Sign in
      </Button>
    </form>
  );
}

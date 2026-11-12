import type { Metadata } from 'next';

import { SignInForm } from '@/components/auth/SignInForm';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from '@/components/ui/card';

export const metadata: Metadata = {
  title: 'Sign in · Transaction Management',
};

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <Card className="w-full max-w-[400px] gap-6 rounded-xl shadow-md">
        <CardHeader className="gap-2">
          <h1 className="text-2xl leading-tight">Transaction Management</h1>
          <CardDescription>
            Sign in to review, decide and export transactions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignInForm />
        </CardContent>
      </Card>
    </main>
  );
}

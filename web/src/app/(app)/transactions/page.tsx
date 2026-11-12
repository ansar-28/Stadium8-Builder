import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Transactions · Transaction Management',
};

export default function TransactionsPage() {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-[1.625rem] leading-tight">Transactions</h1>
      <p className="text-sm text-muted-foreground">
        Transaction data is read-only. Decisions are final.
      </p>
    </header>
  );
}

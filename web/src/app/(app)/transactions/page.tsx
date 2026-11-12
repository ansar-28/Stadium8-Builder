import type { Metadata } from 'next';

import { PageHeader } from '@/components/layout/PageHeader';
import { TransactionList } from '@/components/transactions/TransactionList';

export const metadata: Metadata = {
  title: 'Transactions · Transaction Management',
};

export default function TransactionsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Transactions"
        description="Transaction data is read-only. Decisions are final."
      />
      <TransactionList />
    </div>
  );
}

import type { Metadata } from 'next';

import { PageHeader } from '@/components/layout/PageHeader';

export const metadata: Metadata = {
  title: 'Transactions · Transaction Management',
};

export default function TransactionsPage() {
  return (
    <PageHeader
      title="Transactions"
      description="Transaction data is read-only. Decisions are final."
    />
  );
}

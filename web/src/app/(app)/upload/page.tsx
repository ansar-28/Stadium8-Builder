import type { Metadata } from 'next';

import { PageHeader } from '@/components/layout/PageHeader';

export const metadata: Metadata = {
  title: 'Upload transaction file · Transaction Management',
};

export default function UploadTransactionFilePage() {
  return (
    <PageHeader
      title="Upload transaction file"
      description="Only the seven-column .csv layout is accepted: Reference, TransactionDate, AccountNumber, Description, Amount, TransactionType, Currency."
    />
  );
}

import type { Metadata } from 'next';

import { FileImporterOnly } from '@/components/files/FileImporterOnly';
import { UploadTransactionFile } from '@/components/files/UploadTransactionFile';
import { PageHeader } from '@/components/layout/PageHeader';

export const metadata: Metadata = {
  title: 'Upload transaction file · Transaction Management',
};

export default function UploadTransactionFilePage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Upload transaction file"
        description="Only the seven-column .csv layout is accepted: Reference, TransactionDate, AccountNumber, Description, Amount, TransactionType, Currency."
      />
      <FileImporterOnly>
        <UploadTransactionFile />
      </FileImporterOnly>
    </div>
  );
}

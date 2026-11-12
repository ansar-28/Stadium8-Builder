import type { Metadata } from 'next';

import { PageHeader } from '@/components/layout/PageHeader';

export const metadata: Metadata = {
  title: 'Export actioned transactions · Transaction Management',
};

export default function ExportActionedTransactionsPage() {
  return (
    <PageHeader
      title="Export actioned transactions"
      description="Approved and rejected transactions only. The .csv uses the import layout plus a Status field."
    />
  );
}

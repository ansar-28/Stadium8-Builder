import type { Metadata } from 'next';

import { PageHeader } from '@/components/layout/PageHeader';

export const metadata: Metadata = {
  title: 'Uploaded files · Transaction Management',
};

export default function UploadedFilesPage() {
  return (
    <PageHeader
      title="Uploaded files"
      description="Every successfully uploaded .csv file, with its upload timestamp."
    />
  );
}

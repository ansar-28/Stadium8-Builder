import type { Metadata } from 'next';

import { UploadedFiles } from '@/components/files/UploadedFiles';

export const metadata: Metadata = {
  title: 'Uploaded files · Transaction Management',
};

export default function UploadedFilesPage() {
  return <UploadedFiles />;
}

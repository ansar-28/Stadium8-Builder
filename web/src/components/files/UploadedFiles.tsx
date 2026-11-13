'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import {
  DEFAULT_PAGE_SIZE,
  TablePagination,
  pageCountOf,
  pageOf,
} from '@/components/data-table/TablePagination';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useSignedInUser } from '@/contexts/SessionContext';
import { useToast } from '@/contexts/ToastContext';
import { serverMessageOf } from '@/lib/api/errors';
import { downloadFile, getFileLogs } from '@/lib/api/endpoints';
import { FILE_IMPORTER_ROLE_NAME, hasRole } from '@/lib/auth/roles';
import { saveBlobAsFile } from '@/lib/download';
import { dateTimeSortValue, formatDateTime } from '@/lib/format/date-time';
import type { FileLog } from '@/types/api-generated';

const ACTIVE_FILES_ONLY = 'Yes';
const UPLOAD_PATH = '/upload';

type FileListLoad =
  | { status: 'loading' }
  | { status: 'loaded'; files: FileLog[] }
  | { status: 'failed'; message: string };

function newestFirst(files: readonly FileLog[]): FileLog[] {
  return [...files].sort(
    (firstFile, secondFile) =>
      dateTimeSortValue(secondFile.ProcessDate ?? '') -
      dateTimeSortValue(firstFile.ProcessDate ?? ''),
  );
}

/** A file can only be requested from storage when the server gave it an id. */
function isDownloadable(file: FileLog): boolean {
  return typeof file.Id === 'number';
}

function UploadAFileLink() {
  return (
    <Button asChild className="min-h-10 font-semibold hover:bg-primary-hover">
      <Link href={UPLOAD_PATH}>Upload a file</Link>
    </Button>
  );
}

function FileListLoading() {
  return (
    <div
      role="status"
      aria-label="Loading files…"
      className="flex flex-col gap-3 rounded-lg border p-4"
    >
      {['w-3/4', 'w-1/2', 'w-2/3', 'w-1/3', 'w-3/5'].map((barWidth) => (
        <div
          key={barWidth}
          className={`h-5 animate-pulse rounded-md bg-muted motion-reduce:animate-none ${barWidth}`}
        />
      ))}
    </div>
  );
}

function FileListLoadFailed({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <Card role="alert" className="max-w-xl">
      <CardHeader>
        <CardTitle className="text-xl">
          We couldn&apos;t load the uploaded files
        </CardTitle>
        <CardDescription className="text-base">{message}</CardDescription>
      </CardHeader>
      <CardFooter>
        <Button
          type="button"
          onClick={onRetry}
          className="min-h-10 font-semibold hover:bg-primary-hover"
        >
          Try again
        </Button>
      </CardFooter>
    </Card>
  );
}

function NoFilesYet({ canUpload }: { canUpload: boolean }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border px-6 py-12 text-center">
      <p className="text-lg font-semibold">No files yet</p>
      {canUpload && <UploadAFileLink />}
    </div>
  );
}

/** Uploaded files screen: every successfully uploaded file, newest first, with download. */
export function UploadedFiles() {
  const signedInUser = useSignedInUser();
  const { showToast } = useToast();
  const canUpload = hasRole(signedInUser, FILE_IMPORTER_ROLE_NAME);

  const [fileListLoad, setFileListLoad] = useState<FileListLoad>({
    status: 'loading',
  });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  useEffect(() => {
    let isCurrentLoad = true;
    getFileLogs(ACTIVE_FILES_ONLY)
      .then((fileLogList) => {
        if (!isCurrentLoad) return;
        setFileListLoad({
          status: 'loaded',
          files: newestFirst(fileLogList?.FileLog ?? []),
        });
      })
      .catch((error: unknown) => {
        if (!isCurrentLoad) return;
        setFileListLoad({ status: 'failed', message: serverMessageOf(error) });
      });
    return () => {
      isCurrentLoad = false;
    };
  }, [loadAttempt]);

  function retryFileListLoad() {
    setFileListLoad({ status: 'loading' });
    setPageNumber(1);
    setLoadAttempt((attempt) => attempt + 1);
  }

  const downloadUploadedFile = useCallback(
    async function download(file: FileLog) {
      if (!isDownloadable(file)) return;
      const fileName = file.CurrentFileName ?? `file-${file.Id}`;
      try {
        const fileContent = await downloadFile(String(file.Id));
        saveBlobAsFile(fileContent, fileName);
        showToast({ variant: 'success', title: `${fileName} downloaded.` });
      } catch (error) {
        showToast({
          variant: 'error',
          title: `${fileName} could not be downloaded`,
          message: serverMessageOf(error),
          action: { label: 'Try again', onAction: () => void download(file) },
        });
      }
    },
    [showToast],
  );

  const files = useMemo(
    () => (fileListLoad.status === 'loaded' ? fileListLoad.files : []),
    [fileListLoad],
  );
  const currentPageNumber = Math.min(
    pageNumber,
    pageCountOf(files.length, pageSize),
  );
  const filesOnPage = pageOf(files, currentPageNumber, pageSize);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Uploaded files"
        description="Every successfully uploaded .csv file, with its upload timestamp."
        action={canUpload ? <UploadAFileLink /> : undefined}
      />

      {fileListLoad.status === 'loading' && <FileListLoading />}

      {fileListLoad.status === 'failed' && (
        <FileListLoadFailed
          message={fileListLoad.message}
          onRetry={retryFileListLoad}
        />
      )}

      {fileListLoad.status === 'loaded' && files.length === 0 && (
        <NoFilesYet canUpload={canUpload} />
      )}

      {fileListLoad.status === 'loaded' && files.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border">
            <Table className="min-w-[560px]">
              <TableHeader className="bg-muted">
                <TableRow>
                  <TableHead className="h-11 px-4 text-xs font-semibold text-muted-foreground uppercase">
                    File name
                  </TableHead>
                  <TableHead className="h-11 px-4 text-xs font-semibold text-muted-foreground uppercase">
                    Upload timestamp
                  </TableHead>
                  <TableHead className="h-11 w-[140px] px-4">
                    <span className="sr-only">Download</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filesOnPage.map((file) => {
                  const fileName = file.CurrentFileName ?? `file-${file.Id}`;
                  return (
                    <TableRow key={file.Id ?? fileName}>
                      <TableCell className="px-4">{fileName}</TableCell>
                      <TableCell className="px-4 tabular-nums">
                        {formatDateTime(file.ProcessDate ?? '')}
                      </TableCell>
                      <TableCell className="px-4">
                        <Button
                          type="button"
                          variant="outline"
                          className="min-h-10"
                          aria-label={`Download ${fileName}`}
                          disabled={!isDownloadable(file)}
                          onClick={() => void downloadUploadedFile(file)}
                        >
                          Download
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <TablePagination
            shownCount={filesOnPage.length}
            totalCount={files.length}
            itemNoun="files"
            pageNumber={currentPageNumber}
            pageSize={pageSize}
            onPageChange={setPageNumber}
            onPageSizeChange={(newPageSize) => {
              setPageSize(newPageSize);
              setPageNumber(1);
            }}
          />
        </div>
      )}
    </div>
  );
}

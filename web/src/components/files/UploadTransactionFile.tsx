'use client';

import {
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import { CircleAlert, CircleCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/contexts/ToastContext';
import { uploadFile } from '@/lib/api/endpoints';
import { serverMessageOf } from '@/lib/api/errors';
import {
  TRANSACTION_FILE_SETTING_ID,
  TRANSACTION_FILE_SETTING_NAME,
} from '@/lib/files/transaction-file-setting';
import { cn } from '@/lib/utils';
import {
  TRANSACTION_FILE_LAYOUT_MESSAGE,
  isSevenColumnTransactionFile,
} from '@/lib/validation/transaction-file';

const NO_FILE_CHOSEN_MESSAGE = 'Choose a .csv file to upload.';

type UploadOutcome =
  | { status: 'accepted'; message: string }
  | { status: 'rejected'; title?: string; message: string };

function rejectedAtUploadNotice(fileName: string): string {
  return `The file ${fileName} was rejected at upload.`;
}

function acceptedMessage(fileName: string): string {
  return `${fileName} was uploaded. It appears in the file list and its transactions are pending.`;
}

function UploadOutcomeBanner({ outcome }: { outcome: UploadOutcome }) {
  const isAccepted = outcome.status === 'accepted';
  const OutcomeIcon = isAccepted ? CircleCheck : CircleAlert;
  return (
    <div
      role="status"
      aria-atomic="true"
      className={cn(
        'flex items-start gap-3 rounded-md border bg-card p-4 text-sm',
        isAccepted ? 'border-success-text' : 'border-destructive-text',
      )}
    >
      <OutcomeIcon
        aria-hidden="true"
        className={cn(
          'mt-0.5 size-5 shrink-0',
          isAccepted ? 'text-success-text' : 'text-destructive-text',
        )}
      />
      <div className="flex flex-col gap-1">
        {outcome.status === 'rejected' && outcome.title && (
          <p className="font-semibold">{outcome.title}</p>
        )}
        <p>{outcome.message}</p>
      </div>
    </div>
  );
}

/** Upload card: choose a .csv, check its seven-column layout, send it, report the outcome. */
export function UploadTransactionFile() {
  const { showToast } = useToast();
  const fileInputId = useId();
  const noFileMessageId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [chosenFile, setChosenFile] = useState<File | null>(null);
  const [isNoFileMessageShown, setIsNoFileMessageShown] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [outcome, setOutcome] = useState<UploadOutcome | null>(null);

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    setChosenFile(event.target.files?.[0] ?? null);
    setIsNoFileMessageShown(false);
    setOutcome(null);
  }

  function clearChosenFile() {
    setChosenFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  function reportRejection(fileName: string, rejection: UploadOutcome) {
    setOutcome(rejection);
    showToast({ variant: 'error', title: rejectedAtUploadNotice(fileName) });
  }

  async function uploadChosenFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isUploading) return;
    if (!chosenFile) {
      setIsNoFileMessageShown(true);
      return;
    }

    const fileName = chosenFile.name;
    setOutcome(null);
    setIsUploading(true);
    try {
      if (!(await isSevenColumnTransactionFile(chosenFile))) {
        reportRejection(fileName, {
          status: 'rejected',
          message: TRANSACTION_FILE_LAYOUT_MESSAGE,
        });
        return;
      }
      await uploadFile(
        TRANSACTION_FILE_SETTING_ID,
        TRANSACTION_FILE_SETTING_NAME,
        fileName,
        chosenFile,
      );
      clearChosenFile();
      setOutcome({ status: 'accepted', message: acceptedMessage(fileName) });
    } catch (error) {
      reportRejection(fileName, {
        status: 'rejected',
        title: `${fileName} could not be uploaded.`,
        message: serverMessageOf(error),
      });
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <Card className="max-w-[640px]">
      <CardContent>
        <form
          noValidate
          onSubmit={(event) => void uploadChosenFile(event)}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor={fileInputId}>Choose a .csv file</Label>
            <Input
              ref={fileInputRef}
              id={fileInputId}
              type="file"
              accept=".csv,text/csv"
              className="h-auto min-h-10 py-1.5"
              disabled={isUploading}
              aria-invalid={isNoFileMessageShown || undefined}
              aria-describedby={
                isNoFileMessageShown ? noFileMessageId : undefined
              }
              onChange={chooseFile}
            />
            {isNoFileMessageShown && (
              <p
                id={noFileMessageId}
                role="alert"
                className="text-sm text-destructive-text"
              >
                {NO_FILE_CHOSEN_MESSAGE}
              </p>
            )}
            {chosenFile && (
              <p className="text-sm text-muted-foreground">
                Selected:{' '}
                <strong className="font-semibold text-foreground">
                  {chosenFile.name}
                </strong>
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              type="submit"
              disabled={isUploading}
              aria-busy={isUploading || undefined}
              className="min-h-10 font-semibold hover:bg-primary-hover"
            >
              Upload file
            </Button>
          </div>

          {outcome && <UploadOutcomeBanner outcome={outcome} />}
        </form>
      </CardContent>
    </Card>
  );
}

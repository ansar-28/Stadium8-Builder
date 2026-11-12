import { Badge } from '@/components/ui/badge';
import {
  CREDIT_TYPE,
  DEBIT_TYPE,
  type TransactionStatus,
} from '@/lib/transactions/transaction-rows';
import { cn } from '@/lib/utils';

// Light theme: coloured text and outline on the plain table surface (a tint would
// pull the status colours under 4.5:1). Dark theme: the prototype's tinted fill.
const STATUS_CHIP_CLASS_NAMES: Record<TransactionStatus, string> = {
  Pending: 'border-warning-text text-warning-text dark:bg-warning-text/15',
  Approved: 'border-success-text text-success-text dark:bg-success-text/15',
  Rejected:
    'border-destructive-text text-destructive-text dark:bg-destructive-text/15',
};

const TYPE_CHIP_CLASS_NAMES: Record<string, string> = {
  [CREDIT_TYPE]: 'border-info-text text-info-text dark:bg-info-text/15',
  [DEBIT_TYPE]:
    'border-muted-foreground text-muted-foreground dark:bg-muted-foreground/15',
};

const CHIP_BASE_CLASS_NAME = 'px-2.5 text-xs font-semibold';

export function StatusChip({ status }: { status: TransactionStatus }) {
  return (
    <Badge
      variant="outline"
      className={cn(CHIP_BASE_CLASS_NAME, STATUS_CHIP_CLASS_NAMES[status])}
    >
      {status}
    </Badge>
  );
}

export function TypeChip({ transactionType }: { transactionType: string }) {
  if (!transactionType) return null;
  return (
    <Badge
      variant="outline"
      className={cn(
        CHIP_BASE_CLASS_NAME,
        TYPE_CHIP_CLASS_NAMES[transactionType] ??
          'border-muted-foreground text-muted-foreground',
      )}
    >
      {transactionType}
    </Badge>
  );
}

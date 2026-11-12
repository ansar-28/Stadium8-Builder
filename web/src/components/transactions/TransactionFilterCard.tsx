'use client';

import { useId, type ComponentProps } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { CREDIT_TYPE, DEBIT_TYPE } from '@/lib/transactions/transaction-rows';
import {
  ANY_OPTION,
  FILTER_LABELS,
  type TransactionFilters,
} from '@/lib/transactions/transaction-view';

const ACCOUNT_NUMBER_PLACEHOLDER = '1001-2034';
const TRANSACTION_TYPE_OPTIONS = [ANY_OPTION, CREDIT_TYPE, DEBIT_TYPE];
const FILTER_LABEL_CLASS_NAME = 'text-xs font-semibold text-muted-foreground';
const FILTER_CONTROL_CLASS_NAME = 'h-10';

interface TransactionFilterCardProps {
  filters: TransactionFilters;
  currencyOptions: readonly string[];
  onFilterChange: (filterName: keyof TransactionFilters, value: string) => void;
  onClearAll: () => void;
}

/** Filter fields for the transaction list; every change applies immediately. */
export function TransactionFilterCard({
  filters,
  currencyOptions,
  onFilterChange,
  onClearAll,
}: TransactionFilterCardProps) {
  const fieldIdPrefix = useId();
  const fieldIdOf = (filterName: keyof TransactionFilters) =>
    `${fieldIdPrefix}-${filterName}`;

  function textField(
    filterName: keyof TransactionFilters,
    inputProps: ComponentProps<typeof Input>,
  ) {
    return (
      <div className="flex flex-col gap-1.5">
        <Label
          htmlFor={fieldIdOf(filterName)}
          className={FILTER_LABEL_CLASS_NAME}
        >
          {FILTER_LABELS[filterName]}
        </Label>
        <Input
          id={fieldIdOf(filterName)}
          value={filters[filterName]}
          onChange={(event) => onFilterChange(filterName, event.target.value)}
          {...inputProps}
        />
      </div>
    );
  }

  function choiceField(
    filterName: keyof TransactionFilters,
    options: readonly string[],
  ) {
    return (
      <div className="flex flex-col gap-1.5">
        <Label
          htmlFor={fieldIdOf(filterName)}
          className={FILTER_LABEL_CLASS_NAME}
        >
          {FILTER_LABELS[filterName]}
        </Label>
        <NativeSelect
          id={fieldIdOf(filterName)}
          value={filters[filterName]}
          onChange={(event) => onFilterChange(filterName, event.target.value)}
          className={FILTER_CONTROL_CLASS_NAME}
          wrapperClassName="min-w-32"
        >
          {options.map((option) => (
            <NativeSelectOption key={option} value={option}>
              {option}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
    );
  }

  return (
    <Card
      role="search"
      aria-label="Filters"
      className="flex-row flex-wrap items-end gap-4 rounded-lg px-4 py-4 shadow-none"
    >
      {textField('dateFrom', { type: 'date', className: 'h-10 w-40' })}
      {textField('dateTo', { type: 'date', className: 'h-10 w-40' })}
      {textField('accountNumber', {
        type: 'text',
        placeholder: ACCOUNT_NUMBER_PLACEHOLDER,
        className: 'h-10 w-44 tabular-nums',
      })}
      {textField('amountMin', {
        type: 'number',
        step: 'any',
        inputMode: 'decimal',
        className: 'h-10 w-32 tabular-nums',
      })}
      {textField('amountMax', {
        type: 'number',
        step: 'any',
        inputMode: 'decimal',
        className: 'h-10 w-32 tabular-nums',
      })}
      {choiceField('transactionType', TRANSACTION_TYPE_OPTIONS)}
      {choiceField('currency', [ANY_OPTION, ...currencyOptions])}
      <Button
        type="button"
        variant="outline"
        onClick={onClearAll}
        className="h-10 font-semibold"
      >
        Clear all
      </Button>
    </Card>
  );
}

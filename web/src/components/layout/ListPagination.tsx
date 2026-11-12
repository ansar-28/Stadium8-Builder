'use client';

import { useId } from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { FIRST_PAGE, PAGE_SIZE_OPTIONS } from '@/lib/pagination';

interface ListPaginationProps {
  pageNumber: number;
  pageCount: number;
  pageSize: number;
  onPageChange: (pageNumber: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

/** Always-visible list footer controls: Rows per page, Previous, "Page n of pages", Next. */
export function ListPagination({
  pageNumber,
  pageCount,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: ListPaginationProps) {
  const rowsPerPageId = useId();

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center gap-3 text-sm"
    >
      <div className="flex items-center gap-2">
        <Label
          htmlFor={rowsPerPageId}
          className="text-sm font-normal text-muted-foreground"
        >
          Rows per page
        </Label>
        <NativeSelect
          id={rowsPerPageId}
          value={String(pageSize)}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
          className="h-9 tabular-nums"
        >
          {PAGE_SIZE_OPTIONS.map((pageSizeOption) => (
            <NativeSelectOption
              key={pageSizeOption}
              value={String(pageSizeOption)}
            >
              {pageSizeOption}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={pageNumber <= FIRST_PAGE}
        onClick={() => onPageChange(pageNumber - 1)}
        className="h-9"
      >
        Previous
      </Button>
      <span className="text-muted-foreground tabular-nums">
        {`Page ${pageNumber} of ${pageCount}`}
      </span>
      <Button
        type="button"
        variant="outline"
        disabled={pageNumber >= pageCount}
        onClick={() => onPageChange(pageNumber + 1)}
        className="h-9"
      >
        Next
      </Button>
    </nav>
  );
}

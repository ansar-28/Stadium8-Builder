'use client';

import { useId } from 'react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export const PAGE_SIZE_OPTIONS = [5, 10, 20, 50] as const;
export const DEFAULT_PAGE_SIZE = 20;

/** Number of pages for a list; an empty list still has one page. */
export function pageCountOf(totalCount: number, pageSize: number): number {
  return Math.max(1, Math.ceil(totalCount / pageSize));
}

/** The items on a 1-based page. */
export function pageOf<Item>(
  items: readonly Item[],
  pageNumber: number,
  pageSize: number,
): Item[] {
  const firstIndex = (pageNumber - 1) * pageSize;
  return items.slice(firstIndex, firstIndex + pageSize);
}

interface TablePaginationProps {
  /** Items shown on the current page. */
  shownCount: number;
  totalCount: number;
  /** Plural noun for the count, e.g. "files" → "Showing 20 of 25 files". */
  itemNoun: string;
  pageNumber: number;
  pageSize: number;
  onPageChange: (pageNumber: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

/** Table footer: count on the left; rows-per-page, Previous, "Page n of m" and Next on the right. */
export function TablePagination({
  shownCount,
  totalCount,
  itemNoun,
  pageNumber,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: TablePaginationProps) {
  const rowsPerPageLabelId = useId();
  const pageCount = pageCountOf(totalCount, pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 text-sm">
      <p className="text-muted-foreground">
        Showing {shownCount} of {totalCount} {itemNoun}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span id={rowsPerPageLabelId} className="text-muted-foreground">
            Rows per page
          </span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => onPageSizeChange(Number(value))}
          >
            <SelectTrigger
              aria-labelledby={rowsPerPageLabelId}
              className="min-h-10 w-20"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          variant="outline"
          className="min-h-10"
          disabled={pageNumber <= 1}
          onClick={() => onPageChange(pageNumber - 1)}
        >
          Previous
        </Button>
        <span className="tabular-nums">
          Page {pageNumber} of {pageCount}
        </span>
        <Button
          type="button"
          variant="outline"
          className="min-h-10"
          disabled={pageNumber >= pageCount}
          onClick={() => onPageChange(pageNumber + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

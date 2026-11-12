export const PAGE_SIZE_OPTIONS = [5, 10, 20, 50] as const;
export const DEFAULT_PAGE_SIZE = 20;
export const FIRST_PAGE = 1;

export interface PageSlice<Item> {
  items: Item[];
  /** The requested page, clamped into 1..pageCount. */
  pageNumber: number;
  /** At least 1, so an empty list still reads "Page 1 of 1". */
  pageCount: number;
}

/** One page of an already filtered and sorted list. */
export function slicePage<Item>(
  items: readonly Item[],
  requestedPageNumber: number,
  pageSize: number,
): PageSlice<Item> {
  const pageCount = Math.max(FIRST_PAGE, Math.ceil(items.length / pageSize));
  const pageNumber = Math.min(
    Math.max(FIRST_PAGE, requestedPageNumber),
    pageCount,
  );
  const startIndex = (pageNumber - 1) * pageSize;
  return {
    items: items.slice(startIndex, startIndex + pageSize),
    pageNumber,
    pageCount,
  };
}

# Story 3: Page through transactions

- **slug:** story-3-page-through-transactions
- **requirementIds:** R6, BR5, BR6
- **roles:** File Importer, Approver
- **route:** /transactions
- **targetFile:** web/src/app/(app)/transactions/page.tsx
- **pageAction:** modify_existing
- **isInfrastructureOnly:** false

## Summary

Adds always-visible footer pagination next to the count — "Rows per page" select (5/10/20/50, default 20), Previous, "Page <n> of <pages>", Next — with Previous disabled on page 1 and Next on the last page (including a single page). Pages are sliced client-side from the filtered, sorted list; changing the page size returns to page 1, and the current page clamps when filtering shrinks the page count.

## Plain summary

Below the list you choose how many rows to show (5, 10, 20 or 50 — 20 by default) and move between pages with Previous and Next, with "Page n of pages" telling you where you are. The page controls are always there, even when everything fits on one page.

## Acceptance criteria

- **AC-1** (vitest): The footer always shows "Rows per page" with 5, 10, 20 and 50 (20 selected by default), Previous, "Page <n> of <pages>" and Next, even when every transaction fits on one page
- **AC-2** (vitest): Previous is disabled on the first page and Next is disabled on the last page
- **AC-3** (vitest): Changing Rows per page shows that many rows and returns to page 1
- **AC-4** (playwright): Pressing Next and Previous moves through the pages, updating the rows and the "Page <n> of <pages>" label

## Manual test checklist

- Open Transactions → the footer shows "Rows per page" set to 20, "Page 1 of N", and Previous is greyed out
- Press Next → the next set of transactions shows and the label reads "Page 2 of N"
- Go to the last page → Next is greyed out
- Change Rows per page to 5 from page 2 → five rows show and you're back on page 1
- Filter down to a handful of transactions → the page controls are still shown, reading "Page 1 of 1" with both buttons greyed out

## Resolved design choices

- The previous-page button is labelled "Previous".

## Technical notes

- additionalTechnicalChecksCount: 0

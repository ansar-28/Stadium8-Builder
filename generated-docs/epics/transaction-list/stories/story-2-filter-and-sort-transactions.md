# Story 2: Filter and sort transactions

- **slug:** story-2-filter-and-sort-transactions
- **requirementIds:** R3, R4, R9, R11, BR2, BR4, BR5, BR7, NFR1, NFR3
- **roles:** File Importer, Approver
- **route:** /transactions
- **targetFile:** web/src/app/(app)/transactions/page.tsx
- **pageAction:** modify_existing
- **isInfrastructureOnly:** false

## Summary

Adds the filter card (Date from, Date to, Account number with placeholder, Amount min, Amount max, Transaction type Any/Credit/Debit, Currency Any/…; visible labels, Clear all) and client-side AND filtering on the full loaded list (account number contains, inclusive date and amount bounds, "Any" = no restriction), keeping the count as "Showing <filtered> of <total>". Every data header becomes a keyboard-operable sort button with ▲/▼ and aria-sort (new column ascending, active column toggles; default Date descending). Adds the no-match state ("No transactions match these filters", active-filter chips, Clear all). Filtering and sorting reset to page 1. Filter/sort derivation is memoised over the full list so a 1,000-transaction list stays within the 200 ms render target.

## Plain summary

A filter card lets you narrow the list by Date from/to, Account number, Amount min/max, Transaction type and Currency — the list updates as you type and only shows transactions matching every filter. Clicking any column header sorts by it, and when nothing matches you see the active filters and a "Clear all" button.

## Acceptance criteria

- **AC-1** (vitest): The filter card shows the labelled filter fields specified in the brief, and combining filters shows only transactions matching every one (account number contains the text, date and amount bounds inclusive, "Any" means no restriction), with the count reading "Showing <filtered> of <total> transactions"
- **AC-2** (vitest): When the filters match nothing, the list shows "No transactions match these filters", a chip for each active filter and a "Clear all" button that brings back the full list
- **AC-3** (vitest): Clicking a column header sorts by that column ascending, clicking it again sorts descending, and the active header shows ▲ or ▼
- **AC-4** (vitest): Every sortable header can be operated from the keyboard and tells assistive technology its current sort direction
- **AC-5** (playwright): On page 2 or later, applying a filter or sorting a column narrows or re-orders the list and returns to page 1
- **AC-6** (none): A list of 1,000 transactions renders and re-renders after a filter or sort within 200 ms

## Manual test checklist

- Type part of an account number into Account number → only transactions whose account number contains it remain, and the "Showing x of y" count drops
- Set Amount min and Amount max → only amounts within (and including) those values remain
- Choose Transaction type "Debit" and a Currency together → only transactions matching both show
- Set filters that match nothing → you see "No transactions match these filters", chips for your filters, and "Clear all" brings everything back
- Click the Amount header → the list sorts smallest first with ▲; click again → largest first with ▼
- Tab to a column header and press Enter → the list sorts by that column

## Resolved design choices

- Only the Account number filter shows example text ("1001-2034"), as in the design.
- The Currency filter offers "Any" plus whatever currencies appear in the loaded transactions.

## Technical notes

- additionalTechnicalChecksCount: 2

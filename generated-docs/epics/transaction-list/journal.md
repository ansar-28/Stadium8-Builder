
## Story 1 — Transaction list with days pending
- Added an info-text colour (design-system info blue in light mode, the prototype's light blue in dark mode) so the Credit chip has a token like the other status chips.
- Status and Type chips are outlined in light mode and tinted in dark mode; a light tint would push the green and amber status text below the required contrast.

## Story 2 — Filter and sort transactions
- The Currency filter offers "Any" plus the currencies found in the loaded transactions, in alphabetical order, as agreed in the story's design choices.
- Account number matching ignores upper/lower case and spaces at either end of the typed text. "Date to" counts the whole of the chosen day.

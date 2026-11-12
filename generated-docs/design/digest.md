# Design Digest — Transaction Management

A staff-facing transaction-approval tool: sign-in, a transaction list where Approvers approve or reject pending transactions (singly or in bulk, with a confirmation dialog and a mandatory rejection reason), a list of uploaded .csv files with download, an upload screen for File Importers, and an export screen for approved/rejected transactions. Shipped with a brand design system (light and dark token sets, Open Sans, brand blue `#004B8D`) and a requirements document that the prototype follows closely.

| Field | Value |
|---|---|
| Read from | `documentation/Prototype.html` (a single self-unpacking bundle — its embedded markup, styles and screen logic were decoded and read), `documentation/design-system-light.html`, `documentation/design-system-dark.html`; context from `documentation/requirements-application.md` and `documentation/transactions_2026-04-15.csv` |
| Artifact verdict | design — five screens plus app shell and two dialogs, with full copy, styles and behaviour; a separate light/dark token catalogue |
| Interpreter confidence | high for screens, copy and palette (all read as text); medium for which theme ships and which status colours apply (the prototype and design system disagree — see Uncertainties) |
| Last updated | 2026-11-12T00:00:00Z |

---

## Your Decisions

- **Theme — both light and dark, following the computer's setting by default, with a header switch to override** *(sign-in-and-app-shell, 2026-11-12)*
  Overrides the prototype being dark only.
- **Sign in — the password is hidden as typed (dots), with a show/hide button** *(sign-in-and-app-shell, 2026-11-12)*
  Overrides the prototype's plain-text password field.
- **Notifications — each has a close button; success messages fade after a few seconds, errors stay until closed** *(sign-in-and-app-shell, 2026-11-12)*
  Overrides the prototype's 4.5-second auto-hide with no close button.

---

## Screens

### Sign in

- **Purpose:** User signs in with username and password; the app then opens on Transactions with only the actions their roles allow.
- **Layout:** Full-viewport centred card (max width 400px) on the page background with a soft dark-blue radial glow top-left (`#0f2740`). Card: heading, subtitle, then a vertical stack of the two fields, an inline error slot, and a full-width primary button.
- **Fields:**
  - Label "Username" — text input, no placeholder, autocomplete off.
  - Label "Password" — rendered as a **plain text input** (characters visible), no placeholder, autocomplete off.
- **Validation:**
  - Either field blank (after trim) → "Username and password are required."
  - Credentials rejected → "Sign-in failed. Check your details and try again." (generic — never says which entry was wrong)
  - Errors appear inline below the fields as an alert (`role="alert"`), in error-red text; editing either field clears the error.
- **Navigation:** "Sign in" (submit) → Transactions screen (shows a loading placeholder first).
- **Copy:**
  - Heading: "Transaction Management"
  - Subtitle: "Sign in to review, decide and export transactions."
  - Button: "Sign in"
  - Prototype-only helper block (demo affordance, see Translate, Don't Copy): "Prototype accounts, password **demo**:" with quick-fill buttons "carol · File Importer", "bob · Approver", "alice · both roles".

### App shell (header, navigation, notifications)

- **Purpose:** Persistent frame on every signed-in screen: product name, primary navigation, who is signed in and their roles, sign-out, and transient notifications.
- **Layout:** Full-width header bar in the brand colour (`#004B8D`) with light text; wraps on narrow widths. Left: product name (semibold, 16px). Middle: horizontal tab-style nav buttons (min height 44px); the active item is white with a 3px white bottom border, inactive items are light blue (`#cfe0f2`) and turn white on hover. Right: user's display name, one pill chip per role (translucent white), and an outlined "Sign out" button. Content area below: max width 1280px, centred, 24px padding. Each page starts with a header row: light-weight (300) 26px title with a muted 13px description line beneath, and an optional primary action aligned right. Notifications appear as a toast bottom-right (max width 420px, raised surface, 4px primary-blue left edge, `role="status"`, polite live region), auto-hiding after about 4.5 seconds.
- **Fields:** none.
- **Validation:** none.
- **Navigation:**
  - "Transactions" → Transactions
  - "Files" → Uploaded files
  - "Upload" → Upload transaction file — **shown only to users holding the File Importer role**
  - "Export" → Export actioned transactions
  - "Sign out" → label changes to "Signing out…" while the sign-out completes, then returns to Sign in (clears selections, dialogs, password).
  - Changing view clears any selections and upload messages.
- **Copy:**
  - Product name: "Transaction Management"
  - Nav: "Transactions", "Files", "Upload", "Export" (nav landmark labelled "Main")
  - Role chip text: "File Importer", "Approver"
  - "Sign out" / "Signing out…"

### Transactions

- **Purpose:** View all transactions read in (read-only), filter and sort them, see days pending; Approvers approve or reject pending transactions individually (row icons) or in bulk (selection + bulk bar).
- **Layout:**
  - Page header: title + description (no header action).
  - Filter card: a wrapping row of labelled filter fields (small 12px semibold muted labels above inputs), ending with a "Clear all" button. Filters apply immediately on change and reset to page 1. Filters have no sort controls.
  - Bulk-action bar (only for Approvers, only when ≥1 row selected): tinted primary-blue strip with the selection count in bold, then "Approve selected" (primary), "Reject selected" (destructive red), "Clear selection".
  - Loading state: a list-shaped skeleton (five shimmering bars of varying width; shimmer disabled under reduced-motion) inside the table container, `aria-busy`.
  - Table: horizontally scrollable bordered container; header row on a raised background with uppercase 12px muted labels; rows separated by thin borders; selected rows tinted primary blue. Columns, left to right:
    1. *(Approvers only)* selection checkbox — small (14px, i.e. 75% of the export-list checkbox size); header checkbox selects all **pending** rows on the current page.
    2. *(Approvers only)* unlabelled row-action column (84px): on **pending** rows only, two 32px square outlined icon buttons — a green tick (approve) and a red cross (reject). On rows from a file the signed-in user uploaded, both icons are dimmed (50% opacity) and their tooltip reads "From a file you uploaded"; clicking them opens the Decision blocked dialog.
    3. Reference (tabular numerals)
    4. Date (date + time, tabular numerals)
    5. Account number (shown in full, tabular numerals)
    6. Description
    7. Amount (right-aligned, tabular numerals, two decimals, space as thousands separator, e.g. "12 345.35")
    8. Type — chip: Credit (light-blue tint) / Debit (grey tint)
    9. Currency
    10. Status — chip: Pending (amber), Approved (green), Rejected (red); a rejected row shows "Reason: <reason>" in small muted text under the chip
    11. Days pending — "1 day" / "N days" for pending rows, "—" otherwise
  - Every data column header is a sort button showing " ▲" / " ▼" on the active column and exposing `aria-sort`; clicking a new column sorts ascending, clicking the active column toggles direction; sorting resets to page 1. Default sort: Date, descending. There is no "Decision" column.
  - Non-pending rows' checkboxes are disabled, with tooltip "<Status> — decision is final" (e.g. "Approved — decision is final").
  - Footer row: count on the left; on the right "Rows per page" select (5 / 10 / 20 / 50, default 20), "Previous" button, page label, "Next" button (Previous/Next disabled at the ends). Pagination always shown.
- **Fields (filters):**
  - "Date from" — date input
  - "Date to" — date input
  - "Account number" — text, placeholder "1001-2034" (matches any account number containing the text)
  - "Amount min" — number
  - "Amount max" — number
  - "Transaction type" — select: "Any", "Credit", "Debit"
  - "Currency" — select: "Any", "ZAR", "USD", "EUR"
- **Validation:** none on filters.
- **Navigation:**
  - Tick / "Approve selected" → Decision confirmation dialog (approve), or Decision blocked dialog if any affected transaction is from the user's own upload.
  - Cross / "Reject selected" → Decision confirmation dialog (reject, with reason), or Decision blocked dialog as above.
  - Empty-state "Upload a file" (File Importers only) → Upload transaction file.
- **Copy:**
  - Title: "Transactions"
  - Description: "Transaction data is read-only. Decisions are final."
  - "Clear all"
  - Bulk bar: "1 transaction selected" / "N transactions selected"; "Approve selected", "Reject selected", "Clear selection" (region labelled "Bulk actions")
  - Column headers: "Reference", "Date", "Account number", "Description", "Amount", "Type", "Currency", "Status", "Days pending"
  - Accessible labels: header checkbox "Select all pending transactions on this page"; row checkbox "Select <Reference>"; row icons "Approve <Reference>" / "Reject <Reference>", tooltips "Approve" / "Reject"; action column "Row actions"
  - Count: "Showing <filtered> of <total> transactions"
  - Pagination: "Rows per page", "Previous", "Page <n> of <pages>", "Next"
  - Empty (no data): **"No transactions yet"** — "Transactions appear here once a file has been uploaded." + (File Importer only) button "Upload a file"
  - Empty (filters match nothing): **"No transactions match these filters"** — "Active filters:" followed by a row of chips, then button "Clear all". Chip texts: "From <date>", "To <date>", "Account: <value>", "Min amount: <value>", "Max amount: <value>", "Type: <value>", "Currency: <value>"
  - Toast after a decision: "Transaction <Reference> was approved." / "Transaction <Reference> was rejected." / "<N> transactions were approved." / "<N> transactions were rejected."

### Decision confirmation dialog

- **Purpose:** Confirm an approve or reject of one or more transactions, naming them, and (for reject) capture one mandatory reason.
- **Layout:** Modal over a dark 62% scrim; card max width 520px, raised surface, 1px border, large shadow; `role="dialog"`, `aria-modal`, labelled by its title. Title (20px semibold); a bulleted list of affected transactions (tabular numerals) — at most six listed as "<Reference> · <Description> · <Currency> <Amount>", then "and <N> more"; for reject, a labelled 3-row textarea and an inline error slot; an amber semibold "final" warning line; actions right-aligned: "Cancel" then the confirm button. **Focus starts on "Cancel"** when the dialog opens.
- **Fields:**
  - Reject only — textarea labelled "Rejection reason" (single transaction) or "Rejection reason (applies to every selected transaction)" (more than one). No placeholder.
- **Validation:**
  - Reject with blank reason, single → "Enter a rejection reason to continue."
  - Reject with blank reason, multiple → "Enter one rejection reason for the selection."
  - Dialog stays open; error shown as alert; typing clears it.
- **Navigation:** "Cancel" closes with no change. Confirm records the decision, closes the dialog, clears the selection and shows the decision toast (see Transactions).
- **Copy:**
  - Title: "Approve 1 selected transaction?" / "Approve <N> selected transactions?" / "Reject 1 selected transaction?" / "Reject <N> selected transactions?"
  - Warning: "This decision is final."
  - Buttons: "Cancel"; confirm "Approve" (primary blue) or "Reject" (destructive red)

### Decision blocked dialog

- **Purpose:** Refuse an approve/reject that touches transactions from a file the signed-in user uploaded (segregation of duties); a bulk action containing any such transaction is refused whole.
- **Layout:** Same modal shell as the confirmation dialog but `role="alertdialog"`; title, explanatory paragraph, bulleted list of the blocked References (tabular numerals), muted 13px help line, single right-aligned primary "Close" button (focused on open).
- **Fields:** none.
- **Validation:** none.
- **Navigation:** "Close" dismisses; nothing changes.
- **Copy:**
  - Single transaction — title "You cannot decide this transaction"; text "This transaction is from a file you uploaded. You cannot approve or reject transactions from your own upload."; help "Another user with the Approver role can decide it."
  - Bulk — title "The whole action was refused"; text "No status was changed. These selected transactions are from a file you uploaded:"; help "Remove them from the selection, or ask another Approver to decide them."
  - Button: "Close"

### Uploaded files

- **Purpose:** View every successfully uploaded file with its upload timestamp, and download any of them. Same for both roles.
- **Layout:** Page header with title + description and, for File Importers, a primary "Upload a file" button on the right. Table (min width 560px) with columns File name, Upload timestamp (tabular numerals), and an unlabelled 140px action column holding a per-row "Download" button. Newest file first. Footer with count and the same pagination controls as Transactions. Column headers here are plain (not sort buttons).
- **Fields:** none.
- **Validation:** none.
- **Navigation:** "Upload a file" (File Importers only) → Upload transaction file. "Download" saves the file locally and shows a toast.
- **Copy:**
  - Title: "Uploaded files"
  - Description: "Every successfully uploaded .csv file, with its upload timestamp."
  - Columns: "File name", "Upload timestamp"; action column has visually-hidden header "Download"
  - Row button: "Download" (accessible label "Download <file name>")
  - Count: "Showing <n> of <total> files"
  - Empty: **"No files yet"** + (File Importer only) "Upload a file"
  - Toast: "<file name> downloaded."

### Upload transaction file

- **Purpose:** File Importer chooses a .csv file and uploads it; the app checks the seven-column layout and reports the outcome.
- **Layout:** Page header with title + description; a single card (max width 640px) containing a labelled file input, a "Selected: **<name>**" line once a file is chosen, a row of buttons, and an outcome banner (`role="status"`) — green-bordered on success, red-bordered on failure.
- **Fields:** Label "Choose a .csv file" — file input accepting `.csv`.
- **Validation:**
  - Nothing chosen → "Choose a .csv file to upload."
  - Not .csv, or header row is not exactly `Reference,TransactionDate,AccountNumber,Description,Amount,TransactionType,Currency` → banner "The file could not be uploaded. Only the seven-column .csv layout is accepted." plus toast "The file <name> was rejected at upload."
- **Navigation:** "Upload file" submits. On success the file joins the top of Uploaded files and its transactions appear as Pending on Transactions.
- **Copy:**
  - Title: "Upload transaction file"
  - Description: "Only the seven-column .csv layout is accepted: Reference, TransactionDate, AccountNumber, Description, Amount, TransactionType, Currency."
  - "Selected: <name>"
  - Button: "Upload file" (primary)
  - Prototype-only buttons (demo affordance): "Use a valid sample", "Use an invalid sample"
  - Success banner: "<name> was uploaded. It appears in the file list and its 4 transactions are pending." (the "4" is the prototype's canned count — see Uncertainties)

### Export actioned transactions

- **Purpose:** View approved and rejected transactions (never pending), filter/sort/select them and export the selection to .csv, or quick-export a day/week/month.
- **Layout:**
  - Page header with title + description.
  - "Quick export" card: small 16px semibold heading, then a filter row with Period and Decision selects and a primary "Quick export" button.
  - Filter card: wrapping row of filters ending with "Clear all" (no currency filter; filters have no sort controls).
  - Selection bar, **always visible** (tinted primary strip): selection count in bold, "Export selected" (primary) and "Clear selection" — both disabled when nothing is selected.
  - Table like Transactions but: full-size (18px) checkboxes on every row (all rows selectable); header checkbox selects all rows on the page; no row-action column; no Days pending column. Columns: selection, Reference, Date, Account number, Description, Amount (right-aligned), Type chip, Currency, Status chip (with "Reason: <reason>" under rejected). All data columns sortable as on Transactions; default Date descending.
  - Footer: count + pagination as on Transactions.
- **Fields:**
  - Quick export — "Period" select: "Day" (default), "Week", "Month"; "Decision" select: "Approved and rejected" (default), "Approved", "Rejected".
  - Filters — "Approval state" select: "Approved and rejected", "Approved", "Rejected"; "Date from" (date); "Date to" (date); "Account number" (text, no placeholder); "Amount min" (number); "Amount max" (number); "Transaction type" select: "Any", "Credit", "Debit".
- **Validation:** none. Export with no matching/selected rows → toast "Nothing is available to export for that selection."
- **Navigation:** "Export selected" / "Quick export" download a .csv named `actioned-transactions-<YYYY-MM-DD>.csv` (today's date) with header `Reference,TransactionDate,AccountNumber,Description,Amount,TransactionType,Currency,Status`; Amount at two decimals, TransactionType written as `C`/`D`, Description quoted. Prototype's quick-export window: Day = today; Week = today and the previous 6 days; Month = today and the previous 29 days.
- **Copy:**
  - Title: "Export actioned transactions"
  - Description: "Approved and rejected transactions only. The .csv uses the import layout plus a Status field."
  - "Quick export" (card heading and button)
  - Selection bar: "0 transactions selected" / "1 transaction selected" / "N transactions selected"; "Export selected", "Clear selection"
  - Header checkbox label: "Select all transactions on this page"
  - Count: "Showing <filtered> of <total> transactions"
  - Empty: **"Nothing is available to export"** — "Change the filters to see approved or rejected transactions. Pending transactions are never offered." + button "Clear all"
  - Active-filter chip text includes "Approval state: <value>" (plus the Transactions chip forms other than currency)
  - Toast on export: "<file name> downloaded: 1 transaction." / "<file name> downloaded: <N> transactions."

---

## Palette & Typography

Two sources. The **design system** files define named brand tokens for light and dark modes (light is the source of truth; dark is derived from it). The **prototype** is built in dark mode only and uses the dark tokens plus a few extra surface/status values of its own.

| Token | Value | Where found |
|---|---|---|
| Primary (light) | `#004B8D` | `design-system-light.html` (extracted from brand site) |
| Primary (dark) | `#2868AD` | `design-system-dark.html`; prototype `--primary` (buttons, focus accents, selection tint) |
| Primary hover (dark) | `#3274bd` | prototype only |
| Brand (both modes) | `#004B8D` | both design-system files — "identity only (header / logo strip / brand mark / empty state; never a button, link, badge, focus ring or text)"; prototype header bar |
| Secondary (light / dark) | `#4D5660` / `#363E48` | design-system files |
| Accent (both) | `#156CBC` | design-system files |
| Background (light) | `#FFFFFF` | `design-system-light.html` |
| Background (dark) | `#0C1015` | `design-system-dark.html`; prototype page/input background |
| Surface (light) | `#F1F4F8` | `design-system-light.html` |
| Surface (dark) | `#161B21` | `design-system-dark.html`; prototype cards, table container, sign-in card |
| Card / raised (dark) | `#1c2229` / `#23282f` | prototype only (table header, dialogs, toast / secondary buttons, filter chips); hover `#2c333b` |
| Border / strong border (dark) | `#2e353d` / `#4b535c` | prototype only |
| Text (light / dark) | `#292B2C` / `#EBEFF4` | design-system files; prototype uses `#EBEFF4` |
| Text muted (light / dark) | `#51565C` / `#9A9FA5` | design-system files; prototype uses `#9A9FA5` |
| On-colour text (all fills) | `#F6F9FC` | design-system `--on-*`; prototype `--on` |
| Success (light / dark) | `#15803D` / `#15803D` | design-system files |
| Warning (light / dark) | `#B45309` / `#B45309` | design-system files |
| Error (light / dark) | `#B91C1C` / `#C42A26` | design-system files; prototype destructive button fill `#C42A26` |
| Info (light / dark) | `#0369A1` / `#0A6CA4` | design-system files |
| Status text — ok / warn / err / info (dark) | `#4ade80` / `#fbbf24` / `#f87171` / `#7db4ea` | prototype only — chip text (Approved / Pending / Rejected / Credit), tick/cross icons, error text, "final" warning, focus outline (`#7db4ea`); chip backgrounds are the same colours at 16% alpha. Debit chip: text `#c3c8ce` on `rgba(154,159,165,.18)` |
| Header nav inactive | `#cfe0f2` | prototype only |
| Sign-in backdrop glow | `#0f2740` | prototype only |

- **Font (headings):** 'Open Sans', sans-serif — weight 300 (design system `heading-family`; prototype h1/h2/h3 weight 300, dialog titles 600)
- **Font (body):** 'Open Sans', sans-serif — weight 400; semibold 600 for labels, buttons, chips
- **Font (monospace / numerals):** no monospace family; numeric cells use tabular figures (`font-variant-numeric: tabular-nums`)
- **Type scale (design system):** text-xs `0.6875rem`, text-sm `0.8125rem`, text-base `0.9375rem`, text-lg `1rem`, text-xl `1.125rem`, text-2xl `1.375rem`, text-3xl `1.625rem`, text-4xl `2rem`. Line heights: tight `1.2`, base `1.45`, loose `1.65`. Prototype body 15px / 1.45; controls 14px; page titles 26px.
- **Radius:** prototype `6px` for buttons/inputs/icon buttons, `8px` cards/tables/bars/toast, `10px` dialogs and sign-in card, pill (`99px`) for chips.
- **Shadows (light):** sm `0 1px 2px 0 rgba(41, 43, 44, 0.05)`, md `0 4px 6px -1px rgba(41, 43, 44, 0.08)`, lg `0 10px 15px -3px rgba(41, 43, 44, 0.10)`. **(dark):** sm `0 1px 2px 0 rgba(0, 0, 0, 0.10)`, md `0 4px 6px -1px rgba(0, 0, 0, 0.16)`, lg `0 10px 15px -3px rgba(0, 0, 0, 0.20)`. Prototype dialogs and toast use `0 10px 15px -3px rgba(0,0,0,.5)`.
- **Motion:** transition-fast `100ms`, transition-base `160ms`, transition-slow `240ms`, easing-standard `cubic-bezier(0.4, 0, 0.2, 1)`.
- **Focus ring (prototype):** `2px solid #7db4ea`, offset `2px`, on buttons, inputs, selects, textareas and links.
- **Control sizing (prototype):** buttons min height 40px, nav items 44px, inputs 40px, sortable header cells 44px.
- **Theme:** the prototype is dark only; the design system defines both light and dark (see Uncertainties).
- **Design-system standards (house rules shipped in both design-system files):** every table column sortable with visible `aria-sort`; footer pagination always shown with page-size 5/10/20/50, default 20, and "Page X of Y"; rows never clickable, with actions in a dedicated column; numeric columns right-aligned; date fields are calendar pickers; every input has a visible label and a placeholder; modals trap focus, close on Esc, have shadow plus 1px border, and return focus on close; toasts dismissible, with errors persisting until acknowledged; sentence-case labels; WCAG AA; 44×44px touch targets; honour `prefers-reduced-motion`.

---

## Data Shapes

Informed by the prototype's screens and canned data, confirmed against `requirements-application.md` §7 and the sample CSV.

- **Transaction** — id (hidden), file id (link to uploaded file, hidden), reference (e.g. `TXN-20260415-0001`), transaction date+time, account number (text, e.g. `1001-2034-5567`, shown unmasked), description, amount (unsigned number; direction from type), transaction type (Credit | Debit; import file uses `C` | `D`), currency (3-letter code: ZAR, USD, EUR seen), status (Pending | Approved | Rejected), rejection reason (only when Rejected). Derived: days pending = whole days from the owning file's upload date to today, while Pending.
- **Uploaded file** — id, file name, upload timestamp, uploaded-by user (needed for the own-upload block; the requirements say the backend contract does not have this field).
- **Decision** — transaction id(s), action (approve | reject), one reason shared by all transactions in a bulk reject, deciding user.
- **User** — username, display name (prototype shows full name, e.g. "Carol Mokoena"), roles (File Importer and/or Approver).
- **Login request** — username, password.
- **Export row** — the seven import columns plus Status (see Export screen for the file layout).

---

## Assets

- No logo or image assets; the header shows the product name as text only.
- Icons: two inline line icons in the prototype — a check mark (approve) and an X (reject), 18px, stroke width 2.6.
- Fonts: Open Sans (weights 300/400/600/700, latin subset) embedded in the prototype bundle and in both design-system files; the prototype also references Google Fonts for the other character subsets.
- The prototype bundle also carries a React 18 runtime and its own prototype rendering script. These are runtime files, not design assets.

---

## Translate, Don't Copy

- **Canned data → real data.** The prototype generates 36 sample transactions, three sample files, a fixed "today" (2026-04-16), three demo users and a fixed password. None of this is real; screens read the configured data source.
- **Demo affordances are not product features.** The sign-in "Prototype accounts" quick-fill block and the upload screen's "Use a valid sample" / "Use an invalid sample" buttons exist only to drive the prototype.
- **Simulated behaviour → real behaviour.** Sign-in checks, role lookup, the layout check on upload, the own-upload block, decision recording, the timed loading skeleton, the sign-out delay, and the file download (which in the prototype yields a header-only file) are faked client-side in the prototype.
- **Remote/embedded runtime → our stack.** The prototype's bundled React runtime, Google-Fonts links and template bindings are packaging, not design. Re-express the fonts, icons and markup within the project's stack.
- **Inline styles and hard-coded hex → design tokens and primitives.** The prototype's class styles and inline `style` attributes show visual intent. Express them through the design-system tokens above, not as copied CSS.
- **View switching → real navigation.** The prototype swaps views in place with no URLs. The design-system standards ask that the current view be reflected in the URL.

---

## Uncertainties

- **Theme:** The prototype is dark only, but the design system defines a light palette (the brand source of truth) and a derived dark palette. Should the app ship light only, dark only, or both with a switch?
- **Status colours:** The prototype's chip, icon and error colours (`#4ade80`, `#fbbf24`, `#f87171`, `#7db4ea`) are brighter tints than the design system's dark status tokens (success `#15803D`, warning `#B45309`, error `#C42A26`, info `#0A6CA4`). Which set applies? The extra prototype surfaces (`#1c2229`, `#23282f`, `#2e353d`, `#4b535c`) also have no design-system token.
- **Password visibility:** The prototype's Password field shows the characters as typed (plain text input). The requirements also say "both entries are shown as entered". Please confirm the password should not be masked.
- **Upload success copy:** "…its 4 transactions are pending." uses the prototype's fixed count. Should the real message state the actual number of transactions, and does the upload response provide it? If not, what wording should it use?
- **Still-loading message:** The requirements ask for a still-loading message after three seconds on the transaction list. The prototype only shows a skeleton and gives no wording.
- **Upload permission-denied banner:** The requirements describe a banner naming the missing permission (with a path to request access) for a non-File-Importer who reaches the upload screen. The prototype has no design or copy for it; it only hides the nav item.
- **Error states not designed:** There is no design or copy for a failed transaction-list load, a failed file download, a failed decision call, or a failed export. The requirements say to show the server's message. Where should it appear (toast, banner, or inline)?
- **Toast persistence:** Prototype toasts auto-hide after about 4.5 s and have no dismiss control, including the "rejected at upload" notice. The design-system standards say toasts are dismissible and errors persist until acknowledged. Which rule applies?
- **Pagination label:** The prototype says "Previous"; the design-system standard names the control "Back". Which label?
- **Placeholders:** The design-system standard says every field has a placeholder. The prototype gives one only for the Transactions "Account number" filter ("1001-2034"). Should other fields get placeholders, and with what text?
- **Date and amount display format:** The prototype shows dates as `YYYY-MM-DD HH:mm` and amounts as `12 345.35` (space thousands separator, currency in its own column, no symbol). The design-system standards call for locale-aware dates and an explicit currency symbol. Please confirm the formats.
- **Quick-export periods:** The prototype treats Week as the last 7 days and Month as the last 30 days, counting back from today. Should these instead be the calendar week or month?
- **Export file details:** The prototype names files `actioned-transactions-<date>.csv` and writes TransactionType as `C`/`D` and dates as `YYYY-MM-DD HH:mm`. Please confirm the filename and value formats (the sample import file writes dates as `2026/04/15 08:12`).
- **Files table sorting:** The design-system standard says every table column is sortable. The prototype's Uploaded files table has no sort controls and lists newest first. Should it be sortable?
- **Session timeout warning:** The requirements set a 15-minute idle timeout with a 60-second warning. The prototype has no design for the warning.
- **Brand identity:** The design-system files are titled for "discovery.co.za" and use its brand blue, but there is no logo. The header shows only "Transaction Management". Please confirm the product name and whether a logo belongs in the header.

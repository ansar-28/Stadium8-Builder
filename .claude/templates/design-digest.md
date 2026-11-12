<!--
This template defines the design digest for the comprehend-don't-parse design path.

Filename contract: generated-docs/design/digest.md (a generated artifact — NOT
under documentation/, which is read-only user input). Committed on whatever branch
owns the current design (main after a design epic merges; the epic branch while a
design update is in flight — see .claude/policies/epic-branch-concurrency.md §6.2).

WHAT THIS IS
  The digest is the design-interpreter agent's normalized, our-format description
  of the user's design. It is the QUARANTINE BOUNDARY: the interpreter is the only
  thing that ever reads the raw design files (any shape, any dialect); every
  downstream consumer — intake-agent, feature-planner, developer, type-generator,
  styling — reads THIS FILE, never the raw design. Route one thing through the
  interpreter → one thing to fix when the export format drifts.

PURE MARKDOWN — no YAML front-matter, no machine parsing. "Structured" means
consistent per-screen headings + a palette table (the same way project.md uses
tables while staying pure markdown). Nothing parses it; every consumer reads it by
comprehension. A JSON schema would re-introduce the very format-rigidity this path
exists to escape.

DIGEST-CARRIES-VERBATIM (load-bearing)
  The developer builds from the digest, not from the raw design. So anything that
  must match the design EXACTLY — field labels, placeholder/helper text, validation
  rules and their error text, on-screen copy, brand colour values — is carried here
  VERBATIM, not paraphrased. Quote it. If you summarise copy, the build ships the
  summary.

THE UNCERTAINTIES SECTION IS NOT OPTIONAL
  It is what turns a silent misread into a visible question at INTAKE. Anything the
  interpreter could not determine from the files goes there so the user can correct
  it before BUILD. An empty design read is still a design read with a full
  uncertainties list — never omit the section.

ON UPDATE: RECONCILE, DON'T REWRITE
  When the design changes, the interpreter re-reads documentation/ from scratch but
  updates THIS FILE IN PLACE (via Edit) — only the sections the design actually
  changed; untouched ones stay byte-for-byte identical. It matters because this file
  also holds content the design files never said (below). Full rules:
  design-interpreter.md § Updating an existing digest.

YOUR DECISIONS OVERRIDE THE DESIGN (load-bearing)
  A design file is not the last word — the user is. The Your Decisions section
  OUTRANKS every screen entry. Screen entries still describe THE CURRENT DESIGN, so
  when a decision contradicts one, both stay: the entry says what the design says,
  the decision says what to build.

Replace every [bracketed placeholder]. Delete sections only when the reading genuinely
found nothing for them AND that absence is recorded under Uncertainties — except Your
Decisions, which is always present, empty or not.
-->

# Design Digest — [Project / design name]

[1–2 sentences: what this design appears to be, in plain language. e.g. "A staff
admin console: sign-in, a dashboard listing recent orders, and an order-detail
screen with a refund action."]

| Field | Value |
|---|---|
| Read from | [the file(s) under documentation/ the interpreter comprehended, e.g. `documentation/acme.dc.html`, `documentation/styles.css`] |
| Artifact verdict | [design / not-a-design / partial — with a one-line reason] |
| Interpreter confidence | [high / medium / low — overall, for the reader's calibration] |
| Last updated | [ISO 8601 timestamp — from the `timestamp` the orchestrator passes on each run] |

---

## Your Decisions

<!--
THESE OVERRIDE EVERYTHING BELOW. Written and maintained by the ORCHESTRATOR only —
the interpreter carries this section through untouched, never edits or re-words it,
and never re-raises a question answered here.

Append one bullet per decision, newest last. Three things land here:
  1. An answer to something the design files don't say ("what's your brand colour?",
     "where should this button go?") — settled at an approval.
  2. A change the user asked for mid-epic that DELIBERATELY differs from the design
     (e.g. while manual-testing: "move the filter to the right"). Not bug fixes —
     only changes that would be undone by rebuilding the screen from the design.
  3. Behaviour an already-built app deliberately has, where the design says
     otherwise (a project that had a design before this workflow read it).

A question answered here is CLOSED — it does not also appear under Uncertainties. If a
later design contradicts a decision, the decision STANDS and the conflict is raised
with the user; strike an entry only when the user says the new design wins.

ALWAYS WRITE THIS SECTION, even when empty — use the "nothing yet" line below, so the
orchestrator never has to create it and every reader can count on finding it.
-->

*Nothing yet — this fills in as you settle things while we build.*

<!-- Once there are decisions, replace the line above with bullets in this shape: -->

- **[Screen or topic] — [what was decided, in the user's terms]** *(<epic slug, or "intake">, <YYYY-MM-DD>)*
  [Optional: the question or design detail it overrides, so a later reader knows why it's here.]

---

## Screens

<!--
One entry per screen the interpreter comprehended. A "screen" is a distinct surface
a user lands on — however the source organises it, and whether or not it maps to a
route. Carry copy VERBATIM.
-->

### [Screen name]

- **Purpose:** [what the user does here, in plain language]
- **Layout:** [prose: element arrangement, regions, responsive intent — describe, don't copy markup]
- **Fields:** [each input: label, placeholder, helper text — VERBATIM. e.g. Label "Work email", placeholder "you@company.com", helper "We'll never share this."]
- **Validation:** [rules + error text — VERBATIM. e.g. Email required → "Enter your work email"; min 8 chars → "Password must be at least 8 characters."]
- **Navigation:** [which control leads to which screen. e.g. "Sign in" → Dashboard; "Forgot password?" → Reset screen]
- **Copy:** [any on-screen text that must appear verbatim — headings, button labels, empty states, legal microcopy]

### [Next screen name]

- **Purpose:** …
- **Layout:** …
- **Fields:** …
- **Validation:** …
- **Navigation:** …
- **Copy:** …

---

## Palette & Typography

<!--
Brand colours as RAW VALUES, verbatim, wherever the interpreter found them —
inline, a separate stylesheet, or asked from the user. Raw hex is preferred (per
styling-centralisation.md — Tailwind v4 oklch approximations drift from brand). If
a value's source is unclear or missing, say so and add it to Uncertainties.
-->

| Token | Value | Where found |
|---|---|---|
| Primary | `#XXXXXX` | [inline `:root` block / `styles.css` / you told us (see Your Decisions)] |
| Accent / secondary | `#XXXXXX` | […] |
| Background (light) | `#XXXXXX` | […] |
| Background (dark, if any) | `#XXXXXX` | […] |

- **Font (headings):** [family]
- **Font (body):** [family]
- **Theme:** [light only / dark only / both]

---

## Data Shapes

<!--
The entities and fields behind the screens — the data-model signal. Inferred from
what the screens display and collect, informed by any type/schema/data-model file
that happened to ship with the design (don't assume one does or doesn't exist).
Feeds type-generator and the epics' data models; flag guesses under Uncertainties.
-->

- **[Entity]** — [fields the screens imply, e.g. Order: id, customer name, total, status, placed-at]
- **[Entity]** — […]

---

## Assets

<!-- Inventory of images / logos / icons / attachments present with the design. -->

- [path or description of each asset, e.g. `documentation/uploads/logo.svg` — brand logo]

---

## Translate, Don't Copy

<!--
Prototype-runtime constructs to REBUILD in our stack rather than carry forward.
State these as PRINCIPLES, with today's dialect only as a disposable example — the
principle survives when the dialect changes; the example does not.
-->

- **Placeholder / fake data → real data.** [Wire to the configured data source, not the design's canned values.]
- **Remote CDN icons/images → local components/assets.** [Rebuild with local icon components; don't hotlink.]
- **Placeholder handlers → real handlers.** [The design's inert click targets become real actions.]
- **Inline styles / utility soup → design tokens + Shadcn primitives.** [Re-express visual intent through tokens, not copied styles.]

---

## Uncertainties

<!--
LOAD-BEARING — never omit. Everything the interpreter could NOT determine from the
files, so the user can correct it at INTAKE before BUILD. Better an honest "I
couldn't tell" here than a confident wrong guess in a screen entry above.

List only what is STILL OPEN. Anything answered in Your Decisions is closed and does
NOT belong here. The one exception is a conflict: the design now contradicts a
decision, which IS an open question.
-->

- [What could not be determined, and why — e.g. "No brand colours found in the files; the palette above is a placeholder — please confirm."]
- [e.g. "The 'Export' button on Dashboard has no visible destination — where should it lead?"]
- [e.g. "Two screens share the label 'Details' — confirm they're distinct surfaces."]
- [conflict form — e.g. "You'd decided 'Export' goes to Reports; the updated design points it at a download action instead — which should I build?"]

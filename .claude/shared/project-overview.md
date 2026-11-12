# Project Overview section (`CLAUDE.md`)

The `## Project Overview` section of `CLAUDE.md` describes the project being built. Written at INTAKE, then checked against `project.md` at every epic merge — the only two points it is ever written.

## What it contains

A two-sentence lead-in (what the app is, what each role does with it), three bullets, one pointer line — **within 12 lines and 150 words**.

| Bullet | From `project.md` | Ends with |
|---|---|---|
| Roles | column headings of §Roles & Permissions | closed list; exact string form |
| Auth | §Authentication `Method` | session mechanism; what it forbids |
| Data source | §Data Source & Backend Integration `Data source` + `Mock layer required` | mocks or live |

Each bullet ends in the constraint that makes the fact actionable — a few words, never more than a short sentence, always derived from this project's `project.md`.

Pointer line, exactly three: `generated-docs/project.md` (facts and detail), `generated-docs/epics/` (epics and briefs), `generated-docs/architecture.md` (reusable code and conventions).

**Never present:** permissions, endpoints, palette, compliance domains or requirements, theme, backend connectivity, epics, stories, build progress, timestamps, slugs, NFRs.

### Shape to match

```markdown
## Project Overview

Transaction Import & Approval System: an internal financial-operations console. A File Importer uploads bank-transaction files and tracks processing; an Approver reviews, approves, rejects (with a note) or exports the resulting transactions.

- Roles: `File Importer`, `Approver` (exact backend strings; no other role exists).
- Auth: server-side, browser-managed session cookie. No token in frontend code.
- Data source: existing API, two live backend services. No mocks.

Facts and detail: `generated-docs/project.md`. Epics and briefs: `generated-docs/epics/`. Reusable code and conventions: `generated-docs/architecture.md`.
```

The shape, not the wording — no clause above transfers to another project, except the pointer line.

## Writing it

- **Never from an `epic/*` branch** — only where `project.md` itself is written.
- **Correct, don't rewrite.** Stale means it contradicts `project.md`, or a stated fact is missing. Worded differently from how you would have written it is **not** stale.
- **Write nothing when nothing is stale** — leave `CLAUDE.md` byte-for-byte untouched.
- **Never trim the user's own words to fit the budget.** The budget binds what you write; correct the facts in place and leave the rest.
- **Silent** — no prompt, no message, including when correcting words the user wrote.

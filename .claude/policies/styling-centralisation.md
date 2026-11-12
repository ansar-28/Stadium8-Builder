# Styling Centralisation Policy

## Core Principle

All styling lives in a single set of centralised design tokens. Components reference tokens by name — never by hex literal, never by inline rgba(), never by hard-coded Tailwind colour utilities. The reason: when the user revisits styling later, token-level edits propagate across the entire app. Scattered styling turns every "let me tweak the brand colour" into a multi-file refactor.

---

## What "Centralised" Means

The single source of truth for styling in this template is **`web/src/app/globals.css`** — specifically the `:root` and `.dark` blocks (Shadcn token names, **raw hex** values — Tailwind v4 `oklch()` approximations drift from brand colours, so we keep hex).

Tokens cover:

- **Colours** — `--primary`, `--background`, `--foreground`, `--muted`, `--accent`, `--destructive`, `--border`, etc. (Shadcn convention)
- **Typography** — `--font-sans`, `--font-mono` (Tailwind `@theme`)
- **Spacing** — `--spacing-*` if customised; otherwise the Tailwind default scale
- **Radii** — `--radius`
- **Shadows** — `--shadow-*` if customised
- **Z-index** — `--z-*` if customised

If a component needs a value not represented by an existing token, the correct action is to **add a token**, not hard-code the value.

---

## Mandatory Rules

1. **Components reference tokens by name.** Use `var(--primary)`, `bg-primary`, `text-foreground`, etc. — the Shadcn/Tailwind helpers map to the underlying tokens.

2. **No hex literals in component code.** A colour written as `#rrggbb` (or `#rgb`) outside `globals.css` is a violation. Exceptions: SVG path attributes inside imported icons, and comments documenting reference values. If this is ever automated, note that matching `#[0-9a-fA-F]{3,8}` on its own is not a safe implementation — it also matches URL fragments (`#add`, `#decade`), issue references (`#123`), and HTML entities (`&#169;`). A usable check has to gate on colour *context* (a CSS declaration value, a colour-named key, a `bg-[#…]` arbitrary value) and skip comments.

3. **No inline `rgb()` / `rgba()` / `hsl()` / `oklch()` in component code.** Same reasoning — colour values belong in tokens (which themselves use raw hex).

4. **No Tailwind palette utilities for brand colours.** `bg-blue-600`, `text-red-500`, etc. are acceptable for transient design (e.g., a placeholder screen) but must be replaced before story commit. The brand palette goes in tokens; components use semantic helpers (`bg-primary`, `text-destructive`).

5. **If the project has a dark theme, it must work end-to-end.** Every colour token gets both a `:root` and a `.dark` value, and components must NOT hard-code light-mode-only colours. Never invent dark values for a light-only design.

6. **No styling in `documentation/` artifacts dictates production directly.** The design digest's **Palette & Typography** section (raw values the `design-interpreter` carried verbatim from wherever they lived in the design) is an *input* to `intake-agent`, not the final production tokens. It is reviewed, merged into the Shadcn convention, and the user signs off at the INTAKE approval.

7. **Brief-level styling stays high-level.** During INTAKE, `project.md` §Styling & Branding captures palette (raw hex) and font family only. Component-specific styling (button radii, card shadows, etc.) emerges on demand during BUILD — not at INTAKE.

8. **Font files are never fetched by hand.** No `curl`, no `wget`, no download script, no copying binaries out of `node_modules`. How a font reaches the browser is decided by the branch table in [Font Delivery](#font-delivery) below.

---

## INTAKE Stage Behaviour

The `intake-agent` populates `project.md` §Styling & Branding with raw hex values. Two patterns:

**Pattern A — Defaulted (no source):**
```markdown
- `[DEFAULT]` Palette: neutral light-mode default; primary `#2563eb` (Tailwind blue-600), neutrals from Tailwind `slate`
- `[DEFAULT]` Font family: system UI stack
- `[DEFAULT]` Dark mode: not enabled (can be introduced later)
- `[DEFAULT]` Component-specific styling deferred — emerges during BUILD
```

**Pattern B — Inferred from source (the design digest supplies a palette, a BRD mentions branding, etc.):**
```markdown
- `[INFERRED]` Palette: dark theme with brand accents `#1A1A2E` / `#E94560` (from the design digest's Palette & Typography section)
- `[INFERRED]` Font family: Inter for headings, system stack for body (from the design digest)
- `[INFERRED]` Dark mode: primary mode is dark
```

The user edits these freely at the INTAKE approval (free-text or direct file edit). Whatever is approved is what BUILD implements — the palette becomes the token values, and the font family goes through the [Font Delivery](#font-delivery) branch table below.

---

## Font Delivery

`project.md` §Styling & Branding records the font **family** — a fact about the design. How that family reaches the browser is a BUILD decision, made here. A design source and the digest may state the family; neither dictates the delivery mechanism.

Pick the branch by where the font comes from:

| Recorded family | What BUILD does |
|---|---|
| `[DEFAULT]` system UI stack — nothing specified | **Nothing** — no font loading at all |
| A family published on Google Fonts | `next/font/google` — no dependency, no files |
| A family published on npm (a foundry package, `@fontsource[-variable]/<family>`, etc.) | Install it as a dependency, then load it — a new dependency, so the Tier 4 halt in [agent-autonomy.md](../shared/agent-autonomy.md#tier-4--halt) applies as for any package |
| Font files the user supplied in `documentation/` | Copy into `web/src/assets/fonts/` — **not** `public/`: `next/font/local` emits its own hashed copy at build time, so a source under `public/` ships the same bytes twice — load with `next/font/local`, keep the licence file beside them |
| A named family matching none of the above | **Halt and ask the user** (Tier 4) — this is a licensing question, not a technical one |

**If no branch reaches the font, that IS the answer — halt.** Fetching the binary yourself commits it with no lockfile entry and no integrity hash, and skips the licence question the last row exists to raise. When a user has a font no branch reaches, the resolution is for *them* to put the file in `documentation/` — which turns it into row 4.

`next/font` self-hosts by default: it fetches at **build** time and emits the font as a static asset of the app, so a built app makes no runtime request to a font CDN. Serving fonts from your own origin therefore needs no hand-rolled `@font-face` and no committed binaries. Never hotlink a font stylesheet at runtime — no `@import` from a font CDN, no `<link>` to one — whatever the design source did.

---

## BUILD Stage Behaviour — developer agent

The `developer` agent owns the token layer. **Deriving it from §Styling:**

- **Where it lands.** `project.md` §Styling & Branding is the source; `globals.css`'s `:root` and `.dark`
  blocks are the destination. On the first epic those blocks hold the starter's Shadcn defaults — replace
  their **values**, never add a second block, so every token has exactly one definition site.
- **Stamp the block.** Open it with §Styling's lines copied in **verbatim**, one per line, as comments.
  That stamp is what [continue.md Step B0.3](../commands/continue.md#step-b03-design-tokens-when-the-palette-isnt-applied-yet)
  compares to decide whether the tokens are current, so a paraphrase or a reordering breaks the check.
- **Derive what §Styling doesn't state.** A brand palette gives surfaces, not the text on them: compute each
  foreground and the focus ring against the surface it actually renders on, check it against the project's
  accessibility NFR, and record the ratio in a comment beside the value. This is where a brand colour that
  fails as text gets caught — white on a bright cyan primary measures ~2.5:1 and fails.
  - **Measure every interactive state, not just the resting one** — hover, active/pressed and disabled, for
    each button and link, in both modes. A hover that *fades* the fill is the usual culprit: it moves the
    surface toward the page background, which is the wrong direction for the label sitting on it. Step
    darker (or lighter in dark mode) instead of fading.
  - **Record the ratio truncated, never rounded** — 4.4716:1 is `4.47:1`, not `4.5:1`. Rounding toward the
    threshold is how a failing value gets written down as a passing one and ships.
- **Both modes or neither.** If §Styling names a dark background, every light token needs a dark counterpart
  in `.dark`. A half-populated dark block ships an unreadable screen.
- **`globals.css` is the whole token layer.** No generated copy under `generated-docs/`, no separate token
  file, no style-guide document — §Styling plus the stamp is the record.

**When writing components**, enforce the rules above:

- Reach for Shadcn components first (`<Button />`, `<Card />`, etc.) — they already reference tokens via `bg-primary`, `text-primary-foreground`, etc.
- When adding new styling, use the Tailwind helper that maps to a token (`bg-muted`, `text-foreground`, `border-border`, `rounded-md`)
- If a needed value has no token, **add a token to `globals.css`** rather than hard-coding the value
- **Fonts go through [Font Delivery](#font-delivery)**, not through the token blocks alone

If the developer agent hits a wall (the design genuinely requires a value with no semantic mapping), it should surface the question to the user rather than hard-code.

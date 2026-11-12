<!--
This template defines project.md for the epic-branch workflow.

Filename contract: generated-docs/project.md (committed to main, stable across epics)

Pure markdown — no YAML front-matter, no machine parsing. Claude reads this
file directly during agent runs to pick up project-level facts. The dashboard
and other automated consumers read state.json instead.

What belongs HERE (project-level, stable across epics):
  - Roles & Permissions
  - Authentication
  - Data Source & Backend Integration
  - Compliance
  - Styling & Branding
  - Baseline NFRs (apply to all features)
  - Design source (if any)

What belongs in per-epic brief.md (not here):
  - Data Model
  - Functional Requirements (R-IDs)
  - Business Rules (BR-IDs)
  - Key Workflows
  - Feature-specific NFRs
  - Out of Scope
  - Notes & Caveats

Editing this file: never from an epic branch — every change lands on main via
the §6.1 main-landing write, and in-flight epic branches pick it up when they
rebase. That write carries the record only: derived artifacts (design tokens,
backend smoke-test status) are regenerated or verified separately.

See .claude/policies/epic-branch-concurrency.md §6.1.
-->

# [Project name]

[1–2 sentences: what this project does and for whom. Sourced from the user's project description, BRD, or the design digest.]

| Field | Value |
|---|---|
| Project slug | `[kebab-case-slug]` |
| Created | [ISO 8601 timestamp] |
| Intake source | [docs / design / guided-qa] |
| Backend connectivity | [verified / deferred / mock-only / no-backend] |

---

## Roles & Permissions

**Template:** `[saas-standard | internal-tool | marketplace | editorial | custom]`

[For non-custom templates: emit the full permissions matrix from `.claude/shared/roles-snippets.md`. For custom: emit a minimal matrix with the user's role list and a single "View main dashboard" row — extended per-epic as new actions surface.]

| Permission | [Role 1] | [Role 2] | [Role 3] |
|---|---|---|---|
| [permission] | ✓ | ✓ | |
| ... | | | |

> Permissions extend during BUILD as new stories surface new actions. Additions are recorded here as they come up, with your approval. Removing a permission, or changing who the roles are, stops for you to review.

---

## Authentication

| Field | Value |
|---|---|
| Method | `[server-side | frontend-only | custom]` |
| Auth login endpoint (if server-side) | `[METHOD /path]` |
| Auth userinfo endpoint (if server-side) | `[METHOD /path]` |
| Auth logout endpoint (if server-side) | `[METHOD /path]` |
| Custom auth notes (if custom) | [free-text description] |

> Auth method is never inferred — the user must confirm explicitly per [authentication-intake.md](.claude/policies/authentication-intake.md).

---

## Data Source & Backend Integration

| Field | Value |
|---|---|
| Data source | `[existing-api | new-api | api-in-development | mock-only]` |
| Backend status | `[running | in-development | N/A]` |
| Mock layer required | [yes / no] |

### Backend connectivity (when applicable)

<!-- Omit this subsection when data source is mock-only, or new-api with no connectivity check. Include it for server-side-auth new-api, where a reachability-only probe of the userinfo URL ran. -->

| Aspect | Value |
|---|---|
| Base URL | [e.g. `http://localhost:10010`] |
| Auth scheme | [bearer / apiKey / basic / oauth2-client-creds / cookie / none / custom] |
| Auth header | [e.g. `Authorization`] |
| Auth value format | [e.g. `Bearer {token}`] |
| Credential env vars | [e.g. `API_TOKEN` — names only, never values] |
| Smoke-test endpoint | [e.g. `GET /v1/users/me`] |
| Smoke-test mode | [full / reachability-only] |
| Smoke-test status | [verified / null-deferred] |
| Smoke-test verified at | [ISO 8601 timestamp or null] |
| Smoke-test notes | [deferral reason or "flipped anyway" warning surfaced by /api-status; empty when verified] |
| CORS / proxy notes | [e.g. "Backend host differs from localhost — Next.js rewrite proxy needed"] |

### API specs

<!-- One row per OpenAPI spec file (user-provided or generated). -->

| Path | Source |
|---|---|
| `[documentation/auth-api.yaml]` | [user-provided / generated] |

---

## Compliance

**Applicable domains:** `[list, e.g., pci-dss, gdpr]` (or "None" if empty)
**Region (if Personal data applies):** `[ZA | UK | EU | US | CA | AU | IE | multiple]`

### Compliance Requirements

<!-- One bullet per applicable-domain obligation, expanded from compliance-intake.md §"Per-Domain `[INFERRED]` Assumptions". If no domains apply, write: "No compliance domains were identified during intake screening." -->

- [Compliance obligation — e.g., "Payment handling MUST use third-party hosted fields (Stripe / Adyen / PayFast pattern); no raw card data on our servers (PCI-DSS)"]
- [...]

---

## Styling & Branding

| Field | Value |
|---|---|
| Primary brand color | `#XXXXXX` <!-- Raw hex — Tailwind v4 oklch approximation drifts from brand --> |
| Accent / secondary | `#XXXXXX` |
| Background (light) | `#XXXXXX` |
| Background (dark, if applicable) | `#XXXXXX` |
| Font family (headings) | [e.g., Inter] |
| Font family (body) | [e.g., system stack] |
| Theme | [light only / dark only / both] |
| Source | [design digest palette / BRD branding section / defaulted] |

> Component-specific styling (button radii, card shadows, etc.) emerges during BUILD. This section captures only palette intent and typography per [styling-centralisation.md](.claude/policies/styling-centralisation.md).

---

## Baseline NFRs

<!-- Industry-baseline NFRs that apply to all features. Per-epic NFRs live in the epic's brief.md. -->

- **NFR-base-1:** Accessibility — WCAG 2.1 Level AA baseline
- **NFR-base-2:** Performance — First Contentful Paint < 2.5s on a mid-tier mobile network
- **NFR-base-3:** Responsive design — mobile (≥360px) / tablet (≥768px) / desktop (≥1280px) breakpoints
- **NFR-base-4:** Browser support — latest two versions of Chrome / Edge / Firefox / Safari
- **NFR-base-5:** Error UX — user-visible error states with retry affordance for all async operations

<!-- Add connectivity-derived baseline NFRs when present:
- NFR-base-6: Next.js rewrite proxy required (CORS headers absent on backend)
- NFR-base-7: Dev environment requires VPN / internal-network access
-->

---

## Design Source

<!-- Present only when a design digest exists at generated-docs/design/digest.md with a `design` / `partial` verdict (the design-interpreter comprehended a design). Omit this section entirely otherwise. This section is a SUMMARY + POINTER to the digest — the same relationship §Data Source has to an API spec; the digest carries the verbatim detail. -->

| Field | Value |
|---|---|
| Digest | `generated-docs/design/digest.md` |
| Palette source | [where the interpreter found the colours — e.g. inline / a separate stylesheet / asked from user] |
| Read from | [the design file(s) the interpreter comprehended, from the digest's "Read from" row] |
| Attached files | [assets inventory from the digest / none] |

### Screens

<!-- One row per screen from the digest's Screens section. A design has no route paths in our stack — screens are surfaces the user lands on. Key details is a one-line summary; the digest carries the full fields/validation/copy verbatim, so don't duplicate it here — point at the digest. -->

| Screen | Key details |
|---|---|
| [name] | [one-line summary — see the digest for verbatim fields / validation / navigation] |

> The app is **rebuilt in our stack** (Shadcn + design tokens) to match the design as described in the digest — not copied from any source markup. Prototype constructs that must NOT carry forward to production — placeholder/fake data, remote CDN icons, placeholder handlers, inline styles — are listed in the digest's "Translate, Don't Copy" section and flagged in the per-epic brief.md "Notes & Caveats" when an epic touches that screen.

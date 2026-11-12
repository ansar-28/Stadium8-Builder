# Changelog

All notable changes to this template will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.5.0] - 2026-10-30

### Added

- **Claude Code sessions in this project's folder are now sent to Twenty57** — the full session contents, including recent past sessions still on your machine. Claude starts its first reply in each session with a short notice. Full details in [Help → Session Recording](.template-docs/users/Help/Session-Recording.md).

### Fixed

- **The Approve and Done buttons on the review pages stay put when you click them.** The "Copied" message now appears just above them instead.

- **A story's two sets of automated tests are now written together, so they expect the same controls on the screen.** You should see fewer fix rounds at the end of a feature.

- **Running the app no longer leaves a stray `web/AGENTS.md` file behind.** If your project already has one, you can delete it.

### Security

- **New projects now use version 4 of Zod, the library that checks form and API data.** Version 3 has a known security problem that fails the Security gate in `/quality-check`. If your existing project's Security gate fails on `zod`, ask Claude to update it to version 4.

## [1.4.0] - 2026-10-14

### Added

- **Every epic and story now carries a permanent id.** New epics and stories are stamped with a generated id when they're planned, and an epic you're part-way through picks its ids up on the next `/continue`. An id never changes once set, so renaming and reordering stay free.

### Changed

- **Claude checks before it tells you something.** Whether it's reporting progress or answering your questions, it now checks the facts first, and tells you when it couldn't. Your app's code also uses clear, descriptive names instead of single letters or shorthand, so it's easier to read and maintain.

- **`CLAUDE.md` now describes your app.** A short summary sits at the top of the file. It fills in as you build, and is kept up to date as your project changes.

- **The plan, stories and manual review pages now look and behave the same way every time.** You can always change what you are approving and note what went wrong on a failed check, and the pages keep one consistent look.

- **The workflow now shows you less noise as it works.** You'll see the decisions you need to make, the results you need to know, shorter progress markers and less machinery in between. Plans and test checklists are shown once, in your browser, with shorter summaries in the chat instead of the whole thing twice.

- **`/continue` now tells you where the project stands.** Run it when you're not on an epic branch and it shows every epic and its state — including one you just planned with `/plan`, and the command to build it. It also warns you before resuming an epic that's part-way through being built, in case another window is still working on it; choosing to stop leaves your work exactly as it was.

- **Your files in `documentation/` are now left alone.** Previously an API spec you provided could be edited for you if it turned out not to match your backend — now your copy is left exactly as you wrote it, so it's yours to update if you want it to match.

- **`/plan` can now settle project-setup and design changes too.** If the epic you're planning needs a change to your roles, sign-in, backend, compliance or brand colours — or rebuilds screens against design files you've changed — `/plan` handles it with you instead of sending you to `/start`. A design change becomes part of your app when that epic merges.

- **Failed checks on GitHub are now fixed for you.** If GitHub's checks fail before a merge, the workflow fixes the cause itself. If GitHub can't run them (during an outage, say), it goes ahead to your merge approval, since they already passed on your computer.

- **"BFF" is now called "server-side authentication".** Same sign-in option, plainer wording — and new sign-in code uses `AUTH_*` setting names instead of `BFF_*`. Existing projects keep working untouched; `/upgrade` tells you if there are old names worth tidying up.

### Fixed

- **The manual review page now keeps what you have already done.** Your ticks and notes survive closing and reopening it, and a "check these first" item you have confirmed stays ticked when the page comes back after a fix.

- **The manual review page's "Mark all passed" is now "Mark the rest passed", and leaves your reported failures alone.** Note what went wrong first, then mark off the rest in one click.

- **Build reports no longer miss session history because of how a folder name was capitalised.** On Windows this could leave work out of the time and cost totals, understating them. The maintainer report's **Data quality** section now names the session folders its figures came from, so you can see what was counted.

- **The automated testing check no longer fails over a problem saving its coverage file** — only your tests count.

- **Updated packages to fix newly reported security issues.** Routine housekeeping.

- **Adding a Shadcn component now runs unattended and gets checked afterwards.** The `npx shadcn add` command in `CLAUDE.md` passes the flags that skip every prompt, and Claude checks the generated file's imports and `package.json` before moving on — shadcn's online registry has recently been emitting wrong imports and adding stray packages.

## [1.3.0] - 2026-08-12

### Added

- **The maintainer report now sizes your next feature, not just the last one.** `/build-report-maintainer` has an **Effort benchmarks** section: what each kind of screen actually took to build (list, form, detail, record action, sign-in, export), the same figures per feature, and a calculator you type a screen mix into to size upcoming work against your own delivered history. It uses records the workflow already keeps, so there's nothing to switch on.

- **Build from UI designs you already have.** Drop your design files into `documentation/` — a design export (Claude Design, Figma, or similar), wireframes, or an HTML mockup, in whatever shape they come. Claude Code reads them, works out your screens, colours and wording, and reads it all back at Intake for you to confirm — including anything it couldn't work out — before building each screen to match. See [documentation/README.md](documentation/README.md#working-from-an-existing-design).

- **Update your design any time.** Update the files in `documentation/` and describe the change as you would any other piece of work ("rebuild these screens to match my updated design") — only the screens you name change. Decisions you made along the way are kept, so re-reading your design won't undo them; if the new design contradicts one, Claude Code asks which wins.

- **A sign-off record on the client-facing report.** `/build-report-stakeholders` now has a **“Decisions you signed off”** section: the choices you were asked to make during the build and the answers you gave — who uses the app, how people sign in, what was deferred and why — each in plain language with the date. It's built from the build's own record of what it asked you, so nothing is invented.

### Changed

- **No more importing from a prototype repo.** The onboarding option that asked for the path to a prototype repo is gone — drop whatever you have straight into `documentation/` instead. Nothing to do on upgrade, and nothing to migrate.

- **One report each for you and your client.** `/build-report-maintainer` is the internal retrospective — effort, cost, workflow performance, the effort benchmarks and sizing calculator, and a **Spend detail** fold with the per-model and per-tool breakdowns. `/build-report-stakeholders` is the client-facing delivery report. Both write to `generated-docs/reports/` and tell you the path when they finish. `/build-report`, `/workflow-insights` and the three older report commands are gone — `/upgrade` removes them, along with report pages from earlier versions that had quietly stopped updating. If you've customised a report's wording, note that `/upgrade` replaces it, so keep a copy of any change you want to keep.

- **The maintainer report now shows what you decided, not just what it cost.** It leads with how many decisions you were asked for, your typical answer time, and how many phases ran with no input from you at all — then logs every question and the option you chose.

- **Far fewer emails from the automated checks.** They no longer comment on your pull requests — that was three comments, and three emails, on every one. Results are still on each check's run page, and `/continue` still tells you if one fails.

### Fixed

- **Misnamed workflow documents are now caught.** The check that keeps the workflow's own files correctly named was letting most of them through, so a wrongly-named feature brief or progress record could leave a build unable to resume. Nothing to do — the correct names haven't changed, and existing files are left alone.

- **The workflow now runs on macOS and Linux, not just Windows.** Parts of it were Windows-only and quietly did nothing elsewhere, so builds on a Mac or Linux machine ran without the guard that keeps work inside `/start` and `/continue`. Dashboards, approval pages and reports now open in your browser on any operating system. Nothing changes on Windows.

- **A part-built feature is no longer reported as a small one.** Per-feature figures come from each story's start and finish times, so a feature mid-build only has times for the stories it has finished — and one finished story was being treated as enough to measure the whole thing. Those features are now marked as partly measured and kept out of the "typical feature" figures, so the sizing calculator isn't dragged down by them.

- **A report for one project no longer counts another project's work.** If you keep copies side by side whose folder names start the same way — `my-app`, `my-app-QA` — the report for `my-app` was folding the others' work into its totals and overstating its costs. It now checks with git which folders really belong to the project.

- **A report is no longer lost because one figure is missing.** A data file left over from an older version, or copied from another project, could stop the whole page being produced. Any figure it can't read now shows as a dash and the rest of the report generates as normal.

- **Running a report before a project has started now points you to `/start`.** It used to be mistaken for a report with one detail missing, and produced a page rather than telling you what to do.

## [1.2.0] - 2026-07-28

### Added

- **`/plan` command** — plan the next epic ahead and park it ready to build, without starting the build. It runs the full planning step (breaks the epic into stories and gets your approval) and then stops, leaving the epic ready for `/start` to pick up and build later. Because it's safe to run in a separate window while another epic is building, one person can plan the next piece of work while the current one is still being built — or two people can work in parallel. Everything git-related is automatic: it plans against the latest version of your project and parks the finished plan where it can't go stale, without disturbing any build in progress.

### Changed

- **Lighter CI usage.** The automated quality checks now skip a couple of unnecessary runs: pushing a further change to a pull request stops the checks already running for the earlier version, and commits that don't touch the app's code (such as the internal progress-tracking commit at the end of each epic) no longer start a check run. Together these help a project use fewer GitHub Actions minutes.

- **Simpler Shadcn component setup.** Adding Shadcn UI components (buttons, dialogs, and the like) no longer needs an extra background helper to be running — the workflow now uses the standard Shadcn command-line tool that comes with your project. That's one less thing to start up, and it always uses the exact version pinned to your project.

### Fixed

- **From your next upgrade onward, `/upgrade` consistently clears out template files a newer version no longer uses.** Before, the tidy-up covered a fixed set of folders only, so leftovers could linger — old help pages, retired scripts, and duplicate checks that made every pull request run twice. Empty folders go too. None of your own work is touched: your commands, agents, skills and hooks stay, as does anything that only lives on your machine. Nothing extra to review — it's in the same summary and single approval as the rest of the upgrade.

- **An upgrade now uses the *new* version's updating machinery, not your current one's.** `/upgrade` fetches the version you're moving to and hands the work over to it. Before, it ran the copy already in your project, so improvements to the updater itself arrived a release late.

- **`/upgrade` now keeps your `.gitignore` current.** It adds the entries the new version expects and never touches or reorders yours. That's what keeps files meant to stay on your machine — your local settings, session logs — from being committed by accident.

- **The browser download for end-of-epic tests no longer stalls the workflow.** The one-time Chromium download (~130 MB) these tests need now runs automatically in the background while planning and building carry on, so it's usually ready in time instead of pausing everything at the end. If it's still downloading when the tests are due, the workflow waits for that one download rather than getting stuck or starting a second, competing one — and it no longer asks for admin rights, which could silently hang it on Linux. A new [Troubleshooting](.template-docs/users/Help/Troubleshooting.md) entry covers installing it by hand, the one-time Linux system-library step, and avoiding a re-download on a fresh VM.

## [1.1.0] - 2026-07-14

### Added

- **`/upgrade` command** — brings an existing project up to a newer template version in one guided step: it updates the workflow machinery, adds new dependencies without removing yours, merges `CLAUDE.md` (template sections only — your project-specific content is preserved), migrates the workflow state via `/migrate-legacy` when the model changed, and verifies — all on a branch, then applies it to your project on a single approval (it does the commit and merge for you).
- **Template version marker.** Every project now records which template version it's on in a `template-version.json` file at its root — present from the moment you get the template and kept current on each `/upgrade`, so the version is always knowable (and `/upgrade` can tell exactly what changed).
- **`/build-report`** — a visual retrospective of how your app came together, opened in your browser: how long it took (calendar time vs. actual build time), what it cost, how efficiently it was built, how much you had to step in, what got produced (code, components, tests), and where time was lost. Add `stakeholders` (`/build-report stakeholders`) for a client-facing delivery report that shows what shipped and the quality evidence, without the internal build machinery.

### Changed

- **Reports no longer describe user-side metrics as "human effort".** The build report and workflow-insights report now label only what the logs actually prove — deliberate user inputs (counts) and time the process sat waiting for input — and state explicitly that the user's working time is not recorded, so no human-vs-AI effort split can be derived. The measurements themselves are unchanged.

### Removed

- **The CI Template Sync.** The GitHub Actions sync workflow, its `TEMPLATE_SYNC_PAT` setup, and the `.templatesyncignore` config are gone — `/upgrade` replaces them with a guided, in-session upgrade that also handles the parts sync couldn't: workflow files, the mixed `CLAUDE.md`, and the 4-phase → branch-per-epic state migration.

### Fixed

- **The quality check no longer mistakes a crashed test run for failing tests.** The end-of-epic check used to run your tests at the same time as the production build, and on Windows the two could fight for the machine and crash the test runner as it started up — making a healthy epic look like it had failing tests. It now runs the tests on their own, right after the build, so nothing competes with them, with an automatic single re-run as a safety net if a rare crash ever still slips through.

## [1.0.0] - 2026-07-09

### Added

- **Approve plans and manual-test results in your browser.** PLAN and the manual-test check now open a review page that lays out the story list or the test checklist visually, so you can read and approve without working through the chat.
- **Rebuilt dashboard** — a simplified view of live progress across every epic at once (in-flight and merged). Open it with `/dashboard`.
- **Up-front epic planning.** When you start a new project, the workflow breaks your whole spec into all of its epics, maps the dependencies between them, and checks that every requirement is covered — before any building starts — so you approve the shape of the work first.
- **Production deployment support** — a ready-to-use Docker setup, a build check in CI, and step-by-step docs for deploying the generated app.
- **`/workflow-insights`** — a per-epic report of what the build actually cost: tokens, spend, which models ran, and how much work each part of the workflow did.

### Changed

- **New branch-per-epic workflow.** Work is now organised around *epics* (a group of related stories). Each epic is built on its own branch and merged with a pull request once it's done and you've signed off. The facts you set once — roles, sign-in, data source, styling, compliance — carry across every epic automatically, so you never re-answer them. `/start` begins an epic and `/continue` takes it through plan → build → your final manual check → merge. Because each epic is self-contained on its own branch, epics stay independent and can be split across branches (for example, two people on two epics at once).
- **Upgrade an existing project to the new workflow.** `/migrate-legacy` converts a project built on an older workflow shape — including the previous 4-phase model — over to branch-per-epic, moving your project facts and completed epics into the new layout so you don't have to start over.
- **Faster builds.** Per-story checks were slimmed down and the full quality suite now runs once at the end of an epic instead of repeatedly, removing a lot of redundant re-runs.
- **Leaner CI/CD.** The automated quality checks now run only on pull requests and pushes to `main`, and each run is faster (shared dependency caching, a single Node version, and fewer gates) — so each project spends far fewer GitHub Actions minutes.
- **The security gate is far more accurate.** It now blocks only on real, server-side problems and no longer trips over safe code — pagination dropdowns, download helpers, sign-in/sign-out routes, and pages already behind a sign-in guard are no longer flagged. Compliance obligations (such as POPIA) are still raised with you at the start and stay on the review checklist; they're just no longer a code scan that could block you by mistake.
- **Accessibility and time-based behaviour are tested in a real browser.** Accessibility checks (contrast, layout, focus order) and anything time-driven (session timeouts, countdowns, debounced inputs) now run in a real browser via Playwright, which catches issues the previous in-memory checks couldn't see.

### Removed

- **The Lighthouse performance gate.** It's been dropped from the quality gates — it was a recurring source of CI trouble, and performance is better assessed on the actual deployed app.
- **Built-in session logging.** Claude Code already keeps a full transcript of every session, so the workflow no longer writes its own log files or attaches them to commits.

### Fixed

- **Finishing an epic no longer gets stuck.** Completing an epic now reliably opens the pull request, merges it, and cleans up the branch, instead of occasionally stalling partway through.
- **Fewer false test failures at the end of an epic.** End-of-epic browser tests now run against a real production build, which removes the timing races that used to fail tests for reasons that weren't actually bugs.
- **Security checks now run on Windows.** A path-handling bug had caused two security checks to be silently skipped on Windows; they now run everywhere.

### Security

- **CI now blocks serious dependency vulnerabilities.** Known Critical/High advisories in production dependencies fail the security gate — with the same verdict whether you run `/quality-check` locally or in CI — and secret scanning now runs on every push, not just on pull requests.

## [0.4.1] - 2026-06-03

### Changed

- Fewer permission prompts during the workflow: the bash permission hook now auto-approves more safe, read-only command shapes — including Vitest and quality-gate test runs and `sed -n '<range>p'` as a pipeline filter — while the deny rules were hardened so code-execution forms (`node -e`, `find -exec`, `npm install`, moving source files) still prompt by design.

### Added

- `journal.js` helper script that routes workflow decision-journal reads and writes through an auto-approved command, removing a recurring permission prompt at story commits and epic boundaries.

### Fixed

- Corrected the `vitest-axe` matcher import in the test-generator template (it used the old jest-axe API), which had caused generated accessibility tests to fail.

### Removed

- Unused `bcryptjs` / `@types/bcryptjs` dependency from the web template — password hashing happens in the backend under the BFF auth pattern, so the frontend never needs it. Trims the default install.

## [0.4.0] - 2026-06-01

### Added

- `/migrate-legacy` command to upgrade a pre-4-phase `workflow-state.json` to the current INTAKE/PLAN/BUILD/COMPLETE model; `/continue` auto-routes to it when it detects a legacy state file.
- Backend API connectivity check during INTAKE — captures base URL, auth header, and environment variables, runs a smoke test, and saves a re-runnable `api-smoke-test.sh` plus connectivity config to the intake manifest for BUILD to treat as authoritative.
- `/api-status`, `/api-go-live`, and `/api-mock-refresh` commands for managing the switch between mock and live API backends, with `/api-go-live` gated on a passing smoke test.
- Deployment guide covering how to ship the generated application.
- Requirements traceability matrix and coverage tracking across stories.
- Compliance and regulatory screening surfaced as a blocking question during INTAKE.
- Testing-strategy overhaul: an INTAKE probe for available test tooling, coverage tags, a manual-test approval at each epic boundary, and a hard stop when an endpoint would be invented rather than specified.
- `/continue` can now extend an already-completed feature with new epics.
- Publish pipeline that mirrors each GitHub release into the public release repository.

### Changed

- **Workflow simplification:** collapsed the 9-phase model (INTAKE / DESIGN / SCOPE / STORIES / REALIGN / TEST-DESIGN / WRITE-TESTS / IMPLEMENT / QA) into 4 phases (INTAKE / PLAN / BUILD / COMPLETE) with 1–2 user approvals and an agent-driven BUILD loop. See `.claude/WORKFLOWS.md`.
- INTAKE produces a single `project-brief.md` artifact (replaces the FRS / assumptions split).
- BUILD agents apply a four-tier autonomy policy (`agent-autonomy.md`) and halt only for genuinely unsafe ground.
- `/start` now chains directly into `/continue` after the INTAKE approval — no `/clear` boundaries anywhere in the flow, and setup is inlined into `/start`.
- Subagents are tiered by model — Opus for planning and coding, Sonnet for most agents, Haiku for mechanical generators.
- Template sync now uses a personal access token and runs manual-only, opening a self-healing "action required" issue when it can't run.
- Template documentation reorganized into separate `users/` and `template-maintainers/` folders and rewritten in plain language for non-developer users.
- Authentication follows a Backend-for-Frontend (BFF) pattern, replacing the client-side NextAuth/RBAC scaffold.

### Removed

- Agents `intake-brd-review-agent`, `design-wireframe-agent`, `design-roles-agent`, `prototype-review-agent`, `spec-compliance-watchdog`, `test-designer` — folded into `intake-agent`, `test-generator`, or eliminated.
- Per-story Markdown files; story metadata now lives in `workflow-state.json` with a per-epic overview file for visibility.
- The `/setup` command (folded into `/start`) and the NextAuth/RBAC scaffold (replaced by the BFF auth pattern).

### Fixed

- Numerous permission-hook fixes so routine read-only and QA commands are auto-approved (quoted paths with spaces, git global options, multi-path/glob reads, and subshell pipelines).
- Lighthouse performance gate no longer fails with a Chrome interstitial error in CI (defaults to mock-API mode).
- Resolved npm audit vulnerabilities in dependencies.

### Security

- Authentication moved server-side via the BFF pattern, replacing the client-side RBAC scaffold.

## [0.3.0] - 2026-03-25

Released without a curated changelog entry. See the
[v0.3.0 release notes](https://github.com/stadium-software/stadium-8/releases/tag/v0.3.0)
and the git history for details.

## [0.2.0] - 2026-01-05

### Added

- `/status` command with visual workflow progress indicators showing current phase and completed steps
- `/continue` command for resuming interrupted TDD workflows with automatic state detection
- Design Wireframe agent for creating wireframes before story planning
- `/start` command now executes TDD workflow one epic at a time (Plan → Test → Implement → Review → Verify → Commit/PR per epic)
- Performance gate (Gate 5) with Lighthouse CI integration
- PR comment reporting for all quality gates (Security, Code Quality, Testing, Performance)
- Security scanning for hardcoded secrets (API keys, AWS keys, tokens) in PR checks
- Template update sync system with weekly workflow for receiving upstream changes
- Auto-fix step in quality-gate-checker (runs lint:fix, format, audit fix before reporting failures)
- Plain-language error explanations in quality-gate-checker for non-developer users
- Workflow state tracking to all agents for `/status` visibility
- Session logging now works in both CLI and VSCode extension

### Changed

- Quality gates now enforce strict binary pass/fail (no conditional passes or rationalized failures)
- Agents must present actual status and options to user instead of auto-approving failures
- Improved non-developer user experience with clearer documentation and error messages

### Fixed

- Ensure linting and tests are run before submitting story PRs
- Ensure design-wireframe-agent commits wireframes to prevent data loss
- Exclude bcrypt hashes from hardcoded secrets scan (false positives)
- Add detailed tracing to hardcoded secrets scan for debugging
- Run npm audit fix for dependency security updates
- Remove unused tasks folder

### Security

- Enhanced PR quality gates with regex scanning for hardcoded secrets
- PR comments now report security scan results

## [0.1.0] - 2025-12-12

### Added

- Initial template release
- Next.js 16 with App Router
- React 19 with TypeScript 5 strict mode
- Tailwind CSS 4 with Shadcn UI integration
- Production-ready API client with error handling
- Role-Based Access Control (RBAC) system
- Input validation with Zod schemas
- Toast notification system
- Quality Gates CI/CD workflow (Security, Code Quality, Testing)
- Claude Code agents for TDD workflow (feature-planner, test-generator, developer, code-reviewer, quality-gate-checker)
- Progress tracking system (auto-generated PROGRESS.md)
- Template sync workflow for receiving updates

### Security

- RBAC with role hierarchy (Admin, Power User, Standard User, Read Only)
- Server-side and API route protection helpers
- XSS prevention with HTML sanitization
- Input validation schemas for common patterns

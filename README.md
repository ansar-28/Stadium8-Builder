# Stadium Builder — Digiata release

A web application, built and maintained with the help of an AI assistant. You describe what you want; the assistant plans it, builds it, and tests it. You sign off at every step.

[![Quality checks](https://github.com/Digiata/Stadium-Builder/actions/workflows/quality-gates.yml/badge.svg)](https://github.com/Digiata/Stadium-Builder/actions/workflows/quality-gates.yml)

> The badge above is a live indicator of whether the current version of the app is passing all of its automated quality checks. **Green tick** = healthy. **Red cross** = something needs attention.

---

## Starting a session

1. _(Optional)_ Drop anything that describes what you want to build into the [`documentation/`](documentation/) folder — feature descriptions, design references, sample data, an API spec. You can also skip this and just describe it in the chat.
2. Open the project in Claude Code.
3. Type `/start`.

Claude reads whatever you've provided, breaks the work into a plan, and pauses for your approval before it builds anything. If something important is missing, it asks.

For full setup — prerequisites, creating the project, installing dependencies — see the [Getting Started Guide](.template-docs/users/Getting-Started.md).

## How it works

Work moves one **epic** (a group of related features) at a time, through three stages — **Intake, Plan, Build**. Claude plans the work, writes the tests first, builds each feature, and runs the automated checks. You approve the plan up front, then try the finished result in your browser and sign off before it's merged into the main version of the app.

See the [Agent Workflow Guide](.template-docs/users/Help/Agent-Workflow-Guide.md) for details.

## Workflow Commands

Type these in the Claude Code chat.

| Command | What it does |
| --- | --- |
| `/start` | Build an epic. On a new project it runs setup first, then builds the first one. |
| `/plan` | Plan the next epic ahead and park it ready to build — safe to run while another epic is building. |
| `/continue` | Pick up the current epic where it left off, through to the pull request and merge. |
| `/status` | Show where the project stands. |
| `/dashboard` | Open the visual dashboard in your browser. |
| `/quality-check` | Run the quality gates — security, code quality, tests. |
| `/build-report-stakeholders` | A delivery report to share: what shipped, the decisions you signed off, quality evidence, what's next. |
| `/build-report-maintainer` | An internal report: effort, cost, what each kind of screen costs to build, where time was lost. |
| `/upgrade` | Update the project to a newer template version. |

## How quality is protected

Every change is checked automatically before it can join the main version of the app — functionality, security, code quality, and tests. If a check fails, Claude fixes it and re-runs before handing the work back to you. Type `/quality-check` at any time to see the current status.

See the [Quality Gates Guide](.template-docs/users/Help/Quality-Gates.md) for details.

## Staying up to date

The template behind your project keeps improving — new workflow features, bug fixes, and security patches. To pick them up, type `/upgrade` in Claude Code. It does the work on a separate branch, runs the quality checks, then shows you a plain summary and asks once before anything lands. Your own app code is never touched.

**Want to know when there's something new?** On the template repo, [Digiata/Stadium-Builder](https://github.com/Digiata/Stadium-Builder), click **Watch → Custom → Releases**. GitHub will notify you each time a new version ships — that's your cue to run `/upgrade`.

See the [Upgrading Guide](.template-docs/users/Help/Upgrading.md) for a step-by-step walkthrough, or [CHANGELOG.md](CHANGELOG.md) for what's changed between versions.

## Help

See the [Help Center](.template-docs/users/Help/) for reference guides and common issues.

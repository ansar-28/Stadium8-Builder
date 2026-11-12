# How the Workflow Works

When you type `/start`, Claude Code guides you through building your feature in three stages — **Intake, Plan, Build**. AI agents handle most of the work; you step in at a few approval points and verify each finished epic in your browser.

---

## Quick Start

1. Type `/start` in Claude Code — it will ask what you want to build, or read from anything you've placed in `documentation/`
2. Follow the prompts — Claude Code tells you what it's doing and pauses for your approval at each stage

**Commands:**

| Command | What it does |
|---------|-------------|
| `/start` | Begin building a new feature |
| `/continue` | Pick up where you left off, or see where every epic stands |
| `/plan` | Plan the next epic ahead and park it, ready to build later |
| `/status` | See where you are in the current workflow |
| `/dashboard` | Open a visual overview of your project's progress |
| `/build-report-maintainer` | Open a visual report of how the build went — effort, cost, what each kind of screen costs to build, and what was built |
| `/build-report-stakeholders` | Open a client-facing delivery report — what shipped, what you signed off, and the quality evidence |
| `/quality-check` | Run all quality checks manually |
| `/upgrade` | Update your project to a newer version of Stadium Builder |

---

## How the work is organised

Your project is built **one epic at a time**. An *epic* is a major area of work (for example, "user accounts" or "reporting dashboard"); each epic is made up of several *stories* — the individual pieces of functionality. Claude Code plans all the epics up front, builds them one at a time, and you verify each finished epic in your browser before it ships.

**Planning the next epic ahead (optional).** Normally each epic is planned right before it's built. If you'd rather line the next one up while the current epic is still building, run `/plan` — on its own, in a separate Claude Code session. It works out that epic's stories, gets your approval, and parks it *ready to build*, without disturbing the work already in progress. When you're ready, `/start` picks up the parked epic and builds it.

---

## The Three Stages

### Stage 1: Intake
Claude Code reads anything you've placed in `documentation/` and asks a short checklist of questions (authentication, backend, user roles). It then records your **project setup** — the facts that hold across the whole project — and breaks your requirements into a **plan of epics**, ordered so that each builds on the ones before it. **You review and approve the project setup and the plan before any code is written.**

If your project uses a real backend, Claude Code also runs a quick connection test against it first — so credential or URL problems surface before any code is written.

**Starting from a design?** Drop your design files into `documentation/` and Claude Code builds your screens to match. When your design changes later, drop in the new files and ask for an epic that rebuilds those screens. See [Working from an existing design](../../../documentation/README.md#working-from-an-existing-design).

**Changing your project setup later.** Your setup isn't fixed at Intake. A new role, a change to how people sign in, a different backend, a new compliance obligation or a new brand colour can be settled whenever it comes up — while you're planning an epic with `/plan`, while you're setting one up with `/start`, or part-way through a build. Claude Code shows you exactly what it wants to change and asks before recording it. Once recorded it applies to every epic from then on, not just the one in hand — and it stays even if you never build that epic. New brand colours go into the app the next time an epic builds.

### Stage 2: Plan
For the epic that's about to be built, Claude Code defines the individual **stories** — the specific pieces of functionality — and how it will check each one. **You approve the epic's stories before work starts.** This happens once per epic, as each epic comes up.

### Stage 3: Build
For each approved story, Claude Code automatically:

1. Writes failing tests that describe exactly what the story should do
2. Writes the code to make those tests pass
3. Runs a fast set of checks, then commits the change

It works through every story in the epic without interrupting you. If a check fails, Claude Code fixes it itself. It only stops to ask about decisions that are yours to make — who can do what, how people sign in, or a requirement that can't work as written.

When the whole epic is built, Claude Code runs the **full quality gates** and the **end-to-end browser tests** across everything in the epic, then asks **you to open your browser and confirm the epic works as expected**. Once you confirm, Claude Code ships the epic — it opens a pull request, waits for GitHub's checks, and merges it with your approval — and moves on to the next one.

---

## The Flow at a Glance

```
You describe what you want
          ↓
Claude Code records your project setup and plans the work as epics   ← you approve (Stage 1: Intake)
          ↓
For each epic:
          ↓
  Claude Code defines the epic's stories                             ← you approve (Stage 2: Plan)
          ↓
  For each story: Claude Code writes tests, then code,
  then runs checks and commits                                       (automatic, Stage 3: Build)
          ↓
  Claude Code runs the full quality gates + browser tests,
  then you verify the epic in your browser                           ← you confirm
          ↓
  The epic ships (pull request merged with your approval)
          ↓
  The next epic begins
```

---

## Quality Gates

A fast subset of checks runs as each story is built. The **full set of four gates** runs once at the end of each epic — and again automatically whenever code is pushed to GitHub:

| Gate | What it looks for |
|------|------------------|
| 1. Functional | Does the feature work the way you described? |
| 2. Security | Are there any security vulnerabilities or accidentally exposed secrets? |
| 3. Code quality | Is the code well-formed and free of errors? |
| 4. Tests | Do all the tests pass? |

Gates 2, 3, and 4 are fully automated. Gate 1 includes a step where you check the running app yourself — that's the browser check you do at the end of each epic.

---

## You're Always in Control

You don't have to follow every step rigidly. If you want to skip something, go back, or change direction, just say so in plain English:

- *"Skip ahead to planning, the setup looks good"*
- *"I want to update my requirements before we continue"*
- *"Redo the stories for Epic 2 — I want to change the scope"*
- *"Regenerate the tests for this story"*

Claude Code will follow your lead.

---

## Troubleshooting

**The workflow was interrupted and I don't know where I left off**
Type `/status` to see the current stage, or `/continue` to pick up from where you left off. Claude Code saves its progress as it goes.

**I want to change my requirements after the workflow has started**
Just tell Claude Code what you want to change. You can update your feature description in `documentation/` and ask Claude Code to re-read it, or describe the change in the chat and ask it to adjust the plan.

**A quality check failed**
Claude Code fixes failed checks itself, including the ones GitHub runs before a merge. If GitHub can't run its checks at all, Claude Code tells you and asks whether to merge anyway, since the same checks already passed on your computer.

**I want to drop an epic**
Tell Claude Code which epic to drop. Each epic is built separately, so the rest of your project stays as it is.

**Claude Code seems stuck or is asking for something I don't understand**
Ask it to explain in simpler terms, or describe where you think you are: *"I've approved the stories for Epic 1 — what should happen next?"* Claude Code will orient itself and continue.

**I approved something and want to go back and change it**
You can always ask to revisit a previous stage: *"I want to go back and change the stories for Epic 2."* Claude Code will work with you to adjust the plan.

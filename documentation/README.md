# The `documentation/` Folder

This is where you put anything that describes **what you want to build**. Claude Code reads this folder during Intake — the first stage of the workflow — and uses whatever it finds to produce a project brief for your approval.

You don't need to put anything here. If the folder is empty, Claude Code will just ask you questions when you run `/start`. But the more you provide, the less you'll have to answer in chat.

---

## What to Put Here

Anything you have. Claude Code recognises and uses these kinds of files automatically:

| What | Why it helps |
|---|---|
| **A feature description** (any `.md` file) | The main thing — tells Claude Code what you want built and who it's for |
| **An OpenAPI spec** (`.yaml` / `.json` containing `openapi:` or `swagger:`) | Locks in the real endpoints your backend exposes, so Claude Code uses your actual API shape instead of guessing |
| **Sample data** (any `.json` / `.csv`) | Helps Claude Code understand the shape of your data |
| **Wireframes** (in a `wireframes/` subfolder) | Reference for layout and screen flow |
| **Brand or styling notes** | Logo files, colour palettes, fonts, a `tokens.css` file — anything that defines the look and feel |
| **A design** (a Claude Design or Figma export, an HTML mockup) | See [Working from an existing design](#working-from-an-existing-design) below |

File names and folder structure don't matter — Claude Code scans the whole folder. The `documentation/` folder is read-only during the workflow; Claude Code never modifies what you put here.

---

## A Simple Feature Description

If you're starting from scratch, the easiest thing is one markdown file describing your feature in plain language. Here's an example:

```markdown
# User Profile Page

A page where signed-in users can view and edit their profile.

## What users should be able to do

- View their name, email, and profile picture
- See when their account was created
- Edit their name and profile picture inline (no separate edit page)
- Get a confirmation message after saving changes

## Things to keep in mind

- Changing email address should require re-verification
- Use a card layout
- Accessible from the main navigation menu
```

That's enough for Claude Code to produce a useful project brief. You can be more detailed if you like — include user stories, acceptance criteria, edge cases, or anything else you think matters — but you don't have to.

---

## If You Have a Backend

Put your OpenAPI spec in this folder (any name ending `.yaml` or `.json` will be detected). Claude Code uses it as the source of truth for endpoints, request/response shapes, and authentication — so the generated code calls your real API, not invented endpoints.

If your spec defines authentication (`securitySchemes`), Claude Code will run a quick connection test against your backend at the end of Intake to catch credential or URL problems before any code is written.

---

## Working from an existing design

If you've already designed your app — in Claude Design, Figma, as wireframes, or even a hand-written HTML mockup — you can build from that design instead of writing a fresh spec, and Claude Code rebuilds your screens faithfully in this stack. There's no import step and nothing to point Claude Code at: **just put the design files in this folder.** If they came as a `.zip`, unzip it and drop the files into `documentation/` (or drop loose files in directly). That's the whole mechanism.

When you run `/start`, Claude Code **reads** whatever design files it finds, works out what your screens are — their layout, fields, copy, validation, colours and fonts — and reads it all back to you at Intake for confirmation before anything is built. It also tells you plainly what it *couldn't* determine, so you can fill those gaps rather than have it guess.

**File shape and layout don't matter.** Claude Code reads the design by understanding it, not by matching a fixed export format — so a folder of files, loose files, a renamed export, or a mix of formats all work the same way. You don't have to arrange anything into a particular structure, and it isn't tied to any one design tool.

**What reads reliably.** Anything text-based — HTML, wireframes, notes, specs — is the dependable core and reads well. Images, screenshots, and PDFs are read too, but reconstructing exact text and layout from a picture is less certain; Claude Code uses what it can and is upfront about anything it's unsure of. If a file turns out to be unreadable — a single bundled export file, say — it tells you and asks for it in a form it can read. Either way, nothing is silently dropped — what it read and what it didn't both surface at Intake.

**A design gives Claude Code your screens and look, not your requirements.** Files that come with your design might include a requirements doc — or just a logo, or nothing. If your design comes with requirements, Claude Code uses them; otherwise it asks a few short questions to fill the gaps, guided by the screens it read.

**Updating later.** Changed your design? Drop the new versions into `documentation/`, then run `/start` — or `/plan` to line it up while something else builds — and describe what you want: *"rebuild the dashboard and settings screens to match my updated design."* Claude Code re-reads your design and builds only what you asked for, through the usual plan → build → review → merge flow. There's no special "refresh" mode.

**Your decisions stick.** Claude Code keeps a written record of your design and adds to it every time you settle something it couldn't get from your files — a colour that wasn't in there, where a button should lead, or a change you asked for while testing ("actually, move that filter to the right"). Those decisions **override your design files**, so re-reading the design never quietly puts a screen back the way the design has it. When it re-reads, it updates that record rather than rewriting it, tells you in plain words what moved ("the Export button is now called Download CSV"), and if your new design contradicts something you'd decided, it asks you which one to build instead of picking for you.

**Already built your app without a design?** You can still drop one in and rebuild against it. Claude Code will only change the screens you name — everything else is left alone — and if a screen you're rebuilding should keep the behaviour it has now rather than matching the design, say so and it's recorded.

---

## What Happens Next

After you run `/start`, Claude Code reads this folder, asks a few short questions to fill in any gaps, and produces a project brief summarising what it understood. You review and approve the brief, and the workflow continues into planning and building.

For the full walkthrough, see the [Agent Workflow Guide](../.template-docs/users/Help/Agent-Workflow-Guide.md).

---

## Tips

- **Start small.** A few paragraphs is plenty for a first feature. You can refine as you go.
- **Be specific where it matters.** "Users can filter results by date" is more useful than "Users can search".
- **Include an API spec if you have one.** It saves a lot of back-and-forth.
- **You can always change your mind.** Claude Code will re-read this folder if you ask it to.

Need help? Ask Claude Code: *"How do I describe my feature for the workflow?"*

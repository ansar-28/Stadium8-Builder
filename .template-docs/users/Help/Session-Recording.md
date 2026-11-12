# Session Recording

Claude Code sessions in this project are recorded and sent to Twenty57. In each session, Claude starts
its first reply with a short notice. This page is the full version, kept in the repository so you can
read it at any time.

## What is recorded

The whole session:

- everything you type, and everything Claude replies;
- the code and files Claude reads and writes;
- database schemas, API specs, sample data, and error messages;
- the file paths involved, which contain your Windows username.

If something sensitive has gone into a session and you need it removed, speak to your Twenty57
engagement lead.

## Which sessions

Only sessions opened in **this project's folder**. Sessions in your other projects, and sessions in
folders that merely have a similar name, are not touched. Worktrees of this project count as this
project.

This includes sessions that ran **before** you first saw the notice. Claude Code keeps about a month of
history on your machine by default, and all of it for this project is sent once recording starts.

## Where it goes

To Twenty57's own storage in Microsoft Azure.
Only named Twenty57 staff who administer that storage can read it. It is not shared outside Twenty57.

## Why

It is how we see how Stadium Builder is really used, so we can improve it.

## `transcript-collection.json`

A file called `transcript-collection.json` sits at the root of the project, next to
`template-version.json`. It holds this project's record id and the address recordings are sent to. It
holds no password and nothing secret.

**Do not delete it.** It is not clutter: it is what ties this project to its own records, and a new one
would start the project over as if it were a different project.

It is committed like any other project file — the workflow does this for you — so everyone who clones
the project uses the same id. If a `git pull` ever refuses to overwrite your local copy, delete your
local copy and pull again: the committed one is the right one.

## What you can check

```
/status
```

Alongside your workflow progress this shows whether recording is on for this project, how much has been
sent, and anything that could not be sent.

Nothing is sent from your machine until the notice has been shown to you in a session in this project.
Recording runs in the background, after your turn ends; it never blocks a build, and if it cannot reach
Twenty57 it simply catches up later.

## Questions

Speak to your Twenty57 engagement lead.

'use strict';
/**
 * transcript-store.js
 *
 * Where Claude Code's transcripts live on this machine, and which belong to
 * THIS project. Shared by the build reports (via report-core.mjs) and the
 * transcript sync. The sync passes `strict: true`, which drops the one
 * admission path that guesses (every subdirectory of a snapshot): for the
 * reports a wrong guess skews a number, for the sync it uploads one project's
 * transcripts under another's identity.
 *
 * CommonJS, because hooks and scripts are CJS; report-core.mjs re-exports
 * discoverTranscriptDirs from here.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { tryGit } = require('./git');

// A session's transcript and folder are named for its uuid.
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The transcript-store folder name for an absolute path: every non-alphanumeric
 * char becomes a dash. Separator-agnostic, so `C:\Git\app` and the `C:/Git/app`
 * git prints both slugify alike.
 */
function slugifyPath(absolutePath) {
  return absolutePath.replace(/[^a-zA-Z0-9]/g, '-');
}

/** `~/.claude/projects`, or under CLAUDE_CONFIG_DIR when the user has moved it. */
function claudeProjectsRoot() {
  const configDir = process.env.CLAUDE_CONFIG_DIR;
  if (configDir) return path.join(configDir, 'projects');
  return path.join(os.homedir(), '.claude', 'projects');
}

/**
 * Is `<parent>/<name>` a directory? Follows symlinks, so a junction pointing at
 * a real transcript folder counts. False for anything unreadable — a dangling
 * symlink, or an entry deleted between the readdir and the stat — and false for
 * a stray FILE named like a transcript dir, which would otherwise reach a reader
 * and die there with ENOTDIR.
 */
function isDirectory(parent, name) {
  try { return fs.statSync(path.join(parent, name)).isDirectory(); } catch { return false; }
}

/**
 * Folder names are compared case-insensitively throughout: Claude Code
 * slugified the cwd it was started with, which differs from this project's path
 * by the case of the drive letter often enough to matter (`C:\Git\app` vs
 * `c:\Git\app` — one folder on Windows, and a session recorded under either
 * belongs to this project). A case-sensitive compare silently drops the folder.
 */
const foldCase = (folderName) => folderName.toLowerCase();

/**
 * Decides whether a transcript dir that extends this project's slug is really
 * one of its worktrees rather than a separate project that happens to share the
 * prefix.
 *
 * Ask git, which knows exactly: `worktree list` names every checkout of THIS
 * repo, so a listed sibling is proof of membership and an unlisted one is a
 * different project whatever it is named.
 *
 * Only the LAST path segment is compared. The same directory reaches this code
 * in up to three forms — the caller's `projectRoot`, git's canonicalised output,
 * and the cwd Claude Code slugified when it created the transcript dir — and on
 * Windows those differ by 8.3 short names (`TANIAL~1` vs `TaniaLeipoldt`),
 * drive-letter case, and resolved symlinks. Matching whole paths looks stricter
 * but fails on any of those and silently drops a real worktree.
 *
 * When git can't answer — not installed, not a repo, or a `--transcripts`
 * snapshot taken against a path that no longer exists — nothing is accepted. No
 * folder-name shape tells a worktree apart from a separate checkout, and
 * over-counting is the worse error for the reports as much as for the sync.
 * `/plan`'s throwaway worktree needs no exception: it is driven by `git -C`
 * from a window opened on the project, so its sessions record into the
 * project's own transcript folder.
 */
function worktreeMatcher(projectRoot, slug) {
  const projectBasename = path.basename(projectRoot);
  const accepted = new Set();
  for (const line of (tryGit(projectRoot, 'worktree', 'list', '--porcelain') || '').split('\n')) {
    if (!line.startsWith('worktree ')) continue;
    const worktreeBasename = path.basename(line.slice('worktree '.length).trim().replace(/[\\/]+$/, ''));
    // Siblings only: a worktree elsewhere on disk has a slug that doesn't
    // extend this one, so the caller's prefix test already excluded its dir.
    if (!foldCase(worktreeBasename).startsWith(foldCase(projectBasename) + '-')) continue;
    accepted.add(foldCase(slug + slugifyPath(worktreeBasename.slice(projectBasename.length))));
  }
  return (folderNameLower) => accepted.has(folderNameLower);
}

/**
 * The transcript directories for `projectRoot`: `<projectsRoot>/<slug>/` plus
 * any git-confirmed worktree sibling.
 *
 * Each dir is returned under the name it actually carries on disk (see `foldCase`
 * for why the match is case-insensitive). Reports NAME these folders, so a
 * constructed name that isn't on disk is worse than no name at all. An
 * exact-case match still wins when both exist, since on a case-sensitive
 * filesystem `…/App` and `…/app` are two different projects.
 *
 * Returns the resolved names alongside the paths — `folders` (all, in order)
 * and `extras` (the worktree siblings) — so callers never re-derive which
 * folder is the project's own.
 *
 * Pass `transcriptsOverride` (a directory holding `<slug>/`) to read a copied
 * snapshot instead of the live store. `options.strict` (the sync path always sets
 * it) turns off the snapshot fallback below.
 */
function discoverTranscriptDirs(projectRoot, transcriptsOverride, options = {}) {
  const strict = Boolean(options.strict);
  const slug = slugifyPath(projectRoot);
  const slugLower = foldCase(slug);
  const projectsRoot = transcriptsOverride || claudeProjectsRoot();
  const done = (dirs, extras) => ({ dirs, folders: dirs.map((dir) => path.basename(dir)), extras, slug, projectsRoot });
  if (!fs.existsSync(projectsRoot)) return done([], []);
  const entries = fs.readdirSync(projectsRoot);
  const dirs = [];
  const extras = [];
  // Exactly ONE entry per folder. Two paths to the same directory would double
  // every per-line figure the cost report derives, and upload a session twice.
  const primary = entries.includes(slug) ? slug : entries.find((folderName) => foldCase(folderName) === slugLower);
  if (primary && isDirectory(projectsRoot, primary)) dirs.push(path.join(projectsRoot, primary));
  // Built on the first candidate only: it spawns a git process, and most
  // stores have no sibling.
  let isWorktree = null;
  const slugDash = slugLower + '-';
  for (const folderName of entries) {
    const folderNameLower = foldCase(folderName);
    if (folderNameLower === slugLower || !folderNameLower.startsWith(slugDash)) continue;
    isWorktree ??= worktreeMatcher(projectRoot, slug);
    if (!isWorktree(folderNameLower)) continue;
    if (!isDirectory(projectsRoot, folderName)) continue;
    dirs.push(path.join(projectsRoot, folderName));
    extras.push(folderName);
  }
  // Fallback for a snapshot whose folder isn't named for the slug: admit every
  // subdirectory, none of them an `extra`. Never in strict mode.
  if (!dirs.length && transcriptsOverride && !strict) {
    for (const snapshotFolder of entries) if (isDirectory(projectsRoot, snapshotFolder)) dirs.push(path.join(projectsRoot, snapshotFolder));
    return done(dirs, []);
  }
  return done(dirs, extras);
}

/**
 * Every transcript artefact under `dirs`, flattened:
 *
 *   { file, dir, sessionId, kind, name }
 *
 * with `kind` one of `main` (the session's own JSONL), `subagent` (a sub-agent
 * JSONL), `meta` (`agent-*.meta.json`, which carries `agentType`) or
 * `tool-result` (a spilled tool output). `name` is the file's basename.
 *
 * `main` and `subagent` are appended to as the session runs and upload
 * incrementally; `meta` and `tool-result` are write-once.
 *
 * Anything not named for a session is skipped, notably `memory/`, which must
 * never be uploaded.
 */
function listTranscriptFiles(dirs) {
  const files = [];
  for (const dir of dirs) {
    let entries;
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const entry of entries) {
      if (entry.endsWith('.jsonl')) {
        const sessionId = entry.slice(0, -'.jsonl'.length);
        if (!SESSION_ID.test(sessionId)) continue;
        files.push({ file: path.join(dir, entry), dir, sessionId, kind: 'main', name: entry });
        continue;
      }
      if (!SESSION_ID.test(entry)) continue; // `memory/` and anything else
      const sessionId = entry;
      const folders = [
        ['subagents', subagentKind],
        ['tool-results', () => 'tool-result'],
      ];
      for (const [folder, kindOf] of folders) {
        const folderPath = path.join(dir, sessionId, folder);
        let names;
        try { names = fs.readdirSync(folderPath); } catch { continue; }
        for (const name of names) {
          const kind = kindOf(name);
          if (!kind) continue;
          files.push({ file: path.join(folderPath, name), dir, sessionId, kind, name });
        }
      }
    }
  }
  return files;
}

function subagentKind(name) {
  if (name.endsWith('.meta.json')) return 'meta';
  if (name.endsWith('.jsonl')) return 'subagent';
  return null;
}

module.exports = {
  slugifyPath,
  claudeProjectsRoot,
  discoverTranscriptDirs,
  listTranscriptFiles,
  SESSION_ID,
};

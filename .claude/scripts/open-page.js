#!/usr/bin/env node
/**
 * open-page.js
 *
 * Opens a generated HTML page in the user's default browser, on any platform.
 *
 * Replaces the bare `start "" "<path>"` the workflow commands used to run.
 * `start` is a cmd.exe builtin — it exists only on Windows, so on macOS and
 * Linux the dashboard, the two approval pages, and the build reports silently
 * failed to open, on the critical path of /start and /continue.
 *
 * Deterministic by design (CLAUDE.md: script only what must run identically
 * every time). Keeping the platform choice here rather than in each command's
 * prose also means the bash-permission-checker allowlist needs ONE entry instead
 * of a per-platform regex for start/open/xdg-open.
 *
 * Usage:
 *   node .claude/scripts/open-page.js generated-docs/dashboard.html
 *   node .claude/scripts/open-page.js --print-only <path>   # resolve, don't open
 *
 * Relative paths resolve against the REPO ROOT, not the CWD — the bash tool's
 * CWD persists across calls and drifts into web/ (see lib/project-root.js).
 *
 * Exit codes:
 *   0 — page handed to the OS opener (or --print-only)
 *   1 — file not found, or no opener available; the path is printed so the user
 *       can open it manually rather than the workflow stalling on a blank screen.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { getProjectRoot } = require('./lib/project-root');

/**
 * Opener argv for the current platform.
 *
 * win32: NO SHELL, and Unicode-safe. Each option here was checked against three
 * path shapes with a beacon page that reports back when the browser really
 * renders it — non-ASCII (`ünïcode-Ω/påge.html`), `%USERPROFILE% reports/`, and
 * `dir with space & amp/a & b.html`:
 *
 *            non-ASCII   %VAR%   &
 *   explorer    yes       yes    yes
 *   rundll32    NO        yes    yes     (resolves url.dll's ANSI entry point)
 *   cmd start   yes       NO     yes     (cmd expands %VAR% into another path)
 *
 * So `explorer` is primary. `cmd /c start` is gone: it also invited a subtler bug
 * — caret-escaping `&` yielded a literal `a ^& b.html`, because inside a quoted
 * string cmd treats `^` as an ordinary character, not an escape. Every cmd failure
 * looked the same from here: wrong path, modal "cannot find" dialog, hung call.
 *
 * rundll32 stays as the fallback for Windows installs with no `explorer.exe`
 * (Server Core, some containers), where an ASCII path is the likely case anyway.
 *
 * NOTE: `explorer.exe` exits 1 even on success, so on Windows a successful spawn
 * is the only signal available — see tryOpen. Do not "fix" that by testing
 * explorer's exit code; it would make every successful open look like a failure.
 *
 * linux: xdg-open first, then wslview, which is what works under WSL.
 */
function openerCandidates(target, platform = process.platform) {
  if (platform === 'win32') {
    return [
      { command: 'explorer', args: [target] },
      { command: 'rundll32', args: ['url.dll,FileProtocolHandler', target] },
    ];
  }
  if (platform === 'darwin') {
    return [{ command: 'open', args: [target] }];
  }
  return [
    { command: 'xdg-open', args: [target] },
    { command: 'wslview', args: [target] },
  ];
}

// An opener still running after this long has handed the page to a browser rather
// than failed. `open` and `xdg-open` both return within milliseconds either way,
// so this only ever elapses for a launcher that stays in the foreground.
const HANDOFF_GRACE_MS = 1500;

/**
 * Tries each candidate in turn, resolving with the one that opened the page (or
 * null when none did). A missing opener surfaces as an ENOENT 'error' event.
 *
 * On win32, spawning IS the success signal — explorer.exe exits 1 even when it
 * opened the page, so its exit code carries no information.
 *
 * Everywhere else the exit code is meaningful, and checking it is what makes the
 * fallback chain work at all: `xdg-open` is usually installed under WSL and on
 * headless boxes yet fails there, so treating a successful spawn as success would
 * make `wslview` — the opener that actually works under WSL — unreachable, and
 * would report "Opened <path>" while nothing opened.
 */
function tryOpen(candidates, platform = process.platform) {
  const spawnIsSuccess = platform === 'win32';
  return new Promise((resolve) => {
    const attempt = (candidateIndex) => {
      if (candidateIndex >= candidates.length) return resolve(null);
      const next = () => attempt(candidateIndex + 1);
      const { command, args } = candidates[candidateIndex];

      let child;
      try {
        child = spawn(command, args, { detached: true, stdio: 'ignore' });
      } catch {
        return next(); // spawn can also throw synchronously on a rejected argv
      }

      child.once('error', next); // opener not installed on this box
      child.once('spawn', () => {
        if (spawnIsSuccess) {
          child.unref();
          return resolve(command);
        }
        const handoff = setTimeout(() => {
          child.removeAllListeners('exit');
          child.unref();
          resolve(command);
        }, HANDOFF_GRACE_MS);
        child.once('exit', (exitCode) => {
          clearTimeout(handoff);
          if (exitCode === 0) return resolve(command);
          next(); // opener present but could not open the page — try the next
        });
      });
    };
    attempt(0);
  });
}

function parseArgs(argv) {
  const args = { printOnly: false, target: null };
  for (const arg of argv) {
    if (arg === '--print-only') args.printOnly = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (args.target === null) args.target = arg;
    else throw new Error(`Unexpected extra argument: ${arg}`);
  }
  return args;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }

  if (args.help || !args.target) {
    console.log('Usage: node .claude/scripts/open-page.js [--print-only] <path-to-html>');
    console.log('');
    console.log('Opens a generated page in the default browser on Windows, macOS, or Linux.');
    console.log('Relative paths resolve against the repo root.');
    process.exit(args.help ? 0 : 2);
  }

  const root = getProjectRoot();
  // path.resolve handles the absolute and repo-relative cases together AND normalises
  // separators to the platform's own, so a forward-slashed path handed in on Windows
  // reaches the opener as backslashes rather than a mix.
  const absolutePath = path.resolve(root, args.target);

  if (!fs.existsSync(absolutePath)) {
    console.error(`Page not found: ${absolutePath}`);
    console.error('Nothing was opened. Generate the page first, then retry.');
    process.exit(1);
  }

  // Handing a directory to `explorer` pops a File Explorer window instead of a
  // page — a confusing way to discover the path was wrong. Say so instead.
  if (!fs.statSync(absolutePath).isFile()) {
    console.error(`Not a file: ${absolutePath}`);
    console.error('Point this at the generated .html page, not the folder holding it.');
    process.exit(1);
  }

  if (args.printOnly) {
    console.log(absolutePath);
    process.exit(0);
  }

  // Only ever open .html. This script is auto-approved by the permission checker, so
  // without this it is a general "hand any local file to the OS default handler"
  // launcher: `explorer <path>` ShellExecutes on Windows, so an .exe/.bat/.hta path
  // picked up from an untrusted spec would RUN. The `start ""` allow-pattern this
  // replaced confined the target to the workflow's own folders; this restates that
  // guardrail where it belongs. Checked by extension rather than repo-containment so
  // /plan can still open a page in its sibling worktree — and only on the opening
  // path, since --print-only hands the path to nobody.
  if (path.extname(absolutePath).toLowerCase() !== '.html') {
    console.error(`Not an .html page: ${absolutePath}`);
    console.error('This opens the generated .html pages the workflow produces, nothing else.');
    process.exit(1);
  }

  const opened = await tryOpen(openerCandidates(absolutePath));
  if (!opened) {
    // No working opener on this box (headless Linux, container, stripped WSL).
    // Not fatal to the workflow — but the user must be told the path, or they
    // wait on a page that is never going to appear.
    console.error('Could not open a browser on this computer.');
    console.error(`Open this file manually: ${absolutePath}`);
    process.exit(1);
  }

  console.log(`Opened ${absolutePath}`);
  process.exit(0);
}

if (require.main === module) {
  // Without this, any unexpected throw becomes an unhandled rejection: Node prints
  // a stack trace and exits non-zero, losing the one line the user actually needs.
  main().catch((err) => {
    console.error(`Could not open the page: ${err && err.message ? err.message : err}`);
    process.exit(1);
  });
}

module.exports = { openerCandidates, tryOpen, parseArgs };

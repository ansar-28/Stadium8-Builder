#!/usr/bin/env node

/**
 * Apply template updates (the /upgrade delivery step)
 *
 * Applies template-owned machinery and guardrails, prunes what the template retired, merges
 * `.gitignore` and reconciles `web/` + the root files additively, and regenerates
 * `web/package-lock.json` when it changed `package.json`. Never touches the project's app
 * (`web/src|e2e|public`), specs or output; the mixed files (`CLAUDE.md`, existing `web/` config,
 * `Dockerfile`) are reported for /upgrade to merge, never overwritten.
 *
 * ONE auto-approved call, because editing `.claude/` prompts for approval per file even in
 * auto-accept mode. Writes only the allowlisted paths below, and fails closed throughout.
 *
 * Retirement runs as three sweeps, each covering what the others can't: the owned-TREE sweep
 * (OWNED_TREES), the base→target diff (retiredSinceBase, the only one reaching the guardrail
 * dirs), and a named backstop (DELETE_BY_NAME_PATHS).
 *
 * `--help` for usage and flags. TEMPLATE_DEVELOPMENT.md § Template update boundary for the update
 * boundary, and CONTRIBUTING.md § How Consumers Upgrade for which list a new path belongs in.
 *
 * Exit codes: 0 = ran (see report); 2 = bad usage / fetch failure.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, execSync } = require('node:child_process');
// Shared with the prompt hook, so both mint the identity file the same way.
const { DEFAULT_RECEIVER_URL, COLLECTION_FILE, mintCollectionFile } = require('./lib/transcript-sync-core');

// A constant so the normal /upgrade flow (which passes only --ref) always fetches the official
// repo; the publish pipeline rewrites this to the release repo for the shipped copy.
const DEFAULT_SOURCE_REPO = 'https://github.com/Digiata/Stadium-Builder.git';

// Template-owned machinery dirs — applied (copied/overwritten) on every upgrade.
const MACHINERY_DIRS = [
  '.claude/agents',
  '.claude/commands',
  '.claude/policies',
  '.claude/shared',
  '.claude/skills',
  '.claude/templates',
  '.claude/scripts',
  '.template-docs/users',
  '.github/scripts',
];

// Template-owned files outside a machinery dir. Applied like the dirs above.
const MACHINERY_LOOSE_FILES = [
  '.claude/README.md',
  '.github/release.yml',
  'CHANGELOG.md',
];

const MACHINERY_PATHS = [...MACHINERY_DIRS, ...MACHINERY_LOOSE_FILES];

// Fully template-owned TREES: a file the PROJECT TRACKS inside one that the target template no
// longer ships is retired. Whole trees, not leaf dirs — a leaf list can't survive a template
// restructure, which strands every file the restructure retired.
const OWNED_TREES = ['.claude', '.template-docs', '.github/scripts'];

// Carved out of the owned-tree sweep: inside these, "not in the template" doesn't mean
// "retired" — a project adds its own files here, or they aren't template content at all. Cost in
// a MARKERLESS project: a retired command or agent lingers, which beats deleting the user's own.
const PRUNE_EXEMPT_DIRS = [
  '.claude/hooks',
  '.claude/commands',
  '.claude/agents',
  '.claude/skills',
  '.claude/output-styles',
  '.claude/plugins',
  '.claude/logs',
];

// The dirs ONLY the base→target diff can prune, so with no readable base a retirement inside one
// is left behind. Named once because the report and `--help` both have to state that cost.
const BASE_DIFF_ONLY_DIRS = [
  '.claude/hooks',
  '.claude/commands',
  '.claude/agents',
  '.claude/skills',
  '.github/workflows',
];

// Template-owned files that EXECUTE or govern permissions. Applied like all machinery, but
// reported under their own heading so /upgrade can name them in the summary the user approves.
// The `Dockerfile` is deliberately not here — see ROOT_ADDITIVE_FILES.
const GUARDRAIL_PATHS = [
  '.claude/settings.json',
  '.claude/hooks',
  '.github/workflows',
  '.dockerignore',
];

// Template-owned ROOT files a project may legitimately have had to customise. Reconciled
// ADDITIVELY like existing `web/` config: overwriting a project's `Dockerfile` silently reverts
// the edits its own build needs (e.g. a build-stage placeholder for a validated secret).
const ROOT_ADDITIVE_FILES = ['Dockerfile'];

// Files the template permanently RETIRED — the backstop for retirements neither sweep reaches:
// root files, and guardrail-dir files in a project too old to have a version marker.
const RETIRED_PATHS = [
  '.github/workflows/sync-template.yml',
  '.templatesyncignore',
  '.github/workflows/pr-checks.yml',
  'scripts/parse-logs.ps1', // retired built-in session logging
  // Split into /build-report-maintainer + /build-report-stakeholders
  '.claude/commands/build-report.md',
  '.claude/skills/build-report-all/SKILL.md',
  '.claude/skills/build-report-cost/SKILL.md',
  '.claude/skills/build-report-cost/build-cost-report-template.html',
  '.claude/skills/build-report-cost/generate-build-cost-report.mjs',
  '.claude/skills/build-report-effort/SKILL.md',
  '.claude/skills/build-report-effort/generate-build-effort.mjs',
  '.claude/skills/build-report-effort/generate-build-effort.tests.js',
  // `workflow-insights` became `build-report-cost` 
  '.claude/skills/workflow-insights/SKILL.md',
  '.claude/skills/workflow-insights/generate-insights-report.mjs',
  '.claude/skills/workflow-insights/insights-report-template.html',
  // `/continue` and `/upgrade` both open PRs with `--body`, which suppresses a PR template, so
  // this only ever surfaced on a hand-opened PR — carrying four stale claims when it did.
  '.github/PULL_REQUEST_TEMPLATE.md',
  // The three context hooks and their shared lib, replaced by `.js` ports
  '.claude/hooks/workflow-guard.ps1',
  '.claude/hooks/inject-phase-context.ps1',
  '.claude/hooks/inject-agent-context.ps1',
  '.claude/hooks/lib/workflow-state.ps1',
  // Ported to `.js` by an earlier release that didn't list them here, so markerless projects are
  // still carrying them. Same reasoning as the four above.
  '.claude/hooks/bash-permission-checker.ps1',
  '.claude/hooks/bash-permission-checker.tests.ps1',
  '.claude/hooks/file-permission-checker.ps1',
  // Retired with built-in session logging, alongside `scripts/parse-logs.ps1` above.
  '.claude/logging/capture-context.ps1',
  // Orphaned agent — no command invokes it
  '.claude/agents/design-style-agent.md',
];

// Files the template DEV REPO legitimately ships, which must never appear in a user project
// (`.release-ignore` silently switches off the TDD workflow guard; the workflows fail on every
// push). Separate from RETIRED_PATHS because these are also never APPLIED — otherwise a
// dogfooding run with the dev repo as `--template` copies them in and deletes them again.
const DEV_ONLY_PATHS = [
  '.release-ignore',
  '.github/workflows/publish-template.yml',
  '.github/workflows/template-tests.yml',
];

// The named-backstop sweep: deleted if present, tracked or not. Deliberately NOT here:
// `.github/workflows/docker-build.yml` — deleting by exact name with no tracked check makes a
// filename a containerising user would plausibly author too risky to take.
const DELETE_BY_NAME_PATHS = [...RETIRED_PATHS, ...DEV_ONLY_PATHS];

// Where the base→target diff may delete. Machinery prefixes only: never `web/`,
// `documentation/` or `generated-docs/`, and no root files (RETIRED_PATHS names those).
const BASE_DIFF_PREFIXES = ['.claude/', '.github/', '.template-docs/'];

// web/ entries the reconciler never walks: the app, build output, and the specially-handled pair.
const WEB_SKIP_TOP = new Set([
  'src', 'e2e', 'public', 'node_modules', '.next', '.turbo', 'coverage', '.vercel',
  'package.json', 'package-lock.json',
]);

// Never copy env files except committed `*.example` templates — everything else starting with
// `.env` is treated as a secret and skipped, even from a working-tree source.
function isEnvSecret(relativePath) {
  const fileName = path.basename(relativePath);
  return fileName.startsWith('.env') && !fileName.endsWith('.example');
}

const PACKAGE_SECTIONS = ['dependencies', 'devDependencies', 'scripts'];

// Never applied/pruned even inside an allowlisted dir: dev-only test files/fixtures.
const EXCLUDE = [/\.tests?\.js$/, /(^|[\\/])__fixtures__([\\/]|$)/, /(^|[\\/])__tests__([\\/]|$)/];

function isExcluded(relativePath) {
  return EXCLUDE.some((excludePattern) => excludePattern.test(relativePath));
}

// List files under `root/relativePath` recursively, as `/`-joined paths relative to `root`, so
// tracked-set membership and the report read identically on Windows.
//
// `filtered` (the default) drops dev-only test files/fixtures and env secrets; every copy path
// uses it. The prune sweep passes `filtered: false` and must — filtering both sides makes a stale
// `*.tests.js` in a user project invisible, so it could never be removed.
function listFiles(root, relativePath, filtered = true) {
  const files = [];
  listInto(root, relativePath, filtered, files);
  return files;
}

// Threads ONE accumulator rather than returning an array per level: the obvious
// `files.push(...listFiles(...))` spreads as ARGUMENTS and throws RangeError once a single level
// yields ~130k entries — reachable, since the sweeps walk whole trees including gitignored ones.
function listInto(root, relativePath, filtered, files) {
  const absolutePath = path.join(root, relativePath);
  // ONE stat, not existsSync + statSync — this runs for every entry in a whole-tree walk.
  let stat;
  try {
    stat = fs.statSync(absolutePath);
  } catch {
    return;
  }
  if (stat.isFile()) {
    const skip = filtered && (isExcluded(relativePath) || isEnvSecret(relativePath));
    if (!skip) files.push(relativePath);
    return;
  }
  for (const entry of fs.readdirSync(absolutePath)) listInto(root, `${relativePath}/${entry}`, filtered, files);
}

// Delete one retired file, tolerating "already gone". Never a directory: `rmSync` without
// `recursive` throws EISDIR mid-apply, and `recursive: true` would take the user's own untracked
// files inside it. A path that is now a directory isn't the retired file any more.
function removeFile(absolutePath) {
  let stat;
  try {
    stat = fs.statSync(absolutePath);
  } catch {
    return false; // Not there — nothing to retire.
  }
  if (!stat.isFile()) return false;
  fs.rmSync(absolutePath, { force: true });
  return true;
}

function sameContent(firstPath, secondPath) {
  if (!fs.existsSync(firstPath) || !fs.existsSync(secondPath)) return false;
  return fs.readFileSync(firstPath).equals(fs.readFileSync(secondPath));
}

function copyInto(sourcePath, destinationPath) {
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);
}

// Tolerates a leading UTF-8 BOM: Windows editors and PowerShell `Out-File` write one, and
// JSON.parse would throw on an otherwise-valid package.json.
function readJson(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
}

// Read repo-relative paths out of git. -z + core.quotePath=false so paths with spaces or
// non-ASCII bytes match listFiles' real names, not git's octal-escaped form — a mismatch makes
// the prune sweep delete a still-current file. Returns null on any failure, so callers fail closed.
function gitPathSet(root, args) {
  try {
    const output = execFileSync('git', ['-c', 'core.quotePath=false', '-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return new Set(output.split('\0').filter(Boolean));
  } catch {
    return null;
  }
}

// The files git tracks — so a `--template <working-dir>` source behaves like a fetched clone
// (tracked files only). Also used on the PROJECT side, to tell template content from local state.
function gitTracked(root) {
  return gitPathSet(root, ['ls-files', '-z']);
}

function templateFiles(templateRoot, relativePath, tracked, filtered = true) {
  const files = listFiles(templateRoot, relativePath, filtered);
  return tracked ? files.filter((file) => tracked.has(file)) : files;
}

// The files a given ref ships — read from git, so the base→target diff can ask about a ref that
// isn't checked out, without a second clone.
function gitFilesAtRef(repoRoot, ref) {
  return gitPathSet(repoRoot, ['ls-tree', '-r', '--name-only', '-z', ref]);
}

// Fetch one tag into an existing shallow clone — a single commit, no checkout. Throws if the ref
// can't be fetched (deleted tag, offline, a branch); callers treat that as "no base available".
function fetchRef(repoRoot, ref) {
  execFileSync(
    'git',
    ['-C', repoRoot, 'fetch', '--depth', '1', '--quiet', 'origin', `refs/tags/${ref}:refs/tags/${ref}`],
    { stdio: 'pipe' },
  );
}

// Copy template files under the given paths into the project (add or overwrite).
// DEV_ONLY_PATHS wins over the apply lists — see that list.
function applyPaths(templateRoot, projectRoot, paths, tracked) {
  const added = [];
  const updated = [];
  for (const relativePath of paths) {
    for (const file of templateFiles(templateRoot, relativePath, tracked)) {
      if (DEV_ONLY_PATHS.includes(file)) continue;
      const sourcePath = path.join(templateRoot, file);
      const destinationPath = path.join(projectRoot, file);
      const exists = fs.existsSync(destinationPath);
      if (exists && sameContent(sourcePath, destinationPath)) continue;
      copyInto(sourcePath, destinationPath);
      (exists ? updated : added).push(file);
    }
  }
  return { added: added.sort(), updated: updated.sort() };
}

// Pointing the applier at the template dev repo is uniquely destructive: DEV_ONLY_PATHS deletes
// files the dev repo legitimately OWNS, and applyPaths refuses to put them back.
//
// BOTH files are required, not belt-and-braces: a legacy user project can carry `.release-ignore`
// alone (which is why it's in DEV_ONLY_PATHS), and those most need the clean-up. `CLAUDE.user.md`
// beside it is what makes the pair unambiguous — no user project has that one.
function isTemplateDevRepo(root) {
  return (
    fs.existsSync(path.join(root, '.release-ignore')) && fs.existsSync(path.join(root, 'CLAUDE.user.md'))
  );
}

// Is `relativePath` one of `roots`, or inside one? Shared, so the exempt and guardrail lists
// can't drift into different semantics. (BASE_DIFF_PREFIXES is not one of these — it's a prefix list.)
function isUnder(relativePath, roots) {
  return roots.some((root) => relativePath === root || relativePath.startsWith(`${root}/`));
}

function isPruneExempt(relativePath) {
  return isUnder(relativePath, PRUNE_EXEMPT_DIRS);
}

// "Does the template ship this path?" — the shared test both retirement sweeps need, and the one
// thing standing between a template rename and deleting a user's file.
//
// Case-INSENSITIVE as well as exact: on Windows/macOS a case-only rename in the template
// (`Dev.md` → `dev.md`) doesn't rename the project's file, which then reads back with its old
// casing, isn't in the shipped set, and gets deleted. Being wrong the other way is stale clutter.
function shipsPath(files) {
  const folded = new Set([...files].map((file) => file.toLowerCase()));
  return (relativePath) => files.has(relativePath) || folded.has(relativePath.toLowerCase());
}

// Prune retired template files: anything inside a template-owned tree the target no longer ships.
// Two filters keep it safe — PROJECT-TRACKED ONLY (gitignored local state inside an owned tree
// must survive, so a null set deletes nothing rather than guess) and PRUNE_EXEMPT_DIRS. Both sides
// are listed unfiltered; see listFiles for why that's required.
function mirrorDeleteRetired(templateRoot, projectRoot, trees, tracked, projectTracked) {
  if (!projectTracked) return [];
  const removed = [];
  for (const tree of trees) {
    // Fail closed PER TREE: a template missing a whole owned tree is far likelier truncated
    // (partial clone, mis-pointed --template) than to have retired every file in it. A genuine
    // whole-tree retirement still lands via the base→target diff or a RETIRED_PATHS entry.
    if (!fs.existsSync(path.join(templateRoot, tree))) continue;
    const ships = shipsPath(new Set(templateFiles(templateRoot, tree, tracked, false)));
    // A DISK walk, not the git index, on both sides: the index names paths that may no longer be
    // on disk, and `templateFiles` is shared with the copy paths, where that means a
    // `copyFileSync` throwing ENOENT mid-apply with machinery already on the branch.
    for (const file of listFiles(projectRoot, tree, false)) {
      if (ships(file) || isPruneExempt(file)) continue;
      if (!projectTracked.has(file)) continue;
      if (removeFile(path.join(projectRoot, file))) removed.push(file);
    }
  }
  return removed.sort();
}

// Prune what the template retired between the project's base version and the target. The only
// sweep that reaches a guardrail dir: those are exempt from the owned-tree sweep because a project
// may add its own files there, but "the base shipped this exact path and the target doesn't" is
// unambiguous provenance where LOCATION isn't — which makes retirements there self-cleaning.
//
// Any of the three arguments being null makes this a no-op rather than a guess.
function retiredSinceBase(baseFiles, targetFiles, projectRoot, projectTracked) {
  if (!baseFiles || !targetFiles || !projectTracked) return [];
  const ships = shipsPath(targetFiles);
  const removed = [];
  for (const file of baseFiles) {
    // Scope first: the prefix test rejects outright, and is cheaper than the folded lookup.
    if (!BASE_DIFF_PREFIXES.some((prefix) => file.startsWith(prefix))) continue;
    if (ships(file) || !projectTracked.has(file)) continue;
    if (removeFile(path.join(projectRoot, file))) removed.push(file);
  }
  return removed.sort();
}

// Remove directories the prune emptied — git doesn't track dirs, so it never reports these, but
// the user still sees the empty folders. Only ever removes a genuinely empty dir (rmdirSync
// refuses otherwise) and never the project root. Deepest-first, so a subtree collapses all the way
// up. `removedFiles` are always `/`-joined, so posix path maths is right on every platform.
function pruneEmptyDirs(projectRoot, removedFiles) {
  const candidates = new Set();
  for (const relativePath of removedFiles) {
    for (let dir = path.posix.dirname(relativePath); dir && dir !== '.'; dir = path.posix.dirname(dir)) {
      candidates.add(dir);
    }
  }
  const removed = [];
  for (const dir of [...candidates].sort((firstDir, secondDir) => secondDir.split('/').length - firstDir.split('/').length)) {
    try {
      fs.rmdirSync(path.join(projectRoot, dir));
      removed.push(dir);
    } catch {
      // Not empty (or already gone) — leave it. Both are the correct outcome.
    }
  }
  return removed.sort();
}

// The cross-cutting cleanup mirrorDeleteRetired can't do (guardrail dirs, root files).
function removeRetiredPaths(projectRoot, paths) {
  const removed = [];
  for (const relativePath of paths) {
    if (removeFile(path.join(projectRoot, relativePath))) removed.push(relativePath);
  }
  return removed.sort();
}

// Additive: add missing deps/scripts/overrides/engines, never change a value the project already
// has. Writes only if something was added.
function mergePackageAdditions(templatePackagePath, targetPackagePath) {
  const added = { dependencies: [], devDependencies: [], scripts: [], overrides: [], fields: [] };
  if (!fs.existsSync(templatePackagePath) || !fs.existsSync(targetPackagePath)) {
    return { changed: false, added };
  }
  const templatePackage = readJson(templatePackagePath);
  const target = readJson(targetPackagePath);
  for (const section of PACKAGE_SECTIONS) {
    const templateSection = templatePackage[section];
    if (!templateSection || typeof templateSection !== 'object') continue;
    if (!target[section] || typeof target[section] !== 'object') target[section] = {};
    for (const key of Object.keys(templateSection)) {
      if (!(key in target[section])) {
        target[section][key] = templateSection[key];
        added[section].push(section === 'scripts' ? key : `${key}@${templateSection[key]}`);
      }
    }
  }
  // Overrides carry the template's npm-audit security fixes. Not in PACKAGE_SECTIONS because a
  // value can be a nested object rather than a version string, so the rendering above wouldn't apply.
  if (templatePackage.overrides && typeof templatePackage.overrides === 'object') {
    if (!target.overrides || typeof target.overrides !== 'object') target.overrides = {};
    for (const key of Object.keys(templatePackage.overrides)) {
      if (!(key in target.overrides)) {
        const overrideValue = templatePackage.overrides[key];
        target.overrides[key] = overrideValue;
        added.overrides.push(typeof overrideValue === 'string' ? `${key}@${overrideValue}` : key);
      }
    }
  }
  if (templatePackage.engines && !target.engines) {
    target.engines = templatePackage.engines;
    added.fields.push('engines');
  }
  const changed = Object.values(added).some((list) => list.length > 0);
  if (changed) fs.writeFileSync(targetPackagePath, `${JSON.stringify(target, null, 2)}\n`);
  return { changed, added };
}

// Bring package-lock.json back in sync after mergePackageAdditions changed package.json: every CI
// gate starts with `npm ci`, which fails hard on a mismatched pair, and a printed reminder gets
// skipped. --package-lock-only rewrites the lock without building node_modules; --ignore-scripts
// skips the project's own install hooks. `exec` is injectable so tests never invoke npm. A no-op
// when there's no lock to keep in sync.
function defaultNpmLockRefresh(webDir) {
  // Via the shell, so `npm` resolves to npm.cmd on Windows. Fixed constant — no interpolation.
  execSync('npm install --package-lock-only --ignore-scripts --no-audit --no-fund', {
    cwd: webDir,
    stdio: 'pipe',
  });
}

function refreshLockfile(projectRoot, exec = defaultNpmLockRefresh) {
  const webDir = path.join(projectRoot, 'web');
  const packagePath = path.join(webDir, 'package.json');
  const lockPath = path.join(webDir, 'package-lock.json');
  if (!fs.existsSync(packagePath) || !fs.existsSync(lockPath)) {
    return { ran: false, ok: true, reason: 'no web/package-lock.json to refresh' };
  }
  try {
    exec(webDir);
    return { ran: true, ok: true };
  } catch (err) {
    return { ran: true, ok: false, error: err.message };
  }
}

// Template web/ config/tooling files, for add-if-missing.
function listWebConfig(root, tracked) {
  const webPath = path.join(root, 'web');
  if (!fs.existsSync(webPath)) return [];
  const files = [];
  for (const entry of fs.readdirSync(webPath)) {
    if (WEB_SKIP_TOP.has(entry)) continue;
    // One at a time, not spread — same argument-count ceiling listInto exists to avoid.
    for (const file of templateFiles(root, `web/${entry}`, tracked)) files.push(file);
  }
  return files;
}

// Add-if-missing / report-if-changed — never overwrites; a file that changed upstream goes to
// `review` for /upgrade to merge.
function addOrReview(templateRoot, projectRoot, files) {
  const added = [];
  const review = [];
  for (const file of files) {
    const sourcePath = path.join(templateRoot, file);
    const destinationPath = path.join(projectRoot, file);
    if (!fs.existsSync(destinationPath)) {
      copyInto(sourcePath, destinationPath);
      added.push(file);
    } else if (!sameContent(sourcePath, destinationPath)) {
      review.push(file);
    }
  }
  return { added, review };
}

// The additive half of an upgrade: web/ config, ROOT_ADDITIVE_FILES, and package.json additions.
function reconcileWeb(templateRoot, projectRoot, tracked) {
  const rootFiles = ROOT_ADDITIVE_FILES.flatMap((relativePath) => templateFiles(templateRoot, relativePath, tracked));
  const { added, review } = addOrReview(templateRoot, projectRoot, [
    ...listWebConfig(templateRoot, tracked),
    ...rootFiles,
  ]);
  const packageMerge = mergePackageAdditions(path.join(templateRoot, 'web/package.json'), path.join(projectRoot, 'web/package.json'));
  return { added: added.sort(), review: review.sort(), pkg: packageMerge };
}

// Pure reconcile step — no network, so tests exercise it offline; the network steps live in main().
// `options.baseFiles` is the file set the project's BASE version shipped, for the retirement diff.
// The returned `baseDiffRan` says whether that diff actually happened — supplying baseFiles isn't
// enough, it also needs a git template source and a git project.
function applyTemplate(templateRoot, projectRoot, options = {}) {
  // Before any write, so a mis-pointed --project can't strip the repo's release infrastructure.
  if (isTemplateDevRepo(projectRoot)) {
    throw new Error(
      `${projectRoot} is the template dev repo, not a project to upgrade — refusing to reconcile ` +
        '(this would delete .release-ignore and the dev-only workflows, and they would not be restored).',
    );
  }
  // Fail closed the other way: a mis-pointed `--template` yields an empty template file set, and
  // mirrorDeleteRetired would then delete ALL the project's machinery. Content, not existence — an
  // empty `.claude/` dir is exactly the aborted-fetch shape this catches.
  if (listFiles(templateRoot, '.claude', false).length === 0) {
    throw new Error(
      `not a template: ${templateRoot} has no .claude/ content — refusing to reconcile (this would delete your machinery).`,
    );
  }
  const tracked = gitTracked(templateRoot);
  const machinery = applyPaths(templateRoot, projectRoot, MACHINERY_PATHS, tracked);
  const guardrails = applyPaths(templateRoot, projectRoot, GUARDRAIL_PATHS, tracked);
  // A new ignore rule can't untrack what git already tracks, so this protects the NEXT upgrade —
  // and stops /upgrade's `git add -A` committing state the template has since started ignoring.
  const gitignore = mergeGitignoreAdditions(templateRoot, projectRoot);

  // Both tracked-filtered sweeps fail closed on a null set themselves. `pruneRan` reports it, so a
  // short "retired" list doesn't read as "nothing to remove". DELETE_BY_NAME_PATHS still runs — it
  // names exact paths a project never owns, so it needs no tracked set to be safe.
  const projectTracked = gitTracked(projectRoot);
  const pruneRan = Boolean(projectTracked);
  // Reported so buildReport can't claim a diff that never happened.
  const baseDiffRan = Boolean(options.baseFiles && options.baseFiles.size && tracked && projectTracked);
  // Dedupe: the sweeps overlap by design, so the same file can be reported twice.
  const retired = [
    ...new Set([
      ...mirrorDeleteRetired(templateRoot, projectRoot, OWNED_TREES, tracked, projectTracked),
      ...retiredSinceBase(options.baseFiles, tracked, projectRoot, projectTracked),
      ...removeRetiredPaths(projectRoot, DELETE_BY_NAME_PATHS),
    ]),
  ].sort();
  const web = reconcileWeb(templateRoot, projectRoot, tracked);
  // After the machinery, so the hooks that read the identity file are in place first.
  const collection = writeCollectionIdentity(
    projectRoot,
    'receiverUrl' in options ? options.receiverUrl : DEFAULT_RECEIVER_URL,
  );
  pruneEmptyDirs(projectRoot, retired);
  return { machinery, guardrails, gitignore, retired, web, pruneRan, baseDiffRan, collection };
}

// Bring `.gitignore` up to date ADDITIVELY — a mixed file, like web/package.json. More than a
// tidy-up: the retirement sweeps spare local state by asking what git TRACKS, so a `.gitignore`
// predating a rule is what turns `.claude/settings.local.json` into a tracked file the NEXT
// upgrade is entitled to delete. Appended at the end, which is order-sensitive and so makes the
// template's rule win.
function mergeGitignoreAdditions(templateRoot, projectRoot) {
  const templateGitignorePath = path.join(templateRoot, '.gitignore');
  const projectGitignorePath = path.join(projectRoot, '.gitignore');
  if (!fs.existsSync(templateGitignorePath)) return { changed: false, added: [] };

  // Bare patterns only: blanks and comments carry no rule, and the project may use its own headings.
  const patterns = (text) => text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
  const existing = fs.existsSync(projectGitignorePath) ? fs.readFileSync(projectGitignorePath, 'utf8') : '';
  const knownPatterns = new Set(patterns(existing));
  const added = [];
  for (const pattern of patterns(fs.readFileSync(templateGitignorePath, 'utf8'))) {
    if (knownPatterns.has(pattern)) continue;
    knownPatterns.add(pattern); // The template may list the same pattern under two headings.
    added.push(pattern);
  }
  if (!added.length) return { changed: false, added: [] };

  const body = existing && !existing.endsWith('\n') ? `${existing}\n` : existing;
  fs.writeFileSync(projectGitignorePath, `${body}\n# Added by the template update\n${added.join('\n')}\n`);
  return { changed: true, added };
}

// Mints the project's transcript-collection identity during an upgrade, so it is committed with
// it. At the project root, not under `.claude`: that is an OWNED_TREE, so the next upgrade would
// prune it as unknown.
//
// Only when absent: a second id would orphan everything already uploaded. The dev-repo check
// repeats applyTemplate's because this function is also exported on its own.
function writeCollectionIdentity(projectRoot, receiverUrl) {
  const identityPath = path.join(projectRoot, COLLECTION_FILE);
  // Any file at all, even one that won't parse.
  if (fs.existsSync(identityPath)) return { created: false, reason: 'present' };
  if (fs.existsSync(path.join(projectRoot, '.release-ignore'))) return { created: false, reason: 'dev_repo' };
  // Passed in, not resolved here: the core's resolver honours STADIUM_RECEIVER_URL, which could
  // stamp a maintainer's local receiver into a client project.
  const minted = mintCollectionFile(identityPath, receiverUrl);
  if (!minted.created) return minted;
  return { created: true, projectId: minted.collection.projectId };
}

// The marker lives at the PROJECT ROOT, not generated-docs/, so it survives a fresh clone and a
// hand-done file-copy upgrade — not only a scripted /upgrade.
function writeVersionStamp(projectRoot, ref, isoTime) {
  const stamp = { templateRef: ref, appliedAt: isoTime, source: 'apply-template.js' };
  fs.writeFileSync(path.join(projectRoot, 'template-version.json'), `${JSON.stringify(stamp, null, 2)}\n`);
}

// The base version the project is on. main() defaults --base to this, so the only sweep that
// reaches `.claude/hooks/` and `.github/workflows/` can't be lost to a forgotten flag — a silent
// failure, since the run still succeeds. Null for "no base"; never throws, so a corrupt marker
// degrades the sweep instead of aborting the upgrade.
function readVersionStamp(projectRoot) {
  try {
    const { templateRef } = readJson(path.join(projectRoot, 'template-version.json'));
    return typeof templateRef === 'string' && templateRef ? templateRef : null;
  } catch {
    return null;
  }
}

// Resolve the file set the BASE version shipped. Tries the ref as it stands, fetches it otherwise;
// null when it can't be resolved. `mayFetch` is true only for a clone THIS script created — a
// `git fetch` into a caller's `--template <dir>` writes a tag into their repo and marks a full
// clone shallow, which a read-only reconcile has no business doing.
function resolveBaseFiles(templateRoot, baseRef, mayFetch) {
  // `.size`, not truthiness: an empty Set is truthy, and `ls-tree` exits 0 with no output for a
  // ref it can't really read — which would claim a base→target diff that examined nothing.
  const direct = gitFilesAtRef(templateRoot, baseRef);
  if (direct && direct.size) return direct;
  if (!mayFetch) return null;
  try {
    fetchRef(templateRoot, baseRef);
  } catch {
    return null;
  }
  return gitFilesAtRef(templateRoot, baseRef);
}

// Set on the child when a run is handed to the freshly fetched applier: stops it re-execing again
// (it would loop), and tells it the clone it was handed is one WE fetched, so it may fetch into it.
const REEXEC_ENV = 'STADIUM_APPLIER_REEXEC';

// Hand this run over to the applier from the version being installed. /upgrade Step 3 runs the
// PROJECT's copy — the OLD version — so without this every fix to the applier itself arrives one
// release late. Only against a clone THIS script fetched, and only when the two files differ.
//
// The clone's lifecycle stays with the PARENT (the child gets `--template`, so it neither prints
// `TEMPLATE_DIR=` nor removes the temp dir). This makes the CLI a compatibility surface: the new
// applier runs with the OLD one's arguments, so flags may be added but not removed or renamed.
function reexecFetchedApplier(cloneRoot, argv) {
  if (process.env[REEXEC_ENV]) return null;
  const fetchedApplierPath = path.join(cloneRoot, '.claude', 'scripts', 'apply-template.js');
  if (!fs.existsSync(fetchedApplierPath) || sameContent(fetchedApplierPath, __filename)) return null;
  try {
    execFileSync(process.execPath, [fetchedApplierPath, ...argv, '--template', cloneRoot], {
      stdio: 'inherit',
      env: { ...process.env, [REEXEC_ENV]: '1' },
    });
    return 0;
  } catch (err) {
    // The child already printed its diagnosis. A signal (no numeric status) is still a failure.
    return typeof err.status === 'number' ? err.status : 2;
  }
}

function fetchTemplate(repo, ref) {
  const cloneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stadium8-template-'));
  try {
    execFileSync('git', ['clone', '--depth', '1', '--branch', ref, repo, cloneDir], { stdio: 'pipe' });
  } catch (err) {
    // Don't leak the empty/partial temp dir when the clone fails (bad ref, offline).
    fs.rmSync(cloneDir, { recursive: true, force: true });
    throw err;
  }
  return cloneDir;
}

function bullets(items) {
  return items.length ? items.map((item) => `- \`${item}\``).join('\n') : '_(none)_';
}

function buildReport({
  machinery,
  guardrails,
  retired,
  web,
  ref,
  lockfile,
  gitignore = { changed: false, added: [] },
  base = null,
  pruneRan = true,
  collection = { created: false },
}) {
  const changed = (applyResult) => [...applyResult.added, ...applyResult.updated];
  const section = (label, items) => [`**${label} (${items.length}):**`, bullets(items), ''];
  const lines = ['# Template update applied', ''];
  lines.push(
    `Brought template machinery up to date with \`${ref}\`. Only template-owned files were`,
    'touched — your app code (`web/src`, `web/e2e`, `web/public`), specs, and output were not.',
    '',
    `## Machinery (${changed(machinery).length} applied, ${retired.length} retired)`,
    '',
    ...section('Added', machinery.added),
    ...section('Updated', machinery.updated),
    ...section('Removed / retired', retired),
  );
  // Say which sweeps ran, so a short "retired" list reads as "nothing to remove" rather than "the
  // sweep didn't happen". A missing base and an unreadable one leave the same gap, so one sentence
  // covers both; the dirs are read off the constant so exempting another can't overclaim coverage.
  if (!pruneRan) {
    lines.push(
      '> ⚠️ Retired-file sweep skipped: the project is not a git repo, so only the explicitly',
      '> named retired files were removed.',
      '',
    );
  } else if (base && base.available) {
    lines.push(`_Retired files pruned, including anything the template dropped between \`${base.ref}\` and \`${ref}\`._`, '');
  } else {
    const missingBaseReason = base
      ? `The base version (\`${base.ref}\`) couldn't be read`
      : 'This project has no version marker to compare against';
    lines.push(
      `_Retired files were pruned from the template-owned trees. ${missingBaseReason}, so retirements inside`,
      `${BASE_DIFF_ONLY_DIRS.map((dir) => `\`${dir}/\``).join(', ')} were not diffed — only known ones removed._`,
      '',
    );
  }
  if (collection.created) {
    lines.push(
      '**`transcript-collection.json` added at the project root.**',
      '',
      'This project now records Claude Code sessions and sends them to Twenty57. A short notice',
      'appears under your first message in each session.',
      'Keep the file: it is what ties this project to its own records. It is committed as part of',
      'this upgrade.',
      '',
    );
  }
  if (gitignore.changed) {
    lines.push(
      ...section('`.gitignore` entries added', gitignore.added),
      '_Added at the end; nothing already there was changed or reordered._',
      '',
    );
  }
  lines.push(
    '## web/ and root config',
    '',
    ...section('Config/tooling added', web.added),
  );
  if (web.pkg.changed) {
    const packageAdditions = web.pkg.added;
    lines.push('**package.json additions:**');
    // Off PACKAGE_SECTIONS plus the two handled specially, so a new section can't go unreported.
    for (const sectionName of [...PACKAGE_SECTIONS, 'overrides', 'fields']) {
      if (packageAdditions[sectionName] && packageAdditions[sectionName].length) lines.push(`- ${sectionName}: ${packageAdditions[sectionName].map((addition) => `\`${addition}\``).join(', ')}`);
    }
    lines.push('');
    // Report which happened, so /upgrade knows whether the lock is in the branch already.
    if (lockfile && lockfile.ran && lockfile.ok) {
      lines.push('_`web/package-lock.json` was refreshed to match — both files are in this branch to review._', '');
    } else if (lockfile && lockfile.ran && !lockfile.ok) {
      lines.push(
        '> ⚠️ **The lockfile could NOT be refreshed automatically** — `web/package.json` changed but',
        "> `web/package-lock.json` did not, so CI's `npm ci` will fail until they match. While online,",
        '> run `(cd web && npm install)`, then commit the updated `web/package-lock.json`.',
        '',
      );
    } else {
      // Not attempted (an older caller, or --skip-lockfile): the manual pass is REQUIRED.
      lines.push(
        '_Required: run `(cd web && npm install)` and commit `web/package-lock.json` — otherwise CI `npm ci` fails._',
        '',
      );
    }
  } else {
    lines.push('_No package.json additions._', '');
  }
  lines.push(
    ...section('Changed upstream but left untouched — /upgrade should merge if you customised them', web.review),
    '## Guardrail files — name these in the upgrade summary',
    '',
  );
  // A DELETED hook or workflow governs permissions as much as a changed one, and the base→target
  // diff is the first sweep that can delete them — so they belong here, not only under machinery.
  const retiredGuardrails = retired.filter((relativePath) => isUnder(relativePath, GUARDRAIL_PATHS));
  const guardrailBlocks = [];
  if (changed(guardrails).length) {
    guardrailBlocks.push(
      'Applied like all machinery. They execute or govern permissions, so say so in the summary:\n\n' +
        bullets(changed(guardrails)),
    );
  }
  if (retiredGuardrails.length) {
    guardrailBlocks.push(
      'REMOVED as retired — name these deletions in the summary too:\n\n' +
        bullets(retiredGuardrails),
    );
  }
  lines.push(guardrailBlocks.length ? guardrailBlocks.join('\n\n') : '_No guardrail changes._', '');
  return `${lines.join('\n')}\n`;
}

function parseArgs(argv) {
  const args = { ref: null, base: null, repo: DEFAULT_SOURCE_REPO, report: null, template: null, project: '.', keepClone: false, skipLockfile: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--ref') args.ref = argv[++i];
    else if (arg === '--base') args.base = argv[++i];
    else if (arg === '--repo') args.repo = argv[++i];
    else if (arg === '--report') args.report = argv[++i];
    else if (arg === '--template') args.template = argv[++i];
    else if (arg === '--project') args.project = argv[++i];
    else if (arg === '--keep-clone') args.keepClone = true;
    else if (arg === '--skip-lockfile') args.skipLockfile = true;
  }
  return args;
}

function showHelp() {
  process.stdout.write(
    [
      'Apply template updates (the /upgrade delivery step)',
      '',
      'Usage:',
      '  node apply-template.js --ref <tag-or-branch> [--base <tag>] [--report <file>] [--skip-lockfile]',
      '  node apply-template.js --template <dir> --project <dir> [--base <tag>] [--report <file>] [--skip-lockfile]',
      '',
      'Applies machinery + guardrails, prunes retired machinery, and reconciles web/',
      'additively. Never touches your app (web/src|e2e|public), specs, or the mixed files',
      '(CLAUDE.md / existing web/ config / the root Dockerfile), which /upgrade merges. When it',
      'changes package.json it regenerates web/package-lock.json to match (npm install',
      '--package-lock-only); --skip-lockfile opts out for offline runs.',
      '',
      "--base is the version the project currently has. It defaults to the project's own",
      'template-version.json templateRef, so you rarely need to pass it. It lets the update also',
      'remove files the template retired inside the dirs that are otherwise never pruned because a',
      'project may add its own files there:',
      ...BASE_DIFF_ONLY_DIRS.map((dir) => `  ${dir}/`),
      'Without a base (an unstamped project, a deleted tag, offline) those retirements are left alone.',
      '',
    ].join('\n'),
  );
}

function main(argv, nowIso) {
  const args = parseArgs(argv);
  if (args.help) {
    showHelp();
    return 0;
  }
  let templateRoot = args.template;
  let cleanup = null;
  let keptForReuse = false;
  const ref = args.ref || 'local';
  if (!templateRoot) {
    if (!args.ref) {
      process.stderr.write('Error: pass --ref <tag> (to fetch) or --template <dir> (pre-fetched).\n');
      return 2;
    }
    try {
      templateRoot = fetchTemplate(args.repo, args.ref);
      cleanup = templateRoot;
    } catch (err) {
      process.stderr.write(
        `Error: could not fetch the template (${args.repo} @ ${args.ref}).\n` +
          'Check your network and that the ref exists, then retry.\n' +
          `Details: ${err.message}\n`,
      );
      return 2;
    }
  }
  try {
    if (!fs.existsSync(templateRoot) || !fs.existsSync(args.project)) {
      process.stderr.write(`Error: template (${templateRoot}) or project (${args.project}) not found.\n`);
      return 2;
    }
    // The `TEMPLATE_DIR=` line on stderr is the contract /upgrade Step 3 parses, so it has one author.
    const keepCloneForUpgrade = () => {
      process.stderr.write(`TEMPLATE_DIR=${templateRoot}\n`);
      keptForReuse = true;
    };
    // Only on the clone path — never re-exec a caller's --template dir.
    if (cleanup) {
      const handedOver = reexecFetchedApplier(templateRoot, argv);
      if (handedOver !== null) {
        if (handedOver === 0 && args.keepClone) keepCloneForUpgrade();
        return handedOver;
      }
    }
    // Before reconciling, so the retirement diff runs in the same pass; a base that can't be read
    // costs only the guardrail-dir retirements, and the report says so. After a hand-over the child
    // has no `cleanup` of its own, but its clone IS one we fetched — REEXEC_ENV is how it knows.
    const ownsClone = Boolean(cleanup) || Boolean(process.env[REEXEC_ENV]);
    // --base wins; otherwise read it off the project's own marker (see readVersionStamp).
    const baseRef = args.base || readVersionStamp(args.project);
    const baseFiles = baseRef ? resolveBaseFiles(templateRoot, baseRef, ownsClone) : null;
    const result = applyTemplate(templateRoot, args.project, { baseFiles });
    // "available" means the diff actually RAN, not just that the base resolved.
    const base = baseRef ? { ref: baseRef, available: result.baseDiffRan } : null;
    if (args.ref) writeVersionStamp(args.project, ref, nowIso);
    // --skip-lockfile opts out for offline runs that can't reach the registry; the report then
    // flags the manual pass as required.
    let lockfile;
    if (result.web.pkg.changed && !args.skipLockfile) {
      lockfile = refreshLockfile(args.project);
    }
    const report = buildReport({ ...result, ref, lockfile, base });
    if (args.report) {
      fs.mkdirSync(path.dirname(path.resolve(args.report)), { recursive: true });
      fs.writeFileSync(args.report, report);
      process.stdout.write(`Report written to ${args.report}\n`);
    } else {
      process.stdout.write(report);
    }
    // Exit non-zero so /upgrade halts instead of merging a branch whose `npm ci` must fail.
    if (lockfile && lockfile.ran && !lockfile.ok) {
      process.stderr.write(
        'Error: web/package.json changed but the lockfile could not be refreshed ' +
          `(${lockfile.error}).\n` +
          "CI's `npm ci` will fail until they match. While online, run `(cd web && npm install)`,\n" +
          'commit web/package-lock.json, then re-run the upgrade.\n',
      );
      return 2;
    }
    if (cleanup && args.keepClone) keepCloneForUpgrade();
    return 0;
  } catch (err) {
    // Fail closed: report the cause rather than a raw stack trace. Some files may already be
    // applied — /upgrade runs on a throwaway branch, so a half-applied tree never reaches `main`.
    process.stderr.write(
      `Error: the update did not complete (${err.message}).\n` +
        'Some files may have been partially applied — review the branch diff and discard\n' +
        'it if needed, then fix the cause and re-run.\n',
    );
    return 2;
  } finally {
    // Unless we handed the path to /upgrade, so a --keep-clone failure doesn't orphan the temp dir.
    if (cleanup && !keptForReuse) fs.rmSync(cleanup, { recursive: true, force: true });
  }
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2), new Date().toISOString()));
}

module.exports = {
  MACHINERY_PATHS,
  OWNED_TREES,
  PRUNE_EXEMPT_DIRS,
  BASE_DIFF_ONLY_DIRS,
  BASE_DIFF_PREFIXES,
  GUARDRAIL_PATHS,
  ROOT_ADDITIVE_FILES,
  RETIRED_PATHS,
  DEV_ONLY_PATHS,
  DELETE_BY_NAME_PATHS,
  WEB_SKIP_TOP,
  EXCLUDE,
  isExcluded,
  isEnvSecret,
  isUnder,
  isPruneExempt,
  isTemplateDevRepo,
  listFiles,
  gitTracked,
  applyPaths,
  mirrorDeleteRetired,
  retiredSinceBase,
  removeRetiredPaths,
  pruneEmptyDirs,
  mergePackageAdditions,
  mergeGitignoreAdditions,
  refreshLockfile,
  reconcileWeb,
  applyTemplate,
  writeVersionStamp,
  writeCollectionIdentity,
  readVersionStamp,
  buildReport,
  parseArgs,
  reexecFetchedApplier,
  REEXEC_ENV,
};

#!/usr/bin/env node
/**
 * collect-build-report-data.js
 *
 * Produces a "how did this build actually go?" retrospective payload for the
 * /build-report-maintainer and /build-report-stakeholders pages. Everything here is DERIVED from artifacts the workflow
 * already writes — nothing is invented, so the report reads identically every run:
 *
 *   Timeline + effort  ← git commit timestamps (author date), clustered into
 *                        working sessions by an idle-gap threshold. "Active build
 *                        time" is the summed span of those sessions — a floor, not
 *                        a stopwatch (a lone commit contributes ~0), stated as such
 *                        in the report so it can't be read as billing precision.
 *   Per-epic effort    ← commits attributed to an epic by their conventional-commit
 *                        scope (`feat(<slug>/story-N)`, `docs(<slug>)`, …), plus the
 *                        epic's own state.json (stories, manual-test outcome).
 *   Stumbling blocks   ← generated-docs/template-feedback.md — the workflow's own
 *                        curated log of tooling friction — one entry per `## ` head.
 *   Rework signal      ← git `fix(...)` / manual-test-fix commits + each story's
 *                        e2eStatus === "passed-after-fix" in state.json.
 *   Code & app stats   ← tracked files under web/src + web/e2e (LOC by layer,
 *                        components, routes, test blocks) and web/package.json
 *                        diffed against its first committed version (deps added).
 *   Churn              ← git --numstat over web/ (lockfile excluded), attributed
 *                        per commit so rework cost is measurable in lines.
 *   Performance        ← ratios derived from the above: first-pass E2E yield,
 *                        rework share, velocity per story, test-to-code ratio.
 *   Cost & effort      ← generated-docs/reports/build-cost-data.json — the
 *                        exact transcript-derived tokens/cost/user-inputs/waits the
 *                        cost generator writes. Summarised here (null when
 *                        absent); this script never parses transcripts itself.
 *   Gate history       ← generated-docs/quality-gate-runs.jsonl, appended by
 *                        quality-gates.js on every run (null when absent).
 *
 * Report inputs and outputs it reads live under generated-docs/reports/ (REPORTS_DIR) —
 * the one folder every /build-report-* command generates into. The gate-run log is the
 * exception: /quality-check appends it during the build, so it stays in generated-docs/.
 *   Data quality       ← a manifest of which sources above were found, plus every
 *                        assumption/estimate — rendered verbatim in the report.
 *   Narrative          ← each epic's journal.md, surfaced verbatim for the reader.
 *
 * Usage:
 *   node .claude/scripts/collect-build-report-data.js                 # JSON to stdout
 *   node .claude/scripts/collect-build-report-data.js --format=text   # compact text
 *   node .claude/scripts/collect-build-report-data.js --root <dir>    # operate on <dir>
 *   node .claude/scripts/collect-build-report-data.js --gap <minutes> # session idle gap (default 45)
 *
 * Empty/fresh projects (no project.md) return { status: "no_project" }; a project
 * with legacy state returns { status: "legacy_detected" } — the report surfaces the
 * same guidance the dashboard does rather than rendering a blank page.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { tryGit } = require('./lib/git');
const { projectStatus } = require('./lib/project-status');
const { EPICS_DIR, PROJECT_MD_PATH, REPORTS_DIR } = require('./resolve-state-path');
const { getProjectRoot } = require('./lib/project-root');
const { parseEpicPlan } = require('./collect-dashboard-data'); // shared "## Epics" table parser (require.main-guarded — no side effects)
// Story roll-ups and the terminal-phase test, from the canonical state module.
const { summariseStories, isTerminalPhase } = require('./lib/epic-state');

const EPIC_PLAN_PATH = 'generated-docs/epic-plan.md';
const TEMPLATE_FEEDBACK_PATH = 'generated-docs/template-feedback.md';
const INSIGHTS_DATA_PATH = `${REPORTS_DIR}/build-cost-data.json`; // written by the cost generator
const EFFORT_DATA_PATH = `${REPORTS_DIR}/build-effort-data.json`; // written by the effort generator
const GATE_RUNS_PATH = 'generated-docs/quality-gate-runs.jsonl'; // appended by quality-gates.js on every run
const REPORT_META_PATH = `${REPORTS_DIR}/report-meta.json`; // { team } — asked once by /build-report-maintainer
const DEFAULT_GAP_MIN = 45; // commits more than this far apart start a new work session

function parseArgs(argv) {
  const args = { root: getProjectRoot(), format: 'json', gapMin: DEFAULT_GAP_MIN };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root') args.root = path.resolve(argv[++i]);
    else if (arg.startsWith('--format=')) args.format = arg.split('=')[1];
    else if (arg === '--format') args.format = argv[++i];
    else if (arg === '--gap') { const gapMinutes = Number(argv[++i]); args.gapMin = Number.isFinite(gapMinutes) && gapMinutes >= 0 ? gapMinutes : DEFAULT_GAP_MIN; }
  }
  return args;
}

function readFileIf(root, relativePath) {
  const absolutePath = path.join(root, relativePath);
  try { return fs.readFileSync(absolutePath, 'utf8'); } catch { return null; }
}

// ── Git history → commits + churn (one traversal) ────────────────────────────
// A single `git log --all --no-merges --numstat` walk feeds BOTH the commit list
// (parseCommits) and the per-commit churn map (parseNumstat), so the whole history is
// walked once, not twice. Author date (%aI) is when the work happened; %H/%s identify
// it. Unit + record separators (0x1f/0x1e) survive any punctuation a commit subject may
// contain, and %x1e leads each record so --numstat's lines attach to the right commit.
function readGitLog(root) {
  return tryGit(root, 'log', '--all', '--no-merges', '--numstat',
    '--pretty=format:%x1e%H\x1f%aI\x1f%s');
}

function parseCommits(raw) {
  if (!raw) return [];
  const seen = new Set();
  const commits = [];
  for (const record of raw.split('\x1e')) {
    // First line of each record is the commit header; the rest are --numstat rows,
    // consumed separately by parseNumstat.
    const header = record.split('\n', 1)[0].replace(/\r$/, '');
    if (!header) continue;
    const [hash, date, subject] = header.split('\x1f');
    if (!hash || !date) continue;
    if (seen.has(hash)) continue;           // --all can list a commit under several refs
    seen.add(hash);
    // Stash bookkeeping commits (`WIP on …`, `index on …`) are not real work moments.
    if (/^(WIP|index) on /.test(subject || '')) continue;
    commits.push({ hash: hash.slice(0, 8), date, subject: subject || '' });
  }
  // Sort by the parsed instant, not the raw ISO string: %aI carries each author's
  // timezone offset, so a lexical compare misorders commits across a DST shift or
  // machines in different zones (and clusterSessions would then read a negative gap).
  commits.sort((firstCommit, secondCommit) => Date.parse(firstCommit.date) - Date.parse(secondCommit.date));
  return commits;
}

const minutesBetween = (startIso, endIso) =>
  Math.round((Date.parse(endIso) - Date.parse(startIso)) / 60000);

// Cluster commits into sessions: a gap larger than gapMin starts a new session.
// Session duration is the span of its own commits (a single-commit session is 0),
// so "active minutes" is a deliberate FLOOR on real effort, never an over-count.
function clusterSessions(commits, gapMin) {
  if (!commits.length) return [];
  const sessions = [];
  let currentSession = null;
  for (const commit of commits) {
    if (currentSession && minutesBetween(currentSession.commits[currentSession.commits.length - 1].date, commit.date) <= gapMin) {
      currentSession.commits.push(commit);
    } else {
      currentSession = { commits: [commit] };
      sessions.push(currentSession);
    }
  }
  return sessions.map((session) => {
    const first = session.commits[0].date;
    const last = session.commits[session.commits.length - 1].date;
    return {
      start: first,
      end: last,
      day: first.slice(0, 10),
      durationMin: Math.max(0, minutesBetween(first, last)),
      commitCount: session.commits.length,
      commits: session.commits
    };
  });
}

// ── Epic slugs + per-epic state ──────────────────────────────────────────────
// Every epic dir on disk (merged epics live under generated-docs/epics on the
// working tree once main is checked out; in-flight ones are there too).
function listEpicSlugs(root) {
  const dir = path.join(root, EPICS_DIR);
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((dirEntry) => dirEntry.isDirectory())
      .map((dirEntry) => dirEntry.name)
      .sort();
  } catch {
    return [];
  }
}

function readState(root, slug) {
  const raw = readFileIf(root, `${EPICS_DIR}/${slug}/state.json`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function readJournal(root, slug) {
  return readFileIf(root, `${EPICS_DIR}/${slug}/journal.md`);
}

// ── Code & app stats ─────────────────────────────────────────────────────────
// Tracked files only (git ls-files) so scratch/untracked files never skew counts.
const CODE_FILE_EXTENSION = /\.(ts|tsx|js|jsx|css)$/;

function classifySourceFile(relativePath) {
  const normalizedPath = relativePath.replace(/\\/g, '/');
  if (!CODE_FILE_EXTENSION.test(normalizedPath)) return null;
  if (normalizedPath.startsWith('web/e2e/')) return 'e2e';
  if (!normalizedPath.startsWith('web/src/')) return null;
  if (/(^|\/)__tests__\//.test(normalizedPath) || /\.(test|spec)\.[jt]sx?$/.test(normalizedPath)) return 'unitTests';
  return 'source';
}

// Count executable test blocks. `test.fixme(` / `test.skip(` deliberately do NOT
// match the test/it pattern (the dot breaks `\s*\(`), so they're counted apart.
function countTestBlocks(sourceText) {
  return {
    test: (sourceText.match(/\b(?:test|it)(?:\.each\s*\([^)]*\))?\s*\(/g) || []).length,
    fixme: (sourceText.match(/\btest\.fixme\s*\(/g) || []).length
  };
}

function codebaseStats(root) {
  const stats = {
    loc: { source: 0, unitTests: 0, e2e: 0, total: 0 },
    files: { source: 0, unitTests: 0, e2e: 0 },
    components: 0,
    routes: 0,
    tests: { unitFiles: 0, unitBlocks: 0, e2eSpecs: 0, e2eBlocks: 0, e2eFixmes: 0 }
  };
  const raw = tryGit(root, 'ls-files', '-z', 'web/src', 'web/e2e');
  if (!raw) return stats;
  for (const relativePath of raw.split('\0')) {
    if (!relativePath) continue;
    const kind = classifySourceFile(relativePath);
    if (!kind) continue;
    const content = readFileIf(root, relativePath);
    if (content == null) continue; // tracked but deleted in the working tree
    stats.loc[kind] += content ? content.replace(/\n$/, '').split('\n').length : 0;
    stats.files[kind]++;
    const normalizedPath = relativePath.replace(/\\/g, '/');
    if (kind === 'source') {
      if (/^web\/src\/components\/.+\.tsx$/.test(normalizedPath)) stats.components++;
      if (/^web\/src\/app\/.*page\.tsx$/.test(normalizedPath)) stats.routes++;
    } else if (kind === 'unitTests') {
      stats.tests.unitFiles++;
      stats.tests.unitBlocks += countTestBlocks(content).test;
    } else {
      const blockCounts = countTestBlocks(content);
      stats.tests.e2eSpecs++;
      stats.tests.e2eBlocks += blockCounts.test;
      stats.tests.e2eFixmes += blockCounts.fixme;
    }
  }
  stats.loc.total = stats.loc.source + stats.loc.unitTests + stats.loc.e2e;
  return stats;
}

// Dependencies the build ADDED: current web/package.json vs its first committed
// version (the template baseline). Removals aren't interesting for this report.
function diffDependencies(baseJson, currentJson) {
  const keys = (packageJson, field) => Object.keys((packageJson && packageJson[field]) || {});
  const baseNames = new Set([...keys(baseJson, 'dependencies'), ...keys(baseJson, 'devDependencies')]);
  return {
    runtime: keys(currentJson, 'dependencies').filter((name) => !baseNames.has(name)).sort(),
    dev: keys(currentJson, 'devDependencies').filter((name) => !baseNames.has(name)).sort()
  };
}

function dependenciesAdded(root) {
  const parse = (text) => { try { return text ? JSON.parse(text) : null; } catch { return null; } };
  const currentPackage = parse(readFileIf(root, 'web/package.json'));
  if (!currentPackage) return { runtime: [], dev: [] };
  const firstHash = (tryGit(root, 'log', '--all', '--reverse', '--format=%H', '--', 'web/package.json') || '')
    .split('\n')[0].trim();
  const basePackage = firstHash ? parse(tryGit(root, 'show', `${firstHash}:web/package.json`)) : null;
  return diffDependencies(basePackage || {}, currentPackage);
}

// ── Churn: lines added/deleted per commit ────────────────────────────────────
// Counted over web/ only (the app itself) and excluding the lockfile, whose
// generated thousands-of-line diffs would swamp the hand-written signal.
function churnCounted(filePath) {
  return /^web\//.test(filePath) && !/^web\/package-lock\.json$/.test(filePath);
}

function parseNumstat(raw) {
  const byCommit = new Map();
  if (!raw) return byCommit;
  for (const record of raw.split('\x1e')) {
    const lines = record.split('\n').map((line) => line.trim()).filter(Boolean);
    if (!lines.length) continue;
    const hash = lines[0].slice(0, 8);
    let added = 0, deleted = 0;
    for (const line of lines.slice(1)) {
      const numstatRow = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (!numstatRow || numstatRow[1] === '-') continue; // binary
      if (!churnCounted(numstatRow[3])) continue;
      added += Number(numstatRow[1]);
      deleted += Number(numstatRow[2]);
    }
    byCommit.set(hash, { add: added, del: deleted }); // --all may repeat a commit; same value, harmless
  }
  return byCommit;
}

// Attribute a commit subject to an epic slug. Conventional-commit scope first
// (`feat(slug/story-N)`, `docs(slug)`), then — for generic scopes like
// `docs(plan): stories for epic <slug>` — a name match anywhere in the subject.
// Slugs are tried longest-first so a slug that is a prefix of another can't
// mis-claim it.
// Whole-word slug matcher, memoised so the fallback loop below doesn't recompile a
// regex per commit×slug. A raw substring test would let a short slug claim any commit
// that merely mentions it inside another word (`data` in "metadata", `ui` in "guidance").
const slugWordRegexCache = new Map();
function slugBoundary(slug) {
  let slugWordRegex = slugWordRegexCache.get(slug);
  if (!slugWordRegex) { slugWordRegex = new RegExp(`\\b${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`); slugWordRegexCache.set(slug, slugWordRegex); }
  return slugWordRegex;
}

function attributeCommit(subject, slugsByLength) {
  const scope = subject.match(/^[a-zA-Z]+\(([^)]+)\)/);
  if (scope) {
    const scopeSlug = scope[1].split('/')[0].trim();
    if (slugsByLength.includes(scopeSlug)) return scopeSlug;
  }
  for (const slug of slugsByLength) {
    if (slugBoundary(slug).test(subject)) return slug;
  }
  return null;
}

// Rework signal in a commit subject. `correct` is matched only as the fix verb/noun
// (correct/corrects/corrected/correcting/correction[s]); the `\b` after the optional suffix
// excludes "correctly"/"correctness", which describe a feature working, not rework.
const FIX_COMMIT_PATTERN = /^(fix|revert)\b|manual-test fix|epic-end.*fix|\bcorrect(?:s|ed|ing|ions?)?\b|\bharden/i;

function summariseManualTest(state) {
  // state.json carries the manual-test result in a few shapes across epics:
  // an array of per-check results, a short manualTestOutcome word, and/or a long
  // manualTestResults/manualTestNote prose string. We return a SHORT label for the
  // headline pill plus the full prose as `note` for the epic body.
  const epic = state?.epic || {};
  // A NON-EMPTY array of per-check results. An empty array is the init-time default
  // (manual test not run yet), NOT a 0-of-0 pass — treat it as "no structured results"
  // so the label falls back to prose or to "not tested yet", never reporting an
  // untested epic as passed. Each element is guarded too (a null entry mustn't crash).
  const checkResults = Array.isArray(epic.manualTestResults) && epic.manualTestResults.length ? epic.manualTestResults : null;
  const prose = epic.manualTestNote || (typeof epic.manualTestResults === 'string' ? epic.manualTestResults : null) || null;
  let passed = null, total = null;
  if (checkResults) { total = checkResults.length; passed = checkResults.filter((result) => result && result.passed).length; }
  // No structured results? Best-effort a "13/15 passed" figure out of the prose.
  if (passed == null && prose) {
    const passedFigure = prose.match(/(\d+)\s*\/\s*(\d+)(?:\s+(?:checks?|tests?))?\s+passed/i);
    if (passedFigure && Number(passedFigure[2]) >= Number(passedFigure[1])) { passed = Number(passedFigure[1]); total = Number(passedFigure[2]); }
  }

  // Short label: prefer an explicit short outcome; else derive. Collapse any verbose
  // outcome string (some epics stored the whole write-up there) to one word.
  const failLike = (text) => /\bfail|mixed/i.test(text) && !/no .*defect|no code defect/i.test(text);
  let label = epic.manualTestOutcome || null;
  if (!label) {
    if (checkResults) label = passed === total ? 'passed' : 'mixed';
    else if (prose) label = failLike(prose) ? 'mixed' : 'passed';
  }
  if (label && label.length > 24) label = failLike(label) ? 'mixed' : 'passed';

  return { outcome: label, note: prose, passed, total };
}

function countStories(state) {
  const stories = state?.stories && typeof state.stories === 'object' ? Object.values(state.stories) : [];
  // total/complete come from the canonical derivation in lib/epic-state.js, so this
  // report, the dashboard and the hooks' injected context can't disagree about them.
  // The e2e tallies below are this report's own, and every predicate guards `story &&`
  // first: a null story entry in a malformed/partially written state.json must be
  // skipped, not crash the whole report.
  const { total, complete } = summariseStories(state?.stories);
  return {
    total,
    complete,
    passedAfterFix: stories.filter((story) => story && story.e2eStatus === 'passed-after-fix').length,
    // First-pass yield inputs: stories whose E2E ran at all, and those that
    // passed without needing the fix cycle.
    withE2e: stories.filter((story) => story && (story.e2eStatus === 'passed' || story.e2eStatus === 'passed-after-fix')).length,
    firstPass: stories.filter((story) => story && story.e2eStatus === 'passed').length
  };
}

// ── Build-flow: per-story timing for the swimlane panel ──────────────────────
// Each story carries orchestrator-written startedAt/completedAt (minute-granular).
// The wrap-up segment is the epic-end work after the last story (review, batched
// E2E, manual test): last story end → the epic's last attributed commit on that
// same calendar day. Older state files without story timestamps yield
// { stories: [] } and the panel degrades gracefully.
function storyFlow(state, epicCommits) {
  // Story SHAs are not stored in state.json (continue.md B5 says so explicitly) — they are
  // derived from the one-commit-per-story convention `feat(<slug>/story-<N>): <title>`, the
  // same way the PR body derives them at B7.2.2. Match the story number in the scope, and
  // take the FIRST such commit: a later `fix(<slug>/story-<N>)` is rework, not the story.
  const storyCommit = (storyNumber) =>
    epicCommits.find((candidate) => {
      const scope = candidate.subject.match(/^feat\(([^)]+)\)/);
      return scope ? new RegExp(`(^|/)story-${storyNumber}$`).test(scope[1].trim()) : false;
    }) || null;
  const stories = Object.entries(state?.stories && typeof state.stories === 'object' ? state.stories : {})
    .filter(([, story]) => story.startedAt && story.completedAt && Date.parse(story.startedAt) <= Date.parse(story.completedAt))
    .map(([storyNumber, story]) => {
      const commit = storyCommit(storyNumber);
      const title = commit ? (commit.subject.match(/:\s*(.+)$/)?.[1] ?? commit.subject) : null;
      return { n: Number(storyNumber), title, startedAt: story.startedAt, completedAt: story.completedAt, commit: commit ? commit.hash : null, e2eStatus: story.e2eStatus || null };
    })
    .sort((firstStory, secondStory) => Date.parse(firstStory.startedAt) - Date.parse(secondStory.startedAt));
  if (!stories.length) return { stories: [], wrapUp: null };
  const lastStory = stories[stories.length - 1];
  const sameDay = (firstDate, secondDate) => String(firstDate).slice(0, 10) === String(secondDate).slice(0, 10); // day as recorded, like formatDate
  const wrapUpCommits = epicCommits.filter((commit) => Date.parse(commit.date) > Date.parse(lastStory.completedAt) && sameDay(commit.date, lastStory.completedAt));
  const wrapUp = wrapUpCommits.length ? { endedAt: wrapUpCommits[wrapUpCommits.length - 1].date, commits: wrapUpCommits.length } : null;
  return { stories, wrapUp };
}

// Parallelism headline over every story interval in the project: total story
// minutes vs the union of the story time windows (wall-clock), peak stories in
// flight, and the share of wall-clock with ≥ 2 stories running. Null when no
// story has timestamps.
function buildFlowStats(intervals) {
  const valid = intervals.filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end >= start);
  if (!valid.length) return null;
  const sorted = valid.slice().sort((first, second) => first[0] - second[0]);
  let unionMs = 0, runStart = null, runEnd = null;
  for (const [start, end] of sorted) {
    if (runEnd === null || start > runEnd) { if (runEnd !== null) unionMs += runEnd - runStart; runStart = start; runEnd = end; }
    else runEnd = Math.max(runEnd, end);
  }
  if (runEnd !== null) unionMs += runEnd - runStart;
  // Sweep: ends before starts at the same instant, so touching ≠ overlapping.
  const events = [];
  for (const [start, end] of valid) events.push([start, 1], [end, -1]);
  events.sort((first, second) => first[0] - second[0] || first[1] - second[1]);
  let inFlight = 0, peak = 0, previousTime = null, multiStoryMs = 0;
  for (const [time, delta] of events) {
    if (previousTime !== null && inFlight >= 2 && time > previousTime) multiStoryMs += time - previousTime;
    inFlight += delta; peak = Math.max(peak, inFlight); previousTime = time;
  }
  const storyMinutes = Math.round(valid.reduce((totalMs, [start, end]) => totalMs + (end - start), 0) / 60000);
  const wallClockMinutes = Math.round(unionMs / 60000);
  return {
    storyMinutes,
    wallClockMinutes,
    parallelism: wallClockMinutes ? +(storyMinutes / wallClockMinutes).toFixed(2) : null,
    peakInFlight: peak,
    overlapPct: unionMs ? Math.round((multiStoryMs / unionMs) * 100) : null
  };
}

function epicPhaseStatus(state) {
  const phase = state?.phase ?? null;
  // COMPLETE-ON-BRANCH is terminal work: the epic is fully built and manually
  // tested, awaiting only the merge to main — count it as delivered, like COMPLETE.
  if (isTerminalPhase(phase)) return 'complete';
  // READY-TO-BUILD is a parked, planned-ahead epic (via /plan): planning is done
  // but no build has started, so it's 'planned', not actively 'in-flight'. (Null
  // phase — a brief with no state — is also just planned.)
  if (phase == null || phase === 'READY-TO-BUILD') return 'planned';
  return 'in-flight';
}

// ── template-feedback.md → stumbling blocks ─────────────────────────────────
// Each `## ` section is one friction entry. Body shapes vary (Source/Issue/Fix
// bullets, or Where/What happens/Impact prose), so we keep the raw body for the
// reader and best-effort a one-line "source" + summary for the card headline.
function parseTemplateFeedback(raw) {
  if (!raw) return [];
  const lines = raw.split(/\r?\n/);
  const blocks = [];
  let currentBlock = null;
  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+?)\s*$/);
    if (headingMatch) {
      if (currentBlock) blocks.push(currentBlock);
      currentBlock = { title: headingMatch[1].trim(), body: [] };
      continue;
    }
    if (line.match(/^#\s+/)) { continue; } // skip the file H1
    if (currentBlock) currentBlock.body.push(line);
  }
  if (currentBlock) blocks.push(currentBlock);

  const fieldValue = (body, labels) => {
    for (const line of body) {
      for (const label of labels) {
        const fieldRegex = new RegExp(`^[-*]?\\s*\\*\\*${label}[:.]?\\*\\*\\s*(.+)$`, 'i');
        const fieldMatch = line.match(fieldRegex);
        if (fieldMatch) return fieldMatch[1].trim();
      }
    }
    return null;
  };

  return blocks.map((block) => {
    const body = block.body.join('\n').trim();
    const source = fieldValue(block.body, ['Source', 'Where']);
    const summary = fieldValue(block.body, ['Issue', 'What happens']) ||
      // fall back to the first non-empty prose line
      (block.body.map((line) => line.replace(/^[-*]\s*/, '').trim()).find((line) => line && !line.startsWith('**')) || '');
    return { title: block.title, source, summary, body };
  });
}

// ── Coverage: planned vs built ───────────────────────────────────────────────
function readPlanSlugs(root) {
  const raw = tryGit(root, 'show', `main:${EPIC_PLAN_PATH}`) ?? readFileIf(root, EPIC_PLAN_PATH);
  // Reuse the dashboard's "## Epics" table parser so the two reports never disagree
  // on the plan for the same epic-plan.md. Empty set when there's no plan.
  return new Set((raw ? parseEpicPlan(raw) : []).map((epic) => epic.slug));
}

function readProjectName(root) {
  const raw = readFileIf(root, PROJECT_MD_PATH);
  if (!raw) return null;
  const h1 = raw.match(/^#\s+(.+?)\s*$/m);
  return h1 ? h1[1].trim() : null;
}

// ── Cost & user involvement (from the cost generator's data file) ───────────
// generate-build-cost-report.mjs parses the Claude Code transcripts and writes exact
// token/cost/user-involvement figures to a JSON file. We summarise it here so the
// build report can show cost alongside the git-derived metrics without owning a
// second transcript parser. Null when the file hasn't been generated.
function readInsightsSummary(root) {
  const raw = readFileIf(root, INSIGHTS_DATA_PATH);
  if (!raw) return null;
  let costData;
  try { costData = JSON.parse(raw); } catch { return null; }
  if (!costData || !costData.grand) return null;
  const agentsSpawned = Array.isArray(costData.agents)
    ? costData.agents.filter((agent) => agent.instances != null).reduce((total, agent) => total + agent.instances, 0)
    : null;
  const questionsAsked = Array.isArray(costData.buckets)
    ? costData.buckets.reduce((total, bucket) => total + (bucket.questionsAsked || 0), 0)
    : null;
  return {
    generatedAt: costData.generatedAt || null,
    usdToZar: costData.usdToZar || null,
    rateProvided: !!costData.rateProvided,
    costUsd: costData.grand.costUsd ?? null,
    totalTokens: costData.grand.totalTokens ?? null,
    outputTokens: costData.grand.output ?? null,
    apiCalls: costData.grand.calls ?? null,
    cacheHit: costData.grand.cacheHit ?? null,
    agentsSpawned,
    questionsAsked,
    userInputs: costData.userInputsTotal || null,       // { typed, commands, manualTest, interruptions }
    waits: costData.waitsTotal || null,                 // { approvalMs, approvalCount, generalMs, generalCount, stallMs, stallCount }
    // Median/slowest answer latency. A sum of waits reads as lost time; the median is what says
    // whether answering held the build up. Null on data files written before it was recorded.
    answerStats: costData.answerStatsTotal || null,     // { medianMs, maxMs, samples }
    // A COUNT, not the labels: the panel renders "<n> / <total phases>". The cost script emits
    // the labels, so collapse here rather than in the renderer.
    unattendedBuckets: Array.isArray(costData.unattendedBuckets) ? costData.unattendedBuckets.length : null,
    stallThresholdMin: costData.stallThresholdMin || null,
    postDelivery: costData.postDelivery
      ? { sessions: (costData.postDelivery.sessions || []).length, costUsd: costData.postDelivery.tokens?.costUsd ?? 0 }
      : null,
    // Per-bucket cost for the "cost by phase/epic" bars (label + USD only).
    bucketCosts: Array.isArray(costData.buckets)
      ? costData.buckets.map((bucket) => ({ label: bucket.label, costUsd: bucket.tokens?.costUsd ?? 0 }))
      : [],
    // ── Spend detail that used to be the standalone /build-report-cost page ──
    // Model mix, tool activity, sub-agent composition and the verbatim decision log. All four
    // are read straight from the cost data file; nothing is recomputed here.
    pricingEstimated: !!costData.pricingEstimated,
    unknownModels: Array.isArray(costData.unknownModels) ? costData.unknownModels : [],
    // model id → { costUsd, calls, output }. Sorted by spend so the page renders biggest first.
    models: costData.modelTotals
      ? Object.entries(costData.modelTotals)
        .map(([model, modelTotal]) => ({ model, costUsd: modelTotal.costUsd ?? 0, calls: modelTotal.calls ?? 0, output: modelTotal.output ?? 0 }))
        .sort((first, second) => second.costUsd - first.costUsd)
      : [],
    // tool name → call count across the orchestrator AND every sub-agent.
    tools: costData.toolTotals
      ? Object.entries(costData.toolTotals).map(([tool, calls]) => ({ tool, calls })).sort((first, second) => second.calls - first.calls)
      : [],
    // `instances: null` marks the orchestrator — one continuous session, so it has no spawn count.
    agents: Array.isArray(costData.agents)
      ? costData.agents.map((agent) => ({ agent: agent.agent, calls: agent.calls ?? 0, costUsd: agent.costUsd ?? 0, instances: agent.instances ?? null }))
      : [],
    // The decision log, flattened out of the per-bucket arrays and tagged with its phase. This is
    // the maintainer-facing record: every question verbatim with the answer given. The
    // stakeholders page shows a CURATED product-decision subset instead (authored, not this).
    // `resolved: false` means it was never answered — kept, and rendered as such, because a
    // question that got no answer is itself a finding.
    decisions: Array.isArray(costData.buckets)
      ? costData.buckets.flatMap((bucket) => (bucket.decisions || []).map((decision) => ({
        phase: bucket.label,
        header: decision.header || '',
        question: decision.question || '',
        answer: decision.answer ?? null,
        resolved: !!decision.resolved,
        failed: !!decision.failed,
        waitMs: decision.waitMs ?? null,
        // Only the first row of a multi-question dialog owns the wait; the rest say "same dialog"
        // rather than repeating it, so the column can't be mistaken for per-question latency.
        first: decision.first !== false,
        isStall: !!decision.isStall
      })))
      : []
  };
}

// ── Per-story effort benchmarks (from the effort generator's data file) ──────
// The effort report used to be its own page; its content is now a section of the
// maintainer report, so the data is ingested here exactly like the cost data above.
// The generator that writes this file remains the source of the numbers — this only
// selects what the page renders and drops the per-story rows (kept in the JSON for
// cross-project pooling, too long to render).
//
// `costComplete: false` means the project's sub-agent transcripts weren't captured, so
// per-story COST couldn't be reconstructed. Time is still valid. The page must then show
// time only — never publish a dollar figure the logs can't support.
// `finiteOrZero` defaults every figure the page does bare arithmetic on. The renderer reaches straight
// for `totals.medMinutes.toFixed(0)` and `benchmarks.costUplift.toFixed(1)`, so one renamed or
// missing key in the file on disk — an older generator, a hand edit, a file pooled from another
// project — would throw inside the page template and abort the WHOLE report rather than degrade
// one section. Same rule renderCostEffort states for the cost data: a partial object must never
// surface as a literal "NaN" or "undefined" in a tile, and must never cost the reader the page.
function readEffortSummary(root) {
  const raw = readFileIf(root, EFFORT_DATA_PATH);
  if (!raw) return null;
  let effortData;
  try { effortData = JSON.parse(raw); } catch { return null; }
  if (!effortData || !effortData.totals || !Array.isArray(effortData.categories)) return null;
  const finiteOrZero = (value) => (Number.isFinite(value) ? value : 0);
  const totals = effortData.totals;
  const benchmarks = effortData.benchmarks;
  return {
    generatedAt: effortData.generatedAt || null,
    costComplete: !!effortData.costComplete,
    pricingEstimated: !!effortData.pricingEstimated,
    unknownModels: Array.isArray(effortData.unknownModels) ? effortData.unknownModels : [],
    // The session folders the figures were read from — the project's own, plus any
    // parallel-planning worktree's. Named in Data quality so a missed one is visible.
    transcriptFolders: Array.isArray(effortData.transcriptFolders) ? effortData.transcriptFolders : [],
    rate: effortData.rate || null,
    totals: {
      ...totals,
      stories: finiteOrZero(totals.stories), epics: finiteOrZero(totals.epics),
      buildMinutes: finiteOrZero(totals.buildMinutes), medMinutes: finiteOrZero(totals.medMinutes),
      inStoryCost: finiteOrZero(totals.inStoryCost), overheadCost: finiteOrZero(totals.overheadCost),
      totalCost: finiteOrZero(totals.totalCost), overheadShare: finiteOrZero(totals.overheadShare),
      medCost: finiteOrZero(totals.medCost)
    },
    benchmarks: benchmarks ? {
      ...benchmarks,
      costUplift: finiteOrZero(benchmarks.costUplift),
      // 1 = "no uplift", the identity for the calculator's elapsed multiplier. 0 would make
      // every elapsed estimate zero.
      timeUplift: Number.isFinite(benchmarks.timeUplift) ? benchmarks.timeUplift : 1,
      typicalEpic: benchmarks.typicalEpic || null
    } : null,
    categories: effortData.categories,
    // Per-epic roll-up, keyed by slug so the page can merge it into the epic breakdown
    // it already renders instead of repeating the epic list a second time.
    epics: Array.isArray(effortData.epics) ? effortData.epics : [],
    // Share of in-story spend that had more than one story in flight. Above ~5% the
    // per-feature split is approximate and the page has to say so.
    ambiguousShare: effortData.attribution?.ambiguousShare ?? 0,
    parallelEpics: effortData.attribution?.parallelEpics || []
  };
}

// ── Quality-gate run history (from quality-gates.js's append-only log) ────────
// One JSONL line per gate run: { timestamp, branch, checks, gates, overallStatus,
// failedGates }. Summarised into per-gate pass/fail totals plus a rerun count
// (runs that immediately follow a failed run — the retry loop signal).
function readGateRuns(root) {
  const raw = readFileIf(root, GATE_RUNS_PATH);
  if (!raw) return null;
  const runs = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { runs.push(JSON.parse(line)); } catch { /* skip corrupt line */ }
  }
  if (!runs.length) return null;
  const byGate = {};
  let failedRuns = 0;
  let rerunsAfterFailure = 0;
  runs.forEach((run, i) => {
    if (run.overallStatus === 'fail') failedRuns++;
    if (i > 0 && runs[i - 1].overallStatus === 'fail') rerunsAfterFailure++;
    for (const [gate, status] of Object.entries(run.gates || {})) {
      if (status === 'skip' || status === 'pending') continue;
      const gateTally = (byGate[gate] ||= { runs: 0, fails: 0 });
      gateTally.runs++;
      if (status === 'fail') gateTally.fails++;
    }
  });
  return {
    totalRuns: runs.length,
    failedRuns,
    rerunsAfterFailure,
    byGate,
    firstRun: runs[0].timestamp || null,
    lastRun: runs[runs.length - 1].timestamp || null
  };
}

function readReportMeta(root) {
  const raw = readFileIf(root, REPORT_META_PATH);
  if (!raw) return null;
  try {
    const meta = JSON.parse(raw);
    return meta && typeof meta === 'object' ? { team: meta.team || null } : null;
  } catch { return null; }
}

function collect(root, gapMin = DEFAULT_GAP_MIN) {
  const status = projectStatus(root);
  if (status === 'legacy_detected') {
    return { status, message: 'Legacy workflow state detected. Run /migrate-legacy to convert to the epic-branch workflow.' };
  }
  if (status === 'no_project') {
    return { status, message: 'No project yet — run /start to begin. Your build report will fill in as the workflow runs.' };
  }

  const gitLog = readGitLog(root);
  const commits = parseCommits(gitLog);
  const sessions = clusterSessions(commits, gapMin);
  const activeMinutes = sessions.reduce((total, session) => total + session.durationMin, 0);

  const slugs = listEpicSlugs(root);
  const slugsByLength = [...slugs].sort((first, second) => second.length - first.length);
  const churnByCommit = parseNumstat(gitLog);
  const churnOf = (commitList) => commitList.reduce((totals, commit) => {
    const commitChurn = churnByCommit.get(commit.hash);
    if (commitChurn) { totals.add += commitChurn.add; totals.del += commitChurn.del; }
    return totals;
  }, { add: 0, del: 0 });

  // Attribute every commit to an epic (or null) once, up front.
  const commitEpic = new Map();
  for (const commit of commits) commitEpic.set(commit.hash, attributeCommit(commit.subject, slugsByLength));

  const epics = slugs.map((slug) => {
    const state = readState(root, slug);
    const epicCommits = commits.filter((commit) => commitEpic.get(commit.hash) === slug);
    const fixCommits = epicCommits.filter((commit) => FIX_COMMIT_PATTERN.test(commit.subject));
    // Sessions this epic appears in (interleaved epics share sessions — flagged).
    const epicSessions = sessions.filter((session) => session.commits.some((commit) => commitEpic.get(commit.hash) === slug));
    const stories = countStories(state);
    const churn = churnOf(epicCommits);
    return {
      slug,
      name: state?.epic?.name || slug,
      status: epicPhaseStatus(state),
      createdAt: state?.epic?.createdAt || (epicCommits[0]?.date ?? null),
      firstCommit: epicCommits[0] ? { date: epicCommits[0].date, subject: epicCommits[0].subject } : null,
      lastCommit: epicCommits.length ? { date: epicCommits[epicCommits.length - 1].date, subject: epicCommits[epicCommits.length - 1].subject } : null,
      spanMin: epicCommits.length ? Math.max(0, minutesBetween(epicCommits[0].date, epicCommits[epicCommits.length - 1].date)) : 0,
      sessionMinutes: epicSessions.reduce((total, session) => total + session.durationMin, 0),
      sharedSessions: epicSessions.some((session) => session.commits.some((commit) => commitEpic.get(commit.hash) && commitEpic.get(commit.hash) !== slug)),
      commitCount: epicCommits.length,
      fixCommitCount: fixCommits.length,
      linesAdded: churn.add,
      linesDeleted: churn.del,
      stories,
      flow: storyFlow(state, epicCommits),
      manualTest: summariseManualTest(state),
      unverifiedAssumptions: Array.isArray(state?.epic?.unverifiedAssumptions) ? state.epic.unverifiedAssumptions.length : 0,
      journal: readJournal(root, slug)
    };
  });

  // Order epics the way they were built: by first attributed commit; epics with no
  // commits yet (planned-only, e.g. a brief with no state.json) fall to the end.
  epics.sort((firstEpic, secondEpic) => {
    const firstDate = firstEpic.firstCommit?.date, secondDate = secondEpic.firstCommit?.date;
    if (firstDate && secondDate) return Date.parse(firstDate) - Date.parse(secondDate);
    if (firstDate) return -1;
    if (secondDate) return 1;
    return firstEpic.slug.localeCompare(secondEpic.slug);
  });

  // Fix / rework commits across the whole project (timeline markers). Filtered once
  // and reused for the churn sum below (same predicate, no second scan).
  const fixCommitList = commits.filter((commit) => FIX_COMMIT_PATTERN.test(commit.subject));
  const fixCommits = fixCommitList
    .map((commit) => ({ date: commit.date, subject: commit.subject, epic: commitEpic.get(commit.hash) }));

  const templateFeedbackRaw = readFileIf(root, TEMPLATE_FEEDBACK_PATH);
  const stumblingBlocks = parseTemplateFeedback(templateFeedbackRaw);

  // Build-flow headline: parallelism across every timestamped story interval.
  const buildFlow = buildFlowStats(epics.flatMap((epic) =>
    epic.flow.stories.map((story) => [Date.parse(story.startedAt), Date.parse(story.completedAt)])));

  const builtEpics = epics.filter((epic) => epic.status === 'complete').length;
  const planSlugs = readPlanSlugs(root);
  const plannedEpics = planSlugs.size || null;
  // Off-plan epics (built outside the plan, e.g. a hotfix) count toward the denominator
  // too, so "epics delivered X/Y" can never exceed 100% — mirrors the dashboard's
  // epicsTotal (collect-dashboard-data.js computeOverview).
  const offPlanEpics = plannedEpics ? epics.filter((epic) => !planSlugs.has(epic.slug)).length : 0;
  const storiesBuilt = epics.reduce((total, epic) => total + epic.stories.complete, 0);
  const passedAfterFix = epics.reduce((total, epic) => total + epic.stories.passedAfterFix, 0);

  // ── Workflow-performance ratios (all derived, nothing new measured) ────────
  const codebase = codebaseStats(root);
  codebase.depsAdded = dependenciesAdded(root);

  const totalChurn = churnOf(commits);
  const fixChurn = churnOf(fixCommitList);
  const storiesWithE2e = epics.reduce((total, epic) => total + epic.stories.withE2e, 0);
  const firstPassStories = epics.reduce((total, epic) => total + epic.stories.firstPass, 0);
  const manualChecks = epics.reduce((totals, epic) => {
    if (epic.manualTest.passed != null && epic.manualTest.total != null) {
      totals.passed += epic.manualTest.passed; totals.total += epic.manualTest.total;
    }
    return totals;
  }, { passed: 0, total: 0 });
  const percentOf = (numerator, denominator) => (denominator ? Math.round((100 * numerator) / denominator) : null);
  const testLoc = codebase.loc.unitTests + codebase.loc.e2e;

  const performance = {
    // Of the stories whose E2E ran, how many passed without a fix cycle.
    e2eFirstPass: { passed: firstPassStories, total: storiesWithE2e, pct: percentOf(firstPassStories, storiesWithE2e) },
    fixCommitSharePct: percentOf(fixCommits.length, commits.length),
    // Share of all churned lines (web/, no lockfile) that fix commits touched.
    reworkChurnPct: percentOf(fixChurn.add + fixChurn.del, totalChurn.add + totalChurn.del),
    minutesPerStory: storiesBuilt ? Math.round(activeMinutes / storiesBuilt) : null,
    commitsPerStory: storiesBuilt ? +(commits.length / storiesBuilt).toFixed(1) : null,
    sourceLocPerStory: storiesBuilt && codebase.loc.source ? Math.round(codebase.loc.source / storiesBuilt) : null,
    testToCodeRatio: codebase.loc.source ? +(testLoc / codebase.loc.source).toFixed(2) : null,
    manualChecks: manualChecks.total
      ? { passed: manualChecks.passed, total: manualChecks.total, pct: percentOf(manualChecks.passed, manualChecks.total) }
      : null,
    // Gate escapes: manual-verification checks a human failed AFTER the automated
    // gates had passed the same code — defects the gates didn't catch.
    gateEscapes: manualChecks.total ? manualChecks.total - manualChecks.passed : null,
    assumptionsOpen: epics.reduce((total, epic) => total + epic.unverifiedAssumptions, 0),
    churn: { added: totalChurn.add, deleted: totalChurn.del, fixAdded: fixChurn.add, fixDeleted: fixChurn.del }
  };

  const costEffort = readInsightsSummary(root);
  const effort = readEffortSummary(root);
  const gateRuns = readGateRuns(root);
  const meta = readReportMeta(root);
  const hasTemplateFeedback = templateFeedbackRaw != null;
  // Facts for the effort row, ' · '-joined. The session folders ride on THIS row rather than one
  // of their own so they inherit its generated-at date: a stale data file would otherwise state a
  // folder count as if it were this run's. Add a fact as an entry — falsy entries drop out.
  const effortNote = () => [
    effort.costComplete
      ? `${effort.totals.stories} timed stories across ${effort.totals.epics} features`
      : `${effort.totals.stories} timed stories — TIME ONLY, sub-agent transcripts missing so per-story cost could not be reconstructed`,
    effort.generatedAt && `generated ${effort.generatedAt.slice(0, 16).replace('T', ' ')} UTC`,
    effort.transcriptFolders.length && `read ${effort.transcriptFolders.length} session folder(s): ${effort.transcriptFolders.join(', ')}`
  ].filter(Boolean).join(' · ');

  // What fed this report, what's missing, and what's estimated vs exact — rendered
  // verbatim as the report's "Data quality" section so the numbers can't be
  // over-read. `found: false` entries state what instrumentation would fill them.
  const dataQuality = {
    sources: [
      { name: 'Git history', found: commits.length > 0, note: commits.length ? `${commits.length} commits — timeline, effort floor, churn, per-epic attribution` : 'no commits found' },
      { name: 'Epic state files', found: slugs.length > 0, note: slugs.length ? `${slugs.length} epic(s) under generated-docs/epics/ — stories, manual-test outcomes` : 'no epics yet' },
      { name: 'Tooling-friction log', found: hasTemplateFeedback, note: hasTemplateFeedback ? 'generated-docs/template-feedback.md' : 'none logged (or file absent)' },
      { name: 'Transcript cost & involvement data', found: !!costEffort, note: costEffort ? `cost data generated ${(costEffort.generatedAt || '').slice(0, 16).replace('T', ' ')} UTC` : 'not generated — /build-report-maintainer refreshes it as its first step' },
      // Dated like the cost row above it, and for a sharper reason: the effort generator exits
      // before writing when there are no timestamped stories, so a failed run leaves the PREVIOUS
      // file in place and the page renders it as if it were current. The date is the only thing
      // that gives that away.
      { name: 'Per-story effort benchmarks', found: !!effort, note: effort ? effortNote() : 'not generated — the effort generator produces it; stories need startedAt/completedAt timestamps' },
      { name: 'Quality-gate run history', found: !!gateRuns, note: gateRuns ? `${gateRuns.totalRuns} runs logged since ${(gateRuns.firstRun || '').slice(0, 10)}` : 'no quality-gate-runs.jsonl — history starts with the first gate run after this template version' },
      { name: 'Team name', found: !!(meta && meta.team), note: meta && meta.team ? meta.team : 'not set — /build-report-maintainer asks once and saves it' }
    ],
    assumptions: [
      'Active build time is a floor, not a stopwatch: git commits are clustered into sessions and each session’s span is summed — a lone commit contributes ~0.',
      'Per-epic time is attributed by commit scope; epics built interleaved share session time (marked "shared time").',
      'Cost figures are estimates at API list prices; actual billing under a subscription differs.',
      'Waiting-on-user durations are measured between recorded events (a question → its answer; end of AI output → the next deliberate input); gaps over the stall threshold are excluded from waits and shown as stalls.',
      'Waiting-on-user time is how long the process sat idle awaiting input — it is NOT a measure of the user\'s working time, which is not recorded anywhere. No human-vs-AI effort split can be derived from this data.',
      'Time spent at permission prompts is NOT measurable — permission prompts are not recorded in transcripts and hide inside tool runtimes.',
      'User-input counts follow transcript hygiene: harness-injected user-role entries (tool results, notifications, IDE events) are excluded; only typed messages, commands, manual-test submissions, and interruptions count.',
      'Post-delivery reporting sessions (report/dashboard generation) are excluded from cost totals and shown separately.',
      'Build-flow story bars use the orchestrator-written per-story timestamps (minute-granular, ±1 min); the hatched lead-in/lead-out segments are derived (epic creation → first story; last story → the epic\'s last same-day commit), not measured phases.'
    ]
  };

  return {
    status: 'ok',
    project: { name: readProjectName(root) },
    meta: meta || { team: null },
    generatedAt: new Date().toISOString(),
    timeline: {
      firstCommit: commits[0] ? { date: commits[0].date, subject: commits[0].subject } : null,
      lastCommit: commits.length ? { date: commits[commits.length - 1].date, subject: commits[commits.length - 1].subject } : null,
      spanDays: commits.length ? Math.max(1, Math.ceil(minutesBetween(commits[0].date, commits[commits.length - 1].date) / 1440)) : 0,
      totalCommits: commits.length,
      sessions,
      sessionCount: sessions.length,
      activeMinutes,
      gapMin
    },
    epics,
    buildFlow,
    coverage: { plannedEpics, offPlanEpics, builtEpics, storiesBuilt },
    rework: { fixCommitCount: fixCommits.length, passedAfterFixStories: passedAfterFix, fixCommits },
    codebase,
    performance,
    costEffort,
    effort,
    gateRuns,
    dataQuality,
    stumblingBlocks
  };
}

// ── Compact text (debug / fallback) ──────────────────────────────────────────
function formatDuration(minutes) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h${String(remainingMinutes).padStart(2, '0')}` : `${hours}h`;
}

function renderText(data) {
  if (data.status !== 'ok') return `${data.status}: ${data.message}`;
  const timeline = data.timeline;
  const lines = [];
  lines.push(`Build report: ${data.project.name ?? '(no name)'}`);
  lines.push('');
  lines.push(`Span:        ${timeline.spanDays} days (${(timeline.firstCommit?.date ?? '').slice(0, 10)} → ${(timeline.lastCommit?.date ?? '').slice(0, 10)})`);
  lines.push(`Active time: ~${formatDuration(timeline.activeMinutes)} across ${timeline.sessionCount} sessions (${timeline.totalCommits} commits)`);
  lines.push(`Delivered:   ${data.coverage.builtEpics}${data.coverage.plannedEpics ? `/${data.coverage.plannedEpics + (data.coverage.offPlanEpics || 0)}` : ''} epics · ${data.coverage.storiesBuilt} stories`);
  lines.push(`Rework:      ${data.rework.fixCommitCount} fix commits · ${data.rework.passedAfterFixStories} stories passed only after a fix`);
  const performance = data.performance;
  if (performance) {
    const firstPass = performance.e2eFirstPass;
    lines.push(`First pass:  ${firstPass.total ? `${firstPass.passed}/${firstPass.total} stories (${firstPass.pct}%) passed E2E without a fix` : 'no E2E outcomes recorded'}`);
    lines.push(`Churn:       +${performance.churn.added}/−${performance.churn.deleted} lines in web/ · ${performance.reworkChurnPct ?? 0}% of it in fix commits`);
    const codebase = data.codebase;
    lines.push(`Codebase:    ${codebase.loc.source} src + ${codebase.loc.unitTests} unit-test + ${codebase.loc.e2e} e2e lines · ${codebase.components} components · ${codebase.routes} routes · test:code ${performance.testToCodeRatio ?? '—'}`);
    if (performance.minutesPerStory != null) lines.push(`Velocity:    ~${formatDuration(performance.minutesPerStory)} active / story · ${performance.commitsPerStory} commits / story`);
  }
  lines.push('');
  lines.push('Per epic:');
  for (const epic of data.epics) {
    const manualNote = epic.manualTest.outcome ? ` · manual: ${epic.manualTest.outcome}` : '';
    lines.push(`  ${epic.status === 'complete' ? '✓' : '▸'} ${epic.name} — ${epic.stories.complete}/${epic.stories.total} stories · ${formatDuration(epic.sessionMinutes)}${epic.sharedSessions ? '*' : ''} · ${epic.fixCommitCount} fixes${manualNote}`);
  }
  if (data.epics.some((epic) => epic.sharedSessions)) lines.push('  * session time shared with an interleaved epic');
  lines.push('');
  lines.push(`Stumbling blocks (from template-feedback.md): ${data.stumblingBlocks.length}`);
  for (const block of data.stumblingBlocks) lines.push(`  • ${block.title}`);
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const data = collect(args.root, args.gapMin);
  if (args.format === 'text') process.stdout.write(renderText(data) + '\n');
  else process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

if (require.main === module) main();

module.exports = {
  collect,
  renderText,
  clusterSessions,
  attributeCommit,
  FIX_COMMIT_PATTERN,
  parseTemplateFeedback,
  summariseManualTest,
  formatDuration,
  classifySourceFile,
  countTestBlocks,
  diffDependencies,
  parseNumstat,
  countStories,
  storyFlow,
  buildFlowStats,
  readInsightsSummary,
  readEffortSummary,
  readGateRuns,
  readReportMeta
};

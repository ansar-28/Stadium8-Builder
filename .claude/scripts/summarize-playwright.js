#!/usr/bin/env node

/**
 * summarize-playwright.js
 *
 * Reads a Playwright JSON report and prints the only things the orchestrator
 * needs at EPIC-END: the authoritative top-level stats and the failing specs,
 * each mapped back to its story via the `epic-<slug>-story-<N>-<title>.spec.ts`
 * filename convention.
 *
 * This replaces the recursive `suites[].suites[].specs[]` walk that /continue
 * B7.0.6 otherwise re-implements inline as a throwaway `node -e` parser every
 * epic — which is where the Git-Bash `/tmp` vs Windows `C:\tmp` path mistakes
 * and the "agent transcribes results wrong" failures came from. The walk lives
 * here once, in code.
 *
 * Usage:
 *   node .claude/scripts/summarize-playwright.js <report.json> [--json]
 *
 * Output:
 *   default  — human-readable: a STATS line, one block per failing spec, any
 *              run-level errors, RESULT line
 *   --json   — one line of machine JSON: { stats, failures[], errors[], result }
 *
 * Exit codes:
 *   0 — clean run (no unexpected tests, no failing specs, no run-level errors)
 *   1 — one or more specs/tests failed, OR a run-level error occurred
 *       (globalSetup/webServer/config — recorded in the report's top-level
 *       errors[] with no failing spec to attribute)
 *   2 — report missing / unparseable / wrong shape (caller should treat as a real run failure)
 */
'use strict';

const fs = require('fs');

const ANSI = /\x1b\[[0-9;]*m/g;

function fail(message) {
  process.stderr.write(`summarize-playwright: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const options = { file: null, json: false };
  for (const arg of argv) {
    if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node .claude/scripts/summarize-playwright.js <report.json> [--json]');
      process.exit(0);
    } else if (!options.file) options.file = arg;
    else fail(`unexpected argument: ${arg}`);
  }
  if (!options.file) fail('no report path given. Usage: summarize-playwright.js <report.json> [--json]');
  return options;
}

// Specs can sit at any depth: test-generator always wraps tests in
// test.describe(...), so the real specs are one (or more) levels below the
// file-level suite. Gather every spec at every level.
function collectSpecs(suites, collected) {
  for (const suite of suites || []) {
    for (const spec of suite.specs || []) collected.push(spec);
    if (suite.suites) collectSpecs(suite.suites, collected);
  }
  return collected;
}

function storyOf(file) {
  const storyMatch = /-story-(\d+)-/.exec(file || '');
  return storyMatch ? Number(storyMatch[1]) : null;
}

// Normalise one Playwright error object to a short, ANSI-stripped message
// (first few lines, capped). Returns null when there's no usable message.
function cleanMessage(error) {
  if (!error || !error.message) return null;
  return error.message.replace(ANSI, '').trim().split('\n').slice(0, 4).join(' ').slice(0, 300);
}

// Pull the first real error message off a failing spec. Check `testResult.error` AND
// every entry in `testResult.errors[]` — `testResult.error` can be a truthy object with no
// `.message` (only a stack/value), in which case the real text lives in
// `testResult.errors[0]`, so we must not stop at the first non-null candidate.
function firstError(spec) {
  for (const test of spec.tests || []) {
    for (const testResult of test.results || []) {
      for (const error of [testResult.error, ...(testResult.errors || [])]) {
        const message = cleanMessage(error);
        if (message) return message;
      }
    }
  }
  return null;
}

function main() {
  const { file, json } = parseArgs(process.argv.slice(2));

  let report;
  try {
    report = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    fail(err.code === 'ENOENT' ? `report not found: ${file}` : `could not parse ${file}: ${err.message}`);
  }

  const stats = report.stats || {};
  if (!report.suites || typeof stats.unexpected !== 'number') {
    fail(`unexpected report shape in ${file} (no suites[] / stats.unexpected) — treat as a run failure, do not diagnose from prose.`);
  }

  const specs = collectSpecs(report.suites, []);
  const failures = specs
    .filter((spec) => spec.ok === false)
    .map((spec) => ({ story: storyOf(spec.file), file: spec.file, title: (spec.title || '').trim(), error: firstError(spec) }))
    .sort((firstFailure, secondFailure) => (firstFailure.story ?? 999) - (secondFailure.story ?? 999));

  // Run-level errors live at the report's TOP level, not under any spec:
  // globalSetup throwing, the webServer (dev server, or `next start` under
  // E2E_PROD) never starting, a config error. These can occur with
  // `stats.unexpected === 0` and zero failing
  // specs — so a verdict based on stats alone would call a broken run "pass".
  const runErrors = (Array.isArray(report.errors) ? report.errors : []).map(cleanMessage).filter(Boolean);

  // Fail on ANY signal of trouble: an unexpected test (stats), a failing spec
  // (suites walk), or a run-level error. Relying on a single source lets the
  // other two slip a real failure through.
  const result =
    stats.unexpected > 0 || failures.length > 0 || runErrors.length > 0 ? 'fail' : 'pass';

  if (json) {
    process.stdout.write(
      JSON.stringify({
        stats: {
          expected: stats.expected ?? null,
          unexpected: stats.unexpected ?? null,
          flaky: stats.flaky ?? null,
          skipped: stats.skipped ?? null,
          durationMs: stats.duration ?? null,
        },
        failures,
        errors: runErrors,
        result,
      }) + '\n'
    );
  } else {
    const durationLabel = stats.duration ? ` in ${(stats.duration / 1000).toFixed(1)}s` : '';
    console.log(
      `STATS: ${stats.expected ?? '?'} passed · ${stats.unexpected ?? '?'} failed · ` +
        `${stats.flaky ?? 0} flaky · ${stats.skipped ?? 0} skipped${durationLabel}`
    );
    if (failures.length) {
      console.log('');
      for (const failure of failures) {
        const storyLabel = failure.story != null ? `story ${failure.story}` : 'story ?';
        console.log(`✗ [${storyLabel}] ${failure.file}`);
        console.log(`    ${failure.title}`);
        if (failure.error) console.log(`    → ${failure.error}`);
      }
      console.log('');
    }
    if (runErrors.length) {
      console.log('');
      console.log('Run-level errors (no spec to attribute — e.g. the web server or global setup failed):');
      for (const message of runErrors) console.log(`    → ${message}`);
      console.log('');
    }
    if (result === 'pass') {
      console.log('RESULT: PASS — no unexpected failures');
    } else {
      // Count what's actually printed/actionable rather than stats.unexpected
      // (a per-test count that can exceed the number of failing spec files).
      const failureParts = [];
      if (failures.length) failureParts.push(`${failures.length} spec(s) failed`);
      if (runErrors.length) failureParts.push(`${runErrors.length} run-level error(s)`);
      // Edge: stats flagged a failure that didn't surface as a spec or run error.
      if (!failureParts.length && stats.unexpected > 0) failureParts.push(`${stats.unexpected} test(s) failed`);
      console.log(`RESULT: FAIL — ${failureParts.join(', ')}`);
    }
  }

  process.exit(result === 'pass' ? 0 : 1);
}

main();

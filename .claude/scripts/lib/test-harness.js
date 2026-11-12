'use strict';
/**
 * Minimal shared test harness for the .claude/scripts/*.tests.js files.
 *
 * Each test file is run as a standalone `node` process, so the harness keeps
 * its counters in module-level state. Tests that need a clean working
 * directory pass a `tmpDir` prefix and receive the absolute path as the test
 * body's first argument; the harness creates and removes the tmp dir.
 *
 * Usage:
 *   const harness = require('./lib/test-harness');
 *   harness.test('name', () => { harness.assertEqual(1, 1, 'one'); });
 *   harness.test('with tmp', (root) => { ... }, { tmpDir: 'my-test-' });
 *   await harness.testAsync('async subject', async (root) => { ... }, { tmpDir: 'my-test-' });
 *   harness.summary();   // prints results and exits 1 on failure
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

let passed = 0;
let failed = 0;
const errors = [];

function makeTmpRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function test(name, testBody, options) {
  const tmpPrefix = options && options.tmpDir;
  let root;
  try {
    if (tmpPrefix) root = makeTmpRoot(tmpPrefix);
    const result = testBody(root);
    // The harness is synchronous. An async test body returns a Promise here and its body (incl.
    // assertions) runs AFTER this function returns — so passed++ would print a green ✓ before
    // a failing assertion rejects. Catch that footgun loudly instead of awaiting (which would
    // force every call site to become async). Swallow the eventual rejection so it doesn't
    // crash the process as an unhandled rejection.
    if (result && typeof result.then === 'function') {
      result.catch(() => {});
      throw new Error('test-harness: test() callbacks must be synchronous (the test body returned a Promise).');
    }
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    errors.push({ name, message: err.message });
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  } finally {
    if (root) try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

/**
 * `test` for an async test body: same counters, output and tmp-dir handling,
 * but awaited. Await each call from one async main, and call `summary()` once
 * they have all finished.
 */
async function testAsync(name, testBody, options) {
  const tmpPrefix = options && options.tmpDir;
  let root;
  try {
    if (tmpPrefix) root = makeTmpRoot(tmpPrefix);
    await testBody(root);
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    errors.push({ name, message: err.message });
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  } finally {
    if (root) try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertDeepEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function summary() {
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    for (const failure of errors) {
      console.log(`✗ ${failure.name}`);
      console.log(`  ${failure.message}`);
    }
    process.exit(1);
  }
}

module.exports = { test, testAsync, assert, assertEqual, assertDeepEqual, summary, makeTmpRoot };

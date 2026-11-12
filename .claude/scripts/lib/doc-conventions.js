#!/usr/bin/env node
/**
 * doc-conventions.js
 *
 * Owns `.claude/shared/generated-doc-conventions.json` — where it lives, how to load it,
 * how to compile it, and how to classify a filename against it. Both consumers of the
 * schema are thin wrappers over this module and differ only in how they REACT:
 *   - .claude/hooks/enforce-generated-doc-names.js   (PreToolUse write-time enforcement)
 *   - .claude/scripts/validate-generated-doc-names.js (repo-wide audit)
 *
 * WHY THIS IS A SHARED MODULE: the two consumers each carried their own byte-identical
 * copy of `dirGlobToRegex`, and both copies shipped the same defect — the converter
 * translated `*` but not the `<slug>` placeholder, so a glob like
 * `generated-docs/epics/<slug>/` compiled to a regex matching the LITERAL text
 * `<slug>`. It never matched a real epic directory, so all four epic-scoped
 * conventions (brief.md, state.json, journal.md, story files) were dead branches:
 * wrongly-named files were written and audited with no check at all, failing open.
 * Only the two flat globs (`generated-docs/`, `web/e2e/`) enforced anything, which is
 * why it stayed hidden. Present since v0.4.0, when the epic-branch workflow introduced
 * the placeholder. Both consumers duplicated the classification loop around it too, so
 * the whole path lives here now — one definition, one place to fix, and a co-located
 * test suite (doc-conventions.tests.js) that a non-exported local function couldn't have.
 *
 * Usage:
 *   const docConventions = require('./lib/doc-conventions');       // from .claude/scripts/
 *   const docConventions = require('../scripts/lib/doc-conventions'); // from .claude/hooks/
 */
'use strict';

const fs = require('fs');
const path = require('path');

/** Repo-relative home of the schema. Single definition — consumers and tests derive from it. */
const SCHEMA_PATH = '.claude/shared/generated-doc-conventions.json';

/** Normalise Windows separators so a path can be matched against a forward-slashed glob. */
function toPosix(filePath) { return filePath.replace(/\\/g, '/'); }

/** Absolute path to the schema inside `projectRoot`. */
function schemaPath(projectRoot) { return path.join(projectRoot, ...SCHEMA_PATH.split('/')); }

/**
 * One `dirGlob` path segment: literal safe characters, `*`, and `<name>` placeholders,
 * in any mix. Anything else — `{slug}`, `:slug`, `%slug%`, `?`, `(a|b)`, a space — is
 * unsupported, and unsupported syntax is the whole failure mode this module guards: it
 * would compile to a regex matching the placeholder text LITERALLY, matching no real
 * directory, so the convention would silently enforce nothing. This regex is the single
 * definition of the accepted alphabet; `dirGlobToRegex` substitutes the same placeholder
 * shape below.
 */
const DIR_GLOB_SEGMENT = /^(?:[A-Za-z0-9._-]|\*|<[A-Za-z0-9_-]+>)+$/;

/** Return `null` when `glob` uses only supported `dirGlob` syntax, otherwise the reason. */
function dirGlobError(glob) {
  if (typeof glob !== 'string' || glob.trim() === '') {
    return `dirGlob must be a non-empty string (got ${JSON.stringify(glob)})`;
  }
  for (const segment of glob.replace(/\/+$/, '').split('/')) {
    if (segment === '.' || segment === '..') {
      return `dirGlob "${glob}" must be a plain repo-relative path — "${segment}" segments are not allowed`;
    }
    if (!DIR_GLOB_SEGMENT.test(segment)) {
      return `unsupported segment "${segment}" in dirGlob "${glob}" — a segment may contain ` +
        'only letters, digits, `.`, `_`, `-`, `*`, and `<name>` placeholders';
    }
  }
  return null;
}

/**
 * Compile a convention's `dirGlob` into a regex to test against a file's parent
 * directory (normalised to forward slashes, with a trailing slash — see `classify`).
 *
 * Supported syntax:
 *   `*`       — zero or more characters within ONE path segment.
 *   `<name>`  — a required single path segment (e.g. `<slug>` = an epic slug).
 *
 * Both compile to a character class that cannot cross `/`, which is what keeps the
 * conventions correctly scoped: `generated-docs/epics/<slug>/` matches
 * `generated-docs/epics/task-browsing/` but NOT `.../task-browsing/stories/`, so an
 * epic brief can never be confused with a story file. A `.*` would span `/` and break
 * that separation.
 *
 * `<name>` uses `[^/]+`, not `[^/]*`: a named placeholder stands for a segment that
 * must be present, so the empty match is wrong — with `*`, the glob above would also
 * match the bare `generated-docs/epics/` directory and treat it as an epic.
 *
 * THROWS on unsupported syntax (see dirGlobError) rather than returning a regex that
 * matches nothing: failing loudly is the only way an unsupported glob can't fail open.
 */
function dirGlobToRegex(glob) {
  const problem = dirGlobError(glob);
  if (problem) throw new TypeError(`dirGlobToRegex: ${problem}`);
  const escaped = glob
    // Escape first, so the `[`, `]` and `+` in the classes substituted below survive.
    .replace(/[.+^${}()|[\]\\?]/g, '\\$&')
    .replace(/\*/g, '[^/]*')
    .replace(/<[A-Za-z0-9_-]+>/g, '[^/]+');
  return new RegExp('^' + escaped.replace(/\/$/, '') + '/?$');
}

/**
 * Return `null` when `pattern` is usable as a convention's filename regex, otherwise the
 * reason. Both `filenamePattern` and `badPattern` are REQUIRED, and both must be anchored:
 *
 *   - A missing/misspelled `filenamePattern` is the worst case, because `new RegExp(undefined)`
 *     is `/(?:)/` — it matches every basename, so every file in the convention's dirGlob is
 *     classified OK, which also short-circuits any later convention governing the same
 *     directory. The rule looks enforced and enforces nothing.
 *   - Without a `badPattern` no filename can ever be DRIFT, so correct names are marked OK
 *     and every wrong name falls through as ungoverned — allowed.
 *   - An unanchored pattern matches substrings and silently widens the rule.
 *
 * All three are the same fail-open class as an unsupported dirGlob, so they are reported the
 * same way rather than left to the maintainer-only test suite (which the published template
 * strips — in a user's project the audit is the only check there is).
 */
function patternError(key, pattern) {
  if (typeof pattern !== 'string' || pattern === '') {
    return `${key} must be a non-empty regex string (got ${JSON.stringify(pattern)}) — ` +
      'without it the convention cannot classify anything and silently enforces nothing';
  }
  if (!pattern.startsWith('^') || !pattern.endsWith('$')) {
    return `${key} "${pattern}" must be anchored with ^ and $ — an unanchored pattern ` +
      'matches substrings and silently widens the rule';
  }
  try {
    new RegExp(pattern);
  } catch (err) {
    return `${key} "${pattern}" is not a valid regular expression: ${err.message}`;
  }
  return null;
}

/**
 * Read the schema from `projectRoot`. Returns `{ file, conventions, error }` — `error`
 * is a message string when the file is missing or unparseable, and consumers choose the
 * reaction (the hook fails open, the audit exits 2).
 */
function loadConventions(projectRoot) {
  const file = schemaPath(projectRoot);
  try {
    const schema = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { file, conventions: schema.conventions || [], error: null };
  } catch (err) {
    return { file, conventions: [], error: err.message };
  }
}

/**
 * Compile every convention's three patterns once. Returns `{ compiled, errors }`, where
 * `errors` is `[{ id, problem }]` for conventions that could not be compiled — an
 * unsupported `dirGlob`, or a `filenamePattern`/`badPattern` that is missing, unanchored,
 * or not valid regex (see `dirGlobError` and `patternError` for why each one fails open).
 *
 * Broken conventions are reported rather than thrown so each consumer can react in the
 * way that suits it, and compiling up front keeps a per-file loop from rebuilding three
 * regexes for every convention on every file.
 */
function compileConventions(conventions) {
  const compiled = [];
  const errors = [];
  for (const convention of conventions) {
    const problem = dirGlobError(convention.dirGlob)
      || patternError('filenamePattern', convention.filenamePattern)
      || patternError('badPattern', convention.badPattern);
    if (problem) {
      errors.push({ id: convention.id, problem });
      continue;
    }
    try {
      compiled.push({
        convention,
        dirPattern: dirGlobToRegex(convention.dirGlob),
        namePattern: new RegExp(convention.filenamePattern),
        badNamePattern: new RegExp(convention.badPattern),
      });
    } catch (err) {
      // Unreachable given the checks above, but a throw here would be a stack trace on
      // every Write/Edit in the PreToolUse hook — report it like any other broken rule.
      errors.push({ id: convention.id, problem: err.message });
    }
  }
  return { compiled, errors };
}

/**
 * Classify one repo-relative path against compiled conventions:
 *   `ok`         — matches a convention's filenamePattern inside its dirGlob.
 *   `drift`      — matches a convention's badPattern but no filenamePattern.
 *   `ungoverned` — neither, in any convention; not a governed doc type.
 *
 * Returns `{ status, convention, drift }` — `convention` is the one it satisfied when
 * `ok`, and `drift` lists the conventions it violated when `drift`. The parent-directory
 * derivation lives here, next to the regex whose trailing-slash contract depends on it.
 *
 * `relativePath` may use either separator: it is normalised to forward slashes first and then
 * split with `path.posix`, so the result is identical on Windows and POSIX. Splitting a
 * backslashed path with plain `path.dirname` would yield `.` on POSIX and classify the
 * file as ungoverned.
 */
function classify(relativePath, compiled) {
  const posixPath = toPosix(relativePath);
  const basename = path.posix.basename(posixPath);
  const parentDir = path.posix.dirname(posixPath) + '/';
  const drift = [];

  for (const { convention, dirPattern, namePattern, badNamePattern } of compiled) {
    if (!dirPattern.test(parentDir)) continue;
    if (namePattern.test(basename)) return { status: 'ok', convention, drift: [] };
    if (badNamePattern.test(basename)) drift.push(convention);
  }

  return drift.length > 0
    ? { status: 'drift', convention: null, drift }
    : { status: 'ungoverned', convention: null, drift: [] };
}

module.exports = {
  SCHEMA_PATH,
  toPosix,
  schemaPath,
  dirGlobError,
  dirGlobToRegex,
  patternError,
  loadConventions,
  compileConventions,
  classify,
};

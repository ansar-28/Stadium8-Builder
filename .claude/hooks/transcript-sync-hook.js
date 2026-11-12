#!/usr/bin/env node
'use strict';
/**
 * transcript-sync-hook.js
 *
 * Has Claude show the transcript-collection notice, and starts every upload
 * once Claude's reply has shown it.
 *
 *   UserPromptSubmit
 *     1. the template dev repo uploads nothing, ever — leave silently;
 *     2. a headless run is never asked and never uploads;
 *     3. if notices.json already holds this session for this project, leave;
 *     4. resolve or mint the project's transcript-collection.json (a local
 *        write, no network, no git);
 *     5. ask Claude, through additionalContext, to open its reply with the
 *        notice. Every prompt asks again until a Stop records the session.
 *
 *   Stop
 *     1. a session notices.json does not hold yet is recorded there only once
 *        Claude's own text in it contains the notice;
 *     2. spawn `transcript-sync.js --catch-up --notice-session <id>`, only for a
 *        session notices.json holds against this project.
 *
 * Shown by Claude, not as a hook systemMessage: the VS Code extension receives a
 * systemMessage but never displays it, so the harness having read it proves
 * nothing. Claude's reply is shown in every client, and the session's
 * transcript is the record of what was shown.
 *
 * On the first prompt, not SessionStart: the VS Code extension runs SessionStart
 * in a hidden config probe. A first prompt also covers resume, fork and /clear.
 *
 * UserPromptSubmit must stay synchronous in settings.json: an async hook's
 * stdout is discarded, so Claude would never be asked. Stop is async, so it
 * carries no `timeout` (not enforced there).
 *
 * Not wrapped in runHook, whose process.exit() would abandon the request
 * mid-write. Nothing here calls process.exit().
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { projectRoot, emitContext } = require('./lib/workflow-state');
const { createCore } = require('../scripts/lib/transcript-sync-core');

// Once, before any tool call: told only to "start your reply", Claude also opens
// the message it writes after its tool calls with the notice.
const NOTICE_REQUEST =
  'Write this notice once, word for word and untranslated, on its own line, as the first thing ' +
  'you write this turn (before any tool call), even when other instructions say to show output ' +
  'as-is. Do not repeat it later in the turn:';

function readInput() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Detached, because an upload's length is bounded only by the history on disk.
 * `windowsHide` stops a console window flashing at the end of each turn.
 */
function spawnChild(root, args) {
  try {
    // --root, because a detached child inherits whatever cwd the session had.
    const script = path.join(__dirname, '..', 'scripts', 'transcript-sync.js');
    if (!fs.existsSync(script)) return;
    const child = spawn(process.execPath, [script, ...args, '--root', root], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  } catch {
    // A machine that cannot spawn simply does not upload this session.
  }
}

/**
 * A headless run (`claude -p`, the SDK) has no one to see the notice, so it
 * must not record one. CLAUDE_CODE_ENTRYPOINT is the only signal a hook gets;
 * an unrecognised entrypoint counts as interactive.
 */
function looksHeadless() {
  return /sdk|print|headless|non-?interactive/i.test(process.env.CLAUDE_CODE_ENTRYPOINT || '');
}

/** Read relative to this hook, which ships with it, not the project root. */
function readNotice() {
  try {
    // CRLF on a Windows checkout.
    const text = fs
      .readFileSync(path.join(__dirname, '..', 'shared', 'transcript-notice.md'), 'utf8')
      .replace(/\r\n/g, '\n')
      .trim();
    return text || null;
  } catch {
    return null;
  }
}

/**
 * Lowercased letters and digits, single-spaced: Claude may bold, quote or
 * re-punctuate the notice and still have shown it.
 */
function comparableText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * The notice's first sentence, which says what is recorded and where it goes.
 * The help-page path after it is left out: Claude may turn it into a link.
 */
function noticeProof(notice) {
  const firstSentence = notice.match(/^[\s\S]*?[.!?](?=\s|$)/);
  return comparableText(firstSentence ? firstSentence[0] : notice);
}

/**
 * Claude's own text blocks in this session's transcript. Not a helper agent's
 * (`isSidechain`), which the user does not see, and not thinking, tool calls,
 * hook context or anything the user typed.
 */
function claudeTextInTranscript(transcriptPath, sessionId) {
  let raw;
  try {
    raw = fs.readFileSync(transcriptPath, 'utf8');
  } catch {
    return [];
  }
  const texts = [];
  for (const line of raw.split('\n')) {
    if (!line.includes('"assistant"')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry || entry.type !== 'assistant' || entry.isSidechain) continue;
    // Entries a resume or fork copied in were shown in another session.
    if (entry.sessionId && entry.sessionId !== sessionId) continue;
    const content = entry.message && entry.message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block && block.type === 'text' && typeof block.text === 'string') texts.push(block.text);
    }
  }
  return texts;
}

/**
 * Whether Claude's text in this session contains the notice. The final reply
 * arrives in the Stop input; earlier replies are read from the transcript,
 * which may not hold the final one yet when Stop fires.
 */
function claudeShowedNotice(input, notice) {
  const proof = noticeProof(notice);
  if (!proof) return false;
  if (comparableText(input.last_assistant_message).includes(proof)) return true;
  if (typeof input.transcript_path !== 'string' || !input.transcript_path) return false;
  return claudeTextInTranscript(input.transcript_path, input.session_id).some((text) =>
    comparableText(text).includes(proof),
  );
}

/**
 * The session's notices.json entry for this project, recording it first when
 * Claude has shown the notice; null while there is nothing to upload under.
 */
function noticedSession(core, root, input) {
  const collection = core.readCollection(root);
  if (!collection) return null;
  const known = core.sessionNotice(input.session_id, collection.projectId);
  if (known) return known;
  const notice = readNotice();
  if (!notice || !claudeShowedNotice(input, notice)) return null;
  try {
    core.recordSessionNotice(input.session_id, collection.projectId, new Date().toISOString());
  } catch {
    // Unrecorded, so this Stop uploads nothing and the next prompt asks again.
    return null;
  }
  return core.sessionNotice(input.session_id, collection.projectId);
}

function main() {
  const input = readInput();
  const event = input.hook_event_name || '';
  const root = projectRoot();
  const core = createCore();

  if (core.isTemplateDevRepo(root) || looksHeadless()) return;

  if (event === 'Stop') {
    if (noticedSession(core, root, input)) {
      spawnChild(root, ['--catch-up', '--notice-session', input.session_id]);
    }
    return;
  }
  if (event !== 'UserPromptSubmit') return;

  // Every prompt after the one Claude showed the notice in ends here.
  const known = core.readCollection(root);
  if (known && core.sessionNotice(input.session_id, known.projectId)) return;

  // Not ok when no receiver is configured, or the identity file is unreadable.
  const initResult = core.initProject(root);
  if (!initResult.ok) return;
  const notice = readNotice();
  if (!notice) return;

  emitContext('UserPromptSubmit', `${NOTICE_REQUEST}\n\n${notice}`);
}

if (require.main === module) {
  try {
    main();
    process.exitCode = 0;
  } catch {
    // Never process.exit(): see the header.
    process.exitCode = 0;
  }
}

module.exports = { noticedSession, claudeShowedNotice, noticeProof };

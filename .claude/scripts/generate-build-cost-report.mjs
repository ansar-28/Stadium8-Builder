// Generates the workflow INSIGHTS report — only ground-truth data, no inferred durations.
//
//   node .claude/scripts/generate-build-cost-report.mjs [--rate=18.50] [--exclude=id,id]
//
// Everything here comes verbatim from the transcripts (usage blocks, tool_use events,
// sub-agent .meta.json) — token counts, API-call counts, model attribution, cache
// read/write split, tool-use counts, sub-agent fan-out, and AskUserQuestion counts are
// all exact. There are deliberately NO active/idle/elapsed time estimates: those are
// reconstructed from timestamp gaps with arbitrary caps and are not reliable.
//
// Reads:  Claude Code transcripts for this project (~/.claude/projects/<slug>/) and
//         generated-docs/epics/<slug>/state.json (per-epic createdAt = time-bucket boundaries).
// Writes: generated-docs/reports/build-cost-data.json — DATA ONLY, no page of its own.
//
// This used to render a standalone build-cost.html. It no longer does: the cost content is now
// part of the maintainer build report — the headline figures in its "Cost & user involvement"
// panel, and the per-model / per-tool / per-agent breakdowns plus the verbatim decision log in
// its "Spend detail" fold — all rendered by generate-build-report-html.js from this JSON.
// Two renderers over the same data could disagree about the same project, which is the
// duplication that merge removed. Render new views from this file; don't re-add a page.
// The stakeholders report reads it too, for the sign-off log behind its curated decision list.
//
// --rate     ZAR per USD. Pass the current market rate; defaults to 18.00 with a warning.
// --exclude  Comma-separated session ids to leave out entirely (unrelated conversations).
// --keep     Comma-separated session ids to keep in the build totals even though they were
//            auto-flagged as post-delivery reporting (see POST_DELIVERY_COMMANDS below).
//
// Beyond token/cost ground truth, the script also computes:
//   - Deliberate user inputs (typed messages / slash commands / manual-test submissions /
//     interruptions), classified per transcript-hygiene rules — harness-injected user-role
//     entries (tool results, task notifications, IDE events, isMeta) are excluded.
//   - A decision log: every AskUserQuestion, with the question, the option the user picked (read
//     verbatim from the tool_result) and how long the answer took — plus the median and slowest
//     answer latency, which say far more than a sum of waits does.
//   - "Waiting on user" durations, measured ONLY between well-defined anchors: an
//     AskUserQuestion tool call → its tool_result (approval waits), and end of the previous
//     transcript event → the next deliberate user input (general waits). Gaps over the stall
//     threshold are reported separately as stalls, never summed into waits. These are the only
//     durations on the report; AI busy/elapsed time remains deliberately unmeasured.
//   - Post-delivery reporting sessions (first command is a report or dashboard command — see
//     POST_DELIVERY_COMMANDS below for the authoritative list) are auto-flagged: their
//     tokens/cost are rolled up separately and excluded from the build totals so report
//     generation doesn't pollute cross-project comparison.
//   - Sibling transcript directories (git-worktree variants of the project path) are included
//     automatically — parallel epics built in worktrees log there.
import fs from 'node:fs';
import path from 'node:path';
import { getProjectRoot } from './lib/project-root.js';
import {
  PRICING, CACHE_READ_MULTIPLIER, CACHE_WRITE_5M_MULTIPLIER, CACHE_WRITE_1H_MULTIPLIER, rates, unknownModels,
  discoverTranscriptDirs, EXIT_NO_PROJECT as NO_PROJECT, EXIT_MISSING_INPUT as MISSING_INPUT,
} from './lib/report-core.mjs';

// Repo root via the canonical marker-walk helper — NOT process.cwd(), which drifts into web/ when
// the shell's cwd was left there. Same source of truth the dashboard/state-path scripts use, and
// it also anchors the transcript-dir slug below to the path the session was actually opened at.
const PROJECT_ROOT = getProjectRoot();

// ---- args ----
const args = Object.fromEntries(process.argv.slice(2).filter(arg => arg.startsWith('--')).map(arg => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  return [key, value ?? true];
}));
const RATE_ARG = parseFloat(args.rate);
const RATE = RATE_ARG || 18.0;
if (!RATE_ARG) console.warn('WARNING: no --rate given, using 18.00 ZAR/USD placeholder — pass the current market rate.');
if (args.exclude === true) console.warn('WARNING: --exclude needs a value like --exclude=id1,id2 — ignoring it (nothing excluded).');
const EXCLUDE = new Set((typeof args.exclude === 'string' ? args.exclude : '').split(',').map(id => id.trim()).filter(Boolean));
const KEEP = new Set((typeof args.keep === 'string' ? args.keep : '').split(',').map(id => id.trim()).filter(Boolean));

// ---- locate the Claude Code transcript directories for this project ----
// Discovery lives in lib/report-core.mjs (the single-dash sibling-worktree rule and its
// rationale are documented there) so this generator and the effort generator can never read a
// DIFFERENT set of transcripts and then disagree about the totals — which is exactly what
// happened while the two carried separate copies of this walk.
const { dirs: TRANSCRIPT_DIRS, extras: extraDirs, slug, projectsRoot: PROJECTS_ROOT } = discoverTranscriptDirs(PROJECT_ROOT);
if (!TRANSCRIPT_DIRS.length) {
  // The project exists; only its session logs are absent (built on another machine). The report
  // still renders and names the gap, so the caller continues — MISSING_INPUT, not NO_PROJECT.
  console.error('Transcript directory not found: ' + path.join(PROJECTS_ROOT, slug));
  process.exit(MISSING_INPUT);
}

// ---- pricing ----
// The table, the cache multipliers and rates() live in lib/report-core.mjs (imported above) so
// this generator and the effort generator can never disagree about what a model costs — add new
// models there, not here. pricingNote below is generated from that same table, so the note can't
// drift from the arithmetic either.

// ---- derive time buckets from the epic-branch state files ----
// The epic-branch workflow keeps per-epic state at generated-docs/epics/<slug>/state.json — there
// is no single workflow-state.json history timeline. We bucket transcript activity into contiguous
// time windows: a leading "INTAKE & setup" window, then one window per epic running from that epic's
// `createdAt` to the next epic's `createdAt` (the last epic runs open-ended).
// Granularity is epic-level because the epic state records no per-story timestamps (stories carry
// only status/commit/e2eStatus). Sub-agent work is still broken down per agent+model within each
// window (see aggregation below).
// Caveat: contiguous createdAt windows assume epics were built sequentially — if two epics ran in
// parallel on separate branches, activity in the overlap is attributed to the earlier window.
const toEpochMs = (isoTimestamp) => (isoTimestamp ? new Date(isoTimestamp).getTime() : NaN);

const epicsDir = path.join(PROJECT_ROOT, 'generated-docs', 'epics');
if (!fs.existsSync(epicsDir)) {
  console.error('No epics found at generated-docs/epics/ — the workflow has not created an epic yet; nothing to report.');
  process.exit(NO_PROJECT);
}
const epics = [];
const undatedEpics = [];
for (const epicSlug of fs.readdirSync(epicsDir)) {
  const stateFile = path.join(epicsDir, epicSlug, 'state.json');
  if (!fs.existsSync(stateFile)) continue;
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    const createdAt = toEpochMs(state.epic?.createdAt);
    // A non-finite createdAt (missing/malformed) makes this epic's bucket boundaries NaN, which
    // silently drops all its transcript activity from the report. Skip it and warn instead.
    if (!Number.isFinite(createdAt)) { undatedEpics.push(epicSlug); continue; }
    epics.push({ slug: epicSlug, name: state.epic?.name || epicSlug, createdAt, phase: state.phase || '' });
  } catch { /* skip an unreadable state file */ }
}
epics.sort((left, right) => left.createdAt - right.createdAt);
if (undatedEpics.length) console.warn('WARNING: skipped epic(s) with no valid epic.createdAt — their activity is NOT in the report: ' + undatedEpics.join(', '));
if (!epics.length) {
  console.error('No readable epic state.json under generated-docs/epics/ — nothing to report.');
  process.exit(NO_PROJECT);
}

// Feature name for the report header: the first H1 in project.md, if present.
let feature = '';
try {
  const projectMd = fs.readFileSync(path.join(PROJECT_ROOT, 'generated-docs', 'project.md'), 'utf8');
  const heading = projectMd.split('\n').find((line) => /^#\s+/.test(line));
  if (heading) feature = heading.replace(/^#\s+/, '').trim();
} catch { /* no project.md — leave blank */ }

const BUCKETS = [
  { key: 'intake', label: 'INTAKE & setup', group: 'Project phases', from: -Infinity, to: epics[0].createdAt },
];
for (let i = 0; i < epics.length; i++) {
  const openPhase = epics[i].phase && epics[i].phase !== 'COMPLETE' ? ` (${epics[i].phase})` : '';
  BUCKETS.push({
    key: `epic-${epics[i].slug}`,
    label: `Epic ${i + 1} — ${epics[i].name}${openPhase}`,
    group: 'Epics',
    from: epics[i].createdAt,
    to: i + 1 < epics.length ? epics[i + 1].createdAt : Infinity,
  });
}
const bucketOf = (timestamp) => BUCKETS.find(bucket => timestamp >= bucket.from && timestamp < bucket.to);

// ---- gather transcript files (each with its agent identity + owning session) ----
const files = [];
for (const dir of TRANSCRIPT_DIRS) {
  for (const fileName of fs.readdirSync(dir)) {
    if (!fileName.endsWith('.jsonl')) continue;
    const sessionId = fileName.replace(/\.jsonl$/, '');
    if (EXCLUDE.has(sessionId)) continue;
    files.push({ file: path.join(dir, fileName), main: true, instance: sessionId, session: sessionId, agent: 'orchestrator', desc: 'Main workflow session (/start, /continue, gates)' });
    const subDir = path.join(dir, sessionId, 'subagents');
    if (!fs.existsSync(subDir)) continue;
    for (const subagentFileName of fs.readdirSync(subDir)) {
      if (!subagentFileName.endsWith('.jsonl')) continue;
      const metaFile = path.join(subDir, subagentFileName.replace(/\.jsonl$/, '.meta.json'));
      let agent = 'subagent', description = '';
      if (fs.existsSync(metaFile)) {
        try { const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); agent = meta.agentType || agent; description = meta.description || ''; } catch {}
      }
      files.push({ file: path.join(subDir, subagentFileName), main: false, instance: subagentFileName.replace(/\.jsonl$/, ''), session: sessionId, agent, desc: description });
    }
  }
}

// ---- transcript hygiene: classify user-role entries ----
// Transcripts record harness-injected events as user-role messages. Only entries a person
// actually produced count as deliberate input: free-text typed messages, slash-command
// invocations, manual-test checklist submissions, and interruptions. Everything else —
// tool results, task notifications, IDE events, isMeta reminders — is machine-generated
// and MUST NOT be counted, or "user prompts" inflates several-fold.
const HARNESS_PREFIXES = ['<task-notification', '<ide_', '<system-reminder', '<local-command-std'];
function classifyUserEntry(entry) {
  if (entry.isMeta) return null;
  const message = entry.message;
  if (!message || message.role !== 'user') return null;
  let text;
  if (typeof message.content === 'string') text = message.content;
  else if (Array.isArray(message.content)) {
    const blocks = message.content.filter(block => block && block.type === 'text');
    if (!blocks.length) return null; // tool_result-only entry — machinery, not a person
    text = blocks.map(block => block.text || '').join('\n');
  } else return null;
  const trimmedText = text.trimStart();
  if (!trimmedText) return null;
  if (HARNESS_PREFIXES.some(prefix => trimmedText.startsWith(prefix))) return null;
  if (trimmedText.includes('[Request interrupted by user')) return { kind: 'interruptions', text: trimmedText };
  if (trimmedText.includes('<command-name>')) return { kind: 'commands', text: trimmedText };
  if (/^\{\s*"decision"\s*:\s*"manual-test-results"/.test(trimmedText)) return { kind: 'manualTest', text: trimmedText };
  return { kind: 'typed', text: trimmedText };
}

// ---- AskUserQuestion answers: parse the tool_result back into question → chosen option ----
// The harness records the answer as a single sentence of quoted pairs:
//   Your questions have been answered: "<question>"="<chosen label>", "<q2>"="<a2>". You can now …
// so the pairs are recoverable verbatim — no inference. An answer containing a literal double
// quote would truncate here; that only ever shortens the displayed label, never miscounts.
const RESULT_PAIR = /"([^"]+)"\s*=\s*"([^"]*)"/g;

// Questions and answers are shown verbatim but capped, so one rambling prompt can't blow out the
// report's row heights. The ellipsis makes the truncation visible instead of silent.
const clip = (value, maxLength) => { const text = String(value ?? ''); return text.length > maxLength ? text.slice(0, maxLength - 1).trimEnd() + '…' : text; };

function parseAskAnswers(content, toolUseId) {
  const resultBlock = Array.isArray(content) ? content.find(block => block && block.type === 'tool_result' && block.tool_use_id === toolUseId) : null;
  let text = '';
  if (typeof resultBlock?.content === 'string') text = resultBlock.content;
  else if (Array.isArray(resultBlock?.content)) text = resultBlock.content.filter(block => block && block.type === 'text').map(block => block.text || '').join('\n');
  const pairs = [...text.matchAll(RESULT_PAIR)].map(match => ({ question: match[1], answer: match[2] }));
  // A dialog can resolve without an answer — the prompt aborts (`is_error`, e.g. "Tool permission
  // stream closed") or the user dismisses it. The gap before that is still real idle time, but it is
  // NOT an answer latency, so it must stay out of the median/slowest figures.
  return { pairs, failed: !!resultBlock?.is_error || !pairs.length };
}

// ---- parse: dedupe streamed snapshots by message id for usage, tool_use AND AskUserQuestion ----
const usageByMessage = new Map(); // id -> usage record
const toolsByMessage = new Map(); // id -> { ts, session, names: [toolName, ...] }
const asksByMessage = new Map();  // id -> { ts, session, dialogs, questions } — deduped so a re-streamed message counts once
// tool_use id -> the decision itself: what was asked, what was chosen, how long the answer took.
// Keyed by tool_use id, so a re-streamed snapshot of the same message overwrites rather than duplicates.
const decisionsByAsk = new Map();
const inputEvents = [];       // { ts, session, kind } — deliberate user inputs (main sessions only)
const waitEvents = [];        // { ts, session, kind: 'approval'|'general'|'stall', ms } — waiting-on-user gaps
const firstInputBySession = {}; // sessionId -> { kind, command, snippet } of the FIRST deliberate input
const STALL_THRESHOLD_MS = 10 * 60 * 1000; // gaps beyond this are stalls (overnight, meetings) — reported apart, never summed into waits

for (const { file, main, instance, session, agent, desc } of files) {
  // Waiting-on-user anchors, per main session (files are chronological):
  //   previousTimestamp — timestamp of the previous transcript event of any kind
  //   pendingAskId      — tool_use id of an AskUserQuestion whose answer hasn't arrived yet
  let previousTimestamp = null, pendingAskId = null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let entry; try { entry = JSON.parse(line); } catch { continue; }
    const timestamp = entry.timestamp ? toEpochMs(entry.timestamp) : null;
    if (!timestamp) continue;
    if (main && entry.type === 'user') {
      const answersAsk = pendingAskId && Array.isArray(entry.message?.content) &&
        entry.message.content.some(block => block && block.type === 'tool_result' && block.tool_use_id === pendingAskId);
      if (answersAsk) {
        // Approval wait: AskUserQuestion tool call → its tool_result. Well-anchored on real events.
        const decision = decisionsByAsk.get(pendingAskId);
        const askResult = parseAskAnswers(entry.message?.content, pendingAskId);
        if (previousTimestamp != null && timestamp > previousTimestamp) {
          const waitMs = timestamp - previousTimestamp;
          // `answered` gates the answer-latency stats only — the gap still counts as idle time either way.
          waitEvents.push({ ts: timestamp, session, kind: waitMs > STALL_THRESHOLD_MS ? 'stall' : 'approval', ms: waitMs, answered: !askResult.failed });
          if (decision) { decision.waitMs = waitMs; decision.isStall = waitMs > STALL_THRESHOLD_MS; }
        }
        if (decision) { decision.answers = askResult.pairs; decision.failed = askResult.failed; }
        pendingAskId = null;
      } else {
        const userInput = classifyUserEntry(entry);
        if (userInput) {
          if (!(session in firstInputBySession)) {
            const commandName = (userInput.text.match(/<command-name>\s*([^<\s]+)\s*<\/command-name>/) || [])[1] || null;
            firstInputBySession[session] = { kind: userInput.kind, command: commandName && !commandName.startsWith('/') ? '/' + commandName : commandName, snippet: userInput.text.slice(0, 120) };
          }
          inputEvents.push({ ts: timestamp, session, kind: userInput.kind });
          // General wait: end of the previous event → this deliberate input. An interruption is
          // NOT a wait — the AI was mid-generation, so that gap is busy time, not waiting.
          if (userInput.kind !== 'interruptions') {
            if (previousTimestamp != null && timestamp > previousTimestamp) {
              const waitMs = timestamp - previousTimestamp;
              waitEvents.push({ ts: timestamp, session, kind: waitMs > STALL_THRESHOLD_MS ? 'stall' : 'general', ms: waitMs });
            }
            pendingAskId = null; // a fresh input abandons any unanswered question
          }
        }
      }
    }
    if (entry.type === 'assistant' && entry.message?.model !== '<synthetic>') { // synthetic messages carry no real usage
      const id = entry.message?.id || entry.uuid;
      if (entry.message?.usage) {
        usageByMessage.set(id, { ts: timestamp, model: entry.message.model, usage: entry.message.usage, cc: entry.message.usage.cache_creation, instance, session, agent, desc });
      }
      if (Array.isArray(entry.message?.content)) {
        const names = [];
        let dialogs = 0, questions = 0;
        for (const block of entry.message.content) {
          if (block.type !== 'tool_use') continue;
          names.push(block.name);
          if (block.name === 'AskUserQuestion' && main) {
            dialogs += 1;
            const askedQuestions = Array.isArray(block.input?.questions) ? block.input.questions : [];
            questions += askedQuestions.length || 1;
            pendingAskId = block.id || pendingAskId;
            if (block.id) decisionsByAsk.set(block.id, {
              ts: timestamp, session, waitMs: null, isStall: false, answers: null,
              // Full question text is kept as the match key for the answer pairs; only the display
              // copy is clipped, so a long question still matches its recorded answer exactly.
              questions: askedQuestions.map(asked => ({ header: clip(asked?.header, 40), question: String(asked?.question || ''), display: clip(asked?.question, 170) })),
            });
          }
        }
        if (names.length) toolsByMessage.set(id, { ts: timestamp, session, names });
        // Keyed by message id like the maps above, so a re-streamed snapshot overwrites instead of
        // adding — questions aren't inflated by the number of snapshot lines for one message.
        if (dialogs) asksByMessage.set(id, { ts: timestamp, session, dialogs, questions });
      }
    }
    previousTimestamp = timestamp;
  }
}

// ---- post-delivery reporting sessions: auto-flag and roll up separately ----
// A session whose FIRST deliberate input is a report/analysis command is about the project,
// not part of the build. Its tokens/cost are excluded from the build buckets and shown as a
// separate line item, so report generation doesn't pollute cross-project comparison.
// --keep=<id> overrides the flag for a specific session.
// The pre-1.3 names (/workflow-insights, /build-effort) stay in the set: transcripts are
// historical, so sessions recorded before the rename must still be recognised.
const POST_DELIVERY_COMMANDS = new Set([
  '/build-report-all',
  '/build-report-maintainer', '/build-report-stakeholders',
  '/build-report-cost', '/build-report-effort', '/dashboard',
  '/build-report', '/workflow-insights', '/build-effort',
]);
const flagged = new Set();
for (const [sessionId, firstInput] of Object.entries(firstInputBySession)) {
  if (KEEP.has(sessionId)) continue;
  if (firstInput.kind === 'commands' && POST_DELIVERY_COMMANDS.has(firstInput.command)) flagged.add(sessionId);
}

// Fold the deduped questions into per-bucket interaction counts (once per unique message).
const interactions = {};       // bucketKey -> { questionDialogs, questionsAsked }
const interactionsAt = (timestamp) => { const bucket = bucketOf(timestamp); return bucket ? (interactions[bucket.key] ||= { questionDialogs: 0, questionsAsked: 0 }) : null; };
for (const { ts, session, dialogs, questions } of asksByMessage.values()) {
  if (flagged.has(session)) continue;
  const bucketInteractions = interactionsAt(ts);
  if (bucketInteractions) { bucketInteractions.questionDialogs += dialogs; bucketInteractions.questionsAsked += questions; }
}

// Fold deliberate inputs and waits into per-bucket rollups.
const emptyInputs = () => ({ typed: 0, commands: 0, manualTest: 0, interruptions: 0 });
const emptyWaits = () => ({ approvalMs: 0, approvalCount: 0, generalMs: 0, generalCount: 0, stallMs: 0, stallCount: 0 });
const inputsByBucket = {}, waitsByBucket = {};
const answerSamples = {}; // bucketKey -> [ms, ...] approval waits, for median/slowest
for (const inputEvent of inputEvents) {
  if (flagged.has(inputEvent.session)) continue;
  const bucket = bucketOf(inputEvent.ts);
  if (bucket) (inputsByBucket[bucket.key] ||= emptyInputs())[inputEvent.kind] += 1;
}
for (const waitEvent of waitEvents) {
  if (flagged.has(waitEvent.session)) continue;
  const bucket = bucketOf(waitEvent.ts);
  if (!bucket) continue;
  const bucketWaits = waitsByBucket[bucket.key] ||= emptyWaits();
  if (waitEvent.kind === 'stall') { bucketWaits.stallMs += waitEvent.ms; bucketWaits.stallCount += 1; }
  else if (waitEvent.kind === 'approval') { bucketWaits.approvalMs += waitEvent.ms; bucketWaits.approvalCount += 1; if (waitEvent.answered !== false) (answerSamples[bucket.key] ||= []).push(waitEvent.ms); }
  else { bucketWaits.generalMs += waitEvent.ms; bucketWaits.generalCount += 1; }
}
// Typical and worst answer latency. A SUM of approval waits reads as lost time; the median plus the
// slowest one is what actually says whether the user was a bottleneck.
const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right), middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
};
const statsOf = (samples) => ({ medianMs: median(samples), maxMs: samples.length ? Math.max(...samples) : null, samples: samples.length });

// ---- decision log: one row per question asked, with the option the user picked ----
// A dialog can carry several questions answered in one go, so the wait belongs to the dialog, not
// to each question — `first` marks the row that owns it, and the stats above never double-count.
const decisionsByBucket = {};
for (const decision of decisionsByAsk.values()) {
  if (flagged.has(decision.session)) continue;
  const bucket = bucketOf(decision.ts);
  if (!bucket) continue;
  const list = decisionsByBucket[bucket.key] ||= [];
  const byQuestion = new Map((decision.answers || []).map(pair => [pair.question, pair.answer]));
  const questionRows = decision.questions.length ? decision.questions : [{ header: '', question: '', display: '' }];
  questionRows.forEach((questionRow, i) => {
    // Match the answer to its question by text; fall back to position when the recorded question
    // string was truncated or reworded (multiSelect answers arrive as one comma-joined label).
    const answer = byQuestion.get(questionRow.question) ?? (decision.answers ? decision.answers[i]?.answer : undefined) ?? null;
    list.push({
      ts: decision.ts, header: questionRow.header, question: questionRow.display ?? questionRow.question,
      answer: answer === null ? null : clip(answer, 180),
      // Three distinct "no answer" outcomes, so the log never implies a decision that wasn't made:
      // resolved=false (no result at all — re-asked or superseded), failed=true (dialog aborted or
      // dismissed), or resolved with answers where this question's pair didn't match.
      resolved: decision.answers != null, failed: !!decision.failed,
      waitMs: decision.waitMs, isStall: decision.isStall, first: i === 0,
    });
  });
}
for (const list of Object.values(decisionsByBucket)) list.sort((left, right) => left.ts - right.ts);

// ---- aggregate tokens/cost/models/tools per bucket ----
const emptyTokens = () => ({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0, costUsd: 0, calls: 0 });
const addTokens = (totals, message) => { totals.input += message.input; totals.cacheRead += message.cacheRead; totals.cacheWrite += message.cacheWrite; totals.output += message.output; totals.costUsd += message.costUsd; totals.calls += 1; };
const usageByBucket = {};
for (const bucket of BUCKETS) usageByBucket[bucket.key] = { total: emptyTokens(), models: {} };

// instance -> { agent, ts of first record } — for sub-agent fan-out per bucket
const instancesById = {};
// agentType -> { calls, output, costUsd, models } — accumulated in this same pass so the cache-split
// and cost formula live in exactly one place (no second loop over usageByMessage to drift out of sync).
const agentCost = {};
// Post-delivery reporting sessions: everything they (and their sub-agents) spent, kept apart.
const postDeliveryTokens = emptyTokens();
for (const usageRecord of usageByMessage.values()) {
  // Price each message at ITS OWN timestamp, so a build that spans a price change (or the end of
  // a promotional window) is costed correctly on both sides of it.
  const modelRates = rates(usageRecord.model, usageRecord.ts);
  const cacheWrite5m = usageRecord.cc ? (usageRecord.cc.ephemeral_5m_input_tokens || 0) : (usageRecord.usage.cache_creation_input_tokens || 0);
  const cacheWrite1h = usageRecord.cc ? (usageRecord.cc.ephemeral_1h_input_tokens || 0) : 0;
  const messageTokens = {
    input: usageRecord.usage.input_tokens || 0, cacheRead: usageRecord.usage.cache_read_input_tokens || 0,
    cacheWrite: cacheWrite5m + cacheWrite1h, output: usageRecord.usage.output_tokens || 0,
  };
  messageTokens.costUsd = (messageTokens.input * modelRates.input + messageTokens.output * modelRates.output + messageTokens.cacheRead * modelRates.cacheRead + cacheWrite5m * modelRates.cacheWrite5m + cacheWrite1h * modelRates.cacheWrite1h) / 1e6;
  if (flagged.has(usageRecord.session)) { addTokens(postDeliveryTokens, messageTokens); continue; }
  const bucket = bucketOf(usageRecord.ts);
  if (!bucket) continue;
  const bucketUsage = usageByBucket[bucket.key];
  addTokens(bucketUsage.total, messageTokens);
  addTokens(bucketUsage.models[usageRecord.model] ||= emptyTokens(), messageTokens);
  const instanceInfo = (instancesById[usageRecord.instance] ||= { agent: usageRecord.agent, ts: usageRecord.ts });
  if (usageRecord.ts < instanceInfo.ts) instanceInfo.ts = usageRecord.ts;
  const agentEntry = agentCost[usageRecord.agent] ||= { calls: 0, output: 0, costUsd: 0, models: {} };
  agentEntry.calls += 1; agentEntry.output += messageTokens.output; agentEntry.costUsd += messageTokens.costUsd;
  agentEntry.models[usageRecord.model] = (agentEntry.models[usageRecord.model] || 0) + 1;
}

const toolsByBucket = {};
for (const bucket of BUCKETS) toolsByBucket[bucket.key] = {};
for (const { ts, session, names } of toolsByMessage.values()) {
  if (flagged.has(session)) continue;
  const bucket = bucketOf(ts);
  if (!bucket) continue;
  const toolCounts = toolsByBucket[bucket.key];
  for (const toolName of names) toolCounts[toolName] = (toolCounts[toolName] || 0) + 1;
}

// sub-agent fan-out: count distinct instances per bucket per agentType (orchestrator excluded —
// it's one continuous main session, not a spawned worker). Bucket = bucket of the instance's
// first usage record.
const fanout = {}; // bucketKey -> { agentType -> instanceCount }
for (const instanceInfo of Object.values(instancesById)) {
  if (instanceInfo.agent === 'orchestrator') continue;
  const bucket = bucketOf(instanceInfo.ts);
  if (!bucket) continue;
  const bucketFanout = (fanout[bucket.key] ||= {});
  bucketFanout[instanceInfo.agent] = (bucketFanout[instanceInfo.agent] || 0) + 1;
}

// ---- emit per-bucket ----
const buckets = BUCKETS.map(bucket => {
  const bucketUsage = usageByBucket[bucket.key];
  const totals = bucketUsage.total;
  const inputProcessed = totals.input + totals.cacheRead + totals.cacheWrite;
  const cacheHit = inputProcessed ? totals.cacheRead / inputProcessed : 0;
  const bucketFanout = fanout[bucket.key] || {};
  // Fix cycles at epic granularity: the batched Playwright pass (playwright-runner) runs once per
  // EPIC-END. Each extra run means the epic bounced back to BUILD for fixes, so its reruns are the
  // cleanest epic-level rework signal. (developer/test-generator can't be used here — at epic level
  // they run once per story, so their counts would conflate story count with rework.)
  return {
    key: bucket.key, label: bucket.label, group: bucket.group,
    tokens: totals, cacheHit,
    models: bucketUsage.models, tools: toolsByBucket[bucket.key], fanout: bucketFanout,
    fixCycles: Math.max(0, (bucketFanout['playwright-runner'] || 0) - 1),
    agentInstances: Object.values(bucketFanout).reduce((total, count) => total + count, 0),
    userInputs: inputsByBucket[bucket.key] || emptyInputs(),
    waits: waitsByBucket[bucket.key] || emptyWaits(),
    answerStats: statsOf(answerSamples[bucket.key] || []),
    decisions: decisionsByBucket[bucket.key] || [],
    ...(interactions[bucket.key] || { questionDialogs: 0, questionsAsked: 0 }),
  };
}).filter(bucket => bucket.tokens.calls > 0);

// ---- global rollups ----
const sumTokens = (selectTokens) => buckets.reduce((totals, bucket) => {
  const bucketTokens = selectTokens(bucket); for (const key of Object.keys(totals)) totals[key] += bucketTokens[key] || 0; return totals;
}, emptyTokens());
const modelTotals = {};
const toolTotals = {};
const agentTotals = {}; // agentType -> { instances }
for (const bucket of buckets) {
  for (const [model, modelTokens] of Object.entries(bucket.models)) {
    const modelTotal = modelTotals[model] ||= emptyTokens();
    for (const key of Object.keys(modelTotal)) modelTotal[key] += modelTokens[key];
  }
  for (const [toolName, count] of Object.entries(bucket.tools)) toolTotals[toolName] = (toolTotals[toolName] || 0) + count;
  for (const [agent, count] of Object.entries(bucket.fanout)) (agentTotals[agent] ||= { instances: 0 }).instances += count;
}
// agentCost was accumulated in the per-bucket usage loop above — single source for the cost formula.
// Emit the raw model id + count per agent; display-name shortening is the renderer's job, so the
// data file stays canonical (raw ids) and no transform is baked into it.
const agents = Object.entries(agentCost).map(([agent, agentEntry]) => ({
  agent, calls: agentEntry.calls, output: agentEntry.output, costUsd: agentEntry.costUsd,
  instances: agent === 'orchestrator' ? null : (agentTotals[agent]?.instances || 0),
  models: Object.entries(agentEntry.models).sort((left, right) => right[1] - left[1]).map(([model, count]) => ({ model, count })),
})).sort((left, right) => right.costUsd - left.costUsd);

const grandTokens = sumTokens(bucket => bucket.tokens);
const grandInputProcessed = grandTokens.input + grandTokens.cacheRead + grandTokens.cacheWrite;

// Human-readable pricing line, generated from PRICING + the multipliers so it can never drift from
// the table (deduped by display name — the two Haiku ids share one name).
const pricingNote = 'USD per 1M tokens — ' +
  [...new Map(Object.values(PRICING).map(modelPricing => [modelPricing.name, `${modelPricing.name} $${modelPricing.input}/$${modelPricing.output}`])).values()].join(', ') +
  `. Cache read ${CACHE_READ_MULTIPLIER}×, write ${CACHE_WRITE_5M_MULTIPLIER}×/${CACHE_WRITE_1H_MULTIPLIER}×.`;

// Grand rollups for the user-involvement metrics (sum of the per-bucket figures).
const userInputsTotal = emptyInputs();
const waitsTotal = emptyWaits();
for (const bucket of buckets) {
  for (const key of Object.keys(userInputsTotal)) userInputsTotal[key] += bucket.userInputs[key];
  for (const key of Object.keys(waitsTotal)) waitsTotal[key] += bucket.waits[key];
}
// Median/slowest over the buckets that survived the `calls > 0` filter — same population as the table.
const answerStatsTotal = statsOf(buckets.flatMap(bucket => answerSamples[bucket.key] || []));
// Epics that needed nothing from the user: no typed message, no command, no decision. The clearest
// single signal of how autonomous the workflow was.
const unattendedBuckets = buckets.filter(bucket =>
  !bucket.decisions.length && !Object.values(bucket.userInputs).some(Boolean)).map(bucket => bucket.label);

const result = {
  generatedAt: new Date().toISOString(),
  feature,
  usdToZar: RATE,
  rateProvided: !!RATE_ARG,
  pricingNote,
  // Non-empty means at least one model wasn't in the pricing table and was costed at Opus-tier
  // rates. The figures in this report are then ESTIMATES, not exact — say so when presenting them.
  unknownModels: [...unknownModels],
  pricingEstimated: unknownModels.size > 0,
  extraDirs, // sibling (worktree) transcript directories that were included
  stallThresholdMin: STALL_THRESHOLD_MS / 60000,
  grand: { ...grandTokens, cacheHit: grandInputProcessed ? grandTokens.cacheRead / grandInputProcessed : 0, totalTokens: grandTokens.input + grandTokens.cacheRead + grandTokens.cacheWrite + grandTokens.output },
  userInputsTotal,
  waitsTotal,
  answerStatsTotal,
  unattendedBuckets,
  postDelivery: {
    sessions: [...flagged].map(id => ({ id, firstCommand: firstInputBySession[id]?.command || null, snippet: firstInputBySession[id]?.snippet || '' })),
    tokens: postDeliveryTokens,
  },
  modelTotals, toolTotals, agents,
  buckets,
};

const reportsDir = path.join(PROJECT_ROOT, 'generated-docs', 'reports');
fs.mkdirSync(reportsDir, { recursive: true });
fs.writeFileSync(path.join(reportsDir, 'build-cost-data.json'), JSON.stringify(result, null, 2));

if (unknownModels.size) console.warn('WARNING: unknown models priced as Opus 4.8 — the cost figures are ESTIMATES until these are added to PRICING in .claude/scripts/lib/report-core.mjs (verify rates via the claude-api skill): ' + [...unknownModels].join(', '));
console.log('written generated-docs/reports/build-cost-data.json');
console.log(JSON.stringify({
  pricingEstimated: result.pricingEstimated,
  unknownModels: result.unknownModels,
  buckets: buckets.length,
  totalCallsAcrossBuckets: grandTokens.calls,
  totalCostUsd: +grandTokens.costUsd.toFixed(2),
  totalCostZar: +(grandTokens.costUsd * RATE).toFixed(2),
  cacheHitPct: +(result.grand.cacheHit * 100).toFixed(1),
  deliberateUserInputs: userInputsTotal,
  waitingOnUserMin: +((waitsTotal.approvalMs + waitsTotal.generalMs) / 60000).toFixed(1),
  decisionsLogged: buckets.reduce((total, bucket) => total + bucket.decisions.length, 0),
  decisionsMissingAnswer: buckets.reduce((total, bucket) => total + bucket.decisions.filter(decision => !decision.answer).length, 0),
  answerLatencySec: {
    median: answerStatsTotal.medianMs != null ? +(answerStatsTotal.medianMs / 1000).toFixed(0) : null,
    slowest: answerStatsTotal.maxMs != null ? +(answerStatsTotal.maxMs / 1000).toFixed(0) : null,
  },
  unattendedBuckets,
  stalls: { count: waitsTotal.stallCount, totalMin: +(waitsTotal.stallMs / 60000).toFixed(0) },
  postDeliverySessionsExcluded: result.postDelivery.sessions.map(session => `${session.id} (${session.firstCommand || session.snippet.slice(0, 40)})`),
  postDeliveryCostUsd: +postDeliveryTokens.costUsd.toFixed(2),
  extraTranscriptDirsIncluded: extraDirs,
  topTools: Object.entries(toolTotals).sort((left, right) => right[1] - left[1]).slice(0, 6),
  agents: agents.map(agentRow => `${agentRow.agent}${agentRow.instances != null ? ' ×' + agentRow.instances : ''}: $${agentRow.costUsd.toFixed(2)}`),
}, null, 1));

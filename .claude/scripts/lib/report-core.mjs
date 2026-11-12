// report-core.mjs
//
// Shared building blocks for the two log-derived data generators
// (generate-build-cost-report.mjs and generate-build-effort.mjs): the ONE pricing table, the
// cache multipliers, the transcript-directory discovery, and the deduped usage-record reader.
//
// What each generator takes, so the boundary is explicit:
//   - BOTH import PRICING/rates() and discoverTranscriptDirs(). Those are the two places a
//     divergence changes the headline numbers — the price of a token, and which transcripts
//     count — so they must never be copied into a generator. They were, once: the two walks
//     drifted to different sibling-worktree rules and the reports disagreed on any build that
//     used a parallel worktree. Don't reintroduce a local copy.
//   - the effort generator also uses gatherUsageRecords(); the cost generator does NOT. It
//     needs more than usage per message (tool_use blocks, AskUserQuestion pairs, user-input
//     classification), so it keeps its own line-level walk over the dirs discovered here.
//     That is deliberate, not drift.
//
// Pure functions only — no argv parsing, no file writes, no process.exit — so both report
// generators can compose these however they need. Transcript-store discovery, re-exported from
// transcript-store.js, is the exception.
import fs from 'node:fs';
import path from 'node:path';

// ---- exit codes ----
// Both generators fail for two very different reasons, and the caller has to tell them apart:
// there is no project to report on yet (STOP — every later step fails the same way), versus an
// optional input is missing (CONTINUE — the page renders and names the gap in Data quality).
// A distinct code makes that a deterministic check. It used to be a substring match on the error
// text, which had already drifted: the procedure quoted "No epics found at" while the effort
// generator printed "No epics at", so the gate silently missed half its cases.
export const EXIT_NO_PROJECT = 3;
export const EXIT_MISSING_INPUT = 1;

// ---- pricing (USD per 1M tokens). Cache read 0.1x input; cache write 1.25x (5m) / 2x (1h). ----
//
// There is NO pricing API — the Models API (`GET /v1/models`) returns context/output limits and
// a capability tree, but no rates. So this table is hand-maintained: verify any new model's
// prices via the `claude-api` skill (never from memory) and add it here when it shows up in the
// unknown-model warning.
//
// Hardcoding is also the *correct* choice, not just the only one: these reports price
// HISTORICAL token spend, so a run must use the rate that was in effect when the tokens were
// spent. A live lookup would silently re-price old reports whenever rates changed, so the same
// report would disagree with itself between runs.
//
// `promo` is optional, for time-boxed introductory pricing: `{ input, output, until }` (plus an
// optional `from`), where the bounds are EXCLUSIVE-end ISO instants. It applies only when the
// caller passes the spend timestamp to rates() — see the `spentAtMs` parameter below.
export const CACHE_READ_MULTIPLIER = 0.1, CACHE_WRITE_5M_MULTIPLIER = 1.25, CACHE_WRITE_1H_MULTIPLIER = 2;
export const PRICING = {
  'claude-fable-5':            { input: 10, output: 50, name: 'Fable 5' },
  'claude-mythos-5':           { input: 10, output: 50, name: 'Mythos 5' },
  'claude-opus-5':             { input: 5,  output: 25, name: 'Opus 5' },
  'claude-opus-4-8':           { input: 5,  output: 25, name: 'Opus 4.8' },
  'claude-opus-4-7':           { input: 5,  output: 25, name: 'Opus 4.7' },
  'claude-opus-4-6':           { input: 5,  output: 25, name: 'Opus 4.6' },
  // Sonnet 5 launched on introductory pricing of $2/$10, reverting to list on 2026-09-01.
  'claude-sonnet-5':           { input: 3,  output: 15, name: 'Sonnet 5',
                                 promo: { input: 2, output: 10, until: '2026-09-01T00:00:00Z' } },
  'claude-sonnet-4-6':         { input: 3,  output: 15, name: 'Sonnet 4.6' },
  'claude-haiku-4-5-20251001': { input: 1,  output: 5,  name: 'Haiku 4.5' },
  'claude-haiku-4-5':          { input: 1,  output: 5,  name: 'Haiku 4.5' },
};
export const unknownModels = new Set();

// rates(model[, spentAtMs]) -> { input, output, cacheRead, cacheWrite5m, cacheWrite1h, estimated }
//
// `spentAtMs` is the epoch-ms timestamp of the spend being priced. Pass it whenever you know it: it
// selects the rate that was in effect at that moment. Omit it and you get LIST price — a caller
// that doesn't know when the tokens were spent must not be handed promotional rates.
//
// `estimated` is true when the model isn't in the table and Opus-tier pricing was substituted.
// Callers should surface that in the report rather than presenting the figure as exact.
export function rates(model, spentAtMs) {
  let modelPricing = PRICING[model];
  let estimated = false;
  if (!modelPricing) { unknownModels.add(model); modelPricing = PRICING['claude-opus-4-8']; estimated = true; }
  let { input, output } = modelPricing;
  if (modelPricing.promo && spentAtMs != null) {
    const from = modelPricing.promo.from ? Date.parse(modelPricing.promo.from) : -Infinity;
    const until = Date.parse(modelPricing.promo.until);
    if (spentAtMs >= from && spentAtMs < until) { input = modelPricing.promo.input; output = modelPricing.promo.output; }
  }
  return {
    input, output,
    cacheRead: input * CACHE_READ_MULTIPLIER,
    cacheWrite5m: input * CACHE_WRITE_5M_MULTIPLIER,
    cacheWrite1h: input * CACHE_WRITE_1H_MULTIPLIER,
    estimated,
  };
}

// ---- transcript directory discovery ----
// Re-exported from transcript-store.js, which owns and documents the discovery rules. Returns
// `{ dirs, folders, extras, slug, projectsRoot }`. Pass `transcriptsOverride` (a directory
// holding `<slug>/`) to read a copied snapshot instead of the live store.
export { discoverTranscriptDirs } from './transcript-store.js';

// ---- usage records, deduped by message id, across orchestrator + all sub-agents ----
// Returns { records:[{ts, model, cost, tokens, sessionId, agent, main, estimated}], sawSubagents,
// sawEstimatedPricing }.
// `sawSubagents` lets a caller detect the incomplete-log case (no sub-agent transcripts
// captured) and degrade gracefully instead of reporting wrong cost.
// `sawEstimatedPricing` is true when any record's model was missing from PRICING and was priced
// at Opus-tier rates — the report must say so rather than presenting the total as exact.
// Each record is priced at the rate in effect at ITS OWN timestamp, so a run that spans a
// price change (or the end of a promotional window) is costed correctly on both sides of it.
export function gatherUsageRecords(dirs, excludeIds = new Set()) {
  const files = [];
  let sawSubagents = false;
  for (const dir of dirs) {
    for (const fileName of fs.readdirSync(dir)) {
      if (!fileName.endsWith('.jsonl')) continue;
      const sessionId = fileName.replace(/\.jsonl$/, '');
      if (excludeIds.has(sessionId)) continue;
      files.push({ file: path.join(dir, fileName), sessionId, agent: 'orchestrator', main: true });
      const subDir = path.join(dir, sessionId, 'subagents');
      if (!fs.existsSync(subDir)) continue;
      for (const subagentFileName of fs.readdirSync(subDir)) {
        if (!subagentFileName.endsWith('.jsonl')) continue;
        sawSubagents = true;
        let agent = 'subagent';
        const metaFile = path.join(subDir, subagentFileName.replace(/\.jsonl$/, '.meta.json'));
        if (fs.existsSync(metaFile)) { try { agent = JSON.parse(fs.readFileSync(metaFile, 'utf8')).agentType || agent; } catch { /* keep default */ } }
        files.push({ file: path.join(subDir, subagentFileName), sessionId, agent, main: false });
      }
    }
  }
  const recordsByMessageId = new Map();
  for (const { file, sessionId, agent, main } of files) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      let entry; try { entry = JSON.parse(line); } catch { continue; }
      if (entry.type !== 'assistant' || entry.message?.model === '<synthetic>' || !entry.message?.usage) continue;
      const id = entry.message?.id || entry.uuid;
      const usage = entry.message.usage, cacheCreation = usage.cache_creation;
      const cacheWrite5m = cacheCreation ? (cacheCreation.ephemeral_5m_input_tokens || 0) : (usage.cache_creation_input_tokens || 0);
      const cacheWrite1h = cacheCreation ? (cacheCreation.ephemeral_1h_input_tokens || 0) : 0;
      const inputTokens = usage.input_tokens || 0, cacheReadTokens = usage.cache_read_input_tokens || 0, outputTokens = usage.output_tokens || 0;
      const timestamp = entry.timestamp ? new Date(entry.timestamp).getTime() : null;
      // Price at the spend's own timestamp — see rates() on why `spentAtMs` matters.
      const modelRates = rates(entry.message.model, timestamp);
      const cost = (inputTokens * modelRates.input + outputTokens * modelRates.output + cacheReadTokens * modelRates.cacheRead + cacheWrite5m * modelRates.cacheWrite5m + cacheWrite1h * modelRates.cacheWrite1h) / 1e6;
      recordsByMessageId.set(id, { ts: timestamp, model: entry.message.model, cost, tokens: inputTokens + cacheReadTokens + cacheWrite5m + cacheWrite1h + outputTokens, sessionId, agent, main, estimated: modelRates.estimated });
    }
  }
  const records = [...recordsByMessageId.values()].filter(record => record.ts);
  return { records, sawSubagents, sawEstimatedPricing: records.some(record => record.estimated) };
}

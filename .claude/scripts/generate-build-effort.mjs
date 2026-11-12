// Generates the BUILD-EFFORT report — how long and how much each story cost to build,
// grouped by screen type AND rolled up to the feature (epic) level, for ONE project.
// Ground truth only:
//   - time  : per-story startedAt -> completedAt from generated-docs/epics/<slug>/state.json
//   - tokens: every transcript message (orchestrator + sub-agents) bucketed into the story
//             window containing its timestamp; priced with the shared report-core table.
//
// Story figures are measured. Feature/epic figures are those measured stories summed, plus a
// documented pro-rata share of the overhead that sits outside every story window (see UPLIFT
// below) — so an epic total can be compared with, and used to estimate, a whole feature.
//
//   node .claude/scripts/generate-build-effort.mjs [--rate=18.50] [--exclude=id,id]
//                                                              [--transcripts=DIR] [--project-root=DIR]
//
// Writes generated-docs/reports/build-effort-data.json — DATA ONLY, no page of its own.
//
// This used to render a standalone build-effort.html. It no longer does: the effort content is
// now the "Effort benchmarks" section of the maintainer build report, rendered by
// scripts/generate-build-report-html.js from this JSON. Keeping a second page meant the same
// tables existed in two renderers, so the two could disagree about the same project — the
// duplication this merge removed. The JSON stays the durable artifact (it also carries the
// per-story rows for future cross-project pooling); render new views from it, don't re-add a page.
//
// Completeness gate: if no sub-agent transcripts are found (e.g. an older log format that
// only kept the orchestrator), token cost is INCOMPLETE — `costComplete: false` tells the
// consumer to render time-only rather than printing wrong dollar figures.
//
// Inclusion rule: the same one the cost generator uses. Post-delivery reporting sessions are
// dropped (see the block below `--exclude`) so the two data files can't hand the same page two
// different build totals.
import fs from 'node:fs';
import path from 'node:path';
import { getProjectRoot } from './lib/project-root.js';
import {
  discoverTranscriptDirs, gatherUsageRecords, unknownModels,
  EXIT_NO_PROJECT as NO_PROJECT, EXIT_MISSING_INPUT as MISSING_INPUT,
} from './lib/report-core.mjs';

// ---- args ----
const args = Object.fromEntries(process.argv.slice(2).filter(arg => arg.startsWith('--')).map(arg => {
  const [key, value] = arg.replace(/^--/, '').split('='); return [key, value ?? true];
}));
const RATE = parseFloat(args.rate) || null; // ZAR per USD; optional
if (args.exclude === true) console.warn('WARNING: --exclude needs a value like --exclude=id1,id2 — ignoring it (nothing excluded).');
const EXCLUDE = new Set((typeof args.exclude === 'string' ? args.exclude : '').split(',').map(id => id.trim()).filter(Boolean));
const PROJECT_ROOT = (typeof args['project-root'] === 'string') ? path.resolve(args['project-root']) : getProjectRoot();
const TRANSCRIPTS = (typeof args.transcripts === 'string') ? path.resolve(args.transcripts) : null;

// ---- post-delivery reporting sessions: excluded, exactly as the cost generator excludes them ----
// A session whose first deliberate input is a report/dashboard command is ABOUT the project, not
// part of the build. Its spend sits outside every story window, so counting it here would land it
// in `overheadCost` and inflate `costUplift` — and since running /build-report-maintainer creates
// one of these sessions every time, every "fully loaded" figure and the sizing calculator would
// creep upwards with each report run. It would also put a total on the maintainer page that
// contradicts the Cost & user involvement panel a few sections above it, which excludes them.
//
// The classification lives in generate-build-cost-report.mjs (it needs that script's full
// transcript-hygiene walk to find each session's first DELIBERATE input) and is published in the
// data file it writes — including any `--keep=<id>` override. build-report-procedure.md runs that
// generator immediately before this one, so the list is fresh. Absent (run standalone, or the cost
// generator failed), nothing is auto-excluded and `--exclude` still applies.
const postDeliveryExcluded = [];
try {
  const costData = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'generated-docs', 'reports', 'build-cost-data.json'), 'utf8'));
  for (const session of costData?.postDelivery?.sessions || []) {
    if (!session?.id || EXCLUDE.has(session.id)) continue;
    EXCLUDE.add(session.id);
    postDeliveryExcluded.push(session.id);
  }
} catch { /* no cost data alongside — carry on with --exclude only */ }

// ---- screen-type taxonomy (edit here to tune classification) ----
// First matching rule wins, so order = priority. Titles come from the story's Playwright
// spec filename. Deliberately title-based, never the epic slug (an epic named "…-export"
// must not tag its listing stories as Export).
const TAXONOMY = [
  { cat: 'Auth / app-shell / infra',  short: 'infra',   re: /server-side auth|bff|proxy|gateway|session|sign ?in|app shell|shell|nav guard|permission|badge|timeout/ },
  { cat: 'Export',                    short: 'export',  re: /export|csv/ },
  { cat: 'Upload / create form',      short: 'form',    re: /upload/ },
  { cat: 'Record action',             short: 'action',  re: /approve|reject|retry|cancel|submit|delete|create|edit|update/ },
  { cat: 'Listing / table page',      short: 'listing', re: /table|overview|filter|search|sort|paginat|card list|\blist\b/ },
  { cat: 'Detail / summary view',     short: 'detail',  re: /summary|detail|validation error|banner|audit|note|state|view/ },
];
const OTHER = { cat: 'Other', short: 'other' };
const classify = title => (TAXONOMY.find(rule => rule.re.test(title.toLowerCase())) || OTHER).cat;
const SHORT_BY_CATEGORY = Object.fromEntries([...TAXONOMY, OTHER].map(rule => [rule.cat, rule.short]));

// ---- stories (time) from epic state files + titles from spec filenames ----
const epicsDir = path.join(PROJECT_ROOT, 'generated-docs', 'epics');
// Same condition and same wording as the cost generator's — one project state should not be
// described two ways by two scripts the orchestrator runs back to back.
if (!fs.existsSync(epicsDir)) {
  console.error('No epics found at generated-docs/epics/ — the workflow has not created an epic yet; nothing to report.');
  process.exit(NO_PROJECT);
}
function specTitles() {
  const e2eDir = path.join(PROJECT_ROOT, 'web', 'e2e'); const titlesByStory = {};
  if (!fs.existsSync(e2eDir)) return titlesByStory;
  for (const fileName of fs.readdirSync(e2eDir)) {
    const match = fileName.match(/^epic-(.+)-story-(\d+)-(.+)\.spec\.ts$/);
    if (match) titlesByStory[`${match[1]}|${match[2]}`] = match[3].replace(/-/g, ' ');
  }
  return titlesByStory;
}
const titles = specTitles();
const stories = [];
// How many stories each epic DECLARES, timed or not. The loop below keeps only stories with
// usable timestamps, so `stories.length` per epic is a coverage figure, not the epic's size —
// and an epic measured from 2 of its 8 stories must not be presented as a measured epic.
const epicStoryTotals = new Map();
for (const slug of fs.readdirSync(epicsDir)) {
  const stateFile = path.join(epicsDir, slug, 'state.json');
  if (!fs.existsSync(stateFile)) continue;
  let state; try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { continue; }
  const epicName = state.epic?.name || slug;
  const declared = Object.entries(state.stories || {});
  epicStoryTotals.set(slug, declared.length);
  for (const [storyNumber, storyState] of declared) {
    const startMs = storyState.startedAt ? new Date(storyState.startedAt).getTime() : NaN;
    const endMs = storyState.completedAt ? new Date(storyState.completedAt).getTime() : NaN;
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
    const title = titles[`${slug}|${storyNumber}`] || `story ${storyNumber}`;
    stories.push({ epic: slug, epicName, n: storyNumber, title, start: startMs, end: endMs, min: (endMs - startMs) / 60000, cat: classify(title), cost: 0, tokens: 0, calls: 0 });
  }
}
// Not a "no project" case: epics exist, they just have no timed stories yet (a build in its first
// story, or one predating the timestamps). The maintainer page drops this section and says so, so
// the caller continues — hence MISSING_INPUT, not NO_PROJECT.
if (!stories.length) { console.error('No stories with start/complete timestamps found — nothing to report.'); process.exit(MISSING_INPUT); }
stories.sort((left, right) => left.start - right.start);

// ---- tokens: bucket transcript records into story windows ----
// Epics can be built in parallel (separate branches/worktrees), so story windows OVERLAP and a
// message's timestamp may sit inside several of them. Attributing it to the first match would
// dump all concurrent spend on whichever story started earliest — and at the feature level that
// silently drains one epic into another. With N stories genuinely in flight at that instant the
// logs can't say which one a message served, so the cost is split evenly across the matches and
// the ambiguous share is tracked so the report can flag it.
const { dirs, folders: transcriptFolders } = discoverTranscriptDirs(PROJECT_ROOT, TRANSCRIPTS);
const { records, sawSubagents, sawEstimatedPricing } = gatherUsageRecords(dirs, EXCLUDE);
let overheadCost = 0, overheadTokens = 0, totalCost = 0, ambiguousCost = 0;
for (const record of records) {
  totalCost += record.cost;
  const hits = stories.filter(story => record.ts >= story.start && record.ts < story.end);
  if (!hits.length) { overheadCost += record.cost; overheadTokens += record.tokens; continue; }
  if (hits.length > 1) ambiguousCost += record.cost;
  for (const story of hits) { story.cost += record.cost / hits.length; story.tokens += record.tokens / hits.length; story.calls++; }
}
// Which stories ran concurrently with a story from a DIFFERENT epic — the case that makes a
// per-feature figure soft, as opposed to two stories of the same epic overlapping.
for (const story of stories) {
  story.parallel = stories.some(other => other !== story && other.epic !== story.epic && other.start < story.end && story.start < other.end);
}
// Completeness is coverage-based, not "does a subagents dir exist": per-story cost is only
// trustworthy if MOST stories actually got token records bucketed into them. A build whose
// sub-agent transcripts weren't captured (old log format) leaves nearly every story at $0,
// even if some unrelated session in the store has a subagents dir. Below the threshold we
// render time-only rather than publish wrong dollar figures.
const COST_COVERAGE_MIN = 0.6;
const storiesWithCost = stories.filter(story => story.cost > 0).length;
const costCoverage = stories.length ? storiesWithCost / stories.length : 0;
const costComplete = sawSubagents && dirs.length > 0 && costCoverage >= COST_COVERAGE_MIN;
const inStoryCost = stories.reduce((total, story) => total + story.cost, 0);

// ---- aggregate per category ----
const median = values => { const sorted = [...values].sort((left, right) => left - right); const middle = sorted.length >> 1; return sorted.length ? (sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2) : 0; };
const mean = values => values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
const sum = values => values.reduce((total, value) => total + value, 0);

// ---- the two uplift factors that turn measured story figures into whole-feature figures ----
//
// Only ~⅓ of a build's spend lands inside story windows; the rest is scaffolding that a feature
// still causes (PLAN, epic-end E2E + fix cycles, PR/merge) or shares (INTAKE, epic decomposition).
// Ground truth can't split that per epic — in a single-session build the overhead messages sit
// between story windows with nothing tying them to one epic, and epics built in parallel
// worktrees overlap in time. So it is allocated pro-rata to measured story cost, which is the
// honest, stated approximation: bigger epics pull more scaffolding.
//
//   costUplift = total spend / in-story spend      -> marginal cost x costUplift = fully loaded
//   timeUplift = summed epic elapsed / summed story minutes
//                (measures the gaps BETWEEN stories inside an epic; PLAN and epic-end aren't
//                 timestamped, so this is a floor on elapsed time, not the whole calendar cost)
const costUplift = inStoryCost > 0 ? totalCost / inStoryCost : 0;

const categoryOrder = ['Listing / table page', 'Record action', 'Upload / create form', 'Detail / summary view', 'Export', 'Auth / app-shell / infra', 'Other'];
const storiesByCategory = {};
for (const story of stories) (storiesByCategory[story.cat] ||= []).push(story);
const categories = categoryOrder.filter(category => storiesByCategory[category]).map(category => {
  const categoryStories = storiesByCategory[category];
  const medianCost = median(categoryStories.map(story => story.cost));
  return {
    cat: category, short: SHORT_BY_CATEGORY[category], n: categoryStories.length,
    medMin: median(categoryStories.map(story => story.min)), meanMin: mean(categoryStories.map(story => story.min)),
    medCost: medianCost, medLoadedCost: medianCost * costUplift, medTokens: median(categoryStories.map(story => story.tokens)),
  };
});

// ---- roll up to the feature (epic) level ----
// An epic IS the feature in this workflow, so this is the level a new feature gets estimated at.
const byEpic = new Map();
for (const story of stories) {
  let epic = byEpic.get(story.epic);
  if (!epic) byEpic.set(story.epic, epic = { slug: story.epic, name: story.epicName, rows: [], mix: {} });
  epic.rows.push(story);
  epic.mix[story.cat] = (epic.mix[story.cat] || 0) + 1;
}
const epics = [...byEpic.values()].map(epic => {
  const start = Math.min(...epic.rows.map(story => story.start)), end = Math.max(...epic.rows.map(story => story.end));
  const marginalCost = sum(epic.rows.map(story => story.cost));
  // An epic lands here on the strength of ONE timed story, so `stories` (timed) can be a
  // fraction of `storiesTotal` (declared) — mid-build, or on a project whose older stories
  // predate the timestamps. `timeComplete` is what lets the page tell a measurement from an
  // undercount: every figure below is summed over timed stories only.
  const storiesTotal = epicStoryTotals.get(epic.slug) ?? epic.rows.length;
  return {
    slug: epic.slug, name: epic.name, stories: epic.rows.length,
    storiesTotal, timeComplete: epic.rows.length >= storiesTotal,
    mix: categoryOrder.filter(category => epic.mix[category]).map(category => ({ cat: category, short: SHORT_BY_CATEGORY[category], n: epic.mix[category] })),
    buildMinutes: sum(epic.rows.map(story => story.min)), medStoryMin: median(epic.rows.map(story => story.min)),
    elapsedMinutes: (end - start) / 60000, start, end,
    tokens: sum(epic.rows.map(story => story.tokens)),
    marginalCost, loadedCost: marginalCost * costUplift,
    parallel: epic.rows.some(story => story.parallel),
  };
}).sort((left, right) => left.start - right.start);
const timeUplift = sum(epics.map(epic => epic.buildMinutes)) > 0
  ? sum(epics.map(epic => epic.elapsedMinutes)) / sum(epics.map(epic => epic.buildMinutes)) : 1;

// Benchmark figures for sizing a NEW feature: the per-type medians above, plus what a typical
// epic in this project looked like as a top-down sanity check on any bottom-up estimate.
//
// Only FULLY timed epics qualify. A partially timed epic's buildMinutes/marginalCost cover a
// subset of its stories, so folding it in drags the "typical feature" median below any real
// feature — and that median is what the sizing calculator quotes. Mid-build there may be no
// complete epic at all, in which case a rough benchmark beats none, and `epicsMeasured` tells
// the page how many features the figure actually rests on.
const timedEpics = epics.filter(epic => epic.timeComplete);
const benchmarkEpics = timedEpics.length ? timedEpics : epics;
const benchmarks = {
  costUplift, timeUplift,
  epicsMeasured: benchmarkEpics.length,
  partialEpics: epics.length - timedEpics.length,
  typicalEpic: {
    // Rounded: a story COUNT, and an even number of epics makes the raw median a half —
    // "3.5 stories" is not a benchmark anyone can size against.
    stories: Math.round(median(benchmarkEpics.map(epic => epic.storiesTotal))),
    buildMinutes: median(benchmarkEpics.map(epic => epic.buildMinutes)),
    elapsedMinutes: median(benchmarkEpics.map(epic => epic.elapsedMinutes)),
    marginalCost: median(benchmarkEpics.map(epic => epic.marginalCost)),
    loadedCost: median(benchmarkEpics.map(epic => epic.loadedCost)),
  },
};

const result = {
  generatedAt: new Date().toISOString(),
  project: PROJECT_ROOT,
  projectName: (() => { try { const heading = fs.readFileSync(path.join(PROJECT_ROOT, 'generated-docs', 'project.md'), 'utf8').split('\n').find(line => /^#\s+/.test(line)); return heading ? heading.replace(/^#\s+/, '').trim() : ''; } catch { return ''; } })(),
  costComplete, rate: RATE,
  // Session ids dropped because the cost generator flagged them as post-delivery reporting runs.
  // Recorded so the maintainer page's totals can be shown to rest on the same inclusion rule as
  // its Cost & user involvement panel.
  postDeliveryExcluded,
  transcriptFolders,
  totals: {
    stories: stories.length,
    epics: epics.length,
    buildMinutes: stories.reduce((total, story) => total + story.min, 0),
    medMinutes: median(stories.map(story => story.min)),
    inStoryCost, overheadCost, totalCost,
    overheadShare: totalCost ? overheadCost / totalCost : 0,
    fullyLoadedPerStory: stories.length ? totalCost / stories.length : 0,
    fullyLoadedPerEpic: epics.length ? totalCost / epics.length : 0,
    medCost: median(stories.map(story => story.cost)),
  },
  attribution: {
    ambiguousCost,
    ambiguousShare: inStoryCost ? ambiguousCost / inStoryCost : 0,
    parallelEpics: epics.filter(epic => epic.parallel).map(epic => epic.slug),
  },
  benchmarks,
  categories,
  epics,
  stories: stories.map(story => ({ epic: story.epic, n: story.n, title: story.title, cat: story.cat, min: story.min, tokens: story.tokens, cost: story.cost })),
  // Non-empty means a model wasn't in the pricing table and was costed at Opus-tier rates, so the
  // dollar figures are estimates. The report banners this rather than presenting them as exact.
  unknownModels: [...unknownModels],
  pricingEstimated: !!sawEstimatedPricing,
};

const reportsDir = path.join(PROJECT_ROOT, 'generated-docs', 'reports');
fs.mkdirSync(reportsDir, { recursive: true });
fs.writeFileSync(path.join(reportsDir, 'build-effort-data.json'), JSON.stringify(result, null, 2));

// ---- console summary ----
console.log(JSON.stringify({
  stories: result.totals.stories,
  epics: result.totals.epics,
  medMinutesPerStory: +result.totals.medMinutes.toFixed(1),
  costComplete,
  transcriptFolders: result.transcriptFolders,
  totalCostUsd: +totalCost.toFixed(2),
  inStoryCostUsd: +inStoryCost.toFixed(2),
  overheadSharePct: +(result.totals.overheadShare * 100).toFixed(0),
  fullyLoadedPerStoryUsd: +result.totals.fullyLoadedPerStory.toFixed(2),
  costUplift: +costUplift.toFixed(2),
  timeUplift: +timeUplift.toFixed(2),
  postDeliverySessionsExcluded: postDeliveryExcluded,
  ambiguousSharePct: +(result.attribution.ambiguousShare * 100).toFixed(0),
  parallelEpics: result.attribution.parallelEpics,
  typicalEpic: `${benchmarks.typicalEpic.stories} stories / ${benchmarks.typicalEpic.buildMinutes.toFixed(0)}min build${costComplete ? ' / $' + benchmarks.typicalEpic.loadedCost.toFixed(2) + ' loaded' : ''}`,
  byType: categories.map(category => `${category.cat}: ${category.medMin.toFixed(0)}min${costComplete ? ' / $' + category.medCost.toFixed(2) + ' marginal / $' + category.medLoadedCost.toFixed(2) + ' loaded' : ''} (n=${category.n})`),
  byEpic: epics.map(epic => `${epic.slug}: ${epic.stories} stories / ${epic.buildMinutes.toFixed(0)}min build / ${epic.elapsedMinutes.toFixed(0)}min elapsed${costComplete ? ' / $' + epic.marginalCost.toFixed(2) + ' marginal / $' + epic.loadedCost.toFixed(2) + ' loaded' : ''}`),
  unknownModels: result.unknownModels,
}, null, 1));
if (!costComplete) console.warn('WARNING: no sub-agent transcripts found — token cost is INCOMPLETE; report shows build time only.');
// Overlap is reported whatever its source, but the CAUSE differs and only the cross-epic case
// softens a per-feature figure — so never name parallel features when there are none to name.
if (result.attribution.ambiguousShare > 0.05) console.warn(`NOTE: ${(result.attribution.ambiguousShare * 100).toFixed(0)}% of story spend fell inside overlapping story windows (${result.attribution.parallelEpics.length ? `features built in parallel: ${result.attribution.parallelEpics.join(', ')}` : 'all within a single feature'}) — split evenly across the stories in flight, so per-feature splits are approximate.`);
if (unknownModels.size) console.warn('WARNING: unknown models priced as Opus 4.8 — add them to PRICING in report-core.mjs: ' + [...unknownModels].join(', '));
console.log('written generated-docs/reports/build-effort-data.json');

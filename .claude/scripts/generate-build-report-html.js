#!/usr/bin/env node
/**
 * generate-build-report-html.js
 *
 * Renders the /build-report-maintainer and /build-report-stakeholders pages as a single self-contained, interactive
 * HTML page (no external assets — opens straight from disk via file://). Data comes
 * from collect-build-report-data.js; presentation matches the dark dashboard theme.
 *
 * Two layers, kept deliberately separate:
 *   • Metrics, timeline, per-epic effort, stumbling blocks — DETERMINISTIC, straight
 *     from the collector, so the numbers read the same every run.
 *   • An optional "What this means" insight panel — narrative the orchestrator writes
 *     by following the brief in the report's own skill file.
 *     Picked up automatically from generated-docs/reports/build-report-insights.md when present.
 *
 * Every output — both pages, their insight files, the sign-off log and the data JSON —
 * lives under generated-docs/reports/ alongside the build-cost-data.json and
 * build-effort-data.json this script consumes, so all generated reports sit in one folder.
 *
 * The maintainer page also renders the EFFORT benchmarks (per-screen-type medians, per-feature
 * roll-up, sizing calculator) that used to be a standalone /build-report-effort page. That
 * generator is now data-only; run it before this script or the section is simply absent.
 *
 * Usage:
 *   node .claude/scripts/generate-build-report-html.js [--collect] [--root <dir>]
 *   node .claude/scripts/generate-build-report-html.js --audience stakeholders  # delivery report variant
 *   node .claude/scripts/generate-build-report-html.js --insights <file>   # override insight source
 *   node .claude/scripts/generate-build-report-html.js --no-insights       # metrics only
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { collect, formatDuration, FIX_COMMIT_PATTERN } = require('./collect-build-report-data');
const { getProjectRoot } = require('./lib/project-root');
const { REPORTS_DIR } = require('./resolve-state-path'); // layout SSOT — derive output paths from it so they can't drift
const { escapeHtml } = require('./lib/html-escape');

const OUT_JSON = path.posix.join(REPORTS_DIR, 'build-report-data.json');

// Each audience gets its own page composition and its own output file — the collected data is
// shared. The brief that shapes each insight panel lives in that report's skill file.
//   maintainer   — the full benchmark: performance ratios, churn, timeline,
//                  stumbling blocks. The default.
//   stakeholders — a delivery report for non-technical readers: what shipped,
//                  the quality evidence, what's still to come. No internals.
const AUDIENCES = {
  maintainer: {
    html: path.posix.join(REPORTS_DIR, 'build-report.html'),
    insights: path.posix.join(REPORTS_DIR, 'build-report-insights.md')
  },
  stakeholders: {
    html: path.posix.join(REPORTS_DIR, 'build-report-stakeholders.html'),
    insights: path.posix.join(REPORTS_DIR, 'build-report-insights-stakeholders.md'),
    // The sign-off log: the product decisions the user was asked for, curated out of the verbatim
    // decision log in the cost generator's data file. Authored (like the insight panel) because
    // separating a product choice from workflow machinery is judgement, not pattern-matching.
    decisions: path.posix.join(REPORTS_DIR, 'build-report-decisions.json')
  }
};

function parseArgs(argv) {
  const args = { root: getProjectRoot(), insights: undefined, noInsights: false, audience: 'maintainer' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root') args.root = path.resolve(argv[++i]);
    else if (arg === '--insights') args.insights = argv[++i];
    else if (arg === '--no-insights') args.noInsights = true;
    else if (arg === '--audience') args.audience = argv[++i];
    else if (arg.startsWith('--audience=')) args.audience = arg.split('=')[1];
    // --collect is implicit (this script always collects); accepted for parity with /dashboard.
  }
  return args;
}

// Minimal, SAFE markdown → HTML for journal + insight prose. Escapes first, then
// applies a small whitelist (## headings, - bullets, **bold**, `code`, blank-line
// paragraphs). No raw HTML from the source ever reaches the page.
function markdownToHtml(markdown) {
  if (!markdown) return '';
  const inline = (text) => escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  const out = [];
  let inList = false;
  let paragraphLines = []; // buffer consecutive plain lines so a hard-wrapped paragraph (and any
                           // **bold** or `code` that straddles a line break) renders as one <p>.
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  const flushParagraph = () => { if (paragraphLines.length) { out.push(`<p>${inline(paragraphLines.join(' '))}</p>`); paragraphLines = []; } };
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    let match;
    if ((match = line.match(/^#{1,6}\s+(.+)/))) { flushParagraph(); closeList(); out.push(`<h5>${inline(match[1])}</h5>`); }
    else if ((match = line.match(/^[-*]\s+(.+)/))) { flushParagraph(); if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${inline(match[1])}</li>`); }
    else if (line.trim() === '') { flushParagraph(); closeList(); }
    else { closeList(); paragraphLines.push(line.trim()); }
  }
  flushParagraph();
  closeList();
  return out.join('\n');
}

function formatDate(iso) { return iso ? iso.slice(0, 10) : ''; }
function formatTime(iso) { return iso ? iso.slice(11, 16) : ''; }
function formatNumber(value) { return Number(value ?? 0).toLocaleString('en-US'); }
function formatDurationMs(durationMs) {
  const minutes = Math.round((durationMs || 0) / 60000);
  if (minutes < 1) return '<1m';
  return formatDuration(minutes);
}
// Answer latencies sit in the seconds-to-minutes range, where formatDurationMs's "<1m" throws the detail away.
function formatSpanMs(durationMs) {
  const seconds = Math.round((durationMs || 0) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) { const minutes = Math.floor(seconds / 60); const remainderSeconds = seconds % 60; return remainderSeconds ? `${minutes}m ${remainderSeconds}s` : `${minutes}m`; }
  return formatDurationMs(durationMs);
}
function formatTokens(tokenCount) {
  if (tokenCount == null) return '—';
  if (tokenCount < 1e3) return String(tokenCount);
  if (tokenCount < 1e6) return `${Math.round(tokenCount / 1e3)}k`;
  return `${(tokenCount / 1e6).toFixed(1)}M`;
}
// The ONE rand formatter. Every section that shows ZAR goes through it, so the same build can't
// be quoted as "R1,800.00" in one panel and "R1,800" in the next; whole rand throughout, since
// these are estimates and the cents were never meaningful. Null when there is no rate to convert
// with — callers fall back to USD rather than printing a bare "R".
function formatZar(usd, rate) {
  return rate != null && usd != null
    ? `R${(usd * rate).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    : null;
}

// ── Cards ────────────────────────────────────────────────────────────────────
function statCard(value, label, subtitle) {
  return `<div class="stat"><div class="stat-v">${escapeHtml(value)}</div><div class="stat-l">${escapeHtml(label)}</div>${subtitle ? `<div class="stat-s">${escapeHtml(subtitle)}</div>` : ''}</div>`;
}

// ── Timeline: sessions grouped by day, bars scaled to the busiest session ─────
function renderTimeline(timeline) {
  if (!timeline.sessions.length) return '<p class="muted">No commits yet.</p>';
  const maxDurationMin = Math.max(1, ...timeline.sessions.map((session) => session.durationMin));
  const byDay = new Map();
  for (const session of timeline.sessions) {
    if (!byDay.has(session.day)) byDay.set(session.day, []);
    byDay.get(session.day).push(session);
  }
  const rows = [];
  for (const [day, sessions] of byDay) {
    const dayMinutes = sessions.reduce((total, session) => total + session.durationMin, 0);
    const chips = sessions.map((session, i) => {
      const widthPct = Math.max(3, Math.round((session.durationMin / maxDurationMin) * 100));
      const fixes = session.commits.filter((commit) => FIX_COMMIT_PATTERN.test(commit.subject)).length; // same predicate as the fix/rework tiles
      const commitsList = session.commits.map((commit) =>
        `<li><span class="c-time">${formatTime(commit.date)}</span> ${escapeHtml(commit.subject)}</li>`).join('');
      return `<div class="sess">
          <div class="sess-head" onclick="this.parentNode.classList.toggle('open')">
            <span class="sess-time">${formatTime(session.start)}–${formatTime(session.end)}</span>
            <span class="bar"><span class="bar-fill${fixes ? ' has-fix' : ''}" style="width:${widthPct}%"></span></span>
            <span class="sess-meta">${session.durationMin ? formatDuration(session.durationMin) : '·'} · ${session.commitCount} commit${session.commitCount === 1 ? '' : 's'}${fixes ? ` · ${fixes} fix` : ''}</span>
          </div>
          <ul class="commits">${commitsList}</ul>
        </div>`;
    }).join('');
    rows.push(`<div class="day"><div class="day-label">${escapeHtml(day)}<span class="day-sum">${formatDuration(dayMinutes)}</span></div><div class="day-sessions">${chips}</div></div>`);
  }
  return rows.join('');
}

// ── Build flow: story swimlanes per day — what ran in parallel ────────────────
// One lane per epic, one bar per story (startedAt → completedAt), day-segmented
// like the Timeline so idle nights don't crush the axis. Hatched shoulders are
// the derived phases around the stories (plan/test-gen before, epic-end checks
// after); the in-flight strip counts concurrent stories. Lane colors are fixed
// categorical slots (--flow-1..8, CVD-validated for this surface); lanes are
// also direct-labeled, so identity never rides on color alone.
function renderBuildFlow(data) {
  const epics = (data.epics || []).filter((epic) => epic.flow && epic.flow.stories.length);
  const buildFlow = data.buildFlow;
  if (!buildFlow || !epics.length) {
    return '<p class="muted">No story timing recorded yet — story start/finish times appear here as epics are built.</p>';
  }

  // Order lanes by first story start; color follows the epic, never the day.
  const ordered = epics.slice().sort((firstEpic, secondEpic) => Date.parse(firstEpic.flow.stories[0].startedAt) - Date.parse(secondEpic.flow.stories[0].startedAt));
  const colorOf = new Map(ordered.map((epic, i) => [epic.slug, (i % 8) + 1]));

  // Collect every drawable segment, grouped by the day its story ran.
  const days = new Map(); // day → { lanes: Map(slug → segments[]), intervals: [[ms,ms]] }
  const dayOf = (iso) => String(iso).slice(0, 10);
  const getDayBucket = (dayKey) => { if (!days.has(dayKey)) days.set(dayKey, { lanes: new Map(), intervals: [] }); return days.get(dayKey); };
  const pushSegment = (dayBucket, slug, segment) => { if (!dayBucket.lanes.has(slug)) dayBucket.lanes.set(slug, []); dayBucket.lanes.get(slug).push(segment); };
  for (const epic of ordered) {
    const firstStory = epic.flow.stories[0];
    if (epic.createdAt && dayOf(epic.createdAt) === dayOf(firstStory.startedAt) && Date.parse(firstStory.startedAt) - Date.parse(epic.createdAt) > 60e3) {
      pushSegment(getDayBucket(dayOf(firstStory.startedAt)), epic.slug, { kind: 'lead', start: Date.parse(epic.createdAt), end: Date.parse(firstStory.startedAt) });
    }
    for (const story of epic.flow.stories) {
      const dayBucket = getDayBucket(dayOf(story.startedAt));
      pushSegment(dayBucket, epic.slug, { kind: 'story', start: Date.parse(story.startedAt), end: Date.parse(story.completedAt), story });
      dayBucket.intervals.push([Date.parse(story.startedAt), Date.parse(story.completedAt)]);
    }
    const lastStory = epic.flow.stories[epic.flow.stories.length - 1];
    if (epic.flow.wrapUp && Date.parse(epic.flow.wrapUp.endedAt) - Date.parse(lastStory.completedAt) > 60e3) {
      pushSegment(getDayBucket(dayOf(lastStory.completedAt)), epic.slug, { kind: 'wrap', start: Date.parse(lastStory.completedAt), end: Date.parse(epic.flow.wrapUp.endedAt), commits: epic.flow.wrapUp.commits });
    }
  }

  const utcHourMinute = (epochMs) => new Date(epochMs).toISOString().slice(11, 16);
  const nameOf = (slug) => ordered.find((epic) => epic.slug === slug).name;

  const rows = [...days.entries()].sort(([firstDay], [secondDay]) => firstDay.localeCompare(secondDay)).map(([day, dayBucket]) => {
    const times = [...dayBucket.lanes.values()].flat().flatMap((segment) => [segment.start, segment.end]);
    const paddingMs = 5 * 60e3;
    const axisStartMs = Math.min(...times) - paddingMs, axisEndMs = Math.max(...times) + paddingMs;
    const percentAt = (timeMs) => ((timeMs - axisStartMs) / (axisEndMs - axisStartMs)) * 100;

    let ticks = '';
    for (let hourMs = Math.ceil(axisStartMs / 36e5) * 36e5; hourMs < axisEndMs; hourMs += 36e5) {
      ticks += `<span class="ftick" style="left:${percentAt(hourMs).toFixed(2)}%"><i></i>${utcHourMinute(hourMs)}</span>`;
    }

    const lanes = [...dayBucket.lanes.entries()]
      .sort(([, firstSegments], [, secondSegments]) => Math.min(...firstSegments.map((segment) => segment.start)) - Math.min(...secondSegments.map((segment) => segment.start)))
      .map(([slug, segments]) => {
        const colorIndex = colorOf.get(slug);
        const chips = segments.map((segment) => {
          const widthPct = Math.max(0.6, percentAt(segment.end) - percentAt(segment.start));
          const range = `${utcHourMinute(segment.start)}–${utcHourMinute(segment.end)} UTC · ${formatDuration(Math.round((segment.end - segment.start) / 60e3))}`;
          if (segment.kind === 'story') {
            const story = segment.story;
            const tip = `<strong>Story ${story.n}${story.title ? ` — ${escapeHtml(story.title)}` : ''}</strong><br>${escapeHtml(nameOf(slug))}<br>${range}<br>E2E: ${escapeHtml(story.e2eStatus || '—')} · commit ${escapeHtml(story.commit || '—')}`;
            const storyLabel = widthPct >= 3 ? `<em>S${story.n}</em>` : '';
            return `<span class="fbar fc-${colorIndex}" data-tip="${escapeHtml(tip)}" style="left:${percentAt(segment.start).toFixed(2)}%;width:${widthPct.toFixed(2)}%">${storyLabel}</span>`;
          }
          const phaseLabel = segment.kind === 'lead'
            ? 'Plan &amp; test generation'
            : `Epic-end review, E2E &amp; manual test (${segment.commits} commit${segment.commits === 1 ? '' : 's'})`;
          const tip = `<strong>${phaseLabel}</strong><br>${escapeHtml(nameOf(slug))}<br>${range}`;
          return `<span class="fshoulder fc-${colorIndex}" data-tip="${escapeHtml(tip)}" style="left:${percentAt(segment.start).toFixed(2)}%;width:${widthPct.toFixed(2)}%"></span>`;
        }).join('');
        return `<div class="flane"><div class="flane-label"><span class="swatch fc-${colorIndex}"></span>${escapeHtml(nameOf(slug))}</div><div class="ftrack">${chips}</div></div>`;
      }).join('');

    // In-flight strip: sweep the day's story intervals (ends before starts, so
    // back-to-back stories don't register as overlap).
    const events = [];
    for (const [startMs, endMs] of dayBucket.intervals) events.push([startMs, 1], [endMs, -1]);
    events.sort((firstEvent, secondEvent) => firstEvent[0] - secondEvent[0] || firstEvent[1] - secondEvent[1]);
    let inFlight = 0, previousMs = null, steps = '';
    for (const [timeMs, delta] of events) {
      if (previousMs !== null && inFlight > 0 && timeMs > previousMs) {
        steps += `<span class="fstep" data-tip="<strong>${inFlight} ${inFlight === 1 ? 'story' : 'stories'} in flight</strong><br>${utcHourMinute(previousMs)}–${utcHourMinute(timeMs)} UTC" style="left:${percentAt(previousMs).toFixed(2)}%;width:${(percentAt(timeMs) - percentAt(previousMs)).toFixed(2)}%;height:${inFlight * 5}px"></span>`;
      }
      inFlight += delta; previousMs = timeMs;
    }

    const dayMinutes = Math.round(dayBucket.intervals.reduce((total, [startMs, endMs]) => total + (endMs - startMs) / 60e3, 0));
    return `<div class="day"><div class="day-label">${escapeHtml(day)}<span class="day-sum">${formatDuration(dayMinutes)} of story work</span></div>
      <div class="fflow"><div class="fticks">${ticks}</div>${lanes}
      <div class="flane fconc"><div class="flane-label muted">in flight</div><div class="ftrack fconc-track">${steps}</div></div></div></div>`;
  }).join('');

  const stats = `<div class="stats tight">
    ${statCard(formatDuration(buildFlow.storyMinutes), 'story work completed', 'sum of story durations')}
    ${statCard(formatDuration(buildFlow.wallClockMinutes), 'wall-clock on stories', 'union of story windows')}
    ${statCard(`${buildFlow.parallelism}×`, 'parallelism', 'story work ÷ wall-clock')}
    ${statCard(String(buildFlow.peakInFlight), 'peak stories in flight', `${buildFlow.overlapPct}% of story time ≥ 2 in flight`)}
  </div>`;

  const table = `<details><summary>Table view</summary>
    <table class="ftable"><thead><tr><th>Epic</th><th>#</th><th>Story</th><th>Day</th><th>Started</th><th>Finished</th><th>Duration</th><th>E2E</th></tr></thead>
    <tbody>${ordered.flatMap((epic) => epic.flow.stories.map((story) =>
      `<tr><td><span class="swatch fc-${colorOf.get(epic.slug)}"></span>${escapeHtml(epic.name)}</td><td>S${story.n}</td><td>${escapeHtml(story.title || '—')}</td><td>${escapeHtml(dayOf(story.startedAt))}</td><td>${formatTime(story.startedAt)}</td><td>${formatTime(story.completedAt)}</td><td>${formatDuration(Math.round((Date.parse(story.completedAt) - Date.parse(story.startedAt)) / 60e3))}</td><td>${escapeHtml(story.e2eStatus || '—')}</td></tr>`)).join('')}
    </tbody></table></details>`;

  const legend = `<div class="legend">
    <span class="key"><span class="swatch fc-1"></span> solid bar = one story (S#), start → finish</span>
    <span class="key"><span class="fkey-hatch"></span> hatched = derived phases around the stories (plan/test-gen before, epic-end checks after)</span>
    <span class="key"><span class="fkey-step"></span> in-flight strip = concurrent stories</span>
  </div>`;

  // Tooltip layer: one fixed div fed by data-tip. Tip HTML is built from
  // escapeHtml()'d parts and the whole tip is escapeHtml()'d again into the attribute, so
  // getAttribute() decodes exactly one level — our tags render, story/epic
  // text stays inert.
  const script = `<div id="ftt"></div><script>
(function(){var tooltip=document.getElementById('ftt');
document.addEventListener('mousemove',function(event){
  var tipped=event.target.closest('[data-tip]');
  if(!tipped){tooltip.style.display='none';return}
  tooltip.innerHTML=tipped.getAttribute('data-tip');
  tooltip.style.display='block';
  tooltip.style.left=Math.min(event.clientX+14,innerWidth-tooltip.offsetWidth-8)+'px';
  tooltip.style.top=Math.min(event.clientY+14,innerHeight-tooltip.offsetHeight-8)+'px';
});})();
</script>`;

  return `${stats}${rows}${legend}${table}${script}`;
}

// ── Per-epic cards ───────────────────────────────────────────────────────────
function manualTestBadge(manualTest) {
  if (!manualTest || !manualTest.outcome) return '<span class="pill grey">not tested yet</span>';
  const outcome = String(manualTest.outcome).toLowerCase();
  const pillColor = /pass/.test(outcome) ? 'green' : /fail|mixed/.test(outcome) ? 'amber' : 'grey';
  const count = manualTest.total ? ` (${manualTest.passed}/${manualTest.total})` : '';
  return `<span class="pill ${pillColor}">manual test: ${escapeHtml(manualTest.outcome)}${count}</span>`;
}

function renderEpic(epic) {
  const shared = epic.sharedSessions ? '<span class="hint" title="Built interleaved with another epic; session time is shared, not exclusive.">shared time</span>' : '';
  const miniStat = (value, label) => `<div class="mini"><span class="mini-v">${escapeHtml(value)}</span><span class="mini-l">${escapeHtml(label)}</span></div>`;
  const dateWindow = epic.firstCommit
    ? `${formatDate(epic.firstCommit.date)}${formatDate(epic.lastCommit.date) !== formatDate(epic.firstCommit.date) ? ` → ${formatDate(epic.lastCommit.date)}` : ''}`
    : '—';
  return `<div class="epic ${epic.status}">
      <div class="epic-head" onclick="this.parentNode.classList.toggle('open')">
        <span class="epic-name">${escapeHtml(epic.name)}</span>
        <span class="epic-tags">${manualTestBadge(epic.manualTest)}${epic.fixCommitCount ? `<span class="pill amber">${epic.fixCommitCount} fix commit${epic.fixCommitCount === 1 ? '' : 's'}</span>` : ''}${shared}</span>
        <span class="chevron">▾</span>
      </div>
      <div class="epic-stats">
        ${miniStat(`${epic.stories.complete}/${epic.stories.total}`, 'stories')}
        ${miniStat(formatDuration(epic.sessionMinutes), 'active time')}
        ${miniStat(dateWindow, 'window')}
        ${miniStat(epic.commitCount, 'commits')}
        ${miniStat(epic.stories.withE2e ? `${epic.stories.firstPass}/${epic.stories.withE2e}` : '—', 'E2E first pass')}
        ${miniStat(`+${formatNumber(epic.linesAdded)} −${formatNumber(epic.linesDeleted)}`, 'lines changed')}
        ${miniStat(epic.unverifiedAssumptions, 'assumptions to verify')}
      </div>
      <div class="epic-body">
        ${epic.manualTest && epic.manualTest.note ? `<h5>Manual test</h5><div class="journal"><p>${escapeHtml(epic.manualTest.note)}</p></div>` : ''}
        <h5>Build journal</h5>
        <div class="journal">${epic.journal ? markdownToHtml(epic.journal) : '<p class="muted">No journal recorded.</p>'}</div>
      </div>
    </div>`;
}

// ── Workflow performance (maintainer benchmark) ──────────────────────────────
// A stacked proportion bar: segments [{label, value, cls}] with a 2px surface
// gap between fills; values live in the legend (text tokens), not on the marks.
function stackBar(segments, unit) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (!total) return '<p class="muted">Nothing to chart yet.</p>';
  const fills = segments.filter((segment) => segment.value > 0).map((segment) => {
    const percent = (100 * segment.value) / total;
    return `<span class="seg ${segment.cls}" style="flex-basis:${percent.toFixed(2)}%" title="${escapeHtml(segment.label)}: ${formatNumber(segment.value)} ${escapeHtml(unit)} (${Math.round(percent)}%)"></span>`;
  }).join('');
  const legend = segments.map((segment) =>
    `<span class="key"><span class="swatch ${segment.cls}"></span>${escapeHtml(segment.label)} — <strong>${formatNumber(segment.value)}</strong> ${escapeHtml(unit)} (${total ? Math.round((100 * segment.value) / total) : 0}%)</span>`).join('');
  return `<div class="hbar">${fills}</div><div class="legend">${legend}</div>`;
}

// One horizontal magnitude-bar row, shared by the "active time by epic" and
// "cost by phase / epic" charts. The caller passes already-escaped strings.
function magnitudeBarRow({ title, name, nameSuffix = '', widthPct, value }) {
  return `<div class="ebar" title="${title}">
        <span class="ebar-name">${name}${nameSuffix}</span>
        <span class="ebar-track"><span class="ebar-fill" style="width:${widthPct.toFixed(1)}%"></span><span class="ebar-v">${value}</span></span>
      </div>`;
}

// Horizontal magnitude bars, one per epic — single series, so no legend; the
// value rides the bar tip and the epic name is the row label.
// `onlyUnmeasured` marks the partial-coverage case: these are the epics the effort table can't
// measure end to end, shown beside it rather than instead of it, so the heading has to say which
// is which. "not fully timed" covers both no timestamps at all and a subset of stories timed —
// naming only the first would be false for an in-flight epic, which has timestamps but no
// completed window for the story still running.
function epicTimeBars(epics, onlyUnmeasured = false) {
  const rows = epics.filter((epic) => epic.sessionMinutes > 0);
  if (!rows.length) return '';
  const maxMinutes = Math.max(...rows.map((epic) => epic.sessionMinutes));
  const note = onlyUnmeasured
    ? `<p class="muted" style="font-size:.82rem">Commit-clustered active time, for the epics whose stories aren't all timestamped — still building, or built before the workflow recorded story times. The Effort benchmarks section below measures the rest directly, story by story.</p>`
    : '';
  return `<h5 class="sub-h">Active time by epic${onlyUnmeasured ? ' — those not fully timed' : ''}</h5>${note}` + rows.map((epic) => {
    const fixNote = epic.fixCommitCount ? ` · ${epic.fixCommitCount} fix commit${epic.fixCommitCount === 1 ? '' : 's'}` : '';
    return magnitudeBarRow({
      title: `${escapeHtml(epic.name)}: ${formatDuration(epic.sessionMinutes)} active${epic.sharedSessions ? ' (shared with an interleaved epic)' : ''}${fixNote}`,
      name: escapeHtml(epic.name),
      nameSuffix: epic.sharedSessions ? '<span class="hint" title="Session time shared with an interleaved epic.">*</span>' : '',
      widthPct: Math.max(2, (100 * epic.sessionMinutes) / maxMinutes),
      value: formatDuration(epic.sessionMinutes)
    });
  }).join('');
}

function renderPerformance(data) {
  const performance = data.performance;
  if (!performance) return '';
  const firstPass = performance.e2eFirstPass;
  const tiles = [
    firstPass.total ? statCard(`${firstPass.pct}%`, 'first-pass E2E yield', `${firstPass.passed} of ${firstPass.total} stories passed with no fix cycle`) : '',
    performance.fixCommitSharePct != null ? statCard(`${performance.fixCommitSharePct}%`, 'commits were fixes', `${performance.reworkChurnPct ?? 0}% of changed lines were rework`) : '',
    performance.minutesPerStory != null ? statCard(`~${formatDuration(performance.minutesPerStory)}`, 'active time per story', `${performance.commitsPerStory} commits · ~${formatNumber(performance.sourceLocPerStory)} source lines each`) : '',
    performance.testToCodeRatio != null ? statCard(performance.testToCodeRatio, 'test-to-code ratio', 'test lines per source line') : '',
    performance.manualChecks ? statCard(`${performance.manualChecks.pct}%`, 'manual checks passed', `${performance.manualChecks.passed}/${performance.manualChecks.total} human-verified checks`) : '',
    statCard(performance.assumptionsOpen, 'assumptions to verify', 'flagged by the workflow, not yet confirmed')
  ].filter(Boolean).join('');
  const yieldBar = firstPass.total ? `<h5 class="sub-h">Story E2E outcomes</h5>${stackBar([
    { label: 'Passed first time', value: firstPass.passed, cls: 'sg-green' },
    { label: 'Needed a fix cycle', value: firstPass.total - firstPass.passed, cls: 'sg-amber' }
  ], 'stories')}` : '';
  // Per-epic time was shown here as commit-clustered "active time" AND again in the effort
  // section as timestamp-derived build time — same label, two methods, two different numbers.
  // The story timestamps are the better measurement (they bound the actual BUILD window rather
  // than inferring it from commit spacing), so the effort table owns per-epic time for every
  // epic it FULLY measures. Coverage is per-STORY, not per-epic: one timed story is enough to
  // put an epic in the effort data, so keying off mere presence dropped the bar for epics whose
  // effort figure covers a fraction of their stories — an in-flight epic, or one whose older
  // stories predate the timestamps — erasing most of their time from the page. `timeComplete`
  // is the fraction made explicit. Absent on older effort files: treat as complete, which is
  // the behaviour those files were rendered with.
  const measuredSlugs = new Set(((data.effort && data.effort.epics) || [])
    .filter((effortEpic) => effortEpic.timeComplete !== false).map((effortEpic) => effortEpic.slug));
  // No effort data => empty set => every epic keeps its bar, and `epicTimeBars` returns '' for
  // an empty list, so this one call covers all three cases.
  const perEpicTime = epicTimeBars((data.epics || []).filter((epic) => !measuredSlugs.has(epic.slug)), !!data.effort);
  return `<section class="panel">
      <h2>Workflow performance <span class="muted" style="font-size:.8rem;font-weight:400">— how efficiently the build ran</span></h2>
      <div class="stats tight">${tiles}</div>
      ${yieldBar}
      ${perEpicTime}
    </section>`;
}

// ── Cost & user involvement (exact transcript-derived figures) ───────────────
// Everything in this panel comes from build-cost-data.json — exact token/
// cost/user-input counts and anchored waiting-on-user durations. When the file
// hasn't been generated the panel is skipped (the Data quality section says so).
function renderCostEffort(costEffort) {
  if (!costEffort) return '';
  const zar = (amountUsd) => formatZar(amountUsd, costEffort.usdToZar);
  const usd = (amountUsd) => (amountUsd != null ? `$${amountUsd.toFixed(2)}` : '—');
  // Default every field so a partial object from an older insights-data schema can't
  // surface as a literal "NaN"/"undefined" in a tile.
  const userInputs = costEffort.userInputs ? { typed: 0, commands: 0, manualTest: 0, interruptions: 0, ...costEffort.userInputs } : null;
  const userInputTotal = userInputs ? userInputs.typed + userInputs.commands + userInputs.manualTest + userInputs.interruptions : null;
  const waits = costEffort.waits ? { approvalMs: 0, approvalCount: 0, generalMs: 0, generalCount: 0, stallMs: 0, stallCount: 0, ...costEffort.waits } : null;
  const waitMs = waits ? waits.approvalMs + waits.generalMs : null;
  const answerStats = costEffort.answerStats || null; // { medianMs, maxMs, samples } — absent on older cost-data files
  const tiles = [
    costEffort.costUsd != null ? statCard(zar(costEffort.costUsd) || usd(costEffort.costUsd), 'estimated AI cost', `${usd(costEffort.costUsd)} at API list prices · ${formatNumber(costEffort.apiCalls)} API calls`) : '',
    costEffort.totalTokens != null ? statCard(formatTokens(costEffort.totalTokens), 'tokens processed', `${formatTokens(costEffort.outputTokens)} generated`) : '',
    costEffort.cacheHit != null ? statCard(`${Math.round(costEffort.cacheHit * 100)}%`, 'cache hit rate', 'share of input served from cache') : '',
    costEffort.agentsSpawned != null ? statCard(formatNumber(costEffort.agentsSpawned), 'sub-agents spawned', `${formatNumber(costEffort.questionsAsked)} questions asked`) : '',
    userInputTotal != null ? statCard(formatNumber(userInputTotal), 'deliberate user inputs', `${userInputs.typed} typed · ${userInputs.commands} commands · ${userInputs.manualTest} manual-test · ${userInputs.interruptions} interrupts`) : '',
    waitMs != null ? statCard(formatDurationMs(waitMs), 'waiting on user', `${waits.approvalCount + waits.generalCount} waits${answerStats && answerStats.medianMs != null ? ` · typical answer ${formatSpanMs(answerStats.medianMs)}` : ''} · stalls (${formatDurationMs(waits.stallMs)} over ${waits.stallCount}) kept apart`) : '',
    costEffort.unattendedBuckets != null && costEffort.bucketCosts ? statCard(`${costEffort.unattendedBuckets} / ${costEffort.bucketCosts.length}`, 'phases run unattended', 'no decisions and no typed input at all') : ''
  ].filter(Boolean).join('');
  const costBars = (costEffort.bucketCosts || []).filter((bucket) => bucket.costUsd > 0);
  const maxCost = Math.max(1e-9, ...costBars.map((bucket) => bucket.costUsd));
  const bars = costBars.length ? `<h5 class="sub-h">Cost by phase / epic</h5>` + costBars.map((bucket) => {
    const costLabel = escapeHtml(zar(bucket.costUsd) || usd(bucket.costUsd));
    return magnitudeBarRow({
      title: `${escapeHtml(bucket.label)}: ${costLabel}`,
      name: escapeHtml(bucket.label),
      widthPct: Math.max(2, (100 * bucket.costUsd) / maxCost),
      value: costLabel
    });
  }).join('') : '';
  const postDeliveryNote = costEffort.postDelivery && costEffort.postDelivery.sessions
    ? `<p class="muted" style="font-size:.82rem">${costEffort.postDelivery.sessions} post-delivery reporting session(s) — report/dashboard generation — are excluded from these totals; they cost ${escapeHtml(zar(costEffort.postDelivery.costUsd) || usd(costEffort.postDelivery.costUsd))} on their own.</p>`
    : '';
  // This is the only place the page introduces rand, so it is the place to say when the rand is
  // guesswork. Without --rate the cost generator falls back to a fixed 18.00 placeholder and every
  // R figure on the page — here, in Spend detail and in the effort benchmarks — is built on it.
  // The retired standalone cost page disclosed this next to an editable rate box; dropping the
  // page dropped the disclosure with it, leaving a made-up rate presented as a measurement.
  const rateNote = costEffort.usdToZar != null && !costEffort.rateProvided
    ? `<p class="muted" style="font-size:.82rem"><strong>Rand figures use a placeholder rate</strong> of R${costEffort.usdToZar.toFixed(2)} per US$1 — no live rate was available when this report ran. The dollar figures are unaffected; re-run the report to pick up the current rate.</p>`
    : '';
  return `<section class="panel">
      <h2>Cost &amp; user involvement <span class="muted" style="font-size:.8rem;font-weight:400">— exact figures from the session logs</span></h2>
      <div class="stats tight">${tiles}</div>
      ${bars}
      ${postDeliveryNote}
      ${rateNote}
    </section>`;
}

// ── Spend detail (absorbed from the standalone /build-report-cost page) ───────
// Model mix, tool activity, sub-agent composition and the verbatim decision log. These were a
// separate page; they are a drill-down of the Cost & user involvement panel above, for the same
// reader, so they belong on the same page behind a <details> fold rather than behind a second
// command. Everything here is exact — read verbatim from the transcripts by the cost generator.
function renderSpendDetail(costEffort) {
  if (!costEffort) return '';
  const usd = (amountUsd) => `$${(amountUsd ?? 0).toFixed(2)}`;
  const zar = (amountUsd) => { const zarText = formatZar(amountUsd ?? 0, costEffort.usdToZar); return zarText ? ` · ${zarText}` : ''; };
  // Default the four collections the way renderCostEffort defaults its fields: a cost-data file
  // written by an older template version has none of them, and a missing key here would take the
  // whole page down rather than just hiding a table.
  const models = costEffort.models || [], tools = costEffort.tools || [], agents = costEffort.agents || [], decisions = costEffort.decisions || [];
  const unknown = costEffort.unknownModels || [];
  const blocks = [];

  if (models.length) {
    const estimateNote = costEffort.pricingEstimated
      ? `<p class="muted" style="font-size:.82rem"><strong>Some figures are estimates.</strong> ${escapeHtml(unknown.join(', '))} ${unknown.length === 1 ? 'is' : 'are'} not in the report's price list and ${unknown.length === 1 ? 'was' : 'were'} costed at Opus-tier rates.</p>`
      : '';
    blocks.push(`<h5 class="sub-h">Model mix — which model did the work, and what it cost</h5>
      ${estimateNote}
      <table class="ftable"><thead><tr><th>Model</th><th>API calls</th><th>Generated tokens</th><th>Cost</th></tr></thead>
      <tbody>${models.map((modelUsage) => `<tr>
          <td>${escapeHtml(modelUsage.model)}</td><td>${formatNumber(modelUsage.calls)}</td><td>${formatTokens(modelUsage.output)}</td><td>${usd(modelUsage.costUsd)}${zar(modelUsage.costUsd)}</td>
        </tr>`).join('')}</tbody></table>`);
  }

  if (tools.length) {
    // Floor of 1: an all-zero column would make the divisor 0 and every width NaN.
    const maxCalls = Math.max(1, ...tools.map((toolUsage) => toolUsage.calls));
    blocks.push(`<h5 class="sub-h">Tool activity — what Claude actually did, by call count</h5>
      ${tools.slice(0, 14).map((toolUsage) => magnitudeBarRow({
    title: `${escapeHtml(toolUsage.tool)}: ${formatNumber(toolUsage.calls)} calls`,
    name: escapeHtml(toolUsage.tool),
    widthPct: Math.max(2, (100 * toolUsage.calls) / maxCalls),
    value: formatNumber(toolUsage.calls)
  })).join('')}
      <p class="muted" style="font-size:.82rem">Every tool invocation across the orchestrator and all sub-agents. A high Edit-to-Write ratio means files were revisited a lot — a churn signal.</p>`);
  }

  if (agents.length) {
    blocks.push(`<h5 class="sub-h">Who ran the work — orchestrator vs. sub-agents</h5>
      <table class="ftable"><thead><tr><th>Agent</th><th>Times spawned</th><th>API calls</th><th>Cost</th></tr></thead>
      <tbody>${agents.map((agentUsage) => `<tr>
          <td>${escapeHtml(agentUsage.agent)}</td>
          <td>${agentUsage.instances == null ? '<span class="muted">main session</span>' : formatNumber(agentUsage.instances)}</td>
          <td>${formatNumber(agentUsage.calls)}</td><td>${usd(agentUsage.costUsd)}${zar(agentUsage.costUsd)}</td>
        </tr>`).join('')}</tbody></table>
      <p class="muted" style="font-size:.82rem">The orchestrator is the single continuous main session, so it has no spawn count.</p>`);
  }

  if (decisions.length) {
    const decisionRow = (decision) => {
      // Three distinct no-answer outcomes, kept apart: aborted/dismissed, never resolved, and
      // answered. Collapsing them would read as "the user declined", which is a different fact.
      const answer = decision.failed
        ? '<span class="muted">dialog dismissed</span>'
        : (!decision.resolved || decision.answer == null ? '<span class="muted">never answered</span>' : escapeHtml(decision.answer));
      const wait = !decision.first
        ? '<span class="muted">same dialog</span>'
        : (decision.waitMs == null ? '—' : `${formatSpanMs(decision.waitMs)}${decision.isStall ? ' <span class="muted">(stall)</span>' : ''}`);
      return `<tr><td>${escapeHtml(decision.header)}</td><td>${escapeHtml(decision.question)}</td><td>${answer}</td><td>${wait}</td></tr>`;
    };
    // One fold per phase rather than one flat table. A real build asks dozens of questions, and
    // an undivided list of all of them buries the phase a reader came looking for — the retired
    // standalone page grouped them with collapsible headers for the same reason. Insertion order
    // is the cost generator's bucket order, i.e. chronological, so don't sort.
    const byPhase = new Map();
    for (const decision of decisions) {
      if (!byPhase.has(decision.phase)) byPhase.set(decision.phase, []);
      byPhase.get(decision.phase).push(decision);
    }
    const groups = [...byPhase.entries()].map(([phase, phaseDecisions]) => `<details class="dgroup">
        <summary>${escapeHtml(phase)} <span class="muted">— ${formatNumber(phaseDecisions.length)} question${phaseDecisions.length === 1 ? '' : 's'}</span></summary>
        <table class="ftable"><thead><tr><th>Topic</th><th>Question</th><th>Your answer</th><th>Answer time</th></tr></thead>
        <tbody>${phaseDecisions.map(decisionRow).join('')}</tbody></table>
      </details>`).join('');
    blocks.push(`<h5 class="sub-h">Every decision, verbatim — what you were asked and what you chose</h5>
      ${groups}
      <p class="muted" style="font-size:.82rem">${formatNumber(decisions.length)} recorded questions across ${formatNumber(byPhase.size)} phase${byPhase.size === 1 ? '' : 's'}, each paired with the option chosen — open a phase to read them. Gaps over ${costEffort.stallThresholdMin ?? 10} minutes are marked as stalls and kept out of the typical-answer figure. Questions asked as plain prose aren't in this log — they appear as typed messages instead.</p>`);
  }

  if (!blocks.length) return '';
  // Folded shut: this is reference detail, not headline. The summary panel above carries the
  // numbers a reader needs first.
  return `<section class="panel">
      <details>
        <summary><h2 style="display:inline">Spend detail <span class="muted" style="font-size:.8rem;font-weight:400">— per model, per tool, per agent, and every decision (click to open)</span></h2></summary>
        ${blocks.join('\n')}
      </details>
    </section>`;
}

// ── Effort benchmarks & the sizing calculator (from build-effort-data.json) ───
// This was the standalone /build-report-effort page. It lives here as a section because it
// answers the same reader's next question — "so what will the NEXT feature cost?" — off inputs
// this page already carries. The generator that produced the data stays the source of the
// numbers; nothing is recomputed here.
//
// Three honesty rules the markup must keep:
//   - `costComplete: false` → render TIME ONLY. Without sub-agent transcripts a per-story
//     dollar figure would be fiction, so every cost column and the cost half of the calculator
//     drop out rather than showing a number the logs can't support.
//   - `pricingEstimated` → say so. A model that wasn't in the price list was costed at
//     Opus-tier rates, which makes every figure here approximate. The retired standalone page
//     bannered this; the same numbers on this page need the same caveat, and it can't live in
//     the collapsed Spend detail fold when these are the figures on open display.
//   - Fully-loaded cost is an ALLOCATION, not a measurement. Overhead (INTAKE, PLAN, epic-end,
//     PR) can't be tied to one feature from the logs, so it's spread pro-rata over measured
//     story spend. The label says so; don't quietly relabel it as measured.
//
// `epics` is the collector's git-derived epic list, used only to carry the per-epic fix-commit
// count and interleaved-epic marker onto the feature rows — those were on the "Active time by
// epic" bars this section replaces, and would otherwise be lost from the page.
function renderEffort(effort, epics = [], fallbackRate = null) {
  if (!effort) return '';
  const withCost = effort.costComplete;
  // readEffortSummary already defaults these, but this function is exported and takes the raw
  // effort shape, so it defends itself: `finiteOrZero` keeps the bare arithmetic below (.toFixed, /60,
  // ×100) from throwing inside the page template and losing the reader the entire report over
  // one absent key. Money and duration helpers already render null as an em dash.
  const finiteOrZero = (value) => (Number.isFinite(value) ? value : 0);
  const totals = effort.totals || {}, benchmarks = effort.benchmarks;
  const categories = Array.isArray(effort.categories) ? effort.categories : [];
  const effortEpics = Array.isArray(effort.epics) ? effort.epics : [];
  const usd = (amountUsd) => (amountUsd != null ? `$${amountUsd.toFixed(2)}` : '—');
  // ZAR is the currency the Cost & user involvement panel above leads with, so these figures
  // lead with it too — otherwise one page quotes two currencies for the same build, and the
  // sizing calculator (the number anyone actually quotes) is the one in the wrong one.
  // `fallbackRate` is the rate the cost data already carries. build-report-procedure.md asks for
  // the same --rate on both generators, but an instruction in a markdown file is not a guarantee:
  // miss it on the effort run and this section alone would drop to dollars. Falling back keeps the
  // page in one currency whatever the two generators were handed. When that rate is the cost
  // generator's 18.00 placeholder, the Cost & user involvement panel says so for the whole page.
  const rate = effort.rate ?? fallbackRate;
  const zar = (amountUsd) => formatZar(amountUsd, rate);
  const money = (amountUsd) => (amountUsd == null ? '—' : `${usd(amountUsd)}${zar(amountUsd) ? ` · ${zar(amountUsd)}` : ''}`);
  const formatMinutes = (minutes) => (minutes != null ? formatDuration(Math.round(minutes)) : '—');

  // `typicalEpic` is only usable for the story-count tile when the count is actually a number — that tile
  // interpolates it raw, so a missing key would render the word "undefined" as a headline figure.
  const typicalEpic = benchmarks && benchmarks.typicalEpic ? benchmarks.typicalEpic : null;
  // How many features the typical-feature medians rest on. The generator counts only fully timed
  // epics, so this can be smaller than the project's feature count; below two it is one feature's
  // figures wearing the word "typical", which the tile has to admit.
  const epicsMeasured = benchmarks && Number.isFinite(benchmarks.epicsMeasured) ? benchmarks.epicsMeasured : null;
  const typicalEpicNote = epicsMeasured != null && epicsMeasured < 2 ? ' · from one fully timed feature — indicative' : '';
  const tiles = [
    typicalEpic && Number.isFinite(typicalEpic.stories) ? statCard(`${typicalEpic.stories}`, 'stories in a typical feature', `median ${formatMinutes(typicalEpic.buildMinutes)} of measured build time${typicalEpicNote}`) : '',
    typicalEpic && withCost ? statCard(zar(typicalEpic.loadedCost) || usd(typicalEpic.loadedCost), 'typical feature cost', `fully loaded · ${money(typicalEpic.marginalCost)} measured inside stories`) : '',
    statCard(`${finiteOrZero(totals.medMinutes).toFixed(0)}m`, 'typical story', withCost ? `median ${money(totals.medCost)} measured cost` : 'median measured build time'),
    withCost && benchmarks ? statCard(`${finiteOrZero(benchmarks.costUplift).toFixed(1)}×`, 'overhead uplift', `${Math.round(finiteOrZero(totals.overheadShare) * 100)}% of spend falls outside story windows`) : statCard(`${(finiteOrZero(totals.buildMinutes) / 60).toFixed(1)}h`, 'total measured build time', `summed across ${finiteOrZero(totals.stories)} stories`)
  ].filter(Boolean).join('');

  // Per-screen-type medians — the rule of thumb the calculator multiplies.
  const categoryRows = categories.map((category) => `<tr>
        <td>${escapeHtml(category.cat)}${category.n <= 2 ? ` <span class="hint" title="Only ${category.n} measurement(s) — treat as indicative.">n=${category.n}</span>` : ''}</td>
        <td>${formatMinutes(category.medMin)}</td>
        ${withCost ? `<td>${formatTokens(category.medTokens)}</td><td>${money(category.medCost)}</td><td>${money(category.medLoadedCost)}</td>` : ''}
        <td>${category.n}</td>
      </tr>`).join('');

  const categoryTable = `<h5 class="sub-h">Rule of thumb by screen type</h5>
    <table class="ftable"><thead><tr>
      <th>Screen type</th><th>~ Time</th>${withCost ? '<th>~ Tokens</th><th>~ Measured</th><th>~ Fully loaded</th>' : ''}<th>n</th>
    </tr></thead><tbody>${categoryRows}</tbody></table>`;

  // Per-feature roll-up. Deliberately time+cost only: the epic NAMES and story counts are
  // already in the per-epic breakdown further down the page, so repeating the full epic list
  // here would be the duplication this merge exists to remove. The two markers carried over
  // from the retired "Active time by epic" bars ride in the name cell for the same reason.
  const gitByEpic = new Map((epics || []).map((epic) => [epic.slug, epic]));
  const epicRows = effortEpics.map((effortEpic) => {
    const gitEpic = gitByEpic.get(effortEpic.slug);
    const fixes = gitEpic && gitEpic.fixCommitCount
      ? ` <span class="hint" title="${gitEpic.fixCommitCount} fix commit${gitEpic.fixCommitCount === 1 ? '' : 's'} — the story bounced back for rework.">${gitEpic.fixCommitCount} fix</span>`
      : '';
    const shared = gitEpic && gitEpic.sharedSessions
      ? ' <span class="hint" title="Commit sessions shared with an interleaved epic.">*</span>'
      : '';
    // Every figure on this row is summed over the epic's TIMED stories. When that's a subset,
    // say so on the row — the numbers are a floor, not a measurement, and the reader is about
    // to compare them against features that were measured whole.
    const partial = effortEpic.timeComplete === false && effortEpic.storiesTotal
      ? ` <span class="hint" title="Only ${effortEpic.stories} of ${effortEpic.storiesTotal} stories have start and finish times, so this row measures part of the feature. Its commit-clustered active time is in Workflow performance above.">${effortEpic.stories}/${effortEpic.storiesTotal} timed</span>`
      : '';
    return `<tr>
        <td>${escapeHtml(effortEpic.name || effortEpic.slug)}${effortEpic.parallel ? ' <span class="hint" title="Built in parallel with another feature — its share of cost is approximate.">∥</span>' : ''}${shared}${fixes}</td>
        <td>${effortEpic.storiesTotal || effortEpic.stories}${partial}</td>
        <td>${formatMinutes(effortEpic.buildMinutes)}</td>
        <td>${formatMinutes(effortEpic.elapsedMinutes)}</td>
        ${withCost ? `<td>${money(effortEpic.marginalCost)}</td><td>${money(effortEpic.loadedCost)}</td>` : ''}
      </tr>`;
  }).join('');
  const partialCount = effortEpics.filter((effortEpic) => effortEpic.timeComplete === false).length;
  const epicNote = partialCount
    ? `<p class="muted" style="font-size:.82rem">${partialCount === 1 ? 'One feature has' : `${partialCount} features have`} stories without recorded times, marked below. Their build time and cost cover only the timed stories, and they are left out of the typical-feature figures above.</p>`
    : '';
  const epicTable = effortEpics.length ? `<h5 class="sub-h">Effort by feature</h5>${epicNote}
    <table class="ftable"><thead><tr>
      <th>Feature</th><th>Stories</th><th>Build time</th><th>Elapsed</th>${withCost ? '<th>Measured</th><th>Fully loaded</th>' : ''}
    </tr></thead><tbody>${epicRows}</tbody></table>` : '';

  // The estimator is deliberately dumb: per-type medians × the counts typed in. No curve
  // fitting, no complexity weighting — so the result stays auditable against the table above.
  const calculatorData = categories.map((category) => ({
    cat: category.cat, n: category.n, min: category.medMin, cost: withCost ? category.medLoadedCost : null
  }));
  const calculatorRows = calculatorData.map((calculatorEntry, i) => `<tr>
        <td>${escapeHtml(calculatorEntry.cat)}</td>
        <td><input class="ecalc" type="number" min="0" step="1" value="0" data-i="${i}" aria-label="Number of ${escapeHtml(calculatorEntry.cat)} screens"></td>
        <td class="muted">${formatMinutes(calculatorEntry.min)}${withCost ? ` · ${money(calculatorEntry.cost)}` : ''} each</td>
      </tr>`).join('');
  // Summed story windows are BUILD time; elapsed adds this project's measured gaps between
  // stories. Quoting only the first understates the wait a reader is actually sizing, so the
  // uplift the generator computes is shown — but only when there are gaps to account for.
  const showElapsed = benchmarks && benchmarks.timeUplift > 1.01;
  const elapsedRow = showElapsed ? `<tr>
        <td class="muted">Allowing for the gaps between stories (${benchmarks.timeUplift.toFixed(2)}×)</td>
        <td></td>
        <td class="muted" id="ecalcElapsed">—</td>
      </tr>` : '';
  // Escape `<` so a screen-type name containing `</script>` can't close the tag early. The
  // browser parses the escape back to `<`, so the embedded data is identical at runtime. The
  // taxonomy is a closed set today; this keeps that from being load-bearing.
  const calculatorJson = JSON.stringify(calculatorData).replace(/</g, '\\u003c');
  const calculator = `<h5 class="sub-h">Size a new feature</h5>
    <p class="muted" style="font-size:.82rem">Enter how many screens of each kind the next feature needs. The estimate multiplies this project's measured medians${withCost ? ', already uplifted for the workflow scaffolding around the stories' : ''} — cross-check it against the typical-feature figures above.</p>
    <table class="ftable"><thead><tr><th>Screen type</th><th>How many</th><th>Each</th></tr></thead>
      <tbody>${calculatorRows}</tbody>
      <tfoot><tr>
        <th>Estimate</th>
        <th id="ecalcN">0 screens</th>
        <th id="ecalcOut">—</th>
      </tr>${elapsedRow}</tfoot>
    </table>
    <script>
    (function(){
      var SCREEN_TYPES = ${calculatorJson};
      function formatMinutes(minutes){ if(minutes<60) return Math.round(minutes)+'m'; var hours=Math.floor(minutes/60), remainderMinutes=Math.round(minutes%60); return hours+'h'+(remainderMinutes?' '+remainderMinutes+'m':''); }
${withCost ? `      var RATE = ${rate != null ? rate : 'null'};
      // Same '$X · RY' shape the tables use, so the calculator can't be the one figure on the
      // page in a different currency. Emitted only under costComplete — with no cost basis the
      // page must not contain a currency formatter at all, let alone call one.
      function formatCost(costUsd){ return '$'+costUsd.toFixed(2)+(RATE!=null?' \\u00b7 R'+Math.round(costUsd*RATE).toLocaleString('en-US'):''); }
` : ''}${showElapsed ? `      var TIME_UPLIFT = ${benchmarks.timeUplift};
` : ''}      function recalculate(){
        var minutes=0, cost=0, screenCount=0;
        document.querySelectorAll('.ecalc').forEach(function(input){
          var quantity = parseInt(input.value,10); if(!quantity || quantity<0) return;
          var screenType = SCREEN_TYPES[+input.dataset.i]; if(!screenType) return;
          screenCount += quantity; minutes += quantity*(screenType.min||0); if(screenType.cost) cost += quantity*screenType.cost;
        });
        document.getElementById('ecalcN').textContent = screenCount+(screenCount===1?' screen':' screens');
        document.getElementById('ecalcOut').textContent = screenCount ? ${withCost
      ? "formatMinutes(minutes)+(cost?' \\u00b7 '+formatCost(cost):'')"
      : 'formatMinutes(minutes)'} : '\\u2014';
${showElapsed ? `        document.getElementById('ecalcElapsed').textContent = screenCount ? '\\u2248 '+formatMinutes(minutes*TIME_UPLIFT)+' elapsed' : '\\u2014';
` : ''}      }
      document.querySelectorAll('.ecalc').forEach(function(input){ input.addEventListener('input', recalculate); });
      // Run once on load: browsers restore number inputs on a soft reload, which would otherwise
      // leave filled-in boxes above a total still reading "0 screens".
      recalculate();
    })();
    </script>`;

  // Banners: the conditions that make the figures softer than they look.
  const timeOnly = !withCost
    ? `<p class="muted" style="font-size:.82rem"><strong>Time only.</strong> No sub-agent transcripts were captured for this project, so per-story cost can't be reconstructed. The build times are unaffected.</p>`
    : '';
  // A fallback-priced model must never look exact. Only meaningful alongside cost figures, so
  // it's gated on withCost — with no cost on the page there is nothing mispriced to disclose.
  const unpriced = effort.unknownModels || [];
  const estimated = withCost && effort.pricingEstimated
    ? `<p class="muted" style="font-size:.82rem"><strong>Cost figures are estimates.</strong> ${unpriced.length
      ? `${escapeHtml(unpriced.join(', '))} ${unpriced.length === 1 ? 'is' : 'are'} not in the report's price list and ${unpriced.length === 1 ? 'was' : 'were'} costed at Opus-tier rates.`
      : `A model used in this build isn't in the report's price list and was costed at Opus-tier rates.`} Treat every dollar figure here as approximate until the price list is updated; the build times are unaffected.</p>`
    : '';
  // Two causes, two sentences. Cross-epic overlap is the one that softens a per-feature figure;
  // same-epic overlap (a re-opened story window) leaves every feature total intact, so naming
  // parallel features when there are none to name would print an empty "()" and claim a fact
  // the data doesn't support.
  const parallelCause = effort.parallelEpics && effort.parallelEpics.length
    ? `(${escapeHtml(effort.parallelEpics.join(', '))}), so that spend is split evenly across the stories open at the time. Project and per-type figures hold; treat the per-feature split for those features as approximate.`
    : `— all of it inside a single feature, so no feature total is affected, only the split between its own stories. Project, per-feature and per-type figures all hold.`;
  const parallel = withCost && effort.ambiguousShare > 0.05
    ? `<p class="muted" style="font-size:.82rem"><strong>${Math.round(effort.ambiguousShare * 100)}% of story spend ran with more than one story in flight</strong> ${parallelCause}</p>`
    : '';
  const loaded = withCost && benchmarks
    ? `<p class="muted" style="font-size:.82rem"><strong>Measured vs fully loaded.</strong> ${money(totals.inStoryCost)} of ${money(totals.totalCost)} fell inside per-story build windows; the remaining ${money(totals.overheadCost)} is workflow scaffolding (INTAKE, PLAN, epic-end tests and fixes, PR/merge). The logs can't tie that to one feature, so "fully loaded" spreads it pro-rata over measured story spend — an <em>allocation</em>, not a per-feature measurement.</p>`
    : '';

  return `<section class="panel">
      <h2>Effort benchmarks <span class="muted" style="font-size:.8rem;font-weight:400">— what each kind of screen costs, and sizing the next feature</span></h2>
      <div class="stats tight">${tiles}</div>
      ${timeOnly}
      ${estimated}
      ${categoryTable}
      ${epicTable}
      ${calculator}
      ${loaded}
      ${parallel}
    </section>`;
}

// ── Quality-gate history (from quality-gates.js's run log) ───────────────────
function renderGateRuns(gateRuns, performance) {
  if (!gateRuns && (!performance || performance.gateEscapes == null)) return '';
  const tiles = [];
  if (gateRuns) {
    tiles.push(statCard(formatNumber(gateRuns.totalRuns), 'quality-gate runs', `${gateRuns.failedRuns} failed · ${gateRuns.rerunsAfterFailure} reruns after a failure`));
    for (const [gate, gateStats] of Object.entries(gateRuns.byGate)) {
      const label = gate.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
      tiles.push(statCard(`${gateStats.runs - gateStats.fails}/${gateStats.runs}`, `${label} gate passed`, gateStats.fails ? `${gateStats.fails} failing run${gateStats.fails === 1 ? '' : 's'}` : 'never failed'));
    }
  }
  if (performance && performance.gateEscapes != null) {
    tiles.push(statCard(formatNumber(performance.gateEscapes), 'gate escapes', 'issues a human found that the automated gates had passed'));
  }
  if (!tiles.length) return '';
  return `<section class="panel">
      <h2>Quality gates <span class="muted" style="font-size:.8rem;font-weight:400">— automated checks vs. what humans caught</span></h2>
      <div class="stats tight">${tiles.join('')}</div>
    </section>`;
}

// ── Data quality: sources, gaps, and every assumption — always rendered ──────
function renderDataQuality(dataQuality) {
  if (!dataQuality) return '';
  const rows = (dataQuality.sources || []).map((source) =>
    `<li><span class="pill ${source.found ? 'green' : 'grey'}">${source.found ? 'found' : 'missing'}</span> <strong>${escapeHtml(source.name)}</strong> — ${escapeHtml(source.note)}</li>`).join('');
  const assumptions = (dataQuality.assumptions || []).map((assumption) => `<li>${escapeHtml(assumption)}</li>`).join('');
  return `<section class="panel">
      <h2>Data quality <span class="muted" style="font-size:.8rem;font-weight:400">— what fed this report, and what to keep in mind</span></h2>
      <h5 class="sub-h">Sources</h5>
      <ul class="vlist">${rows}</ul>
      <h5 class="sub-h">Assumptions &amp; limitations</h5>
      <ul class="vlist">${assumptions}</ul>
    </section>`;
}

// ── What was built (codebase shape) ──────────────────────────────────────────
function renderCodebase(codebase) {
  if (!codebase) return '';
  const locBar = stackBar([
    { label: 'App source', value: codebase.loc.source, cls: 'sg-blue' },
    { label: 'Unit & integration tests', value: codebase.loc.unitTests, cls: 'sg-aqua' },
    { label: 'E2E specs', value: codebase.loc.e2e, cls: 'sg-yellow' }
  ], 'lines');
  const addedDependencies = codebase.depsAdded || { runtime: [], dev: [] };
  const dependencyNames = [...addedDependencies.runtime, ...addedDependencies.dev.map((devDependency) => `${devDependency} (dev)`)];
  const tiles = [
    statCard(formatNumber(codebase.loc.total), 'lines of code', `${formatNumber(codebase.files.source + codebase.files.unitTests + codebase.files.e2e)} tracked files in web/`),
    statCard(codebase.components, 'components', 'under src/components'),
    statCard(codebase.routes, 'routes', 'App Router pages'),
    statCard(codebase.tests.unitBlocks, 'unit/integration tests', `across ${codebase.tests.unitFiles} files`),
    statCard(codebase.tests.e2eBlocks, 'E2E tests', `across ${codebase.tests.e2eSpecs} specs${codebase.tests.e2eFixmes ? ` · ${codebase.tests.e2eFixmes} fixme` : ''}`),
    statCard(dependencyNames.length, 'dependencies added', dependencyNames.length ? dependencyNames.join(', ') : 'built entirely on the template stack')
  ].join('');
  return `<section class="panel">
      <h2>What was built <span class="muted" style="font-size:.8rem;font-weight:400">— the shape of the codebase</span></h2>
      <h5 class="sub-h">Code composition (tracked lines in web/src + web/e2e)</h5>
      ${locBar}
      <div class="stats tight" style="margin-top:1rem">${tiles}</div>
    </section>`;
}

// ── Stumbling blocks ─────────────────────────────────────────────────────────
function renderBlocks(blocks) {
  if (!blocks.length) return '<p class="muted">No tooling friction logged for this project. 🎉</p>';
  return blocks.map((block, i) => `<div class="block">
      <div class="block-head" onclick="this.parentNode.classList.toggle('open')">
        <span class="block-n">${i + 1}</span>
        <span class="block-title">${escapeHtml(block.title)}</span>
        <span class="chevron">▾</span>
      </div>
      ${block.source ? `<div class="block-src">${escapeHtml(block.source)}</div>` : ''}
      <div class="block-body">${markdownToHtml(block.body)}</div>
    </div>`).join('');
}

// The marker says this panel is WRITTEN, not computed — every other panel comes straight from the
// collector. The tooltip names where the wording comes from, but states the limit in the same
// breath: an upgrade replaces the skill file, so this is not a customisation that survives. The
// old "✎ editable" badge promised the opposite.
function renderInsights(insightsMarkdown) {
  if (!insightsMarkdown) return '';
  return `<section class="panel insight">
      <h2>What this means <span class="tweak" title="A written summary of the figures below — every other panel is computed from your project's own records. Its wording comes from a brief in this report's skill file, which an upgrade replaces.">authored</span></h2>
      <div class="insight-body">${markdownToHtml(insightsMarkdown)}</div>
    </section>`;
}

function renderPage(data, insightsMarkdown) {
  if (data.status !== 'ok') {
    return pageShell('Build report', `<header class="top"><h1>Build report</h1></header><p class="muted">${escapeHtml(data.message || data.status)}</p>`);
  }
  return pageShell(`Build report — ${data.project.name || 'Project'}`, renderMaintainerBody(data, insightsMarkdown));
}

const PAGE_CSS = `
:root{--bg:#0f1117;--panel:#171a23;--panel2:#1e222d;--line:#2a2f3c;--text:#e5e7eb;--muted:#9aa4b2;--accent:#0ea5e9;--green:#10b981;--amber:#f59e0b;--red:#ef4444;--grey:#6b7280}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--text);line-height:1.5}
.wrap{max-width:1000px;margin:0 auto;padding:2rem 1.25rem 4rem}
header.top h1{margin:0 0 .25rem;font-size:1.6rem}
header.top .sub{color:var(--muted);font-size:.9rem}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.75rem;margin:1.5rem 0}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:1rem}
.stat-v{font-size:1.7rem;font-weight:700}
.stat-l{color:var(--muted);font-size:.8rem;text-transform:uppercase;letter-spacing:.03em}
.stat-s{color:var(--muted);font-size:.78rem;margin-top:.35rem}
.stats.tight{margin:.4rem 0 .2rem}
.stats.tight .stat{padding:.75rem .9rem}
.stats.tight .stat-v{font-size:1.4rem}
/* charts — series hues validated for this dark surface (CVD + contrast) */
:root{--s-blue:#3987e5;--s-aqua:#199e70;--s-yellow:#c98500}
.sub-h{color:var(--muted);text-transform:uppercase;font-size:.72rem;letter-spacing:.04em;margin:1.1rem 0 .45rem}
.hbar{display:flex;gap:2px;height:18px;border-radius:6px;overflow:hidden}
.seg{display:block;min-width:4px}
.sg-blue{background:var(--s-blue)}.sg-aqua{background:var(--s-aqua)}.sg-yellow{background:var(--s-yellow)}
.sg-green{background:var(--green)}.sg-amber{background:var(--amber)}
.legend{display:flex;flex-wrap:wrap;gap:.4rem 1.2rem;margin-top:.5rem;font-size:.82rem;color:var(--muted)}
.legend strong{color:var(--text)}
.key{display:inline-flex;align-items:center;gap:.4rem}
.swatch{width:10px;height:10px;border-radius:3px;flex:0 0 auto}
.ebar{display:grid;grid-template-columns:minmax(140px,240px) 1fr;gap:.6rem;align-items:center;padding:.22rem 0}
.ebar-name{font-size:.82rem;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ebar-track{display:flex;align-items:center;gap:.5rem;height:14px}
.ebar-fill{display:block;height:100%;background:var(--accent);border-radius:0 4px 4px 0}
.ebar-v{font-size:.78rem;color:var(--text);white-space:nowrap}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:1.25rem 1.4rem;margin:1.25rem 0}
.panel>h2{margin:0 0 .9rem;font-size:1.1rem;display:flex;align-items:center;gap:.5rem}
.muted{color:var(--muted)}
.tweak{font-size:.68rem;color:var(--accent);border:1px solid var(--accent);border-radius:20px;padding:.05rem .5rem;font-weight:400;cursor:help}
.insight{border-color:#1e3a5f;background:linear-gradient(180deg,#141a26,#171a23)}
.insight-body h5{margin:.9rem 0 .3rem;font-size:.98rem}
.insight-body p{margin:.4rem 0}
/* timeline */
.day{display:grid;grid-template-columns:120px 1fr;gap:.75rem;padding:.6rem 0;border-top:1px solid var(--line)}
.day:first-child{border-top:0}
.day-label{color:var(--muted);font-size:.82rem;font-variant-numeric:tabular-nums}
.day-sum{display:block;color:var(--text);font-weight:600;font-size:.9rem;margin-top:.15rem}
.sess{margin-bottom:.4rem}
.sess-head{display:flex;align-items:center;gap:.6rem;cursor:pointer;padding:.25rem .4rem;border-radius:8px}
.sess-head:hover{background:var(--panel2)}
.sess-time{font-variant-numeric:tabular-nums;font-size:.8rem;color:var(--muted);min-width:92px}
.bar{flex:1;height:8px;background:var(--panel2);border-radius:6px;overflow:hidden;min-width:60px}
.bar-fill{display:block;height:100%;background:var(--accent);border-radius:6px}
.bar-fill.has-fix{background:linear-gradient(90deg,var(--accent),var(--amber))}
.sess-meta{font-size:.78rem;color:var(--muted);white-space:nowrap}
.commits{display:none;list-style:none;margin:.2rem 0 .5rem;padding:.4rem .6rem;background:var(--panel2);border-radius:8px;font-size:.82rem}
.sess.open .commits{display:block}
.commits li{padding:.12rem 0}
.c-time{color:var(--muted);font-variant-numeric:tabular-nums;margin-right:.5rem}
/* build flow — categorical slots validated (CVD + ≥3:1 contrast) for this surface */
:root{--flow-1:#3987e5;--flow-2:#008300;--flow-3:#d55181;--flow-4:#c98500;--flow-5:#199e70;--flow-6:#d95926;--flow-7:#9085e9;--flow-8:#e66767}
.fc-1{--fc:var(--flow-1)}.fc-2{--fc:var(--flow-2)}.fc-3{--fc:var(--flow-3)}.fc-4{--fc:var(--flow-4)}
.fc-5{--fc:var(--flow-5)}.fc-6{--fc:var(--flow-6)}.fc-7{--fc:var(--flow-7)}.fc-8{--fc:var(--flow-8)}
.fflow{position:relative;padding-top:1.3rem}
.fticks{position:absolute;inset:0;pointer-events:none}
.ftick{position:absolute;top:0;bottom:0;font-size:.68rem;color:var(--muted);font-variant-numeric:tabular-nums;transform:translateX(-50%)}
.ftick i{position:absolute;left:50%;top:1.2rem;bottom:0;border-left:1px solid var(--line)}
.flane{display:grid;grid-template-columns:235px 1fr;gap:.6rem;align-items:center;margin:.3rem 0}
.flane-label{font-size:.78rem;color:var(--muted);display:flex;align-items:center;gap:.4rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.flane .swatch,.ftable .swatch{background:var(--fc)}
.ftrack{position:relative;height:18px}
.fbar{position:absolute;top:2px;height:14px;border-radius:4px;background:var(--fc);display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:default}
.fbar em{font-style:normal;font-size:.66rem;font-weight:700;color:rgba(255,255,255,.92);text-shadow:0 1px 2px rgba(0,0,0,.45)}
.fbar:hover{outline:2px solid var(--text);outline-offset:1px}
.fshoulder{position:absolute;top:6px;height:6px;border-radius:3px;background:repeating-linear-gradient(45deg,var(--fc),var(--fc) 3px,transparent 3px,transparent 6px);opacity:.4;cursor:default}
.fshoulder:hover{outline:2px solid var(--muted);outline-offset:1px}
.fconc-track{border-bottom:1px solid var(--line)}
.fstep{position:absolute;bottom:0;background:var(--accent);opacity:.75;border-radius:2px 2px 0 0}
.fkey-hatch{width:22px;height:8px;border-radius:4px;background:repeating-linear-gradient(45deg,var(--muted),var(--muted) 3px,transparent 3px,transparent 6px);opacity:.7;display:inline-block}
.fkey-step{width:14px;height:10px;background:var(--accent);opacity:.75;border-radius:2px 2px 0 0;display:inline-block}
.ftable{border-collapse:collapse;width:100%;margin-top:.6rem;font-size:.8rem}
.ftable th,.ftable td{text-align:left;padding:.3rem .5rem;border-bottom:1px solid var(--line)}
.ftable th{color:var(--muted);font-weight:600;text-transform:uppercase;font-size:.68rem;letter-spacing:.03em}
.ftable td{font-variant-numeric:tabular-nums}
#ftt{position:fixed;z-index:10;background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:.5rem .7rem;font-size:.8rem;max-width:340px;pointer-events:none;display:none;box-shadow:0 6px 20px rgba(0,0,0,.5)}
details summary{cursor:pointer;color:var(--muted);font-size:.85rem;margin-top:.8rem}
/* decision log: one fold per phase, nested inside the Spend detail fold */
.dgroup{border:1px solid var(--line);border-radius:8px;margin:.4rem 0;padding:0 .6rem .1rem}
.dgroup>summary{margin:0;padding:.45rem 0;color:var(--text);font-weight:600}
.dgroup[open]>summary{border-bottom:1px solid var(--line)}
/* sizing calculator: native number inputs inherit nothing, so they render as light
   controls on the dark surface unless they're styled to match the table around them */
input.ecalc{width:5em;font:inherit;font-size:.8rem;font-variant-numeric:tabular-nums;text-align:right;
  padding:.2rem .35rem;border:1px solid var(--line);border-radius:6px;background:var(--panel2);color:var(--text)}
input.ecalc:focus{outline:2px solid var(--accent);outline-offset:1px}
/* epics */
.epic{border:1px solid var(--line);border-radius:12px;margin:.6rem 0;overflow:hidden}
.epic.complete{border-left:3px solid var(--green)}
.epic.in-flight{border-left:3px solid var(--amber)}
.epic.planned{border-left:3px solid var(--grey)}
.epic-head{display:flex;align-items:center;gap:.6rem;padding:.7rem .9rem;cursor:pointer}
.epic-head:hover{background:var(--panel2)}
.epic-name{font-weight:600;flex:1}
.epic-tags{display:flex;gap:.4rem;flex-wrap:wrap}
.chevron{color:var(--muted);transition:transform .15s}
.epic.open .chevron,.block.open .chevron{transform:rotate(180deg)}
.epic-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:.5rem;padding:0 .9rem .8rem}
.mini{background:var(--panel2);border-radius:8px;padding:.5rem .6rem}
.mini-v{display:block;font-weight:700;font-size:1.05rem}
.mini-l{color:var(--muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.02em}
.epic-body{display:none;padding:.2rem .9rem 1rem;border-top:1px solid var(--line)}
.epic.open .epic-body{display:block}
.journal h5,.epic-body h5{color:var(--muted);text-transform:uppercase;font-size:.72rem;letter-spacing:.04em;margin:.8rem 0 .3rem}
.journal p,.block-body p{margin:.35rem 0}
.journal ul,.block-body ul,.insight-body ul{margin:.3rem 0 .6rem;padding-left:1.1rem}
.journal li,.block-body li{margin:.2rem 0}
code{background:var(--panel2);padding:.05rem .3rem;border-radius:4px;font-size:.85em}
/* pills */
.pill{font-size:.72rem;padding:.12rem .5rem;border-radius:20px;white-space:nowrap}
.pill.green{background:rgba(16,185,129,.15);color:#6ee7b7;border:1px solid rgba(16,185,129,.4)}
.pill.amber{background:rgba(245,158,11,.15);color:#fcd34d;border:1px solid rgba(245,158,11,.4)}
.pill.grey{background:rgba(107,114,128,.15);color:#cbd5e1;border:1px solid rgba(107,114,128,.4)}
.hint{font-size:.72rem;color:var(--muted);border-bottom:1px dotted var(--muted);cursor:help}
/* blocks */
.block{border:1px solid var(--line);border-radius:12px;margin:.55rem 0;overflow:hidden}
.block-head{display:flex;align-items:center;gap:.6rem;padding:.65rem .9rem;cursor:pointer}
.block-head:hover{background:var(--panel2)}
.block-n{background:var(--amber);color:#111;font-weight:700;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:.8rem;flex:0 0 auto}
.block-title{flex:1;font-weight:600;font-size:.95rem}
.block-src{color:var(--muted);font-size:.78rem;padding:0 .9rem .3rem 3.2rem}
.block-body{display:none;padding:.2rem .9rem 1rem 3.2rem;border-top:1px solid var(--line);font-size:.9rem}
.block.open .block-body{display:block}
footer{color:var(--muted);font-size:.78rem;margin-top:2rem;border-top:1px solid var(--line);padding-top:1rem}
.vlist{margin:.3rem 0;padding-left:1.1rem}
.vlist li{margin:.45rem 0}
.sgroup{margin:.9rem 0 1.1rem}
.sgroup h5{margin:0 0 .2rem;font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
`;

function pageShell(title, body) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${PAGE_CSS}</style></head>
<body><div class="wrap">
${body}
</div></body></html>`;
}

function renderMaintainerBody(data, insightsMarkdown) {
  const timeline = data.timeline;
  const coverage = data.coverage;
  const generated = (data.generatedAt || '').replace('T', ' ').slice(0, 16);
  const costEffort = data.costEffort;
  const overview = [
    statCard(`${timeline.spanDays}d`, 'calendar span', `${formatDate(timeline.firstCommit?.date)} → ${formatDate(timeline.lastCommit?.date)}`),
    statCard(`~${formatDuration(timeline.activeMinutes)}`, 'active build time', `${timeline.sessionCount} work sessions`),
    statCard(`${coverage.builtEpics}${coverage.plannedEpics ? `/${coverage.plannedEpics + (coverage.offPlanEpics || 0)}` : ''}`, 'epics delivered', `${coverage.storiesBuilt} stories`),
    costEffort && costEffort.costUsd != null && costEffort.usdToZar != null
      ? statCard(formatZar(costEffort.costUsd, costEffort.usdToZar), 'estimated AI cost', `$${costEffort.costUsd.toFixed(2)} at API list prices`)
      : '',
    statCard(`${data.rework.fixCommitCount}`, 'fix commits', `${data.rework.passedAfterFixStories} stories fixed post-test`),
    statCard(`${data.stumblingBlocks.length}`, 'stumbling blocks', 'tooling friction logged')
  ].filter(Boolean).join('');

  // Header carries team + project + date range so reports from different
  // teams/projects are directly comparable side by side.
  const team = data.meta && data.meta.team ? ` · Team: ${escapeHtml(data.meta.team)}` : '';
  const range = timeline.firstCommit ? ` · ${formatDate(timeline.firstCommit.date)} → ${formatDate(timeline.lastCommit?.date)}` : '';

  return `<header class="top">
  <h1>Build report — ${escapeHtml(data.project.name || 'Project')}</h1>
  <div class="sub">How this app came together${team}${range} · generated ${escapeHtml(generated)} UTC</div>
</header>
<div class="stats">${overview}</div>
${renderInsights(insightsMarkdown)}
${renderCostEffort(costEffort)}
${renderSpendDetail(costEffort)}
${renderPerformance(data)}
${renderEffort(data.effort, data.epics, costEffort ? costEffort.usdToZar : null)}
${renderGateRuns(data.gateRuns, data.performance)}
${renderCodebase(data.codebase)}
<section class="panel">
  <h2>Timeline <span class="muted" style="font-size:.8rem;font-weight:400">— click a session to see its commits</span></h2>
  ${renderTimeline(timeline)}
</section>
<section class="panel">
  <h2>Build flow <span class="muted" style="font-size:.8rem;font-weight:400">— which stories ran in parallel; hover a bar for detail</span></h2>
  ${renderBuildFlow(data)}
</section>
<section class="panel">
  <h2>Per-epic breakdown <span class="muted" style="font-size:.8rem;font-weight:400">— click an epic to open its journal</span></h2>
  ${data.epics.map(renderEpic).join('')}
</section>
<section class="panel">
  <h2>Stumbling blocks &amp; time-sinks</h2>
  ${renderBlocks(data.stumblingBlocks)}
</section>
${renderDataQuality(data.dataQuality)}
<footer>
  <strong>How the numbers are derived.</strong> Active build time clusters git commits into work sessions
  (a gap over ${timeline.gapMin} min starts a new one) and sums each session's span — a conservative <em>floor</em> on real
  effort, not a stopwatch (a lone commit counts as ~0). Per-epic time is attributed by commit scope; epics built
  interleaved share their session time (marked “shared time”). Stumbling blocks are read from
  <code>generated-docs/template-feedback.md</code>; manual-test outcomes and post-fix flags from each epic's <code>state.json</code>.
  Line counts cover git-tracked files under <code>web/src</code> and <code>web/e2e</code>; churn (lines added/deleted) is
  measured over <code>web/</code> excluding the lockfile, so generated diffs don't swamp the hand-written signal.
  “First-pass E2E yield” is the share of stories whose end-to-end tests passed without entering a fix cycle;
  “dependencies added” diffs <code>web/package.json</code> against its first committed version.
</footer>`;
}

// ── Stakeholder delivery page ────────────────────────────────────────────────
// What shipped, the quality evidence, and what's still to come — written for a
// non-technical reader. Internal machinery (churn, fix commits, work sessions,
// tooling friction) deliberately does not appear on this page.
function prettyEpicName(epic) {
  if (epic.name && epic.name !== epic.slug) return epic.name;
  return epic.slug.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function renderStakeholderEpic(epic) {
  return `<div class="epic complete">
      <div class="epic-head" onclick="this.parentNode.classList.toggle('open')">
        <span class="epic-name">${escapeHtml(prettyEpicName(epic))}</span>
        <span class="epic-tags">${manualTestBadge(epic.manualTest)}<span class="pill grey">${epic.stories.complete} ${epic.stories.complete === 1 ? 'story' : 'stories'}</span></span>
        <span class="chevron">▾</span>
      </div>
      <div class="epic-body">
        <h5>What this delivers</h5>
        <div class="journal">${epic.journal ? markdownToHtml(epic.journal) : '<p class="muted">No write-up recorded.</p>'}</div>
      </div>
    </div>`;
}

// ── Sign-off log (authored: build-report-decisions.json) ─────────────────────
// Defensive by design: the file is model-authored, so anything unexpected is dropped rather than
// rendered. A decision needs at least a `decision` and a `choice` to be worth a row; `area` and
// `when` are optional. Returns null when there is nothing renderable, so the section disappears
// entirely instead of showing an empty table.
function normaliseDecisions(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.decisions)) return null;
  const trimmedString = (value) => (typeof value === 'string' ? value.trim() : '');
  const rows = raw.decisions.map((decision) => (decision && typeof decision === 'object' ? {
    area: trimmedString(decision.area) || 'Other',
    decision: trimmedString(decision.decision),
    choice: trimmedString(decision.choice),
    // Date only — a curated log is a record of what was chosen, not a timestamped audit trail.
    when: /^\d{4}-\d{2}-\d{2}/.test(trimmedString(decision.when)) ? trimmedString(decision.when).slice(0, 10) : ''
  } : null)).filter((row) => row && row.decision && row.choice);
  if (!rows.length) return null;
  const excluded = Number.isFinite(raw.excludedCount) && raw.excludedCount > 0 ? Math.round(raw.excludedCount) : 0;
  // Group in first-seen order, so the list follows the order the decisions were actually made.
  const groups = [];
  for (const row of rows) {
    let group = groups.find((existingGroup) => existingGroup.area === row.area);
    if (!group) groups.push((group = { area: row.area, rows: [] }));
    group.rows.push(row);
  }
  return { groups, count: rows.length, excluded };
}

function renderSignOff(signOff) {
  if (!signOff) return '';
  const groups = signOff.groups.map((group) => `<div class="sgroup">
        <h5>${escapeHtml(group.area)}</h5>
        <ul class="vlist">${group.rows.map((row) => `<li><strong>${escapeHtml(row.decision)}</strong> — ${escapeHtml(row.choice)}${
    row.when ? ` <span class="muted" style="font-size:.78rem;white-space:nowrap">(${escapeHtml(row.when)})</span>` : ''}</li>`).join('')}</ul>
      </div>`).join('');
  const note = `<p class="muted" style="font-size:.82rem">${signOff.count} ${signOff.count === 1 ? 'decision' : 'decisions'} recorded${
    signOff.excluded ? `. A further ${signOff.excluded} ${signOff.excluded === 1 ? 'decision' : 'decisions'} about how the work itself was run — approvals, scheduling and technical setup — are not listed here` : ''
  }. Each line is taken from the build's own record of the question you were asked and the answer you gave.</p>`;
  return `<section class="panel">
  <h2>Decisions you signed off <span class="muted" style="font-size:.8rem;font-weight:400">— the choices that shaped what was built</span></h2>
  ${groups}
  ${note}
</section>`;
}

function renderStakeholdersPage(data, insightsMarkdown, signOff) {
  if (data.status !== 'ok') {
    return pageShell('Delivery report', `<h1>Delivery report</h1><p>${escapeHtml(data.message || data.status)}</p>`);
  }
  const timeline = data.timeline, coverage = data.coverage, codebase = data.codebase, performance = data.performance;
  const done = data.epics.filter((epic) => epic.status === 'complete');
  const pending = data.epics.filter((epic) => epic.status !== 'complete');
  const generated = (data.generatedAt || '').replace('T', ' ').slice(0, 16);
  const overview = [
    statCard(`${coverage.builtEpics}${coverage.plannedEpics ? `/${coverage.plannedEpics + (coverage.offPlanEpics || 0)}` : ''}`, 'feature areas delivered', `${coverage.storiesBuilt} user stories`),
    statCard(`~${formatDuration(timeline.activeMinutes)}`, 'active build effort', `across ${timeline.spanDays} calendar days`),
    statCard(formatNumber(codebase.tests.unitBlocks + codebase.tests.e2eBlocks), 'automated tests', 'run before every release'),
    performance.manualChecks ? statCard(`${performance.manualChecks.pct}%`, 'hands-on checks passed', `${performance.manualChecks.passed} of ${performance.manualChecks.total} human-verified`) : '',
    statCard(formatNumber(codebase.loc.total), 'lines of code', `${codebase.components} components · ${codebase.routes} screens`)
  ].filter(Boolean).join('');

  const verification = `<ul class="vlist">
      <li><strong>${formatNumber(codebase.tests.e2eBlocks)} end-to-end tests</strong> drive the finished app in a real browser the way a person would, across ${codebase.tests.e2eSpecs} scenario files.</li>
      <li><strong>${formatNumber(codebase.tests.unitBlocks)} unit &amp; integration tests</strong> check individual screens and business rules in isolation.</li>
      ${performance.manualChecks ? `<li><strong>${performance.manualChecks.passed} of ${performance.manualChecks.total} hands-on checks passed</strong> — a person verified the finished screens against the real backend.</li>` : ''}
      ${performance.assumptionsOpen ? `<li><strong>${performance.assumptionsOpen} assumptions are flagged for future verification</strong> — points where behaviour depends on backend details that couldn't be fully confirmed yet. Each is written down and will be re-checked as the remaining work lands.</li>` : ''}
    </ul>`;

  const upcoming = pending.length
    ? `<section class="panel"><h2>Still to come</h2><ul class="vlist">${pending.map((epic) =>
        `<li><strong>${escapeHtml(prettyEpicName(epic))}</strong>${epic.status === 'in-flight' ? ' — in progress' : ' — planned, not yet started'}</li>`).join('')}</ul></section>`
    : '';

  const body = `<header class="top">
  <h1>Delivery report — ${escapeHtml(data.project.name || 'Project')}</h1>
  <div class="sub">What was built and how it was verified · generated ${escapeHtml(generated)} UTC</div>
</header>
<div class="stats">${overview}</div>
${renderInsights(insightsMarkdown)}
<section class="panel">
  <h2>What was delivered <span class="muted" style="font-size:.8rem;font-weight:400">— click a feature area for its full write-up</span></h2>
  ${done.map(renderStakeholderEpic).join('')}
</section>
${renderSignOff(normaliseDecisions(signOff))}
<section class="panel">
  <h2>How it was verified</h2>
  ${verification}
</section>
${upcoming}
<footer>
  Figures are derived from the project's own records: effort from the timing of saved work (a conservative
  floor, not a billed figure), delivery from each feature area's build log, and verification from the
  automated test suites plus the recorded hands-on test results.
</footer>`;
  return pageShell(`Delivery report — ${data.project.name || 'Project'}`, body);
}

// Pages that used to be generated separately and are now sections of this report. Their
// generators stopped writing them, but nothing deleted the copies already on disk — and
// `generated-docs/reports/` is gitignored, so a stale page never surfaces as an untracked file.
// A maintainer with one bookmarked sees a page that looks live, is frozen at the last
// pre-upgrade run, and disagrees with the report that replaced it.
//
// Done here rather than in the two data generators because this runs on every report, for both
// audiences, whatever those generators did — they exit early on a missing input, which is
// precisely when a stale page is most misleading.
const SUPERSEDED_PAGES = ['build-cost.html', 'build-effort.html'];

function removeSupersededPages(dir) {
  const removed = [];
  for (const name of SUPERSEDED_PAGES) {
    try {
      fs.unlinkSync(path.join(dir, name));
      removed.push(name);
    } catch { /* not there — the normal case */ }
  }
  return removed;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const audience = Object.hasOwn(AUDIENCES, args.audience) ? AUDIENCES[args.audience] : null;
  if (!audience) {
    process.stdout.write(JSON.stringify({
      status: 'error',
      message: `Unknown audience "${args.audience}". Valid audiences: ${Object.keys(AUDIENCES).join(', ')}.`
    }, null, 2) + '\n');
    process.exitCode = 1;
    return;
  }
  const data = collect(args.root);

  let insightsMarkdown = null;
  if (!args.noInsights) {
    const insightsPath = args.insights ? path.resolve(args.insights) : path.join(args.root, audience.insights);
    try { insightsMarkdown = fs.readFileSync(insightsPath, 'utf8').trim() || null; } catch { insightsMarkdown = null; }
  }

  // The sign-off log is stakeholders-only and always optional: a project whose transcripts live on
  // another machine has no decision log to curate, and the page must render without it.
  let signOff = null;
  if (args.audience === 'stakeholders' && audience.decisions) {
    try { signOff = JSON.parse(fs.readFileSync(path.join(args.root, audience.decisions), 'utf8')); } catch { signOff = null; }
  }

  const html = args.audience === 'stakeholders'
    ? renderStakeholdersPage(data, insightsMarkdown, signOff)
    : renderPage(data, insightsMarkdown);
  const htmlAbsolutePath = path.join(args.root, audience.html);
  const jsonAbsolutePath = path.join(args.root, OUT_JSON);
  fs.mkdirSync(path.dirname(htmlAbsolutePath), { recursive: true });
  fs.mkdirSync(path.dirname(jsonAbsolutePath), { recursive: true });
  fs.writeFileSync(htmlAbsolutePath, html, 'utf8');
  fs.writeFileSync(jsonAbsolutePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  removeSupersededPages(path.dirname(htmlAbsolutePath));

  process.stdout.write(JSON.stringify({
    status: data.status,
    audience: args.audience,
    html: audience.html,
    json: OUT_JSON,
    insights: insightsMarkdown ? 'included' : 'none',
    insightsFile: audience.insights,
    ...(args.audience === 'stakeholders' ? {
      signOff: normaliseDecisions(signOff) ? 'included' : 'none',
      signOffFile: audience.decisions
    } : {}),
    message: data.status === 'ok' ? undefined : data.message
  }, null, 2) + '\n');
}

if (require.main === module) main();

module.exports = {
  renderPage, renderStakeholdersPage, markdownToHtml, renderTimeline, renderBuildFlow, parseArgs, AUDIENCES,
  normaliseDecisions, renderSignOff, renderEffort, renderPerformance, renderSpendDetail
};

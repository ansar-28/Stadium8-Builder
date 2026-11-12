#!/usr/bin/env node
/**
 * render-epic-plan-review.js
 *
 * Renders the editable epic-plan review page shown at the INTAKE approval
 * (commands/start.md Step 8b), from the blocker-free DECOMPOSITION PROPOSAL.
 *
 * Usage:
 *   node .claude/scripts/render-epic-plan-review.js --in <payload.json> [--out <path>]
 *   node .claude/scripts/render-epic-plan-review.js --in -            # payload on stdin
 *
 * Default --out is generated-docs/epic-plan-review.html (alongside epic-plan.md).
 * Relative paths resolve against the repo root. Prints {"status":"ok","page":…}.
 *
 * Payload:
 *   {
 *     projectName?: string,
 *     epics: [{ slug, name, goal, dependsOn?: [slug] }],
 *     coverage?: { total: number, assigned: number }  // a shortfall renders as one
 *   }
 *
 * `dependsOn` carries slugs, but the page shows the depended-on epic's *name* —
 * a slug is an identifier, and this is the page a non-developer signs the scope
 * off on. Approve hands the slug back alongside the name so the orchestrator can
 * still resolve the graph after a rename or reorder.
 *
 * Approve copies: { decision:"epic-plan", edited, epics:[{slug,name,goal,dependsOn}] }
 * — array order is the plan order, `dependsOn` is names as shown, `slug` is null
 * for an epic the user added. The page can't write to disk, so the user pastes
 * that back; the orchestrator re-runs decompose when edited is true.
 */
'use strict';

const path = require('path');
const { GENERATED_DOCS_DIR } = require('./resolve-state-path');
const { page, escapeHtml, jsonForScript, readPayload, resolveOutputPath, emit, runCli } = require('./lib/review-page');

// Built from the layout constant rather than spelled out, so this page follows
// generated-docs/ if it ever moves — the same way the dashboard's output path does.
const DEFAULT_OUT = path.posix.join(GENERATED_DOCS_DIR, 'epic-plan-review.html');

function epicCard(epic, nameOf) {
  const dependencyNames = (epic.dependsOn || []).map((slug) => nameOf(slug)).filter(Boolean).join(', ');
  // Not `draggable` here: wireDrag turns it on only while the ⠿ handle is held, so
  // the contenteditable fields inside keep their own drag-to-select behaviour.
  return `<div class="card epic" data-slug="${escapeHtml(epic.slug || '')}">
  <div class="row">
    <span class="drag" title="Drag to reorder">⠿</span>
    <span class="muted n"></span>
    <div class="grow">
      <h3 contenteditable class="name">${escapeHtml(epic.name || '')}</h3>
      <div class="goal" contenteditable>${escapeHtml(epic.goal || '')}</div>
      <div class="small muted" style="margin-top:.45rem">
        Builds on: <span class="deps" contenteditable>${escapeHtml(dependencyNames || '—')}</span>
      </div>
    </div>
    <div class="actions">
      <button class="icon" onclick="moveCard(this.closest('.epic'),-1)" title="Move up">↑</button>
      <button class="icon" onclick="moveCard(this.closest('.epic'),1)" title="Move down">↓</button>
      <button class="icon" onclick="this.closest('.epic').remove();renumber()" title="Remove">✕</button>
    </div>
  </div>
</div>`;
}

/**
 * States coverage from both numbers, never from `total` alone — claiming
 * everything is covered when `assigned` is short of it would be a false
 * reassurance on the one page where the user signs the scope off.
 *
 * So a missing, null or non-numeric `assigned` renders nothing at all. Defaulting
 * it to `total` produced exactly that false reassurance: `{total: 12}` and
 * `{total: 12, assigned: "9"}` both claimed all 12 requirements were covered.
 */
function coverageNote(coverage) {
  if (!coverage || !Number.isFinite(coverage.total) || coverage.total <= 0) return '';
  const assigned = coverage.assigned;
  if (!Number.isFinite(assigned) || assigned < 0) return '';
  return assigned >= coverage.total
    ? `<p class="small muted">✓ Everything you asked for is covered — all ${coverage.total} requirements are assigned across these epics.</p>`
    : `<p class="small muted">⚠️ ${assigned} of ${coverage.total} requirements are assigned across these epics — ${coverage.total - assigned} still need a home.</p>`;
}

function render(payload) {
  const epics = Array.isArray(payload.epics) ? payload.epics : [];
  const coverage = payload.coverage;
  // Slugs are for the machine; the page shows the depended-on epic's name.
  const nameBySlug = new Map(epics.filter((epic) => epic.slug).map((epic) => [epic.slug, epic.name || epic.slug]));
  const nameOf = (slug) => nameBySlug.get(slug) || slug;

  const body = `
<div id="epics">${epics.map((epic) => epicCard(epic, nameOf)).join('\n')}</div>
<p><button onclick="addEpic()">+ Add an epic</button></p>
${coverageNote(coverage)}
<p class="small muted">Edit anything above, reorder with the handles or arrows, then choose Approve.
Approve copies the plan to your clipboard — paste it into the chat to continue.</p>

<template id="tpl-epic">${epicCard({ slug: '', name: '', goal: '', dependsOn: [] }, nameOf)}</template>`;

  const footer = `<button class="primary" onclick="approve()">Approve plan</button>
<button onclick="approve()">Copy again</button>`;

  const script = `
var LIST=document.getElementById('epics');
function renumber(){renumberIn(LIST)}
function addEpic(){
  var card=document.getElementById('tpl-epic').content.firstElementChild.cloneNode(true);
  card.querySelector('.name').textContent='New epic';
  card.querySelector('.goal').textContent='What it delivers';
  LIST.appendChild(card);renumber();card.querySelector('.name').focus();
}
/* One reader for the page. ORIGINAL is a snapshot of it taken at load, so the
   "did the user change anything" comparison has a single definition of what the
   page says rather than a second hand-written copy of this shape. */
function current(){
  return Array.prototype.map.call(LIST.querySelectorAll('.epic'),function(card){
    var dependencyNames=textOf(card.querySelector('.deps'));
    return {slug:card.dataset.slug||null,name:textOf(card.querySelector('.name')),goal:textOf(card.querySelector('.goal')),
      dependsOn:(dependencyNames==='—'||!dependencyNames)?[]:dependencyNames.split(',').map(function(dependencyName){return dependencyName.trim()}).filter(Boolean)};
  });
}
function approve(){
  var epics=current();
  handoff({decision:'epic-plan',edited:JSON.stringify(epics)!==ORIGINAL,epics:epics},'epic-plan');
}
wireDrag(LIST,'.epic');renumber();
var ORIGINAL=JSON.stringify(current());`;

  return page({
    title: `Epic plan — ${payload.projectName || 'your project'}`,
    heading: 'Here’s the plan',
    pill: `${epics.length} epic${epics.length === 1 ? '' : 's'}`,
    lede: 'Each one ships something you can use. Change anything that looks wrong.',
    body,
    footer,
    script,
  });
}

runCli(() => {
  // Resolve the destination before doing the work, so a bad --out is reported as one.
  const pagePath = resolveOutputPath(process.argv, DEFAULT_OUT);
  emit(render(readPayload(process.argv)), pagePath);
});

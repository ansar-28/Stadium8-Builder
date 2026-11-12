#!/usr/bin/env node
/**
 * render-stories-review.js
 *
 * Renders the editable stories review page shown at the per-epic stories
 * approval (commands/continue.md Phase PLAN, and /plan Step 4 writing into its worktree).
 *
 * Usage:
 *   node .claude/scripts/render-stories-review.js --in <payload.json> --out <path>
 *   node .claude/scripts/render-stories-review.js --in - --out <path>   # payload on stdin
 *
 * --out is required: the page is co-located with the epic it reviews
 * (generated-docs/epics/<slug>/stories-review.html) and /plan writes it inside a
 * throwaway worktree, so there is no useful default. Relative paths resolve
 * against the repo root.
 *
 * Payload:
 *   {
 *     epic, name, summary?,
 *     position?: { index, total, completed },   // header pill + momentum bar
 *     stories: [{
 *       title, plainSummary, scopeCue?, roles?: [],
 *       isInfrastructureOnly?: bool,
 *       acceptanceCriteria?: [string], manualTestChecklist?: [string]
 *     }],
 *     nonGoals?: [string],
 *     designChoices?: [{
 *       question, screen?,
 *       recommended?,                           // label to pre-select; else the first
 *       options: [{ label, previewHtml? }]      // previewHtml is model-authored
 *     }]
 *   }
 *
 * Leads with goals: title + plain summary are visible, criteria / manual tests
 * sit in a collapsed <details> per story, so the page reads as a short list of
 * goals rather than a wall of criteria.
 *
 * Design choices are rendered only when the payload carries them — the planner
 * applies the ">=80% sure" test upstream, so an empty array means no section.
 * `previewHtml` is inserted as markup on purpose: it is a small mockup the
 * model authored for that decision, which is the one part of this page that
 * cannot be templated. Because it is raw markup, the read-back never trusts the
 * page's structure: options are identified by `input.optIn` under their own
 * `.opt`, and `.choice` cards are collected document-wide, so a preview whose
 * tags don't balance can't hijack an answer or drop a later question.
 *
 * Approve copies:
 *   { decision:"stories", edited, epic, name, summary,
 *     stories:[{title,plainSummary,acceptanceCriteria,manualTestChecklist}],
 *     nonGoals, designChoices }
 *
 * `edited` covers the design-choice answers as well as the stories and non-goals:
 * picking a non-recommended option is an edit, and the orchestrator only folds
 * `designChoices` into the build when `edited` is true, so leaving them out of the
 * comparison would silently discard the one thing the section exists to capture.
 * It is computed by snapshotting the page's own reader at load, so there is only
 * one definition of what the page says and nothing to keep in sync.
 */
'use strict';

const { page, escapeHtml, jsonForScript, readPayload, resolveOutputPath, emit, runCli } = require('./lib/review-page');

const listItem = (text) => `<li contenteditable>${escapeHtml(text)}</li>`;

function storyCard(story) {
  const acceptanceCriteria = story.acceptanceCriteria || [];
  const manualTests = story.manualTestChecklist || [];
  const meta = [story.scopeCue, (story.roles || []).join(', ')].filter(Boolean).join(' · ');
  // Not `draggable` here: wireDrag turns it on only while the ⠿ handle is held, so
  // the contenteditable fields inside keep their own drag-to-select behaviour.
  return `<div class="card story">
  <div class="row">
    <span class="drag" title="Drag to reorder">⠿</span>
    <span class="muted n"></span>
    <div class="grow">
      <h3 contenteditable class="title">${escapeHtml(story.title || '')}</h3>
      ${story.isInfrastructureOnly ? '<div class="small muted"><em>Under the hood — nothing to click; the next step proves it works.</em></div>' : ''}
      <div class="summary" contenteditable>${escapeHtml(story.plainSummary || '')}</div>
      ${meta ? `<div class="small muted" style="margin-top:.35rem">${escapeHtml(meta)}</div>` : ''}
      <details>
        <summary>Detail — what "done" means, and what you'll check</summary>
        <div>
          <div class="small muted">Done when:</div>
          <ul class="tight ac">${acceptanceCriteria.map(listItem).join('')}</ul>
          <div class="small muted">You'll check:</div>
          <ul class="tight mt">${manualTests.map(listItem).join('')}</ul>
        </div>
      </details>
    </div>
    <div class="actions">
      <button class="icon" onclick="moveCard(this.closest('.story'),-1)" title="Move up">↑</button>
      <button class="icon" onclick="moveCard(this.closest('.story'),1)" title="Move down">↓</button>
      <button class="icon" onclick="splitStory(this.closest('.story'))" title="Split into two">⑂</button>
      <button class="icon" onclick="this.closest('.story').remove();renumber()" title="Remove">✕</button>
    </div>
  </div>
</div>`;
}

/** One option shape. A bare string is accepted here so nothing downstream has to. */
const asOption = (option) => (typeof option === 'string' ? { label: option } : option || {});

function choiceBlock(choice, choiceIndex) {
  const options = (choice.options || []).map(asOption);
  // The pre-selected option is the recommended one, falling back to the first when
  // the payload names none, or names one that isn't in the list.
  const recommendedIndex = options.findIndex((option) => option.label === choice.recommended);
  const selectedIndex = recommendedIndex >= 0 ? recommendedIndex : 0;
  const optionsHtml = options
    .map((option, optionIndex) => {
      // The preview sits outside the <label> on purpose: a mockup carries its own
      // interactions (and sometimes its own labels), and both break when nested
      // inside a label that forwards every click to the radio.
      // `optIn` marks the real option control. The preview alongside it is
      // model-authored markup that may carry its own inputs — some of them
      // pre-checked — so the read-back has to identify this radio positively
      // rather than taking the first checked input in the card.
      return `<div class="opt${optionIndex === selectedIndex ? ' sel' : ''}">
      <label><input class="optIn" type="radio" name="dc${choiceIndex}" value="${escapeHtml(option.label)}"${optionIndex === selectedIndex ? ' checked' : ''}
             onchange="pickOption(this)"> <b>${escapeHtml(option.label)}</b></label>
      ${option.previewHtml ? `<div class="preview">${option.previewHtml}</div>` : ''}
    </div>`;
    })
    .join('\n');
  return `<div class="card choice">
  <h3 class="q">${escapeHtml(choice.question)}</h3>
  ${choice.screen ? `<div class="small muted screen">${escapeHtml(choice.screen)}</div>` : ''}
  ${optionsHtml}
</div>`;
}

function render(payload) {
  const stories = Array.isArray(payload.stories) ? payload.stories : [];
  const nonGoals = payload.nonGoals || [];
  const choices = payload.designChoices || [];
  const position = payload.position;

  const body = `
<div id="stories">${stories.map(storyCard).join('\n')}</div>
<p><button onclick="addStory()">+ Add a step</button></p>

${
  choices.length
    ? `<h2 style="margin-top:2.2rem;font-size:1.15rem">A couple of choices for you</h2>
<p class="small muted">Everything else we could decide from your brief and design — these are the ones worth your call.</p>
<div id="choices">${choices.map(choiceBlock).join('\n')}</div>`
    : ''
}

${
  nonGoals.length
    ? `<h2 style="margin-top:2.2rem;font-size:1.15rem">Not in this piece</h2>
<p class="small muted">In case you expected any of these:</p>
<ul class="tight" id="nongoals">${nonGoals.map(listItem).join('')}</ul>`
    : ''
}

<p class="small muted" style="margin-top:2rem">Edit anything above, reorder with the handles or arrows,
split a step that's too big, then choose Approve. Approve copies your version to the clipboard —
paste it into the chat and the build starts from exactly that.</p>
<!-- The blank card "+ Add a step" and Split clone. Rendered from the same template
     as the real cards so the two can never drift apart. -->
<template id="tpl-story">${storyCard({ acceptanceCriteria: [''], manualTestChecklist: [''] })}</template>`;

  const footer = `<button class="primary" onclick="approve()">Approve &amp; build</button>
<button onclick="approve()">Copy again</button>`;

  const script = `
var LIST=document.getElementById('stories');
function renumber(){renumberIn(LIST)}
function pickOption(input){
  var group=input.closest('.choice');
  Array.prototype.forEach.call(group.querySelectorAll('.opt'),function(option){option.classList.remove('sel')});
  input.closest('.opt').classList.add('sel');
}
function blankStory(title,summary){
  var card=document.getElementById('tpl-story').content.firstElementChild.cloneNode(true);
  card.querySelector('.title').textContent=title||'New step';
  card.querySelector('.summary').textContent=summary||'What the user gets';
  return card;
}
function addStory(){var card=blankStory();LIST.appendChild(card);
  renumber();card.querySelector('.title').focus()}
function splitStory(card){
  var title=textOf(card.querySelector('.title'));
  card.querySelector('.title').textContent=title+' (part 1)';
  var secondPart=blankStory(title+' (part 2)',textOf(card.querySelector('.summary')));
  card.parentNode.insertBefore(secondPart,card.nextSibling);renumber();
}
/* One reader for the whole page. ORIGINAL is a snapshot of it taken at load, so
   the "did the user change anything" comparison comes from a single definition of
   what the page says — there is no second, hand-written copy of these shapes to
   drift out of agreement with this one. */
function current(){
  return {
    stories:Array.prototype.map.call(LIST.querySelectorAll('.story'),function(card){
      return {title:textOf(card.querySelector('.title')),plainSummary:textOf(card.querySelector('.summary')),
        acceptanceCriteria:listOf(card,'.ac li'),manualTestChecklist:listOf(card,'.mt li')};
    }),
    nonGoals:listOf(document,'#nongoals li'),
    /* Not scoped to #choices: a preview whose markup doesn't balance can close the
       container early, which would drop every later choice from the hand-off while
       the user still sees and answers it on the page. */
    designChoices:Array.prototype.map.call(document.querySelectorAll('.choice'),function(choice){
      var picked=choice.querySelector(':scope > .opt > label > input.optIn:checked');
      return {question:textOf(choice.querySelector('.q')),screen:textOf(choice.querySelector('.screen'))||null,
        answer:picked?picked.value:null};
    })
  };
}
function approve(){
  var pageContent=current();
  handoff({decision:'stories',edited:JSON.stringify(pageContent)!==ORIGINAL,
    epic:${jsonForScript(payload.epic || null)},name:${jsonForScript(payload.name || null)},
    summary:${jsonForScript(payload.summary || null)},
    stories:pageContent.stories,nonGoals:pageContent.nonGoals,designChoices:pageContent.designChoices},'stories');
}
wireDrag(LIST,'.story');renumber();
var ORIGINAL=JSON.stringify(current());`;

  return page({
    title: `${payload.name || 'Epic'} — plan`,
    heading: payload.name || 'This piece of work',
    pill: position ? `Piece ${position.index} of ${position.total}${position.completed ? ` · ${position.completed} done` : ''}` : undefined,
    lede: payload.summary || 'Here’s what we’ll build, step by step.',
    progress: position && position.total ? (position.completed || 0) / position.total : undefined,
    body,
    footer,
    script,
  });
}

runCli(() => {
  // Resolve the destination before doing the work, so a missing --out is reported as one.
  const pagePath = resolveOutputPath(process.argv);
  emit(render(readPayload(process.argv)), pagePath);
});

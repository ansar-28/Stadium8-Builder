#!/usr/bin/env node
/**
 * render-manual-tests.js
 *
 * Renders the manual-test check-off page shown at the manual-test approval
 * (commands/continue.md Step B7.1). Always the primary path — the in-chat checklist is the
 * fallback when this can't be generated or opened.
 *
 * Usage:
 *   node .claude/scripts/render-manual-tests.js --in <payload.json> --out <path>
 *   node .claude/scripts/render-manual-tests.js --in - --out <path>   # payload on stdin
 *
 * --out is required: the page belongs next to the epic it checks off
 * (generated-docs/epics/<slug>/manual-tests.html). Relative paths resolve
 * against the repo root.
 *
 * Payload:
 *   {
 *     epic, name, appUrl?,
 *     unverifiedAssumptions?: [string | { text, priorPassed? }],   // "check these first"
 *     logins?: [{ role, email, password? }],
 *     groups: [{                                  // ordered to minimise persona-switching
 *       role?, stories: [{ story, tests: [{ text, setup?, priorPassed? }] }]
 *     }]
 *   }
 *
 * Ordering is the caller's job: group same-role tests together and put the one
 * sign-out/sign-in for another role in a single section at the end. This script
 * renders the order it is given.
 *
 * `priorPassed` pre-ticks a check on a re-display after a fix cycle, so the user
 * re-verifies only what the fix touched. On first display nothing is ticked. A
 * ledger item carries it the same way, as `{ text, priorPassed }`; passed as a
 * bare string it is simply a check with nothing confirmed yet.
 *
 * Status logic: ticked → Pass (a note just annotates it); unticked + note →
 * Fail; unticked + no note → To do. "Mark the rest passed" ticks only the To do
 * rows, so a user who reports their failures first keeps them. Comment fields are hidden behind a quiet
 * "✎ Add a note" control rather than shown per test, so the passing majority
 * costs no vertical space.
 *
 * Done copies:
 *   { decision:"manual-test-results", epic, allPassed, summary,
 *     failed:[{kind,story,test,comment}], todo:[{kind,story,test}],
 *     results:[{kind,story,test,passed,comment}] }
 *
 * `failed` and `todo` are kept apart because they need different handling: a
 * failure carries what the user saw and goes to the fix cycle, while a check they
 * simply didn't get to carries nothing to act on. Folding to-dos into `failed`
 * turned every skipped check into a bug report with an empty comment.
 * `allPassed` requires both to be empty.
 *
 * `kind` is `"story"` or `"assumption"`, so the orchestrator can tell a failed
 * check-these-first item from a failed story check without pattern-matching the
 * text. An assumption row has `story: null` — it belongs to no story.
 */
'use strict';

const { randomUUID } = require('crypto');
const { page, escapeHtml, jsonForScript, roleColorer, readPayload, resolveOutputPath, emit, runCli } = require('./lib/review-page');

/**
 * `kind` travels with the row so the orchestrator doesn't have to infer what
 * failed. A ledger row belongs to no story, so it carries `story: null` rather
 * than a sentinel that would otherwise reach `state.json` and be matched against
 * the epic's real story names.
 */
function testRow(test, story, kind) {
  const checkedAttribute = test.priorPassed ? ' checked' : '';
  return `<div class="t" data-kind="${kind}"${story ? ` data-story="${escapeHtml(story)}"` : ''}>
  <label class="check">
    <input type="checkbox"${checkedAttribute} onchange="tally();save()">
    <span class="grow"><span class="txt">${escapeHtml(test.text)}</span>
      ${test.setup ? `<details><summary>Setup for this check</summary><div class="small">${escapeHtml(test.setup)}</div></details>` : ''}
    </span>
  </label>
  <div class="noteWrap"><button class="icon" onclick="toggleNote(this)">✎ Add a note</button></div>
</div>`;
}

function group(roleGroup, colourOf) {
  const heading = roleGroup.role
    ? `<h2 style="margin:2rem 0 .3rem;font-size:1.1rem">
         <span class="chip"><span class="dot" style="background:${colourOf(roleGroup.role)}"></span><b>${escapeHtml(roleGroup.role)}</b></span>
       </h2>`
    : '';
  const stories = (roleGroup.stories || [])
    .map(
      (storyEntry) => `<div class="card">
    <h3>${escapeHtml(storyEntry.story)}</h3>
    ${(storyEntry.tests || []).map((test) => testRow(test, storyEntry.story, 'story')).join('')}
  </div>`
    )
    .join('\n');
  return heading + stories;
}

/**
 * Only http(s) reaches the "Open the app" button.
 *
 * It is the page's most prominent control and the one the user is told to click,
 * and `escapeHtml()` stops an attribute break-out but not a `javascript:` URL — which
 * would run in a page that holds the epic's results and clipboard access.
 */
function appLink(appUrl) {
  if (!/^https?:\/\//i.test(String(appUrl || ''))) return '';
  return `<a class="primary" style="text-decoration:none;display:inline-block" href="${escapeHtml(appUrl)}" target="_blank" rel="noopener">Open the app ↗</a>`;
}

function render(payload) {
  const unverifiedAssumptions = payload.unverifiedAssumptions || [];
  const logins = payload.logins || [];
  const groups = payload.groups || [];
  // One colour per role for the whole page, so a role reads the same in the login
  // chips and in the section headings.
  const colourOf = roleColorer([...groups.map((roleGroup) => roleGroup.role), ...logins.map((login) => login.role)]);

  const ledger = unverifiedAssumptions.length
    ? `<div class="card ledger">
  <h2>⚠️ Check these first</h2>
  <p class="small" style="margin:.2rem 0 .6rem">We couldn't verify these against your real backend automatically — they're the most likely things to be wrong.</p>
  ${unverifiedAssumptions
    .map((assumption) => (typeof assumption === 'string' ? { text: assumption } : assumption))
    .map((assumption) => testRow(assumption, null, 'assumption'))
    .join('')}
</div>`
    : '';

  // One password line when every login shares one; otherwise each chip carries its
  // own, because a single line would show one role's password as if it were all.
  const passwords = [...new Set(logins.map((login) => login.password).filter(Boolean))];
  const sharedPassword = passwords.length === 1 && logins.every((login) => login.password) ? passwords[0] : null;
  const loginChips = logins.length
    ? `<div class="card">
  <h3>Signing in</h3>
  <p class="small muted" style="margin:.2rem 0 .5rem">Click a login to copy the email.</p>
  ${logins
    .map((login) => {
      const colour = colourOf(login.role);
      // A login with no role gets no dot and no empty bold — otherwise the chip
      // reads as an unlabelled coloured blob next to an email.
      const badge = login.role
        ? `<span class="dot" style="background:${colour}"></span>
      <b style="color:${colour}">${escapeHtml(login.role)}</b>`
        : '';
      return `<span class="chip" style="cursor:pointer" data-copy="${escapeHtml(login.email)}"
      onclick="copyText(this.dataset.copy)" title="Copy email">
      ${badge}
      <span class="em">${escapeHtml(login.email)}</span>${!sharedPassword && login.password ? `<span class="em">/ ${escapeHtml(login.password)}</span>` : ''}⧉</span>`;
    })
    .join('')}
  ${sharedPassword ? `<p class="small muted" style="margin-top:.5rem">Password: <code>${escapeHtml(sharedPassword)}</code></p>` : ''}
</div>`
    : '';

  const body = `
<div class="card">
  <div class="row" style="align-items:center">
    <div class="grow">
      ${appLink(payload.appUrl)}
      <div class="small muted" style="margin-top:.5rem">Not running? Start it with <code>(cd web &amp;&amp; npm run dev)</code></div>
    </div>
    <button onclick="markAll()">Mark the rest passed</button>
  </div>
</div>
${loginChips}
${ledger}
${groups.map((roleGroup) => group(roleGroup, colourOf)).join('\n')}
<p class="small muted" style="margin-top:2rem">Tick what works. If something's wrong, leave it unticked and
add a note saying what you saw — that's how it gets fixed. Then choose Done; it copies your results to the
clipboard for you to paste into the chat.</p>`;

  const footer = `<span class="tally" id="tallyBox"></span>
<button class="primary" onclick="done()">Done</button>
<button onclick="done()">Copy again</button>`;

  /* Minted per render rather than derived from the payload: a re-render whose checks
     happen to match the last one must still discard that page's saved ticks. */
  const renderId = randomUUID();
  const storeKey = `stadium8-manual-${payload.epic || 'epic'}`;

  const script = `
/* The address is the whole point of the chip, so a blocked clipboard has to show it
   rather than leave the click looking like it did nothing. */
function copyText(text){
  function showForManualCopy(){flash(text+' — select and copy it')}
  if(navigator.clipboard&&window.isSecureContext)
    navigator.clipboard.writeText(text).then(function(){flash('Copied '+text)},showForManualCopy);
  else showForManualCopy();
}
/* Hiding, not removing: this is the only free-text field on the page and the only
   thing the fix cycle has to go on, and the control sits where the user just
   clicked — so a second click must not discard what they typed. */
function toggleNote(button){
  var noteWrap=button.parentNode,note=noteWrap.querySelector('textarea');
  if(note){
    var hide=note.style.display!=='none';
    note.style.display=hide?'none':'';
    button.textContent=hide?(note.value.trim()?'✎ Show my note':'✎ Add a note'):'× hide note';
    if(!hide)note.focus();
    tally();save();return;
  }
  addNote(noteWrap).focus();tally();save();
}
/* One definition of how a note is built, so a note restored on load is the same
   thing the "✎ Add a note" control makes. */
function addNote(noteWrap){
  var note=document.createElement('textarea');note.className='note';
  note.placeholder='What did you see instead?';
  /* Only the empty <-> non-empty transition can change the tally, so a recount per
     keystroke would re-walk every row on the page to produce the same three
     numbers. Track this note's own state and recount only when it flips. The flag
     lives on the element so a restored note starts from what it actually holds. */
  note.addEventListener('input',function(){
    var hasText=!!note.value.trim();
    if(hasText!==(note.dataset.filled==='1')){note.dataset.filled=hasText?'1':'0';tally()}
    save();
  });
  noteWrap.appendChild(note);noteWrap.querySelector('button').textContent='× hide note';
  return note;
}
/* The .t set is fixed once the page is rendered — toggleNote only adds a textarea
   inside a row — so the list is built once instead of per interaction. */
var ROWS=Array.prototype.slice.call(document.querySelectorAll('.t'));
function rows(){return ROWS}
/* The page is a file on disk, so closing it would otherwise lose every tick and
   every note written before Done was pressed. RENDER_ID is minted once per render:
   reopening the same file restores what was there, while a page the orchestrator
   re-rendered after a fix cycle ignores it and starts from the pre-ticks it set. */
var RENDER_ID=${jsonForScript(renderId)},STORE_KEY=${jsonForScript(storeKey)};
function save(){
  try{localStorage.setItem(STORE_KEY,JSON.stringify({renderId:RENDER_ID,rows:rows().map(function(row){
    var note=row.querySelector('textarea');
    return {checked:row.querySelector('input[type=checkbox]').checked,note:note?note.value:null};
  })}))}catch(error){}
}
function restore(){
  var saved=null;
  try{saved=JSON.parse(localStorage.getItem(STORE_KEY))}catch(error){}
  if(!saved||saved.renderId!==RENDER_ID||!saved.rows||saved.rows.length!==rows().length)return;
  rows().forEach(function(row,index){
    var savedRow=saved.rows[index];if(!savedRow)return;
    row.querySelector('input[type=checkbox]').checked=!!savedRow.checked;
    if(savedRow.note){
      var note=addNote(row.querySelector('.noteWrap'));
      note.value=savedRow.note;note.dataset.filled=savedRow.note.trim()?'1':'0';
    }
  });
}
/* Counting only — never reads a row's text, so typing in a note doesn't force a
   layout for every check on the page. readRow() is for the hand-off. */
function counts(){
  var passed=0,failed=0,todo=0;
  rows().forEach(function(row){
    var note=row.querySelector('textarea');
    if(row.querySelector('input[type=checkbox]').checked)passed++;
    else if(note&&note.value.trim())failed++;
    else todo++;
  });
  return {passed:passed,failed:failed,todo:todo};
}
function readRow(row){
  var checkbox=row.querySelector('input[type=checkbox]'),note=row.querySelector('textarea');
  return {kind:row.dataset.kind,story:row.dataset.story||null,test:textOf(row.querySelector('.txt')),
    passed:checkbox.checked,comment:note&&note.value.trim()?note.value.trim():null};
}
function tally(){
  var totals=counts();
  document.getElementById('tallyBox').innerHTML=
    '<b>'+totals.passed+'</b> passed · <b>'+totals.failed+'</b> failed · <b>'+totals.todo+'</b> to do';
}
/* Leaves any check carrying a note alone. That note is the user's failure report,
   and ticking it files the check as a pass, so the failure reaches neither the
   fix cycle nor the to-do list. Tick such a check by hand to pass it anyway. */
function markAll(){rows().forEach(function(row){
  var note=row.querySelector('textarea');
  if(note&&note.value.trim())return;
  row.querySelector('input[type=checkbox]').checked=true});tally();save()}
function done(){
  var results=rows().map(readRow);
  var failed=results.filter(function(result){return !result.passed&&result.comment});
  var todo=results.filter(function(result){return !result.passed&&!result.comment});
  handoff({decision:'manual-test-results',
    epic:${jsonForScript(payload.epic || null)},
    allPassed:failed.length===0&&todo.length===0,
    summary:results.length+' checks, '+(results.length-failed.length-todo.length)+' passed, '+
      failed.length+' failed, '+todo.length+' not checked',
    failed:failed.map(function(result){return {kind:result.kind,story:result.story,test:result.test,comment:result.comment}}),
    todo:todo.map(function(result){return {kind:result.kind,story:result.story,test:result.test}}),
    results:results},'manual-test-results');
}
restore();tally();`;

  const checkCount =
    unverifiedAssumptions.length +
    groups.reduce(
      (groupTotal, roleGroup) =>
        groupTotal +
        (roleGroup.stories || []).reduce((storyTotal, storyEntry) => storyTotal + (storyEntry.tests || []).length, 0),
      0
    );

  return page({
    title: `${payload.name || 'Epic'} — try it out`,
    heading: 'Your turn — try it out',
    pill: `${checkCount} quick check${checkCount === 1 ? '' : 's'}`,
    lede: `Everything automated has passed for ${payload.name || 'this piece'}. This is the last step before it ships.`,
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

'use strict';

/**
 * Shared chrome for the three generated review pages — the epic-plan review,
 * the per-epic stories review, and the manual-test check-off page.
 *
 * These pages used to be described in prose in .claude/shared/approval-pattern.md
 * and rebuilt from that description on every run, which made them a per-run
 * output cost and let their look drift between epics. They must render
 * identically every time, so per CLAUDE.md they are a script.
 *
 * Everything here is inlined into a single self-contained file: no CDN, no
 * external stylesheet, no fonts. The pages are opened straight from disk in the
 * external browser (open-page.js) — the VS Code Simple Browser blocks the
 * clipboard write the Approve/Done buttons depend on.
 */

const fs = require('fs');
const path = require('path');
const { escapeHtml } = require('./html-escape');
const { getProjectRoot } = require('./project-root');
const { requireValue } = require('../resolve-state-path');

/**
 * Visual style for every review page.
 *
 * Light, calm and airy: light background, dark slate text, one accent, soft
 * white cards with generous whitespace, and a hover that deepens a card's
 * shadow without moving it. Editable fields read as plain text at rest — the
 * affordance appears on hover/focus, so the page looks like a document rather
 * than a form.
 */
const STYLE = `
:root{
  --bg:#f6f7f9; --card:#fff; --ink:#1e293b; --muted:#64748b; --line:#e2e8f0;
  --accent:#2563eb; --accent-soft:#eff6ff; --ok:#059669; --warn:#b45309; --bad:#dc2626;
  --radius:10px; --shadow:0 1px 2px rgba(15,23,42,.04),0 4px 12px rgba(15,23,42,.06);
}
*{box-sizing:border-box}
body{margin:0;padding:0 0 5rem;background:var(--bg);color:var(--ink);
  font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:52rem;margin:0 auto;padding:2.5rem 1.25rem}
header.page{margin-bottom:2rem}
header.page h1{margin:.25rem 0 .35rem;font-size:1.6rem;letter-spacing:-.015em}
.lede{color:var(--muted);margin:0}
.pill{display:inline-block;font-size:.75rem;font-weight:600;letter-spacing:.02em;
  text-transform:uppercase;color:var(--accent);background:var(--accent-soft);
  padding:.25rem .6rem;border-radius:999px}
.bar{height:4px;background:var(--line);border-radius:999px;overflow:hidden;margin:1rem 0 .4rem}
.bar>i{display:block;height:100%;background:var(--accent);border-radius:999px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
  padding:1.15rem 1.25rem;margin:.75rem 0;box-shadow:var(--shadow);
  transition:box-shadow .12s ease}
/* Shadow only — no transform. A translateY lift re-rasterises the card's text at a
   sub-pixel offset, and on a page this text-dense it reads as the whole card twitching
   rather than as a deliberate hover effect. The deeper shadow is affordance enough. */
.card:hover{box-shadow:0 2px 4px rgba(15,23,42,.05),0 8px 20px rgba(15,23,42,.08)}
.card h3{margin:0 0 .3rem;font-size:1.02rem}
.row{display:flex;align-items:flex-start;gap:.75rem}
.grow{flex:1;min-width:0}
.muted{color:var(--muted)}
.small{font-size:.85rem}
[contenteditable]{border-radius:6px;padding:.1rem .3rem;margin:-.1rem -.3rem;
  outline:none;transition:background .12s ease,box-shadow .12s ease}
[contenteditable]:hover{background:#f8fafc;box-shadow:inset 0 0 0 1px var(--line)}
[contenteditable]:focus{background:#fff;box-shadow:inset 0 0 0 2px var(--accent)}
details{margin-top:.7rem}
summary{cursor:pointer;color:var(--muted);font-size:.85rem;user-select:none}
summary:hover{color:var(--accent)}
details>div{padding:.6rem 0 .1rem}
ul.tight{margin:.35rem 0;padding-left:1.15rem}
ul.tight li{margin:.2rem 0}
button{font:inherit;cursor:pointer;border-radius:7px;border:1px solid var(--line);
  background:#fff;color:var(--ink);padding:.32rem .6rem;transition:all .12s ease}
button:hover{border-color:var(--accent);color:var(--accent)}
button.icon{padding:.2rem .45rem;color:var(--muted);font-size:.85rem}
.primary{background:var(--accent);border-color:var(--accent);color:#fff;
  padding:.6rem 1.4rem;font-weight:600;font-size:.98rem}
.primary:hover{background:#1d4ed8;border-color:#1d4ed8;color:#fff}
.actions{display:flex;gap:.4rem;flex-shrink:0}
.footer{position:fixed;left:0;right:0;bottom:0;background:rgba(255,255,255,.94);
  backdrop-filter:blur(6px);border-top:1px solid var(--line);padding:.85rem 1.25rem}
.footer .inner{max-width:52rem;margin:0 auto;display:flex;align-items:center;
  gap:1rem;justify-content:flex-end;flex-wrap:wrap;position:relative}
.toast{position:absolute;right:0;bottom:calc(100% + 1.35rem);pointer-events:none;
  background:var(--card);border:1px solid var(--line);border-radius:7px;box-shadow:var(--shadow);
  padding:.35rem .75rem;opacity:0;transition:opacity .2s ease;color:var(--ok);font-weight:600;font-size:.9rem}
.toast.on{opacity:1}
.ledger{background:#fffbeb;border-color:#fde68a}
.ledger h2{margin:0 0 .5rem;font-size:1rem;color:var(--warn)}
.drag{cursor:grab;color:#cbd5e1;user-select:none;padding-top:.15rem}
.drag:active{cursor:grabbing}
li.dragging,.card.dragging{opacity:.45}
label.check{display:flex;gap:.6rem;align-items:flex-start;cursor:pointer;padding:.3rem 0}
label.check input{margin-top:.35rem;width:1.05rem;height:1.05rem;accent-color:var(--accent);flex-shrink:0}
.note{width:100%;margin-top:.4rem;font:inherit;font-size:.9rem;padding:.5rem .6rem;
  border:1px solid var(--line);border-radius:7px;resize:vertical;min-height:3.2rem}
.chip{display:inline-flex;align-items:center;gap:.45rem;border:1px solid var(--line);
  border-radius:999px;padding:.3rem .7rem;margin:.2rem .3rem .2rem 0;background:#fff;font-size:.87rem}
.chip b{font-weight:600}
.chip .dot{width:.55rem;height:.55rem;border-radius:50%;flex-shrink:0}
.chip .em{color:var(--muted);font-size:.82rem}
.tally{font-variant-numeric:tabular-nums;font-size:.9rem;color:var(--muted);margin-right:auto}
.tally b{color:var(--ink)}
.opt{border:1px solid var(--line);border-radius:var(--radius);padding:.8rem .9rem;margin:.5rem 0}
.opt.sel{border-color:var(--accent);background:var(--accent-soft)}
.opt>label{display:block;cursor:pointer}
.opt .preview{margin-top:.6rem;padding:.7rem;background:#fff;border:1px dashed var(--line);border-radius:7px}
/* A preview is model-authored markup, so style the elements a mockup reaches for —
   otherwise two options rendering the same idea can look different for no reason. */
.preview table{border-collapse:collapse;font-size:.88rem}
.preview th,.preview td{border:1px solid var(--line);padding:.3rem .55rem;text-align:left}
.preview th{background:#f8fafc;font-weight:600}
.preview p:first-child{margin-top:0}
.preview p:last-child{margin-bottom:0}
@media print{.footer{position:static}.actions,.drag{display:none}}
`;

/** Clipboard write + confirmation, with a download fallback. Shared by all pages. */
const HANDOFF_JS = `
function flash(message){var toast=document.getElementById('toast');toast.textContent=message;toast.classList.add('on');
  setTimeout(function(){toast.classList.remove('on')},2600)}
function handoff(payload,name){
  var json=JSON.stringify(payload,null,2);
  function fallback(){
    try{
      var blob=new Blob([json],{type:'application/json'}),blobUrl=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=blobUrl;link.download=name+'.json';
      /* The anchor has to be in the document and the URL has to outlive the click:
         a detached anchor never downloads in Firefox, and revoking synchronously
         cancels the download mid-flight. This is the path that runs when the
         clipboard is blocked, so it has to actually produce the file. */
      link.style.display='none';document.body.appendChild(link);link.click();
      setTimeout(function(){URL.revokeObjectURL(blobUrl);link.remove()},1000);
      flash('Downloaded — paste the file contents into chat.');
    }catch(error){
      var popup=window.open('','_blank');
      if(popup){popup.document.write('<pre>'+json.replace(/</g,'&lt;')+'</pre>');flash('Copy the JSON shown, then paste it into chat.');}
      else flash('Could not copy — use "Copy again".');
    }
  }
  if(navigator.clipboard&&window.isSecureContext){
    navigator.clipboard.writeText(json).then(function(){flash('Copied — paste it into the chat to continue.')},fallback);
  }else{fallback()}
}
/* Reorder helpers shared by the two plan pages. renumberIn takes the list it
   renumbers, so moveCard and wireDrag renumber the container they already know
   rather than calling out to a same-named global each page has to remember to
   define — a contract a fourth page could only discover by reading the others. */
function renumberIn(list){Array.prototype.forEach.call(list.children,function(card,i){
  var numberLabel=card.querySelector('.n');if(numberLabel)numberLabel.textContent=(i+1)+'.'})}
function moveCard(card,direction){var list=card.parentNode,neighbour=direction<0?card.previousElementSibling:card.nextElementSibling;
  if(!neighbour)return; if(direction<0)list.insertBefore(card,neighbour); else list.insertBefore(neighbour,card); renumberIn(list);}
function wireDrag(container,cardSelector){
  var dragged=null;
  /* Cards are draggable only while the ⠿ handle is held. A permanently draggable
     card swallows the mousedown-drag gesture from every [contenteditable] inside
     it, so drag-selecting a phrase to retype it silently selects nothing — on a
     page whose whole promise is "edit anything above". */
  container.addEventListener('mousedown',function(event){
    var handle=event.target.closest('.drag');if(!handle)return;
    var card=handle.closest(cardSelector);if(card)card.draggable=true;
  });
  function release(){Array.prototype.forEach.call(container.querySelectorAll(cardSelector),
    function(card){card.draggable=false})}
  container.addEventListener('mouseup',release);
  container.addEventListener('dragstart',function(event){var card=event.target.closest(cardSelector);if(!card)return;
    dragged=card;card.classList.add('dragging');event.dataTransfer.effectAllowed='move';
    /* Firefox will not start a drag unless dragstart sets some data. */
    event.dataTransfer.setData('text/plain','')});
  container.addEventListener('dragend',function(){if(dragged)dragged.classList.remove('dragging');
    dragged=null;release();renumberIn(container)});
  container.addEventListener('dragover',function(event){event.preventDefault();
    var card=event.target.closest(cardSelector);if(!card||card===dragged||!dragged)return;
    var bounds=card.getBoundingClientRect();
    var insertBeforeNode=(event.clientY-bounds.top)/bounds.height>.5?card.nextSibling:card;
    /* Re-inserting a node at its current position still detaches and re-inserts
       it, which invalidates layout and makes cards oscillate under the cursor. */
    if(insertBeforeNode===dragged||insertBeforeNode===dragged.nextSibling)return;
    container.insertBefore(dragged,insertBeforeNode)});
  container.addEventListener('drop',function(event){event.preventDefault()});
}
/* textContent, not innerText: the acceptance criteria and manual-test lines live
   inside a collapsed <details>, and innerText returns "" for a subtree the
   browser isn't rendering. Reading innerText there handed back empty lists for
   every story and reported the page as edited when nobody had touched it.
   textContent is also layout-independent, so reading a row costs no reflow. */
function textOf(element){return element?element.textContent.replace(/\\s+/g,' ').trim():''}
function listOf(root,selector){return Array.prototype.map.call(root.querySelectorAll(selector),textOf).filter(Boolean)}
`;

/**
 * Wraps body content in the full self-contained document.
 *
 * @param {object} options
 * @param {string} options.title      document title
 * @param {string} options.heading    h1 text
 * @param {string} [options.pill]     small uppercase context pill (e.g. "Epic 3 of 4")
 * @param {string} [options.lede]     one-line framing under the heading
 * @param {number} [options.progress] 0..1, renders the momentum bar when present
 * @param {string} options.body       page markup
 * @param {string} options.footer     footer markup (the Approve/Done control)
 * @param {string} [options.script]   page-specific JS appended after the shared helpers
 */
function page(options) {
  // Number.isFinite, not typeof: NaN is a number and propagates through Math.round
  // into `width:NaN%`, which browsers discard — leaving an empty bar reading 0%
  // next to a pill that says otherwise.
  const progressBar = Number.isFinite(options.progress)
    ? `<div class="bar"><i style="width:${Math.max(0, Math.min(100, Math.round(options.progress * 100)))}%"></i></div>`
    : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(options.title)}</title><style>${STYLE}</style></head>
<body><div class="wrap">
<header class="page">
${options.pill ? `<span class="pill">${escapeHtml(options.pill)}</span>` : ''}
<h1>${escapeHtml(options.heading)}</h1>
${options.lede ? `<p class="lede">${escapeHtml(options.lede)}</p>` : ''}
${progressBar}
</header>
${options.body}
</div>
<div class="footer"><div class="inner">
${options.footer}
<span id="toast" class="toast"></span>
</div></div>
<script>${HANDOFF_JS}\n${options.script || ''}</script>
</body></html>`;
}

/**
 * JSON for embedding inside an inline <script> block.
 *
 * `JSON.stringify` alone is not safe here: the HTML parser ends the script at
 * the first `</script>`, so a story title or epic name containing one would
 * break out of the string and into markup. Escaping `<` (and the two line
 * separators JSON leaves bare but JS treats as line terminators) closes that.
 */
function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}


/** Collapses whitespace, so a role named with a stray newline still keys the same. */
function normaliseText(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Per-role accents, assigned by first appearance rather than hashed.
 *
 * Hashing the role name collided constantly on realistic role sets (Buyer and
 * Seller, Nurse and Patient), which defeats the point — the dot and the name are
 * the only thing telling two roles apart. Assigning by position is collision-free
 * up to the palette size. Keys are case- and whitespace-insensitive so a role
 * named slightly differently in `groups` and `logins` still gets one colour.
 */
const ROLE_COLORS = ['#2563eb', '#7c3aed', '#059669', '#b45309', '#db2777', '#0891b2'];
const roleKey = (role) => normaliseText(role).toLowerCase();
function roleColorer(roles) {
  const uniqueRoleKeys = [...new Set((roles || []).map(roleKey).filter(Boolean))];
  const colorByRoleKey = new Map(uniqueRoleKeys.map((key, i) => [key, ROLE_COLORS[i % ROLE_COLORS.length]]));
  return (role) => colorByRoleKey.get(roleKey(role)) || ROLE_COLORS[0];
}

/** The value of a `--flag value` pair, or null when the flag is absent. */
function flagValue(argv, flag) {
  const flagIndex = argv.indexOf(flag);
  return flagIndex >= 0 ? requireValue(argv, flagIndex + 1, flag) : null;
}

/**
 * Reads the JSON payload from `--in <path>`, or from stdin when the path is `-`.
 *
 * `--in` is required. Falling back to stdin whenever the flag was absent read a
 * pipe that nobody was writing to, so a forgotten `--in` didn't fail — it hung
 * until the tool timed out, stalling the approval it was supposed to open.
 */
function readPayload(argv) {
  const payloadPath = flagValue(argv, '--in');
  if (!payloadPath) throw new Error('--in <payload.json> is required (use --in - to read the payload from stdin)');
  return JSON.parse(fs.readFileSync(payloadPath === '-' ? 0 : payloadPath, 'utf8'));
}

/**
 * Resolves --out <path> against the repo root unless absolute.
 *
 * `fallbackRelativePath` is optional: the two epic-scoped pages have no sensible default
 * (they belong next to the epic's brief, and /plan writes them into a worktree),
 * so they omit it and fail loudly rather than write a stray page at a path
 * `.gitignore` doesn't cover.
 */
function resolveOutputPath(argv, fallbackRelativePath) {
  const requestedPath = flagValue(argv, '--out') || fallbackRelativePath;
  if (!requestedPath) throw new Error('--out <path> is required for this page (it is written next to the epic it reviews)');
  // `path.resolve` covers the absolute and repo-relative cases together and
  // normalises separators, the same way open-page.js resolves the path it opens.
  return path.resolve(getProjectRoot(), requestedPath);
}

/**
 * Runs a renderer's main body, turning a usage or payload error into the one-line
 * message + exit 2 the callers document.
 *
 * The helpers above throw rather than exiting: deciding that bad input should end
 * the process belongs to the entry point, not to a library three pages share.
 */
function runCli(main) {
  try {
    main();
  } catch (error) {
    process.stderr.write((error && error.message ? error.message : String(error)) + '\n');
    process.exit(2);
  }
}

/** Writes the page and prints the path, the contract every caller relies on. */
function emit(html, pagePath) {
  fs.mkdirSync(path.dirname(pagePath), { recursive: true });
  fs.writeFileSync(pagePath, html, 'utf8');
  process.stdout.write(JSON.stringify({ status: 'ok', page: pagePath }) + '\n');
}

module.exports = { page, escapeHtml, jsonForScript, roleColorer, readPayload, resolveOutputPath, emit, runCli };

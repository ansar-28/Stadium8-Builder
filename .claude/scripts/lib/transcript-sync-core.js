'use strict';
/**
 * transcript-sync-core.js
 *
 * Uploads this project's Claude Code transcripts to the Stadium receiver, one
 * append at a time. All of the logic lives here; `transcript-sync.js` is a thin
 * CLI over it and `transcript-sync-hook.js` only decides when to run it.
 *
 * Two invariants govern everything below:
 *
 *   NOTICE  A file is bound only during a sweep started by a session that
 *           showed the notice in that file's own project: `notices.json` holds
 *           that session against THAT project id. Every bound file uploads, so
 *           the gate is on binding, never on sending. A sweep without such a
 *           session binds nothing new, whoever runs it.
 *
 *   ISOLATION  A file's `projectId` and `receiverUrl` are bound ONCE, when its
 *           own project's session first discovers it, written into its state
 *           entry, and never re-derived. New files enter the state only through
 *           the current project's own strict-mode transcript directories (see
 *           transcript-store.js). A file already bound to another project is
 *           still uploaded when a sweep passes it — under its own identity, so
 *           the sweeping project's id appears nowhere in the request.
 *
 * Nothing secret ships here: `POST /v1/devices` is unauthenticated (rate
 * limited), and the credential it returns lives only in
 * `~/.stadium-builder/device.json`.
 *
 * Neither the log nor the state file ever holds transcript content: ids,
 * counts, offsets, status codes, hashes and basenames only.
 *
 * No npm dependencies: it runs under bare `node`. `createCore(dependencies)` takes
 * injectable `fetch`/`fs`/`env`/`now`/`git` for the tests.
 */

const nodeFs = require('fs');
const nodeOs = require('os');
const path = require('path');
const crypto = require('crypto');
const { tryGit: nodeTryGit } = require('./git');
const transcriptStore = require('./transcript-store');

/**
 * The receiver this template uploads to. `null` makes the whole feature inert:
 * no notice, no identity file, no request.
 *
 * `STADIUM_RECEIVER_URL` overrides it for testing against a local receiver; set
 * but empty, no new project is minted. A project that already has an identity
 * file keeps uploading to the receiver it names. /upgrade reads only the
 * constant.
 */
const DEFAULT_RECEIVER_URL = 'https://sbrx-receiver-6zuwcewqpqwq6.azurewebsites.net';

const SCHEMA_VERSION = 1;

/**
 * Azure's Append Block maximum, and so the receiver's `maxChunkBytes`. A longer
 * line is spilled to a blob (see readDelta).
 */
const MAX_CHUNK_BYTES = 4 * 1024 * 1024;

/**
 * 409s one file may take in one run before it is blocked as not converging.
 * Each legitimate one (a resync, or a roll) is followed by a 200.
 */
const MAX_CONFLICTS_PER_FILE = 10;

const DEFAULTS = {
  // Overridable so tests needn't write 4 MiB fixtures.
  maxChunkBytes: MAX_CHUNK_BYTES,
  // Per run, so a first catch-up spreads over several turns rather than
  // saturating the uplink.
  maxRunBytes: 64 * 1024 * 1024,
  maxRunMs: 120 * 1000,
  // Above the receiver's cold start (observed once at over 26 s, after a few
  // idle minutes), so waking it is not a timeout strike. Plus one second per
  // `minUploadBytesPerSec` of body, so a full chunk can land on a slow link.
  requestTimeoutMs: 60 * 1000,
  minUploadBytesPerSec: 64 * 1024,
  // So a request started at the end of a run's budget still ends inside
  // `lockStaleMs`.
  maxRequestMs: 5 * 60 * 1000,
  // After this many of our own timeouts in a row, per file or machine-wide,
  // uploads pause. Shorter than blockCooldownMs: a slow link changes in hours.
  maxTimeouts: 3,
  timeoutCooldownMs: 4 * 60 * 60 * 1000,
  // A write-once file this new may be half-written; it waits for the next run.
  minFileAgeMs: 5 * 1000,
  lockStaleMs: 10 * 60 * 1000,
  logMaxBytes: 256 * 1024,
  blockCooldownMs: 24 * 60 * 60 * 1000,
  // Sessions kept in notices.json; an evicted one sees the notice again at its
  // next prompt.
  maxNoticeSessions: 100,
  // Windows refuses a rename onto a file another process has open.
  renameAttempts: 5,
  renameRetryMs: 20,
  maxBlobBytes: 32 * 1024 * 1024,
  retries: 3,
  retryBaseMs: 1000,
};

const COLLECTION_FILE = 'transcript-collection.json';

/** The codes Windows gives a rename onto a file another process holds open. */
const RENAME_BUSY = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** No trailing slash, and null for unset or empty: run() compares receivers exactly. */
const normaliseReceiverUrl = (url) => (url || '').replace(/\/+$/, '') || null;

/**
 * Writes the identity file at `destination`, atomically. The one writer, shared by
 * initProject and /upgrade's applier so the record's shape cannot drift; each
 * caller checks its own preconditions.
 */
function mintCollectionFile(destination, rawReceiverUrl, dependencies = {}) {
  const fs = dependencies.fs || nodeFs;
  const uuid = dependencies.uuid || (() => crypto.randomUUID());
  const now = dependencies.now || (() => new Date());
  const receiverUrl = normaliseReceiverUrl(rawReceiverUrl);
  if (!receiverUrl) return { created: false, reason: 'not_configured' };
  const collection = {
    schemaVersion: SCHEMA_VERSION,
    projectId: uuid(),
    receiverUrl,
    createdAt: now().toISOString(),
  };
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const tempFile = `${destination}.${process.pid}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(collection, null, 2) + '\n');
  fs.renameSync(tempFile, destination);
  return { created: true, collection };
}

/**
 * The receiver's own uuid expression. Ids go into upload URLs, so anything else
 * is refused rather than put in a path.
 */
const isUuid = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

/**
 * A stored credential is believed only with a uuid id and a non-empty string
 * key. Any other key would earn a 401, which never re-registers; rejected here,
 * the machine registers afresh instead.
 */
const usableCredential = (device) =>
  Boolean(device) &&
  isUuid(device.machineId) &&
  typeof device.deviceKey === 'string' &&
  device.deviceKey !== '';

function createCore(dependencies = {}) {
  const fs = dependencies.fs || nodeFs;
  const env = dependencies.env || process.env;
  const now = dependencies.now || (() => new Date());
  const fetchFunction = dependencies.fetch || (typeof fetch === 'function' ? fetch : null);
  const tryGit = dependencies.git || nodeTryGit;
  const store = dependencies.store || transcriptStore;
  const uuid = dependencies.uuid || (() => crypto.randomUUID());
  const sleep = dependencies.sleep || ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const config = { ...DEFAULTS, ...(dependencies.config || {}) };

  // ---------------------------------------------------------------- local state

  /** Machine-wide, not per-project. `STADIUM_BUILDER_HOME` relocates it. */
  function home() {
    return env.STADIUM_BUILDER_HOME || path.join(nodeOs.homedir(), '.stadium-builder');
  }
  const devicePath = () => path.join(home(), 'device.json');
  const statePath = () => path.join(home(), 'sync-state.json');
  const lockPath = () => path.join(home(), 'sync.lock');
  const logPath = () => path.join(home(), 'sync.log');

  function readJson(file) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  }

  /**
   * Temp file and rename: hooks and children write concurrently, and a torn
   * device.json would lose the credential. A busy rename is retried briefly; one
   * that never lands removes its temp file.
   */
  function writeJsonAtomic(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tempFile = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(value, null, 2) + '\n');
    for (let attempt = 1; ; attempt += 1) {
      try {
        fs.renameSync(tempFile, file);
        return;
      } catch (error) {
        if (attempt >= config.renameAttempts || !RENAME_BUSY.has(error && error.code)) {
          try {
            fs.unlinkSync(tempFile);
          } catch {
            // Already gone; the rename's error is the one worth reporting.
          }
          throw error;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, config.renameRetryMs);
      }
    }
  }

  const readDevice = () => readJson(devicePath());

  /**
   * Read-modify-write: the whole file is re-read inside the call, because the
   * caller's copy may be seconds stale.
   */
  function updateDevice(mutate) {
    const current = readDevice();
    const next = mutate(current);
    if (next === undefined) return current;
    writeJsonAtomic(devicePath(), next);
    return next;
  }

  function readState() {
    const state = readJson(statePath());
    if (!state || typeof state !== 'object') {
      return { schemaVersion: SCHEMA_VERSION, files: {}, blocks: { device: null, projects: {} } };
    }
    state.files = state.files || {};
    state.blocks = state.blocks || { device: null, projects: {} };
    state.blocks.projects = state.blocks.projects || {};
    return state;
  }

  function writeState(state) {
    state.schemaVersion = SCHEMA_VERSION;
    state.updatedAt = now().toISOString();
    writeJsonAtomic(statePath(), state);
  }

  /** Windows paths are case-insensitive. */
  const foldCase = (filePath) => (process.platform === 'win32' ? filePath.toLowerCase() : filePath);

  /**
   * One canonical key per file, or an 8.3 short name or a symlink would make
   * the same transcript two entries and upload it twice. The native realpath
   * resolves both (the JS one keeps 8.3 names).
   */
  function stateKey(file) {
    let realPath;
    try {
      realPath = fs.realpathSync.native ? fs.realpathSync.native(file) : fs.realpathSync(file);
    } catch {
      realPath = path.resolve(file);
    }
    return foldCase(realPath);
  }

  // ------------------------------------------------------------------- logging

  /**
   * One JSON object per line, rotated at `logMaxBytes` into `sync.log.1`. The
   * only record of a detached run. Never transcript content (see the header).
   */
  function log(event, fields = {}) {
    try {
      const file = logPath();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      try {
        if (fs.statSync(file).size >= config.logMaxBytes) fs.renameSync(file, `${file}.1`);
      } catch {
        /* no log yet, or a rotate lost a race with the other child: keep going */
      }
      fs.appendFileSync(file, JSON.stringify({ at: now().toISOString(), event, ...fields }) + '\n');
    } catch {
      // Logging must never be the reason a sync fails.
    }
  }

  // ---------------------------------------------------------- project identity

  /**
   * The template dev repo, which never uploads. `.release-ignore` exists only
   * there; workflow-guard.js uses the same sentinel.
   */
  function isTemplateDevRepo(root) {
    return fs.existsSync(path.join(root, '.release-ignore'));
  }

  /**
   * The main worktree's root, so every worktree of a project shares one id.
   * `--git-common-dir` names the main checkout's `.git` even from a linked
   * worktree, where `--show-toplevel` would not.
   *
   * Git is asked only when `<root>/.git` is a file (a linked worktree's
   * `gitdir:` pointer): for any other layout the answer is `root`, and this
   * runs on every Stop. A `--separate-git-dir` checkout or submodule also has
   * a `.git` file, but its common dir is not named `.git`, so it falls back to
   * `root` too.
   */
  function mainWorktreeRoot(root) {
    let gitMarker;
    try {
      gitMarker = fs.statSync(path.join(root, '.git'));
    } catch {
      return root;
    }
    if (!gitMarker.isFile()) return root;
    const commonDir = tryGit(root, 'rev-parse', '--path-format=absolute', '--git-common-dir');
    if (!commonDir) return root;
    const gitDir = commonDir.replace(/[\\/]+$/, '');
    if (path.basename(gitDir) !== '.git') return root;
    return path.dirname(gitDir);
  }

  /**
   * Where this project's identity file is, or should be: in `root` if it is
   * there (one stat), else at the main worktree's root, so a linked worktree
   * uses the main checkout's id rather than minting its own.
   */
  function collectionPath(root) {
    const direct = path.join(root, COLLECTION_FILE);
    if (fs.existsSync(direct)) return direct;
    return path.join(mainWorktreeRoot(root), COLLECTION_FILE);
  }

  /**
   * The project's identity, or null if absent or its id is not a uuid.
   * Lowercased, as the receiver stores it.
   */
  function readCollection(root) {
    const collection = readJson(collectionPath(root));
    if (!collection || !isUuid(collection.projectId)) return null;
    return { ...collection, projectId: collection.projectId.toLowerCase() };
  }

  /** The receiver a newly minted project points at, or null if unset. */
  const defaultReceiverUrl = () =>
    normaliseReceiverUrl(
      env.STADIUM_RECEIVER_URL !== undefined ? env.STADIUM_RECEIVER_URL : DEFAULT_RECEIVER_URL,
    );

  /** Whether collection is switched on at all on this machine. */
  const isConfigured = () => Boolean(defaultReceiverUrl());

  /**
   * Mints `transcript-collection.json` at the main worktree root if absent.
   * Writes the file and nothing else: no network, no `git add` (the slash
   * commands commit it).
   */
  function initProject(root) {
    if (isTemplateDevRepo(root)) return { ok: false, reason: 'dev_repo' };
    const existing = readCollection(root);
    if (existing) return { ok: true, created: false, collection: existing };
    const destination = collectionPath(root);
    if (fs.existsSync(destination)) {
      // Present but unreadable, likely merge conflict markers: a new id would
      // orphan everything sent under the old one.
      log('project_unreadable', {});
      return { ok: false, reason: 'unreadable' };
    }
    const minted = mintCollectionFile(destination, defaultReceiverUrl(), { fs, uuid, now });
    if (!minted.created) return { ok: false, reason: minted.reason };
    log('project_initialised', { projectId: minted.collection.projectId });
    return { ok: true, created: true, collection: minted.collection };
  }

  // ---------------------------------------------------------------------- lock

  /**
   * One sync per machine at a time: two children would race into 409s, or both
   * register and split the machine into two device identities. A lock older
   * than `lockStaleMs` (its child was killed) is broken.
   */
  function acquireLock() {
    const file = lockPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const fd = fs.openSync(file, 'wx');
        fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: now().toISOString() }) + '\n');
        fs.closeSync(fd);
        return {
          release() {
            try {
              fs.unlinkSync(file);
            } catch {
              /* already gone */
            }
          },
        };
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let ageMs = 0;
        try {
          ageMs = now().getTime() - fs.statSync(file).mtimeMs;
        } catch {
          continue; // vanished between the open and the stat: try once more
        }
        if (ageMs < config.lockStaleMs) return null;
        log('lock_stale_broken', { ageMs: Math.round(ageMs) });
        try {
          fs.unlinkSync(file);
        } catch {
          /* the other child got there first */
        }
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ requests

  /** The flat allowance, plus the time the body takes at the floor rate, capped. */
  function timeoutFor(body) {
    const bytes = body ? Buffer.byteLength(body) : 0;
    const scaled = config.requestTimeoutMs + Math.ceil((bytes / config.minUploadBytesPerSec) * 1000);
    return Math.min(config.maxRequestMs, scaled);
  }

  /**
   * Our own timeout is tagged `timedOut` here, where it is certain, rather than
   * inferred from `AbortError` later. `send` never retries it; `run` counts it
   * towards a pause.
   */
  async function request(url, options) {
    if (!fetchFunction) throw new Error('no fetch available');
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutFor(options && options.body));
    try {
      let response;
      try {
        response = await fetchFunction(url, { ...options, signal: controller.signal });
      } catch (error) {
        if (!timedOut) throw error;
        throw Object.assign(new Error('request timed out'), { code: 'timeout', timedOut: true });
      }
      const text = await response.text().catch(() => '');
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      const header = (name) =>
        response.headers && typeof response.headers.get === 'function'
          ? response.headers.get(name)
          : null;
      return { status: response.status, ok: response.status >= 200 && response.status < 300, body, header };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * The blob length the receiver reports, from the header it sets on 200 and
   * 409 or else the JSON body. Null when neither has one (a proxy's error page,
   * say), which the caller turns into a visible block rather than a watermark
   * of `undefined` that silently stops the file.
   */
  function blobLength(response) {
    const candidates = [response.header('x-blob-length'), response.body && response.body.length];
    for (const candidate of candidates) {
      if (candidate === null || candidate === undefined || candidate === '') continue;
      const value = Number(candidate);
      if (Number.isInteger(value) && value >= 0) return value;
    }
    return null;
  }

  const safeUsername = () =>
    String(env.USERNAME || env.USER || 'unknown').slice(0, 120) || 'unknown';

  /**
   * Registers this machine, only when no usable credential is held (checked
   * under the machine lock), so one machine stays one device record.
   *
   * **The machineId that counts is the one in the response.** For an id it
   * already holds, the receiver mints and returns a fresh one; keeping the id
   * sent would 401 on every upload, and a 401 never re-registers.
   *
   * Called only before the first upload, so a machine with nothing to send
   * never contacts the receiver.
   */
  async function ensureDevice(receiverUrl) {
    const held = readDevice();
    if (usableCredential(held)) return held;
    if (held && held.deviceKey) log('device_record_unusable', { machineId: held.machineId });
    // A corrupt stored id is replaced, not sent forever. Lowercased as the
    // receiver stores it, or it would come back looking reissued.
    const stored = held && held.machineId;
    const requested = isUuid(stored) ? stored.toLowerCase() : uuid();
    const response = await request(`${receiverUrl}/v1/devices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ machineId: requested, username: safeUsername() }),
    });
    const issuedKey = response.body && response.body.deviceKey;
    const hasKey = typeof issuedKey === 'string' && issuedKey !== '';
    const issued = response.body && response.body.machineId;
    if (!response.ok || !hasKey || !isUuid(issued)) {
      // `reason` too: a 201 with no usable credential is still a failure.
      log('device_registration_failed', {
        status: response.status,
        reason: !response.ok ? 'refused' : hasKey ? 'bad_machine_id' : 'no_device_key',
      });
      return null;
    }
    const machineId = issued.toLowerCase();
    // Both ids: the only record joining blobs under the old id to the new one.
    if (machineId !== requested) log('device_id_reissued', { requestedMachineId: requested, machineId });
    return updateDevice((current) => ({
      schemaVersion: SCHEMA_VERSION,
      ...current,
      machineId,
      deviceKey: response.body.deviceKey,
      receiverUrl,
      username: safeUsername(),
      registeredAt: response.body.registeredAt || now().toISOString(),
    }));
  }

  // ------------------------------------------------------------------- notices

  /**
   * Sessions that have shown the notice, each against its project: written by
   * the prompt hook, read by the Stop hook and its child to decide which
   * sessions may bind new files. A session lost from it (a concurrent write,
   * eviction) sees the notice again at its next prompt.
   */
  const noticesPath = () => path.join(home(), 'notices.json');

  /** Only uuid sessions with a uuid project survive the read, so no key can be `__proto__`. */
  function readNotices() {
    const raw = readJson(noticesPath());
    const sessions = {};
    const stored = raw && typeof raw.sessions === 'object' && raw.sessions ? raw.sessions : {};
    for (const [sessionId, entry] of Object.entries(stored)) {
      if (!store.SESSION_ID.test(sessionId) || !entry || !isUuid(entry.projectId)) continue;
      sessions[sessionId] = { projectId: entry.projectId, emittedAt: entry.emittedAt };
    }
    return { schemaVersion: SCHEMA_VERSION, sessions };
  }

  /** The session's entry if it showed the notice in this project, else null. */
  function sessionNotice(sessionId, projectId) {
    if (!store.SESSION_ID.test(String(sessionId || '')) || !isUuid(projectId)) return null;
    const entry = readNotices().sessions[sessionId];
    return entry && entry.projectId === projectId ? entry : null;
  }

  /**
   * Re-inserted at the end, then trimmed from the front: session ids are never
   * integer-like, so key order is insertion order and the oldest go first.
   */
  function recordSessionNotice(sessionId, projectId, emittedAt) {
    if (!store.SESSION_ID.test(String(sessionId || '')) || !isUuid(projectId)) return false;
    const { sessions } = readNotices();
    delete sessions[sessionId];
    sessions[sessionId] = { projectId, emittedAt };
    const kept = {};
    for (const key of Object.keys(sessions).slice(-config.maxNoticeSessions)) kept[key] = sessions[key];
    writeJsonAtomic(noticesPath(), { schemaVersion: SCHEMA_VERSION, sessions: kept });
    return true;
  }

  // -------------------------------------------------------------------- upload

  /** `<uuid>`, then `<uuid>.g2` once a generation has rolled. */
  const sessionSegment = (entry) =>
    entry.generation > 0 ? `${entry.sessionId}.g${entry.generation + 1}` : entry.sessionId;

  /**
   * Write-once blobs stay on the plain session segment (`entry.sessionId`, not
   * sessionSegment): they never roll, so a rolled transcript must not move them.
   *
   * Known gap: a sub-agent `.jsonl` that rolls alone lands under `.g2` while its
   * `.meta.json` stays put. Rare, and fixing it needs the receiver too.
   */
  function uploadUrl(entry, machineId) {
    const base = entry.receiverUrl.replace(/\/+$/, '');
    const ids = `${entry.projectId}/${machineId}`;
    if (entry.kind === 'main') {
      return `${base}/v1/transcripts/${ids}/${sessionSegment(entry)}`;
    }
    if (entry.kind === 'subagent') {
      // The route takes the agent id, not the filename: the receiver appends
      // `.jsonl` itself when it builds the blob key.
      const agentId = entry.name.replace(/\.jsonl$/, '');
      return `${base}/v1/transcripts/${ids}/${sessionSegment(entry)}/subagents/${agentId}`;
    }
    // A .meta.json / tool-result PUT takes the full filename.
    const folder = entry.kind === 'meta' ? 'subagents' : 'tool-results';
    return `${base}/v1/blobs/${ids}/${entry.sessionId}/${folder}/${entry.name}`;
  }

  /**
   * A SHA-256 of the file's first line (never the line itself), to catch a file
   * replaced by different content of equal or greater length, which the size
   * check cannot see.
   *
   * A full window with no newline hashes the window, a stable prefix. A short
   * read with no newline is a first line still being written: null, so it is
   * not mistaken for a replacement.
   */
  function firstLineHashOf(file) {
    let fd;
    try {
      fd = fs.openSync(file, 'r');
    } catch {
      return null;
    }
    try {
      const buffer = Buffer.alloc(4096);
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
      const slice = buffer.subarray(0, bytesRead);
      const newline = slice.indexOf(0x0a);
      let line;
      if (newline !== -1) line = slice.subarray(0, newline);
      else if (bytesRead === buffer.length) line = slice;
      else return null;
      return crypto.createHash('sha256').update(line).digest('hex');
    } finally {
      fs.closeSync(fd);
    }
  }

  function rollGeneration(entry, why) {
    entry.generation = (entry.generation || 0) + 1;
    entry.watermark = 0;
    entry.remoteLength = 0;
    delete entry.spilled;
    log('generation_rolled', {
      sessionId: entry.sessionId,
      generation: entry.generation + 1,
      why,
    });
  }

  /**
   * `[watermark, size)` capped at one chunk and trimmed to the last newline,
   * because the receiver refuses a chunk that does not end on one.
   *
   *   { payload }      bytes to send
   *   { incomplete }   only a partial line so far; the next run picks it up
   *   { spill }        a complete line too long to append; it goes to a blob
   *   { oversized }    a line too long even for a blob; the file is blocked
   *
   * A full chunk with no newline may be a long line or one still being written,
   * so only a line whose newline is already on disk is spilled.
   */
  function readDelta(file, watermark, size) {
    const maxChunkBytes = config.maxChunkBytes;
    const wanted = Math.min(maxChunkBytes, size - watermark);
    if (wanted <= 0) return { incomplete: true };
    const fd = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(wanted);
      const bytesRead = fs.readSync(fd, buffer, 0, wanted, watermark);
      const slice = buffer.subarray(0, bytesRead);
      const lastNewline = slice.lastIndexOf(0x0a);
      if (lastNewline !== -1) return { payload: Buffer.from(slice.subarray(0, lastNewline + 1)) };
      if (bytesRead < maxChunkBytes) return { incomplete: true };
      // Stop scanning at the blob cap: past it the line can't be spilled anyway.
      const limit = Math.min(size, watermark + config.maxBlobBytes + 1);
      const end = findNewline(fd, watermark + bytesRead, limit);
      if (end === null) return limit < size ? { oversized: true } : { incomplete: true };
      const bytes = end - watermark; // the line itself, without its newline
      return { spill: { start: watermark, bytes, consumed: end + 1 - watermark } };
    } finally {
      fs.closeSync(fd);
    }
  }

  /**
   * Where the line ends, searching `[from, limit)`, or null. Read in windows:
   * the line is already larger than a 4 MiB chunk by the time we are here.
   */
  function findNewline(fd, from, limit) {
    const step = 256 * 1024;
    const buffer = Buffer.alloc(Math.min(step, Math.max(1, limit - from)));
    for (let position = from; position < limit; position += buffer.length) {
      const bytesRead = fs.readSync(fd, buffer, 0, Math.min(buffer.length, limit - position), position);
      if (bytesRead <= 0) return null;
      const found = buffer.subarray(0, bytesRead).indexOf(0x0a);
      if (found !== -1) return position + found;
    }
    return null;
  }

  /**
   * Whether a remote length can be a local read offset. Every chunk ends on a
   * newline, so one that doesn't land on a local newline means the counts have
   * diverged (e.g. a child killed after a spill's pointer landed but before the
   * state recorded it).
   */
  function onLineBoundary(file, offset) {
    if (offset === 0) return true;
    const fd = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(1);
      return fs.readSync(fd, buffer, 0, 1, offset - 1) === 1 && buffer[0] === 0x0a;
    } finally {
      fs.closeSync(fd);
    }
  }

  /**
   * The first line the receiver's `checkJsonLines` would refuse, or null. One
   * bad line refuses the whole chunk, and every resend would start there.
   */
  function firstInvalidLine(payload) {
    for (let start = 0; start < payload.length; ) {
      const end = payload.indexOf(0x0a, start);
      if (end === start) return { start, bytes: 0, reason: 'blank_line' };
      try {
        JSON.parse(payload.subarray(start, end).toString('utf8'));
      } catch {
        return { start, bytes: end - start, reason: 'invalid_json' };
      }
      start = end + 1;
    }
    return null;
  }

  /** The line's own bytes, without the newline that ends it. */
  function readLine(file, start, bytes) {
    const fd = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(bytes);
      return fs.readSync(fd, buffer, 0, bytes, start) === bytes ? buffer : null;
    } finally {
      fs.closeSync(fd);
    }
  }

  /**
   * Puts the line in `tool-results/` as a write-once blob and returns a pointer
   * line for the caller to append in its place, keeping the stored JSONL valid.
   *
   * The name comes from the offset and the line's hash, so after a crash
   * between the PUT and the pointer append the next run re-derives it and gets
   * `409 already_written`, which counts as success.
   */
  async function spillLine(uploadContext, entry, spill) {
    const body = readLine(entry.file, spill.start, spill.bytes);
    // Truncated between the scan and the read: leave it for the next run.
    if (!body) return { reason: 'partial_line' };
    if (uploadContext.budget.expired()) return { reason: 'budget' };

    const digest = crypto.createHash('sha256').update(body).digest('hex');
    const name = `spill-${spill.start}-${digest.slice(0, 16)}.txt`;
    const response = await send(
      uploadUrl({ ...entry, kind: 'tool-result', name }, uploadContext.machineId),
      {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${uploadContext.deviceKey}`,
          'content-type': 'text/plain',
        },
        body,
      },
      uploadContext.budget,
    );

    if (response.status === 409) {
      log('spill_already_written', { sessionId: entry.sessionId, name });
    } else if (!response.ok) {
      return { refusal: classify(response.status, errorOf(response)), status: response.status };
    } else {
      uploadContext.budget.spend(body.length);
      log('spilled', { sessionId: entry.sessionId, name, bytes: body.length, reason: spill.reason });
    }

    // `reason` marks a damaged line, as opposed to an oversized one.
    const pointer = { type: 'transcript-spill', spill: { name, bytes: body.length, sha256: digest } };
    if (spill.reason) pointer.reason = spill.reason;
    return { pointer: Buffer.from(JSON.stringify(pointer) + '\n') };
  }

  /**
   * What a refusal stops: one file, one project, this machine, or just this
   * attempt.
   *
   * A 401 never re-registers: that would mint a second identity and walk away
   * from a revocation. It blocks the device instead, which expires on its own.
   */
  function classify(status, error) {
    if (status === 401) return { scope: 'device', reason: error || 'unauthorized' };
    if (status === 403) {
      if (error === 'device_revoked') return { scope: 'device', reason: error };
      return { scope: 'project', reason: error || 'forbidden' };
    }
    if (status === 429) {
      if (error === 'rate_limited') return { scope: 'attempt', reason: error };
      if (error === 'project_quota_exceeded') return { scope: 'project', reason: error };
      return { scope: 'device', reason: error || 'quota_exceeded' };
    }
    // This client always sends Content-Length, so a 411 means the transport
    // re-chunks every request: the machine's fault, not the file's.
    if (status === 411) return { scope: 'device', reason: error || 'length_required' };
    // 413 and 400 are both "this payload, unchanged, will never be accepted".
    if (status === 413) return { scope: 'file', reason: error || 'payload_too_large' };
    if (status === 400) return { scope: 'file', reason: error || 'invalid_request' };
    if (status >= 500) return { scope: 'attempt', reason: 'server_error' };
    return { scope: 'file', reason: error || `status_${status}` };
  }

  const errorOf = (response) => (response.body && response.body.error) || null;

  /**
   * A short, searchable code for why a call threw; never the message, which can
   * carry a URL or a path. `cause` first, because fetch hangs the network error
   * (ENOTFOUND, …) there; `code` only when a string, because an aborted fetch's
   * is the legacy numeric 20.
   */
  function failureCode(error) {
    if (!error) return 'error';
    if (error.cause && error.cause.code) return String(error.cause.code);
    if (typeof error.code === 'string' && error.code) return error.code;
    return error.name || 'error';
  }

  /**
   * One request, retried only on a rate limit, a 5xx or a network error. Our
   * own timeout is not retried: it already allows for a slow link. No retry
   * starts once the run's budget is spent, so a run overruns by at most one
   * request.
   */
  async function send(url, options, budget) {
    let lastError = null;
    let lastResponse = null;
    for (let attempt = 0; attempt < config.retries; attempt += 1) {
      if (attempt > 0) {
        if (budget.expired()) break;
        await sleep(config.retryBaseMs * 4 ** (attempt - 1));
      }
      let response;
      try {
        response = await request(url, options);
      } catch (error) {
        if (error.timedOut) throw error;
        lastError = error;
        continue;
      }
      lastResponse = response;
      if (response.status === 429 || response.status >= 500) continue;
      return response;
    }
    // The last refusal, so repeated 429s are recorded as `rate_limited`.
    if (lastResponse) return lastResponse;
    throw lastError || new Error('request failed with no response');
  }

  // --------------------------------------------------------------------- runs

  function makeBudget() {
    const startedAt = now().getTime();
    let bytes = 0;
    return {
      spend(byteCount) {
        bytes += byteCount;
      },
      get bytes() {
        return bytes;
      },
      expired() {
        return bytes >= config.maxRunBytes || now().getTime() - startedAt >= config.maxRunMs;
      },
    };
  }

  function block(state, scope, key, reason) {
    const record = { reason, at: now().toISOString() };
    if (scope === 'device') state.blocks.device = record;
    else state.blocks.projects[key] = record;
    log('blocked', { scope, key, reason });
  }

  /**
   * Blocks are cooldowns. Device and project blocks expire after
   * `blockCooldownMs`, so an admin's fix or a quota reset heals without the
   * client. A file block clears when the file's size changes.
   *
   * `upload_timeout` uses the shorter `timeoutCooldownMs`, and its file block
   * ignores size: an active session grows every turn, a write-once file never.
   */
  const TIMEOUT = 'upload_timeout';
  // The receiver holds less than it confirmed (an admin removed it, or
  // retention expired it). Resyncing would re-send it, so this never lifts.
  const REMOVED = 'removed_on_receiver';

  function blockedNow(record) {
    if (!record) return false;
    const blockedAtMs = Date.parse(record.at);
    if (Number.isNaN(blockedAtMs)) return false;
    const cooldown = record.reason === TIMEOUT ? config.timeoutCooldownMs : config.blockCooldownMs;
    return now().getTime() - blockedAtMs < cooldown;
  }

  /** The file's block if it still holds for a file of `size` bytes, else null. */
  function fileBlock(entry, size) {
    const record = entry.blocked;
    if (!record) return null;
    if (record.reason === REMOVED) return record;
    if (record.reason === TIMEOUT) return blockedNow(record) ? record : null;
    return size === undefined || record.size === size ? record : null;
  }

  function statOrNull(file) {
    try {
      return fs.statSync(file);
    } catch {
      return null;
    }
  }

  /**
   * Every file this run may touch, with its bound identity (see ISOLATION):
   * new files in this project's strict-mode directories, bound to
   * `options.bindTo` (none without it), plus every file already in the state,
   * under the identity it was bound to. Nothing else enters; nothing is
   * re-bound.
   */
  function collectEntries(root, state, options = {}) {
    // Never re-read: a pull mid-sweep could change the id the notice was
    // checked against.
    const collection = options.bindTo || null;
    const { dirs } = store.discoverTranscriptDirs(root, undefined, { strict: true });
    const found = store.listTranscriptFiles(dirs);
    const list = [];
    const seen = new Set();

    // A tracked file is matched by the path it was bound at, skipping the
    // realpath, which is most of a sweep's cost. A miss, new file or known
    // one reached by another path, still resolves to its canonical key.
    const keyByPath = new Map();
    for (const [key, entry] of Object.entries(state.files)) {
      if (entry && entry.file) keyByPath.set(foldCase(entry.file), key);
    }

    for (const transcript of found) {
      const key = keyByPath.get(foldCase(transcript.file)) || stateKey(transcript.file);
      seen.add(key);
      let entry = state.files[key];
      if (!entry) {
        // NOTICE: without a noticed identity, nothing new is bound.
        if (!collection || !collection.receiverUrl) continue;
        entry = {
          projectId: collection.projectId,
          receiverUrl: collection.receiverUrl,
          sessionId: transcript.sessionId,
          kind: transcript.kind,
          name: transcript.name,
          file: transcript.file,
          generation: 0,
          watermark: 0,
          firstLineHash: null,
        };
        state.files[key] = entry;
      }
      entry.file = entry.file || transcript.file;
      list.push({ key, entry });
    }

    for (const [key, entry] of Object.entries(state.files)) {
      if (seen.has(key) || !entry || !entry.file) continue;
      list.push({ key, entry });
    }
    return list;
  }

  /**
   * Uploads one appendable file from its watermark.
   *
   * `watermark` is how far into the local file we have read; `remoteLength` is
   * how many bytes the receiver holds. They part at the first spill, since a
   * pointer is shorter than the line it replaces.
   */
  async function syncAppendable(uploadContext, entry) {
    const stat = statOrNull(entry.file);
    if (!stat) return { reason: 'missing' };
    if (entry.remoteLength == null) entry.remoteLength = entry.watermark || 0;

    const firstLineHash = firstLineHashOf(entry.file);
    if (entry.watermark > stat.size) {
      rollGeneration(entry, `local file is ${stat.size} bytes but ${entry.watermark} were sent`);
    } else if (entry.firstLineHash != null && firstLineHash !== null && entry.firstLineHash !== firstLineHash) {
      rollGeneration(entry, 'first line changed');
    }
    if (firstLineHash !== null) entry.firstLineHash = firstLineHash;

    let sent = 0;
    let conflicts = 0;
    while (entry.watermark < stat.size) {
      if (uploadContext.budget.expired()) return { reason: 'budget', sent };

      let delta = readDelta(entry.file, entry.watermark, stat.size);
      if (delta.oversized) return { blocked: 'oversized_line', sent };
      if (delta.incomplete) return { reason: 'partial_line', sent };

      // Lines before a bad one go as usual. Once it leads, a bad line is
      // spilled (blobs are not content-checked), or stepped over if blank;
      // either way the counts part.
      const invalidLine = delta.payload ? firstInvalidLine(delta.payload) : null;
      if (invalidLine && invalidLine.start > 0) {
        delta = { payload: delta.payload.subarray(0, invalidLine.start) };
      } else if (invalidLine && invalidLine.bytes === 0) {
        entry.watermark += 1;
        entry.spilled = true;
        log('blank_line_skipped', { sessionId: entry.sessionId, offset: entry.watermark - 1 });
        continue;
      } else if (invalidLine) {
        delta = {
          spill: { start: entry.watermark, bytes: invalidLine.bytes, consumed: invalidLine.bytes + 1, reason: invalidLine.reason },
        };
      }

      // What goes on the wire, and how far it carries the local read: the same
      // for an ordinary chunk, different for a spill's short pointer line.
      let payload = delta.payload;
      let advance = delta.payload ? delta.payload.length : 0;
      let spilling = false;
      let response;
      // A timeout is returned, not thrown, so `sent` still reaches the caller.
      try {
        if (delta.spill) {
          const spilled = await spillLine(uploadContext, entry, delta.spill);
          if (spilled.refusal) return { refusal: spilled.refusal, status: spilled.status, sent };
          if (!spilled.pointer) return { reason: spilled.reason, sent };
          payload = spilled.pointer;
          advance = delta.spill.consumed;
          spilling = true;
        }

        response = await send(
          uploadUrl(entry, uploadContext.machineId),
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${uploadContext.deviceKey}`,
              'content-type': 'application/x-ndjson',
              'x-offset': String(entry.remoteLength),
            },
            body: payload,
          },
          uploadContext.budget,
        );
      } catch (error) {
        if (error.timedOut) return { timedOut: true, sent };
        throw error;
      }

      if (response.status === 409) {
        const length = blobLength(response);
        if (length === null) return { blocked: 'unusable_length', sent };
        // Resyncing to the offset just sent would repeat the same request
        // forever (Azure reports its append-block ceiling this way).
        if (length === entry.remoteLength) return { blocked: 'conflict_no_progress', sent };
        // Only under the machine id that sent those bytes: a re-registered
        // machine uploads to a fresh, empty path and must resync from 0.
        if (length < entry.remoteLength && entry.machineId === uploadContext.machineId) {
          return { blocked: REMOVED, sent };
        }
        conflicts += 1;
        if (conflicts > MAX_CONFLICTS_PER_FILE) return { blocked: 'conflict_loop', sent };
        if (entry.spilled) {
          // A remote length can't map to a local offset once a pointer stands
          // in for a line. Rolling is cheap: each re-derived spill PUT meets
          // its own blob.
          rollGeneration(entry, 'a spilled file cannot resync to a remote offset');
          continue;
        }
        if (length > stat.size) {
          rollGeneration(entry, `receiver holds ${length} bytes for a ${stat.size}-byte file`);
          continue;
        }
        // `spilled` is only true of a run that survived to write the state;
        // the file itself settles the rest (see onLineBoundary).
        if (!onLineBoundary(entry.file, length)) {
          rollGeneration(entry, `remote length ${length} is not a local line boundary`);
          continue;
        }
        log('resync', { sessionId: entry.sessionId, from: entry.watermark, to: length });
        entry.watermark = length;
        entry.remoteLength = length;
        continue;
      }

      if (!response.ok) {
        return { refusal: classify(response.status, errorOf(response)), status: response.status, sent };
      }

      const length = blobLength(response);
      if (length === null) return { blocked: 'unusable_length', sent };

      uploadContext.budget.spend(payload.length);
      sent += payload.length;
      entry.watermark += advance;
      entry.remoteLength = length;
      entry.machineId = uploadContext.machineId;
      // Only once the pointer is stored: a 409 before that is still an
      // ordinary resync.
      if (spilling) entry.spilled = true;
      entry.uploadedAt = now().toISOString();
      log('appended', {
        projectId: entry.projectId,
        sessionId: entry.sessionId,
        kind: entry.kind,
        name: entry.kind === 'main' ? undefined : entry.name,
        bytes: payload.length,
        length,
      });
    }
    return { reason: 'complete', sent };
  }

  /** Uploads one write-once file whole: `.meta.json` and spilled tool results. */
  async function syncWriteOnce(uploadContext, entry) {
    if (entry.done) return { reason: 'done' };
    const stat = statOrNull(entry.file);
    if (!stat) return { reason: 'missing' };
    if (now().getTime() - stat.mtimeMs < config.minFileAgeMs) return { reason: 'too_new' };
    if (stat.size === 0) return { reason: 'empty' };
    if (stat.size > config.maxBlobBytes) return { blocked: 'blob_too_large' };
    if (uploadContext.budget.expired()) return { reason: 'budget' };

    const body = fs.readFileSync(entry.file);
    let response;
    // A timeout is a result, not a throw, as in syncAppendable.
    try {
      response = await send(
        uploadUrl(entry, uploadContext.machineId),
        {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${uploadContext.deviceKey}`,
            'content-type': entry.kind === 'meta' ? 'application/json' : 'text/plain',
          },
          body,
        },
        uploadContext.budget,
      );
    } catch (error) {
      if (error.timedOut) return { timedOut: true };
      throw error;
    }

    // 409 `already_written`: the bytes are already there.
    if (response.status === 409) {
      entry.done = true;
      return { reason: 'already_written' };
    }
    if (!response.ok) {
      return { refusal: classify(response.status, errorOf(response)), status: response.status };
    }
    uploadContext.budget.spend(body.length);
    entry.done = true;
    entry.uploadedAt = now().toISOString();
    log('blob_written', {
      projectId: entry.projectId,
      sessionId: entry.sessionId,
      kind: entry.kind,
      name: entry.name,
      bytes: body.length,
    });
    return { reason: 'complete', sent: body.length };
  }

  /**
   * The sweep. Per file, in order: local blocks, then — only if something is
   * actually going to be sent — the credential. The NOTICE gate is on binding,
   * in collectEntries; every file that reaches this loop has passed it.
   */
  async function run(root, options = {}) {
    const summary = {
      files: 0,
      uploaded: 0,
      bytes: 0,
      skipped: {},
      blocked: [],
      registered: false,
    };
    const note = (reason) => {
      summary.skipped[reason] = (summary.skipped[reason] || 0) + 1;
    };

    const state = readState();
    const budget = makeBudget();
    const entries = collectEntries(root, state, options);
    let device = readDevice();
    let stopped = null;

    for (const { key, entry } of entries) {
      if (stopped) break;
      summary.files += 1;

      const stat = statOrNull(entry.file);
      if (!stat) {
        // Claude Code deletes transcripts past `cleanupPeriodDays`; drop the
        // entry so the state doesn't grow without bound.
        delete state.files[key];
        log('pruned', { sessionId: entry.sessionId, name: entry.name });
        note('missing');
        continue;
      }

      if (entry.blocked) {
        const held = fileBlock(entry, stat.size);
        if (held) {
          summary.blocked.push({ name: entry.name, reason: held.reason });
          note(`file_blocked:${held.reason}`);
          continue;
        }
        delete entry.blocked; // the refused payload is gone, or the cooldown ran out
      }
      if (blockedNow(state.blocks.device)) {
        note(`device_blocked:${state.blocks.device.reason}`);
        continue;
      }
      if (blockedNow(state.blocks.projects[entry.projectId])) {
        note(`project_blocked:${state.blocks.projects[entry.projectId].reason}`);
        continue;
      }
      if (!entry.receiverUrl) {
        note('no_receiver');
        continue;
      }

      const appendable = entry.kind === 'main' || entry.kind === 'subagent';
      // Equal, not `>=`: a watermark past the end means a replaced file, which
      // syncAppendable must roll.
      if (appendable && entry.watermark === stat.size) {
        note('up_to_date');
        continue;
      }
      if (!appendable && entry.done) {
        note('up_to_date');
        continue;
      }
      if (budget.expired()) {
        note('budget');
        continue;
      }

      // Only now is a request certain, so only now is a credential needed.
      if (!usableCredential(device)) {
        // Caught: a throw would skip the writeState below.
        let registered = null;
        try {
          registered = await ensureDevice(entry.receiverUrl);
        } catch (error) {
          log('device_registration_failed', { code: failureCode(error) });
        }
        if (!usableCredential(registered)) {
          note('no_device');
          // Stop the run, rather than retry per file or block: the receiver may
          // only be briefly down.
          stopped = 'device:registration_failed';
          continue;
        }
        device = registered;
        summary.registered = true;
      }
      if (device.receiverUrl && device.receiverUrl !== entry.receiverUrl) {
        // Never present a credential to a receiver that did not issue it. A
        // project block, not a silent skip, so a receiver move shows in
        // --status and the log.
        block(state, 'project', entry.projectId, 'receiver_mismatch');
        note('project_blocked:receiver_mismatch');
        continue;
      }

      const uploadContext = { machineId: device.machineId, deviceKey: device.deviceKey, budget };
      let result;
      try {
        result = appendable ? await syncAppendable(uploadContext, entry) : await syncWriteOnce(uploadContext, entry);
      } catch (error) {
        log('request_failed', { sessionId: entry.sessionId, code: failureCode(error) });
        note('request_failed');
        continue;
      }

      if (result.sent) {
        summary.uploaded += 1;
        summary.bytes += result.sent;
        delete entry.timeouts;
        state.timeoutStreak = 0;
      }
      if (result.timedOut) {
        log('request_failed', { sessionId: entry.sessionId, code: 'timeout' });
        note('request_failed');
        // Strike only an attempt that moved nothing: one that landed chunks is
        // a slow link converging.
        if (!result.sent) {
          // Struck against the file and the machine. Timeouts across files
          // pause the machine; one file timing out alone pauses only itself
          // (checked first).
          entry.timeouts = (entry.timeouts || 0) + 1;
          state.timeoutStreak = (state.timeoutStreak || 0) + 1;
          if (entry.timeouts >= config.maxTimeouts) {
            entry.blocked = { reason: TIMEOUT, at: now().toISOString(), size: stat.size };
            entry.timeouts = 0;
            // Those timeouts were this file's; the machine's count restarts.
            state.timeoutStreak = 0;
            summary.blocked.push({ name: entry.name, reason: TIMEOUT });
            log('file_blocked', { sessionId: entry.sessionId, name: entry.name, reason: TIMEOUT });
          } else if (state.timeoutStreak >= config.maxTimeouts) {
            block(state, 'device', null, TIMEOUT);
            state.timeoutStreak = 0;
            stopped = `device:${TIMEOUT}`;
          }
        }
        continue;
      }
      // Every file block, from the receiver or decided locally, is recorded here.
      const blockedReason = result.blocked || (result.refusal && result.refusal.scope === 'file' && result.refusal.reason);
      if (blockedReason) {
        entry.blocked = { reason: blockedReason, at: now().toISOString(), size: stat.size };
        summary.blocked.push({ name: entry.name, reason: blockedReason });
        log('file_blocked', { sessionId: entry.sessionId, name: entry.name, reason: blockedReason });
      }
      if (result.refusal) {
        const { scope, reason } = result.refusal;
        if (scope === 'file') {
          /* recorded above */
        } else if (scope === 'device') {
          block(state, 'device', null, reason);
          stopped = `device:${reason}`;
        } else if (scope === 'project') {
          block(state, 'project', entry.projectId, reason);
        } else {
          note(`attempt:${reason}`);
        }
        log('refused', { sessionId: entry.sessionId, status: result.status, scope, reason });
      } else if (result.reason && result.reason !== 'complete') {
        note(result.reason);
      }
    }

    writeState(state);
    log('run_finished', {
      files: summary.files,
      uploaded: summary.uploaded,
      bytes: summary.bytes,
      stopped: stopped || undefined,
    });
    return { ...summary, stopped };
  }

  /**
   * Everything this project has, from each file's watermark; the first run
   * after a notice is the backfill.
   *
   * `noticeSession` is checked against notices.json, not trusted: without its
   * entry for this project nothing new is bound, so a run by hand only
   * finishes what a noticed session started. Never mints the identity file.
   */
  async function catchUp(options = {}) {
    const root = options.root || process.cwd();
    if (isTemplateDevRepo(root)) return { skipped: 'dev_repo' };
    if (!isConfigured() && !readCollection(root)) return { skipped: 'not_configured' };
    const lock = acquireLock();
    if (!lock) {
      log('lock_busy', {});
      return { skipped: 'locked' };
    }
    try {
      const collection = readCollection(root);
      if (!collection) return { skipped: fs.existsSync(collectionPath(root)) ? 'unreadable' : 'no_project' };
      const bindTo = sessionNotice(options.noticeSession, collection.projectId) ? collection : null;
      return await run(root, { bindTo });
    } finally {
      lock.release();
    }
  }

  // -------------------------------------------------------------------- status

  /** Read-only, always: `/status` runs it, and must never start collection. */
  function status(options = {}) {
    const root = options.root || process.cwd();
    const collection = readCollection(root);
    const device = readDevice();
    const state = readState();
    const projectId = collection ? collection.projectId : null;
    const files = Object.values(state.files).filter((entry) => entry && entry.projectId === projectId);
    const blockedFiles = files.filter((entry) => fileBlock(entry));
    // Progress through the files on disk, not a lifetime total: a rolled
    // generation starts again from 0.
    let sentBytes = 0;
    let pendingBytes = 0;
    let lastUploadAt = null;
    for (const entry of files) {
      const stat = statOrNull(entry.file);
      sentBytes += entry.done ? (stat ? stat.size : 0) : entry.watermark || 0;
      if (stat && !entry.done && !fileBlock(entry)) pendingBytes += Math.max(0, stat.size - (entry.watermark || 0));
      if (entry.uploadedAt && (!lastUploadAt || entry.uploadedAt > lastUploadAt)) lastUploadAt = entry.uploadedAt;
    }
    return {
      configured: isConfigured() || Boolean(collection && collection.receiverUrl),
      devRepo: isTemplateDevRepo(root),
      projectId,
      receiverUrl: collection ? collection.receiverUrl : defaultReceiverUrl(),
      collectionCommitted: collection ? isTracked(root) : false,
      // Present but unreadable: nothing new is bound until it is restored.
      collectionDamaged: !collection && fs.existsSync(collectionPath(root)),
      registered: usableCredential(device),
      machineId: device ? device.machineId : null,
      files: files.length,
      sentBytes,
      pendingBytes,
      lastUploadAt,
      blocked: blockedFiles.map((entry) => ({ name: entry.name, reason: entry.blocked.reason })),
      deviceBlock: blockedNow(state.blocks.device) ? state.blocks.device : null,
      projectBlock:
        projectId && blockedNow(state.blocks.projects[projectId])
          ? state.blocks.projects[projectId]
          : null,
      lastRunAt: state.updatedAt || null,
    };
  }

  /** Whether the identity file is committed yet - `/status` tells the user. */
  function isTracked(root) {
    const listed = tryGit(mainWorktreeRoot(root), 'ls-files', '--', COLLECTION_FILE);
    return Boolean(listed);
  }

  /**
   * The plain-language line `/status` prints: no dev-speak, no ids. Empty when
   * collection is off. The dev repo still gets a line, confirming the
   * .release-ignore sentinel works.
   */
  function statusLine(options = {}) {
    const report = status(options);
    if (report.devRepo) return 'Session recording: off (this is the template dev repo).';
    if (report.collectionDamaged) {
      return (
        `Session recording: stopped for this project, because ${COLLECTION_FILE} is damaged. ` +
        'Restore the committed copy, or ask your Twenty57 engagement lead.'
      );
    }
    if (!report.configured) return '';
    const parts = [
      report.files
        ? `Session recording: on for this project — ${formatBytes(report.sentBytes)} sent from ` +
          `${formatFileCount(report.files)}, ${formatBytes(report.pendingBytes)} waiting`
        : 'Session recording: on for this project. Nothing has been sent yet',
    ];
    if (report.lastUploadAt) parts.push(`Last sent ${formatWhen(report.lastUploadAt)}`);
    if (report.deviceBlock || report.projectBlock) {
      parts.push(
        `Sending is paused ${report.deviceBlock ? 'on this machine' : 'for this project'} and will try again ` +
          'by itself; if it stays paused for more than a day, tell your Twenty57 contact',
      );
    }
    const removed = report.blocked.filter((blockedFile) => blockedFile.reason === REMOVED).length;
    const failed = report.blocked.length - removed;
    if (removed) {
      parts.push(`${capitalize(formatFileCount(removed))} ${removed === 1 ? 'was' : 'were'} removed from Twenty57's copy and ${removed === 1 ? 'is' : 'are'} no longer sent`);
    }
    if (failed) {
      parts.push(`${capitalize(formatFileCount(failed))} could not be sent; tell your Twenty57 contact if this persists`);
    }
    if (report.projectId && !report.collectionCommitted) {
      parts.push(
        `${COLLECTION_FILE} is not committed yet; if a git pull refuses to overwrite it, delete your local copy and pull again`,
      );
    }
    return parts.join('. ') + '.';
  }

  const formatFileCount = (count) => `${count} session ${count === 1 ? 'file' : 'files'}`;
  const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

  function formatWhen(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return {
    // paths and local state
    home,
    devicePath,
    statePath,
    lockPath,
    logPath,
    readJson,
    writeJsonAtomic,
    readDevice,
    updateDevice,
    readState,
    writeState,
    stateKey,
    log,
    // project identity
    isTemplateDevRepo,
    mainWorktreeRoot,
    collectionPath,
    readCollection,
    defaultReceiverUrl,
    isConfigured,
    initProject,
    isTracked,
    // notice
    noticesPath,
    readNotices,
    sessionNotice,
    recordSessionNotice,
    // plumbing the tests drive directly
    acquireLock,
    timeoutFor,
    request,
    blobLength,
    ensureDevice,
    sessionSegment,
    uploadUrl,
    firstLineHashOf,
    readDelta,
    classify,
    failureCode,
    collectEntries,
    makeBudget,
    blockedNow,
    // entry points
    run,
    catchUp,
    status,
    statusLine,
    config,
  };
}

module.exports = {
  createCore,
  mintCollectionFile,
  DEFAULT_RECEIVER_URL,
  MAX_CHUNK_BYTES,
  SCHEMA_VERSION,
  COLLECTION_FILE,
  DEFAULTS,
};

/* ============================================================
   race-worker.js — the six-method race, off the main thread.

   A CLASSIC worker (not a module, not a blob), published as a real file, so
   every URL below resolves against THIS file's own directory: `ig_core.wasm`
   and `instances/NAME.csv` are relative and need no plumbing from the page.
   A blob: URL is not hierarchical and would resolve neither.

   The page it serves (docs/index.html) has no module system — eleven plain
   <script> blocks and zero imports — but `WebAssembly` and `Worker` are plain
   globals, which is the whole reason this file can exist.

   EXECUTION MODEL, decided upstream and not to be redesigned: ONE worker,
   round-robin slices through `race_step`. A budget race is deterministic per
   method, so parallelism would change no result, and a fair parallel race
   needs a per-slice barrier — without SharedArrayBuffer (GitHub Pages cannot
   send COOP/COEP) that barrier is a postMessage round trip, which costs more
   than it buys. Slice size is proven not to change the outcome: 200 / 2000 /
   20000 on STC_NCOS_61 give byte-identical costs and evaluation counts.

   Why the worker is mandatory rather than tidy: greedy's construction is one
   indivisible phase of n(n+1)/2 evaluations, which at n=500 is a single
   ~1.3 s block that no slice size can cut. On the main thread that is a
   frozen page; here it is a paused number on a live one.
   ============================================================ */
"use strict";

var X = null;              /* wasm exports */
var mem = null, u8 = null, view = null;
var wasmBytes = 0, wasmMs = 0;
var scratchPtr = 0, scratchPairs = 0;   /* trace pull buffer, allocated once */
var instances = Object.create(null);    /* name -> { id, n, fam[], proc[] } */
var token = 0;                          /* the run the page is currently waiting for */

/* wasm memory grows during a race (measured: one growth event at n=75 and at
   n=500). Growth DETACHES memory.buffer, so every view has to be rebound. The
   pointers stay valid; the buffer object does not. */
function rebind() {
  if (!u8 || u8.buffer !== mem.buffer) {
    u8 = new Uint8Array(mem.buffer);
    view = new DataView(mem.buffer);
  }
}

/* ---------- loading ---------- */

function loadWasm() {
  if (X) return Promise.resolve();
  var t0 = (self.performance || Date).now();
  /* instantiateStreaming needs `content-type: application/wasm`; GitHub Pages
     sends it (and gzips the body to ~51 KB). The arrayBuffer path is the
     fallback for any host that does not. */
  return fetch("ig_core.wasm").then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status + " for ig_core.wasm");
    var ct = (res.headers.get("content-type") || "").toLowerCase();
    if (WebAssembly.instantiateStreaming && ct.indexOf("application/wasm") === 0) {
      var clone = res.clone();
      return WebAssembly.instantiateStreaming(res, {}).then(function (out) {
        return clone.arrayBuffer().then(function (buf) { return [out, buf.byteLength]; });
      });
    }
    return res.arrayBuffer().then(function (buf) {
      return WebAssembly.instantiate(buf, {}).then(function (out) { return [out, buf.byteLength]; });
    });
  }).then(function (pair) {
    /* The module imports nothing at all — WebAssembly.Module.imports() is [] —
       so there is no glue, no bindgen and no import object to build. */
    X = pair[0].instance.exports;
    mem = X.memory;
    wasmBytes = pair[1];
    wasmMs = Math.round(((self.performance || Date).now() - t0) * 10) / 10;
    rebind();
    scratchPairs = 4096;
    scratchPtr = X.wasm_alloc(scratchPairs * 16);   /* once: there is no free */
    rebind();
  });
}

/* Only what the schedule strip needs: the setup family and the machine time of
   every job, in the engine's own job order. Both parsers key the job index on
   ACTIVITY_ID sorted ascending (engine/src/instance.rs sorts `modes.keys()`),
   so index i here is index i in the permutation race_best_ptr returns. */
function parseJobs(text) {
  var headers = Object.create(null), fam = Object.create(null), proc = Object.create(null);
  var lines = String(text).split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    var cells = line.split(","), tag = cells[0], pipe = tag.indexOf("|");
    if (pipe >= 0) {
      if (tag.slice(pipe + 1) === "NAMES") headers[tag.slice(0, pipe)] = cells.slice(1);
      continue;
    }
    if (tag !== "ACTIVITY" && tag !== "MODE") continue;
    var head = headers[tag] || [];
    var at = function (name) {
      var k = head.indexOf(name);
      return k < 0 ? undefined : cells[k + 1];
    };
    var id = Number(at("ACTIVITY_ID"));
    if (!Number.isFinite(id)) continue;
    if (tag === "ACTIVITY") fam[id] = Number(at("SETUP_STATE")) || 0;
    else proc[id] = Number(at("PROCESSING_TIME")) || 0;
  }
  var ids = Object.keys(proc).map(Number).sort(function (a, b) { return a - b; });
  return {
    fam: ids.map(function (id) { return fam[id] || 0; }),
    proc: ids.map(function (id) { return proc[id] || 0; })
  };
}

function loadInstance(name) {
  var cached = instances[name];
  if (cached) return Promise.resolve(cached);
  return fetch("instances/" + name + ".csv").then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status + " for " + name + ".csv");
    return res.text();
  }).then(function (text) {
    var enc = new TextEncoder().encode(text);
    var ptr = X.wasm_alloc(enc.length);
    rebind();
    u8.set(enc, ptr);
    /* inst_load TAKES OWNERSHIP (Vec::from_raw_parts, dropped at scope end):
       the buffer is freed, so this pointer must never be reused. */
    var id = X.inst_load(ptr, enc.length);
    if (id < 0) throw new Error("the engine refused " + name + ".csv");
    var jobs = parseJobs(text);
    cached = { id: id, n: X.inst_n(id), fam: jobs.fam, proc: jobs.proc, bytes: enc.length };
    instances[name] = cached;
    return cached;
  });
}

/* ---------- the snapshot block ---------- */
/* race_snapshot_ptr() is a fixed address in the data segment (a static array,
   never moved by growth), 6 racers × 64 bytes, #[repr(C)], little-endian. */
var snapPtr = 0;
function snapshot(m) {
  rebind();
  var o = snapPtr + m * 64;
  return {
    best: view.getFloat64(o, true),          /* +Infinity until a first solution */
    cur: view.getFloat64(o + 8, true),
    evals: view.getFloat64(o + 16, true),    /* f64 so it stays exact past 2^32 */
    status: view.getUint32(o + 24, true),
    arg: view.getUint32(o + 28, true),
    flags: view.getUint32(o + 32, true),     /* bit0 done */
    traceLen: view.getUint32(o + 36, true),
    orderLen: view.getUint32(o + 40, true),
    bestLen: view.getUint32(o + 44, true),
    phase: view.getUint32(o + 48, true)
  };
}
function allSnapshots() {
  var out = [];
  for (var m = 0; m < 6; m++) out.push(snapshot(m));
  return out;
}
function traceOf(m) {
  var pts = [], from = 0;
  for (;;) {
    var got = X.race_trace_write(m, from, scratchPtr, scratchPairs);
    if (!got) break;
    rebind();
    for (var k = 0; k < got; k++) {
      pts.push([view.getFloat64(scratchPtr + k * 16, true),
                view.getFloat64(scratchPtr + k * 16 + 8, true)]);
    }
    from += got;
    if (got < scratchPairs) break;
  }
  return pts;
}

/* ---------- the race ---------- */

function startRace(job, inst) {
  var budget = job.budget >>> 0, hi = Math.floor(job.budget / 4294967296) >>> 0;
  var created = X.race_new(inst.id, job.seed >>> 0, budget, hi, job.d, job.accept, job.permute);
  if (created !== 6) throw new Error("the engine refused the race");
  snapPtr = X.race_snapshot_ptr();
}

/* Yield to the event loop without the 4 ms clamp nested setTimeout would take:
   at ~60 yields a second that clamp alone would double a 600 ms race. A
   MessageChannel task is a macrotask like any other, so an incoming `cancel`
   or a newer `race` still lands between two of them. */
var chan = (typeof MessageChannel === "function") ? new MessageChannel() : null;
var queued = [];
if (chan) chan.port1.onmessage = function () { var f = queued.shift(); if (f) f(); };
function nextTick(fn) {
  if (chan) { queued.push(fn); chan.port2.postMessage(0); } else setTimeout(fn, 0);
}

var YIELD_MS = 12;    /* how long one macrotask may hold the worker */
var FRAME_MS = 33;    /* how often the page is told anything */

function raceToEnd(job, inst, onFrame, onDone) {
  var mine = job.token, t0 = (self.performance || Date).now();
  var now = function () { return (self.performance || Date).now(); };
  var frames = 0, worst = 0, posted = 0;
  function tick() {
    if (token !== mine) return;                       /* superseded: drop it */
    var slot = now(), done = false, snaps;
    /* Run whole round-robin passes until this macrotask has held the worker
       long enough. One pass can overrun it by a lot and that is not a bug:
       greedy's construction is a single indivisible phase. */
    do {
      var p0 = now();
      for (var m = 0; m < 6; m++) X.race_step(m, job.slice);
      var dt = now() - p0;
      if (dt > worst) worst = dt;
      X.race_snapshot(0);
      snaps = allSnapshots();
      done = true;
      for (var k = 0; k < 6; k++) if (!(snaps[k].flags & 1)) { done = false; break; }
    } while (!done && now() - slot < YIELD_MS);
    frames++;
    var elapsed = now() - t0;
    if (done) {
      X.race_snapshot(2);                             /* bit1: refresh best orders */
      onDone(snaps, elapsed, frames, worst);
      return;
    }
    if (elapsed - posted >= FRAME_MS) { posted = elapsed; onFrame(snaps, elapsed, frames); }
    nextTick(tick);
  }
  tick();
}

function bestOrderOf(m, n) {
  var ptr = X.race_best_ptr();
  if (!ptr) return [];
  rebind();
  var row = new Uint32Array(mem.buffer, ptr + m * n * 4, n), out = new Array(n);
  for (var i = 0; i < n; i++) out[i] = row[i];
  return out;
}

/* ---------- messages ---------- */

function fail(mine, err) {
  self.postMessage({ type: "error", token: mine, error: String((err && err.message) || err) });
}

function handleRace(job) {
  var mine = job.token;
  loadWasm().then(function () {
    if (token !== mine) return;
    self.postMessage({ type: "engine", token: mine, wasmBytes: wasmBytes, wasmMs: wasmMs });
    return loadInstance(job.inst);
  }).then(function (inst) {
    if (!inst || token !== mine) return;
    self.postMessage({ type: "ready", token: mine, n: inst.n, fam: inst.fam, proc: inst.proc,
                       csvBytes: inst.bytes });
    startRace(job, inst);
    raceToEnd(job, inst, function (snaps, elapsed) {
      self.postMessage({ type: "frame", token: mine, snaps: snaps, elapsed: elapsed });
    }, function (snaps, elapsed, frames, worst) {
      var winner = 0;
      for (var m = 1; m < 6; m++) if (snaps[m].best < snaps[winner].best) winner = m;
      var traces = [];
      for (var t = 0; t < 6; t++) traces.push(traceOf(t));
      self.postMessage({
        type: "done", token: mine, snaps: snaps, traces: traces, winner: winner,
        order: bestOrderOf(winner, inst.n), elapsed: elapsed, frames: frames,
        worstFrame: Math.round(worst * 10) / 10, n: inst.n
      });
    });
  }).catch(function (err) { if (token === mine) fail(mine, err); });
}

/* Twelve consecutive seeds of the same file at the same budget, run to the end
   one after another: the answer to "is this seed luck?". Every seed is a full
   six-method race, so this costs twelve times a single Run — the page states
   the estimate before it offers the button. */
function handleSeeds(job) {
  var mine = job.token;
  loadWasm().then(function () {
    if (token !== mine) return;
    return loadInstance(job.inst);
  }).then(function (inst) {
    if (!inst || token !== mine) return;
    var i = 0;
    function next() {
      if (token !== mine) return;
      if (i >= job.count) { self.postMessage({ type: "seedsDone", token: mine }); return; }
      var one = { token: mine, seed: job.seed + i, budget: job.budget, slice: job.slice,
                  d: job.d, accept: job.accept, permute: job.permute };
      startRace(one, inst);
      raceToEnd(one, inst, function () {}, function (snaps) {
        var winner = 0;
        for (var m = 1; m < 6; m++) if (snaps[m].best < snaps[winner].best) winner = m;
        self.postMessage({ type: "seed", token: mine, index: i, seed: one.seed,
                           cost: snaps[winner].best, winner: winner });
        i++;
        nextTick(next);
      });
    }
    next();
  }).catch(function (err) { if (token === mine) fail(mine, err); });
}

self.onmessage = function (ev) {
  var job = ev.data || {};
  if (job.cmd === "cancel") { token = job.token || token + 1; return; }
  token = job.token;
  if (job.cmd === "race") handleRace(job);
  else if (job.cmd === "seeds") handleSeeds(job);
};

/**
 * Public wire contract between IG Studio and its solver worker.
 *
 * Commands use `{ id, type, payload }`. The worker answers commands with a
 * `response` carrying the same id and publishes long-running updates as
 * `event` messages. Keeping the contract data-only makes it straightforward
 * to exercise in Node and to embed in the final single-file page.
 */
export const ENGINE_PROTOCOL_VERSION = 1;

export const ENGINE_COMMAND = Object.freeze({
  INIT: 'init',
  SELECT_INSTANCE: 'select-instance',
  CONFIGURE: 'configure',
  START: 'start',
  COMPARE: 'compare',
  PAUSE: 'pause',
  RESUME: 'resume',
  RESET: 'reset',
  STATE: 'state',
  DISPOSE: 'dispose',
  RACE_NEW: 'race-new',
  RACE_SLICE: 'race-slice',
  RACE_CLEAR: 'race-clear',
});

/**
 * The method race is request/response, not an event stream: one `RACE_SLICE`
 * round trip advances every live method by a slice of evaluations and answers
 * with the whole snapshot. The main thread keeps exactly one slice in flight,
 * so the reply *is* the backpressure — there is no queue to drain and no
 * second consumer of the worker while a race is running.
 */
export const RACE_METHOD_IDS = Object.freeze([
  'greedy', 'descent', 'tabu', 'tabudiv', 'ama', 'ig',
]);

/**
 * Status keys by index, mirroring `engine/src/race/mod.rs` (`ST_*`). This is a
 * wire format: append, never reorder. Index 3 is reserved-and-dead — the IG
 * racer is `solver::Run`, which constructs by shuffled greedy, so nothing
 * emits `constructingEDD` any more.
 */
export const RACE_STATUS_KEYS = Object.freeze([
  'preparing',
  'constructing',
  'constructingGreedy',
  'constructingEDD',
  'descending',
  'stuckLocal',
  'doneConstructive',
  'iteration',
  'generation',
  'diversified',
  'breeding',
  'igLoop',
  'budgetExhausted',
]);

export const ENGINE_EVENT = Object.freeze({
  STATE: 'state',
  PROGRESS: 'progress',
  RUN_COMPLETE: 'run-complete',
  COMPARISON_RUN_COMPLETE: 'comparison-run-complete',
  COMPARISON_COMPLETE: 'comparison-complete',
  ERROR: 'error',
});

export const ENGINE_STATUS = Object.freeze({
  UNINITIALIZED: 'uninitialized',
  READY: 'ready',
  INSTANCE_SELECTED: 'instance-selected',
  CONFIGURED: 'configured',
  RUNNING: 'running',
  RACING: 'racing',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  ERROR: 'error',
  DISPOSED: 'disposed',
});

export function isEngineResponse(value) {
  return Boolean(value && value.type === 'response' && Number.isInteger(value.id));
}

export function isEngineEvent(value) {
  return Boolean(value && value.type === 'event' && typeof value.event === 'string');
}

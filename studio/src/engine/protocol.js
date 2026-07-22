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
});

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

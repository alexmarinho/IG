import {
  ENGINE_COMMAND,
  ENGINE_EVENT,
  isEngineEvent,
  isEngineResponse,
} from './protocol.js';
import { createWorkerSource } from './worker-runtime.js';

export class IGEngineError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'IGEngineError';
    this.code = code || 'ENGINE_ERROR';
  }
}

export function createIGEngineWorker(options = {}) {
  const WorkerApi = options.Worker || globalThis.Worker;
  const BlobApi = options.Blob || globalThis.Blob;
  const URLApi = options.URL || globalThis.URL;
  if (!WorkerApi || !BlobApi || !URLApi || typeof URLApi.createObjectURL !== 'function') {
    throw new IGEngineError('WORKER_UNAVAILABLE', 'Blob Web Workers are unavailable in this environment.');
  }
  const blob = new BlobApi([createWorkerSource()], { type: 'text/javascript' });
  const url = URLApi.createObjectURL(blob);
  const worker = new WorkerApi(url, { name: options.name || 'ig-engine-worker' });
  const revoke = () => URLApi.revokeObjectURL(url);
  if (typeof queueMicrotask === 'function') queueMicrotask(revoke);
  else setTimeout(revoke, 0);
  return worker;
}

function cloneWasmForTransfer(value) {
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  return value;
}

/** Promise/event facade over the data-only worker protocol. */
export class IGEngineClient {
  constructor(options = {}) {
    this.worker = options.worker || createIGEngineWorker(options);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.disposed = false;
    this.handleMessage = (event) => this.#onMessage(event.data);
    this.handleError = (event) => this.#onWorkerError(event);
    this.worker.addEventListener('message', this.handleMessage);
    this.worker.addEventListener('error', this.handleError);
  }

  on(event, listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(listener);
    return () => this.off(event, listener);
  }

  off(event, listener) {
    const bucket = this.listeners.get(event);
    if (!bucket) return;
    bucket.delete(listener);
    if (!bucket.size) this.listeners.delete(event);
  }

  waitFor(event, predicate = () => true) {
    return new Promise((resolve) => {
      const unsubscribe = this.on(event, (payload) => {
        if (!predicate(payload)) return;
        unsubscribe();
        resolve(payload);
      });
    });
  }

  request(type, payload = {}, transfer = []) {
    if (this.disposed) return Promise.reject(new IGEngineError('DISPOSED', 'The engine client has been disposed.'));
    const id = this.nextId;
    this.nextId += 1;
    const promise = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.worker.postMessage({ id, type, payload }, transfer);
    return promise;
  }

  init(options) {
    const wasm = cloneWasmForTransfer(options.wasm ?? options.wasmBytes ?? options.wasmBase64);
    const payload = { wasm };
    if (options.catalog) payload.catalog = options.catalog;
    if (options.catalogGzipBase64) payload.catalogGzipBase64 = options.catalogGzipBase64;
    const transfer = wasm instanceof ArrayBuffer ? [wasm] : [];
    return this.request(ENGINE_COMMAND.INIT, payload, transfer);
  }

  selectInstance(name) {
    return this.request(ENGINE_COMMAND.SELECT_INSTANCE, { name });
  }

  configure(configuration) {
    return this.request(ENGINE_COMMAND.CONFIGURE, configuration);
  }

  start() {
    return this.request(ENGINE_COMMAND.START);
  }

  async runSingle() {
    const completed = this.waitFor(ENGINE_EVENT.RUN_COMPLETE);
    await this.start();
    return completed;
  }

  compare(options) {
    return this.request(ENGINE_COMMAND.COMPARE, options);
  }

  async runComparison(options) {
    const completed = this.waitFor(ENGINE_EVENT.COMPARISON_COMPLETE);
    await this.compare(options);
    return completed;
  }

  pause() {
    return this.request(ENGINE_COMMAND.PAUSE);
  }

  resume() {
    return this.request(ENGINE_COMMAND.RESUME);
  }

  reset() {
    return this.request(ENGINE_COMMAND.RESET);
  }

  state() {
    return this.request(ENGINE_COMMAND.STATE);
  }

  async dispose() {
    if (this.disposed) return;
    try {
      await this.request(ENGINE_COMMAND.DISPOSE);
    } finally {
      this.disposed = true;
      this.worker.removeEventListener('message', this.handleMessage);
      this.worker.removeEventListener('error', this.handleError);
      if (typeof this.worker.terminate === 'function') this.worker.terminate();
      const error = new IGEngineError('DISPOSED', 'The engine client has been disposed.');
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      this.listeners.clear();
    }
  }

  #onMessage(message) {
    if (isEngineResponse(message)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new IGEngineError(message.error && message.error.code, message.error && message.error.message));
      return;
    }
    if (isEngineEvent(message)) {
      this.#emit(message.event, message);
      this.#emit('*', message);
    }
  }

  #onWorkerError(event) {
    const error = new IGEngineError('WORKER_ERROR', event && event.message ? event.message : 'The engine worker failed.');
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.#emit(ENGINE_EVENT.ERROR, { type: 'event', event: ENGINE_EVENT.ERROR, error });
  }

  #emit(event, payload) {
    const bucket = this.listeners.get(event);
    if (!bucket) return;
    for (const listener of [...bucket]) listener(payload);
  }
}

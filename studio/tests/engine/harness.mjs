import { installEngineWorker } from '../../src/engine/worker-runtime.js';

export class WorkerHarness {
  constructor(options = {}) {
    this.messages = [];
    this.waiters = new Set();
    this.nextId = 1;
    this.closed = false;
    this.listeners = new Set();
    this.scope = {
      addEventListener: (type, listener) => {
        if (type === 'message') this.listeners.add(listener);
      },
      postMessage: (message, transfer = []) => this.#publish(message, transfer),
      close: () => { this.closed = true; },
    };
    installEngineWorker(this.scope, {
      schedule: options.schedule || ((callback) => setImmediate(callback)),
      now: options.now,
      decompressCatalog: options.decompressCatalog,
    });
  }

  dispatch(message) {
    for (const listener of this.listeners) listener({ data: message });
  }

  async command(type, payload = {}) {
    const id = this.nextId;
    this.nextId += 1;
    const after = this.messages.length;
    this.dispatch({ id, type, payload });
    const envelope = await this.waitFor(
      (entry) => entry.message.type === 'response' && entry.message.id === id,
      { after },
    );
    return envelope.message;
  }

  waitForEvent(event, predicate = () => true, options = {}) {
    return this.waitFor(
      (entry) => entry.message.type === 'event'
        && entry.message.event === event
        && predicate(entry.message),
      options,
    );
  }

  waitFor(predicate, { after = 0, timeout = 10_000 } = {}) {
    for (let index = after; index < this.messages.length; index += 1) {
      const entry = this.messages[index];
      if (predicate(entry)) return Promise.resolve({ ...entry, index });
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error(`Timed out after ${timeout} ms waiting for worker output.`));
      }, timeout);
      const waiter = {
        after,
        predicate,
        resolve: (entry, index) => {
          clearTimeout(timer);
          resolve({ ...entry, index });
        },
      };
      this.waiters.add(waiter);
    });
  }

  #publish(message, transfer) {
    const entry = { message, transfer };
    const index = this.messages.push(entry) - 1;
    for (const waiter of [...this.waiters]) {
      if (index < waiter.after || !waiter.predicate(entry)) continue;
      this.waiters.delete(waiter);
      waiter.resolve(entry, index);
    }
  }
}

/** Browser Worker facade wired to the real in-process worker runtime. */
export class LoopbackWorker {
  constructor(options = {}) {
    this.mainListeners = { message: new Set(), error: new Set() };
    this.workerListeners = new Set();
    this.terminated = false;
    const scope = {
      addEventListener: (type, listener) => {
        if (type === 'message') this.workerListeners.add(listener);
      },
      postMessage: (message) => {
        setImmediate(() => {
          for (const listener of this.mainListeners.message) listener({ data: message });
        });
      },
      close: () => {},
    };
    installEngineWorker(scope, {
      schedule: options.schedule || ((callback) => setImmediate(callback)),
    });
  }

  addEventListener(type, listener) {
    this.mainListeners[type].add(listener);
  }

  removeEventListener(type, listener) {
    this.mainListeners[type].delete(listener);
  }

  postMessage(message) {
    setImmediate(() => {
      for (const listener of this.workerListeners) listener({ data: message });
    });
  }

  terminate() {
    this.terminated = true;
  }
}

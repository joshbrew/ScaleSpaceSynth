// WorkerPool.js  (type: module)
// A tiny, Promise-based worker pool with zero dependencies.
//
// • Creates a fixed number of Web Workers (module type).
// • Queues jobs FIFO; each job returns a Promise that resolves with
//   whatever the worker posts back under `{ id, result }`.
// • Automatically filters the transfer-list so that
//   SharedArrayBuffer-backed data is **not** placed in it.
//
// Requires `smartBuffers.js` in the same folder (for `transferList()`):
//   export { transferList } from './smartBuffers.js';

import { transferList } from './smartBuffers.js';

export class WorkerPool {
  /**
   * @param {string | URL} workerUrl  Module worker script.
   * @param {number} [size]           #workers (defaults to hw threads or 4).
   */
  constructor(workerUrl, size = Math.max(1, navigator.hardwareConcurrency || 4)) {
    this.workerUrl = workerUrl;
    /** @type {{ w: Worker, busy: boolean, current: any | null }[]} */
    this.workers = [];
    /** @type {{ id:number, payload:any, transfer:ArrayBuffer[] }[]} */
    this.queue = [];
    /** @type {Map<number,{resolve:Function,reject:Function}>} */
    this.pending = new Map();
    this.nextId = 0;

    for (let i = 0; i < size; i++) {
      this.workers.push(this.#spawnSlot());
    }
  }

  #spawnSlot() {
    const slot = { w: null, busy: false, current: null };
    const w = new Worker(this.workerUrl);
    slot.w = w;
    w.onmessage = (e) => this.#handleDone(slot, e.data);
    w.onerror = (err) => this.#handleWorkerFailure(slot, Object.assign(new Error('Worker error'), { cause: err }));
    w.onmessageerror = (err) => this.#handleWorkerFailure(slot, Object.assign(new Error('Worker message error'), { cause: err }));
    return slot;
  }

  /**
   * Enqueue work in the pool.
   * @param {any}            payload  Data posted to the worker.
   * @param {ArrayBuffer[]} [buffers] ArrayBuffers you *might* want transferred.
   *                                  SharedArrayBuffers will be auto-filtered out.
   * @returns {Promise<any>}          Resolves with worker's `result`.
   */
  exec(payload, buffers = []) {
    return new Promise((resolve, reject) => {
      const id   = this.nextId++;
      const xfer = transferList(buffers);      // strip SABs if present

      this.pending.set(id, { resolve, reject });
      this.queue.push({ id, payload, transfer: xfer });
      this.#pump();
    });
  }

  /** Kill workers and clear queues/promises. */
  async terminate() {
    for (const [, entry] of this.pending) {
      try { entry.reject(new Error('WorkerPool terminated')); } catch (e) { console.error(e); }
    }
    for (const { w } of this.workers) w.terminate();
    this.queue.length = 0;
    this.pending.clear();
  }

  /* ───────── private helpers ───────── */

  #handleDone(slot, message) {
    if (!message || typeof message !== 'object') return;
    const { id, result, error } = message;
    const entry = this.pending.get(id);
    if (entry) {
      error ? entry.reject(error) : entry.resolve(result);
      this.pending.delete(id);
    }
    slot.busy = false;
    slot.current = null;
    this.#pump();
  }

  #handleWorkerFailure(slot, err) {
    const job = slot.current;
    if (job) {
      const entry = this.pending.get(job.id);
      if (entry) {
        this.pending.delete(job.id);
        try { entry.reject(err); } catch (e) { console.error(e); }
      }
    }
    try { if (slot.w) slot.w.terminate(); } catch (e) { console.error(e); }
    const next = this.#spawnSlot();
    const idx = this.workers.indexOf(slot);
    if (idx >= 0) this.workers[idx] = next;
    else this.workers.push(next);
    this.#pump();
  }

  #pump() {
    while (this.queue.length) {
      const idle = this.workers.find(s => !s.busy);
      if (!idle) break;

      const job = this.queue.shift();
      idle.busy = true;
      idle.current = job;
      try {
        idle.w.postMessage(
          { id: job.id, payload: job.payload },
          job.transfer                       // already SAB-safe
        );
      } catch (err) {
        idle.busy = false;
        idle.current = null;
        const entry = this.pending.get(job.id);
        if (entry) {
          this.pending.delete(job.id);
          entry.reject(Object.assign(new Error('Worker postMessage failed'), { cause: err }));
        }
      }
    }
  }
}

import { PARTICLE_INIT_WORKER_SOURCE } from './particle-init.worker-source.js';
import { hasSAB, allocTyped } from '../core/smartBuffers.js';
import { WorkerPool } from '../core/WorkerPool.js';

const TAU = Math.PI * 2;

let particleInitWorkerUrl = '';

function getParticleInitWorkerUrl() {
    if (!particleInitWorkerUrl) {
        particleInitWorkerUrl = URL.createObjectURL(new Blob([PARTICLE_INIT_WORKER_SOURCE], { type: 'text/javascript' }));
    }
    return particleInitWorkerUrl;
}

function _makeRng(seed) {
    let s = (seed >>> 0) || 0x9e3779b9;
    return function rand() {
        s ^= s << 13;
        s ^= s >>> 17;
        s ^= s << 5;
        return ((s >>> 0) / 4294967296);
    };
}

function _spec(e) {
    return {
        r: Math.min(1, Math.max(0, e < 0.5 ? e * 0.4 : 0.2 + (e - 0.5) * 1.6)),
        g: Math.min(1, Math.max(0, e < 0.3 ? 0.1 : e < 0.7 ? (e - 0.3) * 1.5 : 0.6 - (e - 0.7) * 1.5)),
        b: Math.min(1, Math.max(0, e < 0.5 ? 0.9 - e * 0.8 : 0.5 - (e - 0.5) * 1)),
    };
}

function _workerCount(count) {
    const hw = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency || 4) : 4;
    const usable = Math.max(1, hw - 1);
    if (count < 70000) return 1;
    if (count < 140000) return Math.min(3, usable);
    if (count < 320000) return Math.min(4, usable);
    return Math.min(6, usable);
}

export function particleSeed() {
    return ((Date.now() & 0xfffffff) ^ ((Math.random() * 0xffffffff) >>> 0)) >>> 0;
}

export function generateParticleBuffersSync({ count, inversion, hue, sat, lightness, seed = particleSeed(), start = 0, pos, vel, col } = {}) {
    const n = Math.max(0, count | 0);
    const offsetParticles = Math.max(0, start | 0);
    const rand = _makeRng((seed ^ ((offsetParticles + 1) * 0x9e3779b9)) >>> 0);
    const sR = Number.isFinite(+inversion) ? +inversion : 120;
    const h = Number.isFinite(+hue) ? +hue : 0.5;
    const s = Number.isFinite(+sat) ? +sat : 0.8;
    const l = Number.isFinite(+lightness) ? +lightness : 0.2;

    const outPos = pos || new Float32Array(n * 4);
    const outVel = vel || new Float32Array(n * 4);
    const outCol = col || new Float32Array(n * 4);

    for (let i = 0; i < n; i++) {
        const off = (offsetParticles + i) * 4;
        const th = rand() * TAU;
        const ph = Math.acos(2 * rand() - 1);
        const r = Math.cbrt(rand()) * sR * 0.8;
        const sinPh = Math.sin(ph);

        outPos[off + 0] = r * sinPh * Math.cos(th);
        outPos[off + 1] = r * sinPh * Math.sin(th);
        outPos[off + 2] = r * Math.cos(ph);
        outPos[off + 3] = 0.5 + rand() * 1.5;

        outVel[off + 0] = (rand() - 0.5) * 0.5;
        outVel[off + 1] = (rand() - 0.5) * 0.5;
        outVel[off + 2] = (rand() - 0.5) * 0.5;
        outVel[off + 3] = rand();

        const e = (h + rand() * l) % 1.0;
        const c = _spec(e);
        outCol[off + 0] = c.r * s + (1 - s);
        outCol[off + 1] = c.g * s + (1 - s);
        outCol[off + 2] = c.b * s + (1 - s);
        outCol[off + 3] = rand();
    }

    return { pos: outPos, vel: outVel, col: outCol };
}

function createSingleParticleWorker() {
    let worker = null;
    let nextId = 1;
    const pending = new Map();

    const spawn = () => {
        const w = new Worker(getParticleInitWorkerUrl());
        w.onmessage = (e) => {
            const m = e && e.data;
            if (!m || !pending.has(m.id)) return;
            const p = pending.get(m.id);
            pending.delete(m.id);
            if (m.type === 'filled') {
                p.resolve({ pos: m.pos, vel: m.vel, col: m.col });
            } else {
                p.reject(new Error(m.message || 'particle worker failed'));
            }
        };
        w.onerror = (err) => {
            for (const [, p] of pending) p.reject(Object.assign(new Error('particle worker error'), { cause: err }));
            pending.clear();
            try { w.terminate(); } catch (e) { console.error(e); }
            worker = null;
        };
        return w;
    };

    return {
        backend: 'worker-single',
        generate(opts = {}) {
            if (!worker) worker = spawn();
            const id = nextId++;
            return new Promise((resolve, reject) => {
                pending.set(id, { resolve, reject });
                try {
                    worker.postMessage({ ...opts, id, type: 'fill' });
                } catch (err) {
                    pending.delete(id);
                    reject(err);
                }
            }).catch((err) => {
                console.warn('[particles] worker init failed, using sync fallback', err);
                return generateParticleBuffersSync(opts);
            });
        },
        destroy() {
            for (const [, p] of pending) p.reject(new Error('particle worker destroyed'));
            pending.clear();
            try { if (worker) worker.terminate(); } catch (e) { console.error(e); }
            worker = null;
        },
    };
}

export function createParticleInitWorker() {
    if (typeof Worker === 'undefined') {
        return {
            generate: (opts) => Promise.resolve(generateParticleBuffersSync(opts)),
            destroy() {},
            backend: 'sync',
        };
    }

    const single = createSingleParticleWorker();
    let pool = null;
    let poolSize = 0;

    return {
        backend: hasSAB ? 'worker-pool-sab' : single.backend,
        async generate(opts = {}) {
            const count = Math.max(0, opts.count | 0);
            const canPool = hasSAB && count >= 70000;
            if (!canPool) return single.generate(opts);

            try {
                const desiredSize = Math.max(1, opts.workerCount | 0 || _workerCount(count));
                if (!pool || poolSize !== desiredSize) {
                    if (pool) await pool.terminate();
                    pool = new WorkerPool(getParticleInitWorkerUrl(), desiredSize);
                    poolSize = desiredSize;
                }

                const pos = allocTyped(Float32Array, count * 4);
                const vel = allocTyped(Float32Array, count * 4);
                const col = allocTyped(Float32Array, count * 4);
                const chunk = Math.ceil(count / desiredSize);
                const jobs = [];

                for (let i = 0; i < desiredSize; i++) {
                    const start = i * chunk;
                    const end = Math.min(count, start + chunk);
                    if (end <= start) continue;
                    jobs.push(pool.exec({
                        type: 'fillRange',
                        start,
                        count: end - start,
                        inversion: opts.inversion,
                        hue: opts.hue,
                        sat: opts.sat,
                        lightness: opts.lightness,
                        seed: ((opts.seed || particleSeed()) ^ (i * 0x85ebca6b)) >>> 0,
                        posBuffer: pos.buffer,
                        velBuffer: vel.buffer,
                        colBuffer: col.buffer,
                    }));
                }

                await Promise.all(jobs);
                return { pos, vel, col };
            } catch (err) {
                console.warn('[particles] SAB worker pool failed, using single worker fallback', err);
                return single.generate(opts);
            }
        },
        async destroy() {
            try { await single.destroy(); } catch (e) { console.error(e); }
            try { if (pool) await pool.terminate(); } catch (e) { console.error(e); }
            pool = null;
            poolSize = 0;
        },
    };
}

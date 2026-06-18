const TAU = Math.PI * 2;

function makeRng(seed) {
    let s = (seed >>> 0) || 0x9e3779b9;
    return function rand() {
        s ^= s << 13;
        s ^= s >>> 17;
        s ^= s << 5;
        return ((s >>> 0) / 4294967296);
    };
}

function spectralSpec(e) {
    return {
        r: Math.min(1, Math.max(0, e < 0.5 ? e * 0.4 : 0.2 + (e - 0.5) * 1.6)),
        g: Math.min(1, Math.max(0, e < 0.3 ? 0.1 : e < 0.7 ? (e - 0.3) * 1.5 : 0.6 - (e - 0.7) * 1.5)),
        b: Math.min(1, Math.max(0, e < 0.5 ? 0.9 - e * 0.8 : 0.5 - (e - 0.5) * 1)),
    };
}

function fillParticleBuffers({ count, inversion, hue, sat, lightness, seed, start = 0, pos, vel, col }) {
    const n = Math.max(0, count | 0);
    const offsetParticles = Math.max(0, start | 0);
    const rand = makeRng((seed ^ ((offsetParticles + 1) * 0x9e3779b9)) >>> 0);
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
        const c = spectralSpec(e);
        outCol[off + 0] = c.r * s + (1 - s);
        outCol[off + 1] = c.g * s + (1 - s);
        outCol[off + 2] = c.b * s + (1 - s);
        outCol[off + 3] = rand();
    }

    return { pos: outPos, vel: outVel, col: outCol };
}

function handleFill(m) {
    const buffers = fillParticleBuffers(m);
    self.postMessage({
        type: 'filled',
        id: m.id,
        pos: buffers.pos,
        vel: buffers.vel,
        col: buffers.col,
    }, [buffers.pos.buffer, buffers.vel.buffer, buffers.col.buffer]);
}

function handleFillRange(id, payload) {
    const pos = new Float32Array(payload.posBuffer);
    const vel = new Float32Array(payload.velBuffer);
    const col = new Float32Array(payload.colBuffer);
    fillParticleBuffers({ ...payload, pos, vel, col });
    self.postMessage({ id, result: { start: payload.start | 0, count: payload.count | 0 } });
}

self.onmessage = (e) => {
    const m = e && e.data;
    if (!m) return;

    try {
        if (m.type === 'fill') return handleFill(m);

        // WorkerPool protocol: { id, payload }. Used only with SAB-backed
        // buffers so all workers write into disjoint ranges of the same arrays.
        if (m.payload && m.payload.type === 'fillRange') return handleFillRange(m.id, m.payload);
    } catch (err) {
        if (m.payload) {
            self.postMessage({ id: m.id, error: err && err.message ? err.message : String(err || 'particle init failed') });
        } else {
            self.postMessage({
                type: 'error',
                id: m.id,
                message: err && err.message ? err.message : String(err || 'particle init failed'),
            });
        }
    }
};

const SHARED = {
    WRITE_INDEX: 0,
    SEQ: 1,
    READ_INDEX: 2,
    DROPPED: 3,
};

let samples = null;
let state = null;
let ringSize = 0;
let mask = 0;
let timer = null;
let level = 0;
let peak = 0;

function sampleLevel() {
    if (!samples || !state || ringSize <= 0) return;

    const writeAbs = Atomics.load(state, SHARED.WRITE_INDEX) | 0;
    let readAbs = Atomics.load(state, SHARED.READ_INDEX) | 0;
    const available = Math.max(0, writeAbs - readAbs);
    const maxRead = Math.min(available, ringSize, 4096);

    if (maxRead <= 0) {
        level *= 0.86;
        peak *= 0.82;
        postMessage({ type: 'level', level, peak, dropped: Atomics.load(state, SHARED.DROPPED) | 0 });
        return;
    }

    const start = writeAbs - maxRead;
    let sum = 0;
    let pk = 0;
    for (let i = 0; i < maxRead; i++) {
        const v = samples[(start + i) & mask] || 0;
        const a = v < 0 ? -v : v;
        if (a > pk) pk = a;
        sum += v * v;
    }

    readAbs = writeAbs;
    Atomics.store(state, SHARED.READ_INDEX, readAbs);

    const rms = Math.sqrt(sum / maxRead);
    level = level * 0.72 + rms * 0.28;
    peak = Math.max(pk, peak * 0.84);

    postMessage({ type: 'level', level, peak, dropped: Atomics.load(state, SHARED.DROPPED) | 0 });
}

self.onmessage = (e) => {
    const m = e && e.data;
    if (!m || typeof m !== 'object') return;

    if (m.type === 'start') {
        samples = new Float32Array(m.samplesSAB);
        state = new Int32Array(m.stateSAB);
        ringSize = m.ringSize | 0;
        mask = ringSize - 1;
        if (timer) clearInterval(timer);
        timer = setInterval(sampleLevel, Math.max(16, Math.min(250, m.intervalMs || 50)));
        sampleLevel();
        return;
    }

    if (m.type === 'stop') {
        if (timer) clearInterval(timer);
        timer = null;
        samples = null;
        state = null;
        ringSize = 0;
        mask = 0;
    }
};

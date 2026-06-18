import audioLevelWorkerUrl from './level.worker.js';
export function createAudioLevelBridge(sharedTap, opts = {}) {
    if (!sharedTap || !sharedTap.samples || !sharedTap.state || !sharedTap.ringSize) return null;
    if (typeof Worker === 'undefined') return null;
    if (typeof SharedArrayBuffer === 'undefined') return null;
    if (!(sharedTap.samples.buffer instanceof SharedArrayBuffer)) return null;

    let level = 0;
    let peak = 0;
    let dropped = 0;
    let worker = null;

    try {
        worker = new Worker(audioLevelWorkerUrl);
        worker.onmessage = (e) => {
            const m = e && e.data;
            if (!m || m.type !== 'level') return;
            level = Math.max(0, Number(m.level) || 0);
            peak = Math.max(0, Number(m.peak) || 0);
            dropped = Math.max(0, Number(m.dropped) || 0);
        };
        worker.postMessage({
            type: 'start',
            samplesSAB: sharedTap.samples.buffer,
            stateSAB: sharedTap.state.buffer,
            ringSize: sharedTap.ringSize | 0,
            intervalMs: opts.intervalMs || 50,
        });
    } catch (err) {
        console.warn('[audio] shared level worker unavailable', err);
        try { if (worker) worker.terminate(); } catch (e) { console.error(e); }
        return null;
    }

    return {
        getLevel() { return level; },
        getPeak() { return peak; },
        getDropped() { return dropped; },
        destroy() {
            try { if (worker) worker.postMessage({ type: 'stop' }); } catch (e) { console.error(e); }
            try { if (worker) worker.terminate(); } catch (e) { console.error(e); }
            worker = null;
        },
    };
}

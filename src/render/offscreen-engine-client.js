import * as THREE from 'three/webgpu';
import offscreenRendererWorkerUrl from './offscreen-renderer.worker.js';

function cloneJson(value, fallback = null) {
    if (value == null) return fallback;
    try { return JSON.parse(JSON.stringify(value)); } catch (e) { return fallback; }
}

function numberOr(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function forceFullscreenCanvasStyle(canvas) {
    if (!canvas || !canvas.style) return;
    try {
        canvas.style.position = 'fixed';
        canvas.style.inset = '0';
        canvas.style.width = '100vw';
        canvas.style.height = '100vh';
        canvas.style.display = 'block';
    } catch (e) {}
}

function getCanvasCssSize(canvas) {
    const readPositive = (v) => {
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : 0;
    };
    const viewportW = readPositive(window.innerWidth) || readPositive(document?.documentElement?.clientWidth) || 1;
    const viewportH = readPositive(window.innerHeight) || readPositive(document?.documentElement?.clientHeight) || 1;

    // This canvas is the full-screen playfield. A default HTML canvas reports
    // 300x150 before CSS/layout has settled, and trusting that is exactly what
    // made the worker render a tiny top-left viewport. Use viewport as source
    // of truth for #cv, then let ResizeObserver/window resize update it.
    if (canvas && canvas.id === 'cv') {
        forceFullscreenCanvasStyle(canvas);
        return { width: Math.max(1, Math.floor(viewportW)), height: Math.max(1, Math.floor(viewportH)) };
    }

    const clientW = readPositive(canvas?.clientWidth);
    const clientH = readPositive(canvas?.clientHeight);
    let rectW = 0;
    let rectH = 0;
    try {
        const rect = canvas && typeof canvas.getBoundingClientRect === 'function' ? canvas.getBoundingClientRect() : null;
        rectW = readPositive(rect?.width);
        rectH = readPositive(rect?.height);
    } catch (e) {}

    let width = clientW || viewportW || rectW || 1;
    let height = clientH || viewportH || rectH || 1;
    if (viewportW && width > viewportW * 1.1) width = viewportW;
    if (viewportH && height > viewportH * 1.1) height = viewportH;
    if (viewportW && width < viewportW * 0.5) width = viewportW;
    if (viewportH && height < viewportH * 0.5) height = viewportH;
    return { width: Math.max(1, Math.floor(width)), height: Math.max(1, Math.floor(height)) };
}

const OFFSCREEN_SAFE_TEXTURE_DIM = 8192;
const OFFSCREEN_TEXTURE_MARGIN = 64;

function computeResizeMetrics(canvas) {
    const { width, height } = getCanvasCssSize(canvas);
    const rawDpr = Math.max(1, Number(window.devicePixelRatio) || 1);
    // The transferred OffscreenCanvas must use the same final pixel grid that
    // the visible canvas is presenting. Letting DPR inflate the worker backing
    // store made the WebGPU viewport center and the DOM presentation center
    // diverge, which is the bottom-right drift we were seeing.
    return {
        width,
        height,
        cssWidth: width,
        cssHeight: height,
        devicePixelRatio: 1,
        rawDevicePixelRatio: rawDpr,
        maxTextureDimension2D: OFFSCREEN_SAFE_TEXTURE_DIM,
        backingWidth: width,
        backingHeight: height,
    };
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function nextFrame() {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function waitForCanvasLayout(canvas, {
    settleMs = 100,
    timeoutMs = 1200,
    minWidth = 320,
    minHeight = 240,
} = {}) {
    const nowFn = () => (performance && typeof performance.now === 'function') ? performance.now() : Date.now();
    const start = nowFn();
    let best = getCanvasCssSize(canvas);
    let last = best;
    let stableSince = 0;

    while (true) {
        await nextFrame();
        const now = nowFn();
        const current = getCanvasCssSize(canvas);
        if (current.width * current.height >= best.width * best.height) best = current;

        const valid = current.width >= minWidth && current.height >= minHeight;
        const same = Math.abs(current.width - last.width) <= 1 && Math.abs(current.height - last.height) <= 1;
        if (!same) {
            last = current;
            stableSince = now;
        } else if (!stableSince) {
            stableSince = now;
        }

        if (valid && same && (now - stableSince) >= settleMs) return current;
        if ((now - start) >= timeoutMs) return valid ? current : best;
    }
}

function copyEvent(event, extra = {}) {
    const data = {
        type: event.type,
        altKey: !!event.altKey,
        ctrlKey: !!event.ctrlKey,
        metaKey: !!event.metaKey,
        shiftKey: !!event.shiftKey,
        button: numberOr(event.button, 0),
        buttons: numberOr(event.buttons, 0),
        which: numberOr(event.which, 0),
        clientX: numberOr(event.clientX, 0),
        clientY: numberOr(event.clientY, 0),
        pageX: numberOr(event.pageX, 0),
        pageY: numberOr(event.pageY, 0),
        movementX: numberOr(event.movementX, 0),
        movementY: numberOr(event.movementY, 0),
        deltaX: numberOr(event.deltaX, 0),
        deltaY: numberOr(event.deltaY, 0),
        key: event.key || '',
        code: event.code || '',
        keyCode: numberOr(event.keyCode, 0),
        repeat: !!event.repeat,
        timeStamp: numberOr(event.timeStamp, performance.now()),
        ...extra
    };
    return data;
}

function shouldSkipKeyTarget(target) {
    return !!(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable));
}

function serializeWorkerEvent(event) {
    if (!event) return { message: 'Unknown worker failure' };
    const message = event.message || event.error?.message || event.reason?.message || event.type || String(event);
    return {
        name: event.name || event.type || 'WorkerEvent',
        message: String(message || 'Worker failure'),
        stack: event.error?.stack || event.reason?.stack || event.stack || '',
        filename: event.filename || '',
        lineno: event.lineno || 0,
        colno: event.colno || 0,
    };
}

function formatWorkerError(event, fallback = 'offscreen renderer worker failed') {
    const e = serializeWorkerEvent(event);
    const loc = e.filename ? ` @ ${e.filename}:${e.lineno || 0}:${e.colno || 0}` : '';
    return `${e.message || fallback}${loc}`;
}

function makeWorker(url, opts) {
    try { return new Worker(url, opts ? { ...opts, name: opts.name || 'scale-space-renderer' } : { name: 'scale-space-renderer' }); }
    catch (err) { return null; }
}

export function supportsOffscreenEngine() {
    return typeof Worker !== 'undefined'
        && typeof HTMLCanvasElement !== 'undefined'
        && !!HTMLCanvasElement.prototype.transferControlToOffscreen
        && typeof OffscreenCanvas !== 'undefined';
}


function arrayFromVectorLike(value, fallback = [0, 0, 0]) {
    try {
        if (value && typeof value.toArray === 'function') {
            const a = value.toArray();
            return [Number(a[0]) || 0, Number(a[1]) || 0, Number(a[2]) || 0];
        }
        if (Array.isArray(value)) {
            return [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0];
        }
        if (value && typeof value === 'object') {
            return [Number(value.x) || 0, Number(value.y) || 0, Number(value.z) || 0];
        }
    } catch (e) {}
    return fallback.slice();
}

function arrayFromQuatLike(value, fallback = [0, 0, 0, 1]) {
    try {
        if (value && typeof value.toArray === 'function') {
            const a = value.toArray();
            return [Number(a[0]) || 0, Number(a[1]) || 0, Number(a[2]) || 0, Number(a[3]) || 1];
        }
        if (Array.isArray(value)) {
            return [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0, Number(value[3]) || 1];
        }
        if (value && typeof value === 'object') {
            return [Number(value.x) || 0, Number(value.y) || 0, Number(value.z) || 0, Number(value.w) || 1];
        }
    } catch (e) {}
    return fallback.slice();
}

function makeCameraStateSnapshot(client) {
    const cam = client && client.cam && typeof client.cam === 'object' ? client.cam : {};
    const camera = client && client.camera && typeof client.camera === 'object' ? client.camera : {};
    const dist = Number.isFinite(+cam.dist) ? +cam.dist : (Number.isFinite(+cam.distTarget) ? +cam.distTarget : 100);
    const distTarget = Number.isFinite(+cam.distTarget) ? +cam.distTarget : dist;
    return {
        camera: {
            aspect: Number.isFinite(+camera.aspect) && +camera.aspect > 0 ? +camera.aspect : 1,
            fov: Number.isFinite(+camera.fov) && +camera.fov > 0 ? +camera.fov : 60,
            position: arrayFromVectorLike(camera.position, [0, 0, dist]),
            quaternion: arrayFromQuatLike(camera.quaternion, [0, 0, 0, 1]),
        },
        cam: {
            pos: arrayFromVectorLike(cam.pos, [0, 0, dist]),
            target: arrayFromVectorLike(cam.target, [0, 0, 0]),
            quat: arrayFromQuatLike(cam.quat, [0, 0, 0, 1]),
            dist,
            distTarget,
            yaw: Number.isFinite(+cam.yaw) ? +cam.yaw : 0,
            pitch: Number.isFinite(+cam.pitch) ? +cam.pitch : 0,
            orbitYaw: Number.isFinite(+cam.orbitYaw) ? +cam.orbitYaw : 0,
            orbitPitch: Number.isFinite(+cam.orbitPitch) ? +cam.orbitPitch : 0,
            flyMoveSpeed: Number.isFinite(+cam.flyMoveSpeed) ? +cam.flyMoveSpeed : 1,
            orbitZoomSpeed: Number.isFinite(+cam.orbitZoomSpeed) ? +cam.orbitZoomSpeed : 1,
        },
    };
}


function applyCameraStateToClient(client, state = {}) {
    if (!client || !state || typeof state !== 'object') return;
    const num = (v, fallback) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
    };
    const cam = client.cam || {};
    if (state.dist !== undefined) cam.dist = Math.max(1, num(state.dist, cam.dist || 100));
    if (state.distTarget !== undefined) cam.distTarget = Math.max(1, num(state.distTarget, cam.distTarget || cam.dist || 100));
    else if (state.dist !== undefined) cam.distTarget = cam.dist;
    if (state.yaw !== undefined) cam.yaw = num(state.yaw, cam.yaw || 0);
    if (state.pitch !== undefined) cam.pitch = num(state.pitch, cam.pitch || 0);
    if (state.orbitYaw !== undefined) cam.orbitYaw = num(state.orbitYaw, cam.orbitYaw || 0);
    if (state.orbitPitch !== undefined) cam.orbitPitch = num(state.orbitPitch, cam.orbitPitch || 0);
    if (state.flyMoveSpeed !== undefined) cam.flyMoveSpeed = Math.max(0.05, num(state.flyMoveSpeed, cam.flyMoveSpeed || 1));
    if (state.orbitZoomSpeed !== undefined) cam.orbitZoomSpeed = Math.max(0.1, num(state.orbitZoomSpeed, cam.orbitZoomSpeed || 1));
    if (Array.isArray(state.pos) && cam.pos?.fromArray) { try { cam.pos.fromArray(state.pos.slice(0, 3)); } catch (e) {} }
    if (Array.isArray(state.quat) && cam.quat?.fromArray) { try { cam.quat.fromArray(state.quat.slice(0, 4)).normalize(); } catch (e) {} }
    if (Array.isArray(state.target) && cam.target?.fromArray) { try { cam.target.fromArray(state.target.slice(0, 3)); } catch (e) {} }
}

export class OffscreenEngineClient {
    constructor(canvas, bgCanvas) {
        this.canvas = canvas;
        this.bgCanvas = bgCanvas || null;
        this.worker = null;
        this._seq = 0;
        this._pending = new Map();
        this._initialized = false;
        this._transferred = false;
        this._listeners = [];
        this._lastDebug = null;
        this._lastRenderPromise = null;
        this._inRender = false;
        this._lastRenderPacket = null;
        this._stateDirty = true;
        this._statePostTimer = null;
        this._lastAudioCopyAt = 0;
        this._lastFrequencyData = null;
        this._failed = false;
        this._failureReason = '';
        this._resizeObserver = null;
        this._resizePollTimer = null;
        this._lastResizeKey = '';
        const initSize = computeResizeMetrics(canvas);
        this._lastResizeMetrics = initSize;
        this.camera = {
            aspect: initSize.width / Math.max(1, initSize.height),
            fov: 60,
            position: new THREE.Vector3(),
            quaternion: new THREE.Quaternion(),
        };
        this.cam = {
            dist: 100,
            distTarget: 100,
            target: new THREE.Vector3(),
            pos: new THREE.Vector3(),
            quat: new THREE.Quaternion(),
            yaw: 0,
            pitch: 0,
            orbitYaw: 0,
            orbitPitch: 0,
            flyMoveSpeed: 1,
            orbitZoomSpeed: 1,
        };
        this.scene = null;
        this.renderer = {
            init: () => this.init(),
            setSize: (w, h) => this.resize(w, h),
            setPixelRatio: () => {},
        };
    }

    _request(type, payload = {}, transfer = []) {
        if (this._failed) return Promise.reject(new Error(this._failureReason || 'offscreen renderer worker failed'));
        if (!this.worker) return Promise.reject(new Error('offscreen renderer worker is not initialized'));
        const id = ++this._seq;
        return new Promise((resolve, reject) => {
            this._pending.set(id, { resolve, reject, type });
            try {
                this.worker.postMessage({ type, id, ...payload }, transfer);
            } catch (err) {
                this._pending.delete(id);
                reject(err);
            }
        });
    }

    _post(type, payload = {}, transfer = []) {
        if (!this.worker) return;
        try { this.worker.postMessage({ type, ...payload }, transfer); } catch (e) { console.error('[offscreen-render] post failed:', e); }
    }

    _snapshot() {
        return {
            S: cloneJson(window.S, {}),
            S_effective: cloneJson(window.S_effective || {}, {}),
            SS_PERF: cloneJson(window.SS_PERF || {}, {}),
            SS_FPS: cloneJson(window.SS_FPS || {}, {}),
            SS_AUDIO_FEATURES: cloneJson(window.SS_AUDIO_FEATURES || {}, {}),
            audioActive: !!(window.audio && window.audio.active),
            frequencyData: this._copyFrequencyData(),
            width: computeResizeMetrics(this.canvas).width,
            height: computeResizeMetrics(this.canvas).height,
            devicePixelRatio: (this._lastResizeMetrics && this._lastResizeMetrics.devicePixelRatio) || computeResizeMetrics(this.canvas).devicePixelRatio,
            rawDevicePixelRatio: Number(window.devicePixelRatio) || 1,
            captureInProgress: !!window._captureInProgress,
            transitionActive: !!window.transition,
            tourActive: !!(window.tour && window.tour.active),
            // Camera is owned by the renderer worker; regular state snapshots must not feed stale mirrored camera data back into it.
            cameraState: null,
        };
    }

    _copyFrequencyData() {
        const now = performance && typeof performance.now === 'function' ? performance.now() : Date.now();
        if (this._lastFrequencyData && (now - this._lastAudioCopyAt) < 50) return this._lastFrequencyData;
        try {
            if (window.audio && typeof window.audio.getFrequencyData === 'function') {
                const f = window.audio.getFrequencyData();
                if (f && typeof f.length === 'number') {
                    const maxBins = 512;
                    const n = Math.min(maxBins, f.length | 0);
                    const out = new Array(n);
                    for (let i = 0; i < n; i++) out[i] = f[i] || 0;
                    this._lastFrequencyData = out;
                    this._lastAudioCopyAt = now;
                    return out;
                }
            }
        } catch (e) {}
        this._lastFrequencyData = null;
        this._lastAudioCopyAt = now;
        return null;
    }

    _failAllPending(reason) {
        const message = String(reason || 'offscreen renderer worker failed');
        this._failed = true;
        this._failureReason = message;
        for (const [, pending] of this._pending) {
            try { pending.reject(new Error(message)); } catch (e) {}
        }
        this._pending.clear();
    }

    async _spawnWorker() {
        const candidates = [
            { label: 'module', opts: { type: 'module' } },
            { label: 'classic', opts: undefined },
        ];
        let lastError = null;
        for (const candidate of candidates) {
            const worker = makeWorker(offscreenRendererWorkerUrl, candidate.opts);
            if (!worker) {
                lastError = new Error(`Could not construct ${candidate.label} worker`);
                continue;
            }
            try {
                await this._probeWorker(worker, candidate.label);
                return worker;
            } catch (err) {
                lastError = err;
                try { worker.terminate(); } catch (e) {}
            }
        }
        throw lastError || new Error('Could not start offscreen renderer worker');
    }

    _probeWorker(worker, label = 'worker') {
        const id = ++this._seq;
        return new Promise((resolve, reject) => {
            let done = false;
            const finish = (ok, value) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                worker.removeEventListener('message', onMessage);
                worker.removeEventListener('error', onError);
                worker.removeEventListener('messageerror', onMessageError);
                ok ? resolve(value) : reject(value);
            };
            const onMessage = (event) => {
                const data = event.data || {};
                if (data.type === 'pong' && data.id === id) finish(true, true);
                else if (data.type === 'error') finish(false, new Error(data.message || `${label} worker reported an error before init`));
            };
            const onError = (event) => finish(false, new Error(formatWorkerError(event, `${label} worker script failed`)));
            const onMessageError = (event) => finish(false, new Error(formatWorkerError(event, `${label} worker message failed`)));
            const timer = setTimeout(() => finish(false, new Error(`${label} worker did not boot`)), 1200);
            worker.addEventListener('message', onMessage);
            worker.addEventListener('error', onError);
            worker.addEventListener('messageerror', onMessageError);
            try { worker.postMessage({ type: 'ping', id }); }
            catch (err) { finish(false, err); }
        });
    }

    async init() {
        if (this._initialized) return true;
        if (!supportsOffscreenEngine()) throw new Error('OffscreenCanvas renderer is not supported in this browser');
        if (this._transferred) throw new Error('Canvas was already transferred to the renderer worker');

        forceFullscreenCanvasStyle(this.canvas);
        this.worker = await this._spawnWorker();
        this.worker.onmessage = (event) => this._onMessage(event.data || {});
        this.worker.onerror = (event) => {
            const message = formatWorkerError(event);
            console.error('[offscreen-render] worker error:', message, event);
            this._failAllPending(message);
        };
        this.worker.onmessageerror = (event) => {
            const message = formatWorkerError(event, 'offscreen renderer worker message error');
            console.error('[offscreen-render] worker message error:', message, event);
            this._failAllPending(message);
        };

        await nextFrame();
        await wait(100);
        await waitForCanvasLayout(this.canvas, {
            settleMs: 100,
            timeoutMs: 1400,
        });
        const initMetrics = computeResizeMetrics(this.canvas);
        const { width, height } = initMetrics;
        this._lastResizeMetrics = initMetrics;
        try { this.canvas.width = initMetrics.width; } catch (e) {}
        try { this.canvas.height = initMetrics.height; } catch (e) {}
        const offscreen = this.canvas.transferControlToOffscreen();
        this._transferred = true;
        const storage = {};
        // Offscreen renderer owns its camera bootstrap. Do not replay old main-thread camera state.

        await this._request('init', {
            canvas: offscreen,
            snapshot: this._snapshot(),
            storage,
            width,
            height,
            cssWidth: initMetrics.cssWidth,
            cssHeight: initMetrics.cssHeight,
            backingWidth: initMetrics.backingWidth,
            backingHeight: initMetrics.backingHeight,
            devicePixelRatio: initMetrics.devicePixelRatio,
            rawDevicePixelRatio: initMetrics.rawDevicePixelRatio,
            maxTextureDimension2D: initMetrics.maxTextureDimension2D,
        }, [offscreen]);
        this._initialized = true;
        this._installEventProxy();
        await this._sendResize(width, height, { request: true, force: true });
        this._installResizeObserver();
        setTimeout(() => this.resize(), 100);
        setTimeout(() => this.resize(), 350);
        setTimeout(() => this.resize(), 900);
        return true;
    }

    _onMessage(message) {
        if (message.type === 'reply') {
            const pending = this._pending.get(message.id);
            if (!pending) return;
            this._pending.delete(message.id);
            if (message.ok === false) pending.reject(new Error(message.error || message.detail?.message || `${pending.type || 'worker'} failed`));
            else pending.resolve(message.result);
            return;
        }
        if (message.type === 'metrics') {
            this._inRender = false;
            this._lastRenderPromise = null;
            this._applyMetrics(message);
            return;
        }
        if (message.type === 'renderComplete') {
            this._inRender = false;
            this._lastRenderPromise = null;
            if (message.result) this._applyMetrics({ type: 'metrics', ...message.result });
            return;
        }
        if (message.type === 'storage') {
            try { localStorage.setItem(message.key, String(message.value ?? '')); } catch (e) {}
            return;
        }
        if (message.type === 'bgStyle') {
            if (this.bgCanvas && this.bgCanvas.style && message.key) {
                this.bgCanvas.style[message.key] = String(message.value ?? '');
            }
            return;
        }
        if (message.type === 'toast') {
            if (window.showParamToast) window.showParamToast(message.label || '', message.value || '');
            return;
        }
        if (message.type === 'error') {
            const detail = message.error && typeof message.error === 'object' ? message.error : null;
            const text = message.message || detail?.stack || detail?.message || String(message.error || message);
            console.error(`[offscreen-render] ${message.tag || 'worker'}:`, text);
        }
    }

    _applyMetrics(message) {
        if (message.debug) this._lastDebug = message.debug;
        if (message.camera) {
            this.camera.aspect = Number.isFinite(Number(message.camera.aspect)) ? Number(message.camera.aspect) : this.camera.aspect;
            this.camera.fov = Number.isFinite(Number(message.camera.fov)) ? Number(message.camera.fov) : this.camera.fov;
            if (Array.isArray(message.camera.position) && this.camera.position && this.camera.position.fromArray) {
                try { this.camera.position.fromArray(message.camera.position); } catch (e) {}
            }
        }
        if (message.cam) {
            const cam = message.cam;
            if (Number.isFinite(Number(cam.dist))) this.cam.dist = Number(cam.dist);
            if (Number.isFinite(Number(cam.distTarget))) this.cam.distTarget = Number(cam.distTarget);
            if (Number.isFinite(Number(cam.yaw))) this.cam.yaw = Number(cam.yaw);
            if (Number.isFinite(Number(cam.pitch))) this.cam.pitch = Number(cam.pitch);
            if (Number.isFinite(Number(cam.orbitYaw))) this.cam.orbitYaw = Number(cam.orbitYaw);
            if (Number.isFinite(Number(cam.orbitPitch))) this.cam.orbitPitch = Number(cam.orbitPitch);
            if (Number.isFinite(Number(cam.flyMoveSpeed))) this.cam.flyMoveSpeed = Number(cam.flyMoveSpeed);
            if (Number.isFinite(Number(cam.orbitZoomSpeed))) this.cam.orbitZoomSpeed = Number(cam.orbitZoomSpeed);
            if (Array.isArray(cam.quat) && this.cam.quat?.fromArray) { try { this.cam.quat.fromArray(cam.quat).normalize(); } catch (e) {} }
            if (Array.isArray(cam.pos) && this.cam.pos?.fromArray) { try { this.cam.pos.fromArray(cam.pos); } catch (e) {} }
            if (Array.isArray(cam.target) && this.cam.target?.fromArray) { try { this.cam.target.fromArray(cam.target); } catch (e) {} }
        }
        if (message.fps) {
            window.SS_WORKER_FPS = { ...message.fps, receivedAt: (performance && typeof performance.now === 'function') ? performance.now() : Date.now() };
        }
        if (message.pointsFallback) window.SS_POINTS_FALLBACK = message.pointsFallback;
        if (message.particleScale) {
            window.SS_PARTICLE_SCALE = message.particleScale;
            if (!window.SS_POINTS_FALLBACK && message.particleScale.pointsFallback) window.SS_POINTS_FALLBACK = message.particleScale.pointsFallback;
            if (typeof window.updateAdaptiveParticleCountReadout === 'function') {
                try { window.updateAdaptiveParticleCountReadout(message.particleScale); } catch (e) {}
            }
        }
        if (message.zoom) window.SS_ZOOM_OPT = message.zoom;
        if (message.visualStyle !== undefined) window.SS_VISUAL_EFFECT_STYLE = message.visualStyle;
        if (message.visualParamDrive !== undefined) window.SS_VISUAL_PARAM_DRIVE = message.visualParamDrive;
    }

    _installEventProxy() {
        if (this._listeners.length) return;
        const on = (target, type, fn, opts) => {
            target.addEventListener(type, fn, opts);
            this._listeners.push(() => target.removeEventListener(type, fn, opts));
        };
        const canvasEvent = (type, opts) => on(this.canvas, type, (event) => {
            this._post('event', { target: 'canvas', event: copyEvent(event) });
        }, opts);
        canvasEvent('mousedown');
        canvasEvent('mouseup');
        canvasEvent('mousemove');
        canvasEvent('wheel', { passive: true });
        canvasEvent('contextmenu');

        on(window, 'mouseup', (event) => this._post('event', { target: 'window', event: copyEvent(event) }));
        on(window, 'mousemove', (event) => this._post('event', { target: 'window', event: copyEvent(event) }));
        on(window, 'keydown', (event) => {
            if (shouldSkipKeyTarget(event.target)) return;
            if (event.code === 'Tab') {
                event.preventDefault();
                if (typeof window.setUIVisibility === 'function') window.setUIVisibility(!window.uiVisible);
            }
            if (event.code === 'Home') {
                event.preventDefault();
                if (typeof window.travelToHomepoint === 'function') window.travelToHomepoint();
            }
            this._post('event', { target: 'window', event: copyEvent(event, { targetIsInput: false }) });
        });
        on(window, 'keyup', (event) => {
            if (shouldSkipKeyTarget(event.target)) return;
            this._post('event', { target: 'window', event: copyEvent(event, { targetIsInput: false }) });
        });
        on(window, 'blur', (event) => this._post('event', { target: 'window', event: copyEvent(event) }));
        on(document, 'visibilitychange', () => this._post('event', { target: 'document', event: { type: 'visibilitychange', hidden: !!document.hidden } }));
    }

    _installResizeObserver() {
        if (this._resizeObserver || !this.canvas) return;
        if (typeof ResizeObserver === 'function') {
            this._resizeObserver = new ResizeObserver(() => this.resize());
            try { this._resizeObserver.observe(this.canvas); } catch (e) {}
        }
        const poll = () => {
            if (!this.worker || this._failed) return;
            this.resize();
            this._resizePollTimer = setTimeout(poll, 500);
        };
        this._resizePollTimer = setTimeout(poll, 500);
    }

    _resizePayload(metrics) {
        const width = metrics.width;
        const height = metrics.height;
        const rect = this.canvas && typeof this.canvas.getBoundingClientRect === 'function'
            ? this.canvas.getBoundingClientRect()
            : { left: 0, top: 0, right: width, bottom: height, width, height };
        return {
            width,
            height,
            cssWidth: metrics.cssWidth || width,
            cssHeight: metrics.cssHeight || height,
            backingWidth: metrics.backingWidth,
            backingHeight: metrics.backingHeight,
            devicePixelRatio: metrics.devicePixelRatio,
            rawDevicePixelRatio: metrics.rawDevicePixelRatio,
            maxTextureDimension2D: metrics.maxTextureDimension2D,
            left: Number(rect.left) || 0,
            top: Number(rect.top) || 0,
            right: Number(rect.right) || width,
            bottom: Number(rect.bottom) || height,
            snapshot: this._snapshot(),
        };
    }

    _sendResize(width, height, { request = false, force = false } = {}) {
        const metrics = computeResizeMetrics(this.canvas);
        if (width != null) {
            metrics.width = metrics.cssWidth = Math.max(1, Math.floor(Number(width) || 1));
            metrics.backingWidth = metrics.width;
        }
        if (height != null) {
            metrics.height = metrics.cssHeight = Math.max(1, Math.floor(Number(height) || 1));
            metrics.backingHeight = metrics.height;
        }
        this._lastResizeMetrics = metrics;
        try { this.canvas.width = metrics.width; } catch (e) {}
        try { this.canvas.height = metrics.height; } catch (e) {}
        this.camera.aspect = metrics.width / Math.max(1, metrics.height);
        const payload = this._resizePayload(metrics);
        const key = `${payload.width}x${payload.height}:${payload.backingWidth}x${payload.backingHeight}@${payload.devicePixelRatio}:${payload.left},${payload.top}`;
        if (!force && key === this._lastResizeKey) return request ? Promise.resolve(true) : undefined;
        this._lastResizeKey = key;
        if (request) return this._request('resize', payload);
        this._post('resize', payload);
        return undefined;
    }

    setupControls() {
        this._installEventProxy();
    }

    resize(width, height) {
        const currentSize = computeResizeMetrics(this.canvas);
        if (width == null) width = currentSize.width;
        if (height == null) height = currentSize.height;
        this._sendResize(width, height);
    }

    async render() {
        if (!this._initialized) await this.init();
        const packet = this._snapshot();
        this._lastRenderPacket = packet;
        this._post('state', { snapshot: packet });
        this._stateDirty = false;
        return this._lastDebug;
    }

    updateUniforms() {
        // In the worker renderer, render() already sends the latest state once
        // per frame. Randomizer transitions can call updateUniforms every RAF;
        // posting a full snapshot for each call floods the worker queue and can
        // make the canvas appear frozen. Mark dirty and let the next render tick
        // carry the newest state instead.
        this._stateDirty = true;
        if (this._statePostTimer || this._inRender) return;
        this._statePostTimer = setTimeout(() => {
            this._statePostTimer = null;
            if (!this._initialized || this._inRender || !this._stateDirty) return;
            this._post('state', { snapshot: this._snapshot() });
            this._stateDirty = false;
        }, 80);
    }

    applyCameraStateSnapshot(state = {}) {
        const clean = cloneJson(state, null);
        if (!clean) return false;
        applyCameraStateToClient(this, clean);
        this._post('cameraState', { state: clean, snapshot: this._snapshot() });
        return true;
    }

    applyPixelRatioIfNeeded(force = false) {
        this._post('call', { method: 'applyPixelRatioIfNeeded', args: [!!force], snapshot: this._snapshot() });
    }

    applyPerfLimits() {
        this._post('call', { method: 'applyPerfLimits', args: [], snapshot: this._snapshot() });
    }

    resizeParticles(count, options = {}) {
        return this._request('call', { method: 'resizeParticles', args: [Math.round(Number(count) || 0), options || {}], snapshot: this._snapshot() });
    }

    reinitializeParticles(opts = {}) {
        return this._request('call', { method: 'reinitializeParticles', args: [opts || {}], snapshot: this._snapshot() });
    }

    ensureParticleVisibilityBootstrap() {
        return this._request('call', { method: 'ensureParticleVisibilityBootstrap', args: [], snapshot: this._snapshot() });
    }

    forceParticleVisibility() {
        this._post('call', { method: 'forceParticleVisibility', args: [], snapshot: this._snapshot() });
    }

    getVisibilityDebug() {
        return this._lastDebug;
    }

    getZoomOptimizationState() {
        return window.SS_ZOOM_OPT || (this._lastDebug && this._lastDebug.zoom) || { close: 0, effectScale: 1, activeScale: 1, pixelRatioScale: 1, overdrawPressure: 0 };
    }

    terminate() {
        for (const off of this._listeners.splice(0)) {
            try { off(); } catch (e) {}
        }
        if (this._statePostTimer) {
            clearTimeout(this._statePostTimer);
            this._statePostTimer = null;
        }
        if (this._resizeObserver) {
            try { this._resizeObserver.disconnect(); } catch (e) {}
            this._resizeObserver = null;
        }
        if (this._resizePollTimer) {
            clearTimeout(this._resizePollTimer);
            this._resizePollTimer = null;
        }
        for (const [, p] of this._pending) p.reject(new Error('offscreen renderer terminated'));
        this._pending.clear();
        try { if (this.worker) this.worker.terminate(); } catch (e) {}
        this.worker = null;
    }
}

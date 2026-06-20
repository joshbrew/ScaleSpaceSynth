let EngineClass = null;
let engine = null;
let visualEffectsState = null;
let initialized = false;
let proxyCanvas = null;
let canvas = null;
let storageMap = Object.create(null);
let frame = 0;

const listeners = new WeakMap();

function makeEventTarget(label) {
    return {
        _label: label,
        addEventListener(type, fn) {
            if (!listeners.has(this)) listeners.set(this, new Map());
            const map = listeners.get(this);
            if (!map.has(type)) map.set(type, new Set());
            map.get(type).add(fn);
        },
        removeEventListener(type, fn) {
            const map = listeners.get(this);
            if (!map || !map.has(type)) return;
            map.get(type).delete(fn);
        },
        dispatchEvent(event) {
            const map = listeners.get(this);
            if (!map || !map.has(event.type)) return true;
            for (const fn of Array.from(map.get(event.type))) {
                try { fn.call(this, event); } catch (err) { reportError('Event Proxy Error', err); }
            }
            return !event.defaultPrevented;
        }
    };
}

const fakeWindow = makeEventTarget('window');
const fakeDocument = makeEventTarget('document');
const fakeBody = makeEventTarget('body');

function makeClassList() {
    const set = new Set();
    return {
        add: (...names) => names.forEach(n => set.add(String(n))),
        remove: (...names) => names.forEach(n => set.delete(String(n))),
        toggle: (name, force) => {
            name = String(name);
            const next = force === undefined ? !set.has(name) : !!force;
            if (next) set.add(name); else set.delete(name);
            return next;
        },
        contains: (name) => set.has(String(name)),
        toString: () => Array.from(set).join(' '),
    };
}

function makeElement(tag = 'div') {
    const el = makeEventTarget(tag);
    el.tagName = String(tag).toUpperCase();
    el.nodeName = el.tagName;
    el.children = [];
    el.style = {};
    el.classList = makeClassList();
    el.appendChild = (child) => { el.children.push(child); return child; };
    el.removeChild = (child) => { const i = el.children.indexOf(child); if (i >= 0) el.children.splice(i, 1); return child; };
    el.setAttribute = (k, v) => { el[k] = String(v); };
    el.getAttribute = (k) => el[k];
    el.getBoundingClientRect = () => ({ left: 0, top: 0, right: fakeWindow.innerWidth || 1, bottom: fakeWindow.innerHeight || 1, width: fakeWindow.innerWidth || 1, height: fakeWindow.innerHeight || 1 });
    return el;
}

function makeCanvasElement(width = 64, height = 64) {
    let c;
    try { c = new OffscreenCanvas(width, height); }
    catch (e) { c = makeElement('canvas'); }
    return installCanvasDomShim(c, width, height);
}


function installCanvasDomShim(c, width = 1, height = 1) {
    if (!c) return c;
    const w = Math.max(1, Math.floor(Number(width) || 1));
    const h = Math.max(1, Math.floor(Number(height) || 1));
    try { c.width = w; } catch (e) {}
    try { c.height = h; } catch (e) {}

    const ensureValue = (key, value) => {
        try {
            if (c[key] === undefined || c[key] === null) c[key] = value;
            return;
        } catch (e) {}
        try {
            Object.defineProperty(c, key, {
                value,
                writable: true,
                configurable: true,
                enumerable: false,
            });
        } catch (e) {}
    };

    ensureValue('style', {});
    ensureValue('classList', makeClassList());
    ensureValue('tagName', 'CANVAS');
    ensureValue('nodeName', 'CANVAS');
    ensureValue('ownerDocument', fakeDocument);
    ensureValue('parentElement', fakeBody);

    try { c.clientWidth = w; } catch (e) { ensureValue('clientWidth', w); }
    try { c.clientHeight = h; } catch (e) { ensureValue('clientHeight', h); }
    try { c.style.width = `${w}px`; } catch (e) {}
    try { c.style.height = `${h}px`; } catch (e) {}

    if (typeof c.addEventListener !== 'function') {
        const target = makeEventTarget('offscreenCanvas');
        ensureValue('addEventListener', target.addEventListener.bind(target));
        ensureValue('removeEventListener', target.removeEventListener.bind(target));
        ensureValue('dispatchEvent', target.dispatchEvent.bind(target));
    }
    if (typeof c.getBoundingClientRect !== 'function') {
        ensureValue('getBoundingClientRect', () => ({
            left: 0,
            top: 0,
            right: c.clientWidth || c.width || w,
            bottom: c.clientHeight || c.height || h,
            width: c.clientWidth || c.width || w,
            height: c.clientHeight || c.height || h,
        }));
    }
    return c;
}

function resizeCanvasDomShim(c, width = 1, height = 1, backingWidth = null, backingHeight = null) {
    if (!c) return;
    const w = Math.max(1, Math.floor(Number(width) || 1));
    const h = Math.max(1, Math.floor(Number(height) || 1));
    const bw = Math.max(1, Math.floor(Number(backingWidth) || w));
    const bh = Math.max(1, Math.floor(Number(backingHeight) || h));
    try { c.width = bw; } catch (e) {}
    try { c.height = bh; } catch (e) {}
    try { c.clientWidth = w; } catch (e) {}
    try { c.clientHeight = h; } catch (e) {}
    try {
        if (!c.style) installCanvasDomShim(c, w, h);
        c.style.width = `${w}px`;
        c.style.height = `${h}px`;
    } catch (e) {}
}

function makeBgProxy() {
    const style = new Proxy({}, {
        set(target, key, value) {
            target[key] = value;
            postMessage({ type: 'bgStyle', key: String(key), value: String(value ?? '') });
            return true;
        }
    });
    return { style };
}

function installShims({ width = 1, height = 1, devicePixelRatio = 1, storage = {} } = {}) {
    storageMap = { ...(storage || {}) };

    fakeWindow.window = fakeWindow;
    fakeWindow.self = globalThis;
    fakeWindow.globalThis = globalThis;
    fakeWindow.innerWidth = Math.max(1, Math.floor(width));
    fakeWindow.innerHeight = Math.max(1, Math.floor(height));
    fakeWindow.devicePixelRatio = Number(devicePixelRatio) || 1;
    fakeWindow.performance = performance;
    fakeWindow.requestAnimationFrame = (...args) => globalThis.requestAnimationFrame(...args);
    fakeWindow.cancelAnimationFrame = (...args) => globalThis.cancelAnimationFrame(...args);
    fakeWindow.setTimeout = (...args) => globalThis.setTimeout(...args);
    fakeWindow.clearTimeout = (...args) => globalThis.clearTimeout(...args);
    fakeWindow.setInterval = (...args) => globalThis.setInterval(...args);
    fakeWindow.clearInterval = (...args) => globalThis.clearInterval(...args);
    fakeWindow.navigator = globalThis.navigator;
    fakeWindow.location = { href: '', search: '', origin: '' };
    fakeWindow.S = fakeWindow.S || {};
    fakeWindow.S_effective = fakeWindow.S_effective || {};
    fakeWindow.SS_PERF = fakeWindow.SS_PERF || {};
    fakeWindow.SS_FPS = fakeWindow.SS_FPS || {};
    fakeWindow.SS_AUDIO_FEATURES = fakeWindow.SS_AUDIO_FEATURES || {};
    fakeWindow.SS_AUDIO_FREQUENCY_DATA = null;
    fakeWindow.audio = {
        active: false,
        getFrequencyData() {
            return fakeWindow.SS_AUDIO_FREQUENCY_DATA || new Uint8Array(0);
        }
    };
    globalThis.audio = fakeWindow.audio;
    fakeWindow.uiVisible = true;
    fakeWindow.transition = null;
    fakeWindow.tour = { active: false };
    fakeWindow.setUIVisibility = (visible) => { fakeWindow.uiVisible = !!visible; };
    fakeWindow.refreshSpeedPopups = () => {};
    fakeWindow.showParamToast = (label, value) => postMessage({ type: 'toast', label, value });
    fakeWindow.showToast = (message) => postMessage({ type: 'toast', label: message, value: '' });

    fakeDocument.hidden = false;
    fakeDocument.body = fakeBody;
    fakeDocument.documentElement = makeElement('html');
    fakeDocument.createElement = (tag) => {
        tag = String(tag || '').toLowerCase();
        if (tag === 'canvas') return makeCanvasElement(64, 64);
        return makeElement(tag || 'div');
    };
    fakeDocument.getElementById = () => null;
    fakeDocument.querySelector = () => null;
    fakeDocument.querySelectorAll = () => [];
    fakeBody.appendChild = () => null;
    fakeBody.removeChild = () => null;
    fakeBody.classList = makeClassList();
    fakeBody.style = {};

    globalThis.window = fakeWindow;
    globalThis.document = fakeDocument;
    globalThis.localStorage = {
        getItem(key) {
            key = String(key);
            return Object.prototype.hasOwnProperty.call(storageMap, key) ? storageMap[key] : null;
        },
        setItem(key, value) {
            key = String(key);
            value = String(value);
            storageMap[key] = value;
            postMessage({ type: 'storage', key, value });
        },
        removeItem(key) {
            key = String(key);
            delete storageMap[key];
            postMessage({ type: 'storage', key, value: '' });
        }
    };
    fakeWindow.localStorage = globalThis.localStorage;

    if (typeof globalThis.requestAnimationFrame !== 'function') {
        globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);
    }
    if (typeof globalThis.cancelAnimationFrame !== 'function') {
        globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
    }
    if (typeof globalThis.CustomEvent !== 'function') {
        globalThis.CustomEvent = class CustomEvent {
            constructor(type, init = {}) {
                this.type = type;
                this.detail = init.detail;
                this.bubbles = !!init.bubbles;
                this.cancelable = !!init.cancelable;
            }
        };
    }
}

function ensureWorkerAudioBridge() {
    if (!fakeWindow.audio || typeof fakeWindow.audio !== 'object') {
        fakeWindow.audio = {};
    }
    if (typeof fakeWindow.audio.getFrequencyData !== 'function') {
        fakeWindow.audio.getFrequencyData = () => fakeWindow.SS_AUDIO_FREQUENCY_DATA || new Uint8Array(0);
    }
    if (fakeWindow.audio.active === undefined) fakeWindow.audio.active = false;
    globalThis.audio = fakeWindow.audio;
    return fakeWindow.audio;
}

function applySnapshot(snapshot = {}) {
    if (!snapshot || typeof snapshot !== 'object') return;
    if (snapshot.S && typeof snapshot.S === 'object') fakeWindow.S = snapshot.S;
    if (snapshot.S_effective && typeof snapshot.S_effective === 'object') fakeWindow.S_effective = snapshot.S_effective;
    else fakeWindow.S_effective = {};
    if (snapshot.SS_PERF && typeof snapshot.SS_PERF === 'object') fakeWindow.SS_PERF = snapshot.SS_PERF;
    if (snapshot.SS_FPS && typeof snapshot.SS_FPS === 'object') fakeWindow.SS_FPS = snapshot.SS_FPS;
    if (snapshot.SS_AUDIO_FEATURES && typeof snapshot.SS_AUDIO_FEATURES === 'object') fakeWindow.SS_AUDIO_FEATURES = snapshot.SS_AUDIO_FEATURES;
    fakeWindow._captureInProgress = !!snapshot.captureInProgress;
    fakeWindow.transition = snapshot.transitionActive ? (fakeWindow.transition || { active: true }) : null;
    fakeWindow.tour = { active: !!snapshot.tourActive };
    if (Array.isArray(snapshot.frequencyData)) fakeWindow.SS_AUDIO_FREQUENCY_DATA = new Uint8Array(snapshot.frequencyData);
    else fakeWindow.SS_AUDIO_FREQUENCY_DATA = null;
    const audioBridge = ensureWorkerAudioBridge();
    audioBridge.active = !!snapshot.audioActive;
    if (snapshot.width) fakeWindow.innerWidth = Math.max(1, Math.floor(snapshot.width));
    if (snapshot.height) fakeWindow.innerHeight = Math.max(1, Math.floor(snapshot.height));
    if (snapshot.devicePixelRatio) fakeWindow.devicePixelRatio = Number(snapshot.devicePixelRatio) || 1;
    // Camera is owned by the renderer worker. Main-thread snapshots must not
    // replay stale mirrored camera state into the worker.
    // applyCameraState(snapshot.cameraState || null);
}

function applyCameraState(state = null) {
    if (!state || !engine || !engine.cam) return;
    const cam = engine.cam;
    const num = (v, fb) => { const n = Number(v); return Number.isFinite(n) ? n : fb; };
    if (state.dist !== undefined) cam.dist = Math.max(1, num(state.dist, cam.dist || 100));
    if (state.distTarget !== undefined) cam.distTarget = Math.max(1, num(state.distTarget, cam.distTarget || cam.dist || 100));
    if (state.yaw !== undefined) cam.yaw = num(state.yaw, cam.yaw || 0);
    if (state.pitch !== undefined) cam.pitch = num(state.pitch, cam.pitch || 0);
    if (state.orbitYaw !== undefined) cam.orbitYaw = num(state.orbitYaw, cam.orbitYaw || 0);
    if (state.orbitPitch !== undefined) cam.orbitPitch = num(state.orbitPitch, cam.orbitPitch || 0);
    if (state.flyMoveSpeed !== undefined) cam.flyMoveSpeed = num(state.flyMoveSpeed, cam.flyMoveSpeed || 1);
    if (state.orbitZoomSpeed !== undefined) cam.orbitZoomSpeed = num(state.orbitZoomSpeed, cam.orbitZoomSpeed || 1);
    if (Array.isArray(state.quat) && cam.quat && typeof cam.quat.fromArray === 'function') {
        try { cam.quat.fromArray(state.quat).normalize(); } catch (e) {}
    }
    if (Array.isArray(state.pos) && cam.pos && typeof cam.pos.fromArray === 'function') {
        try { cam.pos.fromArray(state.pos); } catch (e) {}
    }
    if (Array.isArray(state.target) && cam.target && typeof cam.target.fromArray === 'function') {
        try { cam.target.fromArray(state.target); } catch (e) {}
    }
}

function makeProxyCanvas(width, height) {
    const target = makeEventTarget('proxyCanvas');
    target.left = 0;
    target.top = 0;
    target.width = width;
    target.height = height;
    target.clientWidth = width;
    target.clientHeight = height;
    target.right = width;
    target.bottom = height;
    target.style = { width: `${Math.max(1, Math.floor(width || 1))}px`, height: `${Math.max(1, Math.floor(height || 1))}px` };
    target.classList = makeClassList();
    target.tagName = 'CANVAS';
    target.nodeName = 'CANVAS';
    target.ownerDocument = fakeDocument;
    target.parentElement = fakeBody;
    target.getBoundingClientRect = () => ({ left: 0, top: 0, right: target.clientWidth || 1, bottom: target.clientHeight || 1, width: target.clientWidth || 1, height: target.clientHeight || 1 });
    return target;
}

function makeEvent(data = {}) {
    return {
        ...data,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.cancelBubble = true; },
        target: data.target || null,
        currentTarget: data.currentTarget || null,
        defaultPrevented: false,
    };
}

class ElementProxyReceiver {
    constructor(proxied = null) {
        this.__listeners = Object.create(null);
        this.proxied = proxied;
        this.style = {};
        this.left = 0;
        this.top = 0;
        this.width = 1;
        this.height = 1;
        this.right = 1;
        this.bottom = 1;
    }

    get clientWidth() { return this.width; }
    get clientHeight() { return this.height; }

    addEventListener(type, listener) {
        type = String(type || '');
        if (!type || typeof listener !== 'function') return;
        if (!this.__listeners[type]) this.__listeners[type] = [];
        if (this.__listeners[type].indexOf(listener) < 0) this.__listeners[type].push(listener);
    }

    removeEventListener(type, listener) {
        type = String(type || '');
        const arr = this.__listeners[type];
        if (!arr) return;
        const i = arr.indexOf(listener);
        if (i >= 0) arr.splice(i, 1);
    }

    dispatchEvent(event, target = this.proxied || this) {
        if (!event || !event.type) return true;
        const arr = this.__listeners[event.type];
        if (!arr || !arr.length) return !event.defaultPrevented;
        if (!event.target) event.target = target;
        event.currentTarget = target;
        for (const fn of arr.slice()) {
            try { fn.call(target, event); } catch (err) { reportError('Canvas Proxy Event Error', err); }
        }
        return !event.defaultPrevented;
    }

    setPointerCapture() {}
    releasePointerCapture() {}
    focus() {}
    blur() {}

    getBoundingClientRect = () => ({
        left: this.left,
        top: this.top,
        right: this.right,
        bottom: this.bottom,
        width: this.width,
        height: this.height,
    });

    handleEvent = (data = {}) => {
        const event = makeEvent(data);
        if (event.type === 'resize') {
            const width = Math.max(1, Math.floor(Number(data.width) || Number(data.clientWidth) || this.width || 1));
            const height = Math.max(1, Math.floor(Number(data.height) || Number(data.clientHeight) || this.height || 1));
            this.left = Number(data.left) || 0;
            this.top = Number(data.top) || 0;
            this.width = width;
            this.height = height;
            this.right = Number(data.right) || this.left + width;
            this.bottom = Number(data.bottom) || this.top + height;
            this.style.width = `${width}px`;
            this.style.height = `${height}px`;
            const target = this.proxied;
            if (target && typeof target === 'object') {
                try { target.style = this.style; } catch (e) {}
                try { target.clientWidth = width; } catch (e) {}
                try { target.clientHeight = height; } catch (e) {}
            }
        }
        event.preventDefault = event.preventDefault || (() => { event.defaultPrevented = true; });
        event.stopPropagation = event.stopPropagation || (() => { event.cancelBubble = true; });
        return this.dispatchEvent(event, this.proxied || this);
    };
}

function defineCanvasProxyValue(target, key, value) {
    if (!target) return;
    try {
        target[key] = value;
        return;
    } catch (e) {}
    try {
        Object.defineProperty(target, key, {
            value,
            writable: true,
            configurable: true,
            enumerable: false,
        });
    } catch (e) {}
}

function defineCanvasProxyGetter(target, key, getter) {
    if (!target) return;
    try {
        Object.defineProperty(target, key, {
            get: getter,
            configurable: true,
            enumerable: false,
        });
    } catch (e) {
        try { target[key] = getter(); } catch (err) {}
    }
}

function installThreeCanvasProxy(target, width = 1, height = 1, rect = {}) {
    if (!target) return null;
    const proxy = target.proxy instanceof ElementProxyReceiver ? target.proxy : new ElementProxyReceiver(target);
    proxy.proxied = target;
    defineCanvasProxyValue(target, 'proxy', proxy);
    defineCanvasProxyValue(target, 'style', proxy.style);
    defineCanvasProxyValue(target, 'classList', target.classList || makeClassList());
    defineCanvasProxyValue(target, 'tagName', 'CANVAS');
    defineCanvasProxyValue(target, 'nodeName', 'CANVAS');
    defineCanvasProxyValue(target, 'ownerDocument', fakeDocument);
    defineCanvasProxyValue(target, 'parentElement', fakeBody);
    defineCanvasProxyValue(target, 'setPointerCapture', proxy.setPointerCapture.bind(proxy));
    defineCanvasProxyValue(target, 'releasePointerCapture', proxy.releasePointerCapture.bind(proxy));
    defineCanvasProxyValue(target, 'getBoundingClientRect', proxy.getBoundingClientRect.bind(proxy));
    defineCanvasProxyValue(target, 'addEventListener', proxy.addEventListener.bind(proxy));
    defineCanvasProxyValue(target, 'removeEventListener', proxy.removeEventListener.bind(proxy));
    defineCanvasProxyValue(target, 'dispatchEvent', proxy.dispatchEvent.bind(proxy));
    defineCanvasProxyValue(target, 'handleEvent', proxy.handleEvent.bind(proxy));
    defineCanvasProxyValue(target, 'focus', proxy.focus.bind(proxy));
    defineCanvasProxyValue(target, 'blur', proxy.blur.bind(proxy));
    defineCanvasProxyGetter(target, 'clientWidth', () => proxy.width);
    defineCanvasProxyGetter(target, 'clientHeight', () => proxy.height);
    proxy.handleEvent({
        type: 'resize',
        width,
        height,
        left: Number(rect.left) || 0,
        top: Number(rect.top) || 0,
        right: Number(rect.right) || (Number(rect.left) || 0) + width,
        bottom: Number(rect.bottom) || (Number(rect.top) || 0) + height,
    });
    return proxy;
}

function updateProxyCanvasSizeFromEvent(event = {}) {
    if (!proxyCanvas) return;
    const width = Math.max(1, Math.floor(Number(event.width) || Number(event.clientWidth) || proxyCanvas.clientWidth || fakeWindow.innerWidth || 1));
    const height = Math.max(1, Math.floor(Number(event.height) || Number(event.clientHeight) || proxyCanvas.clientHeight || fakeWindow.innerHeight || 1));
    proxyCanvas.left = Number(event.left) || 0;
    proxyCanvas.top = Number(event.top) || 0;
    proxyCanvas.width = width;
    proxyCanvas.height = height;
    proxyCanvas.clientWidth = width;
    proxyCanvas.clientHeight = height;
    proxyCanvas.right = Number(event.right) || proxyCanvas.left + width;
    proxyCanvas.bottom = Number(event.bottom) || proxyCanvas.top + height;
    if (proxyCanvas.style) {
        proxyCanvas.style.width = `${width}px`;
        proxyCanvas.style.height = `${height}px`;
    }
}

function dispatchProxyEvent(target, event) {
    if (!event || !event.type) return;
    const ev = makeEvent(event);
    if (target === 'canvas' && canvas && typeof canvas.handleEvent === 'function') {
        canvas.handleEvent(event);
        return;
    }
    if (target === 'canvas' && proxyCanvas) {
        if (event.type === 'resize') updateProxyCanvasSizeFromEvent(event);
        ev.target = proxyCanvas;
        ev.currentTarget = proxyCanvas;
        proxyCanvas.dispatchEvent(ev);
        return;
    }
    if (target === 'document') {
        fakeDocument.hidden = !!event.hidden;
        ev.target = fakeDocument;
        ev.currentTarget = fakeDocument;
        fakeDocument.dispatchEvent(ev);
        return;
    }
    ev.target = fakeWindow;
    ev.currentTarget = fakeWindow;
    fakeWindow.dispatchEvent(ev);
}

function cameraMetrics() {
    if (!engine || !engine.camera) return null;
    const camera = engine.camera;
    const cam = engine.cam || {};
    return {
        camera: {
            aspect: camera.aspect,
            fov: camera.fov,
            position: camera.position && camera.position.toArray ? camera.position.toArray() : null,
        },
        cam: {
            dist: cam.dist,
            distTarget: cam.distTarget,
            yaw: cam.yaw,
            pitch: cam.pitch,
            orbitYaw: cam.orbitYaw,
            orbitPitch: cam.orbitPitch,
            flyMoveSpeed: cam.flyMoveSpeed,
            orbitZoomSpeed: cam.orbitZoomSpeed,
            quat: cam.quat && cam.quat.toArray ? cam.quat.toArray() : null,
            pos: cam.pos && cam.pos.toArray ? cam.pos.toArray() : null,
            target: cam.target && cam.target.toArray ? cam.target.toArray() : null,
        }
    };
}

function collectMetrics(includeDebug = false) {
    let debug = null;
    if (includeDebug && engine && typeof engine.getVisibilityDebug === 'function') {
        try { debug = engine.getVisibilityDebug(); } catch (e) {}
    }
    return {
        particleScale: fakeWindow.SS_PARTICLE_SCALE || null,
        pointsFallback: fakeWindow.SS_POINTS_FALLBACK || null,
        zoom: fakeWindow.SS_ZOOM_OPT || null,
        visualStyle: fakeWindow.SS_VISUAL_EFFECT_STYLE || '',
        visualParamDrive: fakeWindow.SS_VISUAL_PARAM_DRIVE || null,
        fps: collectWorkerFpsMetrics(),
        debug,
        ...cameraMetrics(),
    };
}

function serializeError(err) {
    if (!err) return { message: 'Unknown worker error' };
    if (err instanceof Error) {
        return {
            name: err.name || 'Error',
            message: err.message || String(err),
            stack: err.stack || '',
        };
    }
    if (err && typeof err === 'object') {
        const anyErr = err;
        const message = anyErr.message || anyErr.reason?.message || anyErr.error?.message || anyErr.type || String(err);
        return {
            name: anyErr.name || anyErr.type || 'WorkerEvent',
            message: String(message || 'Worker event'),
            stack: anyErr.stack || anyErr.reason?.stack || anyErr.error?.stack || '',
            filename: anyErr.filename || '',
            lineno: anyErr.lineno || 0,
            colno: anyErr.colno || 0,
        };
    }
    return { message: String(err) };
}

function reportError(tag, err) {
    const packed = serializeError(err);
    const message = packed.stack || packed.message || String(err);
    postMessage({ type: 'error', tag, message, error: packed });
}

self.onerror = (message, source, lineno, colno, error) => {
    reportError('Uncaught Worker Error', error || { message, filename: source, lineno, colno });
};

self.onunhandledrejection = (event) => {
    reportError('Unhandled Worker Rejection', event && event.reason ? event.reason : event);
};


function applyOffscreenSizeMessage(message = {}) {
    const width = Math.max(1, Math.floor(Number(message.width || message.cssWidth) || fakeWindow.innerWidth || 1));
    const height = Math.max(1, Math.floor(Number(message.height || message.cssHeight) || fakeWindow.innerHeight || 1));
    const dpr = 1;
    const safeDim = Math.max(2048, Math.min(8192, Number(message.maxTextureDimension2D) || 8192));
    const backingWidth = width;
    const backingHeight = height;
    fakeWindow.innerWidth = width;
    fakeWindow.innerHeight = height;
    fakeWindow.devicePixelRatio = dpr;
    fakeWindow.SS_OFFSCREEN_SIZE = {
        width,
        height,
        cssWidth: width,
        cssHeight: height,
        backingWidth,
        backingHeight,
        devicePixelRatio: dpr,
        rawDevicePixelRatio: Number(message.rawDevicePixelRatio) || dpr,
        left: Number(message.left) || 0,
        top: Number(message.top) || 0,
        right: Number(message.right) || width,
        bottom: Number(message.bottom) || height,
    };
    return fakeWindow.SS_OFFSCREEN_SIZE;
}

async function initRenderer(message) {
    installShims(message);
    const initSize = applyOffscreenSizeMessage(message);
    canvas = installCanvasDomShim(message.canvas, initSize.width, initSize.height);
    resizeCanvasDomShim(canvas, initSize.width, initSize.height, initSize.backingWidth, initSize.backingHeight);
    proxyCanvas = installThreeCanvasProxy(canvas, initSize.width, initSize.height, {
        left: Number(message.left) || 0,
        top: Number(message.top) || 0,
        right: Number(message.right) || initSize.right,
        bottom: Number(message.bottom) || initSize.bottom,
    });
    latestRenderSnapshot = message.snapshot || {};
    applySnapshot(latestRenderSnapshot);

    const engineModule = await import('./engine.js');
    EngineClass = engineModule.Engine;
    engine = new EngineClass(canvas, makeBgProxy());
    fakeWindow.engine = engine;
    if (typeof engine.setupControls === 'function') engine.setupControls(canvas);
    dispatchProxyEvent('canvas', {
        type: 'resize',
        width: fakeWindow.innerWidth,
        height: fakeWindow.innerHeight,
        left: 0,
        top: 0,
        right: fakeWindow.innerWidth,
        bottom: fakeWindow.innerHeight,
        devicePixelRatio: fakeWindow.devicePixelRatio,
    });
    fakeWindow.dispatchEvent(makeEvent({ type: 'resize', width: fakeWindow.innerWidth, height: fakeWindow.innerHeight }));
    try {
        const fxModule = await import('./visual-effects.js');
        if (fxModule && typeof fxModule.initVisualEffects === 'function') {
            visualEffectsState = fxModule.initVisualEffects();
        }
    } catch (err) {
        reportError('Visual Effects Worker Init', err);
    }
    try {
        await engine.renderer.init();
        if (typeof engine.applyPixelRatioIfNeeded === 'function') engine.applyPixelRatioIfNeeded(true);
        if (typeof engine.resize === 'function') engine.resize(fakeWindow.innerWidth, fakeWindow.innerHeight);
        if (engine.reinitializeParticles) await engine.reinitializeParticles({ preferGpu: true });
        if (engine.warmCompileTrailPipelines) await engine.warmCompileTrailPipelines();
        if (fakeWindow.S.compatParticleFallback && engine.ensureParticleVisibilityBootstrap) await engine.ensureParticleVisibilityBootstrap();
    } catch (err) {
        reportError('Renderer Init Error', err);
        throw err;
    }
    initialized = true;
    startWorkerFrameLoop();
    return true;
}

async function renderFrame(snapshot) {
    if (!initialized || !engine) return collectMetrics(false);
    applySnapshot(snapshot || {});
    fakeWindow.SS_FPS = collectWorkerFpsMetrics();
    const renderStart = performance.now();
    await engine.render();
    updateWorkerFps(renderStart, performance.now());
    fakeWindow.SS_FPS = collectWorkerFpsMetrics();
    frame = (frame + 1) | 0;
    return collectMetrics((frame & 15) === 0);
}

async function callEngine(method, args = [], snapshot) {
    if (snapshot) applySnapshot(snapshot);
    if (!engine || typeof engine[method] !== 'function') return null;
    return await engine[method](...(Array.isArray(args) ? args : []));
}

function resizeRenderer(message) {
    applySnapshot(message.snapshot || {});
    const size = applyOffscreenSizeMessage(message);
    const { width, height, backingWidth, backingHeight } = size;
    resizeCanvasDomShim(canvas, width, height, backingWidth, backingHeight);
    const resizeEvent = {
        type: 'resize',
        width,
        height,
        cssWidth: width,
        cssHeight: height,
        backingWidth,
        backingHeight,
        left: Number(message.left) || 0,
        top: Number(message.top) || 0,
        right: Number(message.right) || size.right,
        bottom: Number(message.bottom) || size.bottom,
        devicePixelRatio: fakeWindow.devicePixelRatio,
    };
    if (canvas && typeof canvas.handleEvent === 'function') {
        canvas.handleEvent(resizeEvent);
    } else if (proxyCanvas) {
        updateProxyCanvasSizeFromEvent(resizeEvent);
        proxyCanvas.dispatchEvent(makeEvent({ ...resizeEvent, target: proxyCanvas, currentTarget: proxyCanvas }));
    }
    fakeWindow.dispatchEvent(makeEvent({ ...resizeEvent, target: fakeWindow, currentTarget: fakeWindow }));
    if (engine && typeof engine.applyPixelRatioIfNeeded === 'function') engine.applyPixelRatioIfNeeded(true);
    if (engine && typeof engine.resize === 'function') engine.resize(width, height);
    if (engine && typeof engine.applyPixelRatioIfNeeded === 'function') engine.applyPixelRatioIfNeeded(true);
}

let renderBusy = false;
let queuedRenderSnapshot = null;
let latestRenderSnapshot = {};
let workerFrameLoopEnabled = false;
let workerFrameLoopRunning = false;
let workerFrameSeq = 0;

let workerFpsLastTime = 0;
let workerFpsSmoothed = 60;
let workerEntropySmoothed = 0;
let workerFrameMsSmoothed = 16.7;
let workerFpsDt = 16.7;

function workerFpsToEntropy(fps) {
    if (fps >= 60) return 0;
    if (fps <= 1) return 100;
    return Math.round(((60 - fps) / 59) * 100);
}

function updateWorkerFps(renderStart, renderEnd) {
    const now = Number(renderEnd) || performance.now();
    const renderMs = Math.max(0, now - (Number(renderStart) || now));
    if (workerFpsLastTime > 0) {
        const dt = Math.max(1, Math.min(1000, now - workerFpsLastTime));
        const instant = 1000 / dt;
        const k = instant < workerFpsSmoothed ? 0.35 : 0.12;
        workerFpsSmoothed = workerFpsSmoothed * (1 - k) + instant * k;
        workerFrameMsSmoothed = workerFrameMsSmoothed * 0.82 + renderMs * 0.18;
        workerEntropySmoothed = workerFpsToEntropy(workerFpsSmoothed);
        workerFpsDt = dt;
    }
    workerFpsLastTime = now;
}

function collectWorkerFpsMetrics() {
    return {
        fps: workerFpsSmoothed,
        fpsRounded: Math.round(workerFpsSmoothed),
        entropy: workerEntropySmoothed,
        dt: workerFpsDt,
        frameMs: workerFrameMsSmoothed,
        updatedAt: performance.now(),
        source: 'worker'
    };
}

function scheduleWorkerFrameLoop() {
    if (!workerFrameLoopEnabled || workerFrameLoopRunning) return;
    workerFrameLoopRunning = true;
    const raf = typeof self.requestAnimationFrame === 'function'
        ? self.requestAnimationFrame.bind(self)
        : (fn) => setTimeout(() => fn(performance.now()), 16);
    raf(workerFrameLoopTick);
}

async function workerFrameLoopTick() {
    if (!workerFrameLoopEnabled) {
        workerFrameLoopRunning = false;
        return;
    }
    try {
        if (initialized && engine) {
            const result = await renderFrame(latestRenderSnapshot || {});
            workerFrameSeq = (workerFrameSeq + 1) >>> 0;
            if ((workerFrameSeq & 15) === 0 && result) postMessage({ type: 'metrics', ...result });
        }
    } catch (err) {
        reportError('worker frame loop', err);
    } finally {
        workerFrameLoopRunning = false;
        scheduleWorkerFrameLoop();
    }
}

function startWorkerFrameLoop() {
    workerFrameLoopEnabled = true;
    scheduleWorkerFrameLoop();
}

function stopWorkerFrameLoop() {
    workerFrameLoopEnabled = false;
}

async function runRenderMessage(message) {
    if (renderBusy) {
        queuedRenderSnapshot = message.snapshot || {};
        return;
    }
    renderBusy = true;
    try {
        let snapshot = message.snapshot || {};
        while (snapshot) {
            const result = await renderFrame(snapshot);
            postMessage({ type: 'renderComplete', seq: message.seq || 0, result });
            snapshot = queuedRenderSnapshot;
            queuedRenderSnapshot = null;
        }
    } catch (err) {
        reportError('render', err);
    } finally {
        renderBusy = false;
    }
}

async function handleWorkerMessage(event) {
    const message = event.data || {};
    try {
        if (message.type === 'ping') {
            postMessage({ type: 'pong', id: message.id || 0, ok: true });
            return;
        }
        if (message.type === 'init') {
            const result = await initRenderer(message);
            postMessage({ type: 'reply', id: message.id, ok: true, result });
            postMessage({ type: 'metrics', ...collectMetrics(true) });
            return;
        }
        if (message.type === 'render') {
            latestRenderSnapshot = message.snapshot || latestRenderSnapshot || {};
            if (message.id) {
                const result = await renderFrame(latestRenderSnapshot);
                postMessage({ type: 'reply', id: message.id, ok: true, result });
            }
            return;
        }
        if (message.type === 'resize') {
            resizeRenderer(message);
            if (message.id) postMessage({ type: 'reply', id: message.id, ok: true, result: true });
            return;
        }
        if (message.type === 'state') {
            latestRenderSnapshot = message.snapshot || latestRenderSnapshot || {};
            applySnapshot(latestRenderSnapshot);
            return;
        }
        if (message.type === 'cameraState') {
            latestRenderSnapshot = message.snapshot || latestRenderSnapshot || {};
            applySnapshot(latestRenderSnapshot);
            if (engine && typeof engine.applyCameraStateSnapshot === 'function') {
                await engine.applyCameraStateSnapshot(message.state || {});
            } else {
                applyCameraState(message.state || null);
            }
            return;
        }
        if (message.type === 'event') {
            dispatchProxyEvent(message.target, message.event);
            return;
        }
        if (message.type === 'call') {
            const result = await callEngine(message.method, message.args, message.snapshot);
            if (message.id) postMessage({ type: 'reply', id: message.id, ok: true, result });
            else postMessage({ type: 'metrics', ...collectMetrics(true) });
            return;
        }
    } catch (err) {
        const packed = serializeError(err);
        reportError(message.type || 'Worker Message Error', err);
        if (message.id) postMessage({ type: 'reply', id: message.id, ok: false, error: packed.stack || packed.message || String(err), detail: packed });
    }

}

let _serial = Promise.resolve();

self.onmessage = (event) => {
    const message = event.data || {};
    if (message.type === 'ping') {
        postMessage({ type: 'pong', id: message.id || 0, ok: true });
        return;
    }
    if (message.type === 'render' && !message.id) {
        latestRenderSnapshot = message.snapshot || latestRenderSnapshot || {};
        return;
    }
    _serial = _serial
        .then(() => handleWorkerMessage(event))
        .catch((err) => {
            reportError('Worker Serial Error', err);
            if (message.id) {
                const packed = serializeError(err);
                postMessage({ type: 'reply', id: message.id, ok: false, error: packed.stack || packed.message || String(err), detail: packed });
            }
        });
};

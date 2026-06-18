import { createHowlerAudioController } from './howlerAudio.js';
import { ensureHowlerWorklet } from './howler-worklet-wrapper.js';
import audioFetchWorkerUrl from './fetch.worker.js';
import { createAudioFetchPool } from './fetch-pool.js';
import { createAudioLevelBridge } from './level-bridge.js';

const AUDIO_SOURCE_LABELS = {
    off: 'Off',
    file: 'File',
    url: 'URL',
    mic: 'Mic',
    system: 'System Audio'
};

function _clamp01(v, fallback = 0.5) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(1, n));
}

function _effectiveOutputGain(s, fallback = 0.5) {
    const S = s || window.S || {};
    if (S.audioMuted) return 0;
    return _clamp01(S.volume, fallback);
}

function _safeTrackStop(stream) {
    if (!stream || typeof stream.getTracks !== 'function') return;
    for (const tr of stream.getTracks()) {
        try { tr.stop(); } catch (e) { console.error(e); }
    }
}

function _dispatchAudioState(detail) {
    try {
        window.dispatchEvent(new CustomEvent('scalespace-audio-state', { detail }));
    } catch (e) { console.error(e); }
}

function _syncStateToggle(key) {
    try {
        const updaters = window._toggleUpdaters && window._toggleUpdaters[key];
        if (updaters) updaters.forEach(fn => fn());
    } catch (e) { console.error(e); }
}

function _syncAudioVisualState() {
    _syncStateToggle('audioReactive');
    _syncStateToggle('visualEffects');
    try {
        window.dispatchEvent(new CustomEvent('scalespace-audio-visual-state'));
    } catch (e) { console.error(e); }
}

async function _decodeAudioData(ctx, ab) {
    return await new Promise((resolve, reject) => {
        try {
            const p = ctx.decodeAudioData(ab, resolve, reject);
            if (p && typeof p.then === 'function') p.then(resolve, reject);
        } catch (e) {
            reject(e);
        }
    });
}

async function _fileToArrayBuffer(file) {
    if (file && typeof file.arrayBuffer === 'function') return await file.arrayBuffer();
    return await new Promise((resolve, reject) => {
        try {
            const fr = new FileReader();
            fr.onerror = () => reject(new Error('FileReader failed'));
            fr.onload = () => resolve(fr.result);
            fr.readAsArrayBuffer(file);
        } catch (e) {
            reject(e);
        }
    });
}

async function _resolveHowler() {
    if (globalThis.Howler && globalThis.Howler.ctx !== undefined) return globalThis.Howler;
    if (globalThis.Howl && globalThis.Howler) return globalThis.Howler;

    try {
        const spec = 'how' + 'ler';
        const mod = await import(/* @vite-ignore */ spec);
        return mod.Howler || (mod.default && mod.default.Howler) || null;
    } catch (e) {
        return null;
    }
}

export class AudioManager {
    constructor() {
        this.backend = 'none';
        this.controller = null;
        this.fetchPool = null;
        this.fetchArrayBuffer = null;

        this.ctx = null;
        this.analyser = null;
        this.outputGain = null;
        this.currentNode = null;
        this.currentStream = null;
        this.currentBufferSource = null;
        this._timeBytes = null;
        this._levelBridge = null;
        this._cachedLevel = 0;
        this._lastLevelAt = 0;

        this.file = null;
        this.fileName = '';
        this.active = false;
        this.paused = false;
        this.lastError = '';
        this.currentSource = 'off';
        this.devices = { audioinput: [], audiooutput: [] };
        this._preSystemAudioMuted = false;
        this._nativeDecodedBuffer = null;
        this._nativeLoop = false;
        this._nativeStartedAt = 0;
        this._nativeOffset = 0;
        this._nativeDuration = 0;
    }

    async _ensureFetchPool() {
        if (this.fetchArrayBuffer) return this.fetchArrayBuffer;
        if (typeof Worker === 'undefined') {
            this.fetchArrayBuffer = async (url, init = {}) => {
                const res = await fetch(String(url), init || {});
                if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText || ''}`.trim());
                return await res.arrayBuffer();
            };
            return this.fetchArrayBuffer;
        }

        try {
            this.fetchPool = createAudioFetchPool(audioFetchWorkerUrl, { size: 1, autoRespawn: true });
            this.fetchArrayBuffer = this.fetchPool.fetchArrayBuffer;
        } catch (e) {
            console.warn('[audio] fetch worker unavailable, using direct fetch', e);
            this.fetchArrayBuffer = async (url, init = {}) => {
                const res = await fetch(String(url), init || {});
                if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText || ''}`.trim());
                return await res.arrayBuffer();
            };
        }
        return this.fetchArrayBuffer;
    }

    async _ensureHowler() {
        if (this.controller) return this.controller;

        const Howler = await _resolveHowler();
        if (!Howler) return null;
        if (typeof AudioWorkletNode === 'undefined') return null;

        const fetchArrayBuffer = await this._ensureFetchPool();
        const controller = createHowlerAudioController({
            ensureHowlerWorklet,
            Howler,
            fetchArrayBuffer,
        });

        await controller.init({
            analyser: { fftSize: 2048, smoothingTimeConstant: 0.12 },
            sharedTap: { ringSize: 32768, monoMode: 'avg' },
            outputGain: _effectiveOutputGain(window.S, 0.5),
            fxGain: Number(window.S?.audioFxGain) || 1,
        });

        this.controller = controller;
        this._attachLevelBridge(controller.getSharedTap ? controller.getSharedTap() : null);
        this.backend = 'howler-worklet';
        return controller;
    }

    _attachLevelBridge(sharedTap) {
        try { if (this._levelBridge) this._levelBridge.destroy(); } catch (e) { console.error(e); }
        this._levelBridge = createAudioLevelBridge(sharedTap, { intervalMs: 50 });
    }

    async _ensureNative() {
        if (this.ctx && this.ctx.state !== 'closed') return;

        const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AC) throw new Error('AudioContext unavailable in this browser');

        this.ctx = new AC();
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 2048;
        this.analyser.smoothingTimeConstant = 0.12;

        this.outputGain = this.ctx.createGain();
        this.outputGain.gain.value = _effectiveOutputGain(window.S, 0.5);
        this.analyser.connect(this.outputGain);
        this.outputGain.connect(this.ctx.destination);
        this.backend = 'native-webaudio';
    }

    async _getAudioPath() {
        const ctrl = await this._ensureHowler();
        if (ctrl) return { type: 'howler', ctrl };
        await this._ensureNative();
        return { type: 'native' };
    }

    _stopNativeNodes() {
        if (this.currentBufferSource) {
            try { this.currentBufferSource.stop(); } catch (e) { console.error(e); }
            try { this.currentBufferSource.disconnect(); } catch (e) { console.error(e); }
            this.currentBufferSource = null;
        }
        if (this.currentNode) {
            try { this.currentNode.disconnect(); } catch (e) { console.error(e); }
            this.currentNode = null;
        }
        if (this.currentStream) {
            _safeTrackStop(this.currentStream);
            this.currentStream = null;
        }
    }

    _connectNativeSource(node, { monitor = true } = {}) {
        if (!this.analyser) return;
        this._stopNativeNodes();
        node.connect(this.analyser);
        this.currentNode = node;
        this.setOutputGain(monitor ? _effectiveOutputGain(window.S, 0.5) : 0);
    }

    async _playNativeOsc(opts = {}) {
        await this._ensureNative();
        const hz = Number.isFinite(+opts.hz) ? Math.max(10, Math.min(24000, +opts.hz)) : 220;
        const gain = Number.isFinite(+opts.gain) ? Math.max(0, Math.min(1, +opts.gain)) : 0.12;
        const osc = this.ctx.createOscillator();
        const gn = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(hz, this.ctx.currentTime);
        gn.gain.setValueAtTime(gain, this.ctx.currentTime);
        osc.connect(gn);
        this._connectNativeSource(gn, { monitor: true });
        osc.start();
        this.currentBufferSource = osc;
    }

    _startNativeDecodedBuffer(buf, { loop = true, offset = 0 } = {}) {
        if (!this.ctx || !buf) return;
        const dur = Number(buf.duration) || 0;
        const off = dur > 0 ? Math.max(0, Math.min(dur - 0.01, Number(offset) || 0)) : 0;
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.loop = !!loop;
        this._connectNativeSource(src, { monitor: true });
        try { src.start(0, off); } catch (e) { src.start(); }
        this.currentBufferSource = src;
        this._nativeDecodedBuffer = buf;
        this._nativeLoop = !!loop;
        this._nativeOffset = off;
        this._nativeStartedAt = this.ctx.currentTime || 0;
        this._nativeDuration = dur;
        src.onended = () => {
            if (this.currentBufferSource === src) this.currentBufferSource = null;
        };
    }

    async _playNativeBuffer(ab, { loop = true } = {}) {
        await this._ensureNative();
        const buf = await _decodeAudioData(this.ctx, ab.slice(0));
        this._startNativeDecodedBuffer(buf, { loop, offset: 0 });
    }

    async _playNativeFile(file, opts = {}) {
        const ab = await _fileToArrayBuffer(file);
        await this._playNativeBuffer(ab, opts);
    }

    async _playNativeUrl(url, opts = {}) {
        const fetchArrayBuffer = await this._ensureFetchPool();
        const ab = await fetchArrayBuffer(String(url), { method: 'GET' });
        await this._playNativeBuffer(ab, opts);
    }

    async _playNativeStream(stream, opts = {}) {
        await this._ensureNative();
        const src = this.ctx.createMediaStreamSource(stream);
        this._connectNativeSource(src, { monitor: !!opts.monitor });
        this.currentStream = stream;
    }

    async _openMicStream(deviceId) {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('Microphone input is unavailable in this browser');
        }
        const audio = deviceId
            ? { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
            : { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
        return await navigator.mediaDevices.getUserMedia({ audio, video: false });
    }

    async _openSystemAudioStream() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            throw new Error('System/tab audio capture is unavailable in this browser');
        }
        const stream = await navigator.mediaDevices.getDisplayMedia({
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
            video: true,
        });
        for (const tr of stream.getVideoTracks()) {
            try { tr.stop(); } catch (e) { console.error(e); }
        }
        if (!stream.getAudioTracks().length) {
            _safeTrackStop(stream);
            throw new Error('No system audio track was shared');
        }
        return stream;
    }

    async refreshDevices() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return this.devices;
        try {
            const list = await navigator.mediaDevices.enumerateDevices();
            this.devices = {
                audioinput: list.filter(d => d.kind === 'audioinput'),
                audiooutput: list.filter(d => d.kind === 'audiooutput'),
            };
        } catch (e) {
            console.warn('[audio] enumerateDevices failed', e);
        }
        return this.devices;
    }

    setFile(file) {
        this.file = file || null;
        this.fileName = file && file.name ? String(file.name) : '';
        if (window.S) window.S.audioFileName = this.fileName;
        this._emit();
    }

    async setSource(source, opts = {}) {
        const src = AUDIO_SOURCE_LABELS[source] ? source : 'off';
        if (window.S) {
            const prevSource = window.S.audioSource;
            if (src === 'system') {
                if (prevSource !== 'system') this._preSystemAudioMuted = !!window.S.audioMuted;
                window.S.audioMuted = true;
                window.S.audioMonitor = false;
            } else if (prevSource === 'system') {
                window.S.audioMuted = !!this._preSystemAudioMuted;
                this._preSystemAudioMuted = false;
            }
            window.S.audioSource = src;
            window.S.audioOn = src !== 'off';
        }
        if (src === 'off') {
            this.stop();
            return;
        }
        const startOpts = { ...(window.S || {}), ...opts, audioSource: src };
        if (src === 'system') {
            startOpts.audioMuted = true;
            startOpts.audioMonitor = false;
        }
        await this.start(startOpts);
    }

    async toggle(s = window.S) {
        const S = s || window.S || {};
        if (S.audioOn) {
            await this.start(S);
        } else {
            this.stop();
        }
    }

    async start(s = window.S) {
        const S = s || window.S || {};
        const source = AUDIO_SOURCE_LABELS[S.audioSource] ? S.audioSource : 'off';
        this.lastError = '';

        if (source === 'off') {
            this.stop();
            return;
        }

        if (this.active && this.paused && source === this.currentSource) {
            await this.resume();
            return;
        }

        try {
            const path = await this._getAudioPath();
            const outputGain = _effectiveOutputGain(S, 0.5);
            const fxGain = Number.isFinite(+S.audioFxGain) ? +S.audioFxGain : 1;
            const loop = S.audioLoop !== false;
            const monitor = !!S.audioMonitor;
            this.currentSource = source;

            if (path.type === 'howler') {
                if (source === 'file') {
                    if (!this.file) throw new Error('Choose an audio file first');
                    await path.ctrl.playFile({ file: this.file, loop, outputGain, fxGain });
                } else if (source === 'url') {
                    if (!S.audioUrl) throw new Error('Paste an audio URL first');
                    await path.ctrl.playUrl({ url: S.audioUrl, loop, outputGain, fxGain });
                } else if (source === 'mic') {
                    const stream = await this._openMicStream(S.audioDeviceId || '');
                    await path.ctrl.playMediaStream({ stream, outputGain, fxGain, monitor });
                } else if (source === 'system') {
                    const stream = await this._openSystemAudioStream();
                    await path.ctrl.playMediaStream({ stream, outputGain, fxGain, monitor });
                }
            } else {
                if (source === 'file') {
                    if (!this.file) throw new Error('Choose an audio file first');
                    await this._playNativeFile(this.file, { loop });
                } else if (source === 'url') {
                    if (!S.audioUrl) throw new Error('Paste an audio URL first');
                    await this._playNativeUrl(S.audioUrl, { loop });
                } else if (source === 'mic') {
                    const stream = await this._openMicStream(S.audioDeviceId || '');
                    await this._playNativeStream(stream, { monitor });
                } else if (source === 'system') {
                    const stream = await this._openSystemAudioStream();
                    await this._playNativeStream(stream, { monitor });
                }
            }

            this.active = true;
            this.paused = false;
            this.currentSource = source;
            if (window.S) {
                window.S.audioOn = true;
                window.S.audioPaused = false;
                window.S.audioSource = source;
                if (window.S.audioAutoEnableVisuals !== false) {
                    this._autoVisualRestore = {
                        audioReactive: window.S.audioReactive,
                        visualEffects: window.S.visualEffects
                    };
                    window.S.audioReactive = true;
                    window.S.visualEffects = true;
                    _syncAudioVisualState();
                } else {
                    this._autoVisualRestore = null;
                }
                try { localStorage.setItem('ss_state', JSON.stringify(window.S)); } catch (e) {}
            }
            this._emit();
        } catch (err) {
            this.active = false;
            this.paused = false;
            this.lastError = err && err.message ? err.message : String(err || 'Audio failed');
            if (window.S) window.S.audioOn = false;
            this.stop({ silent: true });
            this._emit();
            if (window.showToast) window.showToast('Audio: ' + this.lastError, { color: '#ff9a40', duration: 4500 });
            throw err;
        }
    }

    async pause() {
        if (!this.active || this.paused) return false;
        try {
            if (this.controller && typeof this.controller.pause === 'function') await this.controller.pause();
            else if (this.ctx && typeof this.ctx.suspend === 'function' && this.ctx.state === 'running') await this.ctx.suspend();
            this.paused = true;
            if (window.S) window.S.audioPaused = true;
            this._emit();
            return true;
        } catch (e) {
            console.error(e);
            return false;
        }
    }

    async resume() {
        if (!this.active || !this.paused) return false;
        try {
            if (this.controller && typeof this.controller.resume === 'function') await this.controller.resume();
            else if (this.ctx && typeof this.ctx.resume === 'function' && this.ctx.state !== 'running') await this.ctx.resume();
            this.paused = false;
            if (window.S) window.S.audioPaused = false;
            this._emit();
            return true;
        } catch (e) {
            console.error(e);
            return false;
        }
    }

    async togglePause() {
        return this.paused ? await this.resume() : await this.pause();
    }

    stop(opts = {}) {
        try { if (this.controller) this.controller.stop(); } catch (e) { console.error(e); }
        this._stopNativeNodes();
        this._nativeDecodedBuffer = null;
        this._nativeDuration = 0;
        this._nativeOffset = 0;
        this.active = false;
        this.paused = false;
        this.currentSource = 'off';
        if (window.S) {
            window.S.audioOn = false;
            window.S.audioPaused = false;
            if (this._autoVisualRestore && window.S.audioAutoEnableVisuals !== false) {
                window.S.audioReactive = this._autoVisualRestore.audioReactive;
                window.S.visualEffects = this._autoVisualRestore.visualEffects;
                _syncAudioVisualState();
            }
            this._autoVisualRestore = null;
        }
        if (!opts.silent) this._emit();
    }

    shutdown() {
        this.stop({ silent: true });
        try { if (this.controller) this.controller.shutdown(); } catch (e) { console.error(e); }
        try { if (this.fetchPool) this.fetchPool.destroy(); } catch (e) { console.error(e); }
        try { if (this._levelBridge) this._levelBridge.destroy(); } catch (e) { console.error(e); }
        try { if (this.ctx && this.ctx.state !== 'closed') this.ctx.close(); } catch (e) { console.error(e); }
        this.controller = null;
        this.fetchPool = null;
        this._levelBridge = null;
        this.ctx = null;
        this.backend = 'none';
        this._emit();
    }

    updateVolume(v) {
        if (window.S && Number.isFinite(+v)) window.S.volume = _clamp01(v, 0.5);
        this.setOutputGain(v);
    }

    setMuted(muted) {
        if (window.S) window.S.audioMuted = !!muted;
        this.setOutputGain(window.S?.volume);
        this._emit();
    }

    setOutputGain(v) {
        const S = window.S || {};
        const sourceNeedsMonitor = this.currentSource === 'mic' || this.currentSource === 'system';
        const monitorAllowed = !sourceNeedsMonitor || !!S.audioMonitor;
        const x = (S.audioMuted || !monitorAllowed) ? 0 : _clamp01(v, 0.5);
        try { if (this.controller) this.controller.setOutputGain(x); } catch (e) { console.error(e); }
        try { if (this.outputGain) this.outputGain.gain.setValueAtTime(x, this.ctx.currentTime); } catch (e) { console.error(e); }
    }

    getAnalyser() {
        if (this.controller && this.controller.getAnalyser) return this.controller.getAnalyser();
        return this.analyser;
    }

    getFrequencyData(outU8) {
        const a = this.getAnalyser();
        if (!a) return outU8 || new Uint8Array(0);
        const buf = outU8 || new Uint8Array(a.frequencyBinCount);
        a.getByteFrequencyData(buf);
        return buf;
    }

    getTimeDomainData(outU8) {
        const a = this.getAnalyser();
        if (!a) return outU8 || new Uint8Array(0);
        const buf = outU8 || new Uint8Array(a.fftSize);
        a.getByteTimeDomainData(buf);
        return buf;
    }

    getLevel() {
        if (this._levelBridge) {
            const lv = this._levelBridge.getLevel();
            this._cachedLevel = lv;
            return lv;
        }

        const now = performance.now();
        if (now - this._lastLevelAt < 66) return this._cachedLevel;
        this._lastLevelAt = now;

        const a = this.getAnalyser();
        if (!a) {
            this._cachedLevel *= 0.86;
            return this._cachedLevel;
        }
        if (!this._timeBytes || this._timeBytes.length !== a.fftSize) this._timeBytes = new Uint8Array(a.fftSize);
        a.getByteTimeDomainData(this._timeBytes);
        let sum = 0;
        for (let i = 0; i < this._timeBytes.length; i++) {
            const x = (this._timeBytes[i] - 128) / 128;
            sum += x * x;
        }
        this._cachedLevel = Math.sqrt(sum / (this._timeBytes.length || 1));
        return this._cachedLevel;
    }

    getPeak() {
        if (this._levelBridge && typeof this._levelBridge.getPeak === 'function') return this._levelBridge.getPeak();
        return this._cachedLevel;
    }


    seek(seconds) {
        const sec = Math.max(0, Number(seconds) || 0);
        if (this.controller && typeof this.controller.seek === 'function') {
            try { return this.controller.seek(sec); } catch (e) { console.error(e); return false; }
        }
        if (!this._nativeDecodedBuffer || !this.ctx) return false;
        this._startNativeDecodedBuffer(this._nativeDecodedBuffer, { loop: this._nativeLoop, offset: sec });
        this._emit();
        return true;
    }

    getTransport() {
        if (this.controller && typeof this.controller.getTransport === 'function') {
            try { return this.controller.getTransport(); } catch (e) { console.error(e); }
        }
        const duration = Number(this._nativeDuration) || 0;
        if (!duration || !this.ctx || !this._nativeDecodedBuffer) return { seekable: false, currentTime: 0, duration: 0, paused: !!this.paused };
        let currentTime = (Number(this._nativeOffset) || 0) + Math.max(0, (this.ctx.currentTime || 0) - (this._nativeStartedAt || 0));
        if (this._nativeLoop && duration > 0) currentTime = currentTime % duration;
        else currentTime = Math.min(duration, currentTime);
        return { seekable: true, currentTime, duration, loop: !!this._nativeLoop, source: this.currentSource, paused: !!this.paused };
    }

    getStatus() {
        const ctxState = this.controller && this.controller.getCtxState
            ? this.controller.getCtxState()
            : (this.ctx ? String(this.ctx.state || 'unknown') : 'none');
        return {
            active: this.active,
            paused: this.paused,
            source: this.currentSource,
            label: AUDIO_SOURCE_LABELS[this.currentSource] || 'Off',
            backend: this.backend,
            ctxState,
            fileName: this.fileName || window.S?.audioFileName || '',
            lastError: this.lastError,
            muted: !!window.S?.audioMuted,
            monitor: !!window.S?.audioMonitor,
            reactive: window.S?.audioReactive !== false,
            level: this.getLevel(),
            devices: this.devices,
            transport: this.getTransport(),
        };
    }

    _emit() {
        _dispatchAudioState(this.getStatus());
    }
}

export { AUDIO_SOURCE_LABELS };

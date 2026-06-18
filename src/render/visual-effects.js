import * as THREE from 'three/webgpu';
import visualEffectsWorkerUrl from './visual-effects.worker.js';
import {
    describeVisualEffectStyle as describeVisualEffectStyleFromRegistry,
    FULL_EFFECT_STYLES as REGISTRY_FULL_EFFECT_STYLES,
    visualStylePool as registryVisualStylePool
} from './visual-style-registry.js';

const STYLE_LABELS = {
    random: 'Random visualizer',
    adaptive: 'Adaptive plasma',
    spectral: 'Spectral Bloom',
    kaleido: 'Kaleido Bloom',
    constellation: 'Constellation Web',
    cymatics: 'Cymatic rings',
    sinefield: 'iTunes sine field',
    oscilloscope: 'Oscilloscope sweep',
    matrixrain: 'Matrix Rain',
    spectrum: 'Classic Spectrum',
    vectorscope: 'Vectorscope Bloom',
    tunnel: 'Subatomic tunnel',
    aurora: 'Entropy aurora',
    lattice: 'Wave lattice',
    cellular: 'Cellular Automata',
    moire: 'Moiré Phase Mesh',
    hyperspace: 'Hyperspace Spokes',
    starfield: 'Starfield Trails',
    trails: 'Light Trails',
    entropy: 'Entropy Calculator',
    ribbons: 'Ribbon Reactor'
};

const SAFE_EFFECT_STYLES = ['spectral', 'kaleido', 'constellation', 'cymatics', 'sinefield', 'oscilloscope', 'matrixrain', 'spectrum', 'vectorscope', 'aurora', 'tunnel', 'moire', 'hyperspace', 'starfield', 'trails', 'entropy'];
const FULL_EFFECT_STYLES = ['spectral', 'kaleido', 'constellation', 'cymatics', 'sinefield', 'oscilloscope', 'matrixrain', 'spectrum', 'vectorscope', 'aurora', 'tunnel', 'lattice', 'cellular', 'moire', 'hyperspace', 'starfield', 'trails', 'entropy', 'ribbons'];

const STATE = {
    canvas: null,
    ctx: null,
    frame: 0,
    w: 0,
    h: 0,
    scale: 1,
    smoothed: 0,
    beat: 0,
    phase: 0,
    bands: new Float32Array(32),
    lastDrawAt: 0,
    adaptiveSkip: 0,
    lastCostMs: 0,
    randomStyle: '',
    randomNextAt: 0,
    renderStyle: '',
    previousStyle: '',
    styleBlendStart: 0,
    styleBlendDuration: 1.6,
    accentStyle: '',
    accentLevel: 0,
    accentNextAt: 0,
    detail: 1,
    bass: 0,
    mid: 0,
    treble: 0,
    energy: 0,
    surfaceGate: 0,
    surfaceHoldUntil: 0,
    nodeCache: [],
    gpu2d: null,
    gpuSurface: null,
    worker: null,
    workerBusy: false,
    workerSeq: 0,
    workerLastRequestAt: 0,
    workerFrame: null,
    workerFailed: false,
    backdropObjectMotion: null,
};

function clamp(v, lo, hi) {
    const n = Number(v);
    if (!Number.isFinite(n)) return lo;
    return Math.max(lo, Math.min(hi, n));
}

function finite(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function smooth01(v) {
    const x = clamp(v, 0, 1);
    return x * x * (3 - 2 * x);
}

function smoothstep(edge0, edge1, x) {
    const span = Number(edge1) - Number(edge0);
    if (!Number.isFinite(span) || Math.abs(span) < 1e-6) return Number(x) >= Number(edge1) ? 1 : 0;
    return smooth01((Number(x) - Number(edge0)) / span);
}
try { globalThis.smoothstep = globalThis.smoothstep || smoothstep; } catch (e) {}

function dutyPulse(t, seed = 0, duty = 0.30, period = 7.0) {
    const p = Math.max(1.2, Number(period) || 7.0);
    const d = clamp(duty, 0.05, 0.85);
    const ph = (((Number(t) / p + seed) % 1) + 1) % 1;
    const e = Math.min(0.08, d * 0.33);
    if (ph > d) return 0;
    return smoothstep(0, e, ph) * (1 - smoothstep(Math.max(e, d - e), d, ph));
}

function hsl(h, s, l, a = 1) {
    const hh = (((h % 1) + 1) % 1) * 360;
    return `hsla(${hh.toFixed(1)}, ${(s * 100).toFixed(1)}%, ${(l * 100).toFixed(1)}%, ${a.toFixed(3)})`;
}

function computeDetailScale(S, z) {
    const profile = String(S?.perfProfile || 'balanced');
    const profileScale = profile === 'potato' ? 0.46 : profile === 'speed' ? 0.62 : profile === 'quality' ? 1.0 : 0.82;
    const adaptiveTrim = 1 - Math.min(0.42, Math.max(0, STATE.adaptiveSkip | 0) * 0.065);
    const pressure = clamp(z?.overdrawPressure || 0, 0, 1);
    const zoomTrim = (0.74 + Math.max(0.25, Math.min(1, z?.effectScale || 1)) * 0.26) * (1 - pressure * 0.46);
    return clamp(profileScale * adaptiveTrim * zoomTrim, 0.34, 1.08);
}

function detailCount(value, lo, hi) {
    return Math.floor(clamp(value * (STATE.detail || 1), lo, hi));
}

function averageBands(start, end) {
    const bands = STATE.bands;
    const a = Math.max(0, Math.min(bands.length, start | 0));
    const b = Math.max(a + 1, Math.min(bands.length, end | 0));
    let sum = 0;
    for (let i = a; i < b; i++) sum += bands[i] || 0;
    return sum / (b - a);
}

function hash01(v) {
    return ((Math.sin(v * 12.9898 + 78.233) * 43758.5453) % 1 + 1) % 1;
}

function readParamDrive(src = window.S_effective || window.S || {}) {
    const freeEnergy = Math.max(0, finite(src.freeEnergy ?? window.S?.freeEnergy, 100000));
    return {
        coherence: clamp(Math.abs(finite(src.coherence, 30)) / 180, 0, 1.4),
        coherenceSign: finite(src.coherence, 30) < 0 ? -1 : 1,
        temperature: clamp(finite(src.temperature, 0) / 3, 0, 1.4),
        equilibrium: clamp(finite(src.equilibrium, 0.01) / 0.18, 0, 1.8),
        scaleDepth: clamp(finite(src.scaleDepth, 0) / 5, 0, 1.4),
        inversion: clamp(finite(src.inversion, 80) / 220, 0.08, 2.2),
        tempo: clamp(finite(src.tempo, 1) / 3, 0, 1.8),
        particleLoad: clamp(freeEnergy / 100000, 0.15, 4.0),
    };
}

function updateSpectrumState(feat) {
    const bass = Math.max(averageBands(0, 7), clamp(feat.bass || 0, 0, 1) * 0.72);
    const mid = Math.max(averageBands(7, 20), clamp(feat.mid || 0, 0, 1) * 0.72);
    const treble = Math.max(averageBands(20, 32), clamp(feat.treble || 0, 0, 1) * 0.78);
    STATE.bass = lerp(STATE.bass, bass, 0.12);
    STATE.mid = lerp(STATE.mid, mid, 0.10);
    STATE.treble = lerp(STATE.treble, treble, 0.14);
    const featureEnergy = clamp(feat.fxLevel || feat.blowout || 0, 0, 2.5);
    const target = clamp(STATE.bass * 0.40 + STATE.mid * 0.24 + STATE.treble * 0.22 + STATE.beat * 0.40 + featureEnergy * 0.18, 0, 1.5);
    STATE.energy = lerp(STATE.energy, target, target > STATE.energy ? 0.16 : 0.045);
}

function isAudioLive() {
    return !!(window.S?.audioReactive !== false && window.audio && window.audio.active);
}

function updateAccentStyle(S, chosen, t, dynamics) {
    const styleMode = String(S.visualEffectStyle || 'random');
    const canAccent = isAudioLive() && (styleMode === 'random' || styleMode === 'adaptive' || dynamics > 1.28);
    if (!canAccent || dynamics < 0.35) {
        STATE.accentLevel = lerp(STATE.accentLevel, 0, 0.08);
        return '';
    }
    const pool = visualStylePool(S).filter(style => style !== chosen);
    if (!pool.length) return '';
    const hitThreshold = clamp(0.55 - dynamics * 0.10, 0.28, 0.55);
    const beatHit = STATE.beat > hitThreshold;
    const due = t > STATE.accentNextAt && STATE.energy > 0.16;
    const invalidAccent = !pool.includes(STATE.accentStyle);
    if (beatHit || due || (invalidAccent && STATE.energy > 0.12)) {
        STATE.accentStyle = pickVisualStyle(pool, chosen);
        STATE.accentNextAt = t + clamp(4.8 - dynamics * 1.15, 1.5, 4.8) + Math.random() * clamp(2.6 - dynamics * 0.55, 0.8, 2.6);
        STATE.accentLevel = Math.max(STATE.accentLevel, clamp((STATE.energy * 0.40 + STATE.beat * 0.80) * dynamics, 0.14, 0.94));
    }
    STATE.accentLevel = lerp(STATE.accentLevel, 0, 0.030 + dynamics * 0.018);
    return STATE.accentStyle;
}

function visualStylePool(S) {
    return registryVisualStylePool({ includeTrailStyles: S.visualEffectNoTrailStyles === false });
}

function pickVisualStyle(pool, avoid) {
    if (!pool || pool.length === 0) return 'cymatics';
    if (pool.length === 1) return pool[0];
    let next = pool[Math.floor(Math.random() * pool.length) % pool.length];
    if (next === avoid) next = pool[(pool.indexOf(next) + 1 + Math.floor(Math.random() * (pool.length - 1))) % pool.length];
    return next;
}

function commitVisualStyle(next, t, duration = 1.6) {
    const style = next || 'cymatics';
    if (!STATE.renderStyle) {
        STATE.renderStyle = style;
        STATE.previousStyle = '';
        STATE.styleBlendStart = t;
        STATE.styleBlendDuration = duration;
        return style;
    }
    if (style !== STATE.renderStyle) {
        STATE.previousStyle = STATE.renderStyle;
        STATE.renderStyle = style;
        STATE.styleBlendStart = t;
        STATE.styleBlendDuration = Math.max(0.25, duration);
    }
    return STATE.renderStyle;
}

function visualStyleBlend(t) {
    if (!STATE.previousStyle || STATE.previousStyle === STATE.renderStyle) return 1;
    const k = smooth01((t - STATE.styleBlendStart) / Math.max(0.25, STATE.styleBlendDuration || 1.6));
    if (k >= 0.995) STATE.previousStyle = '';
    return k;
}

function resolveVisualStyle(S, hue, t) {
    const pool = visualStylePool(S);
    const style = String(S.visualEffectStyle || 'random');
    if (style === 'random') {
        const morph = Math.max(0.001, Number(S.visualEffectMorphRate) || 0.018);
        const hold = clamp(10.5 - morph * 95 - (isAudioLive() ? STATE.beat * 2.0 : 0), 5.5, 14);
        const beatCut = isAudioLive() && STATE.beat > 0.68 && t > STATE.randomNextAt - 2.0;
        if (!pool.includes(STATE.randomStyle) || t >= STATE.randomNextAt || beatCut) {
            STATE.randomStyle = pickVisualStyle(pool, STATE.randomStyle);
            STATE.randomNextAt = t + hold + Math.random() * hold * 0.45;
        }
        return commitVisualStyle(STATE.randomStyle, t, 1.8);
    }
    if (style === 'adaptive') {
        const u = (((hue + t * (Number(S.visualEffectMorphRate) || 0.018)) % 1) + 1) % 1;
        return commitVisualStyle(pool[Math.floor(u * pool.length) % pool.length] || 'cymatics', t, 1.9);
    }
    return commitVisualStyle(REGISTRY_FULL_EFFECT_STYLES.includes(style) ? style : 'cymatics', t, 0.8);
}

function zoomState() {
    try {
        if (window.engine && typeof window.engine.getZoomOptimizationState === 'function') return window.engine.getZoomOptimizationState();
    } catch (e) { console.error(e); }
    return window.SS_ZOOM_OPT || { close: 0, effectScale: 1 };
}

function perfSkip() {
    const profile = String(window.S?.perfProfile || 'balanced');
    const z = zoomState();
    const pressure = clamp(z.overdrawPressure || 0, 0, 1);
    const extra = (z.close > 0.88 ? 1 : 0) + Math.round(pressure * 2);
    const adaptive = Math.max(0, Math.min(6, STATE.adaptiveSkip | 0));
    if (profile === 'potato') return 3 + extra + Math.min(4, adaptive);
    if (profile === 'speed') return 2 + Math.min(2, extra) + Math.min(3, adaptive);
    // The 2D backdrop is very sensitive to whole-frame skipping. Keep balanced
    // and quality visually continuous; the backdrop detail slider carries the
    // geometry budget instead.
    return 1;
}

function qualityScale() {
    const S = window.S || {};
    const profile = String(S.perfProfile || 'balanced');
    const q = clamp(S.visualEffectQuality ?? 0.62, 0.25, 1);
    const profileScale = profile === 'potato' ? 0.36 : profile === 'speed' ? 0.50 : profile === 'quality' ? 0.92 : 0.72;
    const z = zoomState();
    const adaptiveTrim = 1 - Math.min(0.18, Math.max(0, STATE.adaptiveSkip | 0) * 0.030);
    const pressureTrim = 1 - clamp(z.overdrawPressure || 0, 0, 1) * 0.20;
    return Math.max(0.28, Math.min(1, q * profileScale * (z.effectScale || 1) * adaptiveTrim * pressureTrim));
}


function backdropDetailScale(S = window.S || {}) {
    return clamp(Number(S.visualEffect2DResolutionScale ?? 0.66), 0.25, 1);
}

function backdropWorkerIntervalMs(S = window.S || {}) {
    const detail = backdropDetailScale(S);
    const configured = Number(S.visualEffectBackdropWorkerMs);
    if (Number.isFinite(configured)) return clamp(configured, 8, 140);
    // Keep animation cadence high even when geometry detail is low. A low-detail
    // 60-ish FPS backdrop looks better and often costs less than a full-detail
    // 18 FPS backdrop that judders across the particles.
    return clamp(12 + (1 - detail) * 22, 10, 42);
}

function update2DBackdropOpacity(gpu, amount, S, fade2D) {
    const mix = clamp(Number(S.visualEffect2DBackdropMix ?? 1.0) || 1.0, 0.05, 2.5);
    const sliderLift = Math.pow(mix, 0.78);
    const lineBase = clamp((0.044 + amount * 0.050 + STATE.beat * 0.018) * sliderLift * fade2D, 0.0, 0.25);
    const fillBase = clamp((0.038 + amount * 0.048 + STATE.beat * 0.020) * sliderLift * fade2D, 0.0, 0.21);
    const blurLine = clamp(lineBase * 0.78, 0.0, 0.20);
    const blurFill = clamp(fillBase * 1.02, 0.0, 0.22);
    if (gpu.mesh && gpu.mesh.material) gpu.mesh.material.opacity = lineBase;
    if (gpu.fillMesh && gpu.fillMesh.material) gpu.fillMesh.material.opacity = fillBase;
    if (Array.isArray(gpu.blurMeshes)) {
        for (const m of gpu.blurMeshes) if (m && m.material) m.material.opacity = blurLine;
    }
    if (Array.isArray(gpu.blurFillMeshes)) {
        for (const m of gpu.blurFillMeshes) if (m && m.material) m.material.opacity = blurFill;
    }
}

function hashString01(str) {
    const s = String(str || '');
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 1000003) / 1000003;
}

function apply2DBackdropObjectMotion(gpu, amount, S, frameAgeMs = 0) {
    const group = gpu && gpu.group;
    if (!group) return;
    const t = performance.now() * 0.001;
    const style = String(S.visualEffect2DBackdropStyle || S.visualEffectStyle || 'classic');
    const seed = hashString01(style);
    const radial = /cymatics|rings|vectorscope|tunnel|bokeh|blob|bloom|nebula|opal|starfield/i.test(style);
    const matrix = /matrix/i.test(style);
    const ribbon = /ribbon|trail|aurora|sine|wave|silk|gradient/i.test(style);
    const period = matrix ? 24 + seed * 18 : radial ? 16 + seed * 13 : 18 + seed * 15;
    const duty = matrix ? 0.18 : radial ? 0.30 : ribbon ? 0.26 : 0.22;
    const gate = dutyPulse(t + seed * period, seed, duty, period);
    const staleGate = clamp((Number(frameAgeMs) - 260) / 1350, 0, 1) * 0.70;
    const active = Math.max(gate, staleGate);
    const limit = (matrix ? 0.018 : radial ? 0.060 : ribbon ? 0.042 : 0.036) * clamp(0.70 + amount * 0.18, 0.65, 1.12);
    const slowA = Math.sin(t * (0.060 + seed * 0.028) + seed * 19.0);
    const slowB = Math.sin(t * (0.031 + seed * 0.019) + seed * 41.0) * 0.42;
    const targetAngle = active * limit * (slowA + slowB);
    const driftGate = Math.max(active * 0.72, staleGate);
    const halfW = Number(gpu.backdropHalfW) || 1;
    const halfH = Number(gpu.backdropHalfH) || 1;
    const targetX = driftGate * halfW * 0.0040 * Math.sin(t * (0.050 + seed * 0.024) + seed * 9.0);
    const targetY = driftGate * halfH * 0.0045 * Math.cos(t * (0.044 + seed * 0.019) + seed * 13.0);
    const targetScale = 1 - Math.abs(targetAngle) * 0.030 - driftGate * 0.002;
    let m = STATE.backdropObjectMotion;
    if (!m || m.style !== style) {
        m = STATE.backdropObjectMotion = { style, angle: targetAngle, x: targetX, y: targetY, scale: targetScale };
    }
    const k = 0.030 + staleGate * 0.040;
    m.angle += (targetAngle - m.angle) * k;
    m.x += (targetX - m.x) * k;
    m.y += (targetY - m.y) * k;
    m.scale += (targetScale - m.scale) * k;
    group.rotation.z = m.angle;
    group.position.set(m.x, m.y, 0);
    group.scale.setScalar(clamp(m.scale, 0.985, 1.004));
    group.visible = true;
}

function resize() {
    const c = STATE.canvas;
    if (!c) return;
    const cap = Math.max(0.4, Math.min(1, Number(window.S?.canvasResolutionScale) || 1));
    const dpr = Math.min(2, window.devicePixelRatio || 1) * cap;
    const q = qualityScale();
    const scale = Math.max(0.20, Math.min(0.95, dpr * q));
    const w = Math.max(1, Math.floor(window.innerWidth * scale));
    const h = Math.max(1, Math.floor(window.innerHeight * scale));
    if (w === STATE.w && h === STATE.h && Math.abs(scale - STATE.scale) < 0.01) return;
    STATE.w = c.width = w;
    STATE.h = c.height = h;
    STATE.scale = scale;
    c.style.width = '100vw';
    c.style.height = '100vh';
}

function sampleAudioBands() {
    const out = STATE.bands;
    const feat = window.SS_AUDIO_FEATURES || {};
    let filled = false;
    const audioLive = window.S?.audioReactive !== false && window.audio && window.audio.active;
    try {
        if (audioLive && typeof window.audio.getFrequencyData === 'function') {
            const f = window.audio.getFrequencyData();
            if (f && f.length) {
                const bin = Math.max(1, Math.floor(f.length / out.length));
                for (let i = 0; i < out.length; i++) {
                    let sum = 0;
                    const start = i * bin;
                    for (let j = 0; j < bin; j++) sum += f[Math.min(f.length - 1, start + j)] || 0;
                    out[i] = lerp(out[i], clamp(sum / (bin * 255), 0, 1), 0.18);
                }
                filled = true;
            }
        }
    } catch (e) { console.error(e); }
    if (!filled) {
        const rms = clamp(feat.rms || 0, 0, 1);
        const beat = clamp(feat.beat || 0, 0, 1);
        const t = performance.now() * 0.001;
        for (let i = 0; i < out.length; i++) {
            const x = i / Math.max(1, out.length - 1);
            const synthetic = rms * (0.35 + 0.45 * Math.sin(t * (0.55 + x * 2.4) + x * 8.0) ** 2) + beat * Math.exp(-x * 4.0) * 0.45;
            out[i] = lerp(out[i], clamp(synthetic, 0, 1), 0.08);
        }
    }
}

function drawCymatics(ctx, cx, cy, rBase, hue, sat, light, amount, t, bands, feat) {
    const S = window.S || {};
    const ringCount = detailCount(5 + amount * 9 + clamp(S.visualEffectRings ?? 0.7, 0, 1) * 8, 4, 24);
    const beat = clamp(feat.beat || 0, 0, 1);
    const tension = clamp(feat.tensionRelease || 0, 0, 1.5);
    ctx.lineCap = 'round';
    for (let i = 0; i < ringCount; i++) {
        const k = (i + 1) / ringCount;
        const band = bands[(i * 5) % bands.length] || 0;
        const radius = rBase * (0.10 + k * 0.92) * (1 + band * 0.08 + beat * 0.025);
        const steps = detailCount(120 + amount * 90, 48, 210);
        ctx.beginPath();
        for (let s = 0; s <= steps; s++) {
            const a = (s / steps) * Math.PI * 2;
            const cym = Math.sin(a * (3 + (i % 7)) + t * (0.32 + k) + band * 8)
                + 0.55 * Math.sin(a * (7 + (i % 5)) - t * 0.46 + hue * 8)
                + 0.35 * Math.sin(a * (11 + (i % 4)) + t * 0.18);
            const rr = radius + cym * rBase * (0.006 + amount * 0.018) * (0.45 + band + beat * 0.7) * (1 + tension * 0.3);
            const x = cx + Math.cos(a) * rr;
            const y = cy + Math.sin(a) * rr;
            if (s === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = hsl(hue + k * 0.22 + band * 0.08, sat, light * (0.55 + k * 0.28), (0.035 + band * 0.045 + beat * 0.035) * amount);
        ctx.lineWidth = (0.45 + band * 2.3 + beat * 1.2) * STATE.scale;
        ctx.stroke();
    }
}

function drawSineField(ctx, w, h, hue, sat, light, amount, t, bands, feat) {
    const drive = readParamDrive();
    const lines = detailCount(9 + amount * 18 + drive.scaleDepth * 5, 5, 32);
    const beat = clamp(feat.beat || 0, 0, 1);
    const rms = clamp(feat.rms || 0, 0, 1);
    const mid = STATE.mid || averageBands(8, 20);
    const skew = (drive.temperature - drive.coherence * 0.35) * 0.18;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let l = 0; l < lines; l++) {
        const k = l / Math.max(1, lines - 1);
        const laneBend = Math.sin(k * Math.PI * 2 + t * 0.035 + hue * 5.0) * h * (0.018 + drive.equilibrium * 0.020);
        const y0 = h * (0.10 + k * 0.80) + laneBend;
        const band = bands[(l * 3 + Math.floor(t * 0.7)) % bands.length] || rms;
        const amp = h * (0.010 + amount * 0.026 + drive.scaleDepth * 0.010) * (0.36 + band * 1.8 + beat * 0.55 + mid * 0.38);
        const freq = 1.35 + (l % 7) * (0.42 + drive.coherence * 0.18) + drive.inversion * 0.18;
        const speed = 0.16 + drive.equilibrium * 0.72 + k * 0.18 + beat * 0.035;
        ctx.beginPath();
        const steps = detailCount(92 + amount * 72, 44, 160);
        for (let s = 0; s <= steps; s++) {
            const x = w * (s / steps);
            const u = s / steps;
            const fold = Math.sin((u + k * 0.07) * Math.PI * (2.0 + drive.scaleDepth * 1.8) + t * 0.05) * skew;
            const wave = Math.sin((u + fold) * Math.PI * 2 * freq + t * speed + k * 9.0)
                + 0.42 * Math.sin(u * Math.PI * 2 * (freq * 2.11) - t * speed * 0.77 + hue * 8 + band * 2.0)
                + 0.20 * Math.sin((u * 2.0 + k) * Math.PI * (freq * 1.35) + t * 0.11 + STATE.energy);
            const envelope = Math.sin(u * Math.PI);
            const y = y0 + wave * amp * (0.55 + envelope * 0.62) + Math.sin(u * Math.PI + t * 0.08 + k) * h * 0.012 * amount;
            if (s === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = hsl(hue + k * 0.38 + band * 0.11 + beat * 0.08, sat, light * (0.48 + k * 0.34 + band * 0.12), (0.026 + rms * 0.030 + band * 0.042 + beat * 0.030) * amount);
        ctx.lineWidth = (0.38 + beat * 1.05 + band * 1.75 + drive.scaleDepth * 0.35) * STATE.scale;
        ctx.stroke();
    }
    if (amount > 0.35 && STATE.detail > 0.48) {
        const rails = detailCount(2 + amount * 3, 1, 5);
        ctx.globalCompositeOperation = 'screen';
        for (let r = 0; r < rails; r++) {
            const u = (r + 1) / (rails + 1);
            const x = w * (((t * (0.018 + drive.equilibrium * 0.04) + u + hue * 0.13) % 1 + 1) % 1);
            ctx.strokeStyle = hsl(hue + 0.24 + u * 0.18, sat, light * 0.66, (0.010 + beat * 0.012 + STATE.treble * 0.016) * amount);
            ctx.lineWidth = Math.max(0.5, STATE.scale * (0.6 + beat * 1.2));
            ctx.beginPath();
            ctx.moveTo(x, h * 0.06);
            ctx.lineTo(x + Math.sin(t * 0.12 + u * 8.0) * w * 0.022, h * 0.94);
            ctx.stroke();
        }
    }
    ctx.restore();
}

function drawRadialBars(ctx, cx, cy, rBase, hue, sat, light, amount, t, bands, feat) {
    const beat = clamp(feat.beat || 0, 0, 1);
    const n = detailCount(48 + amount * 80, 24, 128);
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + t * 0.018;
        const b = bands[i % bands.length] || 0;
        const wob = Math.sin(a * 3 + t * 0.41) * 0.08 + Math.cos(a * 5 - t * 0.27) * 0.04;
        const r0 = rBase * (0.18 + wob + beat * 0.015);
        const r1 = rBase * (0.25 + b * 0.42 + amount * 0.18 + beat * 0.08 + wob);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.strokeStyle = hsl(hue + i / n * 0.62 + b * 0.08, sat, light * (0.55 + b * 0.35), (0.045 + b * 0.08 + beat * 0.04) * amount);
        ctx.lineWidth = (0.45 + b * 3.0 + beat * 1.2) * STATE.scale;
        ctx.stroke();
    }
}

function drawClassicPhosphor(ctx, w, h, hue, sat, light, amount, t, bands, feat) {
    const drive = readParamDrive();
    const beat = clamp(feat.beat || 0, 0, 1);
    const rms = clamp(feat.rms || 0, 0, 1);
    const lines = detailCount(12 + amount * 22 + drive.scaleDepth * 4, 8, 42);
    const sweeps = detailCount(1 + amount * 2 + beat * 2, 1, 5);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.lineCap = 'round';
    for (let i = 0; i < lines; i++) {
        const k = (i + 0.5) / lines;
        const b = bands[(i * 5 + 1) % bands.length] || 0;
        const y = h * k + Math.sin(t * (0.12 + drive.equilibrium) + k * 19.0 + hue * 4.0) * h * (0.002 + b * 0.006 + rms * 0.004);
        ctx.beginPath();
        ctx.moveTo(w * 0.05, y);
        ctx.quadraticCurveTo(
            w * (0.40 + Math.sin(t * 0.07 + k * 5.0) * 0.08),
            y + Math.sin(k * 31.0 - t * 0.24) * h * (0.005 + b * 0.010),
            w * 0.95,
            y + Math.cos(k * 17.0 + t * 0.19) * h * (0.003 + b * 0.007)
        );
        ctx.strokeStyle = hsl(hue + k * 0.22 + b * 0.08, sat, light * (0.42 + b * 0.28), (0.008 + b * 0.020 + beat * 0.010) * amount);
        ctx.lineWidth = Math.max(0.35, STATE.scale * (0.35 + b * 1.0 + beat * 0.7));
        ctx.stroke();
    }
    for (let s = 0; s < sweeps; s++) {
        const k = (s + 0.5) / sweeps;
        const x = w * (((t * (0.035 + drive.equilibrium * 0.22) + k * 0.38 + hue * 0.17) % 1 + 1) % 1);
        const b = bands[(s * 9 + 4) % bands.length] || 0;
        const alpha = (0.012 + b * 0.030 + beat * 0.020) * amount;
        ctx.strokeStyle = hsl(hue + 0.42 + k * 0.18, sat, light * (0.58 + b * 0.20), alpha);
        ctx.lineWidth = Math.max(0.5, STATE.scale * (0.75 + b * 2.5 + beat * 1.8));
        ctx.beginPath();
        ctx.moveTo(x, h * 0.08);
        ctx.lineTo(x + Math.sin(t * 0.19 + k * 8.0) * w * 0.028, h * 0.92);
        ctx.stroke();
    }
    ctx.restore();
}

function drawMatrixRain(ctx, w, h, hue, sat, light, amount, t, bands, feat) {
    const drive = readParamDrive();
    const beat = clamp(feat.beat || 0, 0, 1);
    const rms = clamp(feat.rms || 0, 0, 1);
    const cols = detailCount(30 + amount * 50 + drive.particleLoad * 4, 16, 96);
    const rows = detailCount(14 + amount * 24, 8, 42);
    const cellW = Math.max(3, w / cols);
    const cellH = Math.max(7 * STATE.scale, h / rows);
    const glyphs = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ+-*/';
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.max(7, Math.min(16, cellH * 0.78))}px monospace`;
    for (let c = 0; c < cols; c++) {
        const seed = hash01(c * 19.19 + Math.floor(t * 0.17));
        const band = bands[(c * 5) % bands.length] || rms;
        const speed = 1.2 + seed * 3.8 + drive.tempo * 1.8 + band * 2.8 + beat * 2.0;
        const head = ((t * speed + seed * rows * 1.7) % rows + rows) % rows;
        const tail = Math.max(4, Math.min(rows, Math.round(5 + band * 11 + amount * 5 + drive.scaleDepth * 5)));
        const x = (c + 0.5 + Math.sin(t * 0.11 + c * 0.73) * 0.16 * drive.temperature) * cellW;
        for (let j = 0; j < tail; j++) {
            const yIdx = Math.floor(head - j + rows) % rows;
            const k = j / Math.max(1, tail - 1);
            const y = (yIdx + 0.5) * cellH;
            const pulse = j === 0 ? 1.9 + beat * 0.9 : 1.0;
            const alpha = (0.010 + band * 0.036 + rms * 0.012) * amount * (1 - k) ** 1.45 * pulse;
            const charIdx = (c * 7 + yIdx * 13 + Math.floor(t * (4 + speed))) % glyphs.length;
            ctx.fillStyle = hsl(hue + 0.26 + seed * 0.10 + band * 0.08, sat, light * (0.48 + (1 - k) * 0.30 + band * 0.18), alpha);
            ctx.fillText(glyphs[charIdx], x, y);
        }
    }
    ctx.restore();
}

function drawSpectrumAnalyzer(ctx, w, h, hue, sat, light, amount, t, bands, feat) {
    const drive = readParamDrive();
    const beat = clamp(feat.beat || 0, 0, 1);
    const rms = clamp(feat.rms || 0, 0, 1);
    const bars = detailCount(38 + amount * 72 + drive.particleLoad * 6, 24, 136);
    const gap = Math.max(1, Math.floor(w / bars * 0.16));
    const bw = Math.max(1, w / bars - gap);
    const baseY = h * (0.76 + Math.sin(t * 0.20 + drive.scaleDepth * 4) * 0.025);
    const topY = h * (0.24 - Math.sin(t * 0.17 + drive.coherence * 3) * 0.018);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < bars; i++) {
        const u = i / Math.max(1, bars - 1);
        const b0 = bands[Math.floor(u * (bands.length - 1))] || 0;
        const b1 = bands[(i * 7 + 3) % bands.length] || 0;
        const wave = 0.5 + 0.5 * Math.sin(u * Math.PI * (4 + drive.coherence * 5) + t * (0.45 + drive.equilibrium * 1.9));
        const signal = clamp(Math.pow(b0 * 0.74 + b1 * 0.26 + rms * 0.12, 0.72) + beat * 0.20 * (1 - u) + wave * drive.temperature * 0.12, 0, 1.45);
        const height = h * (0.045 + signal * (0.28 + amount * 0.045 + drive.scaleDepth * 0.04));
        const x = i * (bw + gap) + gap * 0.5;
        const alpha = (0.030 + signal * 0.085 + beat * 0.025) * amount;
        ctx.fillStyle = hsl(hue + u * (0.34 + drive.scaleDepth * 0.18) + signal * 0.08, sat, light * (0.45 + signal * 0.34), alpha);
        ctx.fillRect(x, baseY - height, bw, height);
        if ((i & 1) === 0) {
            ctx.fillStyle = hsl(hue + 0.48 + u * 0.22, sat, light * (0.38 + signal * 0.24), alpha * 0.45);
            ctx.fillRect(x, topY, bw, height * (0.28 + drive.inversion * 0.16));
        }
    }
    ctx.strokeStyle = hsl(hue + 0.08 + drive.temperature * 0.12, sat, light * 0.72, (0.035 + beat * 0.035) * amount);
    ctx.lineWidth = Math.max(0.5, STATE.scale * (0.7 + beat * 1.4));
    ctx.beginPath();
    for (let i = 0; i < bars; i++) {
        const u = i / Math.max(1, bars - 1);
        const b = bands[Math.floor(u * (bands.length - 1))] || 0;
        const y = baseY - h * (0.05 + Math.pow(b + beat * 0.10, 0.75) * (0.22 + drive.scaleDepth * 0.06));
        const x = i * (bw + gap) + bw * 0.5;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
}

function drawVectorscope(ctx, cx, cy, rBase, hue, sat, light, amount, t, bands, feat) {
    const drive = readParamDrive();
    const beat = clamp(feat.beat || 0, 0, 1);
    const rms = clamp(feat.rms || 0, 0, 1);
    const loops = detailCount(2 + amount * 3 + drive.scaleDepth * 2, 2, 8);
    const steps = detailCount(190 + amount * 80, 96, 280);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = 'lighter';
    for (let pass = 0; pass < loops; pass++) {
        const k = pass / Math.max(1, loops - 1);
        const band = bands[(pass * 9 + 4) % bands.length] || 0;
        const ax = 2 + Math.floor(drive.coherence * 5) + (pass % 3);
        const ay = 3 + Math.floor(drive.scaleDepth * 5) + ((pass + 1) % 4);
        const phase = t * (0.18 + drive.equilibrium * 1.6 + k * 0.04) + band * 4.0;
        const rx = rBase * (0.26 + k * 0.22 + band * 0.14 + beat * 0.05) * (0.92 + drive.inversion * 0.18);
        const ry = rBase * (0.20 + k * 0.19 + rms * 0.08 + drive.temperature * 0.05);
        ctx.beginPath();
        for (let s = 0; s <= steps; s++) {
            const u = (s / steps) * Math.PI * 2;
            const carrier = bands[(s + pass * 5) % bands.length] || 0;
            const wob = 1 + carrier * (0.08 + drive.temperature * 0.10) + Math.sin(u * (5 + pass) + phase) * 0.035;
            const x = cx + Math.sin(u * ax + phase + hue * 5.0) * rx * wob;
            const y = cy + Math.sin(u * ay - phase * 0.83 + k * 2.2) * ry * wob;
            if (s === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = hsl(hue + k * 0.26 + band * 0.12, sat, light * (0.54 + k * 0.20 + band * 0.12), (0.024 + band * 0.046 + beat * 0.025) * amount);
        ctx.lineWidth = (0.55 + band * 2.4 + beat * 1.2 + k * 0.8) * STATE.scale;
        ctx.stroke();
    }
    ctx.restore();
}

function drawStarfieldTrails(ctx, cx, cy, rBase, hue, sat, light, amount, t, bands, feat) {
    const drive = readParamDrive();
    const beat = clamp(feat.beat || 0, 0, 1);
    const n = detailCount(58 + amount * 150 + drive.particleLoad * 14, 36, 220);
    const speed = 0.060 + drive.equilibrium * 0.12 + drive.temperature * 0.035 + STATE.bass * 0.10 + beat * 0.12;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
        const seed = hash01(i + drive.coherence * 19.0);
        const z = ((hash01(i * 2.77) - t * speed * (0.6 + seed * 1.8) - beat * 0.10) % 1 + 1) % 1;
        const depth = 1 - z;
        const a = seed * Math.PI * 2 + t * (0.010 + drive.equilibrium * 0.04) + Math.sin(i * 0.19) * drive.scaleDepth * 0.12;
        const band = bands[(i * 11) % bands.length] || 0;
        const rr = rBase * (0.12 + Math.pow(depth, 1.75) * (1.18 + drive.inversion * 0.24 + band * 0.35));
        const tail = rBase * (0.020 + depth * (0.10 + amount * 0.015 + drive.temperature * 0.030) + beat * 0.020);
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr * (0.72 + drive.scaleDepth * 0.10);
        ctx.beginPath();
        ctx.moveTo(x - Math.cos(a) * tail, y - Math.sin(a) * tail * 0.72);
        ctx.lineTo(x + Math.cos(a) * tail * 0.26, y + Math.sin(a) * tail * 0.20);
        ctx.strokeStyle = hsl(hue + seed * 0.28 + band * 0.10, sat, light * (0.48 + depth * 0.34 + band * 0.15), (0.016 + depth * 0.055 + band * 0.045 + beat * 0.020) * amount);
        ctx.lineWidth = (0.35 + depth * 1.8 + band * 1.4 + beat * 0.9) * STATE.scale;
        ctx.stroke();
    }
    ctx.restore();
}

function drawLightTrails(ctx, w, h, hue, sat, light, amount, t, bands, feat) {
    const drive = readParamDrive();
    const beat = clamp(feat.beat || 0, 0, 1);
    const rms = clamp(feat.rms || 0, 0, 1);
    const strands = detailCount(10 + amount * 22 + drive.scaleDepth * 5, 6, 42);
    const steps = detailCount(52 + amount * 36, 30, 96);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = 'lighter';
    for (let r = 0; r < strands; r++) {
        const k = r / Math.max(1, strands - 1);
        const seed = hash01(r * 5.31 + drive.inversion * 7.0);
        const lane = h * (0.14 + k * 0.72);
        const band = bands[(r * 7 + 2) % bands.length] || 0;
        const amp = h * (0.020 + band * 0.060 + rms * 0.020 + drive.temperature * 0.035 + beat * 0.015) * amount;
        const drift = t * (0.11 + drive.equilibrium * 1.4 + seed * 0.08);
        ctx.beginPath();
        for (let s = 0; s <= steps; s++) {
            const u = s / steps;
            const b = bands[(s + r * 3) % bands.length] || 0;
            const x = w * u;
            const curl = Math.sin(u * Math.PI * (2.0 + drive.coherence * 5.0) + drift + seed * 6.28)
                + 0.55 * Math.sin(u * Math.PI * (6.0 + drive.scaleDepth * 5.0) - drift * 1.7 + hue * 6.0)
                + 0.25 * Math.sin(u * Math.PI * 13.0 + t * 0.23 + b * 4.0);
            const y = lane + curl * amp * (0.65 + b * 1.4) + Math.sin(k * 9.0 + t * 0.08) * h * 0.025 * drive.inversion;
            if (s === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = hsl(hue + k * 0.42 + seed * 0.12 + band * 0.10, sat, light * (0.50 + band * 0.30), (0.030 + band * 0.055 + beat * 0.028) * amount);
        ctx.lineWidth = (0.50 + band * 2.5 + beat * 1.5 + drive.scaleDepth * 0.7) * STATE.scale;
        ctx.stroke();
    }
    ctx.restore();
}

function drawTunnel(ctx, cx, cy, rBase, hue, sat, light, amount, t, bands, feat) {
    const beat = clamp(feat.beat || 0, 0, 1);
    const count = detailCount(12 + amount * 26, 7, 38);
    for (let i = 0; i < count; i++) {
        const k = i / count;
        const spin = t * (0.06 + k * 0.035) + k * Math.PI * 4;
        const rr = rBase * (0.06 + k * k * 0.95) * (1 + beat * 0.04);
        const sides = 5 + (i % 5);
        const b = bands[(i * 7) % bands.length] || 0;
        ctx.beginPath();
        for (let s = 0; s <= sides; s++) {
            const a = spin + (s / sides) * Math.PI * 2;
            const wob = 1 + Math.sin(a * 3 + t * 0.33 + b * 4) * (0.035 + b * 0.05);
            const x = cx + Math.cos(a) * rr * wob;
            const y = cy + Math.sin(a) * rr * wob;
            if (s === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = hsl(hue + k * 0.33 + b * 0.12, sat, light * (0.52 + k * 0.34), (0.035 + b * 0.04 + beat * 0.04) * amount * (1 - k * 0.25));
        ctx.lineWidth = (0.5 + b * 2.3 + beat * 1.1) * STATE.scale;
        ctx.stroke();
    }
}

function drawAurora(ctx, w, h, hue, sat, light, amount, t, bands, feat) {
    const bandsN = detailCount(4 + amount * 7, 2, 12);
    const rms = clamp(feat.rms || 0, 0, 1);
    for (let b = 0; b < bandsN; b++) {
        const k = b / Math.max(1, bandsN - 1);
        const grad = ctx.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, hsl(hue + k * 0.25, sat, light * 0.55, 0));
        grad.addColorStop(0.45, hsl(hue + k * 0.25 + 0.08, sat, light * 0.74, (0.025 + rms * 0.03) * amount));
        grad.addColorStop(1, hsl(hue + k * 0.25 + 0.16, sat, light * 0.50, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        const yBase = h * (0.18 + k * 0.62);
        ctx.moveTo(0, h);
        const steps = detailCount(42, 24, 42);
        for (let i = 0; i <= steps; i++) {
            const u = i / steps;
            const band = bands[(i + b * 5) % bands.length] || 0;
            const y = yBase + Math.sin(u * 7 + t * (0.10 + k * 0.04) + b) * h * (0.04 + band * 0.06) * amount
                + Math.sin(u * 19 - t * 0.07) * h * 0.012;
            ctx.lineTo(u * w, y);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();
    }
}

function drawBeatBloom(ctx, w, h, cx, cy, rBase, hue, sat, light, amount, t, bands, feat) {
    const beat = clamp(feat.beat || 0, 0, 1);
    const blow = clamp(feat.blowout || feat.fxLevel || 0, 0, 2.5);
    const pulse = clamp(0.18 + amount * 0.16 + beat * 0.20 + blow * 0.08, 0.05, 0.62);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const passes = detailCount(3, 1, 3);
    for (let p = 0; p < passes; p++) {
        const k = p / 3;
        const band = bands[(p * 9 + 3) % bands.length] || 0;
        const ox = Math.sin(t * (0.11 + k * 0.05) + k * 6.0 + hue * 4.0) * rBase * (0.14 + band * 0.12);
        const oy = Math.cos(t * (0.09 + k * 0.04) + k * 4.7) * rBase * (0.10 + band * 0.10);
        const rr = rBase * (0.62 + k * 0.34 + band * 0.18 + beat * 0.08);
        const grad = ctx.createRadialGradient(cx + ox, cy + oy, rr * 0.06, cx + ox, cy + oy, rr);
        grad.addColorStop(0, hsl(hue + k * 0.18 + band * 0.08, sat, light * (0.72 + beat * 0.12), pulse * (0.18 + band * 0.10)));
        grad.addColorStop(0.48, hsl(hue + 0.12 + k * 0.20, sat, light * 0.50, pulse * 0.06));
        grad.addColorStop(1, hsl(hue + 0.28 + k * 0.12, sat, light * 0.34, 0));
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
}

function drawSpectralBloom(ctx, cx, cy, rBase, hue, sat, light, amount, t, bands, feat) {
    const beat = clamp(feat.beat || 0, 0, 1);
    const blow = clamp(feat.blowout || feat.fxLevel || 0, 0, 2.5);
    const petals = Math.floor(8 + amount * 8 + beat * 4);
    const loops = detailCount(3 + amount * 3, 2, 7);
    ctx.lineCap = 'round';
    for (let pass = 0; pass < loops; pass++) {
        const k = pass / Math.max(1, loops - 1);
        const band = bands[(pass * 7 + 2) % bands.length] || 0;
        ctx.beginPath();
        const steps = detailCount(150, 64, 150);
        for (let s = 0; s <= steps; s++) {
            const u = s / steps;
            const a = u * Math.PI * 2 * (1.35 + k * 0.45) + t * (0.045 + k * 0.035) + pass * 0.9;
            const petal = Math.sin(a * petals + t * (0.30 + k * 0.08) + band * 5.0);
            const rr = rBase * (0.10 + u * (0.82 + beat * 0.06)) * (1 + petal * (0.026 + amount * 0.012) + band * 0.11 + blow * 0.025);
            const x = cx + Math.cos(a) * rr;
            const y = cy + Math.sin(a) * rr * (0.68 + k * 0.12 + beat * 0.04);
            if (s === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = hsl(hue + k * 0.28 + band * 0.12, sat, light * (0.55 + k * 0.22), (0.026 + band * 0.040 + beat * 0.025) * amount);
        ctx.lineWidth = (0.65 + band * 2.2 + beat * 1.4) * STATE.scale;
        ctx.stroke();
    }
}

function drawKaleidoBloom(ctx, cx, cy, rBase, hue, sat, light, amount, t, bands, feat) {
    const beat = clamp(feat.beat || 0, 0, 1);
    const arms = detailCount(6 + amount * 4 + beat * 3, 4, 15);
    const rings = detailCount(3 + amount * 4, 2, 8);
    ctx.lineCap = 'round';
    for (let arm = 0; arm < arms; arm++) {
        const a0 = (arm / arms) * Math.PI * 2 + t * 0.035;
        for (let ring = 0; ring < rings; ring++) {
            const k = (ring + 1) / rings;
            const b = bands[(arm * 5 + ring * 7) % bands.length] || 0;
            const spread = 0.18 + b * 0.18 + beat * 0.07;
            const r0 = rBase * (0.12 + k * 0.12);
            const r1 = rBase * (0.18 + k * (0.72 + b * 0.22 + beat * 0.05));
            const mid = a0 + Math.sin(t * 0.12 + ring + b * 4.0) * spread;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a0 - spread) * r0, cy + Math.sin(a0 - spread) * r0);
            ctx.quadraticCurveTo(
                cx + Math.cos(mid) * rBase * (0.28 + k * 0.42),
                cy + Math.sin(mid) * rBase * (0.24 + k * 0.34),
                cx + Math.cos(a0 + spread) * r1,
                cy + Math.sin(a0 + spread) * r1
            );
            ctx.strokeStyle = hsl(hue + arm / arms * 0.45 + k * 0.12 + b * 0.08, sat, light * (0.48 + k * 0.28), (0.022 + b * 0.034 + beat * 0.020) * amount);
            ctx.lineWidth = (0.45 + k * 1.25 + b * 2.0 + beat * 0.8) * STATE.scale;
            ctx.stroke();
        }
    }
}

function drawConstellationWeb(ctx, cx, cy, rBase, hue, sat, light, amount, t, bands, feat) {
    const beat = clamp(feat.beat || 0, 0, 1);
    const n = detailCount(34 + amount * 44, 20, 82);
    const nodes = STATE.nodeCache;
    nodes.length = n;
    for (let i = 0; i < n; i++) {
        const k = i / n;
        const b = bands[(i * 11) % bands.length] || 0;
        const a = k * Math.PI * 2 * 2.35 + t * (0.018 + (i % 5) * 0.003) + Math.sin(k * 21 + t * 0.07) * 0.24;
        const rr = rBase * (0.13 + ((i * 37) % n) / n * 0.96) * (1 + b * 0.20 + beat * 0.06);
        const node = nodes[i] || (nodes[i] = {});
        node.x = cx + Math.cos(a) * rr;
        node.y = cy + Math.sin(a * 1.08 + Math.sin(t * 0.04 + k * 9.0) * 0.18) * rr * 0.74;
        node.b = b;
        node.k = k;
    }
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
        const a = nodes[i];
        for (const hop of [5, 13]) {
            const b = nodes[(i + hop) % n];
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const maxD = rBase * (0.26 + beat * 0.04 + (a.b + b.b) * 0.06);
            if (dist > maxD) continue;
            const alpha = (1 - dist / maxD) * (0.034 + (a.b + b.b) * 0.028 + beat * 0.014) * amount;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = hsl(hue + a.k * 0.52 + a.b * 0.12, sat, light * (0.52 + a.b * 0.30), alpha);
            ctx.lineWidth = (0.35 + (a.b + b.b) * 1.1 + beat * 0.45) * STATE.scale;
            ctx.stroke();
        }
    }
    for (let i = 0; i < n; i += 2) {
        const a = nodes[i];
        const size = (0.55 + a.b * 2.1 + beat * 0.8) * STATE.scale;
        ctx.fillStyle = hsl(hue + a.k * 0.62, sat, light * (0.58 + a.b * 0.28), (0.035 + a.b * 0.055 + beat * 0.025) * amount);
        ctx.fillRect(a.x - size * 0.5, a.y - size * 0.5, size, size);
    }
}


function drawCellularAutomata(ctx, w, h, hue, sat, light, amount, t, bands, feat) {
    const cols = detailCount(18 + amount * 22, 10, 40);
    const rows = detailCount(10 + amount * 16, 6, 26);
    const cellW = w / cols;
    const cellH = h / rows;
    const beat = clamp(feat.beat || 0, 0, 1);
    const rms = clamp(feat.rms || 0, 0, 1);
    ctx.lineWidth = Math.max(0.35, STATE.scale * (0.35 + beat));
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            const u = x / cols;
            const v = y / rows;
            const b = bands[(x * 7 + y * 3) % bands.length] || 0;
            const phase = Math.sin(u * 19 + v * 13 + t * (0.42 + b) + hue * 7)
                + Math.cos(u * 31 - v * 17 - t * 0.31);
            if (phase + b * 1.6 + beat * 1.4 < 0.92) continue;
            const px = (x + 0.5) * cellW;
            const py = (y + 0.5) * cellH;
            const r = Math.min(cellW, cellH) * (0.18 + b * 0.42 + beat * 0.18);
            ctx.strokeStyle = hsl(hue + b * 0.18 + u * 0.22, sat, light * (0.5 + b * 0.35), (0.025 + b * 0.050 + rms * 0.018) * amount);
            ctx.strokeRect(px - r, py - r, r * 2, r * 2);
            if ((x + y) % 2 === 0) {
                ctx.beginPath();
                ctx.moveTo(px, py);
                ctx.lineTo(px + Math.cos(phase) * cellW * 0.7, py + Math.sin(phase) * cellH * 0.7);
                ctx.stroke();
            }
        }
    }
}

function drawMoire(ctx, cx, cy, rBase, hue, sat, light, amount, t, bands, feat) {
    const beat = clamp(feat.beat || 0, 0, 1);
    const rings = detailCount(10 + amount * 26, 6, 36);
    for (let pass = 0; pass < 2; pass++) {
        const rot = t * (0.025 + pass * 0.017) + pass * 0.73;
        for (let i = 0; i < rings; i++) {
            const k = i / rings;
            const b = bands[(i * 5 + pass * 11) % bands.length] || 0;
            ctx.beginPath();
            const steps = detailCount(96, 48, 96);
            for (let s = 0; s <= steps; s++) {
                const a = rot + s / steps * Math.PI * 2;
                const rr = rBase * (0.12 + k * 1.05) * (1 + Math.sin(a * (5 + pass * 2) + t * 0.21 + b * 4) * (0.018 + b * 0.06 + beat * 0.025));
                const x = cx + Math.cos(a) * rr;
                const y = cy + Math.sin(a) * rr * (0.72 + pass * 0.18);
                if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = hsl(hue + pass * 0.18 + k * 0.22 + b * 0.08, sat, light * (0.52 + k * 0.22), (0.012 + b * 0.028 + beat * 0.018) * amount);
            ctx.lineWidth = (0.35 + b * 1.8 + beat * 0.6) * STATE.scale;
            ctx.stroke();
        }
    }
}

function drawHyperspace(ctx, cx, cy, rBase, hue, sat, light, amount, t, bands, feat) {
    const beat = clamp(feat.beat || 0, 0, 1);
    const n = detailCount(42 + amount * 120, 24, 162);
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
        const k = i / n;
        const b = bands[(i * 13) % bands.length] || 0;
        const a = k * Math.PI * 2 + Math.sin(t * 0.06 + k * 18) * 0.22;
        const r0 = rBase * (0.08 + b * 0.08 + beat * 0.04);
        const r1 = rBase * (0.35 + b * 0.95 + amount * 0.55);
        const bend = Math.sin(k * 31 + t * 0.37) * rBase * 0.08;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        ctx.quadraticCurveTo(cx + Math.cos(a + 0.7) * bend, cy + Math.sin(a - 0.4) * bend, cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.strokeStyle = hsl(hue + k * 0.8 + b * 0.1, sat, light * (0.48 + b * 0.45), (0.025 + b * 0.055 + beat * 0.04) * amount);
        ctx.lineWidth = (0.4 + b * 2.6 + beat * 1.1) * STATE.scale;
        ctx.stroke();
    }
}

function drawRibbonReactor(ctx, w, h, hue, sat, light, amount, t, bands, feat) {
    const ribbons = detailCount(4 + amount * 6, 3, 10);
    const beat = clamp(feat.beat || 0, 0, 1);
    ctx.lineCap = 'round';
    for (let r = 0; r < ribbons; r++) {
        const k = r / Math.max(1, ribbons - 1);
        const yBase = h * (0.18 + k * 0.64);
        ctx.beginPath();
        const steps = detailCount(110, 52, 110);
        for (let s = 0; s <= steps; s++) {
            const u = s / steps;
            const b = bands[(s + r * 9) % bands.length] || 0;
            const x = w * u;
            const y = yBase
                + Math.sin(u * 7.0 + t * (0.18 + k * 0.12) + r) * h * (0.026 + b * 0.036) * amount
                + Math.sin(u * 23.0 - t * 0.32 + hue * 8) * h * (0.008 + beat * 0.005);
            if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = hsl(hue + k * 0.48 + beat * 0.12, sat * 0.92, light * (0.54 + k * 0.20), (0.026 + beat * 0.024) * amount);
        ctx.lineWidth = (0.55 + k * 1.45 + beat * 1.20) * STATE.scale;
        ctx.stroke();
    }
}

function drawVisualStyle(style, ctx, w, h, cx, cy, rBase, hue, sat, light, amount, t, bands, feat) {
    if (style === 'spectral') drawSpectralBloom(ctx, cx, cy, rBase * 1.05, hue, sat, light, amount, t, bands, feat);
    else if (style === 'kaleido') drawKaleidoBloom(ctx, cx, cy, rBase * 1.08, hue, sat, light, amount, t, bands, feat);
    else if (style === 'constellation') drawConstellationWeb(ctx, cx, cy, rBase * 1.12, hue, sat, light, amount, t, bands, feat);
    else if (style === 'cymatics') drawCymatics(ctx, cx, cy, rBase, hue, sat, light, amount, t, bands, feat);
    else if (style === 'sinefield') drawSineField(ctx, w, h, hue, sat, light, amount, t, bands, feat);
    else if (style === 'matrixrain') drawMatrixRain(ctx, w, h, hue, sat, light, amount, t, bands, feat);
    else if (style === 'oscilloscope') {
        drawSineField(ctx, w, h, hue, sat, light, amount * 1.1, t, bands, feat);
        drawRadialBars(ctx, cx, cy, rBase * 0.72, hue + 0.08, sat, light, amount * 0.7, t, bands, feat);
    } else if (style === 'spectrum') drawSpectrumAnalyzer(ctx, w, h, hue, sat, light, amount, t, bands, feat);
    else if (style === 'vectorscope') drawVectorscope(ctx, cx, cy, rBase * 1.08, hue, sat, light, amount, t, bands, feat);
    else if (style === 'tunnel') drawTunnel(ctx, cx, cy, rBase * 1.5, hue, sat, light, amount, t, bands, feat);
    else if (style === 'aurora') drawAurora(ctx, w, h, hue, sat, light, amount, t, bands, feat);
    else if (style === 'lattice') {
        drawCymatics(ctx, cx, cy, rBase * 0.9, hue, sat, light, amount * 0.72, t, bands, feat);
        drawSineField(ctx, w, h, hue + 0.18, sat, light, amount * 0.72, t + 10.0, bands, feat);
    } else if (style === 'cellular') {
        drawCellularAutomata(ctx, w, h, hue, sat, light, amount, t, bands, feat);
    } else if (style === 'moire') {
        drawMoire(ctx, cx, cy, rBase * 1.15, hue, sat, light, amount, t, bands, feat);
    } else if (style === 'hyperspace') {
        drawHyperspace(ctx, cx, cy, rBase * 1.25, hue, sat, light, amount, t, bands, feat);
    } else if (style === 'starfield') {
        drawStarfieldTrails(ctx, cx, cy, rBase * 1.35, hue, sat, light, amount, t, bands, feat);
    } else if (style === 'trails') {
        drawLightTrails(ctx, w, h, hue, sat, light, amount, t, bands, feat);
        drawStarfieldTrails(ctx, cx, cy, rBase * 1.08, hue + 0.12, sat, light, amount * 0.55, t + 4.0, bands, feat);
    } else if (style === 'entropy') {
        drawCellularAutomata(ctx, w, h, hue, sat, light, amount * 0.72, t, bands, feat);
        drawMoire(ctx, cx, cy, rBase * 0.95, hue + 0.1, sat, light, amount * 0.70, t, bands, feat);
        drawRadialBars(ctx, cx, cy, rBase * 0.85, hue + 0.22, sat, light, amount * 0.55, t, bands, feat);
    } else if (style === 'ribbons') {
        drawRibbonReactor(ctx, w, h, hue, sat, light, amount, t, bands, feat);
    } else {
        drawCymatics(ctx, cx, cy, rBase, hue, sat, light, amount, t, bands, feat);
        drawSineField(ctx, w, h, hue + 0.12, sat, light, amount * 0.7, t, bands, feat);
    }
}

function drawFrame() {
    const S = window.S || {};
    const c = STATE.canvas;
    const ctx = STATE.ctx;
    if (!c || !ctx) return;
    STATE.frame++;
    requestAnimationFrame(drawFrame);

    if (S.visualEffects === false) {
        ctx.clearRect(0, 0, STATE.w, STATE.h);
        return;
    }
    const skip = perfSkip();
    if (skip > 1 && (STATE.frame % skip) !== 0) return;

    const frameStarted = performance.now();
    resize();
    sampleAudioBands();

    const w = STATE.w;
    const h = STATE.h;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const minDim = Math.min(w, h);
    const t = performance.now() * 0.001;
    const eff = window.S_effective || S;
    const feat = window.SS_AUDIO_FEATURES || {};
    const z = zoomState();
    const drive = readParamDrive(eff);
    window.SS_VISUAL_PARAM_DRIVE = drive;
    STATE.detail = computeDetailScale(S, z);
    const rms = clamp(feat.rms || 0, 0, 1);
    const beat = clamp(feat.beat || 0, 0, 1);
    STATE.smoothed = lerp(STATE.smoothed, rms, 0.08);
    STATE.beat = lerp(STATE.beat, beat, beat > STATE.beat ? 0.45 : 0.08);
    updateSpectrumState(feat);
    const expressivity = clamp(S.visualEffectExpressivity ?? 1.35, 0.35, 2.5);
    const dynamics = clamp(S.visualEffectDynamics ?? 1.15, 0.25, 2.5);
    const response = 0.78 + expressivity * 0.22 + STATE.smoothed * (0.20 + expressivity * 0.20) + STATE.beat * (0.14 + expressivity * 0.17)
        + STATE.bass * (0.05 + dynamics * 0.07) + STATE.treble * (0.03 + dynamics * 0.05)
        + drive.temperature * 0.055 * dynamics + drive.scaleDepth * 0.035 * expressivity + drive.particleLoad * 0.010;
    const pressure = clamp(z.overdrawPressure || 0, 0, 1);
    const active2D = S.visualEffectBackdrop !== false && S.visualEffect2DBackdrop !== false;
    const active3D = S.visualEffectPost !== false;
    const layerBudget = active2D && active3D ? 0.86 : 1.0;
    const amount = clamp((S.visualEffectAmount ?? 0.75) * (0.72 + (z.effectScale || 1) * 0.28) * response * (1 - pressure * 0.24) * layerBudget, 0, 2.65);
    STATE.phase += 0.0015 + finite(eff.tempo, 1) * 0.0007 + STATE.smoothed * 0.004 * (0.75 + expressivity * 0.30)
        + STATE.beat * 0.010 * (0.75 + expressivity * 0.25) + (STATE.mid - STATE.bass) * 0.0025 * dynamics
        + drive.equilibrium * 0.0015 * dynamics + drive.temperature * 0.0008 * expressivity;

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    const echo = clamp((S.visualEffectEcho ?? 0.18) * (1 - STATE.beat * 0.18), 0.018, 0.6);
    ctx.fillStyle = `rgba(0, 0, 0, ${echo})`;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';

    const hue = (((finite(eff.hue, 0.59) + STATE.phase + clamp(feat.colorPhase || 0, 0, 4) * 0.025 + (STATE.treble - STATE.bass) * 0.055 * dynamics + drive.scaleDepth * 0.018) % 1) + 1) % 1;
    const sat = clamp(finite(eff.sat, 1) * (1 + drive.temperature * 0.08), 0.1, 2.0);
    const light = clamp(finite(eff.lightness, 0.9) * (0.54 + expressivity * 0.055 + STATE.beat * 0.035 + STATE.treble * 0.032 * dynamics + drive.coherence * 0.018), 0.28, 0.9);
    const rBase = minDim * (0.21 + clamp(finite(eff.inversion, 80), 20, 450) / 2200 + STATE.smoothed * (0.05 + expressivity * 0.035) + STATE.beat * 0.018 + STATE.bass * 0.020 * dynamics + drive.particleLoad * 0.006);
    const chosen = resolveVisualStyle(S, hue, t);
    const styleBlend = visualStyleBlend(t);
    const previousStyle = STATE.previousStyle;
    const accent = updateAccentStyle(S, chosen, t, dynamics);
    window.SS_VISUAL_EFFECT_STYLE = previousStyle && styleBlend < 0.5 ? previousStyle : chosen;

    if (S.visualEffectBackdrop !== false) {
        drawBeatBloom(ctx, w, h, cx, cy, rBase, hue, sat, light, amount * (0.38 + expressivity * 0.08 + dynamics * 0.05), t, STATE.bands, feat);
        if (previousStyle && previousStyle !== chosen && styleBlend < 0.995) {
            ctx.save();
            ctx.globalAlpha = clamp((1 - styleBlend) * 0.78, 0, 0.78);
            drawVisualStyle(previousStyle, ctx, w, h, cx, cy, rBase, hue, sat, light, amount, t, STATE.bands, feat);
            ctx.restore();
            ctx.save();
            ctx.globalAlpha = clamp(0.18 + styleBlend * 0.82, 0.18, 1);
            drawVisualStyle(chosen, ctx, w, h, cx, cy, rBase, hue, sat, light, amount, t, STATE.bands, feat);
            ctx.restore();
        } else {
            drawVisualStyle(chosen, ctx, w, h, cx, cy, rBase, hue, sat, light, amount, t, STATE.bands, feat);
        }
        if (accent && STATE.accentLevel > 0.035 && accent !== chosen && (pressure < 0.78 || STATE.beat > 0.62)) {
            ctx.save();
            ctx.globalAlpha = clamp(STATE.accentLevel * (0.22 + dynamics * 0.12) * (1 - pressure * 0.42), 0.04, 0.58);
            ctx.globalCompositeOperation = 'lighter';
            drawVisualStyle(accent, ctx, w, h, cx, cy, rBase * (0.88 + STATE.bass * 0.20), hue + 0.13 + STATE.treble * 0.08, sat, light, amount * clamp(0.38 + dynamics * 0.14, 0.34, 0.72) * (1 - pressure * 0.30), t + 9.7, STATE.bands, feat);
            ctx.restore();
        }
    }

    if (S.visualEffectPost !== false) {
        const postScale = 1 - pressure * 0.54;
        drawRadialBars(ctx, cx, cy, rBase * (0.88 + STATE.beat * 0.08), hue + 0.05, sat, light, amount * (0.50 + STATE.beat * 0.40) * postScale, t, STATE.bands, feat);
        if (pressure < 0.86 || STATE.beat > 0.70) {
            drawClassicPhosphor(ctx, w, h, hue + 0.17, sat, light, amount * (0.42 + STATE.treble * 0.28 + STATE.beat * 0.18) * postScale, t, STATE.bands, feat);
        }
        const aberr = clamp(S.visualEffectAberration ?? 0.22, 0, 1) * amount;
        if (aberr > 0.01) {
            ctx.globalCompositeOperation = 'screen';
            ctx.strokeStyle = hsl(hue + 0.33, sat, light * 0.75, 0.012 * aberr + STATE.beat * 0.014);
            ctx.lineWidth = Math.max(1, STATE.scale * (1 + STATE.beat * 2));
            const off = minDim * (0.010 + STATE.beat * 0.012) * aberr;
            ctx.strokeRect(off, off, w - off * 2, h - off * 2);
        }
    }
    ctx.restore();

    const budget = Math.max(1, Math.min(24, Number(S.visualEffectMaxFrameMs) || 4.5));
    const cost = performance.now() - frameStarted;
    STATE.lastCostMs = cost;
    if (cost > budget && STATE.adaptiveSkip < 6) STATE.adaptiveSkip++;
    else if (cost < budget * 0.45 && STATE.adaptiveSkip > 0 && (STATE.frame % 40) === 0) STATE.adaptiveSkip--;
}

export function describeVisualEffectStyle(id) {
    return describeVisualEffectStyleFromRegistry(id);
}


function hslToRgb01(h, sat = 1, light = 0.5) {
    const hue = (((Number(h) || 0) % 1) + 1) % 1;
    const s = clamp(sat, 0, 2);
    const l = clamp(light, 0, 1);
    const c = (1 - Math.abs(2 * l - 1)) * Math.min(1, s);
    const x = c * (1 - Math.abs((hue * 6) % 2 - 1));
    const m = l - c * 0.5;
    let r = 0, g = 0, b = 0;
    const hp = hue * 6;
    if (hp < 1) { r = c; g = x; }
    else if (hp < 2) { r = x; g = c; }
    else if (hp < 3) { g = c; b = x; }
    else if (hp < 4) { g = x; b = c; }
    else if (hp < 5) { r = x; b = c; }
    else { r = c; b = x; }
    return [r + m, g + m, b + m];
}

function ensureGpuVisualEffects() {
    const engine = window.engine;
    if (!engine || !engine.scene) return false;
    if (STATE.gpu && STATE.gpu.mesh && STATE.gpu.mesh.parent) return true;

    const maxSegments = 4096;
    const positions = new Float32Array(maxSegments * 2 * 3);
    const colors = new Float32Array(maxSegments * 2 * 3);
    const geometry = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(positions, 3);
    const colAttr = new THREE.BufferAttribute(colors, 3);
    if (THREE.DynamicDrawUsage !== undefined) {
        posAttr.setUsage(THREE.DynamicDrawUsage);
        colAttr.setUsage(THREE.DynamicDrawUsage);
    }
    geometry.setAttribute('position', posAttr);
    geometry.setAttribute('color', colAttr);
    geometry.setDrawRange(0, 0);

    const material = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
    });
    const mesh = new THREE.LineSegments(geometry, material);
    mesh.name = 'webgpu-visual-effects';
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    mesh.visible = false;
    engine.scene.add(mesh);

    const maxTriangles = 4096;
    const surfacePositions = new Float32Array(maxTriangles * 3 * 3);
    const surfaceColors = new Float32Array(maxTriangles * 3 * 3);
    const surfaceGeometry = new THREE.BufferGeometry();
    const sPosAttr = new THREE.BufferAttribute(surfacePositions, 3);
    const sColAttr = new THREE.BufferAttribute(surfaceColors, 3);
    if (THREE.DynamicDrawUsage !== undefined) {
        sPosAttr.setUsage(THREE.DynamicDrawUsage);
        sColAttr.setUsage(THREE.DynamicDrawUsage);
    }
    surfaceGeometry.setAttribute('position', sPosAttr);
    surfaceGeometry.setAttribute('color', sColAttr);
    surfaceGeometry.setDrawRange(0, 0);
    const surfaceMaterial = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
    });
    const surfaceMesh = new THREE.Mesh(surfaceGeometry, surfaceMaterial);
    surfaceMesh.name = 'webgpu-audio-surface-fx';
    surfaceMesh.frustumCulled = false;
    surfaceMesh.renderOrder = 2;
    surfaceMesh.visible = false;
    engine.scene.add(surfaceMesh);

    STATE.gpu = { mesh, geometry, positions, colors, maxSegments, segments: 0,
        surfaceMesh, surfaceGeometry, surfacePositions, surfaceColors, maxTriangles, surfaceTriangles: 0 };
    STATE.gpuSurface = surfaceMesh;
    return true;
}

function writeGpuSegment(gpu, seg, ax, ay, az, bx, by, bz, colorA, colorB = colorA) {
    if (!gpu || seg >= gpu.maxSegments) return seg;
    const vi = seg * 6;
    const ci = seg * 6;
    gpu.positions[vi + 0] = ax;
    gpu.positions[vi + 1] = ay;
    gpu.positions[vi + 2] = az;
    gpu.positions[vi + 3] = bx;
    gpu.positions[vi + 4] = by;
    gpu.positions[vi + 5] = bz;
    gpu.colors[ci + 0] = colorA[0];
    gpu.colors[ci + 1] = colorA[1];
    gpu.colors[ci + 2] = colorA[2];
    gpu.colors[ci + 3] = colorB[0];
    gpu.colors[ci + 4] = colorB[1];
    gpu.colors[ci + 5] = colorB[2];
    return seg + 1;
}

function writeGpuTriangle(gpu, tri, p0, p1, p2, c0, c1 = c0, c2 = c0) {
    if (!gpu || tri >= gpu.maxTriangles) return tri;
    const vi = tri * 9;
    const ci = tri * 9;
    const pos = gpu.surfacePositions;
    const col = gpu.surfaceColors;
    pos[vi + 0] = p0[0]; pos[vi + 1] = p0[1]; pos[vi + 2] = p0[2];
    pos[vi + 3] = p1[0]; pos[vi + 4] = p1[1]; pos[vi + 5] = p1[2];
    pos[vi + 6] = p2[0]; pos[vi + 7] = p2[1]; pos[vi + 8] = p2[2];
    col[ci + 0] = c0[0]; col[ci + 1] = c0[1]; col[ci + 2] = c0[2];
    col[ci + 3] = c1[0]; col[ci + 4] = c1[1]; col[ci + 5] = c1[2];
    col[ci + 6] = c2[0]; col[ci + 7] = c2[1]; col[ci + 8] = c2[2];
    return tri + 1;
}

function drawGpuAudioSurface(gpu, style, radius, hue, sat, light, amount, t, bands, feat, drive, maxTri) {
    if (!gpu || !gpu.surfaceMesh) return 0;
    let tri = 0;
    const beat = clamp(feat.beat || feat.fxBeat || 0, 0, 1);
    const rms = clamp(feat.rms || feat.fxLevel || 0, 0, 1);
    const rings = Math.max(4, Math.min(13, Math.round(5 + amount * 2.4 + beat * 2.2)));
    const steps = Math.max(30, Math.min(88, Math.floor(maxTri / Math.max(2, rings * 2))));
    const swirl = Math.sin(t * 0.035) * 0.16 * (drive.coherenceSign || 1);
    const surfStyle = style === 'random' || style === 'adaptive' ? 'spectral' : style;
    for (let r = 0; r < rings - 1 && tri < maxTri; r++) {
        const rk0 = r / Math.max(1, rings - 1);
        const rk1 = (r + 1) / Math.max(1, rings - 1);
        for (let i = 0; i < steps && tri < maxTri; i++) {
            const u0 = i / steps;
            const u1 = (i + 1) / steps;
            const band0 = bands[(i + r * 3) % bands.length] || 0;
            const band1 = bands[(i + 1 + r * 3) % bands.length] || 0;
            const make = (u, rk, band, off = 0) => {
                const a = u * Math.PI * 2 + swirl + rk * (0.75 + drive.scaleDepth * 0.18);
                const petal = Math.sin(a * (1.6 + drive.scaleDepth * 0.45) + t * 0.32 + rk * 6.0);
                const fold = Math.cos(a * (2.1 + drive.temperature * 0.55) - t * 0.24 + rk * 3.0);
                let rr = radius * (0.10 + rk * 0.50 + band * 0.14 + rms * 0.07 + beat * 0.035);
                if (surfStyle === 'tunnel' || surfStyle === 'hyperspace' || surfStyle === 'starfield') rr *= 0.65 + rk * 0.9;
                if (surfStyle === 'aurora') rr *= 0.66 + petal * 0.055;
                if (surfStyle === 'ribbons') rr *= 0.74 + petal * 0.085;
                if (surfStyle === 'trails') rr *= 0.68 + petal * 0.075;
                const x = Math.cos(a + petal * 0.16 + off) * rr + Math.sin(rk * 8 + t * 0.22) * radius * 0.014;
                const y = Math.sin(a * (0.88 + drive.equilibrium * 0.9) - off) * rr * (0.58 + band * 0.24) + petal * radius * 0.020;
                const z = fold * radius * (0.050 + rk * 0.110 + band * 0.055 + beat * 0.035) + (rk - 0.5) * radius * 0.070;
                return [x, y, z];
            };
            const p00 = make(u0, rk0, band0, 0);
            const p10 = make(u1, rk0, band1, 0.02);
            const p01 = make(u0, rk1, band0, 0.04);
            const p11 = make(u1, rk1, band1, 0.06);
            const c00 = hslToRgb01(hue + u0 * 0.70 + rk0 * 0.21 + band0 * 0.16, clamp(sat * (0.86 + beat * 0.08), 0.25, 1.65), clamp(light * (0.34 + band0 * 0.18 + beat * 0.10), 0.16, 0.92));
            const c10 = hslToRgb01(hue + u1 * 0.72 + rk0 * 0.24 + 0.08, clamp(sat * 0.96, 0.25, 1.70), clamp(light * (0.36 + band1 * 0.17), 0.16, 0.92));
            const c01 = hslToRgb01(hue + u0 * 0.68 + rk1 * 0.26 + 0.18, clamp(sat * 0.90, 0.25, 1.65), clamp(light * (0.30 + band0 * 0.15), 0.14, 0.86));
            const c11 = hslToRgb01(hue + u1 * 0.72 + rk1 * 0.28 + 0.28, clamp(sat * 0.98, 0.25, 1.70), clamp(light * (0.35 + band1 * 0.17 + beat * 0.09), 0.16, 0.94));
            tri = writeGpuTriangle(gpu, tri, p00, p10, p11, c00, c10, c11);
            if (tri < maxTri) tri = writeGpuTriangle(gpu, tri, p00, p11, p01, c00, c11, c01);
        }
    }
    return tri;
}

function gpuPoint(style, i, n, ring, t, radius, drive, bands, feat) {
    const u = i / Math.max(1, n);
    const band = bands[i % bands.length] || 0;
    const audio = clamp((feat.fxLevel || feat.rms || 0) + band * 0.75, 0, 2);
    const sign = drive.coherenceSign || 1;
    const a = u * Math.PI * 2;
    const b = ring * 0.73 + Math.sin(t * 0.035 + ring * 0.17) * 0.12 * sign;
    const styleHash = hash01(String(style).length * 17 + ring * 11);
    let r = radius * (0.56 + ring * 0.055 + band * 0.20 + audio * 0.035);
    let x = Math.cos(a + b) * r;
    let y = Math.sin(a + b) * r;
    let z = Math.sin(a * (2.0 + drive.scaleDepth * 2.0) + t * 0.65 + ring) * radius * (0.05 + drive.temperature * 0.09 + audio * 0.025);

    if (style === 'tunnel' || style === 'hyperspace' || style === 'starfield') {
        const depth = (u * 2 - 1) * radius * (1.2 + ring * 0.08);
        const s = 0.18 + Math.abs(depth / Math.max(1, radius * 1.4));
        x = Math.cos(a * (2 + ring % 5) + Math.sin(t * 0.045) * 0.18 * sign) * radius * s * (0.35 + band * 0.35);
        y = Math.sin(a * (2 + ring % 5) + Math.sin(t * 0.040) * 0.16 * sign) * radius * s * (0.35 + band * 0.35);
        z = depth;
    } else if (style === 'vectorscope' || style === 'oscilloscope' || style === 'sinefield') {
        x = (u * 2 - 1) * radius * 1.35;
        y = Math.sin(u * Math.PI * (4 + ring % 6) + t * (1.1 + drive.equilibrium * 5) * sign) * radius * (0.18 + band * 0.45 + audio * 0.04);
        z = Math.cos(u * Math.PI * 2 + ring + t * 0.2) * radius * 0.07;
    } else if (style === 'lattice' || style === 'cellular' || style === 'moire') {
        // No more flat rectangular cage. Grid-ish styles become twisted
        // spectral knots / folded audio ribbons in 3D space.
        const q = u * Math.PI * 2 * (1.0 + (ring % 4) * 0.23);
        const wob = Math.sin(q * 2.7 + t * (0.9 + drive.equilibrium * 3.2) + ring) * (0.18 + band * 0.38 + audio * 0.10);
        const fold = Math.cos(q * (3.0 + drive.scaleDepth * 0.6) - t * 0.72 * sign + ring * 0.31);
        const rr = radius * (0.32 + ring * 0.040 + band * 0.22 + audio * 0.08);
        const twist = ring * 0.38 + Math.sin(t * 0.035 + ring) * 0.14 * sign;
        x = Math.cos(q + twist + wob) * rr + Math.cos(q * 2.0 - t * 0.12) * radius * (0.05 + audio * 0.025);
        y = Math.sin(q * 1.18 - twist * 0.55) * rr * (0.75 + band * 0.34) + Math.sin(q * 3.0 + t * 0.18) * radius * 0.035;
        z = fold * radius * (0.18 + drive.temperature * 0.08 + audio * 0.08) + Math.sin(q + ring) * radius * 0.06;
    } else if (style === 'aurora' || style === 'entropy' || style === 'ribbons') {
        const wave = Math.sin(a * (1.0 + ring * 0.08) + t * (0.6 + audio * 0.4) * sign);
        r *= 0.75 + wave * 0.18 + styleHash * 0.12;
        x = Math.cos(a + wave * 0.5) * r;
        y = Math.sin(a * (1.0 + drive.temperature * 0.18) + b * 0.5) * r * (0.62 + band * 0.42);
        z = Math.cos(a * 2.0 + t * 0.4 + ring) * radius * (0.08 + band * 0.12);
    }
    return [x, y, z];
}

function drawGpuVisualStyle(gpu, style, radius, hue, sat, light, amount, t, bands, feat, drive, maxSeg) {
    let seg = 0;
    const rings = Math.max(3, Math.min(18, Math.round(5 + amount * 3 + STATE.detail * 5)));
    const perRing = Math.max(48, Math.min(192, Math.floor(maxSeg / Math.max(1, rings))));
    const radialRibbonScale = style === 'ribbons' ? 0.62 : style === 'trails' ? 0.72 : style === 'hyperspace' ? 0.74 : 1;
    const styleRadius = radius * radialRibbonScale;
    for (let ring = 0; ring < rings && seg < maxSeg; ring++) {
        const localN = style === 'lattice' || style === 'cellular' || style === 'moire' ? 512 : perRing;
        const step = style === 'hyperspace' || style === 'starfield' ? 3 : 1;
        for (let i = 0; i < localN - step && seg < maxSeg; i += step) {
            const p0 = gpuPoint(style, i, localN, ring, t, styleRadius, drive, bands, feat);
            const p1 = gpuPoint(style, i + step, localN, ring, t, styleRadius, drive, bands, feat);
            const band = bands[(i + ring) % bands.length] || 0;
            const colorSat = clamp(sat * (1.10 + STATE.beat * 0.32 + (feat.fxLevel || 0) * 0.18), 0.25, 2.4);
            const colorA = hslToRgb01(hue + ring * 0.035 + band * 0.14 + STATE.beat * 0.025, colorSat, light * (0.76 + band * 0.26));
            const colorB = hslToRgb01(hue + ring * 0.045 + 0.16 + band * 0.16 + STATE.beat * 0.06, colorSat, light * (0.70 + STATE.beat * 0.22));
            seg = writeGpuSegment(gpu, seg, p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], colorA, colorB);
        }
    }
    return seg;
}

function ensureGpu2DBackdrop() {
    const engine = window.engine;
    if (!engine || !engine.scene || !engine.camera) return false;
    if (STATE.gpu2d && STATE.gpu2d.mesh && STATE.gpu2d.mesh.parent) return true;

    const maxSegments = 16000;
    const positions = new Float32Array(maxSegments * 2 * 3);
    const colors = new Float32Array(maxSegments * 2 * 3);
    const geometry = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(positions, 3);
    const colAttr = new THREE.BufferAttribute(colors, 3);
    if (THREE.DynamicDrawUsage !== undefined) {
        posAttr.setUsage(THREE.DynamicDrawUsage);
        colAttr.setUsage(THREE.DynamicDrawUsage);
    }
    geometry.setAttribute('position', posAttr);
    geometry.setAttribute('color', colAttr);
    geometry.setDrawRange(0, 0);
    const material = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
    });
    const mesh = new THREE.LineSegments(geometry, material);
    mesh.name = 'webgpu-2d-visualizer-backdrop-lines';
    mesh.frustumCulled = false;
    mesh.renderOrder = -19;
    mesh.visible = false;

    const maxFillTriangles = 18000;
    const fillPositions = new Float32Array(maxFillTriangles * 3 * 3);
    const fillColors = new Float32Array(maxFillTriangles * 3 * 3);
    const fillGeometry = new THREE.BufferGeometry();
    const fPosAttr = new THREE.BufferAttribute(fillPositions, 3);
    const fColAttr = new THREE.BufferAttribute(fillColors, 3);
    if (THREE.DynamicDrawUsage !== undefined) {
        fPosAttr.setUsage(THREE.DynamicDrawUsage);
        fColAttr.setUsage(THREE.DynamicDrawUsage);
    }
    fillGeometry.setAttribute('position', fPosAttr);
    fillGeometry.setAttribute('color', fColAttr);
    fillGeometry.setDrawRange(0, 0);
    const fillMaterial = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
    });
    const fillMesh = new THREE.Mesh(fillGeometry, fillMaterial);
    fillMesh.name = 'webgpu-2d-visualizer-backdrop-fills';
    fillMesh.frustumCulled = false;
    fillMesh.renderOrder = -20;
    fillMesh.visible = false;

    const blurOffsets = [
        [1.0, 0.0],
        [-1.0, 0.0],
        [0.0, 1.0],
        [0.0, -1.0],
        [0.72, 0.52],
        [-0.72, -0.52],
        [0.72, -0.52],
        [-0.72, 0.52],
        [1.25, 0.34],
        [-1.25, -0.34],
    ];
    const blurMeshes = blurOffsets.map((_, i) => {
        const m = new THREE.LineSegments(geometry, material.clone());
        m.name = `webgpu-2d-visualizer-backdrop-lines-blur-${i}`;
        m.frustumCulled = false;
        m.renderOrder = -23;
        m.visible = false;
        if (m.material) {
            m.material.transparent = true;
            m.material.depthWrite = false;
            m.material.depthTest = false;
            m.material.blending = THREE.AdditiveBlending;
            m.material.opacity = 0.0;
        }
        return m;
    });
    const blurFillMeshes = blurOffsets.map((_, i) => {
        const m = new THREE.Mesh(fillGeometry, fillMaterial.clone());
        m.name = `webgpu-2d-visualizer-backdrop-fills-blur-${i}`;
        m.frustumCulled = false;
        m.renderOrder = -24;
        m.visible = false;
        if (m.material) {
            m.material.transparent = true;
            m.material.depthWrite = false;
            m.material.depthTest = false;
            m.material.blending = THREE.AdditiveBlending;
            m.material.side = THREE.DoubleSide;
            m.material.opacity = 0.0;
        }
        return m;
    });

    // Camera-locked scene geometry: this gives us the old 2D backdrop feel
    // without a CanvasRenderingContext2D stroke path. The worker generates
    // normalized line + fill geometry; three/webgpu renders it. Keep all meshes
    // inside one camera-locked group so a tiny render-side transform can keep
    // the backdrop alive even if a worker frame arrives late.
    const group = new THREE.Group();
    group.name = 'webgpu-2d-visualizer-backdrop-group';
    group.frustumCulled = false;
    group.visible = false;
    group.add(fillMesh);
    group.add(mesh);
    for (const m of blurFillMeshes) group.add(m);
    for (const m of blurMeshes) group.add(m);
    try {
        if (!engine.camera.parent) engine.scene.add(engine.camera);
        engine.camera.add(group);
    } catch (e) {
        engine.scene.add(group);
    }
    STATE.gpu2d = { group, mesh, geometry, positions, colors, maxSegments, segments: 0, pending: null,
        fillMesh, fillGeometry, fillPositions, fillColors, maxFillTriangles, fillTriangles: 0,
        blurOffsets, blurMeshes, blurFillMeshes, backdropHalfW: 0, backdropHalfH: 0 };
    return true;
}

function ensureVisualEffectWorker() {
    if (STATE.worker || STATE.workerFailed) return !!STATE.worker;
    if (typeof Worker === 'undefined') return false;
    try {
        const w = new Worker(visualEffectsWorkerUrl);
        w.onmessage = (e) => {
            const m = e && e.data;
            if (!m || typeof m !== 'object') return;
            if (m.type === 'frame') {
                STATE.workerBusy = false;
                STATE.workerFrame = {
                    id: m.id,
                    segments: Math.max(0, m.segments | 0),
                    positions: m.positions,
                    colors: m.colors,
                    triangles: Math.max(0, m.triangles | 0),
                    fillPositions: m.fillPositions,
                    fillColors: m.fillColors,
                    arrivedAt: performance.now(),
                };
            } else if (m.type === 'error') {
                STATE.workerBusy = false;
                console.warn('[visual-effects] worker error:', m.message || m);
            }
        };
        w.onerror = (err) => {
            STATE.workerBusy = false;
            STATE.workerFailed = true;
            try { w.terminate(); } catch (e) { console.error(e); }
            STATE.worker = null;
            console.warn('[visual-effects] worker unavailable:', err && err.message ? err.message : err);
        };
        STATE.worker = w;
    } catch (err) {
        STATE.workerFailed = true;
        console.warn('[visual-effects] worker spawn failed:', err && err.message ? err.message : err);
    }
    return !!STATE.worker;
}

function request2DBackdropFrame(snapshot) {
    if (!ensureVisualEffectWorker()) return;
    const now = performance.now();
    if (STATE.workerBusy) {
        const busyFor = now - (STATE.workerLastRequestAt || now);
        if (busyFor < 260) return;
        // If an expensive backdrop style wedged the worker, recycle it instead
        // of letting the 2D layer visually freeze on a stale frame.
        if (busyFor > 850 && STATE.worker) {
            try { STATE.worker.terminate(); } catch (e) { console.warn('[visual-effects] worker terminate failed:', e); }
            STATE.worker = null;
            STATE.workerBusy = false;
            STATE.workerFailed = false;
            if (!ensureVisualEffectWorker()) return;
        } else {
            return;
        }
    }
    const minInterval = backdropWorkerIntervalMs(window.S || {});
    if (now - (STATE.workerLastRequestAt || 0) < minInterval) return;
    STATE.workerBusy = true;
    STATE.workerLastRequestAt = now;
    const id = ++STATE.workerSeq;
    const bands = new Float32Array(snapshot.bands || STATE.bands);
    try {
        STATE.worker.postMessage({ ...snapshot, id, type: 'render', bands }, [bands.buffer]);
    } catch (err) {
        STATE.workerBusy = false;
        console.warn('[visual-effects] worker post failed:', err && err.message ? err.message : err);
    }
}


function hide2DBackdropGeometry() {
    const gpu = STATE.gpu2d;
    if (!gpu) return;
    if (gpu.group) {
        gpu.group.visible = false;
        gpu.group.rotation.z = 0;
        gpu.group.position.set(0, 0, 0);
        gpu.group.scale.setScalar(1);
    }
    if (gpu.mesh) gpu.mesh.visible = false;
    if (gpu.geometry) gpu.geometry.setDrawRange(0, 0);
    if (gpu.fillMesh) gpu.fillMesh.visible = false;
    if (gpu.fillGeometry) gpu.fillGeometry.setDrawRange(0, 0);
    if (Array.isArray(gpu.blurMeshes)) gpu.blurMeshes.forEach((m) => { if (m) m.visible = false; });
    if (Array.isArray(gpu.blurFillMeshes)) gpu.blurFillMeshes.forEach((m) => { if (m) m.visible = false; });
    gpu.segments = 0;
    gpu.fillTriangles = 0;
    gpu.last2DProjectionKey = '';
}

function apply2DBackdropFrame(amount = 1) {
    if (!ensureGpu2DBackdrop()) return;
    const gpu = STATE.gpu2d;
    const frame = STATE.workerFrame;
    const S = window.S || {};
    const fade2D = clamp(Number(S.visualEffect2DFade ?? 0.01), 0, 1);
    if (S.visualEffects === false || S.visualEffectBackdrop === false || S.visualEffect2DBackdrop === false || fade2D <= 0.001 || !frame || !frame.positions || !frame.colors) {
        hide2DBackdropGeometry();
        return;
    }
    const frameAgeMs = Math.max(0, performance.now() - (Number(frame.arrivedAt) || performance.now()));
    if (gpu.group) gpu.group.visible = true;

    const engine = window.engine;
    const cam = engine && engine.camera;
    const dist = Math.max(40, Math.min(360, Number(S.visualEffectBackdropDistance) || 150));
    const fov = cam && Number.isFinite(cam.fov) ? cam.fov : 60;
    const aspect = cam && Number.isFinite(cam.aspect) ? cam.aspect : (window.innerWidth / Math.max(1, window.innerHeight));
    const halfH = Math.tan(fov * Math.PI / 360) * dist;
    const halfW = halfH * aspect;
    const z = -dist;
    const segs = Math.max(0, Math.min(gpu.maxSegments, frame.segments | 0));
    const srcP = frame.positions;
    const srcC = frame.colors;
    const tris = Math.max(0, Math.min(gpu.maxFillTriangles || 0, frame.triangles | 0));
    gpu.backdropHalfW = halfW;
    gpu.backdropHalfH = halfH;
    const projectionKey = [frame.id, segs, tris, Math.round(halfW * 100), Math.round(halfH * 100), Math.round(z * 100)].join(':');
    if (gpu.last2DProjectionKey === projectionKey) {
        const blurScale = 1 + clamp(amount, 0, 2) * 0.0025;
        const blurX = halfW * 0.0088;
        const blurY = halfH * 0.0088;
        if (Array.isArray(gpu.blurMeshes) && Array.isArray(gpu.blurOffsets)) {
            gpu.blurMeshes.forEach((m, i) => {
                if (!m) return;
                const off = gpu.blurOffsets[i] || [0, 0];
                m.position.set(off[0] * blurX, off[1] * blurY, 0);
                m.scale.setScalar(blurScale + i * 0.0010);
                m.visible = segs > 0;
            });
        }
        if (Array.isArray(gpu.blurFillMeshes) && Array.isArray(gpu.blurOffsets)) {
            gpu.blurFillMeshes.forEach((m, i) => {
                if (!m) return;
                const off = gpu.blurOffsets[i] || [0, 0];
                m.position.set(off[0] * blurX * 1.08, off[1] * blurY * 1.08, 0);
                m.scale.setScalar(blurScale + 0.0022 + i * 0.0011);
                m.visible = tris > 0;
            });
        }
        update2DBackdropOpacity(gpu, amount, S, fade2D);
        apply2DBackdropObjectMotion(gpu, amount, S, frameAgeMs);
        return;
    }
    gpu.last2DProjectionKey = projectionKey;
    for (let i = 0; i < segs; i++) {
        const si = i * 4;
        const vi = i * 6;
        gpu.positions[vi + 0] = srcP[si + 0] * halfW;
        gpu.positions[vi + 1] = srcP[si + 1] * halfH;
        gpu.positions[vi + 2] = z;
        gpu.positions[vi + 3] = srcP[si + 2] * halfW;
        gpu.positions[vi + 4] = srcP[si + 3] * halfH;
        gpu.positions[vi + 5] = z;
        gpu.colors[vi + 0] = srcC[vi + 0] || 0;
        gpu.colors[vi + 1] = srcC[vi + 1] || 0;
        gpu.colors[vi + 2] = srcC[vi + 2] || 0;
        gpu.colors[vi + 3] = srcC[vi + 3] || 0;
        gpu.colors[vi + 4] = srcC[vi + 4] || 0;
        gpu.colors[vi + 5] = srcC[vi + 5] || 0;
    }
    const pAttr = gpu.geometry.getAttribute('position');
    const cAttr = gpu.geometry.getAttribute('color');
    if (pAttr) pAttr.needsUpdate = true;
    if (cAttr) cAttr.needsUpdate = true;
    gpu.geometry.setDrawRange(0, segs * 2);
    gpu.mesh.visible = segs > 0;
    if (Array.isArray(gpu.blurMeshes)) gpu.blurMeshes.forEach((m) => { if (m) m.visible = segs > 0; });
    gpu.segments = segs;

    const srcFP = frame.fillPositions;
    const srcFC = frame.fillColors;
    if (gpu.fillMesh && gpu.fillGeometry && srcFP && srcFC && tris > 0) {
        for (let i = 0; i < tris; i++) {
            const si = i * 6;
            const vi = i * 9;
            gpu.fillPositions[vi + 0] = srcFP[si + 0] * halfW;
            gpu.fillPositions[vi + 1] = srcFP[si + 1] * halfH;
            gpu.fillPositions[vi + 2] = z - 0.06;
            gpu.fillPositions[vi + 3] = srcFP[si + 2] * halfW;
            gpu.fillPositions[vi + 4] = srcFP[si + 3] * halfH;
            gpu.fillPositions[vi + 5] = z - 0.06;
            gpu.fillPositions[vi + 6] = srcFP[si + 4] * halfW;
            gpu.fillPositions[vi + 7] = srcFP[si + 5] * halfH;
            gpu.fillPositions[vi + 8] = z - 0.06;
            gpu.fillColors[vi + 0] = srcFC[vi + 0] || 0;
            gpu.fillColors[vi + 1] = srcFC[vi + 1] || 0;
            gpu.fillColors[vi + 2] = srcFC[vi + 2] || 0;
            gpu.fillColors[vi + 3] = srcFC[vi + 3] || 0;
            gpu.fillColors[vi + 4] = srcFC[vi + 4] || 0;
            gpu.fillColors[vi + 5] = srcFC[vi + 5] || 0;
            gpu.fillColors[vi + 6] = srcFC[vi + 6] || 0;
            gpu.fillColors[vi + 7] = srcFC[vi + 7] || 0;
            gpu.fillColors[vi + 8] = srcFC[vi + 8] || 0;
        }
        const fpAttr = gpu.fillGeometry.getAttribute('position');
        const fcAttr = gpu.fillGeometry.getAttribute('color');
        if (fpAttr) fpAttr.needsUpdate = true;
        if (fcAttr) fcAttr.needsUpdate = true;
        gpu.fillGeometry.setDrawRange(0, tris * 3);
        gpu.fillMesh.visible = true;
        if (Array.isArray(gpu.blurFillMeshes)) gpu.blurFillMeshes.forEach((m) => { if (m) m.visible = true; });
        gpu.fillTriangles = tris;
    } else if (gpu.fillMesh && gpu.fillGeometry) {
        gpu.fillMesh.visible = false;
        if (Array.isArray(gpu.blurFillMeshes)) gpu.blurFillMeshes.forEach((m) => { if (m) m.visible = false; });
        gpu.fillGeometry.setDrawRange(0, 0);
        gpu.fillTriangles = 0;
    }

    const blurScale = 1 + clamp(amount, 0, 2) * 0.0025;
    const blurX = halfW * 0.0088;
    const blurY = halfH * 0.0088;
    if (Array.isArray(gpu.blurMeshes) && Array.isArray(gpu.blurOffsets)) {
        gpu.blurMeshes.forEach((m, i) => {
            if (!m) return;
            const off = gpu.blurOffsets[i] || [0, 0];
            m.position.set(off[0] * blurX, off[1] * blurY, 0);
            m.scale.setScalar(blurScale + i * 0.0010);
        });
    }
    if (Array.isArray(gpu.blurFillMeshes) && Array.isArray(gpu.blurOffsets)) {
        gpu.blurFillMeshes.forEach((m, i) => {
            if (!m) return;
            const off = gpu.blurOffsets[i] || [0, 0];
            m.position.set(off[0] * blurX * 1.08, off[1] * blurY * 1.08, 0);
            m.scale.setScalar(blurScale + 0.0022 + i * 0.0011);
        });
    }

    update2DBackdropOpacity(gpu, amount, S, fade2D);
    apply2DBackdropObjectMotion(gpu, amount, S, frameAgeMs);
}


function audioSurfaceAccentFactor(style, beat, t) {
    const s = String(style || '');
    const hash = hash01(s.length * 19.19 + 4.7);
    // Keep 3D surface fills as occasional accents, not a constant second/third
    // visualizer fighting the 2D backdrop and particle field.
    const periodA = 7.5 + hash * 7.5;
    const periodB = 11.0 + hash01(hash * 91.3 + 0.17) * 8.0;
    const dutyA = dutyPulse(t, hash, 0.28, periodA);
    const dutyB = dutyPulse(t + 1.7, hash01(hash * 53.1 + 3.3), 0.18, periodB) * 0.46;
    const duty = Math.max(dutyA, dutyB);
    const beatKick = duty > 0.02 ? clamp((beat - 0.45) * 1.10, 0, 0.34) : 0;
    const surfaceStyles = new Set(['spectral', 'kaleido', 'cymatics', 'aurora', 'tunnel', 'hyperspace', 'ribbons', 'trails', 'entropy']);
    const gridStyles = new Set(['spectrum', 'vectorscope', 'moire', 'lattice', 'cellular', 'matrixrain']);
    let weight = 0.26;
    if (surfaceStyles.has(s) || s === 'adaptive' || s === 'random') weight = 0.76;
    else if (gridStyles.has(s)) weight = 0.42;
    const ribbonBase = (s === 'ribbons' || s === 'trails' || s === 'hyperspace') ? 0.18 : 0.0;
    return clamp(ribbonBase + (duty * weight) + beatKick * (0.58 + weight * 0.36), 0, 0.94);
}

function shouldDraw3DAudioSurface(style, beat, t) {
    return audioSurfaceAccentFactor(style, beat, t) > 0.16;
}

function drawGpuFrame() {
    STATE.frame++;
    requestAnimationFrame(drawGpuFrame);
    const S = window.S || {};
    if (!ensureGpuVisualEffects()) return;
    const gpu = STATE.gpu;
    const mesh = gpu.mesh;
    if (S.visualEffects === false) {
        mesh.visible = false;
        gpu.geometry.setDrawRange(0, 0);
        if (gpu.surfaceMesh) {
            gpu.surfaceMesh.visible = false;
            gpu.surfaceGeometry.setDrawRange(0, 0);
        }
        hide2DBackdropGeometry();
        return;
    }
    const skip = perfSkip();
    if (skip > 1 && (STATE.frame % skip) !== 0) return;

    const frameStarted = performance.now();
    sampleAudioBands();
    const t = performance.now() * 0.001;
    const eff = window.S_effective || S;
    const feat = window.SS_AUDIO_FEATURES || {};
    const z = zoomState();
    const drive = readParamDrive(eff);
    window.SS_VISUAL_PARAM_DRIVE = drive;
    STATE.detail = computeDetailScale(S, z);
    const rms = clamp(feat.rms || 0, 0, 1);
    const beat = clamp(feat.beat || 0, 0, 1);
    STATE.smoothed = lerp(STATE.smoothed, rms, 0.08);
    STATE.beat = lerp(STATE.beat, beat, beat > STATE.beat ? 0.45 : 0.08);
    updateSpectrumState(feat);

    const expressivity = clamp(S.visualEffectExpressivity ?? 1.35, 0.35, 2.5);
    const dynamics = clamp(S.visualEffectDynamics ?? 1.15, 0.25, 2.5);
    const response = 0.78 + expressivity * 0.22 + STATE.smoothed * (0.20 + expressivity * 0.20) + STATE.beat * (0.14 + expressivity * 0.17)
        + STATE.bass * (0.05 + dynamics * 0.07) + STATE.treble * (0.03 + dynamics * 0.05)
        + drive.temperature * 0.055 * dynamics + drive.scaleDepth * 0.035 * expressivity + drive.particleLoad * 0.010;
    const pressure = clamp(z.overdrawPressure || 0, 0, 1);
    const active2D = S.visualEffectBackdrop !== false && S.visualEffect2DBackdrop !== false;
    const active3D = S.visualEffectPost !== false;
    const layerBudget = active2D && active3D ? 0.86 : 1.0;
    const amount = clamp((S.visualEffectAmount ?? 0.75) * (0.72 + (z.effectScale || 1) * 0.28) * response * (1 - pressure * 0.24) * layerBudget, 0, 2.65);
    STATE.phase += 0.0015 + finite(eff.tempo, 1) * 0.0007 + STATE.smoothed * 0.004 * (0.75 + expressivity * 0.30)
        + STATE.beat * 0.010 * (0.75 + expressivity * 0.25) + (STATE.mid - STATE.bass) * 0.0025 * dynamics
        + drive.equilibrium * 0.0015 * dynamics + drive.temperature * 0.0008 * expressivity;

    const hue = (((finite(eff.hue, 0.59) + STATE.phase + clamp(feat.colorPhase || 0, 0, 4) * 0.025 + (STATE.treble - STATE.bass) * 0.055 * dynamics + drive.scaleDepth * 0.018) % 1) + 1) % 1;
    const sat = clamp(finite(eff.sat, 1) * (1 + drive.temperature * 0.08), 0.1, 2.0);
    const light = clamp(finite(eff.lightness, 0.9) * (0.50 + expressivity * 0.055 + STATE.beat * 0.035 + STATE.treble * 0.032 * dynamics + drive.coherence * 0.018), 0.24, 0.86);
    const radius = clamp(finite(eff.inversion, 80) * (0.52 + STATE.smoothed * 0.10 + STATE.beat * 0.025 + drive.particleLoad * 0.006), 12, 320);
    const chosen = resolveVisualStyle(S, hue, t);
    const previousStyle = STATE.previousStyle;
    const styleBlend = visualStyleBlend(t);
    window.SS_VISUAL_EFFECT_STYLE = previousStyle && styleBlend < 0.5 ? previousStyle : chosen;

    if (active2D) {
        const backdropDetail = backdropDetailScale(S);
        const max2d = Math.max(420, Math.min(8400, Math.floor(8400 * STATE.detail * backdropDetail * backdropDetail * (1 - pressure * 0.30) * (active3D ? 0.88 : 1))));
        request2DBackdropFrame({
            style: chosen,
            backdropStyle: String(S.visualEffect2DBackdropStyle || 'classic'),
            maxSegments: max2d,
            amount,
            mix: Number(S.visualEffect2DBackdropMix ?? 1.0) || 1.0,
            t,
            aspect: window.engine && window.engine.camera && Number.isFinite(window.engine.camera.aspect) ? window.engine.camera.aspect : (window.innerWidth / Math.max(1, window.innerHeight)),
            hue,
            sat,
            light,
            bands: STATE.bands,
            feat: {
                rms: feat.rms || 0, beat: feat.beat || 0, bass: feat.bass || 0, mid: feat.mid || 0, treble: feat.treble || 0,
                fxLevel: feat.fxLevel || 0, blowout: feat.blowout || 0, colorPhase: feat.colorPhase || 0
            },
            drive
        });
        apply2DBackdropFrame(amount);
    } else if (STATE.gpu2d && STATE.gpu2d.mesh) {
        hide2DBackdropGeometry();
    }

    const fade3D = clamp(Number(S.visualEffect3DFade ?? 0.5), 0, 1);
    const radius3D = radius * 2.0;
    const maxSeg = Math.max(128, Math.min(gpu.maxSegments, Math.floor(gpu.maxSegments * STATE.detail * (1 - pressure * 0.40) * (0.28 + fade3D * 0.82) * (active2D ? 0.84 : 1))));
    let seg = 0;
    if (S.visualEffectPost !== false && fade3D > 0.001) {
        if (previousStyle && previousStyle !== chosen && styleBlend < 0.995) {
            seg += drawGpuVisualStyle(gpu, previousStyle, radius3D * (0.92 + (1 - styleBlend) * 0.05), hue - 0.08, sat, light * (1 - styleBlend * 0.16), amount * (1 - styleBlend * 0.24), t - 0.4, STATE.bands, feat, drive, Math.floor(maxSeg * 0.42));
            const used = seg;
            const oldWrite = writeGpuSegment;
            seg += drawGpuVisualStyle({ ...gpu, positions: gpu.positions.subarray(used * 6), colors: gpu.colors.subarray(used * 6), maxSegments: gpu.maxSegments - used }, chosen, radius3D, hue, sat, light, amount, t, STATE.bands, feat, drive, maxSeg - used);
        } else {
            seg = drawGpuVisualStyle(gpu, chosen, radius3D, hue, sat, light, amount, t, STATE.bands, feat, drive, maxSeg);
        }
    }

    let surfaceTri = 0;
    const rawSurfaceAccent = active3D && fade3D > 0.001 ? audioSurfaceAccentFactor(chosen, STATE.beat, t) * fade3D : 0;
    const surfaceTarget = active2D ? rawSurfaceAccent * 0.84 : rawSurfaceAccent;
    STATE.surfaceGate = lerp(STATE.surfaceGate || 0, surfaceTarget, surfaceTarget > (STATE.surfaceGate || 0) ? 0.12 : 0.16);
    const surfaceAccent = STATE.surfaceGate;
    if (active3D && fade3D > 0.001 && surfaceAccent > 0.10) {
        const maxTri = Math.max(64, Math.min(gpu.maxTriangles || 0, Math.floor((gpu.maxTriangles || 0) * STATE.detail * (1 - pressure * 0.40) * (0.34 + surfaceAccent * 0.42) * (active2D ? 0.78 : 1.0))));
        surfaceTri = drawGpuAudioSurface(gpu, chosen, radius3D * (0.68 + amount * 0.028), hue + 0.10, sat, light * 0.96, amount * (0.52 + surfaceAccent * 0.30), t, STATE.bands, feat, drive, maxTri);
    }

    const sAttrPos = gpu.surfaceGeometry && gpu.surfaceGeometry.getAttribute('position');
    const sAttrCol = gpu.surfaceGeometry && gpu.surfaceGeometry.getAttribute('color');
    if (sAttrPos) sAttrPos.needsUpdate = true;
    if (sAttrCol) sAttrCol.needsUpdate = true;
    if (gpu.surfaceGeometry) gpu.surfaceGeometry.setDrawRange(0, surfaceTri * 3);
    gpu.surfaceTriangles = surfaceTri;
    if (gpu.surfaceMesh) {
        gpu.surfaceMesh.visible = surfaceTri > 0;
        if (gpu.surfaceMesh.material) gpu.surfaceMesh.material.opacity = surfaceTri > 0 ? clamp((0.026 + amount * 0.036 + STATE.beat * 0.018) * surfaceAccent, 0.0, 0.145) : 0;
    }

    const attrPos = gpu.geometry.getAttribute('position');
    const attrCol = gpu.geometry.getAttribute('color');
    if (attrPos) attrPos.needsUpdate = true;
    if (attrCol) attrCol.needsUpdate = true;
    gpu.geometry.setDrawRange(0, seg * 2);
    gpu.segments = seg;
    mesh.visible = seg > 0;
    if (mesh.material) {
        mesh.material.opacity = clamp((0.050 + amount * 0.052 + STATE.beat * 0.022) * Math.pow(fade3D, 0.82) * (active2D ? 0.90 : 1), 0.0, 0.32);
    }
    const off = window.S_effective || S;
    mesh.position.set(Number(off.offsetX) || 0, Number(off.offsetY) || 0, Number(off.offsetZ) || 0);
    if (gpu.surfaceMesh) gpu.surfaceMesh.position.copy(mesh.position);

    const budget = Math.max(1, Math.min(24, Number(S.visualEffectMaxFrameMs) || 4.5));
    const cost = performance.now() - frameStarted;
    STATE.lastCostMs = cost;
    if (cost > budget && STATE.adaptiveSkip < 6) STATE.adaptiveSkip++;
    else if (cost < budget * 0.45 && STATE.adaptiveSkip > 0 && (STATE.frame % 40) === 0) STATE.adaptiveSkip--;
}

export function initVisualEffects() {
    if (STATE.gpuStarted) return STATE;
    STATE.gpuStarted = true;
    requestAnimationFrame(drawGpuFrame);
    window.visualEffects = STATE;
    return STATE;
}

import * as THREE from 'three/webgpu';
import {
    pass, color, mix, positionLocal, attribute,
    float, vec3, vec4, instanceIndex, uniform,
    dot, length, normalize, sub, add, mul, sin, cos, fract, floor,
    compute, storage, Fn, time, max, min, div, step,
    atomicAdd, atomicStore, uint, int, If, bitAnd, Loop, select, clamp, abs,
    sqrt, pow, log2,
    modelViewMatrix, cameraProjectionMatrix, vertexIndex, cross
} from 'three/tsl';
import { curlNoise, spectralColor, specCore } from './engine-nodes.js';
import { createParticleInitWorker, generateParticleBuffersSync, particleSeed } from './particle-init.js';
import {
    clampActiveParticleCount, getPerformanceSettings, resolveLatticeParticleCount,
    resolveMaxPerCell, resolveParticleCapacity, resolveRibbonParticleCount
} from './performance.js';
import { resolveRuntimeVisualStyle, visualStyleHasGeometry } from './visual-style-registry.js';

const DEFAULT_ORBIT_DIST = 100;
const DEFAULT_ORBIT_OFFSET = new THREE.Vector3(-11, 32, -16);
const ORBIT_ROTATE_SPEED = 0.006;
const ORBIT_KEY_SPEED = 0.024;
const TAU = Math.PI * 2;
const STATE_SWIM_SEED = 1.61803398875;

function wrapOrbitAngle(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return ((((n + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

function orbitAnglesFromOffset(offset) {
    const x = Number(offset?.x) || 0;
    const y = Number(offset?.y) || 0;
    const z = Number(offset?.z) || 0;
    const r = Math.max(1e-6, Math.sqrt(x * x + y * y + z * z));
    return {
        yaw: Math.atan2(x, z),
        pitch: wrapOrbitAngle(Math.asin(Math.max(-1, Math.min(1, y / r))))
    };
}

function orbitOffsetFromAngles(yaw, pitch, dist) {
    const d = Math.max(1, Number(dist) || DEFAULT_ORBIT_DIST);
    const y = wrapOrbitAngle(yaw);
    const p = wrapOrbitAngle(pitch);
    const cp = Math.cos(p);
    return new THREE.Vector3(
        Math.sin(y) * cp * d,
        Math.sin(p) * d,
        Math.cos(y) * cp * d
    );
}

function orbitUpFromAngles(yaw, pitch) {
    const y = wrapOrbitAngle(yaw);
    const p = wrapOrbitAngle(pitch);
    return new THREE.Vector3(
        -Math.sin(y) * Math.sin(p),
        Math.cos(p),
        -Math.cos(y) * Math.sin(p)
    ).normalize();
}

function resolveConcreteVisualStyle(configStyle, runtimeStyle) {
    const style = resolveRuntimeVisualStyle(configStyle, runtimeStyle);
    return (style === 'random' || style === 'adaptive') ? '' : style;
}


// ────────────────────────────────────────────────────────────────────────────
//   4. Engine
// ────────────────────────────────────────────────────────────────────────────

export class Engine {
    constructor(canvas, bgCanvas) {
        this.canvas = canvas;
        this.bgCanvas = bgCanvas;
        this.MAX_PARTICLES = resolveParticleCapacity(window.S?.gpuParticleCapacity);
        this.particleCount = this.MAX_PARTICLES;
        this.particleInit = createParticleInitWorker();
        this._particleInitToken = 0;
        this._perfFrame = 0;
        this._lastPerfPixelRatio = 0;
        this._gpuResetReady = false;
        this._lastGpuResetAt = 0;
        this._compatCpuWarmfillRequested = false;

        this.setupRenderer();
        this.setupScene();
        this.setupCamera();
        this.setupBuffers();
        this.setupCompute();
        this.setupMaterial();
        this.setupMesh();
        this.setupGpuPointCloud();
        this.setupRibbon();
        this.setupLattice();
        this.setupNavigationArrow();
    }

    isGpuPointsMode() {
        const S = window.S || {};
        return S.shape === 'point';
    }

    isCompatParticleFallbackActive() {
        return window.S?.compatParticleFallback === true;
    }

    isPointsFallbackActive() {
        return this.isCompatParticleFallbackActive();
    }

    isPointDrawActive() {
        return (this.isGpuPointsMode() && !!this.gpuPointCloud) || this.isCompatParticleFallbackActive();
    }

    updatePointDrawState() {
        const S = window.S || {};
        const gpuActive = this.isGpuPointsMode() && !!this.gpuPointCloud;
        const compatActive = this.isCompatParticleFallbackActive();
        if (S.perfParticleDrawMode !== (gpuActive ? 'points' : 'native')) S.perfParticleDrawMode = gpuActive ? 'points' : 'native';
        const state = {
            active: gpuActive || compatActive,
            gpuActive,
            compatActive,
            autoActive: false,
            manualActive: compatActive,
            mode: gpuActive ? 'points' : 'native',
            reason: gpuActive ? 'manual points' : (compatActive ? 'compat fallback' : 'native')
        };
        window.SS_POINTS_FALLBACK = state;
        return state.active;
    }

    ensureCompatParticleCloud() {
        if (this.compatParticleCloud) return true;
        this.setupCompatParticleCloud();
        return !!this.compatParticleCloud;
    }

    ensureCompatStructureLayers() {
        if (this.compatRibbonLayer && this.compatCurveLayer && this.compatCellLayer) return true;
        this.setupCompatStructureLayers();
        return !!(this.compatRibbonLayer && this.compatCurveLayer && this.compatCellLayer);
    }

    _ensureCompatCpuWarmfill() {
        if (this._compatCpuWarmfillRequested || !this.reinitializeParticles) return;
        this._compatCpuWarmfillRequested = true;
        this.reinitializeParticles({ preferGpu: false })
            .catch(e => console.warn('[points fallback] CPU particle warm fill failed:', e && e.message ? e.message : e));
    }

    updatePerformanceParticleScale() {
        const S = window.S || {};
        const enabled = S.perfParticleScaling === true;
        const safety = this.getAdaptiveCullingSafetyState();
        const baseMinScale = Math.max(0.25, Math.min(1, Number(S.perfParticleScaleMin) || 0.45));
        const safetyMinScale = [baseMinScale, 0.42, 0.34, 0.28][Math.max(0, Math.min(3, safety.level | 0))] ?? baseMinScale;
        const minScale = Math.min(baseMinScale, safetyMinScale);
        const requested = this.getTargetParticleCount();
        const publishInfo = (info) => {
            const active = this.getActiveParticleCount();
            const zoomState = window.SS_ZOOM_OPT || null;
            const displayActive = this.getZoomDisplayParticleCount(active, zoomState);
            const out = {
                ...info,
                active,
                displayActive,
                requested,
                zoom: zoomState,
                trailBudget: window.SS_TRAIL_BUDGET || null,
                overdrawVisualBudget: window.SS_OVERDRAW_VISUAL_BUDGET || null,
                pointsFallback: window.SS_POINTS_FALLBACK || null
            };
            window.SS_PARTICLE_SCALE = out;
            if (typeof window.updateAdaptiveParticleCountReadout === 'function') window.updateAdaptiveParticleCountReadout(out);
            return out;
        };

        if (!enabled) {
            this._perfParticleScale = 1;
            this._frameParticleCountCache = null;
            this._adaptiveCountLevel = 0;
            this._adaptiveCountNextChangeAt = 0;
            publishInfo({
                enabled: false,
                scale: 1,
                target: 1,
                minScale: baseMinScale,
                safety,
                level: 0,
                targetLevel: 0,
            });
            return this._perfParticleScale;
        }

        const fpsInfo = window.SS_FPS || {};
        const rawFps = Number(fpsInfo.fps);
        const rawEntropy = Number.isFinite(Number(fpsInfo.entropy))
            ? Math.max(0, Math.min(100, Number(fpsInfo.entropy)))
            : (Number.isFinite(rawFps) ? Math.max(0, Math.min(100, (60 - rawFps) / 59 * 100)) : 0);

        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        if (!Number.isFinite(this._adaptiveFpsSmoothed)) this._adaptiveFpsSmoothed = Number.isFinite(rawFps) ? rawFps : 60;
        if (!Number.isFinite(this._adaptiveEntropySmoothed)) this._adaptiveEntropySmoothed = rawEntropy;
        if (Number.isFinite(rawFps)) {
            const kFps = rawFps < this._adaptiveFpsSmoothed ? 0.20 : 0.070;
            this._adaptiveFpsSmoothed += (rawFps - this._adaptiveFpsSmoothed) * kFps;
        }
        const kEntropy = rawEntropy > this._adaptiveEntropySmoothed ? 0.16 : 0.060;
        this._adaptiveEntropySmoothed += (rawEntropy - this._adaptiveEntropySmoothed) * kEntropy;

        const fps = this._adaptiveFpsSmoothed;
        const entropy = Math.max(0, Math.min(100, this._adaptiveEntropySmoothed));
        const z = this.getZoomOptimizationState();
        const screenHot = Math.max(0, Math.min(1, Number(z.screenPressure) || 0));
        const zoomHot = Math.max(0, Math.min(1, Number(z.overdrawPressure) || 0));
        const safetyLevel = Math.max(0, Math.min(3, safety.level | 0));
        const emergency = Number.isFinite(fps) && fps < 22;
        let pressure = 0;
        let targetLevel = 0;

        // Adaptive count targets the full requested count. It only steps below
        // 100% after the slow safety controller confirms sustained bad FPS,
        // or during an immediate emergency. Overdraw/zoom no longer causes a
        // permanent sub-full adaptive count by itself.
        if (emergency) {
            pressure = Math.max(0.92, Math.min(1, (26 - fps) / 14));
            targetLevel = 4;
        } else if (safetyLevel > 0) {
            pressure = Math.max(
                0.34 + safetyLevel * 0.17,
                Math.max(0, (entropy - 48) / 40),
                screenHot * 0.14,
                zoomHot * 0.10
            );
            targetLevel = Math.min(5, safetyLevel + 1);
        }

        const nowGood = (Number.isFinite(fps) ? fps >= 53 : entropy < 28) && entropy < 34;
        if (nowGood && safetyLevel <= 0) {
            targetLevel = 0;
            pressure = 0;
        }

        let level = Number.isFinite(this._adaptiveCountLevel) ? this._adaptiveCountLevel : 0;
        const nextAt = Number.isFinite(this._adaptiveCountNextChangeAt) ? this._adaptiveCountNextChangeAt : 0;
        if (targetLevel > level && (now >= nextAt || emergency)) {
            level = Math.min(targetLevel, level + (emergency && targetLevel - level >= 2 ? 2 : 1));
            this._adaptiveCountNextChangeAt = now + (emergency ? 700 : 1500);
        } else if (targetLevel < level && (now >= nextAt || (nowGood && safetyLevel <= 0))) {
            level = Math.max(targetLevel, level - 1);
            this._adaptiveCountNextChangeAt = now + (targetLevel === 0 ? 900 : 2200);
        }
        this._adaptiveCountLevel = level;

        const scaleLevels = [
            1.00,
            Math.max(minScale, 0.92),
            Math.max(minScale, 0.84),
            Math.max(minScale, 0.74),
            Math.max(minScale, 0.64),
            minScale
        ];
        const target = scaleLevels[level] ?? minScale;
        this._perfParticleScale = target;
        this._frameParticleCountCache = null;

        publishInfo({
            enabled: true,
            scale: this._perfParticleScale,
            target,
            minScale,
            baseMinScale,
            safety,
            entropy,
            fps: Number.isFinite(fps) ? fps : null,
            pressure,
            screenPressure: screenHot,
            zoomPressure: zoomHot,
            level,
            targetLevel,
            source: fpsInfo.source || 'worker',
        });
        return this._perfParticleScale;
    }

    getPerformanceParticleScale() {
        if (window.S?.perfParticleScaling !== true) return 1;
        const n = Number(this._perfParticleScale);
        return Number.isFinite(n) ? Math.max(0.25, Math.min(1, n)) : 1;
    }

    getActiveParticleCount(value = window.S?.freeEnergy) {
        const target = clampActiveParticleCount(value, this.particleCount);
        if (target <= 0) return 0;
        const scale = this.getPerformanceParticleScale();
        const active = Math.max(1, Math.min(target, Math.floor(target * scale)));
        if (window.S?.perfParticleScaling !== true || scale >= 0.999) return active;
        const chunk = Math.max(1, Math.min(65536, Math.round(Number(window.S?.perfParticleCountChunk) || 2048)));
        const rounded = Math.floor(active / chunk) * chunk;
        return Math.max(1, Math.min(target, rounded || Math.min(target, chunk)));
    }

    getTargetParticleCount(value = window.S?.freeEnergy) {
        return clampActiveParticleCount(value, this.particleCount);
    }

    getFrameParticleCounts(value = window.S?.freeEnergy, zoomState = null) {
        const frame = Number(this._perfFrame) || 0;
        const parsedValue = Number(value);
        const keyValue = Number.isFinite(parsedValue) ? parsedValue : -1;
        const scale = this.getPerformanceParticleScale ? this.getPerformanceParticleScale() : 1;
        const cache = this._frameParticleCountCache;
        if (cache && cache.frame === frame && cache.value === keyValue && cache.scale === scale && (!zoomState || cache.zoom === zoomState)) return cache;
        const active = this.getActiveParticleCount(value);
        const zoom = zoomState || window.SS_ZOOM_OPT || this.getZoomOptimizationState();
        const display = this.getZoomDisplayParticleCount(active, zoom);
        const out = { frame, value: keyValue, scale, zoom, active, display };
        this._frameParticleCountCache = out;
        return out;
    }

    getFrameActiveParticleCount(value = window.S?.freeEnergy, zoomState = null) {
        return this.getFrameParticleCounts(value, zoomState).active;
    }

    getFrameDisplayParticleCount(value = window.S?.freeEnergy, zoomState = null) {
        return this.getFrameParticleCounts(value, zoomState).display;
    }

    _smoothstep(edge0, edge1, x) {
        const span = Math.max(1e-6, edge1 - edge0);
        const t = Math.max(0, Math.min(1, (x - edge0) / span));
        return t * t * (3 - 2 * t);
    }

    getAdaptiveCullingSafetyState() {
        const S = window.S || {};
        const enabled = S.adaptiveCulling !== false;
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const cached = this._adaptiveCullingSafety;
        if (cached && (now - (cached.updatedAt || 0)) < 250) return cached;

        let level = cached && Number.isFinite(cached.level) ? cached.level : 0;
        if (!enabled) {
            level = 0;
            this._adaptiveCullingBadSince = 0;
            this._adaptiveCullingGoodSince = 0;
            this._adaptiveCullingDropScore = 0;
            this._adaptiveCullingDropScoreAt = now;
            this._adaptiveCullingNextChangeAt = now + 500;
            const state = { enabled: false, level: 0, fps: null, entropy: 0, rawFps: null, frameMs: null, dt: null, dropScore: 0, badForMs: 0, goodForMs: 0, updatedAt: now };
            this._adaptiveCullingSafety = state;
            window.SS_ADAPTIVE_CULLING = state;
            return state;
        }

        const fpsInfo = window.SS_FPS || {};
        const rawFps = Number(fpsInfo.fps);
        const rawEntropy = Number.isFinite(Number(fpsInfo.entropy)) ? Math.max(0, Math.min(100, Number(fpsInfo.entropy))) : 0;
        const rawFrameMs = Number(fpsInfo.frameMs);
        const rawDtMs = Number(fpsInfo.dt);
        if (!Number.isFinite(this._adaptiveCullingFpsSmoothed)) this._adaptiveCullingFpsSmoothed = Number.isFinite(rawFps) ? rawFps : 60;
        if (!Number.isFinite(this._adaptiveCullingEntropySmoothed)) this._adaptiveCullingEntropySmoothed = rawEntropy;
        if (Number.isFinite(rawFps)) {
            const kFps = rawFps < this._adaptiveCullingFpsSmoothed ? 0.22 : 0.050;
            this._adaptiveCullingFpsSmoothed += (rawFps - this._adaptiveCullingFpsSmoothed) * kFps;
        }
        const kEntropy = rawEntropy > this._adaptiveCullingEntropySmoothed ? 0.18 : 0.045;
        this._adaptiveCullingEntropySmoothed += (rawEntropy - this._adaptiveCullingEntropySmoothed) * kEntropy;

        const fps = this._adaptiveCullingFpsSmoothed;
        const entropy = Math.max(0, Math.min(100, this._adaptiveCullingEntropySmoothed));

        // Dropped frames usually show up as frame-time spikes before the
        // smoothed FPS drops below 30. Keep a small burst score so Auto Culling
        // can trim visible work/trail cadence quickly, then decay it back out.
        const spikeMs = Math.max(
            Number.isFinite(rawFrameMs) ? rawFrameMs : 0,
            Number.isFinite(rawDtMs) ? rawDtMs : 0
        );
        const lastSpikeAt = Number.isFinite(this._adaptiveCullingDropScoreAt) ? this._adaptiveCullingDropScoreAt : now;
        const decay = Math.pow(0.58, Math.max(0, now - lastSpikeAt) / 1000);
        let dropScore = Math.max(0, Math.min(12, (Number(this._adaptiveCullingDropScore) || 0) * decay));
        if (spikeMs > 24) dropScore += Math.min(5.5, (spikeMs - 24) / 12);
        if (Number.isFinite(rawFps) && rawFps < 48) dropScore += Math.min(2.8, (48 - rawFps) / 18);
        if (rawEntropy > 42) dropScore += Math.min(2.5, (rawEntropy - 42) / 28);
        dropScore = Math.max(0, Math.min(14, dropScore));
        this._adaptiveCullingDropScore = dropScore;
        this._adaptiveCullingDropScoreAt = now;

        const bad = (Number.isFinite(fps) && fps < 36) || entropy > 54 || dropScore > 2.4;
        const veryBad = (Number.isFinite(fps) && fps < 25) || entropy > 76 || dropScore > 6.2 || spikeMs > 58;
        const good = (Number.isFinite(fps) && fps > 53) && entropy < 30 && dropScore < 1.2;
        if (bad) {
            if (!this._adaptiveCullingBadSince) this._adaptiveCullingBadSince = now;
            this._adaptiveCullingGoodSince = 0;
        } else if (good) {
            if (!this._adaptiveCullingGoodSince) this._adaptiveCullingGoodSince = now;
            this._adaptiveCullingBadSince = 0;
        } else {
            this._adaptiveCullingBadSince = 0;
            this._adaptiveCullingGoodSince = 0;
        }
        const badForMs = this._adaptiveCullingBadSince ? now - this._adaptiveCullingBadSince : 0;
        const goodForMs = this._adaptiveCullingGoodSince ? now - this._adaptiveCullingGoodSince : 0;
        const nextAt = Number.isFinite(this._adaptiveCullingNextChangeAt) ? this._adaptiveCullingNextChangeAt : 0;
        if (bad && now >= nextAt) {
            const target =
                (veryBad && (badForMs > 650 || dropScore > 8.5)) ? 3 :
                (badForMs > 1800 || dropScore > 5.0) ? 2 :
                (badForMs > 420 || dropScore > 2.4) ? 1 : 0;
            if (target > level) {
                level = Math.min(target, level + 1);
                this._adaptiveCullingNextChangeAt = now + (veryBad ? 700 : 1050);
                this._forcePixelRatioApply = true;
            }
        } else if (good && goodForMs > 2600 && now >= nextAt && level > 0) {
            level = Math.max(0, level - 1);
            this._adaptiveCullingNextChangeAt = now + 2200;
            this._forcePixelRatioApply = true;
        }
        const state = { enabled: true, level, fps: Number.isFinite(fps) ? fps : null, entropy, rawFps: Number.isFinite(rawFps) ? rawFps : null, frameMs: Number.isFinite(rawFrameMs) ? rawFrameMs : null, dt: Number.isFinite(rawDtMs) ? rawDtMs : null, dropScore, badForMs, goodForMs, updatedAt: now };
        this._adaptiveCullingSafety = state;
        window.SS_ADAPTIVE_CULLING = state;
        return state;
    }

    getZoomOptimizationState() {
        const frame = Number(this._perfFrame) || 0;
        if (frame > 0 && this._zoomOptFrame === frame && this._zoomOptCache) return this._zoomOptCache;
        const S = window.S || {};
        const enabled = S.zoomRenderOptimize !== false;
        const dist = Number(this.cam && this.cam.dist);
        const camDist = Number.isFinite(dist) ? Math.max(0.001, dist) : DEFAULT_ORBIT_DIST;
        const near = Math.max(1, Number(S.zoomNearDistance) || 18);
        const far = Math.max(near + 1, Number(S.zoomFarDistance) || 75);
        const close = enabled ? (1 - this._smoothstep(near, far, camDist)) : 0;
        // Extra visible-instance trim once the camera is inside ~50 units. At
        // that range we only see a thin slice of the body, so drawing the full
        // requested count is wasted even when compute count still targets full.
        const closeUnder50 = enabled ? (1 - this._smoothstep(28, 50, camDist)) : 0;
        const activeMin = Math.max(0.05, Math.min(1, Number(S.zoomActiveScaleMin) || 0.33));
        const pixelMin = Math.max(0.35, Math.min(1, Number(S.zoomPixelRatioScaleMin) || 0.78));
        const effectMin = Math.max(0.2, Math.min(1, Number(S.zoomEffectScaleMin) || 0.52));
        const baseActiveScale = 1 - close * (1 - activeMin);
        const basePixelRatioScale = 1 - close * (1 - pixelMin);
        const baseEffectScale = 1 - close * (1 - effectMin);

        const safety = this.getAdaptiveCullingSafetyState();
        const cullingEnabled = S.adaptiveCulling !== false;
        const safetyLevel = Math.max(0, Math.min(3, safety.level | 0));
        const safetyActiveNow = cullingEnabled && safetyLevel > 0;
        const overdrawEnabled = enabled && safetyActiveNow;
        const targetCount = this.getTargetParticleCount ? this.getTargetParticleCount(S.freeEnergy) : (Number(S.freeEnergy) || 0);
        // Keep overdraw estimation tied to the requested scene, not the
        // current adaptive-trimmed count. Otherwise the two control loops
        // chase each other and FPS oscillates around dense scenes.
        const activeForLoad = targetCount;
        const pointSize = Math.max(0.02, Math.min(24, Number((window.S_effective || S).resolution ?? S.resolution ?? 0.1) || 0.1));
        const amount = Math.max(0, Math.min(3, Number(S.visualEffectAmount ?? 0.75) || 0.75));
        const dynamics = Math.max(0.25, Math.min(2.5, Number(S.visualEffectDynamics ?? 1.15) || 1.15));
        const layerLoad =
            (S.visualEffects !== false ? 0.16 : 0) +
            (S.visualEffectBackdrop !== false ? 0.15 : 0) +
            (S.visualEffectPost !== false ? 0.18 : 0) +
            (S.visualEffectGeometry === true ? 0.28 : 0) +
            (S.showRibbons ? 0.22 : 0) +
            (S.tessRibbons ? 0.26 : 0) +
            (Number(S.bgGlow) > 0.18 ? 0.08 : 0);
        const particleLoad = Math.max(0, Math.min(1, activeForLoad / 180000));
        const sizeLoad = Math.max(0, Math.min(1, (pointSize - 0.35) / 5.65));
        const fxLoad = Math.max(0, Math.min(1.35, layerLoad + amount * 0.12 + dynamics * 0.08 + particleLoad * 0.20 + sizeLoad * 0.22));
        const screenOverdraw = overdrawEnabled
            ? this.getScreenOverdrawState({ activeCount: activeForLoad, pointSize, layerLoad, amount, dynamics })
            : { area: 0, activeCount: activeForLoad, pointSize, fillEstimate: 0, targetLevel: 0, level: 0, pressure: 0, particleFill: 0, ribbonFill: 0, fxFill: 0, fullScreenFill: 0 };
        const screenPressure = overdrawEnabled ? Math.max(0, Math.min(1, screenOverdraw.pressure || 0)) : 0;
        const zoomPressure = overdrawEnabled ? Math.max(0, Math.min(1, close * (0.18 + fxLoad * 0.55))) : 0;
        const overdrawPressure = Math.max(zoomPressure, screenPressure);
        const overdrawActiveMin = Math.max(0.05, Math.min(activeMin, Number(S.zoomOverdrawActiveScaleMin) || 0.30));
        const overdrawPixelMin = Math.max(0.35, Math.min(pixelMin, Number(S.zoomOverdrawPixelRatioScaleMin) || 0.76));
        const overdrawEffectMin = Math.max(0.15, Math.min(effectMin, Number(S.zoomOverdrawEffectScaleMin) || 0.55));
        const lineMin = Math.max(0.02, Math.min(1, Number(S.zoomOverdrawLineScaleMin) || 0.14));
        const safetyActive = [1.00, 0.92, 0.84, 0.76][safetyLevel] || 1;
        const safetyPixel = [1.00, 0.96, 0.91, 0.86][safetyLevel] || 1;
        const safetyEffect = [1.00, 0.90, 0.80, 0.70][safetyLevel] || 1;
        const safetyLine = [1.00, 0.86, 0.72, 0.58][safetyLevel] || 1;
        // Adaptive Count should target the full requested compute count unless
        // FPS is genuinely bad, but close-view visible culling is still useful:
        // when the camera is zoomed into a sliver of the particle body, drawing
        // the full instance set is wasted. So activeScale always gets the
        // zoom-visible trim, while pixel/FX/line quality only tighten under the
        // slow sustained-FPS safety controller.
        const deepZoomActiveMin = Math.max(0.12, Math.min(activeMin, activeMin * 0.62));
        const visibleZoomScale = Math.max(deepZoomActiveMin, baseActiveScale * (1 - closeUnder50 * 0.42));
        const activeScale = safetyActiveNow
            ? Math.max(overdrawActiveMin, visibleZoomScale * (1 - zoomPressure * 0.22) * (1 - screenPressure * 0.30) * safetyActive)
            : visibleZoomScale;
        const pixelRatioScale = safetyActiveNow
            ? Math.max(overdrawPixelMin, basePixelRatioScale * (1 - zoomPressure * 0.10) * (1 - screenPressure * 0.12) * safetyPixel)
            : 1.0;
        const effectScale = safetyActiveNow
            ? Math.max(overdrawEffectMin, baseEffectScale * (1 - zoomPressure * 0.16) * (1 - screenPressure * 0.16) * safetyEffect)
            : 1.0;
        const lineScale = safetyActiveNow
            ? Math.max(lineMin, activeScale * (1 - close * 0.24) * (1 - overdrawPressure * 0.34) * safetyLine)
            : activeScale;
        const syncEveryMax = Math.max(1, Math.min(8, Math.round(Number(S.zoomCompatSyncMaxEvery) || 2)));
        const compatSyncEvery = Math.max(1, Math.round(1 + close * (syncEveryMax - 1) + overdrawPressure * 2));
        const state = { enabled, adaptiveCulling: cullingEnabled, safety, safetyActive: safetyActiveNow, dist: camDist, close, closeUnder50, activeScale, pixelRatioScale, effectScale, lineScale, overdrawPressure, zoomPressure, screenPressure, fxLoad, compatSyncEvery, screenOverdraw };
        this._zoomOptFrame = frame;
        this._zoomOptCache = state;
        window.SS_ZOOM_OPT = state;
        return state;
    }

    getZoomDisplayParticleCount(base = this.getActiveParticleCount(window.S?.freeEnergy), zOverride = null) {
        const n = Math.max(0, Math.floor(Number(base) || 0));
        if (n <= 0) return 0;
        // Fixed Count means fixed visible/compute count. Keep the overdraw
        // shader pressure controls (size/opacity/pixel ratio), but do not cut
        // the instance count behind the user's back.
        if (window.S?.perfParticleScaling !== true) return n;
        const z = zOverride || this.getZoomOptimizationState();
        const floor = (z.overdrawPressure || 0) > 0.75 ? 4000 : 8000;
        const rawVisible = Math.min(n, Math.max(floor, Math.floor(n * z.activeScale)));
        const q = Math.max(256, Math.min(65536, Math.round(Number(window.S?.zoomDisplayParticleChunk) || Number(window.S?.perfParticleCountChunk) || 4096)));
        if (rawVisible >= n || rawVisible <= q) return Math.max(1, rawVisible);
        return Math.max(1, Math.min(n, Math.floor(rawVisible / q) * q));
    }

    getScreenOverdrawState(options = {}) {
        const S = window.S || {};
        const area = Math.max(
            1,
            Math.floor(
                (Number(options.width) || Number(window.SS_OFFSCREEN_SIZE?.width) || Number(this.canvas?.clientWidth) || Number(window.innerWidth) || 1) *
                (Number(options.height) || Number(window.SS_OFFSCREEN_SIZE?.height) || Number(this.canvas?.clientHeight) || Number(window.innerHeight) || 1)
            )
        );
        const activeCount = Math.max(0, Math.floor(Number(options.activeCount) || 0));
        const pointSize = Math.max(0.02, Math.min(24, Number(options.pointSize) || 0.1));
        const layerLoad = Math.max(0, Math.min(2, Number(options.layerLoad) || 0));
        const amount = Math.max(0, Math.min(3, Number(options.amount) || 0));
        const dynamics = Math.max(0.25, Math.min(2.5, Number(options.dynamics) || 1));
        const trailDepth = Math.max(1, Math.min(32, Number(window.SS_PERF?.nativeTrailDepth) || 8));
        const ribbonsOn = !!(S.showRibbons || S.tessRibbons || S.visualEffectGeometry === true || S.compatAllowManualStructure === true);
        const pointDrawMode = String(S.perfParticleDrawMode || 'native').toLowerCase();
        const pointsMode = pointDrawMode === 'points';
        const bgGlow = Math.max(0, Math.min(1, Number(S.bgGlow) / 0.8 || 0));
        const bgBlur = Math.max(0, Math.min(1, Number(S.bgBlur) / 300 || 0));
        const backdropMix = Math.max(0, Math.min(1.5, Number(S.visualEffect2DBackdropMix ?? 1.0) || 0));
        const fxFade = Math.max(0, Math.min(1, Number(S.visualEffect2DFade ?? 0.01) / 0.16 || 0));
        const lightLoad = Math.max(0, Math.min(1, Number((window.S_effective || S).lightness ?? S.lightness ?? 0.9) || 0));

        const spriteArea = Math.max(0.35, Math.pow(pointSize * (pointsMode ? 0.92 : 1.0), 2));
        const particleFill = Math.max(0, Math.min(1.8, activeCount * spriteArea * 0.20 / area));
        const ribbonFill = ribbonsOn ? Math.max(0, Math.min(1.6, activeCount * Math.max(2, trailDepth) * 0.010 / area)) : 0;
        const fxFill = Math.max(0, Math.min(0.55, layerLoad * 0.085 + amount * 0.030 + dynamics * 0.018));
        const hasBackdrop = S.visualEffectBackdrop !== false && S.visualEffect2DBackdrop !== false;
        const fullScreenFill = Math.max(0, Math.min(0.70,
            bgGlow * 0.15 + bgBlur * 0.055 + backdropMix * fxFade * 0.16 + lightLoad * 0.025 +
            (hasBackdrop && fxFade > 0.02 ? 0.025 : 0)
        ));
        const fillEstimate = Math.max(0, Math.min(2.4, particleFill + ribbonFill + fxFill + fullScreenFill));
        const thresholds = [0.22, 0.38, 0.58, 0.82, 1.10];
        let targetLevel = 0;
        for (let i = 0; i < thresholds.length; i++) {
            if (fillEstimate >= thresholds[i]) targetLevel = i + 1;
        }

        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        let level = Number.isFinite(this._screenOverdrawLevel) ? this._screenOverdrawLevel : 0;
        const nextAt = Number.isFinite(this._screenOverdrawNextChangeAt) ? this._screenOverdrawNextChangeAt : 0;
        if (targetLevel > level && now >= nextAt) {
            level = Math.min(targetLevel, level + 1);
            this._screenOverdrawNextChangeAt = now + 900;
        } else if (targetLevel < level && now >= nextAt) {
            level = Math.max(targetLevel, level - 1);
            this._screenOverdrawNextChangeAt = now + 1800;
        }
        this._screenOverdrawLevel = level;

        const pressureLevels = [0.00, 0.12, 0.24, 0.40, 0.58, 0.75];
        return {
            area,
            activeCount,
            pointSize,
            fillEstimate,
            targetLevel,
            level,
            pressure: pressureLevels[level] ?? pressureLevels[pressureLevels.length - 1],
            particleFill,
            ribbonFill,
            fxFill,
            fullScreenFill,
        };
    }

    getOverdrawVisualBudgetState(lineZoom = this.getZoomOptimizationState()) {
        const S = window.S || {};
        const safety = this.getAdaptiveCullingSafetyState();
        const enabled = S.adaptiveCulling !== false && S.zoomRenderOptimize !== false && (safety.level | 0) > 0;
        const safetyPressureFloor = [0, 0.18, 0.34, 0.52][Math.max(0, Math.min(3, safety.level | 0))] || 0;
        const pressure = enabled
            ? Math.max(0, Math.min(1, Math.max(
                Number(lineZoom.overdrawPressure) || 0,
                Number(lineZoom.screenPressure) || 0,
                safetyPressureFloor
            )))
            : 0;
        const thresholds = [0.12, 0.24, 0.40, 0.58, 0.76];
        let targetLevel = 0;
        for (let i = 0; i < thresholds.length; i++) {
            if (pressure >= thresholds[i]) targetLevel = i + 1;
        }

        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        let level = Number.isFinite(this._overdrawVisualLevel) ? this._overdrawVisualLevel : 0;
        const nextAt = Number.isFinite(this._overdrawVisualNextChangeAt) ? this._overdrawVisualNextChangeAt : 0;
        if (!enabled) {
            level = 0;
            this._overdrawVisualNextChangeAt = now + 250;
        } else if (targetLevel > level && now >= nextAt) {
            level = Math.min(targetLevel, level + 1);
            this._overdrawVisualNextChangeAt = now + 750;
        } else if (targetLevel < level && now >= nextAt) {
            level = Math.max(targetLevel, level - 1);
            this._overdrawVisualNextChangeAt = now + 1800;
        }
        this._overdrawVisualLevel = level;

        const pointScaleFloor = Math.max(0.30, Math.min(1, Number(S.overdrawParticleScaleMin ?? 0.48) || 0.48));
        const opacityScaleFloor = Math.max(0.38, Math.min(1, Number(S.overdrawOpacityScaleMin ?? 0.62) || 0.62));
        const sizeBases = [1.00, 0.88, 0.76, 0.64, 0.54, 0.46];
        const opacityBases = [1.00, 0.92, 0.84, 0.76, 0.68, 0.60];
        const particleScale = Math.max(pointScaleFloor, sizeBases[level] ?? sizeBases[sizeBases.length - 1]);
        const opacityScale = Math.max(opacityScaleFloor, opacityBases[level] ?? opacityBases[opacityBases.length - 1]);
        const state = { enabled, pressure, level, targetLevel, particleScale, opacityScale, safety };
        window.SS_OVERDRAW_VISUAL_BUDGET = state;
        return state;
    }

    getTrailBudgetState(lineZoom = this.getZoomOptimizationState(), manualTrails = false) {
        const S = window.S || {};
        const safety = this.getAdaptiveCullingSafetyState();
        // Trail count culling is a close-view/zoom optimization, not only a
        // panic-mode quality cut. If Auto Culling is on, trim trail draw count
        // when zoomed into a sliver even while FPS is healthy; sustained bad FPS
        // can still push it harder below.
        const enabled = S.adaptiveCulling !== false && S.zoomRenderOptimize !== false;
        const safetyLevel = Math.max(0, Math.min(3, safety.level | 0));
        const safetyActive = safetyLevel > 0;
        const dist = Math.max(0.001, Number(lineZoom.dist) || DEFAULT_ORBIT_DIST);
        const bandRise = this._smoothstep(46, 58, dist);
        const bandFall = 1 - this._smoothstep(96, 116, dist);
        const midBand = enabled ? Math.max(0, Math.min(1, bandRise * bandFall)) : 0;
        const bandStrength = Math.max(0, Math.min(1, Number(S.zoomTrailMidBandStrength) || 0.82));
        const under50Pressure = Math.max(0, Math.min(1, Number(lineZoom.closeUnder50) || 0));
        const zoomPressure = enabled
            ? Math.max(
                Number(lineZoom.overdrawPressure) || 0,
                Number(lineZoom.screenPressure) || 0,
                (Number(lineZoom.close) || 0) * 0.78,
                under50Pressure * 0.96,
                midBand * bandStrength
            )
            : 0;
        const fpsInfo = window.SS_FPS || {};
        const entropy = Number.isFinite(Number(fpsInfo.entropy)) ? Math.max(0, Math.min(100, Number(fpsInfo.entropy))) : 0;
        const fpsPressure = enabled ? Math.max(0, Math.min(1, (entropy - 26) / 54)) : 0;
        const pressure = Math.max(0, Math.min(1, Math.max(zoomPressure, fpsPressure * 0.92)));
        const thresholds = [0.18, 0.34, 0.52, 0.68, 0.84];
        let targetLevel = 0;
        for (let i = 0; i < thresholds.length; i++) {
            if (pressure >= thresholds[i]) targetLevel = i + 1;
        }
        if (enabled && safetyActive) targetLevel = Math.max(targetLevel, Math.min(5, safetyLevel + 1));

        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        let level = Number.isFinite(this._trailBudgetLevel) ? this._trailBudgetLevel : 0;
        const nextAt = Number.isFinite(this._trailBudgetNextChangeAt) ? this._trailBudgetNextChangeAt : 0;
        if (!enabled) {
            level = 0;
            this._trailBudgetLevel = 0;
            this._trailBudgetNextChangeAt = now + 250;
        } else if (targetLevel > level && now >= nextAt) {
            level = Math.min(targetLevel, level + 1);
            this._trailBudgetNextChangeAt = now + 700;
        } else if (targetLevel < level && now >= nextAt) {
            level = Math.max(targetLevel, level - 1);
            this._trailBudgetNextChangeAt = now + 1800;
        }
        this._trailBudgetLevel = level;

        const manualScales = [1.00, 0.82, 0.66, 0.52, 0.40, 0.30];
        const fxScales =     [1.00, 0.72, 0.54, 0.38, 0.26, 0.18];
        const manualEveryBoost = [0, 0, 0, 0, 0, 0];
        const fxEveryBoost =     [0, 1, 2, 4, 6, 8];
        const alphaScale =       [1.00, 0.96, 0.90, 0.84, 0.78, 0.72];
        const scales = manualTrails ? manualScales : fxScales;
        const everyBoost = manualTrails ? manualEveryBoost : fxEveryBoost;
        const state = {
            enabled,
            dist,
            midBand,
            under50Pressure,
            entropy,
            pressure,
            targetLevel,
            level,
            visibleScale: scales[level] ?? scales[scales.length - 1],
            everyBoost: everyBoost[level] ?? everyBoost[everyBoost.length - 1],
            alphaScale: alphaScale[level] ?? alphaScale[alphaScale.length - 1],
            safety,
            safetyActive,
            chunk: Math.max(128, Math.min(16384, Math.round(Number(S.zoomTrailParticleChunk) || 2048)))
        };
        window.SS_TRAIL_BUDGET = state;
        return state;
    }

    getTrailDisplayParticleCount(maxCount, visibleScale, chunk = 2048) {
        const maxN = Math.max(0, Math.floor(Number(maxCount) || 0));
        if (maxN <= 2) return maxN;
        const scale = Math.max(0.01, Math.min(1, Number(visibleScale) || 1));
        const raw = Math.max(2, Math.min(maxN, Math.floor(maxN * scale)));
        const q = Math.max(128, Math.min(16384, Math.round(Number(chunk) || 2048)));
        if (raw <= q) return raw;
        return Math.max(2, Math.min(maxN, Math.floor(raw / q) * q));
    }


    async warmCompileTrailPipelines() {
        if (this._trailPipelinesWarmed || !this.renderer) return;
        this._trailPipelinesWarmed = true;
        const meshes = [this.ribbonMesh, this.latticeMesh].filter(Boolean);
        const savedMeshes = meshes.map(mesh => ({
            mesh,
            visible: mesh.visible,
            count: Number(mesh.count) || 0,
            opacity: mesh.material ? mesh.material.opacity : undefined,
            transparent: mesh.material ? mesh.material.transparent : undefined,
        }));
        const savedActive = this.uniforms?.activeParticleCount ? this.uniforms.activeParticleCount.value : undefined;
        try {
            const active = Math.max(2, Math.min(
                this.getActiveParticleCount(window.S?.freeEnergy),
                Math.max(2, Math.min(this._ribbonN || 2, this._latticeN || 2))
            ));
            if (this.uniforms?.activeParticleCount) this.uniforms.activeParticleCount.value = active;
            // Compile the compute kernels while the splash / first-frame settle
            // is still hiding startup work. First visible trail toggle should
            // only change uniforms/counts, not build TSL/WebGPU pipelines.
            if (this.computeLatticeNode && typeof this.renderer.computeAsync === 'function') {
                await this.renderer.computeAsync(this.computeLatticeNode);
            }
            if (this.computeRibbonNode && typeof this.renderer.computeAsync === 'function') {
                await this.renderer.computeAsync(this.computeRibbonNode);
            }
            for (const mesh of meshes) {
                mesh.visible = true;
                mesh.count = Math.max(1, Math.min(2, Number(mesh.count) || 2));
                if (mesh.material) {
                    mesh.material.transparent = true;
                    mesh.material.opacity = 0.0001;
                }
            }
            if (meshes.length && typeof this.renderer.render === 'function') {
                this._updateCamera?.();
                await this.renderer.render(this.scene, this.camera);
            }
        } catch (e) {
            console.warn('[trails] warm compile skipped:', e && e.message ? e.message : e);
        } finally {
            if (this.uniforms?.activeParticleCount && savedActive !== undefined) this.uniforms.activeParticleCount.value = savedActive;
            for (const rec of savedMeshes) {
                rec.mesh.visible = rec.visible;
                rec.mesh.count = rec.count;
                if (rec.mesh.material) {
                    if (rec.opacity !== undefined) rec.mesh.material.opacity = rec.opacity;
                    if (rec.transparent !== undefined) rec.mesh.material.transparent = rec.transparent;
                }
            }
        }
    }


    getTrailAnimationThrottleState(manualTrails = false) {
        const S = window.S || {};
        const validModes = new Set(['auto', 'smooth', 'held12', 'held4']);
        let mode = String(S.trailAnimationMode || '').toLowerCase();
        if (!validModes.has(mode)) {
            if (S.trailAnimationThrottle === true) {
                mode = (Number(S.trailAnimationFps) || 12) <= 6 ? 'held4' : 'held12';
            } else {
                mode = 'smooth';
            }
        }

        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        let targetLevel = 0;
        let pressure = 0;
        const fpsInfo = window.SS_FPS || {};
        const fps = Number(fpsInfo.fps);
        const entropy = Number.isFinite(Number(fpsInfo.entropy)) ? Math.max(0, Math.min(100, Number(fpsInfo.entropy))) : 0;
        const zoom = window.SS_ZOOM_OPT || {};
        const screenPressure = Math.max(0, Math.min(1, Number(zoom.screenPressure ?? zoom.screenOverdraw?.pressure) || 0));
        const close = Math.max(0, Math.min(1, Number(zoom.close) || 0));
        const adaptiveCullingOn = S.adaptiveCulling !== false && S.zoomRenderOptimize !== false;
        if (mode === 'auto' && manualTrails === true) {
            const fpsPressure = Number.isFinite(fps) ? Math.max(0, Math.min(1, (52 - fps) / 28)) : 0;
            // Close-view trail throttling is separate from quality panic. When
            // the camera is inside a sliver of the body, full-speed trail
            // compute is mostly wasted, so Auto moves trails to the 12 FPS
            // hand-animated cadence even if global FPS is still okay.
            const closePressure = adaptiveCullingOn ? Math.max(0, Math.min(1, (close - 0.34) / 0.46)) : 0;
            const under50Pressure = adaptiveCullingOn ? Math.max(0, Math.min(1, Number(zoom.closeUnder50) || 0)) : 0;
            pressure = Math.max(fpsPressure, Math.max(0, (entropy - 18) / 58), screenPressure * 0.30, closePressure * 0.72, under50Pressure * 0.74);
            if ((Number.isFinite(fps) && fps < 25) || entropy > 58) targetLevel = 2;
            else if ((Number.isFinite(fps) && fps < 46) || entropy > 30 || closePressure > 0.18 || under50Pressure > 0.12) targetLevel = 1;
        }

        let level = Number.isFinite(this._trailAnimationAutoLevel) ? this._trailAnimationAutoLevel : 0;
        const nextAt = Number.isFinite(this._trailAnimationAutoNextAt) ? this._trailAnimationAutoNextAt : 0;
        if (mode !== 'auto' || manualTrails !== true) {
            level = 0;
            this._trailAnimationAutoNextAt = now + 250;
        } else if (targetLevel > level && now >= nextAt) {
            level = Math.min(targetLevel, level + 1);
            this._trailAnimationAutoNextAt = now + 260;
        } else if (targetLevel < level && now >= nextAt) {
            level = Math.max(targetLevel, level - 1);
            this._trailAnimationAutoNextAt = now + 1800;
        }
        this._trailAnimationAutoLevel = level;

        const effectiveMode = mode === 'auto'
            ? (level >= 2 ? 'held4' : level >= 1 ? 'held12' : 'smooth')
            : mode;
        const effectiveFps = effectiveMode === 'held4' ? 4 : effectiveMode === 'held12' ? 12 : Math.max(1, Math.min(60, Number(S.trailAnimationFps) || 12));
        const enabled = manualTrails === true && (effectiveMode === 'held12' || effectiveMode === 'held4');
        const intervalMs = enabled ? (1000 / effectiveFps) : 0;
        const state = {
            enabled,
            mode,
            effectiveMode,
            auto: mode === 'auto',
            fps: effectiveFps,
            intervalMs,
            level,
            targetLevel,
            pressure,
            close,
            closeUnder50: Math.max(0, Math.min(1, Number(zoom.closeUnder50) || 0)),
            adaptiveCulling: adaptiveCullingOn,
            source: fpsInfo.source || 'worker'
        };
        window.SS_TRAIL_ANIMATION_THROTTLE = state;
        return state;
    }

    shouldRunTrailAnimationTick(slot = 'trail', throttle = null, force = false) {
        const t = throttle || this.getTrailAnimationThrottleState(true);
        if (!t || t.enabled !== true) return true;
        if (!this._trailAnimationThrottleLast) this._trailAnimationThrottleLast = Object.create(null);
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const interval = Math.max(16, Number(t.intervalMs) || 0);
        const last = Number(this._trailAnimationThrottleLast[slot]) || -1e9;
        if (force || now - last >= interval * 0.98) {
            this._trailAnimationThrottleLast[slot] = now;
            return true;
        }
        return false;
    }

    applyPerfLimits() {
        this.updatePointDrawState();
        this.updatePerformanceParticleScale();
        const counts = this.getFrameParticleCounts(window.S?.freeEnergy);
        if (this.uniforms && this.uniforms.activeParticleCount) {
            this.uniforms.activeParticleCount.value = counts.display;
        }
        if (this.mesh) this.mesh.count = counts.display;
        this.applyPixelRatioIfNeeded(true);
    }

    setupNavigationArrow() {
        // Repositioned to the top of the viewport (was bottom) so it doesn't
        // compete with the dock and footer controls. Semi-transparent white
        // (was solid red) reads as a guidance cue rather than an alarm —
        // the arrow exists to gently say "origin is over here," not to
        // demand attention. Fade via opacity transition; the previous
        // display:block/none flip caused a jarring pop.
        this.navArrow = document.createElement('div');
        this.navArrow.id = 'nav-arrow';
        this.navArrow.style.cssText = `
            position: fixed;
            top: 36px;
            left: 50%;
            transform: translateX(-50%);
            width: 28px;
            height: 28px;
            background: rgba(255, 255, 255, 0.55);
            clip-path: polygon(50% 0%, 100% 100%, 50% 80%, 0% 100%);
            z-index: 1000;
            pointer-events: none;
            opacity: 0;
            transition: opacity 350ms ease;
            box-shadow: 0 0 8px rgba(255, 255, 255, 0.25);
        `;
        document.body.appendChild(this.navArrow);
    }

    updateNavigationArrow() {
        if (!this.camera || !this.navArrow) return;
        const projected = this._navProjected || (this._navProjected = new THREE.Vector3());
        projected.set(0, 0, 0).project(this.camera);

        const isOffScreen = Math.abs(projected.x) > 0.95 || Math.abs(projected.y) > 0.95 || projected.z > 1;

        if (isOffScreen) {
            const angle = Math.atan2(projected.y, projected.x) + Math.PI / 2;
            const opacity = projected.z > 1 ? '0.9' : '0.55';
            if (!Number.isFinite(this._navLastAngle) || Math.abs(angle - this._navLastAngle) > 0.002) {
                this._navLastAngle = angle;
                this.navArrow.style.transform = `translateX(-50%) rotate(${angle}rad)`;
            }
            if (this._navLastOpacity !== opacity) {
                this._navLastOpacity = opacity;
                this.navArrow.style.opacity = opacity;
            }
        } else if (this._navLastOpacity !== '0') {
            this._navLastOpacity = '0';
            this.navArrow.style.opacity = '0';
        }
    }


    _offscreenCssSize() {
        const offscreenSize = window.SS_OFFSCREEN_SIZE || null;
        if (!offscreenSize) return null;
        const width = Math.max(1, Math.floor(Number(offscreenSize.cssWidth ?? offscreenSize.width) || Number(window.innerWidth) || 1));
        const height = Math.max(1, Math.floor(Number(offscreenSize.cssHeight ?? offscreenSize.height) || Number(window.innerHeight) || 1));
        return { width, height };
    }

    _offscreenBackingSize() {
        const offscreenSize = window.SS_OFFSCREEN_SIZE || null;
        if (!offscreenSize) return null;
        const css = this._offscreenCssSize ? this._offscreenCssSize() : { width: 1, height: 1 };
        const backingWidth = Math.max(1, Math.floor(Number(offscreenSize.backingWidth) || Number(this.canvas?.width) || css.width));
        const backingHeight = Math.max(1, Math.floor(Number(offscreenSize.backingHeight) || Number(this.canvas?.height) || css.height));
        return { width: backingWidth, height: backingHeight };
    }

    _syncOffscreenViewport(force = false) {
        const css = this._offscreenCssSize ? this._offscreenCssSize() : null;
        const backing = this._offscreenBackingSize ? this._offscreenBackingSize() : css;
        if (!css || !backing || !this.renderer) return false;
        const key = `${css.width}x${css.height}:${backing.width}x${backing.height}`;
        if (!force && this._lastOffscreenViewportKey === key) return false;
        this._lastOffscreenViewportKey = key;

        if (this.camera) {
            this.camera.aspect = css.width / Math.max(1, css.height);
            if (typeof this.camera.clearViewOffset === 'function') this.camera.clearViewOffset();
            this.camera.filmOffset = 0;
            this.camera.updateProjectionMatrix();
        }
        try { if (typeof this.renderer.setScissorTest === 'function') this.renderer.setScissorTest(false); } catch (e) {}
        try { if (typeof this.renderer.setViewport === 'function') this.renderer.setViewport(0, 0, css.width, css.height); } catch (e) {}
        try { if (typeof this.renderer.setScissor === 'function') this.renderer.setScissor(0, 0, css.width, css.height); } catch (e) {}
        return true;
    }


    _orbitTarget() {
        const target = this.cam && this.cam.target ? this.cam.target : new THREE.Vector3();
        target.set(0, 0, 0);
        if (this.cam) this.cam.target = target;
        return target;
    }

    _setOrbitAnglesFromOffset(offset) {
        if (!this.cam || !offset) return;
        const a = orbitAnglesFromOffset(offset);
        this.cam.orbitYaw = a.yaw;
        this.cam.orbitPitch = a.pitch;
    }

    _syncOrbitAnglesFromQuat() {
        if (!this.cam || !this.cam.quat) return;
        const q = this.cam.quat.clone ? this.cam.quat.clone() : new THREE.Quaternion();
        if (!Number.isFinite(q.x) || !Number.isFinite(q.y) || !Number.isFinite(q.z) || !Number.isFinite(q.w)) return;
        q.normalize();
        this._setOrbitAnglesFromOffset(new THREE.Vector3(0, 0, 1).applyQuaternion(q));
    }

    _applyOrbitCamera() {
        if (!this.camera || !this.cam) return false;
        const target = this._orbitTarget();
        const dist = Math.max(1, Number(this.cam.dist) || DEFAULT_ORBIT_DIST);
        this.cam.dist = dist;
        this.cam.distTarget = Math.max(1, Number(this.cam.distTarget) || dist);
        if (!Number.isFinite(this.cam.orbitYaw)) this.cam.orbitYaw = orbitAnglesFromOffset(DEFAULT_ORBIT_OFFSET).yaw;
        if (!Number.isFinite(this.cam.orbitPitch)) this.cam.orbitPitch = orbitAnglesFromOffset(DEFAULT_ORBIT_OFFSET).pitch;
        this.cam.orbitYaw = wrapOrbitAngle(this.cam.orbitYaw);
        this.cam.orbitPitch = wrapOrbitAngle(this.cam.orbitPitch);

        const offset = orbitOffsetFromAngles(this.cam.orbitYaw, this.cam.orbitPitch, dist);
        this.camera.up.copy(orbitUpFromAngles(this.cam.orbitYaw, this.cam.orbitPitch));
        this.camera.position.copy(target).add(offset);
        this.camera.lookAt(target);
        this.camera.updateMatrixWorld(true);
        this.cam.quat.copy(this.camera.quaternion).normalize();
        this.cam.pos.copy(this.camera.position);
        return true;
    }


    applyCameraStateSnapshot(state = {}) {
        if (!this.camera || !this.cam || !state || typeof state !== 'object') return false;
        const num = (v, fallback) => {
            const n = Number(v);
            return Number.isFinite(n) ? n : fallback;
        };
        const hasOrbitYaw = Number.isFinite(Number(state.orbitYaw));
        const hasOrbitPitch = Number.isFinite(Number(state.orbitPitch));
        const hasPos = Array.isArray(state.pos) && state.pos.length >= 3;

        if (state.dist !== undefined) this.cam.dist = Math.max(1, num(state.dist, this.cam.dist || DEFAULT_ORBIT_DIST));
        if (state.distTarget !== undefined) this.cam.distTarget = Math.max(1, num(state.distTarget, this.cam.distTarget || this.cam.dist || DEFAULT_ORBIT_DIST));
        else this.cam.distTarget = this.cam.dist;
        if (state.yaw !== undefined) this.cam.yaw = num(state.yaw, this.cam.yaw || 0);
        if (state.pitch !== undefined) this.cam.pitch = num(state.pitch, this.cam.pitch || 0);
        if (state.flyMoveSpeed !== undefined) this.cam.flyMoveSpeed = Math.max(0.05, num(state.flyMoveSpeed, this.cam.flyMoveSpeed || 1));
        if (state.orbitZoomSpeed !== undefined) this.cam.orbitZoomSpeed = Math.max(0.1, num(state.orbitZoomSpeed, this.cam.orbitZoomSpeed || 1));
        if (Array.isArray(state.target) && state.target.length >= 3 && this.cam.target && this.cam.target.fromArray) {
            try { this.cam.target.fromArray(state.target.slice(0, 3)); } catch (e) {}
        }
        if (hasPos && this.cam.pos && this.cam.pos.fromArray) {
            try { this.cam.pos.fromArray(state.pos.slice(0, 3)); } catch (e) {}
        }
        if (Array.isArray(state.quat) && state.quat.length >= 4 && this.cam.quat && this.cam.quat.fromArray) {
            try { this.cam.quat.fromArray(state.quat.slice(0, 4)).normalize(); } catch (e) {}
        }
        if (hasOrbitYaw) this.cam.orbitYaw = num(state.orbitYaw, this.cam.orbitYaw || 0);
        if (hasOrbitPitch) this.cam.orbitPitch = wrapOrbitAngle(num(state.orbitPitch, this.cam.orbitPitch || 0));
        if ((!hasOrbitYaw || !hasOrbitPitch) && hasPos) {
            const target = this._orbitTarget();
            const offset = this.cam.pos.clone().sub(target);
            const angles = orbitAnglesFromOffset(offset);
            if (!hasOrbitYaw) this.cam.orbitYaw = angles.yaw;
            if (!hasOrbitPitch) this.cam.orbitPitch = angles.pitch;
        }

        if (window.S && window.S.moveMode === 'fly') {
            this.camera.position.copy(this.cam.pos);
            if (this.cam.quat && Number.isFinite(this.cam.quat.w)) this.camera.quaternion.copy(this.cam.quat).normalize();
            else this.camera.rotation.set(this.cam.pitch || 0, this.cam.yaw || 0, 0, 'YXZ');
            this.camera.updateMatrixWorld(true);
            return true;
        }
        return this._applyOrbitCamera();
    }

    _resetOffscreenOrbitCamera() {
        if (!window.SS_OFFSCREEN_SIZE || !this.camera || !this.cam) return;
        const a = orbitAnglesFromOffset(DEFAULT_ORBIT_OFFSET);
        this.cam.orbitYaw = Number.isFinite(this.cam.orbitYaw) ? this.cam.orbitYaw : a.yaw;
        this.cam.orbitPitch = Number.isFinite(this.cam.orbitPitch) ? wrapOrbitAngle(this.cam.orbitPitch) : a.pitch;
        this.cam.dist = Number.isFinite(Number(this.cam.dist)) && this.cam.dist > 0 ? this.cam.dist : DEFAULT_ORBIT_DIST;
        this.cam.distTarget = Number.isFinite(Number(this.cam.distTarget)) && this.cam.distTarget > 0 ? this.cam.distTarget : this.cam.dist;
        this._applyOrbitCamera();
    }


    setupRenderer() {
        this.renderer = new THREE.WebGPURenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance'
        });
        const offscreenSize = window.SS_OFFSCREEN_SIZE || null;
        if (offscreenSize) {
            const css = this._offscreenCssSize ? this._offscreenCssSize() : { width: Math.max(1, Math.floor(Number(offscreenSize.width) || Number(window.innerWidth) || 1)), height: Math.max(1, Math.floor(Number(offscreenSize.height) || Number(window.innerHeight) || 1)) };
            const backing = this._offscreenBackingSize ? this._offscreenBackingSize() : css;
            if (this.camera) {
                this.camera.aspect = css.width / Math.max(1, css.height);
                if (typeof this.camera.clearViewOffset === 'function') this.camera.clearViewOffset();
                this.camera.filmOffset = 0;
                this.camera.updateProjectionMatrix();
            }
            this._lastPerfPixelRatio = 1;
            this.renderer.setPixelRatio(1);
            this.renderer.setSize(css.width, css.height, false);
            this._syncOffscreenViewport(true);
        } else {
            this.renderer.setPixelRatio(this.resolvePixelRatio());
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        }
    }


    resolvePixelRatio() {
        const offscreenSize = window.SS_OFFSCREEN_SIZE || null;
        if (offscreenSize) return 1;
        const dpr = Number(offscreenSize?.devicePixelRatio) || Number(window.devicePixelRatio) || 1;
        const active = this.getActiveParticleCount(window.S?.freeEnergy ?? this.particleCount ?? 0);
        const perf = window.SS_PERF || {};
        let cap = Number.isFinite(+perf.maxPixelRatio) ? +perf.maxPixelRatio : 1.75;
        if (active > 350000) cap = Math.min(cap, 1.15);
        else if (active > 180000) cap = Math.min(cap, 1.35);
        else if (active > 90000) cap = Math.min(cap, 1.55);
        const z = this.getZoomOptimizationState ? this.getZoomOptimizationState() : { pixelRatioScale: 1 };
        const canvasScale = Math.max(0.4, Math.min(1, Number(window.S?.canvasResolutionScale) || 1));
        cap *= z.pixelRatioScale || 1;

        // WebGPU's default device often exposes maxTextureDimension2D = 8192
        // even when the adapter can support more with explicit requiredLimits.
        // Do not let DPR / perf pixel ratio inflate a large browser window into
        // an invalid swapchain, depth buffer, or MSAA texture.
        const safeTextureDim = Math.max(2048, Math.min(8192, Number(perf.safeMaxTextureDimension2D) || 8192));
        const cssWidth = Math.max(1, Number(offscreenSize?.width) || Number(this.canvas?.clientWidth) || Number(window.innerWidth) || 1);
        const cssHeight = Math.max(1, Number(offscreenSize?.height) || Number(this.canvas?.clientHeight) || Number(window.innerHeight) || 1);
        const maxCssDim = Math.max(cssWidth, cssHeight);
        const maxRatioForCanvas = Math.max(0.1, (safeTextureDim - 32) / maxCssDim);

        const raw = Math.min(dpr, cap) * canvasScale;
        const pressureMin = (z.overdrawPressure || 0) > 0.55 ? 0.48 : 0.55;
        const floor = Math.min(Math.min(pressureMin, canvasScale), maxRatioForCanvas);
        const next = Math.min(dpr, raw, maxRatioForCanvas);
        return Math.max(0.1, Math.min(maxRatioForCanvas, Math.max(floor, next)));
    }

    applyPixelRatioIfNeeded(force = false) {
        if (!this.renderer) return;
        if (window.SS_OFFSCREEN_SIZE) {
            if (force || this._lastPerfPixelRatio !== 1) {
                this._lastPerfPixelRatio = 1;
                this.renderer.setPixelRatio(1);
            }
            this._syncOffscreenViewport(force);
            return;
        }
        const next = this.resolvePixelRatio();
        if (!force && Math.abs(next - (this._lastPerfPixelRatio || 0)) < 0.04) return;
        this._lastPerfPixelRatio = next;
        this.renderer.setPixelRatio(next);
    }

    setupScene() {
        this.scene = new THREE.Scene();
        // Fog removed — was previously fixed at 0.001 density which made
        // distant particles fade dark/monochrome at zoom-out, fighting the
        // ability to view systems from a distance. The opt-in slider was
        // also removed because the foggy aesthetic conflicts with the
        // "look at the real shape of this thing" core value of the app.
        this.setupReferenceGrid();
    }

    // Reference sphere grid — a wireframe sphere that provides spatial
    // orientation. Opacity is driven by window.S.referenceGrid (0..1,
    // default 0). The mesh is always in the scene but invisible until the
    // slider is raised. Behaves as a skybox: positioned at the camera each
    // frame so it always reads as "the distant horizon" rather than a
    // physical object in the world. Large radius ensures it lives far
    // beyond any plausible particle extent.
    setupReferenceGrid() {
        const radius = 5000;
        const widthSegs = 32;
        const heightSegs = 24;
        const geo = new THREE.SphereGeometry(radius, widthSegs, heightSegs);
        // Use WebGPU-compatible MeshBasicNodeMaterial with wireframe=true.
        // The earlier LineBasicMaterial + LineSegments combo doesn't render
        // under the WebGPU renderer used by this app — it silently failed
        // (no error, no pixels). MeshBasicNodeMaterial is what every other
        // material in the codebase uses, so it's guaranteed to work.
        const mat = new THREE.MeshBasicNodeMaterial({
            color: 0xffffff,
            wireframe: true,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            side: THREE.BackSide  // we're inside the sphere; render the inside faces
        });
        this.refGrid = new THREE.Mesh(geo, mat);
        this.refGrid.frustumCulled = false;
        // Render before everything else (skybox-style). Particles will draw
        // on top of it regardless of their position relative to the sphere
        // surface, which is what we want for a backdrop.
        this.refGrid.renderOrder = -1000;
        this.scene.add(this.refGrid);
    }

    updateReferenceGrid() {
        if (!this.refGrid) return;
        const v = (window.S && typeof window.S.referenceGrid === 'number') ? window.S.referenceGrid : 0;
        // Slider range is now [0, 0.25] (the useful range — anything beyond
        // overwhelms the simulation). Map directly to material opacity so
        // slider=0.25 reads at 0.25 alpha. No multiplier needed.
        this.refGrid.material.opacity = v;
        // Hide the grid entirely when a screenshot capture is in progress.
        // Grid is a visual aid, not part of the simulation's visual identity.
        this.refGrid.visible = v > 0.001 && !window._captureInProgress;
        // Skybox behavior: anchor the grid to the CAMERA position each frame so
        // it stays a fixed shell around the viewer — you can never zoom out
        // through it (it follows you), and because it tracks the camera at a
        // fixed radius it never appears to rescale. This is the "sky sphere"
        // the user expects. (A previous target-anchored version turned it into
        // a finite sphere at the origin that you could zoom out of — wrong.)
        if (this.refGrid.visible && this.camera) {
            this.refGrid.position.copy(this.camera.position);
            // Scale the shell with the camera's orbit distance so it always
            // encloses the view at a constant apparent size. The base mesh is
            // radius 5000; when zoomed out far (large distTarget) a fixed-radius
            // shell gets left behind — the camera approaches and then passes
            // through it, which read as a "nudge" that worsened with zoom and
            // eventually punched through (the screen going dark = seeing the
            // shell's far side / clipping). Tying radius to distance keeps the
            // camera always well inside, at safe vertex magnitudes.
            const dist = (this.cam && typeof this.cam.dist === 'number') ? this.cam.dist : DEFAULT_ORBIT_DIST;
            // Keep the shell ~12x the orbit distance (never smaller than its
            // base) so the horizon stays comfortably beyond the view frustum.
            // Cap the scale so the shell radius (5000 * s) stays well under the
            // camera far plane (1e6) — past ~150x, vertices approach the far
            // plane and precision/clipping cause the dark-screen punch-through.
            const s = Math.max(1, Math.min(150, (dist * 12) / 5000));
            this.refGrid.scale.setScalar(s);
        }
        // White in both themes — earlier theme-aware coloring (cyan/amber)
        // read as yellow under low alpha because the white-additive
        // blending against a dark canvas pulled the hue toward warm. Pure
        // white renders correctly across all blending paths.
        this.refGrid.material.color.setHex(0xffffff);
    }

    setupCamera() {
        const offscreenSize = window.SS_OFFSCREEN_SIZE || null;
        const camWidth = Math.max(1, Number(offscreenSize?.cssWidth ?? offscreenSize?.width) || Number(window.innerWidth) || 1);
        const camHeight = Math.max(1, Number(offscreenSize?.cssHeight ?? offscreenSize?.height) || Number(window.innerHeight) || 1);
        this.camera = new THREE.PerspectiveCamera(60, camWidth / camHeight, 0.1, 1_000_000);
        if (typeof this.camera.clearViewOffset === 'function') this.camera.clearViewOffset();
        this.camera.filmOffset = 0;

        const defaultAngles = orbitAnglesFromOffset(DEFAULT_ORBIT_OFFSET);
        const defaultPos = orbitOffsetFromAngles(defaultAngles.yaw, defaultAngles.pitch, DEFAULT_ORBIT_DIST);
        this.cam = {
            quat: new THREE.Quaternion(),
            dist: DEFAULT_ORBIT_DIST,
            distTarget: DEFAULT_ORBIT_DIST,
            target: new THREE.Vector3(),
            pos: defaultPos.clone(),
            yaw: 0,
            pitch: 0,
            orbitYaw: defaultAngles.yaw,
            orbitPitch: defaultAngles.pitch,
            down: false,
            mx: 0,
            my: 0,
            flyMoveSpeed: 1.0,
            orbitZoomSpeed: 1.0
        };

        if (window.SS_OFFSCREEN_SIZE) {
            this._resetOffscreenOrbitCamera();
            return;
        }

        try {
            const savedCam = localStorage.getItem('ss_cam');
            if (savedCam) {
                const c = JSON.parse(savedCam);
                if (c.pos) this.cam.pos.fromArray(c.pos);
                if (c.quat) this.cam.quat.fromArray(c.quat).normalize();
                if (c.dist !== undefined) {
                    let d = Number(c.dist);
                    if (!Number.isFinite(d) || d <= 0) {
                        d = DEFAULT_ORBIT_DIST;
                    } else {
                        try {
                            const migrated = localStorage.getItem('ss_cam_default_zoom_100_migrated') === '1';
                            if (!migrated && Math.abs(d - 52) <= 3) {
                                d = DEFAULT_ORBIT_DIST;
                                localStorage.setItem('ss_cam_default_zoom_100_migrated', '1');
                            }
                        } catch(e) {}
                    }
                    this.cam.dist = d;
                    this.cam.distTarget = d;
                }
                if (Number.isFinite(Number(c.yaw))) this.cam.yaw = Number(c.yaw);
                if (Number.isFinite(Number(c.pitch))) this.cam.pitch = Number(c.pitch);
                if (Number.isFinite(Number(c.orbitYaw))) this.cam.orbitYaw = Number(c.orbitYaw);
                else if (c.quat) this._syncOrbitAnglesFromQuat();
                else if (c.pos) this._setOrbitAnglesFromOffset(this.cam.pos);
                if (Number.isFinite(Number(c.orbitPitch))) this.cam.orbitPitch = wrapOrbitAngle(Number(c.orbitPitch));
                if (c.flyMoveSpeed !== undefined) this.cam.flyMoveSpeed = c.flyMoveSpeed;
                if (c.orbitZoomSpeed !== undefined) this.cam.orbitZoomSpeed = c.orbitZoomSpeed;
            }
        } catch(e) {}

        if (window.S.moveMode === 'fly') {
            this.camera.position.copy(this.cam.pos);
            this.camera.rotation.set(this.cam.pitch, this.cam.yaw, 0, 'YXZ');
        } else {
            this._applyOrbitCamera();
        }
    }

    setupBuffers() {
        const activeAtBoot = this.getActiveParticleCount(window.S.freeEnergy || 0);
        const bootCount = Math.min(this.particleCount, Math.max(30000, activeAtBoot + 8192));
        const seeded = generateParticleBuffersSync({
            count: bootCount,
            inversion: window.S.inversion,
            hue: window.S.hue ?? 0.5,
            sat: window.S.sat ?? 0.8,
            lightness: window.S.lightness ?? 0.2,
            seed: particleSeed(),
        });

        const posArray = new Float32Array(this.particleCount * 4);
        const velArray = new Float32Array(this.particleCount * 4);
        const colArray = new Float32Array(this.particleCount * 4);
        posArray.set(seeded.pos);
        velArray.set(seeded.vel);
        colArray.set(seeded.col);

        this.cpuPosArray = posArray;
        this.cpuVelArray = velArray;
        this.cpuColArray = colArray;
        this.posStorage = new THREE.StorageBufferAttribute(posArray, 4);
        this.velStorage = new THREE.StorageBufferAttribute(velArray, 4);
        this.colStorage = new THREE.StorageBufferAttribute(colArray, 4);
        // Keep the first frame deterministic. The initial seeded range is already
        // enough to draw immediately. On the default WebGPU path, bootstrap runs
        // a post-init compute reset that fills the full capacity on-GPU; only use
        // the CPU/worker warm-fill when GPU reset is explicitly disabled.
        queueMicrotask(() => {
            if (getPerformanceSettings().gpuResetParticles !== false) return;
            this.reinitializeParticles({ preferGpu: false }).catch(e => console.warn('[particles] async boot fill failed', e));
        });

        this.geometry = new THREE.PlaneGeometry(1, 1);

        this.GRID_X = 64; this.GRID_Y = 64; this.GRID_Z = 64;
        this.GRID_TOTAL_CELLS = this.GRID_X * this.GRID_Y * this.GRID_Z;
        this.MAX_PER_CELL = resolveMaxPerCell();
        this.gridCountStorage = new THREE.StorageBufferAttribute(new Uint32Array(this.GRID_TOTAL_CELLS), 1);
        this.gridMemberStorage = new THREE.StorageBufferAttribute(new Uint32Array(this.GRID_TOTAL_CELLS * this.MAX_PER_CELL), 1);
        // System color histogram: 16 bins over the spectral index [0,1] that
        // feeds spectralColor(). Each particle ticks its bin once per frame
        // (atomic add) as a near-free byproduct of the color pass. Read back
        // throttled (~1/s, 64 bytes) to find the dominant on-screen color and
        // crossfade the backdrop toward it — so the bg tracks the TRUE color
        // distribution (velocity/density/size spread included), not the hue
        // slider. Reusable as a generic "what color is the system right now"
        // signal (the audio engine can read it later).
        this.COLOR_BINS = 16;
        this.colorHistStorage = new THREE.StorageBufferAttribute(new Uint32Array(this.COLOR_BINS), 1);
    }

    _scheduleStructureBufferRebuild({ ribbon = false, lattice = false, delay = 220 } = {}) {
        const needRibbon = !!ribbon;
        const needLattice = !!lattice;
        if (!needRibbon && !needLattice) return;
        this._pendingStructRebuild = {
            ribbon: !!(needRibbon || this._pendingStructRebuild?.ribbon),
            lattice: !!(needLattice || this._pendingStructRebuild?.lattice),
        };
        clearTimeout(this._structRebuildTimer);
        this._structRebuildTimer = setTimeout(() => {
            const pending = this._pendingStructRebuild || {};
            this._pendingStructRebuild = null;
            const raf = typeof requestAnimationFrame === 'function'
                ? requestAnimationFrame
                : (fn) => setTimeout(() => fn((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()), 16);
            const runLattice = () => {
                if (!pending.lattice) return;
                try { this.setupLattice(); }
                catch (e) { console.warn('lattice rebuild failed', e); }
            };
            const runRibbon = () => {
                if (!pending.ribbon) return;
                try { this.setupRibbon(); }
                catch (e) { console.warn('strings rebuild failed', e); }
            };
            // These create sizeable WebGPU storage buffers and TSL compute
            // nodes. Do not do both in the same task/microtask; splitting them
            // avoids the atlas→randomizer handoff hitch seen in Chrome traces.
            raf(() => {
                runLattice();
                if (pending.ribbon) raf(() => setTimeout(runRibbon, 48));
            });
        }, Math.max(0, Number(delay) || 0));
    }

    resizeParticles(newCount, options = {}) {
        const activeCount = this.getActiveParticleCount(newCount);
        if (this.mesh) this.mesh.count = this.getZoomDisplayParticleCount(activeCount);
        if (this.uniforms && this.uniforms.activeParticleCount) {
            this.uniforms.activeParticleCount.value = this.getZoomDisplayParticleCount(activeCount);
        }
        // Particle buffers are fixed-capacity; freeEnergy only changes draw /
        // active counts. Trail/string buffers are the expensive exception.
        // Never reallocate them just because the desired count got smaller —
        // keep the larger allocation hot and draw a smaller range. Only grow
        // when a direct/manual path explicitly allows it. Atlas and continuous
        // randomizer handoffs use the landed freeEnergy as a budget but must not
        // hit WebGPU/TSL buffer+node rebuilds on the handoff frame.
        const opts = (options && typeof options === 'object') ? options : {};
        const allowStructureRebuild = opts.structureRebuild !== false && opts.resizeStructures !== false;
        const allowStructureGrow = allowStructureRebuild && opts.allowStructureGrow !== false;
        const desiredRibbonN = Math.max(2, resolveRibbonParticleCount(newCount, this.particleCount));
        const desiredLatticeN = Math.max(2, resolveLatticeParticleCount(newCount, this.particleCount));
        const ribbonCapacity = Math.max(0, Number(this._ribbonCapacityN) || Number(this._ribbonN) || 0);
        const latticeCapacity = Math.max(0, Number(this._latticeCapacityN) || Number(this._latticeN) || 0);
        const ribbonGrow = desiredRibbonN > Math.max(2, ribbonCapacity);
        const latticeGrow = desiredLatticeN > Math.max(2, latticeCapacity);
        if (allowStructureGrow && (ribbonGrow || latticeGrow)) {
            this._scheduleStructureBufferRebuild({ ribbon: ribbonGrow, lattice: latticeGrow, delay: Math.max(260, Number(opts.structureDelayMs) || 0) });
        }
    }

    // Re-scramble all particle positions and velocities back to the original
    // spawn distribution. Prefer the compute path so resets do not allocate
    // giant CPU arrays or re-upload full storage buffers. The worker/CPU path
    // stays as a fallback for context loss, older browser behavior, or explicit
    // perf debug switches.
    async reinitializeParticles(options = {}) {
        if (!this.posStorage || !this.velStorage || !this.colStorage) return;
        const token = ++this._particleInitToken;
        const perf = getPerformanceSettings();

        const allowGpuReset = options.preferGpu !== false && perf.gpuResetParticles !== false;
        if (allowGpuReset && this.renderer && this.computeResetNode && this.uniforms && this.uniforms.resetSeed) {
            try {
                this.uniforms.resetSeed.value = ((particleSeed() % 1000000) + 1) / 997.0;
                await this.renderer.computeAsync(this.computeResetNode);
                if (token !== this._particleInitToken) return;
                this._lastGpuResetAt = performance.now();
                if (this.computeClearNode) await this.renderer.computeAsync(this.computeClearNode);
                return;
            } catch (e) {
                if (!this._gpuResetWarnedOnce) {
                    this._gpuResetWarnedOnce = true;
                    console.warn('[particles] GPU reset failed, falling back to worker init:', e && e.message ? e.message : e);
                }
            }
        }

        const opts = {
            count: this.particleCount,
            workerCount: perf.particleInitWorkers || 0,
            inversion: window.S.inversion,
            hue: window.S.hue ?? 0.5,
            sat: window.S.sat ?? 0.8,
            lightness: window.S.lightness ?? 0.2,
            seed: particleSeed(),
        };

        const buffers = this.particleInit && this.particleInit.generate
            ? await this.particleInit.generate(opts)
            : generateParticleBuffersSync(opts);
        if (token !== this._particleInitToken) return;

        this.posStorage.array.set(buffers.pos);
        this.velStorage.array.set(buffers.vel);
        if (buffers.col && this.colStorage.array.length === buffers.col.length) this.colStorage.array.set(buffers.col);
        this.cpuPosArray = this.posStorage.array;
        this.cpuVelArray = this.velStorage.array;
        this.cpuColArray = this.colStorage.array;
        if (this.isPointsFallbackActive() || this.compatParticleCloud) this.syncCompatParticleCloud(true);

        for (const storageAttr of [this.posStorage, this.velStorage, this.colStorage]) {
            storageAttr.needsUpdate = true;
            if (typeof storageAttr.version === 'number') storageAttr.version++;
        }
    }

    setupCompute() {
        this.uniforms = {
            activeParticleCount: uniform(uint(this.getActiveParticleCount(window.S.freeEnergy))),
            dt: uniform(0.016),
            time: time,
            mass: uniform(window.S.mass),
            viscosity: uniform(window.S.viscosity),
            tempo: uniform(window.S.tempo),
            inversion: uniform(window.S.inversion),
            maxV: uniform(8.0),
            ssDamp: uniform(0.0),
            coherence: uniform(window.S.coherence),
            temperature: uniform(window.S.temperature),
            equilibrium: uniform(window.S.equilibrium),
            scaleDepth: uniform(window.S.scaleDepth),
            physicsEmergence: uniform(window.S.physicsEmergence ?? 0.0),
            effectDynamics: uniform(window.S.visualEffectDynamics ?? 1.35),
            audioRms: uniform(0.0),
            audioBeat: uniform(0.0),
            halfLife: uniform(window.S.halfLife ?? 15.0),
            camPos: uniform(new THREE.Vector3(0, 0, 300)),
            offsetX: uniform(window.S.offsetX),
            offsetY: uniform(window.S.offsetY),
            offsetZ: uniform(window.S.offsetZ),
            offscreenCenterLock: uniform(0.0),
            billboardOffset: uniform(window.S.billboardOffset),
            colorMode: uniform(window.S.colorMode || 0),
            colorRange: uniform(window.S.hue || 0.5),
            sat: uniform(window.S.sat ?? 0.8),
            lightness: uniform(window.S.lightness ?? 0.2),
            trailLen: uniform(window.S.trailLen ?? 5.0),
            shape: uniform(window.S.shape === 'square' ? 1 : (window.S.shape === 'diamond' ? 2 : 0)),
            particleCloseScale: uniform(window.S.particleCloseScale === false ? 0.0 : 1.0),
            particleCloseScaleStrength: uniform(window.S.particleCloseScaleStrength ?? 0.72),
            particleCloseScaleNear: uniform(window.S.particleCloseScaleNear ?? 20),
            overdrawParticleScale: uniform(1.0),
            overdrawOpacityScale: uniform(1.0),
            resetSeed: uniform(1.0)
        };

        const getCellIndex = Fn(([p]) => {
            const cx = int(floor(div(p.x, this.uniforms.coherence)));
            const cy = int(floor(div(p.y, this.uniforms.coherence)));
            const cz = int(floor(div(p.z, this.uniforms.coherence)));
            const wx = uint(bitAnd(add(cx, int(10240)), int(63)));
            const wy = uint(bitAnd(add(cy, int(10240)), int(63)));
            const wz = uint(bitAnd(add(cz, int(10240)), int(63)));
            return add(wx, add(mul(wy, uint(64)), mul(wz, uint(4096))));
        });

        const resetHash = Fn(([x]) => {
            return fract(sin(x).mul(43758.5453));
        });

        // GPU-side spawn/reset. This removes the full particle respawn from the
        // CPU/worker/upload path on browsers where compute is live. The CPU
        // worker path remains as a fallback for older builds or context loss.
        const computeResetParticles = Fn(() => {
            If(instanceIndex.lessThan(uint(this.particleCount)), () => {
                const pBuf = storage(this.posStorage, 'vec4', this.particleCount);
                const vBuf = storage(this.velStorage, 'vec4', this.particleCount);
                const cBuf = storage(this.colStorage, 'vec4', this.particleCount);

                const i = float(instanceIndex);
                const seed = this.uniforms.resetSeed;
                const h0 = resetHash(add(mul(i, 12.9898), seed));
                const h1 = resetHash(add(mul(i, 78.233), mul(seed, 1.37)));
                const h2 = resetHash(add(mul(i, 45.164), mul(seed, 2.11)));
                const h3 = resetHash(add(mul(i, 94.673), mul(seed, 3.17)));
                const h4 = resetHash(add(mul(i, 31.719), mul(seed, 4.23)));
                const h5 = resetHash(add(mul(i, 63.137), mul(seed, 5.29)));
                const h6 = resetHash(add(mul(i, 17.371), mul(seed, 6.31)));
                const h7 = resetHash(add(mul(i, 53.917), mul(seed, 7.43)));

                const dirRaw = vec3(sub(mul(h0, 2.0), 1.0), sub(mul(h1, 2.0), 1.0), sub(mul(h2, 2.0), 1.0));
                const dir = normalize(add(dirRaw, vec3(0.001, 0.003, 0.007)));
                const radius = mul(pow(h3, 0.3333333), mul(this.uniforms.inversion, 0.8));
                const pos = mul(dir, radius);

                const vDirRaw = vec3(sub(mul(h4, 2.0), 1.0), sub(mul(h5, 2.0), 1.0), sub(mul(h6, 2.0), 1.0));
                const vDir = normalize(add(vDirRaw, vec3(0.007, 0.005, 0.003)));
                const vel = mul(vDir, 0.25);

                const size = add(0.5, mul(h7, 1.5));
                const life = resetHash(add(mul(i, 19.191), mul(seed, 8.59)));
                const cIdx = fract(add(this.uniforms.colorRange, mul(resetHash(add(mul(i, 29.291), mul(seed, 9.61))), this.uniforms.lightness)));
                const spec = spectralColor(cIdx);
                const sat = clamp(this.uniforms.sat, 0.0, 1.0);
                const col = add(mul(spec, sat), vec3(sub(1.0, sat)));

                pBuf.element(instanceIndex).assign(vec4(pos, size));
                vBuf.element(instanceIndex).assign(vec4(vel, life));
                cBuf.element(instanceIndex).assign(vec4(col, life));
            });
        });

        const computeClearGrid = Fn(() => {
            const countBuf = storage(this.gridCountStorage, 'uint', this.GRID_TOTAL_CELLS).toAtomic();
            atomicStore(countBuf.element(instanceIndex), uint(0));
        });

        const computeAssignGrid = Fn(() => {
            If(instanceIndex.lessThan(this.uniforms.activeParticleCount), () => {
                const pBuf = storage(this.posStorage, 'vec4', this.particleCount);
                const countBuf = storage(this.gridCountStorage, 'uint', this.GRID_TOTAL_CELLS).toAtomic();
                const memberBuf = storage(this.gridMemberStorage, 'uint', this.GRID_TOTAL_CELLS * this.MAX_PER_CELL);

                const pNode = pBuf.element(instanceIndex).xyz;
                const cellIdx = getCellIndex(pNode);
                const offset = atomicAdd(countBuf.element(cellIdx), uint(1));

                If(offset.lessThan(uint(this.MAX_PER_CELL)), () => {
                    const memberIdx = add(mul(cellIdx, uint(this.MAX_PER_CELL)), offset);
                    memberBuf.element(memberIdx).assign(uint(instanceIndex));
                });
            });
        });

        // ── Color histogram passes ──────────────────────────────────────────
        // Clear the 16 bins, then have every active particle tick the bin for
        // its current spectral index (the same value that drives its on-screen
        // color). One atomic add per particle; runs once per frame. The CPU
        // reads this back throttled and crossfades the backdrop toward the
        // dominant color.
        //
        // Local density helper — getSmoothDensity lives in other setup scopes,
        // not here in setupCompute. Re-declare locally (a cell-index-from-coords
        // variant, named distinctly so it doesn't clash with this scope's
        // existing getCellIndex([p])).
        const histCellIndex = Fn(([cx, cy, cz]) => {
            const wx = uint(bitAnd(add(cx, int(10240)), int(63)));
            const wy = uint(bitAnd(add(cy, int(10240)), int(63)));
            const wz = uint(bitAnd(add(cz, int(10240)), int(63)));
            return add(wx, add(mul(wy, uint(64)), mul(wz, uint(4096))));
        });
        const histDensity = Fn(([p]) => {
            const fPos = div(p, this.uniforms.coherence).sub(0.5);
            const base = floor(fPos);
            const f = fract(fPos);
            const bx = int(base.x); const by = int(base.y); const bz = int(base.z);
            const bx1 = bx.add(1); const by1 = by.add(1); const bz1 = bz.add(1);
            const sBuf = storage(this.gridCountStorage, 'uint', this.GRID_TOTAL_CELLS);
            const c000 = float(sBuf.element(histCellIndex(bx, by, bz)));
            const c100 = float(sBuf.element(histCellIndex(bx1, by, bz)));
            const c010 = float(sBuf.element(histCellIndex(bx, by1, bz)));
            const c110 = float(sBuf.element(histCellIndex(bx1, by1, bz)));
            const c001 = float(sBuf.element(histCellIndex(bx, by, bz1)));
            const c101 = float(sBuf.element(histCellIndex(bx1, by, bz1)));
            const c011 = float(sBuf.element(histCellIndex(bx, by1, bz1)));
            const c111 = float(sBuf.element(histCellIndex(bx1, by1, bz1)));
            const mx00 = mix(c000, c100, f.x);
            const mx10 = mix(c010, c110, f.x);
            const mx01 = mix(c001, c101, f.x);
            const mx11 = mix(c011, c111, f.x);
            const mx0 = mix(mx00, mx10, f.y);
            const mx1 = mix(mx01, mx11, f.y);
            return mix(mx0, mx1, f.z);
        });
        const computeClearColorHist = Fn(() => {
            const histBuf = storage(this.colorHistStorage, 'uint', this.COLOR_BINS).toAtomic();
            atomicStore(histBuf.element(instanceIndex), uint(0));
        });

        const computeColorHist = Fn(() => {
            If(instanceIndex.lessThan(this.uniforms.activeParticleCount), () => {
                const pBuf = storage(this.posStorage, 'vec4', this.particleCount);
                const vBuf = storage(this.velStorage, 'vec4', this.particleCount);
                const histBuf = storage(this.colorHistStorage, 'uint', this.COLOR_BINS).toAtomic();

                const pw = pBuf.element(instanceIndex).w;
                const speed = length(vBuf.element(instanceIndex).xyz);
                const density = histDensity(pBuf.element(instanceIndex).xyz);
                const spectrumWidth = add(mul(this.uniforms.colorRange, float(1.2)), float(0.05));

                // Same per-mode index math as the particle material.
                const sizeNorm = clamp(div(sub(pw, float(0.5)), float(1.5)), 0.0, 1.0);
                const sizeVal = clamp(mul(sizeNorm, spectrumWidth), 0.0, 1.0);
                const velVal = clamp(div(sqrt(speed), mul(spectrumWidth, float(5.0))), 0.0, 1.0);
                // Match the particle material's density mapping (log-compressed
                // blue→red heatmap) so the sampled backdrop color agrees.
                const dNorm = clamp(div(log2(add(float(density), 1.0)), mul(spectrumWidth, float(6.0))), 0.0, 1.0);
                const densityVal = mul(sub(float(1.0), dNorm), float(0.66));

                // Mono (0) → top bin (white); modes 1-3 use their spectral index.
                const idx = select(this.uniforms.colorMode.equal(1), sizeVal,
                    select(this.uniforms.colorMode.equal(2), velVal,
                        select(this.uniforms.colorMode.equal(3), densityVal, float(1.0))));

                const bin = uint(clamp(floor(mul(idx, float(this.COLOR_BINS))), 0.0, float(this.COLOR_BINS - 1)));
                // Size mode (1): weight each particle's tick by its screen
                // coverage (area ∝ size²) so the backdrop average matches
                // what the eye sees. In Size mode big == one end of the
                // spectrum, so equal-weighting skewed the backdrop toward the
                // small-particle end (the miscalibration). Velocity/Density
                // keep weight 1 — size is uncorrelated with their color index,
                // so they're already calibrated and must not be perturbed.
                const areaW = mul(pw, pw);
                const tickW = uint(floor(select(this.uniforms.colorMode.equal(1),
                    clamp(mul(areaW, float(16.0)), float(1.0), float(8192.0)), float(1.0))));
                atomicAdd(histBuf.element(bin), tickW);
            });
        });

        this.computeClearColorHistNode = computeClearColorHist().compute(this.COLOR_BINS);
        this.computeColorHistNode = computeColorHist().compute(this.particleCount);

        const computePhysics = Fn(() => {
            If(instanceIndex.lessThan(this.uniforms.activeParticleCount), () => {
                const pBuf = storage(this.posStorage, 'vec4', this.particleCount);
                const vBuf = storage(this.velStorage, 'vec4', this.particleCount);
                const countBuf = storage(this.gridCountStorage, 'uint', this.GRID_TOTAL_CELLS);
                const memberBuf = storage(this.gridMemberStorage, 'uint', this.GRID_TOTAL_CELLS * this.MAX_PER_CELL);

                const pNode = pBuf.element(instanceIndex);
                const vNode = vBuf.element(instanceIndex);

                let p = pNode.xyz;
                let v = vNode.xyz;

                const cellIdx = getCellIndex(p);
                const r = this.uniforms.inversion;
                // tempo (tScale) keeps its EXACT original behavior. Timescale is
                // NOT applied here — speeding the sim is done by running this
                // fixed-timestep integrator MORE TIMES per frame (sub-stepping
                // in render()), never by enlarging dt. Enlarging dt changes the
                // numerical trajectory of a nonlinear system (it destabilizes,
                // flinging particles outward); sub-stepping keeps every step
                // identical and just advances further per frame — a true clock,
                // the way Conway/Unreal time-dilation work.
                const tScale = this.uniforms.tempo;
                let fx = float(0.0).toVar();
                let fy = float(0.0).toVar();
                let fz = float(0.0).toVar();

                const cx = int(floor(div(p.x, this.uniforms.coherence)));
                const cy = int(floor(div(p.y, this.uniforms.coherence)));
                const cz = int(floor(div(p.z, this.uniforms.coherence)));

                const ax = float(0).toVar();
                const ay = float(0).toVar();
                const az = float(0).toVar();

                Loop({ start: int(-1), end: int(2), type: 'int', condition: '<' }, ({ i: dx }) => {
                    Loop({ start: int(-1), end: int(2), type: 'int', condition: '<' }, ({ i: dy }) => {
                        Loop({ start: int(-1), end: int(2), type: 'int', condition: '<' }, ({ i: dz }) => {
                            const nx = add(cx, dx);
                            const ny = add(cy, dy);
                            const nz = add(cz, dz);

                            const wx = uint(bitAnd(add(nx, int(10240)), int(63)));
                            const wy = uint(bitAnd(add(ny, int(10240)), int(63)));
                            const wz = uint(bitAnd(add(nz, int(10240)), int(63)));
                            const neighborCellIdx = add(wx, add(mul(wy, uint(this.GRID_X)), mul(wz, uint(this.GRID_X * this.GRID_Y))));

                            const cellCount = min(countBuf.element(neighborCellIdx), uint(this.MAX_PER_CELL));

                            Loop({ start: uint(0), end: cellCount, type: 'uint', condition: '<' }, ({ i: j }) => {
                                const memberIdx = add(mul(neighborCellIdx, uint(this.MAX_PER_CELL)), j);
                                const neighborId = memberBuf.element(memberIdx);

                                If(neighborId.notEqual(uint(instanceIndex)), () => {
                                    const nPos = pBuf.element(neighborId).xyz;
                                    const dx_p = sub(nPos.x, p.x);
                                    const dy_p = sub(nPos.y, p.y);
                                    const dz_p = sub(nPos.z, p.z);
                                    const dSq = add(mul(dx_p, dx_p), add(mul(dy_p, dy_p), mul(dz_p, dz_p)));
                                    const radSq = mul(this.uniforms.coherence, this.uniforms.coherence);

                                    If(dSq.lessThan(radSq).and(dSq.greaterThan(1.0)), () => {
                                        const d = length(vec3(dx_p, dy_p, dz_p));
                                        const ratio = div(d, this.uniforms.coherence);
                                        const forceStr = float(0).toVar();
                                        If(ratio.greaterThan(0.15), () => {
                                            forceStr.assign( mul(this.uniforms.scaleDepth, mul(25.0, sub(1.0, ratio))) );
                                        }).Else(() => {
                                            forceStr.assign( mul(this.uniforms.scaleDepth, mul(-150.0, sub(0.15, ratio))) );
                                        });

                                        ax.addAssign(mul(div(dx_p, d), forceStr));
                                        ay.addAssign(mul(div(dy_p, d), forceStr));
                                        az.addAssign(mul(div(dz_p, d), forceStr));
                                    });
                                });
                            });
                        });
                    });
                });

                const maxR = mul(r, 0.9);
                const eq = this.uniforms.equilibrium;
                const temp = this.uniforms.temperature;

                const curlPos = vec3(
                    add(mul(p.x, 0.5), mul(time, 0.05)),
                    add(mul(p.y, 0.5), mul(time, 0.02)),
                    mul(p.z, 0.5)
                );

                const turb = curlNoise(curlPos, mul(eq, 10.0), mul(temp, 2.0));

                fx.addAssign(turb.x);
                fy.addAssign(turb.y);
                fz.addAssign(turb.z);

                If(abs(this.uniforms.physicsEmergence).greaterThan(0.001), () => {
                    // UI label: Turbulence. Internal key stays physicsEmergence for old atlas/share compatibility.
                    // Positive values drive the original lobe/swirl/ripple field; negative values invert the
                    // organized force directions, giving a complementary turbulence mode instead of becoming invalid.
                    // Slider range is -2.5..2.5, but Unbound mode can store larger values; clamp in-shader for stability.
                    const turbulenceRaw = clamp(this.uniforms.physicsEmergence, -8.0, 8.0);
                    const turbulence = abs(turbulenceRaw);
                    const turbulenceSign = select(turbulenceRaw.lessThan(0.0), float(-1.0), float(1.0));
                    const dyn = clamp(this.uniforms.effectDynamics, 0.25, 2.5);
                    const audioPulse = add(float(1.0), add(mul(this.uniforms.audioRms, float(0.60)), mul(this.uniforms.audioBeat, float(0.95))));
                    const phase = add(mul(time, add(float(0.11), mul(eq, float(1.35)))), mul(this.uniforms.colorRange, float(6.2831853)));
                    const lobeRadius = mul(r, add(float(0.22), mul(dyn, float(0.055))));
                    const lobeA = vec3(
                        mul(sin(phase), lobeRadius),
                        mul(cos(mul(phase, float(0.73))), mul(r, float(0.18))),
                        mul(cos(mul(phase, float(1.17))), lobeRadius)
                    );
                    const toA = sub(lobeA, p);
                    const dA = max(length(toA), float(1.0));
                    const lobeRange = mul(r, add(float(0.82), mul(turbulence, float(0.18))));
                    const fallA = clamp(sub(float(1.0), div(dA, lobeRange)), 0.0, 1.0);
                    const vortexAxis = normalize(add(vec3(
                        sin(mul(phase, float(0.37))),
                        cos(mul(phase, float(0.29))),
                        sin(mul(phase, float(0.53)))
                    ), vec3(0.01, 0.03, 0.05)));
                    const radial = normalize(add(p, vec3(0.001, 0.003, 0.005)));
                    const swirl = cross(vortexAxis, radial);
                    const turbulenceAmp = mul(turbulence, mul(audioPulse, add(float(0.10), add(mul(temp, float(0.050)), mul(this.uniforms.scaleDepth, float(0.010))))));
                    const signedAmp = mul(turbulenceAmp, turbulenceSign);
                    const lobeForce = mul(normalize(add(toA, vec3(0.001, 0.003, 0.005))), mul(fallA, mul(signedAmp, float(1.55))));
                    const swirlForce = mul(swirl, mul(signedAmp, add(float(0.55), mul(fallA, float(0.65)))));
                    const phaseB = add(mul(phase, float(-0.61)), mul(time, add(float(0.07), mul(temp, float(0.22)))));
                    const lobeB = vec3(
                        mul(cos(mul(phaseB, float(0.83))), mul(r, add(float(0.18), mul(dyn, float(0.045))))),
                        mul(sin(mul(phaseB, float(1.11))), mul(r, add(float(0.10), mul(turbulence, float(0.035))))),
                        mul(sin(phaseB), mul(r, add(float(0.24), mul(temp, float(0.075)))))
                    );
                    const awayB = sub(p, lobeB);
                    const dB = max(length(awayB), float(1.0));
                    const fallB = clamp(sub(float(1.0), div(dB, mul(lobeRange, float(0.82)))), 0.0, 1.0);
                    const splitForce = mul(normalize(add(awayB, vec3(0.005, 0.002, 0.007))), mul(fallB, mul(signedAmp, float(0.72))));
                    const ripple = sin(add(mul(length(p), add(float(0.050), mul(this.uniforms.coherence, float(0.002)))), mul(time, add(float(0.35), mul(eq, float(2.0))))));
                    const rippleForce = mul(radial, mul(ripple, mul(signedAmp, float(0.34))));
                    fx.addAssign(add(add(add(lobeForce.x, swirlForce.x), rippleForce.x), splitForce.x));
                    fy.addAssign(add(add(add(lobeForce.y, swirlForce.y), rippleForce.y), splitForce.y));
                    fz.addAssign(add(add(add(lobeForce.z, swirlForce.z), rippleForce.z), splitForce.z));
                });

                If(this.uniforms.scaleDepth.greaterThan(0.001), () => {
                    If(this.uniforms.coherence.greaterThan(0.1), () => {
                        fx.addAssign(ax);
                        fy.addAssign(ay);
                        fz.addAssign(az);
                    });
                });

                const distFromOrigin = length(p);
                If(distFromOrigin.greaterThan(5.0), () => {
                    const originAudioDrive = clamp(add(mul(this.uniforms.audioRms, float(0.40)), mul(this.uniforms.audioBeat, float(0.75))), 0.0, 1.0);
                    const turbulencePullTrim = max(float(0.55), sub(float(1.0), mul(abs(clamp(this.uniforms.physicsEmergence, -8.0, 8.0)), add(float(0.055), mul(originAudioDrive, float(0.105))))));
                    const pullStrength = mul(min(mul(sub(distFromOrigin, 5.0), 0.05), float(1.5)), turbulencePullTrim);
                    const dirToOrigin = normalize(p);
                    fx.subAssign(mul(dirToOrigin.x, pullStrength));
                    fy.subAssign(mul(dirToOrigin.y, pullStrength));
                    fz.subAssign(mul(dirToOrigin.z, pullStrength));
                });

                const softLimit = mul(maxR, 0.8);
                If(distFromOrigin.greaterThan(softLimit), () => {
                    const push = mul(sub(distFromOrigin, softLimit), 0.5);
                    const dirToOrigin = normalize(p);
                    fx.subAssign(mul(dirToOrigin.x, push));
                    fy.subAssign(mul(dirToOrigin.y, push));
                    fz.subAssign(mul(dirToOrigin.z, push));
                });

                const force = vec3(fx, fy, fz);
                const drag = sub(float(1.0), mul(this.uniforms.viscosity, mul(0.005, tScale)));
                const newV = add(mul(v, drag), mul(force, mul(this.uniforms.dt, div(8.0, this.uniforms.mass)))).toVar();
                // ── OVERSHOOT DAMPING (toggle: this.uniforms.ssDamp = 1) ──────
                // The period-2 flicker is a stiff-spring overshoot: in dense
                // clusters the strong short-range neighbor repulsion integrated
                // with the explicit step over-corrects, so a particle slams one
                // way then back the next step (a 2-cycle). When enabled, this
                // removes the component of velocity that points along the
                // instantaneous neighbor-force direction beyond what one step
                // needs — i.e. lightly critically-damps the spring — which kills
                // the oscillation without touching global/turbulence motion.
                // Gated + default 0 so the shipped behavior is byte-identical
                // until we confirm this is the cure.
                If(this.uniforms.ssDamp.greaterThan(0.5), () => {
                    const aMag = length(vec3(ax, ay, az));
                    If(aMag.greaterThan(0.0001), () => {
                        const aDir = normalize(vec3(ax, ay, az));
                        const along = dot(newV, aDir);          // velocity component along neighbor force
                        // Damp only the portion moving WITH the repulsion (the
                        // overshoot carrier); kept gentle so fine motion survives.
                        If(along.greaterThan(0.0), () => {
                            newV.subAssign(mul(aDir, mul(along, float(0.24))));
                        });
                    });
                });
                const vMag = length(newV);
                const clampScale = min(float(1.0), div(this.uniforms.maxV, vMag));
                newV.assign(mul(newV, clampScale));
                const newP = add(p, mul(newV, tScale)).toVar();

                const decayNoise = add(float(1.0), mul(fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))).mul(43758.5453)), float(0.5)));
                const decayRate = max(float(0.0), mul(sub(float(30.0), this.uniforms.halfLife), mul(float(0.05), mul(tScale, mul(this.uniforms.dt, decayNoise)))));
                const life = sub(vNode.w, decayRate).toVar();
                
                const hashVec = vec3(p.x, p.y, add(p.z, float(instanceIndex)));
                const randAngle1 = mul(fract(sin(dot(hashVec, vec3(12.9898, 78.233, 45.164))).mul(43758.5453)), mul(Math.PI, 2.0));
                const randAngle2 = mul(fract(sin(dot(hashVec, vec3(45.164, 12.9898, 78.233))).mul(43758.5453)), mul(Math.PI, 2.0));
                const blastSpeed = add(mul(fract(sin(dot(hashVec, vec3(78.233, 45.164, 12.9898))).mul(43758.5453)), 20.0), 5.0);
                const blastDir = vec3(
                    mul(sin(randAngle1), cos(randAngle2)),
                    mul(sin(randAngle1), sin(randAngle2)),
                    cos(randAngle1)
                );
                const blastV = mul(blastDir, blastSpeed);
                const spawnHash = fract(sin(dot(hashVec, vec3(31.719, 17.371, 63.137))).mul(43758.5453));
                const spawnRadius = mul(
                    this.uniforms.inversion,
                    add(float(0.004), mul(spawnHash, add(float(0.014), mul(clamp(this.uniforms.temperature, 0.0, 2.75), float(0.003)))))
                );
                const respawnSize = add(float(0.42), mul(fract(sin(dot(hashVec, vec3(53.917, 29.291, 19.191))).mul(43758.5453)), float(1.32))).toVar();

                const shouldRespawn = life.lessThan(0.0).toVar();
                If(shouldRespawn, () => {
                    newP.assign(mul(blastDir, spawnRadius));
                    newV.assign(blastV);
                    life.assign(float(1.0));
                });

                vNode.assign(vec4(newV, life));
                // Preserve per-particle size variation in pos.w. Previously
                // this was clobbered to 1.0 every frame, which made every
                // particle render at the same size (the random spawn-time
                // variation in [0.5, 2.0] was being overwritten the moment
                // physics ran). Now pos.w is carried through unchanged.
                // Side effect: Size color mode now actually works — particles
                // have different per-particle w values, so the spectrum maps
                // them to distinct colors. On respawn the spawn cycle should
                // re-randomize, which would require sampling a new value
                // here, but for now using the existing value gives stable
                // size identity per particle across its lifetime, with a fresh
                // identity only when that particle respawns.
                pNode.assign(vec4(newP, select(shouldRespawn, respawnSize, pNode.w)));
            });
        });

        this.computeResetNode = computeResetParticles().compute(this.particleCount);
        this._gpuResetReady = true;
        this.computeClearNode = computeClearGrid().compute(this.GRID_TOTAL_CELLS);
        this.computeAssignNode = computeAssignGrid().compute(this.particleCount);
        this.computeNode = computePhysics().compute(this.particleCount);
    }

    makeTex(t) {
        const c = document.createElement('canvas');
        c.width = 64;
        c.height = 64;
        const x = c.getContext('2d');

        if (t === 'circle') {
            const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
            g.addColorStop(0, 'rgba(255,255,255,1)');
            g.addColorStop(.4, 'rgba(255,255,255,.8)');
            g.addColorStop(1, 'rgba(255,255,255,0)');
            x.fillStyle = g;
            x.fillRect(0, 0, 64, 64);
        } else if (t === 'square') {
            x.fillStyle = '#fff';
            x.fillRect(4, 4, 56, 56);
        } else {
            x.fillStyle = '#fff';
            x.beginPath();
            x.moveTo(32, 2);
            x.lineTo(62, 32);
            x.lineTo(32, 62);
            x.lineTo(2, 32);
            x.closePath();
            x.fill();
        }
        return new THREE.CanvasTexture(c);
    }

    setupMaterial() {
        this.uniforms.pointSize = uniform(window.S.resolution);
        this.uniforms.pointOpacity = uniform(window.S.opacity);

        const posFromBuf = storage(this.posStorage, 'vec4', this.particleCount).element(instanceIndex);
        const colFromBuf = storage(this.colStorage, 'vec4', this.particleCount).element(instanceIndex);

        this.material = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        });

        const worldOffset = vec3(this.uniforms.offsetX, this.uniforms.offsetY, this.uniforms.offsetZ);
        const worldPos = add(posFromBuf.xyz, worldOffset);
        const viewPos = modelViewMatrix.mul(vec4(worldPos, 1.0)).xyz;
        const centerViewPos = modelViewMatrix.mul(vec4(worldOffset, 1.0)).xyz;
        const centeredViewPos = vec3(sub(viewPos.x, centerViewPos.x), sub(viewPos.y, centerViewPos.y), viewPos.z);
        const drawViewPos = mix(viewPos, centeredViewPos, this.uniforms.offscreenCenterLock);

        const colorMode = this.uniforms.colorMode;
        // Perceptual gamma curve on color spectrum range: linear colorRange
        // produced a slider whose lower half felt "dead" because the spectral
        // function is itself non-linear in input (lower phases occupy a
        // narrow blue→purple band while upper phases sweep through the
        // visually-distinct yellow/orange/red region). Square-rooting the
        // input compresses the upper region and expands the lower one so
        // the slider feels more responsive across its full travel.
        const colorRange = sqrt(this.uniforms.colorRange);
        const velFromBuf = storage(this.velStorage, 'vec4', this.particleCount).element(instanceIndex);

        const getCellIndex = Fn(([cx, cy, cz]) => {
            const wx = uint(bitAnd(add(cx, int(10000)), int(63)));
            const wy = uint(bitAnd(add(cy, int(10000)), int(63)));
            const wz = uint(bitAnd(add(cz, int(10000)), int(63)));
            return add(wx, add(mul(wy, uint(this.GRID_X)), mul(wz, uint(this.GRID_X * this.GRID_Y))));
        });

        const getSmoothDensity = Fn(([p]) => {
            const fPos = div(p, this.uniforms.coherence).sub(0.5);
            const base = floor(fPos);
            const f = fract(fPos);
            
            const bx = int(base.x); const by = int(base.y); const bz = int(base.z);
            const bx1 = bx.add(1);  const by1 = by.add(1);  const bz1 = bz.add(1);
            
            const sBuf = storage(this.gridCountStorage, 'uint', this.GRID_TOTAL_CELLS);
            
            const c000 = float(sBuf.element(getCellIndex(bx, by, bz)));
            const c100 = float(sBuf.element(getCellIndex(bx1, by, bz)));
            const c010 = float(sBuf.element(getCellIndex(bx, by1, bz)));
            const c110 = float(sBuf.element(getCellIndex(bx1, by1, bz)));
            
            const c001 = float(sBuf.element(getCellIndex(bx, by, bz1)));
            const c101 = float(sBuf.element(getCellIndex(bx1, by, bz1)));
            const c011 = float(sBuf.element(getCellIndex(bx, by1, bz1)));
            const c111 = float(sBuf.element(getCellIndex(bx1, by1, bz1)));
            
            const mx00 = mix(c000, c100, f.x);
            const mx10 = mix(c010, c110, f.x);
            const mx01 = mix(c001, c101, f.x);
            const mx11 = mix(c011, c111, f.x);
            
            const mx0 = mix(mx00, mx10, f.y);
            const mx1 = mix(mx01, mx11, f.y);
            
            return mix(mx0, mx1, f.z);
        });

        const density = getSmoothDensity(posFromBuf.xyz);
        const speed = length(velFromBuf.xyz);

        const pSize = mul(posFromBuf.w, this.uniforms.pointSize, float(0.4), this.uniforms.overdrawParticleScale);
        const finalSize = max(pSize, float(0.06));
        const lQuadPos = positionLocal.mul(finalSize);
        const fViewPos = add(drawViewPos, vec3(lQuadPos.x, lQuadPos.y, this.uniforms.billboardOffset));
        this.material.vertexNode = cameraProjectionMatrix.mul(vec4(fViewPos, 1.0));

        const spectrumWidth = add(mul(colorRange, float(1.2)), float(0.05));
        
        // Size mode reads the per-particle size factor (posFromBuf.w)
        // directly rather than the post-multiplied finalSize. This isolates
        // the actual per-particle size variation from the global pointSize
        // uniform, so size differences become visible regardless of where
        // the user has the pointSize slider. Particles are spawned with
        // w in [0.5, 2.0], so we first normalize to [0, 1] before applying
        // the colorRange. Previously the math mapped this range into the
        // middle of the spectrum (~0.22 → 0.89), leaving the cool blues
        // and hot reds unreachable. Normalizing first guarantees the full
        // spectrum is accessible whenever colorRange is high enough.
        const sizeNorm = clamp(div(sub(posFromBuf.w, float(0.5)), float(1.5)), 0.0, 1.0);
        const sizeVal = clamp(mul(sizeNorm, spectrumWidth), 0.0, 1.0);
        // Velocity mode uses sqrt compression so the full spectrum maps
        // across the typical particle-velocity range. Without this, in any
        // settled system most particles cluster around the same magnitude
        // and previously mapped to one solid color in the blue end. Sqrt
        // expands the low end and compresses the high end so the spectrum
        // becomes sensitive to differences across the working range.
        const velVal = clamp(div(sqrt(speed), mul(spectrumWidth, float(5.0))), 0.0, 1.0);
        // Density mode had an inverted relationship with spectrumWidth
        // compared to size/velocity (multiplied instead of divided), which
        // squashed typical density values into the low-blue end and made
        // density nearly impossible to read visually. Switched to the
        // size/velocity pattern with a scaling factor calibrated against
        // the spatial-hash cell capacity (32) so typical mid-cluster
        // densities of 4-8 land in mid-spectrum.
        // Density mode: the old linear scale (density / (spectrumWidth*12))
        // mapped the LOW cell counts that dominate a spread-out field down to
        // t≈0 — and spectralColor(0) is red — so most particles came out red,
        // while truly dense cores saturated to t≈1 which is ALSO red. Fixed two
        // ways: (1) log2 compression so the huge dynamic range of cell counts
        // (1 … many hundreds) spreads across the scale instead of bunching at
        // the bottom; (2) map into a non-wrapping blue→red heatmap arc
        // (sparse = blue, dense = red) so neither end collides on red. The /6
        // is the one calibration knob — raise it if dense cores read too hot.
        const dNorm = clamp(div(log2(add(float(density), 1.0)), mul(spectrumWidth, float(6.0))), 0.0, 1.0);
        const densityVal = mul(sub(float(1.0), dNorm), float(0.66));
        
        const sizeColor = spectralColor(sizeVal);
        const velColor = spectralColor(velVal);
        const densityColor = spectralColor(densityVal);
        const baseColor = specCore(colorRange);
        
        // Mono used to be pure white, which made audio + trails wash the whole
        // system out. Keep it simple, but not white: a base spectral hue with
        // audio phase drift so the particle engine stays technicolor even when
        // old atlas codes or user settings land on colorMode 0.
        const monoAudioColor = spectralColor(fract(add(colorRange, add(mul(this.uniforms.audioBeat, float(0.23)), mul(this.uniforms.audioRms, float(0.09))))));
        const baseModeColor = select(colorMode.equal(1), sizeColor, 
                            select(colorMode.equal(2), velColor,
                                select(colorMode.equal(3), densityColor, monoAudioColor)));

        // Perceptual gamma curve on saturation: human color response to
        // white-mixing is non-linear. Raw linear mix produces a slider
        // where the lower 60% all looks "desaturated" and color only
        // really blooms in the top 25%. Square-rooting the slider value
        // (gamma 2.0) reshapes the response so saturation feels even
        // across the full travel — 50% slider produces a perceptibly
        // half-saturated result instead of an almost-white one.
        const audioColorBoost = clamp(add(mul(this.uniforms.audioRms, float(0.16)), mul(this.uniforms.audioBeat, float(0.28))), 0.0, 0.40);
        const satPerceptual = clamp(add(sqrt(this.uniforms.sat), add(float(0.18), audioColorBoost)), 0.0, 1.0);
        const finalColor = mix(mul(baseModeColor, float(0.36)), baseModeColor, satPerceptual);

        // Avoid uv() here. Some three/webgpu material paths compile this
        // node against non-quad helper geometries while the main storage
        // mesh is hidden, which triggers "Vertex attribute uv not found".
        // positionLocal.xy is already the same -0.5..0.5 quad domain for
        // the particle plane and does not require a uv vertex attribute.
        const uPos = positionLocal.xy;
        const distCirc = length(uPos);
        const distSquare = max(abs(uPos.x), abs(uPos.y));
        const distDiamond = add(abs(uPos.x), abs(uPos.y));
        
        const dist = select(this.uniforms.shape.equal(1), distSquare,
                       select(this.uniforms.shape.equal(2), distDiamond, distCirc));
                       
        const mask = step(dist, float(0.5));
        
        const life = velFromBuf.w;
        const fadeMod = select(this.uniforms.halfLife.lessThan(29.5), clamp(mul(life, 3.0), 0.0, 1.0), float(1.0));
        
        this.material.colorNode = vec4(finalColor, mul(this.uniforms.pointOpacity, mul(this.uniforms.overdrawOpacityScale, mul(mask, fadeMod))));
    }

    setupRibbon() {
        if (this.ribbonMesh) {
            this.scene.remove(this.ribbonMesh);
        }
        const N = Math.max(2, resolveRibbonParticleCount(window.S.freeEnergy, this.particleCount));
        this._ribbonN = N;
        this._ribbonCapacityN = N;
        const S = 24;
        this._ribbonS = S;
        
        const totalPoints = N * S;
        const totalVerts = totalPoints * 2;
        const maxInstances = (N - 1) * S;

        this.ribbonPosStorage = new THREE.StorageBufferAttribute(new Float32Array(totalVerts * 4), 4);
        this.ribbonColStorage = new THREE.StorageBufferAttribute(new Float32Array(totalVerts * 4), 4);

        this.ribbonMesh = this._makeSegmentMesh(
            this.ribbonPosStorage, this.ribbonColStorage, totalVerts, maxInstances, 2
        );
        this.scene.add(this.ribbonMesh);

        const pBuf = storage(this.posStorage, 'vec4', this.particleCount);
        const vBuf = storage(this.velStorage, 'vec4', this.particleCount);
        const outPos = storage(this.ribbonPosStorage, 'vec4', totalVerts);
        const outCol = storage(this.ribbonColStorage, 'vec4', totalVerts);
        const U = this.uniforms;
        
        const hermitePos = Fn(([p1, p2, m1, m2, t]) => {
            const t2 = mul(t, t);
            const t3 = mul(t2, t);
            const h00 = add(sub(mul(2.0, t3), mul(3.0, t2)), 1.0);
            const h10 = add(sub(t3, mul(2.0, t2)), t);
            const h01 = sub(mul(3.0, t2), mul(2.0, t3));
            const h11 = sub(t3, t2);
            return add(add(mul(p1, h00), mul(m1, h10)), add(mul(p2, h01), mul(m2, h11)));
        });

        const hermiteTan = Fn(([p1, p2, m1, m2, t]) => {
            const t2 = mul(t, t);
            const dh00 = sub(mul(6.0, t2), mul(6.0, t));
            const dh10 = add(sub(mul(3.0, t2), mul(4.0, t)), 1.0);
            const dh01 = sub(mul(6.0, t), mul(6.0, t2));
            const dh11 = sub(mul(3.0, t2), mul(2.0, t));
            return add(add(mul(p1, dh00), mul(m1, dh10)), add(mul(p2, dh01), mul(m2, dh11)));
        });

        // Local density helpers — getSmoothDensity lives in setupMaterial()'s
        // scope and is NOT visible here. Calling it from this method threw at
        // shader-build time and broke the whole compute pipeline (the graphics
        // regression). Re-declare the helpers locally, matching the per-scope
        // pattern used for getCellIndex elsewhere. Uses instance props
        // (gridCountStorage, uniforms.coherence, GRID_*) so it reads the same
        // populated grid the physics pass filled.
        const getCellIndex = Fn(([cx, cy, cz]) => {
            const wx = uint(bitAnd(add(cx, int(10000)), int(63)));
            const wy = uint(bitAnd(add(cy, int(10000)), int(63)));
            const wz = uint(bitAnd(add(cz, int(10000)), int(63)));
            return add(wx, add(mul(wy, uint(this.GRID_X)), mul(wz, uint(this.GRID_X * this.GRID_Y))));
        });
        const getSmoothDensity = Fn(([p]) => {
            const fPos = div(p, this.uniforms.coherence).sub(0.5);
            const base = floor(fPos);
            const f = fract(fPos);
            const bx = int(base.x); const by = int(base.y); const bz = int(base.z);
            const bx1 = bx.add(1);  const by1 = by.add(1);  const bz1 = bz.add(1);
            const sBuf = storage(this.gridCountStorage, 'uint', this.GRID_TOTAL_CELLS);
            const c000 = float(sBuf.element(getCellIndex(bx, by, bz)));
            const c100 = float(sBuf.element(getCellIndex(bx1, by, bz)));
            const c010 = float(sBuf.element(getCellIndex(bx, by1, bz)));
            const c110 = float(sBuf.element(getCellIndex(bx1, by1, bz)));
            const c001 = float(sBuf.element(getCellIndex(bx, by, bz1)));
            const c101 = float(sBuf.element(getCellIndex(bx1, by, bz1)));
            const c011 = float(sBuf.element(getCellIndex(bx, by1, bz1)));
            const c111 = float(sBuf.element(getCellIndex(bx1, by1, bz1)));
            const mx00 = mix(c000, c100, f.x);
            const mx10 = mix(c010, c110, f.x);
            const mx01 = mix(c001, c101, f.x);
            const mx11 = mix(c011, c111, f.x);
            const mx0 = mix(mx00, mx10, f.y);
            const mx1 = mix(mx01, mx11, f.y);
            return mix(mx0, mx1, f.z);
        });

        const computeRibbon = Fn(() => {
            const tId = instanceIndex;
            If(tId.lessThan(uint(totalPoints)), () => {
                const SUint = uint(S);
                const pIdx = div(tId, SUint);
                const subIdx = sub(tId, mul(pIdx, SUint));
                const u = div(float(subIdx), float(S));

                const Nm1 = uint(N - 1);
                const Nm2 = uint(Math.max(0, N - 2));

                const i0 = select(pIdx.greaterThan(uint(0)), sub(pIdx, uint(1)), uint(0));
                const i1 = pIdx;
                const i2 = select(pIdx.lessThan(Nm1), add(pIdx, uint(1)), Nm1);
                const i3 = select(pIdx.lessThan(Nm2), add(pIdx, uint(2)), Nm1);

                const p0 = pBuf.element(i0).xyz;
                const p1 = pBuf.element(i1).xyz;
                const p2 = pBuf.element(i2).xyz;
                const p3 = pBuf.element(i3).xyz;

                const tension = mul(U.trailLen, 0.1);
                const m1 = mul(sub(p2, p0), tension);
                const m2 = mul(sub(p3, p1), tension);

                const pos = hermitePos(p1, p2, m1, m2, u);
                const rawTan = hermiteTan(p1, p2, m1, m2, u);
                const validTan = select(length(rawTan).greaterThan(0.0001), normalize(rawTan), vec3(0,1,0));

                const worldOffset = vec3(U.offsetX, U.offsetY, U.offsetZ);
                const toCam = normalize(sub(U.camPos, add(pos, worldOffset)));
                const norm = normalize(cross(validTan, toCam));
                // Trail half-width: thinner than particles, with a sqrt
                // remap so growth against resolution is gentle in the
                // upper range. Previously `pointSize * 0.5` made trails
                // outgrow particles fast as resolution increased; the new
                // formula keeps them visually subordinate to the cloud.
                const hw = mul(sqrt(U.pointSize), 0.25, U.overdrawParticleScale);

                const outIdx = mul(tId, uint(2));
                outPos.element(outIdx).assign(vec4(add(pos, mul(norm, hw)), 1.0));
                outPos.element(add(outIdx, uint(1))).assign(vec4(sub(pos, mul(norm, hw)), 1.0));

                const life1 = vBuf.element(i1).w;
                const life2 = vBuf.element(i2).w;
                const life = mix(life1, life2, u);
                
                const dist = length(sub(p2, p1));
                const distFade = clamp(sub(1.0, div(sub(dist, 60.0), 40.0)), 0.0, 1.0);
                const baseFade = select(U.halfLife.lessThan(29.5), clamp(mul(life, 4.0), 0.0, 1.0), 1.0);
                // Keep trail alpha below particles while staying visible at
                // the low default opacity.
                // Previously the trails inherited 1:1 from system opacity,
                // which made them blow out to pure white even at slider=0.05.
                // The 0.22 scale means the full slider range now scales
                // from invisible up to "what 0.1 used to look like" — a
                // gradient that actually fits the system's natural use.
                const fadeAlpha = mul(mul(baseFade, distFade), mul(U.pointOpacity, mul(U.overdrawOpacityScale, float(0.055))));

                const speed1 = length(vBuf.element(i1).xyz);
                const speed2 = length(vBuf.element(i2).xyz);
                const speed = mix(speed1, speed2, u);
                
                const sw = add(mul(sqrt(U.colorRange), 1.2), 0.05);
                // Sqrt compression — matches main particle material for
                // consistency between trails and their parent particles.
                const velVal = clamp(div(sqrt(speed), mul(sw, 5.0)), 0.0, 1.0);
                const baseColor = specCore(sqrt(U.colorRange));

                // Size + density modes previously weren't implemented for
                // ribbons: size was hardcoded to a constant spectralColor(0.5)
                // and density fell through to vec3(1.0) — pure white, blown
                // out. Compute both the same way the particle material does so
                // trails color correctly in every mode.
                //   Size: per-particle w-factor (interpolated across the
                //   segment), normalized from [0.5,2.0] → [0,1].
                const wMid = mix(pBuf.element(i1).w, pBuf.element(i2).w, u);
                const sizeNorm = clamp(div(sub(wMid, float(0.5)), float(1.5)), 0.0, 1.0);
                const sizeVal = clamp(mul(sizeNorm, sw), 0.0, 1.0);
                //   Density: smoothed local density at the segment midpoint,
                //   scaled like the particle material (÷ sw·12).
                const densityRb = getSmoothDensity(pos);
                const densityVal = clamp(div(float(densityRb), mul(sw, 12.0)), 0.0, 1.0);

                // Trails should not wash the cloud to white. Even in Mono
                // they inherit a spectral/base hue, and audio beats push the
                // trail saturation harder than the particle fill.
                const audioTrailPulse = clamp(add(mul(U.audioRms, float(0.16)), mul(U.audioBeat, float(0.34))), 0.0, 0.55);
                const monoTrailColor = spectralColor(fract(add(sqrt(U.colorRange), add(mul(U.audioBeat, float(0.23)), mul(U.audioRms, float(0.07))))));
                const modeColor = select(U.colorMode.equal(2), spectralColor(velVal),
                    select(U.colorMode.equal(1), spectralColor(sizeVal),
                        select(U.colorMode.equal(3), spectralColor(densityVal), monoTrailColor)));
                const trailSat = clamp(add(sqrt(U.sat), add(float(0.28), audioTrailPulse)), 0.0, 1.0);
                const fc = vec4(mix(monoTrailColor, modeColor, trailSat), fadeAlpha);

                outCol.element(outIdx).assign(fc);
                outCol.element(add(outIdx, uint(1))).assign(fc);
            });
        });
        this.computeRibbonNode = computeRibbon().compute(totalPoints);
    }

    setupLattice() {
        if (this.latticeMesh) {
            this.scene.remove(this.latticeMesh);
        }
        const N = Math.max(2, resolveLatticeParticleCount(window.S.freeEnergy, this.particleCount));
        this._latticeN = N;
        this._latticeCapacityN = N;
        const segCount = N - 1;
        const totalVerts = N * 2;
        this.latticePosStorage = new THREE.StorageBufferAttribute(new Float32Array(totalVerts * 4), 4);
        this.latticeColStorage = new THREE.StorageBufferAttribute(new Float32Array(totalVerts * 4), 4);

        this.latticeMesh = this._makeSegmentMesh(
            this.latticePosStorage, this.latticeColStorage, totalVerts, segCount, 2
        );
        this.scene.add(this.latticeMesh);

        const pBuf = storage(this.posStorage, 'vec4', this.particleCount);
        const vBuf = storage(this.velStorage, 'vec4', this.particleCount);
        const outPos = storage(this.latticePosStorage, 'vec4', totalVerts);
        const outCol = storage(this.latticeColStorage, 'vec4', totalVerts);
        const U = this.uniforms;
        const Nm1 = uint(N - 1);

        // Local density helpers (see setupRibbon for why — getSmoothDensity
        // isn't in this scope; calling the setupMaterial version broke the
        // render). Re-declared locally against the same instance grid buffers.
        const getCellIndex = Fn(([cx, cy, cz]) => {
            const wx = uint(bitAnd(add(cx, int(10000)), int(63)));
            const wy = uint(bitAnd(add(cy, int(10000)), int(63)));
            const wz = uint(bitAnd(add(cz, int(10000)), int(63)));
            return add(wx, add(mul(wy, uint(this.GRID_X)), mul(wz, uint(this.GRID_X * this.GRID_Y))));
        });
        const getSmoothDensity = Fn(([p]) => {
            const fPos = div(p, this.uniforms.coherence).sub(0.5);
            const base = floor(fPos);
            const f = fract(fPos);
            const bx = int(base.x); const by = int(base.y); const bz = int(base.z);
            const bx1 = bx.add(1);  const by1 = by.add(1);  const bz1 = bz.add(1);
            const sBuf = storage(this.gridCountStorage, 'uint', this.GRID_TOTAL_CELLS);
            const c000 = float(sBuf.element(getCellIndex(bx, by, bz)));
            const c100 = float(sBuf.element(getCellIndex(bx1, by, bz)));
            const c010 = float(sBuf.element(getCellIndex(bx, by1, bz)));
            const c110 = float(sBuf.element(getCellIndex(bx1, by1, bz)));
            const c001 = float(sBuf.element(getCellIndex(bx, by, bz1)));
            const c101 = float(sBuf.element(getCellIndex(bx1, by, bz1)));
            const c011 = float(sBuf.element(getCellIndex(bx, by1, bz1)));
            const c111 = float(sBuf.element(getCellIndex(bx1, by1, bz1)));
            const mx00 = mix(c000, c100, f.x);
            const mx10 = mix(c010, c110, f.x);
            const mx01 = mix(c001, c101, f.x);
            const mx11 = mix(c011, c111, f.x);
            const mx0 = mix(mx00, mx10, f.y);
            const mx1 = mix(mx01, mx11, f.y);
            return mix(mx0, mx1, f.z);
        });

        const computeLattice = Fn(() => {
            const i = instanceIndex;
            If(i.lessThan(uint(N)), () => {
                const i0 = select(i.greaterThan(uint(0)), sub(i, uint(1)), uint(0));
                const i2 = select(i.lessThan(Nm1), add(i, uint(1)), Nm1);
                const pos = pBuf.element(i).xyz;
                const tangent = normalize(sub(pBuf.element(i2).xyz, pBuf.element(i0).xyz));
                const worldOffset = vec3(U.offsetX, U.offsetY, U.offsetZ);
                const norm = normalize(cross(tangent, normalize(sub(U.camPos, add(pos, worldOffset)))));
                // Trail half-width: thinner than particles, sqrt remap on
                // resolution so growth against the resolution slider is
                // gentle in the upper range. Matches the ribbon material.
                const hw = mul(sqrt(U.pointSize), 0.25, U.overdrawParticleScale);
                // Trail length scalar — extends segment along tangent so
                // the slider visibly affects the lattice (not just ribbons).
                const segScale = mul(U.trailLen, 0.1);
                const aOffset = mul(tangent, mul(hw, segScale));
                outPos.element(mul(i, uint(2))).assign(vec4(add(add(pos, mul(norm, hw)), aOffset), 1.0));
                outPos.element(add(mul(i, uint(2)), uint(1))).assign(vec4(sub(add(pos, aOffset), mul(norm, hw)), 1.0));

                const life = vBuf.element(i).w;
                const dist = length(sub(pBuf.element(i2).xyz, pos));
                const distFade = clamp(sub(1.0, div(sub(dist, 60.0), 40.0)), 0.0, 1.0);
                const baseFade = select(U.halfLife.lessThan(29.5), clamp(mul(life, 4.0), 0.0, 1.0), 1.0);
                // Keep lattice alpha below particles while staying visible at
                // the low default opacity.
                // Matches the ribbon material — prevents blow-out at low
                // opacity slider values; full slider range maps to
                // "previously 0 → 0.1" effective alpha.
                const fadeAlpha = mul(mul(baseFade, distFade), mul(U.pointOpacity, mul(U.overdrawOpacityScale, float(0.055))));

                const vel = vBuf.element(i).xyz;
                const speed = length(vel);
                const sw = add(mul(sqrt(U.colorRange), 1.2), 0.05);
                // Sqrt compression — matches main material.
                const velVal = clamp(div(sqrt(speed), mul(sw, 5.0)), 0.0, 1.0);
                const baseColor = specCore(sqrt(U.colorRange));

                // Size + density were unimplemented for the lattice (size was a
                // constant, density fell through to white). Compute both like
                // the particle material so the lattice colors correctly in
                // every mode.
                const sizeNorm = clamp(div(sub(pBuf.element(i).w, float(0.5)), float(1.5)), 0.0, 1.0);
                const sizeVal = clamp(mul(sizeNorm, sw), 0.0, 1.0);
                const densityLt = getSmoothDensity(pos);
                const densityVal = clamp(div(float(densityLt), mul(sw, 12.0)), 0.0, 1.0);

                // Lattice follows the same colorful trail rule as
                // ribbons: Mono particles can stay neutral, but trail geometry
                // should not be a white additive veil over the audio color.
                const audioTrailPulse = clamp(add(mul(U.audioRms, float(0.16)), mul(U.audioBeat, float(0.34))), 0.0, 0.55);
                const monoTrailColor = spectralColor(fract(add(sqrt(U.colorRange), add(mul(U.audioBeat, float(0.23)), mul(U.audioRms, float(0.07))))));
                const modeColor = select(U.colorMode.equal(2), spectralColor(velVal),
                    select(U.colorMode.equal(1), spectralColor(sizeVal),
                        select(U.colorMode.equal(3), spectralColor(densityVal), monoTrailColor)));
                const trailSat = clamp(add(sqrt(U.sat), add(float(0.28), audioTrailPulse)), 0.0, 1.0);
                const fc = vec4(mix(monoTrailColor, modeColor, trailSat), fadeAlpha);
                outCol.element(mul(i, uint(2))).assign(fc);
                outCol.element(add(mul(i, uint(2)), uint(1))).assign(fc);
            });
        });
        this.computeLatticeNode = computeLattice().compute(N);
    }

    _makeSegmentMesh(posStorage, colStorage, totalStorageVerts, instanceCount, cornerStride) {
        const quadGeo = new THREE.BufferGeometry();
        const quadPos = new Float32Array([0,0,0, 1,0,0, 0,1,0, 1,1,0]);
        const quadUv = new Float32Array([0,0, 1,0, 0,1, 1,1]);
        quadGeo.setAttribute('position', new THREE.BufferAttribute(quadPos, 3));
        quadGeo.setAttribute('uv', new THREE.BufferAttribute(quadUv, 2));
        quadGeo.setIndex([0,1,2, 1,3,2]);
        const mat = new THREE.MeshBasicNodeMaterial();
        mat.transparent = true;
        mat.blending = THREE.AdditiveBlending;
        mat.depthWrite = false;
        mat.depthTest = true;
        mat.side = THREE.DoubleSide;

        const rPosBuf = storage(posStorage, 'vec4', totalStorageVerts);
        const rColBuf = storage(colStorage, 'vec4', totalStorageVerts);
        const stride = uint(cornerStride);
        const storageIdx = add(mul(instanceIndex, stride), uint(vertexIndex));
        const wPos = rPosBuf.element(storageIdx);
        const worldOffset = vec3(this.uniforms.offsetX, this.uniforms.offsetY, this.uniforms.offsetZ);
        const rViewPos = modelViewMatrix.mul(vec4(add(wPos.xyz, worldOffset), 1.0)).xyz;
        const rCenterViewPos = modelViewMatrix.mul(vec4(worldOffset, 1.0)).xyz;
        const rCenteredViewPos = vec3(sub(rViewPos.x, rCenterViewPos.x), sub(rViewPos.y, rCenterViewPos.y), rViewPos.z);
        const rDrawViewPos = mix(rViewPos, rCenteredViewPos, this.uniforms.offscreenCenterLock);
        mat.vertexNode = cameraProjectionMatrix.mul(vec4(rDrawViewPos, 1.0));
        const rCol = rColBuf.element(storageIdx);
        mat.colorNode = vec4(rCol.xyz, rCol.w);

        const mesh = new THREE.InstancedMesh(quadGeo, mat, instanceCount);
        mesh.frustumCulled = false;
        mesh.matrixAutoUpdate = false;
        mesh.matrixWorld.identity();
        mesh.visible = false;
        mesh.count = 0;
        return mesh;
    }

    setupGpuPointCloud() {
        if (!THREE.PointsNodeMaterial) {
            this.gpuPointCloud = null;
            return;
        }

        const count = Math.max(1, this.particleCount | 0);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
        geo.setDrawRange(0, 0);

        const mat = new THREE.PointsNodeMaterial({
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: false
        });
        mat.transparent = true;
        mat.blending = THREE.AdditiveBlending;
        mat.depthWrite = false;
        mat.depthTest = false;
        mat.opacity = 1;

        const idx = uint(vertexIndex);
        const posFromBuf = storage(this.posStorage, 'vec4', this.particleCount).element(idx);
        const velFromBuf = storage(this.velStorage, 'vec4', this.particleCount).element(idx);

        const getCellIndex = Fn(([cx, cy, cz]) => {
            const wx = uint(bitAnd(add(cx, int(10000)), int(63)));
            const wy = uint(bitAnd(add(cy, int(10000)), int(63)));
            const wz = uint(bitAnd(add(cz, int(10000)), int(63)));
            return add(wx, add(mul(wy, uint(this.GRID_X)), mul(wz, uint(this.GRID_X * this.GRID_Y))));
        });

        const getSmoothDensity = Fn(([p]) => {
            const fPos = div(p, this.uniforms.coherence).sub(0.5);
            const base = floor(fPos);
            const f = fract(fPos);
            const bx = int(base.x); const by = int(base.y); const bz = int(base.z);
            const bx1 = bx.add(1);  const by1 = by.add(1);  const bz1 = bz.add(1);
            const sBuf = storage(this.gridCountStorage, 'uint', this.GRID_TOTAL_CELLS);
            const c000 = float(sBuf.element(getCellIndex(bx, by, bz)));
            const c100 = float(sBuf.element(getCellIndex(bx1, by, bz)));
            const c010 = float(sBuf.element(getCellIndex(bx, by1, bz)));
            const c110 = float(sBuf.element(getCellIndex(bx1, by1, bz)));
            const c001 = float(sBuf.element(getCellIndex(bx, by, bz1)));
            const c101 = float(sBuf.element(getCellIndex(bx1, by, bz1)));
            const c011 = float(sBuf.element(getCellIndex(bx, by1, bz1)));
            const c111 = float(sBuf.element(getCellIndex(bx1, by1, bz1)));
            const mx00 = mix(c000, c100, f.x);
            const mx10 = mix(c010, c110, f.x);
            const mx01 = mix(c001, c101, f.x);
            const mx11 = mix(c011, c111, f.x);
            const mx0 = mix(mx00, mx10, f.y);
            const mx1 = mix(mx01, mx11, f.y);
            return mix(mx0, mx1, f.z);
        });

        const worldOffset = vec3(this.uniforms.offsetX, this.uniforms.offsetY, this.uniforms.offsetZ);
        const worldPos = add(posFromBuf.xyz, worldOffset);
        const viewPos = modelViewMatrix.mul(vec4(worldPos, 1.0)).xyz;
        const centerViewPos = modelViewMatrix.mul(vec4(worldOffset, 1.0)).xyz;
        const centeredViewPos = vec3(sub(viewPos.x, centerViewPos.x), sub(viewPos.y, centerViewPos.y), viewPos.z);
        const drawViewPos = mix(viewPos, centeredViewPos, this.uniforms.offscreenCenterLock);
        mat.vertexNode = cameraProjectionMatrix.mul(vec4(drawViewPos, 1.0));

        const spectrumWidth = add(mul(sqrt(this.uniforms.colorRange), 1.2), 0.05);
        const speed = length(velFromBuf.xyz);
        const sizeNorm = clamp(div(sub(posFromBuf.w, float(0.5)), float(1.5)), 0.0, 1.0);
        const sizeVal = clamp(mul(sizeNorm, spectrumWidth), 0.0, 1.0);
        const velVal = clamp(div(sqrt(speed), mul(spectrumWidth, float(5.0))), 0.0, 1.0);
        const dNorm = clamp(div(log2(add(float(getSmoothDensity(posFromBuf.xyz)), 1.0)), mul(spectrumWidth, float(6.0))), 0.0, 1.0);
        const densityVal = mul(sub(float(1.0), dNorm), float(0.66));
        const monoAudioColor = spectralColor(fract(add(sqrt(this.uniforms.colorRange), add(mul(this.uniforms.audioBeat, float(0.23)), mul(this.uniforms.audioRms, float(0.09))))));
        const baseModeColor = select(this.uniforms.colorMode.equal(1), spectralColor(sizeVal),
            select(this.uniforms.colorMode.equal(2), spectralColor(velVal),
                select(this.uniforms.colorMode.equal(3), spectralColor(densityVal), monoAudioColor)));
        const audioColorBoost = clamp(add(mul(this.uniforms.audioRms, float(0.16)), mul(this.uniforms.audioBeat, float(0.28))), 0.0, 0.40);
        const satPerceptual = clamp(add(sqrt(this.uniforms.sat), add(float(0.18), audioColorBoost)), 0.0, 1.0);
        const finalColor = mix(mul(baseModeColor, float(0.36)), baseModeColor, satPerceptual);
        const fadeMod = select(this.uniforms.halfLife.lessThan(29.5), clamp(mul(velFromBuf.w, 3.0), 0.0, 1.0), float(1.0));
        mat.colorNode = vec4(finalColor, mul(this.uniforms.pointOpacity, mul(this.uniforms.overdrawOpacityScale, fadeMod)));

        const cloud = new THREE.Points(geo, mat);
        cloud.frustumCulled = false;
        cloud.renderOrder = 29;
        cloud.visible = false;
        this.gpuPointCloud = cloud;
        this.scene.add(cloud);
    }

    syncGpuPointCloud(alpha = 1, displayCount = null) {
        if (!this.gpuPointCloud) return;
        const active = !!(this.isGpuPointsMode() && alpha > 0.001 && window.S?.showParticles !== false);
        const cloud = this.gpuPointCloud;
        cloud.visible = active;
        if (!active) {
            cloud.geometry.setDrawRange(0, 0);
            return;
        }
        const drawCount = Number.isFinite(Number(displayCount))
            ? Math.max(0, Math.floor(Number(displayCount)))
            : this.getFrameDisplayParticleCount(window.S.freeEnergy);
        cloud.geometry.setDrawRange(0, drawCount);
        if (cloud.material) {
            cloud.material.opacity = Math.max(0, Math.min(1, Number(alpha) || 0));
            cloud.material.transparent = true;
        }
    }


    setupCompatParticleCloud() {
        if (this.compatParticleCloud) return;
        const count = Math.max(1, this.particleCount | 0);
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const modes = new Uint8Array(count);
        for (let i = 0; i < count; i++) modes[i] = (Math.abs(Math.sin(i * 12.9898) * 9999) | 0) % 4;
        this.compatParticlePositions = positions;
        this.compatParticleColors = colors;
        this.compatParticleModeIds = modes;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        const mat = new THREE.PointsMaterial({
            size: Number(window.S?.compatParticleSize) || 0.60,
            sizeAttenuation: true,
            vertexColors: true,
            transparent: true,
            opacity: Number(window.S?.compatParticleOpacity) || 0.20,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: false,
            alphaTest: 0.0
        });

        const cloud = new THREE.Points(geo, mat);
        cloud.frustumCulled = false;
        cloud.renderOrder = 30;
        cloud.visible = this.isPointsFallbackActive();
        this.compatParticleCloud = cloud;
        this.scene.add(cloud);
        this.syncCompatParticleCloud(true);
    }


    spectralCompatColor(t) {
        const x = ((Number(t) || 0) % 1 + 1) % 1;
        return {
            r: Math.min(1, Math.max(0, Math.abs(x * 6 - 3) - 1)),
            g: Math.min(1, Math.max(0, 2 - Math.abs(x * 6 - 2))),
            b: Math.min(1, Math.max(0, 2 - Math.abs(x * 6 - 4)))
        };
    }


    _makeCompatLineLayer(name, maxSegments, opacity, renderOrder) {
        const safeSegments = Math.max(1, Math.floor(maxSegments || 1));
        const positions = new Float32Array(safeSegments * 2 * 3);
        const colors = new Float32Array(safeSegments * 2 * 3);

        // Use one dynamic LineSegments draw call per structure layer. The last
        // pass used instanced boxes for every segment; it looked chunky and ate
        // perf. Lines are thinner/cheaper and closer to the older ribbon/curve
        // read while the native/TSL renderer is still disabled.
        const geo = new THREE.BufferGeometry();
        const posAttr = new THREE.BufferAttribute(positions, 3);
        const colAttr = new THREE.BufferAttribute(colors, 3);
        if (THREE.DynamicDrawUsage !== undefined) {
            posAttr.setUsage(THREE.DynamicDrawUsage);
            colAttr.setUsage(THREE.DynamicDrawUsage);
        }
        geo.setAttribute('position', posAttr);
        geo.setAttribute('color', colAttr);
        const uvAttr = new THREE.BufferAttribute(new Float32Array(safeSegments * 2 * 2), 2);
        if (THREE.DynamicDrawUsage !== undefined) uvAttr.setUsage(THREE.DynamicDrawUsage);
        for (let i = 0; i < safeSegments; i++) {
            const u = i * 4;
            uvAttr.array[u + 0] = 0; uvAttr.array[u + 1] = 0;
            uvAttr.array[u + 2] = 1; uvAttr.array[u + 3] = 1;
        }
        geo.setAttribute('uv', uvAttr);
        geo.setDrawRange(0, 0);
        const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: false,
        }));
        line.name = name;
        line.frustumCulled = false;
        line.renderOrder = renderOrder;
        line.visible = false;
        this.scene.add(line);
        return {
            line,
            positions,
            colors,
            maxSegments: safeSegments,
            segments: 0,
            color: new THREE.Color(),
        };
    }

    setupCompatStructureLayers() {
        if (this.compatRibbonLayer || this.compatCurveLayer || this.compatCellLayer) return;
        const S = window.S || {};
        const ribbonBudget = Math.max(32, Math.min(260, Math.floor(Number(S.compatRibbonBudget) || 220)));
        const curveBudget = Math.max(16, Math.min(120, Math.floor(Number(S.compatCurveBudget) || 80)));
        const cellBudget = Math.max(16, Math.min(120, Math.floor(Number(S.compatCellBudget) || 80)));
        this.compatRibbonLayer = this._makeCompatLineLayer('compat-ribbons', ribbonBudget, 0.045, 8);
        this.compatCurveLayer = this._makeCompatLineLayer('compat-curves', curveBudget, 0.040, 7);
        this.compatCellLayer = this._makeCompatLineLayer('compat-cellular-web', cellBudget, 0.035, 6);
        const depth = Math.max(2, Math.min(16, Math.floor(Number(S.compatStructureDepth) || 8)));
        const samples = Math.max(64, Math.min(4096, Math.floor(ribbonBudget / Math.max(1, depth - 1))));
        this.compatTrailDepth = depth;
        this.compatTrailSamples = samples;
        this.compatTrailHistory = new Float32Array(samples * depth * 3);
        this.compatTrailHead = 0;
        this.compatTrailInitialized = false;
    }

    _musicModeActive() {
        return !!(window.S?.audioReactive !== false && window.audio && window.audio.active);
    }

    _compatColorForParticle(idx, hue, sat, lightness, beat, lane = 0) {
        const col = this.cpuColArray;
        const pos = this.cpuPosArray;
        const vel = this.cpuVelArray;
        const j = idx * 4;
        const baseMode = Number(window.S?.colorMode ?? 2) | 0;
        const particleMode = this.compatParticleModeIds ? this.compatParticleModeIds[idx] || 0 : 0;
        const allowMixed = window.S?.compatMixedVisualModes === true && (window.S?.compatMixedVisualModesMusicOnly === false || this._musicModeActive());
        const localMode = allowMixed && baseMode !== 0 ? (1 + ((baseMode - 1 + particleMode) % 3)) : baseMode;
        const size = pos ? Math.max(0, Math.min(2, Number(pos[j + 3]) || 1)) : 1;
        const vx = vel ? Number(vel[j + 0]) || 0 : 0;
        const vy = vel ? Number(vel[j + 1]) || 0 : 0;
        const vz = vel ? Number(vel[j + 2]) || 0 : 0;
        const speed01 = Math.min(1, Math.sqrt(vx * vx + vy * vy + vz * vz) * 0.14);
        const x = pos ? Number(pos[j + 0]) || 0 : 0;
        const y = pos ? Number(pos[j + 1]) || 0 : 0;
        const z = pos ? Number(pos[j + 2]) || 0 : 0;
        const inv = Math.max(1, Math.abs(Number((window.S_effective || window.S || {}).inversion) || 80));
        const radius01 = Math.min(1, Math.sqrt(x * x + y * y + z * z) / inv);
        let e = hue + lane * 0.07 + beat * 0.08;
        if (localMode === 0) e = hue + beat * 0.04;
        else if (localMode === 1) e += size * 0.20;
        else if (localMode === 2) e += speed01 * 0.34;
        else if (localMode === 3) e += radius01 * 0.30 + Math.sin((x + y + z) * 0.018) * 0.035;
        else if (localMode === 4) e += speed01 * 0.42 + radius01 * 0.22 + Math.sin((x - y + z) * 0.024) * 0.08;
        if (allowMixed) e += particleMode * 0.04;
        const spec = this.spectralCompatColor(e);
        const baseR = col ? (col[j + 0] || 1) : spec.r;
        const baseG = col ? (col[j + 1] || 1) : spec.g;
        const baseB = col ? (col[j + 2] || 1) : spec.b;
        const feat = window.SS_AUDIO_FEATURES || {};
        const musicColor = Math.max(0, Math.min(0.45, Number(feat.fxBeat || feat.beat || 0) * 0.20 + Number(feat.fxLevel || 0) * 0.12));
        const mixSpec = baseMode === 0 ? 0.58 + musicColor : 0.62 + musicColor;
        const lift = 0.56 + lightness * 0.34;
        return {
            r: Math.min(1, (baseR * (1 - mixSpec) + spec.r * mixSpec) * lift),
            g: Math.min(1, (baseG * (1 - mixSpec) + spec.g * mixSpec) * lift),
            b: Math.min(1, (baseB * (1 - mixSpec) + spec.b * mixSpec) * lift),
        };
    }

    _writeCompatSegment(layer, seg, ax, ay, az, bx, by, bz, ca, cb = ca) {
        if (!layer || seg >= layer.maxSegments) return seg;
        const p = layer.positions;
        const c = layer.colors;
        const vi = seg * 6;
        p[vi + 0] = ax; p[vi + 1] = ay; p[vi + 2] = az;
        p[vi + 3] = bx; p[vi + 4] = by; p[vi + 5] = bz;
        c[vi + 0] = ca.r; c[vi + 1] = ca.g; c[vi + 2] = ca.b;
        c[vi + 3] = cb.r; c[vi + 4] = cb.g; c[vi + 5] = cb.b;
        return seg + 1;
    }

    _finalizeCompatLayer(layer, segments, visible, opacityScale = 1) {
        if (!layer || !layer.line) return;
        layer.segments = Math.max(0, Math.min(layer.maxSegments, segments | 0));
        const line = layer.line;
        line.visible = !!visible && layer.segments > 0;
        if (line.position) {
            const S = window.S || {};
            line.position.set(Number(S.offsetX) || 0, Number(S.offsetY) || 0, Number(S.offsetZ) || 0);
        }
        const geo = line.geometry;
        if (geo) geo.setDrawRange(0, layer.segments * 2);
        if (line.visible && geo) {
            const pAttr = geo.getAttribute('position');
            const cAttr = geo.getAttribute('color');
            if (pAttr) pAttr.needsUpdate = true;
            if (cAttr) cAttr.needsUpdate = true;
        }
        if (line.material) {
            const base = Number(window.S?.compatStructureOpacity) || 0.045;
            line.material.opacity = Math.max(0, Math.min(0.11, base * opacityScale));
        }
    }

    _hideCompatStructureLayers() {
        for (const layer of [this.compatRibbonLayer, this.compatCurveLayer, this.compatCellLayer]) {
            if (!layer || !layer.line) continue;
            layer.segments = 0;
            layer.line.visible = false;
            if (layer.line.geometry) layer.line.geometry.setDrawRange(0, 0);
            if (layer.line.material) layer.line.material.opacity = 0;
        }
    }

    _wakeCompatParticleMotion(active = 0, strength = 1.0) {
        const pos = this.cpuPosArray;
        const vel = this.cpuVelArray;
        if (!pos || !vel || active <= 0) return;
        const S = window.S_effective || window.S || {};
        const inversion = Math.max(8, Math.abs(Number(S.inversion ?? 30) || 30));
        const hue = (((Number(S.hue ?? 0.59) || 0) % 1) + 1) % 1;
        const t = performance.now() * 0.001;
        const wake = Math.max(0.25, Math.min(4.0, Number(strength) || 1));
        const count = Math.min(active | 0, pos.length / 4 | 0);
        for (let i = 0, j = 0; i < count; i++, j += 4) {
            let x = pos[j + 0], y = pos[j + 1], z = pos[j + 2];
            let r2 = x * x + y * y + z * z;
            const seed = ((Math.sin((i + 1) * 12.9898 + (pos[j + 3] || 1) * 78.233) * 43758.5453) % 1 + 1) % 1;
            if (!Number.isFinite(r2) || r2 < 1e-5) {
                const a = seed * Math.PI * 2 + hue * 4;
                const b = ((seed * 17.17) % 1) * Math.PI * 2;
                const rr = inversion * (0.05 + ((seed * 31.31) % 1) * 0.30);
                x = Math.cos(a) * Math.sin(b) * rr;
                y = Math.sin(a) * Math.sin(b) * rr;
                z = Math.cos(b) * rr;
                pos[j + 0] = x; pos[j + 1] = y; pos[j + 2] = z;
                r2 = x * x + y * y + z * z;
            }
            const r = Math.sqrt(r2 + 1e-6);
            const nx = x / r, ny = y / r, nz = z / r;
            const swirl = 0.22 + seed * 0.55;
            const phase = seed * Math.PI * 2 + t * 0.15 + hue * 6.283;
            const tx = -nz + Math.sin(phase) * 0.35;
            const ty = Math.cos(phase * 0.73) * 0.45;
            const tz = nx + Math.cos(phase) * 0.35;
            vel[j + 0] = (vel[j + 0] || 0) * 0.35 + (tx * swirl + nx * 0.10) * wake;
            vel[j + 1] = (vel[j + 1] || 0) * 0.35 + (ty * swirl + ny * 0.05) * wake;
            vel[j + 2] = (vel[j + 2] || 0) * 0.35 + (tz * swirl + nz * 0.10) * wake;
            vel[j + 3] = Math.max(0.25, Math.min(1.0, Number(vel[j + 3]) || (0.4 + seed * 0.6)));
        }
    }

    updateCompatStructureLayers(force = false) {
        const S = window.S || {};
        const enabled = !!(this.isPointsFallbackActive() && S.compatStructureLayers !== false);
        const wantsAnyStructure = !!(S.showRibbons || S.tessRibbons || S.visualEffectGeometry === true || S.compatAllowManualStructure === true);
        if (!enabled || !wantsAnyStructure || !this.cpuPosArray) {
            this._hideCompatStructureLayers();
            return;
        }
        if (!this.ensureCompatStructureLayers()) return;
        const z = this.getZoomOptimizationState();
        const profile = String(S.perfProfile || 'balanced');
        const profileAdd = profile === 'potato' ? 6 : profile === 'speed' ? 4 : profile === 'quality' ? 1 : 2;
        const baseEvery = Math.max(6, Math.min(24, Math.round(Number(S.compatStructureEvery) || 8)));
        const autoEvery = Math.max(0, Math.min(8, this._compatStructureAutoEvery | 0));
        const pressure = Math.max(0, Math.min(1, Number(z.overdrawPressure) || 0));
        const every = Math.max(1, Math.round(baseEvery + profileAdd + autoEvery + z.close * 2 + pressure * 5));
        if (!force && this._perfFrame && (this._perfFrame % every) !== 0) return;
        const structureStarted = performance.now();

        const active = Math.min(
            this.getZoomDisplayParticleCount(this.getActiveParticleCount(S.freeEnergy)),
            Math.max(1, Number(S.compatParticleMaxCpuActive) || this.particleCount)
        );
        if (active <= 2) return;

        const pos = this.cpuPosArray;
        const t = performance.now() * 0.001;
        const feat = window.SS_AUDIO_FEATURES || {};
        const beat = Math.max(0, Math.min(1, Number(feat.beat) || 0));
        const tension = Math.max(0, Math.min(1.5, Number(feat.tensionRelease) || 0));
        const hue = (((Number((window.S_effective || S).hue ?? S.hue ?? 0.59) || 0) % 1) + 1) % 1;
        const sat = Math.max(0, Math.min(1.9, Number((window.S_effective || S).sat ?? S.sat ?? 1) || 1));
        const light = Math.max(0.35, Math.min(1.5, Number((window.S_effective || S).lightness ?? S.lightness ?? 0.9) || 0.9));
        const effectAmountRaw = Number(S.visualEffectAmount ?? 0.9);
        const fxExpressivity = Math.max(0.35, Math.min(2.5, Number(S.visualEffectExpressivity ?? 1.35) || 1.35));
        const fxDynamics = Math.max(0.25, Math.min(2.5, Number(S.visualEffectDynamics ?? 1.15) || 1.15));
        const effectAmount = Math.max(0, Math.min(3.0, (Number.isFinite(effectAmountRaw) ? effectAmountRaw : 0.9) * (0.78 + fxExpressivity * 0.22 + fxDynamics * 0.12)));
        const fxStyle = resolveRuntimeVisualStyle(S.visualEffectStyle, window.SS_VISUAL_EFFECT_STYLE);
        const fxOn = S.visualEffects !== false;
        const geometryFx = fxOn && S.visualEffectGeometry === true;
        // Particles are the baseline. Structure layers wake when the user
        // enables Strings/Lattice or the active visual style declares a
        // compat geometry channel.
        const ribbonFx = geometryFx && visualStyleHasGeometry(fxStyle, 'compatRibbon');
        const curveFx = geometryFx && visualStyleHasGeometry(fxStyle, 'compatCurve');
        const cellFx = geometryFx && visualStyleHasGeometry(fxStyle, 'compatCell');
        const showRibbon = S.compatRibbonLayer !== false && (!!S.showRibbons || ribbonFx);
        const showCurves = S.compatCurveLayer === true && (!!S.showRibbons || curveFx);
        const showCells = S.compatCellularLayer === true && (!!S.tessRibbons || cellFx);
        let closeTrim = 1 - z.close * 0.42 - pressure * 0.42;
        if (profile === 'speed') closeTrim *= 0.72;
        else if (profile === 'potato') closeTrim *= 0.48;
        else if (profile === 'quality') closeTrim *= 1.10;
        closeTrim = Math.max(0.06, Math.min(1.0, closeTrim));

        // Trail/ribbon history layer. This restores the old non-particle strand
        // read without waking the broken hidden TSL ribbon pass.
        const depth = this.compatTrailDepth || 8;
        const sampleTrim = Math.max(0.34, 1 - pressure * 0.58);
        const samples = Math.min(this.compatTrailSamples || 256, Math.max(8, Math.floor(active * 0.035 * sampleTrim)));
        const head = this.compatTrailHead || 0;
        const hist = this.compatTrailHistory;
        if (hist && samples > 0) {
            for (let sidx = 0; sidx < samples; sidx++) {
                const idx = (sidx * 9973 + ((sidx * 37) % 19)) % active;
                const src = idx * 4;
                const dst = (sidx * depth + head) * 3;
                hist[dst + 0] = pos[src + 0] || 0;
                hist[dst + 1] = pos[src + 1] || 0;
                hist[dst + 2] = pos[src + 2] || 0;
                if (!this.compatTrailInitialized) {
                    for (let d = 0; d < depth; d++) {
                        const dd = (sidx * depth + d) * 3;
                        hist[dd + 0] = hist[dst + 0];
                        hist[dd + 1] = hist[dst + 1];
                        hist[dd + 2] = hist[dst + 2];
                    }
                }
            }
            this.compatTrailInitialized = true;
            this.compatTrailHead = (head + 1) % depth;
        }

        let seg = 0;
        const ribbonLayer = this.compatRibbonLayer;
        if (showRibbon && ribbonLayer && hist) {
            const maxSeg = Math.min(ribbonLayer.maxSegments, Math.floor(ribbonLayer.maxSegments * closeTrim));
            const stride = Math.max(1, Math.ceil(samples * (depth - 1) / Math.max(1, maxSeg)));
            for (let n = 0; n < samples * (depth - 1) && seg < maxSeg; n += stride) {
                const sidx = Math.floor(n / (depth - 1));
                const d = n % (depth - 1);
                const idx = (sidx * 9973 + ((sidx * 37) % 19)) % active;
                const h0 = (this.compatTrailHead - 1 - d + depth * 8) % depth;
                const h1 = (this.compatTrailHead - 2 - d + depth * 8) % depth;
                const a = (sidx * depth + h0) * 3;
                const b = (sidx * depth + h1) * 3;
                const ca = this._compatColorForParticle(idx, hue + d * 0.018, sat, light, beat, 1);
                const cb = this._compatColorForParticle(idx, hue + d * 0.026 + 0.09, sat, light, beat, 2);
                seg = this._writeCompatSegment(ribbonLayer, seg, hist[a], hist[a + 1], hist[a + 2], hist[b], hist[b + 1], hist[b + 2], ca, cb);
            }
        }
        this._finalizeCompatLayer(ribbonLayer, seg, showRibbon, (0.22 + beat * 0.08 + effectAmount * 0.025) * closeTrim);

        // Curve strands: bent two-segment links between flow-related particles.
        const curveLayer = this.compatCurveLayer;
        seg = 0;
        if (showCurves && curveLayer) {
            const maxSeg = Math.min(curveLayer.maxSegments, Math.floor(curveLayer.maxSegments * closeTrim));
            const pairs = Math.floor(maxSeg / 2);
            const inversion = Math.max(8, Math.abs(Number((window.S_effective || S).inversion ?? S.inversion ?? 80) || 80));
            for (let n = 0; n < pairs && seg + 1 < maxSeg; n++) {
                const i0 = (n * 1543 + 17) % active;
                const i1 = (i0 + Math.floor(active * (0.006 + ((n * 13) % 43) / 12000)) + 19) % active;
                const a = i0 * 4;
                const b = i1 * 4;
                const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
                const bx = pos[b], by = pos[b + 1], bz = pos[b + 2];
                const mx = (ax + bx) * 0.5;
                const my = (ay + by) * 0.5;
                const mz = (az + bz) * 0.5;
                const bend = Math.sin(n * 0.37 + t * 0.44) * inversion * (0.025 + effectAmount * 0.012 + beat * 0.018);
                const cx = mx + Math.sin(my * 0.035 + t + n) * bend;
                const cy = my + Math.cos(mz * 0.030 - t * 0.7 + n) * bend;
                const cz = mz + Math.sin(mx * 0.028 + t * 0.4) * bend;
                const ca = this._compatColorForParticle(i0, hue, sat, light, beat, 3);
                const cb = this._compatColorForParticle(i1, hue + 0.11, sat, light, beat, 0);
                seg = this._writeCompatSegment(curveLayer, seg, ax, ay, az, cx, cy, cz, ca, cb);
                seg = this._writeCompatSegment(curveLayer, seg, cx, cy, cz, bx, by, bz, cb, ca);
            }
        }
        this._finalizeCompatLayer(curveLayer, seg, showCurves, (0.14 + beat * 0.05 + tension * 0.035) * closeTrim);

        // Cellular web: low-budget automata-looking local interactions.
        const cellLayer = this.compatCellLayer;
        seg = 0;
        if (showCells && cellLayer) {
            const maxSeg = Math.min(cellLayer.maxSegments, Math.floor(cellLayer.maxSegments * closeTrim));
            const step = Math.max(1, Math.floor(active / Math.max(1, maxSeg * 2)));
            const threshold = 0.18 - beat * 0.22;
            for (let n = 0, i0 = 0; i0 < active && seg < maxSeg; n++, i0 += step) {
                const phase = Math.sin(i0 * 0.013 + t * 0.38) + Math.cos(i0 * 0.021 - t * 0.27);
                if (phase < threshold && (n % 5) !== 0) continue;
                const i1 = (i0 + 31 + ((n * 17) % Math.max(37, Math.floor(active * 0.025)))) % active;
                const a = i0 * 4;
                const b = i1 * 4;
                const dx = (pos[a] || 0) - (pos[b] || 0);
                const dy = (pos[a + 1] || 0) - (pos[b + 1] || 0);
                const dz = (pos[a + 2] || 0) - (pos[b + 2] || 0);
                const dist2 = dx * dx + dy * dy + dz * dz;
                const maxD = Math.max(80, Number((window.S_effective || S).coherence || 40) * 3.5 + Number((window.S_effective || S).inversion || 80) * 0.22);
                if (dist2 > maxD * maxD && (n % 9) !== 0) continue;
                const ca = this._compatColorForParticle(i0, hue + phase * 0.03, sat, light, beat, 4);
                const cb = this._compatColorForParticle(i1, hue + 0.21, sat, light, beat, 5);
                seg = this._writeCompatSegment(cellLayer, seg, pos[a], pos[a + 1], pos[a + 2], pos[b], pos[b + 1], pos[b + 2], ca, cb);
            }
        }
        this._finalizeCompatLayer(cellLayer, seg, showCells, (0.11 + beat * 0.04 + effectAmount * 0.02) * closeTrim);

        const budget = Math.max(1, Math.min(18, Number(S.visualEffectMaxFrameMs) || 3.2));
        const cost = performance.now() - structureStarted;
        if (cost > budget && (this._compatStructureAutoEvery || 0) < 8) this._compatStructureAutoEvery = (this._compatStructureAutoEvery || 0) + 1;
        else if (cost < budget * 0.42 && (this._compatStructureAutoEvery || 0) > 0 && (this._perfFrame % 48) === 0) this._compatStructureAutoEvery--;
    }

    stepCompatParticleSimulation(dtRaw = 0.016) {
        if (!window.S || !this.isPointsFallbackActive() || window.S.compatParticleCpuMotion === false) return;
        if (!this.cpuPosArray || !this.cpuVelArray) return;

        const active = Math.min(
            this.getZoomDisplayParticleCount(this.getActiveParticleCount(window.S.freeEnergy)),
            Math.max(1, Number(window.S.compatParticleMaxCpuActive) || this.particleCount),
            Math.max(1, Number(window.S.compatParticleSimMax) || 65000)
        );
        if (active <= 0) return;

        if (window.S.compatMotionWake !== false && !this._compatMotionWakeDone) {
            this._wakeCompatParticleMotion(active, 1.15);
            this._compatMotionWakeDone = true;
        }

        const S = window.S_effective || window.S;
        const tempo = Math.max(0, Number(S.tempo ?? window.S.tempo ?? 1) || 0);
        if (tempo <= 0) return;

        const pos = this.cpuPosArray;
        const vel = this.cpuVelArray;
        const col = this.cpuColArray;
        const colorPulse = window.S.compatParticleColorPulse !== false && !!col;
        const audio = window.SS_AUDIO_FEATURES || null;

        const dt = Math.min(0.033, Math.max(0.001, Number(dtRaw) || 0.016));
        const stepN = Math.min(1.6, Math.max(0.025, dt * 60 * tempo));
        const t = performance.now() * 0.001;
        const inversion = Math.max(8, Math.abs(Number(S.inversion ?? 30) || 30));
        const halfLife = Math.max(0, Math.min(30, Number(S.halfLife ?? 15) || 15));
        const coherenceRaw = Number(S.coherence ?? 1) || 0;
        const coherenceSign = coherenceRaw < 0 ? -1 : 1;
        const coherence = Math.max(0, Math.abs(coherenceRaw));
        const scaleDepth = Number(S.scaleDepth ?? 0) || 0;
        const equilibrium = Math.max(0, Number(S.equilibrium ?? 0.001) || 0);
        const temperature = Math.max(0, Number(S.temperature ?? 0) || 0);
        const motionFloor = Math.max(0, Math.min(0.20, Number(window.S.compatMotionFloor ?? 0.020) || 0.020));
        const equilibriumMotion = Math.max(equilibrium, motionFloor);
        const temperatureMotion = Math.max(temperature, motionFloor * 8.0);
        const viscosity = Math.max(0, Math.min(0.98, Number(S.viscosity ?? 0) || 0));
        const mass = Math.max(0.05, Number(S.mass ?? 0.1) || 0.1);
        const hue = ((Number(S.hue ?? 0.59) || 0) % 1 + 1) % 1;
        const sat = Math.max(this._musicModeActive() ? 0.88 : 0.15, Math.min(1.9, Number(S.sat ?? 1) || 1));
        const lightness = Math.max(0, Math.min(2, Number(S.lightness ?? 0.9) || 0.9));
        const mode = Number(S.colorMode ?? 2) | 0;

        const rms = Math.max(0, Math.min(1, Number(audio && audio.rms) || 0));
        const peak = Math.max(0, Math.min(1.5, Number(audio && audio.peak) || 0));
        const beat = Math.max(0, Math.min(1, Number(audio && audio.beat) || 0));
        const blowout = Math.max(rms * 0.55, Math.min(1.1, Number(audio && audio.blowout) || 0));
        const tensionRelease = Math.max(0, Math.min(1.5, Number(audio && audio.tensionRelease) || 0));
        const colorPhase = Number(audio && audio.colorPhase) || 0;

        const flowMode = String(window.S.compatFlowMode || 'adaptive');
        const effectStyleRaw = String(window.S.visualEffectStyle || 'random');
        const effectStyle = (effectStyleRaw === 'random' || effectStyleRaw === 'adaptive')
            ? String(window.SS_VISUAL_EFFECT_STYLE || effectStyleRaw)
            : effectStyleRaw;
        const effectAmountRaw = Number(window.S.visualEffectAmount ?? 0.75);
        const fxExpressivity = Math.max(0.35, Math.min(2.5, Number(window.S.visualEffectExpressivity ?? 1.35) || 1.35));
        const fxDynamics = Math.max(0.25, Math.min(2.5, Number(window.S.visualEffectDynamics ?? 1.15) || 1.15));
        const effectAmount = Math.max(0, Math.min(3.0, (Number.isFinite(effectAmountRaw) ? effectAmountRaw : 0.75) * (0.78 + fxExpressivity * 0.22 + fxDynamics * 0.12)));
        const flowPhase = hue * Math.PI * 2 + t * 0.045;
        const adaptive = flowMode === 'adaptive';
        const wPlume = flowMode === 'plume' ? 1 : adaptive ? 0.35 + 0.35 * Math.sin(flowPhase + 0.2) : 0;
        const wVortex = flowMode === 'vortex' ? 1 : adaptive ? 0.28 + 0.28 * Math.sin(flowPhase + 1.7) : 0;
        const wSheet = flowMode === 'sheet' ? 1 : adaptive ? 0.26 + 0.26 * Math.sin(flowPhase + 3.1) : 0;
        const wRibbon = flowMode === 'ribbon' ? 1 : adaptive ? 0.30 + 0.30 * Math.sin(flowPhase + 4.4) : 0;
        const wCellular = flowMode === 'cellular' ? 1 : adaptive ? 0.24 + 0.24 * Math.sin(flowPhase + 5.2) : 0;
        const wHelix = flowMode === 'helix' ? 1 : adaptive ? 0.20 + 0.20 * Math.sin(flowPhase + 2.4) : 0;
        const wCymatic = flowMode === 'cymatic' ? 1 : adaptive ? 0.18 + 0.18 * Math.sin(flowPhase + 0.9) : 0;
        const wBurst = flowMode === 'burst' ? 1 : adaptive ? 0.16 + 0.16 * Math.sin(flowPhase + 5.9) : 0;
        const flowNorm = Math.max(0.001, wPlume + wVortex + wSheet + wRibbon + wCellular + wHelix + wCymatic + wBurst);

        const softLimit = inversion * (0.86 + blowout * 0.18 + tensionRelease * 0.16 + effectAmount * 0.015);
        const outerLimit = inversion * (2.05 + blowout * 0.48 + tensionRelease * 0.22);
        const sourceRadius = Math.max(0.35, inversion * 0.015);
        const curlAmp = ((temperatureMotion * 0.020 + equilibriumMotion * 0.36 + 0.010) / mass) * (1.0 - Math.min(0.55, tensionRelease * 0.30));
        const neighborProxy = Math.max(0, scaleDepth) * Math.min(1, coherence / 48) * 0.0042 * coherenceSign / mass;
        const damp = Math.max(0.80, Math.min(0.997, 0.989 - viscosity * 0.082 - tensionRelease * 0.030));
        const maxSpeed = 1.65 + temperatureMotion * 1.15 + equilibriumMotion * 8.0 + blowout * 1.05 - tensionRelease * 0.72 + effectAmount * 0.12;
        const maxSpeedSq = Math.max(0.38, maxSpeed) * Math.max(0.38, maxSpeed);
        const lifeDecay = Math.max(0, 30 - halfLife) * 0.00115;
        const audioPush = blowout * 0.021 + peak * 0.004 + beat * 0.050;
        const wavePush = effectAmount * (0.0025 + beat * 0.0025 + rms * 0.002);

        for (let i = 0, j = 0; i < active; i++, j += 4) {
            let x = pos[j + 0];
            let y = pos[j + 1];
            let z = pos[j + 2];
            let vx = vel[j + 0];
            let vy = vel[j + 1];
            let vz = vel[j + 2];
            const size = Math.max(0.2, pos[j + 3] || 1);
            let life = vel[j + 3];
            if (!Number.isFinite(life) || life <= 0 || life > 1.5) life = ((Math.sin(i * 12.9898 + size * 78.233) * 43758.5453) % 1 + 1) % 1;
            const seed = ((Math.sin((i + 1) * 12.9898 + size * 78.233) * 43758.5453) % 1 + 1) % 1;

            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
                const a = seed * Math.PI * 2;
                const b = ((seed * 17.17) % 1) * Math.PI * 2;
                const rr = sourceRadius * (0.6 + ((seed * 31.31) % 1));
                x = Math.cos(a) * Math.sin(b) * rr;
                y = Math.sin(a) * Math.sin(b) * rr;
                z = Math.cos(b) * rr;
                vx = vy = vz = 0;
            }

            const r2 = x * x + y * y + z * z + 1e-6;
            const r = Math.sqrt(r2);
            const invR = 1 / r;
            const nx = x * invR;
            const ny = y * invR;
            const nz = z * invR;

            const rho = Math.sqrt(x * x + z * z + 1e-6);
            const invRho = 1 / rho;
            const rx = x * invRho;
            const rz = z * invRho;

            const flowT = t * (0.28 + equilibriumMotion * 8.5);
            const px = x * 0.045;
            const py = y * 0.045;
            const pz = z * 0.045;

            const qx = Math.sin(py + seed * 6.28 + flowT) - Math.cos(pz * 1.13 - flowT * 0.73 + seed * 11.4);
            const qy = Math.sin(pz + seed * 8.17 - flowT * 0.91) - Math.cos(px * 1.09 + flowT * 0.61 + seed * 7.3);
            const qz = Math.sin(px + seed * 5.31 + flowT * 0.77) - Math.cos(py * 1.17 - flowT * 0.53 + seed * 3.9);

            let ax = qx * curlAmp;
            let ay = qy * curlAmp;
            let az = qz * curlAmp;

            // A cheap local-field proxy for the original neighbor attraction/repulsion.
            // It keeps the system feeling like one deforming body without forcing a
            // spherical shell in the fallback renderer.
            const cellular = Math.sin((x + qy * 12) * 0.027 + seed * 40.0)
                + Math.sin((y + qz * 12) * 0.025 - seed * 33.0)
                + Math.sin((z + qx * 12) * 0.029 + seed * 21.0);
            const fold = cellular * neighborProxy;
            ax += (qx * 0.45 - nx * cellular) * fold;
            ay += (qy * 0.45 - ny * cellular) * fold;
            az += (qz * 0.45 - nz * cellular) * fold;

            const tubeRadius = inversion * (0.22 + 0.18 * Math.sin(t * 0.17 + seed * 8.0));
            const tubeErr = (tubeRadius - rho) / Math.max(1.0, inversion);
            const vortexSpin = (0.011 + equilibriumMotion * 0.18 + beat * 0.004) * (wVortex / flowNorm) / mass;
            ax += (-rz * vortexSpin + rx * tubeErr * 0.040 * (wVortex / flowNorm));
            az += ( rx * vortexSpin + rz * tubeErr * 0.040 * (wVortex / flowNorm));
            ay += Math.sin(t * 0.31 + seed * 18.0 + rho * 0.018) * 0.010 * (wVortex / flowNorm);

            const sheetZ = Math.sin(x * 0.050 + t * 0.26) * inversion * 0.10
                + Math.sin(y * 0.037 - t * 0.19 + seed * 7.0) * inversion * 0.055;
            const sheetW = wSheet / flowNorm;
            az += (sheetZ - z) * 0.0038 * sheetW;
            ax += qy * 0.006 * sheetW;
            ay += qx * 0.004 * sheetW;

            const pathY = y * 0.040 + t * 0.32;
            const pathX = Math.sin(pathY + hue * 5.0) * inversion * 0.36;
            const pathZ = Math.cos(pathY * 0.83 + seed * 3.0) * inversion * 0.24;
            const ribbonW = wRibbon / flowNorm + (['ribbons', 'trails', 'starfield', 'hyperspace'].includes(effectStyle) ? 0.14 * effectAmount : 0);
            ax += (pathX - x) * 0.0028 * ribbonW + Math.cos(pathY) * 0.012 * ribbonW;
            az += (pathZ - z) * 0.0028 * ribbonW + Math.sin(pathY * 1.7) * 0.010 * ribbonW;
            ay += (0.026 + equilibriumMotion * 0.24) * ribbonW;

            const lobe = Math.sin(seed * 37.0) < 0 ? -1 : 1;
            const lobeX = Math.sin(t * 0.23 + lobe * 1.4 + hue * 6.0) * inversion * 0.28 * lobe;
            const lobeY = Math.cos(t * 0.19 + seed * 4.0) * inversion * 0.18;
            const lobeZ = Math.sin(t * 0.21 + seed * 9.0) * inversion * 0.26;
            const cellW = wCellular / flowNorm + (effectStyle === 'constellation' ? 0.13 * effectAmount : 0);
            ax += (lobeX - x) * 0.0024 * cellW + qz * 0.008 * cellW;
            ay += (lobeY - y) * 0.0021 * cellW + qx * 0.006 * cellW;
            az += (lobeZ - z) * 0.0024 * cellW + qy * 0.008 * cellW;

            const helixW = wHelix / flowNorm;
            if (helixW > 0.0001) {
                const helixPhase = y * 0.030 + t * 0.42 + seed * 12.0 + hue * 6.0;
                const helixRadius = inversion * (0.18 + 0.10 * Math.sin(t * 0.12 + seed * 5.0));
                const hx = Math.cos(helixPhase) * helixRadius;
                const hz = Math.sin(helixPhase) * helixRadius;
                ax += (hx - x) * 0.0027 * helixW + (-rz) * 0.010 * helixW;
                az += (hz - z) * 0.0027 * helixW + ( rx) * 0.010 * helixW;
                ay += Math.sin(helixPhase * 0.7) * 0.012 * helixW;
            }

            const cymW = wCymatic / flowNorm + (['cymatics', 'lattice', 'spectral', 'kaleido', 'spectrum', 'vectorscope'].includes(effectStyle) ? 0.18 * effectAmount : 0);
            if (cymW > 0.0001) {
                const node = Math.sin(r * (0.115 + coherence * 0.0008) - t * (0.74 + equilibriumMotion * 4.0) * coherenceSign + hue * 7.0);
                const petal = Math.sin(Math.atan2(z, x) * (3.0 + Math.floor((hue * 8.0) % 5.0)) + t * 0.33);
                const cymForce = (node * 0.010 + petal * 0.004) * cymW * (0.7 + beat * 0.6 + wavePush * 40.0);
                ax += nx * cymForce + qy * 0.0025 * cymW;
                ay += ny * cymForce * 0.55 + qz * 0.0020 * cymW;
                az += nz * cymForce + qx * 0.0025 * cymW;
            }

            const burstW = wBurst / flowNorm + (['tunnel', 'oscilloscope', 'spectral', 'spectrum', 'starfield', 'trails'].includes(effectStyle) ? 0.11 * effectAmount : 0);
            if (burstW > 0.0001) {
                const pulse = Math.max(0, Math.sin(t * (0.56 + equilibriumMotion * 2.8) + seed * 19.0));
                const burst = (pulse * pulse) * (0.010 + beat * 0.030 + blowout * 0.010) * burstW;
                ax += nx * burst + qx * 0.0025 * burstW;
                ay += ny * burst + qy * 0.0025 * burstW;
                az += nz * burst + qz * 0.0025 * burstW;
            }

            if (effectStyle === 'sinefield' || effectStyle === 'oscilloscope' || effectStyle === 'aurora' || effectStyle === 'vectorscope' || effectStyle === 'trails') {
                const wave = Math.sin(x * 0.045 + t * 0.45 + seed * 9.0) + 0.5 * Math.sin(z * 0.038 - t * 0.31);
                ay += wave * wavePush * (effectStyle === 'aurora' ? 1.7 : 1.1);
                ax += Math.sin(y * 0.025 + t * 0.18) * wavePush * 0.55;
                az += Math.cos(y * 0.028 - t * 0.20) * wavePush * 0.55;
            }

            if (r > inversion * 0.32) {
                const pullStrength = Math.min((r - inversion * 0.32) * 0.00145, 0.046) * (1.0 - Math.min(0.55, tensionRelease * 0.28));
                ax -= nx * pullStrength * (0.45 + 0.55 * (wPlume / flowNorm));
                ay -= ny * pullStrength * (0.45 + 0.55 * (wPlume / flowNorm));
                az -= nz * pullStrength * (0.45 + 0.55 * (wPlume / flowNorm));
            }

            if (r > softLimit) {
                const push = Math.min((r - softLimit) * 0.018, 0.36);
                ax -= nx * push;
                ay -= ny * push;
                az -= nz * push;
            }

            if (r < inversion * 0.11) {
                const centerRepel = (1.0 - r / Math.max(1, inversion * 0.11)) * (0.015 + beat * 0.038 + blowout * 0.020);
                ax += nx * centerRepel;
                ay += ny * centerRepel;
                az += nz * centerRepel;
            }

            if (audioPush > 0.0001) {
                const plume = 0.45 + 0.55 * Math.sin(seed * 12.0 + t * 0.9);
                const lateral = 1.0 - Math.min(0.8, tensionRelease * 0.42);
                ax += (nx * plume * (wPlume / flowNorm) + qx * 0.55 * lateral) * audioPush;
                ay += (ny * plume * (wPlume / flowNorm) + qy * 0.55 * lateral) * audioPush;
                az += (nz * plume * (wPlume / flowNorm) + qz * 0.55 * lateral) * audioPush;
            }

            vx = (vx + ax * stepN) * damp;
            vy = (vy + ay * stepN) * damp;
            vz = (vz + az * stepN) * damp;

            const sp2 = vx * vx + vy * vy + vz * vz;
            if (sp2 > maxSpeedSq) {
                const k = maxSpeed / Math.sqrt(sp2);
                vx *= k; vy *= k; vz *= k;
            }

            x += vx * stepN;
            y += vy * stepN;
            z += vz * stepN;

            const rNext = Math.sqrt(x * x + y * y + z * z + 1e-6);
            if (rNext > outerLimit) {
                const k = outerLimit / rNext;
                x *= k; y *= k; z *= k;
                vx *= -0.18; vy *= -0.18; vz *= -0.18;
            }

            life -= lifeDecay * stepN * (0.65 + seed * 0.7);
            if (life <= 0) {
                const a = (seed * 6.2831853 + t * 0.043 + hue * 2.0) % (Math.PI * 2);
                const b = ((seed * 19.19) % 1) * Math.PI * 2;
                const rr = sourceRadius * (0.35 + ((seed * 13.13) % 1));
                const dirSphereX = Math.cos(a) * Math.sin(b);
                const dirSphereY = Math.sin(a) * Math.sin(b);
                const dirSphereZ = Math.cos(b);
                const pathSeed = seed * 10.0 + t * 0.18;
                const dirPathX = Math.sin(pathSeed + hue * 6.0) * (0.7 + wRibbon / flowNorm);
                const dirPathY = Math.cos(pathSeed * 0.7) * (0.5 + wSheet / flowNorm) + 0.35 * (wVortex / flowNorm);
                const dirPathZ = Math.cos(pathSeed * 1.3 + hue * 3.0) * (0.7 + wVortex / flowNorm);
                const mixPath = Math.min(0.82, 0.28 + (wRibbon + wVortex + wSheet) / flowNorm * 0.52);
                let bx = dirSphereX * (1 - mixPath) + dirPathX * mixPath;
                let by = dirSphereY * (1 - mixPath) + dirPathY * mixPath;
                let bz = dirSphereZ * (1 - mixPath) + dirPathZ * mixPath;
                const bLen = Math.sqrt(bx * bx + by * by + bz * bz + 1e-6);
                bx /= bLen; by /= bLen; bz /= bLen;
                x = bx * rr;
                y = by * rr;
                z = bz * rr;
                const blastSpeed = 1.8 + seed * 4.8 + blowout * 2.4 + beat * 4.6 - tensionRelease * 1.7 + effectAmount * 0.35;
                vx = bx * blastSpeed;
                vy = by * blastSpeed;
                vz = bz * blastSpeed;
                life = 1.0;
                pos[j + 3] = 0.5 + ((seed * 9.71) % 1) * 1.5;
            }

            pos[j + 0] = x;
            pos[j + 1] = y;
            pos[j + 2] = z;
            vel[j + 0] = vx;
            vel[j + 1] = vy;
            vel[j + 2] = vz;
            vel[j + 3] = life;

            if (colorPulse) {
                const speed01 = Math.min(1, Math.sqrt(vx * vx + vy * vy + vz * vz) * 0.16);
                const radius01 = Math.min(1, rNext / Math.max(1, inversion));
                const particleMode = this.compatParticleModeIds ? (this.compatParticleModeIds[i] || 0) : 0;
                const mixed = window.S.compatMixedVisualModes === true && (window.S.compatMixedVisualModesMusicOnly === false || this._musicModeActive()) && mode !== 0 && mode !== 4;
                const localMode = mixed ? (1 + ((mode - 1 + particleMode) % 3)) : mode;
                let e = hue;
                if (localMode === 1) e += size * (0.18 + particleMode * 0.035);
                else if (localMode === 2) e += speed01 * (0.26 + lightness * 0.26 + particleMode * 0.035);
                else if (localMode === 3) e += radius01 * (0.26 + lightness * 0.18 + particleMode * 0.040) + cellular * 0.018;
                else if (localMode === 4) e += speed01 * 0.44 + radius01 * 0.22 + cellular * 0.060;
                e += colorPhase * 0.20 + beat * 0.22 + rms * 0.12 + seed * lightness * 0.08 + particleMode * 0.055;
                const c = mode === 0 ? this.spectralCompatColor(hue + colorPhase * 0.08 + beat * 0.12) : this.spectralCompatColor(e);
                const bloom = Math.min(1.50, 0.82 + beat * 0.46 + blowout * 0.28);
                const lifeFade = halfLife < 29.5 ? Math.max(0.12, Math.min(1, life * 3.0)) : 1;
                col[j + 0] = Math.min(1, (c.r * sat + (1 - sat) * 0.18) * bloom * lifeFade);
                col[j + 1] = Math.min(1, (c.g * sat + (1 - sat) * 0.18) * bloom * lifeFade);
                col[j + 2] = Math.min(1, (c.b * sat + (1 - sat) * 0.18) * bloom * lifeFade);
            }
        }
    }

    syncCompatParticleCloud(force = false) {
        if (!window.S || !this.isPointsFallbackActive()) {
            if (this.compatParticleCloud) this.compatParticleCloud.visible = false;
            return;
        }
        if (!this.ensureCompatParticleCloud() || !this.compatParticlePositions || !this.cpuPosArray) return;
        const active = Math.min(
            this.getZoomDisplayParticleCount(this.getActiveParticleCount(window.S?.freeEnergy)),
            Math.max(1, Number(window.S?.compatParticleMaxCpuActive) || this.particleCount),
            Math.max(1, Number(window.S?.compatParticleSimMax) || 65000)
        );
        const cloud = this.compatParticleCloud;
        cloud.visible = true;
        if (cloud.position) {
            const S = window.S || {};
            cloud.position.set(Number(S.offsetX) || 0, Number(S.offsetY) || 0, Number(S.offsetZ) || 0);
            if (this._visualSwimOffset) cloud.position.add(this._visualSwimOffset);
        }
        cloud.geometry.setDrawRange(0, active);

        const zoomState = this.getZoomOptimizationState();
        const every = (window.S?.compatParticleCpuMotion !== false)
            ? Math.max(1, Math.min(4, Number(window.S?.compatParticleSyncEveryFrames) || 2, zoomState.compatSyncEvery || 2))
            : Math.max(1, Number(window.S?.compatParticleSyncEveryFrames) || 20);
        if (!force && this._perfFrame && (this._perfFrame % every) !== 0) return;

        const pos = this.cpuPosArray;
        const col = this.cpuColArray;
        const outP = this.compatParticlePositions;
        const outC = this.compatParticleColors;
        for (let i = 0, j = 0, k = 0; i < active; i++, j += 4, k += 3) {
            outP[k + 0] = pos[j + 0] || 0;
            outP[k + 1] = pos[j + 1] || 0;
            outP[k + 2] = pos[j + 2] || 0;
            if (col) {
                outC[k + 0] = col[j + 0] || 1;
                outC[k + 1] = col[j + 1] || 1;
                outC[k + 2] = col[j + 2] || 1;
            } else {
                outC[k + 0] = 1;
                outC[k + 1] = 1;
                outC[k + 2] = 1;
            }
        }
        const g = cloud.geometry;
        const pAttr = g.getAttribute('position');
        const cAttr = g.getAttribute('color');
        if (pAttr) pAttr.needsUpdate = true;
        if (cAttr) cAttr.needsUpdate = true;
        if (cloud.material) {
            const feat = window.SS_AUDIO_FEATURES || {};
            const beat = Math.max(0, Math.min(1, Number(feat.beat) || 0));
            const blowout = Math.max(0, Math.min(1.25, Number(feat.blowout) || 0));
            const baseSize = Number(window.S?.compatParticleSize) || 0.60;
            const baseOpacity = Number(window.S?.compatParticleOpacity) || 0.20;
            const shape = String(window.S?.shape || 'circle');
            const shapeSize = shape === 'square' ? 0.92 : shape === 'diamond' ? 0.82 : 1.0;
            const shapeOpacity = shape === 'square' ? 0.95 : shape === 'diamond' ? 1.08 : 1.0;
            cloud.material.size = baseSize * shapeSize * (1.0 + beat * 0.08 + blowout * 0.05);
            cloud.material.opacity = Math.min(0.32, baseOpacity * shapeOpacity * (1.0 + beat * 0.08 + blowout * 0.04));
        }
    }

    async ensureParticleVisibilityBootstrap() {
        if (!this.renderer || !this.computeResetNode) return false;
        try {
            if (this.uniforms && this.uniforms.resetSeed) {
                this.uniforms.resetSeed.value = ((particleSeed() % 1000000) + 1) / 997.0;
            }
            if (this.computeResetNode) await this.renderer.computeAsync(this.computeResetNode);
            if (this.computeClearNode) await this.renderer.computeAsync(this.computeClearNode);
            if (this.computeAssignNode) await this.renderer.computeAsync(this.computeAssignNode);
            this._lastGpuResetAt = performance.now();
            return true;
        } catch (e) {
            console.warn('[particles] post-init GPU seed failed; using CPU/compat seed:', e && e.message ? e.message : e);
            try { await this.reinitializeParticles({ preferGpu: false }); } catch (e2) { console.warn('[particles] CPU seed fallback failed:', e2 && e2.message ? e2.message : e2); }
            return false;
        } finally {
            if (this.isPointsFallbackActive() || this.compatParticleCloud) this.syncCompatParticleCloud(true);
        }
    }

    forceParticleVisibility() {
        if (!window.S) return;
        window.S.showParticles = true;
        if (!Number.isFinite(Number(window.S.opacity)) || Number(window.S.opacity) <= 0.001) window.S.opacity = 0.15;
        if (!Number.isFinite(Number(window.S.resolution)) || Number(window.S.resolution) <= 0.001) window.S.resolution = 0.1;
        if (!Number.isFinite(Number(window.S.freeEnergy)) || Number(window.S.freeEnergy) < 1000) window.S.freeEnergy = 100000;
        this.updateUniforms();
        this.applyPerfLimits();
        this.syncGpuPointCloud(1);
        if (this.isPointsFallbackActive() || this.compatParticleCloud) this.syncCompatParticleCloud(true);
    }

    setupMesh() {
        this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.particleCount);
        this.mesh.count = this.getFrameDisplayParticleCount(window.S.freeEnergy);
        this.mesh.frustumCulled = false;

        // WebGPU/InstancedMesh can render nothing if the instance matrix buffer
        // is left as a zero-filled allocation. Our node vertex shader places
        // particles from storage buffers, but the renderer still binds the
        // instancing path. Seed identity matrices once so instance transforms
        // can never collapse the quads to zero scale.
        try {
            const m = this.mesh.instanceMatrix;
            const a = m && m.array;
            if (a && a.length >= this.particleCount * 16) {
                a.fill(0);
                for (let i = 0, j = 0; i < this.particleCount; i++, j += 16) {
                    a[j] = 1; a[j + 5] = 1; a[j + 10] = 1; a[j + 15] = 1;
                }
                m.needsUpdate = true;
            }
        } catch (e) {
            console.warn('[particles] instance identity init skipped:', e && e.message ? e.message : e);
        }

        this.scene.add(this.mesh);
    }

    resize(width, height) {
        const offscreenSize = window.SS_OFFSCREEN_SIZE || null;
        if (offscreenSize) {
            const css = this._offscreenCssSize ? this._offscreenCssSize() : { width: Math.max(1, Math.floor(Number(offscreenSize.width) || Number(width) || 1)), height: Math.max(1, Math.floor(Number(offscreenSize.height) || Number(height) || 1)) };
            const backing = this._offscreenBackingSize ? this._offscreenBackingSize() : css;
            this.camera.aspect = css.width / Math.max(1, css.height);
            if (typeof this.camera.clearViewOffset === 'function') this.camera.clearViewOffset();
            this.camera.filmOffset = 0;
            this.camera.updateProjectionMatrix();
            this.renderer.setPixelRatio(1);
            this._lastPerfPixelRatio = 1;
            this.renderer.setSize(css.width, css.height, false);
            this._syncOffscreenViewport(true);
            return;
        }
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.applyPixelRatioIfNeeded(true);
        this.renderer.setSize(width, height);
    }

    setupControls(canvas) {
        const cam = this.cam;
        const keys = {};

        canvas.addEventListener('mousedown', e => {
            if (e.button === 1) { e.preventDefault(); return; }
            cam.down = true;
            cam.mx = e.clientX;
            cam.my = e.clientY;
        });
        window.addEventListener('mouseup', () => cam.down = false);
        window.addEventListener('mousemove', e => {
            if (!cam.down) return;
            const dx = e.clientX - cam.mx;
            const dy = e.clientY - cam.my;
            cam.mx = e.clientX;
            cam.my = e.clientY;
            
            if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
                if (window.sysRadial) window.sysRadial.close(true);
                if (window.envRadial) window.envRadial.close(true);
                if (window.cfgRadial) window.cfgRadial.close(true);
            }

            if (window.S.moveMode === 'orbit') {
                cam.orbitYaw -= dx * ORBIT_ROTATE_SPEED;
                cam.orbitPitch = wrapOrbitAngle(cam.orbitPitch + dy * ORBIT_ROTATE_SPEED);
            } else {
                cam.yaw -= dx * 0.003;
                cam.pitch -= dy * 0.003;
                cam.pitch = Math.max(-Math.PI * 0.49, Math.min(Math.PI * 0.49, cam.pitch));
            }
        });

        canvas.addEventListener('wheel', e => {
            if (window.S.moveMode === 'orbit') {
                const wOrS = (this._keys && (this._keys['KeyW'] || this._keys['KeyS']));
                if (wOrS) {
                    const delta = e.deltaY > 0 ? -0.1 : 0.1;
                    cam.orbitZoomSpeed = Math.max(0.1, Math.min(10, cam.orbitZoomSpeed + delta));
                    // Reveal + sync the orbit speed popup and toast the value.
                    if (window.refreshSpeedPopups) window.refreshSpeedPopups('orbit');
                    if (window.showParamToast) window.showParamToast('Zoom Speed', cam.orbitZoomSpeed.toFixed(1));
                } else {
                    const zoomFactor = 1.0 + (e.deltaY > 0 ? 0.08 : -0.08);
                    // Uncapped zoom-out — see orbit keyboard handler above.
                    // Floor kept at 1; ceiling removed.
                    cam.distTarget = Math.max(1, cam.distTarget * zoomFactor);
                    if (window.showParamToast) window.showParamToast('Zoom', Math.round(cam.distTarget).toString());
                }
            } else {
                // Fly mode scroll:
                //   • default: FOV zoom (inverse — scroll up = zoom in =
                //     lower FOV). Mirrors the Causmonaut behavior the user
                //     likes — gives fly mode a sense of optical depth
                //     without changing position. Rate is tied to fly speed
                //     so users who've slowed down get fine FOV control and
                //     fast flyers get coarse adjustments.
                //   • W or S held: adjusts fly speed, matching the
                //     "modifier + scroll = adjust the speed slider"
                //     pattern that orbit mode uses.
                const wOrS = (this._keys && (this._keys['KeyW'] || this._keys['KeyS']));
                if (wOrS) {
                    const delta = e.deltaY > 0 ? -0.1 : 0.1;
                    cam.flyMoveSpeed = Math.max(0.05, Math.min(20, cam.flyMoveSpeed + delta));
                    // Reveal + sync the fly speed popup and toast the value.
                    if (window.refreshSpeedPopups) window.refreshSpeedPopups('fly');
                    if (window.showParamToast) window.showParamToast('Fly Speed', cam.flyMoveSpeed.toFixed(2));
                } else {
                    // FOV zoom. Bounded to a sane range: 10° (heavy zoom)
                    // to 120° (wide fish-eye). Default is 60°.
                    const zoomRate = 1.0 + cam.flyMoveSpeed * 0.4;  // higher fly speed → bigger FOV steps
                    const delta = (e.deltaY > 0 ? 1 : -1) * zoomRate;
                    this.camera.fov = Math.max(10, Math.min(120, this.camera.fov + delta));
                    this.camera.updateProjectionMatrix();
                    if (window.showParamToast) window.showParamToast('FOV', Math.round(this.camera.fov) + '°');
                }
            }
        }, { passive: true });
        canvas.addEventListener('contextmenu', e => e.preventDefault());

        window.addEventListener('keydown', e => {
            // Skip keys destined for any text-input surface (inputs,
            // textareas, contenteditable .val spans on sliders).
            const t = e.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
            keys[e.code] = true;

            if (e.code === 'Tab') {
                e.preventDefault();
                window.setUIVisibility(!window.uiVisible);
            }
            if (e.code === 'Home') {
                e.preventDefault();
                // Travel to user-saved homepoint if one exists; the helper
                // toasts a hint if not. Old behavior (hard camera reset) is
                // gone — users who relied on that can save a homepoint at
                // {0,0,300} once and the same key will do the same thing.
                if (window.travelToHomepoint) window.travelToHomepoint();
            }
        });
        window.addEventListener('keyup', e => { keys[e.code] = false; });

        const clearAllInputState = () => {
            for (const k in keys) keys[k] = false;
            cam.down = false;
        };
        window.addEventListener('blur', clearAllInputState);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                clearAllInputState();
            } else {
                clearAllInputState();
                window._fpsLastTime = performance.now();
                if (window.transition) {
                    window.transition.startTime = performance.now() - window.transition.duration;
                }
            }
        });

        this._keys = keys;
    }

    _updateCamera() {
        const cam = this.cam;
        const keys = this._keys || {};
        if (keys['ControlLeft'] || keys['ControlRight'] || keys['MetaLeft'] || keys['MetaRight']) return;

        if (window.S.moveMode === 'orbit') {
            // Zoom: uncapped on both ends. Previously had Math.max(5, ...)
            // floor and Math.min(5000, ...) ceiling. The ceiling created a
            // hard stop that prevented seeing very large scales; the floor
            // was a safety net against zooming through the origin which
            // would invert the view. Floor kept at 1 (effectively still no
            // limit for the user). Ceiling removed entirely.
            if (keys['KeyW']) {
                cam.distTarget = Math.max(1, cam.distTarget - cam.distTarget * 0.01 * cam.orbitZoomSpeed);
            }
            if (keys['KeyS']) {
                cam.distTarget = cam.distTarget + cam.distTarget * 0.01 * cam.orbitZoomSpeed;
            }

            let oDx = 0, oDy = 0;
            if (keys['ArrowLeft']  || keys['KeyA']) oDx -= 1;
            if (keys['ArrowRight'] || keys['KeyD']) oDx += 1;
            if (keys['ArrowUp'])   oDy -= 1;
            if (keys['ArrowDown']) oDy += 1;
            if (oDx !== 0 || oDy !== 0) {
                cam.orbitYaw -= oDx * ORBIT_KEY_SPEED;
                cam.orbitPitch = wrapOrbitAngle(cam.orbitPitch + oDy * ORBIT_KEY_SPEED);
            }

            const nowOrbit = performance.now();
            const dtOrbit = this._lastOrbitUpdateAt ? Math.min(0.08, Math.max(0.001, (nowOrbit - this._lastOrbitUpdateAt) / 1000)) : 0.016;
            this._lastOrbitUpdateAt = nowOrbit;
            const userRotating = !!(cam.down || oDx !== 0 || oDy !== 0 || keys['KeyW'] || keys['KeyS']);
            const autoOrbit = window.S.cameraAutoOrbit === true || (window.tour && window.tour.active && !window.transition);
            if (autoOrbit && !userRotating) {
                const speed = Math.max(-5, Math.min(5, Number(window.S.cameraAutoOrbitSpeed) || 0.22));
                const absSpeed = Math.abs(speed);
                if (absSpeed > 0.0001) {
                    const dir = Math.sign(speed || 1);
                    // Make Auto Orbit travel over the top in the current view
                    // plane instead of mostly yawing around a perpendicular
                    // turntable axis. Pitch is the primary motion; yaw is only
                    // a slow drift so the body still reveals new sides over time.
                    const pitchStep = dir * Math.max(0.08, absSpeed * 0.78) * dtOrbit;
                    const yawStep = speed * 0.18 * dtOrbit;
                    cam.orbitPitch = wrapOrbitAngle(cam.orbitPitch + pitchStep);
                    cam.orbitYaw = wrapOrbitAngle(cam.orbitYaw + yawStep);
                }
            } else if (userRotating) {
                cam._autoOrbitPitchPhase = undefined;
            }

            cam.dist += (cam.distTarget - cam.dist) * 0.12;
            this._applyOrbitCamera();
        } else {
            // Fly mode (hybrid was removed — never user-exposed).
            const baseSpeed = Math.max(1, cam.pos.length() * 0.005);
            const speed = baseSpeed * cam.flyMoveSpeed;
            const fwd = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(cam.pitch, cam.yaw, 0, 'YXZ'));
            const right = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(0, cam.yaw, 0, 'YXZ'));
            const up = new THREE.Vector3(0, 1, 0);

            if (keys['KeyW']) cam.pos.addScaledVector(fwd, speed);
            if (keys['KeyS']) cam.pos.addScaledVector(fwd, -speed);
            if (keys['KeyA']) cam.pos.addScaledVector(right, -speed);
            if (keys['KeyD']) cam.pos.addScaledVector(right, speed);
            if (keys['Space']) cam.pos.addScaledVector(up, speed);
            if (keys['ShiftLeft']) cam.pos.addScaledVector(up, -speed);
            
            if (keys['ArrowLeft']) cam.yaw += 0.02;
            if (keys['ArrowRight']) cam.yaw -= 0.02;
            if (keys['ArrowUp']) cam.pitch += 0.02;
            if (keys['ArrowDown']) cam.pitch -= 0.02;

            this.camera.position.copy(cam.pos);
            this.camera.rotation.set(cam.pitch, cam.yaw, 0, 'YXZ');
        }
    }

    updateUniforms() {
        const S = window.S;
        const Eff = window.S_effective || {};
        const v = (k) => (Eff[k] !== undefined) ? Eff[k] : S[k];
        const U = this.uniforms;
        if (U.ssDamp) U.ssDamp.value = (S.stabilityDamping !== false || window.SS_DAMP) ? 1.0 : 0.0;
        U.mass.value = v('mass');
        U.viscosity.value = v('viscosity');
        U.tempo.value = v('tempo');
        U.inversion.value = v('inversion');
        U.temperature.value = v('temperature');
        U.equilibrium.value = v('equilibrium');
        U.coherence.value = v('coherence');
        U.scaleDepth.value = v('scaleDepth');
        if (U.physicsEmergence) U.physicsEmergence.value = v('physicsEmergence') ?? 0.0;
        if (U.effectDynamics) U.effectDynamics.value = S.visualEffectDynamics ?? 1.35;
        if (U.audioRms || U.audioBeat) {
            const feat = window.SS_AUDIO_FEATURES || {};
            if (!this._audioPhysicsDrive) this._audioPhysicsDrive = { rms: 0, beat: 0 };
            const audioLive = window.S?.audioReactive !== false && window.audio && window.audio.active;
            const targetRms = audioLive ? Math.max(0, Math.min(1.5, Number(feat.fxLevel || feat.smoothed || 0))) : 0;
            const targetBeat = audioLive ? Math.max(0, Math.min(1.5, Number(feat.fxBeat || 0))) : 0;
            const rmsK = targetRms > this._audioPhysicsDrive.rms ? 0.040 : 0.012;
            const beatK = targetBeat > this._audioPhysicsDrive.beat ? 0.11 : 0.020;
            this._audioPhysicsDrive.rms += (targetRms - this._audioPhysicsDrive.rms) * rmsK;
            this._audioPhysicsDrive.beat += (targetBeat - this._audioPhysicsDrive.beat) * beatK;
            if (this._audioPhysicsDrive.rms < 0.0001 && targetRms <= 0.0001) this._audioPhysicsDrive.rms = 0;
            if (this._audioPhysicsDrive.beat < 0.0001 && targetBeat <= 0.0001) this._audioPhysicsDrive.beat = 0;
            if (U.audioRms) U.audioRms.value = this._audioPhysicsDrive.rms;
            if (U.audioBeat) U.audioBeat.value = this._audioPhysicsDrive.beat;
        }
        const zOpt = window.SS_ZOOM_OPT || this.getZoomOptimizationState();
        const overdrawVisualBudget = this.getOverdrawVisualBudgetState(zOpt);
        U.pointSize.value = v('resolution');
        U.pointOpacity.value = v('opacity');
        if (U.overdrawParticleScale) U.overdrawParticleScale.value = overdrawVisualBudget.particleScale;
        if (U.overdrawOpacityScale) U.overdrawOpacityScale.value = overdrawVisualBudget.opacityScale;
        if (U.particleCloseScale) U.particleCloseScale.value = S.particleCloseScale === false ? 0.0 : 1.0;
        if (U.particleCloseScaleStrength) U.particleCloseScaleStrength.value = Math.max(0, Math.min(0.95, Number(S.particleCloseScaleStrength ?? 0.72) || 0));
        if (U.particleCloseScaleNear) U.particleCloseScaleNear.value = Math.max(1, Math.min(200, Number(S.particleCloseScaleNear ?? 20) || 20));
        if (U.halfLife) U.halfLife.value = v('halfLife') ?? 15.0;
        if (U.camPos) U.camPos.value.copy(this.camera.position);
        if (U.trailLen) U.trailLen.value = v('trailLen') ?? 5.0;
        let swimX = 0, swimY = 0, swimZ = 0;
        if (S.visualEffects !== false && S.visualEffectCenterSwim !== false) {
            const feat = window.SS_AUDIO_FEATURES || {};
            const t = performance.now() * 0.001;
            const dyn = Math.max(0.25, Math.min(2.5, Number(S.visualEffectDynamics ?? 1.15) || 1.15));
            const inv = Math.max(8, Math.abs(Number(v('inversion')) || 80));
            const audio = Math.max(0, Math.min(1.5, Number(feat.fxLevel || feat.blowout || 0)));
            const amp = Math.min(18, inv * 0.055) * dyn * (0.22 + audio * 0.48);
            swimX = Math.sin(t * 0.21 + STATE_SWIM_SEED) * amp;
            swimY = Math.cos(t * 0.17 + STATE_SWIM_SEED * 0.7) * amp * 0.55;
            swimZ = Math.sin(t * 0.13 + STATE_SWIM_SEED * 1.3) * amp * 0.75;
        }
        if (!this._visualSwimOffset) this._visualSwimOffset = new THREE.Vector3();
        const swimBlend = S.visualEffectCenterSwim === false ? 0.075 : 0.045;
        this._visualSwimOffset.x += (swimX - this._visualSwimOffset.x) * swimBlend;
        this._visualSwimOffset.y += (swimY - this._visualSwimOffset.y) * swimBlend;
        this._visualSwimOffset.z += (swimZ - this._visualSwimOffset.z) * swimBlend;
        if (Math.abs(swimX) < 0.0001 && Math.abs(this._visualSwimOffset.x) < 0.0001) this._visualSwimOffset.x = 0;
        if (Math.abs(swimY) < 0.0001 && Math.abs(this._visualSwimOffset.y) < 0.0001) this._visualSwimOffset.y = 0;
        if (Math.abs(swimZ) < 0.0001 && Math.abs(this._visualSwimOffset.z) < 0.0001) this._visualSwimOffset.z = 0;
        if (U.offsetX) U.offsetX.value = S.offsetX + this._visualSwimOffset.x;
        if (U.offsetY) U.offsetY.value = S.offsetY + this._visualSwimOffset.y;
        if (U.offsetZ) U.offsetZ.value = S.offsetZ + this._visualSwimOffset.z;
        if (U.offscreenCenterLock) U.offscreenCenterLock.value = 0.0;
        if (U.billboardOffset) U.billboardOffset.value = S.billboardOffset;
        if (U.colorMode) U.colorMode.value = S.colorMode || 0;
        if (U.colorRange) U.colorRange.value = v('hue');
        if (U.sat) U.sat.value = v('sat') ?? 0.8;
        if (U.activeParticleCount) U.activeParticleCount.value = this.getFrameDisplayParticleCount(v('freeEnergy'));
        if (U.shape) U.shape.value = S.shape === 'square' ? 1 : (S.shape === 'diamond' ? 2 : 0);

        if (this.bgCanvas && v('bgGlow') > 0) {
            const mode = S.colorMode || 0;
            const colorRange = v('hue') || 0.5; // misleadingly named — this is the spectral index
            const sVal = Math.round((v('sat') ?? 0.8) * 100);

            // Representative particle color is sampled from the rainbow the
            // shader actually uses (spectralColor), per the mode logic below.
            const rgbToHsl = (r, g, b) => {
                const max = Math.max(r, g, b), min = Math.min(r, g, b);
                const l = (max + min) / 2;
                let h = 0, s = 0;
                if (max !== min) {
                    const d = max - min;
                    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                    switch (max) {
                        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                        case g: h = (b - r) / d + 2; break;
                        case b: h = (r - g) / d + 4; break;
                    }
                    h *= 60;
                }
                return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
            };

            let gradientStr = '';
            if (mode === 0) {
                // Mono — particles are pure white. Bg is neutral dark gray
                // (no hue tint). Was previously tinted slightly blue which
                // gave Mono mode a cool cast that didn't match the
                // expectation of "white particles → black background."
                gradientStr = `radial-gradient(ellipse at center, rgba(35,35,35,0.5) 0%, rgba(15,15,15,0.4) 50%, transparent 80%)`;
            } else {
                // Modes 1-3 (Size / Velocity / Density): use the GPU color
                // histogram to find the ACTUAL average on-screen color. The
                // histogram is read back throttled by sampleColorHistogram(),
                // which stores _bgColorTargetRGB; here we ease toward it.
                // Ease the live bg color toward the readback target EVERY frame
                // for a continuous ~1-2s drift (no stepping). _bgColorTargetRGB
                // is the salience-weighted average particle color.
                if (this._bgColorTargetRGB) {
                    if (!this._bgColorRGB) this._bgColorRGB = { ...this._bgColorTargetRGB };
                    const t = this._bgColorTargetRGB, c = this._bgColorRGB;
                    c.r += (t.r - c.r) * 0.018;
                    c.g += (t.g - c.g) * 0.018;
                    c.b += (t.b - c.b) * 0.018;
                }
                const col = this._bgColorRGB || { r: 0.2, g: 0.6, b: 0.5 };
                const satF = Math.min(1, Math.max(0, (v('sat') ?? 0.8)));
                // Mix toward white by (1-sat) so the bg desaturates with the
                // particles, then render at three brightness levels for depth.
                const mix1 = (lvl) => {
                    const r = Math.round((col.r * satF + (1 - satF)) * lvl);
                    const g = Math.round((col.g * satF + (1 - satF)) * lvl);
                    const b = Math.round((col.b * satF + (1 - satF)) * lvl);
                    return `rgb(${r},${g},${b})`;
                };
                gradientStr =
                    `radial-gradient(ellipse at center, ` +
                    `${mix1(70)} 0%, ` +
                    `${mix1(36)} 45%, ` +
                    `${mix1(16)} 75%, ` +
                    `transparent 90%)`;
            }
            this.bgCanvas.style.background = gradientStr;
            this.bgCanvas.style.opacity = Math.min(1, v('bgGlow') * 1.5).toFixed(2);
        } else if (this.bgCanvas) {
            this.bgCanvas.style.opacity = '0';
        }
    }

    saveCameraState() {
        if (window.SS_OFFSCREEN_SIZE) return;
        if (!this.cam) return;
        const now = performance.now();
        if (!this._lastCamSave || now - this._lastCamSave > 500) {
            this._lastCamSave = now;
            const state = {
                pos: this.cam.pos.toArray(),
                quat: this.cam.quat.toArray(),
                dist: this.cam.dist,
                distTarget: this.cam.distTarget,
                yaw: this.cam.yaw,
                pitch: this.cam.pitch,
                orbitYaw: this.cam.orbitYaw,
                orbitPitch: this.cam.orbitPitch,
                flyMoveSpeed: this.cam.flyMoveSpeed,
                orbitZoomSpeed: this.cam.orbitZoomSpeed
            };
            try { localStorage.setItem('ss_cam', JSON.stringify(state)); } catch(e){}
        }
    }

    // Read back the tiny color histogram (16 uints) off the frame path and
    // update _bgColorIndex — the smoothed dominant spectral index the backdrop
    // samples. Throttled to ~1/sec; the readback is async and never blocks the
    // frame. We crossfade (lerp) toward each new reading so the backdrop drifts
    // rather than pops — invisible at a 1s cadence.
    async sampleColorHistogram() {
        if (this._histReadInFlight || !this.colorHistStorage) return;
        this._histReadInFlight = true;
        try {
            const buf = await this.renderer.getArrayBufferAsync(this.colorHistStorage);
            const bins = new Uint32Array(buf);
            const n = bins.length || this.COLOR_BINS;
            // Average the ACTUAL colors, not bin indices. The spectrum is
            // non-monotonic (red sits at both t=0 and t=1, cyan in the middle),
            // so a mean-of-indices is meaningless — it would call a field of
            // red particles "cyan." Sum spectralColor(bin) weighted by
            // population to get the true average RGB the particles show.
            const spectralJS = (t) => {
                const tm = Math.min(1, Math.max(0, t));
                return {
                    r: Math.min(1, Math.max(0, Math.abs(tm * 6 - 3) - 1)),
                    g: Math.min(1, Math.max(0, 2 - Math.abs(tm * 6 - 2))),
                    b: Math.min(1, Math.max(0, 2 - Math.abs(tm * 6 - 4)))
                };
            };
            let total = 0, rSum = 0, gSum = 0, bSum = 0;
            for (let i = 0; i < n; i++) {
                const cnt = bins[i];
                if (cnt === 0) continue;
                const c = spectralJS((i + 0.5) / n);
                // Brightness salience: brighter particles read more strongly to
                // the eye. Weight by population, lightly boosted by the color's
                // own luminance so faint bins don't wash the average toward grey.
                const lum = 0.3 * c.r + 0.59 * c.g + 0.11 * c.b;
                const w = cnt * (0.4 + 0.6 * lum);
                total += w; rSum += c.r * w; gSum += c.g * w; bSum += c.b * w;
            }
                if (total > 0) {
                    // Average RGB of what's on screen. Normalize by total to get
                    // the mean color, then store as the TARGET; the per-frame
                    // easing in render() crossfades the live bg color toward it.
                    let r = rSum / total, g = gSum / total, b = bSum / total;
                    // Re-vivify: the population average tends toward grey because
                    // it blends many hues. Push it back out toward its dominant
                    // channel so the backdrop reads as a color, not mud.
                    const mx = Math.max(r, g, b);
                    if (mx > 0.001) { const k = 1 / mx; r *= k; g *= k; b *= k; }
                    if (this._bgColorTargetRGB) {
                        const prev = this._bgColorTargetRGB;
                        r = prev.r + (r - prev.r) * 0.34;
                        g = prev.g + (g - prev.g) * 0.34;
                        b = prev.b + (b - prev.b) * 0.34;
                    }
                    this._bgColorTargetRGB = { r, g, b };
                    if (!this._bgColorRGB) this._bgColorRGB = { r, g, b };
                }
        } catch (e) {
            if (!this._histErrLoggedOnce) {
                this._histErrLoggedOnce = true;
                console.warn('[colorHist] readback failed:', e && e.message ? e.message : e);
            }
        } finally {
            this._histReadInFlight = false;
        }
    }

    getVisibilityDebug() {
        const active = this.getActiveParticleCount(window.S?.freeEnergy);
        const target = this.getTargetParticleCount(window.S?.freeEnergy);
        return {
            freeEnergy: window.S?.freeEnergy,
            particleCapacity: this.particleCount,
            targetParticleCount: target,
            activeParticleCount: active,
            performanceParticleScale: window.SS_PARTICLE_SCALE || null,
            zoomOptimizedParticleCount: this.getZoomDisplayParticleCount(active),
            zoom: this.getZoomOptimizationState(),
            adaptiveReadout: window.SS_PARTICLE_SCALE || null,
            showParticles: window.S?.showParticles !== false,
            opacity: window.S?.opacity,
            resolution: window.S?.resolution,
            meshVisible: !!this.mesh?.visible,
            meshCount: this.mesh?.count ?? 0,
            pointDrawMode: this.isGpuPointsMode() ? 'points' : 'native',
            pointDrawActive: this.isPointDrawActive(),
            gpuPointVisible: !!this.gpuPointCloud?.visible,
            gpuPointDrawRange: this.gpuPointCloud?.geometry?.drawRange || null,
            compatParticleFallback: this.isPointsFallbackActive(),
            manualCompatParticleFallback: !!window.S?.compatParticleFallback,
            pointsFallback: window.SS_POINTS_FALLBACK || null,
            compatVisible: !!this.compatParticleCloud?.visible,
            compatCpuMotion: window.S?.compatParticleCpuMotion !== false,
            compatColorPulse: window.S?.compatParticleColorPulse !== false,
            compatDrawRange: this.compatParticleCloud?.geometry?.drawRange || null,
            compatStructureLayers: {
                ribbons: this.compatRibbonLayer?.segments || 0,
                curves: this.compatCurveLayer?.segments || 0,
                cells: this.compatCellLayer?.segments || 0,
                autoEvery: this._compatStructureAutoEvery || 0,
            },
            xfade: window.S?._xfade || null,
            xfadeEnv: window.S?._xfadeEnv ?? null,
            perf: window.SS_PERF || null,
        };
    }

    async render() {
        this._perfFrame = ((this._perfFrame || 0) + 1) | 0;
        if ((this._perfFrame & 31) === 0) this.applyPixelRatioIfNeeded(false);
        this.updatePointDrawState();
        this.updatePerformanceParticleScale();
        if (this._forcePixelRatioApply) {
            this._forcePixelRatioApply = false;
            if (typeof this.applyPixelRatioIfNeeded === 'function') this.applyPixelRatioIfNeeded(true);
        }
        this.updateUniforms();
        this.updateNavigationArrow();
        this.updateReferenceGrid();

        // Gate the physics step on the EFFECTIVE tempo, not the base slider.
        // Modulation (Bioclast cymatics, or the core's own _mod oscillation)
        // writes window.S_effective.tempo; if we gated on window.S.tempo a
        // user who parks the tempo slider at 0 could never have an audio patch
        // (or oscillator) lift the sim back into motion — it would look stuck.
        const _effTempo = (window.S_effective && typeof window.S_effective.tempo === 'number')
            ? window.S_effective.tempo : window.S.tempo;
        const skipHiddenGpuCompute = false;
        if (_effTempo > 0.0 && !skipHiddenGpuCompute) {
            try {
                // Single fixed-dt physics step per frame (original behavior).
                // Time dilation / sub-stepping was removed pre-release: at
                // extreme params it drove a period-2 limit cycle that strobed,
                // and the display-side mitigations weren't worth the cost.
                // Tempo (excitation) covers speed control. timeScale is retained
                // in the data model for save/share compatibility but ignored.
                await this.renderer.computeAsync(this.computeClearNode);
                await this.renderer.computeAsync(this.computeAssignNode);
                await this.renderer.computeAsync(this.computeNode);
                // Color histogram — ONCE per frame (not per sub-step), after the
                // grid is freshly populated by the last physics step so the
                // density-mode bin reads correct values. Two tiny passes: clear
                // 16 bins, then one atomic tick per particle.
                const perf = window.SS_PERF || {};
                const bgGlowVal = (typeof window.S.bgGlow === 'number') ? window.S.bgGlow : 0.3;
                const wantsColorHist = (window.S.colorMode || 0) !== 0 && bgGlowVal > 0.02 && window.S.showParticles !== false;
                const safetyLevel = Math.max(0, Math.min(3, Number(window.SS_ADAPTIVE_CULLING?.level) || 0));
                const deepZoom = Math.max(0, Math.min(1, Number(window.SS_ZOOM_OPT?.closeUnder50) || 0));
                const histEvery = Math.max(2, Math.min(30, Math.round((perf.histEveryFrames || 4) + safetyLevel * 4 + deepZoom * 3)));
                if (wantsColorHist && this.computeColorHistNode && !window.SS_NO_HIST && (this._perfFrame % histEvery === 0)) {
                    await this.renderer.computeAsync(this.computeClearColorHistNode);
                    await this.renderer.computeAsync(this.computeColorHistNode);
                    const now = performance.now();
                    if (now - (this._lastHistRead || 0) > 900) {
                        this._lastHistRead = now;
                        this.sampleColorHistogram(); // fire-and-forget; never awaited
                    }
                }
            } catch (e) {
                console.error("Compute Error:", e);
            }
        }

        const xf = window.S._xfade;
        // _xfade is authoritative when present. Set by tour transitions
        // (multi-key) and fadeVisibilityKey (per-key); cleared on stopTour,
        // fade completion, and transition end.
        // _xfadeEnv is a separate channel for the colorMode V-envelope dip,
        // multiplied onto each layer's alpha. See fadeColorModeChange().
        const envMul = (window.S._xfadeEnv !== undefined) ? window.S._xfadeEnv : 1;
        const geometryStyle = resolveConcreteVisualStyle(window.S.visualEffectStyle, window.SS_VISUAL_EFFECT_STYLE);
        // Music/visualizer FX must not implicitly wake the native trail meshes.
        // Trails stay controlled by Strings/Lattice/atlas state unless the
        // deprecated explicit geometry bridge is manually enabled for debugging.
        const geometryFx = window.S.visualEffects !== false && window.S.visualEffectGeometry === true;
        const geometryRibbon = geometryFx && visualStyleHasGeometry(geometryStyle, 'nativeRibbon');
        const geometryLattice = geometryFx && visualStyleHasGeometry(geometryStyle, 'nativeLattice');
        const lineZoom = this.getZoomOptimizationState();
        const frameCounts = this.getFrameParticleCounts(window.S.freeEnergy, lineZoom);
        const frameActiveCount = frameCounts.active;
        const frameDisplayCount = frameCounts.display;
        const manualTrails = !!(window.S.showRibbons || window.S.tessRibbons || window.S.compatAllowManualStructure === true);
        const trailBudget = this.getTrailBudgetState(lineZoom, manualTrails);
        const trailAnimationThrottle = this.getTrailAnimationThrottleState(manualTrails);
        const lineEveryBoost = trailBudget.everyBoost;
        const lineVisibleScale = trailBudget.visibleScale;
        const lineAlphaScale = trailBudget.alphaScale;

        if (this.isPointsFallbackActive()) {
            const nowCompat = performance.now();
            const dtCompat = this._lastCompatFrameTime ? (nowCompat - this._lastCompatFrameTime) / 1000 : 0.016;
            this._lastCompatFrameTime = nowCompat;
            this.stepCompatParticleSimulation(dtCompat);
            this.syncCompatParticleCloud(false);
            this.updateCompatStructureLayers(false);
        } else {
            this._lastCompatFrameTime = 0;
            if (this.compatParticleCloud) this.compatParticleCloud.visible = false;
            if (this.compatRibbonLayer || this.compatCurveLayer || this.compatCellLayer) this._hideCompatStructureLayers();
        }

        if (this.mesh) {
            const showP = (window.S.showParticles !== false);
            const xfP = (xf && xf.particles !== undefined) ? xf.particles : null;
            const baseAlpha = (xfP !== null) ? xfP : (showP ? 1 : 0);
            const alpha = baseAlpha * envMul;
            const pointsVisible = this.isPointDrawActive();
            const shouldRender = alpha > 0.001 && !pointsVisible;
            this.syncGpuPointCloud(alpha, frameDisplayCount);
            this.mesh.visible = shouldRender;
            if (shouldRender) {
                this.mesh.count = frameDisplayCount;
            } else {
                // Belt-and-suspenders: even with mesh.visible=false, zero out
                // the instance count so no draw call can sneak through if a
                // future renderer path bypasses the visibility flag.
                this.mesh.count = 0;
            }
            if (this.mesh.material) {
                this.mesh.material.opacity = alpha;
                this.mesh.material.transparent = true;
            }
        }

        const trailsRequested = !!(window.S.showRibbons || window.S.tessRibbons || geometryFx || window.S.compatAllowManualStructure === true);
        if (!trailsRequested) {
            if (this.ribbonMesh) { this.ribbonMesh.visible = false; this.ribbonMesh.count = 0; if (this.ribbonMesh.material) this.ribbonMesh.material.opacity = 0; }
            if (this.latticeMesh) { this.latticeMesh.visible = false; this.latticeMesh.count = 0; if (this.latticeMesh.material) this.latticeMesh.material.opacity = 0; }
            this._hideCompatStructureLayers();
        }

        if (this.ribbonMesh && trailsRequested) {
            // Strings fade: read xfade if present, else hard state. Compute
            // runs based on the boolean; only material.opacity fades here.
            // Color-mode envelope multiplies onto this alpha.
            const showR = !!window.S.showRibbons || geometryRibbon;
            const xfR = (xf && xf.ribbons !== undefined) ? xf.ribbons : null;
            const baseAlpha = (xfR !== null) ? xfR : (window.S.showRibbons ? 1 : (geometryRibbon ? 0.64 : 0));
            const rawCompatTrailScale = Number(window.S?.compatTrailAlphaScale);
            const compatTrailScale = (this.isPointsFallbackActive() && window.S?.compatSuppressTrails !== false && !window.S.showRibbons)
                ? (Number.isFinite(rawCompatTrailScale) ? rawCompatTrailScale : 0.0)
                : 1;
            const alpha = baseAlpha * envMul * compatTrailScale * lineAlphaScale;
            const shouldRender = alpha > 0.001;
            // Compute uses BASE alpha so envelope dip doesn't pause geometry mid-flip.
            const baseOn = baseAlpha > 0.001;
            this.ribbonMesh.visible = shouldRender;
            if (baseOn && this.computeRibbonNode) {
                const perf = window.SS_PERF || {};
                const every = Math.max(1, Math.min(22, (perf.ribbonEveryFrames || 1) + lineEveryBoost));
                const forceTrailFrame = this.ribbonMesh.count === 0;
                const runTrailFrame = trailAnimationThrottle.enabled
                    ? this.shouldRunTrailAnimationTick('ribbon', trailAnimationThrottle, forceTrailFrame)
                    : (this._perfFrame % every === 0 || forceTrailFrame);
                try {
                    if (runTrailFrame) {
                        await this.renderer.computeAsync(this.computeRibbonNode);
                    }
                    const activeN = this.getTrailDisplayParticleCount(
                        Math.min(frameActiveCount, this._ribbonN),
                        lineVisibleScale,
                        trailBudget.chunk
                    );
                    this.ribbonMesh.count = Math.max(0, activeN - 1) * this._ribbonS;
                } catch(e) { console.error('Ribbon error:', e); }
            }
            if (this.ribbonMesh.material) {
                this.ribbonMesh.material.opacity = alpha;
                this.ribbonMesh.material.transparent = true;
            }
        }

        if (this.latticeMesh && trailsRequested) {
            // Lattice: same fade pattern as ribbons above.
            const showL = !!window.S.tessRibbons || geometryLattice;
            const xfL = (xf && xf.lattice !== undefined) ? xf.lattice : null;
            const baseAlpha = (xfL !== null) ? xfL : (window.S.tessRibbons ? 1 : (geometryLattice ? 0.52 : 0));
            const rawCompatLatticeScale = Number(window.S?.compatLatticeAlphaScale);
            const compatLatticeScale = (this.isPointsFallbackActive() && window.S?.compatSuppressTrails !== false && !window.S.tessRibbons)
                ? Math.max(0, Number.isFinite(rawCompatLatticeScale) ? rawCompatLatticeScale : 0.0)
                : 1;
            const alpha = baseAlpha * envMul * compatLatticeScale * lineAlphaScale;
            const shouldRender = alpha > 0.001;
            const baseOn = baseAlpha > 0.001;
            this.latticeMesh.visible = shouldRender;
            if (baseOn && this.computeLatticeNode) {
                const perf = window.SS_PERF || {};
                const every = Math.max(1, Math.min(26, (perf.latticeEveryFrames || 2) + lineEveryBoost));
                const forceTrailFrame = this.latticeMesh.count === 0;
                const runTrailFrame = trailAnimationThrottle.enabled
                    ? this.shouldRunTrailAnimationTick('lattice', trailAnimationThrottle, forceTrailFrame)
                    : (this._perfFrame % every === 0 || forceTrailFrame);
                try {
                    if (runTrailFrame) {
                        await this.renderer.computeAsync(this.computeLatticeNode);
                    }
                    const activeN = this.getTrailDisplayParticleCount(
                        Math.min(frameActiveCount, this._latticeN),
                        lineVisibleScale,
                        trailBudget.chunk
                    );
                    this.latticeMesh.count = Math.max(0, activeN - 1);
                } catch(e) { console.error('Lattice error:', e); }
            }
            if (this.latticeMesh.material) {
                this.latticeMesh.material.opacity = alpha;
                this.latticeMesh.material.transparent = true;
            }
        }

        this._updateCamera();
        this._syncOffscreenViewport(false);
        this.saveCameraState();

        try {
            await this.renderer.render(this.scene, this.camera);
        } catch (e) {
            console.error("Render Error:", e);
        }
    }
}

const DEFAULT_PERF = {
    maxPixelRatio: 1.75,
    canvasResolutionScale: 0.80,
    visualEffect2DResolutionScale: 0.60,
    defaultFreeEnergy: 80000,
    defaultGpuParticleCapacity: 150000,
    defaultParticleFloor: 0.45,
    histEveryFrames: 4,
    ribbonEveryFrames: 1,
    latticeEveryFrames: 2,
    maxParticles: 150000,
    maxRibbonParticles: 65000,
    maxLatticeParticles: 65000,
    maxPerCell: 16,
    particleInitWorkers: 0,
    gpuResetParticles: true,
    preferWorkerRenderer: true,
    workerCompute: true,
    nativeComputeBackend: 'three-tsl',
    computeBudgetMode: 'native-balanced',
    nativeTrailDepth: 8,
};

const PROFILE_TABLE = {
    quality: {
        maxPixelRatio: 2,
        canvasResolutionScale: 1.0,
        visualEffect2DResolutionScale: 0.85,
        defaultFreeEnergy: 140000,
        defaultGpuParticleCapacity: 220000,
        defaultParticleFloor: 0.70,
        histEveryFrames: 2,
        ribbonEveryFrames: 1,
        latticeEveryFrames: 1,
        maxParticles: 220000,
        maxRibbonParticles: 90000,
        maxLatticeParticles: 90000,
        maxPerCell: 24,
        computeBudgetMode: 'native-quality',
        gpuResetParticles: true,
        nativeTrailDepth: 12,
    },
    balanced: {
        maxPixelRatio: 1.75,
        canvasResolutionScale: 0.80,
        visualEffect2DResolutionScale: 0.60,
        defaultFreeEnergy: 80000,
        defaultGpuParticleCapacity: 150000,
        defaultParticleFloor: 0.45,
        histEveryFrames: 4,
        ribbonEveryFrames: 1,
        latticeEveryFrames: 2,
        maxParticles: 150000,
        maxRibbonParticles: 65000,
        maxLatticeParticles: 65000,
        maxPerCell: 16,
        computeBudgetMode: 'native-balanced',
        gpuResetParticles: true,
        nativeTrailDepth: 8,
    },
    speed: {
        maxPixelRatio: 1.35,
        canvasResolutionScale: 0.62,
        visualEffect2DResolutionScale: 0.42,
        defaultFreeEnergy: 45000,
        defaultGpuParticleCapacity: 110000,
        defaultParticleFloor: 0.32,
        histEveryFrames: 8,
        ribbonEveryFrames: 2,
        latticeEveryFrames: 4,
        maxParticles: 110000,
        maxRibbonParticles: 42000,
        maxLatticeParticles: 42000,
        maxPerCell: 12,
        computeBudgetMode: 'native-speed',
        gpuResetParticles: true,
        nativeTrailDepth: 6,
    },
    potato: {
        maxPixelRatio: 1,
        canvasResolutionScale: 0.48,
        visualEffect2DResolutionScale: 0.28,
        defaultFreeEnergy: 22000,
        defaultGpuParticleCapacity: 75000,
        defaultParticleFloor: 0.25,
        histEveryFrames: 12,
        ribbonEveryFrames: 3,
        latticeEveryFrames: 6,
        maxParticles: 75000,
        maxRibbonParticles: 25000,
        maxLatticeParticles: 25000,
        maxPerCell: 8,
        computeBudgetMode: 'native-potato',
        gpuResetParticles: true,
        nativeTrailDepth: 4,
    },
};

function positiveInt(v, fallback, min = 1, max = 1000000) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

export function initPerformanceDefaults() {
    const existing = window.SS_PERF && typeof window.SS_PERF === 'object' ? window.SS_PERF : {};
    window.SS_PERF = { ...DEFAULT_PERF, ...existing };
    // Do not stomp a saved coordinate at boot. The profile applies render caps,
    // and user-facing defaults are applied only when the user actively changes mode.
    if (window.S && window.S.perfProfile) return setPerformanceProfile(window.S.perfProfile, { applyDefaults: false });
    return window.SS_PERF;
}

function syncUiForPerformanceDefaults() {
    const sync = window.sliderSync || {};
    for (const key of ['canvasResolutionScale', 'visualEffect2DResolutionScale', 'freeEnergy', 'perfParticleScaleMin']) {
        try { if (typeof sync[key] === 'function') sync[key](window.S[key]); } catch (e) {}
    }
    const updaters = window._toggleUpdaters && window._toggleUpdaters.perfProfile;
    if (updaters) updaters.forEach(fn => { try { fn(); } catch (e) {} });
    try { if (typeof window.syncTogglesFromState === 'function') window.syncTogglesFromState(); } catch (e) {}
    try { if (typeof window.refreshRadialUI === 'function') window.refreshRadialUI(); } catch (e) {}
    try { window.dispatchEvent(new CustomEvent('scalespace-audio-visual-state')); } catch (e) {}
}


export function setPerformanceProfile(profile = 'balanced', options = {}) {
    const p = String(profile || 'balanced');
    const base = PROFILE_TABLE[p] || PROFILE_TABLE.balanced;
    const prev = window.SS_PERF || {};
    const applyDefaults = options && options.applyDefaults !== false;

    if (window.S && applyDefaults) {
        window.S.perfProfile = PROFILE_TABLE[p] ? p : 'balanced';
        window.S.canvasResolutionScale = Number(base.canvasResolutionScale ?? DEFAULT_PERF.canvasResolutionScale);
        window.S.visualEffect2DResolutionScale = Number(base.visualEffect2DResolutionScale ?? DEFAULT_PERF.visualEffect2DResolutionScale);
        window.S.perfParticleScaleMin = Number(base.defaultParticleFloor ?? DEFAULT_PERF.defaultParticleFloor);
        window.S.gpuParticleCapacity = positiveInt(base.defaultGpuParticleCapacity ?? base.maxParticles, base.maxParticles, 1000, 1000000);
        window.S.freeEnergy = positiveInt(base.defaultFreeEnergy ?? Math.min(base.maxParticles, window.S.gpuParticleCapacity), DEFAULT_PERF.defaultFreeEnergy, 500, window.S.gpuParticleCapacity);
    }

    const capSource = applyDefaults
        ? (base.defaultGpuParticleCapacity ?? base.maxParticles)
        : (window.S && Number.isFinite(+window.S.gpuParticleCapacity) ? +window.S.gpuParticleCapacity : (base.defaultGpuParticleCapacity ?? base.maxParticles));
    const profileCap = positiveInt(capSource, base.maxParticles, 1000, 1000000);
    const next = {
        ...DEFAULT_PERF,
        ...prev,
        ...base,
        maxParticles: profileCap,
    };

    window.SS_PERF = next;
    if (window.engine && typeof window.engine.applyPixelRatioIfNeeded === 'function') {
        window.engine.applyPixelRatioIfNeeded(true);
    }
    if (window.engine && typeof window.engine.applyPerfLimits === 'function') {
        window.engine.applyPerfLimits();
    }
    if (window.engine && applyDefaults) {
        if (typeof window.engine.resize === 'function') {
            try { window.engine.resize(window.innerWidth, window.innerHeight); } catch (e) {}
        }
        if (typeof window.engine.resizeParticles === 'function') {
            try { window.engine.resizeParticles(Math.round(window.S.freeEnergy)); } catch (e) {}
        }
    }
    if (applyDefaults && window.S) {
        syncUiForPerformanceDefaults();
        try { localStorage.setItem('ss_state', JSON.stringify(window.S)); } catch (e) {}
    }
    return next;
}

export function getPerformanceSettings() {
    if (!window.SS_PERF) initPerformanceDefaults();
    return window.SS_PERF || DEFAULT_PERF;
}

export function resolveParticleCapacity(requested) {
    const perf = getPerformanceSettings();
    const req = Number.isFinite(+requested) ? +requested : perf.maxParticles;
    return positiveInt(req, perf.maxParticles, 1000, 1000000);
}

export function resolveMaxPerCell() {
    const perf = getPerformanceSettings();
    return positiveInt(perf.maxPerCell, DEFAULT_PERF.maxPerCell, 4, 32);
}

export function clampActiveParticleCount(v, capacity = resolveParticleCapacity()) {
    return positiveInt(v, 0, 0, capacity);
}

export function resolveRibbonParticleCount(v, capacity = resolveParticleCapacity()) {
    const perf = getPerformanceSettings();
    const cap = positiveInt(perf.maxRibbonParticles, 65000, 1000, capacity);
    return positiveInt(v, 0, 0, Math.min(cap, capacity));
}

export function resolveLatticeParticleCount(v, capacity = resolveParticleCapacity()) {
    const perf = getPerformanceSettings();
    const cap = positiveInt(perf.maxLatticeParticles, 65000, 1000, capacity);
    return positiveInt(v, 0, 0, Math.min(cap, capacity));
}

export function describeRuntimeCapabilities() {
    return {
        webgpu: typeof navigator !== 'undefined' && !!navigator.gpu,
        workers: typeof Worker !== 'undefined',
        sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
        crossOriginIsolated: typeof globalThis.crossOriginIsolated === 'boolean' ? !!globalThis.crossOriginIsolated : false,
        hardwareConcurrency: typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency || 0) : 0,
    };
}

if (typeof window !== 'undefined') {
    window.setScaleSpacePerformanceProfile = setPerformanceProfile;
    window.getScaleSpaceRuntimeCapabilities = describeRuntimeCapabilities;
}

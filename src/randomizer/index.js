import { setPerformanceProfile } from '../render/performance.js';
import {
    SAFE_EFFECT_STYLES as VISUAL_EFFECT_SAFE_STYLES,
    VISUAL_EFFECT_PICK_STYLES,
    VISUAL_EFFECT_STYLES
} from '../render/visual-style-registry.js';
import { AUDIO_2D_BACKDROP_STYLE_IDS, AUDIO_2D_RANDOM_STYLE_POOL } from '../render/audio-fx-registry.js';
import {
    AUDIO_PILOT_KEYS,
    AUDIO_REACTIVE_CONTROL_KEYS,
    audioPilotStateKey,
    randomizerPilotStateKey,
    isAudioPilotEnabled,
    isRandomizerPilotEnabled,
    sanitizeAudioWaypointState,
    AUDIO_WAYPOINT_KEYS
} from '../audio/pilot.js';
const SAFE_RANDOM_RANGES = {
    tempo:       { min: 0.08,  max: 3.25, step: 0.01, curve: 'linear' },
    resolution:  { min: 0.03,  max: 8.0, step: 0.01, curve: 'log' },
    inversion:   { min: 70,    max: 520, step: 1, curve: 'linear' },
    halfLife:    { min: 1.0,   max: 30, step: 0.1, curve: 'linear' },
    scaleDepth:  { min: 0.035, max: 5.8, step: 0.01, curve: 'lowWeighted' },
    physicsEmergence: { min: -6.5, max: 6.5, step: 0.01, curve: 'signedExtreme' },
    coherence:   { min: 0.2,   max: 210, step: 1, curve: 'lowWeighted' },
    equilibrium: { min: 0.001, max: 0.13, step: 0.001, curve: 'log' },
    temperature: { min: 0,     max: 1.85, step: 0.01, curve: 'linear' },
    viscosity:   { min: 0,     max: 0.82, step: 0.01, curve: 'linear' },
    mass:        { min: 0.1,   max: 4.25, step: 0.05, curve: 'log' },

    opacity:   { min: 0.05, max: 0.56, step: 0.01, curve: 'linear' },
    trailLen:  { min: 3,    max: 30, step: 1, curve: 'linear' },
    hue:       { min: 0.01, max: 1, step: 0.01, curve: 'linear' },
    sat:       { min: 0.25, max: 1.5, step: 0.01, curve: 'linear' },
    lightness: { min: 0.55, max: 1.18, step: 0.01, curve: 'linear' },
    bgGlow:    { min: 0.02, max: 0.8, step: 0.02, curve: 'linear' },
    bgBlur:    { min: 0,    max: 180, step: 1, curve: 'linear' },
    visualEffectAmount: { min: 0.50, max: 2.20, step: 0.01, curve: 'linear' },
    visualEffectQuality: { min: 0.34, max: 0.72, step: 0.01, curve: 'linear' },
    visualEffectEcho: { min: 0.06, max: 0.30, step: 0.01, curve: 'linear' },
    visualEffectAberration: { min: 0.10, max: 0.82, step: 0.01, curve: 'linear' },
    visualEffectRings: { min: 0.35, max: 1.2, step: 0.01, curve: 'linear' },
    visualEffectExpressivity: { min: 1.10, max: 2.45, step: 0.01, curve: 'linear' },
    visualEffectDynamics: { min: 0.95, max: 2.35, step: 0.01, curve: 'linear' },
    visualEffect2DBackdropMix: { min: 0.75, max: 2.0, step: 0.01, curve: 'linear' },
    visualEffect2DFade: { min: 0.0, max: 0.18, step: 0.01, curve: 'linear' },
    visualEffect3DFade: { min: 0.22, max: 0.85, step: 0.01, curve: 'linear' },

    audioOscHz:  { min: 45, max: 880, step: 1, curve: 'log' },
    audioFxGain: { min: 0.35, max: 2.8, step: 0.01, curve: 'linear' },
    audioReactiveAmount: { min: 0.65, max: 2.25, step: 0.01, curve: 'linear' },
    audioReactiveGain: { min: 3.0, max: 8.5, step: 0.01, curve: 'linear' },
    audioReactiveAttack: { min: 0.025, max: 0.12, step: 0.001, curve: 'linear' },
    audioReactiveRelease: { min: 0.006, max: 0.032, step: 0.001, curve: 'linear' },
    audioReactiveRelaxation: { min: 0.25, max: 1.35, step: 0.01, curve: 'linear' },
    audioColorBeat: { min: 0.45, max: 2.35, step: 0.01, curve: 'linear' },
    audioParticleDrive: { min: 0.55, max: 2.25, step: 0.01, curve: 'linear' },
    audioParticleMotionDrive: { min: 0.35, max: 2.6, step: 0.01, curve: 'linear' },
    audioParticleColorDrive: { min: 0.25, max: 2.4, step: 0.01, curve: 'linear' },
};

const HISTORY_KEY = 'ss_randomizer_history';
const MAX_HISTORY = 10;

const NUMERIC_VISUAL_KEYS = [
    'tempo', 'resolution', 'inversion', 'halfLife', 'scaleDepth', 'physicsEmergence',
    'coherence', 'equilibrium', 'temperature', 'viscosity', 'mass',
    'opacity', 'trailLen', 'hue', 'sat', 'lightness', 'bgGlow', 'bgBlur',
    'visualEffectAmount', 'visualEffectQuality', 'visualEffectEcho', 'visualEffectAberration', 'visualEffectRings', 'visualEffectExpressivity', 'visualEffectDynamics',
    'visualEffect2DBackdropMix', 'visualEffect2DFade', 'visualEffect3DFade'
];
const NON_RANDOMIZED_FX_FADE_KEYS = ['visualEffect2DFade', 'visualEffect3DFade'];
const NUMERIC_VISUAL_RANDOMIZER_KEYS = NUMERIC_VISUAL_KEYS.filter(key => !NON_RANDOMIZED_FX_FADE_KEYS.includes(key));
const RANDOM_NUMERIC_AUDIO_KEYS = ['audioOscHz', 'audioFxGain'];
const NUMERIC_AUDIO_KEYS = [...RANDOM_NUMERIC_AUDIO_KEYS, ...AUDIO_REACTIVE_CONTROL_KEYS];
const AUDIO_PILOT_STATE_KEYS = AUDIO_PILOT_KEYS.map(key => audioPilotStateKey(key));
const RANDOMIZER_PILOT_STATE_KEYS = AUDIO_PILOT_KEYS.map(key => randomizerPilotStateKey(key));
const STRING_VISUAL_KEYS = ['compatFlowMode', 'visualEffectStyle', 'visualEffect2DBackdropStyle'];
const DISCRETE_KEYS = ['shape', 'colorMode', 'showParticles', 'showRibbons', 'tessRibbons', 'visualEffects', 'visualEffectBackdrop', 'visualEffect2DBackdrop', 'visualEffectPost', 'visualEffectCenterSwim', 'visualEffectNoTrailStyles', 'audioLoop', 'audioMuted', 'audioReactive', 'audioAutoEnableVisuals', 'perfProfile', 'visualEffectRandomize', 'randomizerSourceMode', ...RANDOMIZER_PILOT_STATE_KEYS, ...AUDIO_PILOT_STATE_KEYS];
const USER_CONTROLLED_FX_LAYER_KEYS = ['visualEffects', 'visualEffectBackdrop', 'visualEffect2DBackdrop', 'visualEffectPost'];
const USER_CONTROLLED_AUDIO_MENU_KEYS = [
    ...USER_CONTROLLED_FX_LAYER_KEYS,
    ...RANDOMIZER_PILOT_STATE_KEYS,
    ...AUDIO_PILOT_STATE_KEYS,
    'audioLoop',
    'audioMuted',
    'audioReactive',
    'audioMonitor',
    'audioAutoEnableVisuals',
    'visualEffectRandomize',
    'randomizerSourceMode',
    'audioAutoEnableVisuals'
];
const LIVE_EDIT_OWNED_TRANSITION_KEYS = new Set([
    ...USER_CONTROLLED_AUDIO_MENU_KEYS,
    ...AUDIO_WAYPOINT_KEYS,
]);
const RANDOMIZER_FX_KEYS = [
    'compatFlowMode',
    'visualEffectStyle',
    'visualEffect2DBackdropStyle',
    'visualEffectAmount',
    'visualEffectQuality',
    'visualEffectEcho',
    'visualEffectAberration',
    'visualEffectRings',
    'visualEffectExpressivity',
    'visualEffectDynamics',
    'visualEffect2DBackdropMix',
    'visualEffect2DFade',
    'visualEffect3DFade',
    'visualEffectCenterSwim',
    'visualEffectNoTrailStyles'
];
const SNAPSHOT_KEYS = [...NUMERIC_VISUAL_KEYS, ...NUMERIC_AUDIO_KEYS, ...STRING_VISUAL_KEYS, ...DISCRETE_KEYS];

const SHAPES = ['circle', 'square', 'diamond'];
const COLOR_MODES = [0, 1, 2, 3, 4];
const RANDOM_COLOR_MODES = [1, 2, 3, 4];
const COMPAT_FLOW_MODES = ['adaptive', 'plume', 'vortex', 'sheet', 'ribbon', 'cellular', 'helix', 'cymatic', 'burst'];
const VISUAL_2D_BACKDROP_STYLES = AUDIO_2D_BACKDROP_STYLE_IDS;
const PASTEL_2D_BACKDROP_STYLES = AUDIO_2D_BACKDROP_STYLE_IDS.filter(id => String(id).startsWith('pastel'));
const SOFT_PALETTE_2D_BACKDROP_STYLES = [
    ...PASTEL_2D_BACKDROP_STYLES,
    'softwaves', 'silkflow', 'gradientflow', 'contourveil', 'dreamblobs', 'prismadrift',
    'jazzhaze', 'opalbloom', 'nebulawash', 'bokehbloom', 'chromafog', 'ambientglow', 'spectralmist', 'aurora'
].filter(id => AUDIO_2D_BACKDROP_STYLE_IDS.includes(id));
const EXPRESSIVE_EFFECT_STYLES = ['cymatics', 'kaleido', 'constellation', 'vectorscope', 'tunnel', 'aurora', 'moire', 'hyperspace', 'starfield', 'trails', 'ribbons', 'matrixrain', 'starfield', 'matrixrain'];
const EXPRESSIVE_2D_BACKDROP_STYLES = AUDIO_2D_RANDOM_STYLE_POOL;
const EXPRESSIVE_FLOW_MODES = ['vortex', 'ribbon', 'helix', 'cymatic', 'burst', 'plume', 'cellular', 'sheet'];
function _pick2DBackdropStyle() {
    if (PASTEL_2D_BACKDROP_STYLES.length && _rand() < 0.52) return _pick(PASTEL_2D_BACKDROP_STYLES);
    if (SOFT_PALETTE_2D_BACKDROP_STYLES.length && _rand() < 0.78) return _pick(SOFT_PALETTE_2D_BACKDROP_STYLES);
    return _pick(EXPRESSIVE_2D_BACKDROP_STYLES);
}
function _pickVisualEffectStyle() {
    const pool = window.S?.visualEffectNoTrailStyles !== false ? VISUAL_EFFECT_SAFE_STYLES : VISUAL_EFFECT_PICK_STYLES;
    const expressive = EXPRESSIVE_EFFECT_STYLES.filter(style => pool.includes(style));
    return _pick(expressive.length ? expressive : pool);
}
function _randomizerVisualEffectsEnabled() {
    if (typeof window.S?.visualEffects === 'boolean') return window.S.visualEffects;
    return window.S?.audioOn === true || window.S?.audioReactive === true || !!(window.audio && window.audio.active);
}
function _currentLayerFlag(key, fallback = true) {
    return window.S && window.S[key] !== undefined ? window.S[key] !== false : !!fallback;
}

function _isAtlasRandomizerApply(opts = {}) {
    return opts.source === 'atlas-randomizer' || opts.source === 'continuous-atlas' || opts.applyAtlasWaypointState === true;
}

function _shouldRespectAudioPilot(opts = {}) {
    if (opts.respectAudioPilot === false) return false;
    return (
        opts.continuous === true ||
        opts.source === 'randomizer' ||
        opts.source === 'atlas-randomizer' ||
        opts.source === 'continuous-atlas' ||
        opts.source === 'preset' ||
        opts.source === 'history' ||
        opts.applyAtlasWaypointState === true ||
        opts.sourceMode !== undefined
    );
}

function _canPilotKey(key, opts = {}) {
    return !_shouldRespectAudioPilot(opts) || !AUDIO_PILOT_KEYS.includes(key) || isRandomizerPilotEnabled(key);
}

function _shouldPreserveAudioMenuState(opts = {}) {
    if (opts.preserveAudioMenuState === false) return false;
    if (_isAtlasRandomizerApply(opts)) return false;
    return _shouldRespectAudioPilot(opts);
}

function _clearDisabledAudioPilotEffective() {
    if (!window.S_effective) return;
    for (const key of AUDIO_PILOT_KEYS) {
        if (!isAudioPilotEnabled(key)) delete window.S_effective[key];
    }
}

function _continuousAudioPilotMaskSettings() {
    const out = {};
    const rebuildMask = _rand() < 0.22;
    const baseEnabledChance = 0.38 + _rand() * 0.42;
    let enabledCount = 0;

    for (const key of AUDIO_PILOT_KEYS) {
        if (NON_RANDOMIZED_FX_FADE_KEYS.includes(key)) continue;
        const stateKey = audioPilotStateKey(key);
        const current = window.S && typeof window.S[stateKey] === 'boolean'
            ? window.S[stateKey] !== false
            : true;
        let next = current;

        if (key === 'showParticles') {
            next = true;
        } else if (rebuildMask) {
            const keyBias = key === 'shape' || key === 'colorMode' ? -0.10 : 0;
            next = _rand() < Math.max(0.18, Math.min(0.92, baseEnabledChance + keyBias));
        } else {
            const flipChance = key === 'shape' || key === 'colorMode' ? 0.20 : 0.13;
            if (_rand() < flipChance) next = !current;
        }

        out[stateKey] = !!next;
        if (out[stateKey]) enabledCount++;
    }

    const mutablePilotKeys = AUDIO_PILOT_KEYS.filter(k => k !== 'showParticles' && !NON_RANDOMIZED_FX_FADE_KEYS.includes(k));
    const minEnabled = Math.max(5, Math.floor(mutablePilotKeys.length * 0.28));
    while (enabledCount < minEnabled && mutablePilotKeys.length) {
        const key = _pick(mutablePilotKeys);
        const stateKey = audioPilotStateKey(key);
        if (out[stateKey] !== true) {
            out[stateKey] = true;
            enabledCount++;
        }
    }

    return out;
}

function _randomizerApplyOptions(opts = {}, picked = {}) {
    if (picked && picked.source === 'atlas') {
        return {
            ...opts,
            source: opts.continuous ? 'continuous-atlas' : 'atlas-randomizer',
            respectAudioPilot: true,
            preserveAudioMenuState: false,
            preserveRandomizerSourceMode: true,
            applyAtlasWaypointState: true,
        };
    }
    return { ...opts, source: 'randomizer' };
}

function _respectAudioPilotLocks(settings, opts = {}) {
    if (!settings) return settings;
    const filtered = { ...settings };
    const liveSourceMode = window.S?.randomizerSourceMode;
    const randomizePilotMask = opts.randomizeAudioPilotMask === true;
    const applyRandomizerPilotMask = opts.applyRandomizerPilotMask === true;

    if (!applyRandomizerPilotMask) {
        for (const key of RANDOMIZER_PILOT_STATE_KEYS) delete filtered[key];
    }

    if (_shouldRespectAudioPilot(opts)) {
        for (const key of AUDIO_PILOT_KEYS) {
            if (!isRandomizerPilotEnabled(key)) delete filtered[key];
        }
    }
    if (_shouldPreserveAudioMenuState(opts)) {
        for (const key of USER_CONTROLLED_AUDIO_MENU_KEYS) {
            if (randomizePilotMask && AUDIO_PILOT_STATE_KEYS.includes(key)) continue;
            delete filtered[key];
        }
    }

    if (opts.applyRandomizerSourceMode !== true) {
        delete filtered.randomizerSourceMode;
    }

    if (_shouldRespectAudioPilot(opts) && window.S?.visualEffectRandomize === false) {
        for (const key of RANDOMIZER_FX_KEYS) {
            delete filtered[key];
        }
    }
    return filtered;
}

function _randomizerChaos() {
    const n = Number(window.S?.randomizerChaos);
    return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0.68));
}

function _currentFreeEnergyCap() {
    const s = window.S || {};
    const explicit = Number(s.randomizerFreeEnergyCap);
    const current = Number(s.freeEnergy);
    const capacity = Number(s.gpuParticleCapacity);
    const vals = [explicit, current, capacity].filter(Number.isFinite).filter(v => v > 0);
    return vals.length ? Math.max(500, Math.min(...vals)) : Infinity;
}

function _respectFreeEnergyCap(settings, opts = {}) {
    if (!settings || !Number.isFinite(Number(settings.freeEnergy))) return settings;
    // Continuous/random rolls should never silently push the live particle count
    // above the user/atlas-established cap. If the user deliberately loads an
    // atlas with a high count, that becomes the visible cap; randomizer drift is
    // still bounded below that value. Adaptive Count can then downscale live work.
    if (opts.preserveFreeEnergy === true || opts.continuous === true) {
        const cap = _currentFreeEnergyCap();
        if (Number.isFinite(cap)) settings.freeEnergy = Math.min(Number(settings.freeEnergy), cap);
    }
    return settings;
}

function _isLowValueScene(settings = {}) {
    const id = String(settings._familyId || '');
    return settings._lowValueScene === true || settings._leftWeightedScene === true || id.includes('micro') || id.includes('quiet') || id.includes('low');
}

function _leftLaneValue(min, max, power = 1.8, step = 0.01) {
    const lo = Number(min);
    const hi = Number(max);
    const t = Math.pow(_rand(), power);
    return _roundToStep(lo + (hi - lo) * t, step);
}

function _maybeBoostAccent(settings, key, min, max, chance = 0.5, power = 0.65) {
    if (_rand() > chance) return;
    settings[key] = _leftLaneValue(min, max, power, SAFE_RANDOM_RANGES[key]?.step || 0.01);
}

function _applyLeftWeightedScene(settings, opts = {}) {
    if (!settings || opts.leftWeightedScene === false) return settings;
    const chanceRaw = Number(opts.leftWeightedChance);
    const chance = Number.isFinite(chanceRaw) ? Math.max(0, Math.min(1, chanceRaw)) : 0.20;
    if (settings._leftWeightedScene !== true && _rand() >= chance) return settings;

    settings._leftWeightedScene = true;
    settings._lowValueScene = true;

    settings.inversion = _leftLaneValue(30, 210, 1.35, 1);
    settings.scaleDepth = _leftLaneValue(0.025, 0.95, 2.20, 0.01);
    settings.coherence = _leftLaneValue(0.2, 19.0, 1.85, 1);
    settings.equilibrium = _leftLaneValue(0.001, 0.034, 2.25, 0.001);
    settings.temperature = _leftLaneValue(0.00, 0.58, 2.10, 0.01);
    settings.viscosity = _leftLaneValue(0.00, 0.36, 2.15, 0.01);
    settings.mass = _leftLaneValue(0.10, 0.82, 2.25, 0.05);
    settings.resolution = _leftLaneValue(0.035, 1.15, 1.85, 0.01);
    settings.opacity = _leftLaneValue(0.055, 0.30, 1.70, 0.01);
    settings.bgGlow = _leftLaneValue(0.02, 0.32, 1.85, 0.02);
    settings.bgBlur = _leftLaneValue(0, 78, 1.70, 1);

    // Keep halfLife on its normal randomizer path. The interesting low-left
    // scenes usually come from letting one or two other axes break formation.
    const accents = ['physicsEmergence', 'temperature', 'equilibrium', 'viscosity', 'inversion', 'resolution', 'opacity'];
    const picks = new Set(['physicsEmergence']);
    while (picks.size < 3) picks.add(_pick(accents));

    if (picks.has('physicsEmergence')) {
        const t = Math.pow(_rand(), 0.48);
        settings.physicsEmergence = _roundToStep((_rand() < 0.5 ? -1 : 1) * (0.14 + t * 7.2), 0.01);
    }
    if (picks.has('temperature')) _maybeBoostAccent(settings, 'temperature', 0.62, 2.25, 1.0, 0.70);
    if (picks.has('equilibrium')) _maybeBoostAccent(settings, 'equilibrium', 0.036, 0.16, 1.0, 0.72);
    if (picks.has('viscosity')) _maybeBoostAccent(settings, 'viscosity', 0.38, 0.90, 1.0, 0.75);
    if (picks.has('inversion')) _maybeBoostAccent(settings, 'inversion', 215, 500, 1.0, 0.72);
    if (picks.has('resolution')) _maybeBoostAccent(settings, 'resolution', 1.20, 6.5, 1.0, 0.72);
    if (picks.has('opacity')) _maybeBoostAccent(settings, 'opacity', 0.31, 0.58, 1.0, 0.82);

    settings.compatFlowMode = _pick(['sheet', 'vortex', 'cymatic', 'ribbon', 'helix']);
    settings.visualEffectStyle = _pick(['moire', 'vectorscope', 'cymatics', 'trails', 'constellation', 'ribbons']);
    settings.visualEffect2DBackdropStyle = _pick2DBackdropStyle();
    return settings;
}

function _avoidTinyCenterBall(settings, opts = {}) {
    if (!settings) return settings;
    const current = window.S || {};
    const lowScene = _isLowValueScene(settings);

    const inv = Number(settings.inversion ?? current.inversion);
    if (Number.isFinite(inv)) {
        settings.inversion = lowScene
            ? Math.max(inv, settings._leftWeightedScene ? 30 : 68 + _rand() * 170)
            : Math.max(inv, 74 + _rand() * 150);
    }

    const depth = Number(settings.scaleDepth ?? current.scaleDepth);
    if (Number.isFinite(depth)) {
        settings.scaleDepth = lowScene
            ? Math.min(Math.max(depth, 0.025 + _rand() * 0.08), 0.98)
            : (depth < 0.08 ? 0.08 + _rand() * 0.30 : depth);
    }

    // Blob rescue used to push temperature upward, which made continuous mode
    // drift into yellow fuzzy balls. Keep temperature low/mid unless the current
    // scene family explicitly wants heat.
    const temp = Number(settings.temperature ?? current.temperature);
    if (Number.isFinite(temp) && temp > (settings._leftWeightedScene ? 2.35 : (lowScene ? 0.58 : 1.08))) settings.temperature = 0.04 + _rand() * (lowScene ? 0.34 : 0.78);

    const coh = Number(settings.coherence ?? current.coherence);
    if (Number.isFinite(coh)) {
        settings.coherence = lowScene
            ? Math.min(Math.max(coh, 0.2 + _rand() * 1.8), 19.5)
            : (coh < 22 ? Math.max(coh, 0.2 + _rand() * 3.8) : Math.max(coh, 22 + _rand() * 58));
    }

    const eq = Number(settings.equilibrium ?? current.equilibrium);
    if (Number.isFinite(eq) && eq > (settings._leftWeightedScene ? 0.17 : (lowScene ? 0.034 : 0.086))) settings.equilibrium = 0.001 + _rand() * (lowScene ? 0.020 : 0.060);

    const op = Number(settings.opacity ?? current.opacity);
    if (Number.isFinite(op) && op > (settings._leftWeightedScene ? 0.62 : 0.48)) settings.opacity = 0.11 + _rand() * 0.30;

    const emer = Number(settings.physicsEmergence ?? current.physicsEmergence);
    if (Number.isFinite(emer) && Math.abs(emer) < (lowScene ? 0.035 : 0.38)) {
        settings.physicsEmergence = (_rand() < 0.5 ? -1 : 1) * (lowScene ? 0.04 + _rand() * 0.42 : 0.48 + _rand() * 1.15);
    }

    if (settings.showRibbons === undefined && _rand() < 0.52) settings.showRibbons = true;
    if (settings.tessRibbons === undefined && _rand() < 0.24) settings.tessRibbons = true;
    return settings;
}

function _defuzzParticleSnapshot(settings, opts = {}) {
    if (!settings) return settings;
    const family = String(settings._familyId || '');
    const lowScene = _isLowValueScene(settings);
    const hotFamilies = new Set(['hyperspace-tunnel', 'matrix-cascade', 'split-plume']);

    // Keep particle scenes readable: one/two strong extremes, other diffusion
    // controls low. Audio/backdrop layers carry most of the chaos.
    if (lowScene) {
        settings.temperature = Math.min(Number(settings.temperature) || 0, settings._leftWeightedScene ? 2.25 : 0.54);
        settings.equilibrium = Math.min(Number(settings.equilibrium) || 0.012, settings._leftWeightedScene ? 0.16 : 0.034);
        settings.opacity = Math.min(Number(settings.opacity) || 0.18, settings._leftWeightedScene ? 0.58 : 0.34);
    } else if (!hotFamilies.has(family)) {
        settings.temperature = Math.min(Number(settings.temperature) || 0, 0.88);
        settings.equilibrium = Math.min(Number(settings.equilibrium) || 0.03, 0.068);
        settings.opacity = Math.min(Number(settings.opacity) || 0.24, 0.42);
    }
    if (lowScene) {
        settings.coherence = Math.min(Math.max(Number(settings.coherence) || 0, 0.2), 20);
        settings.inversion = Math.max(Number(settings.inversion) || 0, settings._leftWeightedScene ? 30 : 68);
        settings.scaleDepth = Math.min(Math.max(Number(settings.scaleDepth) || 0.05, 0.025), 1.0);
    } else {
        const coherence = Number(settings.coherence);
        settings.coherence = Number.isFinite(coherence) && coherence < 22
            ? Math.max(coherence, 0.2)
            : Math.max(coherence || 0, 22);
        settings.inversion = Math.max(Number(settings.inversion) || 0, 74);
        const depth = Number(settings.scaleDepth);
        settings.scaleDepth = Number.isFinite(depth) && depth > 0 ? Math.max(0.08, depth) : 0.62;
    }

    // Avoid pale overblown mono balls.
    settings.colorMode = RANDOM_COLOR_MODES.includes(Number(settings.colorMode)) ? settings.colorMode : _pick(RANDOM_COLOR_MODES);
    settings.sat = Math.max(0.82, Math.min(1.55, Number(settings.sat) || 1.05));
    settings.lightness = Math.min(1.05, Math.max(0.56, Number(settings.lightness) || 0.82));

    // Resolution should explore above 1 too; only clamp absurd spikes.
    const res = Number(settings.resolution);
    if (Number.isFinite(res)) settings.resolution = Math.max(0.10, Math.min(7.5, res));
    return settings;
}

function _addExpressiveStructure(settings, opts = {}) {
    if (!settings) return settings;
    const chaos = _randomizerChaos();
    const lowScene = _isLowValueScene(settings);
    const currentEmergence = Number(settings.physicsEmergence) || 0;
    if (lowScene) {
        if (Math.abs(currentEmergence) < 0.04) {
            settings.physicsEmergence = (_rand() < 0.5 ? -1 : 1) * _roundToStep(0.05 + _rand() * 0.45, 0.01);
        }
    } else if (Math.abs(currentEmergence) < 0.85 + chaos * 0.85) {
        const t = Math.pow(_rand(), 0.45);
        settings.physicsEmergence = (_rand() < 0.5 ? -1 : 1) * _roundToStep(0.85 + t * (2.35 + chaos * 3.15), 0.01);
    }
    settings.compatFlowMode = EXPRESSIVE_FLOW_MODES.includes(settings.compatFlowMode) && _rand() > 0.28
        ? settings.compatFlowMode
        : _pick(EXPRESSIVE_FLOW_MODES);
    settings.visualEffects = true;
    settings.visualEffectBackdrop = _currentLayerFlag('visualEffectBackdrop', true);
    settings.visualEffect2DBackdrop = _currentLayerFlag('visualEffect2DBackdrop', true);
    settings.visualEffectPost = _currentLayerFlag('visualEffectPost', true);
    settings.visualEffectStyle = VISUAL_EFFECT_STYLES.includes(settings.visualEffectStyle) && _rand() > 0.38
        ? settings.visualEffectStyle
        : _pickVisualEffectStyle();
    settings.visualEffect2DBackdropStyle = VISUAL_2D_BACKDROP_STYLES.includes(settings.visualEffect2DBackdropStyle) && _rand() > 0.32
        ? settings.visualEffect2DBackdropStyle
        : _pick2DBackdropStyle();
    settings.visualEffectAmount = Math.max(Number(settings.visualEffectAmount) || 0, (lowScene ? 0.72 : 0.92) + _rand() * 0.85);
    settings.visualEffectExpressivity = Math.max(Number(settings.visualEffectExpressivity) || 0, (lowScene ? 1.18 : 1.32) + _rand() * 0.82);
    settings.visualEffectDynamics = Math.max(Number(settings.visualEffectDynamics) || 0, (lowScene ? 0.92 : 1.08) + _rand() * 0.72);
    settings.visualEffectRings = Math.max(Number(settings.visualEffectRings) || 0, 0.58 + _rand() * 0.40);
    settings.visualEffectAberration = Math.max(Number(settings.visualEffectAberration) || 0, 0.16 + _rand() * 0.38);
    settings.showRibbons = settings.showRibbons !== false || _rand() < 0.50;
    settings.tessRibbons = settings.showRibbons && (settings.tessRibbons === true || _rand() < (opts.continuous ? 0.34 : 0.46));
    settings.trailLen = Math.max(Math.round(Number(settings.trailLen) || 0), Math.round((lowScene ? 7 : 10) + _rand() * 17));
    settings.bgGlow = Math.max(Number(settings.bgGlow) || 0, (lowScene ? 0.06 : 0.12) + _rand() * 0.34);
    settings.bgBlur = Math.max(Number(settings.bgBlur) || 0, Math.round((lowScene ? 6 : 18) + _rand() * 92));
    return settings;
}

export const RANDOMIZER_PRESETS = [
    {
        id: 'coffee-shop-rain',
        group: 'Weather You Can Hear',
        name: 'Coffee Shop Rain',
        blurb: 'warm window glow, soft rain, laptop hum, tiny trails behaving themselves',
        settings: {
            freeEnergy: 54000, resolution: 0.82, inversion: 138, halfLife: 22.5, scaleDepth: 2.2,
            coherence: 68, equilibrium: 0.012, temperature: 0.34, viscosity: 0.46, mass: 1.15,
            tempo: 0.72, opacity: 0.34, trailLen: 26, hue: 0.105, sat: 0.92, lightness: 0.86,
            bgGlow: 0.42, bgBlur: 135, shape: 'circle', colorMode: 1,
            showParticles: true, showRibbons: true, tessRibbons: false,
            audioOscHz: 98, audioFxGain: 1.05, volume: 0.32, audioLoop: true
        }
    },
    {
        id: 'thunderhead-at-3am',
        group: 'Weather You Can Hear',
        name: 'Thunderhead at 3 AM',
        blurb: 'slow heavy cloud brain, bright rim flashes, everything feels electrically damp',
        settings: {
            freeEnergy: 124000, resolution: 0.38, inversion: 92, halfLife: 9.2, scaleDepth: 3.0,
            coherence: 38, equilibrium: 0.074, temperature: 1.46, viscosity: 0.64, mass: 2.35,
            tempo: 1.28, opacity: 0.31, trailLen: 13, hue: 0.59, sat: 0.74, lightness: 0.72,
            bgGlow: 0.48, bgBlur: 94, shape: 'square', colorMode: 2,
            showParticles: true, showRibbons: true, tessRibbons: false,
            audioOscHz: 63, audioFxGain: 2.32, volume: 0.54, audioLoop: true
        }
    },
    {
        id: 'monsoon-window',
        group: 'Weather You Can Hear',
        name: 'Monsoon Window',
        blurb: 'water crawling down glass while the room turns blue and sleepy',
        settings: {
            freeEnergy: 98000, resolution: 0.5, inversion: 74, halfLife: 5.8, scaleDepth: 1.55,
            coherence: 26, equilibrium: 0.13, temperature: 0.86, viscosity: 0.72, mass: 2.0,
            tempo: 1.7, opacity: 0.23, trailLen: 9, hue: 0.55, sat: 0.68, lightness: 0.82,
            bgGlow: 0.36, bgBlur: 78, shape: 'circle', colorMode: 2,
            showParticles: true, showRibbons: true, tessRibbons: false,
            audioOscHz: 88, audioFxGain: 2.1, volume: 0.5, audioLoop: true
        }
    },
    {
        id: 'aurora-highway',
        group: 'Weather You Can Hear',
        name: 'Aurora Highway',
        blurb: 'night drive, cold windshield, green-purple sky doing impossible math',
        settings: {
            freeEnergy: 112000, resolution: 0.3, inversion: 118, halfLife: 14.5, scaleDepth: 1.2,
            coherence: 22, equilibrium: 0.052, temperature: 1.18, viscosity: 0.08, mass: 0.35,
            tempo: 1.9, opacity: 0.18, trailLen: 18, hue: 0.38, sat: 1.45, lightness: 1.02,
            bgGlow: 0.72, bgBlur: 118, shape: 'circle', colorMode: 3,
            showParticles: true, showRibbons: true, tessRibbons: false,
            audioOscHz: 277, audioFxGain: 1.7, volume: 0.44, audioLoop: true
        }
    },
    {
        id: 'radio-tower-fog',
        group: 'Weather You Can Hear',
        name: 'Radio Tower Fog',
        blurb: 'red blinking antenna through soup-thick fog, low frequency nonsense nearby',
        settings: {
            freeEnergy: 47000, resolution: 2.2, inversion: 318, halfLife: 28, scaleDepth: 4.4,
            coherence: 156, equilibrium: 0.004, temperature: 0.18, viscosity: 0.78, mass: 2.8,
            tempo: 0.28, opacity: 0.52, trailLen: 30, hue: 0.0, sat: 0.82, lightness: 0.78,
            bgGlow: 0.3, bgBlur: 180, shape: 'diamond', colorMode: 0,
            showParticles: true, showRibbons: true, tessRibbons: true,
            audioOscHz: 54, audioFxGain: 2.7, volume: 0.42, audioLoop: true
        }
    },
    {
        id: 'aquarium-at-midnight',
        group: 'Living Room Physics',
        name: 'Aquarium at Midnight',
        blurb: 'fish tank glow in a dark room, tiny organisms commuting with purpose',
        settings: {
            freeEnergy: 68000, resolution: 0.45, inversion: 84, halfLife: 19, scaleDepth: 1.7,
            coherence: 31, equilibrium: 0.02, temperature: 0.46, viscosity: 0.18, mass: 0.48,
            tempo: 1.08, opacity: 0.27, trailLen: 25, hue: 0.49, sat: 1.28, lightness: 0.96,
            bgGlow: 0.56, bgBlur: 96, shape: 'circle', colorMode: 3,
            showParticles: true, showRibbons: true, tessRibbons: false,
            audioOscHz: 174, audioFxGain: 1.24, volume: 0.4, audioLoop: true
        }
    },
    {
        id: 'campfire-crt',
        group: 'Living Room Physics',
        name: 'Campfire CRT',
        blurb: 'old TV warmth, orange coals, comforting phosphor ghosts in the corner',
        settings: {
            freeEnergy: 39000, resolution: 1.35, inversion: 188, halfLife: 26, scaleDepth: 2.9,
            coherence: 104, equilibrium: 0.008, temperature: 0.62, viscosity: 0.34, mass: 1.05,
            tempo: 0.58, opacity: 0.43, trailLen: 30, hue: 0.075, sat: 1.2, lightness: 0.84,
            bgGlow: 0.5, bgBlur: 142, shape: 'square', colorMode: 1,
            showParticles: true, showRibbons: true, tessRibbons: true,
            audioOscHz: 123, audioFxGain: 1.45, volume: 0.36, audioLoop: true
        }
    },
    {
        id: 'lava-lamp-thesis',
        group: 'Living Room Physics',
        name: 'Lava Lamp Thesis',
        blurb: 'procrastination object, but scientifically defensible if anyone asks',
        settings: {
            freeEnergy: 52000, resolution: 2.8, inversion: 330, halfLife: 30, scaleDepth: 3.7,
            coherence: 148, equilibrium: 0.003, temperature: 0.28, viscosity: 0.88, mass: 1.6,
            tempo: 0.22, opacity: 0.58, trailLen: 29, hue: 0.87, sat: 1.05, lightness: 0.98,
            bgGlow: 0.68, bgBlur: 168, shape: 'circle', colorMode: 0,
            showParticles: true, showRibbons: false, tessRibbons: false,
            audioOscHz: 72, audioFxGain: 0.92, volume: 0.3, audioLoop: true
        }
    },
    {
        id: 'museum-after-dark',
        group: 'Living Room Physics',
        name: 'Museum After Dark',
        blurb: 'quiet glass cases, laser tripwires, something ancient maybe blinking',
        settings: {
            freeEnergy: 33000, resolution: 3.6, inversion: 390, halfLife: 30, scaleDepth: 4.7,
            coherence: 178, equilibrium: 0.002, temperature: 0.08, viscosity: 0.83, mass: 2.1,
            tempo: 0.16, opacity: 0.62, trailLen: 30, hue: 0.66, sat: 0.82, lightness: 1.12,
            bgGlow: 0.42, bgBlur: 105, shape: 'diamond', colorMode: 1,
            showParticles: true, showRibbons: true, tessRibbons: true,
            audioOscHz: 128, audioFxGain: 0.8, volume: 0.28, audioLoop: true
        }
    },
    {
        id: 'subway-dream',
        group: 'Living Room Physics',
        name: 'Subway Dream',
        blurb: 'late train lights sliding by, mild dread, strangely beautiful compression artifacts',
        settings: {
            freeEnergy: 87000, resolution: 0.58, inversion: 156, halfLife: 12.5, scaleDepth: 2.1,
            coherence: 44, equilibrium: 0.047, temperature: 0.9, viscosity: 0.28, mass: 1.4,
            tempo: 1.36, opacity: 0.3, trailLen: 20, hue: 0.72, sat: 1.05, lightness: 0.82,
            bgGlow: 0.34, bgBlur: 82, shape: 'square', colorMode: 2,
            showParticles: true, showRibbons: true, tessRibbons: false,
            audioOscHz: 104, audioFxGain: 1.9, volume: 0.46, audioLoop: true
        }
    },
    {
        id: 'jellyfish-cathedral',
        group: 'Bio Weird',
        name: 'Jellyfish Cathedral',
        blurb: 'soft bells drifting through stained glass water, blessed nonsense',
        settings: {
            freeEnergy: 76000, resolution: 0.72, inversion: 206, halfLife: 24, scaleDepth: 3.0,
            coherence: 58, equilibrium: 0.018, temperature: 0.5, viscosity: 0.3, mass: 0.72,
            tempo: 0.92, opacity: 0.22, trailLen: 30, hue: 0.78, sat: 1.36, lightness: 1.04,
            bgGlow: 0.78, bgBlur: 170, shape: 'circle', colorMode: 3,
            showParticles: true, showRibbons: true, tessRibbons: false,
            audioOscHz: 222, audioFxGain: 1.08, volume: 0.38, audioLoop: true
        }
    },
    {
        id: 'firefly-swamp',
        group: 'Bio Weird',
        name: 'Firefly Swamp',
        blurb: 'summer mud, blinking bugs, warm green chaos that somehow calms down',
        settings: {
            freeEnergy: 92000, resolution: 0.34, inversion: 104, halfLife: 8.8, scaleDepth: 0.85,
            coherence: 18, equilibrium: 0.082, temperature: 1.15, viscosity: 0.16, mass: 0.38,
            tempo: 1.65, opacity: 0.17, trailLen: 12, hue: 0.28, sat: 1.46, lightness: 0.94,
            bgGlow: 0.62, bgBlur: 88, shape: 'circle', colorMode: 2,
            showParticles: true, showRibbons: false, tessRibbons: false,
            audioOscHz: 311, audioFxGain: 1.35, volume: 0.36, audioLoop: true
        }
    },
    {
        id: 'glass-beehive',
        group: 'Bio Weird',
        name: 'Glass Beehive',
        blurb: 'organized panic, hex logic, tiny workers doing GPU logistics',
        settings: {
            freeEnergy: 142000, resolution: 0.24, inversion: 128, halfLife: 5.4, scaleDepth: 0.72,
            coherence: 12, equilibrium: 0.104, temperature: 1.58, viscosity: 0.06, mass: 0.28,
            tempo: 2.3, opacity: 0.14, trailLen: 7, hue: 0.13, sat: 1.42, lightness: 0.96,
            bgGlow: 0.5, bgBlur: 42, shape: 'diamond', colorMode: 2,
            showParticles: true, showRibbons: true, tessRibbons: true,
            audioOscHz: 523, audioFxGain: 1.52, volume: 0.4, audioLoop: true
        }
    },
    {
        id: 'witch-hazel-bloom',
        group: 'Bio Weird',
        name: 'Witch Hazel Bloom',
        blurb: 'winter flowers with spidery yellow logic, medicinal goblin garden',
        settings: {
            freeEnergy: 61000, resolution: 0.94, inversion: 248, halfLife: 20.5, scaleDepth: 2.65,
            coherence: 76, equilibrium: 0.016, temperature: 0.38, viscosity: 0.4, mass: 0.78,
            tempo: 0.82, opacity: 0.33, trailLen: 25, hue: 0.15, sat: 1.18, lightness: 0.9,
            bgGlow: 0.44, bgBlur: 132, shape: 'diamond', colorMode: 1,
            showParticles: true, showRibbons: true, tessRibbons: false,
            audioOscHz: 147, audioFxGain: 1.12, volume: 0.34, audioLoop: true
        }
    },
    {
        id: 'blue-hour-orchard',
        group: 'Bio Weird',
        name: 'Blue Hour Orchard',
        blurb: 'fruit trees after sunset, cool air, pollinator ghosts punching out',
        settings: {
            freeEnergy: 72000, resolution: 0.68, inversion: 176, halfLife: 18.8, scaleDepth: 2.35,
            coherence: 54, equilibrium: 0.021, temperature: 0.52, viscosity: 0.22, mass: 0.68,
            tempo: 1.02, opacity: 0.25, trailLen: 23, hue: 0.57, sat: 0.96, lightness: 0.92,
            bgGlow: 0.52, bgBlur: 146, shape: 'circle', colorMode: 3,
            showParticles: true, showRibbons: true, tessRibbons: false,
            audioOscHz: 196, audioFxGain: 1.02, volume: 0.34, audioLoop: true
        }
    },
    {
        id: 'neon-noodle-shop',
        group: 'City / Arcade',
        name: 'Neon Noodle Shop',
        blurb: 'rainy alley, hot broth, pink-blue sign buzzing like it has opinions',
        settings: {
            freeEnergy: 118000, resolution: 0.22, inversion: 96, halfLife: 7.6, scaleDepth: 0.42,
            coherence: 10, equilibrium: 0.092, temperature: 1.76, viscosity: 0.05, mass: 0.2,
            tempo: 2.1, opacity: 0.16, trailLen: 9, hue: 0.88, sat: 1.5, lightness: 1.05,
            bgGlow: 0.74, bgBlur: 64, shape: 'circle', colorMode: 2,
            showParticles: true, showRibbons: false, tessRibbons: false,
            audioOscHz: 392, audioFxGain: 1.8, volume: 0.46, audioLoop: true
        }
    },
    {
        id: 'arcade-carpet',
        group: 'City / Arcade',
        name: 'Arcade Carpet',
        blurb: 'galaxy pattern floor, sticky shoes, every color guilty of a crime',
        settings: {
            freeEnergy: 154000, resolution: 0.18, inversion: 116, halfLife: 4.6, scaleDepth: 0.22,
            coherence: 7, equilibrium: 0.14, temperature: 2.45, viscosity: 0.02, mass: 0.14,
            tempo: 3.0, opacity: 0.12, trailLen: 5, hue: 0.31, sat: 1.5, lightness: 1.1,
            bgGlow: 0.58, bgBlur: 36, shape: 'circle', colorMode: 3,
            showParticles: true, showRibbons: true, tessRibbons: false,
            audioOscHz: 659, audioFxGain: 1.55, volume: 0.38, audioLoop: true
        }
    },
    {
        id: 'mall-fountain-1998',
        group: 'City / Arcade',
        name: 'Mall Fountain 1998',
        blurb: 'quarter wishes, chlorine nostalgia, skylight beams hitting fake marble',
        settings: {
            freeEnergy: 69000, resolution: 1.1, inversion: 216, halfLife: 23, scaleDepth: 2.6,
            coherence: 82, equilibrium: 0.01, temperature: 0.26, viscosity: 0.54, mass: 1.0,
            tempo: 0.64, opacity: 0.4, trailLen: 28, hue: 0.52, sat: 0.86, lightness: 1.0,
            bgGlow: 0.5, bgBlur: 150, shape: 'circle', colorMode: 1,
            showParticles: true, showRibbons: true, tessRibbons: true,
            audioOscHz: 156, audioFxGain: 1.2, volume: 0.34, audioLoop: true
        }
    },
    {
        id: 'parking-lot-ufo',
        group: 'City / Arcade',
        name: 'Parking Lot UFO',
        blurb: 'grocery store sodium lights, wet asphalt, one suspicious hovering pancake',
        settings: {
            freeEnergy: 102000, resolution: 0.46, inversion: 250, halfLife: 14, scaleDepth: 3.25,
            coherence: 48, equilibrium: 0.034, temperature: 0.88, viscosity: 0.22, mass: 0.9,
            tempo: 1.34, opacity: 0.28, trailLen: 18, hue: 0.19, sat: 1.18, lightness: 0.78,
            bgGlow: 0.46, bgBlur: 110, shape: 'diamond', colorMode: 3,
            showParticles: true, showRibbons: true, tessRibbons: true,
            audioOscHz: 185, audioFxGain: 2.0, volume: 0.46, audioLoop: true
        }
    },
    {
        id: 'server-room-snowglobe',
        group: 'Machines Dreaming',
        name: 'Server Room Snowglobe',
        blurb: 'cold aisle snowfall, rack fans, tiny packets shaking loose in blue light',
        settings: {
            freeEnergy: 134000, resolution: 0.26, inversion: 68, halfLife: 6.4, scaleDepth: 0.35,
            coherence: 11, equilibrium: 0.118, temperature: 0.74, viscosity: 0.04, mass: 0.22,
            tempo: 2.45, opacity: 0.13, trailLen: 8, hue: 0.61, sat: 1.18, lightness: 1.12,
            bgGlow: 0.64, bgBlur: 52, shape: 'square', colorMode: 2,
            showParticles: true, showRibbons: true, tessRibbons: false,
            audioOscHz: 440, audioFxGain: 1.65, volume: 0.42, audioLoop: true
        }
    },
    {
        id: 'ancient-circuit-board',
        group: 'Machines Dreaming',
        name: 'Ancient Circuit Board',
        blurb: 'copper traces pretending to be ley lines, dusty but still booting',
        settings: {
            freeEnergy: 48000, resolution: 1.8, inversion: 300, halfLife: 28, scaleDepth: 4.0,
            coherence: 126, equilibrium: 0.005, temperature: 0.2, viscosity: 0.66, mass: 1.9,
            tempo: 0.38, opacity: 0.52, trailLen: 30, hue: 0.22, sat: 0.98, lightness: 0.82,
            bgGlow: 0.36, bgBlur: 122, shape: 'diamond', colorMode: 1,
            showParticles: true, showRibbons: true, tessRibbons: true,
            audioOscHz: 96, audioFxGain: 1.7, volume: 0.38, audioLoop: true
        }
    },
    {
        id: 'ham-radio-moonbounce',
        group: 'Machines Dreaming',
        name: 'Ham Radio Moonbounce',
        blurb: 'garage antenna magic, signal leaves earth and comes back slightly haunted',
        settings: {
            freeEnergy: 79000, resolution: 0.52, inversion: 178, halfLife: 16, scaleDepth: 2.7,
            coherence: 37, equilibrium: 0.044, temperature: 0.72, viscosity: 0.14, mass: 0.62,
            tempo: 1.55, opacity: 0.22, trailLen: 17, hue: 0.64, sat: 1.25, lightness: 0.98,
            bgGlow: 0.42, bgBlur: 76, shape: 'circle', colorMode: 2,
            showParticles: true, showRibbons: true, tessRibbons: false,
            audioOscHz: 144, audioFxGain: 2.15, volume: 0.48, audioLoop: true
        }
    },
    {
        id: 'printer-jam-singularity',
        group: 'Machines Dreaming',
        name: 'Printer Jam Singularity',
        blurb: 'office machine anger becomes a small local cosmological event',
        settings: {
            freeEnergy: 176000, resolution: 0.16, inversion: 58, halfLife: 3.2, scaleDepth: 0.18,
            coherence: 5, equilibrium: 0.165, temperature: 2.6, viscosity: 0.01, mass: 0.12,
            tempo: 3.2, opacity: 0.1, trailLen: 4, hue: 0.02, sat: 1.5, lightness: 0.98,
            bgGlow: 0.38, bgBlur: 28, shape: 'square', colorMode: 2,
            showParticles: true, showRibbons: false, tessRibbons: false,
            audioOscHz: 777, audioFxGain: 2.6, volume: 0.5, audioLoop: true
        }
    },
    {
        id: 'elevator-to-orbit',
        group: 'Space, But Local',
        name: 'Elevator to Orbit',
        blurb: 'office elevator opens into starfield, nobody in the lobby seems concerned',
        settings: {
            freeEnergy: 86000, resolution: 0.9, inversion: 260, halfLife: 21, scaleDepth: 3.9,
            coherence: 72, equilibrium: 0.018, temperature: 0.52, viscosity: 0.24, mass: 0.85,
            tempo: 0.88, opacity: 0.36, trailLen: 26, hue: 0.72, sat: 1.12, lightness: 0.9,
            bgGlow: 0.58, bgBlur: 160, shape: 'diamond', colorMode: 3,
            showParticles: true, showRibbons: true, tessRibbons: true,
            audioOscHz: 196, audioFxGain: 1.35, volume: 0.4, audioLoop: true
        }
    },
    {
        id: 'black-hole-laundry',
        group: 'Space, But Local',
        name: 'Black Hole Laundry',
        blurb: 'dryer vortex, missing socks, gravity lens with a lint trap',
        settings: {
            freeEnergy: 91000, resolution: 1.4, inversion: 372, halfLife: 27.5, scaleDepth: 4.85,
            coherence: 154, equilibrium: 0.003, temperature: 0.16, viscosity: 0.74, mass: 3.8,
            tempo: 0.28, opacity: 0.56, trailLen: 22, hue: 0.76, sat: 0.82, lightness: 0.72,
            bgGlow: 0.24, bgBlur: 156, shape: 'square', colorMode: 0,
            showParticles: true, showRibbons: true, tessRibbons: true,
            audioOscHz: 57, audioFxGain: 2.25, volume: 0.5, audioLoop: true
        }
    },
    {
        id: 'satellite-beach',
        group: 'Space, But Local',
        name: 'Satellite Beach',
        blurb: 'night shore, tide noise, orbital debris glittering like vacation LEDs',
        settings: {
            freeEnergy: 73000, resolution: 0.66, inversion: 190, halfLife: 17.6, scaleDepth: 2.4,
            coherence: 46, equilibrium: 0.027, temperature: 0.66, viscosity: 0.2, mass: 0.7,
            tempo: 1.16, opacity: 0.26, trailLen: 21, hue: 0.54, sat: 1.05, lightness: 0.94,
            bgGlow: 0.52, bgBlur: 128, shape: 'circle', colorMode: 3,
            showParticles: true, showRibbons: true, tessRibbons: false,
            audioOscHz: 234, audioFxGain: 1.38, volume: 0.42, audioLoop: true
        }
    },
    {
        id: 'comet-tail-static',
        group: 'Space, But Local',
        name: 'Comet Tail Static',
        blurb: 'fast ice, long smear, radio snow from something you cannot pronounce',
        settings: {
            freeEnergy: 146000, resolution: 0.21, inversion: 82, halfLife: 5.0, scaleDepth: 0.48,
            coherence: 9, equilibrium: 0.132, temperature: 2.05, viscosity: 0.03, mass: 0.18,
            tempo: 2.75, opacity: 0.13, trailLen: 6, hue: 0.62, sat: 1.42, lightness: 1.08,
            bgGlow: 0.7, bgBlur: 48, shape: 'circle', colorMode: 2,
            showParticles: true, showRibbons: false, tessRibbons: false,
            audioOscHz: 620, audioFxGain: 1.88, volume: 0.44, audioLoop: true
        }
    },
    {
        id: 'garden-hose-galaxy',
        group: 'Space, But Local',
        name: 'Garden Hose Galaxy',
        blurb: 'backyard spiral arms, sprinkler mist, Milky Way but with weeds',
        settings: {
            freeEnergy: 82000, resolution: 0.76, inversion: 222, halfLife: 22, scaleDepth: 3.15,
            coherence: 64, equilibrium: 0.019, temperature: 0.78, viscosity: 0.25, mass: 0.82,
            tempo: 1.0, opacity: 0.32, trailLen: 27, hue: 0.45, sat: 1.2, lightness: 0.96,
            bgGlow: 0.62, bgBlur: 142, shape: 'circle', colorMode: 3,
            showParticles: true, showRibbons: true, tessRibbons: false,
            audioOscHz: 210, audioFxGain: 1.28, volume: 0.38, audioLoop: true
        }
    },
    {
        id: 'deep-sea-sonar',
        group: 'Big Quiet',
        name: 'Deep Sea Sonar',
        blurb: 'black water, one ping, ancient machines below deciding whether to answer',
        settings: {
            freeEnergy: 44000, resolution: 3.1, inversion: 404, halfLife: 29, scaleDepth: 4.6,
            coherence: 168, equilibrium: 0.002, temperature: 0.1, viscosity: 0.86, mass: 3.4,
            tempo: 0.14, opacity: 0.5, trailLen: 30, hue: 0.58, sat: 0.72, lightness: 0.8,
            bgGlow: 0.26, bgBlur: 175, shape: 'circle', colorMode: 0,
            showParticles: true, showRibbons: true, tessRibbons: false,
            audioOscHz: 48, audioFxGain: 2.5, volume: 0.42, audioLoop: true
        }
    },
    {
        id: 'moonlit-pool',
        group: 'Big Quiet',
        name: 'Moonlit Pool',
        blurb: 'still backyard water, silver ripples, almost too calm to trust',
        settings: {
            freeEnergy: 36000, resolution: 2.6, inversion: 348, halfLife: 30, scaleDepth: 4.2,
            coherence: 144, equilibrium: 0.004, temperature: 0.14, viscosity: 0.76, mass: 1.8,
            tempo: 0.24, opacity: 0.46, trailLen: 30, hue: 0.62, sat: 0.58, lightness: 1.1,
            bgGlow: 0.44, bgBlur: 165, shape: 'circle', colorMode: 0,
            showParticles: true, showRibbons: false, tessRibbons: false,
            audioOscHz: 81, audioFxGain: 0.86, volume: 0.28, audioLoop: true
        }
    },
    {
        id: 'desert-mirage',
        group: 'Big Quiet',
        name: 'Desert Mirage',
        blurb: 'heat shimmer at the horizon, pale gold math pretending to be water',
        settings: {
            freeEnergy: 59000, resolution: 1.5, inversion: 286, halfLife: 24, scaleDepth: 3.5,
            coherence: 96, equilibrium: 0.008, temperature: 1.38, viscosity: 0.52, mass: 1.2,
            tempo: 0.46, opacity: 0.39, trailLen: 24, hue: 0.11, sat: 0.98, lightness: 0.98,
            bgGlow: 0.5, bgBlur: 178, shape: 'diamond', colorMode: 1,
            showParticles: true, showRibbons: true, tessRibbons: false,
            audioOscHz: 67, audioFxGain: 1.55, volume: 0.32, audioLoop: true
        }
    },
    {
        id: 'phantom-icebox',
        group: 'Big Quiet',
        name: 'Phantom Icebox',
        blurb: 'kitchen fridge hum at midnight, blue cold, probably not haunted, probably',
        settings: {
            freeEnergy: 42000, resolution: 3.9, inversion: 398, halfLife: 29.5, scaleDepth: 4.4,
            coherence: 160, equilibrium: 0.003, temperature: 0.04, viscosity: 0.88, mass: 2.4,
            tempo: 0.18, opacity: 0.44, trailLen: 30, hue: 0.57, sat: 0.62, lightness: 1.12,
            bgGlow: 0.34, bgBlur: 172, shape: 'square', colorMode: 0,
            showParticles: true, showRibbons: true, tessRibbons: true,
            audioOscHz: 60, audioFxGain: 1.05, volume: 0.3, audioLoop: true
        }
    },
    {
        id: 'red-giant-kitchen-light',
        group: 'Heat / Danger / Delicious',
        name: 'Red Giant Kitchen Light',
        blurb: 'oven preheat energy, red star swelling, dinner may be cosmological',
        settings: {
            freeEnergy: 96000, resolution: 0.7, inversion: 236, halfLife: 12, scaleDepth: 2.4,
            coherence: 62, equilibrium: 0.037, temperature: 2.18, viscosity: 0.16, mass: 0.92,
            tempo: 1.58, opacity: 0.44, trailLen: 17, hue: 0.02, sat: 1.38, lightness: 0.82,
            bgGlow: 0.66, bgBlur: 100, shape: 'circle', colorMode: 3,
            showParticles: true, showRibbons: true, tessRibbons: true,
            audioOscHz: 440, audioFxGain: 1.72, volume: 0.46, audioLoop: true
        }
    },
    {
        id: 'volcano-snow',
        group: 'Heat / Danger / Delicious',
        name: 'Volcano Snow',
        blurb: 'ash and sparks mixing with impossible cold, geology doing theater',
        settings: {
            freeEnergy: 128000, resolution: 0.33, inversion: 108, halfLife: 7.2, scaleDepth: 1.15,
            coherence: 21, equilibrium: 0.088, temperature: 2.35, viscosity: 0.18, mass: 1.0,
            tempo: 2.0, opacity: 0.2, trailLen: 10, hue: 0.01, sat: 1.44, lightness: 0.92,
            bgGlow: 0.62, bgBlur: 72, shape: 'circle', colorMode: 2,
            showParticles: true, showRibbons: true, tessRibbons: false,
            audioOscHz: 311, audioFxGain: 2.25, volume: 0.52, audioLoop: true
        }
    },
    {
        id: 'honeycomb-engine',
        group: 'Heat / Danger / Delicious',
        name: 'Honeycomb Engine',
        blurb: 'warm mechanical sweetness, bees invented a turbine and refused peer review',
        settings: {
            freeEnergy: 105000, resolution: 0.4, inversion: 154, halfLife: 10.4, scaleDepth: 1.65,
            coherence: 34, equilibrium: 0.058, temperature: 1.24, viscosity: 0.22, mass: 0.7,
            tempo: 1.85, opacity: 0.25, trailLen: 14, hue: 0.13, sat: 1.36, lightness: 0.86,
            bgGlow: 0.58, bgBlur: 68, shape: 'diamond', colorMode: 2,
            showParticles: true, showRibbons: true, tessRibbons: true,
            audioOscHz: 369, audioFxGain: 1.5, volume: 0.42, audioLoop: true
        }
    },
    {
        id: 'toaster-fire-drill',
        group: 'Heat / Danger / Delicious',
        name: 'Toaster Fire Drill',
        blurb: 'breakfast crossed the event horizon, chaotic but survivable',
        settings: {
            freeEnergy: 166000, resolution: 0.19, inversion: 64, halfLife: 3.6, scaleDepth: 0.2,
            coherence: 6, equilibrium: 0.152, temperature: 2.7, viscosity: 0.02, mass: 0.16,
            tempo: 3.15, opacity: 0.11, trailLen: 5, hue: 0.05, sat: 1.5, lightness: 0.9,
            bgGlow: 0.5, bgBlur: 32, shape: 'square', colorMode: 2,
            showParticles: true, showRibbons: false, tessRibbons: false,
            audioOscHz: 740, audioFxGain: 2.4, volume: 0.48, audioLoop: true
        }
    },
    {
        id: 'ghost-bloom',
        group: 'Old Scale Space Spirits',
        name: 'Ghost Bloom',
        blurb: 'pale bloom, soft disappearance, the system politely becoming a rumor',
        settings: {
            freeEnergy: 58000, resolution: 4.8, inversion: 410, halfLife: 26.2, scaleDepth: 3.6,
            coherence: 112, equilibrium: 0.006, temperature: 0.38, viscosity: 0.55, mass: 0.55,
            tempo: 0.58, opacity: 0.09, trailLen: 22, hue: 0.9, sat: 0.42, lightness: 1.14,
            bgGlow: 0.46, bgBlur: 180, shape: 'circle', colorMode: 0,
            showParticles: true, showRibbons: false, tessRibbons: false,
            audioOscHz: 72, audioFxGain: 0.66, volume: 0.28, audioLoop: true
        }
    },
    {
        id: 'amber-lattice',
        group: 'Old Scale Space Spirits',
        name: 'Amber Lattice',
        blurb: 'clean amber geometry, like a fossilized circuit board in nice lighting',
        settings: {
            freeEnergy: 42000, resolution: 0.65, inversion: 145, halfLife: 24.5, scaleDepth: 2.8,
            coherence: 88, equilibrium: 0.009, temperature: 0.24, viscosity: 0.38, mass: 1.35,
            tempo: 0.72, opacity: 0.38, trailLen: 30, hue: 0.1, sat: 1.12, lightness: 0.88,
            bgGlow: 0.36, bgBlur: 126, shape: 'diamond', colorMode: 1,
            showParticles: true, showRibbons: true, tessRibbons: true,
            audioOscHz: 111, audioFxGain: 1.55, volume: 0.38, audioLoop: true
        }
    },
    {
        id: 'cold-plasma',
        group: 'Old Scale Space Spirits',
        name: 'Cold Plasma',
        blurb: 'blue-white bite, ionized sparkle, fast enough to wake the debugger',
        settings: {
            freeEnergy: 118000, resolution: 0.24, inversion: 70, halfLife: 8.5, scaleDepth: 0.55,
            coherence: 12, equilibrium: 0.065, temperature: 1.75, viscosity: 0.04, mass: 0.18,
            tempo: 2.35, opacity: 0.16, trailLen: 11, hue: 0.61, sat: 1.42, lightness: 1.08,
            bgGlow: 0.68, bgBlur: 58, shape: 'circle', colorMode: 2,
            showParticles: true, showRibbons: false, tessRibbons: false,
            audioOscHz: 333, audioFxGain: 1.95, volume: 0.48, audioLoop: true
        }
    },
    {
        id: 'nebula-thread',
        group: 'Old Scale Space Spirits',
        name: 'Nebula Thread',
        blurb: 'purple threadwork, enough cosmic mist to be suspiciously pretty',
        settings: {
            freeEnergy: 76000, resolution: 0.95, inversion: 204, halfLife: 21, scaleDepth: 3.25,
            coherence: 52, equilibrium: 0.022, temperature: 0.85, viscosity: 0.24, mass: 0.72,
            tempo: 1.42, opacity: 0.31, trailLen: 28, hue: 0.82, sat: 1.34, lightness: 0.92,
            bgGlow: 0.74, bgBlur: 172, shape: 'diamond', colorMode: 3,
            showParticles: true, showRibbons: true, tessRibbons: false,
            audioOscHz: 222, audioFxGain: 1.18, volume: 0.42, audioLoop: true
        }
    }
];

export function getRandomizerPreset(id) {
    return RANDOMIZER_PRESETS.find(p => p.id === id) || null;
}

export function getRandomizerPresetGroups() {
    const groups = [];
    for (const preset of RANDOMIZER_PRESETS) {
        const group = preset.group || 'Presets';
        if (!groups.includes(group)) groups.push(group);
    }
    return groups;
}

export function describeRandomizerPreset(id) {
    const preset = getRandomizerPreset(id);
    if (!preset) return '';
    return `${preset.group || 'Preset'} · ${preset.blurb || preset.name}`;
}

let _transitionRAF = null;
let _transitionToken = 0;
let _transitionLiveEditKeys = null;

function _markRandomizerLiveEdit(keys) {
    if (!_transitionLiveEditKeys) return;
    const list = Array.isArray(keys) ? keys : [keys];
    for (const key of list) {
        if (typeof key === 'string' && key) _transitionLiveEditKeys.add(key);
    }
}

if (typeof window !== 'undefined') {
    window.markRandomizerLiveEdit = _markRandomizerLiveEdit;
}

const _continuous = {
    active: false,
    transitionSec: 6.0,
    pending: null,
    timer: null,
    runId: 0,
    roll: 0,
    family: null,
    familyRollsLeft: 0,
    focus: 'shape',
    seed: 0,
};

function _rand() {
    if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
        const a = new Uint32Array(1);
        globalThis.crypto.getRandomValues(a);
        return a[0] / 0xFFFFFFFF;
    }
    return Math.random();
}

function _pick(arr) {
    return arr[Math.floor(_rand() * arr.length) % arr.length];
}

function _roundToStep(v, step) {
    const s = Number(step) || 0;
    if (s <= 0) return v;
    const rounded = Math.round(v / s) * s;
    const decimals = String(s).includes('.') ? String(s).split('.')[1].length : 0;
    return Number(rounded.toFixed(Math.min(6, decimals + 1)));
}

function _randomValue(key, range) {
    if (key === 'resolution') {
        const lowLane = _rand() < 0.22;
        const lane = lowLane
            ? { ...range, min: 0.04, max: 0.85, curve: 'log' }
            : { ...range, min: 1.05, max: 8.0, curve: 'log' };
        return _randomValue('', lane);
    }
    if (key === 'scaleDepth') {
        const lowLane = _rand() < 0.50;
        const lane = lowLane
            ? { ...range, min: 0.035, max: 0.98, curve: 'log' }
            : { ...range, min: 1.05, max: 5.8, curve: 'log' };
        return _randomValue('', lane);
    }
    if (key === 'coherence') {
        const lowLane = _rand() < 0.68;
        const lane = lowLane
            ? { ...range, min: 0.2, max: 19.5, curve: 'log' }
            : { ...range, min: 20, max: Math.max(21, Number(range.max) || 210), curve: 'log' };
        return _randomValue('', lane);
    }

    if (key === 'physicsEmergence' || range.curve === 'signedExtreme') {
        const maxAbs = Math.max(Math.abs(Number(range.min)), Math.abs(Number(range.max)));
        const quietRoll = _rand() < 0.18;
        const t = quietRoll ? Math.pow(_rand(), 1.65) : Math.pow(_rand(), 0.42);
        const floor = quietRoll ? 0.02 : 0.32;
        const mag = floor + t * Math.max(0, maxAbs - floor);
        const v = (_rand() < 0.5 ? -1 : 1) * mag;
        return _roundToStep(v, range.step);
    }
    const min = Number(range.min);
    const max = Number(range.max);
    const t = _rand();
    let v;
    if (range.curve === 'log' && min > 0 && max > min) {
        v = Math.exp(Math.log(min) + (Math.log(max) - Math.log(min)) * t);
    } else {
        v = min + (max - min) * t;
    }
    return _roundToStep(v, range.step);
}

function _randomNearbyValue(key, range) {
    if (key === 'resolution' || key === 'coherence' || key === 'scaleDepth') return _randomValue(key, range);
    const cur = Number(window.S && window.S[key]);
    if (!Number.isFinite(cur)) return _randomValue(key, range);
    const min = Number(range.min);
    const max = Number(range.max);
    const span = max - min;
    const walk = span * (0.16 + _rand() * 0.30);
    const centered = cur + (_rand() * 2 - 1) * walk;
    const occasionalJump = _rand() < 0.20 ? _randomValue(key, range) : centered;
    return _roundToStep(Math.max(min, Math.min(max, occasionalJump)), range.step);
}

function _saveState() {
    try { localStorage.setItem('ss_state', JSON.stringify(window.S)); } catch (e) {}
}

function _dispatch(name, detail) {
    try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch (e) { console.error(e); }
}

function _syncKeys(keys) {
    for (const key of keys) {
        if (window.sliderSync && window.sliderSync[key]) {
            try { window.sliderSync[key](window.S[key]); } catch (e) { console.error(e); }
        }
    }
    try { if (window.syncTogglesFromState) window.syncTogglesFromState(); } catch (e) { console.error(e); }
    try { if (window.syncAudioPilotTogglesFromState) window.syncAudioPilotTogglesFromState(); } catch (e) { console.error(e); }
    try { if (window.syncRandomizerPilotTogglesFromState) window.syncRandomizerPilotTogglesFromState(); } catch (e) { console.error(e); }
    try { if (window.refreshRadialUI) window.refreshRadialUI(); } catch (e) { console.error(e); }
}

function _applyEngineSideEffects(changed, opts = {}) {
    const resize = opts.resize !== false;
    const reinitialize = opts.reinitialize !== false;

    const bgGlow = document.getElementById('bgGlow');
    if (bgGlow) {
        if (changed.has('bgGlow')) bgGlow.style.opacity = Math.min(1, (window.S.bgGlow || 0) * 1.5).toFixed(2);
        if (changed.has('bgBlur')) bgGlow.style.filter = 'blur(' + (window.S.bgBlur || 0) + 'px)';
    }

    if (changed.has('perfProfile')) {
        try { setPerformanceProfile(window.S.perfProfile || 'balanced'); } catch (e) { console.error(e); }
    }

    const engine = window.engine;
    if (!engine) return;

    if (resize && changed.has('canvasResolutionScale') && typeof engine.resize === 'function') {
        try { engine.resize(window.innerWidth, window.innerHeight); } catch (e) { console.error(e); }
    }

    if (resize && changed.has('freeEnergy') && typeof engine.resizeParticles === 'function') {
        try { engine.resizeParticles(Math.round(window.S.freeEnergy)); } catch (e) { console.error(e); }
    }

    if (typeof engine.updateUniforms === 'function') {
        try { engine.updateUniforms(); } catch (e) { console.error(e); }
    }

    if (reinitialize && typeof engine.reinitializeParticles === 'function') {
        try { engine.reinitializeParticles(); } catch (e) { console.error(e); }
    }
}

function _restartOscIfNeeded(changed) {
    const gainChanged = changed.has('volume') || changed.has('audioMuted') || changed.has('audioFxGain');
    if (!gainChanged) return;
    if (window.audio && typeof window.audio.updateVolume === 'function') {
        try { window.audio.updateVolume(window.S.volume); } catch (e) { console.error(e); }
    }
}

function _snapshotFromState() {
    const out = {};
    for (const key of SNAPSHOT_KEYS) {
        if (window.S && window.S[key] !== undefined) out[key] = window.S[key];
    }
    return out;
}

function _sanitizeSnapshot(raw, { includeAudio = true, includeVisuals = true } = {}) {
    const out = {};
    const numericKeys = [];
    if (includeVisuals) numericKeys.push(...NUMERIC_VISUAL_KEYS);
    if (includeAudio) numericKeys.push(...NUMERIC_AUDIO_KEYS);

    for (const key of numericKeys) {
        if (!raw || raw[key] === undefined) continue;
        const n = Number(raw[key]);
        if (Number.isFinite(n)) out[key] = n;
    }

    if (includeVisuals) {
        if (COMPAT_FLOW_MODES.includes(raw?.compatFlowMode)) out.compatFlowMode = raw.compatFlowMode;
        if (VISUAL_EFFECT_STYLES.includes(raw?.visualEffectStyle)) out.visualEffectStyle = raw.visualEffectStyle;
        if (VISUAL_2D_BACKDROP_STYLES.includes(raw?.visualEffect2DBackdropStyle)) out.visualEffect2DBackdropStyle = raw.visualEffect2DBackdropStyle;
        if (SHAPES.includes(raw?.shape)) out.shape = raw.shape;
        const cm = Number(raw?.colorMode);
        if (Number.isInteger(cm) && COLOR_MODES.includes(cm)) out.colorMode = cm;
        for (const key of ['showParticles', 'showRibbons', 'tessRibbons', 'visualEffects', 'visualEffectBackdrop', 'visualEffect2DBackdrop', 'visualEffectPost', 'visualEffectCenterSwim', 'visualEffectNoTrailStyles']) {
            if (typeof raw?.[key] === 'boolean') out[key] = raw[key];
        }
        // Preserve preset/randomizer trail intent now that Strings/Lattice are
        // budgeted by the native renderer again. Particles remain the anchor so
        // a random state cannot become trails-only.
        out.showParticles = true;
        if (out.showRibbons === undefined) out.showRibbons = !!raw?.showRibbons;
        if (out.tessRibbons === undefined) out.tessRibbons = !!raw?.tessRibbons;
    }

    if (includeAudio) {
        const audioState = sanitizeAudioWaypointState(raw);
        if (audioState) Object.assign(out, audioState);
        if (typeof raw?.audioLoop === 'boolean') out.audioLoop = raw.audioLoop;
        if (typeof raw?.audioMuted === 'boolean') out.audioMuted = raw.audioMuted;
        if (typeof raw?.audioReactive === 'boolean') out.audioReactive = raw.audioReactive;
    }
    if (typeof raw?.perfProfile === 'string' && ['balanced', 'quality', 'speed', 'potato'].includes(raw.perfProfile)) out.perfProfile = raw.perfProfile;
    return out;
}

function _summarize(settings, label = '') {
    return {
        id: Date.now().toString(36).toUpperCase(),
        label,
        freeEnergy: Math.round(Number(settings.freeEnergy ?? window.S?.freeEnergy ?? 0)),
        resolution: Number(settings.resolution ?? window.S?.resolution ?? 0),
        colorMode: Number(settings.colorMode ?? window.S?.colorMode ?? 0),
        shape: String(settings.shape ?? window.S?.shape ?? 'circle'),
        audioOscHz: Math.round(Number(settings.audioOscHz ?? window.S?.audioOscHz ?? 0)),
    };
}

function _historyLabel(summary, at = new Date()) {
    const hh = String(at.getHours()).padStart(2, '0');
    const mm = String(at.getMinutes()).padStart(2, '0');
    const ss = String(at.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss} · ${summary.freeEnergy}q · ${summary.audioOscHz}Hz`;
}

function _readHistory() {
    try {
        const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
        return Array.isArray(raw) ? raw.slice(0, MAX_HISTORY).filter(x => x && typeof x === 'object') : [];
    } catch (e) {
        return [];
    }
}

function _writeHistory(items) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY))); } catch (e) {}
    _dispatch('scalespace-randomizer-history', { history: items.slice(0, MAX_HISTORY) });
}

function _pushHistory(settings, summary) {
    const now = new Date();
    const entry = {
        id: 'rnd_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
        label: _historyLabel(summary, now),
        createdAt: now.toISOString(),
        summary,
        settings: _sanitizeSnapshot(settings, { includeAudio: true, includeVisuals: true }),
    };
    const history = [entry, ..._readHistory()].slice(0, MAX_HISTORY);
    _writeHistory(history);
    return entry;
}

function _setRandomizerState({ preset, continuous, transitionSec } = {}) {
    if (!window.S) return;
    if (preset !== undefined) window.S.randomizerPreset = String(preset || '');
    if (continuous !== undefined) window.S.randomizerContinuous = !!continuous;
    if (transitionSec !== undefined) window.S.randomizerTransitionSec = Math.max(0, Math.min(120, Number(transitionSec) || 0));
    _saveState();
}

function _applySnapshotImmediate(settings, opts = {}) {
    if (!window.S) return null;
    const includeAudio = opts.includeAudio !== false;
    const includeVisuals = opts.includeVisuals !== false;
    const clean = _respectAudioPilotLocks(_sanitizeSnapshot(settings, { includeAudio, includeVisuals }), opts);
    const changed = new Set();

    for (const [key, value] of Object.entries(clean)) {
        if (!_canPilotKey(key, opts)) continue;
        if (window.S[key] === value) continue;
        window.S[key] = value;
        changed.add(key);
    }

    _clearDisabledAudioPilotEffective();
    _syncKeys([...changed]);
    _applyEngineSideEffects(changed, {
        resize: opts.resize !== false,
        reinitialize: opts.reinitialize === true,
    });
    _restartOscIfNeeded(changed);
    _saveState();

    return { settings: clean, changed };
}

function _easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function _cancelTransition() {
    _transitionToken++;
    _transitionLiveEditKeys = null;
    if (_transitionRAF) {
        cancelAnimationFrame(_transitionRAF);
        _transitionRAF = null;
    }
}

function _transitionToSnapshot(settings, opts = {}) {
    const transitionSec = Math.max(0, Math.min(120, Number(opts.transitionSec) || 0));
    if (!transitionSec) return Promise.resolve(_applySnapshotImmediate(settings, opts));

    _cancelTransition();

    const clean = _sanitizeSnapshot(settings, {
        includeAudio: opts.includeAudio !== false,
        includeVisuals: opts.includeVisuals !== false,
    });
    const filteredClean = _respectAudioPilotLocks(clean, opts);
    const from = _snapshotFromState();
    const numericKeys = Object.keys(filteredClean).filter(k => typeof filteredClean[k] === 'number' && typeof from[k] === 'number');
    const discreteKeys = Object.keys(filteredClean).filter(k => !numericKeys.includes(k));
    const changed = new Set(Object.keys(filteredClean).filter(k => window.S[k] !== filteredClean[k]));
    const liveOwnedKeys = new Set(Object.keys(filteredClean).filter(key => LIVE_EDIT_OWNED_TRANSITION_KEYS.has(key)));
    const ownedStartValues = new Map();
    const ownedLastWritten = new Map();
    const ownedUserEdited = new Set();
    const liveEditKeys = new Set();
    _transitionLiveEditKeys = liveEditKeys;
    for (const key of liveOwnedKeys) ownedStartValues.set(key, window.S[key]);
    const token = ++_transitionToken;
    const start = performance.now();
    const duration = transitionSec * 1000;
    let flipped = false;
    let lastUISync = 0;

    return new Promise((resolve) => {
        const sameTransitionValue = (a, b) => {
            if (typeof a === 'number' || typeof b === 'number') {
                const an = Number(a);
                const bn = Number(b);
                return Number.isFinite(an) && Number.isFinite(bn) && Math.abs(an - bn) < 1e-7;
            }
            return a === b;
        };
        const writeTransitionValue = (key, value) => {
            if (!_canPilotKey(key, opts)) return false;
            // UI edits are scoped to this one transition/roll. The active target
            // stops writing those keys immediately, then the next randomizer roll
            // starts with a fresh liveEditKeys set so randomization keeps working.
            if (liveEditKeys.has(key)) {
                ownedUserEdited.add(key);
                return false;
            }
            if (liveOwnedKeys.has(key)) {
                const expected = ownedLastWritten.has(key) ? ownedLastWritten.get(key) : ownedStartValues.get(key);
                if (!sameTransitionValue(window.S[key], expected)) {
                    ownedUserEdited.add(key);
                    liveEditKeys.add(key);
                    return false;
                }
            }
            window.S[key] = value;
            if (liveOwnedKeys.has(key)) ownedLastWritten.set(key, value);
            return true;
        };

        const tick = (now) => {
            if (token !== _transitionToken) {
                if (_transitionLiveEditKeys === liveEditKeys) _transitionLiveEditKeys = null;
                return resolve(null);
            }
            const rawT = Math.min(1, (now - start) / duration);
            const ease = _easeInOut(rawT);

            for (const key of numericKeys) {
                const value = from[key] + (filteredClean[key] - from[key]) * ease;
                writeTransitionValue(key, value);
            }

            if (!flipped && rawT >= 0.5) {
                for (const key of discreteKeys) writeTransitionValue(key, filteredClean[key]);
                flipped = true;
                _syncKeys(discreteKeys.filter(key => !ownedUserEdited.has(key)));
            }

            if (now - lastUISync > 90 || rawT >= 1) {
                _syncKeys(numericKeys.filter(key => !ownedUserEdited.has(key)));
                lastUISync = now;
            }

            _applyEngineSideEffects(changed, { resize: false, reinitialize: false });
            if (window.audio && typeof window.audio.updateVolume === 'function') {
                try { window.audio.updateVolume(window.S.volume); } catch (e) { console.error(e); }
            }

            if (rawT < 1) {
                _transitionRAF = requestAnimationFrame(tick);
                return;
            }

            for (const [key, value] of Object.entries(filteredClean)) {
                writeTransitionValue(key, value);
            }
            for (const key of ownedUserEdited) {
                if (Object.prototype.hasOwnProperty.call(filteredClean, key)) filteredClean[key] = window.S[key];
            }
            _clearDisabledAudioPilotEffective();
            _syncKeys([...changed].filter(key => !ownedUserEdited.has(key)));
            _applyEngineSideEffects(changed, { resize: true, reinitialize: opts.reinitialize === true });
            _restartOscIfNeeded(changed);
            _transitionRAF = null;
            if (_transitionLiveEditKeys === liveEditKeys) _transitionLiveEditKeys = null;
            _saveState();
            resolve({ settings: filteredClean, changed, userEdited: ownedUserEdited });
        };
        _transitionRAF = requestAnimationFrame(tick);
    });
}

function _randomizerSourceMode(opts = {}) {
    const raw = String(opts.sourceMode || window.S?.randomizerSourceMode || 'both');
    return ['true-random', 'atlas-codes', 'both'].includes(raw) ? raw : 'both';
}

function _atlasWaypointPool() {
    const wps = Array.isArray(window.waypoints) ? window.waypoints : [];
    return wps.filter(wp => wp && wp.params && typeof wp.params === 'object');
}

function _settingsFromWaypoint(wp, { includeAudio = true, includeVisuals = true } = {}) {
    if (!wp || !wp.params) return null;
    const raw = {};
    const optics = wp.optics && typeof wp.optics === 'object' ? wp.optics : {};
    if (includeVisuals) {
        Object.assign(raw, wp.params || {});
        Object.assign(raw, optics);
        if (typeof optics.showParticles === 'boolean') raw.showParticles = optics.showParticles;
        if (typeof optics.showRibbons === 'boolean') raw.showRibbons = optics.showRibbons;
        if (typeof optics.tessRibbons === 'boolean') raw.tessRibbons = optics.tessRibbons;
        if (typeof optics.shape === 'string') raw.shape = optics.shape;
        if (Number.isFinite(Number(optics.colorMode))) raw.colorMode = Number(optics.colorMode);
        // Imported/old atlas codes may carry the deprecated invalid negative-coherence bug.
        // Keep treating negative coherence as no-coherence, but do NOT touch signed Turbulence.
        if (Number.isFinite(Number(raw.coherence)) && Number(raw.coherence) < 0) raw.coherence = 0;
        if (!Number.isFinite(Number(raw.physicsEmergence))) raw.physicsEmergence = 0;
    }
    if (includeAudio) {
        const audioState = sanitizeAudioWaypointState(optics.audio || wp.audio || optics);
        if (audioState) Object.assign(raw, audioState);
        else Object.assign(raw, _generateTrueRandomSettings({ includeAudio: true, includeVisuals: false }));
    }
    const clean = _sanitizeSnapshot(raw, { includeAudio, includeVisuals });
    clean._atlasSourceId = wp.id || '';
    clean._atlasSourceName = wp.name || wp.coordId || 'atlas code';
    return clean;
}

function _generateAtlasSettings(opts = {}) {
    const pool = _atlasWaypointPool();
    if (!pool.length) return null;
    const wp = _pick(pool);
    return _settingsFromWaypoint(wp, opts);
}

function _finishRandomizerSettings(settings, opts = {}) {
    const capped = _respectFreeEnergyCap(settings, opts);
    const leftWeighted = _applyLeftWeightedScene(capped, opts);
    return _addExpressiveStructure(_defuzzParticleSnapshot(_avoidTinyCenterBall(leftWeighted, opts), opts), opts);
}

function _chooseRandomizerSettings(opts = {}) {
    const mode = _randomizerSourceMode(opts);
    const allowAtlas = mode === 'atlas-codes' || mode === 'both';
    const useAtlas = allowAtlas && (mode === 'atlas-codes' || _rand() < 0.5);
    if (useAtlas) {
        const atlas = _generateAtlasSettings(opts);
        if (atlas) return { settings: atlas, source: 'atlas', label: atlas._atlasSourceName || 'atlas code' };
        if (mode === 'atlas-codes') return { settings: null, source: 'atlas-empty', label: 'no atlas codes' };
    }
    return { settings: _finishRandomizerSettings(_generateTrueRandomSettings(opts), opts), source: 'random', label: 'random' };
}


const CONTINUOUS_SCENE_FAMILIES = [
    // Low-temp / high-structure families keep the particle body readable;
    // audio FX/backdrops do the messy expression around it.
    { id: 'crystal-cymatics', style: 'cymatics', backdrop: 'rings', flow: 'cymatic', trails: [true, false], range: { inversion:[180, 420], scaleDepth:[1.4, 4.5], coherence:[72, 180], equilibrium:[0.003, 0.045], temperature:[0.02, 0.58], viscosity:[0.08, 0.52], physicsEmergence:[-1.25, 1.25], resolution:[0.70, 6.5], opacity:[0.10,0.34] } },
    { id: 'cellular-orbit', style: 'cellular', backdrop: 'cellfield', flow: 'cellular', trails: [false, false], range: { inversion:[120, 330], scaleDepth:[0.9, 3.4], coherence:[54, 155], equilibrium:[0.006, 0.066], temperature:[0.04, 0.82], viscosity:[0.16, 0.74], physicsEmergence:[-1.05, 1.05], resolution:[0.80, 5.8], opacity:[0.12,0.38] } },
    { id: 'sacred-lowtemp', style: 'kaleido', backdrop: 'sacred', flow: 'vortex', trails: [false, false], range: { inversion:[170, 390], scaleDepth:[1.15, 3.8], coherence:[84, 190], equilibrium:[0.003, 0.052], temperature:[0.00, 0.48], viscosity:[0.10, 0.60], physicsEmergence:[-1.65, 1.65], resolution:[0.55, 4.6], opacity:[0.08,0.32] } },
    { id: 'ribbon-orbit', style: 'ribbons', backdrop: 'sinefield', flow: 'ribbon', trails: [true, false], range: { inversion:[165, 420], scaleDepth:[1.6, 4.8], coherence:[58, 168], equilibrium:[0.004, 0.050], temperature:[0.10, 0.92], viscosity:[0.04, 0.50], physicsEmergence:[-1.9, 1.9], resolution:[0.70, 6.8], opacity:[0.09,0.36] } },
    { id: 'aurora-sheet', style: 'aurora', backdrop: 'aurora', flow: 'sheet', trails: [true, false], range: { inversion:[135, 360], scaleDepth:[1.15, 4.0], coherence:[34, 122], equilibrium:[0.006, 0.082], temperature:[0.04, 0.86], viscosity:[0.20, 0.78], physicsEmergence:[-1.2, 1.2], resolution:[0.62, 5.2], opacity:[0.10,0.40] } },
    { id: 'vortex-scope', style: 'vectorscope', backdrop: 'honeycomb', flow: 'vortex', trails: [false, false], range: { inversion:[150, 400], scaleDepth:[0.85, 3.4], coherence:[74, 182], equilibrium:[0.003, 0.055], temperature:[0.02, 0.70], viscosity:[0.08, 0.58], physicsEmergence:[-1.6, 1.6], resolution:[0.50, 5.4], opacity:[0.08,0.32] } },
    { id: 'matrix-cascade', style: 'matrixrain', backdrop: 'matrixcrawl', flow: 'cellular', trails: [false, true], range: { inversion:[120, 280], scaleDepth:[0.9, 2.9], coherence:[40, 130], equilibrium:[0.008, 0.085], temperature:[0.15, 1.05], viscosity:[0.22, 0.82], physicsEmergence:[-0.95, 0.95], resolution:[1.0, 6.0], opacity:[0.10,0.34] } },
    { id: 'hyperspace-tunnel', style: 'tunnel', backdrop: 'tunnel', flow: 'helix', trails: [true, false], range: { inversion:[200, 500], scaleDepth:[1.4, 5.0], coherence:[42, 140], equilibrium:[0.004, 0.072], temperature:[0.18, 1.25], viscosity:[0.02, 0.44], physicsEmergence:[-2.0, 2.0], resolution:[1.0, 7.2], opacity:[0.08,0.36] } },
    { id: 'split-plume', style: 'constellation', backdrop: 'aurora', flow: 'plume', trails: [true, true], range: { inversion:[190, 520], scaleDepth:[1.25, 5.2], coherence:[38, 145], equilibrium:[0.006, 0.096], temperature:[0.28, 1.20], viscosity:[0.03, 0.46], physicsEmergence:[-3.0, 3.0], resolution:[0.75, 7.8], opacity:[0.09,0.36] } },
    { id: 'chromatic-filaments', style: 'trails', backdrop: 'vectorscope', flow: 'ribbon', trails: [true, true], range: { inversion:[160, 460], scaleDepth:[1.6, 5.6], coherence:[66, 190], equilibrium:[0.002, 0.058], temperature:[0.00, 0.72], viscosity:[0.00, 0.38], physicsEmergence:[-2.7, 2.7], resolution:[0.40, 5.8], opacity:[0.08,0.30] } },
    { id: 'kinetic-lattice', style: 'moire', backdrop: 'honeycomb', flow: 'cymatic', trails: [true, false], range: { inversion:[210, 520], scaleDepth:[1.8, 5.4], coherence:[88, 210], equilibrium:[0.001, 0.046], temperature:[0.00, 0.62], viscosity:[0.08, 0.64], physicsEmergence:[-2.4, 2.4], resolution:[0.55, 6.4], opacity:[0.07,0.28] } },
    { id: 'micro-filaments', style: 'moire', backdrop: 'sinefield', flow: 'sheet', trails: [true, false], range: { inversion:[90, 320], scaleDepth:[0.035, 0.95], coherence:[0.2, 18], equilibrium:[0.001, 0.028], temperature:[0.00, 0.42], viscosity:[0.00, 0.34], physicsEmergence:[-0.48, 0.48], resolution:[0.035, 0.95], opacity:[0.05,0.24] } },
    { id: 'quiet-low-orbit', style: 'vectorscope', backdrop: 'rings', flow: 'vortex', trails: [true, false], range: { inversion:[110, 360], scaleDepth:[0.045, 0.88], coherence:[0.5, 16], equilibrium:[0.001, 0.024], temperature:[0.00, 0.36], viscosity:[0.00, 0.28], physicsEmergence:[-0.62, 0.62], resolution:[0.05, 1.15], opacity:[0.06,0.26] } },
    { id: 'low-coherence-waves', style: 'cymatics', backdrop: 'sinefield', flow: 'cymatic', trails: [true, false], range: { inversion:[120, 380], scaleDepth:[0.055, 1.05], coherence:[0.4, 19], equilibrium:[0.001, 0.035], temperature:[0.00, 0.54], viscosity:[0.00, 0.36], physicsEmergence:[-0.85, 0.85], resolution:[0.045, 1.35], opacity:[0.06,0.30] } },
    { id: 'micro-cymatic-waves', style: 'moire', backdrop: 'cymatics', flow: 'sheet', trails: [true, false], range: { inversion:[90, 340], scaleDepth:[0.035, 0.98], coherence:[0.2, 18], equilibrium:[0.001, 0.030], temperature:[0.00, 0.44], viscosity:[0.00, 0.34], physicsEmergence:[-0.65, 0.65], resolution:[0.035, 1.05], opacity:[0.05,0.26] } },
];
const CONTINUOUS_FOCUS_GROUPS = ['structure', 'structure', 'micro', 'motion', 'optics', 'trails', 'trails', 'audiofx', 'audiofx'];

function _continuousExplorerState() {
    _continuous.roll = (_continuous.roll || 0) + 1;
    if (!_continuous.family || (_continuous.familyRollsLeft | 0) <= 0) {
        _continuous.family = _pick(CONTINUOUS_SCENE_FAMILIES);
        _continuous.familyRollsLeft = 2 + Math.floor(_rand() * 4);
        _continuous.seed = _rand() * 1000;
    } else {
        _continuous.familyRollsLeft--;
    }
    if ((_continuous.roll % 2) === 1 || !_continuous.focus) _continuous.focus = _pick(CONTINUOUS_FOCUS_GROUPS);
    return { family: _continuous.family, focus: _continuous.focus, roll: _continuous.roll, seed: _continuous.seed };
}

function _rangeValue(range, roll, seed, focusAmp = 1) {
    const lo = Number(range[0]);
    const hi = Number(range[1]);
    const chaos = _randomizerChaos();
    const spanBias = 0.46 + chaos * 0.54;
    const osc = 0.5 + 0.5 * Math.sin(roll * (0.62 + chaos * 0.58) + seed);
    const jitter = (_rand() - 0.5) * (0.05 + chaos * 0.24) * focusAmp;
    const centered = 0.5 + (osc - 0.5) * spanBias;
    return lo + (hi - lo) * Math.max(0, Math.min(1, centered * (0.78 + focusAmp * 0.12) + 0.08 + jitter));
}

function _coherentContinuousScene(settings) {
    if (!settings) return settings;
    const ex = _continuousExplorerState();
    const f = ex.family || CONTINUOUS_SCENE_FAMILIES[0];
    const ranges = f.range || {};
    const focus = ex.focus;
    const focusKeys = {
        structure: ['inversion', 'scaleDepth', 'coherence', 'physicsEmergence'],
        micro: ['scaleDepth', 'coherence', 'equilibrium', 'temperature', 'viscosity', 'resolution', 'opacity', 'physicsEmergence'],
        motion: ['tempo', 'equilibrium', 'temperature', 'viscosity', 'mass'],
        optics: ['hue', 'sat', 'lightness', 'opacity', 'bgGlow', 'bgBlur', 'resolution'],
        trails: ['trailLen', 'showRibbons', 'tessRibbons', 'compatFlowMode'],
        audiofx: ['visualEffectAmount', 'visualEffectExpressivity', 'visualEffectDynamics', 'visualEffectRings', 'visualEffect2DBackdropMix']
    }[focus] || [];
    const setR = (key, fallbackRange) => {
        const range = ranges[key] || fallbackRange || (SAFE_RANDOM_RANGES[key] ? [SAFE_RANDOM_RANGES[key].min, SAFE_RANDOM_RANGES[key].max] : null);
        if (!range) return;
        const chaos = _randomizerChaos();
        const amp = (focusKeys.includes(key) ? 1.35 : 0.45) * (0.42 + chaos * 1.18);
        settings[key] = _roundToStep(_rangeValue(range, ex.roll, ex.seed + key.length * 1.91, amp), SAFE_RANDOM_RANGES[key]?.step || 0.01);
    };
    for (const key of ['inversion', 'scaleDepth', 'coherence', 'equilibrium', 'temperature', 'viscosity', 'physicsEmergence', 'resolution', 'opacity']) setR(key);
    if (focus === 'motion') { setR('tempo', [0.35, 2.6]); setR('mass', [0.55, 3.1]); }
    else { settings.tempo = _roundToStep(_rangeValue([0.45, 2.2], ex.roll, ex.seed + 7.3, 0.65), 0.01); settings.mass = _roundToStep(_rangeValue([0.55, 2.6], ex.roll, ex.seed + 8.4, 0.45), 0.05); }
    if (focus === 'optics' || focus === 'audiofx') {
        settings.hue = _roundToStep(((_rangeValue([0.0, 1.0], ex.roll, ex.seed + 4.1, 1.5) % 1) + 1) % 1, 0.01);
        settings.sat = _roundToStep(_rangeValue([0.78, 1.55], ex.roll, ex.seed + 5.2, 1.2), 0.01);
        settings.lightness = _roundToStep(_rangeValue([0.62, 1.12], ex.roll, ex.seed + 6.1, 0.9), 0.01);
        settings.opacity = _roundToStep(_rangeValue([0.10, 0.62], ex.roll, ex.seed + 6.7, 1.0), 0.01);
    } else {
        settings.sat = Math.max(0.78, Number(settings.sat) || 1.0);
        settings.lightness = Math.max(0.60, Math.min(1.12, Number(settings.lightness) || 0.86));
    }
    settings.compatFlowMode = focus === 'trails' && _rand() < 0.34 ? _pick(COMPAT_FLOW_MODES) : f.flow;
    settings.visualEffectStyle = _rand() < 0.72 ? f.style : _pickVisualEffectStyle();
    settings.visualEffect2DBackdropStyle = _rand() < 0.48 ? f.backdrop : _pick2DBackdropStyle();
    settings.visualEffectAmount = _roundToStep(_rangeValue([0.55, 1.82], ex.roll, ex.seed + 9.2, focus === 'audiofx' ? 1.6 : 0.75), 0.01);
    settings.visualEffectExpressivity = _roundToStep(_rangeValue([1.05, 2.35], ex.roll, ex.seed + 10.2, focus === 'audiofx' ? 1.4 : 0.65), 0.01);
    settings.visualEffectDynamics = _roundToStep(_rangeValue([0.92, 2.15], ex.roll, ex.seed + 11.2, focus === 'audiofx' ? 1.3 : 0.65), 0.01);
    const trailIntent = f.trails || [true, false];
    settings.showRibbons = focus === 'trails' ? (_rand() < 0.74) : !!trailIntent[0];
    settings.tessRibbons = focus === 'trails' ? (_rand() < 0.42) : !!trailIntent[1];
    settings.trailLen = Math.round(_rangeValue([7, 30], ex.roll, ex.seed + 12.7, focus === 'trails' ? 1.35 : 0.55));
    settings.showParticles = true;
    settings.shape = _rand() < 0.12 ? _pick(SHAPES) : (window.S.shape || 'circle');
    settings.colorMode = _pick(RANDOM_COLOR_MODES);
    settings._familyId = f.id;
    settings._lowValueScene = _isLowValueScene(settings);
    settings._focus = focus;
    return settings;
}

function _applyLowValueFlux(settings) {
    if (!settings) return settings;
    settings._lowValueScene = true;
    settings.inversion = _roundToStep(90 + _rand() * 280, 1);
    settings.scaleDepth = _roundToStep(0.035 + _rand() * 0.90, 0.01);
    settings.coherence = _roundToStep(_rand() * 18, 1);
    settings.equilibrium = _roundToStep(0.001 + _rand() * 0.026, 0.001);
    settings.temperature = _roundToStep(_rand() * 0.46, 0.01);
    settings.viscosity = _roundToStep(_rand() * 0.34, 0.01);
    settings.physicsEmergence = _roundToStep((_rand() < 0.5 ? -1 : 1) * (0.04 + _rand() * 0.58), 0.01);
    settings.resolution = _roundToStep(_rand() < 0.64 ? (0.035 + _rand() * 0.88) : (1.0 + _rand() * 2.4), 0.01);
    settings.opacity = _roundToStep(0.06 + _rand() * 0.22, 0.01);
    settings.trailLen = Math.round(7 + _rand() * 18);
    settings.compatFlowMode = _pick(['sheet', 'vortex', 'cymatic', 'ribbon']);
    settings.visualEffectStyle = _pick(['moire', 'vectorscope', 'cymatics', 'trails', 'constellation']);
    settings.visualEffect2DBackdropStyle = _pick2DBackdropStyle();
    return settings;
}

function _generateTrueRandomSettings({ includeAudio = true, includeVisuals = true, continuous = false, allowDiscrete = false, randomizeAudioPilotMask = false } = {}) {
    const settings = {};

    if (includeVisuals) {
        for (const key of NUMERIC_VISUAL_RANDOMIZER_KEYS) {
            settings[key] = continuous
                ? _randomNearbyValue(key, SAFE_RANDOM_RANGES[key])
                : _randomValue(key, SAFE_RANDOM_RANGES[key]);
        }
        if (!continuous && _rand() < 0.42) _applyLowValueFlux(settings);
        settings.showParticles = true;

        if (continuous && window.S?.randomizerSmoothContinuous !== false) {
            // Continuous mode should morph, but it should still travel through
            // optical states. Shape changes are rare; color/trails/backdrop style
            // are intentionally active so the continuous randomizer is visible.
            settings.shape = _rand() < 0.18 ? _pick(SHAPES) : (window.S.shape || 'circle');
            settings.colorMode = _pick(RANDOM_COLOR_MODES);
            settings.showRibbons = _rand() > 0.26;
            settings.tessRibbons = settings.showRibbons && _rand() > 0.62;
            settings.trailLen = _randomValue('trailLen', SAFE_RANDOM_RANGES.trailLen);
            settings.hue = _randomValue('hue', SAFE_RANDOM_RANGES.hue);
            settings.sat = Math.max(0.72, _randomValue('sat', SAFE_RANDOM_RANGES.sat));
            settings.lightness = _randomValue('lightness', SAFE_RANDOM_RANGES.lightness);
            settings.opacity = _randomValue('opacity', SAFE_RANDOM_RANGES.opacity);
            settings.bgGlow = _randomValue('bgGlow', SAFE_RANDOM_RANGES.bgGlow);
            settings.bgBlur = _randomValue('bgBlur', SAFE_RANDOM_RANGES.bgBlur);
            settings.compatFlowMode = _rand() < 0.42 ? _pick(COMPAT_FLOW_MODES) : (window.S.compatFlowMode || 'adaptive');
            settings.visualEffectStyle = (window.S.visualEffectRandomize !== false) ? _pickVisualEffectStyle() : (window.S.visualEffectStyle || 'random');
            settings.visualEffects = _randomizerVisualEffectsEnabled();
            // Continuous randomization changes effect style/amount, but layer
            // power is user-controlled by the 2D Backdrop and 3D FX toggles.
            settings.visualEffectBackdrop = _currentLayerFlag('visualEffectBackdrop', true);
            settings.visualEffect2DBackdrop = _currentLayerFlag('visualEffect2DBackdrop', true);
            settings.visualEffect2DBackdropStyle = window.S.visualEffectRandomize !== false ? _pick2DBackdropStyle() : (window.S.visualEffect2DBackdropStyle || 'rainbow');
            settings.visualEffectPost = _currentLayerFlag('visualEffectPost', true);
            settings.visualEffectCenterSwim = false;
            settings.visualEffectNoTrailStyles = false;
            settings.visualEffectAmount = Math.max(settings.visualEffectAmount || 0, 0.72 + _rand() * 1.15);
            _coherentContinuousScene(settings);
            if (_rand() < 0.34) {
                settings.coherence = _roundToStep(0.2 + _rand() * 19.3, 1);
                settings._lowCoherenceScene = true;
            }
        } else if (allowDiscrete || !continuous) {
            settings.shape = _pick(SHAPES);
            settings.colorMode = _pick(RANDOM_COLOR_MODES);
            settings.compatFlowMode = _pick(COMPAT_FLOW_MODES);
            settings.visualEffectStyle = _pickVisualEffectStyle();
            settings.visualEffects = _randomizerVisualEffectsEnabled();
            // Manual randomize changes the selected FX, but layer power remains
            // user-controlled via 2D Backdrop / 3D FX toggles.
            settings.visualEffectBackdrop = _currentLayerFlag('visualEffectBackdrop', true);
            settings.visualEffect2DBackdrop = _currentLayerFlag('visualEffect2DBackdrop', true);
            settings.visualEffect2DBackdropStyle = _rand() < 0.82 ? _pick2DBackdropStyle() : _pick(['cymatics', 'rings', 'sinefield', 'oscilloscope', 'vectorscope', 'moire']);
            settings.visualEffectPost = _currentLayerFlag('visualEffectPost', true);
            settings.visualEffectCenterSwim = false;
            settings.visualEffectNoTrailStyles = false;
            settings.showRibbons = _rand() > 0.22;
            settings.tessRibbons = _rand() > 0.54;
        }
    }

    if (includeAudio) {
        for (const key of RANDOM_NUMERIC_AUDIO_KEYS) settings[key] = _randomValue(key, SAFE_RANDOM_RANGES[key]);
        settings.audioLoop = true;
        if (continuous && randomizeAudioPilotMask) {
            Object.assign(settings, _continuousAudioPilotMaskSettings());
        }
    }

    return settings;
}

function _continuousNext() {
    if (_continuous.timer) {
        clearTimeout(_continuous.timer);
        _continuous.timer = null;
    }
    if (!_continuous.active) return;

    const now = performance.now ? performance.now() : Date.now();
    const maxPendingMs = Math.max(2500, ((_continuous.transitionSec || 6) * 1000) + 2500);
    if (_continuous.pending && _continuous.pendingStartedAt && (now - _continuous.pendingStartedAt) < maxPendingMs) {
        _continuous.timer = setTimeout(_continuousNext, Math.max(600, Math.min(2000, _continuous.transitionSec * 220)));
        return;
    }
    if (_continuous.pending) {
        console.warn('[randomizer] stale continuous transition cleared');
        _continuous.pending = null;
    }

    const runId = _continuous.runId;
    _continuous.pendingStartedAt = now;
    const p = randomizeScaleSpaceSettings({
        includeAudio: true,
        includeVisuals: true,
        transitionSec: _continuous.transitionSec,
        continuous: true,
        preserveFreeEnergy: true,
        randomizeAudioPilotMask: true,
    });
    _continuous.pending = Promise.resolve(p)
        .catch(e => console.error(e))
        .finally(() => {
            if (runId === _continuous.runId) {
                _continuous.pending = null;
                _continuous.pendingStartedAt = 0;
            }
            if (!_continuous.active || runId !== _continuous.runId) return;
            _continuous.timer = setTimeout(_continuousNext, Math.max(900, _continuous.transitionSec * 520));
            _dispatch('scalespace-randomizer-continuous', getContinuousRandomizationState());
        });

    // Watchdog: if a transition promise gets orphaned by a canceled RAF or a
    // tab visibility pause, keep the continuous randomizer alive.
    setTimeout(() => {
        if (_continuous.active && runId === _continuous.runId && _continuous.pending) {
            const t = performance.now ? performance.now() : Date.now();
            if (!_continuous.pendingStartedAt || (t - _continuous.pendingStartedAt) >= maxPendingMs) {
                _continuous.pending = null;
                _continuous.pendingStartedAt = 0;
                _continuousNext();
            }
        }
    }, maxPendingMs + 120);
}

export function getRandomizerLast10() {
    return _readHistory();
}

export function clearRandomizerLast10() {
    _writeHistory([]);
}

export async function applyScaleSpaceSettings(settings, opts = {}) {
    const result = await _transitionToSnapshot(settings, opts);
    const summary = _summarize(settings, opts.label || 'settings');
    _dispatch('scalespace-randomized', { ...summary, source: opts.source || 'settings' });
    return result;
}

export function randomizeScaleSpaceSettings(opts = {}) {
    if (!window.S) return null;

    const picked = _chooseRandomizerSettings(opts);
    if (!picked || !picked.settings) {
        const summary = {
            id: Date.now().toString(36).toUpperCase(),
            label: picked?.label || 'no atlas codes',
            randomizerSource: picked?.source || 'atlas-empty',
            atlasSourceId: '',
            atlasSourceName: '',
            skipped: true,
        };
        _dispatch('scalespace-randomized', { ...summary, source: picked?.source || 'atlas-empty' });
        return summary;
    }

    const applyOpts = _randomizerApplyOptions(opts, picked);
    const settings = _respectAudioPilotLocks(picked.settings, applyOpts);
    const source = opts.continuous ? (picked.source === 'atlas' ? 'continuous-atlas' : 'continuous') : picked.source;
    const summary = _summarize(settings, picked.label || source);
    summary.randomizerSource = picked.source;
    summary.atlasSourceId = settings._atlasSourceId || '';
    summary.atlasSourceName = settings._atlasSourceName || '';
    delete settings._atlasSourceId;
    delete settings._atlasSourceName;
    _pushHistory(settings, summary);

    if (!opts.transitionSec) {
        _applySnapshotImmediate(settings, applyOpts);
        _dispatch('scalespace-randomized', { ...summary, source });
        return summary;
    }

    return _transitionToSnapshot(settings, applyOpts)
        .then(() => {
            _dispatch('scalespace-randomized', { ...summary, source });
            return summary;
        });
}

export async function applyRandomizerPreset(id, opts = {}) {
    const preset = RANDOMIZER_PRESETS.find(p => p.id === id);
    if (!preset) return null;
    _setRandomizerState({ preset: preset.id, transitionSec: opts.transitionSec });
    const settings = _respectAudioPilotLocks(preset.settings, { ...opts, source: 'preset' });
    await _transitionToSnapshot(settings, { ...opts, source: 'preset', reinitialize: opts.reinitialize === true });
    const summary = _summarize(settings, preset.name);
    _dispatch('scalespace-randomized', { ...summary, source: 'preset', presetId: preset.id, presetName: preset.name });
    return summary;
}

export async function applyRandomizerHistory(id, opts = {}) {
    const entry = _readHistory().find(h => h.id === id);
    if (!entry || !entry.settings) return null;
    const settings = _respectAudioPilotLocks(entry.settings, { ...opts, source: 'history' });
    await _transitionToSnapshot(settings, { ...opts, source: 'history', reinitialize: opts.reinitialize === true });
    const summary = _summarize(settings, entry.label || 'last 10');
    _dispatch('scalespace-randomized', { ...summary, source: 'history', historyId: entry.id });
    return summary;
}

export function setContinuousRandomization(active, opts = {}) {
    const transitionSec = Math.max(0.1, Math.min(120, Number(opts.transitionSec ?? window.S?.randomizerTransitionSec ?? 6.0) || 6.0));
    const nextActive = !!active;
    _continuous.runId++;
    _continuous.active = nextActive;
    _continuous.transitionSec = transitionSec;
    _continuous.pending = null;
    _continuous.pendingStartedAt = 0;
    if (nextActive) {
        _continuous.family = null;
        _continuous.familyRollsLeft = 0;
        _continuous.focus = 'shape';
        _continuous.seed = _rand() * 1000;
    }
    if (window.S) {
        window.S.randomizerContinuous = nextActive;
        window.S.randomizerTransitionSec = transitionSec;
    }
    if (_continuous.timer) {
        clearTimeout(_continuous.timer);
        _continuous.timer = null;
    }
    _setRandomizerState({ continuous: nextActive, transitionSec });
    _syncKeys(['randomizerContinuous']);

    if (!nextActive) {
        _cancelTransition();
        _continuous.pending = null;
        _dispatch('scalespace-randomizer-continuous', getContinuousRandomizationState());
        return getContinuousRandomizationState();
    }

    _dispatch('scalespace-randomizer-continuous', getContinuousRandomizationState());
    _continuous.timer = setTimeout(_continuousNext, 0);
    return getContinuousRandomizationState();
}

export function updateContinuousRandomizationTransitionSec(value) {
    const current = Number(window.S?.randomizerTransitionSec ?? _continuous.transitionSec ?? 6.0);
    const n = Number(value);
    const transitionSec = Math.max(0.1, Math.min(120, Number.isFinite(n) ? n : (Number.isFinite(current) ? current : 6.0)));
    _continuous.transitionSec = transitionSec;
    if (window.S) window.S.randomizerTransitionSec = transitionSec;
    _setRandomizerState({ transitionSec });
    _syncKeys(['randomizerTransitionSec']);
    _dispatch('scalespace-randomizer-continuous', getContinuousRandomizationState());
    return getContinuousRandomizationState();
}

export function getContinuousRandomizationState() {
    return {
        active: _continuous.active,
        transitionSec: _continuous.transitionSec,
        pending: !!_continuous.pending,
        timer: !!_continuous.timer,
        pendingStartedAt: _continuous.pendingStartedAt || 0,
    };
}

export function exportScaleSpaceSettingsFile() {
    const payload = {
        schemaVersion: 1,
        exportedFrom: 'scale-space-settings',
        exportedAt: new Date().toISOString(),
        settings: _snapshotFromState(),
        history: _readHistory(),
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date();
    const ymd = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const hms = String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0') + String(d.getSeconds()).padStart(2, '0');
    a.href = url;
    a.download = `scalespace_settings_${ymd}_${hms}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function importScaleSpaceSettingsFile(file, opts = {}) {
    if (!file) return Promise.resolve(null);
    if (typeof file.size === 'number' && file.size > 10_000_000) {
        if (window.showToast) window.showToast('Settings file too large', { color: '#ff9a9a' });
        return Promise.resolve(null);
    }

    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onerror = () => {
            if (window.showToast) window.showToast('Could not read settings JSON', { color: '#ff9a9a' });
            resolve(null);
        };
        reader.onload = async (e) => {
            try {
                const data = JSON.parse(String(e.target.result || '{}'));
                const settings = data && typeof data === 'object'
                    ? (data.settings && typeof data.settings === 'object' ? data.settings : data)
                    : null;
                if (!settings) throw new Error('settings missing');
                const result = await applyScaleSpaceSettings(settings, { ...opts, source: 'settings-import', label: 'import' });
                if (Array.isArray(data.history)) _writeHistory(data.history.slice(0, MAX_HISTORY));
                if (window.showToast) window.showToast('Settings imported', { color: '#88ff88' });
                resolve(result);
            } catch (err) {
                if (window.showToast) window.showToast('Bad settings JSON', { color: '#ff9a9a' });
                resolve(null);
            }
        };
        reader.readAsText(file);
    });
}

window.randomizeScaleSpaceSettings = randomizeScaleSpaceSettings;
window.applyScaleSpaceSettings = applyScaleSpaceSettings;
window.applyRandomizerPreset = applyRandomizerPreset;
window.applyRandomizerHistory = applyRandomizerHistory;
window.setContinuousRandomization = setContinuousRandomization;
window.updateContinuousRandomizationTransitionSec = updateContinuousRandomizationTransitionSec;
window.getRandomizerLast10 = getRandomizerLast10;
window.exportScaleSpaceSettingsFile = exportScaleSpaceSettingsFile;
window.importScaleSpaceSettingsFile = importScaleSpaceSettingsFile;

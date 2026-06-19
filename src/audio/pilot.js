import { VISUAL_EFFECT_STYLES } from '../render/visual-style-registry.js';
import { AUDIO_2D_BACKDROP_STYLE_IDS } from '../render/audio-fx-registry.js';

export const AUDIO_PILOT_KEYS = [
    'resolution', 'opacity', 'bgGlow', 'bgBlur', 'trailLen', 'coherence',
    'scaleDepth', 'physicsEmergence', 'inversion', 'halfLife', 'temperature', 'equilibrium', 'viscosity', 'mass', 'tempo',
    'hue', 'sat', 'lightness',
    'showParticles', 'shape', 'showRibbons', 'tessRibbons', 'colorMode'
];

export const AUDIO_REACTIVE_CONTROL_KEYS = [
    'audioReactiveAmount',
    'audioReactiveGain',
    'audioReactiveAttack',
    'audioReactiveRelease',
    'audioReactiveRelaxation',
    'audioColorBeat',
    'audioParticleDrive',
    'audioParticleMotionDrive',
    'audioParticleColorDrive'
];

export const AUDIO_FX_NUMBER_KEYS = [
    'visualEffectAmount',
    'visualEffectQuality',
    'visualEffectEcho',
    'visualEffectAberration',
    'visualEffectRings',
    'visualEffectExpressivity',
    'visualEffectDynamics',
    'visualEffect2DBackdropMix',
    'visualEffect2DFade',
    'visualEffect3DFade'
];

export const AUDIO_FX_BOOLEAN_KEYS = [
    'visualEffects',
    'visualEffectBackdrop',
    'visualEffect2DBackdrop',
    'visualEffectPost',
    'visualEffectCenterSwim',
    'visualEffectNoTrailStyles',
    'visualEffectRandomize',
    'audioAutoEnableVisuals'
];

export const AUDIO_FX_ENUM_KEYS = [
    'visualEffectStyle',
    'visualEffect2DBackdropStyle'
];

export const AUDIO_RANDOMIZER_CONTROL_KEYS = [
    'visualEffectRandomize',
    'randomizerSourceMode'
];

export const AUDIO_WAYPOINT_KEYS = [
    ...AUDIO_REACTIVE_CONTROL_KEYS,
    ...AUDIO_FX_NUMBER_KEYS,
    ...AUDIO_FX_BOOLEAN_KEYS,
    ...AUDIO_FX_ENUM_KEYS,
    'randomizerSourceMode',
    ...AUDIO_PILOT_KEYS.map(key => 'randomizerPilot_' + key),
    ...AUDIO_PILOT_KEYS.map(key => 'audioPilot_' + key)
];

const AUDIO_NUMBER_LIMITS = {
    audioReactiveAmount: [0, 3],
    audioReactiveGain: [0, 16],
    audioReactiveAttack: [0.005, 0.5],
    audioReactiveRelease: [0.002, 0.25],
    audioReactiveRelaxation: [0, 2],
    audioColorBeat: [0, 3],
    audioParticleDrive: [0, 3],
    audioParticleMotionDrive: [0, 3],
    audioParticleColorDrive: [0, 3],
    visualEffectAmount: [0, 2.5],
    visualEffectQuality: [0.25, 1],
    visualEffectEcho: [0.02, 0.6],
    visualEffectAberration: [0, 1],
    visualEffectRings: [0, 1],
    visualEffectExpressivity: [0.35, 2.5],
    visualEffectDynamics: [0.25, 2.5],
    visualEffect2DBackdropMix: [0.05, 2.5],
    visualEffect2DFade: [0, 1],
    visualEffect3DFade: [0, 1]
};

const AUDIO_ENUM_VALUES = {
    randomizerSourceMode: ['true-random', 'atlas-codes', 'both'],
    visualEffectStyle: VISUAL_EFFECT_STYLES,
    visualEffect2DBackdropStyle: AUDIO_2D_BACKDROP_STYLE_IDS
};

export function audioPilotStateKey(key) {
    return 'audioPilot_' + key;
}

export function randomizerPilotStateKey(key) {
    return 'randomizerPilot_' + key;
}

export function defaultAudioPilotEnabled(key) {
    return key !== 'resolution';
}

export function defaultRandomizerPilotEnabled(key) {
    return true;
}

export function isAudioPilotEnabled(key, S = (typeof window !== 'undefined' ? window.S || {} : {})) {
    const stateKey = audioPilotStateKey(key);
    if (typeof S[stateKey] === 'boolean') return S[stateKey];
    return defaultAudioPilotEnabled(key);
}

export function isRandomizerPilotEnabled(key, S = (typeof window !== 'undefined' ? window.S || {} : {})) {
    const stateKey = randomizerPilotStateKey(key);
    if (typeof S[stateKey] === 'boolean') return S[stateKey];
    const legacyKey = audioPilotStateKey(key);
    if (typeof S[legacyKey] === 'boolean') return S[legacyKey];
    return defaultRandomizerPilotEnabled(key);
}

function finiteClamped(v, lo, hi) {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.max(lo, Math.min(hi, n));
}

export function sanitizeAudioWaypointState(raw, base = (typeof window !== 'undefined' ? window.S || {} : {})) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const out = {};

    for (const key of [...AUDIO_REACTIVE_CONTROL_KEYS, ...AUDIO_FX_NUMBER_KEYS]) {
        const limits = AUDIO_NUMBER_LIMITS[key];
        const n = limits ? finiteClamped(raw[key], limits[0], limits[1]) : null;
        if (n !== null) out[key] = n;
    }

    for (const key of AUDIO_FX_BOOLEAN_KEYS) {
        if (typeof raw[key] === 'boolean') out[key] = raw[key];
    }

    for (const key of AUDIO_FX_ENUM_KEYS) {
        const allowed = AUDIO_ENUM_VALUES[key];
        if (typeof raw[key] === 'string' && allowed && allowed.includes(raw[key])) out[key] = raw[key];
    }

    for (const key of AUDIO_PILOT_KEYS) {
        const audioKey = audioPilotStateKey(key);
        const randomizerKey = randomizerPilotStateKey(key);
        const hasAudio = typeof raw[audioKey] === 'boolean';
        const hasRandomizer = typeof raw[randomizerKey] === 'boolean';
        if (hasAudio) out[audioKey] = raw[audioKey];
        if (hasRandomizer) out[randomizerKey] = raw[randomizerKey];
        else if (hasAudio) out[randomizerKey] = raw[audioKey];
    }

    if (typeof raw.randomizerSourceMode === 'string' && AUDIO_ENUM_VALUES.randomizerSourceMode.includes(raw.randomizerSourceMode)) {
        out.randomizerSourceMode = raw.randomizerSourceMode;
    }

    return Object.keys(out).length ? out : null;
}

export function captureAudioWaypointState(S = (typeof window !== 'undefined' ? window.S || {} : {})) {
    const out = {};

    for (const key of [...AUDIO_REACTIVE_CONTROL_KEYS, ...AUDIO_FX_NUMBER_KEYS]) {
        const limits = AUDIO_NUMBER_LIMITS[key];
        const fallback = Number.isFinite(Number(S[key])) ? Number(S[key]) : Number(baseAudioDefaults[key]);
        const n = limits ? finiteClamped(fallback, limits[0], limits[1]) : null;
        if (n !== null) out[key] = n;
    }

    for (const key of AUDIO_FX_BOOLEAN_KEYS) {
        out[key] = typeof S[key] === 'boolean' ? S[key] : baseAudioDefaults[key] !== false;
    }

    for (const key of AUDIO_FX_ENUM_KEYS) {
        const allowed = AUDIO_ENUM_VALUES[key];
        const value = typeof S[key] === 'string' ? S[key] : baseAudioDefaults[key];
        if (allowed && allowed.includes(value)) out[key] = value;
    }

    for (const key of AUDIO_PILOT_KEYS) {
        out[randomizerPilotStateKey(key)] = isRandomizerPilotEnabled(key, S);
        out[audioPilotStateKey(key)] = isAudioPilotEnabled(key, S);
    }

    out.randomizerSourceMode = AUDIO_ENUM_VALUES.randomizerSourceMode.includes(S.randomizerSourceMode) ? S.randomizerSourceMode : 'both';
    return out;
}

const baseAudioDefaults = {
    audioReactiveAmount: 1.28,
    audioReactiveGain: 5.2,
    audioReactiveAttack: 0.062,
    audioReactiveRelease: 0.010,
    audioReactiveRelaxation: 0.72,
    audioColorBeat: 1.25,
    audioParticleDrive: 1.0,
    audioParticleMotionDrive: 1.0,
    audioParticleColorDrive: 1.0,
    visualEffects: true,
    visualEffectStyle: 'random',
    visualEffectAmount: 1.05,
    visualEffectQuality: 0.66,
    visualEffectEcho: 0.12,
    visualEffectAberration: 0.34,
    visualEffectRings: 0.95,
    visualEffectExpressivity: 1.6,
    visualEffectDynamics: 1.35,
    visualEffectBackdrop: true,
    visualEffect2DBackdrop: true,
    visualEffect2DBackdropStyle: 'classic',
    visualEffect2DBackdropMix: 1.0,
    visualEffect2DFade: 0.01,
    visualEffect3DFade: 0.5,
    visualEffectPost: true,
    visualEffectCenterSwim: false,
    visualEffectNoTrailStyles: false,
    visualEffectRandomize: true,
    audioAutoEnableVisuals: true
};

export function applyAudioWaypointState(raw, S = (typeof window !== 'undefined' ? window.S || {} : {}), opts = {}) {
    const state = sanitizeAudioWaypointState(raw, S);
    if (!state) return false;

    const applyRandomizerPilotMask = opts.applyRandomizerPilotMask === true;
    const applyRandomizerSourceMode = opts.applyRandomizerSourceMode === true;

    for (const [key, value] of Object.entries(state)) {
        if (!applyRandomizerPilotMask && key.startsWith('randomizerPilot_')) continue;
        if (!applyRandomizerSourceMode && key === 'randomizerSourceMode') continue;
        S[key] = value;
        try {
            if (typeof window !== 'undefined' && window.sliderSync && typeof window.sliderSync[key] === 'function') {
                window.sliderSync[key](value);
            }
        } catch (e) {}
    }

    if (typeof window !== 'undefined' && window.S_effective) {
        for (const key of AUDIO_PILOT_KEYS) {
            if (!isAudioPilotEnabled(key, S)) delete window.S_effective[key];
        }
    }

    try { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('scalespace-audio-visual-state')); } catch (e) {}
    try { if (typeof window !== 'undefined' && window.syncTogglesFromState) window.syncTogglesFromState(); } catch (e) {}
    try { if (typeof window !== 'undefined' && window.syncRandomizerPilotTogglesFromState) window.syncRandomizerPilotTogglesFromState(); } catch (e) {}
    try { if (typeof window !== 'undefined' && window.syncAudioPilotTogglesFromState) window.syncAudioPilotTogglesFromState(); } catch (e) {}
    try { if (typeof window !== 'undefined' && window.refreshRadialUI) window.refreshRadialUI(); } catch (e) {}
    return true;
}

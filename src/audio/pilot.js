export const AUDIO_PILOT_KEYS = [
    'resolution', 'opacity', 'bgGlow', 'bgBlur', 'trailLen', 'coherence',
    'scaleDepth', 'physicsEmergence', 'inversion', 'halfLife', 'temperature', 'equilibrium', 'viscosity', 'mass', 'tempo',
    'hue', 'sat', 'lightness',
    'showParticles', 'shape', 'showRibbons', 'tessRibbons', 'colorMode'
];

export function audioPilotStateKey(key) {
    return 'audioPilot_' + key;
}

export function defaultAudioPilotEnabled(key) {
    return key !== 'resolution';
}

export function isAudioPilotEnabled(key, S = window.S || {}) {
    const stateKey = audioPilotStateKey(key);
    if (typeof S[stateKey] === 'boolean') return S[stateKey];
    return defaultAudioPilotEnabled(key);
}

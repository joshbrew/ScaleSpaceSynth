// Shared atlas/state constants. Keep this module dependency-free so save/share,
// validation, modulation, UI, and atlas can all use the same keys without
// importing the whole atlas UI/tour system.

export const PARAM_KEYS = [
    'freeEnergy', 'resolution', 'inversion', 'halfLife', 'scaleDepth', 'physicsEmergence',
    'coherence', 'equilibrium', 'temperature', 'viscosity', 'mass',
    'tempo', 'hue', 'sat', 'lightness', 'opacity', 'trailLen',
    'bgGlow', 'bgBlur', 'offsetX', 'offsetY', 'offsetZ', 'billboardOffset'
];

export const MODULATABLE_KEYS = [
    'freeEnergy', 'resolution', 'inversion', 'halfLife', 'scaleDepth', 'physicsEmergence',
    'coherence', 'equilibrium', 'temperature', 'viscosity', 'mass',
    'tempo', 'opacity', 'hue', 'sat', 'lightness', 'trailLen', 'bgGlow', 'bgBlur'
];

export const MOD_KEYS = MODULATABLE_KEYS.map(k => k + '_mod');

export const VISIBILITY_XFADE_KEYS = {
    showParticles: 'particles',
    showRibbons:   'ribbons',
    tessRibbons:   'lattice'
};

export const TOUR_STOPPING_KEYS = new Set([
    ...PARAM_KEYS,
    ...MOD_KEYS,
    'showParticles', 'showRibbons', 'tessRibbons',
    'shape', 'colorMode',
    'moveMode'
]);

export const tour = { active: false, rotSpeed: 0.0005, wpIdx: 0, mode: 'sequential', speed: 1 };

export function coordHash(p) {
    let h = '';
    PARAM_KEYS.forEach(k => {
        const v = p[k];
        if (v === undefined) return;
        h += v < 1 ? v.toFixed(2) : v < 100 ? Math.round(v * 10) / 10 : Math.round(v);
    });
    let n = 0;
    for (let i = 0; i < h.length; i++) n = ((n << 5) - n) + h.charCodeAt(i) | 0;
    return 'SS-' + Math.abs(n).toString(36).toUpperCase().slice(0, 8);
}

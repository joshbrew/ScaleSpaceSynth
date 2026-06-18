const BASE_STYLE_MODES = [
    { id: 'random', label: 'Random visualizer' },
    { id: 'adaptive', label: 'Adaptive plasma' }
];

export const VISUAL_EFFECT_PLUGINS = [
    { id: 'spectral', label: 'Spectral Bloom' },
    { id: 'kaleido', label: 'Kaleido Bloom' },
    { id: 'constellation', label: 'Constellation Web' },
    { id: 'cymatics', label: 'Cymatic rings' },
    { id: 'sinefield', label: 'iTunes sine field', geometry: ['nativeRibbon'] },
    { id: 'oscilloscope', label: 'Oscilloscope sweep' },
    { id: 'matrixrain', label: 'Matrix Rain' },
    { id: 'spectrum', label: 'Classic Spectrum', geometry: ['nativeLattice', 'compatCell'] },
    { id: 'vectorscope', label: 'Vectorscope Bloom', geometry: ['nativeRibbon', 'compatCurve'] },
    { id: 'tunnel', label: 'Subatomic tunnel', geometry: ['nativeRibbon'] },
    { id: 'aurora', label: 'Entropy aurora' },
    { id: 'lattice', label: 'Wave lattice', safe: false, geometry: ['nativeLattice', 'compatCell'] },
    { id: 'cellular', label: 'Cellular Automata', safe: false, geometry: ['nativeLattice', 'compatCell'] },
    { id: 'moire', label: 'Moire Phase Mesh', geometry: ['nativeLattice', 'compatCurve', 'compatCell'] },
    { id: 'hyperspace', label: 'Hyperspace Spokes', geometry: ['nativeRibbon', 'compatRibbon', 'compatCurve'] },
    { id: 'starfield', label: 'Starfield Trails', geometry: ['nativeRibbon', 'compatRibbon'] },
    { id: 'trails', label: 'Light Trails', geometry: ['nativeRibbon', 'compatRibbon', 'compatCurve'] },
    { id: 'entropy', label: 'Entropy Calculator', geometry: ['nativeRibbon', 'nativeLattice', 'compatRibbon', 'compatCurve', 'compatCell'] },
    { id: 'ribbons', label: 'Ribbon Reactor', safe: false, geometry: ['nativeRibbon', 'compatRibbon', 'compatCurve'] }
];

const PLUGIN_BY_ID = new Map(VISUAL_EFFECT_PLUGINS.map(plugin => [plugin.id, plugin]));
const STYLE_MODES = [...BASE_STYLE_MODES, ...VISUAL_EFFECT_PLUGINS];

export const STYLE_LABELS = Object.fromEntries(STYLE_MODES.map(style => [style.id, style.label]));
export const SAFE_EFFECT_STYLES = VISUAL_EFFECT_PLUGINS
    .filter(plugin => plugin.safe !== false)
    .map(plugin => plugin.id);
export const FULL_EFFECT_STYLES = VISUAL_EFFECT_PLUGINS.map(plugin => plugin.id);
export const VISUAL_EFFECT_STYLES = [...BASE_STYLE_MODES.map(style => style.id), ...FULL_EFFECT_STYLES];
export const VISUAL_EFFECT_PICK_STYLES = FULL_EFFECT_STYLES.slice();
export const VISUAL_EFFECT_STYLE_OPTIONS = VISUAL_EFFECT_STYLES.map(value => ({
    value,
    label: STYLE_LABELS[value] || value
}));

export function getVisualEffectPlugin(id) {
    return PLUGIN_BY_ID.get(String(id || '')) || null;
}

export function describeVisualEffectStyle(id) {
    return STYLE_LABELS[id] || STYLE_LABELS.random;
}

export function visualStylePool({ includeTrailStyles = true } = {}) {
    return includeTrailStyles ? FULL_EFFECT_STYLES : SAFE_EFFECT_STYLES;
}

export function resolveRuntimeVisualStyle(configStyle = 'random', runtimeStyle = '', { fallback = 'cymatics' } = {}) {
    const configured = String(configStyle || 'random');
    const runtime = String(runtimeStyle || '');
    const style = (configured === 'random' || configured === 'adaptive') ? runtime || configured : configured;
    return FULL_EFFECT_STYLES.includes(style) || BASE_STYLE_MODES.some(mode => mode.id === style) ? style : fallback;
}

export function visualStyleHasGeometry(style, channel) {
    if (style === 'random' || style === 'adaptive') return true;
    const plugin = getVisualEffectPlugin(style);
    return !!(plugin && Array.isArray(plugin.geometry) && plugin.geometry.includes(channel));
}

export function visualStyleLikesGeometry(style) {
    if (style === 'random' || style === 'adaptive') return true;
    const plugin = getVisualEffectPlugin(style);
    return !!(plugin && Array.isArray(plugin.geometry) && plugin.geometry.length);
}

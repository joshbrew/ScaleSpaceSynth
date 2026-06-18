// Central user-facing registry for 2D / iTunes-style audio backdrop FX.
//
// To add a new 2D backdrop style:
//   1. Add one entry to AUDIO_2D_BACKDROP_PLUGINS below.
//   2. Add a matching drawer registration in render/visual-effects.worker.js
//      inside BACKDROP_STYLE_DRAWERS.
//   3. Use the same id in both places.
//
// The renderer path is worker-generated geometry uploaded to WebGPU/three.
// Do not add CanvasRenderingContext2D effects here; canvas-style effects should
// be translated into line/fill geometry functions in visual-effects.worker.js.

export const AUDIO_2D_BACKDROP_PLUGINS = [
    { id: 'rainbow',      label: 'Rainbow Ribbons',        randomWeight: 0.08, tone: 'bright' },
    { id: 'classic',      label: 'Classic Scene Roulette', randomWeight: 1.35, tone: 'mixed' },
    { id: 'auto',         label: 'Match 3D Style',         randomWeight: 0.00, tone: 'meta' },

    { id: 'sinefield',    label: 'Sine Waves',             randomWeight: 1.15, tone: 'soft' },
    { id: 'softwaves',    label: 'Soft Color Waves',       randomWeight: 3.20, tone: 'soft' },
    { id: 'silkflow',     label: 'Silk Flow',              randomWeight: 2.80, tone: 'soft' },
    { id: 'colorbursts',  label: 'Color Bursts',           randomWeight: 1.90, tone: 'soft' },
    { id: 'gradientflow', label: 'Gradient Flow',          randomWeight: 2.70, tone: 'soft' },
    { id: 'contourveil',  label: 'Contour Veils',          randomWeight: 2.55, tone: 'soft' },
    { id: 'dreamblobs',   label: 'Dream Blobs',            randomWeight: 2.55, tone: 'soft' },
    { id: 'prismadrift', label: 'Prisma Drift',           randomWeight: 2.80, tone: 'soft' },
    { id: 'jazzhaze',    label: 'Jazz Haze',              randomWeight: 2.35, tone: 'soft' },
    { id: 'opalbloom',   label: 'Opal Bloom',             randomWeight: 2.30, tone: 'soft' },
    { id: 'nebulawash',   label: 'Nebula Wash',            randomWeight: 3.10, tone: 'soft' },
    { id: 'bokehbloom',   label: 'Bokeh Bloom',            randomWeight: 2.85, tone: 'soft' },
    { id: 'chromafog',    label: 'Chroma Fog',             randomWeight: 2.70, tone: 'soft' },
    { id: 'ambientglow',  label: 'Ambient Glow',           randomWeight: 2.40, tone: 'soft' },
    { id: 'spectralmist', label: 'Spectral Mist',          randomWeight: 2.10, tone: 'soft' },

    { id: 'pasteldawn',   label: 'Pastel Dawn',            randomWeight: 1.35, tone: 'soft' },
    { id: 'pastelpetal',  label: 'Pastel Petal',           randomWeight: 1.35, tone: 'soft' },
    { id: 'pastelsorbet', label: 'Pastel Sorbet',          randomWeight: 1.35, tone: 'soft' },
    { id: 'pastelmint',   label: 'Pastel Mint',            randomWeight: 1.35, tone: 'soft' },
    { id: 'pastelseaglass', label: 'Pastel Sea Glass',     randomWeight: 1.35, tone: 'soft' },
    { id: 'pastellagoon', label: 'Pastel Lagoon',          randomWeight: 1.35, tone: 'soft' },
    { id: 'pastellilac',  label: 'Pastel Lilac',           randomWeight: 1.35, tone: 'soft' },
    { id: 'pastelorchid', label: 'Pastel Orchid',          randomWeight: 1.35, tone: 'soft' },
    { id: 'pastelrosegold', label: 'Pastel Rose Gold',     randomWeight: 1.35, tone: 'soft' },
    { id: 'pastelcitrus', label: 'Pastel Citrus',          randomWeight: 1.35, tone: 'soft' },
    { id: 'pastelfoam',   label: 'Pastel Foam',            randomWeight: 1.35, tone: 'soft' },
    { id: 'pasteltwilight', label: 'Pastel Twilight',      randomWeight: 1.35, tone: 'soft' },

    { id: 'oscilloscope', label: 'Oscilloscope',           randomWeight: 1.00, tone: 'line' },
    { id: 'spectrum',     label: 'Spectrum Bars',          randomWeight: 0.80, tone: 'line' },
    { id: 'vectorscope',  label: 'Vectorscope',            randomWeight: 1.05, tone: 'line' },
    { id: 'matrixrain',   label: 'Matrix Rain',            randomWeight: 0.85, tone: 'line' },
    { id: 'matrixcrawl',  label: 'Matrix Crawl',           randomWeight: 0.65, tone: 'line' },
    { id: 'aurora',       label: 'Aurora Curtains',        randomWeight: 1.15, tone: 'soft' },
    { id: 'cymatics',     label: 'Cymatics',               randomWeight: 1.35, tone: 'soft' },
    { id: 'rings',        label: 'Cymatic Rings',          randomWeight: 1.00, tone: 'line' },
    { id: 'sacred',       label: 'Sacred Geometry',        randomWeight: 0.55, tone: 'line' },
    { id: 'tunnel',       label: 'Tunnel',                 randomWeight: 0.55, tone: 'line' },
    { id: 'starfield',    label: 'Starfield',              randomWeight: 1.15, tone: 'line' },
    { id: 'moire',        label: 'Moire Grid',             randomWeight: 0.70, tone: 'line' },
    { id: 'cellular',     label: 'Cell Field',             randomWeight: 0.70, tone: 'line' },
    { id: 'cellfield',    label: 'Cell Field Alt',         randomWeight: 0.70, tone: 'line' },
    { id: 'honeycomb',    label: 'Honeycomb',              randomWeight: 0.70, tone: 'line' },
    { id: 'lightfield',   label: 'Light Field',            randomWeight: 1.05, tone: 'soft' },
    { id: 'trails',       label: 'Light Trails',           randomWeight: 0.85, tone: 'soft' },
];

export const AUDIO_2D_BACKDROP_STYLE_IDS = AUDIO_2D_BACKDROP_PLUGINS.map(plugin => plugin.id);

export const AUDIO_2D_BACKDROP_STYLE_OPTIONS = AUDIO_2D_BACKDROP_PLUGINS.map(plugin => ({
    value: plugin.id,
    label: plugin.label
}));

export const AUDIO_2D_RANDOM_STYLE_POOL = AUDIO_2D_BACKDROP_PLUGINS
    .filter(plugin => plugin.randomWeight > 0 && plugin.id !== 'auto')
    .flatMap(plugin => Array(Math.max(1, Math.round(plugin.randomWeight * 4))).fill(plugin.id));

export const AUDIO_2D_SOFT_STYLE_IDS = AUDIO_2D_BACKDROP_PLUGINS
    .filter(plugin => plugin.tone === 'soft')
    .map(plugin => plugin.id);

export function hasAudio2DBackdropStyle(id) {
    return AUDIO_2D_BACKDROP_STYLE_IDS.includes(String(id || ''));
}

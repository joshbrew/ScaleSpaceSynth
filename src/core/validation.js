import { PARAM_KEYS, MOD_KEYS } from '../atlas/constants.js';
import { sanitizeName } from './utils.js';
import { VISUAL_EFFECT_STYLES } from '../render/visual-style-registry.js';
import { AUDIO_2D_BACKDROP_STYLE_IDS } from '../render/audio-fx-registry.js';
import { sanitizeAudioWaypointState } from '../audio/pilot.js';

// ─── Input sanitization & validation ───────────────────────────────────────
// Trust-boundary defenses for save files, share strings, and localStorage.
//   sanitizeName(s, opts)  — coerce-to-string, strip control chars, length-cap.
//   validateWaypoint(w)    — fresh waypoint from allowlisted keys + type checks.
//                            Returns null on malformed input.
//   hydrateState(raw)      — merge into window.S using DEFAULTS as allowlist,
//                            per-type coercion. Unknown keys / bad types dropped.
// Primary XSS defense is at DOM sinks (textContent, DOM construction).
// These helpers are second-layer.
const _VALID_SHAPES = new Set(['circle', 'square', 'diamond']);
export function _isFiniteNumber(v) { return typeof v === 'number' && Number.isFinite(v); }
export function _isFiniteIntInRange(v, lo, hi) { return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi; }
export function _isFiniteNumberArray(v, len) {
    if (!Array.isArray(v) || v.length !== len) return false;
    for (let i = 0; i < len; i++) if (!_isFiniteNumber(v[i])) return false;
    return true;
}

export function validateWaypoint(w) {
    if (!w || typeof w !== 'object' || Array.isArray(w)) return null;

    const out = {
        id: typeof w.id === 'string' ? w.id.slice(0, 100) : ('wp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
        coordId: typeof w.coordId === 'string' ? w.coordId.slice(0, 50) : '',
        name: sanitizeName(w.name, { maxLen: 200 }) || 'Untitled',
        notes: sanitizeName(w.notes, { maxLen: 2000, allowNewlines: true }),
        category: sanitizeName(w.category, { maxLen: 100 }) || 'Waypoints',
        timestamp: _isFiniteNumber(w.timestamp) ? w.timestamp : Date.now(),
        isImported: !!w.isImported,
        thumbAspect: (_isFiniteNumber(w.thumbAspect) && w.thumbAspect > 0 && w.thumbAspect < 100) ? w.thumbAspect : (16 / 9),
        params: {},
        optics: {},
        camDist: (_isFiniteNumber(w.camDist) && w.camDist > 0 && w.camDist < 1e6) ? w.camDist : 300,
        camPosArr: _isFiniteNumberArray(w.camPosArr, 3) ? w.camPosArr.slice(0, 3) : [0, 0, 300],
        camQuatArr: _isFiniteNumberArray(w.camQuatArr, 4) ? w.camQuatArr.slice(0, 4) : [0, 0, 0, 1]
    };

    // Thumbnail: data URLs only, length-capped to ~2MB (toDataURL output
    // for our thumbnails sits well under this). Reject any other shape
    // — including http: URLs which could exfiltrate referer or trigger
    // mixed-content fetches.
    if (typeof w.thumbnail === 'string'
        && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(w.thumbnail)
        && w.thumbnail.length < 2_000_000) {
        out.thumbnail = w.thumbnail;
    } else {
        out.thumbnail = null;
    }

    // Params — PARAM_KEYS allowlist, finite-number values only.
    const inParams = (w.params && typeof w.params === 'object' && !Array.isArray(w.params)) ? w.params : {};
    PARAM_KEYS.forEach(k => {
        if (!_isFiniteNumber(inParams[k])) return;
        out.params[k] = (k === 'coherence') ? Math.max(0, Math.min(200, inParams[k])) : inParams[k];
    });
    if (!_isFiniteNumber(out.params.physicsEmergence)) out.params.physicsEmergence = 0;

    // Optics — explicit allowlist + per-key type rules.
    const inV = (w.optics && typeof w.optics === 'object' && !Array.isArray(w.optics)) ? w.optics : {};
    const visNumKeys = ['hue', 'sat', 'lightness', 'opacity', 'tempo', 'timeScale', 'trailLen',
                        'bgGlow', 'bgBlur', 'offsetX', 'offsetY', 'offsetZ', 'billboardOffset'];
    visNumKeys.forEach(k => { if (_isFiniteNumber(inV[k])) out.optics[k] = inV[k]; });
    if (_isFiniteIntInRange(inV.colorMode, 0, 4)) out.optics.colorMode = inV.colorMode;
    if (typeof inV.showParticles === 'boolean') out.optics.showParticles = inV.showParticles;
    if (typeof inV.showRibbons === 'boolean')   out.optics.showRibbons   = inV.showRibbons;
    if (typeof inV.tessRibbons === 'boolean')   out.optics.tessRibbons   = inV.tessRibbons;
    if (typeof inV.shape === 'string' && _VALID_SHAPES.has(inV.shape)) out.optics.shape = inV.shape;

    const audioState = sanitizeAudioWaypointState(inV.audio || w.audio || inV);
    if (audioState) out.optics.audio = audioState;

    // Mods — MOD_KEYS allowlist, finite-number values only.
    const inMods = (inV.mods && typeof inV.mods === 'object' && !Array.isArray(inV.mods)) ? inV.mods : null;
    if (inMods) {
        out.optics.mods = {};
        MOD_KEYS.forEach(k => { if (_isFiniteNumber(inMods[k])) out.optics.mods[k] = inMods[k]; });
    }

    // Future-multiplayer fields — pass through with sanitization. authorId
    // and remoteId are opaque tokens (not displayed), so just length-cap.
    // authorName and tags will be displayed, so they go through sanitizeName.
    if (typeof w.authorId === 'string')   out.authorId = w.authorId.slice(0, 50);
    if (typeof w.authorName === 'string') out.authorName = sanitizeName(w.authorName, { maxLen: 64 });
    if (Array.isArray(w.tags)) {
        out.tags = w.tags
            .filter(t => typeof t === 'string')
            .map(t => sanitizeName(t, { maxLen: 30 }))
            .filter(Boolean)
            .slice(0, 20);
    }
    if (typeof w.isShared === 'boolean') out.isShared = w.isShared;
    if (typeof w.remoteId === 'string')  out.remoteId = w.remoteId.slice(0, 50);

    return out;
}

// Allowlist of enum-valued state keys. The hydration step rejects any value
// not in the listed set, so a tampered save with `theme: '<script>...'` just
// gets the default theme instead.
const _STATE_ENUMS = {
    shape:       ['circle', 'square', 'diamond'],
    theme:       ['classic', 'synthesist'],
    buttonShape: ['hex', 'circle'],
    moveMode:    ['orbit', 'fly'],
    tourMode:    ['sequential', 'random'],
    audioSource: ['off', 'file', 'url', 'mic', 'system'],
    perfProfile: ['balanced', 'quality', 'speed', 'potato'],
    nativeComputeBackend: ['three-tsl', 'direct-webgpu', 'babylon'],
    visualEffectStyle: VISUAL_EFFECT_STYLES,
    visualEffect2DBackdropStyle: AUDIO_2D_BACKDROP_STYLE_IDS,
    compatFlowMode: ['adaptive', 'plume', 'vortex', 'sheet', 'ribbon', 'cellular', 'helix', 'cymatic', 'burst'],
    randomizerSourceMode: ['true-random', 'atlas-codes', 'both']
};

// Numeric clamps for keys where an unbounded value would actually hurt.
// freeEnergy drives a buffer allocation; everything else either flows into a
// shader uniform (which clamps in-shader) or a UI slider (clamped by the
// slider's min/max). If you add a new key whose magnitude has real-world
// cost, add it here.
const _STATE_CLAMPS = {
    freeEnergy: [0, 1_000_000],
    gpuParticleCapacity: [1_000, 1_000_000],
    visualEffectAmount: [0, 2.5],
    visualEffectQuality: [0.25, 1],
    visualEffectEcho: [0.02, 0.6],
    visualEffectAberration: [0, 1],
    visualEffectRings: [0, 1],
    visualEffectExpressivity: [0.35, 2.5],
    visualEffectDynamics: [0.25, 2.5],
    visualEffect2DFade: [0, 1],
    visualEffect2DResolutionScale: [0.25, 1],
    visualEffect3DFade: [0, 1],
    audioReactiveAmount: [0, 3],
    audioReactiveGain: [0, 16],
    audioReactiveAttack: [0.005, 0.5],
    audioReactiveRelease: [0.002, 0.25],
    audioReactiveRelaxation: [0, 2],
    audioColorBeat: [0, 3],
    audioParticleDrive: [0, 3],
    audioParticleMotionDrive: [0, 3],
    audioParticleColorDrive: [0, 3],
    randomizerChaos: [0, 1],
    coherence: [0, 200],
    zoomNearDistance: [1, 500],
    zoomFarDistance: [2, 2000],
    zoomActiveScaleMin: [0.05, 1],
    zoomPixelRatioScaleMin: [0.35, 1],
    zoomEffectScaleMin: [0.2, 1],
    zoomCompatSyncMaxEvery: [1, 8],
    zoomOverdrawActiveScaleMin: [0.05, 1],
    zoomOverdrawPixelRatioScaleMin: [0.35, 1],
    zoomOverdrawEffectScaleMin: [0.15, 1],
    zoomOverdrawLineScaleMin: [0.02, 1],
    particleCloseScaleStrength: [0, 0.95],
    particleCloseScaleNear: [1, 200],
    compatRibbonBudget: [0, 12000],
    compatCurveBudget: [0, 6000],
    compatCellBudget: [0, 6000],
    compatStructureEvery: [1, 12],
    compatStructureOpacity: [0, 1],
    compatStructureDepth: [2, 16],
    compatParticleSimMax: [1000, 150000],
    compatMotionFloor: [0, 0.20],
    visualEffectMorphRate: [0.001, 0.2],
    visualEffectMaxFrameMs: [1, 24],
    canvasResolutionScale: [0.4, 1],
    visualEffect2DBackdropMix: [0.05, 2.5],
    visualEffectBackdropWorkerMs: [8, 140],
    cameraAutoOrbitSpeed: [-5, 5],
    perfParticleScaleMin: [0.25, 1],
    perfParticleCountChunk: [1, 65536]
};

export function hydrateState(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    const defaults = window.DEFAULTS;
    if (!defaults) return;

    for (const k of Object.keys(defaults)) {
        if (!(k in raw)) continue;
        const v = raw[k];
        const d = defaults[k];

        // colorMode is the only int-valued numeric enum. typeof its default
        // is 'number' so it'd otherwise flow through the generic number
        // branch and accept e.g. 2.7. Special-case integer-and-range.
        if (k === 'colorMode') {
            if (_isFiniteIntInRange(Number(v), 0, 4)) window.S[k] = Number(v);
            continue;
        }

        if (typeof d === 'number') {
            const n = Number(v);
            if (!Number.isFinite(n)) continue;
            const clamp = _STATE_CLAMPS[k];
            window.S[k] = clamp ? Math.max(clamp[0], Math.min(clamp[1], n)) : n;
        } else if (typeof d === 'boolean') {
            // Do not hydrate compatSpriteMap from old saves. The WebGPU
            // PointsMaterial texture-map path is the known source of the
            // recurring missing-uv AttributeNode error.
            if (k === 'compatSpriteMap') { window.S[k] = false; continue; }
            if (typeof v === 'boolean') window.S[k] = v;
        } else if (typeof d === 'string') {
            const enums = _STATE_ENUMS[k];
            if (enums) {
                if (typeof v === 'string' && enums.includes(v)) window.S[k] = v;
            } else if (typeof v === 'string') {
                window.S[k] = sanitizeName(v, { maxLen: 100 });
            }
        }
        // typeof d === 'object' branch intentionally absent — the only
        // object-valued default key is homepoint, handled below via
        // validateWaypoint. Default null/undefined values fall through.
    }

    // Modulation keys (_mod suffix on each modulatable param). Not present
    // in DEFAULTS so handled separately. Bounded 0..1 in normal use; allow
    // a small headroom for legacy saves before rejecting.
    for (const k of MOD_KEYS) {
        if (!(k in raw)) continue;
        const n = Number(raw[k]);
        if (Number.isFinite(n) && n >= 0 && n <= 2) window.S[k] = n;
    }

    // Homepoint: shaped like a waypoint, so the same validator applies.
    if (raw.homepoint && typeof raw.homepoint === 'object') {
        const hp = validateWaypoint(raw.homepoint);
        if (hp) {
            hp.id = 'homepoint'; // synthetic id is the contract travelTo expects
            window.S.homepoint = hp;
        }
    }

    // In-flight runtime values must never survive a session. Strip on every
    // hydrate so a half-faded snapshot can't pin visibility next boot.
    delete window.S._xfade;
    delete window.S._xfadeEnv;
}

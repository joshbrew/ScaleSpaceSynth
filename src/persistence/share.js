import { PARAM_KEYS, MOD_KEYS, coordHash } from '../atlas/constants.js';
import { validateWaypoint } from '../core/validation.js';
import { showToast } from '../ui/toast.js';

// ─── Sharable Coordinate Strings ───────────────────────────────────────────
// Pack a waypoint into a short string for pasting into Reddit/Discord.
// Format: "SS1:<base64url(payload)>" where payload is DEFLATE-compressed
// JSON (or raw JSON for legacy decode). Decoder tries DEFLATE first,
// falls back to raw on failure.
//
// Payload fields (all optional except p, c):
//   p — params (10 sim values that ARE the coordinate)
//   v — optics (17 visual fields; if shareIncludeOptics)
//   m — modulations (subset of params being modulated)
//   c — camera
//   n — name/title (if shareIncludeTitle)
//   d — notes (if shareIncludeNotes)
//   a — author (if shareIncludeAuthor)
//
// Schema is additive — missing keys mean "don't apply." New visual fields
// can be added under v without breaking old clients. Removals/renames
// would require SS2: bump.

const SHARE_PARAM_KEYS = PARAM_KEYS;
// Visual fields that travel with a coordinate. Under DEFLATE the extra
// fields cost almost nothing and recipients get a faithful reproduction.
const SHARE_VISUAL_KEYS = [
    'opacity', 'tempo', 'trailLen',
    'showParticles', 'showRibbons', 'tessRibbons',
    'shape', 'colorMode',
    'hue', 'sat', 'lightness',
    'bgGlow', 'bgBlur',
    'offsetX', 'offsetY', 'offsetZ', 'billboardOffset'
];

function _b64urlEncode(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function _b64urlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

// DEFLATE via CompressionStream. Browser support: Chromium 80+, Firefox
// 113+, Safari 16.4+. Callers fall back to raw-JSON on unsupported.
async function _deflate(bytes) {
    const cs = new CompressionStream('deflate-raw');
    const writer = cs.writable.getWriter();
    writer.write(bytes); writer.close();
    const out = [];
    const reader = cs.readable.getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        out.push(value);
    }
    const total = out.reduce((n, c) => n + c.length, 0);
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of out) { merged.set(c, off); off += c.length; }
    return merged;
}
async function _inflate(bytes) {
    const cs = new DecompressionStream('deflate-raw');
    const writer = cs.writable.getWriter();
    writer.write(bytes); writer.close();
    const out = [];
    const reader = cs.readable.getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        out.push(value);
    }
    const total = out.reduce((n, c) => n + c.length, 0);
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of out) { merged.set(c, off); off += c.length; }
    return merged;
}

// Build the JSON payload from a waypoint + options. Pure function so we
// can also use it to compute char counts without actually committing to
// the compression step.
function _buildSharePayload(wp, opts) {
    const o = opts || {};
    const inclName    = o.includeName    !== false;
    const inclNotes   = o.includeNotes   !== false;
    const inclAuthor  = o.includeAuthor  !== false;
    const inclOptics = o.includeOptics !== false;

    // Compact representation. Round each value to its sane precision —
    // saves bytes pre-compression and removes float noise like
    // 0.30000000000000004 in the output.
    const PREC = {
        opacity: 2, hue: 3, sat: 2, lightness: 2,
        equilibrium: 3, temperature: 2, viscosity: 2, mass: 2,
        scaleDepth: 2, coherence: 0, halfLife: 1, tempo: 2,
        trailLen: 0, bgGlow: 2, bgBlur: 1,
        resolution: 2, inversion: 0, freeEnergy: 0,
        offsetX: 0, offsetY: 0, offsetZ: 0, billboardOffset: 0
    };
    const round = (k, v) => {
        if (typeof v !== 'number') return v;
        const p = PREC[k] !== undefined ? PREC[k] : 2;
        const f = Math.pow(10, p);
        return Math.round(v * f) / f;
    };

    const payload = { p: {}, c: {} };
    // Coordinate (the 10 simulation params) and camera are always included
    // — they ARE the "location." Without them the share string is empty.
    SHARE_PARAM_KEYS.forEach(k => {
        if (wp.params && wp.params[k] !== undefined) payload.p[k] = round(k, wp.params[k]);
    });
    if (wp.camDist !== undefined) payload.c.d = Math.round(wp.camDist);
    if (wp.camPosArr) payload.c.p = wp.camPosArr.map(x => Math.round(x));
    if (wp.camQuatArr) payload.c.q = wp.camQuatArr.map(x => Math.round(x * 10000) / 10000);

    if (inclOptics) {
        payload.v = {};
        SHARE_VISUAL_KEYS.forEach(k => {
            if (wp.optics && wp.optics[k] !== undefined) payload.v[k] = wp.optics[k];
        });
        const savedMods = wp.optics && wp.optics.mods ? wp.optics.mods : {};
        const m = {};
        MOD_KEYS.forEach(k => {
            if (savedMods[k] !== undefined) m[k] = round(k, savedMods[k]);
        });
        if (Object.keys(m).length > 0) payload.m = m;
    }
    if (inclName && wp.name) payload.n = wp.name;
    if (inclNotes && wp.notes) payload.d = wp.notes;
    if (inclAuthor && wp.authorName) payload.a = wp.authorName;

    return payload;
}

// Async because CompressionStream is async. Two callers in the codebase:
// importShareString (already async-friendly) and the share-builder UI
// (which awaits via Promise.then). Returns the final SS1:... string.
export async function encodeShareString(wp, opts) {
    if (!wp) return null;
    const payload = _buildSharePayload(wp, opts);
    const json = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);

    // Try DEFLATE. If the browser doesn't support CompressionStream (very
    // old, predates 2023), fall back to raw JSON inside SS1:. Both formats
    // share the same SS1: prefix; the decoder distinguishes by trying
    // inflate first and parsing on failure.
    try {
        if (typeof CompressionStream !== 'undefined') {
            const compressed = await _deflate(bytes);
            // Only ship the compressed form if it's actually shorter
            // (tiny payloads can grow under DEFLATE headers). For typical
            // waypoint payloads compressed is always smaller, but the
            // safety check keeps the fallback honest.
            if (compressed.length < bytes.length) {
                return 'SS1:' + _b64urlEncode(compressed);
            }
        }
    } catch (e) { /* fall through to raw */ }
    return 'SS1:' + _b64urlEncode(bytes);
}

// Synchronous "approximate size" estimator — used by the live char count
// in the share-builder UI without paying the cost of an async compression
// round-trip on every toggle click. The estimate compresses the JSON
// using a quick approximation (rough DEFLATE ratio); the actual generated
// string can differ by a few characters. Good enough for "is it getting
// bigger or smaller" feedback.
function _estimateShareLength(wp, opts) {
    const payload = _buildSharePayload(wp, opts);
    const json = JSON.stringify(payload);
    // Rough DEFLATE estimate for JSON-with-repeated-keys: 35-40% of
    // input size at typical waypoint complexity. Conservative side of
    // the range so the displayed number tends to overestimate by 1-3%,
    // never underestimate (avoids "wait, the real string is longer
    // than the count said").
    const compressedEst = Math.ceil(json.length * 0.40);
    // base64url overhead is ~4/3
    return 4 /* SS1: */ + Math.ceil(compressedEst * 4 / 3);
}

export async function decodeShareString(str) {
    if (typeof str !== 'string') return null;
    str = str.trim();
    if (!str.startsWith('SS1:')) return null;
    let bytes;
    try {
        bytes = _b64urlDecode(str.slice(4));
    } catch (e) { return null; }

    // Try DEFLATE first. If it succeeds, parse the inflated bytes as JSON.
    // If it fails (bytes weren't deflate-compressed — they're legacy raw
    // JSON), fall back to parsing the original bytes as JSON. Both paths
    // produce the same payload shape downstream.
    try {
        if (typeof DecompressionStream !== 'undefined') {
            const inflated = await _inflate(bytes);
            const json = new TextDecoder().decode(inflated);
            const payload = JSON.parse(json);
            if (payload && typeof payload === 'object') return payload;
        }
    } catch (e) { /* fall through to raw */ }

    try {
        const json = new TextDecoder().decode(bytes);
        const payload = JSON.parse(json);
        if (payload && typeof payload === 'object') return payload;
    } catch (e) { /* fall through to null */ }
    return null;
}

// Apply a decoded share payload by creating a new waypoint from it. Async
// because decodeShareString is now async (DEFLATE decompression is a
// stream-based API). The new waypoint preserves the original author's
// attribution if present in the payload — anyone can claim to have
// discovered any coordinate so the field is purely social, but
// preserving it lets attribution chain naturally as coordinates get
// reshared.
export async function importShareString(str) {
    const payload = await decodeShareString(str);
    if (!payload) {
        showToast('Invalid share string', { color: '#ff6d6d' });
        return null;
    }

    // Build waypoint candidate from payload, then run through validateWaypoint
    // (same validator as save-file imports). All fields are type/range checked
    // or sanitized; unknown keys dropped.
    const _camD = payload.c && payload.c.d;
    const _camQ = payload.c && payload.c.q;
    const _camP = payload.c && payload.c.p;
    // Notes: prefer shared notes, fall back to marker.
    const importedNotes = (typeof payload.d === 'string' && payload.d.length > 0)
        ? payload.d
        : 'Imported from shared coordinates';
    // Author: discoverer attribution (claim-anything, not verified).
    const importedAuthor = (typeof payload.a === 'string' && payload.a.length > 0)
        ? payload.a
        : '';
    const candidate = {
        id: 'wp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        coordId: '',
        name: typeof payload.n === 'string' ? payload.n : '',
        notes: importedNotes,
        category: window.S.lastWpCat || 'Waypoints',
        isImported: true,
        params: payload.p,
        optics: Object.assign({}, payload.v || {}, payload.m ? { mods: payload.m } : {}),
        camDist:    _camD,
        camQuatArr: _camQ,
        camPosArr:  _camP,
        timestamp: Date.now(),
        thumbnail: null,
        thumbAspect: 16 / 9,
        // authorId stays as the importer's id (this is "who has this in
        // their local waypoint list" — needed for any future per-user
        // analytics). authorName is the original synthesist if shared,
        // otherwise the importer (so the discovered-by line says something
        // sensible either way).
        authorId: window.profile?.id,
        authorName: importedAuthor || window.profile?.username || ''
    };

    const wp = validateWaypoint(candidate);
    if (!wp) {
        showToast('Invalid share string', { color: '#ff6d6d' });
        return null;
    }

    // Compute coordId from the validated params (the share string doesn't
    // carry coordId — it's derived).
    if (typeof coordHash === 'function') {
        wp.coordId = coordHash(wp.params);
    }

    // If the share string had no name, synthesize one from coordId + date.
    // (validateWaypoint defaults to 'Untitled' when name is missing.)
    if (!payload.n) {
        const d = new Date();
        const dStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        wp.name = wp.coordId + ' — ' + dStr;
    }

    window.waypoints = window.waypoints || [];
    window.waypoints.unshift(wp);
    if (window.saveWP) window.saveWP();
    if (window.applyWaypointImmediate) window.applyWaypointImmediate(wp, { reseed: true });
    else if (window.travelTo) window.travelTo(wp);
    else if (window.buildAtlasUI) window.buildAtlasUI(window.engine);
    showToast('Coordinates imported');
    return wp;
}

window.encodeShareString = encodeShareString;
window.decodeShareString = decodeShareString;
window.importShareString = importShareString;

export async function copyToClipboard(str) {
    try {
        await navigator.clipboard.writeText(str);
        return true;
    } catch (e) {
        // Fallback for older browsers / non-secure contexts
        try {
            const ta = document.createElement('textarea');
            ta.value = str;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            return true;
        } catch (e2) { return false; }
    }
}
window.copyToClipboard = copyToClipboard;

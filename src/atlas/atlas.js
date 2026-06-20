import * as THREE from 'three/webgpu';
import { sanitizeName } from '../core/utils.js';
import { makeButtonRow, makeSection } from '../ui/dom-ui.js';
import { PARAM_KEYS, MOD_KEYS, VISIBILITY_XFADE_KEYS, tour, coordHash } from './constants.js';
import { paintBackgroundLayer, downloadFullResScreenshot } from '../render/capture-render.js';
import { captureAudioWaypointState, applyAudioWaypointState } from '../audio/pilot.js';
export { PARAM_KEYS, MODULATABLE_KEYS, MOD_KEYS, VISIBILITY_XFADE_KEYS, TOUR_STOPPING_KEYS, tour, coordHash } from './constants.js';

// ────────────────────────────────────────────────────────────────────────────
//   3. Atlas
// ────────────────────────────────────────────────────────────────────────────

const pulseStyle = document.createElement('style');
pulseStyle.textContent = `
@keyframes pulseGreen {
    0% { transform: scale(1); text-shadow: 0 0 5px rgba(136, 255, 136, 0.2); color: rgba(136, 255, 136, 0.8); }
    50% { transform: scale(1.1); text-shadow: 0 0 15px rgba(136, 255, 136, 1); color: #88ff88; }
    100% { transform: scale(1); text-shadow: 0 0 5px rgba(136, 255, 136, 0.2); color: rgba(136, 255, 136, 0.8); }
}`;
document.head.appendChild(pulseStyle);

function lerpAngle(a, b, t) {
    const tau = Math.PI * 2;
    const d = ((b - a + Math.PI * 3) % tau) - Math.PI;
    return a + d * t;
}

function clamp01(v) {
    return Math.max(0, Math.min(1, Number(v) || 0));
}

// freeEnergy is a particle-count budget. Interpolating it every atlas frame
// makes active draw counts and trail budgets churn during the camera/parameter
// morph. Keep it anchored through the flight and commit it at the landing.
const ATLAS_DEFERRED_PARAM_KEYS = new Set(['freeEnergy']);

const ANIMATION_MODES = new Set(['auto', 'smooth', 'held12', 'held4']);
function normalizeAnimationMode(mode, legacyThrottle, legacyFps, fallback = 'auto', kind = 'trail') {
    const isBackdrop = kind === 'backdrop';
    const raw = String(mode || '').toLowerCase();
    if (ANIMATION_MODES.has(raw)) return isBackdrop && raw === 'held4' ? 'held12' : raw;
    if (typeof legacyThrottle === 'boolean') {
        if (!legacyThrottle) return 'smooth';
        if (isBackdrop) return 'held12';
        return (Number(legacyFps) || 12) <= 6 ? 'held4' : 'held12';
    }
    return isBackdrop && fallback === 'held4' ? 'held12' : fallback;
}
function applyAnimationMode(kind, mode) {
    const S = window.S || {};
    const m = normalizeAnimationMode(mode, undefined, undefined, 'auto', kind);
    const prefix = kind === 'backdrop' ? 'backdrop' : 'trail';
    S[prefix + 'AnimationMode'] = m;
    if (m === 'held4' && kind !== 'backdrop') {
        S[prefix + 'AnimationThrottle'] = true;
        S[prefix + 'AnimationFps'] = 4;
    } else if (m === 'held12') {
        S[prefix + 'AnimationThrottle'] = true;
        S[prefix + 'AnimationFps'] = 12;
    } else {
        S[prefix + 'AnimationThrottle'] = false;
        S[prefix + 'AnimationFps'] = 12;
    }
}
function applyAnimationModesFromOptics(v = {}) {
    if (!v || typeof v !== 'object') return;
    if (v.backdropAnimationMode !== undefined || v.backdropAnimationThrottle !== undefined) {
        applyAnimationMode('backdrop', normalizeAnimationMode(v.backdropAnimationMode, v.backdropAnimationThrottle, v.backdropAnimationFps, window.S?.backdropAnimationMode || 'auto', 'backdrop'));
    }
    if (v.trailAnimationMode !== undefined || v.trailAnimationThrottle !== undefined) {
        applyAnimationMode('trail', normalizeAnimationMode(v.trailAnimationMode, v.trailAnimationThrottle, v.trailAnimationFps, window.S?.trailAnimationMode || 'auto', 'trail'));
    }
}
function captureAnimationMode(kind) {
    const S = window.S || {};
    const prefix = kind === 'backdrop' ? 'backdrop' : 'trail';
    return normalizeAnimationMode(S[prefix + 'AnimationMode'], S[prefix + 'AnimationThrottle'], S[prefix + 'AnimationFps'], 'auto', kind);
}

export function visibilityAlphaForKey(key) {
    const xfadeKey = VISIBILITY_XFADE_KEYS[key];
    const xf = window.S && window.S._xfade;
    if (xfadeKey && xf && xf[xfadeKey] !== undefined) return clamp01(xf[xfadeKey]);
    return window.S && window.S[key] ? 1 : 0;
}

export function formatToggleState(key) {
    const alpha = visibilityAlphaForKey(key);
    if (alpha > 0.001 && alpha < 0.999) return Math.round(alpha * 100) + '%';
    return alpha >= 0.5 ? 'ON' : 'OFF';
}

export function clearVisibilityXfadeForKey(key) {
    const xfadeKey = VISIBILITY_XFADE_KEYS[key];
    if (!xfadeKey || !window.S || !window.S._xfade) return;
    delete window.S._xfade[xfadeKey];
    if (!Object.keys(window.S._xfade).some(k => window.S._xfade[k] !== undefined)) {
        delete window.S._xfade;
    }
}

// Fade a visibility toggle (showParticles / showRibbons / tessRibbons)
// instead of hard-snapping. Writes window.S._xfade[<key>] each frame;
// engine reads that as the material opacity, falling back to the boolean
// when no xfade is set. Self-cancelling — repeated toggles resume from
// current alpha, never desync.
export function fadeVisibilityKey(stateKey, fromAlpha, toAlpha, duration = 300) {
    const xfadeKey = VISIBILITY_XFADE_KEYS[stateKey];
    if (!xfadeKey) return;

    window._xfadeTimers = window._xfadeTimers || {};
    if (window._xfadeTimers[xfadeKey]) {
        cancelAnimationFrame(window._xfadeTimers[xfadeKey]);
        window._xfadeTimers[xfadeKey] = null;
    }

    // If the current xfade has a value, pick up from there instead of the
    // caller-provided fromAlpha. This makes rapid mid-fade reversals smooth.
    const xfNow = window.S && window.S._xfade && window.S._xfade[xfadeKey];
    const actualFrom = (xfNow !== undefined) ? xfNow : fromAlpha;

    if (!window.S._xfade) window.S._xfade = {};
    window.S._xfade[xfadeKey] = actualFrom;

    const start = performance.now();
    const tick = (now) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = t * t * (3 - 2 * t); // smoothstep
        if (!window.S._xfade) window.S._xfade = {}; // restore if something cleared it mid-fade
        window.S._xfade[xfadeKey] = actualFrom + (toAlpha - actualFrom) * eased;
        if (t < 1) {
            window._xfadeTimers[xfadeKey] = requestAnimationFrame(tick);
        } else {
            window._xfadeTimers[xfadeKey] = null;
            // Land on the exact target, then clear so engine reverts to
            // reading the boolean state directly (avoids stale xfade values
            // pinning visibility — the original Quanta bug class).
            window.S._xfade[xfadeKey] = toAlpha;
            clearVisibilityXfadeForKey(stateKey);
        }
    };
    window._xfadeTimers[xfadeKey] = requestAnimationFrame(tick);
}

// Animate colorMode change with a V-envelope: fade everything to 0,
// swap the discrete mode at the trough, fade back to 1. Uses a separate
// channel (window.S._xfadeEnv) so it multiplies onto any in-flight layer
// fades instead of clobbering them.
// Engine read: alpha = (xfade_layer ?? bool) * (xfadeEnv ?? 1).
// Self-cancelling — mid-envelope changes restart from current envelope.
export function fadeColorModeChange(toMode, duration = 600) {
    if (window.S.colorMode === toMode) return; // already there
    if (window._xfadeColorModeTarget === toMode && window._xfadeColorModeTimer) {
        return; // same fade already running
    }

    if (window._xfadeColorModeTimer) {
        cancelAnimationFrame(window._xfadeColorModeTimer);
        window._xfadeColorModeTimer = null;
    }
    window._xfadeColorModeTarget = toMode;

    const start = performance.now();
    let flipped = false;

    const tick = (now) => {
        const t = Math.min(1, (now - start) / duration);
        // V-envelope: ^0.7 widens the dip so it reads as a smooth dip rather
        // than a knife-edge cut. Same shape used by tour transitions for
        // colorMode flips, so user toggles feel consistent with tour optics.
        const env = Math.pow(Math.abs(2 * t - 1), 0.7);
        window.S._xfadeEnv = env;

        // Discrete mode flip at the trough. Idempotent — guard prevents
        // re-flipping if the envelope re-crosses 0.5 due to numerical jitter.
        if (!flipped && t >= 0.5) {
            window.S.colorMode = toMode;
            if (window.engine) window.engine.updateUniforms();
            if (window.refreshRadialUI) window.refreshRadialUI();
            flipped = true;
        }

        if (t < 1) {
            window._xfadeColorModeTimer = requestAnimationFrame(tick);
        } else {
            window._xfadeColorModeTimer = null;
            window._xfadeColorModeTarget = null;
            delete window.S._xfadeEnv;
            // Safety net: if for any reason we never crossed the midpoint
            // (e.g. duration was very short and rAF resolution missed t=0.5),
            // ensure the mode actually got set.
            if (!flipped) {
                window.S.colorMode = toMode;
                if (window.engine) window.engine.updateUniforms();
                if (window.refreshRadialUI) window.refreshRadialUI();
            }
            try { localStorage.setItem('ss_state', JSON.stringify(window.S)); } catch (e) {}
        }
    };
    window._xfadeColorModeTimer = requestAnimationFrame(tick);
}

export function captureParamState() {
    const params = {};
    PARAM_KEYS.forEach(k => {
        if (window.S[k] !== undefined) params[k] = window.S[k];
    });
    return params;
}

export function captureModState() {
    const mods = {};
    MOD_KEYS.forEach(k => {
        if (window.S[k] !== undefined) mods[k] = window.S[k];
    });
    return mods;
}

function buildTargetParams(toP = {}, toV = {}) {
    const params = {};
    PARAM_KEYS.forEach(k => {
        if (toP && toP[k] !== undefined) params[k] = toP[k];
        else if (toV && toV[k] !== undefined) params[k] = toV[k];
        else if (k === 'physicsEmergence') params[k] = 0;
        if (k === 'coherence' && params[k] !== undefined) params[k] = Math.max(0, Number(params[k]) || 0);
    });
    return params;
}

function buildTargetMods(toV = {}) {
    const mods = {};
    const savedMods = toV && toV.mods ? toV.mods : {};
    MOD_KEYS.forEach(k => {
        mods[k] = savedMods[k] !== undefined ? savedMods[k] : 0;
    });
    return mods;
}

function syncTransitionUI(keys = []) {
    keys.forEach(k => {
        if (window.sliderSync && window.sliderSync[k]) window.sliderSync[k](window.S[k]);
    });
    if (window.syncTogglesFromState) window.syncTogglesFromState();
    if (window.refreshRadialUI) window.refreshRadialUI();
}

function applyTransitionSideEffects(keys = []) {
    if (keys.includes('bgBlur')) {
        const bgCanvas = document.getElementById('bgGlow');
        if (bgCanvas) bgCanvas.style.filter = 'blur(' + (window.S.bgBlur ?? 40) + 'px)';
    }
}

function finiteNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function orbitAnglesFromPositionArray(posArr) {
    if (!Array.isArray(posArr) || posArr.length < 3) return null;
    const x = Number(posArr[0]) || 0;
    const y = Number(posArr[1]) || 0;
    const z = Number(posArr[2]) || 0;
    const r = Math.max(1e-6, Math.sqrt(x * x + y * y + z * z));
    return {
        yaw: Math.atan2(x, z),
        pitch: Math.asin(Math.max(-1, Math.min(1, y / r)))
    };
}

function cameraStateFromWaypoint(wp, fallbackEngine = window.engine) {
    if (!wp) return null;
    const engine = fallbackEngine || window.engine;
    const cam = engine && engine.cam ? engine.cam : null;
    const state = {
        dist: finiteNumber(wp.camDist) ?? finiteNumber(cam && cam.dist) ?? 100,
        distTarget: finiteNumber(wp.camDist) ?? finiteNumber(cam && cam.distTarget) ?? finiteNumber(cam && cam.dist) ?? 100
    };
    if (Array.isArray(wp.camPosArr) && wp.camPosArr.length === 3) state.pos = wp.camPosArr.map(v => Number(v) || 0);
    if (Array.isArray(wp.camQuatArr) && wp.camQuatArr.length === 4) state.quat = wp.camQuatArr.map((v, i) => Number(v) || (i === 3 ? 1 : 0));
    if (Number.isFinite(Number(wp.camOrbitYaw))) state.orbitYaw = Number(wp.camOrbitYaw);
    if (Number.isFinite(Number(wp.camOrbitPitch))) state.orbitPitch = Number(wp.camOrbitPitch);
    if (!Number.isFinite(state.orbitYaw) || !Number.isFinite(state.orbitPitch)) {
        const angles = orbitAnglesFromPositionArray(state.pos);
        if (angles) {
            if (!Number.isFinite(state.orbitYaw)) state.orbitYaw = angles.yaw;
            if (!Number.isFinite(state.orbitPitch)) state.orbitPitch = angles.pitch;
        }
    }
    return state;
}

function cameraStateFromTransitionCamera(cam) {
    if (!cam) return null;
    const state = {
        dist: finiteNumber(cam.dist),
        distTarget: finiteNumber(cam.distTarget),
        orbitYaw: finiteNumber(cam.orbitYaw),
        orbitPitch: finiteNumber(cam.orbitPitch)
    };
    if (cam.pos && typeof cam.pos.toArray === 'function') state.pos = cam.pos.toArray();
    if (cam.quat && typeof cam.quat.toArray === 'function') state.quat = cam.quat.toArray();
    if (cam.target && typeof cam.target.toArray === 'function') state.target = cam.target.toArray();
    return state;
}

function syncRendererCameraState(state) {
    const engine = window.engine;
    if (!engine || !state) return;
    if (typeof engine.applyCameraStateSnapshot === 'function') {
        try { engine.applyCameraStateSnapshot(state); } catch (e) {}
    }
}

function stopContinuousRandomizerForWaypointTravel() {
    const S = window.S || {};
    S.randomizerContinuous = false;
    try {
        if (typeof window.cancelRandomizerTransitions === 'function') {
            window.cancelRandomizerTransitions({ keepTransitionSec: true });
        } else if (typeof window.setContinuousRandomization === 'function') {
            window.setContinuousRandomization(false, { transitionSec: S.randomizerTransitionSec || 6.0 });
        } else {
            if (window.sliderSync && typeof window.sliderSync.randomizerContinuous === 'function') {
                window.sliderSync.randomizerContinuous(false);
            }
            if (window.syncTogglesFromState) window.syncTogglesFromState();
        }
    } catch (e) {
        S.randomizerContinuous = false;
    }
    if (window.sliderSync && typeof window.sliderSync.randomizerContinuous === 'function') {
        try { window.sliderSync.randomizerContinuous(false); } catch (e) {}
    }
    if (window.syncTogglesFromState) window.syncTogglesFromState();
}

export function saveWP() {
    try {
        localStorage.setItem('ss_waypoints', JSON.stringify({ waypoints: window.waypoints }));
    } catch (e) {
        // QuotaExceededError: base64 thumbnails blow Chrome's ~5MB localStorage
        // cap. The old code just logged and moved on, so the write never landed
        // and ALL waypoints vanished on refresh (looked saved because the
        // in-memory list still held them). Least-action fix: retry WITHOUT the
        // thumbnail blobs so the waypoints themselves persist — only the preview
        // images drop, and only when over quota. Better than losing everything.
        try {
            const slim = { waypoints: window.waypoints.map(wp => {
                const { thumbnail, ...rest } = wp; return rest;
            }) };
            localStorage.setItem('ss_waypoints', JSON.stringify(slim));
            console.warn('Waypoint storage full; saved without thumbnails.', e);
            if (window.showToast) window.showToast('\u26a0 Storage full \u2014 waypoints saved without thumbnails', { color: '#c0a070', duration: 5000 });
        } catch (e2) {
            console.error('Failed to save waypoints even without thumbnails', e2);
            if (window.showToast) window.showToast('\u26a0 Could not save waypoints \u2014 storage full', { color: '#c0a070', duration: 5000 });
        }
    }
}

export async function captureWaypoint() {
    const engine = window.engine;
    if (!engine) { console.error('[ATLAS] No engine found'); return; }

    const canvas = engine.canvas;
    // bgCanvas is no longer touched here — the background, if requested,
    // is reconstructed via paintBackgroundLayer below since the bgGlow DIV
    // can't be drawImage'd.

    // Hide developer-only overlays (reference grid) during capture so they
    // don't appear in saved thumbnails or full-res screenshots. The flag is
    // read by updateReferenceGrid each frame; we hold it across two rAFs to
    // guarantee a clean frame is drawn before we sample the canvas, then
    // clear it after both the thumb and full-res capture have read pixels.
    window._captureInProgress = true;
    if (engine.render) await engine.render();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    
    const aspect = canvas.width / canvas.height;
    const tw = 240, th = Math.round(tw / aspect);
    const tc = document.createElement('canvas');
    tc.width = tw; tc.height = th;
    const ctx = tc.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Honor Include → Background toggle. (Previously used drawImage on the
    // bgCanvas DIV — silent no-op. Now routes through paintBackgroundLayer.)
    if (window.S.includeScreenshotBg) {
        paintBackgroundLayer(ctx, tw, th);
    }
    ctx.drawImage(canvas, 0, 0, tw, th);

    const thumb = tc.toDataURL('image/png');

    if (window.S.saveOnNewWaypoint) await downloadFullResScreenshot(engine);

    // Capture complete — clear the flag so the reference grid restores
    // on the next frame.
    window._captureInProgress = false;

    const flash = document.createElement('div');
    flash.className = 'flash';
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 500);

    const params = captureParamState();
    const mods = captureModState();
    
    const optics = {
        colorMode: window.S.colorMode,
        hue: window.S.hue,
        sat: window.S.sat,
        lightness: window.S.lightness,
        opacity: window.S.opacity,
        tempo: window.S.tempo,
        // Global clock — stored as a keyed optics field (NOT in PARAM_KEYS,
        // which is positional and would shift share-string layout). Old builds
        // ignore this unknown key; new builds read it. Default 1.0 on absence.
        timeScale: (typeof window.S.timeScale === 'number' ? window.S.timeScale : 1.0),
        trailLen: window.S.trailLen,
        backdropAnimationMode: captureAnimationMode('backdrop'),
        trailAnimationMode: captureAnimationMode('trail'),
        bgGlow: window.S.bgGlow,
        bgBlur: window.S.bgBlur,
        offsetX: window.S.offsetX,
        offsetY: window.S.offsetY,
        offsetZ: window.S.offsetZ,
        billboardOffset: window.S.billboardOffset,
        showParticles: window.S.showParticles !== false,
        showRibbons:   !!window.S.showRibbons,
        tessRibbons:   !!window.S.tessRibbons,
        shape:         window.S.shape || 'circle',
        mods: mods,
        audio: captureAudioWaypointState()
    };

    const cid = coordHash(params);
    const d = new Date();
    const dStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    
    const wp = {
        id: 'wp_' + Date.now(),
        coordId: cid,
        name: cid + ' — ' + dStr,
        notes: '',
        category: window.S.lastWpCat || 'Waypoints',
        params,
        optics,
        camDist: engine.cam.dist,
        camQuatArr: engine.cam.quat.toArray(),
        camPosArr: engine.cam.pos.toArray(),
        camOrbitYaw: engine.cam.orbitYaw,
        camOrbitPitch: engine.cam.orbitPitch,
        timestamp: Date.now(),
        thumbnail: thumb,
        thumbAspect: aspect,
        // Frozen at capture time so renaming yourself doesn't rewrite the past.
        authorId:   window.profile?.id || '',
        authorName: window.profile?.username || ''
    };

    // Layer seam: let registered layers attach their own scene data to the
    // waypoint (e.g. Bioclast cymatics config) before it's stored. Plain JSON
    // fields ride along in local waypoints; unknown to old builds.
    if (window._waypointCaptureHooks) for (const h of window._waypointCaptureHooks) { try { h(wp); } catch (e) { console.error('wp capture hook', e); } }

    window.waypoints.unshift(wp);
    saveWP();
    window.atlasView = wp.id;
    if (window.buildAtlasUI) window.buildAtlasUI(engine);
    if (window.showToast) window.showToast('Waypoint created');
}

// Match current sim params against a waypoint's stored params, within
// tolerance. Camera position is not checked — the user might be circling
// to frame a tour-stop angle.
export function isAtWaypointParams(wp, tolerance = 0.001) {
    if (!wp || !wp.params) return false;
    for (const k of PARAM_KEYS) {
        if (wp.params[k] === undefined) continue;
        const cur = window.S[k];
        const tgt = wp.params[k];
        if (typeof cur !== 'number' || typeof tgt !== 'number') {
            if (cur !== tgt) return false;
            continue;
        }
        // Relative tolerance — handles float-precision roundtripping through
        // JSON/localStorage. Absolute fallback for values near zero.
        const diff = Math.abs(cur - tgt);
        const scale = Math.max(Math.abs(cur), Math.abs(tgt), 1);
        if (diff / scale > tolerance) return false;
    }
    return true;
}
window.isAtWaypointParams = isAtWaypointParams;

// Returns the id of the waypoint whose params match current state, or
// null. First match wins.
export function getCurrentWaypointId() {
    const wps = window.waypoints;
    if (!wps || !wps.length) return null;
    for (const wp of wps) {
        if (isAtWaypointParams(wp)) return wp.id;
    }
    return null;
}
window.getCurrentWaypointId = getCurrentWaypointId;

export async function captureThumbnailFor(wpId) {
    const wp = window.waypoints && window.waypoints.find(w => w.id === wpId);
    if (!wp) return;
    // Hard guard: refuse to capture if we're not actually at this waypoint's
    // parameter coordinates. Without this check, the captured thumbnail would
    // misrepresent what's stored in the waypoint — a UX disaster because the
    // atlas would lie about its own contents.
    if (!isAtWaypointParams(wp)) {
        if (window.showToast) window.showToast('Travel to this waypoint first', { color: '#ff9a40' });
        return;
    }
    const engine = window.engine;
    if (!engine) return;

    const canvas = engine.canvas;
    // bgCanvas removed — see captureWaypoint above for rationale.
    // Hide developer overlays during capture (matches captureWaypoint).
    window._captureInProgress = true;
    if (engine.render) await engine.render();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const aspect = canvas.width / canvas.height;
    const tw = 240, th = Math.round(tw / aspect);
    const tc = document.createElement('canvas');
    tc.width = tw; tc.height = th;
    const ctx = tc.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // Background: paint only when opted in. Same paintBackgroundLayer path
    // as the initial-capture and full-res screenshot flows.
    if (window.S.includeScreenshotBg) {
        paintBackgroundLayer(ctx, tw, th);
    }
    ctx.drawImage(canvas, 0, 0, tw, th);
    wp.thumbnail = tc.toDataURL('image/png');
    wp.thumbAspect = aspect;
    saveWP();

    // Mirror captureWaypoint but on the thumbnail-specific toggle: the user
    // gets a screenshot for recaptures only if "Save On New Thumbnail" is on.
    // Lets people opt into one-or-both flows without conflating them.
    if (window.S.saveOnNewThumbnail) await downloadFullResScreenshot(engine);

    window._captureInProgress = false;

    // Reuse the same flash effect as a full waypoint capture, since the
    // user pressed the same conceptual "snapshot" button.
    const flash = document.createElement('div');
    flash.className = 'flash';
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 500);

    if (window.buildAtlasUI) window.buildAtlasUI(engine);
}
window.captureThumbnailFor = captureThumbnailFor;


export function applyWaypointImmediate(wp, options = {}) {
    if (!wp) return;
    const engine = window.engine;
    if (!engine) return;

    if (window.tour && window.tour.active && typeof stopTour === 'function') stopTour();
    stopContinuousRandomizerForWaypointTravel();
    window.transition = null;
    window.S_effective = {};
    delete window.S._xfade;
    delete window.S._xfadeEnv;
    if (window._xfadeColorModeTimer) {
        cancelAnimationFrame(window._xfadeColorModeTimer);
        window._xfadeColorModeTimer = null;
        window._xfadeColorModeTarget = null;
    }

    const targetParams = buildTargetParams(wp.params, wp.optics);
    const targetMods = buildTargetMods(wp.optics);
    PARAM_KEYS.forEach(k => {
        if (targetParams[k] !== undefined) window.S[k] = targetParams[k];
    });
    MOD_KEYS.forEach(k => {
        window.S[k] = targetMods[k] !== undefined ? targetMods[k] : 0;
    });

    const v = wp.optics || {};
    if (v.showParticles !== undefined) window.S.showParticles = !!v.showParticles;
    if (v.showRibbons !== undefined) window.S.showRibbons = !!v.showRibbons;
    if (v.tessRibbons !== undefined) window.S.tessRibbons = !!v.tessRibbons;
    if (v.shape !== undefined) window.S.shape = v.shape;
    if (v.colorMode !== undefined) window.S.colorMode = v.colorMode;
    applyAnimationModesFromOptics(v);
    if (v.audio) applyAudioWaypointState(v.audio);

    const waypointCameraState = cameraStateFromWaypoint(wp, engine);
    if (waypointCameraState) {
        if (Number.isFinite(Number(waypointCameraState.dist))) {
            engine.cam.dist = Number(waypointCameraState.dist);
            engine.cam.distTarget = Number(waypointCameraState.distTarget ?? waypointCameraState.dist);
        }
        if (Array.isArray(waypointCameraState.quat) && waypointCameraState.quat.length === 4 && engine.cam.quat && engine.cam.quat.fromArray) {
            engine.cam.quat.fromArray(waypointCameraState.quat).normalize();
            const euler = new THREE.Euler().setFromQuaternion(engine.cam.quat, 'YXZ');
            engine.cam.pitch = euler.x;
            engine.cam.yaw = euler.y;
        }
        if (Array.isArray(waypointCameraState.pos) && waypointCameraState.pos.length === 3 && engine.cam.pos && engine.cam.pos.fromArray) {
            engine.cam.pos.fromArray(waypointCameraState.pos);
        }
        if (Number.isFinite(Number(waypointCameraState.orbitYaw))) engine.cam.orbitYaw = Number(waypointCameraState.orbitYaw);
        if (Number.isFinite(Number(waypointCameraState.orbitPitch))) engine.cam.orbitPitch = Number(waypointCameraState.orbitPitch);
        syncRendererCameraState(waypointCameraState);
    }

    syncTransitionUI([...PARAM_KEYS, ...MOD_KEYS, 'showParticles', 'showRibbons', 'tessRibbons', 'shape', 'colorMode', 'backdropAnimationMode', 'trailAnimationMode']);
    applyTransitionSideEffects(PARAM_KEYS);

    if (typeof engine.resizeParticles === 'function') {
        try { engine.resizeParticles(Math.round(window.S.freeEnergy), { allowStructureGrow: false, reason: 'atlas' }); } catch (e) { console.error(e); }
    }
    if (typeof engine.updateUniforms === 'function') {
        try { engine.updateUniforms(); } catch (e) { console.error(e); }
    }

    if (options.reseed !== false && typeof engine.reinitializeParticles === 'function') {
        try {
            const finalizeImportState = () => {
                try { engine.updateUniforms && engine.updateUniforms(); } catch (e) {}
                try { engine.syncCompatParticleCloud && engine.syncCompatParticleCloud(true); } catch (e) {}
            };
            const reset = engine.reinitializeParticles({ preferGpu: window.S.compatParticleFallback !== true });
            if (reset && typeof reset.then === 'function') {
                reset.then(() => {
                    finalizeImportState();
                    try { requestAnimationFrame(() => finalizeImportState()); } catch (e) {}
                }).catch(e => console.warn('[atlas] coordinate reset failed', e));
            } else {
                finalizeImportState();
            }
        } catch (e) { console.warn('[atlas] coordinate reset failed', e); }
    }
    if (engine.compatTrailHistory) {
        try {
            engine.compatTrailHistory.fill(0);
            engine.compatTrailHead = 0;
            engine.compatTrailInitialized = false;
        } catch (e) {}
    }
    if (typeof engine._hideCompatStructureLayers === 'function') {
        try { engine._hideCompatStructureLayers(); } catch (e) {}
    }

    if (window.buildAtlasUI && window.engine) window.buildAtlasUI(window.engine);
    try { localStorage.setItem('ss_state', JSON.stringify(window.S)); } catch (e) {}
}
window.applyWaypointImmediate = applyWaypointImmediate;

export function travelTo(wp) {
    if (!wp) return;
    stopContinuousRandomizerForWaypointTravel();
    // tour.speed (default 1) divides the dwell/transition time — +/- keys let
    // the user speed up or slow a running tour live. Clamped so it can't hit
    // zero (infinite) or invert.
    const spd = (window.tour && typeof window.tour.speed === 'number') ? Math.max(0.25, window.tour.speed) : 1;
    const baseDur = window.tour && window.tour.active ? 5000 + Math.random() * 3000 : 5000;
    const dur = baseDur / spd;
    startTransition(wp.params, wp.camDist, wp.camQuatArr, wp.optics, wp.camPosArr, dur, wp.camOrbitYaw, wp.camOrbitPitch);
    // Layer seam: hand the destination waypoint + transition duration to any
    // registered layers so they can restore/animate their own scene data
    // (e.g. Bioclast cymatics) in step with the param transition.
    if (window._waypointApplyHooks) for (const h of window._waypointApplyHooks) { try { h(wp, dur); } catch (e) { console.error('wp apply hook', e); } }
    // Tag the in-flight transition so the atlas can highlight the destination
    // immediately, not wait for param interpolation to complete.
    if (window.transition) window.transition.targetWpId = wp.id;
    if (window.buildAtlasUI && window.engine) window.buildAtlasUI(window.engine);
}

// Homepoint: a sticky "favorite spot" in window.S.homepoint. Reachable via
// the Home key and the Params footer button. Persists with ss_state.
export function captureHomepoint() {
    const engine = window.engine;
    if (!engine) return;
    window.S.homepoint = {
        // Tag with synthetic id so travelTo's atlas-highlight pathway treats
        // it like any other destination (no-op for the atlas list, but
        // matches the contract travelTo expects).
        id: 'homepoint',
        params: captureParamState(),
        optics: {
            colorMode: window.S.colorMode,
            hue: window.S.hue, sat: window.S.sat, lightness: window.S.lightness,
            opacity: window.S.opacity, tempo: window.S.tempo,
            trailLen: window.S.trailLen,
            backdropAnimationMode: captureAnimationMode('backdrop'),
            trailAnimationMode: captureAnimationMode('trail'),
            bgGlow: window.S.bgGlow, bgBlur: window.S.bgBlur,
            offsetX: window.S.offsetX, offsetY: window.S.offsetY, offsetZ: window.S.offsetZ,
            billboardOffset: window.S.billboardOffset,
            showParticles: window.S.showParticles !== false,
            showRibbons:   !!window.S.showRibbons,
            tessRibbons:   !!window.S.tessRibbons,
            shape:         window.S.shape || 'circle',
            mods: captureModState(),
            audio: captureAudioWaypointState()
        },
        camDist:       engine.cam.dist,
        camQuatArr:    engine.cam.quat.toArray(),
        camPosArr:     engine.cam.pos.toArray(),
        camOrbitYaw:   engine.cam.orbitYaw,
        camOrbitPitch: engine.cam.orbitPitch,
        timestamp:     Date.now()
    };
    try { localStorage.setItem('ss_state', JSON.stringify(window.S)); } catch (e) {}

    // Layer seam (same as captureWaypoint) so the homepoint also carries
    // layer scene data like cymatics config.
    if (window._waypointCaptureHooks) for (const h of window._waypointCaptureHooks) { try { h(window.S.homepoint); } catch (e) {} }
    // and Homepoint glow animations stop. Build is cheap (panel rebuild is fast).
    window._needsHomepointHint = false;
    if (window.buildUI && window.engine) window.buildUI(window.engine);

    // Same shutter flash as waypoint capture so users feel the action took.
    const flash = document.createElement('div');
    flash.className = 'flash';
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 500);

    if (window.showToast) window.showToast('Homepoint updated');
}
window.captureHomepoint = captureHomepoint;

export function travelToHomepoint() {
    const hp = window.S.homepoint;
    if (!hp) {
        if (window.showToast) window.showToast('No homepoint set — press +Homepoint to save one', { color: '#ff9a40' });
        return;
    }
    if (window.tour && window.tour.active) stopTour();
    travelTo(hp);
}
window.travelToHomepoint = travelToHomepoint;

export function startTour() {
    if (!window.waypoints || window.waypoints.length === 0) return;
    tour.active = true;
    tour.rotSpeed = 0.0005;
    // In sequential mode, if the user's live params match a saved waypoint,
    // start the tour from there (the next stop is the one after current).
    // Random mode picks any-but-current, so this hint isn't useful there.
    tour.wpIdx = -1;
    if (tour.mode === 'sequential' || tour.mode === undefined) {
        const curId = (typeof getCurrentWaypointId === 'function') ? getCurrentWaypointId() : null;
        if (curId) {
            const curIdx = window.waypoints.findIndex(w => w.id === curId);
            if (curIdx >= 0) tour.wpIdx = curIdx;
        }
    }
    if (window.refreshRadialUI) window.refreshRadialUI();
    nextTourStop();
}

export function stopTour() {
    if (!tour.active) return;
    tour.active = false;
    window.transition = null;
    // _xfade and window.transition are coupled state — tear down together
    // or stale alphas pin layer visibility past the transition.
    delete window.S._xfade;
    // Same for the colorMode envelope channel.
    if (window._xfadeColorModeTimer) {
        cancelAnimationFrame(window._xfadeColorModeTimer);
        window._xfadeColorModeTimer = null;
        window._xfadeColorModeTarget = null;
    }
    delete window.S._xfadeEnv;
    if (window._nextTourTimeout) clearTimeout(window._nextTourTimeout);
    if (window.showToast) window.showToast('Tour paused');
    if (window.buildAtlasUI) window.buildAtlasUI(window.engine);
    syncTransitionUI(['showParticles', 'showRibbons', 'tessRibbons']);
}

export function nextTourStop() {
    if (!tour.active || !window.waypoints || window.waypoints.length === 0) return;
    // Tour the ACTIVE atlas tab only (spec 8.3): step through the indices of
    // window.waypoints whose isImported matches the current tab. tour.wpIdx
    // stays a window.waypoints index, so startTour / drag-reorder / the
    // is-tour-active highlight keep working unchanged. Falls back to the whole
    // list when the active tab is empty.
    const _tab = (window.atlasTab === 'imported') ? 'imported' : 'mine';
    const _inTab = (i) => { const w = window.waypoints[i]; return w && (_tab === 'imported' ? !!w.isImported : !w.isImported); };
    let idxs = window.waypoints.map((_, i) => i).filter(_inTab);
    if (!idxs.length) idxs = window.waypoints.map((_, i) => i);
    if (tour.mode === 'random' && idxs.length > 1) {
        let nextIdx = tour.wpIdx;
        while (nextIdx === tour.wpIdx) {
            nextIdx = idxs[Math.floor(Math.random() * idxs.length)];
        }
        tour.wpIdx = nextIdx;
    } else {
        const _pos = idxs.indexOf(tour.wpIdx);
        tour.wpIdx = idxs[(_pos + 1) % idxs.length];
    }
    if (window.buildAtlasUI) window.buildAtlasUI(window.engine);
    // Scroll the active row into view AFTER the rebuild paints (next frame)
    // so .is-tour-active is on the new row before we measure it.
    requestAnimationFrame(() => {
        const activeRow = document.querySelector('#atlasBody .wp-row-card.is-tour-active');
        if (activeRow && typeof activeRow.scrollIntoView === 'function') {
            try {
                activeRow.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
            } catch (e) {
                // Some browsers reject options object; fall back to boolean form.
                activeRow.scrollIntoView(false);
            }
        }
    });
    travelTo(window.waypoints[tour.wpIdx]);
}

export function deleteWP(id) {
    if (!window.waypoints) return;
    window.waypoints = window.waypoints.filter(w => w.id !== id);
    saveWP();
    window.atlasView = 'list';
    if (window.buildAtlasUI) window.buildAtlasUI(window.engine);
}

export function showDelModal(id, name) {
    // Build via DOM construction rather than innerHTML so the waypoint name
    // can't break out of its container. Names can come from imported save
    // files / share strings, so they're untrusted at this layer.
    const ov = document.createElement('div');
    ov.className = 'modal-overlay';

    const box = document.createElement('div');
    box.className = 'modal-box';

    const p = document.createElement('p');
    p.appendChild(document.createTextNode('Delete waypoint'));
    p.appendChild(document.createElement('br'));
    const nameSpan = document.createElement('span');
    nameSpan.className = 'modal-name';
    nameSpan.textContent = '"' + sanitizeName(name, { maxLen: 200 }) + '"';
    p.appendChild(nameSpan);
    p.appendChild(document.createElement('br'));
    p.appendChild(document.createTextNode('This cannot be undone.'));
    box.appendChild(p);

    const btnRow = document.createElement('div');
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'modal-btn';
    cancelBtn.style.cssText = 'border-color:#6a7a8a;color:#99aabb';
    cancelBtn.textContent = 'Cancel';
    btnRow.appendChild(cancelBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'modal-btn';
    delBtn.style.cssText = 'border-color:#cc6666;color:#cc6666;background:rgba(30,10,10,0.5)';
    delBtn.textContent = 'Delete';
    btnRow.appendChild(delBtn);

    box.appendChild(btnRow);
    ov.appendChild(box);
    document.body.appendChild(ov);

    cancelBtn.addEventListener('click', () => ov.remove());
    delBtn.addEventListener('click', () => { ov.remove(); deleteWP(id); });
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
}

function startTransition(toP, toD, toQArr, toV, toPArr, dur = 5000, toOrbitYaw = undefined, toOrbitPitch = undefined) {
    const engine = window.engine;
    if (!engine) return;

    const targetParams = buildTargetParams(toP, toV);
    const targetMods = buildTargetMods(toV);

    const from = {
        params: {},
        mods: {},
        camDist: engine.cam.dist,
        camQuat: engine.cam.quat.clone(),
        camPos: engine.cam.pos.clone(),
        camOrbitYaw: engine.cam.orbitYaw,
        camOrbitPitch: engine.cam.orbitPitch,
        optics: {
            opacity: window.S.opacity,
            tempo: window.S.tempo,
            timeScale: (typeof window.S.timeScale === 'number' ? window.S.timeScale : 1.0),
            offsetX: window.S.offsetX || 0,
            offsetY: window.S.offsetY || 0,
            offsetZ: window.S.offsetZ || 0,
            billboardOffset: window.S.billboardOffset || 0,
            hue: window.S.hue || 0.5,
            sat: window.S.sat ?? 0.8,
            lightness: window.S.lightness ?? 0.9,
            trailLen: window.S.trailLen ?? 10,
            backdropAnimationMode: captureAnimationMode('backdrop'),
            trailAnimationMode: captureAnimationMode('trail'),
            bgGlow: window.S.bgGlow ?? 0.3,
            bgBlur: window.S.bgBlur ?? 40,
            showParticles: window.S.showParticles !== false,
            showRibbons:   !!window.S.showRibbons,
            tessRibbons:   !!window.S.tessRibbons,
            shape:         window.S.shape || 'circle',
            colorMode:     window.S.colorMode ?? 0
        }
    };
    PARAM_KEYS.forEach(k => from.params[k] = window.S[k]);
    MOD_KEYS.forEach(k => from.mods[k] = window.S[k] || 0);

    const toQ = new THREE.Quaternion();
    if (Array.isArray(toQArr) && toQArr.length === 4) toQ.fromArray(toQArr);
    else toQ.copy(engine.cam.quat);
    if (from.camQuat.dot(toQ) < 0) toQ.set(-toQ.x, -toQ.y, -toQ.z, -toQ.w);
    const toPos = new THREE.Vector3();
    if (Array.isArray(toPArr) && toPArr.length === 3) toPos.fromArray(toPArr);
    else toPos.copy(engine.cam.pos);

    const fromFlags = {
        showParticles: window.S.showParticles !== false,
        showRibbons:   !!window.S.showRibbons,
        tessRibbons:   !!window.S.tessRibbons,
        shape:         window.S.shape || 'circle',
        colorMode:     window.S.colorMode ?? 0,
        backdropAnimationMode: captureAnimationMode('backdrop'),
        trailAnimationMode:    captureAnimationMode('trail')
    };
    const toFlags = (toV) ? {
        showParticles: toV.showParticles !== undefined ? toV.showParticles : fromFlags.showParticles,
        showRibbons:   toV.showRibbons   !== undefined ? toV.showRibbons   : fromFlags.showRibbons,
        tessRibbons:   toV.tessRibbons   !== undefined ? toV.tessRibbons   : fromFlags.tessRibbons,
        shape:         toV.shape         !== undefined ? toV.shape         : fromFlags.shape,
        colorMode:     toV.colorMode     !== undefined ? toV.colorMode     : fromFlags.colorMode,
        backdropAnimationMode: toV.backdropAnimationMode !== undefined ? normalizeAnimationMode(toV.backdropAnimationMode, toV.backdropAnimationThrottle, toV.backdropAnimationFps, fromFlags.backdropAnimationMode, 'backdrop') : fromFlags.backdropAnimationMode,
        trailAnimationMode:    toV.trailAnimationMode    !== undefined ? normalizeAnimationMode(toV.trailAnimationMode, toV.trailAnimationThrottle, toV.trailAnimationFps, fromFlags.trailAnimationMode, 'trail') : fromFlags.trailAnimationMode
    } : { ...fromFlags };

    if (toV) applyAnimationModesFromOptics(toV);
    if (toV && toV.audio) applyAudioWaypointState(toV.audio);

    const fromVisibility = {
        particles: visibilityAlphaForKey('showParticles'),
        ribbons: visibilityAlphaForKey('showRibbons'),
        lattice: visibilityAlphaForKey('tessRibbons')
    };
    const toVisibility = {
        particles: toFlags.showParticles ? 1 : 0,
        ribbons: toFlags.showRibbons ? 1 : 0,
        lattice: toFlags.tessRibbons ? 1 : 0
    };

    // Keep meshes alive through the transition: showXxx = true if either
    // end wants visibility. _xfade is authoritative material.opacity; the
    // boolean just gates "render this mesh at all" for the duration.
    // toFlags values are restored at t>=1.
    window.S.showParticles = fromVisibility.particles > 0.001 || toVisibility.particles > 0.001;
    window.S.showRibbons   = fromVisibility.ribbons   > 0.001 || toVisibility.ribbons   > 0.001;
    window.S.tessRibbons   = fromVisibility.lattice   > 0.001 || toVisibility.lattice   > 0.001;
    window.S._xfade = {
        particles: fromVisibility.particles,
        ribbons:   fromVisibility.ribbons,
        lattice:   fromVisibility.lattice
    };
    window.S._shapeFlipped = false;

    syncTransitionUI(['showParticles', 'showRibbons', 'tessRibbons']);

    const targetOrbitAngles = orbitAnglesFromPositionArray(Array.isArray(toPArr) ? toPArr : null);

    window.transition = {
        from,
        fromFlags,
        fromVisibility,
        toFlags,
        toVisibility,
        to: {
            params: targetParams,
            mods: targetMods,
            camDist: toD !== undefined ? toD : engine.cam.dist,
            camQuat: toQ,
            camPos: toPos,
            camOrbitYaw: Number.isFinite(Number(toOrbitYaw)) ? Number(toOrbitYaw) : (targetOrbitAngles ? targetOrbitAngles.yaw : engine.cam.orbitYaw),
            camOrbitPitch: Number.isFinite(Number(toOrbitPitch)) ? Number(toOrbitPitch) : (targetOrbitAngles ? targetOrbitAngles.pitch : engine.cam.orbitPitch),
            optics: toV
        },
        startTime: performance.now(),
        duration: dur
    };
}

export function updateTransition() {
    if (!window.transition) return;
    const t = Math.min(1, (performance.now() - window.transition.startTime) / window.transition.duration);
    const ease = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const from = window.transition.from, to = window.transition.to;

    PARAM_KEYS.forEach(k => {
        if (ATLAS_DEFERRED_PARAM_KEYS.has(k)) return;
        if (to.params[k] !== undefined) {
          window.S[k] = from.params[k] + (to.params[k] - from.params[k]) * ease;
          if (window.sliderSync && window.sliderSync[k]) window.sliderSync[k](window.S[k]);
        }
    });
    applyTransitionSideEffects(PARAM_KEYS);

	// ─── Modulation values ──────────────────────────────────────────────────
    MOD_KEYS.forEach(k => {
        if (to.mods[k] !== undefined) {
            const fromVal = from.mods[k] || 0;
            const toVal = to.mods[k] || 0;
            window.S[k] = fromVal + (toVal - fromVal) * ease;
        }
    });

    // ─── Timescale ───────────────────────────────────────────────────────────
    // Time dilation was removed pre-release. timeScale is retained in saved
    // optics for share-string/waypoint compatibility but no longer affects
    // rendering, so it is not interpolated or applied during tours.

	// ─── Camera ─────────────────────────────────────────────────────────────
    const engine = window.engine;
    if (engine) {
        engine.cam.dist = from.camDist + (to.camDist - from.camDist) * ease;
        engine.cam.distTarget = engine.cam.dist;
        engine.cam.quat.copy(from.camQuat).slerp(to.camQuat, ease);
        engine.cam.pos.lerpVectors(from.camPos, to.camPos, ease);
        engine.cam.orbitYaw = lerpAngle(from.camOrbitYaw ?? engine.cam.orbitYaw ?? 0, to.camOrbitYaw ?? engine.cam.orbitYaw ?? 0, ease);
        engine.cam.orbitPitch = (from.camOrbitPitch ?? engine.cam.orbitPitch ?? 0) + ((to.camOrbitPitch ?? engine.cam.orbitPitch ?? 0) - (from.camOrbitPitch ?? engine.cam.orbitPitch ?? 0)) * ease;
        const euler = new THREE.Euler().setFromQuaternion(engine.cam.quat, 'YXZ');
        engine.cam.pitch = euler.x;
        engine.cam.yaw = euler.y;
        syncRendererCameraState(cameraStateFromTransitionCamera(engine.cam));
    }

	// ─── Layer Crossfade ────────────────────────────────────────────────────
    const fromFlags = window.transition.fromFlags || {};
    const toFlags   = window.transition.toFlags   || {};
    const fromVisibility = window.transition.fromVisibility || {
        particles: fromFlags.showParticles ? 1 : 0
    };
    const toVisibility = window.transition.toVisibility || {
        particles: toFlags.showParticles ? 1 : 0
    };
    const xfade = (fromVal, toVal) => fromVal + (toVal - fromVal) * ease;
    let particleOpacity = clamp01(xfade(fromVisibility.particles, toVisibility.particles));
    let ribbonsOpacity  = clamp01(xfade(fromVisibility.ribbons,   toVisibility.ribbons));
    let latticeOpacity  = clamp01(xfade(fromVisibility.lattice,   toVisibility.lattice));

    // ColorMode crossfade: multiply existing fade by V-envelope so particles
    // dip to ~0 at the discrete-mode flip (t=0.5), then recover. Applied to
    // ribbons/lattice too since they re-color by mode.
    const fromCM = (fromFlags && fromFlags.colorMode);
    const toCM   = (toFlags   && toFlags.colorMode);
    if (fromCM !== undefined && toCM !== undefined && fromCM !== toCM) {
        // ^0.7 widens the dip to ~30% at half-opacity. Pure |2t-1| too sharp.
        const env = Math.pow(Math.abs(2 * t - 1), 0.7);
        particleOpacity *= env;
        ribbonsOpacity  *= env;
        latticeOpacity  *= env;
    }

    window.S._xfade = {
        particles: particleOpacity,
        ribbons:   ribbonsOpacity,
        lattice:   latticeOpacity
    };
    // Keep meshes "logically on" while their alpha is fading; toFlags values
    // get restored at t>=1. Falling to false mid-fade would cull the mesh
    // and break the visual transition.
    window.S.showParticles = particleOpacity > 0.001 || !!toFlags.showParticles;
    window.S.showRibbons   = ribbonsOpacity  > 0.001 || !!toFlags.showRibbons;
    window.S.tessRibbons   = latticeOpacity  > 0.001 || !!toFlags.tessRibbons;
    syncTransitionUI(['showParticles', 'showRibbons', 'tessRibbons']);

    // Discrete visual switch at midpoint.
    if (!window.transition._discreteFlipped && t >= 0.5) {
        if (toFlags.shape && toFlags.shape !== window.S.shape) {
            window.S.shape = toFlags.shape;
            if (window.sliderSync && window.sliderSync.shape) window.sliderSync.shape(window.S.shape);
        }
        if (toFlags.colorMode !== undefined && toFlags.colorMode !== window.S.colorMode) {
            window.S.colorMode = toFlags.colorMode;
        }
        window.transition._discreteFlipped = true;
        syncTransitionUI(['shape', 'colorMode']);
    }

    if (t >= 1) {
        PARAM_KEYS.forEach(k => {
            if (to.params[k] !== undefined) {
                window.S[k] = to.params[k];
                if (window.sliderSync && window.sliderSync[k]) window.sliderSync[k](window.S[k]);
            }
        });
        MOD_KEYS.forEach(k => {
            if (to.mods[k] !== undefined) window.S[k] = to.mods[k];
        });
        if (toFlags) {
            window.S.showParticles = toFlags.showParticles;
            window.S.showRibbons   = toFlags.showRibbons;
            window.S.tessRibbons   = toFlags.tessRibbons;
            if (toFlags.shape !== undefined) window.S.shape = toFlags.shape;
            if (toFlags.colorMode !== undefined) window.S.colorMode = toFlags.colorMode;
            if (toFlags.backdropAnimationMode !== undefined) applyAnimationMode('backdrop', toFlags.backdropAnimationMode);
            if (toFlags.trailAnimationMode !== undefined) applyAnimationMode('trail', toFlags.trailAnimationMode);
        }
        delete window.S._xfade;
        window.transition = null;
        const settledAt = performance.now ? performance.now() : Date.now();
        // Continuous RNG should inherit this landed freeEnergy budget, not kick
        // a random target on the same frame as atlas cleanup. _isAtlasTraveling
        // watches this settle window before the next continuous roll.
        window.SS_ATLAS_SETTLED_AT = settledAt;
        window.SS_ATLAS_RANDOMIZER_SETTLE_UNTIL = settledAt + 900;
        // First continuous RNG rolls after atlas should be param/uniform-only.
        // That prevents a waypoint->random handoff from waking a cold trail,
        // lattice, point-mode, or FX render path and forcing WebGPU/TSL builds
        // during the visible transition.
        window.SS_ATLAS_RANDOMIZER_UNIFORM_ONLY_ROLLS = Math.max(2, Math.floor(Number(window.SS_ATLAS_RANDOMIZER_UNIFORM_ONLY_ROLLS) || 0));

        const finalSyncKeys = [...PARAM_KEYS, 'showParticles', 'showRibbons', 'tessRibbons', 'shape', 'colorMode', 'backdropAnimationMode', 'trailAnimationMode'];
        applyTransitionSideEffects(PARAM_KEYS);
        try { localStorage.setItem('ss_state', JSON.stringify(window.S)); } catch (e) {}

        const finalizeAtlasLanding = () => {
            if (window.engine && typeof window.engine.resizeParticles === 'function') {
                try { window.engine.resizeParticles(Math.round(window.S.freeEnergy), { allowStructureGrow: false, reason: 'atlas' }); } catch (e) { console.error(e); }
            }
            if (window.engine && typeof window.engine.updateUniforms === 'function') {
                try { window.engine.updateUniforms(); } catch (e) { console.error(e); }
            }
            syncTransitionUI(finalSyncKeys);
            // Atlas highlight resolution: during the transition the targetWpId
            // drove the highlight; now that transition is null, the atlas needs
            // to re-evaluate against isAtWaypointParams. Rebuild off the landing
            // frame so it cannot hitch the visual transition/rng handoff.
            if (window.buildAtlasUI && window.engine) window.buildAtlasUI(window.engine);
        };
        try {
            requestAnimationFrame(() => requestAnimationFrame(finalizeAtlasLanding));
        } catch (e) {
            setTimeout(finalizeAtlasLanding, 32);
        }
        if (tour.active) {
            if (window._nextTourTimeout) clearTimeout(window._nextTourTimeout);
            window._nextTourTimeout = setTimeout(nextTourStop, 500);
        }
    }
}

function getCategories() {
    const c = new Set(['Waypoints']);
    window.waypoints.forEach(w => { if (w.category) c.add(w.category); });
    return [...c].sort();
}

export function buildAtlasUI(engine) {
    const panel = document.getElementById('panelAtlas');
    if (!panel) return;
    const body = document.getElementById('atlasBody');
    if (!body) return;

    const h = panel.querySelector('.panel-head');
    if (h) {
        const hText = h.querySelector('span');
        if (hText) {
            let add = hText.querySelector('.add-wp-btn');
            if (!add) {
                add = document.createElement('span');
                add.className = 'add-wp-btn';
                add.title = 'Capture Waypoint (Ctrl+S)';
                add.textContent = '+waypoint';
                add.style.cssText = 'font-weight:bold;margin-left:6px;font-size:10px;text-transform:uppercase;cursor:pointer;';
                add.addEventListener('mousedown', e => e.stopPropagation());
                add.addEventListener('click', captureWaypoint);
                hText.appendChild(add);
            }
            if (window.waypoints && window.waypoints.length === 0) {
                add.style.animation = 'pulseGreen 1.5s infinite';
                add.style.color = '#88ff88';
            } else {
                add.style.animation = 'none';
                add.style.color = '';  // fall back to themeable .add-wp-btn color
            }
        }
    }

    // Preserve scroll position across rebuilds (which happen on every tour
    // step, drag-drop, and capture). Body is the .panel-body itself, so
    // scrollbar sits at the panel edge like every other panel.
    const prevScroll = body.scrollTop;
    // Detail view should always open at the top; only the LIST preserves
    // scroll across rebuilds (tour step / drag-drop / capture).
    const _isDetailView = (typeof window.atlasView === 'string' && window.atlasView !== 'list');

    body.innerHTML = '';
    body.style.display = '';
    body.style.flexDirection = '';

    // listContainer aliases body — kept to avoid renaming every appendChild below.
    const listContainer = body;

    // Restore after children populate. Browsers clamp to content size.
    requestAnimationFrame(() => { body.scrollTop = _isDetailView ? 0 : prevScroll; });

    if (typeof window.atlasView === 'string' && window.atlasView !== 'list') {
        const wp = window.waypoints.find(w => w.id === window.atlasView);
        if (!wp) { window.atlasView = 'list'; buildAtlasUI(engine); return; }

        const bk = document.createElement('div');
        // Sticky "Back to Atlas" link — pinned to top of the scrolling
        // detail view so it's always reachable.
        bk.className = 'wp-back';
        bk.style.cssText = 'font-size:9px;cursor:pointer;margin-bottom:8px;display:inline-block;position:sticky;top:0;padding:6px 0 10px;margin-top:-6px;z-index:5;';
        bk.textContent = '\u25c2 Back to Atlas';
        bk.addEventListener('click', () => { window.atlasView = 'list'; buildAtlasUI(engine); });
        listContainer.appendChild(bk);

        // Thumbnail frame — handles both states (has thumb / no thumb yet)
        // and exposes a hover-revealed Capture button so users can replace
        // imported placeholders or refresh existing thumbnails.
        const tf = document.createElement('div');
        tf.className = 'thumb-frame' + (wp.thumbnail ? '' : ' is-empty');
        tf.style.cssText = 'position:relative;width:100%;border-radius:4px;margin-bottom:8px;border:1px solid rgba(40,40,70,0.5);overflow:hidden;aspect-ratio:16/9;background:rgba(8,8,16,0.5);';

        if (wp.thumbnail) {
            const im = document.createElement('img');
            im.src = wp.thumbnail;
            im.style.cssText = 'display:block;width:100%;height:100%;object-fit:cover;';
            tf.appendChild(im);
        } else {
            const ph = document.createElement('div');
            ph.className = 'thumb-placeholder';
            ph.style.cssText = 'display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:rgba(138,184,232,0.35);font-size:48px;font-weight:300;font-family:inherit;';
            ph.textContent = '?';
            tf.appendChild(ph);
        }

        const capBtn = document.createElement('div');
        capBtn.className = 'thumb-capture-btn';
        capBtn.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(8,8,20,0.65);font-size:10px;letter-spacing:0.12em;text-transform:uppercase;opacity:0;transition:opacity 200ms ease;padding:0 12px;text-align:center;line-height:1.4;';
        tf.appendChild(capBtn);
        
        // Button state depends on whether the user is actually at this
        // waypoint's parameter coordinates. If they are, capture is enabled.
        // If not, the button explains why and prompts them to travel first.
        // Refresh runs on hover so the state stays accurate as params change.
        function refreshCapBtnState() {
            const atLocation = isAtWaypointParams(wp);
            if (atLocation) {
                capBtn.style.color = '#cce6ff';
                capBtn.style.cursor = 'pointer';
                capBtn.textContent = wp.thumbnail ? 'Recapture Thumbnail' : 'Capture Thumbnail';
                capBtn.dataset.enabled = '1';
            } else {
                capBtn.style.color = '#7a8a99';
                capBtn.style.cursor = 'not-allowed';
                capBtn.textContent = 'Travel here first to capture';
                capBtn.dataset.enabled = '0';
            }
        }
        refreshCapBtnState();
        
        capBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (capBtn.dataset.enabled !== '1') return;
            await captureThumbnailFor(wp.id);
        });
        // Empty thumbnails: button visible from the start so the user
        // sees there's a way to populate it. Filled thumbnails: hover only.
        if (!wp.thumbnail) {
            capBtn.style.opacity = '1';
            capBtn.style.background = 'rgba(8,8,20,0.45)';
        }
        tf.addEventListener('mouseenter', () => {
            refreshCapBtnState();
            capBtn.style.opacity = '1';
        });
        tf.addEventListener('mouseleave', () => {
            if (wp.thumbnail) capBtn.style.opacity = '0';
        });

        listContainer.appendChild(tf);

        // ─── Header row: name (editable, left) + travel button (right) ────
        const hdrRow = document.createElement('div');
        hdrRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:8px;';
        const cn = document.createElement('input');
        cn.className = 'wp-edit';
        cn.style.cssText = 'flex:1;min-width:0;font-size:13px;font-weight:bold;color:#e6f0fa;';
        cn.value = wp.name;
        cn.addEventListener('change', e => { wp.name = e.target.value; saveWP(); });
        hdrRow.appendChild(cn);

        // Travel button — airplane glyph, stops active tour before traveling.
        const travelBtn = document.createElement('div');
        travelBtn.className = 'wp-travel-hdr';
        travelBtn.title = 'Travel to this location';
        travelBtn.textContent = '\u2708';
        travelBtn.addEventListener('click', () => {
            if (tour.active) stopTour();
            travelTo(wp);
        });
        hdrRow.appendChild(travelBtn);
        listContainer.appendChild(hdrRow);

        // Discovered-by line — brand-color "discovered by" + white name.
        // Falls back to 'Synthesist' role when authorName is empty.
        const discoBy = document.createElement('div');
        discoBy.className = 'wp-discoby';
        discoBy.style.cssText = 'font-size:9px;letter-spacing:0.05em;margin-top:-4px;margin-bottom:12px;';
        const discoLabel = document.createElement('span');
        discoLabel.className = 'wp-discoby-label';
        discoLabel.textContent = 'discovered by ';
        const discoNameEl = document.createElement('span');
        discoNameEl.className = 'wp-discoby-name';
        discoNameEl.textContent = sanitizeName(wp.authorName, { maxLen: 64 }) || 'Synthesist';
        discoBy.appendChild(discoLabel);
        discoBy.appendChild(discoNameEl);
        listContainer.appendChild(discoBy);

        // ─── Notes (description) ──────────────────────────────────────────
        const desc = document.createElement('textarea');
        desc.className = 'wp-edit wp-notes-area';
        desc.style.cssText = 'font-size:10px;height:60px;';
        desc.placeholder = 'Observation notes';
        desc.value = wp.notes || '';
        desc.addEventListener('change', e => { wp.notes = e.target.value; saveWP(); });
        listContainer.appendChild(desc);

        // ─── Share Coordinates ────────────────────────────────────────────
        // Live-updating share-code builder. Toggle inclusion of title/notes/
        // author/optics; the section subhead shows live character count.
        // All four toggles persist across sessions via window.S.shareInclude*
        // and are shared with the quick-share button on each waypoint card.
        const shareWrap = document.createElement('div');
        shareWrap.style.cssText = 'margin-top:14px;';
        listContainer.appendChild(shareWrap);

        // shareSubEl reference held for live char count updates.
        const shareHdr = makeSection(shareWrap, 'Share Coordinates', '… characters');
        const shareSubEl = shareHdr.querySelector('.section-sub');

        // Multi-select pills (not tabs) — any combination can be on.
        const shareToggles = makeButtonRow(shareWrap, [
            { label: 'Title',       key: 'shareIncludeTitle'    },
            { label: 'Notes',      key: 'shareIncludeNotes'   },
            { label: 'Author', key: 'shareIncludeAuthor'  },
            { label: 'Optics',    key: 'shareIncludeOptics' }
        ]);

        // Share string display + overlaid copy button (top-right corner of
        // the field). Field is user-selectable so manual copy also works.
        const shareWrapper = document.createElement('div');
        shareWrapper.style.cssText = 'position:relative;margin-top:8px;';
        shareWrap.appendChild(shareWrapper);

        const shareStrEl = document.createElement('div');
        shareStrEl.style.cssText = 'font-family:monospace,"Courier New";font-size:9px;color:#cce6ff;background:rgba(8,8,16,0.7);border:1px solid rgba(40,40,70,0.6);padding:8px 56px 8px 8px;border-radius:3px;word-break:break-all;line-height:1.4;user-select:text;-webkit-user-select:text;';
        shareWrapper.appendChild(shareStrEl);

        const copyBtn = document.createElement('div');
        copyBtn.className = 'btn';
        // Solid bg + z-index so "Copied!" feedback stays above the string.
        copyBtn.style.cssText = 'position:absolute;top:19px;right:4px;cursor:pointer;color:#cce6ff;padding:3px 8px;font-size:8px;letter-spacing:0.06em;border-radius:2px;z-index:2;background:rgba(8,8,16,0.92);';
        copyBtn.textContent = 'Copy';
        shareWrapper.appendChild(copyBtn);

        // Cached so Copy doesn't re-encode.
        let _currentShareStr = '';

        const buildShareOpts = () => ({
            includeName:    window.S.shareIncludeTitle    !== false,
            includeNotes:   window.S.shareIncludeNotes   !== false,
            includeAuthor:  window.S.shareIncludeAuthor  !== false,
            includeOptics: window.S.shareIncludeOptics !== false
        });

        // Token-guarded async update — only the most recent call's result
        // lands in the UI, so rapid toggle storms can't show stale strings.
        let _shareUpdateToken = 0;
        const refreshShareString = async () => {
            const token = ++_shareUpdateToken;
            const opts = buildShareOpts();
            const str = await window.encodeShareString(wp, opts);
            if (token !== _shareUpdateToken) return; // stale; a newer call superseded us
            _currentShareStr = str || '';
            shareStrEl.textContent = _currentShareStr;
            if (shareSubEl) shareSubEl.textContent = _currentShareStr.length + ' characters';
        };
        refreshShareString();

        // Register so toggles trigger refresh via _toggleUpdaters dispatch.
        window._toggleUpdaters = window._toggleUpdaters || {};
        ['shareIncludeTitle', 'shareIncludeNotes', 'shareIncludeAuthor', 'shareIncludeOptics'].forEach(k => {
            if (!window._toggleUpdaters[k]) window._toggleUpdaters[k] = new Set();
            window._toggleUpdaters[k].add(refreshShareString);
        });

        copyBtn.addEventListener('click', async () => {
            if (!_currentShareStr) {
                // Ensure we have a string even if the user clicks Copy
                // before the first encodeShareString promise resolved
                // (extremely fast race; defensive only).
                await refreshShareString();
            }
            const ok = await window.copyToClipboard(_currentShareStr);
            copyBtn.textContent = ok ? 'Copied!' : 'Failed';
            setTimeout(() => copyBtn.textContent = 'Copy', 1500);
        });

        // ─── Delete link ──────────────────────────────────────────────────
        const delLk = document.createElement('div');
        delLk.style.cssText = 'color:#bb6666;font-size:8px;cursor:pointer;text-decoration:underline;margin-top:16px;margin-bottom:8px;text-align:center;';
        delLk.textContent = 'delete waypoint';
        delLk.addEventListener('click', () => showDelModal(wp.id, wp.name));
        listContainer.appendChild(delLk);
    } else {
        // ── Mine / Imported tabs ──────────────────────────────────────────
        // 'Mine' = the user's own captures (no isImported). 'Imported' =
        // anything that arrived from outside (file import or build-time
        // playlist). The single window.waypoints array is filtered by the flag.
        if (window.atlasTab !== 'mine' && window.atlasTab !== 'imported') {
            try { window.atlasTab = localStorage.getItem('ss_atlas_tab') || 'mine'; }
            catch (e) { window.atlasTab = 'mine'; }
        }
        const activeTab = (window.atlasTab === 'imported') ? 'imported' : 'mine';
        const inTab = (w) => activeTab === 'imported' ? !!w.isImported : !w.isImported;
        const tabWps = (window.waypoints || []).filter(inTab);
        const mineCount = (window.waypoints || []).filter(w => !w.isImported).length;
        const impCount  = (window.waypoints || []).filter(w => !!w.isImported).length;

        const tabBar = document.createElement('div');
        tabBar.className = 'cfg-tab-bar';   // same styling as the Config panel tabs
        [['mine', 'Mine', mineCount], ['imported', 'Imported', impCount]].forEach(([key, label, count]) => {
            const on = (activeTab === key);
            const t = document.createElement('div');
            t.className = 'cfg-tab';
            t.dataset.active = on ? 'true' : 'false';
            t.textContent = label + '  ' + count;
            t.addEventListener('click', () => {
                if (window.atlasTab === key) return;
                window.atlasTab = key;
                try { localStorage.setItem('ss_atlas_tab', key); } catch (e) {}
                window.atlasView = 'list';
                buildAtlasUI(engine);
            });
            // Drop a waypoint card onto a tab to move it across (drag an
            // Imported card onto Mine to "adopt" it; the flag flips, no copy).
            t.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; t.style.background = 'rgba(80,220,255,0.18)'; });
            t.addEventListener('dragleave', () => { t.style.background = ''; });
            t.addEventListener('drop', (e) => {
                e.preventDefault();
                t.style.background = '';
                const sourceId = e.dataTransfer.getData('text/plain');
                const w = (window.waypoints || []).find(x => x.id === sourceId);
                if (!w) return;
                const wantImported = (key === 'imported');
                if (!!w.isImported === wantImported) return;   // already in this tab
                w.isImported = wantImported;
                saveWP();
                if (window.showToast) window.showToast(wantImported ? 'Moved to Imported' : 'Adopted into Mine', { color: '#8ab8e8' });
                buildAtlasUI(engine);
            });
            tabBar.appendChild(t);
        });
        listContainer.appendChild(tabBar);

        const importSect = document.createElement('div');
        importSect.style.cssText = 'display:flex;gap:4px;margin-bottom:10px;align-items:stretch;';
        const importInput = document.createElement('input');
        importInput.type = 'text';
        importInput.placeholder = 'Paste SS1:... share string';
        importInput.className = 'wp-edit';
        importInput.style.cssText = 'flex:1;font-size:9px;';
        const importBtn = document.createElement('div');
        importBtn.className = 'btn';
        importBtn.style.cssText = 'cursor:pointer;padding:0 12px;margin:0;font-size:8px;display:flex;align-items:center;justify-content:center;';
        importBtn.textContent = 'Import';
        const doImport = () => {
            const v = importInput.value.trim();
            if (!v) return;
            if (typeof window.importShareString === 'function') window.importShareString(v);
            importInput.value = '';
        };
        importBtn.addEventListener('click', doImport);
        importInput.addEventListener('keydown', e => { if (e.key === 'Enter') doImport(); });
        importSect.appendChild(importInput);
        importSect.appendChild(importBtn);
        listContainer.appendChild(importSect);

        const cats = tabWps.length
            ? (() => { const c = new Set(['Waypoints']); tabWps.forEach(w => { if (w.category) c.add(w.category); }); return [...c].sort(); })()
            : [];
        if (!tabWps.length) {
            const empty = document.createElement('div');
            empty.style.cssText = 'color:#6a7a89;font-size:9px;text-align:center;padding:24px 8px;line-height:1.5;';
            empty.textContent = (activeTab === 'imported')
                ? 'No imported destinations yet.'
                : 'No waypoints yet \u2014 capture one with +Waypoint.';
            listContainer.appendChild(empty);
        }
        let _atlasFirstSection = true;
        cats.forEach(cat => {
            const wps = tabWps.filter(w => (w.category || 'Waypoints') === cat);
            if (wps.length === 0 && cat !== 'Waypoints') return;
            // Atlas category header — raw flex (not makeSection) because the
            // count sits inline with the label. textContent only since `cat`
            // can come from imported waypoints (untrusted).
            const ch = document.createElement('div');
            ch.style.cssText = 'display:flex;align-items:baseline;gap:6px;color:#d9edf6;font-size:11px;letter-spacing:0.04em;margin-top:14px;margin-bottom:6px;';
            const chLabel = document.createElement('span');
            chLabel.textContent = cat;
            ch.appendChild(chLabel);
            const cnt = document.createElement('span');
            cnt.className = 'wp-cat-count';
            cnt.style.cssText = 'font-size:8px;letter-spacing:0.05em;';
            cnt.textContent = '(' + wps.length + ')';
            ch.appendChild(cnt);
            // First header sits under Import — trim top margin.
            if (_atlasFirstSection) {
                ch.style.marginTop = '4px';
                _atlasFirstSection = false;
            }
            listContainer.appendChild(ch);
            
            wps.forEach(wp => {
                const cd = document.createElement('div');
                cd.className = 'wp-row-card';
                cd.draggable = true;
                cd.dataset.wpid = wp.id;
                
                const isTourTarget = tour.active &&
                    window.waypoints[tour.wpIdx] &&
                    window.waypoints[tour.wpIdx].id === wp.id;
                if (isTourTarget) cd.classList.add('is-tour-active');
                // "You are here" — during in-flight travel, targetWpId
                // signals intent before params finish interpolating.
                const inFlightTargetId = window.transition && window.transition.targetWpId;
                const isCurrent = inFlightTargetId
                    ? (inFlightTargetId === wp.id)
                    : isAtWaypointParams(wp);
                if (!isTourTarget && isCurrent) cd.classList.add('is-current');
                
                cd.style.cssText = 'display:flex;padding:6px;margin-bottom:2px;border:1px solid transparent;border-bottom:1px solid rgba(40,40,70,0.3);cursor:grab;border-radius:3px;transition:background 0.2s, box-shadow 0.2s, border-color 0.2s;';
                
                cd.addEventListener('dragstart', e => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', wp.id);
                    cd.style.opacity = '0.4';
                });
                cd.addEventListener('dragend', () => {
                    cd.style.opacity = '1';
                    listContainer.querySelectorAll('.wp-row-card').forEach(el => {
                        el.style.borderTop = '';
                        el.style.borderBottom = '1px solid rgba(40,40,70,0.3)';
                    });
                });
                cd.addEventListener('dragover', e => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    listContainer.querySelectorAll('.wp-row-card').forEach(el => {
                        el.style.borderTop = '';
                    });
                    cd.style.borderTop = '2px solid #6dffb0';
                });
                cd.addEventListener('drop', e => {
                    e.preventDefault();
                    const sourceId = e.dataTransfer.getData('text/plain');
                    if (!sourceId || sourceId === wp.id) return;
                    const fromIdx = window.waypoints.findIndex(w => w.id === sourceId);
                    const toIdx   = window.waypoints.findIndex(w => w.id === wp.id);
                    if (fromIdx < 0 || toIdx < 0) return;
                    const [moved] = window.waypoints.splice(fromIdx, 1);
                    const newToIdx = window.waypoints.findIndex(w => w.id === wp.id);
                    window.waypoints.splice(newToIdx, 0, moved);
                    saveWP();
                    if (tour.active && window.waypoints[tour.wpIdx]) {
                        const curId = window.waypoints[tour.wpIdx].id;
                        tour.wpIdx = window.waypoints.findIndex(w => w.id === curId);
                    }
                    buildAtlasUI(engine);
                });
                
                if (wp.thumbnail) {
                    const ig = document.createElement('img');
                    ig.src = wp.thumbnail;
                    // Pointer cursor here = "click to open detail"; the card
                    // body keeps its grab cursor for the drag-reorder action.
                    ig.style.cssText = 'width:60px;height:40px;object-fit:cover;border-radius:2px;margin-right:8px;border:1px solid rgba(40,40,70,0.4);background:transparent;cursor:pointer';
                    ig.addEventListener('click', e => { e.stopPropagation(); window.atlasView = wp.id; buildAtlasUI(engine); });
                    cd.appendChild(ig);
                } else {
                    const ph = document.createElement('div');
                    ph.style.cssText = 'width:60px;height:40px;border-radius:2px;margin-right:8px;border:1px dashed rgba(80,120,160,0.4);background:rgba(8,8,16,0.5);display:flex;align-items:center;justify-content:center;color:rgba(138,184,232,0.5);font-size:18px;font-weight:300;cursor:pointer';
                    ph.textContent = '?';
                    ph.addEventListener('click', e => { e.stopPropagation(); window.atlasView = wp.id; buildAtlasUI(engine); });
                    cd.appendChild(ph);
                }

                const inf = document.createElement('div');
                inf.style.cssText = 'flex:1;min-width:0';
                const nm = document.createElement('div');
                nm.style.cssText = 'font-size:10px;color:#bbccdd;font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer';
                nm.textContent = wp.name;
                nm.addEventListener('click', e => { e.stopPropagation(); window.atlasView = wp.id; buildAtlasUI(engine); });
                inf.appendChild(nm);
                cd.appendChild(inf);

                const goBtn = document.createElement('div');
                goBtn.className = 'wp-plane';
                goBtn.style.cssText = 'font-size:12px;margin-left:4px;width:22px;height:18px;display:flex;align-items:center;justify-content:center;align-self:center;cursor:pointer;';
                goBtn.textContent = '\u2708';
                goBtn.addEventListener('click', e => { e.stopPropagation(); if (tour.active) stopTour(); travelTo(wp); });
                cd.appendChild(goBtn);

                const delBtn = document.createElement('div');
                delBtn.className = 'wp-del-btn';
                delBtn.style.cssText = 'color:#5f6770;font-size:13px;margin-left:4px;width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;align-self:center;padding-top:1px;box-sizing:border-box;cursor:pointer;font-weight:bold;background:#11161f;border:1px solid rgba(217,237,246,0.16);transition:background 120ms ease,color 120ms ease,border-color 120ms ease;';
                delBtn.textContent = '\u00d7';
                delBtn.addEventListener('click', e => { e.stopPropagation(); showDelModal(wp.id, wp.name); });
                cd.appendChild(delBtn);

                // No card-wide click handler — the name and thumbnail are the
                // explicit click-through affordances (each has its own listener).
                // The card body keeps the grab cursor for drag-to-reorder.
                listContainer.appendChild(cd);
            });
        });

        if (window.waypoints.length === 0) {
            const em = document.createElement('div');
            em.style.cssText = 'font-size:9px;color:#6a7a8a;padding:12px 0;text-align:center';
            em.textContent = 'Press Ctrl+S to capture a waypoint';
            listContainer.appendChild(em);
        }
    }

    // Footer content varies by view + tour state:
    //   • List view: Sequence/Random toggles + Start/Pause Tour
    //   • Detail + tour active: Stop Tour
    //   • Detail + no tour: empty (collapses via :empty CSS rule)
    // Lives in #atlasFooter outside the scroll container so the scrollbar
    // doesn't shift it.
    const footerEl = document.getElementById('atlasFooter');
    if (footerEl) {
        footerEl.innerHTML = '';
        const onListView = (window.atlasView === 'list' || !window.atlasView);
        if (onListView) {
            if (window.waypoints && window.waypoints.length > 0) {
                const modeRow = document.createElement('div');
                footerEl.appendChild(modeRow);
                if (typeof window.makeGroupToggles === 'function') window.makeGroupToggles(modeRow, [
                    { label: 'Sequence', key: 'tourMode', matchVal: 'sequential', cb: () => { tour.mode = 'sequential'; } },
                    { label: 'Random',   key: 'tourMode', matchVal: 'random',     cb: () => { tour.mode = 'random'; } }
                ]);

                const tbtn = document.createElement('div');
                tbtn.className = 'tour-go-btn' + (tour.active ? ' active' : '');
                tbtn.style.cssText = 'font-weight:600;font-size:10px;padding:9px;border-radius:3px;cursor:pointer;text-transform:uppercase;letter-spacing:2px;transition:all 200ms ease;text-align:center;margin-top:8px;';
                tbtn.textContent = tour.active ? 'Pause Tour' : 'Start Tour';
                tbtn.addEventListener('click', () => { if (tour.active) stopTour(); else startTour(); });
                footerEl.appendChild(tbtn);
            }
        } else if (tour.active) {
            // Detail view + tour active: compact right-aligned Stop Tour.
            // Stopping a tour while on a detail view leaves the user on
            // this detail view — they clearly wanted to look at this
            // specific waypoint when they stopped touring, jumping them
            // back to the list would be jarring.
            const tourRow = document.createElement('div');
            tourRow.style.cssText = 'display:flex;justify-content:flex-end;';
            const tbtn = document.createElement('div');
            tbtn.className = 'tour-go-btn active';
            tbtn.style.cssText = 'font-weight:600;font-size:9px;padding:6px 12px;border-radius:3px;cursor:pointer;text-transform:uppercase;letter-spacing:1.5px;transition:all 200ms ease;';
            tbtn.textContent = 'Stop Tour';
            tbtn.addEventListener('click', () => stopTour());
            tourRow.appendChild(tbtn);
            footerEl.appendChild(tourRow);
        }
        // else: no footer content. The :empty CSS rule hides #atlasFooter
        // entirely so there's no stray padding or border when empty.
    }
}

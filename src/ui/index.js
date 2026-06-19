import { APP_TEXT } from '../core/text.js';
import {
    TOUR_STOPPING_KEYS, tour, stopTour, startTour,
    fadeVisibilityKey, fadeColorModeChange, clearVisibilityXfadeForKey,
    VISIBILITY_XFADE_KEYS,
    travelToHomepoint, captureHomepoint, captureWaypoint, buildAtlasUI
} from '../atlas/atlas.js';
import { exportSaveFile, importSaveFile } from '../persistence/save-file.js';
import { saveProfile } from '../persistence/profile.js';
import { applyTheme, applyButtonShape } from './theme.js';
import { sanitizeName } from '../core/utils.js';
import { initRadialUI } from './radial-ui.js';
import { downloadFullResScreenshot } from '../render/capture-render.js';
import { formatParamValue } from './toast.js';
import { initAudioSourceButton } from './audio-source-ui.js';
import {
    AUDIO_PILOT_KEYS,
    audioPilotStateKey,
    randomizerPilotStateKey,
    defaultAudioPilotEnabled,
    defaultRandomizerPilotEnabled
} from '../audio/pilot.js';
import { addVisualEffectControls } from './audiovisual-controls.js';
import { setPerformanceProfile } from '../render/performance.js';

// ───────────────────────────────────────────────────────────────────────────
//   6. UI
// ───────────────────────────────────────────────────────────────────────────


import { makeButtonRow, makeSection } from './dom-ui.js';
export { makeButtonRow, makeSection } from './dom-ui.js';

export const sliderSync = {};
window.sliderSync = sliderSync;

const paramSyncRegistry = {};
const freeEnergyReadoutRegistry = new Set();

function clearParamSyncRegistry() {
    for (const key of Object.keys(paramSyncRegistry)) delete paramSyncRegistry[key];
    for (const key of Object.keys(sliderSync)) delete sliderSync[key];
    freeEnergyReadoutRegistry.clear();
    window.updateAdaptiveParticleCountReadout = undefined;
}

function registerParamSync(key, fn) {
    if (!key || typeof fn !== 'function') return;
    if (!paramSyncRegistry[key]) {
        paramSyncRegistry[key] = new Set();
        sliderSync[key] = (value) => {
            const fns = paramSyncRegistry[key];
            if (!fns) return;
            fns.forEach(sync => {
                try { sync(value); } catch (err) { console.error(err); }
            });
        };
    }
    paramSyncRegistry[key].add(fn);
}

function syncParamKey(key, value) {
    const sync = sliderSync[key];
    if (typeof sync === 'function') sync(value);
}

function registerFreeEnergyReadout(fn) {
    if (typeof fn !== 'function') return;
    freeEnergyReadoutRegistry.add(fn);
    window.updateAdaptiveParticleCountReadout = (info = {}) => {
        freeEnergyReadoutRegistry.forEach(update => {
            try { update(info); } catch (err) { console.error(err); }
        });
    };
}

	// ─── UI overlay functionality ──────────────────────────────────────────

export function setupUI(engine) {
    window.togglePanel = function (id) {
        const p = document.getElementById(id);
        if (!p) return;
        const b = p.querySelector('.panel-body'), t = p.querySelector('.toggle');
        if (b && t) {
            // Toggle visibility of the entire panel instead of just the body
            p.classList.toggle('hidden');
            if (!p.classList.contains('hidden')) {
                // When showing the panel, ensure the body is also visible
                b.classList.remove('hidden');
                t.textContent = '−';
            }
            savePanelPos();
            if (window.renderDock) window.renderDock();
        }
    };

    function _layoutViewport() {
        const zoom = Math.max(0.25, Number(window.S?.uiZoom) || 1.0);
        return { zoom, vw: window.innerWidth / zoom, vh: window.innerHeight / zoom };
    }

    function _clampFixedElementToViewport(el, opts = {}) {
        if (!el) return;
        const { vw, vh } = _layoutViewport();
        const full = opts.full === true;
        const pad = Math.max(0, Number(opts.pad ?? 8) || 8);
        const minVisible = Math.max(24, Number(opts.minVisible ?? 120) || 120);
        const pw = Math.max(1, el.offsetWidth || 1);
        const ph = Math.max(1, el.offsetHeight || 1);
        let left = Number.parseFloat(el.style.left);
        let top = Number.parseFloat(el.style.top);

        if (!Number.isFinite(left)) {
            const r = el.getBoundingClientRect();
            left = r.left / (_layoutViewport().zoom || 1);
            el.style.left = left + 'px';
            el.style.right = 'auto';
        }
        if (!Number.isFinite(top)) {
            const r = el.getBoundingClientRect();
            top = r.top / (_layoutViewport().zoom || 1);
            el.style.top = top + 'px';
            el.style.bottom = 'auto';
        }

        if (full && pw <= vw - pad * 2) left = Math.max(pad, Math.min(vw - pw - pad, left));
        else left = Math.max(pad - pw + minVisible, Math.min(vw - minVisible - pad, left));

        if (full && ph <= vh - pad * 2) top = Math.max(pad, Math.min(vh - ph - pad, top));
        else top = Math.max(pad - ph + minVisible, Math.min(vh - minVisible - pad, top));

        el.style.left = left + 'px';
        el.style.top = top + 'px';
        el.style.right = 'auto';
        el.style.bottom = 'auto';
    }

    function clampPanels() {
        document.querySelectorAll('.panel').forEach(p => {
            if (p.classList.contains('hidden')) return;
            _clampFixedElementToViewport(p, { minVisible: 140, pad: 8, full: false });
        });
        document.querySelectorAll('.hud-element').forEach(p => {
            if (!p.style.left || !p.style.top) return;
            _clampFixedElementToViewport(p, { minVisible: 80, pad: 8, full: true });
        });
        document.querySelectorAll('.radial-menu, .radial-submenu, .radial-context-menu').forEach(p => {
            _clampFixedElementToViewport(p, { minVisible: 120, pad: 8, full: false });
        });
        if (typeof window.placeAudioSourcePanel === 'function') window.placeAudioSourcePanel();
    }
    window.clampPanels = clampPanels;

    function savePanelPos() {
        const pos = {};
        document.querySelectorAll('.panel, .hud-element').forEach(p => {
            if (!p.id) return; // skip un-IDed elements like the dock-handle
            const pb = p.classList.contains('panel') ? p.querySelector('.panel-body') : null;
            pos[p.id] = {
                left: p.style.left,
                top: p.style.top,
                right: p.style.right,
                display: p.classList.contains('hidden') ? 'none' : 'block',
                bodyHidden: pb ? pb.classList.contains('hidden') : false,
                // Persist a user-dragged body height (inline px) so resized
                // panels restore. Empty when never resized / reset to fit.
                bodyH: (pb && pb.style.height) ? pb.style.height : ''
            };
        });
        try { localStorage.setItem('ss6_panels', JSON.stringify(pos)); } catch (e) { }
        clampPanels();
    }
    // Expose on window: multiple call sites (panel resize handler, logo snap,
    // panel toggles) invoke `window.savePanelPos()` guarded by `if
    // (window.savePanelPos)`. Without this assignment that guard was always
    // false, so resize releases never persisted the dragged height — the root
    // cause of "panels don't remember their height."
    window.savePanelPos = savePanelPos;

    // Conservative validator for CSS length values pulled from localStorage.
    // Accepts plain numbers (with optional sign and decimals) plus px/% units;
    // rejects anything else — including url(), expression(), JS-pseudo-protocol
    // bombs, and stray semicolons that could close out the attribute.
    const _CSS_LEN_RE = /^-?\d+(?:\.\d+)?(?:px|%)?$/;
    function _safeCssLen(v) {
        return (typeof v === 'string' && _CSS_LEN_RE.test(v)) ? v : '';
    }

    function loadPanelPos() {
        try {
            const d = localStorage.getItem('ss6_panels');
            if (d) {
                const pos = JSON.parse(d);
                if (!pos || typeof pos !== 'object') return;
                for (const id in pos) {
                    const p = document.getElementById(id);
                    if (p && pos[id] && typeof pos[id] === 'object') {
                        p.style.left   = _safeCssLen(pos[id].left);
                        p.style.top    = _safeCssLen(pos[id].top);
                        p.style.right  = _safeCssLen(pos[id].right);
                        p.style.bottom = _safeCssLen(pos[id].bottom);
                        if (p.classList.contains('panel')) {
                            if (pos[id].display === 'none' || pos[id].hidden) {
                                p.classList.add('hidden');
                            } else {
                                p.classList.remove('hidden');
                            }
                            const b = p.querySelector('.panel-body'), t = p.querySelector('.toggle');
                            if (b && t) {
                                if (pos[id].bodyHidden) {
                                    b.classList.add('hidden');
                                    t.textContent = '+';
                                } else {
                                    b.classList.remove('hidden');
                                    t.textContent = '−';
                                }
                                // Restore a user-dragged height (validated len).
                                // Save side is confirmed correct; the value just
                                // wasn't sticking on load, so apply it now AND
                                // re-assert after layout settles (a double rAF),
                                // beating the max-height transition and any
                                // post-load relayout that would otherwise leave
                                // the body at its default height.
                                const bh = _safeCssLen(pos[id].bodyH);
                                if (bh) {
                                    // Restore the saved height only.
                                    // Pinning maxHeight here was the
                                    // bug that made panels un-growable
                                    // across sessions.
                                    const applyH = () => { b.style.height = bh; };
                                    applyH();
                                    requestAnimationFrame(() => requestAnimationFrame(applyH));
                                }
                            }
                        }
                    }
                }
                // After loading saved positions, verify all panels are
                // still on-screen via the existing clampPanels (also called
                // on resize/fullscreen). Window may have been resized
                // between sessions, or this may be a different monitor.
                clampPanels();
            } else {
                // First run — no saved positions. Place each panel just above
                // the dock so users see a clear cause/effect when they click
                // a dock button (panels rise from where they pressed). Each
                // panel gets a horizontal offset so they don't fully overlap.
                // After the user drags a panel, the new position is saved
                // and this branch never runs again.
                positionPanelsAboveDock();
                // Default to ALL panels closed on first load — clean canvas,
                // just dock + logo visible. User explicitly opens what they
                // want. Mirrors the docked-UI feel of a DAW where panels are
                // hidden until you call them up. Persisted state from later
                // sessions overrides this branch entirely.
                document.querySelectorAll('.panel').forEach(p => {
                    p.classList.add('hidden');
                });
            }
        } catch (e) { }
    }

    function positionPanelsAboveDock() {
        const dock = document.getElementById('dock');
        if (!dock) return;
        const dockRect = dock.getBoundingClientRect();
        // Compute a target Y just above the dock, taking each panel's own
        // height into account so they don't overshoot the screen.
        // panelIds is ordered to match the dock left-to-right.
        const panelIds = ['panelParams', 'panelSettings', 'panelAtlas', 'panelControls', 'panelConfig'];
        // Horizontal spread: stagger them across the lower-third of the
        // viewport so they're individually accessible.
        const vw = window.innerWidth;
        const stride = Math.min(280, (vw - 80) / panelIds.length);
        const startX = Math.max(20, (vw - stride * panelIds.length) / 2);
        panelIds.forEach((id, idx) => {
            const p = document.getElementById(id);
            if (!p) return;
            // Need the panel rendered to measure height. It's already in DOM
            // but might be hidden by default. Briefly un-hide for measurement.
            const wasHidden = p.classList.contains('hidden');
            if (wasHidden) {
                p.style.visibility = 'hidden';
                p.classList.remove('hidden');
            }
            const h = p.offsetHeight || 200;
            if (wasHidden) {
                p.classList.add('hidden');
                p.style.visibility = '';
            }
            // Y: sit so the panel's bottom edge is 16px above the dock top.
            // Clamp to a sensible minimum so very tall panels don't clip off top.
            const y = Math.max(20, dockRect.top - h - 16);
            const x = Math.round(startX + idx * stride);
            p.style.left = x + 'px';
            p.style.top = y + 'px';
            p.style.right = 'auto';
            p.style.bottom = 'auto';
        });
    }

    // Panel resize — full-width bottom handle. The live drag moves only a
    // fixed-position GUIDE LINE via `transform` (compositor-only, never
    // re-rasters → cannot lag behind the cursor even while the GPU sim runs).
    // The real body height is written ONCE on release (a single raster), then
    // persisted. This is the no-lag synthesis: the smoothness of a CSS
    // transform with the content-cap / fit / state-save the native resizer
    // can't do.
    function initPanelResize() {
        const MIN_BODY = 60; // never collapse the body below this (layout px)
        document.querySelectorAll('.panel').forEach(panel => {
            const body = panel.querySelector('.panel-body');
            if (!body || panel.dataset.noResize === '1' || panel.querySelector('.panel-resize-handle')) return;

            const handle = document.createElement('div');
            handle.className = 'panel-resize-handle';
            handle.title = 'Drag to resize \u00b7 double-click to fit';
            panel.appendChild(handle); // last child -> below body (and atlas footer)

            const zoom = () => (window.S && window.S.uiZoom) || 1.0;

            // Tallest the body should ever be = its natural content height,
            // clamped to the viewport. scrollHeight is the full content height
            // (layout px) regardless of the body's current visible height, so
            // this is correct even when the body is currently scrolled/short.
            // If the body delegates scrolling to an inner region (overflow on a
            // child marked [data-fit-scroll]), the body itself never overflows,
            // so add that child's clipped overflow to recover the true content
            // height — otherwise the panel can't grow past its current size.
            const contentCap = () => {
                let h = body.scrollHeight;
                const inner = body.querySelector('[data-fit-scroll]');
                if (inner) h += Math.max(0, inner.scrollHeight - inner.clientHeight);
                return Math.min(h, (window.innerHeight / zoom()) * 0.9);
            };

            let startY = 0, startH = 0, cap = 0, dragging = false, guide = null;

            // Clamp a raw cursor delta to [MIN_BODY, cap] and return the target
            // body height (layout px). Single source of truth for move + commit.
            const targetH = (clientY) => {
                const dy = (clientY - startY) / zoom();
                return Math.max(MIN_BODY, Math.min(startH + dy, cap));
            };

            const onMove = (e) => {
                if (!dragging) return;
                // Move the guide only — pure transform, no layout, no raster.
                const screenDy = (targetH(e.clientY) - startH) * zoom();
                guide.style.transform = 'translateY(' + screenDy + 'px)';
                e.preventDefault();
            };

            const endDrag = (commit, clientY) => {
                if (!dragging) return;
                dragging = false;
                handle.classList.remove('dragging');
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                document.removeEventListener('pointercancel', onCancel);
                if (guide) { guide.remove(); guide = null; }
                if (commit) {
                    const h = targetH(clientY);
                    // At (or within 1px of) the content cap, clear the inline
                    // height so the body becomes true fit-content — an exact
                    // pixel height can leave a 1px overflow that keeps the
                    // scrollbar up even though everything fits.
                    if (h >= cap - 1) {
                        body.style.height = '';
                    } else {
                        body.style.height = h + 'px';
                    }
                    // NOTE: never pin maxHeight here. Pinning it (the old
                    // restore bug) welds the panel's ceiling to one drag and
                    // makes it un-growable on the next session.
                    body.style.maxHeight = '';
                    savePanelPos();
                }
            };
            const onUp = (e) => endDrag(true, e.clientY);
            const onCancel = () => endDrag(false, 0);

            handle.addEventListener('pointerdown', (e) => {
                dragging = true;
                handle.classList.add('dragging');
                startY = e.clientY;
                cap = contentCap();
                startH = Math.min(body.getBoundingClientRect().height / zoom(), cap);
                // Fixed-position guide at the body's current bottom edge, full
                // width. Fixed (not absolute) so panel overflow:hidden can't
                // clip it; appended to <body> so the UI root's `zoom` doesn't
                // scale it (zoom != transform, so fixed stays in screen px).
                const r = body.getBoundingClientRect();
                guide = document.createElement('div');
                guide.className = 'panel-resize-guide';
                guide.style.cssText = 'position:fixed;left:' + r.left + 'px;top:' + r.bottom + 'px;width:' + r.width + 'px;';
                document.body.appendChild(guide);
                document.addEventListener('pointermove', onMove);
                document.addEventListener('pointerup', onUp);
                document.addEventListener('pointercancel', onCancel);
                e.preventDefault();
                e.stopPropagation();
            });

            // Double-click -> snap to fit-content (clear inline overrides).
            handle.addEventListener('dblclick', (e) => {
                body.style.height = '';
                body.style.maxHeight = '';
                savePanelPos();
                e.preventDefault();
            });
        });
    }
    window.initPanelResize = initPanelResize;

    function initDrag() {
        let dr = false, ox = 0, oy = 0, p = null;

        // Per-element setup, extracted so we can also call it for dynamically
        // created panels (currently: the entropy panel built on first open).
        function attachDragToHead(h) {
            if (!h || h.dataset.dragWired === '1') return;
            h.dataset.dragWired = '1';
            h.addEventListener('mousedown', e => {
                if (e.target.closest('.toggle')) return;
                p = h; dr = true;
                // Panel backdrop-filter blur samples the scanline overlay
                // behind it; while the panel MOVES, the blurred sample of that
                // periodic light/dark pattern beats and the panel appears to
                // flash. Suppress blur for the duration of the drag (also makes
                // dragging cheaper). Restored on mouseup.
                document.body.classList.add('panel-dragging');
                const isHud = h.classList.contains('hud-element');
                // Allow a hud-element to designate a different element as the actual drag target (e.g. dock-handle drags the dock).
                let targetEl;
                if (isHud) {
                    const sel = h.dataset.dragTarget;
                    targetEl = (sel && document.querySelector(sel)) || h;
                } else {
                    targetEl = h.parentElement;
                }
                
                // Z-layering: bring the just-grabbed panel above all others. Increment a shared counter so each new grab beats the last.
                window._panelZTop = (window._panelZTop || 20) + 1;
                targetEl.style.zIndex = window._panelZTop;
                
                // Native zoom compensation: clientX/Y are screen pixels.
                ox = e.clientX;
                oy = e.clientY;
                
                const zoom = window.S?.uiZoom || 1.0;
                const rect = targetEl.getBoundingClientRect();
                
                const isPixelValue = (v) => typeof v === 'string' && /^-?\d+(\.\d+)?px$/.test(v.trim());
                const hasPixelLeft = isPixelValue(targetEl.style.left);
                const hasPixelTop  = isPixelValue(targetEl.style.top);
                
                if (!hasPixelLeft) {
                    targetEl.style.left = (rect.left / zoom) + 'px';
                    targetEl.style.right = 'auto';
                    targetEl.style.transform = 'none';
                    targetEl.style.margin = '0';
                }
                if (!hasPixelTop) {
                    targetEl.style.top = (rect.top / zoom) + 'px';
                    targetEl.style.bottom = 'auto';
                }
                
                targetEl.dataset.startLeft  = parseFloat(targetEl.style.left)  || 0;
                targetEl.dataset.startTop   = parseFloat(targetEl.style.top)   || 0;
                targetEl.dataset.startRight = parseFloat(targetEl.style.right) || 0;
            });
            window.addEventListener('mousemove', e => {
                if (!dr || p !== h) return;
                const isHud = h.classList.contains('hud-element');
                let targetEl;
                if (isHud) {
                    const sel = h.dataset.dragTarget;
                    targetEl = (sel && document.querySelector(sel)) || h;
                } else {
                    targetEl = h.parentElement;
                }
                
                const zoom = window.S.uiZoom || 1.0;
                const dx = (e.clientX - ox) / zoom;
                const dy = (e.clientY - oy) / zoom;
                
                const sl = parseFloat(targetEl.dataset.startLeft);
                const st = parseFloat(targetEl.dataset.startTop);
                const sr = parseFloat(targetEl.dataset.startRight);

                targetEl.style.top = (st + dy) + 'px';
                
                // If it was right-anchored, keep it right-anchored
                if (targetEl.style.left === 'auto' || (!targetEl.style.left && targetEl.style.right)) {
                    targetEl.style.right = (sr - dx) + 'px';
                } else {
                    targetEl.style.left = (sl + dx) + 'px';
                }

                if (targetEl.id === 'dock') {
                    targetEl.style.margin = '0';
                    // Logo tracks the dock live during drag — without this,
                    // fast drags left the logo behind because applyDocked()
                    // only ran on pointerup. Now the logo follows as the
                    // dock moves.
                    if (window.applyDockedLogo) window.applyDockedLogo();
                }
                
                // Live bounds clamping. HUD elements (dock, hud-title) get clamped so their full body stays visible. Panels keep at least a corner.
                const zoomNow = window.S?.uiZoom || 1.0;
                const vw = window.innerWidth / zoomNow;
                const vh = window.innerHeight / zoomNow;
                const pw = targetEl.offsetWidth;
                const ph = targetEl.offsetHeight;
                let lpx = parseFloat(targetEl.style.left) || 0;
                let tpx = parseFloat(targetEl.style.top) || 0;
                if (isHud) {
                    if (lpx < 0) lpx = 0;
                    if (tpx < 0) tpx = 0;
                    if (lpx + pw > vw) lpx = vw - pw;
                    if (tpx + ph > vh) tpx = vh - ph;
                } else {
                    const minVisible = 140;
                    if (pw <= vw - 16) lpx = Math.max(8, Math.min(vw - pw - 8, lpx));
                    else lpx = Math.max(8 - pw + minVisible, Math.min(vw - minVisible - 8, lpx));
                    if (ph <= vh - 16) tpx = Math.max(8, Math.min(vh - ph - 8, tpx));
                    else tpx = Math.max(8 - ph + minVisible, Math.min(vh - minVisible - 8, tpx));
                }
                targetEl.style.left = lpx + 'px';
                targetEl.style.top = tpx + 'px';
            });
            window.addEventListener('mouseup', () => {
                if (dr) { savePanelPos() }
                dr = false;
                document.body.classList.remove('panel-dragging');
            });
        } // end attachDragToHead

        // Wire all currently-present heads, and expose the helper so newly
        // created panels (entropy panel, future dynamic UIs) can wire themselves.
        document.querySelectorAll('.panel-head, .hud-element').forEach(attachDragToHead);
        window.attachDragToHead = attachDragToHead;

        // Click anywhere on a panel raises it above the others (not just the
        // header drag). Shares the same _panelZTop counter so the last-touched
        // panel always wins. Capture phase so it fires before inner handlers.
        if (!window._panelRaiseWired) {
            window._panelRaiseWired = true;
            document.addEventListener('mousedown', (e) => {
                const panel = e.target.closest && e.target.closest('.panel');
                if (!panel) return;
                window._panelZTop = (window._panelZTop || 20) + 1;
                panel.style.zIndex = window._panelZTop;
            }, true);
            // Clicking a dock (button-bar) button also raises its panel. The
            // panel may be created lazily by the click, so run on bubble (after
            // the button's own handler) and derive the panel id from the button.
            document.addEventListener('click', (e) => {
                const db = e.target.closest && e.target.closest('.dock-btn');
                if (!db || !db.id || db.id.indexOf('dock-btn-') !== 0) return;
                const panel = document.getElementById(db.id.slice('dock-btn-'.length));
                if (!panel) return;
                window._panelZTop = (window._panelZTop || 20) + 1;
                panel.style.zIndex = window._panelZTop;
            }, false);
        }
    }

    // Initialize Dock BEFORE initDrag so it receives the drag listeners
    initDock();
    initAudioSourceButton();
    // Logo behavior (snap-to-dock, fade-on-distance) is independent of the
    // dock's button layout but anchored to it, so init here right after.
    initLogo();
    
    // Initialize defaults before building UI
    if (typeof window.S.panelOpacity !== 'number') window.S.panelOpacity = 0.55;
    if (typeof window.S.buttonOpacity !== 'number') window.S.buttonOpacity = 0.8;

    // UI BUILDER
    buildUI(engine);
    
    // ui-ready is NOT added here. It's added by splash dismiss (or by
    // setUIVisibility(true) later). This way the UI stays invisible behind
    // the splash regardless of how long the engine init takes.
    loadPanelPos();
    // The dock now holds its restored position — re-evaluate the logo's dock
    // state against the CORRECT target (initLogo ran before this). A double
    // rAF lets layout settle so offsetWidth/Height are real, not 0.
    if (window.refreshDockedLogo) {
        window.refreshDockedLogo();
        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (window.refreshDockedLogo) window.refreshDockedLogo();
        }));
    }
    if (window.renderDock) window.renderDock(); // Sync dock buttons with loaded panel states
    initDrag();
    initPanelResize();
    const clampPanelsSoon = () => requestAnimationFrame(() => requestAnimationFrame(clampPanels));
    window.addEventListener('resize', clampPanelsSoon);
    try { new ResizeObserver(clampPanelsSoon).observe(document.documentElement); } catch (e) {}

    // Scanlines must be locked to PHYSICAL pixels, not CSS pixels, so browser
    // zoom doesn't fatten them. Browser zoom scales css-px AND devicePixelRatio
    // together, so a tile of (2 / dpr) css-px renders ~2 physical px at any
    // zoom. Update on resize (fires on zoom too) and via a matchMedia dpr watch.
    const updateScanPx = () => {
        const dpr = window.devicePixelRatio || 1;
        document.documentElement.style.setProperty('--scan-px', (2 / dpr) + 'px');
    };
    updateScanPx();
    window.addEventListener('resize', updateScanPx);
    // matchMedia resolution watch catches zoom changes that don't fire resize.
    try {
        let mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
        const onDpr = () => { updateScanPx(); try { mq.removeEventListener('change', onDpr); } catch(e){} mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`); mq.addEventListener('change', onDpr); };
        mq.addEventListener('change', onDpr);
    } catch (e) {}
    // Fullscreen toggle (F11) may not always fire 'resize' synchronously
    // on every browser. Listen for fullscreenchange explicitly so panels
    // re-clamp to the viewport the moment the screen dimensions change.
    document.addEventListener('fullscreenchange', clampPanels);
    document.addEventListener('webkitfullscreenchange', clampPanels);
    
    // Initialize Radial Menu Paradigm
    initRadialUI();
}

function initDock() {
    const dock = document.createElement('nav');

    // Dock itself is NOT .hud-element — that class enables drag,
	// but we want only the handle (a child) to be draggable. Otherwise buttons drag.
    dock.className = 'dock';
    dock.id = 'dock';
    dock.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);display:flex;align-items:center;height:32px;gap:8px;z-index:500;padding:0 0 0 6px;background:transparent;border:none;';
    const uiRoot = document.getElementById('ui-root') || document.body;
    uiRoot.appendChild(dock);

    // Drag handle on the left edge. Three rows of two dots — small,
	// gives the user a clear "grab here" affordance without crowding the buttons.
	// This is the ONLY part of the dock that initiates a drag.
    const handle = document.createElement('div');
    handle.className = 'hud-element dock-handle';
    handle.title = 'Drag to move';
    handle.setAttribute('data-drag-target', '#dock');
    handle.innerHTML = '<span></span><span></span><span></span><span></span><span></span><span></span>';
    dock.appendChild(handle);

    // ─── Navigation toggle (Orbit / Fly) ─────────────────────────────────
    // Lives on the far-left of the dock so the camera-mode switch is one
    // click away regardless of which panels are open. Distinct visual from
    // panel-open dock buttons: it's a segmented control, not an on/off.
    const navMov = (window.APP_TEXT && window.APP_TEXT.moveMode) || { items: ['Orbit', 'Fly'] };
    const navToggle = document.createElement('div');
    navToggle.className = 'dock-nav-toggle';
    navToggle.title = 'Camera navigation mode';
    const navOrbit = document.createElement('button');
    navOrbit.className = 'dock-nav-seg';
    navOrbit.dataset.mode = 'orbit';
    navOrbit.textContent = navMov.items[0] || 'Orbit';
    const navFly = document.createElement('button');
    navFly.className = 'dock-nav-seg';
    navFly.dataset.mode = 'fly';
    navFly.textContent = navMov.items[1] || 'Fly';
    const navAuto = document.createElement('button');
    navAuto.className = 'dock-nav-seg';
    navAuto.dataset.mode = 'auto-orbit';
    navAuto.title = 'Auto-orbit camera around the system';
    navAuto.textContent = 'Auto';
    navToggle.appendChild(navOrbit);
    navToggle.appendChild(navFly);
    navToggle.appendChild(navAuto);
    dock.appendChild(navToggle);

    // ─── Hover-revealed speed sliders ─────────────────────────────────────
    // Vertical slider pops up above each nav button on hover (orbit →
    // orbitZoomSpeed, fly → flyMoveSpeed). Only revealed when its mode is
    // active. 400ms grace on hide so the user can travel from button to
    // slider without it disappearing.
    const makeSpeedSlider = (label, getCurrent, setCurrent, min, max, step) => {
        const popup = document.createElement('div');
        popup.className = 'dock-speed-popup';
        const lbl = document.createElement('div');
        lbl.className = 'dock-speed-label';
        lbl.textContent = label;
        popup.appendChild(lbl);
        const valEl = document.createElement('div');
        valEl.className = 'dock-speed-val';
        valEl.textContent = getCurrent().toFixed(2);
        popup.appendChild(valEl);
        const inp = document.createElement('input');
        inp.type = 'range';
        inp.className = 'dock-speed-range';
        inp.min = min; inp.max = max; inp.step = step;
        inp.value = getCurrent();
        // Vertical orientation. CSS rotation handles the visual; we read
        // input.value as numeric regardless of orientation.
        inp.addEventListener('input', () => {
            const v = parseFloat(inp.value);
            setCurrent(v);
            valEl.textContent = v.toFixed(2);
        });
        popup.appendChild(inp);
        // Expose a sync so external value changes (e.g. W/S + scroll-wheel
        // adjusting speed via the canvas wheel handler) can refresh the
        // slider thumb and numeric readout. Without this the popup only
        // updated on its own input event and went stale after a scroll.
        popup._sync = () => {
            const cur = getCurrent();
            inp.value = cur;
            valEl.textContent = cur.toFixed(2);
        };
        return popup;
    };

    const orbitSpeedPopup = makeSpeedSlider(
        'W/S\nzoom',
        () => window.engine?.cam?.orbitZoomSpeed ?? 1.0,
        v => { if (window.engine?.cam) window.engine.cam.orbitZoomSpeed = v; },
        0.1, 10, 0.1
    );
    const flySpeedPopup = makeSpeedSlider(
        'fly\nspeed',
        () => window.engine?.cam?.flyMoveSpeed ?? 1.0,
        v => { if (window.engine?.cam) window.engine.cam.flyMoveSpeed = v; },
        0.05, 20, 0.05
    );

    // Append popups to the nav buttons so they position relative to each
    // button. CSS positions them absolutely above with bottom:100%.
    navOrbit.style.position = 'relative';
    navFly.style.position = 'relative';
    navOrbit.appendChild(orbitSpeedPopup);
    navFly.appendChild(flySpeedPopup);

    // Lets the canvas wheel handler refresh these popups when W/S + scroll
    // changes orbitZoomSpeed / flyMoveSpeed directly on the cam object,
    // keeping the slider thumb and readout in sync with the live value.
    // Pass 'orbit' or 'fly' to also flash that popup visible so the user
    // sees the change happen even when not hovering the button.
    window.refreshSpeedPopups = (flashMode) => {
        try { orbitSpeedPopup._sync(); } catch (e) {}
        try { flySpeedPopup._sync(); } catch (e) {}
        try {
            if (flashMode === 'orbit' && orbitSpeedPopup._flash) orbitSpeedPopup._flash();
            else if (flashMode === 'fly' && flySpeedPopup._flash) flySpeedPopup._flash();
        } catch (e) {}
    };

    // Show/hide logic. Sub-millisecond function; called on every
    // pointerenter/pointerleave on the button + popup.
    const wireSpeedPopup = (btn, popup, requiredMode) => {
        let hideTimer = null;
        const show = () => {
            clearTimeout(hideTimer);
            popup.classList.add('visible');
        };
        const hideSoon = (delay = 400) => {
            clearTimeout(hideTimer);
            // 400ms grace lets the user transit from button to popup
            // without the popup disappearing en route.
            hideTimer = setTimeout(() => popup.classList.remove('visible'), delay);
        };
        // Hover reveal is mode-gated (don't show the fly popup while orbiting).
        btn.addEventListener('pointerenter', () => { if (window.S.moveMode === requiredMode) show(); });
        btn.addEventListener('pointerleave', () => hideSoon());
        popup.addEventListener('pointerenter', () => { clearTimeout(hideTimer); });
        popup.addEventListener('pointerleave', () => hideSoon());
        // Flash the popup visible when W/S + scroll changes the speed, so the
        // user can see the thumb and value move. Longer hide grace than hover
        // (1100ms) so the change is readable before it fades. Only fired for
        // the active mode — the wheel handler is already inside that branch.
        popup._flash = () => { show(); hideSoon(1100); };
    };
    wireSpeedPopup(navOrbit, orbitSpeedPopup, 'orbit');
    wireSpeedPopup(navFly, flySpeedPopup, 'fly');

    // Screenshot capture button — one-shot full-res PNG download.
    // Honors Include → Background and Include → Scanlines from System.
    const captureBtn = document.createElement('button');
    captureBtn.className = 'dock-capture-btn';
    captureBtn.title = 'Capture screenshot (be sure to reinitialize for accuracy)';
    // SVG camera glyph rather than Unicode "📷" which renders inconsistently.
    captureBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M9 3L7.17 5H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2h-3.17L15 3H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/><circle cx="12" cy="13" r="3"/></svg>';
    captureBtn.addEventListener('click', async () => {
        if (window.engine && typeof downloadFullResScreenshot === 'function') {
            await downloadFullResScreenshot(window.engine);
        }
    });
    dock.appendChild(captureBtn);

    const syncNavToggle = () => {
        const mode = window.S.moveMode || 'orbit';
        navOrbit.dataset.active = (mode === 'orbit') ? 'true' : 'false';
        navFly.dataset.active   = (mode === 'fly')   ? 'true' : 'false';
        navAuto.dataset.active  = (window.S.cameraAutoOrbit === true) ? 'true' : 'false';
    };
    const setNavMode = (mode) => {
        if (window.S.moveMode === mode) return;
        window.S.moveMode = mode;
        // Reset camera FOV back to default when leaving fly mode so any
        // zoom-in from fly's scroll-wheel doesn't bleed into orbit. Orbit
        // uses position-distance for zoom, not FOV — having a stale lens
        // setting from a previous fly session would feel like a bug.
        if (mode === 'orbit' && window.engine && window.engine.camera) {
            window.engine.camera.fov = 60;
            window.engine.camera.updateProjectionMatrix();
        }
        syncNavToggle();
        // Match makeGroupToggles semantics: any explicit mode change cancels
        // an active tour (the user is now driving), refreshes radial UI, and
        // persists state. Also notify any other toggle observers tracking
        // moveMode (none currently, but the registry is the right place).
        if (window.tour && window.tour.active && window.stopTour) window.stopTour();
        if (window.refreshRadialUI) window.refreshRadialUI();
        if (window._toggleUpdaters && window._toggleUpdaters.moveMode) {
            window._toggleUpdaters.moveMode.forEach(fn => fn());
        }
        try { localStorage.setItem('ss_state', JSON.stringify(window.S)); } catch (e) {}
    };
    navOrbit.addEventListener('click', () => setNavMode('orbit'));
    navFly.addEventListener('click', () => setNavMode('fly'));
    navAuto.addEventListener('click', () => {
        window.S.cameraAutoOrbit = window.S.cameraAutoOrbit !== true;
        if (window.S.cameraAutoOrbit) window.S.moveMode = 'orbit';
        syncNavToggle();
        if (window.refreshRadialUI) window.refreshRadialUI();
        if (window.showParamToast) window.showParamToast('Auto Orbit', window.S.cameraAutoOrbit ? 'ON' : 'OFF');
        try { localStorage.setItem('ss_state', JSON.stringify(window.S)); } catch (e) {}
    });
    syncNavToggle();
    // Register in the toggle-updater registry so anyone who changes moveMode
    // through other paths (modulation, share-string load, keyboard shortcut)
    // can keep this segmented toggle in sync.
    window._toggleUpdaters = window._toggleUpdaters || {};
    if (!window._toggleUpdaters.moveMode) window._toggleUpdaters.moveMode = new Set();
    window._toggleUpdaters.moveMode.add(syncNavToggle);
    // Convenience export for callers that just want to refresh the visual.
    window.syncDockNavToggle = syncNavToggle;

    const dockDefs = [
        { id: 'panelParams', label: 'Params' },
        { id: 'panelSettings', label: 'Optics' },
        { id: 'panelAtlas', label: 'Atlas' },
        { id: 'panelControls', label: 'Controls' },
        { id: 'panelConfig', label: 'Config' },
        { id: 'panelEntropy', label: 'Entropy', isFps: true }
    ];

    dockDefs.forEach(def => {
        const btn = document.createElement('button');
        btn.id = 'dock-btn-' + def.id;
        btn.className = 'dock-btn';
        // Entropy button gets an inline FPS readout next to its label
        btn.innerHTML = def.isFps
            ? `<span class="dock-label">${def.label}</span><span class="dock-fps" id="dock-fps">--</span>`
            : def.label;
        // All visual states driven by .dock-btn[data-closed] attribute (managed by renderDock()) and theme CSS.
        
        let downX, downY, downTime;
        btn.addEventListener('pointerdown', (e) => {
            downX = e.clientX;
            downY = e.clientY;
            downTime = Date.now();
        });
        
        btn.addEventListener('pointerup', (e) => {
            const dist = Math.sqrt((e.clientX - downX)**2 + (e.clientY - downY)**2);
            const time = Date.now() - downTime;
            if (dist < 10 && time < 400) {
                if (def.isFps) {
                    // Entropy button opens the small entropy panel
                    if (window.toggleEntropyPanel) window.toggleEntropyPanel();
                    return;
                }
                window.togglePanel(def.id);
            }
        });
        dock.appendChild(btn);
    });

    window.renderDock = function() {
        dockDefs.forEach(def => {
            const panel = document.getElementById(def.id);
            const btn = document.getElementById('dock-btn-' + def.id);
            if (!btn) return;
            // Entropy (or any def lacking a panel) defaults to button-closed.
            // Once the panel is lazily created on first open, this falls
            // through to the same panel-state logic as the others.
            if (!panel) {
                btn.dataset.closed = 'true';
                return;
            }
            const body = panel.querySelector('.panel-body');
            const isClosed = panel.classList.contains('hidden') || (body && body.classList.contains('hidden'));
            btn.dataset.closed = isClosed ? 'true' : 'false';
        });
    };

    window.renderDock();
}

// ─── Logo behavior ─────────────────────────────────────────────────────────
// Snap to dock (tracks dock position), drag to detach, snap-back on release
// within radius, mouse-distance fade, click-to-toggle opaque/translucent.
// ═══════════════════════════════════════════════════════════════════════════
// LOGO — the title label glued above the button bar.
//
// This is intentionally trivial. The label sits centered above the dock; that
// is a pure CSS relationship (a dock child with bottom:100%), so the browser
// maintains it through resize, F11, font-load and dock-drag with ZERO
// JavaScript. There is no position tracking to get wrong.
//
// Dragging the logo to a free position was removed: it was a nice-to-have that
// proved fiddly, and "label above bar" is the only behavior launch needs. If
// free-drag returns later, it goes HERE and nowhere else — the logo is no
// longer a `.hud-element`, so the generic drag/clamp/save systems never touch
// it. (The earlier brittleness came from those systems all writing its
// position at once; keeping it isolated is the fix that matters.)
// ═══════════════════════════════════════════════════════════════════════════

// LOGO — free-floating title mark. Lifted OUT of the dock (where it lived as
// position:absolute and got pinned by the HUD clamp to top>=0 relative to the
// 32px bar — the invisible ceiling). As a fixed child of <body> it lives in
// screen space and drags anywhere, viewport-clamped, persisting its own spot.
// No edge-snap / stacked reformatting. Bioclast theme swaps the text for the
// pixel-art SVG (currentColor, inherits the themed tint).
function initLogo() {
    const logo = document.getElementById('hud-title');
    const dock = document.getElementById('dock');
    if (!logo) return;

    // Lifted into screen space (fixed child of <body>), NOT absolute-inside-dock.
    // The original trap was dock-relative absolute positioning + the HUD top>=0
    // clamp, which fenced the logo just above the bar. Fixed-to-body has no such
    // ceiling, so the logo can both dock AND drag free anywhere on screen.
    if (logo.parentElement !== document.body) document.body.appendChild(logo);
    logo.style.position = 'fixed';
    logo.style.right = 'auto';
    logo.style.bottom = 'auto';
    logo.style.transform = 'none';
    logo.style.margin = '0';
    logo.style.cursor = 'grab';
    logo.style.zIndex = '600';

    const GAP = 16;   // logo sits this far above the dock when docked
    const SNAP = 70;  // drop within this distance of the dock home -> re-dock

    // Persisted: { docked, left, top }. left/top only used when undocked (free).
    let state;
    try { state = JSON.parse(localStorage.getItem('ss6_logo') || 'null'); } catch (e) {}
    if (!state || typeof state.docked !== 'boolean') state = { docked: true, left: null, top: null };

    const sz = () => ({ w: logo.offsetWidth || 200, h: logo.offsetHeight || 30 });
    const dockHome = () => {
        const { w, h } = sz();
        if (dock) {
            const r = dock.getBoundingClientRect();
            return { left: r.left + r.width / 2 - w / 2, top: r.top - h - GAP };
        }
        return { left: (window.innerWidth - w) / 2, top: window.innerHeight - h - 60 };
    };
    const clampView = (left, top) => {
        const { w, h } = sz();
        return {
            left: Math.max(0, Math.min(left, window.innerWidth - w)),
            top:  Math.max(0, Math.min(top,  window.innerHeight - h))
        };
    };
    const homeDist = (left, top) => {
        const home = dockHome();
        return Math.hypot(left - home.left, top - home.top);
    };
    const apply = (left, top) => {
        const p = clampView(left, top);
        logo.style.left = p.left + 'px';
        logo.style.top  = p.top + 'px';
    };
    const place = () => {
        const t = (state.docked || state.left == null) ? dockHome() : { left: state.left, top: state.top };
        apply(t.left, t.top);
        logo.classList.toggle('docked', !!state.docked);   // .docked drives the connector rule
    };
    place();
    requestAnimationFrame(() => requestAnimationFrame(place));

    const save = () => { try { localStorage.setItem('ss6_logo', JSON.stringify(state)); } catch (e) {} };

    let dragging = false, sx = 0, sy = 0, sl = 0, st = 0, moved = false;
    logo.addEventListener('pointerdown', (e) => {
        dragging = true; moved = false;
        logo.style.cursor = 'grabbing';
        const r = logo.getBoundingClientRect();
        sl = r.left; st = r.top; sx = e.clientX; sy = e.clientY;
        try { logo.setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault();
    });
    document.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - sx, dy = e.clientY - sy;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
        const p = clampView(sl + dx, st + dy);
        logo.style.left = p.left + 'px';
        logo.style.top  = p.top + 'px';
        // Connector previews while you're in the snap zone: "release here to dock".
        logo.classList.toggle('docked', homeDist(p.left, p.top) < SNAP);
    });
    document.addEventListener('pointerup', () => {
        if (!dragging) return;
        dragging = false;
        logo.style.cursor = 'grab';
        if (!moved) { place(); return; }  // click, not a drag
        const left = parseFloat(logo.style.left) || 0;
        const top  = parseFloat(logo.style.top) || 0;
        state = (homeDist(left, top) < SNAP)
            ? { docked: true, left: null, top: null }
            : { docked: false, left, top };
        place();
        save();
    });

    // Keep a docked logo glued to the bar as the dock moves / the window resizes.
    window.addEventListener('resize', place);
    window.refreshDockedLogo = () => { if (state.docked) place(); };
    window.applyDockedLogo  = () => { if (state.docked) place(); };
}
window.initLogo = initLogo;

// Keys that should never go negative — even in Unbound mode. These are
// parameters where negative values are either physically meaningless,
// would crash the engine, or cause buffer-allocation failures. The
// Unbound feature is meant to expose interesting out-of-range behavior
// (like negative inversion producing galactic spirals); these keys are
// excluded because negative values produce only broken states, not
// interesting ones. They CAN still exceed their max (uncapped on top).
//   freeEnergy — sizes a GPU buffer. Negative crashes immediately.
//   resolution — particle billboard size. Negative breaks rendering.
// tempo is intentionally NOT here: negative tempo inverts the motion, which
// is a desirable creative effect in Unbound mode (per setz). The integrator
// produces a valid — if unusual — state running "backwards," and that's the
// point of Unbound. Only keys that hard-break (buffer size, billboard size)
// stay floored.
const UNBOUND_NON_NEGATIVE_KEYS = new Set(['freeEnergy', 'resolution']);

// Keys that ignore Unbound entirely — always clamped to slider range.
// Two groups belong here:
//   • UI-chrome controls (background appearance, sky grid, etc) where
//     out-of-range values either do nothing or just look wrong.
//   • Normalized optical knobs whose range IS the meaningful domain:
//     opacity / buttonOpacity (alpha, 0..1 is the whole space — there's
//     no "more than fully opaque"), hue (a 0..1 spectral index that just
//     wraps past the ends), and sat (saturation; past max is already
//     full color). Letting these escape only produces confusing numbers,
//     not new behavior — so they stay bound even in Unbound mode and
//     therefore never show the broken-chain indicator.
const UNBOUND_ALWAYS_CLAMPED_KEYS = new Set([
    'referenceGrid', 'bgGlow', 'bgBlur', 'uiScanlines', 'screenScanlines',
    'uiZoom', 'panelOpacity', 'perfParticleScaleMin', 'canvasResolutionScale', 'visualEffect2DResolutionScale',
    'opacity', 'buttonOpacity', 'hue', 'sat'
]);

// Combined gating used by both drag-scrub and typed-entry commit paths.
// Bounded mode: clamp to declared slider [min, max].
// Unbound mode: pass through verbatim, except keys in UNBOUND_NON_NEGATIVE_KEYS
// (floored at 0) and UNBOUND_ALWAYS_CLAMPED_KEYS (still range-clamped).
function clampForBoundlessMode(key, val, min, max) {
    if (!window.S.boundless) {
        return Math.max(min, Math.min(max, val));
    }
    if (UNBOUND_ALWAYS_CLAMPED_KEYS.has(key)) {
        return Math.max(min, Math.min(max, val));
    }
    if (UNBOUND_NON_NEGATIVE_KEYS.has(key) && val < 0) {
        return 0;
    }
    return val;
}
// Exposed as a generic seam so the modulation layer can clamp identically to
// the core's own drag/typed paths (Unbound lets values escape slider range).
window.clampForBoundlessMode = clampForBoundlessMode;

// Reflect Unbound mode as a body class so CSS can reveal the broken-chain
// indicator on every unboundable slider at once. Called from the
// Bound/Unbound toggle and once on UI build to pick up persisted state.
function applyBoundlessClass() {
    document.body.classList.toggle('boundless', !!window.S.boundless);
}
window.applyBoundlessClass = applyBoundlessClass;

function makeSlider(p, label, subhead, ll, lr, key, min, max, step, cb) {
    // Cache range so the modulation pipeline can compute proper amplitude and clamp values back into bounds.
    window._paramRanges = window._paramRanges || {};
    window._paramRanges[key] = { min, max, step };

    // Force-cast min/max/step/value through Number() before interpolation.
    // window.S[key] could be tampered (via an imported save or localStorage
    // mutation) to be a non-numeric string that would break out of the
    // value="..." attribute and inject HTML. Casting to Number first means
    // either a finite number (safe in any HTML context) or NaN (which we
    // catch and fall back to min).
    const _min = Number(min);
    const _max = Number(max);
    const _step = Number(step);
    const _raw = Number(window.S[key]);
    const _val = Number.isFinite(_raw) ? _raw : _min;
    const pct = ((_val - _min) / (_max - _min)) * 100;
    const d = document.createElement('div');
    d.className = 'row';
    d.dataset.paramKey = key;  // used by the modulation indicator (CSS pulse)
    // Flag rows whose value can escape its slider range in Unbound mode, so
    // CSS can show a ghosted broken-chain glyph next to the value (gated on
    // body.boundless) — making it obvious WHICH sliders actually unbind.
    // Chrome/appearance keys stay clamped even in Unbound, so no flag.
    if (!UNBOUND_ALWAYS_CLAMPED_KEYS.has(key)) d.dataset.unboundable = '1';
    if ((window.S[key + '_mod'] || 0) > 0.001) d.dataset.modulating = 'true';
    const fmtVal = (v) => v < 1 && v > 0 ? v.toFixed(3) : v < 100 ? Number(v).toFixed(1) : Math.round(v);

    d.innerHTML = `
        <div class="label">
            <span>${label}</span>
            ${subhead ? `<span class="subhead">${subhead}</span>` : ''}
        </div>
        <span class="val" data-editable="1" tabindex="0">${fmtVal(_val)}</span>
        <div class="bar">
            <i style="--v:${Math.max(0, Math.min(100, pct))}%"></i>
        </div>
        <input type="range" min="${_min}" max="${_max}" step="${_step}" value="${_val}">
    `;

    const valSpan = d.querySelector('.val');
    if (AUDIO_PILOT_KEYS.includes(key)) {
        const randomizerKey = randomizerPilotStateKey(key);
        const audioKey = audioPilotStateKey(key);
        if (typeof window.S[randomizerKey] !== 'boolean') {
            window.S[randomizerKey] = typeof window.S[audioKey] === 'boolean' ? window.S[audioKey] : defaultRandomizerPilotEnabled(key);
        }
        if (typeof window.S[audioKey] !== 'boolean') window.S[audioKey] = defaultAudioPilotEnabled(key);
        d.dataset.pilotRow = '1';
        d.dataset.audioPilotRow = '1';

        const makePilotToggle = (kind, stateKey, fallback, title, onDisable) => {
            const pilotLabel = document.createElement('label');
            pilotLabel.className = `pilot-toggle ${kind}-pilot-toggle`;
            pilotLabel.title = title;
            const pilot = document.createElement('input');
            pilot.type = 'checkbox';
            pilot.checked = window.S[stateKey] !== false;
            const glyph = document.createElement('span');
            glyph.className = 'pilot-glyph';
            glyph.textContent = kind === 'randomizer' ? 'R' : 'A';
            pilot.addEventListener('change', () => {
                window.S[stateKey] = !!pilot.checked;
                if (window.markRandomizerLiveEdit) window.markRandomizerLiveEdit(stateKey);
                if (!pilot.checked && typeof onDisable === 'function') onDisable();
                try { localStorage.setItem('ss_state', JSON.stringify(window.S)); } catch (e) {}
                if (kind === 'randomizer' && window.syncRandomizerPilotTogglesFromState) window.syncRandomizerPilotTogglesFromState();
                if (kind === 'audio' && window.syncAudioPilotTogglesFromState) window.syncAudioPilotTogglesFromState();
            });
            const registryName = kind === 'randomizer' ? '_randomizerPilotUpdaters' : '_audioPilotUpdaters';
            window[registryName] = window[registryName] || {};
            if (!window[registryName][stateKey]) window[registryName][stateKey] = new Set();
            window[registryName][stateKey].add(() => {
                if (typeof window.S[stateKey] !== 'boolean') window.S[stateKey] = fallback;
                pilot.checked = window.S[stateKey] !== false;
            });
            pilotLabel.appendChild(pilot);
            pilotLabel.appendChild(glyph);
            return pilotLabel;
        };

        const randomizerToggle = makePilotToggle(
            'randomizer',
            randomizerKey,
            defaultRandomizerPilotEnabled(key),
            'Let the randomizer control this parameter'
        );
        const audioToggle = makePilotToggle(
            'audio',
            audioKey,
            defaultAudioPilotEnabled(key),
            'Let audio modulate this parameter',
            () => { if (window.S_effective) delete window.S_effective[key]; }
        );
        d.insertBefore(randomizerToggle, valSpan);
        d.insertBefore(audioToggle, valSpan);
    }
    const inp = d.querySelector('input[type="range"]');
    const syncLocalSlider = (val) => {
        inp.value = val;
        // Bar pins at 0/100% — values can exceed the slider range via
        // typed entry or drag-scrub; the visualization just clamps.
        const rawPct = ((val - min) / (max - min) * 100);
        d.querySelector('i').style.setProperty('--v', Math.max(0, Math.min(100, rawPct)) + '%');
        // Don't overwrite an in-progress edit.
        if (document.activeElement !== valSpan) {
            valSpan.textContent = fmtVal(val);
        }
    };
    registerParamSync(key, syncLocalSlider);
    if (key === 'freeEnergy') {
        registerFreeEnergyReadout((info = {}) => {
            const active = Math.round(Number(info.active) || Number(window.S.freeEnergy) || 0);
            const requested = Math.round(Number(info.requested) || Number(window.S.freeEnergy) || 0);
            const shown = Number(window.S.freeEnergy) || requested || active || 0;
            const scaled = info.enabled === true && active > 0 && requested > 0 && active < requested;
            const rawPct = ((shown - min) / (max - min) * 100);
            d.querySelector('i').style.setProperty('--v', Math.max(0, Math.min(100, rawPct)) + '%');
            d.dataset.perfScaled = scaled ? 'true' : 'false';
            d.title = scaled ? `Adaptive Count rendering ${fmtVal(active)} active of ${fmtVal(requested)} requested` : '';
            if (document.activeElement !== valSpan) {
                valSpan.textContent = fmtVal(shown);
            }
        });
    }

    const updateVal = (val, isProgrammatic = false) => {
        window.S[key] = parseFloat(val);
        if (!isProgrammatic && window.markRandomizerLiveEdit) window.markRandomizerLiveEdit(key);
        syncParamKey(key, window.S[key]);
        if (cb) cb(window.S[key]);
        // Live readout toast: shows "Label: value" in the center-anchor
        // toast position so users can see the value as they scrub without
        // looking away from the simulation. Programmatic changes (state
        // restore, waypoint travel) skip the toast since they aren't
        // user-driven.
        if (!isProgrammatic && window.showParamToast) {
            window.showParamToast(label, formatParamValue(window.S[key]));
        }
        // Tour only cancels on changes to params it animates.
        if (!isProgrammatic && window.tour && window.tour.active && TOUR_STOPPING_KEYS.has(key)) window.stopTour();
        if (window.refreshRadialUI) window.refreshRadialUI();
        try { localStorage.setItem('ss_state', JSON.stringify(window.S)) } catch (e) { }
    };

    inp.addEventListener('input', e => { if (e.isTrusted) updateVal(e.target.value, false) });
    // Wheel-scrub lives on the VALUE only — not the whole row — so scrolling
    // the panel past a slider doesn't accidentally change it. Hovering the
    // number and scrolling still nudges it.
    valSpan.addEventListener('wheel', e => {
        e.preventDefault();
        const stepDist = (step || (max - min) / 100) * 5;
        const newVal = Math.max(min, Math.min(max, window.S[key] - Math.sign(e.deltaY) * stepDist));
        inp.value = newVal;
        updateVal(newVal, false);
    }, { passive: false });

    // ─── Editable / scrubbable value field ─────────────────────────────────
    // .val span: click-to-edit (focus, type, Enter/blur commits) OR drag-to-
    // scrub (4px threshold distinguishes click from drag). Both allow out-
    // of-range values; bar pins at 0/100% visually. freeEnergy is clamped
    // on reload via _STATE_CLAMPS (sizes a GPU buffer).
    const DRAG_THRESHOLD = 4;       // px before pointerdown is considered a drag
    // Value-per-pixel scaled to the RANGE, not the step. Using step*0.5 made
    // coarse-step sliders (e.g. an integer-step slider over a small range) scrub at
    // 0.5/px — a few px overshot the whole range. Range-based gives every slider
    // a consistent ~220px full-travel feel regardless of its step size. The
    // result is still snapped to `step` in updateVal, so integer sliders stay
    // integer.
    const DRAG_FULL_TRAVEL_PX = 220;
    const DRAG_PER_PX = (max - min) / DRAG_FULL_TRAVEL_PX;
    let _ptrStart = null;

    valSpan.addEventListener('pointerdown', (e) => {
        if (valSpan.contentEditable === 'true') return; // already editing; let it select text
        _ptrStart = {
            x: e.clientX,
            y: e.clientY,
            startVal: Number(window.S[key]) || 0,
            dragging: false,
            captured: false,
            pointerId: e.pointerId
        };
        // Attach the document listeners NOW so we don't leak them across
        // buildUI rebuilds (which would otherwise stack 20+ idle listeners
        // every time the panel re-renders). They detach themselves in
        // onPointerUp / onPointerCancel.
        document.addEventListener('pointermove', onPointerMove);
        document.addEventListener('pointerup', onPointerUp);
        document.addEventListener('pointercancel', onPointerUp);
        e.preventDefault();
    });

    // pointermove handler — installed only during active drag (see above).
    // continues even if the user's pointer leaves the span — matches the
    // expectation set by every other scrubber in every other tool.
    const onPointerMove = (e) => {
        if (!_ptrStart) return;
        const dx = e.clientX - _ptrStart.x;
        const dy = e.clientY - _ptrStart.y;
        if (!_ptrStart.dragging) {
            // Cross the threshold in any direction → enter drag mode.
            if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
            _ptrStart.dragging = true;
            valSpan.classList.add('scrubbing');
            document.body.style.cursor = 'ew-resize';
            // Block text selection during drag.
            document.body.style.userSelect = 'none';
            // Capture so pointerup fires even off-element.
            try { valSpan.setPointerCapture(_ptrStart.pointerId); _ptrStart.captured = true; } catch (err) {}
        }
        let newVal = _ptrStart.startVal + dx * DRAG_PER_PX;
        // Snap to the slider's step so coarse sliders (e.g. integer Time
        // Dilation) land on clean values rather than fractional drag positions.
        if (_step > 0) newVal = Math.round(newVal / _step) * _step;
        // Boundless mode (window.S.boundless) lets drag-scrub push past
        // the slider range; bounded mode (default) clamps to [min, max]
        // so users can't accidentally crank a value into a regime that
        // crashes the engine. A small set of keys are floored at 0 even
        // in unbound mode — see NON_NEGATIVE_KEYS for the reasoning.
        const clamped = clampForBoundlessMode(key, newVal, _min, _max);
        updateVal(clamped, false);
    };

    const onPointerUp = (e) => {
        if (!_ptrStart) return;
        const wasDragging = _ptrStart.dragging;
        if (_ptrStart.captured) {
            try { valSpan.releasePointerCapture(_ptrStart.pointerId); } catch (err) {}
        }
        _ptrStart = null;
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);
        document.removeEventListener('pointercancel', onPointerUp);
        valSpan.classList.remove('scrubbing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        // No threshold crossed → click → enter edit mode (select all).
        if (!wasDragging) {
            valSpan.contentEditable = 'true';
            valSpan.focus();
            const range = document.createRange();
            range.selectNodeContents(valSpan);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        }
    };

    // Commit on blur/Enter; revert on Escape. NaN → restore displayed value.
    // Out-of-range typed values accepted verbatim (intentional).
    let _editStartVal = null;
    valSpan.addEventListener('focus', () => {
        _editStartVal = Number(window.S[key]);
    });
    const commit = () => {
        if (valSpan.contentEditable !== 'true') return;
        valSpan.contentEditable = 'false';
        const raw = valSpan.textContent.trim();
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) {
            // Same boundless gating as drag-scrub — typed values get
            // clamped to slider range in bounded mode (default), allowed
            // through verbatim in boundless mode (except for a small set
            // of keys floored at 0 — see clampForBoundlessMode).
            const finalVal = clampForBoundlessMode(key, parsed, _min, _max);
            updateVal(finalVal, false);
        } else {
            // Unparseable → restore the pre-edit displayed value without
            // changing state.
            valSpan.textContent = fmtVal(Number(window.S[key]));
        }
        _editStartVal = null;
    };
    const revert = () => {
        if (valSpan.contentEditable !== 'true') return;
        valSpan.contentEditable = 'false';
        if (_editStartVal != null) {
            valSpan.textContent = fmtVal(_editStartVal);
        }
        _editStartVal = null;
    };
    valSpan.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            valSpan.blur(); // triggers commit via blur handler below
        } else if (e.key === 'Escape') {
            e.preventDefault();
            revert();
            valSpan.blur();
        }
    });
    valSpan.addEventListener('blur', commit);

    p.appendChild(d);
    return d;
}

function setRandomizerPilotKeys(keys, enabled) {
    const list = Array.isArray(keys) ? keys : [keys];
    const edited = [];
    for (const key of list) {
        const pilotKey = randomizerPilotStateKey(key);
        window.S[pilotKey] = !!enabled;
        edited.push(pilotKey);
    }
    if (window.markRandomizerLiveEdit) window.markRandomizerLiveEdit(edited);
    try { localStorage.setItem('ss_state', JSON.stringify(window.S)); } catch (e) {}
    if (window.syncRandomizerPilotTogglesFromState) window.syncRandomizerPilotTogglesFromState();
}

function setAudioPilotKeys(keys, enabled) {
    const list = Array.isArray(keys) ? keys : [keys];
    const edited = [];
    for (const key of list) {
        const pilotKey = audioPilotStateKey(key);
        window.S[pilotKey] = !!enabled;
        edited.push(pilotKey);
        if (!enabled && window.S_effective) delete window.S_effective[key];
    }
    if (window.markRandomizerLiveEdit) window.markRandomizerLiveEdit(edited);
    try { localStorage.setItem('ss_state', JSON.stringify(window.S)); } catch (e) {}
    if (window.syncAudioPilotTogglesFromState) window.syncAudioPilotTogglesFromState();
}

function randomizerPilotGroupEnabled(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    return list.every(key => {
        const pilotKey = randomizerPilotStateKey(key);
        const audioKey = audioPilotStateKey(key);
        if (typeof window.S[pilotKey] !== 'boolean') {
            window.S[pilotKey] = typeof window.S[audioKey] === 'boolean' ? window.S[audioKey] : defaultRandomizerPilotEnabled(key);
        }
        return window.S[pilotKey] !== false;
    });
}

function audioPilotGroupEnabled(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    return list.every(key => {
        const pilotKey = audioPilotStateKey(key);
        if (typeof window.S[pilotKey] !== 'boolean') window.S[pilotKey] = defaultAudioPilotEnabled(key);
        return window.S[pilotKey] !== false;
    });
}

function makePilotSection(p, labelKey, sub, keys) {
    const section = makeSection(p, labelKey, sub);
    const list = Array.isArray(keys) ? keys : [keys];
    section.classList.add('pilot-section', 'audio-pilot-section');
    section.dataset.pilotRow = '1';
    section.dataset.audioPilotRow = '1';

    const makeGroupPilot = (kind, title, checkedFn, setter, registryName, keyFn) => {
        const pilotLabel = document.createElement('label');
        pilotLabel.className = `pilot-toggle ${kind}-pilot-toggle`;
        pilotLabel.title = title;
        const pilot = document.createElement('input');
        pilot.type = 'checkbox';
        pilot.checked = checkedFn(list);
        const glyph = document.createElement('span');
        glyph.className = 'pilot-glyph';
        glyph.textContent = kind === 'randomizer' ? 'R' : 'A';
        pilot.addEventListener('change', () => setter(list, pilot.checked));
        window[registryName] = window[registryName] || {};
        const groupUpdater = () => {
            pilot.checked = checkedFn(list);
        };
        for (const key of list) {
            const pilotKey = keyFn(key);
            if (!window[registryName][pilotKey]) window[registryName][pilotKey] = new Set();
            window[registryName][pilotKey].add(groupUpdater);
        }
        pilotLabel.appendChild(pilot);
        pilotLabel.appendChild(glyph);
        return pilotLabel;
    };

    section.appendChild(makeGroupPilot(
        'randomizer',
        'Let randomizer control this optics group',
        randomizerPilotGroupEnabled,
        setRandomizerPilotKeys,
        '_randomizerPilotUpdaters',
        randomizerPilotStateKey
    ));
    section.appendChild(makeGroupPilot(
        'audio',
        'Let audio modulate this optics group',
        audioPilotGroupEnabled,
        setAudioPilotKeys,
        '_audioPilotUpdaters',
        audioPilotStateKey
    ));
    return section;
}

function makeSelect(p, label, subhead, key, options, cb) {
    window._paramOptions = window._paramOptions || {};
    window._paramOptions[key] = options.map(opt => opt.value);

    const valid = new Set(options.map(opt => opt.value));
    const normalize = (value) => {
        const next = String(value || '');
        return valid.has(next) ? next : (options[0]?.value || '');
    };
    const labelFor = (value) => (options.find(opt => opt.value === value)?.label || value || '');

    const d = document.createElement('div');
    d.className = 'row select-row';
    d.dataset.paramKey = key;

    const labelEl = document.createElement('div');
    labelEl.className = 'label';
    const title = document.createElement('span');
    title.textContent = label;
    labelEl.appendChild(title);
    if (subhead) {
        const sub = document.createElement('span');
        sub.className = 'subhead';
        sub.textContent = subhead;
        labelEl.appendChild(sub);
    }

    const valSpan = document.createElement('span');
    valSpan.className = 'val';
    valSpan.style.display = 'none';
    const bar = document.createElement('div');
    bar.className = 'bar';
    const barFill = document.createElement('i');
    barFill.style.setProperty('--v', '100%');
    bar.appendChild(barFill);

    const select = document.createElement('select');
    select.className = 'cfg-select';
    select.style.cssText = [
        'grid-column:2',
        'grid-row:1',
        'justify-self:end',
        'width:min(170px, 100%)',
        'min-width:0',
        'padding:3px 8px',
        'border-radius:6px',
        'border:1px solid rgba(130,210,255,0.24)',
        'background:rgba(5,8,18,0.86)',
        'color:inherit',
        'font:inherit',
        'outline:none'
    ].join(';');
    options.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label;
        select.appendChild(option);
    });

    d.appendChild(labelEl);
    d.appendChild(select);
    d.appendChild(valSpan);
    d.appendChild(bar);

    const sync = (value) => {
        const next = normalize(value);
        select.value = next;
        valSpan.textContent = labelFor(next);
    };
    registerParamSync(key, sync);
    sync(window.S[key]);
    if (cb) cb(normalize(window.S[key]));

    window._toggleUpdaters = window._toggleUpdaters || {};
    if (!window._toggleUpdaters[key]) window._toggleUpdaters[key] = new Set();
    window._toggleUpdaters[key].add(() => sync(window.S[key]));

    select.addEventListener('change', (e) => {
        const next = normalize(e.target.value);
        window.S[key] = next;
        syncParamKey(key, next);
        if (cb) cb(next);
        if (window.showParamToast) window.showParamToast(label, labelFor(next));
        if (window.refreshRadialUI) window.refreshRadialUI();
        if (window.engine && typeof window.engine.updateUniforms === 'function') {
            try { window.engine.updateUniforms(); } catch (err) {}
        }
        try { window.dispatchEvent(new CustomEvent('scalespace-audio-visual-state')); } catch (err) {}
        const updaters = window._toggleUpdaters && window._toggleUpdaters[key];
        if (updaters) updaters.forEach(fn => { try { fn(); } catch (err) {} });
        try { localStorage.setItem('ss_state', JSON.stringify(window.S)) } catch (e) { }
    });

    p.appendChild(d);
    return d;
}

export function makeGroupToggles(p, items) {
    const tb = document.createElement('div');
    tb.className = 'group-toggles';

    items.forEach((itm, i) => {
        const btn = document.createElement('div');
        btn.className = 'group-toggle-btn';

        itm.update = () => {
            // Read user-intent boolean, not in-flight fade alpha.
            // ColorMode: fade defers the S.colorMode write until midpoint,
            // so read the pending target during fade for instant button
            // feedback instead of off-by-one click highlights.
            let currentVal = window.S[itm.key];
            if (itm.key === 'colorMode' && window._xfadeColorModeTarget != null) {
                currentVal = window._xfadeColorModeTarget;
            }
            // Paired-visibility (Quanta): active iff both visibilityKey AND
            // matchVal match. visibilityKey off → no tab active.
            let active;
            if (itm.visibilityKey) {
                active = !!window.S[itm.visibilityKey] && currentVal === itm.matchVal;
            } else {
                active = (itm.matchVal !== undefined)
                    ? currentVal === itm.matchVal
                    : !!currentVal;
            }
            btn.dataset.active = active ? '1' : '0';
        };
        itm.update();

        window._toggleUpdaters = window._toggleUpdaters || {};
        if (!window._toggleUpdaters[itm.key]) window._toggleUpdaters[itm.key] = new Set();
        window._toggleUpdaters[itm.key].add(itm.update);
        // Register under visibilityKey too — re-render when section toggled externally.
        if (itm.visibilityKey) {
            if (!window._toggleUpdaters[itm.visibilityKey]) window._toggleUpdaters[itm.visibilityKey] = new Set();
            window._toggleUpdaters[itm.visibilityKey].add(itm.update);
        }

        btn.textContent = itm.label;
        btn.addEventListener('click', () => {
            // Paired-visibility (Quanta): clicking active tab turns section
            // OFF; clicking inactive tab switches matchVal + turns section ON.
            // Shape preserved across off/on cycles.
            if (itm.visibilityKey) {
                const wasVisible = !!window.S[itm.visibilityKey];
                const wasMatching = window.S[itm.key] === itm.matchVal;
                const wasActive = wasVisible && wasMatching;

                // Stop tour before any fade kicks off (so stopTour's cleanup doesn't wipe it).
                if (tour && tour.active && (
                    TOUR_STOPPING_KEYS.has(itm.key) ||
                    TOUR_STOPPING_KEYS.has(itm.visibilityKey)
                )) stopTour();

                if (wasActive) {
                    // Active → deselect = section off. Leave shape as-is.
                    window.S[itm.visibilityKey] = false;
                    if (VISIBILITY_XFADE_KEYS[itm.visibilityKey]) {
                        fadeVisibilityKey(itm.visibilityKey, 1, 0);
                    }
                } else {
                    // Switch matchVal; if section was off, fade it on.
                    window.S[itm.key] = itm.matchVal;
                    if (!wasVisible) {
                        window.S[itm.visibilityKey] = true;
                        if (VISIBILITY_XFADE_KEYS[itm.visibilityKey]) {
                            fadeVisibilityKey(itm.visibilityKey, 0, 1);
                        }
                    }
                }

                if (window.markRandomizerLiveEdit) window.markRandomizerLiveEdit([itm.key, itm.visibilityKey]);
                if (itm.cb) itm.cb();
                // Fire updaters for BOTH the discrete key and the
                // visibility key — covers the radial menu's listener for
                // showParticles AND this group's sibling tabs.
                [itm.key, itm.visibilityKey].forEach(k => {
                    const u = window._toggleUpdaters && window._toggleUpdaters[k];
                    if (u) u.forEach(fn => { try { fn(); } catch (e) {} });
                });
                if (window.refreshRadialUI) window.refreshRadialUI();
                try { localStorage.setItem('ss_state', JSON.stringify(window.S)) } catch (e) { }
                return;
            }

            const wasOn = !!window.S[itm.key]; // boolean snapshot before flip
            // colorMode gets a V-envelope fade rather than an immediate
            // assignment. The mode flip itself happens inside the helper at
            // the envelope trough, so visually the layers dip to ~0, swap
            // mode, and rise back — masking the discrete shader-mode flip
            // the same way tour transitions already do. Don't assign here
            // or we'd flash the new mode at full opacity before the dip.
            const isColorModeFade = (itm.key === 'colorMode' && itm.matchVal !== undefined);
            if (isColorModeFade) {
                // Tour-stop check first, same ordering rule as below.
                if (tour && tour.active && TOUR_STOPPING_KEYS.has(itm.key)) stopTour();
                if (window.markRandomizerLiveEdit) window.markRandomizerLiveEdit(itm.key);
                fadeColorModeChange(itm.matchVal);
                if (itm.cb) itm.cb();
                const updaters = window._toggleUpdaters && window._toggleUpdaters[itm.key];
                if (updaters) updaters.forEach(fn => { try { fn(); } catch (e) {} });
                if (window.refreshRadialUI) window.refreshRadialUI();
                // No localStorage write here — fadeColorModeChange persists
                // at completion so the saved mode matches what's rendered.
                return;
            }

            if (itm.matchVal !== undefined) window.S[itm.key] = itm.matchVal;
            else {
                window.S[itm.key] = !wasOn;
            }
            if (window.markRandomizerLiveEdit) window.markRandomizerLiveEdit(itm.key);

            // Only cancel an active tour if this toggle actually affects what
            // the tour is animating. Theme switches, button-shape changes,
            // screenshot toggles, scanline overlays — none of those touch
            // simulation state, so killing the tour for them feels buggy.
            // TOUR_STOPPING_KEYS is the authoritative gate; see definition
            // for the inclusion rules. We stop BEFORE starting any new
            // visibility fade so stopTour's _xfade cleanup doesn't wipe it.
            if (tour && tour.active && TOUR_STOPPING_KEYS.has(itm.key)) stopTour();

            // For boolean visibility keys (Curved / Lattice — the string
            // toggles), animate the alpha rather than hard-snapping the
            // mesh. Quanta runs through the visibilityKey branch above and
            // doesn't reach here. matchVal toggles (tourMode, theme, etc.)
            // skip the fade — they're not visibility flips.
            if (itm.matchVal === undefined && VISIBILITY_XFADE_KEYS[itm.key]) {
                fadeVisibilityKey(itm.key, wasOn ? 1 : 0, wasOn ? 0 : 1);
            } else if (itm.matchVal === undefined) {
                clearVisibilityXfadeForKey(itm.key);
            }

            if (itm.cb) itm.cb();
            // Run ALL registered updaters for this key — not just this
            // group's siblings. Other UI elements may listen to the same
            // key (e.g. Include sub-group disables itself when both Save
            // toggles are off). This was previously a no-op for cross-
            // group listeners because we only iterated the local items.
            const updaters = window._toggleUpdaters && window._toggleUpdaters[itm.key];
            if (updaters) updaters.forEach(fn => { try { fn(); } catch (e) {} });
            if (window.refreshRadialUI) window.refreshRadialUI();
            try { localStorage.setItem('ss_state', JSON.stringify(window.S)) } catch (e) { }
        });
        tb.appendChild(btn);
    });
    p.appendChild(tb);
    return tb;
}

// Synchronize all UI toggles whose state may have changed externally (e.g. after a tour transition writes new values to window.S directly). Cheap — just calls registered update closures.
window.makeGroupToggles = makeGroupToggles;

export function syncTogglesFromState() {
    const updaters = window._toggleUpdaters || {};
    for (const key in updaters) {
        updaters[key].forEach(fn => { try { fn(); } catch (e) {} });
    }
}
window.syncTogglesFromState = syncTogglesFromState;

export function syncRandomizerPilotTogglesFromState() {
    const updaters = window._randomizerPilotUpdaters || {};
    for (const key in updaters) {
        updaters[key].forEach(fn => { try { fn(); } catch (e) {} });
    }
}
window.syncRandomizerPilotTogglesFromState = syncRandomizerPilotTogglesFromState;

export function syncAudioPilotTogglesFromState() {
    const updaters = window._audioPilotUpdaters || {};
    for (const key in updaters) {
        updaters[key].forEach(fn => { try { fn(); } catch (e) {} });
    }
}
window.syncAudioPilotTogglesFromState = syncAudioPilotTogglesFromState;

export function makeToggle(p, label, key, color, cb) {
    const d = document.createElement('span');
    d.className = 'tog';
    d.style.background = window.S[key] ? color + '22' : 'rgba(10,10,24,0.8)';
    d.style.border = '1px solid ' + (window.S[key] ? color : 'rgba(40,40,70,0.6)');
    d.style.color = window.S[key] ? color : '#8899aa';
    d.innerHTML = '<span class="dot" style="background:' + (window.S[key] ? color : '#556') + '"></span>' + label;

    d.addEventListener('click', () => {
        const wasOn = !!window.S[key];
        window.S[key] = !wasOn;
        if (window.markRandomizerLiveEdit) window.markRandomizerLiveEdit(key);
        d.style.background = window.S[key] ? color + '22' : 'rgba(10,10,24,0.8)';
        d.style.border = '1px solid ' + (window.S[key] ? color : 'rgba(40,40,70,0.6)');
        d.style.color = window.S[key] ? color : '#8899aa';
        d.innerHTML = '<span class="dot" style="background:' + (window.S[key] ? color : '#556') + '"></span>' + label;
        
        // Only cancel an active tour if this toggle key actually affects
        // what the tour is animating. See TOUR_STOPPING_KEYS definition.
        // Order matters — stop the tour BEFORE starting any new fade so
        // stopTour's _xfade cleanup doesn't wipe it.
        if (tour && tour.active && TOUR_STOPPING_KEYS.has(key)) stopTour();

        // Visibility fade for boolean layer toggles; other keys hard-snap.
        if (VISIBILITY_XFADE_KEYS[key]) {
            fadeVisibilityKey(key, wasOn ? 1 : 0, wasOn ? 0 : 1);
        }
        
        if (cb) cb();
        if (window.refreshRadialUI) window.refreshRadialUI();
        try { localStorage.setItem('ss_state', JSON.stringify(window.S)) } catch (e) { }
    });
    p.appendChild(d);
}

export function makeBtn(p, label, color, cb) {
    const d = document.createElement('span');
    d.className = 'btn';
    d.style.color = color;
    d.textContent = label;
    d.addEventListener('click', cb);
    p.appendChild(d);
    return d; // for callers that need to attach extra behavior (e.g. glow)
}
// Alias used in places where the return value is semantically important to
// the call site (vs. fire-and-forget makeBtn calls). Identical implementation.
const makeBtnReturn = makeBtn;

export function buildUI(engine) {
    const pb = document.getElementById('paramsBody');
    if (!pb) return;
    clearParamSyncRegistry();

    // Update Panel Titles from Config
    const T = window.APP_TEXT || { controls: {}, panels: {}, instructions: {}, quanta: {}, trails: {}, colorMode: {}, moveMode: {} };
    if (T.panels) {
        for (const [id, title] of Object.entries(T.panels)) {
            const panel = document.getElementById('panel' + id.charAt(0).toUpperCase() + id.slice(1));
            if (panel) {
                const head = panel.querySelector('.panel-head .title');
                if (head) head.textContent = title;
            }
        }
    }

    pb.innerHTML = '';

    // ─── +Homepoint button in Params panel head ───────────────────────────
    // Mirrors the +Waypoint affordance in the Atlas panel head: green text-
    // button that captures current params + cam state as the homepoint.
    // Idempotent — only attaches once per panel (checks for existing node).
    const paramsPanel = document.getElementById('panelParams');
    if (paramsPanel) {
        const h = paramsPanel.querySelector('.panel-head');
        const hText = h && h.querySelector('span');
        if (hText && !hText.querySelector('.add-hp-btn')) {
            const add = document.createElement('span');
            add.className = 'add-hp-btn';
            add.title = 'Save current state as homepoint';
            add.textContent = '+homepoint';
            add.style.cssText = 'font-weight:bold;margin-left:6px;font-size:10px;text-transform:uppercase;cursor:pointer;';
            // stopPropagation on mousedown so clicking this button doesn't
            // trigger the panel-head drag handler (same pattern as +waypoint).
            add.addEventListener('mousedown', e => e.stopPropagation());
            add.addEventListener('click', () => { if (window.captureHomepoint) window.captureHomepoint(); });
            hText.appendChild(add);
        }
        // Pulse the +homepoint button when no homepoint exists or when the
        // user has been prompted to set one (by clicking Homepoint at the
        // bottom without one set). Stored as window._needsHomepointHint so
        // it survives panel rebuilds. The pulse stops as soon as a homepoint
        // is saved (captureHomepoint clears the hint flag).
        const hpBtn = hText && hText.querySelector('.add-hp-btn');
        if (hpBtn) {
            const shouldGlow = !window.S.homepoint || window._needsHomepointHint;
            hpBtn.style.animation = shouldGlow ? 'pulseGreen 1.5s infinite' : 'none';
        }
    }

    // ─── Core Parameters ───────────────────────────────────────────────────
    const c = T.controls || {};
	
    // Tempo lives at the top of Parameters because it's the master control — 0 = pause, 1 = normal, 2 = double speed. Affects everything downstream.
    makeSlider(pb, c.tempo?.label || 'Tempo', c.tempo?.sub ||'excitation', c.tempo?.ll ||'calm', c.tempo?.lr ||'excited', 'tempo', 0, 2, .01);
    makeSlider(pb, c.freeEnergy?.label || 'Free Energy', c.freeEnergy?.sub ||'particle count', c.freeEnergy?.ll ||'sparse', c.freeEnergy?.lr ||'dense', 'freeEnergy', 500, 1000000, 100, (val) => {
        if (window.engine) window.engine.resizeParticles(Math.round(val));
    });
    makeGroupToggles(pb, [
        { label: 'Fixed Count', key: 'perfParticleScaling', matchVal: false, cb: () => { if (window.engine?.applyPerfLimits) window.engine.applyPerfLimits(); } },
        { label: 'Adaptive Count', key: 'perfParticleScaling', matchVal: true, cb: () => { if (window.engine?.applyPerfLimits) window.engine.applyPerfLimits(); } }
    ]);
    makeSlider(pb, c.resolution?.label || 'Resolution', c.resolution?.sub ||'particle size', c.resolution?.ll ||'-rez', c.resolution?.lr ||'+rez', 'resolution', .02, 20, .01);
    makeSlider(pb, c.inversion?.label || 'Inversion', c.inversion?.sub ||'compression', c.inversion?.ll ||'contract', c.inversion?.lr ||'expand', 'inversion', 30, 500, 1);
    makeSlider(pb, c.halfLife?.label || 'Half-Life', c.halfLife?.sub ||'particle lifespan', c.halfLife?.ll ||'mortal', c.halfLife?.lr ||'immortal', 'halfLife', 0, 30, .1);
    makeSlider(pb, c.scaleDepth?.label || 'Scale Depth', c.scaleDepth?.sub ||'attraction force', c.scaleDepth?.ll ||'micro', c.scaleDepth?.lr ||'macro', 'scaleDepth', 0, 5, .01);
    makeSlider(pb, 'Turbulence', 'organized vortex/lobe force', 'inverse', 'forward', 'physicsEmergence', -8, 8, .01);
    makeSlider(pb, c.coherence?.label || 'Coherence', c.coherence?.sub ||'attraction radius', c.coherence?.ll ||'vague', c.coherence?.lr ||'binary', 'coherence', 0, 200, 1);
    makeSlider(pb, c.equilibrium?.label || 'Equilibrium', c.equilibrium?.sub ||'noise speed', c.equilibrium?.ll ||'tranquil', c.equilibrium?.lr ||'random', 'equilibrium', .001, .2, .001);
    makeSlider(pb, c.temperature?.label || 'Temperature', c.temperature?.sub ||'noise intensity', c.temperature?.ll ||'glacial', c.temperature?.lr ||'firey', 'temperature', 0, 3, .01);
    makeSlider(pb, c.viscosity?.label || 'Viscosity', c.viscosity?.sub ||'sluggishness', c.viscosity?.ll ||'fluid', c.viscosity?.lr ||'thick', 'viscosity', 0, 1, .01);
    makeSlider(pb, c.mass?.label || 'Mass', c.mass?.sub ||'inertia', c.mass?.ll ||'light', c.mass?.lr ||'heavy', 'mass', 0.1, 5, .05);

    makeSection(pb, 'Randomizer', 'manual roll / continuous morph');
    const randomizerFooter = document.createElement('div');
    randomizerFooter.className = 'button-row params-randomizer-footer';
    pb.appendChild(randomizerFooter);

    const randomizeNow = document.createElement('div');
    randomizeNow.className = 'button-row-btn params-randomize-now';
    randomizeNow.dataset.active = '0';
    randomizeNow.textContent = 'Randomize';
    randomizeNow.title = 'Roll one new randomizer target now';
    randomizeNow.addEventListener('click', async () => {
        if (randomizeNow.dataset.busy === '1') return;
        randomizeNow.dataset.busy = '1';
        try {
            const summary = window.randomizeScaleSpaceSettings ? await window.randomizeScaleSpaceSettings({
                includeAudio: true,
                includeVisuals: true,
                transitionSec: window.S.randomizerTransitionSec || 6.0,
                sourceMode: window.S.randomizerSourceMode,
            }) : null;
            if (window.showToast) {
                const label = summary?.skipped ? (summary.label || 'no atlas codes') : (summary?.label || 'randomized');
                window.showToast(summary?.skipped ? `Randomizer skipped: ${label}` : `Randomized: ${label}`, { color: summary?.skipped ? '#ffb36d' : '#88ffcc' });
            }
        } finally {
            randomizeNow.dataset.busy = '0';
        }
    });
    randomizerFooter.appendChild(randomizeNow);

    const continuousRandom = document.createElement('div');
    continuousRandom.className = 'button-row-btn params-continuous-random';
    continuousRandom.textContent = 'Continuous';
    continuousRandom.title = 'Keep morphing through randomizer targets';
    const syncContinuousRandom = () => {
        continuousRandom.dataset.active = window.S.randomizerContinuous ? '1' : '0';
    };
    syncContinuousRandom();
    window._toggleUpdaters = window._toggleUpdaters || {};
    if (!window._toggleUpdaters.randomizerContinuous) window._toggleUpdaters.randomizerContinuous = new Set();
    window._toggleUpdaters.randomizerContinuous.add(syncContinuousRandom);
    continuousRandom.addEventListener('click', () => {
        const next = !window.S.randomizerContinuous;
        window.S.randomizerContinuous = next;
        if (window.markRandomizerLiveEdit) window.markRandomizerLiveEdit('randomizerContinuous');
        try { localStorage.setItem('ss_state', JSON.stringify(window.S)); } catch (e) {}
        if (window.setContinuousRandomization) {
            window.setContinuousRandomization(next, { transitionSec: window.S.randomizerTransitionSec || 6.0 });
        }
        syncContinuousRandom();
        if (window.syncTogglesFromState) window.syncTogglesFromState();
    });
    randomizerFooter.appendChild(continuousRandom);

    makeSlider(pb, 'Transition Seconds', 'continuous random', 'snap', 'morph', 'randomizerTransitionSec', .1, 120, .25, (val) => {
        const sec = Math.max(0.1, Math.min(120, Number(val) || 6.0));
        window.S.randomizerTransitionSec = sec;
        if (window.updateContinuousRandomizationTransitionSec) {
            window.updateContinuousRandomizationTransitionSec(sec);
        }
    });

    const rd = document.createElement('div');
    // Generous vertical breathing room — these are footer actions on a
    // panel that gets a lot of vertical scrolling, so they shouldn't feel
    // crammed against the last slider above or against the panel edge
    // below. 22px top, 14px bottom gives them deliberate space.
    rd.style.cssText = 'margin-top:22px;margin-bottom:14px;display:flex;gap:6px;';
    pb.appendChild(rd);
    const styleBottomBtn = (btn) => {
        btn.style.flex = '1';
        btn.style.margin = '0';
        btn.style.justifyContent = 'center';
        btn.style.whiteSpace = 'nowrap';
    };
    // Homepoint: travel back to user's saved "home" state (params + cam).
    // Replaces the old "Reset Params" button — homepoint IS the user's
    // chosen reset state, set via the green +Homepoint button in the panel
    // head. Pulses when no homepoint exists to invite first-time setup;
    // clicking with no homepoint set toasts a hint and triggers the
    // +Homepoint glow so users see exactly where to go next.
    // Green airplane glyph reinforces the "travel here" affordance, matching
    // the per-waypoint travel buttons throughout the Atlas. Homepoint IS a
    // travel target; the icon makes that explicit at a glance.
    const homepointBtn = makeBtnReturn(rd, 'Homepoint \u2708', '#6aaa7a', () => {
        if (!window.S.homepoint) {
            // First-touch hint flow: toast + trigger +Homepoint glow so the
            // user has a clear path to setting one. Flag persists until they
            // actually save a homepoint (captureHomepoint clears it).
            window._needsHomepointHint = true;
            if (window.travelToHomepoint) window.travelToHomepoint(); // toasts
            // Rebuild Params panel to refresh +Homepoint glow state.
            if (window.buildUI && window.engine) buildUI(window.engine);
        } else {
            if (window.travelToHomepoint) window.travelToHomepoint();
        }
    });
    // Bottom Homepoint button no longer glows when unset — the glow on the top
    // +Homepoint button is the canonical "set one here" affordance. Two
    // simultaneously-glowing buttons confused users about which one to click.
    // Re-initialize: blows away particle state, restarts at same coords.
    // Reveals the true attractor without stigmergic momentum.
    makeBtn(rd, 'Re-initialize', '#5fa8c8', () => {
        if (window.engine && typeof window.engine.reinitializeParticles === 'function') {
            window.engine.reinitializeParticles();
        }
    });
    // Apply equal-share + no-margin to both buttons just created
    Array.from(rd.children).forEach(styleBottomBtn);

    // ─── Optics ───────────────────────────────────────────────────────────
    // Order: System Opacity → Quanta → Trails → Trail Length →
    // Color Mode → Color Spectrum Range → Color Saturation.
    // Backdrop sliders live in Config → UI (they affect the UI layer, not
    // the simulation). Dependent controls (Trail Length) live-update via
    // _toggleUpdaters; no buildUI rebuilds on toggle.
    const sb = document.getElementById('settingsBody'); sb.innerHTML = '';

    // System Opacity — first, simplest knob. Was named "Particle Opacity"
    // but it actually controls particles + trails + lattice (everything
    // the system renders), so "System Opacity" is more honest about scope.
    makeSlider(sb, c.opacity?.label || 'System Opacity', c.opacity?.sub ||'', c.opacity?.ll ||'ghost', c.opacity?.lr ||'solid', 'opacity', 0, 1, .01);

    const quantaT = T.quanta || { label: 'Quanta', items: ['Circle', 'Square', 'Diamond'] };
    makePilotSection(sb, 'quanta', undefined, ['showParticles', 'shape']);
    makeGroupToggles(sb, [
        { label: quantaT.items[0], key: 'shape', matchVal: 'circle',  visibilityKey: 'showParticles' },
        { label: quantaT.items[1], key: 'shape', matchVal: 'square',  visibilityKey: 'showParticles' },
        { label: quantaT.items[2], key: 'shape', matchVal: 'diamond', visibilityKey: 'showParticles' }
    ]);

    const trailsT = T.trails || { label: 'Trails', items: ['Strings', 'Lattice'] };
    makePilotSection(sb, 'trails', undefined, ['showRibbons', 'tessRibbons']);
    // Trails uses button-row, not tabs: Strings and Lattice are
    // independent toggles. Either, both, or neither can be on.
    makeButtonRow(sb, [
        { label: trailsT.items[0], key: 'showRibbons' },
        { label: trailsT.items[1], key: 'tessRibbons' }
    ]);

    // Trail Length: standard slider, disabled when both trail types are off.
    // No custom margin-top — the slider's own margin and the makeButtonRow's
    // margin-bottom provide consistent spacing matching other sections.
    const trailWrap = document.createElement('div');
    sb.appendChild(trailWrap);
    makeSlider(
        trailWrap,
        c.trailLength?.label || 'Trail Length',
        c.trailLength?.sub || '',
        c.trailLength?.ll || 'short',
        c.trailLength?.lr || 'long',
        'trailLen', 3, 30, 1
    );

    const updateTrailEnabled = () => {
        const on = !!(window.S.showRibbons || window.S.tessRibbons);
        trailWrap.classList.toggle('disabled', !on);
    };
    window._toggleUpdaters = window._toggleUpdaters || {};
    ['showRibbons', 'tessRibbons'].forEach(k => {
        if (!window._toggleUpdaters[k]) window._toggleUpdaters[k] = new Set();
        window._toggleUpdaters[k].add(updateTrailEnabled);
    });
    updateTrailEnabled();

    const cmm = T.colorMode || { label: 'Color Mode', items: ['Mono', 'Size', 'Velocity', 'Density'] };
    makePilotSection(sb, 'colorMode', undefined, ['colorMode']);
    makeGroupToggles(sb, [
        { label: cmm.items[0], key: 'colorMode', matchVal: 0 },
        { label: cmm.items[1], key: 'colorMode', matchVal: 1 },
        { label: cmm.items[2], key: 'colorMode', matchVal: 2 },
        { label: cmm.items[3], key: 'colorMode', matchVal: 3 },
        
    ]);

    // ─── Color Controls ────────────────────────────────────────────────────
    makeSlider(sb, c.colorRange?.label || 'Color Spectrum Range', c.colorRange?.sub ||'', c.colorRange?.ll ||'tight', c.colorRange?.lr ||'wide', 'hue', 0.01, 1, 0.01, () => {
        if (window.engine) window.engine.updateUniforms();
    });
    makeSlider(sb, c.saturation?.label || 'Color Saturation', c.saturation?.sub ||'', c.saturation?.ll ||'muted', c.saturation?.lr ||'vivid', 'sat', 0, 1.5, 0.01, () => {
        if (window.engine) window.engine.updateUniforms();
    });

    const ob = document.getElementById('offsetsBody');
    if (ob) {
        ob.innerHTML = '';
        makeSlider(ob, 'World X Offset', 'px', 'left', 'right', 'offsetX', -500, 500, 1, () => { if (window.engine) window.engine.updateUniforms(); });
        makeSlider(ob, 'World Y Offset', 'py', 'down', 'up', 'offsetY', -500, 500, 1, () => { if (window.engine) window.engine.updateUniforms(); });
        makeSlider(ob, 'World Z Offset', 'pz', 'back', 'fore', 'offsetZ', -500, 500, 1, () => { if (window.engine) window.engine.updateUniforms(); });
        makeSlider(ob, 'Billboard Offset', 'math', 'min', 'max', 'billboardOffset', -100, 100, 1, () => { if (window.engine) window.engine.updateUniforms(); });
        
        const rb = document.createElement('div');
        rb.className = 'btn';
        rb.style.cssText = 'margin-top:10px;text-align:center;color:#ff8888;border-color:#ff4444';
        rb.textContent = 'RESET OFFSETS';
        rb.onclick = () => {
            window.S.offsetX = 0; window.S.offsetY = 0; window.S.offsetZ = 0; window.S.billboardOffset = 0;
            if (sliderSync.offsetX) {
                sliderSync.offsetX(0); sliderSync.offsetY(0); sliderSync.offsetZ(0); sliderSync.billboardOffset(0);
            }
            if (window.engine) window.engine.updateUniforms();
            try { localStorage.setItem('ss_state', JSON.stringify(window.S)) } catch (e) { }
        };
        ob.appendChild(rb);
    }

    // ─── Config & Controls ─────────────────────────────────────────────────
    const cbConfig = document.getElementById('configBody');
    if (cbConfig) {
        cbConfig.innerHTML = '';

        // Navigation toggle is in the dock bar now (far-left segmented button)
        // — see buildDock() / dock-nav-toggle. This panel no longer hosts it.

        // ─── Tab Bar (UI / System / Profile) ───────────────────────────────
        // Three-tab structure. UI is the most-touched section so it sits
        // leftmost and is the boot default. System narrows to "what gets
        // captured/saved" — fewer controls, clearer scope. Profile holds
        // identity and save-file management.
        //
        // Active tab is persisted so reopening Config remembers your last
        // view. Legacy 'system' values from the old two-tab layout are
        // accepted as-is.
        const tabBar = document.createElement('div');
        tabBar.className = 'cfg-tab-bar';
        const tabUI = document.createElement('button');
        tabUI.className = 'cfg-tab';
        tabUI.dataset.tab = 'ui';
        tabUI.textContent = 'UI';
        const tabSystem = document.createElement('button');
        tabSystem.className = 'cfg-tab';
        tabSystem.dataset.tab = 'system';
        tabSystem.textContent = 'System';
        const tabAudio = document.createElement('button');
        tabAudio.className = 'cfg-tab';
        tabAudio.dataset.tab = 'audio';
        tabAudio.textContent = 'Audio';
        const tabProfile = document.createElement('button');
        tabProfile.className = 'cfg-tab';
        tabProfile.dataset.tab = 'profile';
        tabProfile.textContent = 'Profile';
        tabBar.appendChild(tabUI);
        tabBar.appendChild(tabSystem);
        tabBar.appendChild(tabAudio);
        tabBar.appendChild(tabProfile);
        cbConfig.appendChild(tabBar);

        const uiPane = document.createElement('div');
        uiPane.className = 'cfg-pane';
        uiPane.dataset.tab = 'ui';
        cbConfig.appendChild(uiPane);

        const systemPane = document.createElement('div');
        systemPane.className = 'cfg-pane';
        systemPane.dataset.tab = 'system';
        cbConfig.appendChild(systemPane);

        const audioPane = document.createElement('div');
        audioPane.className = 'cfg-pane';
        audioPane.dataset.tab = 'audio';
        cbConfig.appendChild(audioPane);

        const profilePane = document.createElement('div');
        profilePane.className = 'cfg-pane';
        profilePane.dataset.tab = 'profile';
        cbConfig.appendChild(profilePane);

        const showCfgTab = (t) => {
            [tabUI, tabSystem, tabAudio, tabProfile].forEach(b => { b.dataset.active = (b.dataset.tab === t) ? 'true' : 'false'; });
            uiPane.style.display      = (t === 'ui')      ? '' : 'none';
            systemPane.style.display  = (t === 'system')  ? '' : 'none';
            audioPane.style.display   = (t === 'audio')   ? '' : 'none';
            profilePane.style.display = (t === 'profile') ? '' : 'none';
            // Size the config body to the ACTIVE tab's content. Without this,
            // a height left over from viewing a tall tab (or a manual resize)
            // persists onto a shorter tab and leaves an empty gap at the bottom.
            // Clearing the inline height lets the body fall back to fit-content
            // (bounded by the CSS max-height).
            if (cbConfig) { cbConfig.style.height = ''; cbConfig.style.maxHeight = ''; }
            try { localStorage.setItem('ss_cfg_tab', t); } catch (e) {}
        };
        tabUI.addEventListener('click',      () => showCfgTab('ui'));
        tabSystem.addEventListener('click',  () => showCfgTab('system'));
        tabAudio.addEventListener('click',   () => showCfgTab('audio'));
        tabProfile.addEventListener('click', () => showCfgTab('profile'));
        let lastCfgTab = 'ui';
        try {
            const saved = localStorage.getItem('ss_cfg_tab');
            if (saved === 'ui' || saved === 'system' || saved === 'audio' || saved === 'profile') lastCfgTab = saved;
        } catch (e) {}
        showCfgTab(lastCfgTab);

        const setAudioSourceFromConfig = (src) => {
            const prevSource = window.S.audioSource;
            if (src === 'system') {
                window.S.audioMonitor = false;
                window.S.audioMuted = true;
                const monUpdaters = window._toggleUpdaters && window._toggleUpdaters.audioMonitor;
                if (monUpdaters) monUpdaters.forEach(fn => { try { fn(); } catch (e) {} });
                const muteUpdaters = window._toggleUpdaters && window._toggleUpdaters.audioMuted;
                if (muteUpdaters) muteUpdaters.forEach(fn => { try { fn(); } catch (e) {} });
            } else if ((src === 'file' || src === 'url' || src === 'mic') && prevSource === 'system') {
                window.S.audioMuted = false;
                const muteUpdaters = window._toggleUpdaters && window._toggleUpdaters.audioMuted;
                if (muteUpdaters) muteUpdaters.forEach(fn => { try { fn(); } catch (e) {} });
            }
            window.S.audioSource = src;
            if (window.audio && typeof window.audio.setSource === 'function') {
                Promise.resolve(window.audio.setSource(src, window.S)).catch(err => console.error(err));
            }
            try { localStorage.setItem('ss_state', JSON.stringify(window.S)); } catch (e) {}
        };
        makeSection(audioPane, 'Audio Source');
        makeGroupToggles(audioPane, [
            { label: 'File',   key: 'audioSource', matchVal: 'file',   cb: () => setAudioSourceFromConfig('file') },
            { label: 'URL',    key: 'audioSource', matchVal: 'url',    cb: () => setAudioSourceFromConfig('url') },
            { label: 'Mic',    key: 'audioSource', matchVal: 'mic',    cb: () => setAudioSourceFromConfig('mic') },
            { label: 'System', key: 'audioSource', matchVal: 'system', cb: () => setAudioSourceFromConfig('system') }
        ]);
        makeSlider(audioPane, 'Audio FX Gain', '', 'soft', 'hot', 'audioFxGain', 0.1, 5, 0.01);
        makeSlider(audioPane, 'Input Gain', 'analyser sensitivity', 'flat', 'hot', 'audioReactiveGain', 0, 16, 0.01);
        makeSlider(audioPane, 'Param Drive', 'master audio impact on particle params', 'still', 'violent', 'audioParticleDrive', 0, 3, 0.01);
        makeSlider(audioPane, 'Motion Drive', 'extra impact on physics/motion params', 'calm', 'wild', 'audioParticleMotionDrive', 0, 3, 0.01);
        makeSlider(audioPane, 'Color Drive', 'extra impact on color params', 'plain', 'electric', 'audioParticleColorDrive', 0, 3, 0.01);
        makeSlider(audioPane, 'Envelope Drive', 'audio envelope into param modulation', 'dry', 'wet', 'audioReactiveAmount', 0, 3, 0.01);
        makeSlider(audioPane, 'Release Smear', 'sustained bass/tension response', 'snappy', 'molasses', 'audioReactiveRelaxation', 0, 2, 0.01);
        makeSlider(audioPane, 'Beat Color', 'color punch on transients', 'none', 'full', 'audioColorBeat', 0, 3, 0.01);
        makeSlider(audioPane, 'Volume', '', 'quiet', 'loud', 'volume', 0, 1, 0.01, () => {
            if (window.audio && typeof window.audio.updateVolume === 'function') window.audio.updateVolume(window.S.volume);
        });
        makeGroupToggles(audioPane, [
            { label: 'Reactive', key: 'audioReactive' },
            { label: 'Muted',    key: 'audioMuted', cb: () => { if (window.audio?.setMuted) window.audio.setMuted(window.S.audioMuted); } },
            { label: 'Monitor',  key: 'audioMonitor' }
        ]);
        addVisualEffectControls(audioPane, { makeSection, makeSelect, makeSlider, makeGroupToggles });

        // ─── PROFILE PANE ──────────────────────────────────────────────────
        makeSection(profilePane, 'Callsign', 'your name in the atlas');
        const profileSection = document.createElement('div');
        // DOM construction so the persisted profile id (which a determined
        // attacker could have edited in localStorage) can't inject HTML.
        const _profRow = document.createElement('div');
        _profRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin:3px 0 14px;';
        const _profInput = document.createElement('input');
        _profInput.type = 'text';
        _profInput.id = 'cfgUsername';
        _profInput.placeholder = 'username';
        _profInput.value = sanitizeName(window.profile?.username, { maxLen: 32 });
        _profInput.className = 'wp-edit';
        _profInput.style.cssText = 'flex:1;color:#cce6ff;font-size:10px;';
        _profRow.appendChild(_profInput);
        profileSection.appendChild(_profRow);
        // Profile ID is intentionally not shown in the UI. It exists as
        // plumbing (stamped on waypoints as authorId, used for future
        // multiplayer disambiguation) but has no user-facing purpose at
        // v1, so displaying it added visual noise without value. Keep the
        // sanitize logic in loadOrCreateProfile so it's still safe if
        // we ever expose it.
        profilePane.appendChild(profileSection);
        const usernameInput = _profInput;
        usernameInput.addEventListener('change', () => {
            window.profile.username = sanitizeName(usernameInput.value, { maxLen: 32 });
            saveProfile();
        });

        // ─── Save Progress ─────────────────────────────────────────────────
        // Four toggles: Config / Profile / Waypoints / Thumbs. Thumbs depends
        // on Waypoints (orphan data otherwise) — enforced via .save-thumb-
        // disabled. Save button disables when nothing selected.
        makeSection(profilePane, 'Save Progress', 'choose what to include');

        const exportRow = makeButtonRow(profilePane, [
            { label: 'Config',    key: 'exportIncludeSettings'   },
            { label: 'Profile',   key: 'exportIncludeProfile'    },
            { label: 'Waypoints', key: 'exportIncludeWaypoints'  },
            { label: 'Thumbs',    key: 'exportIncludeThumbnails' }
        ]);

        const saveSection = document.createElement('div');
        saveSection.style.cssText = 'margin-top:10px;margin-bottom:18px;display:flex;gap:6px;';
        const exportBtn = document.createElement('div');
        exportBtn.className = 'btn';
        exportBtn.style.cssText = 'flex:1;text-align:center;cursor:pointer;justify-content:center;';
        exportBtn.textContent = 'Save';
        exportBtn.addEventListener('click', () => {
            // Defense-in-depth: even though the button is disabled when no
            // toggles are on, double-check before triggering an export.
            const anyOn = !!(window.S.exportIncludeSettings || window.S.exportIncludeProfile
                          || window.S.exportIncludeWaypoints || window.S.exportIncludeThumbnails);
            if (!anyOn) return;
            exportSaveFile();
        });
        saveSection.appendChild(exportBtn);
        const importBtn = document.createElement('div');
        importBtn.className = 'btn';
        importBtn.style.cssText = 'flex:1;text-align:center;cursor:pointer;justify-content:center;';
        importBtn.textContent = 'Load';
        importBtn.addEventListener('click', () => {
            const inp = document.createElement('input');
            inp.type = 'file';
            inp.accept = '.json,.scalespace.json,application/json';
            inp.style.display = 'none';
            inp.addEventListener('change', () => importSaveFile(inp.files[0]));
            document.body.appendChild(inp);
            inp.click();
            setTimeout(() => inp.remove(), 5000);
        });
        saveSection.appendChild(importBtn);
        profilePane.appendChild(saveSection);

        // Dependency + Save-button enable logic:
        //   1. Thumbs depends on Waypoints. Off → grey .save-thumb-disabled
        //      and force-off; back on → restore via _thumbWasOnBeforeDisable.
        //   2. Save button enabled iff at least one toggle is on.
        let _thumbWasOnBeforeDisable = window.S.exportIncludeThumbnails !== false;
        const updateExportUI = () => {
            const wpOn = !!window.S.exportIncludeWaypoints;
            // Thumbs dependency on Waypoints.
            if (!wpOn && window.S.exportIncludeThumbnails) {
                _thumbWasOnBeforeDisable = true;
                window.S.exportIncludeThumbnails = false;
                try { localStorage.setItem('ss_state', JSON.stringify(window.S)); } catch (e) {}
                const upd = window._toggleUpdaters && window._toggleUpdaters['exportIncludeThumbnails'];
                if (upd) upd.forEach(fn => { try { fn(); } catch (e) {} });
            } else if (wpOn && _thumbWasOnBeforeDisable && !window.S.exportIncludeThumbnails) {
                window.S.exportIncludeThumbnails = true;
                try { localStorage.setItem('ss_state', JSON.stringify(window.S)); } catch (e) {}
                const upd = window._toggleUpdaters && window._toggleUpdaters['exportIncludeThumbnails'];
                if (upd) upd.forEach(fn => { try { fn(); } catch (e) {} });
            }
            // .save-thumb-disabled: disables only the 4th button (Thumbs)
            // when Waypoints is off. Custom class rather than .thumb-disabled
            // since that one targets nth-child(2) historically.
            exportRow.classList.toggle('save-thumb-disabled', !wpOn);

            // Save button enable: at least one toggle on.
            const anyOn = !!(window.S.exportIncludeSettings || window.S.exportIncludeProfile
                          || window.S.exportIncludeWaypoints || window.S.exportIncludeThumbnails);
            exportBtn.classList.toggle('disabled', !anyOn);
        };
        const _captureThumbIntent = () => {
            if (window.S.exportIncludeWaypoints) {
                _thumbWasOnBeforeDisable = !!window.S.exportIncludeThumbnails;
            }
        };
        window._toggleUpdaters = window._toggleUpdaters || {};
        ['exportIncludeSettings', 'exportIncludeProfile', 'exportIncludeWaypoints'].forEach(k => {
            if (!window._toggleUpdaters[k]) window._toggleUpdaters[k] = new Set();
            window._toggleUpdaters[k].add(updateExportUI);
        });
        if (!window._toggleUpdaters['exportIncludeThumbnails']) window._toggleUpdaters['exportIncludeThumbnails'] = new Set();
        window._toggleUpdaters['exportIncludeThumbnails'].add(_captureThumbIntent);
        window._toggleUpdaters['exportIncludeThumbnails'].add(updateExportUI);
        updateExportUI();

        // ─── Clear Data ────────────────────────────────────────────────────
        // Two destructive actions. .btn-danger styling (red border+text)
        // + confirmation modal on click.
        //   Clear Waypoints — wipes waypoints; preserves settings/profile.
        //   Clear All Data  — full reset, regenerates profile.
        makeSection(profilePane, 'Delete Data', 'this is irreversible');
        const clearSection = document.createElement('div');
        clearSection.style.cssText = 'margin-top:10px;margin-bottom:4px;display:flex;flex-direction:column;gap:8px;';

        const clearWpBtn = document.createElement('div');
        clearWpBtn.className = 'btn btn-danger';
        clearWpBtn.style.cssText = 'text-align:center;cursor:pointer;justify-content:center;';
        clearWpBtn.textContent = 'Clear Waypoints';
        clearWpBtn.addEventListener('click', () => {
            const n = (window.waypoints || []).length;
            if (n === 0) {
                if (window.showToast) window.showToast('No waypoints to clear');
                return;
            }
            if (!confirm(`Delete all ${n} waypoint${n === 1 ? '' : 's'}?\n\nThis cannot be undone. Your settings and profile will be preserved.\n\n(Tip: export your data first if you might want it back.)`)) return;
            window.waypoints = [];
            try { localStorage.removeItem('ss_waypoints'); } catch (e) {}
            try { localStorage.removeItem('ss6_standalone_wp'); } catch (e) {}
            // Drop the shipped-playlist tombstone too, so a clear genuinely
            // resets to a fresh state and the build-time playlist re-seeds on
            // the next load (otherwise 'seen' suppresses the re-seed).
            try { localStorage.removeItem('ss_playlist_seen'); } catch (e) {}
            if (window.buildAtlasUI && window.engine) window.buildAtlasUI(window.engine);
            if (window.showToast) window.showToast('Waypoints cleared');
        });
        clearSection.appendChild(clearWpBtn);

        const clearAllBtn = document.createElement('div');
        clearAllBtn.className = 'btn btn-danger';
        clearAllBtn.style.cssText = 'text-align:center;cursor:pointer;justify-content:center;';
        clearAllBtn.textContent = 'Clear All Data';
        clearAllBtn.addEventListener('click', () => {
            if (!confirm(`Reset everything to default state?\n\nThis will delete:\n  • All waypoints (${(window.waypoints||[]).length})\n  • All settings (theme, defaults, preferences)\n  • Your profile (id and username)\n\nThis cannot be undone. The app will reload after clearing.\n\n(Tip: export your data first if you might want it back.)`)) return;
            try {
                // Targeted removal rather than localStorage.clear() so we
                // don't wipe unrelated origin data (e.g. devtools state).
                ['ss_state', 'ss_waypoints', 'ss6_standalone_wp', 'ss_profile',
                 'ss6_panels', 'ss_camera', 'ss_radial', 'ss_playlist_seen'].forEach(k => {
                    try { localStorage.removeItem(k); } catch (e) {}
                });
            } catch (e) {}
            // Reload triggers fresh hydration from defaults (no localStorage
            // to read) and a new profile generation.
            location.reload();
        });
        clearSection.appendChild(clearAllBtn);
        profilePane.appendChild(clearSection);

        // ─── UI PANE ───────────────────────────────────────────────────────
        // Ergonomic order (per UX feedback): identity/structure controls first
        // (Theme, Radial shape/opacity), then the visual sliders, with UI Zoom
        // LAST — it triggers a whole-UI scale change you don't want to trip by
        // accident while reaching for the others.
        makeSection(uiPane, 'Theme');
        makeGroupToggles(uiPane, [
            { label: 'Synthesist', key: 'theme', matchVal: 'synthesist', cb: () => { applyTheme(); } },
            { label: 'Classic',    key: 'theme', matchVal: 'classic',    cb: () => { applyTheme(); } }
        ]);

        makeSection(uiPane, 'Radial Button Shape');
        makeGroupToggles(uiPane, [
            { label: 'Hex',    key: 'buttonShape', matchVal: 'hex',    cb: () => { applyButtonShape(); } },
            { label: 'Circle', key: 'buttonShape', matchVal: 'circle', cb: () => { applyButtonShape(); } }
        ]);

        // Radial Button Opacity — fades/blurs the radial nodes only.
        makeSlider(uiPane, 'Radial Button Opacity', '', 'clear', 'solid', 'buttonOpacity', 0, 1, .05, () => {
            updatePO();
        });

        makeSlider(uiPane, c.panelOpacity?.label || 'Panel Opacity', c.panelOpacity?.sub ||'', c.panelOpacity?.ll ||'clear', c.panelOpacity?.lr ||'solid', 'panelOpacity', 0, 1, .05, () => {
            updatePO();
        });
        // Backdrop sliders wire directly to the #bgGlow DIV's style so
        // changes preview without a render-pipeline round-trip.
        const _bgCanvasUI = document.getElementById('bgGlow');
        const _bgOpD = makeSlider(uiPane, c.backdropOpacity?.label || 'Backdrop Opacity', c.backdropOpacity?.sub ||'', c.backdropOpacity?.ll ||'off', c.backdropOpacity?.lr ||'bright', 'bgGlow', 0, .8, .02);
        if (_bgCanvasUI && _bgOpD) {
            _bgOpD.querySelector('input[type="range"]').addEventListener('input', () => { _bgCanvasUI.style.opacity = window.S.bgGlow; });
            const _bgBlD = makeSlider(uiPane, c.backdropBlur?.label || 'Backdrop Blur', c.backdropBlur?.sub ||'', c.backdropBlur?.ll ||'crisp', c.backdropBlur?.lr ||'soft', 'bgBlur', 0, 300, 1);
            if (_bgBlD) _bgBlD.querySelector('input[type="range"]').addEventListener('input', () => { _bgCanvasUI.style.filter = 'blur(' + window.S.bgBlur + 'px)'; });
        }

        addVisualEffectControls(uiPane, { makeSection, makeSelect, makeSlider, makeGroupToggles, includePowerToggle: true });

        makeSlider(uiPane, 'UI Scanlines', '', 'off', 'strong', 'uiScanlines', 0, 0.5, 0.01, () => { applyTheme(); });
        makeSlider(uiPane, 'Screen Scanlines', '', 'off', 'strong', 'screenScanlines', 0, 0.5, 0.01, () => { applyTheme(); });

        // Reference Grid — wireframe sphere around the simulation that gives
        // spatial bearings. Off by default; raising the slider fades it in.
        makeSlider(uiPane, 'Sky Grid', '', 'off', 'visible', 'referenceGrid', 0, 0.05, 0.001);

        // UI Zoom LAST — whole-UI scale change, kept away from the others.
        makeSlider(uiPane, 'UI Zoom', '', '50%', '150%', 'uiZoom', 0.5, 1.5, .05, (val) => {
            updateUIZoom(val);
        });

        // ─── SYSTEM PANE ───────────────────────────────────────────────────
        // ─── Save Screenshot ──────────────────────────────────────────────
        // Four toggles: Waypoint/Thumb (save triggers) + BG/Scanlines
        // (what to include). BG/Scanlines auto-disable when neither
        // trigger is on, via .include-disabled.
        makeSection(systemPane, 'Save Screenshot', 'choose what to include');

        const ssRow = makeButtonRow(systemPane, [
            { label: 'Waypoint',  key: 'saveOnNewWaypoint' },
            { label: 'Thumb',     key: 'saveOnNewThumbnail' },
            { label: 'BG',        key: 'includeScreenshotBg' },
            { label: 'Scanlines', key: 'includeScreenshotScanlines' }
        ]);

        const updateInclEnabled = () => {
            const anySave = !!window.S.saveOnNewWaypoint || !!window.S.saveOnNewThumbnail;
            ssRow.classList.toggle('include-disabled', !anySave);
        };
        window._toggleUpdaters = window._toggleUpdaters || {};
        ['saveOnNewWaypoint', 'saveOnNewThumbnail'].forEach(k => {
            if (!window._toggleUpdaters[k]) window._toggleUpdaters[k] = new Set();
            window._toggleUpdaters[k].add(updateInclEnabled);
        });
        updateInclEnabled();

        // ─── Performance ─────────────────────────────────────────────────
        // Mirrors the most important particle budget controls here so the
        // Config panel has one explicit place for render cost tuning.
        makeSection(systemPane, 'Performance', 'canvas, backdrop, particles');
        makeGroupToggles(systemPane, [
            { label: 'Potato',   key: 'perfProfile', matchVal: 'potato',   cb: () => { setPerformanceProfile('potato'); } },
            { label: 'Speed',    key: 'perfProfile', matchVal: 'speed',    cb: () => { setPerformanceProfile('speed'); } },
            { label: 'Balanced', key: 'perfProfile', matchVal: 'balanced', cb: () => { setPerformanceProfile('balanced'); } },
            { label: 'Quality',  key: 'perfProfile', matchVal: 'quality',  cb: () => { setPerformanceProfile('quality'); } }
        ]);
        makeSlider(systemPane, 'Canvas Scale', 'main render buffer cap', '40%', 'native', 'canvasResolutionScale', 0.4, 1, 0.05, () => {
            if (window.engine?.resize) window.engine.resize(window.innerWidth, window.innerHeight);
        });
        makeSlider(systemPane, 'Backdrop Detail', '2D FX geometry budget', '25%', '100%', 'visualEffect2DResolutionScale', 0.25, 1, 0.05);
        makeSlider(systemPane, c.freeEnergy?.label || 'Free Energy', c.freeEnergy?.sub || 'particle count', c.freeEnergy?.ll || 'sparse', c.freeEnergy?.lr || 'dense', 'freeEnergy', 500, 1000000, 100, (val) => {
            if (window.engine) window.engine.resizeParticles(Math.round(val));
        });
        makeGroupToggles(systemPane, [
            { label: 'Fixed Count', key: 'perfParticleScaling', matchVal: false, cb: () => { if (window.engine?.applyPerfLimits) window.engine.applyPerfLimits(); } },
            { label: 'Adaptive Count', key: 'perfParticleScaling', matchVal: true,  cb: () => { if (window.engine?.applyPerfLimits) window.engine.applyPerfLimits(); } }
        ]);
        makeSlider(systemPane, 'Particle Floor', '', 'lean', 'full', 'perfParticleScaleMin', 0.25, 1, 0.05, () => {
            if (window.engine?.applyPerfLimits) window.engine.applyPerfLimits();
        });

        makeSection(systemPane, 'Close-View Optimization', 'zoom-aware trims');
        makeGroupToggles(systemPane, [
            { label: 'Full Zoom FX', key: 'zoomOverdrawOptimize', matchVal: false, cb: () => { if (window.engine?.applyPerfLimits) window.engine.applyPerfLimits(); } },
            { label: 'Close Trim',   key: 'zoomOverdrawOptimize', matchVal: true,  cb: () => { if (window.engine?.applyPerfLimits) window.engine.applyPerfLimits(); } }
        ]);
        makeSlider(systemPane, 'Close Particle Floor', '', 'lean', 'full', 'zoomOverdrawActiveScaleMin', 0.05, 0.8, 0.01, () => {
            if (window.engine?.applyPerfLimits) window.engine.applyPerfLimits();
        });
        makeSlider(systemPane, 'Close FX Floor', '', 'lean', 'full', 'zoomOverdrawEffectScaleMin', 0.15, 0.8, 0.01);
        makeSlider(systemPane, 'Close Line Floor', '', 'lean', 'full', 'zoomOverdrawLineScaleMin', 0.02, 0.5, 0.005);
        makeGroupToggles(systemPane, [
            { label: 'Full Close Size', key: 'particleCloseScale', matchVal: false, cb: () => { if (window.engine?.updateUniforms) window.engine.updateUniforms(); } },
            { label: 'Depth Shrink', key: 'particleCloseScale', matchVal: true, cb: () => { if (window.engine?.updateUniforms) window.engine.updateUniforms(); } }
        ]);
        makeSlider(systemPane, 'Close Size Damp', '', 'soft', 'tight', 'particleCloseScaleStrength', 0, 0.95, 0.01, () => {
            if (window.engine?.updateUniforms) window.engine.updateUniforms();
        });
        makeSlider(systemPane, 'Close Size Near', '', 'near', 'far', 'particleCloseScaleNear', 1, 120, 1, () => {
            if (window.engine?.updateUniforms) window.engine.updateUniforms();
        });

        makeSection(systemPane, 'Numeric Bounds', 'binds to slider ranges');
        makeGroupToggles(systemPane, [
            { label: 'Bound',   key: 'boundless', matchVal: false, cb: applyBoundlessClass },
            { label: 'Unbound', key: 'boundless', matchVal: true,  cb: applyBoundlessClass }
        ]);
        applyBoundlessClass(); // reflect persisted Unbound state on UI build

        // ─── Version (item 12) ───────────────────────────────────────────────
        // Quiet build-version line at the very bottom of the System tab. Not
        // persistent UI chrome — just discoverable here for support/bug reports.
        // ─── Footer row: store link (left) + version (right) ────────────────
        // No divider stroke; compact single row so it doesn't waste vertical
        // space. The store link is the itch.io page for Synthesist; the Bioclast
        // layer rewrites it to the GitHub (open-source) link.
        const verRow = document.createElement('div');
        verRow.className = 'cfg-footer-row';
        const storeLink = document.createElement('a');
        storeLink.className = 'cfg-store-link';
        storeLink.id = 'cfgStoreLink';
        storeLink.href = 'https://setzr.itch.io/scale-space';
        storeLink.target = '_blank';
        storeLink.rel = 'noopener noreferrer';
        storeLink.textContent = 'Scale Space on itch.io';
        const verEl = document.createElement('span');
        verEl.className = 'cfg-version';
        verEl.textContent = 'α v' + (window.SS_VERSION || '0.1');
        verRow.appendChild(storeLink);
        verRow.appendChild(verEl);
        systemPane.appendChild(verRow);

    }

    // ─── Controls Panel ────────────────────────────────────────────────────
    // Single shared CSS grid for all sections so the binding column stays
    // aligned. Section headers span both columns with a faint bottom rule.
    const cb = document.getElementById('controlsBody'); cb.innerHTML = '';
    cb.style.cssText = 'padding:8px 10px 12px;';

    const inst = (T.instructions && T.instructions.global) ? T.instructions : {
        global: { title: 'Global', rows: [] },
        params: { title: 'Parameters', rows: [] },
        orbit:  { title: 'Orbit Mode', rows: [] },
        fly:    { title: 'Fly Mode', rows: [] }
    };

    const grid = document.createElement('div');
    grid.className = 'controls-grid';
    cb.appendChild(grid);

    const groups = ['global', 'params', 'orbit', 'fly'];
    groups.forEach((g, i) => {
        const sec = inst[g];
        if (!sec || !Array.isArray(sec.rows) || sec.rows.length === 0) return;

        // Section header spans both columns. Class controls bottom rule
        // and spacing; first-section variant trims top margin.
        const hdr = document.createElement('div');
        hdr.className = 'controls-section-head' + (i === 0 ? ' is-first' : '');
        hdr.textContent = sec.title;
        grid.appendChild(hdr);

        sec.rows.forEach(([behavior, binding]) => {
            const lbl = document.createElement('div');
            lbl.className = 'controls-row-label';
            lbl.textContent = behavior;
            grid.appendChild(lbl);
            const bnd = document.createElement('div');
            bnd.className = 'controls-row-binding';
            bnd.textContent = binding;
            grid.appendChild(bnd);
        });
    });

    // Build Atlas UI
    buildAtlasUI(engine);
    
    // Finalize Opacity
    updatePO();
}

export function updatePO() {
    window.updatePO = updatePO; // layer seam: re-apply after late panel creation
    const defaultA = 0.55;
    const a = typeof window.S.panelOpacity === 'number' ? window.S.panelOpacity : defaultA;
    window.S.panelOpacity = a; // Ensure state holds a safe value
    
    const btnA = typeof window.S.buttonOpacity === 'number' ? window.S.buttonOpacity : 0.8;
    window.S.buttonOpacity = btnA;
    // Panel/dock/capture buttons are now pinned to full opacity — the opacity
    // slider only governs the RADIAL buttons (per UX feedback: it was odd that
    // a "button opacity" control faded panel buttons too). --btn-alpha stays
    // the variable those selectors read; we just hold it at 1.
    document.documentElement.style.setProperty('--btn-alpha', 1);

    // buttonOpacity → radial node fill + blur only.
    // Map the 0–1 slider across the node's full visible alpha range. Previously
    // this was (btnA-0.1)*0.5 which capped the fill at ~0.45 even at slider max,
    // so the control "barely worked" — the top half of the travel did almost
    // nothing. Now slider max → ~0.9 fill (kept just under 1 so the node still
    // reads as a translucent glass button, not a flat fill).
    const btnBgAlpha = Math.max(0, (btnA - 0.05) * 0.95);
    document.documentElement.style.setProperty('--btn-bg-top', btnBgAlpha);
    document.documentElement.style.setProperty('--btn-bg-bot', btnBgAlpha * 0.9);
    
    const btnBlurVal = Math.max(0, (btnA - 0.05) * 12.63);
    document.documentElement.style.setProperty('--btn-blur', btnA < 0.05 ? '0px' : btnBlurVal.toFixed(1) + 'px');
    document.documentElement.style.setProperty('--btn-border', btnA * 0.8);
    
    const bgCanvas = document.getElementById('bgGlow');
    if (bgCanvas) bgCanvas.style.filter = 'blur(' + (window.S.bgBlur ?? 40) + 'px)';
    
    // Core panels plus any layer-registered ones (window._extraOpacityPanels).
    // Layers push panel IDs there so their panels follow the same Config
    // opacity/blur/border treatment as the built-ins.
    ['panelParams', 'panelSettings', 'panelAtlas', 'panelControls', 'panelConfig', 'panelEntropy', ...(window._extraOpacityPanels || [])].forEach(id => {
        const p = document.getElementById(id);
        if (!p) return;
        if (a < 0.01) {
            p.style.background = 'transparent';
            p.style.border = 'none';
            p.style.boxShadow = 'none';
            p.style.backdropFilter = 'none';
            const h = p.querySelector('.panel-head'); if (h) h.style.borderBottom = 'none';
        } else {
            const blurVal = Math.max(0, (a - 0.05) * 12.63);
            const bgAlpha = Math.max(0, (a - 0.1) * 0.5);
            // Tint RGB triples come from CSS vars so themes (e.g. the Bioclast
            // layer) can recolor panels without touching this logic. Defaults
            // reproduce the original blue-gray exactly. Because the var
            // reference lives in the inline value, changing the var on <body>
            // retints live — no need to re-run this function.
            p.style.background = 'linear-gradient(180deg,rgba(var(--panel-rgb-top,12,12,31),' + bgAlpha + '),rgba(var(--panel-rgb-bot,8,8,26),' + (bgAlpha * 0.9) + '))';
            p.style.border = '1px solid rgba(var(--panel-border-rgb,40,40,80),' + Math.min(0.6, a * 6) + ')';
            p.style.boxShadow = '0 8px 32px rgba(0, 0, 0, ' + Math.min(0.5, a * 5) + ')';
            p.style.backdropFilter = a < 0.05 ? 'none' : 'blur(' + blurVal.toFixed(1) + 'px)';
            const h = p.querySelector('.panel-head'); if (h) h.style.borderBottom = '1px solid rgba(30, 30, 60, ' + Math.min(0.5, a * 5) + ')';
        }
    });
}

export function updateUIZoom(val) {
    const v = typeof val === 'number' ? val : (window.S.uiZoom || 1.0);
    window.S.uiZoom = v;
    document.documentElement.style.setProperty('--ui-zoom', v);
    if (window.clampPanels) requestAnimationFrame(window.clampPanels);
    // Re-clamp panels so they can't be zoomed off-screen
    if (window.clampPanels) window.clampPanels();
}
window.updateUIZoom = updateUIZoom;

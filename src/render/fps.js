import { updatePO } from '../ui/index.js';

// ─── FPS / Entropy Monitor ─────────────────────────────────────────────────
// Entropy is the FPS reading INVERTED onto a 0–100 scale.
//   60+ fps  →   0  (all systems normal)
//   30  fps  →  50
//    1  fps  → 100  (full chaos)
// The dock button shows the entropy number prominently (smoothed). Clicking opens a small panel with a circular gauge plus a subtle FPS readout for users who want the raw number.

let _fpsLastTime = performance.now();
let _fpsSmoothed = 60;
let _entropySmoothed = 0;
let _fpsLastDomUpdate = 0;

export function fpsToEntropy(fps) {
    // Linear ramp 60 → 0  and  1 → 100. Clamped.
    if (fps >= 60) return 0;
    if (fps <= 1)  return 100;
    return Math.round(((60 - fps) / 59) * 100);
}

export function updateFpsMonitor() {
    const now = performance.now();
    const dt = now - _fpsLastTime;
    _fpsLastTime = now;
    // Skip only true gaps (tab-switch / alt-tab). A genuinely slow frame must
    // be allowed through — that's exactly the GPU-choke signal we want to
    // surface. Cap the instantaneous reading at a 1fps floor so a single
    // monster frame can't drive entropy past the bottom of the scale.
    if (dt <= 0) return;
    if (dt > 2000) return; // tab was backgrounded; ignore
    const instant = 1000 / Math.min(dt, 1000);
    // Lighter EMA than before (was 0.92/0.08) so real dips actually register
    // instead of being averaged into invisibility. Asymmetric: react fast to
    // slowdowns (the thing the user feels), recover gently.
    const k = instant < _fpsSmoothed ? 0.35 : 0.12;
    _fpsSmoothed = _fpsSmoothed * (1 - k) + instant * k;
    _entropySmoothed = fpsToEntropy(_fpsSmoothed);
    const fps = Math.round(_fpsSmoothed);
    window.SS_FPS = {
        fps: _fpsSmoothed,
        fpsRounded: fps,
        entropy: _entropySmoothed,
        dt,
        updatedAt: now
    };
    if (now - _fpsLastDomUpdate < 250) return;
    _fpsLastDomUpdate = now;
    
    let tier;
    // 5 entropy bands — FPS ranges match the Causmonaut / toast-data paradigm:
    //   Normal 46-60 · Warming 31-45 · Heating 21-30 · Hot 11-20 · Overload 0-10
    if      (fps >= 46) tier = 'normal';
    else if (fps >= 31) tier = 'warming';
    else if (fps >= 21) tier = 'heating';
    else if (fps >= 11) tier = 'hot';
    else                tier = 'overload';
    window.SS_FPS.tier = tier;

    // Update the dock button readout (the entropy number)
    const btnReadout = document.getElementById('dock-fps');
    if (btnReadout) {
        btnReadout.textContent = _entropySmoothed.toString();
        if (btnReadout.dataset.tier !== tier) btnReadout.dataset.tier = tier;
    }
    
    // Update the entropy panel (if open)
    const panelFps = document.getElementById('entropy-panel-fps');
    if (panelFps) panelFps.textContent = fps.toString();
    const panelEntropy = document.getElementById('entropy-panel-value');
    if (panelEntropy) {
        panelEntropy.textContent = _entropySmoothed.toString();
        panelEntropy.dataset.tier = tier;
    }
    const panelGauge = document.getElementById('entropy-panel-gauge-fill');
    if (panelGauge) {
        // SVG circle: stroke-dasharray controls the visible arc. Circumference of r=42 circle = 2πr ≈ 263.89
        const C = 263.89;
        panelGauge.style.strokeDasharray = `${(_entropySmoothed / 100) * C} ${C}`;
        panelGauge.dataset.tier = tier;
    }
}

// ─── Show / hide entropy panel ────────────────────────────────────────────
// Lazily constructed on first open. Uses the standard .panel / .panel-head /
// .panel-body structure so it gets all the same behaviors as other panels:
//   • drag via panel-head (handled by the global hud-element handler)
//   • minimize via the − toggle
//   • CRT scanlines from active theme
//   • panel opacity / button opacity / z-layering on grab
export function toggleEntropyPanel() {
    let panel = document.getElementById('panelEntropy');
    const dockBtn = document.getElementById('dock-btn-panelEntropy');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'panelEntropy';
        panel.className = 'panel';
        // Center it in PIXELS (not left:50% + translateX). The percent form
        // parsed as "50" by every parseFloat(style.left) consumer (clampPanels,
        // position save/restore), so on reopen/resize the panel got treated as
        // sitting at x=50px and snapped to the top-left, opening tall. Pixel
        // left with no transform is read correctly everywhere.
        const zoom = window.S?.uiZoom || 1.0;
        const vw = window.innerWidth / zoom;
        const pw = 200;
        const leftPx = Math.max(0, Math.round((vw - pw) / 2));
        panel.style.cssText = `left:${leftPx}px;top:auto;bottom:80px;width:${pw}px;`;
        panel.innerHTML = `
            <div class="panel-head">
                <span>Entropy</span>
                <span class="toggle" onclick="togglePanel('panelEntropy')">−</span>
            </div>
            <div class="panel-body" id="entropyBody">
                <div class="entropy-gauge-wrap">
                    <svg viewBox="0 0 100 100" class="entropy-gauge">
                        <circle cx="50" cy="50" r="42" class="entropy-gauge-track" />
                        <circle cx="50" cy="50" r="42" class="entropy-gauge-fill"
                                id="entropy-panel-gauge-fill"
                                transform="rotate(-90 50 50)" />
                    </svg>
                    <div class="entropy-panel-value" id="entropy-panel-value">0</div>
                </div>
                <div class="entropy-panel-fps-row">
                    <span class="entropy-panel-fps-label">fps</span>
                    <span class="entropy-panel-fps" id="entropy-panel-fps">60</span>
                </div>
            </div>
        `;
        const uiRoot = document.getElementById('ui-root') || document.body;
        uiRoot.appendChild(panel);
        // Wire dragging via the new head element
        if (window.attachDragToHead) window.attachDragToHead(panel.querySelector('.panel-head'));
        // Apply current panel opacity / scanlines / theme so the entropy
        // panel matches the rest of the UI on first open. Without this it
        // renders fully opaque even when other panels are translucent.
        if (typeof updatePO === 'function') updatePO();
        if (window.renderDock) window.renderDock();
    } else {
        // Toggle visibility (matches other dock buttons' behavior)
        if (window.togglePanel) window.togglePanel('panelEntropy');
    }
}
window.toggleEntropyPanel = toggleEntropyPanel;

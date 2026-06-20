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

function currentFpsSample(now) {
    const worker = window.SS_WORKER_FPS;
    if (worker && Number.isFinite(Number(worker.fps)) && now - (Number(worker.receivedAt) || 0) < 1800) {
        const fps = Math.max(0.1, Math.min(240, Number(worker.fps)));
        const entropy = Number.isFinite(Number(worker.entropy))
            ? Math.max(0, Math.min(100, Math.round(Number(worker.entropy))))
            : fpsToEntropy(fps);
        return {
            fps,
            entropy,
            dt: Number(worker.dt) || 0,
            frameMs: Number(worker.frameMs) || 0,
            source: 'worker'
        };
    }

    const dt = now - _fpsLastTime;
    _fpsLastTime = now;
    if (dt <= 0) return null;
    if (dt > 2000) return null;
    const instant = 1000 / Math.min(dt, 1000);
    const k = instant < _fpsSmoothed ? 0.35 : 0.12;
    _fpsSmoothed = _fpsSmoothed * (1 - k) + instant * k;
    return {
        fps: _fpsSmoothed,
        entropy: fpsToEntropy(_fpsSmoothed),
        dt,
        frameMs: dt,
        source: 'main'
    };
}

function fpsTier(fps) {
    if      (fps >= 46) return 'normal';
    else if (fps >= 31) return 'warming';
    else if (fps >= 21) return 'heating';
    else if (fps >= 11) return 'hot';
    return 'overload';
}

function updateFpsCounter(fps, entropy, tier, frameMs) {
    const enabled = window.S?.showFpsCounter === true;
    let el = document.getElementById('fps-counter');
    if (!enabled) {
        if (el) el.remove();
        return;
    }
    if (!el) {
        el = document.createElement('div');
        el.id = 'fps-counter';
        el.setAttribute('aria-live', 'off');
        document.body.appendChild(el);
    }
    el.dataset.tier = tier;
    const ms = Number.isFinite(Number(frameMs)) && Number(frameMs) > 0 ? `${Number(frameMs).toFixed(1)}ms` : '--ms';
    el.textContent = `FPS ${Math.round(fps)} · E ${entropy} · ${ms}`;
}

export function updateFpsMonitor() {
    const now = performance.now();
    const sample = currentFpsSample(now);
    if (!sample) return;

    _fpsSmoothed = sample.fps;
    _entropySmoothed = sample.entropy;
    const fps = Math.round(_fpsSmoothed);
    const tier = fpsTier(fps);
    window.SS_FPS = {
        fps: _fpsSmoothed,
        fpsRounded: fps,
        entropy: _entropySmoothed,
        dt: sample.dt,
        frameMs: sample.frameMs,
        source: sample.source,
        tier,
        updatedAt: now
    };

    if (now - _fpsLastDomUpdate < 250) return;
    _fpsLastDomUpdate = now;

    const btnReadout = document.getElementById('dock-fps');
    if (btnReadout) {
        btnReadout.textContent = _entropySmoothed.toString();
        btnReadout.title = `FPS ${fps} · entropy ${_entropySmoothed} · ${sample.source}`;
        if (btnReadout.dataset.tier !== tier) btnReadout.dataset.tier = tier;
    }

    const panelFps = document.getElementById('entropy-panel-fps');
    if (panelFps) panelFps.textContent = fps.toString();
    const panelEntropy = document.getElementById('entropy-panel-value');
    if (panelEntropy) {
        panelEntropy.textContent = _entropySmoothed.toString();
        panelEntropy.dataset.tier = tier;
    }
    const panelMs = document.getElementById('entropy-panel-ms');
    if (panelMs) panelMs.textContent = Number(sample.frameMs) > 0 ? Number(sample.frameMs).toFixed(1) : '--';
    const panelSource = document.getElementById('entropy-panel-source');
    if (panelSource) panelSource.textContent = sample.source;
    const panelGauge = document.getElementById('entropy-panel-gauge-fill');
    if (panelGauge) {
        const C = 263.89;
        panelGauge.style.strokeDasharray = `${(_entropySmoothed / 100) * C} ${C}`;
        panelGauge.dataset.tier = tier;
    }
    updateFpsCounter(fps, _entropySmoothed, tier, sample.frameMs);
}
window.updateFpsMonitor = updateFpsMonitor;

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
                <div class="entropy-panel-fps-row">
                    <span class="entropy-panel-fps-label">ms</span>
                    <span class="entropy-panel-fps" id="entropy-panel-ms">--</span>
                </div>
                <div class="entropy-panel-fps-row">
                    <span class="entropy-panel-fps-label">src</span>
                    <span class="entropy-panel-fps" id="entropy-panel-source">main</span>
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

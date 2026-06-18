import { showToast } from './toast.js';

// ─── Theme ─────────────────────────────────────────────────────────────────
// Applies window.S.theme + window.S.scanlines as data attributes on <body>. CSS does the rest — see the [data-theme="..."] rules in app.css.

export function applyTheme() {
    const t = window.S.theme || 'synthesist';
    document.body.setAttribute('data-theme', t);
    // Scanline opacities flow into CSS via vars; values stored in state
    const ui     = Math.max(0, Math.min(0.5, window.S.uiScanlines     ?? 0));
    const screen = Math.max(0, Math.min(0.5, window.S.screenScanlines ?? 0));
    document.body.style.setProperty('--ui-scan',     ui.toString());
    document.body.style.setProperty('--screen-scan', screen.toString());
}

export function applyButtonShape() {
    const s = window.S.buttonShape || 'hex';
    const prev = document.body.getAttribute('data-button-shape');
    document.body.setAttribute('data-button-shape', s);
    // Relayout existing radial nodes so positions match the new shape. Guarded against being called before RadialInstance is constructed (happens during early init / theme apply on boot).
    try {
        const RI = window.RadialInstance;
        if (RI && RI.instances && typeof RI.instances.forEach === 'function') {
            RI.instances.forEach(m => {
                if (m && typeof m.relayoutNodes === 'function') m.relayoutNodes();
            });
        }
    } catch (e) { /* ignore — apply is best-effort */ }
    // Show a brief toast so users know the change took effect even when no radial menu is currently open.
    if (prev && prev !== s) {
        showToast(`Radial shape: ${s === 'circle' ? 'Circle' : 'Hex'}`);
    }
}


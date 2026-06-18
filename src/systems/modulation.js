import { MODULATABLE_KEYS } from '../atlas/constants.js';

// ─── Modulation Pipeline ───────────────────────────────────────────────────
// Each parameter has a "_mod" sibling in window.S in the range [0, 1] that represents how strongly the parameter oscillates. The right-click drag UI already writes these values; this section is what makes them DO something.
// Architecture: every frame, before the engine reads window.S, we compute "effective" values into window.S_effective for any parameter with a non-zero _mod. The engine reads from window.S_effective when present, otherwise window.S. Slider UIs always read from window.S (the user's set value, not the modulated value) so dragging the slider stays predictable.
// Range cache; populated by makeSlider when each control is built. Used to compute amplitude as a percentage of the parameter's full range.
window._paramRanges = window._paramRanges || {};

window.S_effective = {};

export function updateModulation() {
    const t = performance.now() / 1000;
    for (const key of MODULATABLE_KEYS) {
        const mod = window.S[key + '_mod'] || 0;
        const row = document.querySelector(`.row[data-param-key="${key}"]`);
        if (mod <= 0.001) {
            if (window.S_effective[key] !== undefined) delete window.S_effective[key];
            if (row && row.dataset.modulating) delete row.dataset.modulating;
            continue;
        }
        const range = window._paramRanges[key];
        if (!range) continue;

        // Parameter oscillates between (base * 0.5) and (base * 1.0) so it dips down from the slider value to half of it, then back up.
        //	mod = 0   → no oscillation (handled above)
        // 	mod = 0.5 → slow oscillation at ~0.25 Hz (one cycle every 4s)
        // 	mod = 1.0 → fast oscillation at ~1.0 Hz (one cycle per second)
        // Frequency curve is linear from 0.1 Hz (at mod≈0.05) up to 1.0 Hz. Amplitude is fixed by the 50%-100%-of-base rule; mod only changes SPEED. This matches "expected" synthesizer modulation behavior.
        const base = window.S[key];
        const freq = 0.1 + mod * 0.9; // 0.1 Hz at very low mod, 1.0 Hz at max

        const phase = Math.sin(2 * Math.PI * freq * t);
        const norm = (phase + 1) * 0.5;             // 0..1
        const factor = 0.5 + norm * 0.5;            // 0.5..1.0
        let v = base * factor;
        // Clamp into the parameter's legal range
        if (v < range.min) v = range.min;
        if (v > range.max) v = range.max;
        window.S_effective[key] = v;
        if (row && row.dataset.modulating !== 'true') row.dataset.modulating = 'true';
    }
}


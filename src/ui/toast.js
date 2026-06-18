// ─── Tiny toast helper ─────────────────────────────────────────────────────
// Feedback on changes that happen "off-screen" (such as config changes that affect things the user can't currently see).
//   msg         — text to show
//   opts.color  — accent color (border + text). Defaults to theme accent.
//   opts.duration — total visible time in ms. Defaults to 2000.
//                   Longer durations are useful for one-shot warnings
//                   (seizure warning is 5000) where the user needs time
//                   to read and decide whether to continue.
function _toastAccent() {
    // Single source of truth for toast accent. Bioclast layer sets
    // body[data-bio="on"]; otherwise fall back to the theme accent. Reading
    // the attribute (not a JS global) keeps the open-core boundary clean —
    // the layer just toggles the attribute.
    if (document.body.getAttribute('data-bio') === 'on') return '#38e06a';
    return window.S.theme === 'synthesist' ? '#ffaa55' : '#50dcff';
}
export function showToast(msg, opts = {}) {
    const d = document.createElement('div');
    const accent = opts.color || _toastAccent();
    const duration = opts.duration || 2000;
    // Anchored at ~1/3 from the bottom — toasts at the top were getting lost
    // against the dock UI and hud text. This position floats over the open
    // canvas area so the message is in the user's natural focal zone.
    // The CSS animation `fadeN` runs over 2s by default; for longer-duration
    // toasts we override the animation-duration inline so the fade-out
    // happens at the end of the requested duration instead of at 2s.
    d.style.cssText = 'position:fixed;bottom:33vh;left:50%;transform:translateX(-50%);background:rgba(10,10,24,0.88);border:1px solid ' + accent + ';color:' + accent + ';padding:7px 14px;border-radius:4px;font-size:11px;font-weight:bold;z-index:1000;pointer-events:none;animation:fadeN ' + (duration / 1000) + 's forwards;letter-spacing:0.06em;text-transform:uppercase;';
    d.textContent = msg;
    document.body.appendChild(d);
    setTimeout(() => d.remove(), duration);
}
window.showToast = showToast;

// ─── Live parameter readout toast ─────────────────────────────────────────
// As the user scrubs a slider or rotates a radial, this shows the parameter
// being changed and its current value in the standard toast position. The
// user can keep their eyes on the simulation in the center of the screen
// instead of looking down at the slider to read the numeric value.
//
// Single sticky element (reused across calls, not recreated each tick) to
// avoid DOM churn during continuous scrub gestures. Auto-fades after a
// short idle period; resets the fade timer on every call so as long as
// the user is actively changing something it stays up.
//
// Borrowed from Causmonaut — same pattern, same purpose.
const _paramToastState = { el: null, fadeTimer: null };
export function showParamToast(label, value) {
    let el = _paramToastState.el;
    if (!el) {
        el = document.createElement('div');
        el.id = 'paramToast';
        document.body.appendChild(el);
        _paramToastState.el = el;
    }
    const accent = _toastAccent();
    el.style.cssText = 'position:fixed;bottom:33vh;left:50%;transform:translateX(-50%);background:rgba(10,10,24,0.88);border:1px solid ' + accent + ';color:' + accent + ';padding:7px 14px;border-radius:4px;font-size:11px;font-weight:bold;z-index:1000;pointer-events:none;letter-spacing:0.06em;text-transform:uppercase;opacity:1;transition:opacity 250ms ease;';
    el.textContent = label + ': ' + value;
    if (_paramToastState.fadeTimer) clearTimeout(_paramToastState.fadeTimer);
    // Idle fade — 800ms after the last change, dim then remove. Keeps the
    // toast up during continuous scrubs but gets out of the way after.
    _paramToastState.fadeTimer = setTimeout(() => {
        if (el) {
            el.style.opacity = '0';
            setTimeout(() => {
                if (el && el.parentNode) el.parentNode.removeChild(el);
                _paramToastState.el = null;
                _paramToastState.fadeTimer = null;
            }, 280);
        }
    }, 800);
}
window.showParamToast = showParamToast;

// Format helper — same logic as the slider's display formatter so the
// toast value matches what users see on the slider readout.
export function formatParamValue(v) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return String(v);
    if (v > 0 && v < 0.01) return v.toFixed(6);
    if (v < 1 && v > -1) return v.toFixed(3);
    if (Math.abs(v) < 100) return v.toFixed(1);
    return Math.round(v).toString();
}


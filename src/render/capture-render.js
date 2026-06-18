import { PARAM_KEYS, coordHash } from '../atlas/constants.js';

// Paint the app's background (void + radial gradient) onto a 2D canvas
// context. Used by screenshot and thumbnail paths. The on-screen #bgGlow
// is a DIV with a CSS gradient, not a canvas, so we reconstruct the
// gradient here using the same colorMode/hue/sat math as updateUniforms().
export function paintBackgroundLayer(ctx, w, h) {
    ctx.fillStyle = '#040410';
    ctx.fillRect(0, 0, w, h);

    const S = window.S;
    const bgGlowAmt = S.bgGlow ?? 0.3;
    if (bgGlowAmt <= 0.001) return;

    const mode = S.colorMode || 0;
    const hRaw = S.hue ?? 0.5;
    const sVal = Math.round((S.sat ?? 0.8) * 100);
    const h360 = Math.round(hRaw * 360);
    const hsl = (hh, ll) => `hsl(${hh}, ${sVal}%, ${ll}%)`;

    // Radial gradient anchored at center, extending to the canvas diagonal
    // so the glow reaches all corners (matches the CSS "ellipse at center
    // / sized to viewport" geometry).
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.sqrt(cx * cx + cy * cy);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);

    if (mode === 0) {
        const h2 = (h360 + 20) % 360;
        grad.addColorStop(0,    hsl(h360, 16));
        grad.addColorStop(0.5,  hsl(h2, 8));
        grad.addColorStop(0.8,  'rgba(0,0,0,0)');
    } else if (mode === 1) {
        const h2 = (h360 + 15) % 360;
        const h3 = (h360 + 30) % 360;
        grad.addColorStop(0,    hsl(h2, 18));
        grad.addColorStop(0.45, hsl(h3, 10));
        grad.addColorStop(0.7,  hsl(h360, 5));
        grad.addColorStop(0.9,  'rgba(0,0,0,0)');
    } else if (mode === 2) {
        const hLow  = (h360 - 20 + 360) % 360;
        const hHigh = (h360 + 20) % 360;
        grad.addColorStop(0,    hsl(hHigh, 18));
        grad.addColorStop(0.35, hsl(h360, 9));
        grad.addColorStop(0.75, hsl(hLow, 4));
        grad.addColorStop(0.9,  'rgba(0,0,0,0)');
    } else {
        const hCore = (h360 + 30) % 360;
        grad.addColorStop(0,    hsl(hCore, 22));
        grad.addColorStop(0.3,  hsl(h360, 12));
        grad.addColorStop(0.6,  hsl(h360, 5));
        grad.addColorStop(0.85, 'rgba(0,0,0,0)');
    }
    // CSS opacity comes from `Math.min(1, bgGlow * 1.5)` per the engine's
    // updateUniforms; mirror that here so the gradient strength in
    // captured images matches what the user sees.
    ctx.globalAlpha = Math.min(1, bgGlowAmt * 1.5);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
}

// Save a high-res PNG screenshot to the user's downloads. Filename has a
// coord hash + local-time stamp for sorting/dedup. Used by both
// captureWaypoint and captureThumbnailFor recapture — any "shutter press"
// produces a file when the toggle is on.
//
// MUST be async + render-then-read in the same frame. The WebGPU canvas is
// created with alpha:true and no preserveDrawingBuffer, so its pixels are
// only readable immediately after a render() within that frame — once the
// compositor presents, the drawing buffer is cleared and drawImage() reads
// black. captureWaypoint already does this; the dock screenshot button called
// this function bare (no render), which is why IT produced black images while
// the waypoint capture didn't. Forcing the render here fixes both callers.
export async function downloadFullResScreenshot(engine) {
    try {
        const canvas = engine.canvas;
        // Render a clean frame and read it back in the same turn. The grid is
        // suppressed during capture (updateReferenceGrid honors this flag).
        const wasCapturing = window._captureInProgress;
        window._captureInProgress = true;
        if (engine.render) await engine.render();

        const full = document.createElement('canvas');
        full.width = canvas.width;
        full.height = canvas.height;
        const fctx = full.getContext('2d');
        if (window.S.includeScreenshotBg) {
            paintBackgroundLayer(fctx, full.width, full.height);
        }
        fctx.drawImage(canvas, 0, 0, full.width, full.height);
        // Bake CRT scanlines into the screenshot if opted in. Mirrors
        // the body::after CSS pseudo-element.
        if (window.S.includeScreenshotScanlines) {
            const alpha = Math.max(0, Math.min(0.5, window.S.screenScanlines ?? 0));
            if (alpha > 0.001) {
                const isSynth = (window.S.theme || 'synthesist') === 'synthesist';
                const tint = isSynth ? '255,200,130' : '220,230,255';
                fctx.save();
                fctx.globalAlpha = alpha;
                fctx.fillStyle = `rgb(${tint})`;
                for (let y = 0; y < full.height; y += 2) {
                    fctx.fillRect(0, y, full.width, 1);
                }
                fctx.restore();
            }
        }
        const url = full.toDataURL('image/png');
        // Restore the prior capture flag so the grid reappears next frame
        // (unless a waypoint capture that set it is still mid-flight).
        window._captureInProgress = wasCapturing;
        const cid_preview = coordHash({ ...PARAM_KEYS.reduce((acc, k) => { acc[k] = window.S[k]; return acc; }, {}) });
        const dt = new Date();
        // Local-time stamp so filenames match the user's actual clock
        const pad = (n) => String(n).padStart(2, '0');
        const stamp = dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate()) +
                      'T' + pad(dt.getHours()) + '-' + pad(dt.getMinutes()) + '-' + pad(dt.getSeconds());
        const a = document.createElement('a');
        a.href = url;
        a.download = `scalespace_${cid_preview}_${stamp}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    } catch (err) {
        console.warn('[capture] screenshot save failed:', err);
        window._captureInProgress = false;
    }
}

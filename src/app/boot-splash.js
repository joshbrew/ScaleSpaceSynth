import { BOOT_ASCII } from './boot-art.js';

// ─── ASCII Boot Splash ─────────────────────────────────────────────────────

export function showBootSplash() {
    // The boot splash is a fullscreen click-catcher overlay. The ASCII art
    // lives in a centered child element; the overlay itself covers the
    // viewport so a click anywhere dismisses the splash without the click
    // also firing on whatever UI element happens to be under the cursor
    // (dock button, radial trigger, etc).
    const overlay = document.createElement('div');
    overlay.id = 'boot-overlay';
    overlay.style.cssText = [
        'position:fixed', 'inset:0',
        'pointer-events:auto', 'z-index:200',
        'cursor:default',  // default during loading; switches to pointer once interactive
        'background:#000',  // solid black under the loading state so the ASCII jerk is hidden
        // Suppress browser text-selection highlight during boot. Without this,
        // holding a key down (or dragging on touch) painted a system blue
        // selection rectangle over the ASCII as the user-agent treated the
        // <pre> as selectable text.
        'user-select:none', '-webkit-user-select:none'
    ].join(';');
    document.body.appendChild(overlay);

    // ─── Loading state ──────────────────────────────────────────────────────
    // Shows immediately on page load while the engine initializes. The
    // engine init (WebGPU device acquisition, shader compilation, buffer
    // allocation) can take 200-800ms of bursty main-thread work that would
    // otherwise stutter the ASCII type-in animation. By showing a simple
    // static text first, all the jerkiness happens behind a static curtain.
    // Absolute-positioned so it doesn't share flex layout with the ASCII
    // container — they overlap at center and crossfade independently.
    const loadingEl = document.createElement('div');
    loadingEl.id = 'boot-loading';
    loadingEl.style.cssText = [
        'position:absolute',
        'top:50%', 'left:50%',
        'transform:translate(-50%, -50%)',
        'color:rgba(255,255,255,0.7)',
        'font-family:monospace, "Courier New", "JetBrains Mono"',
        'font-size:11px', 'letter-spacing:0.3em', 'text-transform:uppercase',
        'opacity:0', 'transition:opacity 400ms ease',
        'text-shadow:0 0 8px rgba(255,255,255,0.3)',
        'pointer-events:none'
    ].join(';');
    loadingEl.textContent = 'loading…';
    overlay.appendChild(loadingEl);
    // Fade in next frame so the transition runs.
    requestAnimationFrame(() => { loadingEl.style.opacity = '1'; });

    // ─── ASCII container ────────────────────────────────────────────────────
    // ASCII art + "press any key" prompt sit inside a flex column so the
    // prompt naturally sits below the art. The container is absolute-
    // positioned and centered so it doesn't share layout with the loading
    // text. Starts at opacity:0 so it's invisible but still measurable
    // (display:inline-flex keeps it part of the layout — using display:none
    // here would zero out offsetWidth/offsetHeight, which previously broke
    // the dimension lock and caused the ASCII to wrap badly post-crossfade).
    const asciiContainer = document.createElement('div');
    asciiContainer.id = 'boot-ascii-container';
    asciiContainer.style.cssText = [
        'position:absolute',
        'top:50%', 'left:50%',
        'transform:translate(-50%, -50%)',
        'display:flex', 'flex-direction:column', 'align-items:center',
        'opacity:0', 'transition:opacity 500ms ease',
        'pointer-events:none'
    ].join(';');
    overlay.appendChild(asciiContainer);

    const el = document.createElement('pre');
    el.id = 'boot-splash';
    // Normalize: replace tabs with 4 spaces, trim trailing spaces on each line
    let art = BOOT_ASCII;
    art = art.replace(/\t/g, '    ');
    art = art.split('\n').map(line => line.replace(/\s+$/, '')).join('\n');

    el.style.cssText = [
        'color:#fff', 'font-family:monospace, "Courier New", "JetBrains Mono"',
        'font-size:11px', 'line-height:1.15', 'white-space:pre',
        'text-align:left',
        'text-shadow:0 0 8px rgba(255,255,255,0.4)', 'margin:0', 'padding:0',
        'display:inline-block'
    ].join(';');
    el.textContent = art;
    asciiContainer.appendChild(el);
    // Measure NOW while element is rendered with full text. With the
    // container at opacity:0 the box still occupies layout space, so
    // offsetWidth/offsetHeight report real values. Lock these so the
    // element stays the same size as the typer fills it in.
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    el.textContent = '';

    // "Press any key" prompt appears below the art, after typing completes.
    const prompt = document.createElement('div');
    prompt.id = 'boot-prompt';
    prompt.style.cssText = [
        'margin-top:16px',
        'pointer-events:none',
        'color:rgba(255,255,255,0.7)',
        'font-family:monospace, "Courier New", "JetBrains Mono"',
        'font-size:10px', 'letter-spacing:0.25em', 'text-transform:uppercase',
        'opacity:0', 'transition:opacity 800ms ease',
        'text-shadow:0 0 8px rgba(255,255,255,0.3)'
    ].join(';');
    prompt.textContent = '▸ press any key to begin';
    asciiContainer.appendChild(prompt);

    const lines = art.split('\n');
    let i = 0;
    const cadence = 70;
    // Track the pending typer setTimeout so dismiss can cancel it. Without
    // this, clicking during type-in left the typer running concurrently
    // with the eraser — the two would fight, producing a visible flicker
    // as one wrote lines while the other erased them.
    let typerHandle = null;
    const typer = () => {
        // Bioclast: the bioclast layer sets window.SS_BOOT_SVG, but it loads
        // AFTER init() builds this splash — so we read the flag HERE, at reveal
        // time (first frame), not at creation. Swap the measured ASCII <pre>
        // for the pixel-art SVG and fade it in; press-any-key + dismiss are shared.
        if (window.SS_BOOT_SVG && i === 0) {
            i = 1; // guard re-entry; skips the ASCII line typing entirely
            el.style.width = 'auto'; el.style.height = 'auto';
            el.style.whiteSpace = 'normal'; el.style.lineHeight = '0';
            el.innerHTML = window.SS_BOOT_SVG;
            const _svg = el.querySelector('svg');
            if (_svg) { _svg.style.width = 'min(560px, 72vw)'; _svg.style.height = 'auto'; _svg.style.display = 'block'; _svg.style.filter = 'drop-shadow(0 0 12px rgba(255,255,255,0.35))'; }
            setTimeout(() => {
                requestAnimationFrame(() => { prompt.style.opacity = '1'; });
                pulseAnim = prompt.animate([{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }], { duration: 1800, iterations: Infinity, easing: 'ease-in-out' });
                overlay.style.cursor = 'pointer';
            }, 500);
            return;
        }
        el.textContent = lines.slice(0, i + 1).join('\n');
        i++;
        if (i < lines.length) typerHandle = setTimeout(typer, cadence);
        else {
            typerHandle = null;
            // Typing done — fade in the "press any key" prompt and start
            // a gentle pulse so it reads as interactive. Stash the animation
            // handle on the outer scope so dismiss() can cancel it.
            requestAnimationFrame(() => { prompt.style.opacity = '1'; });
            pulseAnim = prompt.animate(
                [{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }],
                { duration: 1800, iterations: Infinity, easing: 'ease-in-out' }
            );
            // Now that the splash is ready for user interaction, switch the
            // overlay cursor to a pointer to signal "click to begin."
            overlay.style.cursor = 'pointer';
        }
    };
    // NOTE: typer() is NOT called here. Caller invokes the returned
    // `startTyping` function once heavy init (setupUI, Engine, renderer
    // init) is complete, so the typer's setTimeouts don't sit blocked in
    // the queue while the main thread is busy — which produced the
    // line-batching stutter.

    let pulseAnim = null;
    let dismissed = false;
    const dismiss = () => {
        if (dismissed) return;
        dismissed = true;
        // Cancel the typer FIRST so it doesn't race with the eraser. Without
        // this, mid-type clicks produced a visible flicker as the typer
        // continued to add lines that the eraser was simultaneously stripping.
        if (typerHandle) { clearTimeout(typerHandle); typerHandle = null; }
        // Fade the rest of the UI in parallel with the splash erase. By the
        // time the splash is gone, panels are fully visible (0.4s transition),
        // so the handoff is seamless.
        if (window.setUIVisibility) window.setUIVisibility(true);
        // Photosensitivity advisory — shown once on entry using the same
        // toast system as everything else. Amber accent so it reads as
        // caution rather than info. 5s duration gives enough time to read.
        // Previously this used a bespoke #strobeWarning element with its
        // own CSS keyframes — replaced with showToast so all advisories
        // share one positioning + animation system.
        if (window.showToast) {
            window.showToast('⚠ Caution: Flashing Visuals', {
                color: '#c0a070',
                duration: 5000
            });
        }
        if (pulseAnim) { try { pulseAnim.cancel(); } catch (e) {} }
        prompt.style.opacity = '0';
        // Reveal art line-by-line from the top — opposite of how it typed in.
        // Faster cadence (20ms) — user wants to get to the playspace quickly
        // and the slower 40ms felt like waiting twice.
        const dismissCadence = 20;
        const totalLines = lines.length;
        let removed = 0;
        // Keep the rendered line COUNT constant by substituting empty strings
        // for removed lines. The element's rendered height stays locked, so
        // its centered position stays locked, so the remaining ASCII rows
        // sit at the exact pixel position they were typed into.
        const eraser = () => {
            if (window.SS_BOOT_SVG) {   // SVG splash: no line-erase, just fade the container out
                asciiContainer.style.opacity = '0';
                overlay.style.pointerEvents = 'none';
                setTimeout(() => { overlay.remove(); }, 600);
                return;
            }
            removed++;
            if (removed < totalLines) {
                const remaining = lines.slice(removed);
                const padding = new Array(removed).fill('');
                el.textContent = padding.concat(remaining).join('\n');
                setTimeout(eraser, dismissCadence);
            } else {
                // Fade the whole container — both ASCII and prompt go
                // away together. Container has the opacity transition.
                asciiContainer.style.opacity = '0';
                overlay.style.pointerEvents = 'none'; // release click capture immediately
                setTimeout(() => { overlay.remove(); }, 600);
            }
        };
        eraser();
    };
    // Click on the overlay dismisses; keyboard dismiss stays on window so
    // any key works. Both use { once: true } as belt-and-suspenders against
    // double-firing — dismissed flag is the real guard.
    overlay.addEventListener('mousedown', dismiss, { once: true });
    window.addEventListener('keydown', dismiss, { once: true });

    // Return a startTyping function so the caller can defer the type-in
    // animation until heavy synchronous init has settled. See init() flow
    // for why this matters (stutter / line-batching).
    return () => {
        if (i !== 0) return;
        // Crossfade: fade out the loading text and fade in the ASCII
        // container simultaneously. Both are absolute-positioned at center,
        // so they overlap during the transition. Once the loading curtain
        // is gone, drop the overlay's black background so the canvas
        // (now rendering its first frame behind us) becomes visible
        // through the ASCII as it types in.
        loadingEl.style.opacity = '0';
        asciiContainer.style.opacity = '1';
        // Start the typer immediately — by the time the first few lines
        // appear, the crossfade has progressed enough for them to be
        // visible. Don't wait for the crossfade to fully complete.
        requestAnimationFrame(() => { typer(); });
        // Drop background after crossfade completes (matches loading
        // transition duration of 400ms + a hair).
        setTimeout(() => {
            overlay.style.background = 'transparent';
        }, 450);
    };
}


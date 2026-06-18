const MAX_ERRORS = 80;
const STATE = {
    installed: false,
    errors: [],
    lastSig: '',
    lastAt: 0,
    overlay: null,
    list: null,
};

function stringifyError(err) {
    if (!err) return 'Unknown error';
    if (typeof err === 'string') return err;
    const msg = err.message || String(err);
    const stack = err.stack ? String(err.stack).split('\n').slice(0, 7).join('\n') : '';
    return stack || msg;
}

function stateSnapshot() {
    const S = window.S || {};
    return {
        version: window.SS_VERSION || null,
        userAgent: navigator.userAgent,
        webgpu: !!navigator.gpu,
        location: location.href,
        perfProfile: S.perfProfile,
        freeEnergy: S.freeEnergy,
        showParticles: S.showParticles,
        compatParticleFallback: S.compatParticleFallback,
        compatStructureLayers: S.compatStructureLayers,
        visualEffectOn: S.visualEffectOn,
        visualEffectStyle: S.visualEffectStyle,
        colorMode: S.colorMode,
        shape: S.shape,
        zoom: window.engine?.cam?.dist,
        visibility: typeof window.debugScaleSpaceVisibility === 'function' ? window.debugScaleSpaceVisibility() : null,
    };
}

function ensureOverlay() {
    if (STATE.overlay || typeof document === 'undefined') return;
    const wrap = document.createElement('div');
    wrap.id = 'ss-error-overlay';
    wrap.style.cssText = [
        'position:fixed', 'left:10px', 'bottom:10px', 'z-index:2147483647',
        'max-width:min(560px,calc(100vw - 20px))', 'max-height:36vh', 'overflow:auto',
        'padding:10px 12px', 'border:1px solid rgba(255,110,90,.65)',
        'border-radius:8px', 'background:rgba(8,4,10,.88)', 'backdrop-filter:blur(8px)',
        'font:11px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace',
        'color:#ffd4cc', 'box-shadow:0 12px 36px rgba(0,0,0,.45)',
        'display:none'
    ].join(';');
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;gap:8px;align-items:center;justify-content:space-between;margin-bottom:6px;color:#ff9b88;font-weight:700;';
    head.textContent = 'Scale Space runtime report';
    const buttons = document.createElement('span');
    buttons.style.cssText = 'display:inline-flex;gap:6px;margin-left:10px;';
    const copy = document.createElement('button');
    copy.textContent = 'copy';
    copy.style.cssText = 'font:inherit;padding:2px 6px;border-radius:4px;border:1px solid rgba(255,180,160,.45);background:rgba(255,255,255,.06);color:#ffd4cc;cursor:pointer;';
    copy.onclick = async () => {
        const data = window.getScaleSpaceDiagnostics ? window.getScaleSpaceDiagnostics() : { errors: STATE.errors };
        try { await navigator.clipboard.writeText(JSON.stringify(data, null, 2)); copy.textContent = 'copied'; setTimeout(() => copy.textContent = 'copy', 900); }
        catch (_) { console.log('[ScaleSpace diagnostics]', data); copy.textContent = 'logged'; setTimeout(() => copy.textContent = 'copy', 900); }
    };
    const close = document.createElement('button');
    close.textContent = 'hide';
    close.style.cssText = copy.style.cssText;
    close.onclick = () => { wrap.style.display = 'none'; };
    buttons.appendChild(copy);
    buttons.appendChild(close);
    head.appendChild(buttons);
    const list = document.createElement('div');
    list.style.cssText = 'white-space:pre-wrap;';
    wrap.appendChild(head);
    wrap.appendChild(list);
    document.body.appendChild(wrap);
    STATE.overlay = wrap;
    STATE.list = list;
}

function refreshOverlay() {
    ensureOverlay();
    if (!STATE.overlay || !STATE.list) return;
    const rows = STATE.errors.slice(-5).reverse().map((e, i) => {
        const count = e.count > 1 ? ` ×${e.count}` : '';
        return `${i + 1}. [${e.tag}]${count} ${e.message}`;
    });
    STATE.list.textContent = rows.join('\n\n');
    STATE.overlay.style.display = rows.length ? 'block' : 'none';
}

export function reportScaleSpaceError(tag, err, extra = null) {
    const text = stringifyError(err);
    const message = text.split('\n')[0].slice(0, 320);
    const sig = `${tag}:${message}`;
    const now = performance.now ? performance.now() : Date.now();
    const prev = STATE.errors[STATE.errors.length - 1];
    if (STATE.lastSig === sig && now - STATE.lastAt < 1500 && prev) {
        prev.count = (prev.count || 1) + 1;
        prev.at = new Date().toISOString();
    } else {
        STATE.errors.push({ tag, message, detail: text, extra, at: new Date().toISOString(), count: 1 });
        if (STATE.errors.length > MAX_ERRORS) STATE.errors.splice(0, STATE.errors.length - MAX_ERRORS);
    }
    STATE.lastSig = sig;
    STATE.lastAt = now;
    refreshOverlay();
}

export function installScaleSpaceErrorReporting() {
    if (STATE.installed) return;
    STATE.installed = true;
    window.SS_ERROR_LOG = STATE.errors;
    window.reportScaleSpaceError = reportScaleSpaceError;
    window.getScaleSpaceDiagnostics = () => ({ snapshot: stateSnapshot(), errors: STATE.errors.slice() });
    window.addEventListener('error', (ev) => {
        reportScaleSpaceError('window.error', ev.error || ev.message, { filename: ev.filename, lineno: ev.lineno, colno: ev.colno });
    });
    window.addEventListener('unhandledrejection', (ev) => {
        reportScaleSpaceError('unhandledrejection', ev.reason || 'Unhandled promise rejection');
    });
    const rawError = console.error.bind(console);
    console.error = (...args) => {
        try {
            const first = args[0];
            const tag = typeof first === 'string' ? first.replace(/:$/, '').slice(0, 80) : 'console.error';
            const err = args.find(a => a && (a.stack || a.message)) || args.map(a => typeof a === 'string' ? a : stringifyError(a)).join(' ');
            reportScaleSpaceError(tag || 'console.error', err);
        } catch (_) {}
        rawError(...args);
    };
}

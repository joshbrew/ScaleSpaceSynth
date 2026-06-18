// makeButtonRow — multi-select pill buttons (any combination on/off).
// Contrast with makeGroupToggles, which is mutually-exclusive tabs.
// items: { label, key, cb? }. matchVal NOT supported here — pure boolean.
export function makeButtonRow(p, items) {
    const tb = document.createElement('div');
    tb.className = 'button-row';

    items.forEach((itm) => {
        const btn = document.createElement('div');
        btn.className = 'button-row-btn';

        itm.update = () => {
            const active = !!window.S[itm.key];
            btn.dataset.active = active ? '1' : '0';
        };
        itm.update();

        window._toggleUpdaters = window._toggleUpdaters || {};
        if (!window._toggleUpdaters[itm.key]) window._toggleUpdaters[itm.key] = new Set();
        window._toggleUpdaters[itm.key].add(itm.update);

        btn.textContent = itm.label;
        btn.addEventListener('click', () => {
            window.S[itm.key] = !window.S[itm.key];
            try { localStorage.setItem('ss_state', JSON.stringify(window.S)); } catch (e) {}
            // Fire all updaters registered for this key — same dispatch
            // pattern as makeGroupToggles so dependent UI (e.g. Trail
            // Length's .disabled state, Save button's enable, BG/Scanlines
            // conditional disable) reacts to the toggle uniformly.
            const upds = window._toggleUpdaters[itm.key];
            if (upds) upds.forEach(fn => { try { fn(); } catch (e) {} });
            if (itm.cb) itm.cb(window.S[itm.key]);
            // Visual effects that always need to react to state changes
            // matching the makeGroupToggles handler's responsibilities.
            if (window.engine) window.engine.updateUniforms();
        });

        tb.appendChild(btn);
    });

    p.appendChild(tb);
    return tb;
}


// makeSection(parent, labelOrKey, sub?) — section header (white headline +
// optional brand-colored subhead, no rule). labelOrKey is either an APP_TEXT
// key or raw display text.
export function makeSection(p, labelKey, sub) {
    const d = document.createElement('div');
    d.className = 'section';
    let text = labelKey;
    let subText = sub;
    if (window.APP_TEXT && window.APP_TEXT[labelKey]) {
        const val = window.APP_TEXT[labelKey];
        if (typeof val === 'object') {
            text = val.label || labelKey;
            // Auto-pull subhead from APP_TEXT if not explicitly provided.
            // Lets translators / theme authors define subheads in one place.
            if (subText === undefined && val.sub) subText = val.sub;
        } else {
            text = val;
        }
    }
    const hd = document.createElement('span');
    hd.className = 'section-head';
    hd.textContent = text;
    d.appendChild(hd);
    if (subText) {
        const sh = document.createElement('span');
        sh.className = 'section-sub';
        sh.textContent = subText;
        d.appendChild(sh);
    }
    p.appendChild(d);
    return d;
}


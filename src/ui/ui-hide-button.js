const STYLE_ID = 'ss-ui-hide-corner-style';

function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = `
#ss-ui-hide-corner {
    position: fixed;
    right: 14px;
    bottom: 14px;
    z-index: 12000;
    width: 38px;
    height: 26px;
    border: 1px solid rgba(160,190,230,0.28);
    border-radius: 4px;
    background: rgba(4, 6, 14, 0.28);
    color: rgba(205,230,255,0.42);
    font-family: inherit;
    font-size: 9px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    cursor: pointer;
    opacity: 0.32;
    backdrop-filter: blur(6px);
    transition: opacity 160ms ease, color 160ms ease, border-color 160ms ease, background 160ms ease;
}
#ss-ui-hide-corner:hover {
    opacity: 0.86;
    color: rgba(230,245,255,0.92);
    border-color: rgba(160,210,255,0.62);
    background: rgba(8, 12, 26, 0.62);
}
body.ss-ui-hidden-manual #ui-root,
body.ss-ui-hidden-manual .panel,
body.ss-ui-hidden-manual .dock,
body.ss-ui-hidden-manual #audio-source-root,
body.ss-ui-hidden-manual .audio-source-panel,
body.ss-ui-hidden-manual .hud-element:not(#ss-ui-hide-corner) {
    opacity: 0 !important;
    pointer-events: none !important;
}
body.ss-ui-hidden-manual #ss-ui-hide-corner {
    opacity: 0.48;
    color: rgba(136,255,136,0.68);
    border-color: rgba(136,255,136,0.36);
}
`;
    document.head.appendChild(st);
}

function setHidden(hidden) {
    const visible = !hidden;
    document.body.classList.toggle('ss-ui-hidden-manual', hidden);
    if (window.setUIVisibility) window.setUIVisibility(visible);
    const btn = document.getElementById('ss-ui-hide-corner');
    if (btn) {
        btn.textContent = hidden ? 'Show' : 'Hide';
        btn.title = hidden ? 'Show interface' : 'Hide interface';
    }
}

export function initUiHideButton() {
    if (document.getElementById('ss-ui-hide-corner')) return;
    injectStyle();
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'ss-ui-hide-corner';
    btn.textContent = 'Hide';
    btn.title = 'Hide interface';
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        setHidden(!document.body.classList.contains('ss-ui-hidden-manual'));
    });
    document.body.appendChild(btn);
}

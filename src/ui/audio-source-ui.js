import { AUDIO_SOURCE_LABELS } from '../audio/index.js';
import {
    applyRandomizerHistory,
    randomizeScaleSpaceSettings, getRandomizerLast10, setContinuousRandomization,
    getContinuousRandomizationState, exportScaleSpaceSettingsFile, importScaleSpaceSettingsFile
} from '../randomizer/index.js';
import { setPerformanceProfile } from '../render/performance.js';
import { VISUAL_EFFECT_STYLE_OPTIONS } from '../render/visual-style-registry.js';
import { AUDIO_2D_BACKDROP_STYLE_OPTIONS } from '../render/audio-fx-registry.js';

const STYLE_ID = 'ss-audio-source-style';
const SOURCES = ['file', 'url', 'mic', 'system'];

function _saveState() {
    try { localStorage.setItem('ss_state', JSON.stringify(window.S)); } catch (e) {}
}

function _setText(el, text) {
    if (el) el.textContent = text == null ? '' : String(text);
}

function _injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = `
.audio-source-root {
    position: relative;
    z-index: 680;
    font-family: inherit;
    pointer-events: auto;
    display: flex;
    align-items: center;
}
.audio-source-btn {
    min-width: 92px;
    height: 30px;
    padding: 0 10px;
    border: 1px solid rgba(var(--stroke-rgb), calc(0.38 * var(--btn-alpha, 1)));
    border-radius: 3px;
    background: rgba(255, 255, 255, calc(0.045 * var(--btn-alpha, 1)));
    color: rgba(230, 240, 250, calc(0.92 * var(--btn-alpha, 1)));
    font-family: inherit;
    font-size: 9px;
    line-height: 1;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    white-space: nowrap;
    cursor: pointer;
    box-shadow: 0 0 12px rgba(var(--accent-rgb), calc(0.10 * var(--btn-alpha, 1)));
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
}
.audio-source-btn[data-active="true"] {
    color: #88ff88;
    border-color: rgba(136,255,136,calc(0.7 * var(--btn-alpha, 1)));
    box-shadow: 0 0 18px rgba(136,255,136,calc(0.16 * var(--btn-alpha, 1)));
}
body[data-theme="synthesist"] .audio-source-btn {
    color: #ffe0c8;
    border-color: rgba(255, 170, 85, calc(0.42 * var(--btn-alpha, 1)));
    background: rgba(255, 170, 85, calc(0.08 * var(--btn-alpha, 1)));
    box-shadow: 0 0 12px rgba(255, 170, 85, calc(0.14 * var(--btn-alpha, 1)));
}
.audio-source-panel {
    position: fixed;
    left: 0;
    top: 0;
    right: auto;
    bottom: auto;
    width: min(300px, calc(100vw - 20px));
    min-width: 240px;
    max-width: 400px;
    box-sizing: border-box;
    z-index: 12000;
    max-height: min(82vh, calc(100vh - 64px));
    overflow: hidden;
    padding: 0;
    display: flex;
    flex-direction: column;
    border: 1px solid rgba(var(--stroke-rgb), 0.28);
    border-radius: 6px;
    background: rgba(6, 8, 18, 0.84);
    color: #cce6ff;
    box-shadow: 0 16px 38px rgba(0,0,0,0.42), inset 0 1px 0 rgba(var(--accent-rgb), 0.06);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
}
.audio-source-panel.hidden { display: none; }
.audio-source-title {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex: 0 0 auto;
    padding: 8px 12px;
    border-bottom: 1px solid rgba(var(--stroke-rgb), 0.22);
    cursor: grab;
    user-select: none;
}
.audio-source-title span:first-child {
    font-size: 10px;
    letter-spacing: 0.25em;
    text-transform: uppercase;
    color: #7a9acc;
}
.audio-source-status {
    font-size: 9px;
    color: #88ff88;
    letter-spacing: 0.05em;
    text-transform: uppercase;
}
.audio-source-body {
    flex: 1 1 auto;
    min-height: 128px;
    max-height: min(72vh, calc(100vh - 128px));
    overflow-y: auto;
    overflow-x: hidden;
    padding: 10px 12px 12px;
}
.audio-source-row {
    display: flex;
    gap: 6px;
    align-items: center;
    margin: 8px 0;
    min-width: 0;
    max-width: 100%;
}
.audio-source-row.tight-wrap {
    flex-wrap: wrap;
}
.audio-source-row > .audio-source-label {
    flex: 0 0 54px;
}
.audio-source-row > :not(.audio-source-label) {
    flex: 1 1 auto;
    min-width: 0;
}
.audio-source-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
    margin: 2px 0 10px;
}
.audio-source-mini-btn,
.audio-source-action {
    border: 1px solid var(--field-border);
    background: var(--field-bg);
    color: #cce6ff;
    border-radius: 3px;
    height: var(--ctl-h);
    font-family: inherit;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    cursor: pointer;
}
.audio-source-mini-btn:hover,
.audio-source-action:hover {
    border-color: var(--field-border-fc);
}
.audio-source-mini-btn[data-active="true"] {
    color: #88ff88;
    border-color: rgba(136,255,136,0.72);
    background: rgba(28, 52, 36, 0.68);
}
.audio-source-action.stop {
    color: #ff9a9a;
    border-color: rgba(255,120,120,0.58);
}
.audio-source-action.pause {
    color: #ffe1a8;
    border-color: rgba(255,205,120,0.68);
    background: rgba(52, 38, 18, 0.72);
}
.audio-source-file-name {
    flex: 1 1 auto;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: block;
    line-height: var(--ctl-h);
}
.audio-source-file-pick {
    flex: 0 0 auto;
    max-width: 112px;
    white-space: nowrap;
}
.audio-source-action.randomize {
    color: #ffe1a8;
    border-color: rgba(255,205,120,0.72);
    background: rgba(52, 38, 18, 0.78);
}
.audio-source-action.settings {
    color: #bfe8ff;
    border-color: var(--field-border-fc);
}
.audio-source-field.compact {
    flex: 0 0 76px;
    text-align: right;
}
.audio-source-range-wrap {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    --range-pct: 50%;
}
.audio-source-range-wrap .audio-source-field {
    flex: 1;
}
.audio-source-range-wrap input[type="range"].audio-source-field {
    height: 18px;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    appearance: none;
    -webkit-appearance: none;
    cursor: pointer;
}
.audio-source-range-wrap input[type="range"].audio-source-field::-webkit-slider-runnable-track {
    height: 7px;
    border-radius: 2px;
    background: linear-gradient(90deg, #0d3b4a 0%, #6dffb0 var(--range-pct), rgba(217,237,246,0.08) var(--range-pct), rgba(217,237,246,0.08) 100%);
    box-shadow: inset 0 0 0 1px rgba(var(--stroke-rgb), 0.08);
}
.audio-source-range-wrap input[type="range"].audio-source-field::-webkit-slider-thumb {
    appearance: none;
    -webkit-appearance: none;
    width: 11px;
    height: 11px;
    margin-top: -2px;
    border-radius: 50%;
    border: 1px solid rgba(230, 255, 245, 0.78);
    background: #6dffb0;
    box-shadow: 0 0 8px rgba(109, 255, 176, 0.45);
}
.audio-source-range-wrap input[type="range"].audio-source-field::-moz-range-track {
    height: 7px;
    border-radius: 2px;
    background: linear-gradient(90deg, #0d3b4a 0%, #6dffb0 var(--range-pct), rgba(217,237,246,0.08) var(--range-pct), rgba(217,237,246,0.08) 100%);
    box-shadow: inset 0 0 0 1px rgba(var(--stroke-rgb), 0.08);
}
.audio-source-range-wrap input[type="range"].audio-source-field::-moz-range-thumb {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    border: 1px solid rgba(230, 255, 245, 0.78);
    background: #6dffb0;
    box-shadow: 0 0 8px rgba(109, 255, 176, 0.45);
}
.audio-source-value {
    flex: 0 0 44px;
    min-width: 44px;
    height: 24px;
    line-height: 24px;
    text-align: right;
    padding: 0 6px;
    border: 1px solid var(--field-border);
    border-radius: 3px;
    background: rgba(2, 4, 12, 0.62);
    color: #ffe1a8;
    font-size: 9px;
    letter-spacing: 0.04em;
    font-variant-numeric: tabular-nums;
}
.audio-source-preset-info {
    margin: -3px 0 8px 60px;
    min-height: 28px;
    color: #9ebfe8;
    font-size: 9px;
    line-height: 1.35;
    letter-spacing: 0.02em;
}
.audio-source-preset-info strong {
    color: #ffe1a8;
    font-weight: 700;
}
.audio-source-random-note {
    flex: 1;
    min-width: 0;
    font-size: 9px;
    color: #9ebfe8;
    line-height: 1.25;
}
.audio-source-field {
    flex: 1;
    min-width: 0;
    height: var(--ctl-h);
    border: 1px solid var(--field-border);
    border-radius: 3px;
    background: var(--field-bg);
    color: #e6f0fa;
    font-size: 10px;
    padding: 0 8px;
    outline: none;
    font-family: inherit;
}
.audio-source-field:focus {
    border-color: var(--field-border-fc);
}
.audio-source-field[type="range"] {
    padding: 0;
}
.audio-source-label {
    width: 54px;
    font-size: 9px;
    color: #8ab8e8;
    text-transform: uppercase;
    letter-spacing: 0.08em;
}
.audio-source-check {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    max-width: 100%;
    font-size: 9px;
    color: #9ebfe8;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    white-space: normal;
}
.audio-source-level-wrap {
    height: 5px;
    border: 1px solid var(--field-border);
    border-radius: 999px;
    background: rgba(2,4,12,0.7);
    overflow: hidden;
    margin-top: 10px;
}
.audio-source-level {
    height: 100%;
    width: 0%;
    background: currentColor;
    color: #88ff88;
    opacity: 0.72;
}
.audio-source-help {
    margin-top: 8px;
    color: #8198b8;
    font-size: 9px;
    line-height: 1.35;
}
.audio-source-resize-handle {
    height: 7px;
    width: 100%;
    cursor: ns-resize;
    flex: 0 0 auto;
    position: relative;
    border-bottom-left-radius: inherit;
    border-bottom-right-radius: inherit;
}
.audio-source-resize-handle::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 26px;
    height: 3px;
    border-radius: 2px;
    background: rgba(var(--stroke-rgb), 0.25);
    transition: background 140ms ease, width 140ms ease;
}
.audio-source-resize-handle:hover::after,
.audio-source-resize-handle.dragging::after {
    background: rgba(var(--stroke-rgb), 0.70);
    width: 34px;
}
body[data-theme="synthesist"] .audio-source-panel {
    border-color: rgba(80, 50, 30, 0.55);
    background: rgba(20, 11, 24, 0.78);
    color: #ffe0c8;
    box-shadow: 0 0 20px rgba(255, 121, 198, 0.06), inset 0 1px 0 rgba(255, 170, 85, 0.05), 0 16px 38px rgba(0,0,0,0.42);
}
body[data-theme="synthesist"] .audio-source-title span:first-child {
    color: #ffaa55;
}
body[data-theme="synthesist"] .audio-source-label {
    color: #b08070;
}
body[data-theme="synthesist"] .audio-source-help,
body[data-theme="synthesist"] .audio-source-random-note,
body[data-theme="synthesist"] .audio-source-preset-info,
body[data-theme="synthesist"] .audio-source-check {
    color: #b08070;
}
body[data-theme="synthesist"] .audio-source-mini-btn,
body[data-theme="synthesist"] .audio-source-action,
body[data-theme="synthesist"] .audio-source-field {
    color: #f0e0d0;
}
body[data-theme="synthesist"] .audio-source-range-wrap input[type="range"].audio-source-field::-webkit-slider-runnable-track {
    background: linear-gradient(90deg, #5a2438 0%, #ffaa55 var(--range-pct), rgba(255,170,85,0.10) var(--range-pct), rgba(255,170,85,0.10) 100%);
}
body[data-theme="synthesist"] .audio-source-range-wrap input[type="range"].audio-source-field::-webkit-slider-thumb {
    border-color: rgba(255, 225, 185, 0.84);
    background: #ffaa55;
    box-shadow: 0 0 8px rgba(255, 170, 85, 0.52);
}
body[data-theme="synthesist"] .audio-source-range-wrap input[type="range"].audio-source-field::-moz-range-track {
    background: linear-gradient(90deg, #5a2438 0%, #ffaa55 var(--range-pct), rgba(255,170,85,0.10) var(--range-pct), rgba(255,170,85,0.10) 100%);
}
body[data-theme="synthesist"] .audio-source-range-wrap input[type="range"].audio-source-field::-moz-range-thumb {
    border-color: rgba(255, 225, 185, 0.84);
    background: #ffaa55;
    box-shadow: 0 0 8px rgba(255, 170, 85, 0.52);
}
`;
    document.head.appendChild(st);
}

function _mkButton(label, cls = 'audio-source-mini-btn') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = cls;
    btn.textContent = label;
    return btn;
}

function _mkSelect() {
    const select = document.createElement('select');
    select.className = 'audio-source-field';
    return select;
}

function _clampTransitionSeconds(value, fallback = 6.0) {
    const fb = Number(fallback);
    const n = Number(value);
    const v = Number.isFinite(n) ? n : (Number.isFinite(fb) ? fb : 6.0);
    return Math.max(0.1, Math.min(120, v));
}

function _formatTransitionSeconds(value) {
    const sec = _clampTransitionSeconds(value, 6.0);
    return String(Math.round(sec * 100) / 100);
}

function _transitionSecondsFrom(input, fallback) {
    const state = (typeof getContinuousRandomizationState === 'function') ? getContinuousRandomizationState() : null;
    const fb = fallback ?? window.S?.randomizerTransitionSec ?? state?.transitionSec ?? 6.0;
    const raw = input && input.value !== undefined ? String(input.value).trim() : '';
    if (!raw) return _clampTransitionSeconds(fb, 6.0);
    return _clampTransitionSeconds(Number(raw), fb);
}

function _rangeInput(value, min = 0, max = 1, step = 0.01) {
    const input = document.createElement('input');
    input.className = 'audio-source-field';
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    return input;
}

function _formatRangeValue(input) {
    if (!input) return '';
    const step = Math.abs(Number(input.step || 0.01)) || 0.01;
    const value = Number(input.value || 0);
    const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
    return Number.isFinite(value) ? value.toFixed(decimals) : String(input.value || '0');
}

function _formatTime(sec) {
    const n = Math.max(0, Number(sec) || 0);
    const m = Math.floor(n / 60);
    const s = Math.floor(n % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}

function _mkRangeRow(label, input) {
    const wrap = document.createElement('div');
    wrap.className = 'audio-source-range-wrap';
    const value = document.createElement('div');
    value.className = 'audio-source-value';
    const sync = () => {
        value.textContent = _formatRangeValue(input);
        const min = Number(input.min || 0);
        const max = Number(input.max || 1);
        const val = Number(input.value || 0);
        const pct = Number.isFinite(min) && Number.isFinite(max) && max !== min
            ? Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100))
            : 0;
        wrap.style.setProperty('--range-pct', pct.toFixed(2) + '%');
    };
    input._syncAudioSourceValue = sync;
    input.addEventListener('input', sync);
    input.addEventListener('change', sync);
    sync();
    wrap.appendChild(input);
    wrap.appendChild(value);
    return _mkRow(label, wrap);
}

function _toast(text, color = '#ffd08a') {
    if (window.showToast) window.showToast(text, { color, duration: 2200 });
}

function _summaryText(summary) {
    if (!summary) return 'applied';
    return summary.atlasSourceName ? `atlas · ${summary.atlasSourceName}` : `${summary.freeEnergy} quanta · ${summary.audioOscHz} Hz`;
}

function _mkRow(label, child) {
    const row = document.createElement('div');
    row.className = 'audio-source-row';
    const lab = document.createElement('div');
    lab.className = 'audio-source-label';
    lab.textContent = label;
    row.appendChild(lab);
    row.appendChild(child);
    return row;
}

export function initAudioSourceButton() {
    if (document.getElementById('audio-source-root')) return;
    _injectStyle();

    const root = document.createElement('div');
    root.id = 'audio-source-root';
    root.className = 'audio-source-root';

    const mainBtn = document.createElement('button');
    mainBtn.type = 'button';
    mainBtn.className = 'audio-source-btn';
    mainBtn.textContent = 'Audio Menu';
    root.appendChild(mainBtn);

    const panel = document.createElement('div');
    panel.className = 'audio-source-panel hidden';
    let audioPanelUserPositioned = false;
    // Keep the button in the dock, but lift the menu panel to <body>.
    // The dock uses transform: translateX(-50%), which creates a containing
    // block for position:fixed descendants in Chrome. When the panel lived
    // inside the dock, its fixed coordinates were dock-relative and it could
    // render off-screen / invisible. Body-level panel = real viewport coords.
    document.body.appendChild(panel);

    const title = document.createElement('div');
    title.className = 'audio-source-title';
    const titleText = document.createElement('span');
    titleText.textContent = 'Audio Menu';
    const status = document.createElement('span');
    status.className = 'audio-source-status';
    status.textContent = 'off';
    title.appendChild(titleText);
    title.appendChild(status);
    panel.appendChild(title);

    const panelBody = document.createElement('div');
    panelBody.className = 'audio-source-body';
    panel.appendChild(panelBody);

    const grid = document.createElement('div');
    grid.className = 'audio-source-grid';
    panelBody.appendChild(grid);

    const sourceBtns = new Map();
    for (const src of SOURCES) {
        const b = _mkButton(AUDIO_SOURCE_LABELS[src] || src);
        b.dataset.source = src;
        sourceBtns.set(src, b);
        grid.appendChild(b);
    }

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'audio/*,.mp3,.wav,.ogg,.m4a,.flac';
    fileInput.style.display = 'none';
    panelBody.appendChild(fileInput);

    const filePick = _mkButton('Choose File', 'audio-source-action audio-source-file-pick');
    const fileName = document.createElement('div');
    fileName.className = 'audio-source-field audio-source-file-name';
    fileName.textContent = window.S.audioFileName || 'no file selected';
    const fileWrap = document.createElement('div');
    fileWrap.style.cssText = 'display:flex;gap:6px;flex:1;min-width:0;';
    fileWrap.appendChild(fileName);
    fileWrap.appendChild(filePick);
    panelBody.appendChild(_mkRow('File', fileWrap));

    const urlInput = document.createElement('input');
    urlInput.className = 'audio-source-field';
    urlInput.type = 'url';
    urlInput.placeholder = 'https://.../audio.mp3';
    urlInput.value = window.S.audioUrl || '';
    panelBody.appendChild(_mkRow('URL', urlInput));

    const seekInput = document.createElement('input');
    seekInput.className = 'audio-source-field';
    seekInput.type = 'range';
    seekInput.min = '0';
    seekInput.max = '1';
    seekInput.step = '0.001';
    seekInput.value = '0';
    seekInput.disabled = true;
    const seekTime = document.createElement('div');
    seekTime.className = 'audio-source-seek-time';
    seekTime.textContent = '0:00 / 0:00';
    const seekWrap = document.createElement('div');
    seekWrap.className = 'audio-source-range-wrap';
    const syncSeekPct = () => {
        const min = Number(seekInput.min || 0);
        const max = Number(seekInput.max || 1);
        const val = Number(seekInput.value || 0);
        const pct = Number.isFinite(min) && Number.isFinite(max) && max !== min
            ? Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100))
            : 0;
        seekWrap.style.setProperty('--range-pct', pct.toFixed(2) + '%');
    };
    seekWrap.appendChild(seekInput);
    seekWrap.appendChild(seekTime);
    syncSeekPct();
    const seekRow = _mkRow('Seek', seekWrap);
    seekRow.style.display = 'none';
    panelBody.appendChild(seekRow);

    const micSelect = _mkSelect();
    panelBody.appendChild(_mkRow('Mic', micSelect));

    const historySelect = _mkSelect();
    panelBody.appendChild(_mkRow('Last 10', historySelect));

    const sourceModeSelect = _mkSelect();
    for (const [value, label] of [
        ['true-random', 'True Random'],
        ['atlas-codes', 'Atlas Codes'],
        ['both', 'Both'],
    ]) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        sourceModeSelect.appendChild(opt);
    }
    sourceModeSelect.value = window.S.randomizerSourceMode || 'both';
    panelBody.appendChild(_mkRow('RNG', sourceModeSelect));

    const randomWrap = document.createElement('div');
    randomWrap.style.cssText = 'display:flex;gap:6px;flex:1;min-width:0;align-items:center;';
    const randomBtn = _mkButton('Randomize Settings', 'audio-source-action randomize');
    randomBtn.style.flex = '0 0 128px';
    const randomNote = document.createElement('div');
    randomNote.className = 'audio-source-random-note';
    randomNote.textContent = 'safe stress-test reroll';
    randomWrap.appendChild(randomBtn);
    randomWrap.appendChild(randomNote);
    panelBody.appendChild(_mkRow('Test', randomWrap));

    const continuousWrap = document.createElement('div');
    continuousWrap.style.cssText = 'display:flex;gap:6px;flex:1;min-width:0;align-items:center;';
    const continuousLab = document.createElement('label');
    continuousLab.className = 'audio-source-check';
    continuousLab.style.flex = '1';
    const continuous = document.createElement('input');
    continuous.type = 'checkbox';
    continuous.checked = !!window.S.randomizerContinuous;
    continuousLab.appendChild(continuous);
    continuousLab.appendChild(document.createTextNode('Continuous random'));
    const transitionInput = document.createElement('input');
    transitionInput.className = 'audio-source-field compact';
    transitionInput.type = 'number';
    transitionInput.min = '0.1';
    transitionInput.max = '120';
    transitionInput.step = '0.25';
    transitionInput.value = _formatTransitionSeconds(window.S.randomizerTransitionSec ?? 6.0);
    const transitionSuffix = document.createElement('div');
    transitionSuffix.className = 'audio-source-label';
    transitionSuffix.style.width = '34px';
    transitionSuffix.textContent = 'sec';
    continuousWrap.appendChild(continuousLab);
    continuousWrap.appendChild(transitionInput);
    continuousWrap.appendChild(transitionSuffix);
    panelBody.appendChild(_mkRow('Auto', continuousWrap));


    const perfSelect = _mkSelect();
    for (const [value, label] of [
        ['balanced', 'Balanced'],
        ['quality', 'Quality'],
        ['speed', 'Speed'],
        ['potato', 'Potato Mode'],
    ]) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        perfSelect.appendChild(opt);
    }
    perfSelect.value = window.S.perfProfile || 'balanced';
    panelBody.appendChild(_mkRow('Perf', perfSelect));

    const settingsWrap = document.createElement('div');
    settingsWrap.style.cssText = 'display:flex;gap:6px;flex:1;min-width:0;';
    const exportSettingsBtn = _mkButton('Export', 'audio-source-action settings');
    const importSettingsBtn = _mkButton('Import', 'audio-source-action settings');
    exportSettingsBtn.style.flex = '1';
    importSettingsBtn.style.flex = '1';
    settingsWrap.appendChild(exportSettingsBtn);
    settingsWrap.appendChild(importSettingsBtn);
    panelBody.appendChild(_mkRow('JSON', settingsWrap));

    const settingsImportInput = document.createElement('input');
    settingsImportInput.type = 'file';
    settingsImportInput.accept = '.json,application/json';
    settingsImportInput.style.display = 'none';
    panelBody.appendChild(settingsImportInput);

    const hzInput = document.createElement('input');
    hzInput.className = 'audio-source-field';
    hzInput.type = 'number';
    hzInput.min = '10';
    hzInput.max = '24000';
    hzInput.step = '1';
    hzInput.value = String(window.S.audioOscHz || 220);
    hzInput.style.display = 'none';

    const volume = document.createElement('input');
    volume.className = 'audio-source-field';
    volume.type = 'range';
    volume.min = '0';
    volume.max = '1';
    volume.step = '0.01';
    volume.value = String(window.S.volume ?? 0.5);
    panelBody.appendChild(_mkRangeRow('Volume', volume));

    const optsRow = document.createElement('div');
    optsRow.className = 'audio-source-row';
    optsRow.style.justifyContent = 'space-between';
    const loopLab = document.createElement('label');
    loopLab.className = 'audio-source-check';
    const loop = document.createElement('input');
    loop.type = 'checkbox';
    loop.checked = window.S.audioLoop !== false;
    loopLab.appendChild(loop);
    loopLab.appendChild(document.createTextNode('Loop'));
    const muteLab = document.createElement('label');
    muteLab.className = 'audio-source-check';
    const mute = document.createElement('input');
    mute.type = 'checkbox';
    mute.checked = !!window.S.audioMuted;
    muteLab.appendChild(mute);
    muteLab.appendChild(document.createTextNode('Mute output'));
    optsRow.appendChild(loopLab);
    optsRow.appendChild(muteLab);
    panelBody.appendChild(optsRow);

    const optsRow2 = document.createElement('div');
    optsRow2.className = 'audio-source-row tight-wrap';
    optsRow2.style.justifyContent = 'space-between';
    const reactiveLab = document.createElement('label');
    reactiveLab.className = 'audio-source-check';
    const reactive = document.createElement('input');
    reactive.type = 'checkbox';
    reactive.checked = window.S.audioReactive !== false;
    reactiveLab.appendChild(reactive);
    reactiveLab.appendChild(document.createTextNode('Audio reactive'));
    const monitorLab = document.createElement('label');
    monitorLab.className = 'audio-source-check';
    const monitor = document.createElement('input');
    monitor.type = 'checkbox';
    monitor.checked = !!window.S.audioMonitor;
    monitorLab.appendChild(monitor);
    monitorLab.appendChild(document.createTextNode('Monitor mic/system'));
    optsRow2.appendChild(reactiveLab);
    optsRow2.appendChild(monitorLab);
    panelBody.appendChild(optsRow2);

    const fxPowerRow = document.createElement('div');
    fxPowerRow.className = 'audio-source-row';
    fxPowerRow.style.gap = '6px';
    const fxLab = document.createElement('label');
    fxLab.className = 'audio-source-check';
    const fxToggle = document.createElement('input');
    fxToggle.type = 'checkbox';
    fxToggle.checked = window.S.visualEffects !== false;
    fxLab.appendChild(fxToggle);
    fxLab.appendChild(document.createTextNode('Visualizer FX'));
    fxPowerRow.appendChild(fxLab);
    panelBody.appendChild(_mkRow('FX Power', fxPowerRow));

    const fx2DRow = document.createElement('div');
    fx2DRow.className = 'audio-source-row';
    fx2DRow.style.gap = '6px';
    const fx2DLab = document.createElement('label');
    fx2DLab.className = 'audio-source-check';
    fx2DLab.style.flex = '0 0 auto';
    const fx2DToggle = document.createElement('input');
    fx2DToggle.type = 'checkbox';
    fx2DToggle.checked = (window.S.visualEffect2DBackdrop !== false) && (window.S.visualEffectBackdrop !== false);
    fx2DLab.appendChild(fx2DToggle);
    fx2DLab.appendChild(document.createTextNode('On'));
    const fx2DSelect = _mkSelect();
    for (const [value, label] of AUDIO_2D_BACKDROP_STYLE_OPTIONS.map(({ value, label }) => [value, label])){
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        fx2DSelect.appendChild(opt);
    }
    fx2DSelect.value = window.S.visualEffect2DBackdropStyle || 'classic';
    fx2DRow.appendChild(fx2DLab);
    fx2DRow.appendChild(fx2DSelect);
    panelBody.appendChild(_mkRow('2D FX', fx2DRow));

    const fxLayerRow = document.createElement('div');
    fxLayerRow.className = 'audio-source-row';
    fxLayerRow.style.gap = '6px';
    const fx3DLab = document.createElement('label');
    fx3DLab.className = 'audio-source-check';
    fx3DLab.style.flex = '0 0 auto';
    const fx3DToggle = document.createElement('input');
    fx3DToggle.type = 'checkbox';
    fx3DToggle.checked = (window.S.visualEffectPost !== false);
    fx3DLab.appendChild(fx3DToggle);
    fx3DLab.appendChild(document.createTextNode('On'));
    const fxSelect = _mkSelect();
    for (const { value, label } of VISUAL_EFFECT_STYLE_OPTIONS) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        fxSelect.appendChild(opt);
    }
    fxSelect.value = window.S.visualEffectStyle || 'random';
    fxLayerRow.appendChild(fx3DLab);
    fxLayerRow.appendChild(fxSelect);
    panelBody.appendChild(_mkRow('3D FX', fxLayerRow));

    const fx2DMix = document.createElement('input');
    fx2DMix.className = 'audio-source-field';
    fx2DMix.type = 'range';
    fx2DMix.min = '0.05';
    fx2DMix.max = '2.5';
    fx2DMix.step = '0.01';
    fx2DMix.value = String(window.S.visualEffect2DBackdropMix ?? 1.0);
    panelBody.appendChild(_mkRangeRow('2D Bright', fx2DMix));

    const fx2DFade = _rangeInput(window.S.visualEffect2DFade ?? 0.01, 0, 1, 0.01);
    panelBody.appendChild(_mkRangeRow('2D Fade', fx2DFade));

    const fx3DFade = _rangeInput(window.S.visualEffect3DFade ?? 0.5, 0, 1, 0.01);
    panelBody.appendChild(_mkRangeRow('3D Fade', fx3DFade));

    const _animationModeSelect = (value = 'auto') => {
        const select = _mkSelect();
        const options = [
            ['auto', 'Auto'],
            ['smooth', 'Smooth'],
            ['held12', 'Held 12']
        ];
        for (const [v, label] of options) {
            const opt = document.createElement('option');
            opt.value = v;
            opt.textContent = label;
            select.appendChild(opt);
        }
        select.value = value === 'held4' ? 'held12' : (['auto', 'smooth', 'held12'].includes(value) ? value : 'auto');
        return select;
    };
    const backdropAnimationMode = _animationModeSelect(window.S.backdropAnimationMode || 'auto');
    panelBody.appendChild(_mkRow('2D Anim', backdropAnimationMode));

    const fxOptsRow = document.createElement('div');
    fxOptsRow.className = 'audio-source-row tight-wrap';
    fxOptsRow.style.justifyContent = 'space-between';
    const fxRandLab = document.createElement('label');
    fxRandLab.className = 'audio-source-check';
    const fxRand = document.createElement('input');
    fxRand.type = 'checkbox';
    fxRand.checked = window.S.visualEffectRandomize !== false;
    fxRandLab.appendChild(fxRand);
    fxRandLab.appendChild(document.createTextNode('Randomize FX'));
    const autoFxLab = document.createElement('label');
    autoFxLab.className = 'audio-source-check';
    const autoFx = document.createElement('input');
    autoFx.type = 'checkbox';
    autoFx.checked = window.S.audioAutoEnableVisuals !== false;
    autoFxLab.appendChild(autoFx);
    autoFxLab.appendChild(document.createTextNode('Auto FX on start'));
    fxOptsRow.appendChild(fxRandLab);
    fxOptsRow.appendChild(autoFxLab);
    panelBody.appendChild(fxOptsRow);

    const fxAmount = document.createElement('input');
    fxAmount.className = 'audio-source-field';
    fxAmount.type = 'range';
    fxAmount.min = '0';
    fxAmount.max = '2.5';
    fxAmount.step = '0.01';
    fxAmount.value = String(window.S.visualEffectAmount ?? 1.05);
    panelBody.appendChild(_mkRangeRow('FX Amount', fxAmount));

    const audioParticleDrive = _rangeInput(window.S.audioParticleDrive ?? 1.0, 0, 3, 0.01);
    panelBody.appendChild(_mkRangeRow('Param Drive', audioParticleDrive));

    const audioParticleMotionDrive = _rangeInput(window.S.audioParticleMotionDrive ?? 1.0, 0, 3, 0.01);
    panelBody.appendChild(_mkRangeRow('Motion Drive', audioParticleMotionDrive));

    const audioParticleColorDrive = _rangeInput(window.S.audioParticleColorDrive ?? 1.0, 0, 3, 0.01);
    panelBody.appendChild(_mkRangeRow('Color Drive', audioParticleColorDrive));

    const audioReactiveGain = _rangeInput(window.S.audioReactiveGain ?? 5.2, 0, 16, 0.01);
    panelBody.appendChild(_mkRangeRow('Input Gain', audioReactiveGain));

    const actionRow = document.createElement('div');
    actionRow.className = 'audio-source-row';
    const startBtn = _mkButton('Start', 'audio-source-action');
    const stopBtn = _mkButton('Stop', 'audio-source-action stop');
    startBtn.style.flex = '1';
    stopBtn.style.flex = '1';
    actionRow.appendChild(startBtn);
    actionRow.appendChild(stopBtn);
    panelBody.appendChild(actionRow);

    const levelWrap = document.createElement('div');
    levelWrap.className = 'audio-source-level-wrap';
    const level = document.createElement('div');
    level.className = 'audio-source-level';
    levelWrap.appendChild(level);
    panelBody.appendChild(levelWrap);

    const help = document.createElement('div');
    help.className = 'audio-source-help';
    help.textContent = 'Mute output only silences speakers. The analyser can drive the 2D backdrop and the 3D FX independently, or both at once. System Audio uses the browser share picker.';
    panelBody.appendChild(help);

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'audio-source-resize-handle';
    resizeHandle.title = 'Drag to resize · double-click to fit';
    panel.appendChild(resizeHandle);

    const dock = document.getElementById('dock');
    const uiRoot = dock || document.getElementById('ui-root') || document.body;
    uiRoot.appendChild(root);

    const AUDIO_PANEL_LAYOUT_KEY = 'ss_audio_source_panel';
    const CSS_LEN_RE = /^-?\d+(?:\.\d+)?(?:px|%)?$/;
    const safeCssLen = (value) => (typeof value === 'string' && CSS_LEN_RE.test(value)) ? value : '';

    function viewportAudioBodyCap() {
        const pad = 10;
        const titleH = title.getBoundingClientRect().height || 34;
        const handleH = resizeHandle.getBoundingClientRect().height || 7;
        return Math.max(128, window.innerHeight - pad * 2 - titleH - handleH);
    }

    function syncAudioPanelMaxHeight() {
        const pad = 10;
        panel.style.maxHeight = Math.max(180, window.innerHeight - pad * 2) + 'px';
        panelBody.style.maxHeight = viewportAudioBodyCap() + 'px';
    }

    function saveAudioPanelLayout() {
        const layout = {
            left: panel.style.left || '',
            top: panel.style.top || '',
            userPositioned: !!audioPanelUserPositioned,
            bodyH: panelBody.style.height || ''
        };
        try { localStorage.setItem(AUDIO_PANEL_LAYOUT_KEY, JSON.stringify(layout)); } catch (e) {}
    }

    function loadAudioPanelLayout() {
        try {
            const raw = localStorage.getItem(AUDIO_PANEL_LAYOUT_KEY);
            if (!raw) return;
            const layout = JSON.parse(raw);
            if (!layout || typeof layout !== 'object') return;
            const left = safeCssLen(layout.left);
            const top = safeCssLen(layout.top);
            const bodyH = safeCssLen(layout.bodyH);
            if (left) panel.style.left = left;
            if (top) panel.style.top = top;
            if (bodyH) panelBody.style.height = bodyH;
            audioPanelUserPositioned = !!layout.userPositioned && !!left && !!top;
        } catch (e) {}
    }
    loadAudioPanelLayout();

    function clampAudioPanelPosition() {
        const pad = 10;
        syncAudioPanelMaxHeight();
        const pw = Math.min(panel.offsetWidth || 300, Math.max(220, window.innerWidth - pad * 2));
        const ph = Math.min(panel.offsetHeight || panel.scrollHeight || 420, Math.max(180, window.innerHeight - pad * 2));
        const curLeft = Number.parseFloat(panel.style.left || '0');
        const curTop = Number.parseFloat(panel.style.top || '0');
        const left = Math.max(pad, Math.min(window.innerWidth - pw - pad, Number.isFinite(curLeft) ? curLeft : pad));
        const top = Math.max(pad, Math.min(window.innerHeight - ph - pad, Number.isFinite(curTop) ? curTop : pad));
        panel.style.left = left + 'px';
        panel.style.top = top + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
    }

    function placeAudioPanel() {
        if (panel.classList.contains('hidden')) return;
        const pad = 10;
        syncAudioPanelMaxHeight();
        if (audioPanelUserPositioned) {
            clampAudioPanelPosition();
            return;
        }
        const br = mainBtn.getBoundingClientRect();
        const pw = Math.min(panel.offsetWidth || 300, Math.max(220, window.innerWidth - pad * 2));
        const ph = Math.min(panel.offsetHeight || panel.scrollHeight || 420, Math.max(180, window.innerHeight - pad * 2));
        let left = br.right - pw;
        let top = br.top - ph - 8;
        if (top < pad) top = br.bottom + 8;
        left = Math.max(pad, Math.min(window.innerWidth - pw - pad, left));
        top = Math.max(pad, Math.min(window.innerHeight - ph - pad, top));
        panel.style.left = left + 'px';
        panel.style.top = top + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
    }
    window.placeAudioSourcePanel = placeAudioPanel;

    let resizeState = null;
    function targetAudioBodyHeight(clientY) {
        if (!resizeState) return panelBody.getBoundingClientRect().height;
        const dy = clientY - resizeState.startY;
        return Math.max(128, Math.min(resizeState.startH + dy, resizeState.cap));
    }
    const endResize = (commit, clientY = 0) => {
        if (!resizeState) return;
        if (commit) {
            const h = targetAudioBodyHeight(clientY);
            if (h >= resizeState.cap - 1) panelBody.style.height = '';
            else panelBody.style.height = h + 'px';
            saveAudioPanelLayout();
            clampAudioPanelPosition();
        }
        resizeState = null;
        resizeHandle.classList.remove('dragging');
        document.removeEventListener('pointermove', onAudioResizeMove);
        document.removeEventListener('pointerup', onAudioResizeUp);
        document.removeEventListener('pointercancel', onAudioResizeCancel);
    };
    function onAudioResizeMove(e) {
        if (!resizeState) return;
        panelBody.style.height = targetAudioBodyHeight(e.clientY) + 'px';
        e.preventDefault();
    }
    function onAudioResizeUp(e) { endResize(true, e.clientY); }
    function onAudioResizeCancel() { endResize(false, 0); }
    resizeHandle.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        syncAudioPanelMaxHeight();
        resizeState = {
            startY: e.clientY,
            startH: panelBody.getBoundingClientRect().height,
            cap: Math.min(panelBody.scrollHeight, viewportAudioBodyCap())
        };
        resizeHandle.classList.add('dragging');
        document.addEventListener('pointermove', onAudioResizeMove);
        document.addEventListener('pointerup', onAudioResizeUp);
        document.addEventListener('pointercancel', onAudioResizeCancel);
        e.preventDefault();
        e.stopPropagation();
    });
    resizeHandle.addEventListener('dblclick', (e) => {
        panelBody.style.height = '';
        saveAudioPanelLayout();
        clampAudioPanelPosition();
        e.preventDefault();
    });

    let dragState = null;
    title.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        const rect = panel.getBoundingClientRect();
        dragState = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
        audioPanelUserPositioned = true;
        try { title.setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault();
        e.stopPropagation();
    });
    title.addEventListener('pointermove', (e) => {
        if (!dragState) return;
        panel.style.left = (e.clientX - dragState.dx) + 'px';
        panel.style.top = (e.clientY - dragState.dy) + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        clampAudioPanelPosition();
    });
    const endDrag = (e) => {
        if (!dragState) return;
        dragState = null;
        try { title.releasePointerCapture(e.pointerId); } catch (err) {}
        saveAudioPanelLayout();
    };
    title.addEventListener('pointerup', endDrag);
    title.addEventListener('pointercancel', endDrag);
    window.addEventListener('resize', () => {
        syncAudioPanelMaxHeight();
        placeAudioPanel();
    });

    function collectState(changedKeys = null) {
        const allAudioControlKeys = [
            'audioUrl', 'audioLoop', 'audioMuted', 'audioReactive', 'audioMonitor',
            'visualEffects', 'visualEffectStyle', 'visualEffect2DBackdrop', 'visualEffectBackdrop',
            'visualEffect2DBackdropStyle', 'visualEffect2DBackdropMix', 'visualEffect2DFade',
            'visualEffect3DFade', 'visualEffectPost', 'visualEffectRandomize', 'audioAutoEnableVisuals',
            'backdropAnimationMode', 'backdropAnimationThrottle', 'backdropAnimationFps',
            'randomizerSourceMode', 'visualEffectAmount', 'audioParticleDrive',
            'audioParticleMotionDrive', 'audioParticleColorDrive', 'audioReactiveGain',
            'audioDeviceId', 'audioOscHz', 'volume', 'perfProfile'
        ];
        const editedKeys = Array.isArray(changedKeys) ? changedKeys : allAudioControlKeys;
        window.S.audioUrl = urlInput.value.trim();
        window.S.audioLoop = !!loop.checked;
        window.S.audioMuted = !!mute.checked;
        window.S.audioReactive = !!reactive.checked;
        window.S.audioMonitor = !!monitor.checked;
        window.S.visualEffects = !!fxToggle.checked;
        window.S.visualEffectStyle = fxSelect.value || 'random';
        window.S.visualEffect2DBackdrop = !!fx2DToggle.checked;
        window.S.visualEffectBackdrop = !!fx2DToggle.checked;
        window.S.visualEffect2DBackdropStyle = fx2DSelect.value || 'classic';
        window.S.visualEffect2DBackdropMix = Number(fx2DMix.value) || 1;
        window.S.visualEffect2DFade = Math.max(0, Math.min(1, Number(fx2DFade.value) || 0));
        window.S.visualEffect3DFade = Math.max(0, Math.min(1, Number(fx3DFade.value) || 0));
        window.S.visualEffectPost = !!fx3DToggle.checked;
        window.S.backdropAnimationMode = backdropAnimationMode.value === 'held4' ? 'held12' : (['auto', 'smooth', 'held12'].includes(backdropAnimationMode.value) ? backdropAnimationMode.value : 'auto');
        window.S.backdropAnimationThrottle = window.S.backdropAnimationMode === 'held12';
        window.S.backdropAnimationFps = 12;
        window.S.visualEffectRandomize = !!fxRand.checked;
        window.S.audioAutoEnableVisuals = !!autoFx.checked;
        window.S.randomizerSourceMode = ['true-random', 'atlas-codes', 'both'].includes(sourceModeSelect.value) ? sourceModeSelect.value : 'both';
        window.S.visualEffectAmount = Number(fxAmount.value) || 0;
        window.S.audioParticleDrive = Math.max(0, Math.min(3, Number(audioParticleDrive.value) || 0));
        window.S.audioParticleMotionDrive = Math.max(0, Math.min(3, Number(audioParticleMotionDrive.value) || 0));
        window.S.audioParticleColorDrive = Math.max(0, Math.min(3, Number(audioParticleColorDrive.value) || 0));
        window.S.audioReactiveGain = Math.max(0, Math.min(16, Number(audioReactiveGain.value) || 0));
        window.S.audioDeviceId = micSelect.value || '';
        window.S.audioOscHz = Number(hzInput.value) || 220;
        window.S.volume = Number(volume.value) || 0;
        window.S.perfProfile = perfSelect.value || 'balanced';
        if (window.markRandomizerLiveEdit) window.markRandomizerLiveEdit(editedKeys);
        _saveState();
        try { if (window.syncTogglesFromState) window.syncTogglesFromState(); } catch (e) {}
        try { if (window.refreshRadialUI) window.refreshRadialUI(); } catch (e) {}
        try { window.dispatchEvent(new CustomEvent('scalespace-audio-visual-state')); } catch (e) {}
        if (window.engine && typeof window.engine.updateUniforms === 'function') {
            try { window.engine.updateUniforms(); } catch (e) {}
        }
        if (window.audio) {
            if (typeof window.audio.setMuted === 'function') window.audio.setMuted(window.S.audioMuted);
            window.audio.updateVolume(window.S.volume);
        }
        return window.S;
    }

    function syncAudioFieldsFromState() {
        hzInput.value = String(window.S.audioOscHz || 220);
        volume.value = String(window.S.volume ?? 0.5);
        loop.checked = window.S.audioLoop !== false;
        mute.checked = !!window.S.audioMuted;
        reactive.checked = window.S.audioReactive !== false;
        monitor.checked = !!window.S.audioMonitor;
        fxToggle.checked = window.S.visualEffects !== false;
        fxSelect.value = window.S.visualEffectStyle || 'random';
        fx2DToggle.checked = (window.S.visualEffect2DBackdrop !== false) && (window.S.visualEffectBackdrop !== false);
        fx2DSelect.value = window.S.visualEffect2DBackdropStyle || 'classic';
        fx2DMix.value = String(window.S.visualEffect2DBackdropMix ?? 1.0);
        fx2DFade.value = String(window.S.visualEffect2DFade ?? 0.01);
        fx3DFade.value = String(window.S.visualEffect3DFade ?? 0.5);
        fx3DToggle.checked = (window.S.visualEffectPost !== false);
        backdropAnimationMode.value = window.S.backdropAnimationMode === 'held4' ? 'held12' : (['auto', 'smooth', 'held12'].includes(window.S.backdropAnimationMode) ? window.S.backdropAnimationMode : 'auto');
        if (typeof fxRand !== 'undefined') fxRand.checked = window.S.visualEffectRandomize !== false;
        if (typeof autoFx !== 'undefined') autoFx.checked = window.S.audioAutoEnableVisuals !== false;
        if (typeof sourceModeSelect !== 'undefined') sourceModeSelect.value = window.S.randomizerSourceMode || 'both';
        fxAmount.value = String(window.S.visualEffectAmount ?? 1.05);
        audioParticleDrive.value = String(window.S.audioParticleDrive ?? 1.0);
        audioParticleMotionDrive.value = String(window.S.audioParticleMotionDrive ?? 1.0);
        audioParticleColorDrive.value = String(window.S.audioParticleColorDrive ?? 1.0);
        audioReactiveGain.value = String(window.S.audioReactiveGain ?? 5.2);
        [volume, fx2DMix, fx2DFade, fx3DFade, fxAmount, audioParticleDrive, audioParticleMotionDrive, audioParticleColorDrive, audioReactiveGain].forEach((input) => {
            try { if (input && typeof input._syncAudioSourceValue === 'function') input._syncAudioSourceValue(); } catch (e) {}
        });
        const continuousState = getContinuousRandomizationState();
        if (document.activeElement !== transitionInput && !transitionInputEditing) {
            transitionInput.value = _formatTransitionSeconds(window.S.randomizerTransitionSec ?? continuousState.transitionSec ?? transitionInput.value ?? 6.0);
        }
        continuous.checked = !!(continuousState.active || window.S.randomizerContinuous);
        perfSelect.value = window.S.perfProfile || 'balanced';
    }

    function refreshHistorySelect() {
        const prev = historySelect.value;
        const history = getRandomizerLast10();
        historySelect.innerHTML = '';
        const def = document.createElement('option');
        def.value = '';
        def.textContent = history.length ? 'Recover a random roll' : 'No random rolls yet';
        historySelect.appendChild(def);
        for (const entry of history) {
            const opt = document.createElement('option');
            opt.value = entry.id;
            opt.textContent = entry.label || entry.createdAt || entry.id;
            historySelect.appendChild(opt);
        }
        historySelect.value = history.some(h => h.id === prev) ? prev : '';
    }

    let transitionInputEditing = false;

    function commitTransitionInput({ normalize = false, restart = false } = {}) {
        const sec = _transitionSecondsFrom(transitionInput, window.S.randomizerTransitionSec ?? 6.0);
        window.S.randomizerTransitionSec = sec;
        if (window.markRandomizerLiveEdit) window.markRandomizerLiveEdit('randomizerTransitionSec');
        if (normalize) transitionInput.value = _formatTransitionSeconds(sec);
        _saveState();
        if (typeof window.updateContinuousRandomizationTransitionSec === 'function') {
            try { window.updateContinuousRandomizationTransitionSec(sec); } catch (e) { console.error(e); }
        }
        if (restart && continuous.checked) setContinuousRandomization(true, { transitionSec: sec });
        return sec;
    }

    async function refreshDevices() {
        if (!window.audio || !window.audio.refreshDevices) return;
        const devices = await window.audio.refreshDevices();
        const prev = window.S.audioDeviceId || micSelect.value || '';
        micSelect.innerHTML = '';
        const def = document.createElement('option');
        def.value = '';
        def.textContent = 'Default microphone';
        micSelect.appendChild(def);
        const inputs = devices.audioinput || [];
        inputs.forEach((d, i) => {
            const opt = document.createElement('option');
            opt.value = d.deviceId || '';
            opt.textContent = d.label || `Microphone ${i + 1}`;
            micSelect.appendChild(opt);
        });
        micSelect.value = prev;
    }

    function _activeAudioCanPause(st) {
        const src = st && st.active ? st.source : '';
        return !!(st && st.active && (src === 'file' || src === 'url' || src === 'mic'));
    }

    async function startSource(src) {
        const prevSource = window.S.audioSource;
        if (src === 'system') {
            window.S.audioMonitor = false;
            window.S.audioMuted = true;
            monitor.checked = false;
            mute.checked = true;
        } else if ((src === 'file' || src === 'url' || src === 'mic') && prevSource === 'system') {
            window.S.audioMuted = false;
            mute.checked = false;
        }
        collectState();
        if (src === 'file' && !window.audio?.file) {
            window.S.audioSource = 'file';
            fileInput.click();
            updateUI();
            return;
        }
        try {
            await window.audio.setSource(src, collectState());
        } catch (e) {
            updateUI();
        }
    }


    let seekDragging = false;
    function updateSeekUI() {
        const tr = window.audio && typeof window.audio.getTransport === 'function' ? window.audio.getTransport() : null;
        const src = window.audio && window.audio.active ? window.audio.currentSource : window.S.audioSource;
        const seekable = !!(tr && tr.seekable && tr.duration > 0 && (src === 'file' || src === 'url'));
        seekRow.style.display = seekable ? '' : 'none';
        seekInput.disabled = !seekable;
        if (!seekable) {
            if (!seekDragging) seekInput.value = '0';
            syncSeekPct();
            seekTime.textContent = '0:00 / 0:00';
            return;
        }
        const dur = Math.max(0.001, Number(tr.duration) || 0.001);
        const cur = Math.max(0, Math.min(dur, Number(tr.currentTime) || 0));
        if (!seekDragging) seekInput.value = String(cur / dur);
        syncSeekPct();
        seekTime.textContent = `${_formatTime(cur)} / ${_formatTime(dur)}`;
    }

    function updateUI() {
        const st = window.audio && window.audio.getStatus ? window.audio.getStatus() : null;
        const active = !!(st && st.active);
        const paused = !!(st && st.paused);
        const src = active ? st.source : (window.S.audioSource || 'off');
        mainBtn.dataset.active = active ? 'true' : 'false';
        mainBtn.textContent = 'Audio Menu';
        status.textContent = active ? `${st.label} · ${paused ? 'paused' : st.backend}` : 'off';
        const name = window.audio?.fileName || window.S.audioFileName || 'no file selected';
        _setText(fileName, name);
        fileName.title = name;
        for (const [k, b] of sourceBtns) b.dataset.active = (k === src && active) ? 'true' : 'false';
        const canPause = _activeAudioCanPause(st);
        startBtn.textContent = canPause ? (paused ? 'Resume' : 'Pause') : 'Start';
        startBtn.classList.toggle('pause', canPause && !paused);
        updateSeekUI();
    }

    mainBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        panel.classList.toggle('hidden');
        if (!panel.classList.contains('hidden')) {
            placeAudioPanel();
            await refreshDevices();
            updateUI();
            requestAnimationFrame(placeAudioPanel);
        }
    });

    // Outside clicks close the body-mounted panel and are swallowed through
    // pointerdown + click. stopPropagation alone was not enough: the follow-up
    // click could still land on a checkbox behind the panel and make controls
    // appear to re-check themselves after closing the menu.
    let swallowOutsideClick = false;
    document.addEventListener('pointerdown', (e) => {
        if (panel.classList.contains('hidden')) return;
        if (root.contains(e.target) || panel.contains(e.target)) return;
        panel.classList.add('hidden');
        swallowOutsideClick = true;
        e.preventDefault();
        e.stopImmediatePropagation();
    }, true);
    document.addEventListener('click', (e) => {
        if (!swallowOutsideClick) return;
        swallowOutsideClick = false;
        e.preventDefault();
        e.stopImmediatePropagation();
    }, true);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') panel.classList.add('hidden');
    });
    window.addEventListener('resize', () => requestAnimationFrame(placeAudioPanel));
    window.addEventListener('orientationchange', () => setTimeout(placeAudioPanel, 80));

    for (const [src, b] of sourceBtns) {
        b.addEventListener('click', () => startSource(src));
    }

    randomBtn.addEventListener('click', async () => {
        collectState();
        const summary = await randomizeScaleSpaceSettings({
            includeAudio: true,
            includeVisuals: true,
            transitionSec: _transitionSecondsFrom(transitionInput),
            sourceMode: window.S.randomizerSourceMode,
        });
        syncAudioFieldsFromState();
        refreshHistorySelect();
        updateUI();
        _toast(`Randomized: ${_summaryText(summary)}`);
    });

    historySelect.addEventListener('change', async () => {
        const id = historySelect.value;
        if (!id) return;
        collectState();
        const summary = await applyRandomizerHistory(id, {
            includeAudio: true,
            includeVisuals: true,
            transitionSec: _transitionSecondsFrom(transitionInput),
        });
        syncAudioFieldsFromState();
        updateUI();
        _toast(`Recovered: ${_summaryText(summary)}`);
        historySelect.value = '';
    });

    continuous.addEventListener('change', () => {
        const on = !!continuous.checked;
        const sec = _transitionSecondsFrom(transitionInput);
        // Optimistic write first. collectState intentionally does not own this
        // key, so do not let a later UI sync read the old scheduler state and
        // snap the checkbox back off before setContinuousRandomization runs.
        window.S.randomizerContinuous = on;
        window.S.randomizerTransitionSec = sec;
        if (window.markRandomizerLiveEdit) window.markRandomizerLiveEdit(['randomizerContinuous', 'randomizerTransitionSec']);
        _saveState();
        try { if (window.syncTogglesFromState) window.syncTogglesFromState(); } catch (e) {}
        setContinuousRandomization(on, { transitionSec: sec });
        syncAudioFieldsFromState();
        _toast(on ? 'Continuous randomizer on' : 'Continuous randomizer off', on ? '#88ff88' : '#ff9a9a');
    });

    transitionInput.addEventListener('focus', () => {
        transitionInputEditing = true;
    });
    transitionInput.addEventListener('input', () => {
        // Save while typing so a randomizer/status sync cannot snap the field
        // back to the default 6 sec before the browser fires change/blur.
        const raw = String(transitionInput.value || '').trim();
        if (!raw || !Number.isFinite(Number(raw))) return;
        commitTransitionInput({ normalize: false, restart: false });
    });
    transitionInput.addEventListener('change', () => {
        transitionInputEditing = false;
        commitTransitionInput({ normalize: true, restart: false });
    });
    transitionInput.addEventListener('blur', () => {
        transitionInputEditing = false;
        commitTransitionInput({ normalize: true, restart: false });
    });
    transitionInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            transitionInputEditing = false;
            commitTransitionInput({ normalize: true, restart: false });
            transitionInput.blur();
        }
    });

    exportSettingsBtn.addEventListener('click', () => {
        collectState();
        exportScaleSpaceSettingsFile();
    });

    importSettingsBtn.addEventListener('click', () => settingsImportInput.click());
    settingsImportInput.addEventListener('change', async () => {
        const f = settingsImportInput.files && settingsImportInput.files[0];
        if (!f) return;
        await importScaleSpaceSettingsFile(f, { transitionSec: _transitionSecondsFrom(transitionInput) });
        settingsImportInput.value = '';
        syncAudioFieldsFromState();
        refreshHistorySelect();
        updateUI();
    });

    filePick.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
        const f = fileInput.files && fileInput.files[0];
        if (!f || !window.audio) return;
        window.audio.setFile(f);
        window.S.audioSource = 'file';
        await startSource('file');
    });

    seekInput.addEventListener('pointerdown', () => { seekDragging = true; });
    seekInput.addEventListener('pointerup', () => { seekDragging = false; });
    seekInput.addEventListener('input', () => {
        syncSeekPct();
        const tr = window.audio && typeof window.audio.getTransport === 'function' ? window.audio.getTransport() : null;
        const dur = tr && tr.duration > 0 ? tr.duration : 0;
        seekTime.textContent = `${_formatTime((Number(seekInput.value) || 0) * dur)} / ${_formatTime(dur)}`;
    });
    seekInput.addEventListener('change', () => {
        const tr = window.audio && typeof window.audio.getTransport === 'function' ? window.audio.getTransport() : null;
        const dur = tr && tr.duration > 0 ? tr.duration : 0;
        if (dur > 0 && window.audio && typeof window.audio.seek === 'function') window.audio.seek((Number(seekInput.value) || 0) * dur);
        seekDragging = false;
        syncSeekPct();
        updateSeekUI();
    });
    window.setInterval(updateSeekUI, 250);

    startBtn.addEventListener('click', async () => {
        const st = window.audio && window.audio.getStatus ? window.audio.getStatus() : null;
        if (_activeAudioCanPause(st) && window.audio) {
            if (st.paused && typeof window.audio.resume === 'function') await window.audio.resume();
            else if (!st.paused && typeof window.audio.pause === 'function') await window.audio.pause();
            updateUI();
            return;
        }
        const src = window.S.audioSource && window.S.audioSource !== 'off' ? window.S.audioSource : 'file';
        await startSource(src);
        updateUI();
    });
    stopBtn.addEventListener('click', () => {
        if (window.audio) window.audio.stop();
        updateUI();
    });

    urlInput.addEventListener('change', () => collectState(['audioUrl']));
    micSelect.addEventListener('change', () => collectState(['audioDeviceId']));
    hzInput.addEventListener('change', () => collectState(['audioOscHz']));
    loop.addEventListener('change', () => collectState(['audioLoop']));
    mute.addEventListener('change', () => collectState(['audioMuted']));
    reactive.addEventListener('change', () => collectState(['audioReactive']));
    monitor.addEventListener('change', () => collectState(['audioMonitor']));
    fxToggle.addEventListener('change', () => collectState(['visualEffects']));
    fxSelect.addEventListener('change', () => collectState(['visualEffectStyle']));
    fx2DToggle.addEventListener('change', () => collectState(['visualEffect2DBackdrop', 'visualEffectBackdrop']));
    fx2DSelect.addEventListener('change', () => collectState(['visualEffect2DBackdropStyle']));
    fx3DToggle.addEventListener('change', () => collectState(['visualEffectPost']));
    fx2DMix.addEventListener('input', () => collectState(['visualEffect2DBackdropMix']));
    fx2DFade.addEventListener('input', () => collectState(['visualEffect2DFade']));
    fx3DFade.addEventListener('input', () => collectState(['visualEffect3DFade']));
    backdropAnimationMode.addEventListener('change', () => collectState(['backdropAnimationMode', 'backdropAnimationThrottle', 'backdropAnimationFps']));
    fxRand.addEventListener('change', () => collectState(['visualEffectRandomize']));
    autoFx.addEventListener('change', () => collectState(['audioAutoEnableVisuals']));
    sourceModeSelect.addEventListener('change', () => collectState(['randomizerSourceMode']));
    fxAmount.addEventListener('input', () => collectState(['visualEffectAmount']));
    audioParticleDrive.addEventListener('input', () => collectState(['audioParticleDrive']));
    audioParticleMotionDrive.addEventListener('input', () => collectState(['audioParticleMotionDrive']));
    audioParticleColorDrive.addEventListener('input', () => collectState(['audioParticleColorDrive']));
    audioReactiveGain.addEventListener('input', () => collectState(['audioReactiveGain']));
    volume.addEventListener('input', () => collectState(['volume']));
    perfSelect.addEventListener('change', () => {
        collectState();
        setPerformanceProfile(perfSelect.value);
        _toast(`Performance: ${perfSelect.options[perfSelect.selectedIndex]?.textContent || perfSelect.value}`);
    });

    window.addEventListener('scalespace-audio-state', () => { syncAudioFieldsFromState(); updateUI(); });
    window.addEventListener('scalespace-audio-visual-state', syncAudioFieldsFromState);
    window.addEventListener('scalespace-randomized', () => { syncAudioFieldsFromState(); refreshHistorySelect(); updateUI(); });
    window.addEventListener('scalespace-randomizer-history', refreshHistorySelect);
    window.addEventListener('scalespace-randomizer-continuous', syncAudioFieldsFromState);

    let lastLevelPaint = 0;
    const tick = (now = 0) => {
        const st = window.audio && window.audio.getStatus ? window.audio.getStatus() : null;
        const active = !!(st && st.active);
        const visible = !panel.classList.contains('hidden');
        if (active || visible || now - lastLevelPaint > 500) {
            const lv = active ? Math.min(1, (st.level || 0) * 8) : 0;
            level.style.width = Math.round(lv * 100) + '%';
            lastLevelPaint = now;
        }
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    refreshHistorySelect();
    syncAudioFieldsFromState();
    refreshDevices().catch(() => {});
    updateUI();

    // Persisted continuous mode should actually resume instead of showing as
    // enabled in state while the runtime scheduler is parked. Delay one turn so
    // the panel controls and engine globals exist before the first roll.
    if (window.S.randomizerContinuous === true && !getContinuousRandomizationState().active) {
        setTimeout(() => {
            if (window.S.randomizerContinuous === true) {
                setContinuousRandomization(true, { transitionSec: window.S.randomizerTransitionSec });
            }
        }, 0);
    }
}

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
    border: 1px solid rgba(138,184,232,0.55);
    border-radius: 3px;
    background: rgba(8, 10, 22, 0.72);
    color: #cce6ff;
    font-size: 9px;
    line-height: 1;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    white-space: nowrap;
    cursor: pointer;
    box-shadow: 0 0 16px rgba(82, 150, 255, 0.08);
    backdrop-filter: blur(8px);
}
.audio-source-btn[data-active="true"] {
    color: #88ff88;
    border-color: rgba(136,255,136,0.7);
    box-shadow: 0 0 18px rgba(136,255,136,0.16);
}
.audio-source-panel {
    position: fixed;
    left: 0;
    top: 0;
    right: auto;
    bottom: auto;
    width: min(286px, calc(100vw - 20px));
    box-sizing: border-box;
    z-index: 12000;
    max-height: min(76vh, calc(100vh - 86px));
    overflow-y: auto;
    overflow-x: hidden;
    padding: 12px;
    border: 1px solid rgba(80, 110, 160, 0.62);
    border-radius: 5px;
    background: rgba(6, 8, 18, 0.9);
    color: #cce6ff;
    box-shadow: 0 16px 38px rgba(0,0,0,0.42);
    backdrop-filter: blur(12px);
}
.audio-source-panel.hidden { display: none; }
.audio-source-title {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    margin-bottom: 10px;
}
.audio-source-status {
    font-size: 9px;
    color: #88ff88;
    letter-spacing: 0.05em;
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
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
    margin: 8px 0 10px;
}
.audio-source-mini-btn,
.audio-source-action {
    border: 1px solid rgba(90, 130, 180, 0.55);
    background: rgba(18, 24, 42, 0.78);
    color: #cce6ff;
    border-radius: 3px;
    height: 28px;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    cursor: pointer;
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
    line-height: 28px;
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
    border-color: rgba(138,184,232,0.62);
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
}
.audio-source-range-wrap .audio-source-field {
    flex: 1;
}
.audio-source-value {
    flex: 0 0 44px;
    min-width: 44px;
    height: 24px;
    line-height: 24px;
    text-align: right;
    padding: 0 6px;
    border: 1px solid rgba(90, 130, 180, 0.42);
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
    height: 28px;
    border: 1px solid rgba(90, 130, 180, 0.45);
    border-radius: 3px;
    background: rgba(2, 4, 12, 0.7);
    color: #e6f0fa;
    font-size: 10px;
    padding: 0 8px;
    outline: none;
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
    border: 1px solid rgba(90,130,180,0.4);
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
    const sync = () => { value.textContent = _formatRangeValue(input); };
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

    const grid = document.createElement('div');
    grid.className = 'audio-source-grid';
    panel.appendChild(grid);

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
    panel.appendChild(fileInput);

    const filePick = _mkButton('Choose File', 'audio-source-action audio-source-file-pick');
    const fileName = document.createElement('div');
    fileName.className = 'audio-source-field audio-source-file-name';
    fileName.textContent = window.S.audioFileName || 'no file selected';
    const fileWrap = document.createElement('div');
    fileWrap.style.cssText = 'display:flex;gap:6px;flex:1;min-width:0;';
    fileWrap.appendChild(fileName);
    fileWrap.appendChild(filePick);
    panel.appendChild(_mkRow('File', fileWrap));

    const urlInput = document.createElement('input');
    urlInput.className = 'audio-source-field';
    urlInput.type = 'url';
    urlInput.placeholder = 'https://.../audio.mp3';
    urlInput.value = window.S.audioUrl || '';
    panel.appendChild(_mkRow('URL', urlInput));

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
    seekWrap.appendChild(seekInput);
    seekWrap.appendChild(seekTime);
    const seekRow = _mkRow('Seek', seekWrap);
    seekRow.style.display = 'none';
    panel.appendChild(seekRow);

    const micSelect = _mkSelect();
    panel.appendChild(_mkRow('Mic', micSelect));

    const historySelect = _mkSelect();
    panel.appendChild(_mkRow('Last 10', historySelect));

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
    panel.appendChild(_mkRow('RNG', sourceModeSelect));

    const randomWrap = document.createElement('div');
    randomWrap.style.cssText = 'display:flex;gap:6px;flex:1;min-width:0;align-items:center;';
    const randomBtn = _mkButton('Randomize Settings', 'audio-source-action randomize');
    randomBtn.style.flex = '0 0 128px';
    const randomNote = document.createElement('div');
    randomNote.className = 'audio-source-random-note';
    randomNote.textContent = 'safe stress-test reroll';
    randomWrap.appendChild(randomBtn);
    randomWrap.appendChild(randomNote);
    panel.appendChild(_mkRow('Test', randomWrap));

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
    panel.appendChild(_mkRow('Auto', continuousWrap));


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
    panel.appendChild(_mkRow('Perf', perfSelect));

    const settingsWrap = document.createElement('div');
    settingsWrap.style.cssText = 'display:flex;gap:6px;flex:1;min-width:0;';
    const exportSettingsBtn = _mkButton('Export', 'audio-source-action settings');
    const importSettingsBtn = _mkButton('Import', 'audio-source-action settings');
    exportSettingsBtn.style.flex = '1';
    importSettingsBtn.style.flex = '1';
    settingsWrap.appendChild(exportSettingsBtn);
    settingsWrap.appendChild(importSettingsBtn);
    panel.appendChild(_mkRow('JSON', settingsWrap));

    const settingsImportInput = document.createElement('input');
    settingsImportInput.type = 'file';
    settingsImportInput.accept = '.json,application/json';
    settingsImportInput.style.display = 'none';
    panel.appendChild(settingsImportInput);

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
    panel.appendChild(_mkRangeRow('Volume', volume));

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
    panel.appendChild(optsRow);

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
    panel.appendChild(optsRow2);

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
    panel.appendChild(_mkRow('FX Power', fxPowerRow));

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
    panel.appendChild(_mkRow('2D FX', fx2DRow));

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
    panel.appendChild(_mkRow('3D FX', fxLayerRow));

    const fx2DMix = document.createElement('input');
    fx2DMix.className = 'audio-source-field';
    fx2DMix.type = 'range';
    fx2DMix.min = '0.05';
    fx2DMix.max = '2.5';
    fx2DMix.step = '0.01';
    fx2DMix.value = String(window.S.visualEffect2DBackdropMix ?? 1.0);
    panel.appendChild(_mkRangeRow('2D Bright', fx2DMix));

    const fx2DFade = _rangeInput(window.S.visualEffect2DFade ?? 0.01, 0, 1, 0.01);
    panel.appendChild(_mkRangeRow('2D Fade', fx2DFade));

    const fx3DFade = _rangeInput(window.S.visualEffect3DFade ?? 0.5, 0, 1, 0.01);
    panel.appendChild(_mkRangeRow('3D Fade', fx3DFade));

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
    panel.appendChild(fxOptsRow);

    const fxAmount = document.createElement('input');
    fxAmount.className = 'audio-source-field';
    fxAmount.type = 'range';
    fxAmount.min = '0';
    fxAmount.max = '2.5';
    fxAmount.step = '0.01';
    fxAmount.value = String(window.S.visualEffectAmount ?? 1.05);
    panel.appendChild(_mkRangeRow('FX Amount', fxAmount));

    const audioParticleDrive = _rangeInput(window.S.audioParticleDrive ?? 1.0, 0, 3, 0.01);
    panel.appendChild(_mkRangeRow('Param Drive', audioParticleDrive));

    const audioParticleMotionDrive = _rangeInput(window.S.audioParticleMotionDrive ?? 1.0, 0, 3, 0.01);
    panel.appendChild(_mkRangeRow('Motion Drive', audioParticleMotionDrive));

    const audioParticleColorDrive = _rangeInput(window.S.audioParticleColorDrive ?? 1.0, 0, 3, 0.01);
    panel.appendChild(_mkRangeRow('Color Drive', audioParticleColorDrive));

    const audioReactiveGain = _rangeInput(window.S.audioReactiveGain ?? 5.2, 0, 16, 0.01);
    panel.appendChild(_mkRangeRow('Input Gain', audioReactiveGain));

    const actionRow = document.createElement('div');
    actionRow.className = 'audio-source-row';
    const startBtn = _mkButton('Start', 'audio-source-action');
    const stopBtn = _mkButton('Stop', 'audio-source-action stop');
    startBtn.style.flex = '1';
    stopBtn.style.flex = '1';
    actionRow.appendChild(startBtn);
    actionRow.appendChild(stopBtn);
    panel.appendChild(actionRow);

    const levelWrap = document.createElement('div');
    levelWrap.className = 'audio-source-level-wrap';
    const level = document.createElement('div');
    level.className = 'audio-source-level';
    levelWrap.appendChild(level);
    panel.appendChild(levelWrap);

    const help = document.createElement('div');
    help.className = 'audio-source-help';
    help.textContent = 'Mute output only silences speakers. The analyser can drive the 2D backdrop and the 3D FX independently, or both at once. System Audio uses the browser share picker.';
    panel.appendChild(help);

    const dock = document.getElementById('dock');
    const uiRoot = dock || document.getElementById('ui-root') || document.body;
    uiRoot.appendChild(root);

    function clampAudioPanelPosition() {
        const pad = 10;
        const pw = Math.min(panel.offsetWidth || 286, Math.max(220, window.innerWidth - pad * 2));
        const ph = Math.min(panel.offsetHeight || panel.scrollHeight || 420, Math.max(180, window.innerHeight - pad * 2));
        panel.style.maxHeight = Math.max(160, window.innerHeight - pad * 2) + 'px';
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
        if (audioPanelUserPositioned) {
            clampAudioPanelPosition();
            return;
        }
        const br = mainBtn.getBoundingClientRect();
        const pw = Math.min(panel.offsetWidth || 286, Math.max(220, window.innerWidth - pad * 2));
        const ph = Math.min(panel.offsetHeight || panel.scrollHeight || 420, Math.max(180, window.innerHeight - pad * 2));
        panel.style.maxHeight = Math.max(160, window.innerHeight - pad * 2) + 'px';
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
    };
    title.addEventListener('pointerup', endDrag);
    title.addEventListener('pointercancel', endDrag);

    function collectState() {
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
            seekTime.textContent = '0:00 / 0:00';
            return;
        }
        const dur = Math.max(0.001, Number(tr.duration) || 0.001);
        const cur = Math.max(0, Math.min(dur, Number(tr.currentTime) || 0));
        if (!seekDragging) seekInput.value = String(cur / dur);
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
        const tr = window.audio && typeof window.audio.getTransport === 'function' ? window.audio.getTransport() : null;
        const dur = tr && tr.duration > 0 ? tr.duration : 0;
        seekTime.textContent = `${_formatTime((Number(seekInput.value) || 0) * dur)} / ${_formatTime(dur)}`;
    });
    seekInput.addEventListener('change', () => {
        const tr = window.audio && typeof window.audio.getTransport === 'function' ? window.audio.getTransport() : null;
        const dur = tr && tr.duration > 0 ? tr.duration : 0;
        if (dur > 0 && window.audio && typeof window.audio.seek === 'function') window.audio.seek((Number(seekInput.value) || 0) * dur);
        seekDragging = false;
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

    urlInput.addEventListener('change', collectState);
    micSelect.addEventListener('change', collectState);
    hzInput.addEventListener('change', collectState);
    loop.addEventListener('change', collectState);
    mute.addEventListener('change', collectState);
    reactive.addEventListener('change', collectState);
    monitor.addEventListener('change', collectState);
    fxToggle.addEventListener('change', collectState);
    fxSelect.addEventListener('change', collectState);
    fx2DToggle.addEventListener('change', collectState);
    fx2DSelect.addEventListener('change', collectState);
    fx3DToggle.addEventListener('change', collectState);
    fx2DMix.addEventListener('input', collectState);
    fx2DFade.addEventListener('input', collectState);
    fx3DFade.addEventListener('input', collectState);
    fxRand.addEventListener('change', collectState);
    autoFx.addEventListener('change', collectState);
    sourceModeSelect.addEventListener('change', collectState);
    fxAmount.addEventListener('input', collectState);
    audioParticleDrive.addEventListener('input', collectState);
    audioParticleMotionDrive.addEventListener('input', collectState);
    audioParticleColorDrive.addEventListener('input', collectState);
    audioReactiveGain.addEventListener('input', collectState);
    volume.addEventListener('input', collectState);
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

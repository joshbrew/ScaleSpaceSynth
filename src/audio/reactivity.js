import { AUDIO_PILOT_KEYS, isAudioPilotEnabled } from './pilot.js';

const STATE = {
    level: 0,
    slow: 0,
    floor: 0.02,
    beat: 0,
    beatHold: 0,
    lastBeatAt: 0,
    hueDrift: 0,
    fxLevel: 0,
    fxBeat: 0,
    fxTension: 0,
    punch: 0,
    bass: 0,
    mid: 0,
    treble: 0,
    beatPolarity: 1,
};

function clamp(v, lo, hi) {
    const n = Number(v);
    if (!Number.isFinite(n)) return lo;
    return Math.max(lo, Math.min(hi, n));
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function finite(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function readSpectrumShape(raw, peak) {
    let bass = raw;
    let mid = raw * 0.65;
    let treble = Math.max(0, peak - raw);
    try {
        if (window.audio && typeof window.audio.getFrequencyData === 'function') {
            const data = window.audio.getFrequencyData();
            const len = data && data.length ? data.length : 0;
            if (len) {
                const avg = (a, b) => {
                    const start = Math.max(0, Math.min(len - 1, Math.floor(a * len)));
                    const end = Math.max(start + 1, Math.min(len, Math.ceil(b * len)));
                    let sum = 0;
                    for (let i = start; i < end; i++) sum += data[i] || 0;
                    return clamp(sum / ((end - start) * 255), 0, 1);
                };
                bass = avg(0.01, 0.13);
                mid = avg(0.13, 0.46);
                treble = avg(0.46, 0.92);
            }
        }
    } catch (e) { console.error(e); }

    STATE.bass = lerp(STATE.bass, bass, bass > STATE.bass ? 0.22 : 0.055);
    STATE.mid = lerp(STATE.mid, mid, mid > STATE.mid ? 0.18 : 0.050);
    STATE.treble = lerp(STATE.treble, treble, treble > STATE.treble ? 0.26 : 0.070);
    return { bass: STATE.bass, mid: STATE.mid, treble: STATE.treble };
}

function setEff(key, value) {
    if (!isAudioPilotEnabled(key)) {
        if (window.S_effective) delete window.S_effective[key];
        return;
    }
    if (!window.S_effective) window.S_effective = {};
    window.S_effective[key] = value;
}

function setDrivenEff(key, fallback, target, drive) {
    const baseValue = finite((window.S || {})[key], fallback);
    const d = clamp(finite(drive, 1), 0, 3);
    setEff(key, lerp(baseValue, target, d));
}

function clearKeys() {
    if (!window.S_effective) return;
    for (const key of AUDIO_PILOT_KEYS) {
        delete window.S_effective[key];
    }
}

function writeAudioPilotedParams(S, blow, tensionRelease, colorPulse) {
    const base = (key, fallback) => finite(S[key], fallback);
    const beat = STATE.beatHold;
    const punch = STATE.punch;
    const bass = STATE.bass;
    const mid = STATE.mid;
    const treble = STATE.treble;
    const particleDrive = clamp(finite(S.audioParticleDrive, 1.0), 0, 3);
    const motionDrive = particleDrive * clamp(finite(S.audioParticleMotionDrive, 1.0), 0, 3);
    const colorDrive = particleDrive * clamp(finite(S.audioParticleColorDrive, 1.0), 0, 3);

    // Blowout opens the field, punch makes it snap, and the band split keeps
    // the response from collapsing into one soft brightness blob.
    setDrivenEff('resolution', 0.1, clamp(base('resolution', 0.1) * (1 + blow * 1.08 + punch * 0.62 + treble * 0.42), 0.02, 24), motionDrive);
    setDrivenEff('opacity', 0.2, clamp(base('opacity', 0.2) * (1 + blow * 0.58 + bass * 0.32) + beat * 0.075 + punch * 0.045, 0.015, 1), particleDrive);
    setDrivenEff('bgGlow', 0.2, clamp(base('bgGlow', 0.2) + blow * 0.34 + beat * 0.16 + treble * 0.10, 0, 1.35), particleDrive);
    setDrivenEff('bgBlur', 40, clamp(base('bgBlur', 40) + blow * 72 + tensionRelease * 42 + bass * 34 - punch * 20, 0, 280), particleDrive);
    setDrivenEff('trailLen', 10, clamp(base('trailLen', 10) + bass * 8.0 + beat * 4.5 - tensionRelease * 3.0, 1, 30), motionDrive);
    {
        const c0 = base('coherence', 40);
        const cSign = c0 < 0 ? -1 : 1;
        const cMag = Math.abs(c0) * (1 - Math.min(0.58, tensionRelease * 0.28 + blow * 0.08 + punch * 0.10)) + mid * 8;
        setDrivenEff('coherence', 40, cSign * clamp(cMag, 3, 260), motionDrive);
    }
    setDrivenEff('scaleDepth', 1, clamp(base('scaleDepth', 1) * (1 - Math.min(0.54, tensionRelease * 0.34 + blow * 0.06)) + punch * 0.24 + bass * 0.18, 0, 8), motionDrive);
    {
        const turbBase = base('physicsEmergence', 0.0);
        const turbDrive = blow * 0.58 + tensionRelease * 0.24 + punch * 0.72 + treble * 0.38;
        const turbSign = Math.abs(turbBase) > 0.08 ? (turbBase < 0 ? -1 : 1) : STATE.beatPolarity;
        setDrivenEff('physicsEmergence', 0, clamp(turbBase + turbSign * turbDrive, -8.0, 8.0), motionDrive);
    }
    setDrivenEff('temperature', 0.5, clamp(base('temperature', 0.5) + blow * 0.24 + treble * 0.32 + punch * 0.18 - tensionRelease * 0.12, 0, 5), motionDrive);
    setDrivenEff('equilibrium', 0.01, clamp(base('equilibrium', 0.01) * (1 - Math.min(0.42, tensionRelease * 0.25)) + beat * 0.0012 + treble * 0.0024, 0.0001, 0.45), motionDrive);
    setDrivenEff('viscosity', 0.15, clamp(base('viscosity', 0.15) + tensionRelease * 0.12 - punch * 0.055, 0, 0.98), motionDrive);
    setDrivenEff('tempo', 1, clamp(base('tempo', 1) * (1 + beat * 0.16 + treble * 0.10 - tensionRelease * 0.08), 0.01, 8), motionDrive);

    STATE.hueDrift = (STATE.hueDrift + 0.0011 + STATE.fxBeat * 0.017 + treble * 0.002) % 1;
    setDrivenEff('hue', 0.5, (base('hue', 0.5) + STATE.hueDrift + colorPulse * 0.18 + treble * 0.08) % 1, colorDrive);
    setDrivenEff('sat', 0.9, clamp(base('sat', 0.9) + colorPulse * 0.86 + mid * 0.18, 0, 2.35), colorDrive);
    setDrivenEff('lightness', 0.9, clamp(base('lightness', 0.9) + colorPulse * 0.24 + punch * 0.08 - bass * 0.045, 0.35, 1.45), colorDrive);
}

export function updateAudioReactivity() {
    const S = window.S || {};
    const reactiveDisabled = S.audioReactive === false;
    if (reactiveDisabled || !window.audio || !window.audio.active) {
        STATE.level *= 0.94;
        STATE.slow *= 0.985;
        STATE.beat *= 0.92;
        STATE.beatHold *= 0.974;
        STATE.fxLevel *= 0.992;
        STATE.fxBeat *= 0.986;
        STATE.fxTension *= 0.996;
        STATE.punch *= 0.92;
        STATE.bass *= 0.96;
        STATE.mid *= 0.96;
        STATE.treble *= 0.96;
        const fxLevel = reactiveDisabled ? 0 : STATE.fxLevel;
        const fxBeat = reactiveDisabled ? 0 : STATE.fxBeat;
        const fxTension = reactiveDisabled ? 0 : STATE.fxTension;
        const smoothed = reactiveDisabled ? 0 : STATE.slow;
        const bass = reactiveDisabled ? 0 : STATE.bass;
        const mid = reactiveDisabled ? 0 : STATE.mid;
        const treble = reactiveDisabled ? 0 : STATE.treble;
        window.SS_AUDIO_FEATURES = { rms: 0, peak: 0, beat: 0, beatAge: 1, blowout: 0, tensionRelease: fxTension, smoothed, colorPhase: STATE.hueDrift || 0, fxLevel, fxBeat, punch: reactiveDisabled ? 0 : STATE.punch, bass, mid, treble };
        if (window.workerRenderer && typeof window.workerRenderer.setAudioFeatures === 'function') window.workerRenderer.setAudioFeatures(window.SS_AUDIO_FEATURES);
        if (reactiveDisabled || (STATE.level < 0.001 && STATE.slow < 0.001 && STATE.beat < 0.001 && STATE.fxLevel < 0.001 && STATE.fxTension < 0.001)) {
            clearKeys();
        } else {
            writeAudioPilotedParams(S, STATE.fxLevel, STATE.fxTension, 0);
        }
        return;
    }

    const raw = typeof window.audio.getLevel === 'function' ? window.audio.getLevel() : 0;
    const gain = finite(S.audioReactiveGain, 5.8);
    const target = clamp((raw - STATE.floor) * gain, 0, 1);

    // Slow attack prevents little transients from making the sim chatter.
    // Release is even slower so loud sections bloom and then breathe out.
    const attack = finite(S.audioReactiveAttack, 0.055);
    const release = finite(S.audioReactiveRelease, 0.012);
    STATE.level = lerp(STATE.level, target, target > STATE.level ? attack : release);
    STATE.slow = lerp(STATE.slow, STATE.level, 0.012);
    STATE.floor = lerp(STATE.floor, Math.min(raw, STATE.floor + 0.004), 0.004);

    const peak = window.audio && typeof window.audio.getPeak === 'function' ? window.audio.getPeak() : raw;
    const bands = readSpectrumShape(raw, peak);
    const now = performance.now();
    const novelty = STATE.level - STATE.slow;
    const cooldownDone = now - STATE.lastBeatAt > 180;
    const transient = Math.max(novelty, peak - STATE.slow * 0.82, bands.treble * 0.42 + bands.bass * 0.18 - STATE.slow * 0.18);
    if (cooldownDone && transient > 0.060 && STATE.level > 0.11) {
        STATE.beat = Math.min(1, transient * 6.4 + STATE.level * 0.30 + bands.bass * 0.18);
        STATE.beatHold = STATE.beat;
        STATE.punch = Math.max(STATE.punch, STATE.beat);
        STATE.beatPolarity *= -1;
        STATE.lastBeatAt = now;
    } else {
        STATE.beat *= 0.925;
        STATE.beatHold *= 0.966;
        STATE.punch *= 0.900;
    }

    const beatAge = STATE.lastBeatAt ? Math.min(1, (performance.now() - STATE.lastBeatAt) / 1000) : 1;

    const amount = clamp(finite(S.audioReactiveAmount, 1.25), 0, 3);
    const colorAmount = clamp(finite(S.audioColorBeat, 1.35), 0, 3);
    const blowTarget = clamp((STATE.level * 0.62 + STATE.beatHold * 0.92 + bands.bass * 0.36 + bands.treble * 0.16) * amount, 0, 3.1);
    const relaxAmount = clamp(finite(S.audioReactiveRelaxation, 0.72), 0, 2);
    const tensionTarget = clamp((STATE.slow * 0.78 + bands.bass * 0.30 + STATE.beatHold * 0.14) * amount * relaxAmount, 0, 1.7);
    STATE.fxLevel = lerp(STATE.fxLevel, blowTarget, blowTarget > STATE.fxLevel ? 0.092 : 0.012);
    STATE.fxBeat = lerp(STATE.fxBeat, STATE.beatHold, STATE.beatHold > STATE.fxBeat ? 0.55 : 0.026);
    STATE.fxTension = lerp(STATE.fxTension, tensionTarget, tensionTarget > STATE.fxTension ? 0.052 : 0.008);
    const blow = STATE.fxLevel;
    const tensionRelease = STATE.fxTension;
    const colorPulse = clamp((STATE.fxLevel * 0.44 + STATE.fxBeat * 1.55 + bands.treble * 0.42) * colorAmount, 0, 3.25);
    window.SS_AUDIO_FEATURES = {
        rms: raw,
        peak,
        beat: STATE.fxBeat,
        beatAge,
        bass: bands.bass,
        mid: bands.mid,
        treble: bands.treble,
        colorPhase: (STATE.hueDrift || 0) + colorPulse * 0.05,
        blowout: blow,
        tensionRelease,
        smoothed: STATE.slow,
        fxLevel: STATE.fxLevel,
        fxBeat: STATE.fxBeat,
        punch: STATE.punch,
    };
    if (window.workerRenderer && typeof window.workerRenderer.setAudioFeatures === 'function') window.workerRenderer.setAudioFeatures(window.SS_AUDIO_FEATURES);

    // Color gets an obvious beat response: hue steps on hits, saturation and
    // lightness breathe with the pulse. The drift is intentionally slow so it
    // reads like music, not a random value generator.
    writeAudioPilotedParams(S, blow, tensionRelease, colorPulse);
}

export function initAudioReactivity() {
    window._postModulationHooks = window._postModulationHooks || [];
    if (window._audioReactivityHookInstalled) return;
    window._audioReactivityHookInstalled = true;
    window._postModulationHooks.push(updateAudioReactivity);
}

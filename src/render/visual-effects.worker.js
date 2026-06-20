// Worker-side 2D audio visualizer geometry generator.
// No CanvasRenderingContext2D. It emits normalized line geometry that the
// main three/webgpu scene renders as a camera-locked backdrop.
// It now emits line geometry plus translucent fill triangles for bars/waves/blobs.

const TAU = Math.PI * 2;

const WORKER_STATE = {
  lastBeat: 0,
  lastPeakTime: -1e9,
  beatCount: 0,
  rotation: 0,
  targetRotation: 0,
  pulse: 0,
  accentStyleIndex: 0,
  accentRotation: 0,
  sceneStyleIndex: 0,
  previousSceneIndex: -1,
  sceneBlendStart: 0,
  sceneBlendDuration: 1.35,
  nextSceneTime: 0,
  activeBackdropStyle: '',
  previousBackdropStyle: '',
  backdropStyleBlendStart: 0,
  backdropStyleBlendDuration: 1.35,
  nextRotationTime: 0,
  rotationStartTime: 0,
  rotationEndTime: 0,
  rotationBase: 0,
  rotationTarget: 0,
  rotationSpinRate: 0,
  rotationWobble: 0,
  rotationMode: 0
};

const CLASSIC_SCENES = ['pasteldawn', 'pastelseaglass', 'pasteltwilight', 'pastelrosegold', 'nebulawash', 'bokehbloom', 'chromafog', 'dreamblobs', 'softwaves', 'gradientflow', 'contourveil', 'prismadrift', 'jazzhaze', 'opalbloom', 'ambientglow', 'silkflow', 'spectralmist', 'colorbursts', 'sinefield', 'cymatics', 'rings', 'oscilloscope', 'vectorscope', 'moire', 'starfield', 'nebulawash', 'bokehbloom', 'softwaves', 'gradientflow', 'contourveil', 'aurora', 'spectrum', 'trails'];
const CLASSIC_ACCENTS = ['radialbars', 'oscilloscope', 'vectorscope', 'spectrum', 'cymatics', 'starfield', 'trails'];
const TRANSITION_WAVE_SCENES = new Set(['sinefield', 'softwaves', 'gradientflow', 'contourveil', 'dreamblobs', 'nebulawash', 'bokehbloom', 'chromafog', 'prismadrift', 'jazzhaze', 'opalbloom', 'ambientglow', 'silkflow', 'spectralmist', 'colorbursts', 'cymatics', 'rings', 'oscilloscope', 'vectorscope', 'starfield', 'trails']);

function rotatePoint(x, y, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
}
function transformWriter(writer, angle = 0, scale = 1, xSkew = 0, ySkew = 0) {
  if (!angle && scale === 1 && !xSkew && !ySkew) return;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const tx = (x, y) => {
    let nx = (x * c - y * s) * scale;
    let ny = (x * s + y * c) * scale;
    nx += ny * xSkew;
    ny += nx * ySkew;
    return [clamp(nx, -3.0, 3.0), clamp(ny, -3.0, 3.0)];
  };
  const pos = writer.positions;
  for (let i = 0; i < writer.segments; i++) {
    const j = i * 4;
    const a = tx(pos[j + 0], pos[j + 1]);
    const b = tx(pos[j + 2], pos[j + 3]);
    pos[j + 0] = a[0]; pos[j + 1] = a[1]; pos[j + 2] = b[0]; pos[j + 3] = b[1];
  }
  const fpos = writer.fillPositions;
  if (fpos) {
    for (let i = 0; i < writer.triangles; i++) {
      const j = i * 6;
      const a = tx(fpos[j + 0], fpos[j + 1]);
      const b = tx(fpos[j + 2], fpos[j + 3]);
      const cc = tx(fpos[j + 4], fpos[j + 5]);
      fpos[j + 0] = a[0]; fpos[j + 1] = a[1];
      fpos[j + 2] = b[0]; fpos[j + 3] = b[1];
      fpos[j + 4] = cc[0]; fpos[j + 5] = cc[1];
    }
  }
}
function detectBeatPeak(beat, t) {
  const rising = beat > 0.54 && beat > WORKER_STATE.lastBeat + 0.08;
  const cooldown = Math.abs(t - WORKER_STATE.lastPeakTime) > 0.22;
  const peak = rising && cooldown;
  WORKER_STATE.lastBeat = beat;
  if (peak) {
    WORKER_STATE.lastPeakTime = t;
    WORKER_STATE.beatCount++;
    WORKER_STATE.pulse = 1;
    WORKER_STATE.accentStyleIndex = (WORKER_STATE.accentStyleIndex + 1) % 6;
  }
  if (t > WORKER_STATE.nextSceneTime) {
    const prevIndex = Math.abs((WORKER_STATE.sceneStyleIndex ?? 0) % CLASSIC_SCENES.length);
    const step = 1 + Math.floor(hash01(t * 0.31) * 3);
    WORKER_STATE.previousSceneIndex = prevIndex;
    WORKER_STATE.sceneStyleIndex = (WORKER_STATE.sceneStyleIndex + step) % CLASSIC_SCENES.length;
    WORKER_STATE.sceneBlendStart = t;
    WORKER_STATE.sceneBlendDuration = 4.2 + hash01(t * 6.3 + 1.7) * 2.4;
    WORKER_STATE.nextSceneTime = t + 12.0 + hash01(t * 12.1) * 10.0;
  }
  WORKER_STATE.pulse *= 0.90;
  return peak;
}

function updateBackdropRotation(t, style = '', amount = 1) {
  const s = String(style || 'classic');
  const isTextLike = s === 'matrixrain' || s === 'matrixcrawl';
  const isRadial = /cymatics|rings|vectorscope|radialbars|colorbursts|opalbloom|bokehbloom|dreamblobs|nebulawash/.test(s);
  const isGrid = /cellular|cellfield|honeycomb|moire|lattice/.test(s);

  if (!Number.isFinite(WORKER_STATE.nextRotationTime) || WORKER_STATE.nextRotationTime <= 0) {
    WORKER_STATE.nextRotationTime = t + 4.0 + hash01(t * 0.11 + 13.7) * 7.0;
  }

  if (t >= WORKER_STATE.nextRotationTime) {
    const seed = hash01(t * 0.137 + WORKER_STATE.beatCount * 0.071 + 5.31);
    const seed2 = hash01(seed * 37.13 + t * 0.019);
    const seed3 = hash01(seed2 * 53.7 + 2.0);

    WORKER_STATE.rotationStartTime = t;
    WORKER_STATE.rotationEndTime = t + 9.0 + seed2 * 18.0;
    WORKER_STATE.rotationBase = WORKER_STATE.rotation;

    const styleLimit = isTextLike ? 0.18 : isRadial ? 0.44 : isGrid ? 0.34 : 0.38;
    const intensity = clamp(0.55 + amount * 0.18, 0.45, 0.88);
    const sign = seed < 0.5 ? -1 : 1;
    WORKER_STATE.rotationTarget = sign * styleLimit * intensity * (0.42 + seed3 * 0.58);
    WORKER_STATE.rotationMode = seed < 0.22 ? 0 : seed < 0.56 ? 1 : seed < 0.82 ? 2 : 3;

    const spinLimit = isTextLike ? 0.0016 : isRadial ? 0.0048 : 0.0034;
    WORKER_STATE.rotationSpinRate = (seed2 < 0.5 ? -1 : 1) * (spinLimit * (0.35 + seed3 * 0.65));
    WORKER_STATE.rotationWobble = (isTextLike ? 0.018 : 0.045) * (0.35 + seed * 0.65);
    WORKER_STATE.nextRotationTime = WORKER_STATE.rotationEndTime + 5.0 + hash01(seed * 91.7 + t * 0.03) * 12.0;
  }

  const dur = Math.max(0.001, WORKER_STATE.rotationEndTime - WORKER_STATE.rotationStartTime);
  const k = clamp((t - WORKER_STATE.rotationStartTime) / dur, 0, 1);
  const easeIn = smoothstep(0.0, 0.24, k);
  const easeOut = 1.0 - smoothstep(0.76, 1.0, k);
  const engaged = Math.max(0, Math.min(1, easeIn * easeOut));
  const elapsed = Math.max(0, t - WORKER_STATE.rotationStartTime);

  let desired = 0;
  if (engaged > 0.001) {
    if (WORKER_STATE.rotationMode === 0) {
      desired = WORKER_STATE.rotationTarget;
    } else if (WORKER_STATE.rotationMode === 1) {
      desired = WORKER_STATE.rotationTarget + Math.sin(elapsed * 0.18) * WORKER_STATE.rotationWobble;
    } else if (WORKER_STATE.rotationMode === 2) {
      desired = WORKER_STATE.rotationBase + WORKER_STATE.rotationSpinRate * elapsed + Math.sin(elapsed * 0.11) * WORKER_STATE.rotationWobble * 0.55;
    } else {
      desired = WORKER_STATE.rotationTarget * Math.sin(k * Math.PI) + WORKER_STATE.rotationSpinRate * elapsed * 0.42;
    }
    desired *= engaged;
  }

  const styleDamp = isTextLike ? 0.58 : isGrid ? 0.82 : 1.0;
  const maxAbs = isTextLike ? 0.22 : isRadial ? 0.58 : 0.46;
  desired = clamp(desired * styleDamp, -maxAbs, maxAbs);

  const follow = 0.010 + engaged * 0.020;
  WORKER_STATE.rotation += (desired - WORKER_STATE.rotation) * follow;
  if (Math.abs(WORKER_STATE.rotation) < 0.0003 && engaged < 0.001) WORKER_STATE.rotation = 0;
  WORKER_STATE.targetRotation = desired;
  WORKER_STATE.accentRotation = WORKER_STATE.rotation;
  return WORKER_STATE.rotation;
}


function smoothstep(edge0, edge1, x) {
  const span = Number(edge1) - Number(edge0);
  if (!Number.isFinite(span) || Math.abs(span) < 1e-6) return Number(x) >= Number(edge1) ? 1 : 0;
  const t = Math.max(0, Math.min(1, (Number(x) - Number(edge0)) / span));
  return t * t * (3 - 2 * t);
}
try { globalThis.smoothstep = globalThis.smoothstep || smoothstep; } catch(e) {}

function clamp(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
function finite(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function hash01(v) {
  return ((Math.sin(v * 12.9898 + 78.233) * 43758.5453) % 1 + 1) % 1;
}

function ribbonSpanX(u, span = 1.44) {
  return -span + clamp(u, 0, 1) * span * 2.0;
}

function stableStyleFamily(style) {
  return resolveBackdropStyleFamily(style || 'classic');
}

function isMatrixLikeStyle(style) {
  const s = stableStyleFamily(style);
  return s === 'matrixrain' || s === 'matrixcrawl';
}

function isGridLikeStyle(style) {
  const s = stableStyleFamily(style);
  return s === 'cellular' || s === 'cellfield' || s === 'honeycomb' || s === 'moire' || s === 'lattice';
}

function isRadialIdentityStyle(style) {
  const s = stableStyleFamily(style);
  return s === 'cymatics' || s === 'rings' || s === 'georings' || s === 'vectorscope' || s === 'tunnel' || s === 'hyperspace' || s === 'starfield' || s === 'sacred';
}

function isRibbonIdentityStyle(style) {
  const s = stableStyleFamily(style);
  return s === 'ribbons' || s === 'trails' || s === 'lightfield' || s === 'sinefield' || s === 'softwaves' || s === 'gradientflow' || s === 'contourveil' || s === 'silkflow' || s === 'prismadrift' || s === 'jazzhaze' || s === 'oscilloscope';
}

function isLineOnlyBackdropStyle(style) {
  const s = stableStyleFamily(style);
  return s === 'vectorscope' || s === 'oscilloscope';
}

function isSoftIdentityStyle(style) {
  const s = stableStyleFamily(style);
  return s === 'dreamblobs' || s === 'nebulawash' || s === 'bokehbloom' || s === 'chromafog' || s === 'ambientglow' || s === 'spectralmist' || s === 'opalbloom';
}

function sameBackdropStyleFamily(a, b) {
  const sa = stableStyleFamily(a);
  const sb = stableStyleFamily(b);
  if (!sa || !sb) return false;
  if (sa === sb) return true;
  if (isSoftIdentityStyle(sa) && isSoftIdentityStyle(sb)) return true;
  if (isRibbonIdentityStyle(sa) && isRibbonIdentityStyle(sb)) return true;
  if (isRadialIdentityStyle(sa) && isRadialIdentityStyle(sb)) return true;
  if (isGridLikeStyle(sa) && isGridLikeStyle(sb)) return true;
  if (isMatrixLikeStyle(sa) && isMatrixLikeStyle(sb)) return true;
  return false;
}

function wantsFrostedGlassPass(style) {
  return false;
}

function preservesFillPrimitiveGeometry(style) {
  const s = stableStyleFamily(style);
  return s === 'spectrum'
    || s === 'matrixrain'
    || s === 'matrixcrawl'
    || s === 'cellular'
    || s === 'cellfield'
    || s === 'honeycomb'
    || s === 'moire'
    || s === 'lattice'
    || s === 'ribbons'
    || s === 'trails'
    || s === 'sinefield'
    || s === 'softwaves'
    || s === 'gradientflow'
    || s === 'contourveil'
    || s === 'prismadrift'
    || s === 'jazzhaze'
    || s === 'silkflow'
    || s === 'oscilloscope'
    || s === 'aurora'
    || s === 'colorbursts'
    || isRadialIdentityStyle(s)
    || isRibbonIdentityStyle(s);
}

function shouldFeatherBackdropFill(style) {
  const s = stableStyleFamily(style);
  if (preservesFillPrimitiveGeometry(s) || isMatrixLikeStyle(s) || isGridLikeStyle(s) || isSoftIdentityStyle(s)) return false;
  return /^pastel/.test(s) || s === 'nebulawash' || s === 'bokehbloom' || s === 'chromafog' || s === 'dreamblobs' || s === 'ambientglow' || s === 'spectralmist' || s === 'opalbloom';
}
function hslToRgb01(h, sat = 1, light = 0.5) {
  const hue = (((Number(h) || 0) % 1) + 1) % 1;
  const s = clamp(sat, 0, 2);
  const l = clamp(light, 0, 1);
  const c = (1 - Math.abs(2 * l - 1)) * Math.min(1, s);
  const x = c * (1 - Math.abs((hue * 6) % 2 - 1));
  const m = l - c * 0.5;
  let r = 0, g = 0, b = 0;
  const hp = hue * 6;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  return [r + m, g + m, b + m];
}

// Softer palette helpers for GPU/worker backdrops.
// The old visualizer path used broad hue sweeps, which read as cheap rainbow
// once the fill geometry got big. These helpers keep gradients in related hue
// families with small complementary accents so the backdrop can support the
// particle colors instead of fighting them.
const SOFT_HUE_OFFSETS = [0.000, 0.022, 0.050, 0.086, 0.128, 0.172, 0.218, 0.276];


const PASTEL_STYLE_DEFS = {
  pasteldawn:      { family: 'gradientflow', profile: 'gradientflow', stops: [0.950, 0.020, 0.080], satScale: 1.24, lightLift: 0.085, mix: 0.76 },
  pastelpetal:     { family: 'dreamblobs',   profile: 'dreamblobs',   stops: [0.930, 0.985, 0.055], satScale: 1.22, lightLift: 0.090, mix: 0.74 },
  pastelsorbet:    { family: 'softwaves',    profile: 'softwaves',    stops: [0.015, 0.070, 0.125], satScale: 1.20, lightLift: 0.090, mix: 0.74 },
  pastelmint:      { family: 'softwaves',    profile: 'softwaves',    stops: [0.335, 0.395, 0.460], satScale: 1.18, lightLift: 0.090, mix: 0.72 },
  pastelseaglass:  { family: 'ambientglow',  profile: 'ambientglow',  stops: [0.405, 0.470, 0.535], satScale: 1.18, lightLift: 0.082, mix: 0.70 },
  pastellagoon:    { family: 'spectralmist', profile: 'spectralmist', stops: [0.455, 0.515, 0.585], satScale: 1.18, lightLift: 0.082, mix: 0.72 },
  pastellilac:     { family: 'contourveil',  profile: 'contourveil',  stops: [0.720, 0.775, 0.835], satScale: 1.18, lightLift: 0.085, mix: 0.72 },
  pastelorchid:    { family: 'jazzhaze',     profile: 'jazzhaze',     stops: [0.815, 0.875, 0.940], satScale: 1.22, lightLift: 0.080, mix: 0.74 },
  pastelrosegold:  { family: 'opalbloom',    profile: 'opalbloom',    stops: [0.940, 0.995, 0.070], satScale: 1.18, lightLift: 0.082, mix: 0.72 },
  pastelcitrus:    { family: 'colorbursts',  profile: 'colorbursts',  stops: [0.095, 0.055, 0.015], satScale: 1.22, lightLift: 0.078, mix: 0.70 },
  pastelfoam:      { family: 'bokehbloom',   profile: 'ambientglow',  stops: [0.155, 0.240, 0.320], satScale: 1.16, lightLift: 0.090, mix: 0.70 },
  pasteltwilight:  { family: 'nebulawash',   profile: 'nebulawash',   stops: [0.625, 0.705, 0.790], satScale: 1.18, lightLift: 0.080, mix: 0.72 },
};

function resolveBackdropStyleFamily(style) {
  const s = String(style || 'classic');
  return PASTEL_STYLE_DEFS[s]?.family || s;
}

function resolveBackdropProfileStyle(style) {
  const s = String(style || 'classic');
  return PASTEL_STYLE_DEFS[s]?.profile || resolveBackdropStyleFamily(s);
}

function softHue(base, phase = 0, band = 0, accent = 0) {
  const idx = Math.abs(Math.floor((Number(phase) || 0) * SOFT_HUE_OFFSETS.length)) % SOFT_HUE_OFFSETS.length;
  const nearby = SOFT_HUE_OFFSETS[idx] * 0.68;
  const tinyDrift = Math.sin((Number(phase) || 0) * 6.283 + band * 2.7) * 0.009;
  return wrapHue01(base + nearby + tinyDrift + band * 0.020 + accent * 0.42);
}
function softSat(sat, mult = 1) {
  return clamp((Number(sat) || 1) * mult, 0.24, 1.45);
}
function softLight(light, mult = 1, lift = 0) {
  return clamp((Number(light) || 0.5) * mult + lift, 0.02, 0.96);
}
function wrapHue01(h) {
  return (((Number(h) || 0) % 1) + 1) % 1;
}

function unwrapHueAround(h, ref) {
  let d = wrapHue01(h) - wrapHue01(ref);
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return ref + d;
}
function compressHueStops(stops, factor = 0.56) {
  const center = unwrapHueAround(stops[1], stops[1]);
  return stops.map((h) => wrapHue01(center + (unwrapHueAround(h, center) - center) * factor));
}
function rgbToHsl01(r, g, b) {
  const rr = clamp(r, 0, 1), gg = clamp(g, 0, 1), bb = clamp(b, 0, 1);
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  const l = (max + min) * 0.5;
  let s = 0;
  if (d > 1e-6) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case rr: h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6; break;
      case gg: h = ((bb - rr) / d + 2) / 6; break;
      default: h = ((rr - gg) / d + 4) / 6; break;
    }
  }
  return [wrapHue01(h), clamp(s, 0, 1.5), clamp(l, 0, 1)];
}
function paletteStopsForStyle(style, baseHue) {
  const s = String(style || 'classic');
  const pastel = PASTEL_STYLE_DEFS[s];
  if (pastel) {
    return {
      stops: pastel.stops.map(wrapHue01),
      satScale: pastel.satScale,
      lightLift: pastel.lightLift,
      mix: pastel.mix
    };
  }
  let satScale = 1.06;
  let lightLift = 0.02;
  let mix = 0.32;
  let stops = [wrapHue01(baseHue - 0.08), wrapHue01(baseHue + 0.05), wrapHue01(baseHue + 0.22)];
  if (s === 'softwaves' || s === 'contourveil') {
    satScale = 1.00; lightLift = 0.04; mix = 0.34;
    stops = [wrapHue01(baseHue - 0.10), wrapHue01(baseHue + 0.03), wrapHue01(baseHue + 0.20)];
  } else if (s === 'silkflow' || s === 'ribbons' || s === 'trails' || s === 'gradientflow') {
    satScale = 1.04; lightLift = 0.04; mix = 0.34;
    stops = [wrapHue01(baseHue - 0.08), wrapHue01(baseHue + 0.06), wrapHue01(baseHue + 0.24)];
  } else if (s === 'ambientglow' || s === 'spectralmist') {
    satScale = 1.06; lightLift = 0.05; mix = 0.24;
    stops = [wrapHue01(baseHue - 0.13), wrapHue01(baseHue + 0.03), wrapHue01(baseHue + 0.22)];
  } else if (s === 'dreamblobs' || s === 'nebulawash' || s === 'bokehbloom' || s === 'chromafog' || s === 'opalbloom' || s === 'jazzhaze') {
    satScale = 1.16; lightLift = 0.05; mix = 0.18;
    stops = [wrapHue01(baseHue - 0.14), wrapHue01(baseHue + 0.05), wrapHue01(baseHue + 0.28)];
  } else if (s === 'cellular' || s === 'cellfield' || s === 'honeycomb') {
    satScale = 1.10; lightLift = 0.03; mix = 0.16;
    stops = [wrapHue01(baseHue - 0.09), wrapHue01(baseHue + 0.04), wrapHue01(baseHue + 0.20)];
  } else if (s === 'colorbursts' || s === 'vectorscope') {
    satScale = 1.12; lightLift = 0.08; mix = 0.26;
    stops = [wrapHue01(baseHue - 0.06), wrapHue01(baseHue + 0.10), wrapHue01(baseHue + 0.28)];
  } else if (s === 'cymatics' || s === 'rings' || s === 'sinefield' || s === 'oscilloscope') {
    satScale = 1.08; lightLift = 0.04; mix = 0.28;
    stops = [wrapHue01(baseHue - 0.07), wrapHue01(baseHue + 0.06), wrapHue01(baseHue + 0.22)];
  } else if (s === 'aurora' || s === 'starfield' || s === 'matrixrain' || s === 'matrixcrawl') {
    satScale = 1.00; lightLift = 0.03; mix = 0.26;
    stops = [wrapHue01(baseHue - 0.10), wrapHue01(baseHue + 0.03), wrapHue01(baseHue + 0.20)];
  } else if (s === 'rainbow' || s === 'spectrum') {
    satScale = 1.08; lightLift = 0.03; mix = 0.10;
    stops = [wrapHue01(baseHue - 0.08), wrapHue01(baseHue + 0.04), wrapHue01(baseHue + 0.16)];
  }
  const compress = (s === 'rainbow' || s === 'spectrum' || s === 'cymatics' || s === 'rings' || s === 'vectorscope' || s === 'colorbursts') ? 0.38 : (PASTEL_STYLE_DEFS[s] ? 0.48 : 0.54);
  return { stops: compressHueStops(stops, compress), satScale, lightLift, mix: mix * 0.82 };
}

function paletteColor(style, baseHue, sat, light, u, energy = 0) {
  const { stops, satScale, lightLift, mix } = paletteStopsForStyle(style, baseHue);
  const lane = clamp(u, 0, 1);
  const rawSeg = lane < 0.5 ? lane / 0.5 : (lane - 0.5) / 0.5;
  const seg = rawSeg * rawSeg * (3 - 2 * rawSeg);
  const hA = lane < 0.5 ? stops[0] : stops[1];
  const hB = lane < 0.5 ? stops[1] : stops[2];
  let h = hA + (hB - hA) * seg;
  if (Math.abs(hB - hA) > 0.5) h = wrapHue01(h);
  h = wrapHue01(baseHue * (1 - mix) + h * mix);
  return hslToRgb01(h, clamp(sat * satScale * (0.98 + energy * 0.16), 0.16, 1.45), clamp(light + lightLift + energy * 0.04, 0.08, 0.94));
}
function styleColorProfile(style) {
  const s = resolveBackdropProfileStyle(style);
  if (s === 'contourveil' || s === 'softwaves' || s === 'gradientflow' || s === 'silkflow') return { radial: 0.28, vertical: 0.20, angular: 0.14, contour: 0.38, mix: 0.22, fillBoost: 0.06, lightBias: 0.03, lineMixScale: 0.68, fillMixScale: 0.48 };
  if (s === 'dreamblobs' || s === 'nebulawash' || s === 'bokehbloom' || s === 'chromafog' || s === 'opalbloom' || s === 'jazzhaze') return { radial: 0.42, vertical: 0.16, angular: 0.10, contour: 0.32, mix: 0.06, fillBoost: 0.08, lightBias: 0.03, lineMixScale: 0.22, fillMixScale: 0.12 };
  if (s === 'ambientglow' || s === 'spectralmist' || s === 'aurora' || s === 'starfield') return { radial: 0.42, vertical: 0.14, angular: 0.06, contour: 0.30, mix: 0.08, fillBoost: 0.07, lightBias: 0.03, lineMixScale: 0.32, fillMixScale: 0.18 };
  if (s === 'cymatics' || s === 'rings' || s === 'vectorscope' || s === 'colorbursts') return { radial: 0.46, vertical: 0.14, angular: 0.04, contour: 0.32, mix: 0.08, fillBoost: 0.06, lightBias: 0.03, lineMixScale: 0.40, fillMixScale: 0.24 };
  if (s === 'matrixrain' || s === 'matrixcrawl' || s === 'spectrum' || s === 'moire' || s === 'cellular' || s === 'cellfield' || s === 'honeycomb') return { radial: 0.18, vertical: 0.34, angular: 0.10, contour: 0.38, mix: 0.08, fillBoost: 0.05, lightBias: 0.02, lineMixScale: 0.24, fillMixScale: 0.14 };
  return { radial: 0.28, vertical: 0.20, angular: 0.08, contour: 0.34, mix: 0.10, fillBoost: 0.05, lightBias: 0.03, lineMixScale: 0.40, fillMixScale: 0.24 };
}
function paletteColorAtPoint(style, x, y, baseHue, sat, light, energy = 0, extraMix = 0) {
  const profile = styleColorProfile(style);
  const s = resolveBackdropProfileStyle(style);
  const aspectX = x * 1.18;
  const r = Math.sqrt(aspectX * aspectX + y * y);
  const vertical = clamp((y + 1.05) / 2.10, 0, 1);
  const radial = clamp(r / 1.55, 0, 1);
  const contour = Math.sin(y * 3.1 + r * 4.4 + energy * 1.2) * 0.5 + 0.5;
  const radialMode = (s === 'cymatics' || s === 'rings' || s === 'vectorscope' || s === 'colorbursts' || s === 'dreamblobs' || s === 'nebulawash' || s === 'bokehbloom' || s === 'chromafog' || s === 'opalbloom' || s === 'jazzhaze');
  const lane = radialMode
    ? clamp(radial * 0.72 + vertical * 0.10 + contour * 0.18, 0, 1)
    : clamp(vertical * 0.62 + radial * 0.18 + contour * 0.20, 0, 1);
  const target = paletteColor(style, baseHue, sat, light, lane, energy);
  const centerGlow = 1 - clamp(r / 1.25, 0, 1);
  const lightBoost = profile.lightBias + centerGlow * profile.fillBoost + energy * 0.03;
  const rgb = [
    clamp(target[0] * (0.99 + lightBoost), 0, 1),
    clamp(target[1] * (0.99 + lightBoost), 0, 1),
    clamp(target[2] * (0.99 + lightBoost), 0, 1)
  ];
  return {
    rgb,
    mix: clamp(profile.mix + extraMix, 0.04, 0.48),
    lineMixScale: profile.lineMixScale || 0.5,
    fillMixScale: profile.fillMixScale || 0.3
  };
}
function gradeBackdropColors(style, positions, colors, fillPositions, fillColors, baseHue, sat, light, amount) {
  const lineCount = Math.floor((colors && colors.length ? colors.length : 0) / 6);
  for (let i = 0; i < lineCount; i++) {
    const pi = i * 4;
    const ci = i * 6;
    const ax = positions[pi + 0], ay = positions[pi + 1], bx = positions[pi + 2], by = positions[pi + 3];
    const hslA = rgbToHsl01(colors[ci + 0], colors[ci + 1], colors[ci + 2]);
    const hslB = rgbToHsl01(colors[ci + 3], colors[ci + 4], colors[ci + 5]);
    const tA = paletteColorAtPoint(style, ax, ay, baseHue, sat, light, hslA[2], clamp(amount, 0, 2.5) * 0.02);
    const tB = paletteColorAtPoint(style, bx, by, baseHue, sat, light, hslB[2], clamp(amount, 0, 2.5) * 0.02);
    const satLiftA = clamp((0.42 - hslA[1]) * 0.55 + Math.max(0, hslA[2] - 0.72) * 0.22, 0, 0.26);
    const satLiftB = clamp((0.42 - hslB[1]) * 0.55 + Math.max(0, hslB[2] - 0.72) * 0.22, 0, 0.26);
    const mA = clamp(tA.mix * tA.lineMixScale + satLiftA, 0.04, 0.66);
    const mB = clamp(tB.mix * tB.lineMixScale + satLiftB, 0.04, 0.66);
    colors[ci + 0] = colors[ci + 0] * (1 - mA) + tA.rgb[0] * mA;
    colors[ci + 1] = colors[ci + 1] * (1 - mA) + tA.rgb[1] * mA;
    colors[ci + 2] = colors[ci + 2] * (1 - mA) + tA.rgb[2] * mA;
    colors[ci + 3] = colors[ci + 3] * (1 - mB) + tB.rgb[0] * mB;
    colors[ci + 4] = colors[ci + 4] * (1 - mB) + tB.rgb[1] * mB;
    colors[ci + 5] = colors[ci + 5] * (1 - mB) + tB.rgb[2] * mB;
  }
  const fillCount = Math.floor((fillColors && fillColors.length ? fillColors.length : 0) / 9);
  for (let i = 0; i < fillCount; i++) {
    const pi = i * 6;
    const ci = i * 9;
    for (let v = 0; v < 3; v++) {
      const x = fillPositions[pi + v * 2 + 0];
      const y = fillPositions[pi + v * 2 + 1];
      const cix = ci + v * 3;
      const hsl = rgbToHsl01(fillColors[cix + 0], fillColors[cix + 1], fillColors[cix + 2]);
      const t = paletteColorAtPoint(style, x, y, baseHue, sat, light * 0.96, hsl[2], 0.08 + clamp(amount, 0, 2.5) * 0.03);
      const satLift = clamp((0.36 - hsl[1]) * 0.60 + Math.max(0, hsl[2] - 0.70) * 0.18, 0, 0.24);
      const fm = clamp(t.mix * t.fillMixScale + satLift, 0.03, 0.40);
      fillColors[cix + 0] = fillColors[cix + 0] * (1 - fm) + t.rgb[0] * fm;
      fillColors[cix + 1] = fillColors[cix + 1] * (1 - fm) + t.rgb[1] * fm;
      fillColors[cix + 2] = fillColors[cix + 2] * (1 - fm) + t.rgb[2] * fm;
    }
  }
}

function avg(bands, a, b) {
  const x = Math.max(0, Math.min(bands.length, a | 0));
  const y = Math.max(x + 1, Math.min(bands.length, b | 0));
  let s = 0;
  for (let i = x; i < y; i++) s += bands[i] || 0;
  return s / (y - x);
}

function makeWriter(maxSegments, hue, sat, light) {
  const positions = new Float32Array(maxSegments * 4); // ax,ay,bx,by per segment in normalized screen space
  const colors = new Float32Array(maxSegments * 6);    // rgb A + rgb B per segment
  const maxTriangles = Math.max(512, Math.min(12000, Math.floor(maxSegments * 1.08)));
  const fillPositions = new Float32Array(maxTriangles * 6); // ax,ay,bx,by,cx,cy per triangle
  const fillColors = new Float32Array(maxTriangles * 9);    // rgb A/B/C per triangle
  let seg = 0;
  let tri = 0;
  const canWriteSegments = (n = 1) => seg + Math.max(1, n | 0) <= maxSegments;
  const canWriteTris = (n = 1) => tri + Math.max(1, n | 0) <= maxTriangles;
  const write = (ax, ay, bx, by, h0 = hue, h1 = h0, l0 = light, l1 = l0, sat0 = sat, sat1 = sat0) => {
    if (seg >= maxSegments) return false;
    if (![ax, ay, bx, by].every(Number.isFinite)) return false;
    const pi = seg * 4;
    positions[pi + 0] = clamp(ax, -3.0, 3.0);
    positions[pi + 1] = clamp(ay, -3.0, 3.0);
    positions[pi + 2] = clamp(bx, -3.0, 3.0);
    positions[pi + 3] = clamp(by, -3.0, 3.0);
    const ca = hslToRgb01(h0, sat0, l0);
    const cb = hslToRgb01(h1, sat1, l1);
    const ci = seg * 6;
    colors[ci + 0] = ca[0]; colors[ci + 1] = ca[1]; colors[ci + 2] = ca[2];
    colors[ci + 3] = cb[0]; colors[ci + 4] = cb[1]; colors[ci + 5] = cb[2];
    seg++;
    return true;
  };
  const writeTri = (ax, ay, bx, by, cx, cy, h0 = hue, h1 = h0, h2 = h1, l0 = light, l1 = l0, l2 = l1, sat0 = sat, sat1 = sat0, sat2 = sat1) => {
    if (tri >= maxTriangles) return false;
    if (![ax, ay, bx, by, cx, cy].every(Number.isFinite)) return false;
    const pi = tri * 6;
    fillPositions[pi + 0] = clamp(ax, -3.0, 3.0);
    fillPositions[pi + 1] = clamp(ay, -3.0, 3.0);
    fillPositions[pi + 2] = clamp(bx, -3.0, 3.0);
    fillPositions[pi + 3] = clamp(by, -3.0, 3.0);
    fillPositions[pi + 4] = clamp(cx, -3.0, 3.0);
    fillPositions[pi + 5] = clamp(cy, -3.0, 3.0);
    const ca = hslToRgb01(h0, sat0, l0);
    const cb = hslToRgb01(h1, sat1, l1);
    const cc = hslToRgb01(h2, sat2, l2);
    const ci = tri * 9;
    fillColors[ci + 0] = ca[0]; fillColors[ci + 1] = ca[1]; fillColors[ci + 2] = ca[2];
    fillColors[ci + 3] = cb[0]; fillColors[ci + 4] = cb[1]; fillColors[ci + 5] = cb[2];
    fillColors[ci + 6] = cc[0]; fillColors[ci + 7] = cc[1]; fillColors[ci + 8] = cc[2];
    tri++;
    return true;
  };
  return { positions, colors, fillPositions, fillColors,
    get segments() { return seg; }, get triangles() { return tri; },
    get full() { return seg >= maxSegments; }, get fillFull() { return tri >= maxTriangles; },
    get segmentRemaining() { return Math.max(0, maxSegments - seg); },
    get fillRemaining() { return Math.max(0, maxTriangles - tri); },
    canWriteSegments,
    canWriteTris,
    write, writeTri };
}

function drawSineField(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const lines = Math.floor(clamp(5 + amount * 8 + d.scaleDepth * 2.0, 4, 20));
  const steps = Math.floor(clamp(58 + amount * 36, 36, 112));
  const rms = clamp(feat.rms || 0, 0, 1);
  for (let l = 0; l < lines && !wr.full; l++) {
    if (wr.canWriteSegments && !wr.canWriteSegments(steps)) break;
    const k = l / Math.max(1, lines - 1);
    const y0 = -0.88 + k * 1.76 + Math.sin(k * TAU + t * 0.33 + hue * 4) * (0.018 + d.equilibrium * 0.035);
    const band = bands[(l * 3) % bands.length] || rms;
    const amp = (0.026 + amount * 0.026 + d.scaleDepth * 0.010) * (0.35 + band * 2.1 + feat.beat * 0.78);
    let px = ribbonSpanX(0, 1.46);
    let py = y0;
    for (let s = 1; s <= steps && !wr.full; s++) {
      const u = s / steps;
      const x = ribbonSpanX(u, 1.46);
      const wave = Math.sin(u * TAU * (1.2 + (l % 7) * 0.40 + d.coherence * 0.55) + t * (0.7 + d.tempo * 0.45) + k * 8)
        + 0.42 * Math.sin(u * TAU * (2.55 + d.temperature) - t * 0.78 + hue * 7)
        + 0.18 * Math.sin(u * TAU * (5.1 + k * 2) + t * 0.13);
      const y = y0 + wave * amp * (0.48 + Math.sin(u * Math.PI) * 0.75);
      wr.write(px, py, x, y, hue + k * 0.38 + band * 0.12, hue + k * 0.40 + 0.045, light * (0.55 + band * 0.30), light * (0.50 + band * 0.25));
      px = x; py = y;
    }
  }
}


function drawLightFieldBackdrop(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const beat = clamp(feat.beat || 0, 0, 1);
  const rms = clamp(feat.rms || 0, 0, 1);
  const beams = Math.floor(clamp(7 + amount * 8 + d.scaleDepth * 2.6, 6, 18));
  const steps = Math.floor(clamp(96 + amount * 84, 68, 210));
  for (let b = 0; b < beams && !wr.fillFull; b++) {
    if (wr.canWriteTris && !wr.canWriteTris(steps * 2)) break;
    if (wr.canWriteSegments && !wr.canWriteSegments(steps)) break;
    const k = b / Math.max(1, beams - 1);
    const seed = hash01(b * 15.73 + 0.42);
    const band = bands[(b * 5 + 2) % Math.max(1, bands.length)] || rms;
    const angle = -0.74 + k * 1.48 + Math.sin(t * 0.034 + seed * TAU) * 0.16;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const lane = -0.78 + k * 1.56 + Math.sin(t * 0.085 + seed * 6.0) * 0.060;
    const width = 0.022 + amount * 0.012 + band * 0.040 + beat * 0.016;
    let prevTop = null, prevBot = null, prevCore = null, prevHue = hue, prevTopLight = light * 0.10, prevBotLight = light * 0.04;
    for (let i = 0; i <= steps && !wr.fillFull; i++) {
      const u = i / steps;
      const x0 = ribbonSpanX(u, 1.56);
      const bandU = bands[(i * 2 + b * 7) % Math.max(1, bands.length)] || band;
      const lens = Math.sin(u * Math.PI);
      const carrier = Math.sin(u * TAU * (0.62 + d.coherence * 0.22 + seed * 0.22) + t * (0.18 + d.tempo * 0.045) + seed * 7.0)
        + Math.sin(u * TAU * (1.85 + d.temperature * 0.38) - t * 0.15 + b * 0.9) * 0.34
        + Math.sin(u * TAU * (3.7 + seed * 0.5) + t * 0.09) * 0.13;
      const y0 = lane + carrier * (0.050 + bandU * 0.060 + amount * 0.016);
      const spread = width * (0.50 + lens * 1.15 + bandU * 0.55);
      const x = x0 * ca - y0 * sa;
      const y = x0 * sa + y0 * ca;
      const nx = -sa;
      const ny = ca;
      const top = [x + nx * spread, y + ny * spread];
      const bot = [x - nx * spread * (0.56 + seed * 0.20), y - ny * spread * (0.56 + seed * 0.20)];
      const core = [x + nx * spread * 0.10, y + ny * spread * 0.10];
      const hNow = softHue(hue, k * 2.8 + u * 1.5, bandU, 0.13);
      const topLight = light * (0.11 + bandU * 0.11 + lens * 0.080 + beat * 0.050);
      const botLight = light * (0.018 + bandU * 0.030);
      if (prevTop && prevBot && prevCore) {
        wr.writeTri(prevTop[0], prevTop[1], top[0], top[1], bot[0], bot[1], prevHue, hNow, hNow + 0.050, prevTopLight, topLight, botLight, softSat(opts.sat, 1.06), softSat(opts.sat, 1.36), softSat(opts.sat, 0.78));
        if (!wr.fillFull) wr.writeTri(prevTop[0], prevTop[1], bot[0], bot[1], prevBot[0], prevBot[1], prevHue, hNow + 0.050, prevHue + 0.030, prevTopLight, botLight, prevBotLight, softSat(opts.sat, 1.06), softSat(opts.sat, 0.78), softSat(opts.sat, 0.70));
        if (!wr.full) {
          wr.write(prevCore[0], prevCore[1], core[0], core[1], prevHue + 0.08, hNow + 0.16,
            light * (0.10 + bandU * 0.060 + lens * 0.06), light * (0.20 + bandU * 0.12 + beat * 0.08),
            softSat(opts.sat, 0.94), softSat(opts.sat, 1.30));
        }
      }
      prevTop = top;
      prevBot = bot;
      prevCore = core;
      prevHue = hNow;
      prevTopLight = topLight;
      prevBotLight = botLight;
    }
  }

  const caustics = Math.floor(clamp(5 + amount * 8 + beat * 5, 5, 20));
  const steps2 = Math.floor(clamp(46 + amount * 34, 36, 108));
  for (let c = 0; c < caustics && !wr.full; c++) {
    if (wr.canWriteSegments && !wr.canWriteSegments(steps2)) break;
    const seed = hash01(c * 29.31 + 9.4);
    const band = bands[(c * 11 + 4) % Math.max(1, bands.length)] || rms;
    const cx = -0.95 + hash01(seed * 17.0) * 1.90;
    const cy = -0.78 + hash01(seed * 31.0) * 1.56;
    const rx = 0.10 + band * 0.20 + amount * 0.025;
    const ry = rx * (0.32 + hash01(seed * 13.1) * 0.32);
    let px = null, py = null;
    for (let i = 0; i <= steps2 && !wr.full; i++) {
      const u = i / steps2;
      const a = u * TAU + t * (0.055 + seed * 0.020) + seed * TAU;
      const wob = 1 + Math.sin(a * 3.0 - t * 0.18 + band * 3.0) * 0.14;
      const x = cx + ax2(Math.cos(a) * rx * wob, opts);
      const y = cy + Math.sin(a * 1.4 + seed) * ry * wob;
      if (px !== null) wr.write(px, py, x, y,
        hue + 0.12 + seed * 0.12, hue + 0.22 + seed * 0.12,
        light * (0.060 + band * 0.040), light * (0.16 + band * 0.080 + beat * 0.030),
        softSat(opts.sat, 0.82), softSat(opts.sat, 1.12));
      px = x; py = y;
    }
  }
}



function drawOscilloscope(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const ghosts = Math.floor(clamp(3 + amount * 5, 3, 10));
  const steps = Math.floor(clamp(160 + amount * 80, 96, 260));
  const rms = clamp(feat.rms || 0, 0, 1);
  for (let g = 0; g < ghosts && !wr.full; g++) {
    if (wr.canWriteSegments && !wr.canWriteSegments(steps)) break;
    const k = g / Math.max(1, ghosts - 1);
    let px = -1.08;
    let py = (k - 0.5) * 0.42;
    for (let s = 1; s <= steps && !wr.full; s++) {
      const u = s / steps;
      const band = bands[(s + g * 11) % bands.length] || 0;
      const x = -1.08 + u * 2.16;
      const carrier = Math.sin(u * TAU * (2.0 + d.coherence * 2.2) + t * (1.2 + d.tempo * 0.5) + g * 0.6);
      const detail = Math.sin(u * TAU * (10.0 + d.temperature * 5.0) - t * 1.7 + band * 4.0) * 0.35;
      const y = (k - 0.5) * 0.38 + (carrier + detail) * (0.08 + rms * 0.09 + band * 0.12 + feat.beat * 0.05) * (0.75 + amount * 0.25);
      wr.write(px, py, x, y, hue + 0.18 + k * 0.16, hue + 0.28 + band * 0.12, light * (0.45 + k * 0.18), light * (0.55 + band * 0.25));
      px = x; py = y;
    }
  }
}

function drawCymatics(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const rings = Math.floor(clamp(5 + amount * 9 + d.scaleDepth * 4, 4, 22));
  const steps = Math.floor(clamp(110 + amount * 76, 72, 220));
  for (let r = 0; r < rings && !wr.full; r++) {
    if (wr.canWriteSegments && !wr.canWriteSegments(steps)) break;
    const rk = (r + 1) / rings;
    const base = 0.055 + rk * (0.74 + d.inversion * 0.04);
    let px = 0, py = 0;
    for (let s = 0; s <= steps && !wr.full; s++) {
      const u = s / steps;
      const a = u * TAU;
      const b = bands[(s + r * 5) % bands.length] || 0;
      const wob = Math.sin(a * (3 + r % 5) + t * (0.8 + d.equilibrium * 2.4) + r) * (0.018 + b * 0.060 + feat.beat * 0.030)
        + Math.sin(a * (9 + r % 4) - t * 0.42) * (0.004 + amount * 0.004);
      const rr = base + wob;
      const x = Math.cos(a) * rr;
      const y = Math.sin(a) * rr;
      if (s > 0) wr.write(px, py, x, y, hue + rk * 0.30 + b * 0.08, hue + rk * 0.33 + 0.03, light * (0.58 + b * 0.25), light * (0.52 + b * 0.23));
      px = x; py = y;
    }
  }
}

function drawRadialBars(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const n = Math.floor(clamp(48 + amount * 96, 24, 168));
  for (let i = 0; i < n && !wr.full; i++) {
    const u = i / n;
    const a = u * TAU + t * (0.08 + d.tempo * 0.04);
    const b = bands[i % bands.length] || 0;
    const wob = Math.sin(a * 3 + t) * 0.015 + Math.cos(a * 5 - t * 0.7) * 0.010;
    const r0 = 0.10 + wob + feat.beat * 0.018;
    const r1 = 0.18 + b * 0.58 + amount * 0.13 + feat.beat * 0.10 + wob;
    wr.write(Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a) * r1, Math.sin(a) * r1, hue + u * 0.70 + b * 0.12, hue + u * 0.78 + 0.06, light * (0.52 + b * 0.34), light * (0.42 + b * 0.28));
  }
}

function drawSpectrum(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const bars = Math.floor(clamp(48 + amount * 100, 28, 180));
  const base = -0.80 + Math.sin(t * 0.22) * 0.020;
  for (let i = 0; i < bars && !wr.full; i++) {
    const u = i / Math.max(1, bars - 1);
    const x = -1.03 + u * 2.06;
    const b = bands[Math.floor(u * (bands.length - 1))] || 0;
    const wave = 0.5 + 0.5 * Math.sin(u * Math.PI * (4 + d.coherence * 4) + t * (0.7 + d.equilibrium * 2));
    const h = 0.045 + Math.pow(b + feat.beat * 0.08 + wave * d.temperature * 0.06, 0.72) * (0.48 + amount * 0.10);
    wr.write(x, base, x, base + h, hue + u * 0.48 + b * 0.09, hue + u * 0.55 + 0.08, light * 0.42, light * (0.58 + b * 0.34));
    if ((i & 1) === 0) wr.write(x, 0.77, x, 0.77 - h * 0.45, hue + 0.52 + u * 0.24, hue + 0.58, light * 0.34, light * 0.52);
  }
}

function drawVectorscope(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const n = Math.floor(clamp(180 + amount * 220, 96, 460));
  if (wr.canWriteSegments && !wr.canWriteSegments(n)) return;
  let px = 0, py = 0;
  for (let i = 0; i <= n && !wr.full; i++) {
    const u = i / n;
    const b1 = bands[(i * 3) % bands.length] || 0;
    const b2 = bands[(i * 7 + 5) % bands.length] || 0;
    const a = u * TAU * (1.0 + d.coherence * 0.9) + t * (0.55 + d.tempo * 0.2);
    const r = 0.23 + b1 * 0.45 + b2 * 0.18 + amount * 0.07 + feat.beat * 0.04;
    const x = Math.sin(a + b2 * 2.2) * r + Math.sin(a * 2.31 + t) * 0.10 * d.temperature;
    const y = Math.cos(a * 0.97 + b1 * 2.0) * r + Math.cos(a * 1.73 - t * 0.7) * 0.10 * d.equilibrium;
    if (i > 0) wr.write(px, py, x, y, hue + u * 0.58, hue + u * 0.60 + 0.04, light * (0.56 + b1 * 0.22), light * (0.50 + b2 * 0.26));
    px = x; py = y;
  }
}

function drawRainbowRibbons(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const ribbons = Math.floor(clamp(3 + amount * 5, 2, 10));
  const steps = Math.floor(clamp(72 + amount * 44, 48, 140));
  for (let r = 0; r < ribbons && !wr.full; r++) {
    if (wr.canWriteSegments && !wr.canWriteSegments(steps)) break;
    const k = r / Math.max(1, ribbons - 1);
    let px = ribbonSpanX(0, 1.46);
    let py = Math.sin(k * TAU + t * 0.18) * 0.28 + (k - 0.5) * 0.55;
    for (let s = 1; s <= steps && !wr.full; s++) {
      const u = s / steps;
      const b = bands[(s + r * 6) % bands.length] || 0;
      const x = ribbonSpanX(u, 1.46);
      const y = Math.sin(u * Math.PI * (2.0 + r * 0.75 + d.scaleDepth) + t * (0.75 + d.equilibrium * 2.0) + r) * (0.18 + amount * 0.055 + b * 0.20)
        + Math.cos(u * Math.PI * (5.5 + d.temperature * 2.0) - t * 0.72) * 0.055
        + (k - 0.5) * 0.66;
      wr.write(px, py, x, y, softHue(hue, u * 2.0 + k * 3.0, b), softHue(hue, u * 2.0 + k * 3.0 + 0.45, b, 0.025), light * (0.24 + b * 0.12), light * (0.38 + b * 0.14), softSat(opts.sat, 0.86), softSat(opts.sat, 0.98));
      px = x; py = y;
    }
  }
}

function drawAurora(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const curtains = Math.floor(clamp(6 + amount * 9, 4, 18));
  const steps = Math.floor(clamp(56 + amount * 54, 36, 130));
  for (let c = 0; c < curtains && !wr.full; c++) {
    if (wr.canWriteSegments && !wr.canWriteSegments(Math.ceil(steps * 1.36))) break;
    const k = c / Math.max(1, curtains - 1);
    const yBase = -0.72 + k * 1.44;
    let prevTop = [ribbonSpanX(0, 1.46), yBase];
    let prevBot = [ribbonSpanX(0, 1.46), yBase - 0.11 - k * 0.03];
    for (let i = 1; i <= steps && !wr.full; i++) {
      const u = i / steps;
      const b = bands[(i + c * 5) % bands.length] || 0;
      const x = ribbonSpanX(u, 1.46);
      const wave = Math.sin(u * 7 + t * (0.18 + k * 0.05) + c) * (0.055 + b * 0.10) * amount
        + Math.sin(u * 19 - t * 0.11) * 0.018;
      const topY = yBase + wave;
      const botY = topY - (0.10 + b * 0.22 + feat.beat * 0.05) * (0.4 + amount * 0.3);
      wr.write(prevTop[0], prevTop[1], x, topY, hue + k * 0.22 + b * 0.07, hue + k * 0.25 + 0.05, light * 0.48, light * 0.60);
      if ((i + c) % 3 === 0) wr.write(x, topY, x, botY, hue + k * 0.28, hue + k * 0.33, light * 0.54, light * 0.24);
      prevTop = [x, topY];
      prevBot = [x, botY];
    }
  }
}

function drawMatrix(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const cols = Math.floor(clamp(18 + amount * 34, 10, 64));
  for (let c = 0; c < cols && !wr.full; c++) {
    const u = (c + 0.5) / cols;
    const seed = hash01(c * 19.19);
    const band = bands[(c * 5) % bands.length] || feat.rms || 0;
    const x = -1 + u * 2 + Math.sin(t * 0.42 + c) * 0.010;
    const head = ((t * (0.34 + seed * 0.52 + d.tempo * 0.18) + seed) % 1) * 2.12 - 1.06;
    const tail = 0.10 + band * 0.35 + amount * 0.10;
    wr.write(x, head, x + Math.sin(t + c) * 0.018, head - tail, hue + 0.26 + seed * 0.1, hue + 0.30, light * (0.65 + band * 0.22), light * 0.22, opts.sat * 0.9, opts.sat);
    const ticks = Math.floor(2 + band * 5);
    for (let j = 0; j < ticks && !wr.full; j++) {
      const y = head - tail * (j / Math.max(1, ticks)) + Math.sin(t * 1.6 + c * 0.31 + j) * 0.015;
      wr.write(x - 0.006, y, x + 0.006, y, hue + 0.25, hue + 0.25, light * 0.42, light * 0.42, opts.sat * 0.75, opts.sat * 0.75);
    }
  }
}

function drawMoireGrid(wr, bands, feat, d, opts, cellular = false) {
  const { amount, t, hue, light } = opts;
  const cols = Math.floor(clamp(16 + amount * 20, 10, 46));
  const rows = Math.floor(clamp(10 + amount * 14, 7, 30));
  const dx = 2 / cols;
  const dy = 1.6 / rows;
  const beat = clamp(feat.beat || 0, 0, 1);
  for (let y = 0; y <= rows && !wr.full; y++) {
    let px = -1, py = -0.8 + y * dy;
    for (let x = 1; x <= cols && !wr.full; x++) {
      const u = x / cols;
      const k = y * cols + x;
      const b = bands[k % Math.max(1, bands.length)] || 0;
      const nx = -1 + x * dx;
      const wave = Math.sin(u * TAU * (2 + d.scaleDepth) + t * (0.34 + d.tempo * 0.08) + y * 0.7) * (0.010 + b * 0.034);
      const ny = -0.8 + y * dy + wave;
      const gate = cellular ? stableActivity(k * 0.37 + y * 0.11, b, beat, 0.18) : 1;
      if (gate > 0.045) wr.write(px, py, nx, ny, hue + b * 0.12 + y * 0.01, hue + 0.04 + x * 0.006, light * (0.18 + b * 0.28) * gate, light * (0.22 + b * 0.30) * gate);
      px = nx; py = ny;
    }
  }
  for (let x = 0; x <= cols && !wr.full; x += cellular ? 1 : 2) {
    let px = -1 + x * dx, py = -0.8;
    for (let y = 1; y <= rows && !wr.full; y++) {
      const k = y * cols + x;
      const b = bands[k % Math.max(1, bands.length)] || 0;
      const wave = Math.cos(y * 0.8 + t * (0.24 + d.tempo * 0.05)) * (0.008 + b * 0.018);
      const nx = -1 + x * dx + wave;
      const ny = -0.8 + y * dy;
      const gate = cellular ? stableActivity(k * 0.41 + 17.0, b, beat, 0.14) : 1;
      if (gate > 0.045) wr.write(px, py, nx, ny, hue + 0.12 + b * 0.10, hue + 0.15, light * (0.14 + b * 0.28) * gate, light * (0.22 + b * 0.26) * gate);
      px = nx; py = ny;
    }
  }
}

function drawTunnel(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const spokes = Math.floor(clamp(36 + amount * 52, 24, 112));
  const rings = Math.floor(clamp(8 + amount * 10, 5, 24));
  for (let r = 0; r < rings && !wr.full; r++) {
    const k = (r + 1) / rings;
    const rr = 0.05 + k * 1.04;
    const twist = Math.sin(t * 0.030 + k * 2.0) * 0.18 + k * 3.2;
    let pFirst = null;
    let pPrev = null;
    for (let i = 0; i <= spokes && !wr.full; i++) {
      const u = i / spokes;
      const b = bands[(i + r * 3) % bands.length] || 0;
      const a = u * TAU + twist + b * 0.4;
      const p = [Math.cos(a) * rr * (0.72 + b * 0.20), Math.sin(a) * rr * (0.72 + feat.beat * 0.06)];
      if (pPrev) wr.write(pPrev[0], pPrev[1], p[0], p[1], hue + k * 0.22 + b * 0.1, hue + u * 0.24, light * 0.42, light * (0.56 + b * 0.24));
      else pFirst = p;
      pPrev = p;
    }
    if (pFirst && pPrev && !wr.full) wr.write(pPrev[0], pPrev[1], pFirst[0], pFirst[1], hue + k * 0.2, hue + k * 0.25, light * 0.38, light * 0.45);
  }
}

function drawStarfield(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const n = Math.floor(clamp(180 + amount * 280, 96, 560));
  for (let i = 0; i < n && !wr.full; i++) {
    const seed = hash01(i * 3.731);
    const a = seed * TAU;
    const depth = ((t * (0.026 + d.tempo * 0.012) + hash01(i * 9.1)) % 1);
    const r = Math.pow(depth, 1.72) * 1.32;
    const b = bands[i % bands.length] || 0;
    const x = Math.cos(a + t * 0.04) * r;
    const y = Math.sin(a + t * 0.035) * r;
    const len = 0.020 + b * 0.065 + feat.beat * 0.030;
    wr.write(x * (1 - len), y * (1 - len), x, y, hue + seed * 0.25, hue + 0.08 + seed * 0.24, light * 0.28, light * (0.62 + b * 0.25));
  }
}

function drawFilledSpectrumBars(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const bars = Math.floor(clamp(28 + amount * 58, 18, 112));
  const base = -0.84 + Math.sin(t * 0.18) * 0.018;
  const topBase = 0.84 - Math.cos(t * 0.13) * 0.012;
  const width = 2.12 / bars;
  for (let i = 0; i < bars && !wr.fillFull; i++) {
    const u = i / Math.max(1, bars - 1);
    const b = bands[Math.floor(u * Math.max(1, bands.length - 1))] || 0;
    const x0 = -1.06 + i * width + width * 0.08;
    const x1 = x0 + width * (0.55 + Math.min(0.35, b));
    const h = Math.pow(b + feat.beat * 0.16 + 0.015, 0.62) * (0.55 + amount * 0.15);
    const y1 = base + h;
    const y2 = topBase - h * (0.36 + feat.treble * 0.22);
    wr.writeTri(x0, base, x1, base, x1, y1, hue + u * 0.55, hue + u * 0.58, hue + u * 0.62 + b * 0.10, light * 0.18, light * 0.20, light * (0.55 + b * 0.25), opts.sat * 1.15, opts.sat * 1.2, opts.sat * 1.35);
    wr.writeTri(x0, base, x1, y1, x0, y1 * 0.985, hue + u * 0.50, hue + u * 0.64, hue + u * 0.58, light * 0.16, light * (0.55 + b * 0.25), light * (0.38 + b * 0.20), opts.sat * 1.1, opts.sat * 1.35, opts.sat * 1.2);
    if ((i & 1) === 0 && !wr.fillFull) {
      wr.writeTri(x0, topBase, x1, topBase, x1, y2, hue + 0.48 + u * 0.35, hue + 0.50 + u * 0.38, hue + 0.56 + u * 0.35, light * 0.13, light * 0.16, light * (0.40 + b * 0.20), opts.sat * 1.05, opts.sat * 1.1, opts.sat * 1.2);
      wr.writeTri(x0, topBase, x1, y2, x0, y2 * 1.01, hue + 0.46 + u * 0.35, hue + 0.54 + u * 0.40, hue + 0.51 + u * 0.35, light * 0.12, light * (0.40 + b * 0.22), light * (0.30 + b * 0.16), opts.sat, opts.sat * 1.2, opts.sat * 1.1);
    }
  }
}

function drawFilledWaveSheet(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const layers = Math.floor(clamp(2 + amount * 1.8 + feat.beat * 1.0, 2, 5));
  const steps = Math.floor(clamp(96 + amount * 84, 64, 196));
  for (let layer = 0; layer < layers && !wr.fillFull; layer++) {
    if (wr.canWriteTris && !wr.canWriteTris(steps * 2)) break;
    const lk = layer / Math.max(1, layers - 1);
    const yMid = -0.55 + lk * 1.10 + Math.sin(t * 0.11 + layer) * 0.045;
    let prevTop = null, prevBot = null, prevHue = hue, prevTopLight = light * 0.22, prevBotLight = light * 0.08, prevSatTop = opts.sat, prevSatBot = opts.sat;
    for (let i = 0; i <= steps && !wr.fillFull; i++) {
      const u = i / steps;
      const x = ribbonSpanX(u, 1.48);
      const b = bands[(i * 2 + layer * 5) % bands.length] || 0;
      const wave = Math.sin(u * TAU * (1.15 + layer * 0.35 + d.scaleDepth * 0.20) + t * (0.46 + d.tempo * 0.08) + layer)
        + Math.sin(u * TAU * (3.1 + d.temperature * 0.8) - t * 0.36 + b * 2.0) * 0.42;
      const thickness = (0.028 + b * 0.080 + feat.beat * 0.036) * (0.66 + amount * 0.14);
      const cy = yMid + wave * (0.075 + amount * 0.020 + b * 0.050);
      const top = [x, cy + thickness];
      const bot = [x, cy - thickness * (0.78 + lk * 0.32)];
      const hNow = softHue(hue, u * 2.2 + lk * 3.0, b);
      const topLight = light * (0.12 + b * 0.09 + Math.sin(u * Math.PI) * 0.04);
      const botLight = light * (0.026 + b * 0.028);
      const topSat = softSat(opts.sat, 1.22 + b * 0.18);
      const botSat = softSat(opts.sat, 1.10);
      if (prevTop && prevBot) {
        // Use the same vertex colors for shared corners across both triangles.
        // This keeps each ribbon as a continuous strip instead of a repeated
        // per-quad rectangle gradient.
        wr.writeTri(prevTop[0], prevTop[1], top[0], top[1], bot[0], bot[1],
          prevHue, hNow, hNow + 0.035,
          prevTopLight, topLight, botLight,
          prevSatTop, topSat, botSat);
        wr.writeTri(prevTop[0], prevTop[1], bot[0], bot[1], prevBot[0], prevBot[1],
          prevHue, hNow + 0.035, prevHue + 0.030,
          prevTopLight, botLight, prevBotLight,
          prevSatTop, botSat, prevSatBot);
      }
      prevTop = top;
      prevBot = bot;
      prevHue = hNow;
      prevTopLight = topLight;
      prevBotLight = botLight;
      prevSatTop = topSat;
      prevSatBot = botSat;
    }
  }
}

function drawSoftColorWaves(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const bandsLen = Math.max(1, bands.length);
  const layers = Math.floor(clamp(2 + amount * 2.0, 2, 5));
  const steps = Math.floor(clamp(72 + amount * 68, 48, 156));
  for (let layer = 0; layer < layers && !wr.fillFull; layer++) {
    if (wr.canWriteTris && !wr.canWriteTris(steps * 2)) break;
    const lk = layer / Math.max(1, layers - 1);
    const yBase = -0.72 + lk * 1.44 + Math.sin(t * 0.07 + layer * 0.8) * 0.045;
    let prevTop = null, prevBot = null, prevHue = hue, prevTopLight = light * 0.20, prevBotLight = light * 0.06;
    for (let i = 0; i <= steps && !wr.fillFull; i++) {
      const u = i / steps;
      const b = bands[(i * 3 + layer * 9) % bandsLen] || 0;
      const x = ribbonSpanX(u, 1.52);
      const flow = Math.sin(u * TAU * (1.0 + layer * 0.22) + t * (0.18 + d.tempo * 0.035) + b * 1.7)
        + Math.sin(u * TAU * (2.7 + d.temperature * 0.45) - t * 0.16 + layer) * 0.34;
      const span = (0.060 + b * 0.125 + feat.beat * 0.040) * (0.58 + amount * 0.14);
      const cy = yBase + flow * (0.060 + b * 0.040 + amount * 0.014);
      const top = [x, cy + span * (0.55 + lk * 0.16)];
      const bot = [x, cy - span * (0.62 + (1 - lk) * 0.20)];
      const hNow = softHue(hue, u * 1.8 + lk * 2.4, b, 0.04);
      const topLight = light * (0.14 + b * 0.12 + Math.sin(u * Math.PI) * 0.06);
      const botLight = light * (0.040 + b * 0.040);
      if (prevTop && prevBot) {
        wr.writeTri(prevTop[0], prevTop[1], top[0], top[1], bot[0], bot[1], prevHue, hNow, hNow + 0.018, prevTopLight, topLight, botLight, softSat(opts.sat, 1.18), softSat(opts.sat, 1.42), softSat(opts.sat, 1.12));
        wr.writeTri(prevTop[0], prevTop[1], bot[0], bot[1], prevBot[0], prevBot[1], prevHue, hNow + 0.018, prevHue + 0.014, prevTopLight, botLight, prevBotLight, softSat(opts.sat, 1.18), softSat(opts.sat, 1.12), softSat(opts.sat, 1.04));
      }
      prevTop = top; prevBot = bot; prevHue = hNow; prevTopLight = topLight; prevBotLight = botLight;
    }
  }
}

function drawColorBursts(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const count = Math.floor(clamp(3 + amount * 4 + feat.beat * 3, 2, 10));
  const beat = clamp(feat.beat || 0, 0, 1);
  for (let j = 0; j < count && !wr.fillFull; j++) {
    const seed = hash01(j * 41.1 + Math.floor(t * 0.18) * 3.7);
    const band = bands[(j * 7 + 4) % Math.max(1, bands.length)] || 0;
    const a = seed * TAU + Math.sin(t * 0.04 + j) * 0.18;
    const centerR = 0.10 + hash01(seed * 19.4) * 0.64;
    const cx = ax2(Math.cos(a) * centerR, opts);
    const cy = Math.sin(a) * centerR * 0.78;
    const points = Math.floor(clamp(6 + band * 7 + amount * 2, 6, 14));
    const colorGroups = Math.max(3, Math.min(6, Math.floor(points * 0.42)));
    const rad = 0.045 + band * 0.18 + beat * 0.060 + amount * 0.020;
    for (let i = 0; i < points && !wr.fillFull; i++) {
      const u0 = i / points;
      const u1 = (i + 1) / points;
      const a0 = u0 * TAU + seed * TAU;
      const a1 = u1 * TAU + seed * TAU;
      const wob0 = 0.72 + Math.sin(a0 * 3.0 + t * 0.23 + band * 2.0) * 0.22;
      const wob1 = 0.72 + Math.sin(a1 * 3.0 + t * 0.23 + band * 2.0) * 0.22;
      const x0 = cx + ax2(Math.cos(a0) * rad * wob0, opts);
      const y0 = cy + Math.sin(a0) * rad * wob0;
      const x1 = cx + ax2(Math.cos(a1) * rad * wob1, opts);
      const y1 = cy + Math.sin(a1) * rad * wob1;
      const groupU = Math.floor(u0 * colorGroups) / Math.max(1, colorGroups - 1);
      const h = softHue(hue, seed * 0.9 + band * 0.20, band, 0.004);
      const hOuter = wrapHue01(h + 0.006 + groupU * 0.004);
      wr.writeTri(cx, cy, x0, y0, x1, y1, h, hOuter, hOuter, light * (0.040 + band * 0.050), light * (0.180 + band * 0.170), light * (0.125 + band * 0.145), softSat(opts.sat, 0.58), softSat(opts.sat, 0.84), softSat(opts.sat, 0.74));
    }
  }
}


function drawFilledRadialBlob(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const rings = Math.floor(clamp(2 + amount * 2.0 + feat.beat * 2.0, 2, 6));
  const steps = Math.floor(clamp(42 + amount * 44, 28, 112));
  for (let r = 0; r < rings && !wr.fillFull; r++) {
    if (wr.canWriteTris && !wr.canWriteTris(steps * 2)) break;
    const rk0 = r / rings;
    const rk1 = (r + 1) / rings;
    for (let i = 0; i < steps && !wr.fillFull; i++) {
      const u0 = i / steps;
      const u1 = (i + 1) / steps;
      const make = (u, rk) => {
        const band = bands[(Math.floor(u * bands.length) + r * 3) % bands.length] || 0;
        const a = u * TAU + t * (0.18 + d.tempo * 0.04) + rk * 0.9;
        const wob = Math.sin(a * (3.0 + d.scaleDepth * 0.45) + t + band * 2.0) * (0.04 + band * 0.08 + feat.beat * 0.04);
        const rr = (0.08 + rk * (0.70 + amount * 0.09) + band * 0.16 + feat.beat * 0.07 + wob);
        return [Math.cos(a) * rr, Math.sin(a * (0.92 + d.equilibrium * 0.5)) * rr * (0.74 + band * 0.24), band];
      };
      const p00 = make(u0, rk0), p10 = make(u1, rk0), p01 = make(u0, rk1), p11 = make(u1, rk1);
      const hInner = softHue(hue, rk0 * 0.70 + p00[2] * 0.16, p00[2], 0.003);
      const hOuter = softHue(hue, rk1 * 0.70 + p11[2] * 0.16, p11[2], 0.007);
      wr.writeTri(p00[0], p00[1], p10[0], p10[1], p11[0], p11[1], hInner, wrapHue01((hInner + hOuter) * 0.5), hOuter, light * 0.16, light * 0.20, light * (0.38 + p11[2] * 0.28), opts.sat, opts.sat * 1.03, opts.sat * 1.16);
      wr.writeTri(p00[0], p00[1], p11[0], p11[1], p01[0], p01[1], hInner, hOuter, hOuter, light * 0.14, light * (0.38 + p11[2] * 0.28), light * (0.26 + p01[2] * 0.18), opts.sat, opts.sat * 1.16, opts.sat * 1.06);
    }
  }
}

function drawFilledAuroraCurtains(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const cols = Math.floor(clamp(24 + amount * 38, 14, 92));
  const width = (1.46 * 2.0) / cols;
  for (let i = 0; i < cols && !wr.fillFull; i++) {
    const u = i / Math.max(1, cols - 1);
    const b = bands[(i * 3) % bands.length] || 0;
    const x0 = ribbonSpanX(i / cols, 1.46);
    const x1 = x0 + width * (0.65 + b * 0.24);
    const top = -0.82 + Math.sin(u * 8 + t * 0.17 + b * 2.0) * 0.16;
    const len = (0.42 + amount * 0.18 + b * 0.55 + feat.beat * 0.18) * (0.8 + Math.sin(u * TAU + t * 0.07) * 0.15);
    const bottom = Math.min(1.0, top + len);
    const mid = top + len * 0.48;
    const h0 = hue + 0.17 + u * 0.34 + b * 0.08;
    wr.writeTri(x0, top, x1, top + Math.sin(t + i) * 0.03, x1, mid, h0, h0 + 0.04, h0 + 0.10, light * 0.12, light * 0.20, light * (0.42 + b * 0.24), opts.sat * 0.9, opts.sat, opts.sat * 1.25);
    wr.writeTri(x0, top, x1, mid, x0, bottom, h0, h0 + 0.10, h0 + 0.17, light * 0.10, light * (0.42 + b * 0.24), light * 0.11, opts.sat * 0.9, opts.sat * 1.25, opts.sat * 0.75);
  }
}

function writeQuad(wr, x0, y0, x1, y1, h, light, sat, alphaLift = 1) {
  wr.writeTri(x0, y0, x1, y0, x1, y1, h, h + 0.035, h + 0.075, light * 0.18 * alphaLift, light * 0.24 * alphaLift, light * 0.48 * alphaLift, sat, sat * 1.08, sat * 1.22);
  wr.writeTri(x0, y0, x1, y1, x0, y1, h, h + 0.075, h + 0.12, light * 0.15 * alphaLift, light * 0.46 * alphaLift, light * 0.22 * alphaLift, sat, sat * 1.22, sat * 0.92);
}

function writeGlassQuad(wr, x0, y0, x1, y1, h, light, sat, shimmer = 0.0) {
  const cx = (x0 + x1) * 0.5;
  const cy = (y0 + y1) * 0.5;
  const w = x1 - x0;
  const hh = y1 - y0;
  const core = light * (0.13 + shimmer * 0.040);
  const edge = light * (0.040 + shimmer * 0.018);
  const gleam = light * (0.090 + shimmer * 0.030);
  const sSoft = softSat(sat, 0.92);
  const sEdge = softSat(sat, 1.24);
  wr.writeTri(x0, y0, x1, y0, cx, cy, h + 0.01, h + 0.05, h + 0.12, edge, gleam, core, sSoft, sEdge, sEdge);
  wr.writeTri(x1, y0, x1, y1, cx, cy, h + 0.05, h + 0.13, h + 0.12, gleam, edge, core, sEdge, sSoft, sEdge);
  wr.writeTri(x1, y1, x0, y1, cx, cy, h + 0.13, h + 0.18, h + 0.12, edge, gleam * 0.72, core, sSoft, sEdge, sEdge);
  wr.writeTri(x0, y1, x0, y0, cx, cy, h + 0.18, h + 0.01, h + 0.12, gleam * 0.62, edge, core, sEdge, sSoft, sEdge);
  if (!wr.fillFull && Math.abs(w) > 0.02 && Math.abs(hh) > 0.02) {
    const hx0 = x0 + w * 0.08, hy0 = y0 + hh * 0.15;
    const hx1 = x0 + w * 0.62, hy1 = y0 + hh * 0.22;
    const hx2 = x0 + w * 0.50, hy2 = y0 + hh * 0.36;
    const hx3 = x0 + w * 0.10, hy3 = y0 + hh * 0.28;
    wr.writeTri(hx0, hy0, hx1, hy1, hx2, hy2,
      h + 0.08, h + 0.12, h + 0.16,
      light * 0.030, light * (0.085 + shimmer * 0.018), light * 0.050,
      softSat(sat, 0.90), softSat(sat, 1.18), softSat(sat, 0.98));
    if (!wr.fillFull) wr.writeTri(hx0, hy0, hx2, hy2, hx3, hy3,
      h + 0.08, h + 0.16, h + 0.11,
      light * 0.028, light * 0.050, light * 0.022,
      softSat(sat, 0.90), softSat(sat, 0.98), softSat(sat, 0.82));
  }
}


function writeWarpedGlassQuad(wr, ax, ay, bx, by, cx, cy, dx, dy, h, light, sat, shimmer = 0.0) {
  const mx = (ax + bx + cx + dx) * 0.25;
  const my = (ay + by + cy + dy) * 0.25;
  const avgW = (Math.hypot(bx - ax, by - ay) + Math.hypot(cx - dx, cy - dy)) * 0.5;
  const avgH = (Math.hypot(dx - ax, dy - ay) + Math.hypot(cx - bx, cy - by)) * 0.5;
  const core = light * (0.13 + shimmer * 0.040);
  const edge = light * (0.040 + shimmer * 0.018);
  const gleam = light * (0.090 + shimmer * 0.030);
  const sSoft = softSat(sat, 0.92);
  const sEdge = softSat(sat, 1.24);
  wr.writeTri(ax, ay, bx, by, mx, my, h + 0.01, h + 0.05, h + 0.12, edge, gleam, core, sSoft, sEdge, sEdge);
  wr.writeTri(bx, by, cx, cy, mx, my, h + 0.05, h + 0.13, h + 0.12, gleam, edge, core, sEdge, sSoft, sEdge);
  wr.writeTri(cx, cy, dx, dy, mx, my, h + 0.13, h + 0.18, h + 0.12, edge, gleam * 0.72, core, sSoft, sEdge, sEdge);
  wr.writeTri(dx, dy, ax, ay, mx, my, h + 0.18, h + 0.01, h + 0.12, gleam * 0.62, edge, core, sEdge, sSoft, sEdge);
  if (!wr.fillFull && avgW > 0.02 && avgH > 0.02) {
    const ix0 = lerp(ax, mx, 0.20), iy0 = lerp(ay, my, 0.20);
    const ix1 = lerp(bx, mx, 0.20), iy1 = lerp(by, my, 0.20);
    const ix2 = lerp(cx, mx, 0.20), iy2 = lerp(cy, my, 0.20);
    const ix3 = lerp(dx, mx, 0.20), iy3 = lerp(dy, my, 0.20);
    const gx0 = lerp(ix0, ix1, 0.12), gy0 = lerp(iy0, iy1, 0.12);
    const gx1 = lerp(ix0, ix1, 0.68), gy1 = lerp(iy0, iy1, 0.68);
    const gx2 = lerp(ix3, ix2, 0.56), gy2 = lerp(iy3, iy2, 0.56);
    const gx3 = lerp(ix3, ix2, 0.16), gy3 = lerp(iy3, iy2, 0.16);
    wr.writeTri(gx0, gy0, gx1, gy1, gx2, gy2,
      h + 0.08, h + 0.12, h + 0.16,
      light * 0.030, light * (0.085 + shimmer * 0.018), light * 0.050,
      softSat(sat, 0.90), softSat(sat, 1.18), softSat(sat, 0.98));
    if (!wr.fillFull) wr.writeTri(gx0, gy0, gx2, gy2, gx3, gy3,
      h + 0.08, h + 0.16, h + 0.11,
      light * 0.028, light * 0.050, light * 0.022,
      softSat(sat, 0.90), softSat(sat, 0.98), softSat(sat, 0.82));
  }
}

function writeSoftHaloBlob(wr, cx, cy, rx, ry, h, light, sat, drift = 0.0) {
  const layers = 8;
  let needed = 0;
  for (let layer = 0; layer < layers; layer++) needed += 34 + layer * 5;
  if (!wr || !wr.canWriteTris || !wr.canWriteTris(needed)) return false;
  for (let layer = 0; layer < layers; layer++) {
    const lk = layer / Math.max(1, layers - 1);
    const feather = 1.48 - lk * 0.16;
    const radX = rx * feather;
    const radY = ry * feather;
    const sides = 34 + layer * 5;
    const centerLight = light * (0.008 + (1 - lk) * 0.006);
    const edgeLight = light * (0.040 + (1 - lk) * 0.016);
    for (let i = 0; i < sides; i++) {
      const u0 = i / sides;
      const u1 = (i + 1) / sides;
      const a0 = u0 * TAU;
      const a1 = u1 * TAU;
      const wob0 = 1.0 + Math.sin(a0 * (1.8 + drift * 0.5) + drift * 4.0) * 0.018;
      const wob1 = 1.0 + Math.sin(a1 * (1.8 + drift * 0.5) + drift * 4.0) * 0.018;
      const px0 = cx + Math.cos(a0) * radX * wob0;
      const py0 = cy + Math.sin(a0) * radY * wob0;
      const px1 = cx + Math.cos(a1) * radX * wob1;
      const py1 = cy + Math.sin(a1) * radY * wob1;
      wr.writeTri(cx, cy, px0, py0, px1, py1,
        h + lk * 0.010,
        h + 0.016 + lk * 0.018,
        h + 0.040 + lk * 0.024,
        centerLight,
        edgeLight,
        edgeLight * 0.92,
        softSat(sat, 1.28),
        softSat(sat, 1.52),
        softSat(sat, 1.42));
    }
  }
  return true;
}

function writeFrostedPane(wr, cx, cy, hw, hh, shearX, h, light, sat) {
  const layers = 7;
  for (let layer = 0; layer < layers && !wr.fillFull; layer++) {
    const lk = layer / Math.max(1, layers - 1);
    const grow = 1.18 + (1 - lk) * 0.16;
    const x0 = cx - hw * grow + shearX * 0.45;
    const y0 = cy - hh * grow;
    const x1 = cx + hw * grow + shearX * 0.55;
    const y1 = cy - hh * (0.96 + (1 - lk) * 0.04);
    const x2 = cx + hw * grow - shearX * 0.45;
    const y2 = cy + hh * grow;
    const x3 = cx - hw * grow - shearX * 0.55;
    const y3 = cy + hh * (0.96 + (1 - lk) * 0.04);
    const centerLight = light * (0.006 + (1 - lk) * 0.005);
    const edgeLight = light * (0.022 + (1 - lk) * 0.010);
    wr.writeTri(x0, y0, x1, y1, x2, y2,
      h + 0.00, h + 0.015, h + 0.028,
      edgeLight, edgeLight * 0.92, centerLight,
      softSat(sat, 1.26), softSat(sat, 1.42), softSat(sat, 1.30));
    if (!wr.fillFull) wr.writeTri(x0, y0, x2, y2, x3, y3,
      h + 0.00, h + 0.028, h + 0.012,
      edgeLight, centerLight, edgeLight * 0.90,
      softSat(sat, 1.26), softSat(sat, 1.30), softSat(sat, 1.20));
  }
}



function coherentFlow2(x, y, t, seed = 0, amp = 0.01, rate = 0.22, anisotropy = 1.0) {
  const a = t * rate + seed * 6.283 + x * 1.73 + y * 2.11;
  const b = t * rate * 0.71 + seed * 4.117 - x * 2.39 + y * 1.31;
  const c = t * rate * 0.43 + seed * 8.191 + x * 0.67 - y * 2.83;
  return [
    Math.sin(a) * amp * (0.72 + Math.cos(c) * 0.22) * anisotropy,
    Math.cos(b) * amp * (0.74 + Math.sin(c) * 0.20)
  ];
}

function styleShowcaseMix(t, leadSeconds = 2.4, fullSeconds = 5.8) {
  const start = Number(WORKER_STATE.backdropStyleBlendStart) || t;
  return smoothstep(leadSeconds, fullSeconds, Math.max(0, t - start));
}

function stableActivity(seed, signal = 0, beat = 0, floor = 0.0) {
  const bias = hash01(seed * 17.317 + 3.11) * 0.52 + Number(signal || 0) * 0.62 + Number(beat || 0) * 0.20;
  return clamp(floor + smoothstep(0.18, 0.98, bias) * (1 - floor), 0, 1);
}

function writeGlassHex(wr, cx, cy, rx, ry, h, light, sat, shimmer = 0.0, phase = 0.0) {
  const points = [];
  for (let i = 0; i < 6; i++) {
    const a = TAU * (i / 6) + Math.PI / 6;
    const wob = 1 + Math.sin(a * 2.0 + phase) * 0.030 + Math.cos(a * 3.0 - phase * 0.7) * 0.018;
    points.push([cx + Math.cos(a) * rx * wob, cy + Math.sin(a) * ry * wob]);
  }
  const coreLight = light * (0.13 + shimmer * 0.035);
  const edgeLight = light * (0.052 + shimmer * 0.018);
  for (let i = 0; i < 6 && !wr.fillFull; i++) {
    const a = points[i];
    const b = points[(i + 1) % 6];
    const lane = i / 6;
    wr.writeTri(cx, cy, a[0], a[1], b[0], b[1],
      h + 0.08, h + lane * 0.055, h + (lane + 0.16) * 0.055,
      coreLight, edgeLight * (1.10 + shimmer * 0.12), edgeLight,
      softSat(sat, 1.22), softSat(sat, 1.38), softSat(sat, 1.30));
  }
  for (let i = 0; i < 6 && !wr.full; i++) {
    const a = points[i];
    const b = points[(i + 1) % 6];
    wr.write(a[0], a[1], b[0], b[1], h + i * 0.010, h + 0.06 + i * 0.010, light * (0.12 + shimmer * 0.050), light * (0.16 + shimmer * 0.060), softSat(sat, 0.86), softSat(sat, 1.08));
  }
}

function applyBackdropRefractionPass(wr, opts, style) {
  const s = String(style || 'classic');
  const diffuseStyle = /dreamblobs|nebulawash|bokehbloom|chromafog|opalbloom|jazzhaze|ambientglow|spectralmist|cellular|cellfield|honeycomb|moire|lattice/.test(s);
  const lineStride = wr.segments > 7000 ? 4 : wr.segments > 4200 ? 3 : wr.segments > 2200 ? 2 : 1;
  const triStride = wr.triangles > 5200 ? 4 : wr.triangles > 3200 ? 3 : wr.triangles > 1800 ? 2 : 1;
  const lineCopies = diffuseStyle ? 2 : 1;
  const triCopies = diffuseStyle ? 2 : 1;
  const baseLineAmp = diffuseStyle ? 0.012 : 0.008;
  const baseTriAmp = diffuseStyle ? 0.016 : 0.010;
  const initialSegments = wr.segments;
  const initialTriangles = wr.triangles;

  for (let i = 0; i < initialSegments && !wr.full; i += lineStride) {
    const pi = i * 4;
    const ci = i * 6;
    const ax = wr.positions[pi + 0], ay = wr.positions[pi + 1], bx = wr.positions[pi + 2], by = wr.positions[pi + 3];
    const mx = (ax + bx) * 0.5;
    const my = (ay + by) * 0.5;
    const hslA = rgbToHsl01(wr.colors[ci + 0], wr.colors[ci + 1], wr.colors[ci + 2]);
    const hslB = rgbToHsl01(wr.colors[ci + 3], wr.colors[ci + 4], wr.colors[ci + 5]);
    for (let copy = 0; copy < lineCopies && !wr.full; copy++) {
      const dir = copy === 0 ? -1 : 1;
      const off = baseLineAmp * (1 + copy * 0.55) * (0.85 + Math.sin(opts.t * 0.001 + mx * 6.0 + my * 5.0) * 0.25);
      const ox = Math.sin(opts.t * 0.0010 + mx * 7.0 + my * 3.0 + copy * 1.7) * off * dir;
      const oy = Math.cos(opts.t * 0.0009 + mx * 5.0 - my * 6.0 + copy * 1.3) * off * 0.85 * dir;
      wr.write(
        ax + ox, ay + oy, bx + ox, by + oy,
        hslA[0], hslB[0],
        hslA[2] * 0.56, hslB[2] * 0.56,
        softSat(hslA[1], 1.18), softSat(hslB[1], 1.18)
      );
    }
  }

  for (let i = 0; i < initialTriangles && !wr.fillFull; i += triStride) {
    const pi = i * 6;
    const ci = i * 9;
    const ax = wr.fillPositions[pi + 0], ay = wr.fillPositions[pi + 1];
    const bx = wr.fillPositions[pi + 2], by = wr.fillPositions[pi + 3];
    const cx = wr.fillPositions[pi + 4], cy = wr.fillPositions[pi + 5];
    const mx = (ax + bx + cx) / 3;
    const my = (ay + by + cy) / 3;
    const hslA = rgbToHsl01(wr.fillColors[ci + 0], wr.fillColors[ci + 1], wr.fillColors[ci + 2]);
    const hslB = rgbToHsl01(wr.fillColors[ci + 3], wr.fillColors[ci + 4], wr.fillColors[ci + 5]);
    const hslC = rgbToHsl01(wr.fillColors[ci + 6], wr.fillColors[ci + 7], wr.fillColors[ci + 8]);
    for (let copy = 0; copy < triCopies && !wr.fillFull; copy++) {
      const dir = copy === 0 ? -1 : 1;
      const off = baseTriAmp * (1 + copy * 0.45) * (0.90 + Math.sin(opts.t * 0.0008 + mx * 4.5 + my * 4.5) * 0.20);
      const ox = Math.sin(opts.t * 0.0008 + mx * 5.2 + my * 2.9 + copy * 1.1) * off * dir;
      const oy = Math.cos(opts.t * 0.0007 + mx * 3.6 - my * 5.4 + copy * 1.6) * off * 0.86 * dir;
      wr.writeTri(
        ax + ox, ay + oy, bx + ox, by + oy, cx + ox, cy + oy,
        hslA[0], hslB[0], hslC[0],
        hslA[2] * 0.46, hslB[2] * 0.46, hslC[2] * 0.46,
        softSat(hslA[1], 1.16), softSat(hslB[1], 1.16), softSat(hslC[1], 1.16)
      );
    }
  }
}

const COLOR_SEPARATION_OFFSETS = [0.000, 0.055, 0.115, 0.185, 0.285, 0.430, 0.575, 0.715];
function rgbSpread(r, g, b) {
  return Math.max(r, g, b) - Math.min(r, g, b);
}
function separatedPaletteHue(baseHue, index, existingHue, existingSat) {
  const offset = COLOR_SEPARATION_OFFSETS[Math.abs(index) % COLOR_SEPARATION_OFFSETS.length];
  const fallback = wrapHue01(baseHue + offset);
  // If the original hue is meaningful, keep some of it. If the color has
  // already collapsed toward gray/white, trust the palette lane instead.
  return existingSat > 0.18 ? wrapHue01(existingHue * 0.42 + fallback * 0.58) : fallback;
}
function rescueSeparatedRgb(r, g, b, index, baseHue, amount, minSat, minSpread, isFill = false) {
  const hsl = rgbToHsl01(r, g, b);
  const spread = rgbSpread(r, g, b);
  const collapsed = spread < minSpread || hsl[1] < minSat * 0.72 || (hsl[2] > 0.70 && hsl[1] < minSat * 0.95);
  const hue = collapsed ? separatedPaletteHue(baseHue, index, hsl[0], hsl[1]) : hsl[0];
  let sat = clamp(hsl[1] * (1 + amount * (isFill ? 1.35 : 1.15)) + amount * (isFill ? 0.12 : 0.09), minSat, 1.0);
  let light = clamp(hsl[2] * (collapsed ? 0.84 : 0.94) - amount * 0.018, 0.018, isFill ? 0.72 : 0.78);
  let rgb = hslToRgb01(hue, sat, light);
  // Hard stop: do not let R/G/B stay too close after the boost. If they do,
  // raise saturation and slightly dim rather than drifting into white/gray.
  if (rgbSpread(rgb[0], rgb[1], rgb[2]) < minSpread) {
    sat = clamp(Math.max(sat, minSat + 0.22), 0, 1);
    light = clamp(light * 0.88, 0.018, isFill ? 0.66 : 0.72);
    rgb = hslToRgb01(hue, sat, light);
  }
  return rgb;
}
function applyVibranceBoost(lineColors, fillColors, amount = 0.16, baseHue = 0.55) {
  for (let i = 0; i < lineColors.length; i += 3) {
    const rgb = rescueSeparatedRgb(
      lineColors[i + 0], lineColors[i + 1], lineColors[i + 2],
      i / 3, baseHue, amount, 0.46, 0.145, false
    );
    lineColors[i + 0] = rgb[0];
    lineColors[i + 1] = rgb[1];
    lineColors[i + 2] = rgb[2];
  }
  for (let i = 0; i < fillColors.length; i += 3) {
    const rgb = rescueSeparatedRgb(
      fillColors[i + 0], fillColors[i + 1], fillColors[i + 2],
      i / 3, baseHue + 0.035, amount, 0.52, 0.165, true
    );
    fillColors[i + 0] = rgb[0];
    fillColors[i + 1] = rgb[1];
    fillColors[i + 2] = rgb[2];
  }
}

function usesRadialBackdropGradient(style) {
  const s = resolveBackdropProfileStyle(style);
  return /cymatics|rings|vectorscope|tunnel|colorbursts|opalbloom|bokehbloom|dreamblobs|nebulawash|ambientglow|spectralmist|aurora|starfield/.test(s);
}
function usesRibbonBackdropGradient(style) {
  const s = resolveBackdropProfileStyle(style);
  return /ribbons|trails|lightfield|silkflow|gradientflow|softwaves|contourveil|prismadrift|sinefield|oscilloscope/.test(s);
}
function orientedBackdropLane(style, x, y) {
  const s = resolveBackdropProfileStyle(style);
  const xx = Number(x) || 0;
  const yy = Number(y) || 0;
  const vertical = smoothstep(-1.02, 1.02, yy);
  const horizontal = smoothstep(-1.18, 1.18, xx);
  const softVertical = smoothstep(-1.10, 1.10, yy * 0.82 + xx * 0.12);
  const softHorizontal = smoothstep(-1.18, 1.18, xx * 0.86 - yy * 0.10);
  if (usesRadialBackdropGradient(s)) {
    const r = Math.sqrt(xx * xx * 0.92 + yy * yy);
    const radial = smoothstep(0.02, 1.22, r);
    const lane = radial * 0.78 + vertical * 0.12 + softVertical * 0.10;
    return clamp(lane, 0, 1);
  }
  if (usesRibbonBackdropGradient(s)) {
    // Ribbons/bands should show a visible side-to-side + cross-band gradient,
    // not a single flat screen-height color.
    const lane = horizontal * 0.44 + softHorizontal * 0.24 + vertical * 0.20 + softVertical * 0.12;
    return clamp(lane, 0, 1);
  }
  const lane = vertical * 0.66 + softVertical * 0.22 + horizontal * 0.12;
  return clamp(lane, 0, 1);
}
function orientedBackdropColor(style, x, y, originalRgb, baseHue, sat, light, isFill = false, laneOverride = null) {
  const hsl = rgbToHsl01(originalRgb[0], originalRgb[1], originalRgb[2]);
  const baseLane = orientedBackdropLane(style, x, y);
  const lane = Number.isFinite(laneOverride) ? clamp(baseLane * 0.40 + laneOverride * 0.60, 0, 1) : baseLane;
  const shapedLane = lane * lane * (3 - 2 * lane);
  const target = paletteColor(style, baseHue, sat, light * (isFill ? 0.98 : 1.0), shapedLane, hsl[2]);
  const targetHsl = rgbToHsl01(target[0], target[1], target[2]);
  const edgeBoost = Math.abs(shapedLane - 0.5) * 0.18;
  const mixAmt = clamp((isFill ? 0.66 : 0.58) + edgeBoost, 0.44, isFill ? 0.82 : 0.76);
  let rgb = [
    originalRgb[0] * (1 - mixAmt) + target[0] * mixAmt,
    originalRgb[1] * (1 - mixAmt) + target[1] * mixAmt,
    originalRgb[2] * (1 - mixAmt) + target[2] * mixAmt,
  ];
  let out = rgbToHsl01(rgb[0], rgb[1], rgb[2]);
  // Fades should dim, not desaturate. Keep a minimum chroma floor after the
  // directional remap so colors stay rich without reverting to RGB pie slices.
  const minSat = isFill ? 0.46 : 0.40;
  const satBoost = Math.max(minSat, out[1] * 1.06, targetHsl[1] * (isFill ? 0.78 : 0.68));
  const keptLight = clamp(hsl[2] * 0.50 + targetHsl[2] * 0.50, 0.018, isFill ? 0.76 : 0.82);
  rgb = hslToRgb01(out[0], clamp(satBoost, 0, 1), keptLight);
  return rgb;
}
function enforceOrientedBackdropGradients(style, positions, colors, fillPositions, fillColors, baseHue, sat, light) {
  const styleName = style || 'classic';
  const radialMode = usesRadialBackdropGradient(styleName);
  const ribbonMode = usesRibbonBackdropGradient(styleName);
  const lineVerts = Math.floor((colors && colors.length ? colors.length : 0) / 3);
  for (let v = 0; v < lineVerts; v++) {
    const seg = Math.floor(v / 2);
    const endpoint = v % 2;
    const pi = seg * 4 + endpoint * 2;
    const ci = v * 3;
    const ax = positions[seg * 4 + 0], ay = positions[seg * 4 + 1];
    const bx = positions[seg * 4 + 2], by = positions[seg * 4 + 3];
    let laneOverride = null;
    if (ribbonMode) {
      const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx);
      const y0 = Math.min(ay, by), y1 = Math.max(ay, by);
      const spanX = Math.max(0.001, x1 - x0);
      const spanY = Math.max(0.001, y1 - y0);
      const x = positions[pi + 0], y = positions[pi + 1];
      const across = spanX > spanY ? (x - x0) / spanX : (y - y0) / spanY;
      laneOverride = clamp(across * 0.72 + smoothstep(-1.1, 1.1, x) * 0.28, 0, 1);
    }
    const rgb = orientedBackdropColor(styleName, positions[pi + 0], positions[pi + 1], [colors[ci + 0], colors[ci + 1], colors[ci + 2]], baseHue, sat, light, false, laneOverride);
    colors[ci + 0] = rgb[0]; colors[ci + 1] = rgb[1]; colors[ci + 2] = rgb[2];
  }
  const triCount = Math.floor((fillColors && fillColors.length ? fillColors.length : 0) / 9);
  for (let tri = 0; tri < triCount; tri++) {
    const pi = tri * 6;
    const ci = tri * 9;
    const ax = fillPositions[pi + 0], ay = fillPositions[pi + 1];
    const bx = fillPositions[pi + 2], by = fillPositions[pi + 3];
    const cx = fillPositions[pi + 4], cy = fillPositions[pi + 5];
    const minX = Math.min(ax, bx, cx), maxX = Math.max(ax, bx, cx);
    const minY = Math.min(ay, by, cy), maxY = Math.max(ay, by, cy);
    const spanX = Math.max(0.001, maxX - minX);
    const spanY = Math.max(0.001, maxY - minY);
    const midX = (ax + bx + cx) / 3;
    const midY = (ay + by + cy) / 3;
    const maxR = Math.max(
      0.001,
      Math.hypot(ax - midX, ay - midY),
      Math.hypot(bx - midX, by - midY),
      Math.hypot(cx - midX, cy - midY)
    );
    for (let corner = 0; corner < 3; corner++) {
      const vx = fillPositions[pi + corner * 2 + 0];
      const vy = fillPositions[pi + corner * 2 + 1];
      const cix = ci + corner * 3;
      let laneOverride = null;
      if (radialMode) {
        const screenR = smoothstep(0.02, 1.22, Math.hypot(vx * 0.92, vy));
        const screenAngle = 0.5 + 0.5 * Math.sin(Math.atan2(vy, vx) * 2.0);
        laneOverride = clamp(screenR * 0.86 + screenAngle * 0.14, 0, 1);
      } else if (ribbonMode) {
        const side = smoothstep(-1.15, 1.15, vx);
        const heightLane = smoothstep(-1.05, 1.05, vy);
        const flowLane = 0.5 + 0.5 * Math.sin(vx * 2.2 + vy * 0.55);
        laneOverride = clamp(side * 0.46 + heightLane * 0.34 + flowLane * 0.20, 0, 1);
      }
      const rgb = orientedBackdropColor(styleName, vx, vy, [fillColors[cix + 0], fillColors[cix + 1], fillColors[cix + 2]], baseHue, sat, light, true, laneOverride);
      fillColors[cix + 0] = rgb[0]; fillColors[cix + 1] = rgb[1]; fillColors[cix + 2] = rgb[2];
    }
  }
}


function applyBackdropMotionFlow(wr, style, t, amount = 1, motion = 0) {
  const motionStrength = clamp(Number(motion) || 0, 0, 1);
  if (motionStrength <= 0.001) return;
  const s = resolveBackdropStyleFamily(style || 'classic');
  const matrixMode = s === 'matrixrain' || s === 'matrixcrawl';
  const gridMode = s === 'cellular' || s === 'cellfield' || s === 'honeycomb' || s === 'moire' || s === 'lattice';
  const ribbonMode = s === 'trails' || s === 'ribbons' || s === 'aurora' || s === 'softwaves' || s === 'sinefield' || s === 'gradientflow' || s === 'contourveil' || s === 'silkflow';
  const softMode = isSoftIdentityStyle(s);
  const radialMode = isRadialIdentityStyle(s);
  const amp = matrixMode ? 0.0075 : gridMode ? 0.0085 : ribbonMode ? 0.0100 : softMode ? 0.0030 : radialMode ? 0.0 : 0.0080;
  const rate = matrixMode ? 0.30 : gridMode ? 0.22 : ribbonMode ? 0.23 : softMode ? 0.12 : radialMode ? 0.0 : 0.21;
  const strength = clamp(amount, 0.25, 2.0) * motionStrength;

  if (softMode || radialMode) return;

  const nudge = (x, y, idx, isFill = false) => {
    const seed = hash01(idx * 0.071 + (isFill ? 4.7 : 1.3));
    if (matrixMode) {
      const lane = Math.sin(x * 12.0 + seed * TAU);
      const driftY = Math.sin(t * rate + seed * 8.0 + x * 3.0) * amp * 1.10 * strength;
      const driftX = Math.sin(t * rate * 0.55 + y * 2.1 + seed * 5.0) * amp * 0.22 * strength + lane * amp * 0.10;
      return [clamp(x + driftX, -3, 3), clamp(y + driftY, -3, 3)];
    }
    if (gridMode) {
      const flow = coherentFlow2(x, y, t, seed, amp * strength, rate, 0.78);
      const wave = Math.sin((x * 2.2 + y * 1.8) + t * rate * 0.82 + seed * 4.0) * amp * 0.40 * strength;
      return [clamp(x + flow[0] + wave * 0.35, -3, 3), clamp(y + flow[1] + wave * 0.22, -3, 3)];
    }
    if (ribbonMode) {
      const wave = Math.sin(x * 4.4 + t * rate + seed * TAU) * amp * 1.25 * strength;
      const slide = Math.cos(y * 3.1 + t * rate * 0.72 + seed * 5.0) * amp * 0.40 * strength;
      return [clamp(x + slide, -3, 3), clamp(y + wave, -3, 3)];
    }
    const flow = coherentFlow2(x, y, t, seed, amp * strength, rate, 1.0);
    return [clamp(x + flow[0], -3, 3), clamp(y + flow[1], -3, 3)];
  };

  for (let i = 0; i < wr.segments; i++) {
    const j = i * 4;
    const a = nudge(wr.positions[j + 0], wr.positions[j + 1], i * 2, false);
    const b = nudge(wr.positions[j + 2], wr.positions[j + 3], i * 2 + 1, false);
    wr.positions[j + 0] = a[0]; wr.positions[j + 1] = a[1];
    wr.positions[j + 2] = b[0]; wr.positions[j + 3] = b[1];
  }

  // Filled sheets, bars, matrix blocks, and hex/cell primitives already encode
  // their animation inside the generator. Warping their vertices again turns
  // rectangles into diagonal shards and exposes internal triangle seams.
  if (preservesFillPrimitiveGeometry(s)) return;

  for (let i = 0; i < wr.triangles; i++) {
    const j = i * 6;
    for (let v = 0; v < 3; v++) {
      const k = j + v * 2;
      const p = nudge(wr.fillPositions[k + 0], wr.fillPositions[k + 1], i * 3 + v, true);
      wr.fillPositions[k + 0] = p[0]; wr.fillPositions[k + 1] = p[1];
    }
  }
}

function featherBackdropFillEdges(fillPositions, fillColors, triangleCount) {
  const count = Math.max(0, triangleCount | 0);
  if (!count || !fillPositions || !fillColors) {
    return { fillPositions, fillColors, triangles: count };
  }
  const FEATHER_TRIANGLE_BUDGET = 15000;
  if (count * 3 > FEATHER_TRIANGLE_BUDGET) {
    return { fillPositions, fillColors, triangles: count };
  }
  const outCount = count * 3;
  const outPos = new Float32Array(outCount * 6);
  const outCol = new Float32Array(outCount * 9);
  let tri = 0;
  const copyTri = (ax, ay, bx, by, cx, cy, ca, cb, cc) => {
    const pi = tri * 6;
    const ci = tri * 9;
    outPos[pi + 0] = ax; outPos[pi + 1] = ay;
    outPos[pi + 2] = bx; outPos[pi + 3] = by;
    outPos[pi + 4] = cx; outPos[pi + 5] = cy;
    outCol[ci + 0] = ca[0]; outCol[ci + 1] = ca[1]; outCol[ci + 2] = ca[2];
    outCol[ci + 3] = cb[0]; outCol[ci + 4] = cb[1]; outCol[ci + 5] = cb[2];
    outCol[ci + 6] = cc[0]; outCol[ci + 7] = cc[1]; outCol[ci + 8] = cc[2];
    tri++;
  };
  const dim = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
  const mix = (a, b, k) => [a[0] * (1 - k) + b[0] * k, a[1] * (1 - k) + b[1] * k, a[2] * (1 - k) + b[2] * k];
  for (let i = 0; i < count; i++) {
    const pi = i * 6;
    const ci = i * 9;
    const ax = fillPositions[pi + 0], ay = fillPositions[pi + 1];
    const bx = fillPositions[pi + 2], by = fillPositions[pi + 3];
    const cx = fillPositions[pi + 4], cy = fillPositions[pi + 5];
    const ca = [fillColors[ci + 0], fillColors[ci + 1], fillColors[ci + 2]];
    const cb = [fillColors[ci + 3], fillColors[ci + 4], fillColors[ci + 5]];
    const cc = [fillColors[ci + 6], fillColors[ci + 7], fillColors[ci + 8]];
    const mx = (ax + bx + cx) / 3;
    const my = (ay + by + cy) / 3;
    const center = [
      clamp((ca[0] + cb[0] + cc[0]) / 3 * 1.10, 0, 1),
      clamp((ca[1] + cb[1] + cc[1]) / 3 * 1.10, 0, 1),
      clamp((ca[2] + cb[2] + cc[2]) / 3 * 1.10, 0, 1)
    ];
    // Two-step feather: original outside vertices are dimmed, and the newly
    // inserted centroid stays brighter. With additive blending this reads like
    // soft alpha without needing per-vertex opacity support.
    const ea = dim(mix(ca, center, 0.10), 0.34);
    const eb = dim(mix(cb, center, 0.10), 0.34);
    const ec = dim(mix(cc, center, 0.10), 0.34);
    copyTri(mx, my, ax, ay, bx, by, center, ea, eb);
    copyTri(mx, my, bx, by, cx, cy, center, eb, ec);
    copyTri(mx, my, cx, cy, ax, ay, center, ec, ea);
  }
  return { fillPositions: outPos, fillColors: outCol, triangles: tri };
}

function drawFrostedDiffusionField(wr, bands, feat, d, opts, style) {
  const s = String(style || 'classic');
  const diffuseStyle = /dreamblobs|nebulawash|bokehbloom|chromafog|opalbloom|jazzhaze|ambientglow|spectralmist|cellular|cellfield|honeycomb/.test(s);
  const glowCount = diffuseStyle ? Math.floor(clamp(10 + opts.amount * 4.0, 10, 20)) : Math.floor(clamp(7 + opts.amount * 3.0, 7, 14));
  for (let i = 0; i < glowCount && !wr.fillFull; i++) {
    const seed = hash01(i * 29.1 + 4.2);
    const band = bands[(i * 3 + 5) % Math.max(1, bands.length)] || 0;
    const driftA = opts.t * (0.0006 + seed * 0.0008);
    const radius = 0.14 + seed * 0.34;
    const cx = ax2(Math.cos(seed * TAU + driftA) * radius, opts);
    const cy = Math.sin(seed * TAU * 0.93 - driftA * 1.1) * radius * 0.54;
    const baseR = 0.08 + seed * 0.08 + band * 0.05 + opts.amount * 0.012;
    const rx = baseR * (0.96 + hash01(seed * 11.3) * 0.08);
    const ry = baseR * (0.92 + hash01(seed * 17.9) * 0.08);
    const blobHue = softHue(opts.hue, seed * 0.8 + band * 0.25, band, 0.010);
    const blobLight = opts.light * (0.40 + band * 0.06);
    writeSoftHaloBlob(wr, cx, cy, rx, ry, blobHue, blobLight, opts.sat * 1.34, seed * 1.2);
  }

  const cols = diffuseStyle ? 9 : 7;
  const rows = diffuseStyle ? 6 : 5;
  for (let gy = 0; gy < rows && !wr.fillFull; gy++) {
    for (let gx = 0; gx < cols && !wr.fillFull; gx++) {
      const idx = gy * cols + gx;
      const seed = hash01(idx * 17.3 + 2.8);
      if (seed < 0.18) continue;
      const band = bands[(idx * 2 + 7) % Math.max(1, bands.length)] || 0;
      const jitterX = (hash01(seed * 31.7) - 0.5) * 0.12;
      const jitterY = (hash01(seed * 43.3) - 0.5) * 0.10;
      const driftX = Math.sin(opts.t * (0.0005 + seed * 0.0007) + seed * 12.0) * 0.010;
      const driftY = Math.cos(opts.t * (0.0004 + seed * 0.0006) + seed * 8.0) * 0.008;
      const cx = ax2(-0.94 + ((gx + 0.5) / cols) * 1.88 + jitterX + driftX, opts);
      const cy = -0.80 + ((gy + 0.5) / rows) * 1.60 + jitterY + driftY;
      const hw = 0.055 + hash01(seed * 9.1) * 0.045 + band * 0.018;
      const hh = 0.045 + hash01(seed * 12.4) * 0.040 + band * 0.014;
      const shearX = (hash01(seed * 5.4) - 0.5) * 0.028;
      const paneHue = softHue(opts.hue, seed * 0.65 + gy * 0.06 + gx * 0.03, band, 0.008);
      const paneLight = opts.light * (0.34 + band * 0.06);
      writeFrostedPane(wr, cx, cy, hw, hh, shearX, paneHue, paneLight, opts.sat * 1.34);
      if (!wr.fillFull && seed > 0.42) {
        writeSoftHaloBlob(wr, cx, cy, hw * 0.60, hh * 0.60, paneHue + 0.01, opts.light * (0.12 + band * 0.03), opts.sat * 1.24, seed * 1.8);
      }
    }
  }
}

function applyFrostedGlassPass(wr, bands, feat, d, opts, style) {
  const s = String(style || 'classic');
  const diffuseStyle = /dreamblobs|nebulawash|bokehbloom|chromafog|opalbloom|jazzhaze|ambientglow|spectralmist|cellular|cellfield|honeycomb/.test(s);
  drawFrostedDiffusionField(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.92, light: opts.light * 0.88, sat: opts.sat * 1.12 }, s);
  const paneCount = diffuseStyle ? Math.floor(clamp(3 + opts.amount * 1.4, 3, 6)) : Math.floor(clamp(2 + opts.amount * 1.0, 2, 4));
  for (let i = 0; i < paneCount && !wr.fillFull; i++) {
    const seed = hash01(i * 19.7 + 3.1);
    const band = bands[(i * 7 + 3) % Math.max(1, bands.length)] || 0;
    const driftX = Math.sin(opts.t * (0.0006 + seed * 0.0008) + seed * TAU) * 0.018;
    const driftY = Math.cos(opts.t * (0.0005 + seed * 0.0007) + seed * TAU * 0.7) * 0.016;
    const cx = ax2(-0.44 + seed * 0.88 + driftX, opts);
    const cy = -0.34 + hash01(seed * 17.1) * 0.68 + driftY;
    const hw = 0.08 + seed * 0.05 + band * 0.018;
    const hhBase = 0.07 + hash01(seed * 9.2) * 0.04 + band * 0.012;
    const hh = hhBase * (0.94 + hash01(seed * 5.7) * 0.10);
    const shearX = (seed - 0.5) * 0.026;
    const paneHue = softHue(opts.hue, seed * 0.55 + band * 0.20, band, 0.008);
    const paneLight = opts.light * (0.24 + band * 0.05);
    writeFrostedPane(wr, cx, cy, hw, hh, shearX, paneHue, paneLight, opts.sat * 1.38);
  }
}

function drawFilledMatrixBlocks(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const cols = Math.floor(clamp(18 + amount * 24, 14, 56));
  const rows = Math.floor(clamp(11 + amount * 14, 9, 34));
  const dx = 2.18 / cols;
  const dy = 1.72 / rows;
  const beat = clamp(feat.beat || 0, 0, 1);
  for (let c = 0; c < cols && !wr.fillFull; c++) {
    const seed = hash01(c * 31.7 + 11.3);
    const band = bands[(c * 5) % Math.max(1, bands.length)] || 0;
    const speed = 0.12 + seed * 0.34 + d.tempo * 0.075;
    const head = ((t * speed + seed * 3.0) % 1) * 2.34 - 1.17;
    const tailRows = Math.floor(clamp(3 + band * 7 + amount * 2, 3, Math.max(4, Math.floor(rows * 0.68))));
    const laneWobble = Math.sin(t * 0.10 + c * 0.73 + seed * 3.0) * dx * 0.055;
    for (let j = 0; j < tailRows && !wr.fillFull; j++) {
      const fade = 1 - j / Math.max(1, tailRows);
      const y = head - j * dy * (0.88 + seed * 0.18);
      if (y < -1.10 || y > 1.08) continue;
      const drip = Math.sin(t * 0.18 + j * 0.38 + seed * 9.0) * dy * 0.035;
      const x = -1.09 + c * dx + laneWobble;
      const w = dx * (0.14 + hash01(c * 9.1 + j) * 0.16 + band * 0.10);
      const h = dy * (0.22 + hash01(c * 5.3 + j * 2.1) * 0.18 + fade * 0.10);
      const hueJ = hue + 0.26 + seed * 0.15 + band * 0.12 + j * 0.008;
      const live = smoothstep(0.02, 0.95, fade + band * 0.28 + beat * 0.10);
      writeQuad(wr, x, y + drip, x + w, y + h + drip, hueJ, light * (0.15 + fade * 0.42 + band * 0.13) * live, opts.sat * (0.82 + fade * 0.36), 0.52 + fade * 0.56);
      if ((j & 1) === 0 && !wr.full) wr.write(x, y + h * 0.5 + drip, x + w * (1.25 + fade * 0.8), y + h * 0.5 + drip, hueJ + 0.02, hueJ + 0.11, light * (0.22 + fade * 0.28), light * (0.14 + fade * 0.15));
    }
  }
}

function drawFilledGridPulse(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const cols = Math.floor(clamp(8 + amount * 12, 7, 26));
  const rows = Math.floor(clamp(6 + amount * 9, 5, 20));
  const dx = 2.0 / cols;
  const dy = 1.55 / rows;
  const beat = clamp(feat.beat || 0, 0, 1);
  for (let y = 0; y < rows && !wr.fillFull; y++) {
    for (let x = 0; x < cols && !wr.fillFull; x++) {
      const k = y * cols + x;
      const seed = hash01(k * 12.73 + 0.61);
      const b = bands[(k * 3) % Math.max(1, bands.length)] || 0;
      const u = x / Math.max(1, cols - 1);
      const v = y / Math.max(1, rows - 1);
      const pulse = 0.5 + 0.5 * Math.sin(t * (0.36 + d.tempo * 0.06) + k * 0.57 + b * 3.0);
      const gate = stableActivity(k * 0.29 + 5.0, b * 0.74 + pulse * 0.22, beat, 0.10);
      if (seed < 0.10 && gate < 0.20) continue;
      const flow = coherentFlow2(u - 0.5, v - 0.5, t, seed, Math.min(dx, dy) * (0.045 + b * 0.022), 0.22, 1.0);
      const cx = -1.0 + x * dx + dx * 0.5 + flow[0];
      const cy = -0.78 + y * dy + dy * 0.5 + flow[1];
      const sz = Math.min(dx, dy) * (0.16 + pulse * 0.19 + b * 0.28 + beat * 0.07);
      const h = softHue(hue, u * 0.24 + v * 0.10, b, 0.006);
      writeQuad(wr, cx - sz, cy - sz * (0.82 + seed * 0.25), cx + sz, cy + sz * (0.82 + seed * 0.25), h, light * (0.10 + pulse * 0.23 + b * 0.17) * gate, opts.sat * 1.18, 0.52 + gate * 0.30);
    }
  }
}

function drawScanlinePostGrid(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const rows = Math.floor(clamp(14 + amount * 20, 10, 52));
  for (let r = 0; r < rows && !wr.fillFull; r++) {
    const v = r / Math.max(1, rows - 1);
    const b = bands[(r * 7) % bands.length] || 0;
    const y = -0.92 + v * 1.84 + Math.sin(t * 0.5 + r) * 0.006;
    const h = 0.006 + b * 0.020 + feat.beat * 0.006;
    const x0 = -1.15 + Math.sin(t * 0.22 + r) * (0.05 + b * 0.05);
    const x1 = 1.15 - Math.cos(t * 0.19 + r) * (0.05 + b * 0.04);
    const hueR = hue + 0.52 + v * 0.20 + b * 0.12;
    wr.writeTri(x0, y - h, x1, y - h * 0.3, x1, y + h, hueR, hueR + 0.03, hueR + 0.06, light * 0.08, light * (0.18 + b * 0.16), light * 0.09, opts.sat * 0.8, opts.sat, opts.sat * 0.85);
    wr.writeTri(x0, y - h, x1, y + h, x0, y + h * 0.4, hueR, hueR + 0.06, hueR + 0.02, light * 0.08, light * 0.09, light * (0.14 + b * 0.14), opts.sat * 0.8, opts.sat * 0.85, opts.sat);
  }
}


function ax2(x, opts) {
  // Worker geometry is normalized; the main thread scales X by camera aspect.
  // Divide radial/circular X here so cymatic rings stay circular on widescreen.
  return x / Math.max(0.35, Math.min(3.5, opts.aspect || 1));
}

function drawCymaticBloom(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const rings = Math.floor(clamp(4 + amount * 5 + feat.beat * 3, 3, 12));
  const steps = Math.floor(clamp(72 + amount * 64, 48, 180));
  for (let r = 0; r < rings && !wr.fillFull; r++) {
    const rk0 = r / rings;
    const rk1 = (r + 1) / rings;
    const petalCount = 4 + ((r + Math.floor(d.scaleDepth * 2)) % 8);
    for (let i = 0; i < steps && !wr.fillFull; i++) {
      const u0 = i / steps;
      const u1 = (i + 1) / steps;
      const make = (u, rk) => {
        const band = bands[(Math.floor(u * bands.length) + r * 5) % bands.length] || 0;
        const a = u * TAU + t * (0.10 + d.tempo * 0.045) + r * 0.08;
        const petal = Math.sin(a * petalCount + t * (0.6 + d.tempo * 0.2)) * (0.035 + band * 0.11 + feat.beat * 0.045);
        const maxRadius = Number.isFinite(opts.maxRadius) ? clamp(opts.maxRadius, 0.18, 1.10) : 1.10;
        const rr = clamp(0.075 + rk * (0.78 + amount * 0.05) + petal, 0.025, maxRadius);
        return [ax2(Math.cos(a) * rr, opts), Math.sin(a) * rr * (0.86 + band * 0.10), band, a];
      };
      const p00 = make(u0, rk0), p10 = make(u1, rk0), p01 = make(u0, rk1), p11 = make(u1, rk1);
      const h = softHue(hue, u0 * 0.12 + rk1 * 0.12, p11[2], 0.008);
      wr.writeTri(p00[0], p00[1], p10[0], p10[1], p11[0], p11[1], h, h + 0.04, h + 0.12, light * 0.10, light * 0.18, light * (0.40 + p11[2] * 0.30), opts.sat, opts.sat * 1.14, opts.sat * 1.35);
      wr.writeTri(p00[0], p00[1], p11[0], p11[1], p01[0], p01[1], h, h + 0.12, h + 0.20, light * 0.08, light * (0.38 + p11[2] * 0.26), light * 0.18, opts.sat, opts.sat * 1.28, opts.sat * 1.08);
      if ((i % Math.max(6, Math.floor(steps / 18))) === 0 && !wr.full) {
        wr.write(p00[0], p00[1], p01[0], p01[1], h + 0.04, h + 0.18, light * 0.42, light * 0.58, opts.sat * 1.2, opts.sat * 1.35);
      }
    }
  }
}

function drawSacredGeometry(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const circles = Math.floor(clamp(5 + amount * 7, 5, 18));
  const steps = Math.floor(clamp(64 + amount * 40, 48, 144));
  const baseR = 0.22 + amount * 0.035 + feat.beat * 0.025;
  const centers = [[0,0]];
  for (let c = 0; c < circles; c++) {
    const a = c / Math.max(1, circles) * TAU + t * 0.045;
    const rr = baseR * (1.05 + (c % 3) * 0.55);
    centers.push([ax2(Math.cos(a) * rr, opts), Math.sin(a) * rr]);
  }
  for (let ci = 0; ci < centers.length && !wr.full; ci++) {
    const cen = centers[ci];
    const band = bands[(ci * 5) % bands.length] || 0;
    const rad = baseR * (0.72 + (ci % 4) * 0.18 + band * 0.32);
    let first = null, prev = null;
    for (let i = 0; i <= steps && !wr.full; i++) {
      const u = i / steps;
      const a = u * TAU + t * (0.04 + d.tempo * 0.02) * (ci % 2 ? -1 : 1);
      const p = [cen[0] + ax2(Math.cos(a) * rad, opts), cen[1] + Math.sin(a) * rad];
      if (prev) wr.write(prev[0], prev[1], p[0], p[1], hue + ci * 0.041 + u * 0.16, hue + ci * 0.045 + u * 0.22, light * (0.42 + band * 0.25), light * (0.55 + band * 0.28), opts.sat * 1.1, opts.sat * 1.22);
      else first = p;
      if ((i % Math.max(8, Math.floor(steps / 8))) === 0 && ci > 0 && !wr.full) wr.write(cen[0], cen[1], p[0], p[1], hue + 0.2 + ci * 0.05, hue + u * 0.33, light * 0.30, light * (0.56 + band * 0.22), opts.sat, opts.sat * 1.25);
      prev = p;
    }
    if (first && prev && !wr.full) wr.write(prev[0], prev[1], first[0], first[1], hue + ci * 0.04, hue + ci * 0.04 + 0.08, light * 0.38, light * 0.48);
  }
  // soft filled flower core
  if (wr.canWriteTris && !wr.canWriteTris(Math.max(0, centers.length - 2))) return;
  for (let i = 1; i < centers.length - 1 && !wr.fillFull; i++) {
    const a = i / Math.max(1, centers.length - 1);
    const b = bands[(i * 7) % bands.length] || 0;
    wr.writeTri(0, 0, centers[i][0], centers[i][1], centers[i + 1][0], centers[i + 1][1], hue + a * 0.30, hue + 0.14 + a * 0.24, hue + 0.26 + a * 0.25, light * 0.08, light * (0.22 + b * 0.18), light * (0.20 + b * 0.16), opts.sat * 0.85, opts.sat * 1.15, opts.sat * 1.05);
  }
}

function drawMatrixScreenCrawl(wr, bands, feat, d, opts) {
  drawFilledMatrixBlocks(wr, bands, feat, d, { ...opts, amount: opts.amount * 1.20, light: opts.light * 0.92, hue: opts.hue + 0.18 });
  const cols = Math.floor(clamp(22 + opts.amount * 36, 16, 82));
  const rows = Math.floor(clamp(8 + opts.amount * 12, 6, 30));
  const dx = 2.18 / cols;
  const dy = 1.74 / rows;
  for (let c = 0; c < cols && !wr.full; c += 2) {
    const seed = hash01(c * 8.19 + 0.31);
    const head = ((opts.t * (0.36 + seed * 0.75 + d.tempo * 0.12) + seed * 4.0) % 1) * 2.10 - 1.05;
    for (let r = 0; r < rows && !wr.full; r++) {
      const y = head - r * dy * 0.92;
      if (y < -1.02 || y > 1.04) continue;
      const x = -1.09 + c * dx + Math.sin(opts.t * 0.38 + r + seed * 3.0) * 0.018;
      const b = bands[(c + r * 5) % bands.length] || 0;
      wr.write(x, y, x + dx * (0.45 + b * 0.8), y + dy * 0.02, opts.hue + 0.32 + b * 0.13, opts.hue + 0.48 + seed * 0.12, opts.light * (0.30 + b * 0.34), opts.light * (0.52 + b * 0.34), opts.sat, opts.sat * 1.35);
    }
  }
}


function blanketSurfaceDisplace(x, y, t, d, amount = 1, mode = 'cell') {
  const scale = mode === 'honeycomb' ? 1.12 : mode === 'alt' ? 1.34 : 1.0;
  const rate = mode === 'alt' ? 0.20 : mode === 'honeycomb' ? 0.16 : 0.18;
  const amp = (mode === 'honeycomb' ? 0.028 : mode === 'alt' ? 0.040 : 0.036) * clamp(amount, 0.35, 2.0);
  const w1 = Math.sin((x * 2.25 + y * 1.30) * scale + t * (rate + d.tempo * 0.020));
  const w2 = Math.sin((x * -1.15 + y * 2.85) * scale - t * (rate * 0.72 + d.equilibrium * 0.060) + 1.7);
  const w3 = Math.cos((x * 3.10 - y * 1.75) * scale + t * (rate * 0.46 + d.temperature * 0.035) + 0.4);
  const dx = (w1 * 0.58 + w2 * 0.30 + w3 * 0.12) * amp;
  const dy = (Math.cos((x * 1.85 - y * 2.05) * scale + t * (rate * 0.82) + 0.9) * 0.52
    + Math.sin((x * 2.75 + y * 0.95) * scale - t * (rate * 0.50) + 2.1) * 0.34
    + w1 * 0.14) * amp * 0.82;
  return [clamp(x + dx, -3, 3), clamp(y + dy, -3, 3)];
}

function drawCellularBackdrop(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const cols = Math.floor(clamp(7 + amount * 7, 6, 18));
  const rows = Math.floor(clamp(6 + amount * 5, 5, 14));
  const dx = 2.08 / cols;
  const dy = 1.60 / rows;
  const beat = clamp(feat.beat || 0, 0, 1);
  for (let y = 0; y < rows && !wr.fillFull; y++) {
    for (let x = 0; x < cols && !wr.fillFull; x++) {
      const k = y * cols + x;
      const u = x / Math.max(1, cols - 1);
      const v = y / Math.max(1, rows - 1);
      const b = bands[(k * 7 + 3) % Math.max(1, bands.length)] || 0;
      const seed = hash01(k * 19.17 + 4.2);
      const phase = Math.sin(t * (0.16 + d.tempo * 0.025) + (u * 2.2 + v * 1.7) + seed * 0.18 + b * 2.1);
      const gate = stableActivity(k * 0.53 + 2.0, b * 0.76 + Math.max(0, phase) * 0.16, beat, 0.16);
      if (seed < 0.07 && gate < 0.20) continue;
      const cx = -1.04 + x * dx + dx * 0.5;
      const cy = -0.80 + y * dy + dy * 0.5;
      const sx = dx * (0.22 + 0.04 * seed + 0.04 * b + 0.010 * beat);
      const sy = dy * (0.20 + 0.04 * hash01(seed * 14.1) + 0.040 * b);
      const breath = 1 + Math.sin(t * 0.13 + u * 2.4 + v * 1.8 + b) * (0.018 + b * 0.018);
      const ax = cx - sx * breath;
      const ay = cy - sy * breath;
      const bx = cx + sx * breath;
      const by = cy - sy * (0.98 + b * 0.03);
      const cx2 = cx + sx * (0.98 + b * 0.04);
      const cy2 = cy + sy * breath;
      const dx2 = cx - sx * (0.98 + seed * 0.03);
      const dy2 = cy + sy * (0.98 + b * 0.04);
      const p0 = blanketSurfaceDisplace(ax, ay, t, d, amount, 'cell');
      const p1 = blanketSurfaceDisplace(bx, by, t, d, amount, 'cell');
      const p2 = blanketSurfaceDisplace(cx2, cy2, t, d, amount, 'cell');
      const p3 = blanketSurfaceDisplace(dx2, dy2, t, d, amount, 'cell');
      const h = hue + 0.06 + u * 0.12 + v * 0.08 + b * 0.13;
      const shimmer = (0.16 + b * 0.30 + Math.max(0, phase) * 0.10) * gate;
      writeWarpedGlassQuad(wr, p0[0], p0[1], p1[0], p1[1], p2[0], p2[1], p3[0], p3[1], h, light * (0.12 + b * 0.13) * gate, opts.sat * 1.30, shimmer);
      if (!wr.full && gate > 0.22) {
        const m0 = [lerp(p0[0], p3[0], 0.50), lerp(p0[1], p3[1], 0.50)];
        const m1 = [lerp(p1[0], p2[0], 0.50), lerp(p1[1], p2[1], 0.50)];
        wr.write(m0[0], m0[1], m1[0], m1[1], h + 0.03, h + 0.10,
          light * (0.030 + b * 0.032) * gate, light * (0.050 + b * 0.046) * gate,
          softSat(opts.sat, 0.82), softSat(opts.sat, 1.02));
      }
    }
  }
}




function drawCellFieldAltBackdrop(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const cols = Math.floor(clamp(7 + amount * 7, 6, 18));
  const rows = Math.floor(clamp(7 + amount * 6, 6, 16));
  const stepX = 2.10 / cols;
  const stepY = 1.68 / rows;
  const beat = clamp(feat.beat || 0, 0, 1);
  for (let y = 0; y < rows && !wr.fillFull; y++) {
    for (let x = 0; x < cols && !wr.fillFull; x++) {
      const k = y * cols + x;
      const u = x / Math.max(1, cols - 1);
      const v = y / Math.max(1, rows - 1);
      const b = bands[(k * 9 + 5) % Math.max(1, bands.length)] || 0;
      const seed = hash01(k * 23.47 + 7.3);
      const phase = t * (0.12 + d.tempo * 0.016) + u * 1.9 - v * 1.2 + seed * 0.25;
      const gate = stableActivity(k * 0.61 + 11.0, b * 0.72 + Math.max(0, Math.sin(phase)) * 0.18, beat, 0.12);
      if (seed < 0.055 && gate < 0.17) continue;
      const stagger = (y & 1) ? 0.22 : -0.08;
      const cx = -1.05 + (x + 0.5 + stagger) * stepX;
      const cy = -0.84 + (y + 0.5) * stepY;
      const rx = stepX * (0.20 + 0.04 * seed + 0.04 * b + beat * 0.018);
      const ry = stepY * (0.20 + 0.04 * hash01(seed * 15.1) + 0.04 * b + beat * 0.012);
      const lean = Math.sin(phase) * stepX * (0.045 + b * 0.018);
      const shear = Math.cos(phase * 0.84 + seed * 4.2) * stepY * (0.06 + b * 0.020);
      const taper = 0.88 + hash01(seed * 11.7) * 0.08;
      const p0 = blanketSurfaceDisplace(cx - rx - lean * 0.10, cy - ry + shear * 0.18, t, d, amount, 'alt');
      const p1 = blanketSurfaceDisplace(cx + rx * taper - lean * 0.04, cy - ry * 0.84 - shear * 0.08, t, d, amount, 'alt');
      const p2 = blanketSurfaceDisplace(cx + rx + lean * 0.10, cy + ry - shear * 0.18, t, d, amount, 'alt');
      const p3 = blanketSurfaceDisplace(cx - rx * taper + lean * 0.04, cy + ry * 0.84 + shear * 0.08, t, d, amount, 'alt');
      const h = hue + 0.18 + u * 0.08 + v * 0.12 + b * 0.10;
      const shimmer = (0.16 + b * 0.24 + gate * 0.14) * (0.86 + Math.max(0, Math.sin(phase)) * 0.28);
      writeWarpedGlassQuad(wr, p0[0], p0[1], p1[0], p1[1], p2[0], p2[1], p3[0], p3[1], h, light * (0.11 + b * 0.12) * gate, opts.sat * 1.20, shimmer);
      if (!wr.full && gate > 0.18) {
        const c0 = [lerp(p0[0], p3[0], 0.50), lerp(p0[1], p3[1], 0.50)];
        const c1 = [lerp(p1[0], p2[0], 0.50), lerp(p1[1], p2[1], 0.50)];
        wr.write(c0[0], c0[1], c1[0], c1[1], h + 0.03, h + 0.10,
          light * (0.024 + b * 0.024) * gate, light * (0.050 + b * 0.038) * gate,
          softSat(opts.sat, 0.84), softSat(opts.sat, 1.00));
        const hi0 = [lerp(p0[0], p1[0], 0.18), lerp(p0[1], p1[1], 0.18)];
        const hi1 = [lerp(p3[0], p2[0], 0.18), lerp(p3[1], p2[1], 0.18)];
        wr.write(hi0[0], hi0[1], hi1[0], hi1[1], h + 0.05, h + 0.12,
          light * (0.014 + b * 0.014) * gate, light * (0.028 + b * 0.020) * gate,
          softSat(opts.sat, 0.78), softSat(opts.sat, 0.92));
      }
    }
  }
}




function drawEntropyCalculatorBackdrop(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const rows = Math.floor(clamp(7 + amount * 7, 6, 16));
  const stepY = 1.70 / rows;
  const beat = clamp(feat.beat || 0, 0, 1);
  for (let y = 0; y < rows && !wr.fillFull; y++) {
    const rowSeed = hash01(y * 7.37 + 0.41);
    const cols = Math.floor(clamp(5 + amount * 4 + ((y & 1) ? 1 : 0), 4, 11));
    const laneX = 2.08 / cols;
    const rowBand = bands[(y * 5 + 2) % Math.max(1, bands.length)] || 0;
    const rowShift = Math.sin(t * (0.06 + rowSeed * 0.05) + y * 0.42) * laneX * 0.08;
    for (let x = 0; x < cols && !wr.fillFull; x++) {
      const k = y * cols + x;
      const seed = hash01(k * 17.91 + 3.7);
      const b = bands[(k * 3 + y * 7) % Math.max(1, bands.length)] || 0;
      const gate = stableActivity(k * 0.36 + y * 0.21, b * 0.70 + rowBand * 0.16, beat, 0.06);
      if (seed < 0.04 && gate < 0.10) continue;
      const u = x / Math.max(1, cols - 1);
      const cx = -1.04 + (x + 0.5) * laneX + rowShift;
      const cy = -0.85 + (y + 0.5) * stepY + Math.cos(t * 0.08 + x * 0.32 + seed * 5.4) * stepY * 0.05;
      const panelW = laneX * (0.68 + seed * 0.12 + b * 0.08);
      const panelH = stepY * (0.38 + hash01(seed * 11.7) * 0.16 + b * 0.08);
      const skew = Math.sin(t * 0.10 + x * 0.24 + y * 0.16 + seed * TAU) * laneX * (0.03 + b * 0.02);
      const lift = Math.cos(t * 0.09 - x * 0.20 + seed * 4.1) * stepY * (0.05 + b * 0.02);
      const ax = cx - panelW * 0.5 - skew;
      const ay = cy - panelH * 0.5 + lift * 0.30;
      const bx = cx + panelW * 0.5 - skew * 0.35;
      const by = cy - panelH * 0.5 - lift * 0.18;
      const cx2 = cx + panelW * 0.5 + skew;
      const cy2 = cy + panelH * 0.5 - lift * 0.30;
      const dx2 = cx - panelW * 0.5 + skew * 0.35;
      const dy2 = cy + panelH * 0.5 + lift * 0.18;
      const h = hue + 0.10 + u * 0.06 + (y / Math.max(1, rows - 1)) * 0.08 + b * 0.08;
      const panelLight = light * (0.10 + rowBand * 0.04 + b * 0.10) * (0.82 + gate * 0.26);
      writeWarpedGlassQuad(wr, ax, ay, bx, by, cx2, cy2, dx2, dy2, h, panelLight, opts.sat * 1.08, 0.16 + b * 0.18 + gate * 0.10);
      if (!wr.full) {
        const sx0 = lerp(ax, bx, 0.08), sy0 = lerp(ay, by, 0.08);
        const sx1 = lerp(dx2, cx2, 0.08), sy1 = lerp(dy2, cy2, 0.08);
        const stripes = 2 + ((x + y) % 2);
        for (let i = 1; i <= stripes && !wr.full; i++) {
          const kStrip = i / (stripes + 1);
          const lx0 = lerp(ax, dx2, kStrip);
          const ly0 = lerp(ay, dy2, kStrip);
          const lx1 = lerp(bx, cx2, kStrip);
          const ly1 = lerp(by, cy2, kStrip);
          wr.write(lx0, ly0, lx1, ly1,
            h + 0.02, h + 0.08,
            light * (0.016 + b * 0.020) * gate,
            light * (0.028 + b * 0.028) * gate,
            softSat(opts.sat, 0.78), softSat(opts.sat, 0.92));
        }
        wr.write(sx0, sy0, sx1, sy1,
          h + 0.03, h + 0.10,
          light * (0.020 + b * 0.020) * gate,
          light * (0.040 + b * 0.032) * gate,
          softSat(opts.sat, 0.82), softSat(opts.sat, 0.98));
      }
    }
  }
}

function drawHoneycombField(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const cols = Math.floor(clamp(8 + amount * 7, 7, 19));
  const rows = Math.floor(clamp(6 + amount * 5, 5, 14));
  const stepX = 2.02 / cols;
  const stepY = 1.56 / rows;
  const baseR = Math.min(stepX, stepY) * 0.36;
  const beat = clamp(feat.beat || 0, 0, 1);
  for (let y = 0; y < rows && !wr.full; y++) {
    for (let x = 0; x < cols && !wr.full; x++) {
      const k = y * cols + x;
      const seed = hash01(k * 13.91 + 0.73);
      const b = bands[(k * 5 + 1) % Math.max(1, bands.length)] || 0;
      const u = x / Math.max(1, cols - 1);
      const v = y / Math.max(1, rows - 1);
      const gate = stableActivity(k * 0.43 + 9.0, b * 0.78 + Math.sin(t * 0.14 + u * 1.8 + v * 2.2) * 0.08, beat, 0.12);
      if (seed < 0.05 && gate < 0.18) continue;
      const cx0 = -1.02 + (x + 0.5 + (y & 1) * 0.5) * stepX;
      if (cx0 > 1.12) continue;
      const cy0 = -0.78 + (y + 0.5) * stepY;
      const center = blanketSurfaceDisplace(cx0, cy0, t, d, amount, 'honeycomb');
      const wave = 1 + Math.sin(t * 0.16 + u * 2.4 + v * 1.7 + b * 2.0) * 0.040;
      const rx = ax2(baseR * (0.86 + b * 0.28 + beat * 0.05) * wave, opts);
      const ry = baseR * (0.86 + b * 0.28 + beat * 0.05) * (1.0 + Math.cos(t * 0.13 + u * 1.5 + v * 2.1) * 0.030);
      const h = hue + 0.12 + u * 0.10 + v * 0.06 + b * 0.12;
      const phase = t * 0.12 + u * 1.6 + v * 1.2;
      const points = [];
      for (let i = 0; i < 6; i++) {
        const a = TAU * (i / 6) + Math.PI / 6;
        const px = center[0] + Math.cos(a) * rx;
        const py = center[1] + Math.sin(a) * ry;
        points.push(blanketSurfaceDisplace(px, py, t, d, amount * 0.45, 'honeycomb'));
      }
      for (let i = 0; i < 6 && !wr.fillFull; i++) {
        const a = points[i];
        const bpt = points[(i + 1) % 6];
        const lane = i / 6;
        wr.writeTri(center[0], center[1], a[0], a[1], bpt[0], bpt[1],
          h + 0.08, h + lane * 0.055, h + (lane + 0.16) * 0.055,
          light * (0.11 + gate * 0.030), light * (0.044 + b * 0.060) * gate, light * (0.040 + b * 0.052) * gate,
          softSat(opts.sat, 1.16), softSat(opts.sat, 1.32), softSat(opts.sat, 1.24));
      }
      for (let i = 0; i < 6 && !wr.full; i++) {
        const a = points[i];
        const bpt = points[(i + 1) % 6];
        wr.write(a[0], a[1], bpt[0], bpt[1], h + i * 0.010, h + 0.06 + i * 0.010, light * (0.10 + gate * 0.045), light * (0.15 + b * 0.060), softSat(opts.sat, 0.86), softSat(opts.sat, 1.08));
      }
      if (!wr.full && gate > 0.34) {
        const y2 = center[1] + Math.sin(phase) * ry * 0.12;
        wr.write(center[0] - rx * 0.58, y2, center[0] + rx * 0.58, y2, h + 0.04, h + 0.10, light * (0.036 + b * 0.042) * gate, light * (0.058 + b * 0.052) * gate, opts.sat * 0.78, opts.sat * 0.92);
      }
    }
  }
}



function drawWaveInterferenceField(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const waves = Math.floor(clamp(4 + amount * 5 + d.scaleDepth * 1.6, 3, 13));
  const steps = Math.floor(clamp(56 + amount * 36, 40, 112));
  const beat = clamp(feat.beat || 0, 0, 1);
  const bass = clamp(feat.bass || avg(bands, 0, 7), 0, 1);
  const mid = clamp(feat.mid || avg(bands, 7, 20), 0, 1);
  for (let pass = 0; pass < 2 && !wr.full; pass++) {
    const angle = pass === 0 ? 0 : Math.PI * 0.5 + Math.sin(t * 0.035) * 0.20;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    for (let l = 0; l < waves && !wr.full; l++) {
      if (wr.canWriteSegments && !wr.canWriteSegments(steps)) break;
      const k = l / Math.max(1, waves - 1);
      const band = bands[(l * 5 + pass * 3) % bands.length] || 0;
      const y0 = -0.92 + k * 1.84 + Math.sin(t * 0.06 + k * TAU) * 0.025;
      let px = ribbonSpanX(0, 1.46), py = y0;
      for (let i = 1; i <= steps && !wr.full; i++) {
        const u = i / steps;
        const x0 = ribbonSpanX(u, 1.46);
        const carrier = Math.sin(u * TAU * (1.5 + l * 0.34 + d.coherence * 0.40) + t * (0.38 + d.tempo * 0.11) + pass * 1.8)
          + Math.sin(u * TAU * (3.2 + d.scaleDepth * 0.65) - t * 0.30 + k * 5.0) * 0.46
          + Math.sin((u + k) * TAU * (5.2 + d.temperature * 1.2) + t * 0.18 + band * 3.0) * 0.22;
        const amp = (0.020 + amount * 0.012 + bass * 0.028 + mid * 0.018 + beat * 0.014 + band * 0.038);
        const y1 = y0 + carrier * amp * (0.65 + Math.sin(u * Math.PI) * 0.70);
        const ax = px * ca - py * sa;
        const ay = px * sa + py * ca;
        const bx = x0 * ca - y1 * sa;
        const by = x0 * sa + y1 * ca;
        wr.write(ax, ay, bx, by, softHue(hue, pass * 2.0 + k * 2.4, band, 0.04), softHue(hue, pass * 2.0 + k * 2.4 + 0.55, band, 0.06), light * (0.16 + band * 0.12), light * (0.26 + band * 0.16), softSat(opts.sat, 0.96), softSat(opts.sat, 1.12));
        px = x0; py = y1;
      }
    }
  }
}


function drawCenterRadiance(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const beat = clamp(feat.beat || 0, 0, 1);
  const rays = Math.floor(clamp(12 + amount * 18 + beat * 6, 10, 46));
  const layers = Math.floor(clamp(1 + amount * 1.4 + beat * 0.75, 1, 4));
  const spin = Math.sin(t * 0.025) * 0.035;
  for (let layer = 0; layer < layers && !wr.fillFull; layer++) {
    const lk = layer / Math.max(1, layers - 1);
    const inner = 0.030 + lk * 0.060;
    for (let i = 0; i < rays && !wr.fillFull; i++) {
      const u0 = i / rays;
      const u1 = (i + 1) / rays;
      const band = bands[(i * 3 + layer * 7) % bands.length] || 0;
      const a0 = u0 * TAU + spin + layer * 0.10;
      const a1 = u1 * TAU + spin + layer * 0.10;
      const gate = smoothstep(0.08, 0.78, band + beat * 0.36);
      const outer = 0.22 + lk * (0.50 + amount * 0.05) + band * 0.22 + beat * 0.045;
      const wob0 = Math.sin(a0 * (2.2 + d.scaleDepth * 0.10) + t * (0.20 + d.equilibrium * 0.16) + layer) * (0.010 + band * 0.032);
      const wob1 = Math.sin(a1 * (2.2 + d.scaleDepth * 0.10) + t * (0.20 + d.equilibrium * 0.16) + layer) * (0.010 + band * 0.032);
      const p0x = ax2(Math.cos(a0) * inner, opts), p0y = Math.sin(a0) * inner;
      const p1x = ax2(Math.cos(a1) * inner, opts), p1y = Math.sin(a1) * inner;
      const q0x = ax2(Math.cos(a0) * (outer + wob0), opts), q0y = Math.sin(a0) * (outer + wob0);
      const q1x = ax2(Math.cos(a1) * (outer + wob1), opts), q1y = Math.sin(a1) * (outer + wob1);
      const hInner = softHue(hue, lk * 0.50 + band * 0.12, band, 0.003);
      const hOuter = softHue(hue, lk * 0.72 + band * 0.16, band, 0.009);
      const l0 = light * (0.020 + gate * 0.025);
      const l1 = light * (0.060 + band * 0.090 + gate * 0.045);
      const l2 = light * (0.080 + band * 0.120 + gate * 0.070);
      wr.writeTri(p0x, p0y, q0x, q0y, q1x, q1y, hInner, wrapHue01((hInner + hOuter) * 0.5), hOuter, l0, l1, l2, opts.sat * 0.75, opts.sat * 0.90, opts.sat * 0.98);
      wr.writeTri(p0x, p0y, q1x, q1y, p1x, p1y, hInner, hOuter, wrapHue01(hOuter - 0.002), l0 * 0.85, l2 * 0.85, l0 * 0.75, opts.sat * 0.72, opts.sat * 0.96, opts.sat * 0.78);
      if (!wr.full && (i % 7 === 0 || band > 0.42)) {
        wr.write(p0x, p0y, q0x, q0y, hInner + 0.02, hOuter + 0.13, light * 0.080, light * (0.180 + band * 0.090), opts.sat * 0.72, opts.sat * 0.95);
      }
    }
  }
}

function drawStarShower(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const streaks = Math.floor(clamp(80 + amount * 120, 52, 280));
  const beat = clamp(feat.beat || 0, 0, 1);
  for (let i = 0; i < streaks && !wr.full; i++) {
    const seed = hash01(i * 7.31 + 1.7);
    const band = bands[i % bands.length] || 0;
    const speed = 0.22 + seed * 0.80 + d.tempo * 0.08;
    const lane = (t * speed + seed * 6.0) % 1;
    const x = -1.16 + hash01(seed * 53.1 + 0.4) * 2.32 + Math.sin(t * 0.06 + i) * 0.015;
    const y = 1.08 - lane * 2.22;
    const len = 0.035 + band * 0.12 + beat * 0.05;
    const drift = 0.020 + seed * 0.090 + band * 0.020;
    const x2 = x + drift;
    const y2 = y - len * (1.10 + seed * 0.55);
    const h = hue + 0.50 + seed * 0.22 + band * 0.10;
    wr.write(x, y, x2, y2, h, h + 0.08, light * (0.22 + band * 0.15), light * (0.64 + band * 0.24), opts.sat * 0.95, opts.sat * 1.24);
    if (band + beat > 0.65 && !wr.full) {
      const s = 0.008 + band * 0.014;
      wr.write(x2 - s, y2, x2 + s, y2, h + 0.05, h + 0.12, light * 0.30, light * 0.46, opts.sat * 0.92, opts.sat * 1.08);
      wr.write(x2, y2 - s, x2, y2 + s, h + 0.02, h + 0.14, light * 0.26, light * 0.42, opts.sat * 0.90, opts.sat * 1.06);
    }
  }
}


function drawContourVeils(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const veils = Math.floor(clamp(3 + amount * 2.0, 3, 7));
  const steps = Math.floor(clamp(38 + amount * 36, 28, 88));
  for (let v = 0; v < veils && !wr.fillFull; v++) {
    if (wr.canWriteTris && !wr.canWriteTris(steps * 2)) break;
    if (wr.canWriteSegments && !wr.canWriteSegments(Math.ceil(steps / 9))) break;
    const vk = v / Math.max(1, veils - 1);
    const arc = 0.55 + vk * 0.75;
    const offset = -0.65 + vk * 1.30 + Math.sin(t * 0.036 + v * 0.83) * 0.10;
    let prevTop = null, prevBot = null;
    let prevTopH = 0, prevBotH = 0, prevTopL = 0, prevBotL = 0;
    for (let i = 0; i <= steps && !wr.fillFull; i++) {
      const u = i / steps;
      const band = bands[(i * 3 + v * 7) % Math.max(1, bands.length)] || 0;
      const a = -Math.PI * arc + u * Math.PI * 2.0 * arc + t * 0.018;
      const baseR = 0.32 + vk * 0.58 + band * 0.12;
      const wobble = Math.sin(a * (1.8 + vk * 1.3) + t * 0.055 + v) * (0.08 + band * 0.06);
      const ridge = Math.cos(a * 0.52 - t * 0.025 + v * 0.4) * 0.12;
      const cx = ax2(Math.cos(a) * (baseR + wobble) + ridge * 0.35, opts);
      const cy = Math.sin(a) * (0.34 + vk * 0.24 + band * 0.05) + offset * 0.28;
      const nx = -Math.sin(a);
      const ny = Math.cos(a) * (0.70 + vk * 0.18);
      const width = 0.045 + amount * 0.020 + band * 0.055;
      const top = [cx + ax2(nx * width, opts), cy + ny * width];
      const bot = [cx - ax2(nx * width * 0.92, opts), cy - ny * width * 0.92];
      const topH = softHue(hue, vk * 4.6 + u * 1.7, band, 0.010);
      const botH = softHue(hue, vk * 4.6 + u * 1.7 + 0.65, band, 0.022);
      const topL = softLight(light, 0.05 + band * 0.05 + (1 - vk) * 0.02);
      const botL = softLight(light, 0.018 + band * 0.030);
      if (prevTop && prevBot) {
        wr.writeTri(prevTop[0], prevTop[1], top[0], top[1], bot[0], bot[1], prevTopH, topH, botH, prevTopL, topL, botL, softSat(opts.sat, 0.92), softSat(opts.sat, 1.16), softSat(opts.sat, 0.86));
        wr.writeTri(prevTop[0], prevTop[1], bot[0], bot[1], prevBot[0], prevBot[1], prevTopH, botH, prevBotH, prevTopL, botL, prevBotL, softSat(opts.sat, 0.92), softSat(opts.sat, 0.86), softSat(opts.sat, 0.80));
        if ((i % 9) === 0 && !wr.full) wr.write(prevTop[0], prevTop[1], top[0], top[1], prevTopH, topH, light * 0.080, light * (0.130 + band * 0.040), softSat(opts.sat, 0.28), softSat(opts.sat, 0.40));
      }
      prevTop = top; prevBot = bot;
      prevTopH = topH; prevBotH = botH; prevTopL = topL; prevBotL = botL;
    }
  }
}

function drawGradientFlow(wr, bands, feat, d, opts) {
  // Broad veils and contour sheets. Avoid a flat left-to-right wash by using
  // local curve orientation and offset packets instead of screen-space stripes.
  const { amount, t, hue, light } = opts;
  const packets = Math.floor(clamp(2 + amount * 2.0, 2, 6));
  const steps = Math.floor(clamp(40 + amount * 42, 30, 100));
  for (let packet = 0; packet < packets && !wr.fillFull; packet++) {
    if (wr.canWriteTris && !wr.canWriteTris(steps * 2)) break;
    if (wr.canWriteSegments && !wr.canWriteSegments(Math.ceil(steps / 8))) break;
    const pk = packet / Math.max(1, packets - 1);
    const seed = hash01(packet * 13.17 + 0.2);
    const axis = seed * TAU;
    const driftX = Math.cos(axis) * (0.12 + pk * 0.28);
    const driftY = Math.sin(axis) * (0.10 + pk * 0.22);
    let prevA = null, prevB = null, prevHA = 0, prevHB = 0, prevLA = 0, prevLB = 0;
    for (let i = 0; i <= steps && !wr.fillFull; i++) {
      const u = i / steps;
      const band = bands[(i * 4 + packet * 9) % Math.max(1, bands.length)] || 0;
      const xBase = ribbonSpanX(u, 1.52);
      const wave1 = Math.sin(u * TAU * (0.55 + pk * 0.45) + t * 0.050 + packet * 0.8);
      const wave2 = Math.sin(u * TAU * (1.35 + d.temperature * 0.22) - t * 0.032 + seed * 4.0) * 0.52;
      const sway = Math.cos(u * TAU * 0.48 + t * 0.022 + packet) * 0.16;
      const centerX = xBase + driftX * 0.40 + sway * 0.10;
      const centerY = driftY + wave1 * (0.14 + band * 0.08) + wave2 * (0.06 + pk * 0.03);
      const tangentX = 1.0;
      const tangentY = (Math.cos(u * TAU * (0.55 + pk * 0.45) + t * 0.050 + packet * 0.8) * TAU * (0.55 + pk * 0.45) * (0.14 + band * 0.08))
        + (Math.cos(u * TAU * (1.35 + d.temperature * 0.22) - t * 0.032 + seed * 4.0) * TAU * (1.35 + d.temperature * 0.22) * (0.06 + pk * 0.03));
      const normLen = Math.max(1e-4, Math.hypot(-tangentY, tangentX));
      const nx = -tangentY / normLen;
      const ny = tangentX / normLen;
      const width = 0.055 + amount * 0.020 + band * 0.070 + (feat.beat || 0) * 0.015;
      const a = [centerX + ax2(nx * width, opts), centerY + ny * width];
      const b = [centerX - ax2(nx * width * 0.95, opts), centerY - ny * width * 0.95];
      const hA = softHue(hue, packet * 3.2 + u * 1.8, band, 0.012);
      const hB = softHue(hue, packet * 3.2 + u * 1.8 + 0.75, band, 0.026);
      const lA = softLight(light, 0.055 + band * 0.060 + (1 - pk) * 0.02);
      const lB = softLight(light, 0.020 + band * 0.028);
      if (prevA && prevB) {
        wr.writeTri(prevA[0], prevA[1], a[0], a[1], b[0], b[1], prevHA, hA, hB, prevLA, lA, lB, softSat(opts.sat, 0.82), softSat(opts.sat, 1.08), softSat(opts.sat, 0.70));
        wr.writeTri(prevA[0], prevA[1], b[0], b[1], prevB[0], prevB[1], prevHA, hB, prevHB, prevLA, lB, prevLB, softSat(opts.sat, 0.82), softSat(opts.sat, 0.70), softSat(opts.sat, 0.62));
        if ((i % 8) === 0 && !wr.full) wr.write(prevA[0], prevA[1], a[0], a[1], prevHA, hA, light * 0.080, light * (0.130 + band * 0.045), softSat(opts.sat, 0.26), softSat(opts.sat, 0.38));
      }
      prevA = a; prevB = b; prevHA = hA; prevHB = hB; prevLA = lA; prevLB = lB;
    }
  }
}


function drawPrismaDrift(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const ribbons = Math.floor(clamp(3 + amount * 2.0, 3, 7));
  const steps = Math.floor(clamp(40 + amount * 46, 28, 110));
  for (let r = 0; r < ribbons && !wr.fillFull; r++) {
    if (wr.canWriteTris && !wr.canWriteTris(steps * 2)) break;
    const rk = r / Math.max(1, ribbons - 1);
    const lane = -0.82 + rk * 1.64;
    let prevA = null, prevB = null;
    let prevHA = hue, prevHB = hue + 0.08, prevLA = light * 0.1, prevLB = light * 0.05;
    for (let i = 0; i <= steps && !wr.fillFull; i++) {
      const u = i / steps;
      const band = bands[(i * 3 + r * 11) % Math.max(1, bands.length)] || 0;
      const x = ribbonSpanX(u, 1.48);
      const drift = Math.sin(u * TAU * (0.65 + rk * 0.35) + t * 0.022 + r * 0.8) * (0.12 + band * 0.05);
      const y = lane + drift + Math.cos(u * TAU * (1.6 + d.temperature * 0.10) - t * 0.018 + r) * (0.05 + band * 0.025);
      const width = 0.034 + amount * 0.012 + band * 0.028;
      const nx = 0.0, ny = 1.0;
      const a = [x, y + ny * width];
      const b = [x, y - ny * width * 0.92];
      const hA = softHue(hue, rk * 4.0 + u * 2.2, band, 0.028);
      const hB = softHue(hue, rk * 4.0 + u * 2.2 + 0.9, band, 0.055);
      const lA = softLight(light, 0.06 + band * 0.05);
      const lB = softLight(light, 0.026 + band * 0.028);
      if (prevA && prevB) {
        wr.writeTri(prevA[0], prevA[1], a[0], a[1], b[0], b[1], prevHA, hA, hB, prevLA, lA, lB, softSat(opts.sat, 0.88), softSat(opts.sat, 1.12), softSat(opts.sat, 0.76));
        wr.writeTri(prevA[0], prevA[1], b[0], b[1], prevB[0], prevB[1], prevHA, hB, prevHB, prevLA, lB, prevLB, softSat(opts.sat, 0.88), softSat(opts.sat, 0.76), softSat(opts.sat, 0.68));
      }
      prevA = a; prevB = b; prevHA = hA; prevHB = hB; prevLA = lA; prevLB = lB;
    }
  }
}

function drawOpalBloom(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const blobs = Math.floor(clamp(4 + amount * 5.0 + feat.beat * 2.0, 4, 12));
  for (let i = 0; i < blobs && !wr.fillFull; i++) {
    const seed = hash01(i * 19.3 + 0.31);
    const a = seed * TAU + t * (0.015 + seed * 0.02);
    const r = 0.12 + hash01(seed * 37.1 + 1.2) * 0.68;
    const cx = Math.cos(a) * r * (0.95 + Math.sin(t * 0.01 + i) * 0.10);
    const cy = Math.sin(a * (0.88 + seed * 0.22)) * r * 0.68;
    const layers = 3 + (i % 2);
    for (let layer = 0; layer < layers && !wr.fillFull; layer++) {
      const lk = layer / layers;
      const rad = (0.16 + amount * 0.06 + seed * 0.14) * (1.0 - lk * 0.26) * (1.0 + feat.beat * 0.08);
      const steps = 18 + layer * 4;
      if (wr.canWriteTris && !wr.canWriteTris(steps)) break;
      for (let s = 0; s < steps && !wr.fillFull; s++) {
        const u0 = s / steps;
        const u1 = (s + 1) / steps;
        const band = bands[(s * 2 + i * 5) % Math.max(1, bands.length)] || 0;
        const a0 = u0 * TAU + t * 0.022 + layer * 0.6;
        const a1 = u1 * TAU + t * 0.022 + layer * 0.6;
        const wob0 = 0.86 + Math.sin(a0 * (2.4 + seed * 1.8) + t * 0.05) * (0.18 + band * 0.10);
        const wob1 = 0.86 + Math.sin(a1 * (2.4 + seed * 1.8) + t * 0.05) * (0.18 + band * 0.10);
        const x0 = cx + ax2(Math.cos(a0) * rad * wob0, opts);
        const y0 = cy + Math.sin(a0) * rad * wob0 * (0.84 + seed * 0.24);
        const x1 = cx + ax2(Math.cos(a1) * rad * wob1, opts);
        const y1 = cy + Math.sin(a1) * rad * wob1 * (0.84 + seed * 0.24);
        const h = softHue(hue, seed * 5.0 + u0 * 1.8 + layer * 0.35, band, 0.040);
        wr.writeTri(cx, cy, x0, y0, x1, y1, h, h + 0.04, h + 0.10, light * (0.022 + band * 0.022), light * (0.070 + band * 0.070), light * (0.050 + band * 0.055), softSat(opts.sat, 0.96), softSat(opts.sat, 1.18), softSat(opts.sat, 1.04));
      }
    }
  }
}

function drawJazzHaze(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const loops = Math.floor(clamp(14 + amount * 22, 10, 42));
  for (let i = 0; i < loops && !wr.full; i++) {
    const seed = hash01(i * 13.7 + 2.1);
    const phase = seed * TAU;
    const ampX = 0.10 + seed * 0.56;
    const ampY = 0.08 + hash01(seed * 7.1 + 1.4) * 0.42;
    const steps = 26;
    let px = 0, py = 0;
    for (let s = 0; s <= steps && !wr.full; s++) {
      const u = s / steps;
      const band = bands[(s + i * 3) % Math.max(1, bands.length)] || 0;
      const x = Math.sin(u * TAU * (1.0 + seed * 2.0) + phase + t * 0.05) * ampX + Math.cos(t * 0.01 + i) * 0.12;
      const y = Math.sin(u * TAU * (2.0 + seed * 3.0) + phase * 0.7 - t * 0.04) * ampY + Math.sin(t * 0.013 + i * 0.7) * 0.12;
      if (s > 0) {
        const h0 = softHue(hue, seed * 6.0 + u * 1.8, band, 0.030);
        const h1 = softHue(hue, seed * 6.0 + u * 1.8 + 0.3, band, 0.052);
        wr.write(px, py, x, y, h0, h1, light * 0.045, light * (0.11 + band * 0.05), softSat(opts.sat, 0.34), softSat(opts.sat, 0.46));
      }
      px = x;
      py = y;
    }
  }
}

function drawDiffuseClouds(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const cloudCount = Math.floor(clamp(2 + amount * 2.2 + (feat.beat || 0) * 1.2, 2, 7));
  for (let c = 0; c < cloudCount && !wr.fillFull; c++) {
    const seed = hash01(c * 23.17 + 0.91);
    const drift = t * (0.008 + seed * 0.006);
    const cx = ax2(Math.cos(seed * TAU + drift * 0.8) * (0.16 + seed * 0.54), opts);
    const cy = Math.sin(seed * TAU * 1.21 - drift * 0.6) * (0.14 + seed * 0.42);
    const lobeCount = Math.floor(clamp(3 + amount * 2.0 + seed * 3.0, 3, 8));
    for (let lobe = 0; lobe < lobeCount && !wr.fillFull; lobe++) {
      const lk = lobe / Math.max(1, lobeCount - 1);
      const band = bands[(c * 7 + lobe * 5 + 3) % Math.max(1, bands.length)] || 0;
      const a = seed * TAU + lobe * (TAU / lobeCount) + Math.sin(t * 0.018 + lobe) * 0.25;
      const orbit = 0.05 + band * 0.08 + lk * 0.10;
      const ox = Math.cos(a) * orbit;
      const oy = Math.sin(a * 1.13) * orbit * 0.78;
      const layers = 3 + (lobe % 3);
      for (let layer = 0; layer < layers && !wr.fillFull; layer++) {
        const sides = 18 + layer * 4;
        if (wr.canWriteTris && !wr.canWriteTris(sides)) break;
        const depth = layer / layers;
        const rad = (0.18 + amount * 0.08 + seed * 0.18 + band * 0.10) * (1.0 - depth * 0.18);
        const baseH = softHue(hue, seed * 4.0 + lk * 1.8 + depth * 0.7, band, 0.018 + depth * 0.012);
        for (let i = 0; i < sides && !wr.fillFull; i++) {
          const u0 = i / sides;
          const u1 = (i + 1) / sides;
          const a0 = u0 * TAU;
          const a1 = u1 * TAU;
          const w0 = 0.84 + Math.sin(a0 * (2.2 + seed * 1.8) + t * 0.035 + lobe) * (0.10 + band * 0.08);
          const w1 = 0.84 + Math.sin(a1 * (2.2 + seed * 1.8) + t * 0.035 + lobe) * (0.10 + band * 0.08);
          const px0 = cx + ax2(ox + Math.cos(a0) * rad * w0, opts);
          const py0 = cy + oy + Math.sin(a0) * rad * w0 * (0.82 + seed * 0.18);
          const px1 = cx + ax2(ox + Math.cos(a1) * rad * w1, opts);
          const py1 = cy + oy + Math.sin(a1) * rad * w1 * (0.82 + seed * 0.18);
          wr.writeTri(cx + ax2(ox * 0.18, opts), cy + oy * 0.18, px0, py0, px1, py1,
            baseH,
            baseH + 0.020,
            baseH + 0.050,
            light * (0.016 + band * 0.014 + depth * 0.008),
            light * (0.054 + band * 0.036 + depth * 0.016),
            light * (0.045 + band * 0.030 + depth * 0.014),
            softSat(opts.sat, 0.96 + depth * 0.10),
            softSat(opts.sat, 1.26 + depth * 0.12),
            softSat(opts.sat, 1.10 + depth * 0.10));
        }
      }
    }
  }
}

function drawBokehDrift(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const orbCount = Math.floor(clamp(4 + amount * 4.0, 4, 12));
  for (let o = 0; o < orbCount && !wr.fillFull; o++) {
    const seed = hash01(o * 31.7 + 0.42);
    const band = bands[(o * 6 + 2) % Math.max(1, bands.length)] || 0;
    const a = seed * TAU + t * (0.005 + seed * 0.008);
    const cx = ax2(Math.cos(a) * (0.14 + seed * 0.78), opts);
    const cy = Math.sin(a * (0.82 + seed * 0.28)) * (0.10 + seed * 0.62);
    const baseRad = 0.12 + seed * 0.22 + band * 0.08 + amount * 0.04;
    const layers = 4;
    if (wr.canWriteTris && !wr.canWriteTris(layers * 24)) break;
    for (let layer = 0; layer < layers && !wr.fillFull; layer++) {
      const depth = layer / Math.max(1, layers - 1);
      const rad = baseRad * (1.18 - depth * 0.24);
      const sides = 24;
      const baseH = softHue(hue, seed * 5.0 + depth * 0.8, band, 0.030 + depth * 0.014);
      for (let i = 0; i < sides && !wr.fillFull; i++) {
        const u0 = i / sides;
        const u1 = (i + 1) / sides;
        const a0 = u0 * TAU;
        const a1 = u1 * TAU;
        const px0 = cx + ax2(Math.cos(a0) * rad, opts);
        const py0 = cy + Math.sin(a0) * rad;
        const px1 = cx + ax2(Math.cos(a1) * rad, opts);
        const py1 = cy + Math.sin(a1) * rad;
        wr.writeTri(cx, cy, px0, py0, px1, py1,
          baseH,
          baseH + 0.014,
          baseH + 0.030,
          light * (0.014 + depth * 0.010),
          light * (0.038 + depth * 0.016),
          light * (0.038 + depth * 0.016),
          softSat(opts.sat, 1.00 + depth * 0.08),
          softSat(opts.sat, 1.22 + depth * 0.08),
          softSat(opts.sat, 1.22 + depth * 0.08));
      }
    }
  }
}

function drawAmbientGlow(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  drawBokehDrift(wr, bands, feat, d, { ...opts, amount: amount * 0.42, hue: hue + 0.03, light: light * 0.44 });
  const blobs = Math.floor(clamp(3 + amount * 3.5 + (feat.beat || 0) * 2, 3, 12));
  const sides = Math.floor(clamp(18 + amount * 12, 14, 42));
  for (let j = 0; j < blobs && !wr.fillFull; j++) {
    if (wr.canWriteTris && !wr.canWriteTris(sides)) break;
    const seed = hash01(j * 17.37 + Math.floor(t * 0.08) * 0.31);
    const band = bands[(j * 9 + 5) % Math.max(1, bands.length)] || 0;
    const drift = t * (0.018 + seed * 0.010);
    const cx = ax2(Math.cos(seed * TAU + drift) * (0.12 + seed * 0.55), opts);
    const cy = Math.sin(seed * TAU * 1.37 - drift * 0.8) * (0.10 + seed * 0.55);
    const rad = 0.16 + seed * 0.18 + band * 0.20 + amount * 0.030;
    const h = softHue(hue, seed * 5.0, band);
    for (let i = 0; i < sides && !wr.fillFull; i++) {
      const u0 = i / sides;
      const u1 = (i + 1) / sides;
      const a0 = u0 * TAU;
      const a1 = u1 * TAU;
      const w0 = 0.80 + Math.sin(a0 * 2.0 + t * 0.08 + j) * 0.10 + band * 0.10;
      const w1 = 0.80 + Math.sin(a1 * 2.0 + t * 0.08 + j) * 0.10 + band * 0.10;
      const x0 = cx + ax2(Math.cos(a0) * rad * w0, opts);
      const y0 = cy + Math.sin(a0) * rad * w0;
      const x1 = cx + ax2(Math.cos(a1) * rad * w1, opts);
      const y1 = cy + Math.sin(a1) * rad * w1;
      wr.writeTri(cx, cy, x0, y0, x1, y1,
        h, h + 0.024, h + 0.052,
        light * (0.010 + band * 0.016),
        light * (0.044 + band * 0.052),
        light * (0.036 + band * 0.044),
        softSat(opts.sat, 1.00),
        softSat(opts.sat, 1.24),
        softSat(opts.sat, 1.14));
    }
  }
}


function drawSoftHalo(wr, cx, cy, rx, ry, hue, light, sat, seed, rings = 4, sides = 30) {
  if (!wr || wr.fillFull) return false;
  const needed = Math.max(0, Math.floor(sides) * (1 + Math.max(0, Math.floor(rings) - 1) * 2));
  if (wr.canWriteTris && !wr.canWriteTris(needed)) return false;
  const centerH = softHue(hue, seed * 1.7, 0.35, 0.06);
  const centerL = light * (0.10 + hash01(seed * 31.1) * 0.05);
  for (let r = 0; r < rings; r++) {
    const inner = r / rings;
    const outer = (r + 1) / rings;
    const li = light * (0.14 * Math.pow(1 - inner, 1.55) + 0.010);
    const lo = light * (0.09 * Math.pow(1 - outer, 1.90) + 0.004);
    for (let i = 0; i < sides; i++) {
      const u0 = i / sides;
      const u1 = (i + 1) / sides;
      const a0 = u0 * TAU;
      const a1 = u1 * TAU;
      const wob0 = 0.84 + Math.sin(a0 * 2.0 + seed * 7.0) * 0.10 + Math.sin(a0 * 5.0 + seed) * 0.045;
      const wob1 = 0.84 + Math.sin(a1 * 2.0 + seed * 7.0) * 0.10 + Math.sin(a1 * 5.0 + seed) * 0.045;
      const p0 = [cx + Math.cos(a0) * rx * outer * wob0, cy + Math.sin(a0) * ry * outer * wob0];
      const p1 = [cx + Math.cos(a1) * rx * outer * wob1, cy + Math.sin(a1) * ry * outer * wob1];
      const h0 = softHue(hue, seed * 3.0 + u0 * 2.2, 0.25, 0.03);
      const h1 = softHue(hue, seed * 3.0 + u1 * 2.2, 0.25, 0.08);
      if (r === 0) {
        wr.writeTri(cx, cy, p0[0], p0[1], p1[0], p1[1], centerH, h0, h1, centerL, lo, lo * 0.92, softSat(sat, 1.04), softSat(sat, 1.30), softSat(sat, 1.20));
      } else {
        const q0 = [cx + Math.cos(a0) * rx * inner * wob0, cy + Math.sin(a0) * ry * inner * wob0];
        const q1 = [cx + Math.cos(a1) * rx * inner * wob1, cy + Math.sin(a1) * ry * inner * wob1];
        const hi0 = softHue(hue, seed * 3.0 + u0 * 2.2, 0.35, 0.01);
        const hi1 = softHue(hue, seed * 3.0 + u1 * 2.2, 0.35, 0.06);
        wr.writeTri(q0[0], q0[1], p0[0], p0[1], p1[0], p1[1], hi0, h0, h1, li, lo, lo * 0.92, softSat(sat, 1.00), softSat(sat, 1.24), softSat(sat, 1.16));
        wr.writeTri(q0[0], q0[1], p1[0], p1[1], q1[0], q1[1], hi0, h1, hi1, li, lo * 0.92, li * 0.88, softSat(sat, 1.00), softSat(sat, 1.16), softSat(sat, 0.94));
      }
    }
  }
  return true;
}

function drawNebulaWash(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const count = Math.floor(clamp(5 + amount * 5.5 + (feat.beat || 0) * 2.0, 4, 16));
  for (let i = 0; i < count && !wr.fillFull; i++) {
    const seed = hash01(i * 23.71 + 2.7);
    const band = bands[(i * 7 + 3) % Math.max(1, bands.length)] || 0;
    const drift = t * (0.003 + seed * 0.004);
    const cx = ax2(Math.cos(seed * TAU + drift) * (0.14 + seed * 0.64), opts);
    const cy = Math.sin(seed * TAU * 0.87 - drift * 1.1) * (0.12 + seed * 0.54);
    const baseR = 0.22 + seed * 0.22 + amount * 0.030 + band * 0.08;
    const rx = baseR * (0.92 + hash01(seed * 3.7) * 0.16);
    const ry = baseR * (0.86 + hash01(seed * 17.3) * 0.18);
    drawSoftHalo(wr, cx, cy, rx, ry, hue + seed * 0.18 + band * 0.06, light * (0.72 + band * 0.16), opts.sat * 1.12, seed, 5, 34);
  }
}

function drawBokehBloom(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  const count = Math.floor(clamp(8 + amount * 7.5 + (feat.beat || 0) * 5.0, 6, 24));
  for (let i = 0; i < count && !wr.fillFull; i++) {
    const seed = hash01(i * 31.43 + 1.17);
    const band = bands[(i * 5 + 1) % Math.max(1, bands.length)] || 0;
    const a = seed * TAU + t * (0.0015 + seed * 0.0025);
    const r = 0.12 + hash01(seed * 81.1) * 0.72;
    const cx = ax2(Math.cos(a) * r, opts);
    const cy = Math.sin(a * 0.92 + seed) * r * 0.76;
    const rad = 0.055 + seed * 0.10 + band * 0.10 + amount * 0.014;
    const rx = rad * (0.96 + hash01(seed * 7.1) * 0.14);
    const ry = rad * (0.90 + hash01(seed * 9.3) * 0.16);
    drawSoftHalo(wr, cx, cy, rx, ry, hue + 0.08 + seed * 0.28, light * (0.62 + band * 0.18), opts.sat * 1.10, seed + 7.0, 4, 30);
  }
}

function drawChromaFog(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  drawAmbientGlow(wr, bands, feat, d, { ...opts, amount: amount * 0.40, light: light * 0.44, hue: hue + 0.02 });
  drawNebulaWash(wr, bands, feat, d, { ...opts, amount: amount * 0.42, light: light * 0.48, hue: hue + 0.02 });
  const curtains = Math.floor(clamp(6 + amount * 5, 5, 12));
  const steps = Math.floor(clamp(70 + amount * 44, 52, 132));
  for (let c = 0; c < curtains && !wr.fillFull; c++) {
    const ck = c / Math.max(1, curtains - 1);
    const seed = hash01(c * 13.37 + 0.19);
    const centerX = -0.90 + ck * 1.80 + Math.sin(t * (0.020 + seed * 0.018) + c * 0.8) * 0.05;
    const slant = Math.sin(t * 0.028 + seed * 5.0) * 0.18;
    let prevL = null, prevR = null, prevHL = hue, prevHR = hue, prevLL = 0, prevLR = 0;
    for (let i = 0; i <= steps && !wr.fillFull; i++) {
      const u = i / steps;
      const band = bands[(i * 3 + c * 5) % Math.max(1, bands.length)] || 0;
      const y = -0.92 + u * 1.84;
      const wave = Math.sin(u * TAU * (0.55 + ck * 0.22) + t * (0.032 + band * 0.010) + seed * 6.0)
        + Math.sin(u * TAU * (1.10 + band * 0.80) - t * 0.020 + c * 0.6) * 0.45;
      const xCore = centerX + slant * (u - 0.5) + wave * (0.05 + band * 0.06 + amount * 0.015);
      const width = 0.055 + amount * 0.024 + band * 0.060 + Math.sin(u * Math.PI) * 0.020;
      const taper = 0.82 + Math.sin(u * Math.PI) * 0.18;
      const left = [xCore - width * taper, y];
      const right = [xCore + width * taper, y];
      const hL = softHue(hue, ck * 2.4 + u * 1.6, band, 0.05);
      const hR = softHue(hue, ck * 2.4 + u * 1.6 + 0.72, band, 0.10);
      const lL = light * (0.050 + band * 0.042 + Math.sin(u * Math.PI) * 0.024);
      const lR = light * (0.095 + band * 0.074 + Math.sin(u * Math.PI) * 0.050);
      if (prevL && prevR) {
        wr.writeTri(prevL[0], prevL[1], prevR[0], prevR[1], right[0], right[1], prevHL, prevHR, hR, prevLL, prevLR, lR, softSat(opts.sat, 0.92), softSat(opts.sat, 1.10), softSat(opts.sat, 1.18));
        if (!wr.fillFull) wr.writeTri(prevL[0], prevL[1], right[0], right[1], left[0], left[1], prevHL, hR, hL, prevLL, lR, lL, softSat(opts.sat, 0.92), softSat(opts.sat, 1.18), softSat(opts.sat, 0.96));
        if (!wr.full && (i % 3) !== 0) {
          const px = (prevL[0] + prevR[0]) * 0.5;
          const py = (prevL[1] + prevR[1]) * 0.5;
          const qx = (left[0] + right[0]) * 0.5;
          const qy = (left[1] + right[1]) * 0.5;
          wr.write(px, py, qx, qy, hL + 0.03, hR + 0.08, light * (0.020 + band * 0.018), light * (0.040 + band * 0.028), softSat(opts.sat, 0.84), softSat(opts.sat, 1.00));
        }
      }
      prevL = left; prevR = right; prevHL = hL; prevHR = hR; prevLL = lL; prevLR = lR;
    }
  }
}

function drawSpectralMist(wr, bands, feat, d, opts) {
  const { amount, t, hue, light } = opts;
  drawDiffuseClouds(wr, bands, feat, d, { ...opts, amount: amount * 0.54, light: light * 0.54, hue: hue + 0.02 });
  drawAmbientGlow(wr, bands, feat, d, { ...opts, amount: amount * 0.72, light: light * 0.72, hue: hue + 0.02 });
  const wisps = Math.floor(clamp(10 + amount * 16, 8, 42));
  const steps = Math.floor(clamp(18 + amount * 18, 12, 46));
  for (let w = 0; w < wisps && !wr.full; w++) {
    const seed = hash01(w * 9.71 + 0.2);
    const band = bands[(w * 5 + 3) % Math.max(1, bands.length)] || 0;
    let px = -1.12 + hash01(seed * 31.0) * 2.24;
    let py = -0.92 + hash01(seed * 53.0) * 1.84;
    for (let i = 1; i <= steps && !wr.full; i++) {
      const u = i / steps;
      const phase = seed * TAU + u * TAU * (0.60 + band * 0.8);
      const x = px + Math.cos(phase + t * 0.045) * (0.018 + band * 0.035);
      const y = py + Math.sin(phase * 0.82 - t * 0.035) * (0.018 + band * 0.035);
      const h = softHue(hue, seed * 6.0 + u * 1.6, band, 0.055);
      wr.write(px, py, x, y, h, h + 0.020, light * (0.055 + band * 0.040), light * (0.145 + band * 0.075), softSat(opts.sat, 0.42), softSat(opts.sat, 0.62));
      px = x; py = y;
    }
  }
}

// Custom 2D audio backdrop plug-in registry.
// Add a function here with the same id that you add to audio-fx-registry.js.
// Keep each drawer pure: (wr, bands, feat, drive, opts) -> write geometry only.
const BACKDROP_STYLE_DRAWERS = {
  softwaves: (wr, bands, feat, d, opts) => {
    drawSineField(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.45, light: opts.light * 0.56 });
    drawSoftColorWaves(wr, bands, feat, d, { ...opts, amount: opts.amount * 1.00, hue: opts.hue + 0.03, light: opts.light * 0.74 });
    drawGradientFlow(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.42, hue: opts.hue + 0.06, light: opts.light * 0.42 });
  },
  silkflow: (wr, bands, feat, d, opts) => {
    drawFilledWaveSheet(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.70, hue: opts.hue + 0.03, light: opts.light * 0.58 });
    drawGradientFlow(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.74, hue: opts.hue + 0.06, light: opts.light * 0.54 });
    drawWaveInterferenceField(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.12, hue: opts.hue + 0.08, light: opts.light * 0.34 });
  },
  colorbursts: (wr, bands, feat, d, opts) => {
    drawAmbientGlow(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.75, hue: opts.hue + 0.04, light: opts.light * 0.56 });
    drawColorBursts(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.82, hue: opts.hue + 0.08, light: opts.light * 0.66 });
    drawSoftColorWaves(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.30, hue: opts.hue + 0.12, light: opts.light * 0.38 });
  },
  gradientflow: (wr, bands, feat, d, opts) => {
    drawGradientFlow(wr, bands, feat, d, { ...opts, amount: opts.amount * 1.08, hue: opts.hue + 0.02, light: opts.light * 0.74 });
    drawContourVeils(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.34, hue: opts.hue + 0.05, light: opts.light * 0.34 });
    drawWaveInterferenceField(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.16, hue: opts.hue + 0.08, light: opts.light * 0.35 });
  },
  contourveil: (wr, bands, feat, d, opts) => {
    drawContourVeils(wr, bands, feat, d, { ...opts, amount: opts.amount * 1.00, hue: opts.hue + 0.02, light: opts.light * 0.74 });
    drawGradientFlow(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.34, hue: opts.hue + 0.05, light: opts.light * 0.34 });
    drawAmbientGlow(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.40, hue: opts.hue + 0.06, light: opts.light * 0.34 });
  },
  prismadrift: (wr, bands, feat, d, opts) => {
    drawPrismaDrift(wr, bands, feat, d, { ...opts, amount: opts.amount * 1.00, hue: opts.hue + 0.01, light: opts.light * 0.78 });
    drawAmbientGlow(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.34, hue: opts.hue + 0.10, light: opts.light * 0.32 });
    drawWaveInterferenceField(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.18, hue: opts.hue + 0.16, light: opts.light * 0.30 });
  },
  jazzhaze: (wr, bands, feat, d, opts) => {
    drawJazzHaze(wr, bands, feat, d, { ...opts, amount: opts.amount * 1.00, hue: opts.hue + 0.04, light: opts.light * 0.74 });
    drawContourVeils(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.42, hue: opts.hue + 0.08, light: opts.light * 0.30 });
    drawAmbientGlow(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.36, hue: opts.hue + 0.12, light: opts.light * 0.30 });
  },
  opalbloom: (wr, bands, feat, d, opts) => {
    drawOpalBloom(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.94, hue: opts.hue + 0.03, light: opts.light * 0.78 });
    drawAmbientGlow(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.34, hue: opts.hue + 0.12, light: opts.light * 0.32 });
    drawSoftColorWaves(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.22, hue: opts.hue + 0.20, light: opts.light * 0.28 });
  },
  dreamblobs: (wr, bands, feat, d, opts) => {
    drawBokehDrift(wr, bands, feat, d, { ...opts, amount: opts.amount * 1.12, hue: opts.hue + 0.04, light: opts.light * 0.88 });
    drawOpalBloom(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.56, hue: opts.hue + 0.08, light: opts.light * 0.44 });
    drawAmbientGlow(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.24, hue: opts.hue + 0.12, light: opts.light * 0.24 });
  },
  nebulawash: (wr, bands, feat, d, opts) => {
    drawDiffuseClouds(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.72, hue: opts.hue + 0.02, light: opts.light * 0.62 });
    drawNebulaWash(wr, bands, feat, d, { ...opts, amount: opts.amount * 1.02, hue: opts.hue + 0.03, light: opts.light * 0.90 });
    drawBokehBloom(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.38, hue: opts.hue + 0.12, light: opts.light * 0.56 });
    drawSpectralMist(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.18, hue: opts.hue + 0.18, light: opts.light * 0.30 });
  },
  bokehbloom: (wr, bands, feat, d, opts) => {
    drawBokehBloom(wr, bands, feat, d, { ...opts, amount: opts.amount * 1.10, hue: opts.hue + 0.06, light: opts.light * 0.92 });
    drawNebulaWash(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.34, hue: opts.hue + 0.10, light: opts.light * 0.48 });
    drawOpalBloom(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.28, hue: opts.hue + 0.14, light: opts.light * 0.34 });
  },
  chromafog: (wr, bands, feat, d, opts) => {
    drawChromaFog(wr, bands, feat, d, { ...opts, amount: opts.amount * 1.04, hue: opts.hue + 0.05, light: opts.light * 0.88 });
    drawPrismaDrift(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.42, hue: opts.hue + 0.16, light: opts.light * 0.36 });
    drawContourVeils(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.18, hue: opts.hue + 0.10, light: opts.light * 0.20 });
  },
  ambientglow: (wr, bands, feat, d, opts) => {
    drawAmbientGlow(wr, bands, feat, d, { ...opts, amount: opts.amount * 1.06, hue: opts.hue + 0.02, light: opts.light * 0.78 });
    drawContourVeils(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.24, hue: opts.hue + 0.08, light: opts.light * 0.30 });
    drawSoftColorWaves(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.34, hue: opts.hue + 0.10, light: opts.light * 0.36 });
  },
  spectralmist: (wr, bands, feat, d, opts) => {
    drawSpectralMist(wr, bands, feat, d, { ...opts, amount: opts.amount * 1.00, hue: opts.hue + 0.02, light: opts.light * 0.80 });
    drawGradientFlow(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.20, hue: opts.hue + 0.09, light: opts.light * 0.30 });
    drawContourVeils(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.16, hue: opts.hue + 0.04, light: opts.light * 0.24 });
  }
};

function classicSceneBlend(t) {
  const prev = WORKER_STATE.previousSceneIndex;
  const curr = WORKER_STATE.sceneStyleIndex;
  if (prev < 0 || prev === curr) return 1;
  const duration = Math.max(0.35, WORKER_STATE.sceneBlendDuration || 1.35);
  const k = smoothstep(0, 1, (t - (WORKER_STATE.sceneBlendStart || 0)) / duration);
  if (k >= 0.995) WORKER_STATE.previousSceneIndex = -1;
  return k;
}

function drawClassicSceneTransition(wr, bands, feat, d, opts) {
  const currentIndex = Math.abs((WORKER_STATE.sceneStyleIndex ?? 0) % CLASSIC_SCENES.length);
  const currentScene = CLASSIC_SCENES[currentIndex];
  const prevRaw = WORKER_STATE.previousSceneIndex;
  const previousScene = prevRaw >= 0 ? CLASSIC_SCENES[Math.abs(prevRaw % CLASSIC_SCENES.length)] : '';
  const blend = classicSceneBlend(opts.t);
  if (previousScene && previousScene !== currentScene && blend < 0.995) {
    const oldAmt = opts.amount * (0.78 - blend * 0.34);
    const newAmt = opts.amount * (0.46 + blend * 0.54);
    drawByStyle(previousScene, wr, bands, feat, d, {
      ...opts,
      amount: Math.max(0.08, oldAmt),
      hue: opts.hue - 0.03,
      light: opts.light * (0.84 - blend * 0.12)
    });
    drawByStyle(currentScene, wr, bands, feat, d, {
      ...opts,
      amount: Math.max(0.10, newAmt),
      hue: opts.hue + 0.02,
      light: opts.light * (0.82 + blend * 0.18)
    });
    if (blend < 0.92 && (TRANSITION_WAVE_SCENES.has(previousScene) || TRANSITION_WAVE_SCENES.has(currentScene))) {
      drawWaveInterferenceField(wr, bands, feat, d, {
        ...opts,
        amount: opts.amount * (0.12 + (1 - blend) * 0.20),
        hue: opts.hue + 0.18,
        light: opts.light * 0.42
      });
    }
  } else {
    drawByStyle(currentScene, wr, bands, feat, d, opts);
  }
  return currentScene;
}

function drawFilledAccentsForStyle(style, wr, bands, feat, d, opts) {
  const s = String(style || 'classic');
  if (isLineOnlyBackdropStyle(s)) return;
  const pastelLike = /^pastel/.test(s) || !!PASTEL_STYLE_DEFS[s];
  if (pastelLike) {
    drawNebulaWash(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.48, hue: opts.hue + 0.04, light: opts.light * 0.48 });
    drawSoftColorWaves(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.50, hue: opts.hue + 0.10, light: opts.light * 0.52 });
    if ((feat.beat || 0) > 0.36) drawBokehBloom(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.18, hue: opts.hue + 0.12, light: opts.light * 0.34 });
  } else if (s === 'matrixrain' || s === 'matrixcrawl') {
    drawFilledMatrixBlocks(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.36, light: opts.light * 0.62, hue: opts.hue + 0.16 });
    if (s === 'matrixcrawl') {
      drawFilledGridPulse(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.18, light: opts.light * 0.34, hue: opts.hue + 0.36 });
    }
    if ((feat.beat || 0) > 0.52 || WORKER_STATE.pulse > 0.22) {
      drawScanlinePostGrid(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.12, hue: opts.hue + 0.18, light: opts.light * 0.38 });
    }
  } else if (s === 'sacred') {
    drawSacredGeometry(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.98, light: opts.light * 0.95 });
    drawCymaticBloom(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.45, hue: opts.hue + 0.18, light: opts.light * 0.66 });
  } else if (s === 'rings' || s === 'georings') {
    const layerMix = clamp(Number(opts.layerMix ?? 1), 0, 1);
    const lateMix = clamp(Number(opts.lateMix ?? layerMix), 0, 1);
    drawCymaticBloom(wr, bands, feat, d, { ...opts, amount: opts.amount * (0.30 + layerMix * 0.22), light: opts.light * 0.58, maxRadius: 0.46 });
    if ((feat.beat || 0) > 0.34 && lateMix > 0.18) drawFilledRadialBlob(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.08 * lateMix, hue: opts.hue + 0.14, light: opts.light * 0.34 });
  } else if (s === 'honeycomb') {
    const layerMix = clamp(Number(opts.layerMix ?? 1), 0, 1);
    const lateMix = clamp(Number(opts.lateMix ?? layerMix), 0, 1);
    drawHoneycombField(wr, bands, feat, d, { ...opts, amount: opts.amount * (1.00 + layerMix * 0.34), hue: opts.hue + 0.10, light: opts.light * 0.90 });
    drawWaveInterferenceField(wr, bands, feat, d, { ...opts, amount: opts.amount * (0.05 + layerMix * 0.04), hue: opts.hue + 0.08, light: opts.light * 0.20 });
    if ((feat.beat || 0) > 0.30 && lateMix > 0.14) drawCenterRadiance(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.14 * lateMix, hue: opts.hue + 0.22, light: opts.light * 0.42 });
  } else if (s === 'moire' || s === 'lattice') {
    const layerMix = clamp(Number(opts.layerMix ?? 1), 0, 1);
    const lateMix = clamp(Number(opts.lateMix ?? layerMix), 0, 1);
    drawMoireGrid(wr, bands, feat, d, { ...opts, amount: opts.amount * (1.04 + layerMix * 0.18), light: opts.light * 0.92 }, false);
    drawWaveInterferenceField(wr, bands, feat, d, { ...opts, amount: opts.amount * (0.24 + layerMix * 0.18), hue: opts.hue + 0.12, light: opts.light * 0.60 });
  } else if (s === 'cellular') {
    const layerMix = clamp(Number(opts.layerMix ?? 1), 0, 1);
    const lateMix = clamp(Number(opts.lateMix ?? layerMix), 0, 1);
    drawCellularBackdrop(wr, bands, feat, d, { ...opts, amount: opts.amount * (0.94 + layerMix * 0.20), light: opts.light * 0.88 });
    drawWaveInterferenceField(wr, bands, feat, d, { ...opts, amount: opts.amount * (0.06 + layerMix * 0.06), hue: opts.hue + 0.10, light: opts.light * 0.20 });
    if ((feat.beat || 0) > 0.26 && lateMix > 0.12) drawCenterRadiance(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.16 * lateMix, hue: opts.hue + 0.22, light: opts.light * 0.46 });
    if ((feat.beat || 0) > 0.35 && lateMix > 0.20) drawFilledRadialBlob(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.12 * lateMix, hue: opts.hue + 0.25, light: opts.light * 0.44 });
  } else if (s === 'cellfield') {
    const layerMix = clamp(Number(opts.layerMix ?? 1), 0, 1);
    const lateMix = clamp(Number(opts.lateMix ?? layerMix), 0, 1);
    drawCellFieldAltBackdrop(wr, bands, feat, d, { ...opts, amount: opts.amount * (0.98 + layerMix * 0.26), hue: opts.hue + 0.06, light: opts.light * 0.88 });
    drawWaveInterferenceField(wr, bands, feat, d, { ...opts, amount: opts.amount * (0.08 + layerMix * 0.08), hue: opts.hue + 0.14, light: opts.light * 0.22 });
    if ((feat.beat || 0) > 0.34 && lateMix > 0.18) drawCenterRadiance(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.14 * lateMix, hue: opts.hue + 0.28, light: opts.light * 0.40 });
  } else if (s === 'entropy') {
    const layerMix = clamp(Number(opts.layerMix ?? 1), 0, 1);
    const lateMix = clamp(Number(opts.lateMix ?? layerMix), 0, 1);
    drawEntropyCalculatorBackdrop(wr, bands, feat, d, { ...opts, amount: opts.amount * (0.96 + layerMix * 0.18), light: opts.light * 0.88 });
    drawFilledWaveSheet(wr, bands, feat, d, { ...opts, amount: opts.amount * (0.12 + layerMix * 0.10), hue: opts.hue + 0.10, light: opts.light * 0.22 });
  } else if (s === 'spectrum') {
    drawFilledSpectrumBars(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.96, light: opts.light * 0.94 });
  } else if (s === 'chromafog') {
    const layerMix = clamp(Number(opts.layerMix ?? 1), 0, 1);
    const lateMix = clamp(Number(opts.lateMix ?? layerMix), 0, 1);
    drawChromaFog(wr, bands, feat, d, { ...opts, amount: opts.amount * (0.70 + layerMix * 0.20), hue: opts.hue + 0.08, light: opts.light * 0.60 });
    drawPrismaDrift(wr, bands, feat, d, { ...opts, amount: opts.amount * (0.18 + layerMix * 0.12), hue: opts.hue + 0.14, light: opts.light * 0.28 });
    drawAmbientGlow(wr, bands, feat, d, { ...opts, amount: opts.amount * (0.08 + layerMix * 0.08), hue: opts.hue + 0.10, light: opts.light * 0.18 });
    if ((feat.beat || 0) > 0.34 && lateMix > 0.18) drawFilledWaveSheet(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.10 * lateMix, hue: opts.hue + 0.10, light: opts.light * 0.18 });
  } else if (s === 'dreamblobs' || s === 'nebulawash' || s === 'bokehbloom' || s === 'ambientglow' || s === 'spectralmist' || s === 'opalbloom') {
    const layerMix = clamp(Number(opts.layerMix ?? 1), 0, 1);
    const lateMix = clamp(Number(opts.lateMix ?? layerMix), 0, 1);
    drawNebulaWash(wr, bands, feat, d, { ...opts, amount: opts.amount * (0.42 + layerMix * 0.20), hue: opts.hue + 0.08, light: opts.light * 0.56 });
    drawOpalBloom(wr, bands, feat, d, { ...opts, amount: opts.amount * (0.14 + layerMix * 0.18), hue: opts.hue + 0.12, light: opts.light * 0.28 });
    drawAmbientGlow(wr, bands, feat, d, { ...opts, amount: opts.amount * (0.08 + layerMix * 0.08), hue: opts.hue + 0.10, light: opts.light * 0.20 });
    if ((feat.beat || 0) > 0.42 && lateMix > 0.22) drawBokehBloom(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.12 * lateMix, hue: opts.hue + 0.14, light: opts.light * 0.26 });
  } else if (s === 'sinefield' || s === 'lightfield' || s === 'trails') {
    const layerMix = clamp(Number(opts.layerMix ?? 1), 0, 1);
    const lateMix = clamp(Number(opts.lateMix ?? layerMix), 0, 1);
    drawLightFieldBackdrop(wr, bands, feat, d, { ...opts, amount: opts.amount * (0.72 + layerMix * 0.28), hue: opts.hue + 0.04, light: opts.light * 0.76 });
    drawSoftColorWaves(wr, bands, feat, d, { ...opts, amount: opts.amount * (0.12 + layerMix * 0.14), hue: opts.hue + 0.16, light: opts.light * 0.26 });
    if (lateMix > 0.18) drawPrismaDrift(wr, bands, feat, d, { ...opts, amount: opts.amount * (0.08 + lateMix * 0.08), hue: opts.hue + 0.10, light: opts.light * 0.18 });
    if (lateMix > 0.22 && (feat.beat || 0) > 0.32) drawFilledWaveSheet(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.12 * lateMix, hue: opts.hue + 0.12, light: opts.light * 0.20 });
  } else if (s === 'rainbow' || s === 'ribbons' || s === 'oscilloscope' || s === 'softwaves' || s === 'silkflow' || s === 'colorbursts' || s === 'gradientflow' || s === 'contourveil' || s === 'prismadrift' || s === 'jazzhaze') {
    const layerMix = clamp(Number(opts.layerMix ?? 1), 0, 1);
    const lateMix = clamp(Number(opts.lateMix ?? layerMix), 0, 1);
    drawFilledWaveSheet(wr, bands, feat, d, { ...opts, amount: opts.amount * (0.56 + layerMix * 0.14), light: opts.light * 0.68 });
    drawSoftColorWaves(wr, bands, feat, d, { ...opts, amount: opts.amount * (0.28 + layerMix * 0.16), hue: opts.hue + 0.12, light: opts.light * 0.44 });
    if ((s === 'colorbursts' || (feat.beat || 0) > 0.38) && lateMix > 0.20) drawColorBursts(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.18 * lateMix, hue: opts.hue + 0.10, light: opts.light * 0.40 });
    if (lateMix > 0.18) drawWaveInterferenceField(wr, bands, feat, d, { ...opts, amount: opts.amount * (0.08 + lateMix * 0.06), hue: opts.hue + 0.08, light: opts.light * 0.28 });
  } else if (s === 'aurora') { drawFilledAuroraCurtains(wr, bands, feat, d, { ...opts, amount: opts.amount * 1.05, light: opts.light * 0.94 }); drawCenterRadiance(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.18, hue: opts.hue + 0.18, light: opts.light * 0.46 }); }
  else if (s === 'cymatics') {
    const layerMix = clamp(Number(opts.layerMix ?? 1), 0, 1);
    const lateMix = clamp(Number(opts.lateMix ?? layerMix), 0, 1);
    drawCymaticBloom(wr, bands, feat, d, { ...opts, amount: opts.amount * (0.34 + layerMix * 0.20), light: opts.light * 0.58, maxRadius: 0.48 });
    drawWaveInterferenceField(wr, bands, feat, d, { ...opts, amount: opts.amount * (0.18 + layerMix * 0.12), hue: opts.hue + 0.20, light: opts.light * 0.46 });
    drawCenterRadiance(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.12, hue: opts.hue + 0.12, light: opts.light * 0.34 });
    if ((feat.beat || 0) > 0.38 && lateMix > 0.20) drawFilledRadialBlob(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.08 * lateMix, light: opts.light * 0.30 });
  }
  else if (s === 'vectorscope') {
    const layerMix = clamp(Number(opts.layerMix ?? 1), 0, 1);
    drawCenterRadiance(wr, bands, feat, d, { ...opts, amount: opts.amount * (0.12 + layerMix * 0.08), hue: opts.hue + 0.14, light: opts.light * 0.42 });
    if ((feat.beat || 0) > 0.42 && layerMix > 0.40) drawCymaticBloom(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.10 * layerMix, hue: opts.hue + 0.18, light: opts.light * 0.30, maxRadius: 0.38 });
  }
  else if (s === 'tunnel' || s === 'hyperspace') {
    drawCenterRadiance(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.20, hue: opts.hue + 0.14, light: opts.light * 0.46 });
  }
  else if (s === 'starfield') {
    drawCenterRadiance(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.16, hue: opts.hue + 0.14, light: opts.light * 0.40 });
    drawStarShower(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.24, light: opts.light * 0.66, hue: opts.hue + 0.20 });
  }
  else {
    drawFilledWaveSheet(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.48, light: opts.light * 0.52 });
    drawSoftColorWaves(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.34, hue: opts.hue + 0.12, light: opts.light * 0.38 });
    if ((feat.beat || 0) > 0.40) drawCenterRadiance(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.16, hue: opts.hue + 0.18, light: opts.light * 0.36 });
  }
}

function drawClassicMixtape(wr, bands, feat, d, opts) {
  // Classic is a DJ/visualizer scene selector now, not an "everything soup".
  // Base scenes crossfade instead of hard cutting so the shift into cymatics /
  // waves / starfields feels composited rather than jumpy.
  const scene = drawClassicSceneTransition(wr, bands, feat, d, {
    ...opts,
    amount: opts.amount * (0.92 + WORKER_STATE.pulse * 0.10),
    hue: opts.hue + Math.abs((WORKER_STATE.sceneStyleIndex ?? 0) % CLASSIC_SCENES.length) * 0.071,
    light: opts.light * (0.88 + Math.min(0.14, WORKER_STATE.pulse * 0.05))
  });

  if (WORKER_STATE.pulse > 0.18 || (feat.beat || 0) > 0.42) {
    const accent = CLASSIC_ACCENTS[WORKER_STATE.accentStyleIndex % CLASSIC_ACCENTS.length];
    drawByStyle(accent, wr, bands, feat, d, {
      ...opts,
      amount: opts.amount * (0.045 + WORKER_STATE.pulse * 0.070),
      hue: opts.hue + 0.23 + WORKER_STATE.accentStyleIndex * 0.09,
      light: opts.light * 0.60
    });
  }

  if (scene === 'starfield' || scene === 'vectorscope') {
    drawWaveInterferenceField(wr, bands, feat, d, {
      ...opts,
      amount: opts.amount * 0.10,
      hue: opts.hue + 0.24,
      light: opts.light * 0.30
    });
  }
}

function drawByStyle(style, wr, bands, feat, d, opts) {
  const requestedStyle = String(style || '');
  const baseStyle = resolveBackdropStyleFamily(requestedStyle);
  const plug = BACKDROP_STYLE_DRAWERS[baseStyle];
  if (plug) { plug(wr, bands, feat, d, opts); return; }
  if (baseStyle === 'classic' || baseStyle === 'itunes' || baseStyle === 'all' || baseStyle === 'mix') drawClassicMixtape(wr, bands, feat, d, opts);
  else if (baseStyle === 'sinefield' || baseStyle === 'lightfield' || baseStyle === 'trails') { drawLightFieldBackdrop(wr, bands, feat, d, { ...opts, amount: opts.amount * 1.04, light: opts.light * 0.92 }); drawSineField(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.18, hue: opts.hue + 0.08, light: opts.light * 0.34 }); }
  else if (baseStyle === 'softwaves') { drawSineField(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.58, light: opts.light * 0.74 }); drawSoftColorWaves(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.96, hue: opts.hue + 0.12, light: opts.light * 0.76 }); drawWaveInterferenceField(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.24, hue: opts.hue + 0.28, light: opts.light * 0.46 }); }
  else if (baseStyle === 'silkflow') { drawRainbowRibbons(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.52, light: opts.light * 0.62 }); drawFilledWaveSheet(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.86, hue: opts.hue + 0.08, light: opts.light * 0.68 }); drawSoftColorWaves(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.58, hue: opts.hue + 0.20, light: opts.light * 0.54 }); }
  else if (baseStyle === 'colorbursts') { drawVectorscope(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.52, light: opts.light * 0.62 }); drawColorBursts(wr, bands, feat, d, { ...opts, amount: opts.amount * 1.05, hue: opts.hue + 0.14, light: opts.light * 0.78 }); drawSoftColorWaves(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.42, hue: opts.hue + 0.28, light: opts.light * 0.46 }); }
  else if (baseStyle === 'gradientflow') { drawGradientFlow(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.98, hue: opts.hue + 0.04, light: opts.light * 0.78 }); drawContourVeils(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.28, hue: opts.hue + 0.08, light: opts.light * 0.34 }); }
  else if (baseStyle === 'contourveil') { drawContourVeils(wr, bands, feat, d, { ...opts, amount: opts.amount * 1.00, hue: opts.hue + 0.04, light: opts.light * 0.80 }); drawAmbientGlow(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.30, hue: opts.hue + 0.10, light: opts.light * 0.34 }); }
  else if (baseStyle === 'prismadrift') { drawPrismaDrift(wr, bands, feat, d, { ...opts, amount: opts.amount * 1.00, hue: opts.hue + 0.02, light: opts.light * 0.82 }); drawAmbientGlow(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.26, hue: opts.hue + 0.10, light: opts.light * 0.30 }); }
  else if (baseStyle === 'dreamblobs') { drawBokehDrift(wr, bands, feat, d, { ...opts, amount: opts.amount * 1.12, hue: opts.hue + 0.04, light: opts.light * 0.88 }); drawOpalBloom(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.56, hue: opts.hue + 0.08, light: opts.light * 0.44 }); drawAmbientGlow(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.24, hue: opts.hue + 0.12, light: opts.light * 0.24 }); }
  else if (baseStyle === 'jazzhaze') { drawJazzHaze(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.98, hue: opts.hue + 0.04, light: opts.light * 0.76 }); drawContourVeils(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.34, hue: opts.hue + 0.08, light: opts.light * 0.28 }); drawAmbientGlow(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.28, hue: opts.hue + 0.12, light: opts.light * 0.28 }); }
  else if (baseStyle === 'nebulawash') { drawDiffuseClouds(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.64, hue: opts.hue + 0.02, light: opts.light * 0.54 }); drawNebulaWash(wr, bands, feat, d, { ...opts, amount: opts.amount * 1.00, hue: opts.hue + 0.03, light: opts.light * 0.88 }); drawAmbientGlow(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.18, hue: opts.hue + 0.08, light: opts.light * 0.24 }); if ((feat.beat || 0) > 0.34) drawBokehBloom(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.14, hue: opts.hue + 0.12, light: opts.light * 0.28 }); }
  else if (baseStyle === 'bokehbloom') { drawBokehBloom(wr, bands, feat, d, { ...opts, amount: opts.amount * 1.08, hue: opts.hue + 0.06, light: opts.light * 0.90 }); drawNebulaWash(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.28, hue: opts.hue + 0.12, light: opts.light * 0.44 }); }
  else if (baseStyle === 'chromafog') {
    drawChromaFog(wr, bands, feat, d, { ...opts, amount: opts.amount * 1.02, hue: opts.hue + 0.05, light: opts.light * 0.88 });
    drawPrismaDrift(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.20, hue: opts.hue + 0.14, light: opts.light * 0.22 });
  }
  else if (baseStyle === 'opalbloom') { drawOpalBloom(wr, bands, feat, d, { ...opts, amount: opts.amount * 1.00, hue: opts.hue + 0.04, light: opts.light * 0.82 }); drawAmbientGlow(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.28, hue: opts.hue + 0.10, light: opts.light * 0.30 }); }
  else if (baseStyle === 'oscilloscope') { drawOscilloscope(wr, bands, feat, d, opts); drawWaveInterferenceField(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.18, hue: opts.hue + 0.14, light: opts.light * 0.55 }); }
  else if (baseStyle === 'spectrum') drawSpectrum(wr, bands, feat, d, opts);
  else if (baseStyle === 'vectorscope') { drawVectorscope(wr, bands, feat, d, opts); }
  else if (baseStyle === 'radialbars' || style === 'radial') drawRadialBars(wr, bands, feat, d, opts);
  else if (baseStyle === 'matrixrain') { drawMatrix(wr, bands, feat, d, opts); drawStarShower(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.26, hue: opts.hue + 0.18, light: opts.light * 0.52 }); }
  else if (baseStyle === 'matrixcrawl') { drawMatrix(wr, bands, feat, d, opts); drawMatrixScreenCrawl(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.72, light: opts.light * 0.75 }); }
  else if (baseStyle === 'rings' || baseStyle === 'georings') { drawCymatics(wr, bands, feat, d, opts); drawCymaticBloom(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.34, light: opts.light * 0.54, maxRadius: 0.48 }); drawWaveInterferenceField(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.14, hue: opts.hue + 0.22, light: opts.light * 0.52 }); }
  else if (baseStyle === 'sacred') { drawSacredGeometry(wr, bands, feat, d, opts); drawCymatics(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.38, hue: opts.hue + 0.16, light: opts.light * 0.68 }); }
  else if (baseStyle === 'rainbow' || baseStyle === 'ribbons') drawRainbowRibbons(wr, bands, feat, d, opts);
  else if (baseStyle === 'aurora') drawAurora(wr, bands, feat, d, opts);
  else if (baseStyle === 'cymatics' || baseStyle === 'spectral' || baseStyle === 'kaleido' || baseStyle === 'constellation') { drawCymatics(wr, bands, feat, d, opts); drawWaveInterferenceField(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.32, hue: opts.hue + 0.16, light: opts.light * 0.58 }); drawRadialBars(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.26, hue: opts.hue + 0.08 }); }
  else if (baseStyle === 'tunnel' || baseStyle === 'hyperspace') { drawTunnel(wr, bands, feat, d, opts); drawCenterRadiance(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.18, hue: opts.hue + 0.16, light: opts.light * 0.40 }); }
  else if (baseStyle === 'starfield') { drawStarfield(wr, bands, feat, d, opts); drawStarShower(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.52, hue: opts.hue + 0.18, light: opts.light * 0.72 }); drawCenterRadiance(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.18, hue: opts.hue + 0.12, light: opts.light * 0.42 }); drawWaveInterferenceField(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.18, hue: opts.hue + 0.24, light: opts.light * 0.34 }); }
  else if (baseStyle === 'lattice' || baseStyle === 'moire') {
    drawMoireGrid(wr, bands, feat, d, { ...opts, amount: opts.amount * 1.02, light: opts.light * 0.92 }, false);
    drawWaveInterferenceField(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.26, hue: opts.hue + 0.12, light: opts.light * 0.56 });
  }
  else if (baseStyle === 'cellular') {
    drawCellularBackdrop(wr, bands, feat, d, { ...opts, amount: opts.amount * 1.04, light: opts.light * 0.90 });
    drawWaveInterferenceField(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.08, hue: opts.hue + 0.10, light: opts.light * 0.18 });
  }
  else if (baseStyle === 'cellfield') {
    drawCellFieldAltBackdrop(wr, bands, feat, d, { ...opts, amount: opts.amount * 1.04, hue: opts.hue + 0.06, light: opts.light * 0.90 });
    drawWaveInterferenceField(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.10, hue: opts.hue + 0.14, light: opts.light * 0.24 });
  }
  else if (baseStyle === 'entropy') {
    drawEntropyCalculatorBackdrop(wr, bands, feat, d, { ...opts, amount: opts.amount * 1.04, light: opts.light * 0.90 });
    drawFilledWaveSheet(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.14, hue: opts.hue + 0.12, light: opts.light * 0.22 });
  }
  else if (baseStyle === 'honeycomb') {
    drawHoneycombField(wr, bands, feat, d, { ...opts, amount: opts.amount * 1.06, hue: opts.hue + 0.10, light: opts.light * 0.92 });
    drawWaveInterferenceField(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.06, hue: opts.hue + 0.08, light: opts.light * 0.18 });
  }
  else drawClassicMixtape(wr, bands, feat, d, opts);
}

function backdropCompositionEnvelope(style, styleBlend, t) {
  const s = String(style || 'classic');
  const age = Math.max(0, Number(t) - (Number(WORKER_STATE.backdropStyleBlendStart) || Number(t) || 0));
  const k = clamp(Number(styleBlend), 0, 1);
  const intro = smoothstep(1.2, 5.8, age) * smoothstep(0.18, 0.92, k);
  const mid = smoothstep(4.0, 9.5, age);
  const late = smoothstep(8.0, 15.0, age);
  const structured = /matrixrain|matrixcrawl|cellular|cellfield|honeycomb|moire|lattice|spectrum/.test(s);
  return {
    base: clamp(1.16 - intro * 0.12, 1.02, 1.18),
    fill: clamp((structured ? 0.24 : 0.34) + intro * (structured ? 0.54 : 0.64), 0.16, 1.0),
    lateFill: clamp((structured ? 0.08 : 0.18) + late * (structured ? 0.62 : 0.70), 0.04, 1.0),
    accent: clamp(0.18 + mid * 0.82, 0.12, 1.0),
    generic: clamp((structured ? 0.04 : 0.18) + late * (structured ? 0.30 : 0.70), 0.0, structured ? 0.42 : 0.92),
    age
  };
}

function updateBackdropStyleBlend(requestedStyle, t) {
  const requested = String(requestedStyle || 'classic');
  if (!WORKER_STATE.activeBackdropStyle) {
    WORKER_STATE.activeBackdropStyle = requested;
    WORKER_STATE.previousBackdropStyle = '';
    WORKER_STATE.backdropStyleBlendStart = t;
    return { style: requested, previousStyle: '', blend: 1 };
  }
  if (requested !== WORKER_STATE.activeBackdropStyle) {
    WORKER_STATE.previousBackdropStyle = WORKER_STATE.activeBackdropStyle;
    WORKER_STATE.activeBackdropStyle = requested;
    WORKER_STATE.backdropStyleBlendStart = t;
    WORKER_STATE.backdropStyleBlendDuration = 4.1 + hash01(t * 4.7 + requested.length) * 2.1;
  }
  const duration = Math.max(0.25, WORKER_STATE.backdropStyleBlendDuration || 1.35);
  const blend = smoothstep(0, 1, (t - (WORKER_STATE.backdropStyleBlendStart || 0)) / duration);
  if (blend >= 0.995) WORKER_STATE.previousBackdropStyle = '';
  return { style: WORKER_STATE.activeBackdropStyle || requested, previousStyle: WORKER_STATE.previousBackdropStyle || '', blend };
}

function render(msg) {
  const maxSegments = Math.max(128, Math.min(11000, msg.maxSegments | 0 || 9000));
  const bands = msg.bands instanceof Float32Array ? msg.bands : new Float32Array(msg.bands || []);
  const feat = msg.feat || {};
  const d = msg.drive || {};
  d.coherence = finite(d.coherence, 0.2);
  d.scaleDepth = finite(d.scaleDepth, 0.2);
  d.equilibrium = finite(d.equilibrium, 0.1);
  d.temperature = finite(d.temperature, 0.2);
  d.tempo = finite(d.tempo, 0.3);
  d.inversion = finite(d.inversion, 0.5);
  const opts = {
    amount: clamp(msg.amount, 0, 3.5) * clamp(msg.mix, 0.05, 2.5),
    t: finite(msg.t, 0),
    hue: (((finite(msg.hue, 0.55) % 1) + 1) % 1),
    sat: clamp(msg.sat, 0.1, 2.2),
    light: clamp(msg.light, 0.15, 0.98),
    aspect: clamp(msg.aspect || 1, 0.35, 3.5),
    backdropMotion: clamp(Number(msg.backdropMotion) || 0, 0, 1)
  };
  const wr = makeWriter(maxSegments, opts.hue, opts.sat, opts.light);
  const peak = detectBeatPeak(clamp(feat.beat || 0, 0, 1), opts.t);
  const rawStyle = String(msg.backdropStyle || msg.style || 'rainbow');
  const requestedStyle = (rawStyle === 'auto' || rawStyle === 'match') ? String(msg.style || 'rainbow') : rawStyle;
  const styleBlend = updateBackdropStyleBlend(requestedStyle, opts.t);
  const style = styleBlend.style;
  const previousStyle = styleBlend.previousStyle;
  const styleK = clamp(styleBlend.blend, 0, 1);
  const envelope = backdropCompositionEnvelope(style, styleK, opts.t);
  const sensitiveStyle = isSoftIdentityStyle(style) || isRadialIdentityStyle(style) || isRibbonIdentityStyle(style);
  const sameFamily = sameBackdropStyleFamily(previousStyle, style);
  if (previousStyle && previousStyle !== style && styleK < 0.995) {
    drawByStyle(previousStyle, wr, bands, feat, d, {
      ...opts,
      amount: opts.amount * (1 - styleK) * (sensitiveStyle && !sameFamily ? 0.28 : 0.64),
      light: opts.light * (sensitiveStyle && !sameFamily ? 0.34 + (1 - styleK) * 0.12 : 0.44 + (1 - styleK) * 0.22),
      hue: opts.hue - 0.012
    });
  }
  drawByStyle(style, wr, bands, feat, d, {
    ...opts,
    amount: opts.amount * (0.46 + styleK * 0.62) * envelope.base,
    light: opts.light * (0.66 + styleK * 0.34)
  });
  const fillStyle = (style === 'classic' || style === 'itunes' || style === 'mix' || style === 'all')
    ? CLASSIC_SCENES[Math.abs((WORKER_STATE.sceneStyleIndex ?? 0) % CLASSIC_SCENES.length)]
    : style;
  const showcaseMix = styleShowcaseMix(opts.t, 2.2, 5.6);
  const layerMix = clamp(0.35 + showcaseMix * 0.65, 0, 1);
  const lateMix = clamp((showcaseMix - 0.28) / 0.72, 0, 1);
  const lineOnlyTarget = isLineOnlyBackdropStyle(style);
  if (!lineOnlyTarget && previousStyle && previousStyle !== style && styleK < 0.92) {
    const previousAccentGain = sensitiveStyle && !sameFamily ? (0.05 + showcaseMix * 0.05) : (0.12 + showcaseMix * 0.13);
    drawFilledAccentsForStyle(previousStyle, wr, bands, feat, d, { ...opts, amount: opts.amount * (1 - styleK) * previousAccentGain, light: opts.light * (sensitiveStyle && !sameFamily ? 0.28 : 0.38), layerMix, lateMix });
  }
  if (!lineOnlyTarget) {
    drawFilledAccentsForStyle(fillStyle, wr, bands, feat, d, { ...opts, amount: opts.amount * (0.46 + showcaseMix * 0.24 + WORKER_STATE.pulse * 0.18), light: opts.light * 0.72, layerMix, lateMix });
  }

  const softScaleStyles = new Set(['cymatics', 'rings', 'vectorscope', 'starfield', 'matrixrain', 'matrixcrawl']);
  if (softScaleStyles.has(style) && WORKER_STATE.pulse > 0.08) {
    const pulseScale = 1 + WORKER_STATE.pulse * 0.006;
    transformWriter(wr, 0, pulseScale, 0, 0);
  }

  const backdropRotation = updateBackdropRotation(opts.t, fillStyle || style, clamp(opts.amount, 0.25, 2.0));
  if (Math.abs(backdropRotation) > 0.0008) {
    // Slow, eased, occasional whole-backdrop rotation. Scale down just enough to
    // keep corners from clipping when the field appears at a different angle.
    transformWriter(wr, backdropRotation, 0.985, 0, 0);
  }

  applyBackdropMotionFlow(wr, fillStyle || style, opts.t, clamp(opts.amount, 0.25, 2.0), opts.backdropMotion);
  if (wantsFrostedGlassPass(fillStyle || style)) {
    applyFrostedGlassPass(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.74, light: opts.light * 0.86 }, fillStyle || style);
  }

  if (peak && (style === 'moire' || style === 'lattice' || style === 'cellular' || style === 'spectrum')) {
    const accentAngle = 0;
    const before = wr.segments;
    drawByStyle(style === 'spectrum' ? 'vectorscope' : 'spectrum', wr, bands, feat, d, { ...opts, amount: opts.amount * 0.20, hue: opts.hue + 0.37, light: opts.light * 0.78 });
    const start = before * 4;
    const c = Math.cos(accentAngle);
    const s = Math.sin(accentAngle);
    for (let i = before; i < wr.segments; i++) {
      const j = i * 4;
      const ax = wr.positions[j + 0], ay = wr.positions[j + 1], bx = wr.positions[j + 2], by = wr.positions[j + 3];
      wr.positions[j + 0] = clamp((ax * c - ay * s) * 0.96, -3, 3);
      wr.positions[j + 1] = clamp((ax * s + ay * c) * 0.96, -3, 3);
      wr.positions[j + 2] = clamp((bx * c - by * s) * 0.96, -3, 3);
      wr.positions[j + 3] = clamp((bx * s + by * c) * 0.96, -3, 3);
    }
  }

  const usedPos = wr.positions.slice(0, wr.segments * 4);
  const usedCol = wr.colors.slice(0, wr.segments * 6);
  const usedFillPos = wr.fillPositions.slice(0, wr.triangles * 6);
  const usedFillCol = wr.fillColors.slice(0, wr.triangles * 9);
  gradeBackdropColors(fillStyle || style, usedPos, usedCol, usedFillPos, usedFillCol, opts.hue, opts.sat, opts.light, opts.amount);
  applyVibranceBoost(usedCol, usedFillCol, PASTEL_STYLE_DEFS[style] || PASTEL_STYLE_DEFS[fillStyle] ? 0.38 : 0.30, opts.hue);
  enforceOrientedBackdropGradients(fillStyle || style, usedPos, usedCol, usedFillPos, usedFillCol, opts.hue, opts.sat, opts.light);
  const feathered = shouldFeatherBackdropFill(fillStyle || style)
    ? featherBackdropFillEdges(usedFillPos, usedFillCol, wr.triangles)
    : { fillPositions: usedFillPos, fillColors: usedFillCol, triangles: wr.triangles };
  return { positions: usedPos, colors: usedCol, segments: wr.segments, fillPositions: feathered.fillPositions, fillColors: feathered.fillColors, triangles: feathered.triangles };
}

self.onmessage = (e) => {
  const msg = e && e.data;
  if (!msg || msg.type !== 'render') return;
  try {
    const out = render(msg);
    self.postMessage({ type: 'frame', id: msg.id, segments: out.segments, positions: out.positions, colors: out.colors, triangles: out.triangles, fillPositions: out.fillPositions, fillColors: out.fillColors }, [out.positions.buffer, out.colors.buffer, out.fillPositions.buffer, out.fillColors.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, message: err && err.message ? err.message : String(err) });
  }
};

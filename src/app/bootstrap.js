import { APP_TEXT } from '../core/text.js';
import { AudioManager } from '../audio/index.js';
import { OffscreenEngineClient, supportsOffscreenEngine } from '../render/offscreen-engine-client.js';
import { setupUI, buildUI, sliderSync, updateUIZoom } from '../ui/index.js';
import {
    tour, updateTransition,
    stopTour, startTour, captureWaypoint,
    travelTo, buildAtlasUI, saveWP
} from '../atlas/atlas.js';
import { SS_VERSION } from '../core/state.js';
import { validateWaypoint, hydrateState } from '../core/validation.js';
import { loadOrCreateProfile } from '../persistence/profile.js';
import '../persistence/share.js';
import { applyTheme, applyButtonShape } from '../ui/theme.js';
import { showBootSplash } from './boot-splash.js';
import { updateModulation } from '../systems/modulation.js';
import { updateFpsMonitor } from '../render/fps.js';
import { seedImportedPlaylist } from '../persistence/playlist.js';
import { initPerformanceDefaults } from '../render/performance.js';
import { initAudioReactivity } from '../audio/reactivity.js';
import { initUiHideButton } from '../ui/ui-hide-button.js';
import { installScaleSpaceErrorReporting } from '../core/error-reporting.js';

installScaleSpaceErrorReporting();

// ───────────────────────────────────────────────────────────────────────────
//   7. Bootstrap
// ───────────────────────────────────────────────────────────────────────────

window.buildAtlasUI = buildAtlasUI;
window.buildUI = buildUI;
window.captureWaypoint = captureWaypoint;
// Bug fix: saveWP was being called via window.saveWP from importShareString
// and the JSON-import path, but the window assignment was missing — so
// imported waypoints silently weren't persisting to localStorage. They'd
// appear in the current session but vanish on refresh. With this line the
// import paths' `if (window.saveWP) window.saveWP();` checks succeed and
// the localStorage write actually happens.
window.saveWP = saveWP;
window.startTour = startTour;
window.stopTour = stopTour;
window.travelTo = travelTo;
window.tour = tour;
window.APP_TEXT = APP_TEXT;
// Defensive global easing helper: some older/inline visual modules referenced
// smoothstep through window instead of their own module scope.
window.smoothstep = window.smoothstep || function(edge0, edge1, x) {
  const span = Number(edge1) - Number(edge0);
  if (!Number.isFinite(span) || Math.abs(span) < 1e-6) return Number(x) >= Number(edge1) ? 1 : 0;
  const t = Math.max(0, Math.min(1, (Number(x) - Number(edge0)) / span));
  return t * t * (3 - 2 * t);
};

// ───────────────────────────────────────────────────────────────────────────
//   8. Profile, Save File, Theme, Modulation
// ───────────────────────────────────────────────────────────────────────────

function init() {
  const BASELINE_FREE_ENERGY = 25000;
  const RANDOMIZER_BENCHMARK_FREE_ENERGY = 100000;
  // setUIVisibility — show/hide all UI via body.ui-ready toggle. Per-element
  // .hidden classes (panel open/closed state) remain untouched.
  // Locked radials persist through Tab; unlocked ones close.
  window.setUIVisibility = function(visible, opts = {}) {
    window.uiVisible = !!visible;
    document.body.classList.toggle('ui-ready', window.uiVisible);
    if (!window.uiVisible) {
      const closeIfUnlocked = (r) => {
        if (!r || r.isLocked) return;
        if (r.close) r.close(true);
      };
      closeIfUnlocked(window.sysRadial);
      closeIfUnlocked(window.envRadial);
      closeIfUnlocked(window.cfgRadial);
    }
  };

  // Clear old state if version mismatch
  const savedVersion = localStorage.getItem('ss_version');
  let isFirstLoad = false;
  if (savedVersion !== SS_VERSION) {
    localStorage.removeItem('ss_state');
    localStorage.setItem('ss_version', SS_VERSION);
    isFirstLoad = true;
  }

  // ─── Load saved states ───────────────────────────────────────────────────
  try {
    const saved = localStorage.getItem('ss_state');
    if (saved) {
        const parsed = JSON.parse(saved);
        // Allowlist hydration — drops unknown keys, type-coerces values,
        // and strips _xfade/_xfadeEnv internally. This is the same path
        // imported save files take, so the threat model is unified.
        hydrateState(parsed);
    } else {
        isFirstLoad = true;
    }
  } catch (e) { isFirstLoad = true; }
  // Note: hydrateState already strips _xfade and _xfadeEnv. The two deletes
  // below are kept as belt-and-suspenders for the (impossible at this point)
  // case where hydrateState wasn't reached and stale alphas are in window.S.
  delete window.S._xfade;
  delete window.S._xfadeEnv;
  // Migrate legacy `saveScreenshots` (single toggle) → two granular keys.
  // Users who had it on get both new flags on (closest to prior behavior).
  if (typeof window.S.saveScreenshots === 'boolean') {
    if (window.S.saveScreenshots) {
      window.S.saveOnNewWaypoint = true;
      window.S.saveOnNewThumbnail = true;
    }
    delete window.S.saveScreenshots;
  }
  // Always start with audio off (browser policy). Do not clear
  // randomizerContinuous here: it is a user setting, and the audio panel
  // resumes the continuous randomizer after the UI is mounted.
  if ((window.S.audioSource === 'file' || window.S.audioSource === 'url') && window.S.audioMuted) {
    // Older builds used global mute to silence system capture; that persisted and made normal audio sources silent.
    window.S.audioMuted = false;
  }
  window.S.audioOn = false;
  window.S.audioReactive = false;
  window.S.visualEffects = false;
  if (!window.S.visualEffectStyle || (window.S.visualEffectStyle === 'sinefield' && window.S.visualEffectRandomize !== false)) {
    window.S.visualEffectStyle = 'random';
  }
  // Lift stale low-res optimization values from the previous performance pass.
  // Users can still lower these again, but the restored baseline should favor
  // fine structure over coarse reprojection.
  const liftFloor = (key, floor, fallback = floor) => {
    const n = Number(window.S[key]);
    window.S[key] = Number.isFinite(n) ? Math.max(floor, n) : fallback;
  };
  liftFloor('visualEffectQuality', 0.62, 0.66);
  liftFloor('visualEffectMaxFrameMs', 3.4, 3.6);
  liftFloor('zoomPixelRatioScaleMin', 0.82, 0.86);
  liftFloor('zoomEffectScaleMin', 0.62, 0.68);
  liftFloor('zoomOverdrawActiveScaleMin', 0.26, 0.30);
  liftFloor('zoomOverdrawPixelRatioScaleMin', 0.72, 0.76);
  liftFloor('zoomOverdrawEffectScaleMin', 0.50, 0.55);
  liftFloor('zoomOverdrawLineScaleMin', 0.10, 0.14);
  liftFloor('zoomTrailMidBandStrength', 0.68, 0.82);
  liftFloor('zoomTrailParticleChunk', 512, 2048);
  if (!Number.isFinite(Number(window.S.randomizerFixedFreeEnergy)) || Number(window.S.randomizerFixedFreeEnergy) < 1000) {
    window.S.randomizerFixedFreeEnergy = RANDOMIZER_BENCHMARK_FREE_ENERGY;
  }
  if (!['true-random', 'atlas-codes', 'both'].includes(window.S.randomizerSourceMode)) {
    window.S.randomizerSourceMode = 'both';
  }
  // Restore tour mode if saved (sequential is the default)
  if (window.S.tourMode === 'random' || window.S.tourMode === 'sequential') {
    tour.mode = window.S.tourMode;
  }

  // ─── Initialize Waypoints ────────────────────────────────────────────────
  try {
    const savedWp = localStorage.getItem('ss_waypoints') || localStorage.getItem('ss6_standalone_wp');
    const hadSave = !!savedWp;   // first run = no save file at all -> playlist seeds the start location
    if (savedWp) {
      const parsed = JSON.parse(savedWp);
      const raw = (parsed && parsed.waypoints) || parsed || [];
      // Validate each waypoint individually. Drops items with malformed
      // shape (validateWaypoint returns null), neutralizes <script>-laden
      // names from any prior tampered import.
      window.waypoints = Array.isArray(raw)
        ? raw.map(validateWaypoint).filter(Boolean)
        : [];
    } else {
      window.waypoints = [];
    }
    // Merge any build-time shipped destinations into the Imported tab.
    try { seedImportedPlaylist(hadSave); } catch (e) { console.warn('playlist seed skipped', e); }
  } catch (e) {
    window.waypoints = [];
  }

  // Visual safety guard. Saved/imported testing states can legally hide
  // every draw layer or zero opacity; that is valid as a setting, but terrible
  // as a boot state because it looks exactly like a renderer failure. Keep at
  // least the particle layer visible on launch. Manual controls can still turn
  // things back down after boot.
  if (window.S.showParticles === false && !window.S.showRibbons && !window.S.tessRibbons) {
      window.S.showParticles = true;
  }
  if (!Number.isFinite(Number(window.S.opacity)) || Number(window.S.opacity) <= 0.001) {
      window.S.opacity = 0.15;
  }
  if (!Number.isFinite(Number(window.S.resolution)) || Number(window.S.resolution) <= 0.001) {
      window.S.resolution = 0.1;
  }
  if (!Number.isFinite(Number(window.S.freeEnergy)) || Number(window.S.freeEnergy) < 1000) {
      window.S.freeEnergy = BASELINE_FREE_ENERGY;
  }
  if (!Number.isFinite(Number(window.S.gpuParticleCapacity)) || Number(window.S.gpuParticleCapacity) < Number(window.S.freeEnergy)) {
      window.S.gpuParticleCapacity = Math.max(150000, Math.ceil(Number(window.S.freeEnergy) + 8192));
  }
  // Stabilization baseline: particles are the primary renderer. Preserve
  // saved trail visibility exactly so turning Strings/Lattice off stays off
  // after reloads.
  window.S.showParticles = true;
  window.S.visualEffectGeometry = false;
  window.S.visualEffectNoTrailStyles = false;
  window.S.compatSuppressTrails = true;
  window.S.compatTrailAlphaScale = 0.0;
  window.S.compatLatticeAlphaScale = 0.0;
  // Baseline is particles + backdrop/post FX. The old geometry opt-in flag is
  // cleared for stale localStorage; active visual styles now decide which
  // native/compat geometry channels they use.
  window.S.compatStructureLayers = false;
  window.S.compatRibbonLayer = false;
  window.S.compatCurveLayer = false;
  window.S.compatCellularLayer = false;
  window.S.compatAllowManualStructure = false;

  // Baseline renderer stays native. Point draw is explicit only; no FPS-triggered
  // fallback is allowed to swap circle/square/diamond out from under the user.
  delete window.S.perfAutoPointsFallback;
  delete window.S.perfPointsFallbackFps;
  delete window.S.perfPointsFallbackRecoverFps;
  delete window.S.compatSkipGpuCompute;
  window.S.compatParticleFallback = false;
  if (window.S.shape === 'point') window.S.perfParticleDrawMode = 'points';
  else window.S.perfParticleDrawMode = 'native';
  window.S.compatParticleSize = Math.max(0.62, Number(window.S.compatParticleSize) || 0.66);
  window.S.compatParticleOpacity = Math.max(0.22, Number(window.S.compatParticleOpacity) || 0.24);
  window.S.compatParticleCpuMotion = true;
  window.S.compatParticleColorPulse = true;
  window.S.compatParticleMaxCpuActive = Math.min(70000, Math.max(20000, Number(window.S.compatParticleMaxCpuActive) || 65000));
  window.S.compatParticleSimMax = Math.min(70000, Math.max(20000, Number(window.S.compatParticleSimMax) || 65000));
  window.S.compatMotionFloor = Math.max(0.012, Number(window.S.compatMotionFloor) || 0.020);
  window.S.compatMotionWake = true;
  window.S.compatRibbonBudget = Math.min(260, Math.max(48, Number(window.S.compatRibbonBudget) || 220));
  window.S.compatCurveBudget = Math.min(120, Math.max(24, Number(window.S.compatCurveBudget) || 80));
  window.S.compatCellBudget = Math.min(120, Math.max(24, Number(window.S.compatCellBudget) || 80));
  window.S.compatStructureEvery = Math.max(6, Number(window.S.compatStructureEvery) || 8);
  window.S.compatStructureOpacity = Math.min(0.16, Math.max(0.04, Number(window.S.compatStructureOpacity) || 0.045));
  window.S.nativeTrails = false;
  window.S.showNativeTrails = false;

  try { localStorage.setItem('ss_state', JSON.stringify(window.S)); } catch (e) {}

  // Build assumes self-containment; parameters natively driven by window.S
  initPerformanceDefaults();
  // Prefer the OffscreenCanvas renderer path when the browser supports it.
  // Add ?mainRender=1 or ?renderer=main to force the legacy main-thread path.
  window.S.preferWorkerRenderer = true;

  // Initialize AudioManager
  const audio = new AudioManager();
  window.audio = audio;
  initAudioReactivity();

  // Initialize Profile (server-clock-based ID, persisted across sessions)
  window.profile = loadOrCreateProfile();

  // Apply theme + button shape from saved state BEFORE setupUI so the UI
  // is built against the correct CSS variables / data attributes.
  applyTheme();
  applyButtonShape();

  // UI is invisible by default (CSS gates opacity on body.ui-ready).
  // Splash dismiss adds ui-ready to fade everything in. Tab toggles same
  // class. window.uiVisible tracks the gate state for keyboard logic.
  window.uiVisible = false;

  // Boot splash — fades in, holds, fades out. Visible during engine init.
  // Returns a startTyping callback we invoke AFTER engine init, so the
  // heavy synchronous block (setupUI, new Engine) doesn't stutter the
  // type-in animation. Typer's setTimeouts queue up but can't fire while
  // the main thread is busy, producing the line-batching effect.
  const startSplashTyping = showBootSplash();

  // Initialize UI
  setupUI();
  
  // Apply initial zoom
  updateUIZoom();
  initUiHideButton();

  // ─── Initialize WebGPU Engine ────────────────────────────────────────────
  const cv = document.getElementById('cv');
  const bgGlow = document.getElementById('bgGlow');
  if (cv && cv.style) {
    cv.style.position = 'fixed';
    cv.style.inset = '0';
    cv.style.width = '100vw';
    cv.style.height = '100vh';
    cv.style.display = 'block';
  }
  function getViewportCanvasSize() {
    const vw = Math.max(1, Math.floor(window.innerWidth || document.documentElement?.clientWidth || 1));
    const vh = Math.max(1, Math.floor(window.innerHeight || document.documentElement?.clientHeight || 1));
    const cw = Math.max(0, Math.floor(cv?.clientWidth || 0));
    const ch = Math.max(0, Math.floor(cv?.clientHeight || 0));
    return {
      width: cw > 0 && cw <= vw * 1.1 ? cw : vw,
      height: ch > 0 && ch <= vh * 1.1 ? ch : vh,
    };
  }
  let engine;
  if (!supportsOffscreenEngine()) {
    console.error('FATAL ERROR: OffscreenCanvas renderer is required in this build.');
    return;
  }
  window.SS_OFFSCREEN_RENDERER = true;
  window.S.preferWorkerRenderer = true;
  try {
    engine = new OffscreenEngineClient(cv, bgGlow);
    window.engine = engine;
    window.debugScaleSpaceVisibility = () => engine.getVisibilityDebug ? engine.getVisibilityDebug() : null;
    window.forceParticleVisibility = () => {
        if (engine.forceParticleVisibility) engine.forceParticleVisibility();
        if (engine.ensureParticleVisibilityBootstrap) {
            engine.ensureParticleVisibilityBootstrap().catch(err => console.warn('[particles] manual visibility reseed failed:', err));
        }
        return window.debugScaleSpaceVisibility ? window.debugScaleSpaceVisibility() : null;
    };
    engine.setupControls(cv);

    { const { width, height } = getViewportCanvasSize(); engine.resize(width, height); }
    window.addEventListener('resize', () => {
      const { width, height } = getViewportCanvasSize();
      engine.resize(width, height);
    });
  } catch(e) {
    console.error("FATAL ERROR IN ENGINE CONSTRUCTOR:", e);
    return;
  }




  // Splash typing now starts on first frame inside startEngine() — see
  // _firstFrameDrawn block below. This guarantees the canvas is showing
  // live content before the type-in begins, hiding any init jerk behind
  // the static "loading…" curtain.

  // Key handlers for global actions (Ctrl+S for waypoints)
  let lastTempo = null;

  // Freeze/unfreeze the simulation in place (the "paused view"): tempo→0 stops
  // the physics step while the last frame stays on screen. Exposed so the
  // Bioclast audio transport can pause the SYSTEM (not just the audio) — when
  // a look is built from audio-driven params, merely pausing audio would
  // restore params to base and collapse the scene; freezing holds the image.
  // Idempotent; tracks state with an explicit flag rather than tempo===0 so it
  // stays correct even when cymatics is driving tempo from a parked-0 base.
  window._simFrozen = false;
  window.setSimFrozen = function (frozen) {
      frozen = !!frozen;
      if (frozen === window._simFrozen) return;
      window._simFrozen = frozen;
      if (frozen) {
          lastTempo = window.S.tempo;
          window.S.tempo = 0;
      } else {
          window.S.tempo = (lastTempo !== null && lastTempo > 0) ? lastTempo
                          : (window.S.tempo > 0 ? window.S.tempo : 0.02);
          lastTempo = null;
      }
      if (window.sliderSync && window.sliderSync.tempo) window.sliderSync.tempo(window.S.tempo);
      if (window.engine) window.engine.updateUniforms();
  };
  
  const kMap = {
      'KeyQ': { k: 'freeEnergy', d: -2000, min: 500, max: 1000000, label: 'Free Energy' },
      'KeyE': { k: 'freeEnergy', d: 2000, min: 500, max: 1000000, label: 'Free Energy' },
      'KeyZ': { k: 'resolution', d: -0.05, min: 0.02, max: 20, label: 'Resolution' },
      'KeyX': { k: 'resolution', d: 0.05, min: 0.02, max: 20, label: 'Resolution' },
      'KeyR': { k: 'equilibrium', d: -0.005, min: 0.001, max: 0.2, label: 'Equilibrium' },
      'KeyT': { k: 'equilibrium', d: 0.005, min: 0.001, max: 0.2, label: 'Equilibrium' },
      // Temperature: G = glacial (down), F = firey (up). Order in this
      // map matches the other ± pairs (minus first, plus second) so the
      // pattern is consistent across all parameter shortcuts.
      'KeyG': { k: 'temperature', d: -0.05, min: 0, max: 3, label: 'Temperature' },
      'KeyF': { k: 'temperature', d: 0.05, min: 0, max: 3, label: 'Temperature' },
      'KeyV': { k: 'coherence', d: -2, min: 0, max: 200, label: 'Coherence' },
      'KeyB': { k: 'coherence', d: 2, min: 0, max: 200, label: 'Coherence' },
      'KeyI': { k: 'inversion', d: -5, min: 30, max: 500, label: 'Inversion' },
      'KeyO': { k: 'inversion', d: 5, min: 30, max: 500, label: 'Inversion' },
      'KeyN': { k: 'scaleDepth', d: -0.05, min: 0, max: 5, label: 'Scale Depth' },
      'KeyM': { k: 'scaleDepth', d: 0.05, min: 0, max: 5, label: 'Scale Depth' },
      'KeyK': { k: 'halfLife', d: -0.5, min: 0, max: 30, label: 'Half-Life' },
      'KeyL': { k: 'halfLife', d: 0.5, min: 0, max: 30, label: 'Half-Life' },
  };

  window.addEventListener('keydown', e => {
      // Skip all kMap shortcuts when a text-input surface has focus —
      // includes the .val editable spans on every slider. Without this,
      // typing into a slider's value field would trigger waypoint capture
      // (Ctrl+S), tempo adjustments, etc.
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
          e.preventDefault();
          // Ctrl+S captures the current live state. Ctrl+Shift+S is an explicit
          // mid-transition capture path; it does not cancel the randomizer/atlas
          // transition, it just stores the currently visible parameter frame.
          if (e.shiftKey && window.showToast) window.showToast('Captured live transition frame', { color: '#88ffcc' });
          captureWaypoint();
      }
      
      if (e.code === 'KeyP') {
          e.preventDefault();
          window.S.audioOn = !window.S.audioOn;
          if (window.audio) window.audio.toggle(window.S);
          const toggles = document.querySelectorAll('.tog');
          toggles.forEach(t => {
              if (t.textContent.includes('Ambient Audio') || t.textContent.includes(window.APP_TEXT?.toggleAudio)) {
                  t.click(); 
                  window.S.audioOn = !window.S.audioOn; // prevent double toggle
              }
          });
      }

      // Tour speed: +/- (and numpad +/-) adjust a running tour's pace live.
      // Only acts while a tour is active so the keys are free otherwise.
      if ((e.code === 'Equal' || e.code === 'NumpadAdd' || e.code === 'Minus' || e.code === 'NumpadSubtract')
          && window.tour && window.tour.active) {
          e.preventDefault();
          const up = (e.code === 'Equal' || e.code === 'NumpadAdd');
          const cur = (typeof window.tour.speed === 'number') ? window.tour.speed : 1;
          // Geometric steps feel even across the range; clamp to a sane band.
          const next = Math.max(0.25, Math.min(4, +(cur * (up ? 1.25 : 0.8)).toFixed(3)));
          window.tour.speed = next;
          if (window.showParamToast) window.showParamToast('Tour Speed', next.toFixed(2) + '×');
      }

      if (e.code === 'Pause') {
          e.preventDefault();
          // If a tour is running, the Pause key stops it. Users expect a
          // pause control to halt motion regardless of source.
          if (window.tour && window.tour.active && window.stopTour) {
              window.stopTour();
          }
          const willFreeze = !window._simFrozen;
          window.setSimFrozen(willFreeze);
          // Layer seam: tell layers the sim was frozen/unfrozen so coupled
          // media (e.g. Bioclast audio) can pause/resume in lockstep.
          if (window._systemPauseHooks) for (const h of window._systemPauseHooks) { try { h(willFreeze); } catch (e) {} }
      }
      
      if (kMap[e.code]) {
          e.preventDefault();
          const p = kMap[e.code];
          // Uncapped on the high side (matches .val scrub/type). Floor
          // (p.min) preserved — degenerate sim states below zero.
          // freeEnergy keeps its ceiling (sizes a GPU buffer).
          const raw = window.S[p.k] + p.d;
          const lo = p.min;
          const hi = (p.k === 'freeEnergy') ? p.max : Infinity;
          window.S[p.k] = Math.max(lo, Math.min(hi, raw));
          if (window.sliderSync && window.sliderSync[p.k]) {
              window.sliderSync[p.k](window.S[p.k]);
          }
          if (p.k === 'freeEnergy' && window.engine) {
              window.engine.resizeParticles(Math.round(window.S[p.k]));
          }
          if (window.engine) window.engine.updateUniforms();
          // Confirmation toast so the user sees the shortcut took effect.
          // Uses the slider's own formatter when available so the displayed
          // value matches what the panel shows; falls back to a tidy number.
          if (window.showParamToast) {
              const val = window.S[p.k];
              let disp;
              const fmt = window.sliderFormat && window.sliderFormat[p.k];
              if (fmt) disp = fmt(val);
              else disp = (Math.abs(val) >= 100 || Number.isInteger(val)) ? Math.round(val).toString() : val.toFixed(2);
              window.showParamToast(p.label || p.k, disp);
          }
          try { localStorage.setItem('ss_state', JSON.stringify(window.S)); } catch (err) {}
      }
  });

  // ─── Offscreen renderer state pump ───────────────────────────────────────
  async function startEngine() {
    let rendererReady = false;
    try {
      await engine.renderer.init();
      if (engine.reinitializeParticles) {
        await engine.reinitializeParticles({ preferGpu: true });
      }
      if (window.S.compatParticleFallback && engine.ensureParticleVisibilityBootstrap) await engine.ensureParticleVisibilityBootstrap();
      rendererReady = true;
    } catch(e) {
      console.error("Renderer Init Error:", e);
      rendererReady = false;
    }
    if (!rendererReady) return;

    let firstReady = false;
    let pumpBusy = false;
    const pumpState = () => {
      if (pumpBusy) return;
      pumpBusy = true;
      try {
        try { updateTransition(); } catch(e) { console.error("Transition Error:", e); }
        try { updateModulation(); } catch(e) { console.error("Modulation Error:", e); }
        if (window._postModulationHooks) {
          for (const fn of window._postModulationHooks) {
            try { fn(); } catch(e) { console.error("PostModulation Hook Error:", e); }
          }
        }
        if (window.engine && typeof window.engine.updateUniforms === 'function') window.engine.updateUniforms();
        try { updateFpsMonitor(); } catch(e) {}
        if (!firstReady) {
          firstReady = true;
          document.body.classList.add('engine-ready');
          if (startSplashTyping) startSplashTyping();
          if (window._startWaypoint) {
            const _sw = window._startWaypoint; window._startWaypoint = null;
            try { travelTo(_sw); } catch (e) {}
          }
        }
      } finally {
        pumpBusy = false;
      }
    };

    pumpState();
    window._ssStatePump = window.setInterval(pumpState, 33);
  }

  startEngine();
}

init();

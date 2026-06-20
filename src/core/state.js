import { PARAM_KEYS } from '../atlas/constants.js';

export const SS_VERSION = '0.5';
window.SS_VERSION = SS_VERSION;

// ─── Global State ──────────────────────────────────────────────────────────
window.S = {

    // ─── Simulation ────────────────────────────────────────────────────────
    // Default-launch coordinate — handpicked location that gives new users
    // an immediately interesting visual on first run. Captured via the
    // share-string system from a known good location and committed here.
    // Mass = 0.1 + viscosity = 0 + halfLife = 13.9 + tempo 2.7 produces
    // a fast, fluid system with strong coherence dynamics that read as
    // "alive" rather than "settling."
    freeEnergy: 25000,
    resolution: 0.100,
    inversion: 30,
    halfLife: 13.9,
    scaleDepth: 0.0,
    physicsEmergence: 0.0,
    stabilityDamping: true,
    coherence: 1.0,
    equilibrium: 0.001,
    temperature: 0.0,
    viscosity: 0.0,
    mass: 0.1,

    // Optics
    tempo: 2.7,
    // Global clock (Timescale). Default 1 = real-time. Implemented as physics
    // sub-stepping (N steps/frame), so old saves that lack this key get 1 and
    // behave exactly as before. Integer 1–8.
    timeScale: 1,
    showParticles: true,
    showRibbons: true,
    tessRibbons: false,
    shape: "circle", // circle | square | diamond | point
    colorMode: 2,
    hue: 0.59,
    sat: 0.99,
    lightness: 0.9,
    opacity: 0.15,
    trailLen: 27,
    bgGlow: 0.15,
    bgBlur: 40,
    visualEffects: false,
    visualEffectStyle: 'random', // random | adaptive | spectral | kaleido | constellation | cymatics | sinefield | oscilloscope | matrixrain | spectrum | vectorscope | tunnel | aurora | lattice | cellular | cellfield | honeycomb | moire | hyperspace | starfield | trails | entropy | ribbons
    visualEffectAmount: 1.05,
    visualEffectQuality: 0.66,
    visualEffectEcho: 0.12,
    visualEffectAberration: 0.34,
    visualEffectRings: 0.95,
    visualEffectExpressivity: 1.6,
    visualEffectDynamics: 1.35,
    visualEffectBackdrop: true,          // master 2D backdrop layer power, default on
    visualEffect2DBackdrop: true,          // camera-locked old-school / iTunes-style WebGPU line backdrop, default on
    visualEffect2DBackdropStyle: 'classic', // registered in render/audio-fx-registry.js and drawn in visual-effects.worker.js
    visualEffect2DBackdropMix: 1.0,
    visualEffect2DBackdropMotion: 0.0,     // 0..1 camera-locked backdrop drift/shake amount
    backdropAnimationMode: 'auto',         // auto | smooth | held12
    backdropAnimationThrottle: false,      // legacy mirror; mode is authoritative
    backdropAnimationFps: 12,              // legacy mirror / held backdrop FPS
    visualEffect2DResolutionScale: 0.66,   // 0.25..1 geometry budget for the animated 2D backdrop
    visualEffect2DFade: 0.01,             // opacity multiplier for audio 2D backdrop FX
    visualEffect3DFade: 0.5,              // opacity multiplier for audio 3D FX / surfaces
    visualEffectPost: true,              // 3D music FX overlay, default on and independently toggleable
    visualEffectCenterSwim: false,
    visualEffectRandomize: true,
    visualEffectMorphRate: 0.018,
    visualEffectMaxFrameMs: 3.6,
    visualEffectGeometry: false,        // deprecated; geometry is now selected by each visual style plugin
    visualEffectNoTrailStyles: false,    // random/adaptive include trail-like visualizer styles; does not toggle particle trails

    // Zoom-aware render budget. When the camera is close, most of the scene is
    // offscreen or overdrawn into the same pixels, so the renderer can show a
    // smaller active subset and run cheaper backdrop passes without changing
    // the saved coordinate.
    zoomRenderOptimize: true,
    adaptiveCulling: true,              // simple master for adaptive count/overdraw/trail safety trims
    zoomNearDistance: 18,
    zoomFarDistance: 75,
    zoomActiveScaleMin: 0.33,
    zoomPixelRatioScaleMin: 0.86,
    zoomEffectScaleMin: 0.68,
    zoomCompatSyncMaxEvery: 2,
    zoomOverdrawOptimize: true,
    zoomOverdrawActiveScaleMin: 0.30,
    zoomOverdrawPixelRatioScaleMin: 0.76,
    zoomOverdrawEffectScaleMin: 0.55,
    zoomOverdrawLineScaleMin: 0.14,
    overdrawParticleScaleMin: 0.48,
    overdrawOpacityScaleMin: 0.62,
    zoomTrailBudgetOptimize: true,
    zoomTrailMidBandStrength: 0.82,
    trailAnimationMode: 'auto',            // auto | smooth | held12 | held4
    trailAnimationThrottle: false,         // legacy mirror; mode is authoritative
    trailAnimationFps: 12,                 // legacy mirror / held trail FPS
    zoomDisplayParticleChunk: 4096,
    zoomTrailParticleChunk: 2048,
    particleCloseScale: true,
    particleCloseScaleStrength: 0.72,
    particleCloseScaleNear: 20,

    // ─── Navigation ────────────────────────────────────────────────────────
    moveMode: "orbit",
    cameraAutoOrbit: false,
    cameraAutoOrbitSpeed: 0.22,

    // ─── UI ────────────────────────────────────────────────────────────────
    uiZoom: 1.0,
    panelOpacity: 0.45,
    buttonOpacity: 1.0,
    uiVisible: true,
    theme: 'synthesist',     // 'classic' | 'synthesist'  (default: synthesist for the new build identity)
    uiScanlines: 0.06,       // 0..0.5 opacity of CRT scanlines over panels
    screenScanlines: 0.06,   // 0..0.5 opacity of CRT scanlines over the simulation canvas
    showFpsCounter: false,   // optional small FPS / entropy HUD in the System menu
    buttonShape: 'hex',      // 'hex' | 'circle'  (radial menu button shape)
    referenceGrid: 0,        // 0..0.25 opacity of background sky grid
    // Screenshot save triggers, split per gesture so users can opt into one
    // or both flows. Old saveScreenshots key is migrated at load time.
    // Defaulted ON because waypoint captures are how users build their
    // personal atlas — they should get a usable artifact by default
    // without having to opt in. Users who don't want the downloads can
    // turn these off in the System pane.
    saveOnNewWaypoint: true,
    saveOnNewThumbnail: true,
    includeScreenshotBg: true,        // background visible in screenshots
    includeScreenshotScanlines: true, // CRT scanlines baked into screenshots
    
    // ─── Audio ─────────────────────────────────────────────────────────────
    audioOn: false,
    volume: 0.5,
    audioSource: 'off',       // 'off' | 'file' | 'url' | 'mic' | 'system'
    audioUrl: '',
    audioLoop: true,
    audioMonitor: false,      // mic/system monitor, off by default to avoid feedback
    audioMuted: false,        // output mute only; analyser/reactivity still receives signal
    audioAutoEnableVisuals: true, // start audio with audio reactivity + visual FX unless disabled
    audioReactive: false,     // enabled automatically when audio starts
    audioReactiveAmount: 1.28,
    audioReactiveGain: 5.2,
    audioReactiveAttack: 0.062,
    audioReactiveRelease: 0.010,
    audioReactiveRelaxation: 0.72,
    audioColorBeat: 1.25,
    audioParticleDrive: 1.0,       // master strength for audio-driven particle params
    audioParticleMotionDrive: 1.0, // extra scale for physics/motion params
    audioParticleColorDrive: 1.0,  // extra scale for hue/saturation/lightness params
    audioDeviceId: '',
    audioFileName: '',        // label only, File objects are never persisted
    audioOscHz: 220,
    audioFxGain: 1,
    audioPilot_resolution: true,
    audioPilot_opacity: true,
    audioPilot_bgGlow: true,
    audioPilot_bgBlur: true,
    audioPilot_trailLen: true,
    audioPilot_coherence: true,
    audioPilot_scaleDepth: true,
    audioPilot_physicsEmergence: true,
    audioPilot_inversion: true,
    audioPilot_halfLife: true,
    audioPilot_temperature: true,
    audioPilot_equilibrium: true,
    audioPilot_viscosity: true,
    audioPilot_mass: true,
    audioPilot_tempo: true,
    audioPilot_hue: true,
    audioPilot_sat: true,
    audioPilot_lightness: true,
    audioPilot_showParticles: true,
    audioPilot_shape: true,
    audioPilot_showRibbons: true,
    audioPilot_tessRibbons: true,
    audioPilot_colorMode: true,
    randomizerPilot_resolution: true,
    randomizerPilot_opacity: true,
    randomizerPilot_bgGlow: true,
    randomizerPilot_bgBlur: true,
    randomizerPilot_trailLen: true,
    randomizerPilot_coherence: true,
    randomizerPilot_scaleDepth: true,
    randomizerPilot_physicsEmergence: true,
    randomizerPilot_inversion: true,
    randomizerPilot_halfLife: true,
    randomizerPilot_temperature: true,
    randomizerPilot_equilibrium: true,
    randomizerPilot_viscosity: true,
    randomizerPilot_mass: true,
    randomizerPilot_tempo: true,
    randomizerPilot_hue: true,
    randomizerPilot_sat: true,
    randomizerPilot_lightness: true,
    randomizerPilot_showParticles: true,
    randomizerPilot_shape: true,
    randomizerPilot_showRibbons: true,
    randomizerPilot_tessRibbons: true,
    randomizerPilot_colorMode: true,

    // Randomizer test bench
    randomizerPreset: '',
    randomizerTransitionSec: 6.0,
    randomizerSmoothContinuous: true,
    randomizerContinuous: false,
    randomizerSourceMode: 'both', // true-random | atlas-codes | both
    randomizerLockFreeEnergy: true,
    randomizerFixedFreeEnergy: 100000,
    randomizerChaos: 0.68,                // 0=tight coherent drift, 1=wide expressive jumps

    // Performance profile: balanced keeps the cooked look, speed/potato trade visual update cadence for FPS.
    perfProfile: 'balanced',
    canvasResolutionScale: 1.0, // 0.4..1 render-buffer scale cap for high-resolution displays
    perfParticleScaling: true,
    perfParticleScaleMin: 0.45,
    perfParticleCountChunk: 2048,
    perfParticleDrawMode: 'native', // native | points; points is explicit, never FPS-triggered
    // Native/WebGPU allocation cap. This is buffer capacity, not the live particle count.
    // Keep this close to the intended freeEnergy so random/preset changes do not churn massive GPU buffers.
    gpuParticleCapacity: 150000,
    gpuResetParticles: false,      // Three/TSL reset stays worker-backed during normal rerolls; post-init seed may use compute
    compatParticleFallback: false, // emergency CPU Points fallback only; normal point mode uses the live GPU particle buffers
    compatParticleSize: 0.60,
    compatParticleOpacity: 0.20,
    compatParticleSyncEveryFrames: 2,
    compatParticleCpuMotion: true,
    compatParticleColorPulse: true,
    compatMixedVisualModes: false,
    compatMixedVisualModesMusicOnly: true,
    compatParticleMaxCpuActive: 65000,
    compatParticleSimMax: 65000,
    compatMotionFloor: 0.020,
    compatMotionWake: true,
    compatFluidMotion: true,
    compatFlowMode: 'adaptive', // adaptive | plume | vortex | sheet | ribbon | cellular | helix | cymatic | burst
    compatSuppressTrails: true, // suppresses old hidden TSL ribbons only; compat structure layers remain visible
    compatTrailAlphaScale: 0.0,
    compatLatticeAlphaScale: 0.0,
    compatStructureLayers: false,
    compatRibbonLayer: false,
    compatCurveLayer: false,
    compatCellularLayer: false,
    compatAllowManualStructure: false,
    compatRibbonBudget: 220,
    compatCurveBudget: 80,
    compatCellBudget: 80,
    compatStructureEvery: 8,
    compatStructureOpacity: 0.045,
    compatStructureDepth: 5,
    preferWorkerRenderer: true,    // OffscreenCanvas renderer path; add ?mainRender=1 to force legacy main-thread rendering
    workerCompute: true,           // when worker renderer is enabled, run native compute in that worker
    nativeComputeBackend: 'three-tsl', // 'three-tsl' now, 'direct-webgpu'/'babylon' for port scaffolds
    nativeTrails: false,           // worker/native path: compute-written trail history buffer
    showNativeTrails: false,       // worker/native path: render the computed trail buffer
    nativeTrailDepth: 8,           // history samples per particle, 2..32
    nativeTrailOpacity: 0.075,
    nativeTrailThickness: 2.0,
    nativeRenderZoom: 100,

    // When false (default), typed values and drag-scrub are clamped to each
    // slider's declared min/max. When true, out-of-range values pass through
    // and the slider bar pins at 0/100% visually. Boundless mode is the
    // power-user behavior — bounded mode is what new users expect.
    boundless: false,
    
    // Base attributes manually mapped outside APP_CONFIG
    offsetX: 0,
    offsetY: 0,
    offsetZ: 0,
    billboardOffset: 0,
    lastWpCat: 'Waypoints',
    tourMode: 'sequential',   // 'sequential' | 'random'

    // Export-toggle state. Persists across sessions so users who always
    // export aesthetic-only (settings off, waypoints off, etc.) don't have
    // to re-tick the same boxes every time.
    exportIncludeSettings:   true,
    exportIncludeProfile:    true,
    exportIncludeWaypoints:  true,
    exportIncludeThumbnails: true,

    // Share-code-builder toggle state. Same pattern as export toggles —
    // persists per-user, respected by both the in-detail share builder
    // and the quick-share button on each waypoint card. Coordinate +
    // camera always travel together as "the location"; these four toggles
    // control the optional layers a user might or might not want to
    // include when sharing.
    shareIncludeTitle:    true,
    shareIncludeNotes:   true,
    shareIncludeAuthor:  true,
    shareIncludeOptics: true
};
window.DEFAULTS = { ...window.S };
window.PARAM_KEYS = PARAM_KEYS;

// Temporary globals for UI.js until fully modularized
window.uiVisible = true;
window.waypoints = [];
window.atlasView = 'list';
window.collapsedCats = {};

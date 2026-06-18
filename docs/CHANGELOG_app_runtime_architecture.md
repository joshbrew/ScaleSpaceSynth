# Scale Space Changelog: Original `app.js` → Modular Runtime Architecture

This changelog focuses on the meaningful technical changes from the original single-file `app.js` version of Scale Space to the current modular repo. It deliberately avoids the small visual-tuning notes and does not cover packaging/dev-tooling details. The goal is to describe what changed in the app runtime itself: rendering, performance, workers, audio, state, memory, and fault tolerance.

## 1. Starting Point: The Original Monolithic App

The original app was centered around one large browser module, `app.js`. It contained nearly everything in one place:

- UI labels and copy
- the disabled/stubbed `AudioManager`
- Atlas waypoint capture, restore, and tour behavior
- WebGPU renderer setup
- TSL compute kernels
- particle simulation
- radial UI
- DOM panels, sliders, toggles, and layout
- bootstrap defaults, key handlers, render loop, and `init()`
- user profile/save/theme/modulation logic

That version worked, but the architecture made every major feature share the same file and mostly the same runtime surface. Rendering, UI, persistence, audio, and simulation code were all tightly coupled.

The refactor split that responsibility into smaller modules and separate execution paths. The important change is not just folder organization. The app now has clearer boundaries between:

- main-thread UI/state work;
- WebGPU simulation/render work;
- worker-generated geometry;
- audio fetching/decoding/analysis;
- persistence and settings normalization;
- performance profiles and runtime caps.

## 2. High-Level Architecture Changes

### Before

The original `app.js` acted like a complete application container. The engine, UI, state defaults, audio stub, atlas, profile logic, and simulation kernels lived side by side. A lot of behavior depended on globals such as `window.S`, `window.engine`, `window.tour`, and UI functions attached directly to `window`.

### After

The repo was reorganized into a modular `src/` tree. The major runtime areas are now separated roughly like this:

| Area | Current responsibility |
| --- | --- |
| `core/` | state defaults, validation, runtime capability checks, performance mode settings |
| `render/` | WebGPU engine, particle rendering, ribbons/lattice rendering, 2D backdrop rendering |
| `audio/` | source selection, file/URL playback, system/mic capture, audio worklet/level analysis |
| `ui/` | menus, controls, slider/readout binding, audio source UI, performance/config UI |
| `randomizer/` | random preset/profile logic that respects enabled/disabled feature groups |
| `persistence/` | saved settings, migrations, localStorage/import/export handling |
| `workers/` / worker files | particle initialization, audio fetch/level work, 2D effect geometry generation |

The app still exposes some global handles for compatibility and UI wiring, but the implementation is no longer one giant script.

## 3. Performance Profiles and Runtime Budgeting

A major change was adding real performance profiles rather than relying only on individual sliders. The current app has system-level `Perf Mode` settings that affect canvas resolution, particle budgets, worker detail, and geometry limits together.

| Mode | Canvas scale | 2D backdrop scale | Default particles | GPU particle capacity | Adaptive floor | Use case |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `quality` | `1.00` | `0.85` | `140,000` | `220,000` | `0.70` | Best visuals when the GPU can handle it |
| `balanced` | `0.80` | `0.60` | `80,000` | `150,000` | `0.45` | Default middle ground |
| `speed` | `0.62` | `0.42` | `45,000` | `110,000` | `0.32` | Lower fill-rate / better responsiveness |
| `potato` | `0.48` | `0.28` | `22,000` | `75,000` | `0.25` | Minimal mode for weak GPUs or heavy scenes |

The important part is that these profiles now influence multiple systems at once:

- canvas resolution scale;
- maximum effective device pixel ratio;
- default particle count;
- GPU particle capacity;
- adaptive particle floor;
- 2D backdrop detail scale;
- worker geometry budgets;
- ribbon/lattice budget ceilings;
- runtime caps used when the scene gets expensive.

This makes performance predictable. Instead of only lowering one visible slider, the app can reduce the total cost of rendering and simulation in a coordinated way.

## 4. Canvas Resolution and Fill-Rate Control

The original app used WebGPU and could render large particle scenes, but high-DPI displays and translucent layers can easily become fill-rate limited. The modular version treats canvas resolution as a performance budget.

The canvas resolution is now derived from:

- browser/device pixel ratio;
- selected performance mode;
- user-level canvas scale;
- active particle count;
- backdrop/detail settings;
- current overdraw pressure.

This avoids the bad case where the app tries to render full-DPI particles, additive ribbons, blurred 2D backdrops, and UI overlays all at once on a high-DPI canvas. The app can retain the same scene but reduce render resolution before it starts dropping frames or stalling.

## 5. Particle Capacity vs. Active Particle Count

The refactor separates **GPU capacity** from **active particle count**.

### Old model

The old app treated particle count more directly as the system size. Changing count or resetting particles could require heavy CPU-side work and buffer updates.

### New model

The current system distinguishes:

- **GPU particle capacity** — how large the backing buffers are allowed to be;
- **active particle count** — how many particles are currently simulated/rendered;
- **profile maximum** — the performance-mode cap;
- **adaptive floor** — how far the runtime can reduce active work under load.

This matters because reallocating GPU buffers is expensive. Keeping a capacity and changing the active count is cheaper than rebuilding storage every time the user changes density or the runtime adapts.

## 6. Ribbon and Lattice Budgeting

Ribbons/lattice are now budgeted separately from the main particle cloud. This is important because line/ribbon geometry can become expensive even when particle count looks reasonable.

The current profiles cap the structural/ribbon workload independently:

| Mode | Approx. ribbon/lattice cap |
| --- | ---: |
| `quality` | `90k` |
| `balanced` | `65k` |
| `speed` | `42k` |
| `potato` | `25k` |

This prevents a scene from looking “only moderately dense” in particles while quietly exploding in ribbon/lattice geometry cost.

## 7. GPU-First Particle Reset Path

One of the biggest performance changes is the particle reset path.

### Original behavior

The old monolith already used WebGPU storage buffers and compute kernels for simulation, but particle initialization/reset still leaned heavily on CPU-side typed-array generation. A reset could involve a large loop that generated particle position, velocity, color, and size data on the main thread before uploading it.

That causes:

- UI stalls at high particle counts;
- temporary memory spikes;
- garbage-collection pressure;
- expensive CPU→GPU uploads.

### Current behavior

The current engine prefers a GPU-side reset path. Instead of filling huge CPU arrays, the app updates reset seed/uniform data and runs a compute pass that respawns particles directly in GPU storage.

That avoids the worst-case reset behavior:

- no giant main-thread random-fill loop;
- no full particle array re-upload;
- less temporary memory allocation;
- faster reset/reroll interactions.

If GPU reset is unavailable or fails, the app falls back to worker or CPU reset paths.

## 8. Worker-Based Particle Initialization Fallback

The reset system now has a fallback chain:

```text
GPU compute reset
→ SharedArrayBuffer worker pool
→ single worker typed-array fill
→ synchronous CPU fallback
```

That gives the app a graceful degradation path instead of relying on one reset method.

The worker path splits initialization into ranges. Each worker receives a particle range and fills position/velocity/color data for that slice. For large particle counts this reduces main-thread blocking substantially, especially when `SharedArrayBuffer` is available.

## 9. SharedArrayBuffer Use

`SharedArrayBuffer` was added as a performance acceleration path, not as a hard requirement. When supported, it reduces copies and transfer overhead between the main thread, workers, and audio worklet/level analysis logic.

### Why it matters

Normal worker communication uses structured clone or transferable `ArrayBuffer`s. That works, but it is not ideal for repeated large buffers or high-frequency audio metering.

`SharedArrayBuffer` lets multiple execution contexts read/write the same memory without repeatedly copying or transferring ownership.

The app uses this idea in two main places:

1. particle initialization buffers;
2. audio sample/level analysis buffers.

## 10. Shared Particle Buffers

The new particle initialization path can allocate shared typed arrays for particle data:

- positions;
- velocities;
- colors;
- other initialization data as needed.

Workers then write directly into their assigned range of the shared arrays. The main thread does not need to receive a separate large result object from each worker. It only waits for completion and then uses the already-filled buffer data.

This improves:

- memory churn;
- worker message overhead;
- large particle init latency;
- stability at high particle counts.

## 11. SharedArrayBuffer Safety and Transfer Handling

A subtle but important implementation detail: `SharedArrayBuffer` is not transferred the same way as a normal `ArrayBuffer`.

A normal `ArrayBuffer` can be placed in a `postMessage()` transfer list, which moves ownership to the receiving context. A `SharedArrayBuffer` is shared by reference and must not be placed in the transfer list.

The refactor added guarded transfer-list logic so shared buffers are filtered out before posting worker messages. That avoids browser errors caused by trying to transfer memory that is supposed to remain shared.

## 12. Audio Shared Ring Buffer

The audio system also gained a shared-memory path.

The current architecture can use a `SharedArrayBuffer` ring buffer between the AudioWorklet and the level-analysis worker. The AudioWorklet writes sample data into the ring. A worker reads that data and computes levels/peaks at a lower reporting rate.

The ring buffer tracks state with atomic counters such as:

- write index;
- read index;
- sequence/version;
- dropped-sample count.

The resulting pipeline is:

```text
Audio source
→ AudioWorklet
→ SharedArrayBuffer ring
→ level worker with Atomics
→ low-rate UI/render reactivity values
```

That avoids constantly posting raw sample chunks through normal worker messages.

## 13. Cross-Origin Isolation Requirement

`SharedArrayBuffer` generally requires the page to be cross-origin isolated. The current app checks runtime capabilities and can fall back when SAB is unavailable.

Important capability checks now include:

- WebGPU support;
- Worker support;
- AudioWorklet support;
- `SharedArrayBuffer` support;
- `crossOriginIsolated` status;
- hardware concurrency.

Best performance requires serving the app with COOP/COEP headers so `crossOriginIsolated === true`. Without that, the app still runs, but particle initialization and audio analysis may use slower fallback paths.

## 14. 2D Backdrop Worker Geometry

The 2D / iTunes-style backdrop system was changed from a main-thread drawing concept into a worker-generated geometry system.

The worker generates:

- line segments;
- filled triangles;
- ribbon fields;
- bokeh/disc fills;
- matrix/grid-like line systems;
- radial/burst geometry.

The render module then uploads those arrays into GPU-backed meshes.

This makes the 2D backdrop less intrusive on UI responsiveness because expensive geometry generation can happen off the main thread. It also lets the backdrop have independent budgets from the 3D particle simulation.

## 15. Backdrop Rate Limiting and Freeze Guards

The backdrop worker is not allowed to issue unlimited geometry requests. The render path throttles worker updates based on style and performance mode.

Later runtime protections were added so the backdrop does not visually freeze when a worker frame stalls:

- track whether the worker is busy;
- skip duplicate requests while work is in flight;
- recycle the worker if it appears wedged;
- keep the last valid geometry frame instead of blanking;
- add subtle render-side drift/rotation/scale motion so a delayed worker frame does not look static.

This gives the system a better failure mode: if geometry generation misses a frame deadline, the effect can still appear alive until fresh geometry arrives.

## 16. Backdrop Visual Runtime Changes

The 2D backdrop system received several architectural changes beyond pure aesthetics:

- all effects use worker-generated line/fill geometry;
- blur/glass copies are rendered as additional GPU layers rather than relying on CPU canvas blur;
- filled geometry has edge feathering so ribbons/discs/bokeh fade at their borders;
- global oriented-gradient logic prevents rotating RGB pie-slice color maps;
- ribbons use side-to-side/across-band gradients;
- discs/bokeh/rings use inward-to-outward gradients;
- periodic slow rotation can change the apparent angle of patterns without jarring motion;
- stale-frame render-side motion prevents visible freeze when worker output is delayed.

The important runtime point: the 2D visual layer became a GPU-rendered, worker-fed geometry system with its own failure handling and budget control.

## 17. Audio System Changes

The original `AudioManager` in the uploaded monolithic app was effectively disabled/stubbed for that release. The current app has a real audio source layer.

Current supported source behavior includes:

- File audio playback;
- URL audio playback;
- mic capture;
- system audio capture;
- output volume control;
- source-specific mute behavior;
- pause/resume for media sources;
- seek bar and time display for File/URL sources;
- audio-reactive levels for visuals.

System audio intentionally auto-mutes app output while active to avoid feedback/loopback. That mute is now source-scoped so it does not stay stuck after switching back to File/URL/Mic.

Synth audio was removed from the source list so the audio system is focused on real external/media sources.

## 18. Media Control Behavior

File/URL sources now distinguish pause/resume from stop.

That matters because stop is destructive for loaded media state: it can tear down the source and drop context. The Start button now becomes Pause while File/URL/Mic audio is active, then Resume when paused.

File and URL audio also gained a seek/progress bar. Seeking restarts playback at the requested offset using the decoded buffer/media timing state.

## 19. UI and Control Runtime Changes

The UI changes that matter technically are the ones that expose runtime state more clearly or reduce accidental destructive actions:

- slider rows now print live numeric values;
- 2D/3D fade controls show actual values;
- performance mode is exposed in the system/performance menu;
- File/URL media controls include pause/resume and seek;
- long file names are ellipsized so they do not overlap controls;
- audio source changes handle mute/state cleanup;
- source list was simplified after removing Synth.

These are not just cosmetic. They make the runtime state observable, especially for performance and audio debugging.

## 20. State Defaults and Migration Behavior

The current app has more explicit default and saved-state handling than the monolith.

Important default changes include:

- lower default 2D backdrop opacity/fade so effects do not dominate on launch;
- default 3D fade tuned for visible but not overwhelming 3D particles;
- performance mode defaulting into a coherent budget profile;
- audio source defaults avoiding removed Synth behavior;
- saved-state cleanup for source-specific mute issues;
- fallback defaults when older saved states lack new keys.

This matters because refactoring a stateful app without migration guards can make old localStorage saves behave incorrectly.

## 21. WebGPU Render and Compute Improvements

The modular app keeps the core WebGPU/TSL simulation idea from the original, but the runtime around it is more explicit.

Important changes include:

- GPU-first reset path;
- active count decoupled from capacity;
- adaptive particle caps;
- separate ribbon/lattice budget control;
- throttled structural rebuilds;
- improved fallback behavior when GPU paths fail;
- smaller, isolated render modules instead of all engine logic living in the same file as UI and persistence.

The old app already had GPU storage and compute concepts. The new version makes those paths easier to control and less likely to block the rest of the app.

## 22. Histogram and Theme Feedback

The app preserves the idea of deriving visual state from the simulation, but avoids full readback of particle data. Color/histogram feedback is treated as a small, throttled GPU signal rather than a heavy CPU inspection path.

That means the UI/background can react to the simulated system without requiring large particle-buffer readbacks.

## 23. Worker and Runtime Failure Handling

The current app has more fallback behavior than the original monolith.

Key failure chains:

```text
GPU reset unavailable
→ worker particle init
→ synchronous CPU fallback
```

```text
SharedArrayBuffer unavailable
→ ordinary ArrayBuffer / transfer fallback
```

```text
2D backdrop worker stalls
→ keep last valid frame
→ apply render-side motion
→ recycle worker if needed
```

```text
System audio selected
→ output auto-muted
→ mute automatically cleared when leaving system source
```

This is one of the bigger differences. The app is now built around partial failure tolerance instead of assuming the fastest path always works.

## 24. Practical Impact

The refactor improves the app in four main ways.

### Main-thread responsiveness

Particle initialization, 2D backdrop geometry, audio fetch/decode, and audio level analysis are no longer concentrated entirely on the UI/render thread.

### GPU pressure control

Canvas scale, active particle count, capacity, ribbons, lattice, and backdrop detail are tied into performance profiles.

### Memory churn reduction

`SharedArrayBuffer` avoids repeated clone/transfer cycles for large particle buffers and high-frequency audio sample data when the browser supports it.

### Graceful degradation

The app can step down from GPU/SAB/worker paths to slower but safer fallbacks instead of failing or visually freezing.

## 25. Deployment Notes

For best runtime performance, the deployed app should support:

- WebGPU;
- module workers;
- AudioWorklet;
- `SharedArrayBuffer`;
- cross-origin isolation through COOP/COEP headers.

The app should still run without every capability, but the fastest particle and audio paths depend on WebGPU, workers, and SAB support.

## 26. What This Changelog Leaves Out

This document intentionally leaves out most one-off tuning from the development conversation: exact color preset experiments, repeated gradient tweaks, small UI text changes, and individual default-value nudges. Those belong in commit notes, not in the architecture changelog.

The core change is that Scale Space moved from a single-file WebGPU application into a modular runtime with explicit performance profiles, worker-backed geometry, GPU-first particle reset, shared-memory acceleration, real media/audio source handling, and stronger failure recovery.

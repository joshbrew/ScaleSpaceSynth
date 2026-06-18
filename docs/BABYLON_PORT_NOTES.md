# Babylon.js port notes

The long-term target is not "Three but rewritten." The clean target is a native WebGPU simulation core with thin render adapters. Babylon.js is a better host for that than leaning harder into Three internals because it exposes a more direct WebGPU engine path, has stronger scene/resource lifecycle handling, and is easier to grow into a real app shell.

## Port shape

```txt
ScaleSpaceSimCore
  owns GPU buffers
  owns compute pipelines
  owns active particle counts/caps
  exposes small state patch API

RenderAdapter
  Babylon adapter first
  direct WebGPU worker adapter second
  Three/TSL adapter remains current compatibility path

UI/App Shell
  stays DOM/main-thread
  sends compact state patches to the renderer/sim
```

## Already prepared in this package

```txt
src/native/particle-kernels.wgsl.js
  WGSL reset/grid/integration/histogram kernels with Chrome-compatible comma struct fields

src/native/offscreen-renderer-host.js
  main-thread OffscreenCanvas worker bridge

src/native/offscreen-renderer.worker.js
  direct WebGPU worker scaffold that validates the shared WGSL module

src/babylon/babylon-compute-particles.js
  Babylon compute adapter scaffold around the shared WGSL kernel bank

src/babylon/babylon-port-plan.js
  minimal WebGPUEngine/Scene bootstrap scaffold
```

## Migration order

1. Keep the current Three/TSL path as the visual reference.
2. Move particle reset/spawn to compute in the current engine. Done in this pass.
3. Extract a renderer-neutral simulation state object.
4. Build Babylon buffers using the same layout:

```txt
ParticlePosition / posSize: vec4<f32>  xyz position, w size
ParticleVelocity / velLife: vec4<f32>  xyz velocity, w life
ParticleColor / colorSeed: vec4<f32>   rgb tint, a seed
GridCount: array<atomic<u32>>
GridMembers: array<u32>
ColorHist: array<atomic<u32>>
```

5. Recreate particle draw as a Babylon custom shader/material over storage buffers.
6. Recreate ribbon/lattice as optional compute-generated line/quad buffers.
7. Move renderer to an OffscreenCanvas worker once camera and UI inputs are reduced to messages.

## Worker renderer reality check

WebGPU in a Worker is browser-dependent. The scaffold probes support and fails closed. Do not boot the whole app through it until the main-thread engine stops creating DOM nodes like helper arrows, canvases for textures, and screenshot utilities. That split is why the current worker file is a direct-WebGPU scaffold rather than importing the existing `Engine` class.

## Babylon compute backend added

The Babylon scaffold now exposes a native compute system through:

```txt
src/babylon/babylon-native-compute-system.js
```

Usage shape:

```js
const port = createBabylonScaleSpacePort({ BABYLON, canvas, state, capacity: 150000 });
const { engine, scene, camera, nativeCompute } = await port.init();

nativeCompute.step({
  freeEnergy: 100000,
  tempo: 2.7,
  inversion: 30,
  coherence: 1,
});
```

This backend asks Babylon's `WebGPUEngine` for the underlying `GPUDevice`, then uses the renderer-neutral `WebGPUComputeParticles` class. That keeps the particle simulation portable across Babylon, direct worker rendering, and any later custom shell.

The remaining Babylon work is the draw adapter:

```txt
particle draw shader reads packed Particle storage buffer
camera uniforms match the current orbit/fly controller
ribbon/lattice optional passes consume the same particleBuffer
background pass consumes color histogram directly instead of CPU readback
```

## Direct worker renderer now exists

The worker renderer now draws additive particle quads from the packed native `Particle` storage buffer. Babylon should mirror that shape instead of rebuilding three separate position/velocity/color buffer families. The port target is:

```txt
native Particle buffer -> Babylon custom material / direct storage read
native audio feature uniform -> shader-side blowout and color pulse
native grid buffers -> optional debug/density overlays
```

The practical Babylon next step is a draw adapter that consumes `nativeCompute.buffers.particleBuffer`, plus a small camera uniform matching the current orbit/fly camera.

## Compute trail buffer added

The Babylon native compute system now creates a `GPUTrailSystem` beside `WebGPUComputeParticles`.

```txt
nativeCompute.buffers.particleBuffer
nativeCompute.buffers.trailHistoryBuffer
nativeCompute.buffers.trailDepth
nativeCompute.buffers.writeIndex
```

The intended Babylon draw adapter should render trails first, then particles, using the same additive blend mode as the direct worker path. This avoids porting the old Three ribbon/lattice object graph and keeps trails as a pure GPU buffer consumer.

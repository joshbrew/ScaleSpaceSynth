# Native-first WebGPU pass notes

This split still uses Three TSL as the authoring layer, but the runtime is now shaped around a native/WebGPU mental model so it ports more cleanly to Babylon.js or direct WebGPU later.

## Current GPU pass graph

```txt
frame
  update uniforms
  compute clearGrid          storage<uint>[64*64*64]
  compute assignGrid         positions -> grid counts + bounded member slots
  compute physics            positions + velocities, neighbor lookup from grid
  compute colorHistogram     throttled side pass, 16 bins
  compute ribbons            optional, throttled by perf profile
  compute lattice            optional, throttled by perf profile
  render particles
  render ribbon/lattice quads
```

## Native-port storage layout

```txt
ParticlePosition: vec4<f32>  xyz = position, w = size scalar
ParticleVelocity: vec4<f32>  xyz = velocity, w = life
ParticleColor:    vec4<f32>  rgb = spawn tint, a = seed/random lane
GridCount:        u32[cellCount]
GridMembers:      u32[cellCount * maxPerCell]
ColorHist:        u32[16]
RibbonPosition:   vec4<f32>[ribbonVerts]
RibbonColor:      vec4<f32>[ribbonVerts]
LatticePosition:  vec4<f32>[latticeVerts]
LatticeColor:     vec4<f32>[latticeVerts]
```

WGSL struct note for the direct port: use commas in struct declarations for Chrome compatibility.

## Compute decisions made in this pass

- GPU capacity is now separate from live `freeEnergy`. Default capacity is 150k, while live freeEnergy starts at 100k. This prevents silently allocating 1M particles on boot.
- `activeParticleCount` is clamped to the allocated GPU capacity before it reaches compute or draw calls.
- Neighbor grid `MAX_PER_CELL` is profile-driven. Balanced now uses 16 instead of 32, which cuts neighbor-loop work and grid member memory roughly in half.
- Ribbons and lattice have independent particle caps. They no longer scale all the way to a huge freeEnergy value by accident.
- Particle reinitialization uses a SharedArrayBuffer worker pool when available, then falls back to the single worker and then sync generation.

## Good next native kernels

1. **GPU particle spawn/reset**
   - Replace CPU/SAB particle init with a compute kernel that fills position/velocity/color directly on the GPU.
   - This avoids CPU generation and upload entirely.

2. **Merged clear + assign strategy**
   - Current clearGrid and assignGrid are separate passes because atomics need a clean count buffer.
   - A native implementation can explore epoch-stamped cells to avoid full-grid clears when active particle count is low.

3. **Indirect draw / indirect dispatch**
   - Live draw counts are CPU-set today.
   - Native WebGPU can keep active counts in a small uniform/storage buffer and move toward indirect commands once the surrounding renderer path supports it.

4. **Audio features into a uniform/storage block**
   - Audio level/beat currently lands in JS state and then uniforms.
   - A native path can write the audio feature buffer from a worker/SAB bridge once per tick and bind it directly.

5. **Density/color reduction fully GPU-side**
   - Histogram is already compute-backed, but readback is throttled for the background color.
   - A native render path can consume the histogram directly in a fullscreen/background pass without CPU readback.
```

## Next compute-worker pass

This package now includes a direct WebGPU compute backend that does not depend on Three/TSL:

```txt
src/native/webgpu-compute-particles.js
  GPUBuffer ownership
  reset/grid/integrate/histogram compute pipelines
  sim uniform packing
  histogram readback helper

src/native/audio-feature-buffer.js
  fixed 64-byte audio feature uniform layout for future shader-side beat/blowout logic

src/native/epoch-grid-kernels.wgsl.js
  optional epoch-stamped grid assignment kernel for direct ports that want to remove the full clearGrid pass
```

The OffscreenCanvas worker now instantiates this native compute backend and runs the particle compute step in the worker as a smoke-test path. It still renders a blank clear pass because the current production renderer remains the Three/TSL path, but the expensive particle math can now be exercised independently of the DOM/main thread.

The next migration step is to draw particles from `particleBuffer` in the worker/Babylon renderer rather than mirroring the old separate Three storage buffers. The native layout is one packed struct per particle:

```wgsl
struct Particle {
  posSize: vec4<f32>,
  velLife: vec4<f32>,
  colorSeed: vec4<f32>,
}
```

That layout is better for the Babylon/direct WebGPU port because a single storage buffer can be shared by reset, grid assignment, integration, and draw/material stages.

## Compute-worker render pass added

The OffscreenCanvas worker now owns both pieces of the direct path:

```txt
WebGPUComputeParticles
  packed Particle storage buffer
  grid buffers
  audio feature uniform
  reset/grid/integrate compute

WorkerParticleRenderer
  reads the same packed Particle storage buffer
  renders additive billboard quads
  runs inside the renderer worker
```

Frame shape in the worker is now:

```txt
worker frame
  write sim uniform
  write audio feature uniform
  encode clearGrid / assignGrid / integrateParticles
  begin render pass
  draw activeParticleCount * 6 vertices from particleBuffer
  submit one command buffer
```

That is the native-first shape we want for Babylon too: compute owns the particle buffer and render adapters consume it directly. Three/TSL remains the production reference renderer for now, but the direct path no longer clears a blank canvas.

## Compute trails now wired in the worker

The direct worker renderer now records a GPU trail history buffer after particle integration and renders trail quads before particle quads.

```txt
compute integrateParticles
compute recordTrailHistory
render WorkerTrailRenderer
render WorkerParticleRenderer
```

This is the first non-particle visual layer moved into the native worker path. It is intentionally storage-buffer-first so Babylon can consume the same `trailHistoryBuffer` without any Three/TSL translation layer.

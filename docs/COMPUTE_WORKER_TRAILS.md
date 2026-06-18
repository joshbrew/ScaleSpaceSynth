# Compute worker trail pass

This pass moves one more visual layer into the direct WebGPU worker path.

## New worker frame graph

```txt
write sim uniforms
write audio feature uniforms
compute clearGrid / assignGrid / integrateParticles
compute recordTrailHistory
render trail quads from trailHistoryBuffer
render particle quads from particleBuffer
submit one command buffer
```

## Buffers

```txt
ParticleBuffer
  vec4 posSize
  vec4 velLife
  vec4 colorSeed

TrailHistoryBuffer
  capacity * nativeTrailDepth * vec4<f32>
  xyz = particle position
  w   = life/sample-valid marker
```

The trail buffer is written by compute and consumed by the render pass without CPU readback. This is the same shape the Babylon port should keep: one compute-owned particle storage buffer, one compute-owned trail history buffer, and renderers that only read those buffers.

## Runtime knobs

```js
S.nativeTrails = true;
S.showNativeTrails = true;
S.nativeTrailDepth = 8;
S.nativeTrailOpacity = 0.075;
S.nativeTrailThickness = 2.0;
S.nativeRenderZoom = 80;
```

Quality should use 12 trail samples. Balanced should use 8. Speed should use 6. Potato should use 4.

## Why this matters

The old Three path builds most ribbon/trail behavior through framework objects and JS-driven state. The native path now records trails in compute, then draws them directly from GPU storage. That is a useful halfway house toward a Babylon/WebGPU port because Babylon can reuse the buffers and kernels without caring how the original Three/TSL scene was structured.

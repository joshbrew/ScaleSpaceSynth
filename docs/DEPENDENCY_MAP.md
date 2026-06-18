# Dependency map

## src/WorkerPool.js
- `./smartBuffers.js`

## src/atlas-constants.js
- no relative module imports

## src/atlas.js
- `./atlas-constants.js`
- `./capture-render.js`
- `./dom-ui.js`
- `./utils.js`

## src/audio/audio-fetch-pool.js
- no relative module imports

## src/audio/audio-fetch.worker.js
- no relative module imports

## src/audio/howler-worklet-wrapper.js
- no relative module imports

## src/audio/howlerAudio.js
- no relative module imports

## src/audio-level-bridge.js
- no relative module imports

## src/audio-level.worker.js
- no relative module imports

## src/audio-reactivity.js
- no relative module imports

## src/audio-source-ui.js
- `./audio.js`
- `./performance.js`
- `./randomizer.js`

## src/audio.js
- `./audio-level-bridge.js`
- `./audio/audio-fetch-pool.js`
- `./audio/howler-worklet-wrapper.js`
- `./audio/howlerAudio.js`

## src/babylon/babylon-compute-particles.js
- `../native/particle-kernels.wgsl.js`
- `./babylon-native-compute-system.js`

## src/babylon/babylon-native-compute-system.js
- `../native/webgpu-compute-particles.js`

## src/babylon/babylon-port-plan.js
- `./babylon-compute-particles.js`

## src/boot-art.js
- no relative module imports

## src/boot-splash.js
- `./boot-art.js`

## src/bootstrap.js
- `./atlas.js`
- `./audio-reactivity.js`
- `./audio.js`
- `./boot-splash.js`
- `./engine.js`
- `./fps.js`
- `./modulation.js`
- `./performance.js`
- `./playlist.js`
- `./profile.js`
- `./share.js`
- `./state.js`
- `./text.js`
- `./theme.js`
- `./ui-hide-button.js`
- `./ui.js`
- `./validation.js`

## src/capture-render.js
- `./atlas-constants.js`

## src/dom-ui.js
- no relative module imports

## src/engine-nodes.js
- no relative module imports

## src/engine.js
- `./engine-nodes.js`
- `./particle-init.js`
- `./performance.js`

## src/fps.js
- `./ui.js`

## src/modulation.js
- `./atlas-constants.js`

## src/native/audio-feature-buffer.js
- no relative module imports

## src/native/epoch-grid-kernels.wgsl.js
- no relative module imports

## src/native/offscreen-renderer-host.js
- no relative module imports

## src/native/offscreen-renderer.worker.js
- `./particle-kernels.wgsl.js`
- `./webgpu-compute-particles.js`

## src/native/particle-kernels.wgsl.js
- no relative module imports

## src/native/webgpu-compute-particles.js
- `./particle-kernels.wgsl.js`

## src/particle-init.worker.js
- no relative module imports

## src/particle-init.js
- `./WorkerPool.js`
- `./smartBuffers.js`

## src/performance.js
- no relative module imports

## src/playlist.js
- `./atlas-constants.js`
- `./validation.js`

## src/profile.js
- `./state.js`
- `./utils.js`
- `./validation.js`

## src/radial-controls.js
- no relative module imports

## src/radial-ui.js
- `./atlas.js`
- `./radial-controls.js`
- `./theme.js`
- `./toast.js`

## src/randomizer.js
- `./performance.js`

## src/save-file.js
- `./atlas-constants.js`
- `./profile.js`
- `./state.js`
- `./theme.js`
- `./utils.js`
- `./validation.js`

## src/share.js
- `./atlas-constants.js`
- `./toast.js`
- `./validation.js`

## src/smartBuffers.js
- no relative module imports

## src/state.js
- `./atlas-constants.js`

## src/text.js
- no relative module imports

## src/theme.js
- `./toast.js`

## src/toast.js
- no relative module imports

## src/ui-hide-button.js
- no relative module imports

## src/ui.js
- `./atlas.js`
- `./audio-source-ui.js`
- `./capture-render.js`
- `./dom-ui.js`
- `./profile.js`
- `./radial-ui.js`
- `./save-file.js`
- `./text.js`
- `./theme.js`
- `./toast.js`
- `./utils.js`

## src/utils.js
- no relative module imports

## src/validation.js
- `./atlas-constants.js`
- `./utils.js`


## src/native/worker-particle-renderer.js
- `./worker-point-renderer.wgsl.js`

## src/native/worker-point-renderer.wgsl.js
- no relative module imports


## Native compute trail additions

```txt
src/native/offscreen-renderer.worker.js
  -> src/native/webgpu-compute-particles.js
  -> src/native/gpu-trail-system.js
  -> src/native/worker-particle-renderer.js
  -> src/native/worker-trail-renderer.js

src/native/gpu-trail-system.js
  -> src/native/trail-kernels.wgsl.js

src/native/worker-trail-renderer.js
  -> src/native/worker-trail-renderer.wgsl.js

src/native/worker-renderer-bridge.js
  -> src/native/offscreen-renderer-host.js
```

## Visual effects overlay

```txt
src/bootstrap.js
- `./visual-effects.js`

src/audio-source-ui.js
- `./visual-effects.js`

src/visual-effects.js
- no relative module imports
```

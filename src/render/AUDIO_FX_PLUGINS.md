# Audio FX plug-in notes

The performant 2D / iTunes-style backdrop path is not Canvas2D. It is generated in a worker as line and fill geometry, then rendered by the GPU scene.

## Add a new 2D backdrop effect

1. Add metadata in `src/render/audio-fx-registry.js`.

```js
{ id: 'mynewfx', label: 'My New FX', randomWeight: 2.0, tone: 'soft' }
```

`randomWeight` controls how often the randomizer/classic scene picker should choose it. Use `0` for manual-only modes.

2. Add the worker drawer in `src/render/visual-effects.worker.js`.

Find `BACKDROP_STYLE_DRAWERS` and add:

```js
mynewfx: (wr, bands, feat, d, opts) => {
  drawGradientFlow(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.8 });
  drawColorBursts(wr, bands, feat, d, { ...opts, amount: opts.amount * 0.4 });
}
```

3. Keep drawer functions pure.

A drawer should only write geometry through:

- `wr.write(...)` for line segments
- `wr.writeTri(...)` for filled triangles
- helper effects such as `drawGradientFlow`, `drawAmbientGlow`, `drawSoftColorWaves`, `drawSpectralMist`, `drawColorBursts`

Do not use Canvas2D inside this path.

## Color / gradient style

Prefer the soft palette helpers instead of full rainbow sweeps:

- `softHue(baseHue, phase, band, accent)`
- `softSat(sat, multiplier)`
- `softLight(light, multiplier, lift)`

This keeps backdrop gradients closer to the particle palette and avoids the cheap full-rainbow look.


## Design note

Backdrop plug-ins are now expected to lean on geometry-first gradients instead of
left-to-right rainbow sweeps. If a new style needs a color pass, prefer the
position-aware helpers in `visual-effects.worker.js`:

- `paletteStopsForStyle(...)`
- `paletteColorAtPoint(...)`
- `gradeBackdropColors(...)`

Those helpers grade by actual vertex position, radial distance, and contour
orientation so the result complements the particle field rather than reading
like a flat screen-space wash.


### Current soft-style examples

Good reference implementations for future plug-ins:

- `prismadrift` for airy rainbow-gradient motion
- `jazzhaze` for orbit/scribble plus haze layering
- `opalbloom` for large ethereal color masses

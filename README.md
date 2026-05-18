<img src="img/synthesistlogo.png" alt="Scale Space Synthesis" width="1024px" align="center" />

# Scale Space Synthesist

A WebGPU phase-space visualizer / particle-based morphoscope. Part of the [Scale Space](https://reddit.com/r/ScaleSpace) project.

![status](https://img.shields.io/badge/status-1.0-green) ![license](https://img.shields.io/badge/license-MIT-blue)

## Just run it

Open `dist/index.html` in a WebGPU-capable browser (Chrome / Edge / Brave / Safari 17.4+). Done. No install required.

## Edit it (any OS, no command line)

**Windows:** double-click `1-INSTALL.bat` once, then `2-DEV-MODE.bat` to edit, `3-MAKE-BUILD.bat` to ship.
**Mac:** same idea, use the `.command` files instead.

Full plain-English instructions are in `START-HERE.txt`.

## Edit it (command line)

```sh
npm install
npm run dev      # http://localhost:5173, hot-reload on save
npm run build    # produces dist/index.html (~1.15 MB, fully self-contained)
```

## What's inside

```
src/app.js     all application code, single file
src/app.css    all styles, single file
index.html     panel scaffolding
vite.config.js build config (vite-plugin-singlefile)
dist/          generated standalone build
```

`src/app.js` reads top-to-bottom in seven labelled sections — `APP_TEXT`, `AudioManager`, `Atlas`, `Engine`, `RadialUI`, `UI`, `Bootstrap`. Use Ctrl+F to jump around.

## Why a single source file

Original ask: editable by a designer, not just a developer. One file = no jumping between modules, no losing your place. Vite still bundles three.js + Tone.js + your code into a single self-contained HTML on build, so the deliverable is portable to anywhere a browser can read a file.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| Tab | Hide/show UI |
| Home | Reset camera |
| Pause / P | Toggle simulation pause / toggle audio |
| PgUp / PgDn | Adjust tempo |
| Ctrl+S | Capture current configuration as a waypoint |
| Q / E | Free energy (particle count) |
| Z / X | Resolution (particle size) |
| R / T | Equilibrium (noise speed) |
| F / G | Temperature (noise intensity) |
| V / B | Coherence (attraction radius) |
| I / O | Inversion (compression) |
| N / M | Scale depth (attraction force) |
| K / L | Half-life (particle lifespan) |
| Right-click canvas | Open radial menu |

# Screenshots

All screenshots are unedited. Differences in scanlines and backgrounds come from settings in Scale Space Synthesist.

<img src="img/Screenshot 2026-05-07 221114.png" width="100%" />
<img src="img/Screenshot 2026-05-07 221200.png" width="100%" />
<img src="img/Screenshot 2026-05-07 221501.png" width="100%" />
<img src="img/Screenshot 2026-05-07 221521.png" width="100%" />

<img src="img/Screenshot 2026-05-09 073620.png" width="100%" />
<img src="img/Screenshot 2026-05-09 073933.png" width="100%" />
<img src="img/Screenshot 2026-05-09 074014.png" width="100%" />
<img src="img/Screenshot 2026-05-09 074456.png" width="100%" />
<img src="img/Screenshot 2026-05-09 074555.png" width="100%" />
<img src="img/Screenshot 2026-05-09 074634.png" width="100%" />
<img src="img/Screenshot 2026-05-09 074749.png" width="100%" />
<img src="img/Screenshot 2026-05-09 074846.png" width="100%" />
<img src="img/Screenshot 2026-05-09 075919.png" width="100%" />
<img src="img/Screenshot 2026-05-09 080020.png" width="100%" />
<img src="img/Screenshot 2026-05-09 080039.png" width="100%" />

<img src="img/scalespace_SS-PD3VIK_2026-05-11T00-42-48.png" width="100%" />
<img src="img/scalespace_SS-PD3VIK_2026-05-11T00-46-30.png" width="100%" />
<img src="img/scalespace_SS-UH5MWD_2026-05-11T01-03-32.png" width="100%" />
<img src="img/scalespace_SS-WNWP8Y_2026-05-11T01-12-09.png" width="100%" />
<img src="img/scalespace_SS-9RTSWU_2026-05-11T01-30-52.png" width="100%" />
<img src="img/scalespace_SS-PD3VIK_2026-05-11T01-34-41.png" width="100%" />
<img src="img/scalespace_SS-DICTUY_2026-05-11T01-37-58.png" width="100%" />
<img src="img/scalespace_SS-NQKVF3_2026-05-11T12-16-05.png" width="100%" />

<img src="img/Screenshot 2026-05-12 202624.png" width="100%" />
<img src="img/Screenshot 2026-05-12 202714.png" width="100%" />
<img src="img/Screenshot 2026-05-12 202733.png" width="100%" />
<img src="img/Screenshot 2026-05-12 202805.png" width="100%" />
<img src="img/Screenshot 2026-05-12 203323.png" width="100%" />
<img src="img/Screenshot 2026-05-12 203424.png" width="100%" />
<img src="img/Screenshot 2026-05-12 203622.png" width="100%" />
<img src="img/Screenshot 2026-05-12 204410.png" width="100%" />
<img src="img/Screenshot 2026-05-12 204418.png" width="100%" />
<img src="img/Screenshot 2026-05-12 204437.png" width="100%" />
<img src="img/Screenshot 2026-05-12 205132.png" width="100%" />
<img src="img/Screenshot 2026-05-12 210026.png" width="100%" />
<img src="img/Screenshot 2026-05-12 223832.png" width="100%" />
<img src="img/Screenshot 2026-05-12 223952.png" width="100%" />
<img src="img/Screenshot 2026-05-12 224227.png" width="100%" />
<img src="img/Screenshot 2026-05-12 225231.png" width="100%" />

<img src="img/Screenshot 2026-05-13 112616.png" width="100%" />
<img src="img/Screenshot 2026-05-13 112715.png" width="100%" />
<img src="img/Screenshot 2026-05-13 112830.png" width="100%" />
<img src="img/Screenshot 2026-05-13 113429.png" width="100%" />
<img src="img/Screenshot 2026-05-13 114103.png" width="100%" />
<img src="img/Screenshot 2026-05-13 114459.png" width="100%" />
<img src="img/Screenshot 2026-05-13 114639.png" width="100%" />
<img src="img/Screenshot 2026-05-13 210708.png" width="100%" />

<img src="img/Screenshot 2026-05-14 124716.png" width="100%" />
<img src="img/Screenshot 2026-05-14 184434.png" width="100%" />
<img src="img/Screenshot 2026-05-14 194121.png" width="100%" />

<img src="img/scalespace_SS-6NKGC7_2026-05-15T00-46-05.png" width="100%" />
<img src="img/scalespace_SS-IUWNWN_2026-05-15T00-47-22.png" width="100%" />
<img src="img/scalespace_SS-LWTI1V_2026-05-15T00-47-50.png" width="100%" />
<img src="img/scalespace_SS-7TZO93_2026-05-15T00-48-04.png" width="100%" />
<img src="img/scalespace_SS-I4E9KO_2026-05-15T00-48-13.png" width="100%" />
<img src="img/scalespace_SS-SW441D_2026-05-15T00-48-41.png" width="100%" />
<img src="img/scalespace_SS-PC958_2026-05-15T00-50-27.png" width="100%" />
<img src="img/scalespace_SS-WHY9M5_2026-05-15T00-50-57.png" width="100%" />
<img src="img/scalespace_SS-VQ47XP_2026-05-15T00-52-53.png" width="100%" />
<img src="img/scalespace_SS-JY8ZP4_2026-05-15T00-54-51.png" width="100%" />
<img src="img/scalespace_SS-2XOKPQ_2026-05-15T00-57-04.png" width="100%" />
<img src="img/scalespace_SS-HCF2E6_2026-05-15T01-01-00.png" width="100%" />
<img src="img/scalespace_SS-FDOWBK_2026-05-15T01-02-06.png" width="100%" />
<img src="img/scalespace_SS-GM7EMO_2026-05-15T01-02-28.png" width="100%" />
<img src="img/scalespace_SS-GUZL66_2026-05-15T01-05-35.png" width="100%" />
<img src="img/scalespace_SS-INOO0T_2026-05-15T01-06-38.png" width="100%" />
<img src="img/scalespace_SS-JJFR2L_2026-05-15T01-07-18.png" width="100%" />
<img src="img/scalespace_SS-V4IBWY_2026-05-15T01-09-31.png" width="100%" />
<img src="img/Screenshot 2026-05-15 072022.png" width="100%" />
<img src="img/Screenshot 2026-05-15 075556.png" width="100%" />
<img src="img/scalespace_SS-GRCE0A_2026-05-15T12-00-57.png" width="100%" />
<img src="img/scalespace_SS-U4KNIO_2026-05-15T12-02-38.png" width="100%" />
<img src="img/Screenshot 2026-05-15 122803.png" width="100%" />
<img src="img/scalespace_SS-75FPYW_2026-05-15T20-15-50.png" width="100%" />
<img src="img/scalespace_SS-B50047_2026-05-15T21-03-42.png" width="100%" />
<img src="img/scalespace_SS-B50047_2026-05-15T21-04-09.png" width="100%" />
<img src="img/scalespace_SS-B50047_2026-05-15T21-05-42.png" width="100%" />
<img src="img/scalespace_SS-SFHIPC_2026-05-15T21-08-01.png" width="100%" />
<img src="img/scalespace_SS-8VPR0T_2026-05-15T21-10-48.png" width="100%" />
<img src="img/scalespace_SS-8VPR0T_2026-05-15T21-10-57.png" width="100%" />
<img src="img/scalespace_SS-88AYTV_2026-05-15T21-14-44.png" width="100%" />
<img src="img/scalespace_SS-L6148J_2026-05-15T21-17-38.png" width="100%" />
<img src="img/scalespace_SS-X4Z7UO_2026-05-15T21-20-12.png" width="100%" />
<img src="img/scalespace_SS-KY238F_2026-05-15T21-21-02.png" width="100%" />
<img src="img/scalespace_SS-3ZZCCE_2026-05-15T21-21-10.png" width="100%" />
<img src="img/scalespace_SS-TW65FO_2026-05-15T21-21-16.png" width="100%" />
<img src="img/scalespace_SS-UQQK9V_2026-05-15T21-21-45.png" width="100%" />
<img src="img/scalespace_SS-3T9XMI_2026-05-15T21-40-04.png" width="100%" />
<img src="img/scalespace_SS-OMV6D5_2026-05-15T21-42-27.png" width="100%" />
<img src="img/scalespace_SS-UHBZR2_2026-05-15T21-43-48.png" width="100%" />
<img src="img/scalespace_SS-DX3GA0_2026-05-15T21-45-29.png" width="100%" />
<img src="img/scalespace_SS-1KA1PG_2026-05-15T21-46-42.png" width="100%" />
<img src="img/scalespace_SS-Q7GJVF_2026-05-15T21-47-53.png" width="100%" />
<img src="img/scalespace_SS-4ITOAZ_2026-05-15T21-50-24.png" width="100%" />

<img src="img/scalespace_SS-3T9XMI_2026-05-16T00-54-55.png" width="100%" />

<img src="img/scalespace_SS-VX46SX_2026-05-17T12-17-16.png" width="100%" />
<img src="img/scalespace_SS-RRGRGO_2026-05-17T12-34-09.png" width="100%" />
<img src="img/scalespace_SS-RRGRGO_2026-05-17T12-34-24.png" width="100%" />
<img src="img/scalespace_SS-XDG46H_2026-05-17T12-40-32.png" width="100%" />
<img src="img/scalespace_SS-S41G27_2026-05-17T12-44-56.png" width="100%" />
<img src="img/scalespace_SS-AIZYCM_2026-05-17T12-49-27.png" width="100%" />
<img src="img/scalespace_SS-7W7VBE_2026-05-17T13-07-15.png" width="100%" />
<img src="img/Screenshot 2026-05-17 132410.png" width="100%" />
<img src="img/scalespace_SS-DK5UDD_2026-05-17T13-50-29.png" width="100%" />
<img src="img/scalespace_SS-U74EG_2026-05-17T13-51-38.png" width="100%" />
<img src="img/scalespace_SS-6KWR5N_2026-05-17T13-52-28.png" width="100%" />
<img src="img/scalespace_SS-XAJ9FV_2026-05-17T15-07-21.png" width="100%" />

## Contributing

Thoughtful PRs welcome. Discussion and shared waypoints at [/r/ScaleSpace](https://reddit.com/r/ScaleSpace).

## License

MIT — see `LICENSE`.

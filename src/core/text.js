// ────────────────────────────────────────────────────────────────────────────
//   1. APP_TEXT
// ────────────────────────────────────────────────────────────────────────────

export const APP_TEXT = {
    "hud": {
        "title": "CORE DECK // SYNTHESIST"
    },
    "panels": {
        "params": "Params",
        "optics": "Optics",
        "atlas": "Atlas",
        "controls": "Controls",
        "config": "Config",
        "offsets": "Offset Calibration (Debug)",
        "debug": "Debug Tools"
    },
    "controls": {
        "freeEnergy": { "label": "Free Energy", "sub": "particle count", "ll": "sparse", "lr": "dense" },
        "resolution": { "label": "Resolution", "sub": "particle size", "ll": "-rez", "lr": "+rez" },
        "inversion": { "label": "Inversion", "sub": "compression", "ll": "contract", "lr": "expand" },
        "halfLife": { "label": "Half-Life", "sub": "particle lifespan", "ll": "mortal", "lr": "immortal" },
        "scaleDepth": { "label": "Scale Depth", "sub": "attraction force", "ll": "micro", "lr": "macro" },
        "coherence": { "label": "Coherence", "sub": "attraction radius", "ll": "vague", "lr": "binary" },
        "equilibrium": { "label": "Equilibrium", "sub": "noise speed", "ll": "tranquil", "lr": "random" },
        "temperature": { "label": "Temperature", "sub": "noise intensity", "ll": "glacial", "lr": "firey" },
        "viscosity": { "label": "Viscosity", "sub": "sluggishness", "ll": "fluid", "lr": "thick" },
        "mass": { "label": "Mass", "sub": "inertia", "ll": "light", "lr": "heavy" },
        "tempo": { "label": "Tempo", "sub": "excitation", "ll": "pause", "lr": "2x" },
        "colorRange": { "label": "Color Spectrum Range", "sub": "", "ll": "tight", "lr": "wide" },
        "saturation": { "label": "Color Saturation", "sub": "", "ll": "muted", "lr": "vivid" },
        "variance": { "label": "Variance", "sub": "noise gradient", "ll": "uniform", "lr": "spectral" },
        "opacity": { "label": "System Opacity", "sub": "", "ll": "ghost", "lr": "solid" },
        "trailLength": { "label": "Trail Length", "sub": "", "ll": "short", "lr": "long" },
        "backdropOpacity": { "label": "Backdrop Opacity", "sub": "", "ll": "off", "lr": "bright" },
        "backdropBlur": { "label": "Backdrop Blur", "sub": "", "ll": "crisp", "lr": "soft" },
        "panelOpacity": { "label": "Panel Opacity", "sub": "", "ll": "clear", "lr": "solid" },
        "volume": { "label": "Volume", "sub": "", "ll": "quiet", "lr": "loud" }
    },
    "quanta": {
        "label": "Quanta",
        "sub": "particle shape",
        "items": ["Circle", "Square", "Diamond", "Point"]
    },
    "trails": {
        "label": "Trails",
        "sub": "connections between quanta",
        "items": ["Strings", "Lattice"]
    },
    "colorMode": {
        "label": "Color Mode",
        "items": ["Mono", "Size", "Velocity", "Density"]
    },
    "moveMode": {
        "label": "Move Mode",
        "items": ["Orbit", "Fly"]
    },
    "instructions": {
        "global": {
            "title": "Global",
            "rows": [
                ["Hide UI",         "Tab"],
                ["Reset Camera",    "Home"],
                ["Capture Waypoint","Ctrl + S"],
                ["Freeze / Unfreeze","Pause / Break"]
            ]
        },
        "params": {
            "title": "Parameters",
            "rows": [
                ["Free Energy",   "Q / E"],
                ["Resolution",    "Z / X"],
                ["Equilibrium",   "R / T"],
                ["Temperature",   "G / F"],
                ["Coherence",     "V / B"],
                ["Inversion",     "I / O"],
                ["Scale Depth",   "N / M"],
                ["Half-Life",     "K / L"]
            ]
        },
        "orbit": {
            "title": "Orbit Mode",
            "rows": [
                ["Rotate system",       "Click + drag"],
                ["Zoom in / out",       "Scroll · W / S"],
                ["Rotate horizontally", "A / D · ← / →"],
                ["Rotate vertically",   "↑ / ↓"]
            ]
        },
        "fly": {
            "title": "Fly Mode",
            "rows": [
                ["Move forward / back", "W / S"],
                ["Strafe left / right", "A / D"],
                ["Look around",         "Mouse · Arrow keys"],
                ["Move up",             "Space"],
                ["Move down",           "Shift"]
            ]
        }
    }
};

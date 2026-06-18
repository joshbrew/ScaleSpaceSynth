import { coordHash } from '../atlas/constants.js';
import { validateWaypoint } from '../core/validation.js';

// Build-time playlist injection (window.SS_IMPORTED_PLAYLIST). Idempotent,
// non-destructive merge of shipped destinations into the Imported tab — see the
// atlas-import-injection spec. The 'ss_playlist_seen' tombstone of shipped
// coordIds makes user deletions permanent (a deleted shipped spot won't
// resurrect on the next boot), and lets a later build add ONLY its new spots.
export function seedImportedPlaylist(hadSave) {
    const pkg = (typeof window !== 'undefined') ? window.SS_IMPORTED_PLAYLIST : null;
    const list = (pkg && Array.isArray(pkg.waypoints)) ? pkg.waypoints : null;
    if (!list || !list.length) return;
    const ship = list.map((w, i) => {
        const v = validateWaypoint(w);
        if (!v) return null;
        const coordId = v.coordId || (v.params ? coordHash(v.params) : '');
        return { ...v, isImported: true, coordId, id: 'wp_imp_' + Date.now() + '_' + i };
    }).filter(w => w && w.coordId);
    if (!ship.length) return;

    let seen;
    try { seen = new Set(JSON.parse(localStorage.getItem('ss_playlist_seen') || '[]')); }
    catch (e) { seen = new Set(); }

    const have = new Set((window.waypoints || []).map(w => w.coordId));
    const toAdd = [];
    for (const w of ship) {
        if (!have.has(w.coordId) && !seen.has(w.coordId)) { have.add(w.coordId); toAdd.push(w); }
    }
    if (toAdd.length) window.waypoints = toAdd.concat(window.waypoints || []);  // new shipped at top of Imported

    for (const w of ship) seen.add(w.coordId);
    try { localStorage.setItem('ss_playlist_seen', JSON.stringify([...seen])); } catch (e) {}
    if (window.saveWP) window.saveWP();

    // First run (no prior save at all): the shipped list IS the library — open
    // the Imported tab and start the user at shipped index 0.
    if (!hadSave && toAdd.length) {
        window.atlasTab = 'imported';
        window._startWaypoint = toAdd[0];
        // Boot the engine directly in the start waypoint's FULL state — params
        // and optics — before it's created (this seed runs pre-engine). The engine
        // then spawns particles, sizes the lattice/strings, and runs the sim in
        // that regime from frame one, exactly as a refresh-at-this-waypoint would.
        // Without it, first-run boots at defaults and travelTo() transitions in
        // over 5s, which (a) leaves the lattice locked to the default freeEnergy
        // and (b) lets the velocity distribution settle along the transition path,
        // so the adaptive color range locks onto the wrong band — the "orange
        // instead of green" bug. The first-frame travelTo() then only flies the
        // camera in (params already at target, so no jolt or recolor).
        const _p = toAdd[0].params, _o = toAdd[0].optics;
        if (_p) for (const k in _p) { if (k in window.S && Number.isFinite(_p[k])) window.S[k] = _p[k]; }
        if (_o) {
            if (Number.isInteger(_o.colorMode)) window.S.colorMode = _o.colorMode;
            if (typeof _o.shape === 'string') window.S.shape = _o.shape;
            for (const _k of ['showParticles', 'showRibbons', 'tessRibbons']) {
                if (typeof _o[_k] === 'boolean') window.S[_k] = _o[_k];
            }
        }
    }
}


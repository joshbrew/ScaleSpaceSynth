import { coordHash } from '../atlas/constants.js';
import { sanitizeName } from '../core/utils.js';
import { SS_VERSION } from '../core/state.js';
import { validateWaypoint } from '../core/validation.js';
import { saveProfile } from './profile.js';
import { applyTheme, applyButtonShape } from '../ui/theme.js';

// ─── Save File ─────────────────────────────────────────────────────────────
// Export all data as a single .scalespace.json file
// Schema designed to be forward-compatible with the eventual multiplayer server. Adding new fields to waypoints (tags, isShared, remoteId) costs nothing now and saves a migration headache later.

export function buildExportPayload(opts) {
    // opts: { includeSettings, includeProfile, includeWaypoints, includeThumbnails }
    // Each toggle independently omits a section. Thumbnails-without-waypoints
    // is meaningless (orphan data); the UI prevents that combination but we
    // also defensively force-clear it here.
    const o = opts || {};
    const inclSettings   = o.includeSettings   !== false;
    const inclProfile    = o.includeProfile    !== false;
    const inclWaypoints  = o.includeWaypoints  !== false;
    const inclThumbnails = inclWaypoints && (o.includeThumbnails !== false);

    // Round numeric values to remove float noise. Different parameters have very different sane precisions, so we use a small lookup.
    const PRECISION = {
        opacity: 2, panelOpacity: 2, buttonOpacity: 2, volume: 2, audioFxGain: 2,
        sat: 2, lightness: 2, hue: 3,
        equilibrium: 3, temperature: 2, viscosity: 2,
        mass: 2, scaleDepth: 2, coherence: 0, halfLife: 1,
        bgGlow: 2, bgBlur: 1, tempo: 2, trailLen: 0,
        resolution: 2, inversion: 0, freeEnergy: 0,
        offsetX: 0, offsetY: 0, offsetZ: 0, billboardOffset: 0,
        uiZoom: 2, audioOscHz: 0,
    };

    const payload = {
        schemaVersion: 2,
        exportedAt: new Date().toISOString(),
        exportedFrom: 'scale-space-synth',
        buildVersion: SS_VERSION
    };

    if (inclSettings) {
        const settings = { ...window.S };
        // Don't export transient/sensitive fields
        delete settings.audioOn; // always restored to false on load anyway
        // Fade-animation state — runtime only, never part of a save's identity.
        // If included, a save mid-fade would teach the importer a "pinned dip"
        // alpha with no timer to recover from it.
        delete settings._xfade;
        delete settings._xfadeEnv;
        // Don't export the export-toggle preferences themselves. They're a
        // per-user UI state, not a portable setting. Including them would
        // mean importing someone else's save overwrites your toggle choices.
        delete settings.exportIncludeSettings;
        delete settings.exportIncludeProfile;
        delete settings.exportIncludeWaypoints;
        delete settings.exportIncludeThumbnails;

        for (const [k, p] of Object.entries(PRECISION)) {
            if (typeof settings[k] === 'number') {
                const factor = Math.pow(10, p);
                settings[k] = Math.round(settings[k] * factor) / factor;
            }
            const modKey = k + '_mod';
            if (typeof settings[modKey] === 'number') {
                settings[modKey] = Math.round(settings[modKey] * 1000) / 1000;
            }
        }
        payload.settings = settings;
    }

    if (inclProfile) {
        payload.profile = { ...window.profile };
    }

    if (inclWaypoints) {
        // Same precision cleanup for waypoint params (lots of these
        // accumulate over time)
        const cleanParams = (params) => {
            if (!params || typeof params !== 'object') return params;
            const out = {};
            for (const [k, v] of Object.entries(params)) {
                if (typeof v === 'number' && PRECISION[k] !== undefined) {
                    const factor = Math.pow(10, PRECISION[k]);
                    out[k] = Math.round(v * factor) / factor;
                } else {
                    out[k] = v;
                }
            }
            return out;
        };

        payload.waypoints = (window.waypoints || []).map(wp => {
            const out = {
                ...wp,
                params: cleanParams(wp.params),
                // Stamp future-multiplayer fields if missing
                authorId:    wp.authorId   || window.profile.id,
                authorName:  wp.authorName || window.profile.username || '',
                tags:        wp.tags       || [],
                isShared:    wp.isShared   || false,
                remoteId:    wp.remoteId   || null
            };
            // Strip thumbnail data when the user opted out. Recipients will
            // see a placeholder and a "Capture Thumbnail" button — the
            // existing UI path handles this naturally (see is-empty class
            // in the waypoint card render).
            if (!inclThumbnails) out.thumbnail = null;
            return out;
        });
    }

    return payload;
}

export function exportSaveFile() {
    const payload = buildExportPayload({
        includeSettings:   window.S.exportIncludeSettings   !== false,
        includeProfile:    window.S.exportIncludeProfile    !== false,
        includeWaypoints:  window.S.exportIncludeWaypoints  !== false,
        includeThumbnails: window.S.exportIncludeThumbnails !== false
    });
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    // Filename: username (sanitized) + ISO date, no duplicate "scalespace"
    const name = (window.profile.username || 'save').replace(/[^a-zA-Z0-9_-]/g, '_');
    // Local-time date components rather than toISOString() which is UTC.
    // CST evenings would otherwise stamp tomorrow's date on save files.
    const _d = new Date();
    const ymd = _d.getFullYear() + '-' + String(_d.getMonth() + 1).padStart(2, '0') + '-' + String(_d.getDate()).padStart(2, '0');
    a.href = url;
    a.download = `${name}_${ymd}.scalespace.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function importSaveFile(file) {
    if (!file) return;
    // Defensive cap on file size — the on-disk format is JSON with embedded
    // base64 thumbnails. 200MB is well above any legitimate save (typical
    // ~5MB) and rejects DoS-by-huge-file before we spend cycles parsing.
    if (typeof file.size === 'number' && file.size > 200_000_000) {
        alert('Import failed. File too large.');
        return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (!data || typeof data !== 'object') throw new Error('not an object');
            if (data.exportedFrom && data.exportedFrom !== 'scale-space-synth' && data.exportedFrom !== 'scale-space-bioclast') {
                // Sanitize before display — alert/confirm are text-only so
                // there's no HTML injection here, but a maliciously long or
                // control-char-laden exportedFrom could ruin the dialog.
                const _from = sanitizeName(String(data.exportedFrom), { maxLen: 60 });
                if (!confirm(`This file says it's from "${_from}". Import anyway?`)) return;
            }

            // Detect what's actually present in this file. Each section is
            // optional now — exports can be partial — so the confirm dialog
            // shows the user exactly what they're about to apply and what
            // will be left untouched.
            const hasSettings   = !!(data.settings  && typeof data.settings  === 'object');
            const hasProfile    = !!(data.profile   && typeof data.profile   === 'object');
            const hasWaypoints  = Array.isArray(data.waypoints);
            // "hasThumbnails" only means at least one waypoint has a real
            // thumbnail string. A waypoint with thumbnail:null counts as
            // not-having-a-thumbnail. This drives the dialog's "(no
            // thumbnails)" suffix below.
            const thumbCount = hasWaypoints
                ? data.waypoints.reduce((n, w) => n + ((w && typeof w.thumbnail === 'string') ? 1 : 0), 0)
                : 0;

            const _previewUsername = sanitizeName(hasProfile && data.profile.username, { maxLen: 32 });
            const _previewExportedAt = (typeof data.exportedAt === 'string')
                ? sanitizeName(data.exportedAt, { maxLen: 50 })
                : 'unknown';

            // Build the contents preview. Each line only appears if that
            // section is actually present in the file. Order matches the
            // export-toggle order: Settings → Profile → Waypoints.
            const contentsLines = [];
            if (hasProfile)   contentsLines.push(`  Profile (username: ${_previewUsername || '(none)'})`);
            if (hasWaypoints) {
                const thumbSuffix = data.waypoints.length === 0
                    ? ''
                    : (thumbCount === 0
                        ? ' (no thumbnails)'
                        : (thumbCount < data.waypoints.length
                            ? ` (${thumbCount} with thumbnails)`
                            : ''));
                contentsLines.push(`  Waypoints: ${data.waypoints.length}${thumbSuffix}`);
            }
            if (contentsLines.length === 0) contentsLines.push('  (file appears empty)');

            // The "this REPLACES" warning is now conditional on what's
            // actually being applied. If a file has only settings, we
            // shouldn't scare the user about their waypoints being touched
            // when they won't be.
            const replaceParts = [];
            if (hasWaypoints) replaceParts.push('waypoints');
            if (hasProfile)   replaceParts.push('profile');
            const replaceWarning = replaceParts.length
                ? `This REPLACES your current ${replaceParts.join(', ')}.`
                : 'This file contains no data to import.';

            const ok = confirm(
                `Import this save file?\n\n` +
                `Contents:\n${contentsLines.join('\n')}\n\n` +
                `Exported: ${_previewExportedAt}\n\n` +
                `${replaceWarning}\n` +
                `Click Cancel to abort. (Tip: export your current data first as a backup.)`
            );
            if (!ok) return;

            // Apply settings via allowlist hydration. Unknown keys are
            // dropped; tampered types fall back to defaults. The unbounded
            // Object.assign that used to live here is what made every
            // downstream interpolation an XSS target.
            // Imported settings are intentionally NOT applied to the live sim.
            // Loading data must never move the user from where they currently are
            // — applying settings rewrote window.S (freeEnergy, temperature, ...)
            // and caused jarring entropy injections / a teleport. The user moves
            // only by intentionally visiting a waypoint. (data.settings is still
            // detected for the dialog count, just left unapplied.)
            void hasSettings;
            // Apply profile. We keep our local ID — imported profile should
            // not overwrite a returning user's identity unless they're
            // starting fresh on this machine — and take their username
            // through sanitizeName.
            if (hasProfile) {
                window.profile.username = sanitizeName(data.profile.username, { maxLen: 32 });
                saveProfile();
            }
            // Apply waypoints — each must pass validateWaypoint or it's
            // dropped. This is what neutralizes <script>-laden names,
            // out-of-range params, and shape-confused objects.
            if (hasWaypoints) {
                // Additive into the Imported tab (spec §4): incoming waypoints are
                // forced isImported, deduped by coordId against BOTH tabs, and
                // prepended in file order. Never overwrites the user's own set.
                const incoming = data.waypoints
                    .map(w => validateWaypoint(w))
                    .filter(Boolean)
                    .map((w, i) => {
                        const coordId = w.coordId || (w.params ? coordHash(w.params) : '');
                        return { ...w, isImported: true, coordId, id: 'wp_imp_' + Date.now() + '_' + i };
                    });
                const have = new Set((window.waypoints || []).map(w => w.coordId));
                const add = [];
                for (const w of incoming) {
                    if (w.coordId && !have.has(w.coordId)) { have.add(w.coordId); add.push(w); }
                }
                window.waypoints = add.concat(window.waypoints || []);
                if (window.saveWP) window.saveWP();
            }

            applyTheme(); applyButtonShape();
            if (window.engine) window.engine.updateUniforms();
            if (window.buildUI) window.buildUI(window.engine);
            alert('Imported successfully.');
        } catch (err) {
            // Don't include err.message — even though alert() is text-only,
            // a parse error from a malformed file can surface attacker-
            // controlled JSON fragments and there's no diagnostic value
            // beyond "the file was bad" for end users.
            alert('Import failed. The file may be corrupt or in the wrong format.');
        }
    };
    reader.readAsText(file);
}


window.exportSaveFile = exportSaveFile;
window.importSaveFile = importSaveFile;

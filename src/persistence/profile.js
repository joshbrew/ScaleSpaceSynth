import { sanitizeName } from '../core/utils.js';
import { SS_VERSION } from '../core/state.js';
import { _isFiniteNumber } from '../core/validation.js';

// ─── Profile ───────────────────────────────────────────────────────────────
// User-facing ident: username + server-clock-based ID generated on first run.
// Stamped onto every waypoint captured going forward,
// ready for multiplayer when it ships.
// Username is freely editable; ID is immutable.

export function loadOrCreateProfile() {
    let profile = null;
    try {
        const saved = localStorage.getItem('ss_profile');
        if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                // Reconstruct field-by-field with sanitization rather than
                // trusting whatever shape was on disk. id and buildVersion
                // are opaque tokens (length-cap only); username is displayed
                // so it goes through sanitizeName.
                const id = typeof parsed.id === 'string' ? parsed.id.slice(0, 100) : '';
                if (id) {
                    profile = {
                        id,
                        username: sanitizeName(parsed.username, { maxLen: 32 }),
                        createdAt: _isFiniteNumber(parsed.createdAt) ? parsed.createdAt : Date.now(),
                        buildVersion: typeof parsed.buildVersion === 'string'
                            ? parsed.buildVersion.slice(0, 20)
                            : SS_VERSION
                    };
                }
            }
        }
    } catch (e) { /* fall through */ }

    if (!profile) {
        profile = {
            id: Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
            username: '',
            createdAt: Date.now(),
            buildVersion: SS_VERSION
        };
        try { localStorage.setItem('ss_profile', JSON.stringify(profile)); } catch (e) {}
    }
    return profile;
}

export function saveProfile() {
    if (!window.profile) return;
    try { localStorage.setItem('ss_profile', JSON.stringify(window.profile)); } catch (e) {}
}


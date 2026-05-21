# Security Review

_This document records the pre-release security review conducted for Scale Space Synthesist. It was drafted by Claude (Anthropic's Claude Opus 4.7 model) during the OSS release preparation, working from a code audit and a series of hardening passes._

## Scope and Threat Model

Scale Space Synthesist is a single-page client-side application: WebGPU/Three.js particle visualizer with no backend, no authentication, and no network calls beyond loading its own assets. State is persisted to `localStorage`. The app accepts data from three external sources:

1. **Save-file imports** — JSON files the user uploads via the Load button in the Profile pane.
2. **Share-code imports** — `SS1:…` base64-encoded strings (DEFLATE-compressed JSON) pasted into the Atlas import field.
3. **Existing `localStorage` state** — could be tampered with by another script running on the same origin, or by a user manually editing it via DevTools.

The threat model assumes a hostile actor could craft any of these inputs. The application has no server to attack and no credentials to steal, so the realistic risks reduce to:

- **DOM-based XSS** via injected HTML, JavaScript, or event handlers if any user-controlled string were inserted into the DOM unescaped.
- **Denial of service** via pathological inputs (gigantic strings, deeply nested structures, billions of waypoints) that could exhaust memory or freeze the renderer.
- **Persistence attacks** where a malicious save-file leaves the app in a state that re-attacks the user on every subsequent load.

There is no realistic attack surface for data exfiltration, privilege escalation, or remote code execution in the absence of a server.

## Findings and Mitigations

### Issue: Unbounded `Object.assign` during save-file import (HIGH)

The original save-file import did roughly:

```js
Object.assign(window.S, data.settings);
```

This trusted every key/value in the incoming JSON. A malicious save-file could set arbitrary state — including keys the application uses to drive DOM rendering — which then flowed into `innerHTML`-style template strings elsewhere in the codebase. This was the largest single source of XSS surface in the audit.

**Mitigation:** Implemented an allowlist hydration function (`hydrateState`) that walks the incoming object, validates each key against the application's `DEFAULTS` schema, type-checks values, and applies bound clamps from `_STATE_CLAMPS`. Unknown keys are dropped silently. Tampered types fall back to the schema default. The unbounded `Object.assign` is gone.

```js
function hydrateState(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    const defaults = window.DEFAULTS;
    if (!defaults) return;
    for (const key of Object.keys(defaults)) {
        const incoming = raw[key];
        // Type-check against the default, clamp numeric ranges, etc.
        // Unknown keys (anything not in DEFAULTS) are ignored.
    }
}
```

### Issue: Waypoint validation gaps allowed structurally-broken data (HIGH)

Imported waypoints (from save files or share strings) were applied with minimal validation. A waypoint with a non-string `name`, a `params` object containing functions, or an array where an object was expected could either crash the renderer or leave the app in an inconsistent state.

**Mitigation:** Implemented `validateWaypoint(w)` as a strict allowlist validator. It rebuilds each waypoint field-by-field, type-checking every property and dropping anything that fails. Numeric fields are clamped to their declared ranges; string fields run through `sanitizeName` (see below); arrays are length- and content-checked; unknown fields are discarded entirely. Any waypoint that fails validation returns `null` and is filtered out of the import.

The import pipeline now reads:

```js
window.waypoints = data.waypoints
    .map(w => validateWaypoint(w))
    .filter(Boolean);
```

### Issue: Untrusted strings flowed into `innerHTML` template strings (HIGH)

Several UI surfaces interpolated user-controlled strings — waypoint names, profile usernames, category names, share-string `exportedFrom` field — into `innerHTML` assignments without escaping. A waypoint named `<script>...</script>` would execute on import.

**Mitigation:** Two-part fix:

1. **`sanitizeName(s, opts)`** strips C0/C1 control characters, applies a configurable length cap (default 200, lower for fields like usernames), and trims whitespace. Used at the boundary of every untrusted string entering app state.

2. **DOM construction replacing `innerHTML` at trust boundaries.** For elements rendering user-controlled content (atlas category headers, waypoint cards, profile UI, delete-confirmation modals, share-string `exportedFrom` displays), switched from `innerHTML` template literals to `createElement` + `textContent`. `textContent` does not parse HTML, so even an unsanitized control character would render as a literal character, not as markup.

### Issue: Multi-attribute XSS in slider value attribute (MEDIUM)

The `makeSlider` function originally built its `<input type="range">` with the value attribute as part of an `innerHTML` template literal. If a stored value were ever a string containing `" onmouseover="...`, the attribute could break out and inject an event handler.

In practice, all slider values flow through numeric clamping, so this was a defense-in-depth concern rather than an exploitable path. We hardened it anyway because the slider system is core infrastructure.

**Mitigation:** Validate the value is a finite number before interpolation. Type coercion via `Number()` and explicit `Number.isFinite` check; non-numeric values fall back to the slider's `min` value.

### Issue: Panel-position restore from `localStorage` accepted arbitrary CSS strings (MEDIUM)

The `loadPanelPos()` function restored panel positions from `localStorage` by writing the stored value directly into `style.left` and `style.top`. A tampered `localStorage` entry could inject CSS expressions, `url(javascript:...)` patterns (in old browsers), or arbitrary length units that could be used as part of a layout-disruption attack.

**Mitigation:** Added `_safeCssLen(v)` validator that accepts only `-?\d+(\.\d+)?(px|%)?` patterns. Anything else returns an empty string, which clears the inline style and lets CSS defaults take over. Applied to every CSS length value read from `localStorage`.

```js
const _CSS_LEN_RE = /^-?\d+(?:\.\d+)?(?:px|%)?$/;
function _safeCssLen(v) {
    return (typeof v === 'string' && _CSS_LEN_RE.test(v)) ? v : '';
}
```

### Issue: File-size DoS on import (LOW)

A maliciously large save file could be loaded with no upper bound, potentially exhausting browser memory before parsing could be aborted.

**Mitigation:** Added a 200MB file-size check before `FileReader.readAsText`. Typical save files are under 5MB even with embedded thumbnails; 200MB is a generous safety margin against accidental selection of the wrong file and a hard limit against intentional DoS.

### Issue: Error messages leaked input fragments (LOW)

The original import error handler interpolated `err.message` into the alert text. For malformed JSON, this could surface attacker-controlled fragments to the user.

**Mitigation:** Error messages are now generic (`"Import failed. The file may be corrupt or in the wrong format."`) and do not include any portion of the input. The actual error is still logged to the console for developer debugging.

### Issue: Share-string author field could surface untrusted content in confirm dialogs (LOW)

When importing a share string, the `exportedFrom` field was displayed in a confirmation dialog. Although `confirm()` is text-only and can't render HTML, a maliciously long or control-character-laden `exportedFrom` could disrupt the dialog's readability or be used in social-engineering attempts.

**Mitigation:** All fields displayed in confirmation dialogs run through `sanitizeName` with appropriate length caps (60 for `exportedFrom`, 32 for usernames, 50 for timestamps). Control characters are stripped; lengths are bounded.

## Hardening Patterns Adopted Project-Wide

Beyond the specific issues above, the codebase now follows these patterns consistently:

- **Allowlist over blocklist.** Every external input flows through a validator that names what's allowed; anything else is dropped. No attempt is made to "clean" attacker-controlled data; we just don't accept it.
- **`textContent` for any user-controlled string.** The `innerHTML` usage that remains is limited to fully-trusted internal template strings (Claude reviewed each remaining instance individually).
- **Trust boundary validators are run once at the boundary.** A waypoint that passes `validateWaypoint` on import is considered safe for downstream code; we don't re-validate every time we read its fields, which would be tedious and would create the temptation to skip validations in performance-critical paths.
- **Defense in depth on values that drive resource allocation.** `freeEnergy` retains a hard ceiling (`1_000_000`) on hydrate because it sizes a GPU buffer at startup. Most other parameters are clamped only by their physical meaning (e.g. `opacity` is `[0, 1]`).
- **Same validators on every input path.** Save-file imports, share-string imports, and `localStorage` hydration all route through `hydrateState`, `validateWaypoint`, and `sanitizeName`. There is no shorter path that bypasses these helpers.

## Out of Scope

- **Network attacks.** The application makes no network calls beyond loading its own assets. There is no API surface to attack.
- **Cross-origin attacks.** Standard same-origin policy applies. The application does not embed itself in iframes nor expose any postMessage handlers.
- **Cryptographic integrity.** Share strings are compressed, not signed. A recipient cannot verify who created a share string. The `authorName` field is purely social attribution and is documented as such — anyone can claim any attribution. This is by design; signed share strings would require a key infrastructure that doesn't fit a fully offline single-page app.
- **Browser-level vulnerabilities.** We assume the browser correctly enforces its own security model (CSP, same-origin, WebGPU sandboxing). If the browser is exploitable, no application-level mitigation will help.

## Verification

Each mitigation was implemented and verified by:

1. Reading the change in context to confirm the validator covers the intended path.
2. Running the project's build (`vite build`) to confirm no syntax regressions.
3. Manual testing of the import paths with both valid and intentionally malformed inputs.

There is no automated test suite for these security properties. The codebase is small enough that the validators are inspectable by hand, and the patterns are uniform enough that an auditor can grep for `sanitizeName`, `validateWaypoint`, and `hydrateState` to find every trust boundary.

## Open Items

- **No CSP header.** The app is a single HTML file delivered as a static asset; adding a Content Security Policy via a `<meta>` tag is straightforward and would close one residual class of issues (inline event handlers in dynamically generated content), but was not done in this review.
- **`localStorage` is not write-protected from other scripts on the same origin.** Anything hosting this app on a domain shared with other applications should be aware that those applications can modify Scale Space Synthesist's saved state.
- **No rate-limiting on imports.** A user could in principle import a malformed file in a loop to slow their own browser. Since the user is the only person with this capability and the consequence is self-inflicted, this is not mitigated.

## Author's Note

This review represents what we found by reading the code carefully and thinking adversarially about each input path. It does not claim to be exhaustive — no security review of any non-trivial codebase is. The mitigations above address every issue we identified; there may be issues we did not identify. Pull requests reporting additional findings are welcome.

The codebase prior to this review was not vulnerable in any way that produced observed harm; the project had not been distributed publicly. The review was conducted as part of preparing for the OSS release so that the first public version would not ship with the most predictable classes of issues unaddressed.

---

_Reviewed and documented by Claude (Anthropic) during the v1 OSS release prep. Implementation by setz._

import { fadeColorModeChange, fadeVisibilityKey, formatToggleState, visibilityAlphaForKey, VISIBILITY_XFADE_KEYS } from '../atlas/atlas.js';
import { formatParamValue } from './toast.js';
import { applyTheme, applyButtonShape } from './theme.js';
import { createRadialControlSets } from './radial-controls.js';

// ───────────────────────────────────────────────────────────────────────────
//   5. RadialUI
// ───────────────────────────────────────────────────────────────────────────

export function initRadialUI() {

    console.log(
        '%c Scale Space Synthesist %c v' + (window.SS_VERSION || '0.1') + ' \n' +
        '%c r/ScaleSpace: %chttps://reddit.com/r/ScaleSpace\n' +
        '%c itch.io:      %chttps://setzstone.itch.io/scale-space',
        'background:#ffaa55;color:#0c0c1f;font-weight:bold;padding:3px 6px;border-radius:2px 0 0 2px;',
        'background:#2a1f15;color:#ffaa55;padding:3px 6px;border-radius:0 2px 2px 0;',
        'color:#7a9acc;',  'color:#cce6ff;text-decoration:underline;',
        'color:#7a9acc;',  'color:#cce6ff;text-decoration:underline;'
    );
    const { systemControls, environmentControls, configControls } = createRadialControlSets();

    const nodeSize = 64;
    
    class RadialInstance {
        constructor(id, controls, reverseAngle) {
            this.id = id;
            this.controls = controls;
            this.reverseAngle = reverseAngle;
            RadialInstance.instances = RadialInstance.instances || [];
            RadialInstance.instances.push(this);
            this.container = document.createElement('div');
            this.container.className = 'radial';
            this.container.id = id;
            this.container.setAttribute('aria-hidden', 'true');
            this.container.innerHTML = `<div class="radial-bg" id="${id}-bg"></div><div class="band" id="${id}-band"></div>
            <div class="radial-lock" id="${id}-lock" title="Lock Menu Open">
                <svg viewBox="0 0 24 24" fill="currentColor"><path class="lock-path" d="M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10z"/></svg>
            </div>
            <div class="readout" id="${id}-readout">
                <div class="readout-content">
                    <strong class="title"></strong>
                    <div class="value"></div>
                    <div class="meta"></div>
                    <div class="scope">
                        <svg viewBox="0 0 180 34" preserveAspectRatio="none" aria-hidden="true" style="opacity: 0.82 !important;">
                            <path fill="none" stroke="#ffffff" stroke-width="2" d="M0,17 L180,17"></path>
                        </svg>
                    </div>
                    <div class="toggle-ui" style="display:none;pointer-events:auto;">
                        <div class="opt on" data-val="true" style="cursor:pointer;">ON</div>
                        <div class="opt off" data-val="false" style="cursor:pointer;">OFF</div>
                    </div>
                </div>
            </div>`;
            document.body.appendChild(this.container);

            this.bgGradient = document.getElementById(`${id}-bg`);
            this.band = document.getElementById(`${id}-band`);
            this.readout = document.getElementById(`${id}-readout`);
            
            this.readoutTitle = this.readout.querySelector('.title');
            this.readoutValue = this.readout.querySelector('.value');
            this.readoutMeta = this.readout.querySelector('.meta');
            this.readoutScope = this.readout.querySelector('.scope');
            this.readoutToggleUI = this.readout.querySelector('.toggle-ui');
            this.wavePath = this.readout.querySelector('path');
            
            const onBtn = this.readoutToggleUI.querySelector('[data-val="true"]');
            const offBtn = this.readoutToggleUI.querySelector('[data-val="false"]');
            
            const handleToggleClick = (state) => {
                if (this.active && this.active.control && this.active.control.type === 'toggle') {
                    this.active.toggleState = state;
                    this.setValue(this.active.control, state);
                    this.updateReadout(this.active.control, 0, 0, state);
                }
            };
            
            onBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); handleToggleClick(true); });
            offBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); handleToggleClick(false); });
            
            this.lockIcon = document.getElementById(`${id}-lock`);
            this.lockPath = this.lockIcon.querySelector('.lock-path');
            this.isLocked = false;
            this.hasFlashed = false;
            
            const closedPath = "M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z";
            const openPath = "M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10z";

            this.lockIcon.addEventListener('pointerdown', (e) => {
                e.stopPropagation();
                this.isLocked = !this.isLocked;
                this.hasFlashed = false; // Reset flash state on toggle
                this.lockPath.setAttribute('d', this.isLocked ? "M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" : "M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10z");
                this.lockIcon.classList.toggle('locked', this.isLocked);
                this.flashLock(); // Immediate white flash feedback
                this.saveState();
            });
            
            this.animateWave = this.animateWave.bind(this);
            
            this.active = null;
            this.closeTimer = 0;
            this.closeAnimationTimer = 0;
            this.waveAnimId = null;
            this.openTime = 0;
            this.originPoint = { x: 0, y: 0 };
            this.radialRadius = 140; 
            this.isPinned = false;
            
            // ─── Interaction tracking ──────────────────────────────────────
            this.lastMouseX = 0;
            this.lastMouseY = 0;
            
            this.onPointerMove = this.onPointerMove.bind(this);
            document.addEventListener('pointermove', this.onPointerMove);

            this.loadState();
        }

        saveState() {
            const data = {
                isLocked: this.isLocked,
                originX: this.originPoint.x,
                originY: this.originPoint.y,
                isOpen: this.isOpen
            };
            localStorage.setItem(`ss_radial_state_${this.id}`, JSON.stringify(data));
        }

        loadState() {
            try {
                const saved = localStorage.getItem(`ss_radial_state_${this.id}`);
                if (saved) {
                    const data = JSON.parse(saved);
                    this.isLocked = data.isLocked || false;
                    this.originPoint = { x: data.originX || 0, y: data.originY || 0 };
                    
                    if (this.isLocked) {
                        this.updateLockOptics();
                    }
                    
                    if (data.isOpen) {
                        // Don't pop the locked radial in before the rest of
                        // the UI exists — that caused a flash on load. Wait
                        // until the panels are marked ready, then restore.
                        const reopen = () => {
                            this.isRestoring = true;
                            this.open(this.originPoint.x, this.originPoint.y);
                            this.isRestoring = false;
                        };
                        const whenReady = () => {
                            if (document.body.classList.contains('ui-ready')) reopen();
                            else requestAnimationFrame(whenReady);
                        };
                        whenReady();
                    }
                }
            } catch (e) { console.error("Radial load error", e); }
        }

        updateLockOptics() {
            const closedPath = "M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z";
            const openPath = "M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10z";
            this.lockPath.setAttribute('d', this.isLocked ? closedPath : openPath);
            this.lockIcon.classList.toggle('locked', this.isLocked);
        }

        get isOpen() { return this.container.classList.contains('open'); }

        clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
        quantize(value, step) { return Number((Math.round(value / step) * step).toFixed(6)); }
        percent(control) { 
            if (control.type === 'toggle') return visibilityAlphaForKey(control.key) * 100;
            if (control.type === 'trigger') return 0;
            if (control.type === 'enum') return (window.S[control.key] / (control.options.length - 1)) * 100;
            return ((window.S[control.key] - control.min) / (control.max - control.min)) * 100; 
        }


        setValue(control, value) { 
            if (control.type === 'toggle') {
                const wasOn = !!window.S[control.key];
                const newOn = !!value;
                if (wasOn === newOn) return; // no-op; don't clear in-flight fade
                window.S[control.key] = newOn;
                // Fade visibility for the layer toggles (Quanta/Strings/
                // Lattice) so radial toggles match the panel-toggle behavior.
                if (VISIBILITY_XFADE_KEYS[control.key]) {
                    fadeVisibilityKey(control.key, wasOn ? 1 : 0, newOn ? 1 : 0);
                }
                // Notify cross-group listeners (e.g. Include sub-group enables
                // when a Save toggle flips). Same pattern as makeGroupToggles.
                const updaters = window._toggleUpdaters && window._toggleUpdaters[control.key];
                if (updaters) updaters.forEach(fn => { try { fn(); } catch (e) {} });
            } else if (control.type === 'enum') {
                // Resolve the requested option, then either fade (colorMode)
                // or assign immediately (other enums).
                let resolved;
                if (control.options.includes(value)) {
                    resolved = value;
                } else {
                    const idx = Math.max(0, Math.min(control.options.length - 1, Math.round(value)));
                    resolved = control.options[idx];
                }
                if (control.key === 'colorMode' && window.S.colorMode !== resolved) {
                    // V-envelope fade. The helper handles the discrete flip
                    // at the trough and persists state at completion.
                    fadeColorModeChange(resolved);
                } else {
                    window.S[control.key] = resolved;
                }
            } else {
                // Match the panel slider's Bound/Unbound behavior.
                // Bounded mode clamps to the radial control range; Unbound mode
                // passes creative out-of-range values through except for keys
                // the core explicitly floors/clamps. This lets Turbulence run
                // positive or negative while still keeping dangerous values safe.
                const q = this.quantize(value, control.step);
                const clampFn = window.clampForBoundlessMode || ((key, v, lo, hi) => Math.max(lo, Math.min(hi, v)));
                window.S[control.key] = clampFn(control.key, q, control.min, control.max);

                if (control.key === 'uiZoom') {
                    document.documentElement.style.setProperty('--ui-zoom', window.S[control.key]);
                }

                if (window.sliderSync && window.sliderSync[control.key]) {
                    window.sliderSync[control.key](window.S[control.key]);
                }
            }
            
            if (window.engine) window.engine.updateUniforms();
            this.updateActiveNode(control); 

            // Live readout toast — same as the slider's. Resolves the
            // displayed value differently for enum vs numeric controls
            // because enums show their label string, not a number.
            if (window.showParamToast) {
                let displayVal;
                if (control.type === 'enum') {
                    const idx = control.options.indexOf(window.S[control.key]);
                    displayVal = idx >= 0 ? control.labels[idx] : String(window.S[control.key]);
                } else if (control.type === 'toggle') {
                    displayVal = window.S[control.key] ? 'on' : 'off';
                } else {
                    displayVal = formatParamValue(window.S[control.key]);
                }
                window.showParamToast(control.label || control.key, displayVal);
            }

            // Side-effect hooks for keys that need follow-up beyond just updating window.S. Theme/shape changes need apply functions.
            try {
                if (control.key === 'theme' || control.key === 'uiScanlines' || control.key === 'screenScanlines') {
                    applyTheme();
                } else if (control.key === 'buttonShape') {
                    applyButtonShape();
                }
            } catch (e) { /* side-effect must never break setValue */ }
        }

        setModulation(control, value) {
            const key = control.key + '_mod';
            window.S[key] = this.clamp(value, 0, 1);
            // Persistent storage
            try { localStorage.setItem('ss_state', JSON.stringify(window.S)); } catch (e) { }
            if (window.engine) window.engine.updateUniforms();
            this.updateActiveNode(control);
        }

        colorForPercent(value, alpha = 'var(--btn-alpha, 0.8)') {
            const pct = this.clamp(value, 0, 100) / 100;
            const hue = 208 - pct * 122;
            const light = 26 + pct * 12;
            return `hsl(${hue} 46% ${light}% / ${alpha})`;
        }

        layoutSlots(count = (this.controls ? this.controls.length : 12)) {
            // Menus can now exceed the original 12-slot radial layout. Return
            // one slot per control so build() never indexes an undefined slot
            // when a menu gets an extra setting such as Perf Mode.
            const total = Math.max(1, Number(count) || 12);
            const slots = [];

            // Circle layout: distribute every item evenly around one ring.
            if ((window.S?.buttonShape || 'hex') === 'circle') {
                const radius = total > 12 ? 155 : 145;
                for (let i = 0; i < total; i++) {
                    const angle = (i / total) * Math.PI * 2 - Math.PI / 2;
                    slots.push({
                        dx: Math.cos(angle) * radius,
                        dy: Math.sin(angle) * radius
                    });
                }
                return slots;
            }

            // Hex layout: keep the original 12 honeycomb positions, then place
            // any overflow controls on a gentle outer ring instead of crashing.
            const r2Hexes = [
                {q: 0, r: -2},  // 0: Top
                {q: 1, r: -2},  // 1: Top-Right
                {q: 2, r: -2},  // 2: Top-Right-Right
                {q: 2, r: -1},  // 3: Right
                {q: 2, r: 0},   // 4: Bottom-Right-Right
                {q: 1, r: 1},   // 5: Bottom-Right
                {q: 0, r: 2},   // 6: Bottom
                {q: -1, r: 2},  // 7: Bottom-Left
                {q: -2, r: 2},  // 8: Bottom-Left-Left
                {q: -2, r: 1},  // 9: Left
                {q: -2, r: 0},  // 10: Top-Left-Left
                {q: -1, r: -1}  // 11: Top-Left
            ];
            for (let i = 0; i < Math.min(12, total); i++) {
                const q = r2Hexes[i].q;
                const r = r2Hexes[i].r;
                slots.push({ dx: q * 58.5 * 1.04, dy: (q * 34 + r * 68) * 1.04 });
            }
            const extra = total - slots.length;
            if (extra > 0) {
                const outerRadius = 205;
                for (let i = 0; i < extra; i++) {
                    const angle = (i / extra) * Math.PI * 2 - Math.PI / 2;
                    slots.push({ dx: Math.cos(angle) * outerRadius, dy: Math.sin(angle) * outerRadius });
                }
            }
            return slots;
        }

        // Recompute and apply slot positions to existing nodes. Called when the button shape changes (hex ↔ circle) so layout switches live.
        relayoutNodes() {
            const slots = this.layoutSlots();
            this.nodes.forEach((node, index) => {
                const slot = slots[index];
                if (!slot) return;
                const homeX = this.originPoint.x + slot.dx;
                const homeY = this.originPoint.y + slot.dy;
                node.dataset.homeX = homeX.toString();
                node.dataset.homeY = homeY.toString();
                node.style.left = `${homeX}px`;
                node.style.top  = `${homeY}px`;
            });
        }

        updateActiveNode(control) {
            const node = this.container.querySelector(`[data-key="${control.key}"]`);
            if (node) {
                let valStr = '';
                if (control.type === 'toggle') valStr = formatToggleState(control.key);
                else if (control.type === 'enum') valStr = control.labels[control.options.indexOf(window.S[control.key])];
                else if (control.type === 'trigger') valStr = 'ACTIVATE';
                else valStr = (window.S[control.key] !== undefined) ? control.format(window.S[control.key]) : '0.00';
                
                const em = node.querySelector('em');
                if (em) em.textContent = valStr;
                node.setAttribute('aria-label', `${control.label}: ${valStr}`);
                node.style.setProperty('--value-color', this.colorForPercent(this.percent(control)));
            }
            if (this.active && this.active.control === control) {
                this.updateReadout(control, this.active.delta, this.active.modulation, this.active.toggleState);
            }
        }

        updateNodeContent(idx) {
            const node = this.nodes[idx];
            const control = this.controls[idx];
            if (!node) return;

            if (control === null) {
                node.classList.add('empty-slot');
                node.dataset.key = '';
                node.innerHTML = `<div class="hex-fill"></div><div class="hex-stroke-wrap"><svg viewBox="0 0 78 68"><polygon points="21.45,2.04 56.55,2.04 75.66,34 56.55,65.96 21.45,65.96 2.34,34"/></svg></div>`;
                return;
            }

            node.classList.remove('empty-slot');
            node.dataset.key = control.key;
            
            let valStr = '';
            try {
                if (control.type === 'toggle') valStr = formatToggleState(control.key);
                else if (control.type === 'enum') valStr = control.labels[control.options.indexOf(window.S[control.key])];
                else if (control.type === 'trigger') valStr = 'ACTIVATE';
                else valStr = (window.S[control.key] !== undefined) ? control.format(window.S[control.key]) : '0.00';
            } catch (e) { valStr = '---'; }

            let label = control.label;
            if (control.key === 'startTour' && window.tour && window.tour.active) {
                label = 'Pause Tour';
                valStr = '';
            }

            node.style.setProperty('--value-color', this.colorForPercent(this.percent(control)));
            node.innerHTML = `
                <div class="hex-fill"></div><div class="hex-stroke-wrap"><svg viewBox="0 0 78 68"><polygon points="21.45,2.04 56.55,2.04 75.66,34 56.55,65.96 21.45,65.96 2.34,34"/></svg></div>
                <span><strong>${label}</strong><em>${valStr}</em></span>`;
        }

        open(x, y) {
            // If already locked and open, do nothing
			// (prevents accidental unlocking/moving)
            if (this.isLocked && this.isOpen) return; 
            
            // Only reset lock if it was CLOSED (fresh manual open)
            if (!this.isOpen && !this.isRestoring) {
                this.isLocked = false;
                this.updateLockOptics();
            }
            
            clearTimeout(this.closeTimer);
            
            // If restoring from saved state, x/y are already layout pixels.
			// If from a mouse click, they are screen pixels and need division.
            const zoom = window.S.uiZoom || 1.0;
            const layoutX = x / zoom;
            const layoutY = y / zoom;
            
            this.build(layoutX, layoutY);
            
            this.container.classList.add('opening');
            this.saveState();
            setTimeout(() => this.container.classList.remove('opening'), 300);
        }

        build(x, y) {
            clearTimeout(this.closeAnimationTimer);
            this.container.classList.remove('open', 'closing', 'dragging', 'clicked');
            this.container.querySelectorAll('.radial-node').forEach(node => node.remove());
            this.isPinned = false;
            this.pinnedNode = null;
            this.openTime = performance.now();
            
            const slots = this.layoutSlots(this.controls.length);
            this.radialRadius = 140; // Fixed radius to account for inner hole
            
            const layoutW = window.innerWidth / Math.max(0.25, Number(window.S?.uiZoom) || 1.0);
            const layoutH = window.innerHeight / Math.max(0.25, Number(window.S?.uiZoom) || 1.0);
            this.originPoint.x = this.clamp(x, this.radialRadius + nodeSize / 2 + 14, layoutW - this.radialRadius - nodeSize / 2 - 14);
            this.originPoint.y = this.clamp(y, this.radialRadius + nodeSize / 2 + 14, layoutH - this.radialRadius - nodeSize / 2 - 14);
            
            this.container.style.setProperty('--origin-x', `${this.originPoint.x}px`);
            this.container.style.setProperty('--origin-y', `${this.originPoint.y}px`);
            this.band.style.left = `${this.originPoint.x}px`;
            this.band.style.top = `${this.originPoint.y}px`;
            this.band.style.opacity = '0';
            this.readout.style.left = `${this.originPoint.x}px`;
            this.readout.style.top = `${this.originPoint.y}px`;
            
            this.lockIcon.style.left = `${this.originPoint.x}px`;
            this.lockIcon.style.top = `${this.originPoint.y + 71}px`;
            this.lockIcon.style.display = 'grid';
            
			// ─── Set Default Menu Title when opening ───────────────────────
            this.showDefaultReadout();
            this.readout.classList.add('visible');
            this.bgGradient.classList.add('visible');
            
            this.nodes = []; // Track DOM nodes perfectly 1:1 with controls
            
            this.controls.forEach((control, index) => {
                const slot = slots[index] || { dx: 0, dy: 0 };
                const dx = Number(slot.dx) || 0;
                const dy = Number(slot.dy) || 0;
                const homeX = this.originPoint.x + dx;
                const homeY = this.originPoint.y + dy;
                
                const node = document.createElement('button');
                node.addEventListener('mousedown', e => { if(e.button === 1) e.preventDefault(); });
                node.type = 'button';
                node.className = 'radial-node';
                node.dataset.homeX = homeX.toString();
                node.dataset.homeY = homeY.toString();
                node.style.left = `${homeX}px`;
                node.style.top = `${homeY}px`;
                node.style.setProperty('--delay', `${index * 15}ms`);
                
                this.nodes.push(node);
                this.container.appendChild(node);
                this.updateNodeContent(index);
                
                node.addEventListener('pointerdown', event => this.startDrag(event, control, node));
                
                node.getBoundingClientRect(); 
                
                requestAnimationFrame(() => {
                    this.container.classList.add('open');
                });
            });
            this.container.setAttribute('aria-hidden', 'false');
        }

        // Restore the radial center to its default "menu title" state — used
        // both when first opening a menu and when a pinned node is re-clicked
        // to dismiss its readout (return-to-default UX).
        showDefaultReadout() {
            const titleMap = { 'radial-system': 'PARAMETERS', 'radial-environment': 'VISUALS', 'radial-config': 'CONFIG' };
            this.readoutTitle.textContent = titleMap[this.id] || '';
            this.readoutTitle.style.display = 'block';
            this.readoutValue.style.display = 'none';
            this.readoutMeta.style.display = 'none';
            this.readoutScope.style.display = 'none';
            this.readoutToggleUI.style.display = 'none';
            if (this.waveAnimId) { cancelAnimationFrame(this.waveAnimId); this.waveAnimId = null; }
        }

        startDrag(event, control, node) {
            if (!control) return;
            if (event.button > 2) return;
            // Only enforce open-cooldown on the very first grab after menu open (no active drag yet)
            if (!this.active && performance.now() - this.openTime < 280) return;
            
            event.preventDefault();
            event.stopPropagation();
            clearTimeout(this.closeTimer);
            const originX = parseFloat(this.container.style.getPropertyValue('--origin-x'));
            const originY = parseFloat(this.container.style.getPropertyValue('--origin-y'));
            
            // Center is already in layout pixels
            const centerX = originX;
            const centerY = originY;
            
            let baseValue = window.S[control.key];
            if (control.type === 'enum') {
                baseValue = control.options.indexOf(baseValue);
                if (baseValue === -1) baseValue = 0; 
            } else if (control.type === 'toggle') {
                baseValue = baseValue ? 0 : 1; 
            }

            if (this.active && this.active.node !== node) {
                this.active.node.classList.remove('active');
                this.active.node.style.pointerEvents = 'auto';
            }

                const zoom = window.S.uiZoom || 1.0;
                this.active = { 
                    control, 
                    node, 
                    grabX: event.clientX / zoom, 
                    grabY: event.clientY / zoom, 
                    grabOffsetX: parseFloat(node.dataset.homeX) - (event.clientX / zoom), 
                    grabOffsetY: parseFloat(node.dataset.homeY) - (event.clientY / zoom), 
                startZoom: zoom,
                baseValue: baseValue, 
                delta: 0, 
                modulation: 0,
                buttonPressed: event.button, 
                toggleState: window.S[control.key],
                isDrag: false,
                baseModulation: window.S[control.key + '_mod'] || 0
            };
            
            node.classList.add('active');
            node.style.transition = 'none';
            this.container.classList.remove('clicked');
            
            node.setPointerCapture(event.pointerId);
            
            this.dragMoveHandler = e => this.onDrag(e);
            this.dragStopHandler = e => this.stopDrag(e);
            node.addEventListener('pointermove', this.dragMoveHandler);
            node.addEventListener('pointerup', this.dragStopHandler, { once: true });
            node.addEventListener('pointercancel', this.dragStopHandler, { once: true });
            
            this.band.style.opacity = '0';
            this.lastSwapTime = 0; // Reset cooldown
            this.updateReadout(control, 0, 0, this.active.toggleState);
        }

        onDrag(event) {
            if (!this.active) return;
            const control = this.active.control;
            const zoom = this.active.startZoom || 1.0;
            const dx = (event.clientX / zoom) - this.active.grabX;
            const dy = (event.clientY / zoom) - this.active.grabY;
            
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                if (!this.active.isDrag) {
                    this.active.isDrag = true;
                    if (this.active.buttonPressed === 1) {
						
						// ─── Reorder mode ──────────────────────────────────
                        this.container.classList.add('dragging-reorder');
                        this.active.reorderFromIdx = this.nodes.indexOf(this.active.node);
                        this.active.reorderHoverIdx = undefined;
                        this.active.node.classList.add('reorder-active');
                        this.active.node.classList.remove('active');
                        // Create ghost placeholder at home position
                        const ghost = document.createElement('div');
                        ghost.className = 'radial-node reorder-ghost';
                        ghost.innerHTML = `<div class="hex-fill"></div><div class="hex-stroke-wrap"><svg viewBox="0 0 78 68"><polygon points="21.45,2.04 56.55,2.04 75.66,34 56.55,65.96 21.45,65.96 2.34,34"/></svg></div>`;
                        ghost.style.left = this.active.node.dataset.homeX + 'px';
                        ghost.style.top  = this.active.node.dataset.homeY + 'px';
                        ghost.style.position = 'absolute';
                        ghost.style.transform = 'translate(-50%,-50%)';
                        ghost.style.width = '78px';
                        ghost.style.height = '68px';
                        ghost.style.opacity = '1';
                        ghost.style.zIndex = '108';
                        ghost.style.pointerEvents = 'none';
                        this.container.appendChild(ghost);
                        this.active.ghost = ghost;
                    } else if (control.key !== 'buttonOpacity') {
                        this.container.classList.add('dragging');
                    }
                }
            }
            
            if (!this.active.isDrag) return;
            
            const originX = parseFloat(this.container.style.getPropertyValue('--origin-x'));
            const originY = parseFloat(this.container.style.getPropertyValue('--origin-y'));
            
            // New origin point in layout pixels
            let nodeX = (event.clientX / zoom) + this.active.grabOffsetX;
            let nodeY = (event.clientY / zoom) + this.active.grabOffsetY;
            
            // Middle mouse = reorder only — skip ALL value-change logic
            if (this.active.buttonPressed === 1) {
                // fall through to reorder block below
            }
            // Left (0) and Right (2) clicks only — middle mouse is reorder-only, never changes value
            else if (control.type === 'toggle' || control.type === 'enum') {
                const options = (control.type === 'enum') ? control.options : [true, false]; // ON is index 0
                const steps = options.length;
                const stepSize = 40; // Pixels per discrete step
                
                const currentDy = (event.clientY / this.active.startZoom) - this.active.grabY;
                const index = this.clamp(this.active.baseValue + Math.round(currentDy / stepSize), 0, steps - 1);
                
                if (control.type === 'enum') {
                    this.setValue(control, options[index]);
                } else {
                    this.setValue(control, options[index]); // true for 0, false for 1
                }
                
                const hx = parseFloat(this.active.node.dataset.homeX);
                const hy = parseFloat(this.active.node.dataset.homeY);
                
                // Snap node position relative to its HOME position
                nodeY = hy + (index - this.active.baseValue) * stepSize;
                nodeX = hx; 
                this.active.toggleState = options[index];
            } else if (control.type === 'trigger') {
                // Triggers do NOT move or update in onDrag
                return;
            } else {
                let dragAmount = 0;
                const isXY = (event.buttons === 3); // Both left and right buttons held
                
                if (isXY) {
                    // Unified 2D: Y=Value, X=Modulation
                    dragAmount = -dy; 
                    this.active.modulation = this.clamp(this.active.baseModulation + dx / 400, 0, 1);
                } else if (this.active.buttonPressed === 0) {
                    // Left click ONLY: Y axis (Vertical) for Parameter Value
                    dragAmount = -dy;
                    nodeX = this.active.grabX + this.active.grabOffsetX; // Lock Horizontal
                    this.active.modulation = this.active.baseModulation;
                } else if (this.active.buttonPressed === 2) {
                    // Right click ONLY: X axis (Horizontal) for Oscillation Wave (Modulation)
                    dragAmount = 0; 
                    nodeY = this.active.grabY + this.active.grabOffsetY; // Lock Vertical
                    this.active.modulation = this.clamp(this.active.baseModulation + dx / 400, 0, 1);
                }
                
                this.active.delta = dragAmount * control.sensitivity;
                this.setValue(control, this.active.baseValue + this.active.delta);
                if (this.active.modulation !== this.active.baseModulation) {
                    this.setModulation(control, this.active.modulation);
                }
            }
            
            // ─── Reorder (middle-click) ────────────────────────────────────
            if (this.active.buttonPressed === 1) {
                // Node follows mouse freely
                this.active.node.style.left = `${nodeX}px`;
                this.active.node.style.top  = `${nodeY}px`;
                
                // Find closest slot
                let closestIdx = -1;
                let closestDist = Infinity;
                this.nodes.forEach((n, i) => {
                    if (i === this.active.reorderFromIdx) return;
                    const hx = parseFloat(n.dataset.homeX);
                    const hy = parseFloat(n.dataset.homeY);
                    const d = Math.hypot(nodeX - hx, nodeY - hy);
                    if (d < closestDist) { closestDist = d; closestIdx = i; }
                });
                
                // Highlight closest target, clear others
                this.nodes.forEach((n, i) => {
                    if (i === this.active.reorderFromIdx) return;
                    if (i === closestIdx && closestDist < 90) {
                        n.classList.add('drop-target');
                        this.active.reorderHoverIdx = closestIdx;
                    } else {
                        n.classList.remove('drop-target');
                    }
                });
                if (closestDist >= 90) this.active.reorderHoverIdx = undefined;
                
                this.updateReadout(control, 0, 0, false);
                return;
            }
            
            // Visual feedback: Move the node and update the rubber band
            this.active.node.style.left = `${nodeX}px`;
            this.active.node.style.top = `${nodeY}px`;
            this.updateBand(nodeX, nodeY);
            
            this.updateReadout(control, this.active.delta, this.active.modulation, this.active.toggleState);
        }

        stopDrag(event) {
            if (event) event.stopPropagation();
            if (!this.active) return;
            const node = this.active.node;
            node.removeEventListener('pointermove', this.dragMoveHandler);
            node.removeEventListener('pointerup', this.dragStopHandler);
            node.removeEventListener('pointercancel', this.dragStopHandler);
            
            node.style.transition = 'transform 190ms ease, border-color 160ms ease, filter 160ms ease, background 160ms ease, left 280ms cubic-bezier(.4,.0,.2,1), top 280ms cubic-bezier(.4,.0,.2,1)';
            node.style.left = `${node.dataset.homeX}px`;
            node.style.top = `${node.dataset.homeY}px`;
            
            if (this.active.buttonPressed === 1 && this.active.isDrag) {
                // Commit reorder
                const dragIdx = this.active.reorderFromIdx;
                const dropIdx = this.active.reorderHoverIdx;
                // Remove ghost
                if (this.active.ghost) { this.active.ghost.remove(); this.active.ghost = null; }
                // Restore node class
                node.classList.remove('reorder-active');
                node.classList.add('active');
                if (dragIdx !== undefined && dropIdx !== undefined && dragIdx !== dropIdx) {
                    const tmp = this.controls[dragIdx];
                    this.controls[dragIdx] = this.controls[dropIdx];
                    this.controls[dropIdx] = tmp;
                    try { localStorage.setItem(this.id + '_order', JSON.stringify(this.controls.map(c => c ? c.key : null))); } catch(e) {}
                }
                // Clean up all drag state FIRST
                this.active = null;
                this.container.classList.remove('dragging', 'dragging-reorder', 'clicked');
                this.band.style.opacity = '0';
                // Rebuild in-place
                const ox = this.originPoint.x;
                const oy = this.originPoint.y;
                this.container.querySelectorAll('.radial-node').forEach(n => n.remove());
                this.nodes = [];
                this.build(ox, oy);
                this.container.classList.add('open');
                return;
            }
            
            window.setTimeout(() => {
                if(node) node.style.transition = 'transform 200ms cubic-bezier(.2,.8,.2,1), opacity 340ms ease, border-color 160ms ease, filter 160ms ease, background 160ms ease, left 280ms cubic-bezier(.4,.0,.2,1), top 280ms cubic-bezier(.4,.0,.2,1)';
            }, 220);
            
            this.container.classList.remove('dragging');
            this.container.classList.remove('dragging-reorder');
            this.band.style.opacity = '0';
            
            if (!this.active.isDrag && this.active.buttonPressed !== 1) {
                // Successful click (Not a drag)
                if (this.active.control.type === 'trigger') {
                    // Fire only if still hovering over the button on release
                    const elUnder = document.elementFromPoint(this.lastMouseX, this.lastMouseY);
                    const isOver = elUnder && (elUnder === node || node.contains(elUnder));
                    
                    if (isOver) {
                        if (this.active.control.action) this.active.control.action.call(this);
                        this.flashLock();
                        // Immediate label and readout update
                        const idx = this.nodes.indexOf(node);
                        if (idx !== -1) this.updateNodeContent(idx);
                        this.updateReadout(this.active.control, 0, 0, false);
                    }
                    this.active = null;
                    return;
                }

                // Pin state for other types — but if THIS node is already the
                // pinned one, a second click dismisses it and returns the
                // radial to its default state (matches user expectation).
                if (this.isPinned && this.pinnedNode === node) {
                    this.isPinned = false;
                    this.pinnedNode = null;
                    this.container.classList.remove('clicked');
                    node.classList.remove('active');
                    node.style.pointerEvents = 'auto';
                    this.showDefaultReadout();
                    this.active = null;
                } else {
                    this.isPinned = true;
                    this.pinnedNode = node;
                    this.container.classList.add('clicked');
                }
            } else {
                // Drag ended
                node.classList.remove('active');
                node.style.pointerEvents = 'auto';
                this.active = null;
                this.container.classList.remove('clicked');
                this.saveState();
                this.readoutMeta.style.display = 'none';
                this.readoutScope.style.display = 'none';
                this.readoutToggleUI.style.display = 'none';
            }
            
            try { localStorage.setItem('ss_state', JSON.stringify(window.S)) } catch (e) { }
        }

        updateBand(x, y) {
            if (!this.active) return;
            const hx = parseFloat(this.active.node.dataset.homeX);
            const hy = parseFloat(this.active.node.dataset.homeY);
            const dx = x - hx;
            const dy = y - hy;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            this.band.style.left = `${hx}px`;
            this.band.style.top = `${hy}px`;
            this.band.style.width = `${distance}px`;
            this.band.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
            // Tighter opacity fade for shorter rubber bands
            this.band.style.opacity = `${this.clamp(distance / 120, 0, 0.72)}`;
        }

        updateReadout(control, delta, modulation, toggleState) {
            this.readoutControl = control;
            this.readout.classList.add('visible');
            this.bgGradient.classList.add('visible');
            
            this.readoutTitle.textContent = control.label;
            
            if (this.active && this.active.buttonPressed === 1) {
                this.readoutValue.style.display = 'block';
                this.readoutMeta.style.display = 'block';
                this.readoutScope.style.display = 'none';
                this.readoutToggleUI.style.display = 'none';
                
                this.readoutValue.textContent = 'REORDER';
                this.readoutMeta.innerHTML = 'DRAG TO SWAP POSITIONS';
                return;
            }
            
            if (control.type === 'trigger') {
                this.readoutValue.style.display = 'block';
                this.readoutMeta.style.display = 'block';
                this.readoutScope.style.display = 'none';
                this.readoutToggleUI.style.display = 'none';
                
                if (control.key === 'startTour') {
                    const active = window.tour && window.tour.active;
                    this.readoutTitle.textContent = active ? 'Now Touring' : 'Tour Paused';
                    this.readoutValue.textContent = '';
                    this.readoutMeta.textContent = '';
                } else {
                    this.readoutValue.textContent = 'ACTIVATE';
                    this.readoutMeta.textContent = '';
                }
                return;
            }

            if (control.type === 'toggle') {
                this.readoutValue.style.display = 'none';
                this.readoutMeta.style.display = 'none';
                this.readoutScope.style.display = 'none';
                this.readoutToggleUI.style.display = 'flex';
                this.readoutToggleUI.innerHTML = `<span class="opt" data-val="true">ON</span><span class="opt" data-val="false">OFF</span>`;
                
                const onEl = this.readoutToggleUI.querySelector('[data-val="true"]');
                const offEl = this.readoutToggleUI.querySelector('[data-val="false"]');
                const liveToggleState = (this.active && this.active.control === control)
                    ? toggleState
                    : visibilityAlphaForKey(control.key) > 0.001;
					
                // Use the drag state when active, otherwise reflect live tour visibility.
                if (liveToggleState) { onEl.className = 'opt on'; offEl.className = 'opt'; }
                else { onEl.className = 'opt'; offEl.className = 'opt off'; }

                // Restore clickable options
                this.readoutToggleUI.querySelectorAll('.opt').forEach(opt => {
                    opt.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const newVal = opt.dataset.val === 'true';
                        this.setValue(control, newVal);
                        this.active.toggleState = newVal;
                        this.updateActiveNode(control);
                    });
                });
            } else if (control.type === 'enum') {
                this.readoutValue.style.display = 'none';
                this.readoutMeta.style.display = 'none';
                this.readoutScope.style.display = 'none';
                this.readoutToggleUI.style.display = 'flex';
                
                // Use the passed toggleState for immediate visual feedback during snap-drags
                const currentIdx = control.options.indexOf(toggleState);
                let html = '';
                control.labels.forEach((label, idx) => {
                    const isOn = idx === currentIdx;
                    html += `<span class="opt ${isOn ? 'on' : 'off'}">${label}</span>`;
                });
                this.readoutToggleUI.innerHTML = html;

                // Restore clickable options
                this.readoutToggleUI.querySelectorAll('.opt').forEach((opt, idx) => {
                    opt.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const newVal = control.options[idx];
                        this.setValue(control, newVal);
                        this.active.toggleState = newVal;
                        this.updateActiveNode(control);
                    });
                });
            } else {
                this.readoutValue.style.display = 'block';
                this.readoutMeta.style.display = 'block';
                this.readoutScope.style.display = 'block';
                this.readoutToggleUI.style.display = 'none';

                // TODO: click-to-edit on the readout value. Needs a state
                // machine on RadialInstance to gate edit mode (clean click,
                // no drag), suppress global pointer capture during edit,
                // and an escape path. Non-trivial; deferred.
                this.readoutValue.textContent = control.format(window.S[control.key]);
                const sign = delta >= 0 ? '+' : '-';
                const deltaText = `${sign}${control.format(Math.abs(delta))}`;
                const deltaClass = delta >= 0 ? 'delta-positive' : 'delta-negative';
                this.readoutMeta.innerHTML = `Δ <span class="${deltaClass}">${deltaText}</span> <span style="opacity:0.3;margin:0 4px">·</span> MOD ${Math.round(modulation * 100)}%`;
                
                if (!this.waveAnimId) {
                    this.waveAnimId = requestAnimationFrame(this.animateWave);
                }
            }
        }
        
        animateWave(time) {
            if (!this.readout.classList.contains('visible') && !this.container.classList.contains('dragging')) {
                this.waveAnimId = null;
                return; // Stop animating when hidden
            }
            
            const control = this.active ? this.active.control : null;
            if (!control) {
                this.waveAnimId = requestAnimationFrame(this.animateWave);
                return;
            }
            
            // Wave reflects MODULATION depth, not the parameter value. A
            // waveform is literally oscillation, so binding it to how strongly
            // the param is being modulated is the honest mapping; the numeric
            // readout still carries the value. Read live mod during a drag,
            // else the persisted _mod for this key.
            let modDepth;
            if (this.active && this.active.control === control && typeof this.active.modulation === 'number') {
                modDepth = this.active.modulation;
            } else {
                modDepth = window.S[control.key + '_mod'] || 0;
            }
            modDepth = Math.max(0, Math.min(1, modDepth));

            // Flat line at zero modulation; grows in amplitude and frequency as
            // modulation deepens so the wave visibly "comes alive" with mod.
            const amp = modDepth * 13;
            const freq = 1 + modDepth * 5;
            
            // Time-based phase for continuous oscillation
            const phase = time * 0.005;
            
            // Sample finer (was every 6px → angular at high freq) and emit a
            // smooth Catmull-Rom spline as cubic béziers rather than straight
            // line segments, so the wave reads as a smooth curve at any freq.
            const pts = [];
            for (let x = 0; x <= 180; x += 3) {
                const y = 17 + Math.sin((x / 180) * Math.PI * 2 * freq + phase) * amp;
                pts.push([x, y]);
            }
            let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
            for (let i = 0; i < pts.length - 1; i++) {
                const p0 = pts[i - 1] || pts[i];
                const p1 = pts[i];
                const p2 = pts[i + 1];
                const p3 = pts[i + 2] || p2;
                const c1x = p1[0] + (p2[0] - p0[0]) / 6;
                const c1y = p1[1] + (p2[1] - p0[1]) / 6;
                const c2x = p2[0] - (p3[0] - p1[0]) / 6;
                const c2y = p2[1] - (p3[1] - p1[1]) / 6;
                d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
            }
            this.wavePath.setAttribute('d', d);
            
            // Optionally set color based on value. Wave line uses solid opacity to prevent vanishing when buttons are clear
            this.wavePath.style.stroke = this.colorForPercent(modDepth * 100, 1.0);
            
            this.waveAnimId = requestAnimationFrame(this.animateWave);
        }

        flashLock() {
            this.lockIcon.style.color = '#fff';
            this.lockIcon.style.opacity = '1';
            setTimeout(() => {
                this.lockIcon.style.color = '';
                this.lockIcon.style.opacity = '';
            }, 250);
        }

        scheduleClose(delay = 1200) { 
            if (this.isLocked) return;
            clearTimeout(this.closeTimer); 
            this.closeTimer = window.setTimeout(() => this.close(true), delay); 
        }

        close(animate = true, afterClose) {
            if (this.isLocked && animate) return;
            clearTimeout(this.closeTimer);
            clearTimeout(this.closeAnimationTimer);
            if (!this.container.classList.contains('open')) {
                this.container.classList.remove('closing', 'dragging');
                this.active = null;
                if (afterClose) afterClose();
                return;
            }
            
            this.active = null;
            this.isPinned = false;
            this.container.classList.remove('dragging', 'open', 'clicked'); // Removes open, triggers main opacity fade to 0
            this.readout.classList.remove('visible');
            this.bgGradient.classList.remove('visible');
            this.band.style.opacity = '0';
            // The lock icon is positioned/shown via inline display:grid when the
            // menu opens; close() previously never hid it again, so it lingered
            // as an invisible hit target that still showed its tooltip on hover.
            // Hide it explicitly here.
            if (this.lockIcon) this.lockIcon.style.display = 'none';
            this.saveState();
            
            if (!animate) {
                this.container.classList.remove('closing');
                this.container.setAttribute('aria-hidden', 'true');
                if (afterClose) afterClose();
                return;
            }
            
            this.container.classList.add('closing');
            this.container.querySelectorAll('.radial-node').forEach((node, i) => {
                node.style.setProperty('--delay', `${i * 15}ms`);
                node.style.setProperty('--hscale', '1');
            });
            
            this.closeAnimationTimer = window.setTimeout(() => {
                this.container.classList.remove('closing');
                this.container.setAttribute('aria-hidden', 'true');
                this.container.querySelectorAll('.radial-node').forEach(node => node.remove());
                if (afterClose) afterClose();
            }, 300);
        }

        onPointerMove(event) {
            const zoom = window.S.uiZoom || 1.0;
            const mouseX = event.clientX / zoom;
            const mouseY = event.clientY / zoom;
            
            this.lastMouseX = event.clientX; // Screen space for elementFromPoint
            this.lastMouseY = event.clientY;
            
            if (!this.container.classList.contains('open')) return;
            
            // Check idle distance for Sticky Hover (using layout pixels)
            if (!this.active && !this.isPinned) {
                const dx = mouseX - this.originPoint.x;
                const dy = mouseY - this.originPoint.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                
                // Sticky Hover: Only schedule close if the mouse moves far enough away.
                if (dist > this.radialRadius + 120) {
                    this.scheduleClose(950);
                } else {
                    clearTimeout(this.closeTimer); // Keep open
                }
            }

            // Visual Feedback: Glow on proximity (using layout pixels)
            if (!this.container.classList.contains('dragging') && !this.container.classList.contains('dragging-reorder')) {
                this.container.querySelectorAll('.radial-node:not(.empty-slot)').forEach(node => {
                    const nx = parseFloat(node.dataset.homeX);
                    const ny = parseFloat(node.dataset.homeY);
                    const dx = mouseX - nx;
                    const dy = mouseY - ny;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    
                    let hglow = 0;
                    if (dist < 100) {
                        hglow = Math.max(0, 1 - dist / 60);
                    }
                    node.style.setProperty('--hglow', hglow);
                });
            }
        }
    }

    const sysRadial = new RadialInstance('radial-system', systemControls, false);
    const envRadial = new RadialInstance('radial-environment', environmentControls, true);
    const cfgRadial = new RadialInstance('radial-config', configControls, true); // Middle click

    window.sysRadial = sysRadial;
    window.envRadial = envRadial;
    window.cfgRadial = cfgRadial;
    window.RadialInstance = RadialInstance;

    RadialInstance.refreshAll = function() {
        RadialInstance.instances.forEach(m => {
            if (m.isOpen) {
                m.nodes.forEach((n, i) => m.updateNodeContent(i));
                // Update readout if we have a focused control
                if (m.readoutControl) {
                    m.updateReadout(m.readoutControl, 0, 0, false);
                }
            }
        });
    };
    window.refreshRadialUI = RadialInstance.refreshAll;

	// ─── Global Quick-Click Event Listeners ────────────────────────────────
    let clickStartX = 0;
    let clickStartY = 0;
    let clickStartTime = 0;
    let menuClickButton = -1;
    let menuClickX = 0;
    let menuClickY = 0;
    let menuClickTime = 0;

    const requiresMenuDoubleClick = (button) => button === 0 || button === 2;
    const consumeMenuDoubleClick = (e) => {
        const now = performance.now();
        const dx = e.clientX - menuClickX;
        const dy = e.clientY - menuClickY;
        const isDouble = menuClickButton === e.button && (now - menuClickTime) < 420 && Math.sqrt(dx * dx + dy * dy) < 30;
        menuClickButton = isDouble ? -1 : e.button;
        menuClickX = e.clientX;
        menuClickY = e.clientY;
        menuClickTime = now;
        return isDouble;
    };

    const canvas = document.getElementById('cv') || document.body;
    
    canvas.addEventListener('pointerdown', e => { 
        clickStartX = e.clientX;
        clickStartY = e.clientY;
        clickStartTime = performance.now();
        
        // HARD RULE: Radial can ONLY open if clicking the Play Space (canvas). Never on panels or buttons. Check if target is specifically the canvas or something with no ID inside it? No, just the canvas.
        if (e.target.id !== 'cv') return;
    });

    canvas.addEventListener('pointerup', e => {
        const dx = e.clientX - clickStartX;
        const dy = e.clientY - clickStartY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const time = performance.now() - clickStartTime;
        
        // Handle rapid clicks (swapping, closing, opening) BEFORE node blocking. Now safely reject normal UI interactions, including radial node drags (but NOT if we're swapping)
        if (e.target.id !== 'cv') return;

        // For a click in dead space, handle toggle/move behavior
        if (dist < 10 && time < 400) {
            const clickMap = { 0: sysRadial, 2: envRadial, 1: cfgRadial };
            const targetMenu = clickMap[e.button];
            
            if (targetMenu) {
                if (requiresMenuDoubleClick(e.button) && !consumeMenuDoubleClick(e)) return;
                if (targetMenu.isOpen) {
                    const zoom = window.S.uiZoom || 1.0;
                    const distToCenter = Math.sqrt((e.clientX / zoom - targetMenu.originPoint.x)**2 + (e.clientY / zoom - targetMenu.originPoint.y)**2);
                    if (distToCenter < 100) {
                        if (targetMenu.isLocked) {
                            if (!targetMenu.hasFlashed) {
                                targetMenu.flashLock();
                                targetMenu.hasFlashed = true;
                            }
                        } else {
                            targetMenu.close(true);
                        }
                    } else {
                        // Move: Close other unlocked menus and re-open this one at new spot
                        [sysRadial, envRadial, cfgRadial].forEach(m => {
                            if (m !== targetMenu && !m.isLocked) m.close(true);
                        });
                        targetMenu.open(e.clientX, e.clientY);
                    }
                } else {
                    // Open: Close other unlocked menus and open this one
                    [sysRadial, envRadial, cfgRadial].forEach(m => {
                        if (!m.isLocked) m.close(true);
                    });
                    targetMenu.open(e.clientX, e.clientY);
                }
            } else {
                // Click with unmapped button or in dead space -> close any unlocked
                [sysRadial, envRadial, cfgRadial].forEach(m => {
                    if (!m.isLocked) m.close(true);
                });
            }
        } else {
            if (requiresMenuDoubleClick(e.button)) return;
            // Drag or slow click -> close radials (unless locked OR currently dragging a node)
            if (!sysRadial.isLocked && !sysRadial.active) sysRadial.close(true);
            if (!envRadial.isLocked && !envRadial.active) envRadial.close(true);
            if (!cfgRadial.isLocked && !cfgRadial.active) cfgRadial.close(true);
        }
    });

    // Suppress context menu globally so right-click drag works everywhere
    document.addEventListener('contextmenu', e => { 
        e.preventDefault(); 
    });
    
    document.addEventListener('mousedown', e => {
        if (e.button === 1) e.preventDefault();
    });

    window.addEventListener('keydown', e => {
        // Same skip-text-input rule as the camera handler above — typing
        // into a slider's editable .val span shouldn't dismiss an open
        // radial menu just because you pressed a letter key.
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        if (e.ctrlKey || e.metaKey) return; // Prevent movement when using shortcuts (like Ctrl+S)
        // PageUp / PageDown nudge Tempo (excitation). Time dilation used to
        // live on these keys but was removed pre-release; they now drive tempo.
        if (e.key === 'PageUp' || e.key === 'PageDown') {
            const v = Math.max(0, Math.min(2, (window.S.tempo || 0) + (e.key === 'PageUp' ? 0.05 : -0.05)));
            window.S.tempo = v;
            if (window.sliderSync && window.sliderSync.tempo) window.sliderSync.tempo(v);
            if (window.showParamToast) window.showParamToast('Tempo', v.toFixed(2));
            try { localStorage.setItem('ss_state', JSON.stringify(window.S)); } catch (err) {}
            e.preventDefault();
        }
        // NOTE: the keys[] state for camera movement is owned by engine.setupControls
        // and updated there. This listener only handles UI side-effects (radial close)
        // and shouldn't touch the camera key map.
        sysRadial.close(true);
        envRadial.close(true);
        cfgRadial.close(true);
    });
}

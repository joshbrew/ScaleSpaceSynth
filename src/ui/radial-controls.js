export function createRadialControlSets() {
    const systemControls = [
      { key: 'freeEnergy', label: 'Free Energy', min: 500, max: 1000000, step: 100, sensitivity: 950, format: value => Math.round(value).toLocaleString() },
      { key: 'resolution', label: 'Resolution', min: 0.02, max: 20, step: 0.01, sensitivity: 0.03, format: value => value.toFixed(2) },
      { key: 'scaleDepth', label: 'Scale Depth', min: 0, max: 5, step: 0.01, sensitivity: 0.018, format: value => value.toFixed(2) },
      { key: 'physicsEmergence', label: 'Turbulence', min: -2.5, max: 2.5, step: 0.01, sensitivity: 0.012, format: value => value.toFixed(2) },
      { key: 'equilibrium', label: 'Equilibrium', min: 0.001, max: 0.2, step: 0.001, sensitivity: 0.001, format: value => value.toFixed(3) },
      { key: 'mass', label: 'Mass', min: 0.1, max: 5, step: 0.05, sensitivity: 0.02, format: value => value.toFixed(2) }, null,
      { key: 'viscosity', label: 'Viscosity', min: 0, max: 1, step: 0.01, sensitivity: 0.006, format: value => value.toFixed(2) },
      { key: 'temperature', label: 'Temperature', min: 0, max: 3, step: 0.01, sensitivity: 0.015, format: value => value.toFixed(2) },
      { key: 'coherence', label: 'Coherence', min: 0, max: 200, step: 1, sensitivity: 0.75, format: value => Math.round(value).toString() },
      { key: 'halfLife', label: 'Half-Life', min: 0, max: 30, step: 0.1, sensitivity: 0.12, format: value => value.toFixed(1) },
      { key: 'inversion', label: 'Inversion', min: 30, max: 500, step: 1, sensitivity: 1.8, format: value => Math.round(value).toString() },
      { key: 'tempo', label: 'Tempo', min: 0, max: 2, step: 0.01, sensitivity: 0.012, format: value => value.toFixed(2) }
    ];

    const environmentControls = [
      { key: 'showRibbons', label: 'Strings', type: 'toggle' },
      { key: 'tessRibbons', label: 'Lattice', type: 'toggle' }, null,
      { key: 'trailLen', label: 'Trail Length', min: 3, max: 30, step: 1, sensitivity: 0.15, format: value => Math.round(value).toString() }, null, 
      { key: 'sat', label: 'Color Saturation', min: 0, max: 1.5, step: 0.01, sensitivity: 0.005, format: value => value.toFixed(2) },
      { key: 'colorMode', label: 'Color Mode', type: 'enum', options: [0, 1, 2, 3], labels: ['Mono', 'Size', 'Velocity', 'Density'], sensitivity: 0.02 },
      { key: 'hue', label: 'Color Spectrum Range', min: 0, max: 1, step: 0.01, sensitivity: 0.005, format: value => value.toFixed(2) },
      { key: 'newWaypoint', label: 'New Waypoint', type: 'trigger', action: () => window.captureWaypoint() },
      { key: 'startTour', label: 'Start Tour', type: 'trigger', action: () => { 
          if(window.tour && window.tour.active) { if(window.stopTour) window.stopTour(); }
          else { if(window.startTour) window.startTour(); }
      } },
      { key: 'opacity', label: 'System Opacity', min: 0, max: 1, step: 0.01, sensitivity: 0.005, format: value => value.toFixed(2) },
      { key: 'showParticles', label: 'Quanta', type: 'toggle' }
    ];

    const configControls = [
      { key: 'theme', label: 'Theme', type: 'enum', options: ['classic', 'synthesist'], labels: ['Classic', 'Synth'], sensitivity: 0.02 },
      { key: 'buttonShape', label: 'Button Shape', type: 'enum', options: ['hex', 'circle'], labels: ['Hex', 'Circle'], sensitivity: 0.02 },
      { key: 'uiScanlines', label: 'UI Scanlines', min: 0, max: 0.5, step: 0.01, sensitivity: 0.003, format: value => value.toFixed(2) },
      { key: 'bgGlow', label: 'Backdrop', min: 0, max: 0.8, step: 0.02, sensitivity: 0.005, format: value => value.toFixed(2) },
      { key: 'bgBlur', label: 'Backdrop Blur', min: 0, max: 300, step: 1, sensitivity: 0.4, format: value => Math.round(value).toString() }, null, 
      { key: 'uiZoom', label: 'UI Zoom', min: 0.5, max: 1.5, step: 0.05, sensitivity: 0.006, format: value => value.toFixed(2) },
      { key: 'screenScanlines', label: 'Screen Scan', min: 0, max: 0.5, step: 0.01, sensitivity: 0.003, format: value => value.toFixed(2) },
      { key: 'resetLayout', label: 'Reset Layout', type: 'trigger', action: function() { 
          localStorage.removeItem(`ss_radial_state_${this.id}`);
          const defaults = { 'radial-system': systemControls, 'radial-environment': environmentControls, 'radial-config': configControls };
          if (defaults[this.id]) {
             this.controls = [...defaults[this.id]];
             this.nodes.forEach((n, i) => this.updateNodeContent(i));
          }
          this.saveState();
          this.flashLock();
      }}, 
      { key: 'panelOpacity', label: 'Panel Opacity', min: 0, max: 1, step: 0.05, sensitivity: 0.006, format: value => value.toFixed(2) }, 
      { key: 'buttonOpacity', label: 'Radial Button Opacity', min: 0, max: 1, step: 0.05, sensitivity: 0.006, format: value => value.toFixed(2) }, 
      { key: 'moveMode', label: 'Movement Type', type: 'enum', options: ['orbit', 'fly'], labels: ['Orbit', 'Fly'], sensitivity: 0.02 } 
    ];
    return { systemControls, environmentControls, configControls };
}

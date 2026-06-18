import { VISUAL_EFFECT_STYLE_OPTIONS } from '../render/visual-style-registry.js';

export const VISUAL_EFFECT_SLIDERS = [
    { label: 'FX Amount', left: 'subtle', right: 'full', key: 'visualEffectAmount', min: 0, max: 2.5, step: 0.01 },
    { label: 'FX Expressivity', left: 'calm', right: 'wild', key: 'visualEffectExpressivity', min: 0.35, max: 2.5, step: 0.01 },
    { label: 'FX Dynamics', left: 'steady', right: 'kinetic', key: 'visualEffectDynamics', min: 0.25, max: 2.5, step: 0.01 }
];

export const VISUAL_EFFECT_LAYER_TOGGLES = [
    { label: '2D Backdrop', key: 'visualEffectBackdrop' },
    { label: '3D FX', key: 'visualEffectPost' },
    { label: 'Swim', key: 'visualEffectCenterSwim' }
];

export function addVisualEffectControls(pane, {
    makeSection,
    makeSelect,
    makeSlider,
    makeGroupToggles,
    includePowerToggle = false,
    title = 'Audio Visual Background'
}) {
    makeSection(pane, title);
    if (includePowerToggle) {
        makeGroupToggles(pane, [
            { label: 'On', key: 'visualEffects', matchVal: true },
            { label: 'Off', key: 'visualEffects', matchVal: false }
        ]);
    }
    makeSelect(pane, 'Background Style', '', 'visualEffectStyle', VISUAL_EFFECT_STYLE_OPTIONS);
    for (const spec of VISUAL_EFFECT_SLIDERS) {
        makeSlider(pane, spec.label, '', spec.left, spec.right, spec.key, spec.min, spec.max, spec.step);
    }
    makeGroupToggles(pane, VISUAL_EFFECT_LAYER_TOGGLES);
}

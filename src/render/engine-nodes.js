import {
    Fn, float, vec3,
    add, sub, mul, div,
    mx_noise_float, select, clamp, abs, min, max
} from 'three/tsl';

export const noise3d = Fn(([p]) => mx_noise_float(p));

export const curlNoise = Fn(([p, freq, str]) => {
    const e = float(0.01);
    const px = mul(p.x, freq);
    const py = mul(p.y, freq);
    const pz = mul(p.z, freq);

    const p0 = vec3(px, py, pz);
    const p1 = vec3(add(px, 13.5), add(py, 92.1), add(pz, 45.3));
    const p2 = vec3(add(px, 83.1), add(py, 12.3), add(pz, 95.8));

    const dz_dy = sub(noise3d(vec3(p2.x, add(p2.y, e), p2.z)), noise3d(vec3(p2.x, sub(p2.y, e), p2.z)));
    const dy_dz = sub(noise3d(vec3(p1.x, p1.y, add(p1.z, e))), noise3d(vec3(p1.x, p1.y, sub(p1.z, e))));
    const x = mul(div(sub(dz_dy, dy_dz), mul(2.0, e)), str);

    const dx_dz = sub(noise3d(vec3(p0.x, p0.y, add(p0.z, e))), noise3d(vec3(p0.x, p0.y, sub(p0.z, e))));
    const dz_dx = sub(noise3d(vec3(add(p2.x, e), p2.y, p2.z)), noise3d(vec3(sub(p2.x, e), p2.y, p2.z)));
    const y = mul(div(sub(dx_dz, dz_dx), mul(2.0, e)), str);

    const dy_dx = sub(noise3d(vec3(add(p1.x, e), p1.y, p1.z)), noise3d(vec3(sub(p1.x, e), p1.y, p1.z)));
    const dx_dy = sub(noise3d(vec3(p0.x, add(p0.y, e), p0.z)), noise3d(vec3(p0.x, sub(p0.y, e), p0.z)));
    const z = mul(div(sub(dy_dx, dx_dy), mul(2.0, e)), str);

    return vec3(x, y, z);
});

export const spectralColor = Fn(([t]) => {
    const tmod = clamp(t, 0.0, 1.0);
    const r = abs(sub(mul(tmod, 6.0), 3.0)).sub(1.0).clamp(0.0, 1.0);
    const g = sub(2.0, abs(sub(mul(tmod, 6.0), 2.0))).clamp(0.0, 1.0);
    const b = sub(2.0, abs(sub(mul(tmod, 6.0), 4.0))).clamp(0.0, 1.0);
    return vec3(r, g, b);
});

export const specCore = Fn(([eBase]) => {
    const e = eBase.mod(1.0);
    const r = min(float(1.0), max(float(0.0), select(e.lessThan(0.5), mul(e, 0.4), add(0.2, mul(sub(e, 0.5), 1.6)))));
    const g = min(float(1.0), max(float(0.0), select(e.lessThan(0.3), float(0.1), select(e.lessThan(0.7), mul(sub(e, 0.3), 1.5), sub(0.6, mul(sub(e, 0.7), 1.5))))));
    const b = min(float(1.0), max(float(0.0), select(e.lessThan(0.5), sub(0.9, mul(e, 0.8)), sub(0.5, mul(sub(e, 0.5), 1.0)))));
    return vec3(r, g, b);
});

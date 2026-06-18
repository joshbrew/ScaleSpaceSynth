import {
    pass, color, mix, positionLocal, attribute, pointWidth,
    float, vec2, vec3, vec4, instanceIndex, uniform,
    dot, length, normalize, sub, add, mul, sin, cos, fract, floor,
    compute, storage, Fn, time, max, min, div, mx_noise_float, step,
    atomicAdd, atomicStore, uint, int, mod, If, bitAnd, Loop, select, clamp, abs,
    sqrt, pow, log2,
    instancedBufferAttribute, modelViewMatrix, cameraProjectionMatrix, vertexIndex, billboarding, cross
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

    // curl.x = d(Psi_z)/dy - d(Psi_y)/dz
    const dz_dy = sub(noise3d(vec3(p2.x, add(p2.y, e), p2.z)), noise3d(vec3(p2.x, sub(p2.y, e), p2.z)));
    const dy_dz = sub(noise3d(vec3(p1.x, p1.y, add(p1.z, e))), noise3d(vec3(p1.x, p1.y, sub(p1.z, e))));
    const x = mul(div(sub(dz_dy, dy_dz), mul(2.0, e)), str);

    // curl.y = d(Psi_x)/dz - d(Psi_z)/dx
    const dx_dz = sub(noise3d(vec3(p0.x, p0.y, add(p0.z, e))), noise3d(vec3(p0.x, p0.y, sub(p0.z, e))));
    const dz_dx = sub(noise3d(vec3(add(p2.x, e), p2.y, p2.z)), noise3d(vec3(sub(p2.x, e), p2.y, p2.z)));
    const y = mul(div(sub(dx_dz, dz_dx), mul(2.0, e)), str);

    // curl.z = d(Psi_y)/dx - d(Psi_x)/dy
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

// Spectral palette — shared between particle material and ribbon compute
export const specCore = Fn(([eBase]) => {
    const e = eBase.mod(1.0);
    const r = min(float(1.0), max(float(0.0), select(e.lessThan(0.5), mul(e, 0.4), add(0.2, mul(sub(e, 0.5), 1.6)))));
    const g = min(float(1.0), max(float(0.0), select(e.lessThan(0.3), float(0.1), select(e.lessThan(0.7), mul(sub(e, 0.3), 1.5), sub(0.6, mul(sub(e, 0.7), 1.5))))));
    const b = min(float(1.0), max(float(0.0), select(e.lessThan(0.5), sub(0.9, mul(e, 0.8)), sub(0.5, mul(sub(e, 0.5), 1.0)))));
    return vec3(r, g, b);
});

// Catmull-Rom spline position: p0=prev, p1=curr, p2=next, p3=next+1, t in [0,1]
export const catmullRomPos = Fn(([p0, p1, p2, p3, t]) => {
    const t2 = mul(t, t);
    const t3 = mul(t2, t);
    const c0 = mul(p1, float(2.0));
    const c1 = mul(add(mul(p0, float(-1.0)), p2), t);
    const c2 = mul(add(add(mul(p0, float(2.0)), mul(p1, float(-5.0))), add(mul(p2, float(4.0)), mul(p3, float(-1.0)))), t2);
    const c3 = mul(add(add(mul(p0, float(-1.0)), mul(p1, float(3.0))), add(mul(p2, float(-3.0)), p3)), t3);
    return mul(add(add(add(c0, c1), c2), c3), float(0.5));
});

// Catmull-Rom tangent (derivative of above)
export const catmullRomTan = Fn(([p0, p1, p2, p3, t]) => {
    const t2 = mul(t, t);
    const d0 = add(mul(p0, float(-1.0)), p2);
    const d1 = mul(add(add(mul(p0, float(4.0)), mul(p1, float(-10.0))), add(mul(p2, float(8.0)), mul(p3, float(-2.0)))), t);
    const d2 = mul(add(add(mul(p0, float(-3.0)), mul(p1, float(9.0))), add(mul(p2, float(-9.0)), mul(p3, float(3.0)))), t2);
    return mul(add(add(d0, d1), d2), float(0.5));
});


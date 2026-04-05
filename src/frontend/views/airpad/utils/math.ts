// =========================
// Vector Math Utilities
// =========================

// Vector3 type
export interface Vector3 {
    x: number;
    y: number;
    z: number;
}

function n0(v: number | undefined | null): number {
    return Number.isFinite(v as number) ? (v as number) : 0;
}

// =========================
// Scalar helpers
// =========================

export function clamp01(v: number): number {
    const x = n0(v);
    return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function lerp(a: number, b: number, t: number): number {
    return n0(a) + (n0(b) - n0(a)) * clamp01(t);
}

// Exponential smoothing factor in [0..1] for given dt (seconds) and rate (1/seconds).
export function expSmoothing(dtSeconds: number, ratePerSecond: number): number {
    const dt = Math.max(0, n0(dtSeconds));
    const rate = Math.abs(n0(ratePerSecond));
    return 1 - Math.exp(-rate * dt);
}

// Create a vector from components
export function vec3(x: number, y: number, z: number): Vector3 {
    return { x: n0(x), y: n0(y), z: n0(z) };
}

// Create a zero vector
export function vec3Zero(): Vector3 {
    return { x: 0, y: 0, z: 0 };
}

//
export function vec3Mix(a: Vector3, b: Vector3, f: number = 0.5): Vector3 {
    const ax = n0(a.x);
    const ay = n0(a.y);
    const az = n0(a.z);
    const bx = n0(b.x);
    const by = n0(b.y);
    const bz = n0(b.z);
    const ff = n0(f);
    return {
        x: ax + (bx - ax) * ff,
        y: ay + (by - ay) * ff,
        z: az + (bz - az) * ff,
    };
}

// Is near vector
export function vec3IsNear(v: Vector3, other: Vector3, epsilon: number = 0.01): boolean {
    const e = n0(epsilon) || 0.01;
    return Math.abs(n0(v.x) - n0(other.x)) < e && Math.abs(n0(v.y) - n0(other.y)) < e && Math.abs(n0(v.z) - n0(other.z)) < e;
}

// Is far vector
export function vec3IsFar(v: Vector3, other: Vector3, epsilon: number = 0.01): boolean {
    const e = n0(epsilon) || 0.01;
    return Math.abs(n0(v.x) - n0(other.x)) > e && Math.abs(n0(v.y) - n0(other.y)) > e && Math.abs(n0(v.z) - n0(other.z)) > e;
}

// Create a vector from sensor reading
export function vec3FromSensor(sensor: { x?: number; y?: number; z?: number }): Vector3 {
    return {
        x: n0(sensor.x),
        y: n0(sensor.y),
        z: n0(sensor.z),
    };
}

// Vector subtraction: a - b
export function vec3Sub(a: Vector3, b: Vector3): Vector3 {
    return {
        x: n0(a.x) - n0(b.x),
        y: n0(a.y) - n0(b.y),
        z: n0(a.z) - n0(b.z),
    };
}

// Vector addition: a + b
export function vec3Add(a: Vector3, b: Vector3): Vector3 {
    return {
        x: n0(a.x) + n0(b.x),
        y: n0(a.y) + n0(b.y),
        z: n0(a.z) + n0(b.z),
    };
}

// Scale vector by scalar: v * s
export function vec3Scale(v: Vector3, scalar: number): Vector3 {
    const s = n0(scalar);
    return {
        x: n0(v.x) * s,
        y: n0(v.y) * s,
        z: n0(v.z) * s,
    };
}

// Component-wise multiplication: a * b
export function vec3Mul(a: Vector3, b: Vector3): Vector3 {
    return {
        x: n0(a.x) * n0(b.x),
        y: n0(a.y) * n0(b.y),
        z: n0(a.z) * n0(b.z),
    };
}

// Clamp vector length to max (radial clamp): keeps direction, limits magnitude.
export function vec3Clamp(v: Vector3, max: number): Vector3 {
    const m = Math.abs(n0(max));
    if (m === 0) return vec3Zero();

    const x = n0(v.x);
    const y = n0(v.y);
    const z = n0(v.z);
    const length = Math.hypot(x, y, z);

    // If already within limit (or zero), return the sanitized vector unchanged.
    if (length === 0 || length <= m) return { x, y, z };

    const s = m / length;
    return { x: x * s, y: y * s, z: z * s };
}

// Apply dead zone: if |component| < threshold, set to 0
export function vec3DeadZone(v: Vector3, threshold: number): Vector3 {
    const t = Math.abs(n0(threshold));
    return {
        x: Math.abs(n0(v.x)) < t ? 0 : n0(v.x),
        y: Math.abs(n0(v.y)) < t ? 0 : n0(v.y),
        z: Math.abs(n0(v.z)) < t ? 0 : n0(v.z),
    };
}

// Check if vector is near zero (all components < epsilon)
export function vec3IsNearZero(v: Vector3, epsilon: number = 0.01): boolean {
    const e = Math.abs(n0(epsilon) || 0.01);
    return Math.abs(n0(v.x)) < e && Math.abs(n0(v.y)) < e && Math.abs(n0(v.z)) < e;
}

// Exponential smoothing: result = current + (target - current) * factor
export function vec3Smooth(current: Vector3, target: Vector3, factor: number = 0.25): Vector3 {
    return vec3Mix(current, target, factor);
}

//
export function vec3Normalize(v: Vector3, dt: number = 0.1): Vector3 {
    const denom = Math.max(0.000001, Math.abs(n0(dt)) || 0.000001);
    return { x: n0(v.x) / denom, y: n0(v.y) / denom, z: n0(v.z) / denom };
}

// Select components for 2D mouse movement
// axisMapping: 'ax', 'ay', 'az' for x, y, z components
export function vec3Select2D(v: Vector3, axisX: 'ax' | 'ay' | 'az', axisY: 'ax' | 'ay' | 'az'): { x: number; y: number } {
    const componentMap = {
        ax: v.x || 0,
        ay: v.y || 0,
        az: v.z || 0,
    };
    return {
        x: componentMap[axisX],
        y: componentMap[axisY],
    };
}

// Select components for 3D mouse movement
export function vec3Select(v: Vector3, axisX: 'ax' | 'ay' | 'az', axisY: 'ax' | 'ay' | 'az', axisZ: 'ax' | 'ay' | 'az'): { x: number; y: number; z: number } {
    const componentMap = {
        ax: n0(v.x),
        ay: n0(v.y),
        az: n0(v.z),
    };
    return {
        x: componentMap[axisX],
        y: componentMap[axisY],
        z: componentMap[axisZ],
    };
}

// Apply direction multipliers to 2D vector
export function vec2ApplyDirection(v: { x: number; y: number }, dirX: number = 1, dirY: number = 1): { x: number; y: number } {
    return {
        x: n0(v.x) * (n0(dirX) || 1),
        y: n0(v.y) * (n0(dirY) || 1),
    };
}

// Scale 2D vector by scalar
export function vec2Scale(v: { x: number; y: number }, scalar: number = 1): { x: number; y: number } {
    const s = n0(scalar);
    return {
        x: n0(v.x) * s,
        y: n0(v.y) * s,
    };
}

// Rotate X/Y by Z angle (radians). Optionally override output Z (useful when Z is repurposed).
export function vec3RotateXYByAngle(v: Vector3, angleRad: number, zOverride?: number): Vector3 {
    const a = n0(angleRad);
    const cosA = Math.cos(a);
    const sinA = Math.sin(a);
    const x = n0(v.x);
    const y = n0(v.y);
    return {
        x: x * cosA - y * sinA,
        y: x * sinA + y * cosA,
        z: zOverride !== undefined ? n0(zOverride) : n0(v.z),
    };
}

// =========================
// Angle Math
// =========================

// Нормализация угла в [-PI, PI]
export function normalizeAngle(angle: number): number {
    const twoPi = Math.PI * 2;
    angle = angle % twoPi;
    if (angle < -Math.PI) {
        angle += twoPi;
    } else if (angle > Math.PI) {
        angle -= twoPi;
    }
    return angle;
}

// Разность углов с учётом круговой топологии
export function angleDelta(a: number, b: number): number {
    return normalizeAngle(a - b);
}

// Normalize all angles in a vector
export function vec3NormalizeAngles(v: Vector3): Vector3 {
    return {
        x: normalizeAngle(n0(v.x)),
        y: normalizeAngle(n0(v.y)),
        z: normalizeAngle(n0(v.z)),
    };
}

// Calculate angle deltas between two angle vectors
export function vec3AngleDelta(current: Vector3, base: Vector3): Vector3 {
    return {
        x: angleDelta(n0(current.x), n0(base.x)),
        y: angleDelta(n0(current.y), n0(base.y)),
        z: angleDelta(n0(current.z), n0(base.z)),
    };
}

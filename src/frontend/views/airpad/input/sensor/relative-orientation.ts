import { log } from '../../utils/utils';
import { enqueueMotion } from '../../config/motion-state';
import { aiModeActive } from '../speech';
import { getAirState } from '../../ui/air-button';
import {
    REL_ORIENT_DEADZONE,
    REL_ORIENT_GAIN,
    REL_ORIENT_SMOOTH,
    REL_ORIENT_MAX_STEP,
    REL_ORIENT_MAX_STEP_MAX,
    REL_ORIENT_MAX_STEP_UP_RATE,
    REL_ORIENT_MAX_STEP_DOWN_RATE,
    REL_ORIENT_SMOOTH_RATE_LOW,
    REL_ORIENT_SMOOTH_RATE_HIGH,
    relDirX,
    relDirY,
    relDirZ,
    relSrcForMouseX,
    relSrcForMouseY,
    relSrcForMouseZ,
    MOTION_JITTER_EPS,
} from '../../config/config';
import {
    vec3Zero,
    vec3Clamp,
    vec3Smooth,
    vec3IsNearZero,
    vec3Select,
    type Vector3,
    vec3RotateXYByAngle,
    expSmoothing,
    lerp,
    clamp01,
} from '../../utils/math';
import { isAirPadSessionConnected } from '../../network/session';


let relSensor: any = null;
let fallbackOrientationActive = false;
let fallbackHandler: ((event: DeviceOrientationEvent) => void) | null = null;

// Orientation state
let lastQuat: [number, number, number, number] | null = null;
let smoothedDelta: Vector3 = vec3Zero(); // smoothed small-angle delta
let dynamicMaxStepPx: number = REL_ORIENT_MAX_STEP; // adaptive clamp radius in pixels/tick

export function resetRelativeOrientationRuntimeState() {
    lastQuat = null;
    smoothedDelta = vec3Zero();
    dynamicMaxStepPx = REL_ORIENT_MAX_STEP;
}

export function stopRelativeOrientation(): void {
    try {
        if (relSensor) {
            relSensor.stop?.();
        }
    } catch {
        // ignore sensor stop errors
    }
    relSensor = null;

    if (fallbackOrientationActive && fallbackHandler) {
        globalThis.removeEventListener("deviceorientation", fallbackHandler as EventListener);
    }
    fallbackOrientationActive = false;
    fallbackHandler = null;
}

// Quaternion helpers
type Quat = [number, number, number, number];

// Normalize with stability: keep sign consistent with previous to avoid hemisphere flips
const quatNormalizeStable = (q: Quat, prev: Quat | null): Quat => {
    const [x, y, z, w] = q;
    const len = Math.hypot(x, y, z, w) || 1;
    let nx = x / len, ny = y / len, nz = z / len, nw = w / len;
    if (prev) {
        const dot = nx * prev[0] + ny * prev[1] + nz * prev[2] + nw * prev[3];
        if (dot < 0) {
            nx = -nx; ny = -ny; nz = -nz; nw = -nw;
        }
    }
    return [nx, ny, nz, nw];
};

const quatConj = (q: Quat): Quat => {
    const [x, y, z, w] = q;
    return [-x, -y, -z, w];
};

const quatMul = (a: Quat, b: Quat): Quat => {
    const [ax, ay, az, aw] = a;
    const [bx, by, bz, bw] = b;
    return [
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ];
};

// Quaternion delta → small-angle vector (axis * angle)
const quatDeltaToAxisAngle = (dq: Quat): Vector3 => {
    const [x, y, z, w] = dq;
    const sinHalf = Math.hypot(x, y, z);
    const angle = 2 * Math.atan2(sinHalf, w || 1);
    if (sinHalf < 1e-6) {
        return { x: 0, y: 0, z: 0 };
    }
    const inv = 1 / sinHalf;
    return { x: x * inv * angle, y: y * inv * angle, z: z * inv * angle };
};

function mapToPixelsRaw(movement: Vector3): Vector3 {
    const selected = vec3Select(
        movement,
        relSrcForMouseX as 'ax' | 'ay' | 'az',
        relSrcForMouseY as 'ax' | 'ay' | 'az',
        relSrcForMouseZ as 'ax' | 'ay' | 'az'
    );

    const rotationZ = selected.z * relDirZ;
    const projected = vec3RotateXYByAngle(selected, rotationZ, 1);
    return {
        x: projected.x * relDirX * REL_ORIENT_GAIN,
        y: projected.y * relDirY * REL_ORIENT_GAIN,
        z: projected.z * relDirZ * REL_ORIENT_GAIN,
    };
}

function clampPxRadiusFromDeltaVec(deltaVec: Vector3, dt: number): number {
    // Convert deltaVec (rad axis-angle vector) into "desired pixel movement" magnitude.
    // This makes the clamp depend on current motion intensity, and shrink when motion shrinks.
    const rawMapped = mapToPixelsRaw(deltaVec);
    const magPx = Math.hypot(rawMapped.x, rawMapped.y, rawMapped.z);
    const desired = Math.max(REL_ORIENT_MAX_STEP, Math.min(REL_ORIENT_MAX_STEP_MAX, magPx));

    // "Incremental" update: grow slower, shrink faster (feels responsive but stable).
    const t = desired > dynamicMaxStepPx ? expSmoothing(dt, REL_ORIENT_MAX_STEP_UP_RATE) : expSmoothing(dt, REL_ORIENT_MAX_STEP_DOWN_RATE);
    dynamicMaxStepPx = lerp(dynamicMaxStepPx, desired, t);

    if (!Number.isFinite(dynamicMaxStepPx)) dynamicMaxStepPx = REL_ORIENT_MAX_STEP;
    dynamicMaxStepPx = Math.max(REL_ORIENT_MAX_STEP, Math.min(REL_ORIENT_MAX_STEP_MAX, dynamicMaxStepPx));
    return dynamicMaxStepPx;
}






//
function mapAndScale(movement: Vector3, maxStepPx: number): Vector3 {
    const mapped = mapToPixelsRaw(movement);
    return vec3Clamp(mapped, maxStepPx);
}





//vec3NormalizeAngles

function handleReading(quat: number[], dt: number): Vector3 {
    if (!quat || quat.length < 4) return vec3Zero();

    //
    const curQuat = quatNormalizeStable([quat[0], quat[1], quat[2], quat[3]], lastQuat);
    if (!lastQuat) { lastQuat = curQuat; };

    // deltaQuat = q_curr * conj(q_prev)
    const deltaQuat = quatMul(curQuat, quatConj(lastQuat)); lastQuat = curQuat;

    // small-angle vector from delta quaternion
    const deltaVec = quatDeltaToAxisAngle(deltaQuat);

    // Update adaptive clamp from current (unsmoothed) deltaVec.
    const maxStepPx = clampPxRadiusFromDeltaVec(deltaVec, dt);

    // Smooth delta directly in quaternion space (axis-angle vector)
    const deltaPx = mapToPixelsRaw(deltaVec);
    const deltaMagPx = Math.hypot(deltaPx.x, deltaPx.y, deltaPx.z);
    const magT = clamp01((deltaMagPx - REL_ORIENT_MAX_STEP) / Math.max(1, (REL_ORIENT_MAX_STEP_MAX - REL_ORIENT_MAX_STEP)));
    const smoothRate = lerp(REL_ORIENT_SMOOTH_RATE_LOW, REL_ORIENT_SMOOTH_RATE_HIGH, magT);
    const smoothFactor = clamp01(expSmoothing(dt, smoothRate) * clamp01(REL_ORIENT_SMOOTH));
    smoothedDelta = vec3Smooth(smoothedDelta, deltaVec, smoothFactor * 0.9);

    // clamp delta
    // Convert pixel clamp to axis-angle clamp (rad) for stability before mapping.
    const maxStepRad = maxStepPx / Math.max(1e-6, Math.abs(REL_ORIENT_GAIN));
    smoothedDelta = vec3Clamp(smoothedDelta, Math.max(REL_ORIENT_DEADZONE, maxStepRad));

    // Dead-zone / jitter suppression
    const dz = {
        x: Math.abs(smoothedDelta.x) < REL_ORIENT_DEADZONE ? 0 : smoothedDelta.x,
        y: Math.abs(smoothedDelta.y) < REL_ORIENT_DEADZONE ? 0 : smoothedDelta.y,
        z: Math.abs(smoothedDelta.z) < REL_ORIENT_DEADZONE ? 0 : smoothedDelta.z,
    };

    //
    if (Math.abs(dz.x) < MOTION_JITTER_EPS && Math.abs(dz.y) < MOTION_JITTER_EPS && Math.abs(dz.z) < MOTION_JITTER_EPS) {
        return vec3Zero();
    }

    // Map axes, apply gain, clamp
    const mapped = mapAndScale(dz, maxStepPx);

    // Ignore near-zero after mapping
    if (vec3IsNearZero(mapped, MOTION_JITTER_EPS)) return vec3Zero();
    return mapped;
}

export function initRelativeOrientation() {
    stopRelativeOrientation();

    const startDeviceOrientationFallback = () => {
        if (fallbackOrientationActive) return;
        let lastTs = performance.now();
        let lastEuler = { x: 0, y: 0, z: 0 };

        fallbackHandler = (event: DeviceOrientationEvent) => {
            const now = performance.now();
            const dt = Math.max(0.00001, (now - lastTs) / 1000);
            lastTs = now;

            const alpha = Number(event.alpha ?? 0);
            const beta = Number(event.beta ?? 0);
            const gamma = Number(event.gamma ?? 0);
            const current = { x: beta, y: gamma, z: alpha };
            const deltaDeg = {
                x: current.x - lastEuler.x,
                y: current.y - lastEuler.y,
                z: current.z - lastEuler.z
            };
            lastEuler = current;

            // Convert small Euler deltas to radians and reuse the same motion queue.
            const mapped = mapAndScale({
                x: (deltaDeg.x * Math.PI) / 180,
                y: (deltaDeg.y * Math.PI) / 180,
                z: (deltaDeg.z * Math.PI) / 180
            }, clampPxRadiusFromDeltaVec({
                x: (deltaDeg.x * Math.PI) / 180,
                y: (deltaDeg.y * Math.PI) / 180,
                z: (deltaDeg.z * Math.PI) / 180
            }, dt));

            if (getAirState && getAirState() !== 'AIR_MOVE') return;
            if (!isAirPadSessionConnected()) return;
            if (aiModeActive) return;
            if (vec3IsNearZero(mapped, MOTION_JITTER_EPS)) return;
            enqueueMotion(mapped.x, mapped.y, mapped.z);
        };

        globalThis.addEventListener("deviceorientation", fallbackHandler as EventListener, { passive: true });
        fallbackOrientationActive = true;
        log("RelativeOrientation fallback active (deviceorientation)");
    };

    if (!(window as any).RelativeOrientationSensor ) {
        log('RelativeOrientationSensor API is not supported.');
        startDeviceOrientationFallback();
        return;
    }

    try {
        relSensor = new (window as any).RelativeOrientationSensor({ frequency: 120, referenceFrame: 'device' });
    } catch (err: any) {
        log('Cannot create RelativeOrientationSensor: ' + (err?.message || err));
        relSensor = null;
        return;
    }

    let lastTs = performance.now();

    relSensor.addEventListener('reading', () => {
        const now = performance.now();
        const dt = Math.max(0.00001, (now - lastTs) / 1000);
        lastTs = now;

        const mapped = handleReading(relSensor.quaternion, dt);

        //
        if (getAirState && getAirState() !== 'AIR_MOVE') return;
        if (!isAirPadSessionConnected()) return;
        if (aiModeActive) return;

        // Accumulate into unified motion queue
        enqueueMotion(mapped.x, mapped.y, mapped.z);
    });

    relSensor.addEventListener('error', (event: any) => {
        log('RelativeOrientationSensor error: ' + ((event?.error?.message) || event?.message || event));
        startDeviceOrientationFallback();
    });

    try {
        relSensor.start();
        log('RelativeOrientationSensor started (120 Hz)');
    } catch (err: any) {
        log('RelativeOrientationSensor start failed: ' + (err?.message || err));
    }
}

import { log } from '../../utils/utils';
import { enqueueMotion } from '../../config/motion-state';
import { isAirPadSessionConnected } from '../../network/session';
import { aiModeActive } from '../speech';
import { getAirState } from '../../ui/air-button';
import {
    REL_ORIENT_DEADZONE,
    REL_ORIENT_GAIN,
    REL_ORIENT_SMOOTH,
    REL_ORIENT_MAX_STEP,
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
    vec3Add,
    vec3Sub,
    vec3Scale,
    vec3Clamp,
    vec3Smooth,
    vec3NormalizeAngles,
    vec3IsNearZero,
    vec3Select,
    type Vector3,
    normalizeAngle,
} from '../../utils/math';

let relSensor: any = null;

// Orientation state
let lastAngles: Vector3 = vec3Zero();
let smoothedAngles: Vector3 = vec3Zero();
let pendingMovement: Vector3 = vec3Zero();
let smoothedDelta: Vector3 = vec3Zero(); // additional delta smoothing

// Unwrap angle to keep continuity around 2π to avoid jump-back
function unwrapAngle(angle: number, prev: number): number {
    const TWO_PI = Math.PI * 2;
    let a = angle;
    while (a - prev > Math.PI) a -= TWO_PI;
    while (a - prev < -Math.PI) a += TWO_PI;
    return a;
}

function unwrapAngles(current: Vector3, prev: Vector3): Vector3 {
    return {
        x: unwrapAngle(current.x, prev.x),
        y: unwrapAngle(current.y, prev.y),
        z: unwrapAngle(current.z, prev.z),
    };
}

function quaternionToEuler(x: number, y: number, z: number, w: number): Vector3 {
    /*
    // Based on standard conversion; returns radians
    const ysqr = y * y;

    // roll (x-axis rotation)
    const t0 = +2.0 * (w * x + y * z);
    const t1 = +1.0 - 2.0 * (x * x + ysqr);
    const roll = Math.atan2(t0, t1);

    // pitch (y-axis rotation)
    let t2 = +2.0 * (w * y - z * x);
    t2 = t2 > 1 ? 1 : t2;
    t2 = t2 < -1 ? -1 : t2;
    const pitch = Math.asin(t2);

    // yaw (z-axis rotation)
    const t3 = +2.0 * (w * z + x * y);
    const t4 = +1.0 - 2.0 * (ysqr + z * z);
    const yaw = Math.atan2(t3, t4);

    return { x: roll, y: pitch, z: yaw };*/

/*
    const euler = { x: 0, y: 0, z: 0 };

    // Calculate X angle (pitch)
    const sinX_cosY = 2 * (w * x + y * z);
    const cosX_cosY = 1 - 2 * (x * x + y * y);
    euler.x = Math.atan2(sinX_cosY, cosX_cosY);

    // Calculate Y angle (yaw)
    let sinY = 2 * (w * y - z * x);
    if (Math.abs(sinY) >= 1)
        euler.y = Math.sign(sinY) * Math.PI / 2; // Use 90 degrees if out of range
    else
        euler.y = Math.asin(sinY);

    // Calculate Z angle (roll)
    const sinZ_cosY = 2 * (w * z + x * y);
    const cosZ_cosY = 1 - 2 * (y * y + z * z);
    euler.z = Math.atan2(sinZ_cosY, cosZ_cosY);

    return euler; // Angles are in radians*/

    let pitch, yaw, roll;

    // Calculate pitch (around Y-axis)
    let test = 2 * (w * y - z * x);
    test = Math.max(-1, Math.min(1, test)); // Clamp for safety
    pitch = Math.asin(test);

    // Handle Gimbal Lock (when pitch is near +/- 90 degrees)
    if (Math.abs(test) < 0.999999) {
        // Roll (around Z)
        roll = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
        // Yaw (around X) - note: order matters!
        yaw = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
    } else {
        // Gimbal Lock: Roll and Yaw are the same, set one to 0
        roll = 0;
        yaw = Math.atan2(-2 * (x * z - w * y), 1 - 2 * (x * x + y * y));
    }

    return { z: roll, y: pitch, x: yaw }; // Or adjust to your desired output order
}






//
const projectByZ = (v: Vector3)=>{
    // Extract Z axis rotation (rotation around Z axis)
    const rotationZ = normalizeAngle(v.z * relDirZ);

    // Apply rotation correction to X and Y movements
    // Rotation correction: rotate the movement vector by rotationZ
    const cosZ = Math.cos(rotationZ);
    const sinZ = Math.sin(rotationZ);

    // Rotate X, Y by Z rotation
    const correctedX = v.x * cosZ - v.y * sinZ;
    const correctedY = v.x * sinZ + v.y * cosZ;

    //
    let rotatedVector: Vector3 = ({ x: correctedX, y: correctedY, z: 1 });
    return rotatedVector;
}


function mapAndScale(movement: Vector3): Vector3 {
    const selected = vec3Select(
        movement,
        relSrcForMouseX as 'ax' | 'ay' | 'az',
        relSrcForMouseY as 'ax' | 'ay' | 'az',
        relSrcForMouseZ as 'ax' | 'ay' | 'az'
    );

    const projected = projectByZ(selected);
    const mapped = {
        x: projected.x * relDirX * REL_ORIENT_GAIN,
        y: projected.y * relDirY * REL_ORIENT_GAIN,
        z: projected.z * relDirZ * REL_ORIENT_GAIN,
    };

    return vec3Clamp(mapped, REL_ORIENT_MAX_STEP);
}





//vec3NormalizeAngles

function handleReading(quat: number[], dt: number) {
    if (!quat || quat.length < 4) return;
    const [qx, qy, qz, qw] = quat;

    // To Euler
    const rawAngles = quaternionToEuler(qx, qy, qz, qw);
    // Unwrap against previous to avoid wrap jumps
    const angles = unwrapAngles(rawAngles, lastAngles);

    // Smooth angles
    const smoothFactor = Math.max(0.1, Math.min(dt * 5, REL_ORIENT_SMOOTH, 1));
    smoothedAngles = unwrapAngles((vec3Smooth(smoothedAngles, angles, smoothFactor * 0.6)), lastAngles);

    // Delta from last angles
    const delta = (vec3Sub(smoothedAngles, lastAngles));
    lastAngles = smoothedAngles;

    // Smooth delta to reduce jitter in portrait/near-vertical pose
    const deltaSmoothFactor = Math.max(0.05, Math.min(dt * 5, REL_ORIENT_SMOOTH, 1));
    smoothedDelta = delta;//vec3Smooth(smoothedDelta, delta, deltaSmoothFactor);

    // Dead-zone / jitter suppression
    const dz = {
        x: Math.abs(smoothedDelta.x) < REL_ORIENT_DEADZONE ? 0 : smoothedDelta.x,
        y: Math.abs(smoothedDelta.y) < REL_ORIENT_DEADZONE ? 0 : smoothedDelta.y,
        z: Math.abs(smoothedDelta.z) < REL_ORIENT_DEADZONE ? 0 : smoothedDelta.z,
    };
    if (Math.abs(dz.x) < MOTION_JITTER_EPS && Math.abs(dz.y) < MOTION_JITTER_EPS && Math.abs(dz.z) < MOTION_JITTER_EPS) {
        return;
    }

    // Map axes, apply gain, clamp
    const mapped = mapAndScale(dz);

    // Ignore near-zero after mapping
    if (vec3IsNearZero(mapped, MOTION_JITTER_EPS)) return;

    // Accumulate into unified motion queue
    enqueueMotion(mapped.x, mapped.y, mapped.z);
}

export function initRelativeOrientation() {
    if (!(window as any).RelativeOrientationSensor ) {
        log('RelativeOrientationSensor API is not supported.');
        return;
    }

    try {
        relSensor = new (window as any).RelativeOrientationSensor({ frequency: 60, referenceFrame: 'device' });
    } catch (err: any) {
        log('Cannot create RelativeOrientationSensor: ' + (err?.message || err));
        relSensor = null;
        return;
    }

    let lastTs = performance.now();

    relSensor.addEventListener('reading', () => {
        const now = performance.now();
        const dt = Math.max(0.001, (now - lastTs) / 1000);
        lastTs = now;

        if (getAirState && getAirState() !== 'AIR_MOVE') return;
        if (!isAirPadSessionConnected()) return;
        if (aiModeActive) return;

        handleReading(relSensor.quaternion, dt);
    });

    relSensor.addEventListener('error', (event: any) => {
        log('RelativeOrientationSensor error: ' + ((event?.error?.message) || event?.message || event));
    });

    try {
        relSensor.start();
        log('RelativeOrientationSensor started (60 Hz)');
    } catch (err: any) {
        log('RelativeOrientationSensor start failed: ' + (err?.message || err));
    }
}

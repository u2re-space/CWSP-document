// =========================
// Gravity Sensor
// =========================

import { log } from '../../utils/utils';
import { vec3Zero, vec3FromSensor, vec3Smooth, vec3NormalizeAngles, type Vector3, vec3Normalize } from '../../utils/math';
import { GRAVITY_SMOOTH } from '../../config/config';

let gravitySensor: any = null;

// Smoothed gravity vector (normalized)
let gravityVector: Vector3 = vec3Zero();
let gravityMagnitude: number = 0;

// Get current gravity vector (normalized)
export function getGravityVector(): Vector3 {
    return gravityVector;
}

// Get gravity magnitude
export function getGravityMagnitude(): number {
    return gravityMagnitude;
}

// Check if gravity sensor is available
export function isGravityAvailable(): boolean {
    return gravitySensor !== null;
}

// Reset gravity sensor state
export function resetGravitySensor() {
    gravityVector = vec3Zero();
    gravityMagnitude = 0;
}

// Calculate orientation correction matrix from gravity vector
// Returns rotation angles to align with gravity
export function getOrientationCorrection(): Vector3 {
    if (gravityMagnitude < 0.1) {
        return vec3Zero(); // Not enough gravity data
    }

    // Calculate pitch and roll from gravity vector
    // Pitch: rotation around X axis (forward/backward tilt)
    // Roll: rotation around Y axis (left/right tilt)
    const gx = gravityVector.x;
    const gy = gravityVector.y;
    const gz = gravityVector.z;

    const pitch = Math.atan2(-gx, Math.sqrt(gy * gy + gz * gz));
    const roll = Math.atan2(gy, gz);

    return {
        x: pitch,  // pitch correction
        y: roll,   // roll correction
        z: 0       // yaw not determined from gravity alone
    };
}

// Apply dimensional correction to a vector using gravity reference
export function applyDimensionalCorrection(vector: Vector3, useGravity: boolean = true): Vector3 {
    if (!useGravity || !isGravityAvailable() || gravityMagnitude < 0.1) {
        return vector; // No correction if gravity not available
    }

    const correction = getOrientationCorrection();

    // Apply pitch and roll corrections
    // This compensates for device orientation relative to gravity
    return {
        x: vector.x - correction.x * 0.1, // Subtle correction
        y: vector.y - correction.y * 0.1,
        z: vector.z
    };
}

// Initialize gravity sensor
export function initGravitySensor() {
    if (!('GravitySensor' in window)) {
        log('GravitySensor API is not supported.');
        return;
    }

    try {
        gravitySensor = new (window as any).GravitySensor({ frequency: 60 });
    } catch (err: any) {
        log('Cannot create GravitySensor: ' + (err.message || err));
        return;
    }

    gravitySensor.addEventListener('reading', () => {
        const rawGravity = vec3FromSensor(gravitySensor!);

        // Smooth the gravity vector
        gravityVector = vec3Smooth(gravityVector, rawGravity, GRAVITY_SMOOTH);

        // Calculate magnitude
        gravityMagnitude = Math.hypot(gravityVector.x, gravityVector.y, gravityVector.z);

        // Normalize gravity vector
        if (gravityMagnitude > 0.1) {
            const invMag = 1.0 / gravityMagnitude;
            gravityVector = {
                x: gravityVector.x * invMag,
                y: gravityVector.y * invMag,
                z: gravityVector.z * invMag
            };
        }
    });

    gravitySensor.addEventListener('error', (event: any) => {
        log('GravitySensor error: ' + ((event?.error?.message) || event?.message || event));
    });

    gravitySensor.start();
    log('GravitySensor started (60 Hz)');
}


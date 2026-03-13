// =========================
// Accelerometer
// =========================

import { log } from '../../utils/utils';
import { isAirPadSessionConnected } from '../../network/session';
import { enqueueMotion } from '../../config/motion-state';
import { getAirState, setMotionCalibrated } from '../../ui/air-button';
import { ACCELEROMETER_DEADZONE, ACCELEROMETER_GAIN, ACCELEROMETER_SMOOTH, ACCELEROMETER_MAX_SAMPLE_COUNT, GRAVITY_CORRECTION_STRENGTH, accelSrcForMouseX, accelSrcForMouseY, accelSrcForMouseZ, accelDirX, accelDirY, accelDirZ } from '../../config/config';
import { vec3Zero, vec3FromSensor, vec3Sub, vec3Scale, type Vector3, vec3Mix, vec3Smooth, vec3Add, vec3DeadZone, vec3IsNearZero, vec3Select } from '../../utils/math';
import { aiModeActive } from '../speech';
import { getGravityVector, isGravityAvailable, getGravityMagnitude, getOrientationCorrection } from './gravity-sensor';

//
let accelerometer: any = null;

// smoothed values of "movement" for cursor
let lastTimestamp: number = performance.now();
let lastMotionSentAt: number = 0;

// reset accelerometer state (e.g. when exiting AIR_MOVE)
function resetAccelState() {
    setMotionCalibrated(false);
    lastTimestamp = performance.now();
    lastMotionSentAt = 0;
    resetMonteCarloSampling();
    accelerometerSmoothed = vec3Zero();
    accelerometerResolved = vec3Zero();
    forSendingMovement = vec3Zero();
}

export function resetAccelerometerState() {
    resetAccelState();
}

// Called when entering AIR_MOVE mode
export function onEnterAirMove() {
    resetAccelState();
}

// Monte Carlo sampling for real-time calibration
let accelerometerSmoothed: Vector3 = vec3Zero();
let accelerometerResolved: Vector3 = vec3Zero(); // calibrated baseline (bias)

// Sliding window for Monte Carlo sampling
let accelerometerSampleWindow: Vector3[] = [];
let accelerometerSampleWeights: number[] = []; // weights for each sample
let accelerometerTotalWeight = 0;
let accelerometerWeightedSum: Vector3 = vec3Zero(); // cached weighted sum for efficiency

//
let averageRateSampleCount = 0;
let averageRateSampled = 0;
let averageRateResolved = 0;

// Reset Monte Carlo sampling window
function resetMonteCarloSampling() {
    accelerometerSampleWindow = [];
    accelerometerSampleWeights = [];
    accelerometerTotalWeight = 0;
    accelerometerWeightedSum = vec3Zero();
    accelerometerResolved = vec3Zero();
}

// Add sample to sliding window Monte Carlo sampler (optimized incremental update)
function addMonteCarloSample(sample: Vector3, weight: number = 1, smoothForDiff: Vector3 = vec3Zero()): void {
    if ((Math.abs(sample.x) + Math.abs(sample.y) + Math.abs(sample.z)) < 0.0001) return;

    // too large difference from resolved - skip sample
    if (Math.hypot(smoothForDiff.x - accelerometerResolved.x, smoothForDiff.y - accelerometerResolved.y, smoothForDiff.z - accelerometerResolved.z) > 2.0) {
        return;
    }

    const weightedSample = vec3Scale(sample, 1 / Math.max(0.001, weight));

    // Check if we need to remove oldest sample
    let removedWeightedSample: Vector3 | null = null;
    if (accelerometerSampleWindow.length >= ACCELEROMETER_MAX_SAMPLE_COUNT) {
        // Remove oldest sample (FIFO) - store for incremental update
        const removedWeight = accelerometerSampleWeights.shift()!;
        removedWeightedSample = vec3Scale(accelerometerSampleWindow.shift()!, removedWeight);
        accelerometerTotalWeight -= removedWeight;
    }

    // Add new sample to window
    accelerometerSampleWindow.push(weightedSample);
    accelerometerSampleWeights.push(weight);
    accelerometerTotalWeight += 1;

    // Incremental update of weighted sum (more efficient than recalculating)
    if (removedWeightedSample) {
        // Remove old contribution
        accelerometerWeightedSum = vec3Sub(accelerometerWeightedSum, removedWeightedSample);
    }
    // Add new contribution
    accelerometerWeightedSum = vec3Add(accelerometerWeightedSum, weightedSample);

    // Calculate weighted average (calibrated baseline)
    if (accelerometerTotalWeight > 0) {
        accelerometerResolved = vec3Scale(accelerometerWeightedSum, 1 / accelerometerTotalWeight);
    }
}

// Get calibration confidence (0-1): higher when window is full
function getCalibrationConfidence(): number {
    return Math.min(1, accelerometerSampleWindow.length / ACCELEROMETER_MAX_SAMPLE_COUNT);
}


//
export const gravityCorrection = (gyro: Vector3) => {
    if (isGravityAvailable()) {
        const orientationCorrection = getOrientationCorrection();
        return {
            x: gyro.x - orientationCorrection.x * GRAVITY_CORRECTION_STRENGTH,
            y: gyro.y - orientationCorrection.y * GRAVITY_CORRECTION_STRENGTH,
            z: gyro.z
        };
    }
    return gyro;
}


//
function accelerometerSmooth(accel: Vector3, dt: number = 0.1, sampleFactor: number = 1): Vector3 {
    const smoothFactor = Math.max(0.05, Math.min(dt * 1, ACCELEROMETER_SMOOTH, 1));

    // Dead-zone, smoothing and normalization
    accelerometerSmoothed = vec3Smooth(accelerometerSmoothed, accel, smoothFactor);

    // Monte Carlo base sampling (real-time calibration/bias correction)
    // Use sampleFactor as weight to account for timing variations
    addMonteCarloSample(accel, sampleFactor, accelerometerSmoothed);

    // Remove gravity component if gravity sensor is available
    //let linearAccel = vec3Sub(accelerometerSmoothed, accelerometerResolved);

    let linearAccel = (accelerometerSmoothed);

    // Apply dead-zone to final result
    return linearAccel;
}

//
let lastMovement = vec3Zero();
const computeMovementDelta = (movement: Vector3) => {
    const result = vec3Sub(movement, lastMovement);
    lastMovement = movement;
    return result;
}

//
let forSendingMovement: Vector3 = vec3Zero();
let sendWSMovement = (movement: Vector3) => {
    forSendingMovement = vec3Add(forSendingMovement, movement);

    const mappedMovement = {
        x: forSendingMovement.x * accelDirX * ACCELEROMETER_GAIN,
        y: forSendingMovement.y * accelDirY * ACCELEROMETER_GAIN,
        z: forSendingMovement.z * accelDirZ * ACCELEROMETER_GAIN
    };
    forSendingMovement = vec3Zero();

    // Jitter suppression before enqueue
    if (Math.abs(mappedMovement.x) < ACCELEROMETER_DEADZONE) mappedMovement.x = 0;
    if (Math.abs(mappedMovement.y) < ACCELEROMETER_DEADZONE) mappedMovement.y = 0;
    if (Math.abs(mappedMovement.z) < ACCELEROMETER_DEADZONE) mappedMovement.z = 0;
    if (mappedMovement.x === 0 && mappedMovement.y === 0 && mappedMovement.z === 0) return;

    enqueueMotion(mappedMovement.x, mappedMovement.y, mappedMovement.z);
}

//
const gravityBasedCorrection = (accel: Vector3) => {
    if (isGravityAvailable() && getGravityMagnitude() > 0.1) {
        const gravity = getGravityVector();
        const gravityMagnitude = getGravityMagnitude();
        return {
            x: accel.x - gravity.x * gravityMagnitude,
            y: accel.y - gravity.y * gravityMagnitude,
            z: accel.z - gravity.z * gravityMagnitude
        };
    }
    return accel;
}

// initialize accelerometer
export function initAccelerometer() {
    if (!('Accelerometer' in window)) {
        log('Accelerometer API is not supported.');
        return;
    }

    try {
        accelerometer = new (window as any).Accelerometer({ frequency: 60 });
    } catch (err: any) {
        log('Cannot create Accelerometer: ' + (err.message || err));
        return;
    }

    //
    accelerometer.addEventListener('reading', () => {
        //
        const now = performance.now();
        const dtMs = now - (lastTimestamp || now); // to avoid huge dt on first entry
        const dt = dtMs / 1000; lastTimestamp = now; // in seconds

        //
        averageRateSampled += dt; averageRateSampleCount++;
        averageRateResolved = averageRateSampled / averageRateSampleCount;

        // for lag/overshoot correction
        const averageRateFactor = (dt / averageRateResolved); // if dt > 1 has lag, dt < 1 has overshoot

        // smoothing
        const filteredAccel = accelerometerSmooth(vec3FromSensor(accelerometer!), dt, averageRateFactor);
        const corrected = gravityBasedCorrection(filteredAccel);
        const delta = vec3DeadZone(computeMovementDelta(corrected), ACCELEROMETER_DEADZONE);

        // small values after smoothing are not sent
        if (vec3IsNearZero(filteredAccel)) { return; }

        // Проверяем состояния
        if (getAirState() !== 'AIR_MOVE') { return; }
        if (!isAirPadSessionConnected()) return;
        if (aiModeActive) return;

        // selection of axes for mouse
        sendWSMovement(delta);
    });

    accelerometer.addEventListener('error', (event: any) => {
        log('Accelerometer error: ' + ((event?.error?.message) || event?.message || event));
    });

    accelerometer.start(); log('Accelerometer started (60 Hz)');
}

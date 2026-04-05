// =========================
// Gyroscope
// =========================

import { log } from '../../utils/utils';
import { isAirPadSessionConnected } from '../../network/session';
import { enqueueMotion } from '../../config/motion-state';
import { aiModeActive } from '../speech';
import { getAirState, isMotionCalibrated, setMotionCalibrated, resetMotionBaseline } from '../../ui/air-button';
import { ANGLE_DEADZONE, ANGLE_GAIN, ANGLE_SMOOTH, ANGLE_MAX_STEP, MOTION_SEND_INTERVAL, gyroDirX, gyroDirY, gyroDirZ, gyroSrcForMouseX, gyroSrcForMouseY, gyroSrcForMouseZ, GYRO_DEADZONE, GYRO_GAIN, GYRO_SMOOTH, GYRO_MAX_SAMPLE_COUNT, GYRO_ROTATION_GAIN, GRAVITY_CORRECTION_STRENGTH } from '../../config/config';
import {
    vec3Zero,
    vec3FromSensor,
    vec3NormalizeAngles,
    vec3AngleDelta,
    vec3DeadZone,
    vec3Select2D,
    vec2ApplyDirection,
    vec2Scale,
    vec3Smooth,
    vec3Clamp,
    vec3IsNearZero,
    type Vector3,
    vec3Scale,
    vec3Mix,
    vec3Add,
    vec3Sub,
    vec3Select,
    normalizeAngle,
    vec3RotateXYByAngle,
} from '../../utils/math';
import { applyDimensionalCorrection, getOrientationCorrection, isGravityAvailable } from './gravity-sensor';

//
let gyroscope: any = null;

// smoothed values of "movement" for cursor
let filteredMovement = { x: 0, y: 0 };
let lastTimestamp: number = performance.now();
let lastMotionSentAt: number = 0;

// reset IMU state (e.g. when exiting AIR_MOVE)
function resetGyroState() {
    setMotionCalibrated(false);
    filteredMovement = { x: 0, y: 0 };
    lastTimestamp = performance.now();
    lastMotionSentAt = 0;
    resetMonteCarloSampling();
    gyroscopeSmoothed = vec3Zero();
    integratedAngles = vec3Zero();
    lastGyroMovement = vec3Zero();
}

export function resetGyroscopeState() {
    resetGyroState();
    resetMotionBaseline();
}

// Called when entering AIR_MOVE mode
export function onEnterAirMove() {
    resetGyroState();
}

// Monte Carlo sampling for real-time calibration
let gyroscopeSmoothed: Vector3 = vec3Zero();
let gyroscopeResolved: Vector3 = vec3Zero(); // calibrated baseline (bias)
let integratedAngles: Vector3 = vec3Zero(); // accumulated angles

// Sliding window for Monte Carlo sampling
let gyroscopeSampleWindow: Vector3[] = [];
let gyroscopeSampleWeights: number[] = []; // weights for each sample
let gyroscopeTotalWeight = 0;
let gyroscopeWeightedSum: Vector3 = vec3Zero(); // cached weighted sum for efficiency

//
let averageRateSampleCount = 0;
let averageRateSampled = 0;
let averageRateResolved = 0;

// Reset Monte Carlo sampling window
function resetMonteCarloSampling() {
    gyroscopeSampleWindow = [];
    gyroscopeSampleWeights = [];
    gyroscopeTotalWeight = 0;
    gyroscopeWeightedSum = vec3Zero();
    gyroscopeResolved = vec3Zero();
}

// Get calibration confidence (0-1): higher when window is full
function getCalibrationConfidence(): number {
    return Math.pow(Math.min(1, gyroscopeSampleWindow.length / GYRO_MAX_SAMPLE_COUNT), 2);
}

// Add sample to sliding window Monte Carlo sampler (optimized incremental update)
function addMonteCarloSample(sample: Vector3, weight: number = 1, smoothForDiff: Vector3 = vec3Zero()): void {
    if ((Math.abs(sample.x) + Math.abs(sample.y) + Math.abs(sample.z)) < 0.0001) return;

    // too large difference from resolved - skip sample
    if (Math.hypot(smoothForDiff.x - gyroscopeResolved.x, smoothForDiff.y - gyroscopeResolved.y, smoothForDiff.z - gyroscopeResolved.z) > (1 - getCalibrationConfidence())) {
        return;
    }

    // Normalize the sample (angles)
    const normalizedSample = vec3NormalizeAngles(sample);
    const weightedSample = vec3Scale(normalizedSample, 1 / Math.max(0.001, weight));

    // Check if we need to remove oldest sample
    let removedWeightedSample: Vector3 | null = null;
    if (gyroscopeSampleWindow.length >= GYRO_MAX_SAMPLE_COUNT) {
        // Remove oldest sample (FIFO) - store for incremental update
        const removedWeight = gyroscopeSampleWeights.shift()!;
        removedWeightedSample = vec3Scale(gyroscopeSampleWindow.shift()!, removedWeight);
        gyroscopeTotalWeight -= removedWeight;
    }

    // Add new sample to window
    gyroscopeSampleWindow.push(weightedSample);
    gyroscopeSampleWeights.push(weight);
    gyroscopeTotalWeight += 1;

    // Incremental update of weighted sum (more efficient than recalculating)
    if (removedWeightedSample) {
        // Remove old contribution
        gyroscopeWeightedSum = vec3Sub(gyroscopeWeightedSum, removedWeightedSample);
    }
    // Add new contribution
    gyroscopeWeightedSum = vec3Add(gyroscopeWeightedSum, weightedSample);

    // Calculate weighted average (calibrated baseline)
    if (gyroscopeTotalWeight > 0) {
        gyroscopeResolved = vec3Scale(gyroscopeWeightedSum, 1 / gyroscopeTotalWeight);
    }
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
function gyroscopeSmooth(currentAngles: Vector3, dt: number = 0.1, sampleFactor: number = 1): Vector3 {
    const smoothFactor = Math.max(0.1, Math.min(dt * 10, GYRO_SMOOTH, 1));

    // Normalize accumulated angles
    const normAngles = (currentAngles);

    // Monte Carlo base sampling (real-time calibration/bias correction)
    addMonteCarloSample(vec3NormalizeAngles(normAngles), sampleFactor, gyroscopeSmoothed);

    // Remove bias using calibrated baseline, then smooth
    const unbiasedAngles = vec3Sub(normAngles, gyroscopeResolved);
    gyroscopeSmoothed = vec3Smooth(gyroscopeSmoothed, normAngles, smoothFactor);
    let smoothGyro = gyroscopeSmoothed;

    // Apply dead-zone after corrections
    return vec3NormalizeAngles(smoothGyro);
}

//
export const getRotatedGyro = (gyro: Vector3) => {

    //
    let selectedAxes = vec3Select(
        gyro,
        gyroSrcForMouseX as 'ax' | 'ay' | 'az',
        gyroSrcForMouseY as 'ax' | 'ay' | 'az',
        gyroSrcForMouseZ as 'ax' | 'ay' | 'az'
    );

    // Extract Z axis rotation (rotation around Z axis)
    const rotationZ = normalizeAngle(selectedAxes.z * gyroDirZ);
    return vec3RotateXYByAngle(selectedAxes, rotationZ, 1);
}


//
let lastGyroMovement: Vector3 = vec3Zero();
let forSendingGyroMovement: Vector3 = vec3Zero();
let lastSendingTime: number = 0;

//
let deltaGyroMovement: Vector3 = vec3Zero();

//
const calculateDeltaGyroMovement = (gyro: Vector3) => {
    const result = vec3Sub(gyro, lastGyroMovement);
    lastGyroMovement = gyro;
    return (deltaGyroMovement = result);
}

//
let sendWSGyroMovement = (movement: Vector3) => {
    forSendingGyroMovement = vec3Add(forSendingGyroMovement, movement);

    const baseMovement = {
        x: forSendingGyroMovement.x * gyroDirX * GYRO_GAIN,
        y: forSendingGyroMovement.y * gyroDirY * GYRO_GAIN,
        z: forSendingGyroMovement.z * GYRO_GAIN * GYRO_ROTATION_GAIN
    }; forSendingGyroMovement = vec3Zero();

    const clampedMovement: Vector3 = vec3Clamp(baseMovement, ANGLE_MAX_STEP);
    // Jitter suppression using gyro deadzone
    const jx = Math.abs(clampedMovement.x) < GYRO_DEADZONE ? 0 : clampedMovement.x;
    const jy = Math.abs(clampedMovement.y) < GYRO_DEADZONE ? 0 : clampedMovement.y;
    const jz = Math.abs(clampedMovement.z) < GYRO_DEADZONE ? 0 : clampedMovement.z;
    if (jx === 0 && jy === 0 && jz === 0) return;
    enqueueMotion(jx, jy, jz);
}

// Инициализация гироскопа
export function initGyro() {
    if (!('Gyroscope' in window)) {
        log('Gyroscope API не поддерживается.');
        return;
    }

    try {
        gyroscope = new (window as any).Gyroscope({ frequency: 60 });
    } catch (err: any) {
        log('Невозможно создать Gyroscope: ' + (err.message || err));
        return;
    }

    //
    gyroscope.addEventListener('reading', () => {
        //
        const now = performance.now();
        const dtMs = now - (lastTimestamp || now); // to avoid huge dt on first entry
        const dt = dtMs / 1000; lastTimestamp = now; // in seconds

        //
        averageRateSampled += dt; averageRateSampleCount++;
        averageRateResolved = averageRateSampled / averageRateSampleCount;

        // for lag/overshoot correction
        const averageRateFactor = (dt / averageRateResolved); // if dt > 1 has lag, dt < 1 has overshoot

        // integrate raw gyro to angles
        const rawGyro = vec3FromSensor(gyroscope!);
        integratedAngles = vec3NormalizeAngles(vec3Add(integratedAngles, vec3Scale(rawGyro, dt)));

        // smoothing & calibration on accumulated angles
        const filteredGyro = getRotatedGyro(gyroscopeSmooth(integratedAngles, dt, averageRateFactor));

        // track delta between current and previous angles
        const delta = vec3DeadZone(calculateDeltaGyroMovement(filteredGyro), GYRO_DEADZONE);

        // small values after smoothing are not sent
        if (vec3IsNearZero(delta)) { return; }

        // Проверяем состояния
        if (getAirState() !== 'AIR_MOVE') { return; }
        if (!isAirPadSessionConnected()) return;
        if (aiModeActive) return;

        // selection of axes for mouse (as you previously selected axes of accelerometer)
        sendWSGyroMovement(delta);
    });

    gyroscope.addEventListener('error', (event: any) => {
        log('Gyroscope error: ' + ((event.error && event.error.message) || event.message || event));
    });

    gyroscope.start();
    log('Gyroscope started (60 Hz, angle integration)');
}

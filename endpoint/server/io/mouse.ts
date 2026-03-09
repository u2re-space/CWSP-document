// =========================
// Mouse Movement Handling
// =========================

import { executeMouseMove } from "./actions.ts";

// Import constants
import { SERVER_JITTER_EPS, SERVER_MAX_STEP, SERVER_SMOOTH_ALPHA } from "../config/constants.ts";

// Accumulated mouse deltas and smooth target, applied at ~1000 Hz to avoid cross-source overlap
let accumDx = 0;
let accumDy = 0;
let smoothDx = 0;
let smoothDy = 0;

export function addMouseDelta(dx: number, dy: number) {
    accumDx += dx;
    accumDy += dy;
}

function flushAccumulatedMouse() {
    if (accumDx === 0 && accumDy === 0) return;

    // Clamp to avoid huge jumps
    const dx = Math.max(-SERVER_MAX_STEP, Math.min(SERVER_MAX_STEP, accumDx));
    const dy = Math.max(-SERVER_MAX_STEP, Math.min(SERVER_MAX_STEP, accumDy));

    // Skip if near-zero after accumulation
    if (Math.abs(dx) < SERVER_JITTER_EPS && Math.abs(dy) < SERVER_JITTER_EPS) {
        accumDx = 0;
        accumDy = 0;
        return;
    }

    // Move smoothing: exponential step toward accumulated target
    smoothDx += (dx - smoothDx) * SERVER_SMOOTH_ALPHA;
    smoothDy += (dy - smoothDy) * SERVER_SMOOTH_ALPHA;

    executeMouseMove(smoothDx, smoothDy);

    // Reduce the applied portion from the accumulator
    accumDx -= smoothDx;
    accumDy -= smoothDy;
}

// Start the mouse flush interval (1 ms)
export function startMouseFlushInterval() {
    setInterval(flushAccumulatedMouse, 1);
}

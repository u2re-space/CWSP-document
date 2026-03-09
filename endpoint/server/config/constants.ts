// =========================
// Server Constants
// =========================

// Message type constants
export const MSG_TYPE_MOVE = 0;
export const MSG_TYPE_CLICK = 1;
export const MSG_TYPE_SCROLL = 2;
export const MSG_TYPE_MOUSE_DOWN = 3;
export const MSG_TYPE_MOUSE_UP = 4;
export const MSG_TYPE_VOICE_COMMAND = 5;
export const MSG_TYPE_KEYBOARD = 6;

// Button constants
export const BUTTON_LEFT = 0;
export const BUTTON_RIGHT = 1;
export const BUTTON_MIDDLE = 2;
export const FLAG_DOUBLE = 0x80;

import { pickEnvNumberLegacy } from "../lib/env.ts";

// Server-side jitter and smoothing parameters
export const SERVER_JITTER_EPS = pickEnvNumberLegacy("CWS_SERVER_JITTER_EPS") ?? 0.5; // pixels; ignore tiny deltas
export const SERVER_MAX_STEP = pickEnvNumberLegacy("CWS_SERVER_MAX_STEP") ?? 2000; // safety clamp per flush (increased for LTE burst compensation)
export const SERVER_SMOOTH_ALPHA = pickEnvNumberLegacy("CWS_SERVER_SMOOTH_ALPHA") ?? 1.0; // ~exponential approach to target (1.0 = no smoothing, better for high latency)

// Ports
// HTTP server port (non-TLS). Previously used for redirect-only server.
export const HTTP_PORT = 8080;

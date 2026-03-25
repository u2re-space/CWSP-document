import type { AirPadClipboardResult, AirPadIntent } from "./intents";
import { airpadTransport } from "./transport";
import { invalidateAirpadTransportCredentials } from "../credential-cache-bridge";

export type AirPadSessionRail = "canonical-session";
export type AirPadVoiceMessage = {
    text: string;
    type: "voice_result" | "voice_error";
    actions?: unknown[];
    error?: string;
};

const ACTIVE_RAIL: AirPadSessionRail = "canonical-session";

export const getAirPadSessionRail = (): AirPadSessionRail => ACTIVE_RAIL;

export const initAirPadSessionTransport = (button: HTMLElement | null): void => {
    airpadTransport.init(button);
};

export const connectAirPadSession = (): void => {
    airpadTransport.connect();
};

export const disconnectAirPadSession = (): void => {
    airpadTransport.disconnect();
};

/**
 * After changing host/secrets/mode: drop Socket.IO, clear AES/HMAC caches, then connect again.
 * Mirrors legacy "Save & Reconnect" behavior.
 */
export function reconnectAirPadSessionAfterConfigChange(options?: { delayMs?: number }): void {
    airpadTransport.disconnect();
    invalidateAirpadTransportCredentials();
    const delayMs = options?.delayMs ?? 80;
    globalThis.setTimeout(() => {
        try {
            airpadTransport.connect();
        } catch (e) {
            console.warn("[AirPad] reconnect after config failed:", e);
        }
    }, delayMs);
}

export const isAirPadSessionConnected = (): boolean => {
    return airpadTransport.isConnected();
};
export const onAirPadSessionConnectionChange = (handler: (connected: boolean) => void): (() => void) => {
    return airpadTransport.onConnectionChange(handler);
};

export const onAirPadRemoteClipboardUpdate = (handler: (text: string, meta?: { source?: string }) => void): (() => void) => {
    return airpadTransport.onClipboardUpdate(handler);
};

export const onAirPadVoiceMessage = (handler: (message: AirPadVoiceMessage) => void): (() => void) => {
    return airpadTransport.onVoiceResult(handler);
};

export const sendAirPadIntent = (intent: AirPadIntent): void => {
    airpadTransport.sendIntent(intent);
};

export const sendAirPadKeyboardChar = (char: string): void => {
    sendAirPadIntent({ type: "keyboard.char", char });
};

export const createAirPadKeyboardMessage = (codePoint: number, flags = 0): ArrayBuffer => {
    return airpadTransport.createKeyboardMessage(codePoint, flags);
};

export const sendAirPadBinaryMessage = (buffer: ArrayBuffer | Uint8Array): void => {
    airpadTransport.sendBinary(buffer);
};

export const requestAirPadClipboardRead = async (): Promise<AirPadClipboardResult> => {
    return airpadTransport.requestClipboardRead();
};

export const requestAirPadClipboardCopy = async (): Promise<AirPadClipboardResult> => {
    return airpadTransport.requestClipboardCopy();
};

export const requestAirPadClipboardCut = async (): Promise<AirPadClipboardResult> => {
    return airpadTransport.requestClipboardCut();
};

export const requestAirPadClipboardPaste = async (text: string): Promise<AirPadClipboardResult> => {
    return airpadTransport.requestClipboardPaste(text);
};

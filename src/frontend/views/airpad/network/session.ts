import type { AirPadClipboardResult, AirPadIntent } from "./intents";
import {
    connectPacketSocketIoRail,
    createPacketSocketIoKeyboardMessage,
    disconnectPacketSocketIoRail,
    initPacketSocketIoRail,
    isPacketSocketIoRailConnected,
    onPacketSocketIoClipboardUpdate,
    onPacketSocketIoRailConnectionChange,
    requestPacketSocketIoClipboardCopy,
    requestPacketSocketIoClipboardCut,
    requestPacketSocketIoClipboardPaste,
    requestPacketSocketIoClipboardRead,
    sendPacketSocketIoBinary,
    sendPacketSocketIoIntent
} from "./rails/packet-socketio";
import { onVoiceResult } from "./websocket";
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
    initPacketSocketIoRail(button);
};

export const connectAirPadSession = (): void => {
    connectPacketSocketIoRail();
};

export const disconnectAirPadSession = (): void => {
    disconnectPacketSocketIoRail();
};

/**
 * After changing host/secrets/mode: drop Socket.IO, clear AES/HMAC caches, then connect again.
 * Mirrors legacy "Save & Reconnect" behavior.
 */
export function reconnectAirPadSessionAfterConfigChange(options?: { delayMs?: number }): void {
    disconnectPacketSocketIoRail();
    invalidateAirpadTransportCredentials();
    const delayMs = options?.delayMs ?? 80;
    globalThis.setTimeout(() => {
        try {
            connectPacketSocketIoRail();
        } catch (e) {
            console.warn("[AirPad] reconnect after config failed:", e);
        }
    }, delayMs);
}

export const isAirPadSessionConnected = (): boolean => {
    return isPacketSocketIoRailConnected();
};

export const onAirPadSessionConnectionChange = (handler: (connected: boolean) => void): (() => void) => {
    return onPacketSocketIoRailConnectionChange(handler);
};

export const onAirPadRemoteClipboardUpdate = (handler: (text: string, meta?: { source?: string }) => void): (() => void) => {
    return onPacketSocketIoClipboardUpdate(handler);
};

export const onAirPadVoiceMessage = (handler: (message: AirPadVoiceMessage) => void): (() => void) => {
    return onVoiceResult(handler);
};

export const sendAirPadIntent = (intent: AirPadIntent): void => {
    sendPacketSocketIoIntent(intent);
};

export const sendAirPadKeyboardChar = (char: string): void => {
    sendAirPadIntent({ type: "keyboard.char", char });
};

export const createAirPadKeyboardMessage = (codePoint: number, flags = 0): ArrayBuffer => {
    return createPacketSocketIoKeyboardMessage(codePoint, flags);
};

export const sendAirPadBinaryMessage = (buffer: ArrayBuffer | Uint8Array): void => {
    sendPacketSocketIoBinary(buffer);
};

export const requestAirPadClipboardRead = async (): Promise<AirPadClipboardResult> => {
    return requestPacketSocketIoClipboardRead();
};

export const requestAirPadClipboardCopy = async (): Promise<AirPadClipboardResult> => {
    return requestPacketSocketIoClipboardCopy();
};

export const requestAirPadClipboardCut = async (): Promise<AirPadClipboardResult> => {
    return requestPacketSocketIoClipboardCut();
};

export const requestAirPadClipboardPaste = async (text: string): Promise<AirPadClipboardResult> => {
    return requestPacketSocketIoClipboardPaste(text);
};

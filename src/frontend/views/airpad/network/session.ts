import type { AirPadClipboardResult, AirPadIntent } from "./intents";
import { airPadNetworkCoordinator } from "./coordinator";

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
    airPadNetworkCoordinator.init(button);
};

export const connectAirPadSession = (): void => {
    airPadNetworkCoordinator.connect();
};

export const disconnectAirPadSession = (): void => {
    airPadNetworkCoordinator.disconnect();
};

/**
 * After changing host/secrets/mode: drop WebSocket, clear AES/HMAC caches, then connect again.
 * Mirrors legacy "Save & Reconnect" behavior.
 */
export function reconnectAirPadSessionAfterConfigChange(options?: { delayMs?: number }): void {
    airPadNetworkCoordinator.reconnectAfterConfigChange(options);
}

export const isAirPadSessionConnected = (): boolean => {
    return airPadNetworkCoordinator.isConnected();
};
export const onAirPadSessionConnectionChange = (handler: (connected: boolean) => void): (() => void) => {
    return airPadNetworkCoordinator.onConnectionChange(handler);
};

export const onAirPadRemoteClipboardUpdate = (handler: (text: string, meta?: { source?: string }) => void): (() => void) => {
    return airPadNetworkCoordinator.onServerClipboardUpdate(handler);
};

export const onAirPadVoiceMessage = (handler: (message: AirPadVoiceMessage) => void): (() => void) => {
    return airPadNetworkCoordinator.onVoiceMessage(handler as unknown as (message: unknown) => void);
};

export const sendAirPadIntent = (intent: AirPadIntent): void => {
    airPadNetworkCoordinator.sendAirPadIntent(intent);
};

export const sendAirPadKeyboardChar = (char: string): void => {
    airPadNetworkCoordinator.sendAirPadKeyboardChar(char);
};

export const createAirPadKeyboardMessage = (codePoint: number, flags = 0): ArrayBuffer => {
    return airPadNetworkCoordinator.createAirPadKeyboardMessage(codePoint, flags);
};

export const sendAirPadBinaryMessage = (buffer: ArrayBuffer | Uint8Array): void => {
    airPadNetworkCoordinator.sendAirPadBinaryMessage(buffer);
};

export const requestAirPadClipboardRead = async (): Promise<AirPadClipboardResult> => {
    return airPadNetworkCoordinator.requestClipboardRead();
};

export const requestAirPadClipboardCopy = async (): Promise<AirPadClipboardResult> => {
    return airPadNetworkCoordinator.requestClipboardCopy();
};

export const requestAirPadClipboardCut = async (): Promise<AirPadClipboardResult> => {
    return airPadNetworkCoordinator.requestClipboardCut();
};

export const requestAirPadClipboardPaste = async (text: string): Promise<AirPadClipboardResult> => {
    return airPadNetworkCoordinator.requestClipboardPaste(text);
};

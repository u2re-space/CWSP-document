import type { AirPadClipboardResult, AirPadIntent } from "./intents";
import {
    connectLegacySocketIoRail,
    createLegacySocketIoKeyboardMessage,
    disconnectLegacySocketIoRail,
    initLegacySocketIoRail,
    isLegacySocketIoRailConnected,
    onLegacySocketIoClipboardUpdate,
    onLegacySocketIoRailConnectionChange,
    requestLegacySocketIoClipboardCopy,
    requestLegacySocketIoClipboardCut,
    requestLegacySocketIoClipboardPaste,
    requestLegacySocketIoClipboardRead,
    sendLegacySocketIoBinary,
    sendLegacySocketIoIntent
} from "./rails/legacy-socketio";

export type AirPadSessionRail = "canonical-session";

const ACTIVE_RAIL: AirPadSessionRail = "canonical-session";

export const getAirPadSessionRail = (): AirPadSessionRail => ACTIVE_RAIL;

export const initAirPadSessionTransport = (button: HTMLElement | null): void => {
    initLegacySocketIoRail(button);
};

export const connectAirPadSession = (): void => {
    connectLegacySocketIoRail();
};

export const disconnectAirPadSession = (): void => {
    disconnectLegacySocketIoRail();
};

export const isAirPadSessionConnected = (): boolean => {
    return isLegacySocketIoRailConnected();
};

export const onAirPadSessionConnectionChange = (handler: (connected: boolean) => void): (() => void) => {
    return onLegacySocketIoRailConnectionChange(handler);
};

export const onAirPadRemoteClipboardUpdate = (handler: (text: string, meta?: { source?: string }) => void): (() => void) => {
    return onLegacySocketIoClipboardUpdate(handler);
};

export const sendAirPadIntent = (intent: AirPadIntent): void => {
    sendLegacySocketIoIntent(intent);
};

export const sendAirPadKeyboardChar = (char: string): void => {
    sendAirPadIntent({ type: "keyboard.char", char });
};

export const createAirPadKeyboardMessage = (codePoint: number, flags = 0): ArrayBuffer => {
    return createLegacySocketIoKeyboardMessage(codePoint, flags);
};

export const sendAirPadBinaryMessage = (buffer: ArrayBuffer | Uint8Array): void => {
    sendLegacySocketIoBinary(buffer);
};

export const requestAirPadClipboardRead = async (): Promise<AirPadClipboardResult> => {
    return requestLegacySocketIoClipboardRead();
};

export const requestAirPadClipboardCopy = async (): Promise<AirPadClipboardResult> => {
    return requestLegacySocketIoClipboardCopy();
};

export const requestAirPadClipboardCut = async (): Promise<AirPadClipboardResult> => {
    return requestLegacySocketIoClipboardCut();
};

export const requestAirPadClipboardPaste = async (text: string): Promise<AirPadClipboardResult> => {
    return requestLegacySocketIoClipboardPaste(text);
};

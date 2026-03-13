import {
    connectWS,
    createKeyboardMessage,
    disconnectWS,
    initWebSocket,
    isWSConnected,
    onServerClipboardUpdate,
    onWSConnectionChange,
    requestClipboardCopy,
    requestClipboardCut,
    requestClipboardGet,
    requestClipboardPaste,
    sendBinaryMessage,
    sendKeyboardChar,
    sendWS
} from "../websocket";
import type { AirPadClipboardResult, AirPadIntent } from "../intents";

const toLegacyPayload = (intent: AirPadIntent): any => {
    switch (intent.type) {
        case "pointer.move":
            return { type: "move", dx: intent.dx, dy: intent.dy, dz: intent.dz ?? 0 };
        case "pointer.click":
            return {
                type: "click",
                button: intent.button || "left",
                double: intent.double,
                count: intent.count
            };
        case "pointer.scroll":
            return { type: "scroll", dx: intent.dx || 0, dy: intent.dy || 0 };
        case "pointer.down":
            return { type: "mouse_down", button: intent.button || "left" };
        case "pointer.up":
            return { type: "mouse_up", button: intent.button || "left" };
        case "gesture.swipe":
            return { type: "gesture_swipe", direction: intent.direction };
        case "voice.submit":
            return { type: "voice_command", text: intent.text };
        case "keyboard.char":
            return { type: "keyboard", char: intent.char };
        case "keyboard.binary":
            return { type: "keyboard", codePoint: intent.codePoint, flags: intent.flags ?? 0 };
    }
};

export const initLegacySocketIoRail = (button: HTMLElement | null): void => {
    initWebSocket(button);
};

export const connectLegacySocketIoRail = (): void => {
    connectWS();
};

export const disconnectLegacySocketIoRail = (): void => {
    disconnectWS();
};

export const isLegacySocketIoRailConnected = (): boolean => {
    return isWSConnected();
};

export const onLegacySocketIoRailConnectionChange = (handler: (connected: boolean) => void): (() => void) => {
    return onWSConnectionChange(handler);
};

export const onLegacySocketIoClipboardUpdate = (handler: (text: string, meta?: { source?: string }) => void): (() => void) => {
    return onServerClipboardUpdate(handler);
};

export const sendLegacySocketIoIntent = (intent: AirPadIntent): void => {
    if (intent.type === "keyboard.char") {
        sendKeyboardChar(intent.char);
        return;
    }
    if (intent.type === "keyboard.binary") {
        sendBinaryMessage(createKeyboardMessage(intent.codePoint, intent.flags ?? 0));
        return;
    }
    sendWS(toLegacyPayload(intent));
};

export const sendLegacySocketIoBinary = (buffer: ArrayBuffer | Uint8Array): void => {
    sendBinaryMessage(buffer);
};

export const createLegacySocketIoKeyboardMessage = (codePoint: number, flags = 0): ArrayBuffer => {
    return createKeyboardMessage(codePoint, flags);
};

export const requestLegacySocketIoClipboardRead = async (): Promise<AirPadClipboardResult> => {
    return requestClipboardGet();
};

export const requestLegacySocketIoClipboardCopy = async (): Promise<AirPadClipboardResult> => {
    return requestClipboardCopy();
};

export const requestLegacySocketIoClipboardCut = async (): Promise<AirPadClipboardResult> => {
    return requestClipboardCut();
};

export const requestLegacySocketIoClipboardPaste = async (text: string): Promise<AirPadClipboardResult> => {
    return requestClipboardPaste(text);
};

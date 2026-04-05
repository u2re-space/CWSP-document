import {
    connectWS,
    disconnectWS,
    initWebSocket,
    isWSConnected,
    onServerClipboardUpdate,
    onWSConnectionChange,
    sendCoordinatorAct,
    sendCoordinatorRequest
} from "../websocket";
import type { AirPadClipboardResult, AirPadIntent } from "../intents";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const toCoordinatorAction = (intent: AirPadIntent): { what: string; payload: any } | null => {
    switch (intent.type) {
        case "pointer.move":
            return { what: "mouse:move", payload: { x: intent.dx, y: intent.dy, z: intent.dz ?? 0 } };
        case "pointer.click":
            return {
                what: "mouse:click",
                payload: {
                    button: intent.button || "left",
                    double: Boolean(intent.double || intent.count === 2)
                }
            };
        case "pointer.scroll":
            return { what: "mouse:scroll", payload: { dx: intent.dx || 0, dy: intent.dy || 0 } };
        case "pointer.down":
            return { what: "mouse:down", payload: { button: intent.button || "left" } };
        case "pointer.up":
            return { what: "mouse:up", payload: { button: intent.button || "left" } };
        case "voice.submit":
            return { what: "voice:submit", payload: { text: intent.text } };
        case "keyboard.char":
            switch (intent.char) {
                case "\b":
                case "\u007F":
                    return { what: "keyboard:tap", payload: { key: "backspace" } };
                case "\n":
                case "\r":
                    return { what: "keyboard:tap", payload: { key: "enter" } };
                case "\t":
                    return { what: "keyboard:tap", payload: { key: "tab" } };
                default:
                    if (intent.char === " ") {
                        return { what: "keyboard:tap", payload: { key: "space" } };
                    }
                    return { what: "keyboard:type", payload: { text: intent.char } };
            }
        case "keyboard.binary":
            switch (intent.flags ?? 0) {
                case 1:
                    return { what: "keyboard:tap", payload: { key: "backspace" } };
                case 2:
                    return { what: "keyboard:tap", payload: { key: "enter" } };
                case 3:
                    return { what: "keyboard:tap", payload: { key: "space" } };
                case 4:
                    return { what: "keyboard:tap", payload: { key: "tab" } };
                default:
                    return { what: "keyboard:type", payload: { text: String.fromCodePoint(intent.codePoint) } };
            }
        case "gesture.swipe":
            return null;
    }
};

export const initPacketSocketIoRail = (button: HTMLElement | null): void => {
    initWebSocket(button);
};

export const connectPacketSocketIoRail = (): void => {
    connectWS();
};

export const disconnectPacketSocketIoRail = (): void => {
    disconnectWS();
};

export const isPacketSocketIoRailConnected = (): boolean => {
    return isWSConnected();
};

export const onPacketSocketIoRailConnectionChange = (handler: (connected: boolean) => void): (() => void) => {
    return onWSConnectionChange(handler);
};

export const onPacketSocketIoClipboardUpdate = (handler: (text: string, meta?: { source?: string }) => void): (() => void) => {
    return onServerClipboardUpdate(handler);
};

export const sendPacketSocketIoIntent = (intent: AirPadIntent): void => {
    if (intent.type === "gesture.swipe") {
        return;
    }
    const action = toCoordinatorAction(intent);
    if (!action) return;
    sendCoordinatorAct(action.what, action.payload);
};

export const sendPacketSocketIoBinary = (buffer: ArrayBuffer | Uint8Array): void => {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (bytes.byteLength < 6) return;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const type = view.getUint8(4);
    if (type !== 6) return;
    const codePoint = view.getUint32(0, true);
    const flags = view.getUint8(5);
    sendPacketSocketIoIntent({ type: "keyboard.binary", codePoint, flags });
};

export const createPacketSocketIoKeyboardMessage = (codePoint: number, flags = 0): ArrayBuffer => {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setUint32(0, codePoint, true);
    view.setUint8(4, 6);
    view.setUint8(5, flags);
    view.setUint16(6, 0, true);
    return buffer;
};

export const requestPacketSocketIoClipboardRead = async (): Promise<AirPadClipboardResult> => {
    try {
        const text = await sendCoordinatorRequest("clipboard:get", {});
        return { ok: true, text: typeof text === "string" ? text : String(text || "") };
    } catch (error: any) {
        return { ok: false, error: error?.error || error?.message || String(error) };
    }
};

export const requestPacketSocketIoClipboardCopy = async (): Promise<AirPadClipboardResult> => {
    try {
        await sendCoordinatorRequest("keyboard:tap", { key: "c", modifier: ["control"] });
        await sleep(60);
        return await requestPacketSocketIoClipboardRead();
    } catch (error: any) {
        return { ok: false, error: error?.error || error?.message || String(error) };
    }
};

export const requestPacketSocketIoClipboardCut = async (): Promise<AirPadClipboardResult> => {
    try {
        await sendCoordinatorRequest("keyboard:tap", { key: "x", modifier: ["control"] });
        await sleep(60);
        return await requestPacketSocketIoClipboardRead();
    } catch (error: any) {
        return { ok: false, error: error?.error || error?.message || String(error) };
    }
};

export const requestPacketSocketIoClipboardPaste = async (text: string): Promise<AirPadClipboardResult> => {
    try {
        await sendCoordinatorRequest("clipboard:update", { text });
        await sleep(20);
        await sendCoordinatorRequest("keyboard:tap", { key: "v", modifier: ["control"] });
        return { ok: true };
    } catch (error: any) {
        return { ok: false, error: error?.error || error?.message || String(error) };
    }
};

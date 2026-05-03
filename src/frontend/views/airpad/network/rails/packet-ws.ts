import { isShellRemoteClipboardBridgeEnabled } from "../../config/config";
import {
    connectWS,
    disconnectWS,
    initWebSocket,
    isWSConnected,
    onServerClipboardUpdate,
    onWSConnectionChange,
    sendCoordinatorAct,
    sendCoordinatorRequest
} from "shared/transport/websocket";
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

const toSpecAirpadAction = (action: { what: string; payload: any }): { what: string; payload: any } => {
    if (action.what.startsWith("mouse:")) {
        return {
            what: "airpad:mouse",
            payload: {
                op: action.what,
                params: [action.what],
                data: action.payload
            }
        };
    }
    if (action.what.startsWith("keyboard:")) {
        return {
            what: "airpad:keyboard",
            payload: {
                op: action.what,
                params: [action.what],
                data: action.payload
            }
        };
    }
    return action;
};

const sendKeyboardTapCompat = async (key: string, modifier?: string[]): Promise<void> => {
    const payload = { op: "keyboard:tap", params: ["keyboard:tap"], data: { key, modifier: modifier || [] } };
    try {
        await sendCoordinatorRequest("airpad:keyboard", payload);
    } catch {
        await sendCoordinatorRequest("keyboard:tap", { key, modifier: modifier || [] });
    }
};

const requestClipboardReadCompat = async (): Promise<string> => {
    try {
        const text = await sendCoordinatorRequest("airpad:clipboard:read", {
            op: "airpad:clipboard:read",
            params: ["airpad:clipboard:read"]
        });
        return typeof text === "string" ? text : String(text || "");
    } catch {
        const text = await sendCoordinatorRequest("clipboard:get", {});
        return typeof text === "string" ? text : String(text || "");
    }
};

const requestClipboardWriteCompat = async (text: string): Promise<void> => {
    try {
        await sendCoordinatorRequest("airpad:clipboard:write", {
            op: "airpad:clipboard:write",
            params: ["airpad:clipboard:write"],
            data: { text }
        });
    } catch {
        await sendCoordinatorRequest("clipboard:update", { text });
    }
};

export const initPacketWsRail = (button: HTMLElement | null): void => {
    initWebSocket(button);
};

export const connectPacketWsRail = (): void => {
    connectWS();
};

export const disconnectPacketWsRail = (): void => {
    disconnectWS();
};

export const isPacketWsRailConnected = (): boolean => {
    return isWSConnected();
};

export const onPacketWsRailConnectionChange = (handler: (connected: boolean) => void): (() => void) => {
    return onWSConnectionChange(handler);
};

export const onPacketWsClipboardUpdate = (handler: (text: string, meta?: { source?: string }) => void): (() => void) => {
    return onServerClipboardUpdate(handler);
};

export const sendPacketWsIntent = (intent: AirPadIntent): void => {
    if (intent.type === "gesture.swipe") {
        return;
    }
    const action = toCoordinatorAction(intent);
    if (!action) return;
    const specAction = toSpecAirpadAction(action);
    sendCoordinatorAct(specAction.what, specAction.payload);
};

export const sendPacketWsBinary = (buffer: ArrayBuffer | Uint8Array): void => {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (bytes.byteLength < 6) return;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const type = view.getUint8(4);
    if (type !== 6) return;
    const codePoint = view.getUint32(0, true);
    const flags = view.getUint8(5);
    sendPacketWsIntent({ type: "keyboard.binary", codePoint, flags });
};

export const createPacketWsKeyboardMessage = (codePoint: number, flags = 0): ArrayBuffer => {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setUint32(0, codePoint, true);
    view.setUint8(4, 6);
    view.setUint8(5, flags);
    view.setUint16(6, 0, true);
    return buffer;
};

export const requestPacketWsClipboardRead = async (): Promise<AirPadClipboardResult> => {
    if (!isShellRemoteClipboardBridgeEnabled()) {
        return { ok: false, error: "Remote clipboard bridge disabled in Settings → Server → Embedded shell." };
    }
    try {
        const text = await requestClipboardReadCompat();
        return { ok: true, text };
    } catch (error: any) {
        return { ok: false, error: error?.error || error?.message || String(error) };
    }
};

export const requestPacketWsClipboardCopy = async (): Promise<AirPadClipboardResult> => {
    if (!isShellRemoteClipboardBridgeEnabled()) {
        return { ok: false, error: "Remote clipboard bridge disabled in Settings → Server → Embedded shell." };
    }
    try {
        await sendKeyboardTapCompat("c", ["control"]);
        await sleep(60);
        return await requestPacketWsClipboardRead();
    } catch (error: any) {
        return { ok: false, error: error?.error || error?.message || String(error) };
    }
};

export const requestPacketWsClipboardCut = async (): Promise<AirPadClipboardResult> => {
    if (!isShellRemoteClipboardBridgeEnabled()) {
        return { ok: false, error: "Remote clipboard bridge disabled in Settings → Server → Embedded shell." };
    }
    try {
        await sendKeyboardTapCompat("x", ["control"]);
        await sleep(60);
        return await requestPacketWsClipboardRead();
    } catch (error: any) {
        return { ok: false, error: error?.error || error?.message || String(error) };
    }
};

export const requestPacketWsClipboardPaste = async (text: string): Promise<AirPadClipboardResult> => {
    if (!isShellRemoteClipboardBridgeEnabled()) {
        return { ok: false, error: "Remote clipboard bridge disabled in Settings → Server → Embedded shell." };
    }
    try {
        await requestClipboardWriteCompat(text);
        await sleep(20);
        await sendKeyboardTapCompat("v", ["control"]);
        return { ok: true };
    } catch (error: any) {
        return { ok: false, error: error?.error || error?.message || String(error) };
    }
};

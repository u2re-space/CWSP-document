import {
    createPacketWsKeyboardMessage,
    initPacketWsRail,
    connectPacketWsRail,
    disconnectPacketWsRail,
    isPacketWsRailConnected,
    onPacketWsClipboardUpdate,
    onPacketWsRailConnectionChange,
    requestPacketWsClipboardCopy,
    requestPacketWsClipboardCut,
    requestPacketWsClipboardPaste,
    requestPacketWsClipboardRead,
    sendPacketWsBinary,
    sendPacketWsIntent
} from "./rails/packet-ws";
import type { AirPadClipboardResult, AirPadIntent } from "./intents";
import { invalidateAirpadTransportCredentials } from "../credential-cache-bridge";
import {
    sendCoordinatorAct,
    sendCoordinatorAsk,
    sendCoordinatorRequest,
    onVoiceResult,
    isWSConnected
} from "shared/transport/websocket";
import { getRemoteHost, getRemoteProtocol } from "../config/config";

export interface AirPadNetworkCoordinatorState {
    connected: boolean;
    state: string;
    host: string;
    protocol: string;
    detail: string | null;
    timestampMs: number;
}

export interface AirPadNetworkCoordinator {
    init(button: HTMLElement | null): void;
    connect(): void;
    disconnect(): void;
    reconnectAfterConfigChange(options?: { delayMs?: number }): void;
    isConnected(): boolean;
    getRemoteHost(): string;
    getState(): AirPadNetworkCoordinatorState;
    onConnectionChange(handler: (connected: boolean) => void): () => void;
    onServerClipboardUpdate(handler: (text: string, meta?: { source?: string }) => void): () => void;
    onStateChange(handler: (state: string, detail: string | null) => void): () => void;
    onVoiceMessage(handler: (message: unknown) => void): () => void;
    sendCoordinatorAct(what: string, payload: unknown, nodes?: string[]): boolean;
    sendCoordinatorAsk(what: string, payload: unknown, nodes?: string[]): Promise<any>;
    sendCoordinatorRequest(what: string, payload: unknown, nodes?: string[]): Promise<any>;
    sendAirPadIntent(intent: AirPadIntent): void;
    sendAirPadKeyboardChar(char: string): void;
    createAirPadKeyboardMessage(codePoint: number, flags?: number): ArrayBuffer;
    sendAirPadBinaryMessage(buffer: ArrayBuffer | Uint8Array): void;
    requestClipboardRead(): Promise<AirPadClipboardResult>;
    requestClipboardCopy(): Promise<AirPadClipboardResult>;
    requestClipboardCut(): Promise<AirPadClipboardResult>;
    requestClipboardPaste(text: string): Promise<AirPadClipboardResult>;
    requestClipboardHistory(target: string): Promise<any>;
    sendClipboardUpdate(text: string, target?: string): Promise<any>;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const snapshotState = (): AirPadNetworkCoordinatorState => {
    const connected = isPacketWsRailConnected();
    return {
        connected,
        state: connected ? "connected" : "disconnected",
        host: getRemoteHost(),
        protocol: getRemoteProtocol(),
        detail: connected ? null : "disconnected",
        timestampMs: Date.now()
    };
};

/**
 * AirPad-specific coordinator abstraction that aligns with the CRX network
 * coordinator contract while preserving existing rail-level features.
 */
export const airPadNetworkCoordinator: AirPadNetworkCoordinator = {
    init(button: HTMLElement | null): void {
        initPacketWsRail(button);
    },

    connect(): void {
        connectPacketWsRail();
    },

    disconnect(): void {
        disconnectPacketWsRail();
    },

    reconnectAfterConfigChange(options?: { delayMs?: number }): void {
        disconnectPacketWsRail();
        invalidateAirpadTransportCredentials();
        const delayMs = options?.delayMs ?? 80;
        sleep(delayMs).then(() => {
            connectPacketWsRail();
        }).catch(() => {
            console.warn("[AirPad] reconnect after config failed");
        });
    },

    isConnected(): boolean {
        return isWSConnected();
    },

    getRemoteHost(): string {
        return getRemoteHost();
    },

    getState(): AirPadNetworkCoordinatorState {
        return snapshotState();
    },

    onConnectionChange(handler: (connected: boolean) => void): () => void {
        return onPacketWsRailConnectionChange(handler);
    },

    onServerClipboardUpdate(handler: (text: string, meta?: { source?: string }) => void): () => void {
        return onPacketWsClipboardUpdate(handler);
    },

    onStateChange(handler: (state: string, detail: string | null) => void): () => void {
        handler(snapshotState().state, snapshotState().detail);
        const off = onPacketWsRailConnectionChange((connected) => {
            const detail = connected ? null : "disconnected";
            handler(connected ? "connected" : "disconnected", detail);
        });
        return () => {
            off();
        };
    },

    onVoiceMessage(handler: (message: unknown) => void): () => void {
        return onVoiceResult((message) => {
            handler(message);
        });
    },

    sendCoordinatorAct(what: string, payload: unknown, nodes?: string[]): boolean {
        return sendCoordinatorAct(what, payload, nodes);
    },

    sendCoordinatorAsk(what: string, payload: unknown, nodes?: string[]): Promise<any> {
        return sendCoordinatorAsk(what, payload, nodes);
    },

    sendCoordinatorRequest(what: string, payload: unknown, nodes?: string[]): Promise<any> {
        return sendCoordinatorRequest(what, payload, nodes);
    },

    sendAirPadIntent(intent: AirPadIntent): void {
        sendPacketWsIntent(intent);
    },

    sendAirPadKeyboardChar(char: string): void {
        sendPacketWsIntent({ type: "keyboard.char", char });
    },

    createAirPadKeyboardMessage(codePoint: number, flags = 0): ArrayBuffer {
        return createPacketWsKeyboardMessage(codePoint, flags);
    },

    sendAirPadBinaryMessage(buffer: ArrayBuffer | Uint8Array): void {
        sendPacketWsBinary(buffer);
    },

    requestClipboardRead(): Promise<AirPadClipboardResult> {
        return requestPacketWsClipboardRead();
    },

    requestClipboardCopy(): Promise<AirPadClipboardResult> {
        return requestPacketWsClipboardCopy();
    },

    requestClipboardCut(): Promise<AirPadClipboardResult> {
        return requestPacketWsClipboardCut();
    },

    requestClipboardPaste(text: string): Promise<AirPadClipboardResult> {
        return requestPacketWsClipboardPaste(text);
    },

    requestClipboardHistory(target: string): Promise<any> {
        return sendCoordinatorRequest("clipboard:get", { request: "history", target }, [target]);
    },

    sendClipboardUpdate(text: string, target?: string): Promise<any> {
        const payload = target ? { text, target } : { text };
        return sendCoordinatorRequest("clipboard:update", payload, target ? [target] : undefined);
    }
};

/**
 * CRX network sub-coordinator.
 *
 * Provides a small, explicit facade for the shared CWSP network transport in
 * all Chrome extension contexts. The coordinator is intentionally thin:
 * it applies shell settings, enforces shell-native fallback rules, and exposes
 * a compact API for act/ask/request packets plus clipboard + connection hooks.
 */

import type { AppSettings } from "../../frontend/shared/config/SettingsTypes";
import { loadSettings } from "../../com/config/Settings";
import { isCapacitorCwsNativeShell } from "../../frontend/shared/native/cws-bridge";
import {
    applyAirpadRuntimeFromAppSettings,
    getRemoteHost,
    isMaintainHubSocketConnectionEnabled,
    isPreferNativeWebsocketEnabled,
} from "../../frontend/views/airpad/config/config";
import {
    connectWS,
    disconnectWS,
    initWebSocket,
    isWSConnected,
    onServerClipboardUpdate,
    onWSConnectionChange,
    sendCoordinatorAct,
    sendCoordinatorAsk,
    sendCoordinatorRequest,
} from "../../frontend/shared/transport/websocket";

type NetworkClipboardMeta = { source?: string };
type NetworkClipboardHandler = (text: string, meta?: NetworkClipboardMeta) => void;
type ConnectionHandler = (connected: boolean) => void;

export interface CrxNetworkCoordinator {
    startFromStoredSettings(): Promise<void>;
    startFromSettings(settings: AppSettings): Promise<void>;
    stop(): void;
    isConnected(): boolean;
    getRemoteHost(): string;
    onConnectionChange(handler: ConnectionHandler): () => void;
    onServerClipboardUpdate(handler: NetworkClipboardHandler): () => void;
    sendCoordinatorAct(what: string, payload: any, nodes?: string[]): boolean;
    sendCoordinatorAsk(what: string, payload: any, nodes?: string[]): Promise<any>;
    sendCoordinatorRequest(what: string, payload: any, nodes?: string[]): Promise<any>;
}

const createCoordinator = (): CrxNetworkCoordinator => {
    const shouldSkipConnection = (): boolean => {
        if (isCapacitorCwsNativeShell() && isPreferNativeWebsocketEnabled()) {
            return true;
        }
        return false;
    };

    const startFromSettings = async (settings: AppSettings): Promise<void> => {
        applyAirpadRuntimeFromAppSettings(settings);

        if (shouldSkipConnection()) return;
        if (!isMaintainHubSocketConnectionEnabled()) return;

        const host = getRemoteHost().trim();
        if (!host) return;

        initWebSocket(null);
        connectWS();
    };

    return {
        startFromStoredSettings: async () => {
            const settings = await loadSettings();
            await startFromSettings(settings);
        },

        startFromSettings,

        stop: () => {
            disconnectWS();
        },

        isConnected: () => isWSConnected(),

        getRemoteHost: () => getRemoteHost().trim(),

        onConnectionChange: (handler: ConnectionHandler) => onWSConnectionChange(handler),

        onServerClipboardUpdate: (handler: NetworkClipboardHandler) => onServerClipboardUpdate(handler),

        sendCoordinatorAct: (what: string, payload: any, nodes?: string[]) => sendCoordinatorAct(what, payload, nodes),

        sendCoordinatorAsk: (what: string, payload: any, nodes?: string[]) => sendCoordinatorAsk(what, payload, nodes),

        sendCoordinatorRequest: (what: string, payload: any, nodes?: string[]) => sendCoordinatorRequest(what, payload, nodes),
    };
};

let instance: CrxNetworkCoordinator | null = null;

export const getCrxNetworkCoordinator = (): CrxNetworkCoordinator => {
    if (!instance) {
        instance = createCoordinator();
    }
    return instance;
};

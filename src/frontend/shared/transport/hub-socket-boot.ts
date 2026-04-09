/**
 * Unified hub transport: Socket.IO to cwsp / endpoint (same stack as AirPad), optional background connection.
 * Used from main PWA boot, Settings save, and CRX shells so clipboard coordinator works outside the AirPad view.
 */

import type { AppSettings } from "@rs-com/config/SettingsTypes";
import { loadSettings } from "../config/Settings";
import {
    applyAirpadRuntimeFromAppSettings,
    getRemoteHost,
    isMaintainHubSocketConnectionEnabled
} from "../../views/airpad/config/config";

/**
 * Load stored settings, apply AirPad / shell runtime, then connect or disconnect the hub socket.
 */
export async function bootHubSocketFromStoredSettings(): Promise<void> {
    const settings = await loadSettings();
    await applyHubSocketFromSettings(settings);
}

/**
 * Apply after any settings mutation (Save, storage sync). Idempotent with {@link applyAirpadRuntimeFromAppSettings}.
 */
export async function applyHubSocketFromSettings(settings: AppSettings): Promise<void> {
    applyAirpadRuntimeFromAppSettings(settings);

    if (!isMaintainHubSocketConnectionEnabled()) {
        // Do not disconnect: user may still use a manual AirPad "WS" connection.
        return;
    }

    const host = getRemoteHost().trim();
    if (!host) {
        return;
    }

    const { initWebSocket, connectWS } = await import("../../views/airpad/network/websocket");
    initWebSocket(null);
    connectWS();
}

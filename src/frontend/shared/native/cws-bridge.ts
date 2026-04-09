/**
 * Unified CWSP bridge: Capacitor WebView / CWSAndroid (Kotlin) ↔ TypeScript.
 * Native implementation: `runtime/cwsp/plugins/capacitor-cws-bridge/android` (@CapacitorPlugin name CwsBridge).
 */
import type { PluginListenerHandle } from "@capacitor/core";
import { registerPlugin, WebPlugin } from "@capacitor/core";

export interface CwsShellInfo {
    shell: string;
    bridge: string;
    native: boolean;
    platform?: string;
}

export interface CwsBridgeInvokeResult {
    ok: boolean;
    channel: string;
    echo: Record<string, unknown>;
}

export interface CwsBridgePluginContract {
    getShellInfo(): Promise<CwsShellInfo>;
    invoke(options: { channel: string; payload?: Record<string, unknown> }): Promise<CwsBridgeInvokeResult>;
    addListener(
        eventName: "nativeMessage",
        listenerFunc: (event: { payload?: Record<string, unknown> }) => void
    ): Promise<PluginListenerHandle>;
    removeAllListeners(): Promise<void>;
}

class CwsBridgeWeb extends WebPlugin implements CwsBridgePluginContract {
    async getShellInfo(): Promise<CwsShellInfo> {
        return {
            shell: "browser",
            bridge: "cws-bridge",
            native: false,
            platform: typeof globalThis.navigator !== "undefined" ? "web" : "unknown"
        };
    }

    async invoke(options: { channel: string; payload?: Record<string, unknown> }): Promise<CwsBridgeInvokeResult> {
        return { ok: true, channel: options.channel, echo: { ...(options.payload ?? {}) } };
    }
}

export const CwsBridge = registerPlugin<CwsBridgePluginContract>("CwsBridge", {
    web: () => new CwsBridgeWeb()
});

declare global {
    interface Window {
        __CWS_SHELL_INFO__?: CwsShellInfo;
    }
}

let bridgeInitDone = false;

/** Best-effort: resolves shell metadata and subscribes to {@code nativeMessage} → {@code cws-native-message} on window. */
export async function initCwsNativeBridge(): Promise<CwsShellInfo | null> {
    if (bridgeInitDone) {
        return typeof globalThis.window !== "undefined" ? globalThis.window.__CWS_SHELL_INFO__ ?? null : null;
    }
    bridgeInitDone = true;
    try {
        const info = await CwsBridge.getShellInfo();
        if (typeof globalThis.window !== "undefined") {
            globalThis.window.__CWS_SHELL_INFO__ = info;
        }
        try {
            await CwsBridge.addListener("nativeMessage", (event) => {
                globalThis.dispatchEvent(new CustomEvent("cws-native-message", { detail: event }));
            });
        } catch {
            /* no native bridge */
        }
        return info;
    } catch {
        return null;
    }
}

export const isCapacitorCwsNativeShell = (): boolean => {
    try {
        const c = (globalThis as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
        return typeof c?.isNativePlatform === "function" && Boolean(c.isNativePlatform());
    } catch {
        return false;
    }
};

/** Opaque channel → Kotlin/Compose (override {@code CwsBridgePlugin.invoke} in CWSAndroid for real routing). */
export async function invokeCwsNative(
    channel: string,
    payload?: Record<string, unknown>
): Promise<CwsBridgeInvokeResult> {
    return CwsBridge.invoke({ channel, payload });
}

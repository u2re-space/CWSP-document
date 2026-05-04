// =========================
// Конфигурация
// =========================

import type { AppSettings } from "com/config/SettingsTypes";
import {
    parseWireTargetList,
    wireTargetNodeIds,
    type WireTargetEntry
} from "cwsp-shared/wire-target-id";
import {
    resolveWireArchetype,
    resolveWireConnectionType,
} from "cwsp-shared/cws-client-wire-defaults";
import { invalidateAirpadTransportCredentials } from "../credential-cache-bridge";

export type { WireTargetEntry };

type RemoteProtocol = 'auto' | 'http' | 'https';
export type AirpadTransportMode = "plaintext" | "secure";
const STORAGE_KEY = 'airpad.remote.connection.v1';

interface StoredRemoteConfig {
    /** Raw quick-connect field text as entered in the AirPad popup. */
    quickConnectValue?: string;
    /** Routed relay / endpoint origin, e.g. https://192.168.0.200:8443/ */
    endpointUrl?: string;
    /** Direct AirPad / endpoint origin, e.g. https://192.168.0.110:8443/ */
    directUrl?: string;
    /** Logical destination peer id, e.g. L-192.168.0.110 */
    destinationId?: string;
    /** Legacy combined transport host field retained for migration only. */
    host?: string;
    /** Canonical persisted control / access token. */
    accessToken?: string;
    /** @deprecated Legacy key; merged into accessToken on load. */
    authToken?: string;
    routeTarget?: string;
    clientId?: string;
    /** Stable per-browser tab/install; separates concurrent devices sharing the same clientId/token. */
    peerInstanceId?: string;
}
interface MigratedRemoteConfig extends StoredRemoteConfig {
    _legacyMigrated?: boolean;
}

const toTrimmedString = (value: unknown): string => {
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
    return typeof value === "string" ? value.trim() : "";
};
const hasExplicitPort = (value: string): boolean => {
    const valueTrimmed = value.trim();
    if (!valueTrimmed) return false;
    const hostSpec = valueTrimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split("/")[0];
    const at = hostSpec.lastIndexOf(":");
    if (at <= 0) return false;
    const port = hostSpec.slice(at + 1);
    return /^\d{1,5}$/.test(port);
};
const appendPort = (value: string, port: string): string => {
    const valueTrimmed = value.trim();
    if (!valueTrimmed) return "";
    const portTrimmed = port.trim();
    if (!portTrimmed) return valueTrimmed;
    if (hasExplicitPort(valueTrimmed)) return valueTrimmed;
    return `${valueTrimmed}:${portTrimmed}`;
};

const normalizeOriginUrl = (value: unknown): string => {
    const trimmed = toTrimmedString(value);
    if (!trimmed) return "";
    try {
        const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
        return `${url.protocol}//${url.host}/`;
    } catch {
        return trimmed;
    }
};

const looksLikeConnectUrl = (value: string): boolean => {
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return true;
    if (trimmed.startsWith("localhost")) return true;
    if (trimmed.includes("/")) return true;
    if (/^\[[0-9a-f:]+\](?::\d{1,5})?$/i.test(trimmed)) return true;
    if (/^\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?$/.test(trimmed)) return true;
    if (/^[^.\s:]+:\d{1,5}$/.test(trimmed)) return true;
    if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d{1,5})?$/i.test(trimmed)) return true;
    return false;
};

const joinUniqueUrls = (...values: Array<string | undefined>): string => {
    return Array.from(
        new Set(
            values
                .map((entry) => normalizeOriginUrl(entry))
                .filter(Boolean)
        )
    ).join(", ");
};

function loadStoredRemoteConfig(): MigratedRemoteConfig {
    try {
        const raw = globalThis?.localStorage?.getItem?.(STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as StoredRemoteConfig;
        if (!parsed || typeof parsed !== "object") return {};

        const source = parsed as Record<string, unknown>;
        const sourceHost = toTrimmedString(source.host);
        const sourceTunnelHost = toTrimmedString((source as { tunnelHost?: unknown }).tunnelHost);
        const sourcePort = toTrimmedString((source as { port?: unknown }).port);

        const hasLegacyConfig = sourcePort !== "" || sourceTunnelHost !== "";
        if (!hasLegacyConfig) {
            return parsed;
        }

        const hostParts: string[] = [];
        const seen = new Set<string>();
        const addHostPart = (hostValue: string): void => {
            const merged = sourcePort ? appendPort(hostValue, sourcePort) : hostValue;
            const normalized = merged.trim();
            if (!normalized || seen.has(normalized)) return;
            seen.add(normalized);
            hostParts.push(normalized);
        };

        if (sourceHost) addHostPart(sourceHost);
        if (sourceTunnelHost) addHostPart(sourceTunnelHost);
        if (!sourceHost && !sourceTunnelHost && sourcePort && location?.hostname) {
            addHostPart(`${location.hostname}:${sourcePort}`);
        }

        return {
            ...parsed,
            host: hostParts.join(", "),
            _legacyMigrated: true,
        };
    } catch {
        return {};
    }
}

const readGlobalAirpadValue = (keys: string[]): string => {
    const globalValue = (globalThis as any).AIRPAD_CONFIG;
    for (const key of keys) {
        const direct = (globalThis as any)[key];
        if (typeof direct === "string" && direct.trim()) {
            return direct.trim();
        }
        const fromConfig = globalValue && typeof globalValue === "object" && typeof globalValue[key] === "string" ? globalValue[key] : "";
        if (fromConfig.trim()) {
            return String(fromConfig).trim();
        }
    }
    return "";
};

function persistRemoteConfig(): void {
    try {
        globalThis?.localStorage?.setItem?.(STORAGE_KEY, JSON.stringify({
            quickConnectValue: remoteConfig.quickConnectValue,
            endpointUrl: remoteConfig.endpointUrl,
            directUrl: remoteConfig.directUrl,
            destinationId: remoteConfig.destinationId,
            accessToken: remoteConfig.accessToken,
            clientId: remoteConfig.clientId,
            peerInstanceId: remoteConfig.peerInstanceId,
        }));
    } catch {
        // localStorage unavailable (private mode, SSR, etc.)
    }
}

const createPeerInstanceId = (): string => {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `ap-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
};

// Remote connection settings.
// endpointUrl describes the routed relay / endpoint origin used for proxied sessions.
// directUrl describes the direct AirPad target origin used when bypassing the relay.
// destinationId is optional and describes which peer/device to route to by default.

const remoteConfig: {
    quickConnectValue: string;
    endpointUrl: string;
    directUrl: string;
    accessToken: string;
    destinationId: string;
    clientId: string;
    peerInstanceId: string;
} = {
    quickConnectValue: "",
    endpointUrl: "",
    directUrl: "",
    accessToken: "",
    destinationId: "",
    clientId: "",
    peerInstanceId: "",
};

/** IndexedDB “Server” tab: userId fallback for AirPad client identity (CWS_ASSOCIATED_*). */
let coreIdentityBridgeUserId = "";
let coreIdentityBridgeUserKey = "";
let coreIdentityUseForAirpad = true;

/** Shell / Capacitor toggles (coordinator + future native bridges). */
let shellRemoteClipboardEnabled = true;
let shellApplyRemoteToDevice = true;
let shellPushLocalClipboard = false;
let shellClipboardPushIntervalMs = 2000;
let shellClipboardBroadcastTargets = "";
let shellMaintainHubSocket = false;
let shellPreferNativeWebsocket = true;
let shellNativeSmsEnabled = true;
let shellNativeContactsEnabled = true;
let shellAcceptInboundClipboardData = true;
let shellClipboardInboundAllowIds = "";
let shellClipboardShareDestinationIds = "";
let shellAccessTokenBypassesClipboardAllowlist = false;
let shellAcceptContactsBridgeData = false;
let shellAcceptSmsBridgeData = false;
let coreSocketProtocol: RemoteProtocol = "auto";
let coreSocketRouteTarget = "";
let coreSocketSelfId = "";
let coreSocketAccessToken = "";
let coreSocketClientAccessToken = "";
let coreSocketTransportMode: AirpadTransportMode = "plaintext";
let coreSocketTransportSecret = "";
let coreSocketSigningSecret = "";
let coreSocketConnectionType = "";
let coreSocketArchetype = "";
let coreSocketProtocolLanesJson = "";

export let remoteHost = "";

const refreshRemoteHost = (): void => {
    // WHY: the one-field AirPad quick-connect UI now maps URL input to `directUrl`,
    // so try that override before the durable Server-tab endpoint URL.
    remoteHost = joinUniqueUrls(remoteConfig.directUrl, remoteConfig.endpointUrl);
};

/**
 * Apply settings from a stored blob (localStorage shape). Safe to call on tab focus / storage events.
 */
function hydrateFromStored(stored: MigratedRemoteConfig): void {
    const legacyHost = toTrimmedString((stored as StoredRemoteConfig).host);
    const legacyRouteTarget = toTrimmedString((stored as StoredRemoteConfig).routeTarget);
    const endpointUrl =
        normalizeOriginUrl((stored as StoredRemoteConfig).endpointUrl) ||
        (legacyRouteTarget ? normalizeOriginUrl(legacyHost) : "");
    const directUrl =
        normalizeOriginUrl((stored as StoredRemoteConfig).directUrl) ||
        (!legacyRouteTarget ? normalizeOriginUrl(legacyHost) : "");
    const quickConnectValue = toTrimmedString((stored as StoredRemoteConfig).quickConnectValue);
    remoteConfig.endpointUrl = endpointUrl;
    remoteConfig.directUrl = directUrl;
    remoteConfig.accessToken =
        toTrimmedString((stored as StoredRemoteConfig).accessToken) ||
        toTrimmedString((stored as StoredRemoteConfig).authToken) ||
        "";
    remoteConfig.destinationId =
        toTrimmedString((stored as StoredRemoteConfig).destinationId) ||
        legacyRouteTarget;
    remoteConfig.quickConnectValue =
        quickConnectValue ||
        remoteConfig.destinationId ||
        remoteConfig.directUrl;
    remoteConfig.clientId = toTrimmedString((stored as StoredRemoteConfig).clientId);
    const storedPeer = toTrimmedString((stored as StoredRemoteConfig).peerInstanceId);
    if (storedPeer) {
        remoteConfig.peerInstanceId = storedPeer;
    } else if (!remoteConfig.peerInstanceId) {
        remoteConfig.peerInstanceId = createPeerInstanceId();
    }
    refreshRemoteHost();
}

const stored = loadStoredRemoteConfig();
hydrateFromStored(stored);
if (!toTrimmedString((stored as StoredRemoteConfig).peerInstanceId)) {
    remoteConfig.peerInstanceId = remoteConfig.peerInstanceId || createPeerInstanceId();
}
const storedAccessToken = toTrimmedString((stored as StoredRemoteConfig).accessToken);
const storedLegacyAuthToken = toTrimmedString((stored as StoredRemoteConfig).authToken);
if (
    (stored as MigratedRemoteConfig)._legacyMigrated === true ||
    !(stored as StoredRemoteConfig).peerInstanceId ||
    (storedLegacyAuthToken && !storedAccessToken)
) {
    persistRemoteConfig();
}

/** Re-read localStorage (e.g. after another tab saved, or before mounting AirPad). */
export function reloadAirpadRemoteConfigFromStorage(): void {
    hydrateFromStored(loadStoredRemoteConfig());
}

/** When another tab updates AirPad settings, refresh in-memory state and crypto caches. */
export function attachAirpadCrossTabConfigSync(): () => void {
    const onStorage = (e: StorageEvent): void => {
        if (e.key !== STORAGE_KEY || e.newValue == null) return;
        reloadAirpadRemoteConfigFromStorage();
        invalidateAirpadTransportCredentials();
    };
    globalThis.addEventListener?.("storage", onStorage);
    return () => globalThis.removeEventListener?.("storage", onStorage);
}

/** Batch apply from the configuration UI (single persist + optional credential invalidation). */
export type AirpadRemoteConfigInput = {
    endpointUrl?: string;
    directUrl?: string;
    destinationId?: string;
    /** Legacy combined connect host field; maps to endpointUrl for compatibility. */
    host?: string;
    accessToken?: string;
    /** @deprecated Use accessToken */
    authToken?: string;
    /** Legacy routed destination field; maps to destinationId for compatibility. */
    routeTarget?: string;
    clientId?: string;
};

export function applyAirpadRemoteConfig(input: AirpadRemoteConfigInput, options?: { persist?: boolean }): void {
    if (input.endpointUrl !== undefined) {
        remoteConfig.endpointUrl = normalizeOriginUrl(input.endpointUrl);
    } else if (input.host !== undefined) {
        remoteConfig.endpointUrl = normalizeOriginUrl(input.host);
    }
    if (input.directUrl !== undefined) {
        remoteConfig.directUrl = normalizeOriginUrl(input.directUrl);
    }
    if (input.accessToken !== undefined) {
        remoteConfig.accessToken = input.accessToken || "";
    } else if (input.authToken !== undefined) {
        remoteConfig.accessToken = input.authToken || "";
    }
    if (input.destinationId !== undefined) {
        remoteConfig.destinationId = (input.destinationId || "").trim();
    } else if (input.routeTarget !== undefined) {
        remoteConfig.destinationId = (input.routeTarget || "").trim();
    }
    if (input.clientId !== undefined) {
        remoteConfig.clientId = (input.clientId || "").trim();
    }
    refreshRemoteHost();
    if (options?.persist !== false) {
        persistRemoteConfig();
    }
}

const endpointUrlToAirpadConnectHost = (endpointUrl: string): string => {
    try {
        const u = new URL(endpointUrl);
        return `${u.protocol}//${u.host}`;
    } catch {
        return "";
    }
};

/**
 * Apply CrossWord AppSettings shell + identity overlay (call after load/save settings and on boot).
 * Does not clear AirPad localStorage fields; only updates in-memory host/route when shell requests it.
 */
export function applyAirpadRuntimeFromAppSettings(settings: AppSettings): void {
    const core = settings.core;
    const shell = settings.shell;
    const socket = core?.socket;
    const interop = core?.interop;
    coreIdentityBridgeUserId = (core?.userId || "").trim();
    coreIdentityBridgeUserKey = (core?.userKey || "").trim();
    coreIdentityUseForAirpad = (core?.useCoreIdentityForAirPad ?? true) !== false;
    shellRemoteClipboardEnabled = (shell?.enableRemoteClipboardBridge ?? true) !== false;
    shellApplyRemoteToDevice = (shell?.applyRemoteClipboardToDevice ?? true) !== false;
    shellPushLocalClipboard = Boolean(shell?.pushLocalClipboardToLan);
    const intervalRaw = Number(shell?.clipboardPushIntervalMs);
    shellClipboardPushIntervalMs =
        Number.isFinite(intervalRaw) && intervalRaw >= 800 ? Math.min(Math.round(intervalRaw), 60000) : 2000;
    shellClipboardBroadcastTargets = (shell?.clipboardBroadcastTargets || "").trim();
    /** Align with {@link isMaintainHubSocketConnectionEnabled}: explicit false disables; missing shells default on. */
    shellMaintainHubSocket = (shell?.maintainHubSocketConnection ?? true) !== false;
    shellPreferNativeWebsocket = (shell?.preferNativeWebsocket ?? interop?.preferNativeWebsocket ?? true) !== false;
    shellNativeSmsEnabled = (shell?.enableNativeSms ?? true) !== false;
    shellNativeContactsEnabled = (shell?.enableNativeContacts ?? true) !== false;
    shellAcceptInboundClipboardData = (shell?.acceptInboundClipboardData ?? true) !== false;
    shellClipboardInboundAllowIds = (shell?.clipboardInboundAllowIds || "").trim();
    shellClipboardShareDestinationIds = (shell?.clipboardShareDestinationIds || "").trim();
    shellAccessTokenBypassesClipboardAllowlist = (shell?.accessTokenBypassesClipboardAllowlist ?? false) === true;
    shellAcceptContactsBridgeData = (shell?.acceptContactsBridgeData ?? false) === true;
    shellAcceptSmsBridgeData = (shell?.acceptSmsBridgeData ?? false) === true;
    coreSocketProtocol = socket?.protocol === "http" || socket?.protocol === "https" ? socket.protocol : "auto";
    coreSocketRouteTarget = (socket?.routeTarget || "").trim();
    coreSocketSelfId = (socket?.selfId || "").trim();
    coreSocketAccessToken = (socket?.accessToken || socket?.airpadAuthToken || "").trim();
    coreSocketClientAccessToken = (socket?.clientAccessToken || "").trim();
    coreSocketTransportMode = socket?.transportMode === "secure" ? "secure" : "plaintext";
    coreSocketTransportSecret = (socket?.transportSecret || "").trim();
    coreSocketSigningSecret = (socket?.signingSecret || "").trim();
    coreSocketConnectionType = (socket?.connectionType || "").trim();
    coreSocketArchetype = (socket?.archetype || "").trim();
    coreSocketProtocolLanesJson = (socket?.protocolLanesJson || "").trim();

    const input: AirpadRemoteConfigInput = {};
    if (core?.endpointUrl?.trim()) {
        const origin = endpointUrlToAirpadConnectHost(core.endpointUrl.trim());
        if (origin) input.endpointUrl = origin;
    }
    if (Object.keys(input).length) {
        applyAirpadRemoteConfig(input, { persist: false });
    }
    try {
        (globalThis as unknown as { __CWS_SHELL_FEATURES__?: Record<string, boolean> }).__CWS_SHELL_FEATURES__ = {
            clipboardBridge: shellRemoteClipboardEnabled,
            applyRemoteClipboard: shellApplyRemoteToDevice,
            pushLocalClipboard: shellPushLocalClipboard,
            maintainHubSocket: shellMaintainHubSocket,
            preferNativeWebsocket: shellPreferNativeWebsocket,
            sms: shellNativeSmsEnabled,
            contacts: shellNativeContactsEnabled
        };
    } catch {
        // ignore
    }
}

export function isShellRemoteClipboardBridgeEnabled(): boolean {
    return shellRemoteClipboardEnabled !== false;
}

export function isApplyRemoteClipboardToDeviceEnabled(): boolean {
    return shellApplyRemoteToDevice !== false;
}

export function isPushLocalClipboardToLanEnabled(): boolean {
    return shellPushLocalClipboard === true;
}

export function getClipboardPushIntervalMs(): number {
    return shellClipboardPushIntervalMs;
}

function getClipboardBroadcastTargetEntries(): WireTargetEntry[] {
    const fromExplicit = parseWireTargetList(shellClipboardBroadcastTargets);
    if (fromExplicit.length) return fromExplicit;
    const route = getRemoteRouteTarget().trim();
    return route ? parseWireTargetList(route) : [];
}

/** Device ids for outbound clipboard acts (`ID` or `ID::token`, comma/semicolon). */
export function getClipboardBroadcastTargetNodes(): string[] {
    return wireTargetNodeIds(getClipboardBroadcastTargetEntries());
}

/** Parsed outbound clipboard entries including optional per-id access tokens. */
export function getClipboardBroadcastWireTargets(): WireTargetEntry[] {
    return getClipboardBroadcastTargetEntries();
}

/** When false, ignore inbound clipboard payloads (coordinator still may run for other ops). */
export function isShellClipboardInboundEnabled(): boolean {
    return shellAcceptInboundClipboardData !== false;
}

/** Parsed allow list for inbound clipboard senders; empty means any sender (unless bypass rules apply). */
export function getClipboardInboundAllowIds(): string[] {
    return wireTargetNodeIds(parseWireTargetList(shellClipboardInboundAllowIds));
}

/** True when access token bypass of inbound allow list is enabled and a token is configured. */
export function shouldBypassClipboardInboundAllowlistWithAccessToken(): boolean {
    return shellAccessTokenBypassesClipboardAllowlist && Boolean(getAccessToken().trim());
}

/**
 * Inbound clipboard from `senderId` (peer / device id on the wire). Respects allow list unless bypassed by access token.
 */
export function isClipboardSenderAllowedForInbound(senderId: string): boolean {
    if (!isShellClipboardInboundEnabled()) return false;
    if (!isShellRemoteClipboardBridgeEnabled()) return false;
    if (shouldBypassClipboardInboundAllowlistWithAccessToken()) return true;
    const allow = parseWireTargetList(shellClipboardInboundAllowIds);
    if (!allow.length) return true;
    const s = senderId.trim().toLowerCase();
    if (!s) return false;
    return allow.some((e) => e.nodeId.trim().toLowerCase() === s);
}

/**
 * Destinations for share-target / quick-send clipboard; when unset, uses {@link getClipboardBroadcastTargetNodes}.
 */
export function getClipboardShareDestinationNodes(): string[] {
    const share = parseWireTargetList(shellClipboardShareDestinationIds);
    if (share.length) return wireTargetNodeIds(share);
    return getClipboardBroadcastTargetNodes();
}

/** Share / quick-send entries with optional `ID::token` (see {@link getClipboardShareDestinationNodes}). */
export function getClipboardShareDestinationWireTargets(): WireTargetEntry[] {
    const share = parseWireTargetList(shellClipboardShareDestinationIds);
    if (share.length) return share;
    return getClipboardBroadcastTargetEntries();
}

/** Future: contacts payloads from native bridge. */
export function isShellContactsBridgeDataAccepted(): boolean {
    return shellAcceptContactsBridgeData === true;
}

/** Future: SMS payloads from native bridge. */
export function isShellSmsBridgeDataAccepted(): boolean {
    return shellAcceptSmsBridgeData === true;
}

/** Background WebSocket to cwsp / endpoint hub (any shell, not only AirPad view). */
export function isMaintainHubSocketConnectionEnabled(): boolean {
    return shellMaintainHubSocket === true;
}

export function isPreferNativeWebsocketEnabled(): boolean {
    return shellPreferNativeWebsocket !== false;
}

/** Reserved for native integration (CWSAndroid-style). */
export function isShellNativeSmsEnabled(): boolean {
    return shellNativeSmsEnabled !== false;
}

/** Reserved for native integration (CWSAndroid-style). */
export function isShellNativeContactsEnabled(): boolean {
    return shellNativeContactsEnabled !== false;
}

// Configuration getters and setters
export function getRemoteHost(): string {
    return remoteHost;
}

export function getAirPadEndpointUrl(): string {
    if (remoteConfig.endpointUrl.trim()) return remoteConfig.endpointUrl.trim();
    return normalizeOriginUrl(readGlobalAirpadValue(["AIRPAD_ENDPOINT_URL"]));
}

export function getAirPadDirectTargetUrl(): string {
    return remoteConfig.directUrl.trim();
}

/**
 * Quick-connect value shown in the AirPad popup (plus optional auth pass field).
 * Prefer an explicit target device id first, otherwise show the current direct/url target.
 */
export function getAirPadQuickConnectTarget(): string {
    if (remoteConfig.quickConnectValue.trim()) return remoteConfig.quickConnectValue.trim();
    if (remoteConfig.destinationId.trim()) return remoteConfig.destinationId.trim();
    if (remoteConfig.directUrl.trim()) return remoteConfig.directUrl.trim();
    if (coreSocketRouteTarget.trim()) return coreSocketRouteTarget.trim();
    return getAirPadEndpointUrl();
}

/**
 * Quick-connect accepts either a target device id (routed through the Server-tab
 * endpoint URL) or a direct URL/host:port override.
 */
export function setAirPadQuickConnectTarget(value: string): void {
    const trimmed = toTrimmedString(value);
    remoteConfig.quickConnectValue = trimmed;
    if (!trimmed) {
        remoteConfig.directUrl = "";
        remoteConfig.destinationId = "";
        refreshRemoteHost();
        persistRemoteConfig();
        return;
    }
    if (looksLikeConnectUrl(trimmed)) {
        remoteConfig.directUrl = normalizeOriginUrl(trimmed);
        remoteConfig.destinationId = "";
    } else {
        remoteConfig.destinationId = trimmed;
        remoteConfig.directUrl = "";
    }
    refreshRemoteHost();
    persistRemoteConfig();
}

export function setRemoteHost(host: string): void {
    remoteConfig.endpointUrl = normalizeOriginUrl(host);
    refreshRemoteHost();
    persistRemoteConfig();
}

export function getRemoteProtocol(): RemoteProtocol {
    return coreSocketProtocol;
}

export function getRemoteRouteTarget(): string {
    if (remoteConfig.destinationId.trim()) return remoteConfig.destinationId.trim();
    return coreSocketRouteTarget;
}

export function getAirPadDestinationId(): string {
    return getRemoteRouteTarget();
}

export function getAirPadTransportMode(): AirpadTransportMode {
    return coreSocketTransportMode;
}

/** Resolved access / control token (local overlay, settings, then env globals). */
export function getAccessToken(): string {
    const local = (remoteConfig.accessToken || "").trim();
    if (local) return local;
    if (coreSocketAccessToken.trim()) return coreSocketAccessToken.trim();
    return readGlobalAirpadValue([
        "CWS_ACCESS_TOKEN",
        "ACCESS_TOKEN",
        "AIRPAD_AUTH_TOKEN",
        "AIRPAD_TOKEN",
        "CWS_AUTH_TOKEN",
        "HUB_AUTH_TOKEN",
        "MASTER_AUTH_TOKEN",
        "CONTROL_TOKEN",
        "ADMIN_TOKEN"
    ]);
}

/** @deprecated Use {@link getAccessToken} */
export function getAirPadAuthToken(): string {
    return getAccessToken();
}

export function setAccessToken(token: string): void {
    remoteConfig.accessToken = token || "";
    persistRemoteConfig();
}

/** @deprecated Use {@link setAccessToken} */
export function setAirPadAuthToken(token: string): void {
    setAccessToken(token);
}

export function getAirPadClientId(): string {
    if (coreSocketSelfId.trim()) return coreSocketSelfId.trim();
    if (coreIdentityUseForAirpad && coreIdentityBridgeUserId.trim()) return coreIdentityBridgeUserId.trim();
    if (remoteConfig.clientId.trim()) return remoteConfig.clientId.trim();
    return readGlobalAirpadValue(["AIRPAD_CLIENT_ID", "AIRPAD_CLIENT"]);
}

export function getAssociatedClientToken(): string {
    return coreIdentityBridgeUserKey.trim();
}

/** Optional future-facing access token when this client acts as an inbound WS / reverse-server peer. */
export function getClientAccessToken(): string {
    const local = coreSocketClientAccessToken.trim();
    if (local) return local;
    return readGlobalAirpadValue(["CWS_CLIENT_ACCESS_TOKEN", "CLIENT_ACCESS_TOKEN"]);
}

export function setAirPadClientId(clientId: string): void {
    remoteConfig.clientId = (clientId || "").trim();
    persistRemoteConfig();
}

export function setRemoteRouteTarget(routeTarget: string): void {
    remoteConfig.destinationId = (routeTarget || "").trim();
    persistRemoteConfig();
}

export function getAirPadPeerInstanceId(): string {
    const env = readGlobalAirpadValue(["AIRPAD_PEER_INSTANCE_ID", "AIRPAD_DEVICE_ID"]);
    if (env.trim()) return env.trim();
    return remoteConfig.peerInstanceId || "";
}

export function setAirPadPeerInstanceId(id: string): void {
    remoteConfig.peerInstanceId = toTrimmedString(id) || createPeerInstanceId();
    persistRemoteConfig();
}

export function getAirPadTransportSecret(): string {
    return coreSocketTransportSecret;
}

export function getAirPadSigningSecret(): string {
    return coreSocketSigningSecret;
}

/** Handshake `connectionType` before gateway `first-order` normalization (Settings → env → default). */
export function getAirPadHandshakeConnectionType(): string {
    const fromSettings = coreSocketConnectionType.trim();
    if (fromSettings) return resolveWireConnectionType(fromSettings);
    return resolveWireConnectionType(
        readGlobalAirpadValue(["CWS_CONNECTION_TYPE", "AIRPAD_CONNECTION_TYPE"])
    );
}

/** Handshake `archetype` (Settings → env → default). */
export function getAirPadHandshakeArchetype(): string {
    const fromSettings = coreSocketArchetype.trim();
    if (fromSettings) return resolveWireArchetype(fromSettings);
    return resolveWireArchetype(readGlobalAirpadValue(["CWS_ARCHETYPE", "AIRPAD_ARCHETYPE"]));
}

/**
 * Optional JSON mirroring config-v2 `Protocols`; reserved for tooling / future wire hints.
 */
export function getAirPadProtocolLanesJson(): string {
    const fromSettings = coreSocketProtocolLanesJson.trim();
    if (fromSettings) return fromSettings;
    return readGlobalAirpadValue(["CWS_PROTOCOL_LANES_JSON"]).trim();
}

// Направление и выбор осей (подбирается под телефон)
export let gyroDirX = -1;
export let gyroDirY = -1;
export let gyroDirZ = -1;

//
export let gyroSrcForMouseX = 'az';
export let gyroSrcForMouseY = 'ax';
export let gyroSrcForMouseZ = 'ay';

//
export let accelDirX = -1;
export let accelDirY = -1;
export let accelDirZ = 1;

//
export let accelSrcForMouseX = 'ay';
export let accelSrcForMouseY = 'ax';
export let accelSrcForMouseZ = 'az';


// Направление и выбор осей для мыши
//let dirX = +1;  // или -1
//let dirY = -1;  // или +1
//let srcForMouseX = 'ax'; // будем использовать 'ax' как "угол вокруг X"
//let srcForMouseY = 'ay'; // и 'ay' как "угол вокруг Y"

// Параметры жестов
export const HOLD_DELAY = 100;
export const TAP_THRESHOLD = 200;
export const MOVE_TAP_THRESHOLD = 6;
export const SWIPE_THRESHOLD = 40;

// Параметры движения (через Gyroscope)
export const GYRO_DEADZONE = 0.001;     // отсекаем мелкую дрожь (рад/с)
export const GYRO_GAIN = 600.0;        // чувствительность (можно подстраивать)
export const GYRO_SMOOTH = 0.3;       // сглаживание [0..1]
export const GYRO_MAX_STEP = 25;       // максимум пикселей за тик
export const GYRO_MAX_SAMPLE_COUNT = 1000; // размер окна для Monte Carlo калибровки
export const GYRO_ROTATION_GAIN = 0.9; // коэффициент коррекции вращения (Z axis)
export const MOTION_SEND_INTERVAL = 7; // мс между отправками (~144 fps)
export const MOTION_JITTER_EPS = 0.001; // минимальный порог (пикселей), чтобы гасить дрожание при отправке

// Параметры движения (через интегрированные углы)
export const ANGLE_DEADZONE = 0.001;      // минимальный порог по углу (рад)
export const ANGLE_GAIN = 600.0;         // чувствительность в пикселях на радиан
export const ANGLE_SMOOTH = 0.3;        // сглаживание [0..1]
export const ANGLE_MAX_STEP = 30;        // максимум пикселей за тик

//
export const ACCELEROMETER_DEADZONE = 0.1; // отсекаем мелкую дрожь (м/с^2)
export const ACCELEROMETER_GAIN = 40.0;    // чувствительность в пикселях на м/с^2
export const ACCELEROMETER_SMOOTH = 0.2;    // сглаживание [0..1]
export const ACCELEROMETER_MAX_STEP = 30;    // максимум пикселей за тик
export const ACCELEROMETER_MAX_SAMPLE_COUNT = 1000; // размер окна для Monte Carlo калибровки

// Параметры Gravity Sensor
export const GRAVITY_SMOOTH = 0.1;           // сглаживание вектора гравитации [0..1]
export const GRAVITY_CORRECTION_STRENGTH = 0.1; // сила коррекции по гравитации [0..1]

// Параметры RelativeOrientationSensor
export const REL_ORIENT_DEADZONE = 0.001;   // отсечка дрожи по углам (рад)
export const REL_ORIENT_GAIN = 600.0;       // чувствительность (пикс/рад) — чуть ниже для портретного
export const REL_ORIENT_SMOOTH = 0.8;       // сглаживание [0..1]
export const REL_ORIENT_MAX_STEP = 60;      // максимум пикселей за тик
export const REL_ORIENT_MAX_STEP_MAX = 800; // адаптивный максимум пикселей за тик
export const REL_ORIENT_MAX_STEP_UP_RATE = 6;    // 1/s, скорость роста лимита
export const REL_ORIENT_MAX_STEP_DOWN_RATE = 14; // 1/s, скорость уменьшения лимита
export const REL_ORIENT_SMOOTH_RATE_LOW = 6;   // 1/s, скорость сглаживания при малых движениях
export const REL_ORIENT_SMOOTH_RATE_HIGH = 24; // 1/s, скорость сглаживания при больших движениях

//
export let relDirX = -1;
export let relDirY = -1;
export let relDirZ = -1;
export let relSrcForMouseX = 'az';
export let relSrcForMouseY = 'ay';
export let relSrcForMouseZ = 'ax';

// =========================
// Конфигурация
// =========================

import { invalidateAirpadTransportCredentials } from "../credential-cache-bridge";

type RemoteProtocol = 'auto' | 'http' | 'https';
export type AirpadTransportMode = "plaintext" | "secure";
const STORAGE_KEY = 'airpad.remote.connection.v1';

interface StoredRemoteConfig {
    host?: string;
    protocol?: RemoteProtocol;
    routeTarget?: string;
    transportMode?: AirpadTransportMode;
    authToken?: string;
    clientId?: string;
    /** Stable per-browser tab/install; separates concurrent devices sharing the same clientId/token. */
    peerInstanceId?: string;
    transportSecret?: string;
    signingSecret?: string;
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
            host: remoteHost,
            protocol: remoteProtocol,
            routeTarget: remoteRouteTarget,
            transportMode: remoteConfig.transportMode,
            authToken: remoteConfig.authToken,
            clientId: remoteConfig.clientId,
            peerInstanceId: remoteConfig.peerInstanceId,
            transportSecret: remoteConfig.transportSecret,
            signingSecret: remoteConfig.signingSecret,
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
// remoteHost describes where to establish the Socket.IO transport (Connect URL).
// remoteRouteTarget is optional and describes which peer/device to route to by default (Remote Host field).

const remoteConfig: {
    transportMode: AirpadTransportMode;
    authToken: string;
    clientId: string;
    peerInstanceId: string;
    transportSecret: string;
    signingSecret: string;
} = {
    transportMode: "plaintext",
    authToken: "",
    clientId: "",
    peerInstanceId: "",
    transportSecret: "",
    signingSecret: "",
};

export let remoteHost = "";
export let remoteProtocol: RemoteProtocol = "auto";
export let remoteRouteTarget = "";

/**
 * Apply settings from a stored blob (localStorage shape). Safe to call on tab focus / storage events.
 */
function hydrateFromStored(stored: MigratedRemoteConfig): void {
    const locHost = typeof location !== "undefined" ? (location.hostname || "") : "";
    remoteHost = (stored.host || locHost || "").trim();
    remoteProtocol =
        stored.protocol === "http" || stored.protocol === "https" || stored.protocol === "auto"
            ? stored.protocol
            : "auto";
    remoteRouteTarget = (
        stored.routeTarget ||
        readGlobalAirpadValue(["AIRPAD_ROUTE_TARGET"]) ||
        ""
    ).trim();
    remoteConfig.transportMode = stored.transportMode === "secure" ? "secure" : "plaintext";
    remoteConfig.authToken = stored.authToken || "";
    remoteConfig.clientId = stored.clientId || "";
    const storedPeer = toTrimmedString((stored as StoredRemoteConfig).peerInstanceId);
    if (storedPeer) {
        remoteConfig.peerInstanceId = storedPeer;
    } else if (!remoteConfig.peerInstanceId) {
        remoteConfig.peerInstanceId = createPeerInstanceId();
    }
    remoteConfig.transportSecret = stored.transportSecret || "";
    remoteConfig.signingSecret = stored.signingSecret || "";
}

const stored = loadStoredRemoteConfig();
hydrateFromStored(stored);
if (!toTrimmedString((stored as StoredRemoteConfig).peerInstanceId)) {
    remoteConfig.peerInstanceId = remoteConfig.peerInstanceId || createPeerInstanceId();
}
if ((stored as MigratedRemoteConfig)._legacyMigrated === true || !(stored as StoredRemoteConfig).peerInstanceId) {
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
    host?: string;
    protocol?: string;
    routeTarget?: string;
    transportMode?: string;
    authToken?: string;
    clientId?: string;
    transportSecret?: string;
    signingSecret?: string;
};

export function applyAirpadRemoteConfig(input: AirpadRemoteConfigInput): void {
    let secretsOrModeChanged = false;
    if (input.host !== undefined) {
        remoteHost = (input.host || "").trim();
    }
    if (input.protocol !== undefined) {
        remoteProtocol = input.protocol === "http" || input.protocol === "https" ? input.protocol : "auto";
    }
    if (input.routeTarget !== undefined) {
        remoteRouteTarget = (input.routeTarget || "").trim();
    }
    if (input.transportMode !== undefined) {
        const next = input.transportMode === "secure" ? "secure" : "plaintext";
        if (next !== remoteConfig.transportMode) secretsOrModeChanged = true;
        remoteConfig.transportMode = next;
    }
    if (input.authToken !== undefined) {
        remoteConfig.authToken = input.authToken || "";
    }
    if (input.clientId !== undefined) {
        remoteConfig.clientId = input.clientId || "";
    }
    if (input.transportSecret !== undefined) {
        remoteConfig.transportSecret = input.transportSecret || "";
        secretsOrModeChanged = true;
    }
    if (input.signingSecret !== undefined) {
        remoteConfig.signingSecret = input.signingSecret || "";
        secretsOrModeChanged = true;
    }
    persistRemoteConfig();
    if (secretsOrModeChanged) {
        invalidateAirpadTransportCredentials();
    }
}

// Configuration getters and setters
export function getRemoteHost(): string {
    return remoteHost;
}

export function setRemoteHost(host: string): void {
    remoteHost = (host || '').trim();
    persistRemoteConfig();
}
export function getRemoteRouteTarget(): string {
    return remoteRouteTarget;
}
export function setRemoteRouteTarget(target: string): void {
    remoteRouteTarget = (target || '').trim();
    persistRemoteConfig();
}

export function getRemoteProtocol(): RemoteProtocol {
    return remoteProtocol;
}

export function setRemoteProtocol(protocol: string): void {
    remoteProtocol = protocol === 'http' || protocol === 'https' ? protocol : 'auto';
    persistRemoteConfig();
}

export function getAirPadTransportMode(): AirpadTransportMode {
    const envMode = readGlobalAirpadValue(["AIRPAD_TRANSPORT_MODE", "AIRPAD_TRANSPORT"]);
    if (envMode === "secure" || envMode === "plaintext") return envMode;
    return remoteConfig.transportMode === "secure" ? "secure" : "plaintext";
}

export function setAirPadTransportMode(mode: string): void {
    const next = mode === "secure" ? "secure" : "plaintext";
    if (next !== remoteConfig.transportMode) {
        remoteConfig.transportMode = next;
        invalidateAirpadTransportCredentials();
    }
    persistRemoteConfig();
}

export function getAirPadAuthToken(): string {
    return remoteConfig.authToken || readGlobalAirpadValue(["AIRPAD_AUTH_TOKEN", "AIRPAD_TOKEN"]);
}

export function setAirPadAuthToken(token: string): void {
    remoteConfig.authToken = token || "";
    persistRemoteConfig();
}

export function getAirPadClientId(): string {
    return remoteConfig.clientId || readGlobalAirpadValue(["AIRPAD_CLIENT_ID", "AIRPAD_CLIENT"]);
}

export function setAirPadClientId(clientId: string): void {
    remoteConfig.clientId = clientId || "";
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
    return remoteConfig.transportSecret || readGlobalAirpadValue(["AIRPAD_TRANSPORT_SECRET", "AIRPAD_MASTER_KEY"]);
}

export function setAirPadTransportSecret(secret: string): void {
    remoteConfig.transportSecret = secret || "";
    persistRemoteConfig();
    invalidateAirpadTransportCredentials();
}

export function getAirPadSigningSecret(): string {
    return remoteConfig.signingSecret || readGlobalAirpadValue(["AIRPAD_SIGNING_SECRET", "AIRPAD_HMAC_SECRET"]);
}

export function setAirPadSigningSecret(secret: string): void {
    remoteConfig.signingSecret = secret || "";
    persistRemoteConfig();
    invalidateAirpadTransportCredentials();
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

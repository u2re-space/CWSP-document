/*
 * Filename: neutralino-settings-arm.ts
 * FullPath: apps/CrossWord/src/crx/settings/neutralino-settings-arm.ts
 * Change date and time: 22.05.00_19.07.2026
 * Reason for changes: Hydrate/patch Neutralino backend clientId via shell.clientId;
 *   keep CRX wire L-110-crx on core.userId (Extension tab).
 */

import {
    registerSettingsSyncArm,
    setSurfaceDetector,
    type SettingsBlob,
    type SettingsPatch,
    type SettingsSyncArm
} from "views/settings";

/**
 * INVARIANT: desk Neutralino portable.config keeps wire id L-110.
 * CRX chrome.storage keeps L-110-crx — never write CRX id into Node SoT.
 */
export const CRX_WIRE_CLIENT_ID = "L-110-crx";

const DEFAULT_CONTROL_KEY = "cwsp-neutralino-local";
const FETCH_TIMEOUT_MS = 2000;

const CONTROL_PORT_CANDIDATES: number[] = (() => {
    const ports: number[] = [];
    for (let p = 29110; p <= 29118; p++) ports.push(p);
    ports.push(19875, 18765);
    return ports;
})();

type ControlAuth = { port: number; key: string };

let cachedAuth: ControlAuth | null = null;

const asRecord = (value: unknown): SettingsBlob =>
    value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as SettingsBlob)
        : {};

/** Map Node `/service/config` payload into AppSettings-shaped keys for Settings UI bind. */
export function normalizeServiceConfigToAppSettings(
    body: {
        settings?: SettingsBlob;
        portable?: SettingsBlob;
        snapshot?: SettingsBlob;
    } | null
): SettingsBlob {
    if (!body || typeof body !== "object") return {};
    const raw = asRecord(body.settings || body.portable);
    const snap = asRecord(body.snapshot);
    if (!Object.keys(raw).length && !Object.keys(snap).length) return {};

    const bridge = asRecord(raw.bridge || snap.bridge || asRecord(raw.core).bridge);
    const shellRaw = asRecord(raw.shell || snap.shell);
    const coreRaw = asRecord(raw.core);

    const endpoints = Array.isArray(bridge.endpoints)
        ? bridge.endpoints.map((e) => String(e || "").trim()).filter(Boolean)
        : [];
    const endpointUrl = String(
        coreRaw.endpointUrl || bridge.endpointUrl || shellRaw.remoteHost || endpoints[0] || ""
    ).trim();
    // Backend / desk identity (Neutralino portable) — UI binds shell.clientId on CRX CWSP tab.
    const backendClientId = String(
        shellRaw.clientId || coreRaw.userId || bridge.userId || bridge.deviceId || ""
    ).trim();
    const token = String(
        coreRaw.ecosystemToken ||
            coreRaw.userKey ||
            bridge.userKey ||
            shellRaw.accessToken ||
            shellRaw.clientToken ||
            ""
    ).trim();
    const allowInsecureTls =
        bridge.allowInsecureTls !== undefined
            ? Boolean(bridge.allowInsecureTls)
            : coreRaw.allowInsecureTls !== undefined
              ? Boolean(coreRaw.allowInsecureTls)
              : undefined;

    const socketPrev = asRecord(coreRaw.socket);
    const core: SettingsBlob = { ...coreRaw };
    if (endpointUrl) core.endpointUrl = endpointUrl;
    // WHY: omit desk userId on hydrate — chrome.storage core.userId stays L-110-crx.
    delete core.userId;
    if (token) {
        core.userKey = token;
        core.ecosystemToken = token;
        core.socket = { ...socketPrev, accessToken: token };
    } else if (Object.keys(socketPrev).length) {
        core.socket = { ...socketPrev };
    }
    const socket = asRecord(core.socket);
    if (socket.selfId) delete socket.selfId;
    if (Object.keys(socket).length) core.socket = socket;
    if (allowInsecureTls !== undefined) core.allowInsecureTls = allowInsecureTls;
    if (core.preferBackendSync === undefined) core.preferBackendSync = true;

    const shell: SettingsBlob = { ...shellRaw };
    // Prefer portable backend id for CWSP → Client id (Neutralino / backend).
    if (backendClientId && !/^L-110-crx$/i.test(backendClientId)) {
        shell.clientId = backendClientId;
    }
    delete shell.userId;

    return { ...raw, core, shell };
}

/**
 * Strip CRX wire identity (L-110-crx) before POST.
 * KEEP shell.clientId — that is the Neutralino/backend client id from the CWSP tab.
 */
export function stripCrxIdentityFromPatch(patch: SettingsPatch): SettingsPatch {
    const out: SettingsPatch = { ...patch };
    const core = asRecord(out.core);
    if (Object.keys(core).length) {
        const nextCore = { ...core };
        const uid = String(nextCore.userId || "").trim();
        // Only drop when it is the extension wire peer — never send L-110-crx as desk id.
        if (!uid || /^L-110-crx$/i.test(uid)) {
            delete nextCore.userId;
        }
        const socket = asRecord(nextCore.socket);
        if (Object.keys(socket).length) {
            const nextSocket = { ...socket };
            const selfId = String(nextSocket.selfId || "").trim();
            if (!selfId || /^L-110-crx$/i.test(selfId)) {
                delete nextSocket.selfId;
            }
            nextCore.socket = nextSocket;
        }
        out.core = nextCore;
    }
    const shell = asRecord(out.shell);
    if (Object.keys(shell).length) {
        const nextShell = { ...shell };
        delete nextShell.userId;
        const cid = String(nextShell.clientId || "").trim();
        if (/^L-110-crx$/i.test(cid)) {
            delete nextShell.clientId;
        }
        out.shell = nextShell;
    }
    const bridge = asRecord(out.bridge);
    if (Object.keys(bridge).length) {
        const nextBridge = { ...bridge };
        const bid = String(nextBridge.userId || nextBridge.deviceId || "").trim();
        if (/^L-110-crx$/i.test(bid)) {
            delete nextBridge.userId;
            delete nextBridge.deviceId;
        }
        out.bridge = nextBridge;
    }
    return out;
}

const controlFetch = async (
    auth: ControlAuth,
    path: string,
    init?: RequestInit
): Promise<Response | null> => {
    try {
        const headers = new Headers(init?.headers);
        headers.set("Content-Type", "application/json");
        headers.set("X-API-Key", auth.key);
        const signal =
            init?.signal ??
            (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
                ? AbortSignal.timeout(FETCH_TIMEOUT_MS)
                : undefined);
        return await fetch(`http://127.0.0.1:${auth.port}${path}`, {
            ...init,
            headers,
            cache: "no-store",
            signal
        });
    } catch {
        return null;
    }
};

const publishAuthGlobals = (auth: ControlAuth): void => {
    try {
        const g = globalThis as unknown as {
            __NEUTRALINO_AUTH__?: ControlAuth;
            __WEBNATIVE_AUTH__?: ControlAuth;
        };
        g.__NEUTRALINO_AUTH__ = auth;
        g.__WEBNATIVE_AUTH__ = auth;
    } catch {
        /* ignore */
    }
};

/** Probe loopback Neutralino/WebNative control (same band as clipboard-take). */
export async function resolveNeutralinoControlAuth(): Promise<ControlAuth | null> {
    const key = DEFAULT_CONTROL_KEY;
    if (cachedAuth?.port) {
        const hit = await controlFetch(cachedAuth, "/service/config", { method: "GET" });
        if (hit?.ok) {
            publishAuthGlobals(cachedAuth);
            return cachedAuth;
        }
        cachedAuth = null;
    }

    const results = await Promise.all(
        CONTROL_PORT_CANDIDATES.map(async (port) => {
            const auth = { port, key };
            const res = await controlFetch(auth, "/service/config", { method: "GET" });
            return res?.ok ? auth : null;
        })
    );
    const alive = results.find(Boolean) || null;
    if (alive) {
        cachedAuth = alive;
        publishAuthGlobals(alive);
    }
    return alive;
}

async function serviceConfig(
    auth: ControlAuth,
    init?: RequestInit
): Promise<{
    settings?: SettingsBlob;
    portable?: SettingsBlob;
    snapshot?: SettingsBlob;
    defaults?: SettingsBlob;
} | null> {
    const res = await controlFetch(auth, "/service/config", init);
    if (!res?.ok) return null;
    try {
        return (await res.json()) as {
            settings?: SettingsBlob;
            portable?: SettingsBlob;
            snapshot?: SettingsBlob;
            defaults?: SettingsBlob;
        };
    } catch {
        return null;
    }
}

/**
 * Expand AppSettings → portable shell/bridge so Node clipboard-hub dials gateway.
 * INVARIANT: backend clientId comes from shell.clientId (CWSP tab), not CRX core.userId.
 */
function expandCoreIntoPortable(patch: SettingsPatch): SettingsPatch {
    const core = asRecord(patch.core);
    const shellIn = asRecord(patch.shell);
    const endpointUrl = String(core.endpointUrl || "").trim();
    const token = String(core.userKey || core.ecosystemToken || "").trim();
    const backendClientId = String(shellIn.clientId || core.userId || "").trim();
    const safeBackendId =
        backendClientId && !/^L-110-crx$/i.test(backendClientId) ? backendClientId : "";
    const expanded: SettingsPatch = { ...patch };
    if (!endpointUrl && !token && !safeBackendId) return expanded;

    const nextCore: SettingsBlob = { ...core };
    if (safeBackendId) nextCore.userId = safeBackendId;
    expanded.core = nextCore;

    expanded.bridge = {
        ...asRecord(patch.bridge),
        ...(endpointUrl ? { endpointUrl } : {}),
        ...(token ? { userKey: token } : {}),
        ...(safeBackendId ? { userId: safeBackendId } : {})
    };
    expanded.shell = {
        ...shellIn,
        ...(endpointUrl ? { remoteHost: endpointUrl } : {}),
        ...(token ? { accessToken: token, clientToken: token } : {}),
        ...(safeBackendId ? { clientId: safeBackendId, userId: safeBackendId } : {})
    };
    return expanded;
}

/**
 * CRX settings:get/patch arm — Neutralino `/service/config` when live.
 * Falls back to empty get (chrome.storage remains local SoT for identity).
 */
export function createCrxNeutralinoSettingsArm(): SettingsSyncArm {
    return {
        get: async () => {
            const auth = await resolveNeutralinoControlAuth();
            if (!auth) return {};
            const body = await serviceConfig(auth, { method: "GET" });
            return normalizeServiceConfigToAppSettings(body);
        },
        patch: async (patch: SettingsPatch) => {
            const auth = await resolveNeutralinoControlAuth();
            if (!auth) return patch;
            const safe = expandCoreIntoPortable(stripCrxIdentityFromPatch(patch));
            const body = await serviceConfig(auth, {
                method: "POST",
                body: JSON.stringify(safe)
            });
            const endpointUrl = String(asRecord(safe.core).endpointUrl || "").trim();
            const token = String(
                asRecord(safe.core).userKey || asRecord(safe.core).ecosystemToken || ""
            ).trim();
            const clientId = String(
                asRecord(safe.shell).clientId || asRecord(safe.core).userId || ""
            ).trim();
            if (endpointUrl) {
                try {
                    await controlFetch(auth, "/service/clipboard-hub", {
                        method: "POST",
                        body: JSON.stringify({
                            remoteHost: endpointUrl,
                            ...(token ? { accessToken: token, clientToken: token } : {}),
                            ...(clientId && !/^L-110-crx$/i.test(clientId)
                                ? { clientId }
                                : {}),
                            reload: true
                        })
                    });
                } catch {
                    /* hub optional */
                }
            }
            return normalizeServiceConfigToAppSettings(body);
        },
        defaults: async () => {
            const auth = await resolveNeutralinoControlAuth();
            if (!auth) return {};
            const body = await serviceConfig(auth, { method: "GET" });
            return body?.defaults ?? {};
        },
        snapshot: async () => {
            const auth = await resolveNeutralinoControlAuth();
            if (!auth) return {};
            const body = await serviceConfig(auth, { method: "GET" });
            return body?.snapshot ?? {};
        }
    };
}

/** Register CRX surface arm + mark bridge status on documentElement. */
export async function registerCrxNeutralinoSettingsSync(): Promise<boolean> {
    setSurfaceDetector(() => "crx");
    registerSettingsSyncArm("crx", createCrxNeutralinoSettingsArm());
    const auth = await resolveNeutralinoControlAuth();
    try {
        document.documentElement.dataset.cwspBridge = auth ? "live" : "offline";
        document.documentElement.dataset.cwspSurface = "crx";
    } catch {
        /* ignore */
    }
    return Boolean(auth);
}

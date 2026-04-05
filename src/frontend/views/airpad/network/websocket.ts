// =========================
// Socket.IO Transport
// =========================

import { io, Socket } from 'socket.io-client';
import { log, getWsStatusEl } from '../utils/utils';
import {
    getRemoteHost,
    getRemoteProtocol,
    getRemoteRouteTarget,
    getAirPadAuthToken,
    getAirPadTransportMode,
    getAirPadTransportSecret,
    getAirPadSigningSecret,
    getAirPadClientId,
    getAirPadPeerInstanceId,
} from '../config/config';
import { setAirpadCredentialInvalidator } from '../credential-cache-bridge';

let socket: Socket | null = null;
let wsConnected = false;
let isConnecting = false;
let btnEl: HTMLElement | null = null;
let wsConnectButton: HTMLElement | null = null;
let connectAttemptId = 0;
/** Parallel candidate probes — close all on success or disconnect. */
const activeProbeSockets = new Set<Socket>();
let manualDisconnectRequested = false;
let autoReconnectAttempts = 0;
type WSConnectCandidate = {
    url: string;
    protocol: 'http' | 'https';
    host: string;
    source: 'remote' | 'page';
    port: string;
    useWebSocketOnly: boolean;
    preferPollingFirst: boolean;
};
let lastWsCandidates: WSConnectCandidate[] = [];
let nextWsCandidateOffset = 0;
const localNetworkPermissionProbeDone = new Set<string>();
// Keep retrying across NAT/Wi-Fi transitions; 0 means unlimited retries.
const AUTO_RECONNECT_MAX_ATTEMPTS = 0;
const AUTO_RECONNECT_BASE_DELAY_MS = 800;
/** Socket.IO handshake timeout per candidate (dead hosts fail faster). */
const AIRPAD_PROBE_IO_TIMEOUT_MS = 4800;
/** Wall-clock cap per probe if connect_error is slow to fire. */
const AIRPAD_PROBE_HARD_CAP_MS = AIRPAD_PROBE_IO_TIMEOUT_MS + 800;
/** Try this many candidates in parallel; first success wins. */
const AIRPAD_CANDIDATE_PARALLEL = 3;
/** Coordinator ask/act wait — was 12s, tighter for snappier UI. */
const AIRPAD_COORDINATOR_TIMEOUT_MS = 8000;
const AIRPAD_CONNECTION_TYPE = "exchanger-initiator";
const AIRPAD_ARCHETYPE = "server-v2";
type WSConnectionHandler = (connected: boolean) => void;
const wsConnectionHandlers = new Set<WSConnectionHandler>();

// Clipboard state + listeners (PC clipboard as seen by backend)
let lastServerClipboardText = '';
type ClipboardUpdateHandler = (text: string, meta?: { source?: string }) => void;
const clipboardHandlers = new Set<ClipboardUpdateHandler>();
type VoiceResultHandler = (message: { text: string; type: "voice_result" | "voice_error"; actions?: unknown[]; error?: string }) => void;
const voiceResultHandlers = new Set<VoiceResultHandler>();

type AirPadTransportMode = "plaintext" | "secure";
type SignedEnvelope = { cipher: string; sig: string; from?: string };

type NetworkFetchRequest = {
    requestId?: string;
    method?: string;
    url?: string;
    headers?: Record<string, string>;
    body?: any;
    timeoutMs?: number;
};
type NetworkFetchResponse = {
    ok: boolean;
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
    body?: string;
    error?: string;
    requestId?: string;
};

type CoordinatorPacket = {
    op?: "ask" | "act" | "resolve" | "result" | "error";
    what?: string;
    payload?: any;
    nodes?: string[];
    uuid?: string;
    result?: any;
    error?: any;
    byId?: string;
    from?: string;
    token?: string;
    timestamp?: number;
    [key: string]: unknown;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
let aesKeyCache = new Map<string, CryptoKey>();
let hmacKeyCache = new Map<string, CryptoKey>();

setAirpadCredentialInvalidator(() => {
    aesKeyCache.clear();
    hmacKeyCache.clear();
});
const coordinatorPending = new Map<string, {
    resolve: (value: any) => void;
    reject: (error: any) => void;
    timeoutId: ReturnType<typeof globalThis.setTimeout>;
}>();

export function getWS(): Socket | null {
    return socket;
}

export function isWSConnected(): boolean {
    return wsConnected;
}

export function onWSConnectionChange(handler: WSConnectionHandler): () => void {
    wsConnectionHandlers.add(handler);
    try {
        handler(wsConnected);
    } catch {
        // ignore subscriber errors
    }
    return () => wsConnectionHandlers.delete(handler);
}

export function getLastServerClipboard(): string {
    return lastServerClipboardText;
}

export function onServerClipboardUpdate(handler: ClipboardUpdateHandler): () => void {
    clipboardHandlers.add(handler);
    return () => clipboardHandlers.delete(handler);
}

export function onVoiceResult(handler: VoiceResultHandler): () => void {
    voiceResultHandlers.add(handler);
    return () => voiceResultHandlers.delete(handler);
}

function notifyClipboardHandlers(text: string, meta?: { source?: string }) {
    for (const h of clipboardHandlers) {
        try {
            h(text, meta);
        } catch {
            // ignore UI handler errors
        }
    }
}

function safeJson(value: unknown): string {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

const describeError = (error: unknown): string => {
    if (!error) return String(error);
    if (typeof error === "string") return error;
    if (error instanceof Error) {
        return `${error.name}: ${error.message}`;
    }
    return safeJson(error);
};

type EngineLike = {
    on?: (event: string, listener: (...args: unknown[]) => void) => void;
    off?: (event: string, listener: (...args: unknown[]) => void) => void;
    transport?: { name?: string };
};

function getTransportMode(): AirPadTransportMode {
    return getAirPadTransportMode() === "secure" ? "secure" : "plaintext";
}

const toBase64 = (buffer: ArrayBuffer | Uint8Array): string => {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
};

const fromBase64 = (value: string): Uint8Array | null => {
    try {
        const binary = atob(value);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    } catch {
        return null;
    }
};

const isSignedEnvelope = (value: unknown): value is SignedEnvelope =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as any).cipher === "string" &&
    typeof (value as any).sig === "string";

const toSafeObject = (value: unknown): any => {
    if (!value || typeof value !== "string") return null;
    try {
        const parsed = JSON.parse(value);
        return parsed;
    } catch {
        return null;
    }
};

const shouldAutoReconnectAfterDisconnect = (reason?: string): boolean => {
    if (!reason) {
        return true;
    }
    if (reason === "io client disconnect" || reason === "forced close") {
        return false;
    }
    return true;
};

const shouldRotateCandidateOnDisconnect = (reason?: string): boolean => {
    if (!reason) return true;
    if (reason === "io server disconnect" || reason === "io client disconnect") return false;
    return true;
};

const getSecret = (): string => (getAirPadTransportSecret() || "").trim();
const getSigningSecret = (): string => (getAirPadSigningSecret() || "").trim();
const getClientId = (): string => (getAirPadClientId() || "").trim() || "airpad-client";
const getAuthToken = (): string => (getAirPadAuthToken() || "").trim();
const parseNodeList = (value: string): string[] => {
    return Array.from(new Set(
        value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
    ));
};
const getCoordinatorNodes = (): string[] => {
    return parseNodeList(getRemoteRouteTarget().trim());
};
const nextPacketId = (): string => {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `airpad-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const isCoordinatorPacket = (value: unknown): value is CoordinatorPacket => {
    return !!value && typeof value === "object" && (
        "op" in (value as Record<string, unknown>) ||
        "what" in (value as Record<string, unknown>) ||
        "uuid" in (value as Record<string, unknown>) ||
        "result" in (value as Record<string, unknown>) ||
        "error" in (value as Record<string, unknown>)
    );
};

const handleCoordinatorPacket = (packet: CoordinatorPacket): void => {
    const uuid = typeof packet.uuid === "string" ? packet.uuid : "";
    if (uuid && coordinatorPending.has(uuid)) {
        const pending = coordinatorPending.get(uuid);
        if (pending) {
            clearTimeout(pending.timeoutId);
            coordinatorPending.delete(uuid);
            if (packet.op === "error" || packet.error !== undefined) {
                pending.reject(packet.error ?? { ok: false, error: "Unknown coordinator error" });
            } else {
                pending.resolve(packet.result);
            }
        }
        return;
    }

    if (packet.what === "clipboard:update") {
        const clipboardPayload = packet.result ?? packet.payload;
        const text = typeof clipboardPayload?.text === "string" ? clipboardPayload.text : "";
        lastServerClipboardText = text;
        notifyClipboardHandlers(text, { source: clipboardPayload?.source });
    }
};

const emitCoordinatorPacket = (packet: CoordinatorPacket): boolean => {
    if (!socket || !socket.connected) return false;
    socket.emit("data", packet);
    return true;
};

const buildCoordinatorPacket = (
    op: NonNullable<CoordinatorPacket["op"]>,
    what: string,
    payload: any,
    options: { nodes?: string[]; uuid?: string } = {}
): CoordinatorPacket => {
    const clientId = getClientId();
    const authToken = getAuthToken();
    return {
        op,
        what,
        payload,
        nodes: options.nodes ?? getCoordinatorNodes(),
        uuid: options.uuid,
        byId: clientId,
        from: clientId,
        token: authToken || undefined,
        timestamp: Date.now()
    };
};

const getAesKey = async (secret: string): Promise<CryptoKey | null> => {
    if (!secret || !globalThis.crypto?.subtle) return null;
    if (aesKeyCache.has(secret)) return aesKeyCache.get(secret) || null;
    const material = textEncoder.encode(secret);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", material);
    const key = await globalThis.crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
    aesKeyCache.set(secret, key);
    return key;
};

const getHmacKey = async (secret: string): Promise<CryptoKey | null> => {
    if (!secret || !globalThis.crypto?.subtle) return null;
    if (hmacKeyCache.has(secret)) return hmacKeyCache.get(secret) || null;
    const key = await globalThis.crypto.subtle.importKey(
        "raw",
        textEncoder.encode(secret),
        {
            name: "HMAC",
            hash: "SHA-256"
        },
        false,
        ["sign", "verify"]
    );
    hmacKeyCache.set(secret, key);
    return key;
};

const buildSignedEnvelope = async (payload: unknown): Promise<SignedEnvelope> => {
    const payloadJson = safeJson(payload);
    const payloadBytes = textEncoder.encode(payloadJson);
    const secret = getSecret();
    const signingSecret = getSigningSecret();

    let cipher = toBase64(payloadBytes);
    if (secret && globalThis.crypto?.subtle) {
        const key = await getAesKey(secret);
        if (key) {
            const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
            const encrypted = new Uint8Array(
                await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, payloadBytes)
            );
            const merged = new Uint8Array(iv.length + encrypted.length);
            merged.set(iv, 0);
            merged.set(encrypted, iv.length);
            cipher = toBase64(merged);
        }
    }

    const cipherBytesForSig = textEncoder.encode(cipher);
    let sig = toBase64(cipherBytesForSig);
    if (signingSecret && globalThis.crypto?.subtle) {
        const key = await getHmacKey(signingSecret);
        if (key) {
            const signature = new Uint8Array(
                await globalThis.crypto.subtle.sign(
                    {
                        name: "HMAC"
                    },
                    key,
                    cipherBytesForSig
                )
            );
            sig = toBase64(signature);
        }
    }

    return { cipher, sig, from: getClientId() };
};

const unwrapSignedPayload = async (envelope: SignedEnvelope): Promise<any> => {
    if (!isSignedEnvelope(envelope)) return envelope;
    const secret = getSecret();
    const cipherBytes = fromBase64(envelope.cipher);
    if (!cipherBytes) return envelope;
    if (!secret || !globalThis.crypto?.subtle) {
        const decodedText = textDecoder.decode(cipherBytes);
        return toSafeObject(decodedText) ?? envelope;
    }

    const key = await getAesKey(secret);
    if (!key) return envelope;
    if (cipherBytes.length < 28) {
        const decodedText = textDecoder.decode(cipherBytes);
        return toSafeObject(decodedText) ?? envelope;
    }

    const iv = cipherBytes.slice(0, 12);
    const encrypted = cipherBytes.slice(12);
    try {
        const decrypted = new Uint8Array(await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted));
        const decodedText = textDecoder.decode(decrypted);
        return toSafeObject(decodedText) ?? envelope;
    } catch {
        return envelope;
    }
};

const wrapObjectForTransport = async (payload: any): Promise<any> => {
    if (getTransportMode() !== "secure" || typeof payload !== "object" || payload === null) {
        return payload;
    }

    const envelope = await buildSignedEnvelope(payload);
    return {
        ...payload,
        mode: "secure",
        payload: envelope
    };
};

const emitPayload = (value: any): void => {
    if (!socket || !socket.connected) return;
    socket.emit("message", value);
};

const emitSignedObjectMessage = async (payload: any): Promise<void> => {
    const wrapped = await wrapObjectForTransport(payload);
    emitPayload(wrapped);
};

const unwrapIncomingPayload = async (payload: any): Promise<any> => {
    if (!isSignedEnvelope(payload)) return payload;
    if (getTransportMode() !== "secure") return payload;
    return unwrapSignedPayload(payload);
};

function isPrivateOrLocalTarget(host: string): boolean {
    if (!host) return false;
    if (host === 'localhost') return true;
    if (host.endsWith('.local')) return true;
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;
    return (
        host.startsWith('10.') ||
        host.startsWith('192.168.') ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
        host.startsWith('127.')
    );
}

const getCurrentOriginHostname = (): string => {
    try {
        return String(new URL(location.href).hostname).toLowerCase();
    } catch {
        return "";
    }
};

const isNetworkFetchAllowed = (rawUrl: string): boolean => {
    if (!rawUrl || typeof rawUrl !== "string") return false;
    let parsed: URL;
    try {
        parsed = new URL(rawUrl, location.href);
    } catch {
        return false;
    }
    const host = parsed.hostname.toLowerCase();
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") return false;
    const localPageHost = getCurrentOriginHostname();
    return isPrivateOrLocalTarget(host) || host === "localhost" || host === localPageHost;
};

const normalizeNetworkFetchHeaders = (headers?: Record<string, string>): Record<string, string> => {
    const next: Record<string, string> = {};
    if (!headers) return next;
    for (const [key, value] of Object.entries(headers)) {
        if (typeof key !== "string" || !key.trim()) continue;
        if (typeof value !== "string") continue;
        next[key] = value;
    }
    return next;
};

const responseHeadersToObject = (value: Headers): Record<string, string> => {
    const result: Record<string, string> = {};
    value.forEach((headerValue, headerName) => {
        result[headerName] = headerValue;
    });
    return result;
};

const handleServerNetworkFetchRequest = async (request: NetworkFetchRequest): Promise<NetworkFetchResponse> => {
    const requestId = typeof request?.requestId === "string" ? request.requestId.trim() : "";
    const method = typeof request?.method === "string" ? request.method.toUpperCase() : "GET";
    const url = typeof request?.url === "string" ? request.url : "";
    const timeoutMsRaw = request && typeof request.timeoutMs === "number" ? request.timeoutMs : 12000;
    const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0 ? Math.min(Math.max(Math.round(timeoutMsRaw), 1000), 60000) : 12000;
    if (!requestId) {
        return {
            ok: false,
            status: 400,
            statusText: "Bad Request",
            error: "Missing requestId",
        };
    }
    if (!isNetworkFetchAllowed(url)) {
        return {
            requestId,
            ok: false,
            status: 400,
            statusText: "Bad Request",
            error: "URL not allowed",
        };
    }

    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    try {
        const headers = normalizeNetworkFetchHeaders(request?.headers as Record<string, string>);
        const hasBody = !["GET", "HEAD"].includes(method);
        const payload = request?.body;
        const body = hasBody ? (typeof payload === "string" ? payload : safeJson(payload)) : undefined;
        const response = await fetch(url, {
            method,
            headers,
            body,
            signal: controller.signal,
        });
        const responseBody = await response.text();
        return {
            requestId,
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            headers: responseHeadersToObject(response.headers),
            body: responseBody,
        };
    } catch (error: unknown) {
        return {
            requestId,
            ok: false,
            status: 0,
            statusText: "Network Error",
            error: describeError(error),
        };
    } finally {
        clearTimeout(timer);
    }
};

async function tryRequestLocalNetworkPermission(origin: string, host: string): Promise<void> {
    if (!origin || !host) return;
    if (!isPrivateOrLocalTarget(host)) return;
    if (location.protocol !== 'https:') return;
    if (localNetworkPermissionProbeDone.has(origin)) return;

    localNetworkPermissionProbeDone.add(origin);
    try {
        // Best-effort warm-up for Chrome Local Network Access permission flow.
        // `targetAddressSpace` is currently experimental and may be ignored by some browsers.
        await fetch(`${origin}/lna-probe`, {
            method: 'GET',
            mode: 'cors',
            cache: 'no-store',
            credentials: 'omit',
            // TS libs may not include this yet.
            ...( { targetAddressSpace: 'local' } as any ),
        } as RequestInit);
    } catch (error: any) {
        const msg = String(error?.message || error || '');
        log(`LNA probe: ${msg || 'request failed'}`);
    }
}

export function sendCoordinatorAct(what: string, payload: any, nodes?: string[]): boolean {
    return emitCoordinatorPacket(buildCoordinatorPacket("act", what, payload, { nodes }));
}

export function sendCoordinatorAsk(what: string, payload: any, nodes?: string[]): Promise<any> {
    return new Promise((resolve, reject) => {
        if (!socket || !socket.connected) {
            reject({ ok: false, error: "WS not connected" });
            return;
        }

        const uuid = nextPacketId();
        const timeoutId = globalThis.setTimeout(() => {
            coordinatorPending.delete(uuid);
            reject({ ok: false, error: `Timeout waiting for ${what}` });
        }, AIRPAD_COORDINATOR_TIMEOUT_MS);

        coordinatorPending.set(uuid, { resolve, reject, timeoutId });
        emitCoordinatorPacket(buildCoordinatorPacket("ask", what, payload, { nodes, uuid }));
    });
}

export function sendCoordinatorRequest(what: string, payload: any, nodes?: string[]): Promise<any> {
    return new Promise((resolve, reject) => {
        if (!socket || !socket.connected) {
            reject({ ok: false, error: "WS not connected" });
            return;
        }

        const uuid = nextPacketId();
        const timeoutId = globalThis.setTimeout(() => {
            coordinatorPending.delete(uuid);
            reject({ ok: false, error: `Timeout waiting for ${what}` });
        }, AIRPAD_COORDINATOR_TIMEOUT_MS);

        coordinatorPending.set(uuid, { resolve, reject, timeoutId });
        emitCoordinatorPacket(buildCoordinatorPacket("act", what, payload, { nodes, uuid }));
    });
}

function updateButtonLabel() {
    if (!btnEl) return;
    if (isConnecting || (socket && socket.connected === false)) {
        btnEl.textContent = 'WS…';
        return;
    }
    if (wsConnected || (socket && socket.connected)) {
        btnEl.textContent = 'WS ✓';
    } else {
        btnEl.textContent = 'WS ↔';
    }
}

function logWsState(event: string, payload: string) {
    const trimmedPayload = payload.trim();
    log(`[ws-state] event=${event}${trimmedPayload ? ` ${trimmedPayload}` : ""}`);
}

const WS_STATUS_TLS_HINT_CLASS = 'ws-status-tls-hint';

function setWsStatusTlsHint(originUrl: string) {
    const wsStatusEl = getWsStatusEl();
    if (wsStatusEl) {
        wsStatusEl.textContent = `Untrusted cert — open ${originUrl} in this browser, accept, then retry`;
        wsStatusEl.classList.add(WS_STATUS_TLS_HINT_CLASS);
        wsStatusEl.classList.remove('ws-status-ok');
        wsStatusEl.classList.add('ws-status-bad');
    }
}

/** When the server cert is issued for a hostname, https://&lt;public-ip&gt; fails before the user can "trust" it. */
function setWsStatusTlsHostnameHint(hostname: string) {
    const wsStatusEl = getWsStatusEl();
    if (wsStatusEl) {
        wsStatusEl.textContent =
            `TLS name mismatch for raw IP — set Remote host to ${hostname} (name on certificate), keep ports as needed`;
        wsStatusEl.classList.add(WS_STATUS_TLS_HINT_CLASS);
        wsStatusEl.classList.remove('ws-status-ok');
        wsStatusEl.classList.add('ws-status-bad');
    }
}

function setWsStatus(connected: boolean) {
    wsConnected = connected;
    const wsStatusEl = getWsStatusEl();
    if (wsStatusEl) {
        wsStatusEl.classList.remove(WS_STATUS_TLS_HINT_CLASS);
        if (connected) {
            wsStatusEl.textContent = 'connected';
            wsStatusEl.classList.remove('ws-status-bad');
            wsStatusEl.classList.add('ws-status-ok');
        } else {
            wsStatusEl.textContent = 'disconnected';
            wsStatusEl.classList.remove('ws-status-ok');
            wsStatusEl.classList.add('ws-status-bad');
        }
    }
    updateButtonLabel();

    for (const handler of wsConnectionHandlers) {
        try {
            handler(connected);
        } catch {
            // ignore subscriber errors
        }
    }
}

function handleServerMessage(msg: any) {
    if (msg.type === 'voice_result' || msg.type === 'voice_error') {
        const text =
            msg.error ||
            msg.message ||
            ('Actions: ' + JSON.stringify(msg.actions || []));
        for (const handler of voiceResultHandlers) {
            try {
                handler({
                    text,
                    type: msg.type === "voice_error" ? "voice_error" : "voice_result",
                    actions: msg.actions,
                    error: msg.error
                });
            } catch {
                // ignore subscriber errors
            }
        }
        log('Voice result: ' + text);
    }
}

export function connectWS() {
    if (isConnecting) return;
    if (socket && (socket.connected || (socket as any).connecting)) return;
    if (activeProbeSockets.size > 0) return;
    connectAttemptId += 1;
    const attemptId = connectAttemptId;
    manualDisconnectRequested = false;

    const remoteHost = getRemoteHost().trim();
    const resolvedRemoteHost = remoteHost || location.hostname;
    const remoteProtocol = getRemoteProtocol();
    const isIpv4Literal = (host: string): boolean =>
        !!host && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);

    const isPrivateIp = (host: string): boolean => {
        if (!host) return false;
        if (!isIpv4Literal(host)) return false;
        return (
            host.startsWith('10.') ||
            host.startsWith('192.168.') ||
            /^172\.(1[6-9]|2\d|3[01])\./.test(host)
        );
    };

    /** Prefer hostname (SNI) before public IPv4 for HTTPS — certs rarely include the bare IP. */
    const reorderHostEntriesForHttps = (
        entries: Array<{ host: string; source: WSConnectCandidate['source']; preferPort?: string }>
    ) => {
        const dns: typeof entries = [];
        const privateIpv4: typeof entries = [];
        const publicIpv4: typeof entries = [];
        for (const e of entries) {
            if (!isIpv4Literal(e.host)) {
                dns.push(e);
            } else if (isPrivateIp(e.host) || e.host === '127.0.0.1') {
                privateIpv4.push(e);
            } else {
                publicIpv4.push(e);
            }
        }
        dns.sort((a, b) => (a.source === 'page' ? 0 : 1) - (b.source === 'page' ? 0 : 1));
        return [...dns, ...privateIpv4, ...publicIpv4];
    };

    const isLikelyPort = (value: string): boolean => /^\d{1,5}$/.test(value);
    const stripProtocol = (value: string): string => {
        const trimmed = value.trim();
        return trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split("/")[0];
    };
    const parseHostAndPort = (value: string): { host: string; port?: string } | null => {
        const hostSpec = stripProtocol(value).trim();
        if (!hostSpec) return null;
        const at = hostSpec.lastIndexOf(":");
        if (at <= 0) {
            return { host: hostSpec };
        }
        const host = hostSpec.slice(0, at);
        const port = hostSpec.slice(at + 1);
        if (!host || !isLikelyPort(port)) return { host: hostSpec };
        return { host, port };
    };
    const splitHostList = (value: string): string[] =>
        value
            .split(/[;,]/)
            .map((item) => item.trim())
            .filter(Boolean);

    const remoteHostSpecs = splitHostList(remoteHost)
        .map((entry) => parseHostAndPort(entry))
        .filter((entry): entry is { host: string; port?: string } => !!entry && !!entry.host);
    const firstExplicitPort = (remoteHostSpecs[0]?.port || '').trim();
    const remotePort = firstExplicitPort;
    const configuredRouteTarget = getRemoteRouteTarget().trim();
    const parsedConfiguredRouteTarget = configuredRouteTarget ? parseHostAndPort(configuredRouteTarget) : undefined;
    const pageHost = location.hostname || "";
    const isLocalPageHost = /^(localhost|127\.0\.0\.1)$/.test(pageHost) || (
        /^\d{1,3}(?:\.\d{1,3}){3}$/.test(pageHost) &&
        (
            pageHost.startsWith('10.') ||
            pageHost.startsWith('192.168.') ||
            /^172\.(1[6-9]|2\d|3[01])\./.test(pageHost)
        )
    );
    if (location.protocol === 'https:' && remoteProtocol === 'http') {
        log('Socket.IO error: browser blocks ws/http from https page (mixed content). Open Airpad via http:// or use valid HTTPS cert on endpoint.');
        isConnecting = false;
        setWsStatus(false);
        updateButtonLabel();
        return;
    }

    const inferProtocol = (): 'http' | 'https' => {
        if (remoteProtocol === 'http' || remoteProtocol === 'https') return remoteProtocol;
        if (remotePort === '443' || remotePort === '8443') return 'https';
        if (remotePort === '80' || remotePort === '8080') return 'http';
        return location.protocol === 'https:' ? 'https' : 'http';
    };

    const remoteHostSpec = remoteHostSpecs[0];
    const parsedRemoteHost = remoteHostSpec?.host || resolvedRemoteHost;
    const parsedRemotePort = remoteHostSpec?.port;
    const routeTargetForQuery = parsedConfiguredRouteTarget?.host || configuredRouteTarget || "";
    const routeTargetPortForQuery = (parsedConfiguredRouteTarget?.port || "").trim();

    const primaryProtocol = inferProtocol();
    const probeHost = parsedRemoteHost || resolvedRemoteHost;
    const probePort = remotePort || (primaryProtocol === 'https' ? '8443' : '8080');
    const probeOrigin = `${primaryProtocol}://${probeHost}:${probePort}`;
    void tryRequestLocalNetworkPermission(probeOrigin, probeHost);
    const fallbackProtocol = primaryProtocol === 'https' ? 'http' : 'https';
    const defaultPortsByProtocol = {
        http: ['8080', '80'],
        https: ['8443', '443'],
    } as const;
    const locationPort = location.port?.trim?.() || '';

    const protocolOrder = remoteProtocol === 'http'
        ? (['http'] as const)
        : remoteProtocol === 'https'
            ? (['https'] as const)
            : ([primaryProtocol, fallbackProtocol] as const);

    const isLikelyHttpsPort = (port: string): boolean => port === '443' || port === '8443';
    const isLikelyHttpPort = (port: string): boolean => port === '80' || port === '8080';

    const getPortsForProtocol = (protocol: 'http' | 'https', preferredPort?: string) => {
        const ports: string[] = [];
        // Keep user-provided port only when it matches protocol expectations.
        if (preferredPort && isLikelyPort(preferredPort) && !ports.includes(preferredPort)) {
            ports.push(preferredPort);
        }
        if (remotePort) {
            if (protocol === 'https' && isLikelyHttpsPort(remotePort)) ports.push(remotePort);
            if (protocol === 'http' && isLikelyHttpPort(remotePort)) ports.push(remotePort);
            // If protocol is explicit in UI, honor custom port as-is.
            if (remoteProtocol === protocol && !ports.includes(remotePort)) ports.push(remotePort);
        }
        for (const defaultPort of defaultPortsByProtocol[protocol]) {
            ports.push(defaultPort);
        }
        if (locationPort) ports.push(locationPort);
        return ports.filter((port, idx) => ports.indexOf(port) === idx);
    };

    const hostEntries: Array<{ host: string; source: WSConnectCandidate['source']; preferPort?: string }> = [];
    for (const remoteHostSpecEntry of remoteHostSpecs) {
        hostEntries.push({
            host: remoteHostSpecEntry.host,
            source: "remote",
            preferPort: remoteHostSpecEntry.port
        });
    }
    if (remoteHostSpecs.length === 0 && remoteHost) {
        hostEntries.push({
            host: remoteHost,
            source: "remote"
        });
    }
    if (location.hostname) {
        hostEntries.push({
            host: location.hostname,
            source: "page"
        });
    }
    const uniqueHostEntries = new Map<string, { host: string; source: WSConnectCandidate['source']; preferPort?: string }>();
    for (const entry of hostEntries) {
        if (entry.host && !uniqueHostEntries.has(entry.host)) {
            uniqueHostEntries.set(entry.host, entry);
        }
    }
    const candidateHostEntries = Array.from(uniqueHostEntries.values());
    const httpsOrderedHostEntries = reorderHostEntriesForHttps(candidateHostEntries);

    const candidates: WSConnectCandidate[] = [];
    for (const protocol of protocolOrder) {
        // Browsers block active mixed content from HTTPS pages to HTTP endpoints.
        if (location.protocol === 'https:' && protocol === 'http') continue;
        const hostList = protocol === 'https' ? httpsOrderedHostEntries : candidateHostEntries;
        for (const hostEntry of hostList) {
            const { host, source, preferPort } = hostEntry;
            const hostPortOverride = preferPort;
            for (const port of getPortsForProtocol(protocol, hostPortOverride)) {
                const useWebSocketOnly = location.protocol === "https:" && isPrivateIp(host) && !isLocalPageHost;
                // WebSocket-first is faster with server-v2 / same-port TLS; polling first adds a round-trip.
                // If an environment breaks WS upgrade behind a proxy, set transports manually in a fork.
                const preferPollingFirst = false;
                candidates.push({
                    url: `${protocol}://${host}:${port}`,
                    protocol,
                    host,
                    source,
                    port,
                    useWebSocketOnly,
                    preferPollingFirst
                });
            }
        }
    }
    const deduplicatedCandidates = candidates.filter((item, idx) => candidates.findIndex((x) => x.url === item.url) === idx);
    if (deduplicatedCandidates.length === 0) {
        isConnecting = false;
        setWsStatus(false);
        updateButtonLabel();
        return;
    }

    const normalizedOffset = deduplicatedCandidates.length > 0 ? nextWsCandidateOffset % deduplicatedCandidates.length : 0;
    const uniqueCandidates = deduplicatedCandidates
        .slice(normalizedOffset)
        .concat(deduplicatedCandidates.slice(0, normalizedOffset));
    nextWsCandidateOffset = normalizedOffset;
    lastWsCandidates = uniqueCandidates;
    if (lastWsCandidates.length <= 1) {
        nextWsCandidateOffset = 0;
    }

    const rotateCandidate = () => {
        if (lastWsCandidates.length > 1) {
            nextWsCandidateOffset = (nextWsCandidateOffset + 1) % lastWsCandidates.length;
        }
    };

    isConnecting = true;
    updateButtonLabel();

    const maxRounds = 3;
    const retryDelayMs = 450;
    const targetHost = parsedRemoteHost || remoteHost;
    const targetPort =
        routeTargetPortForQuery ||
        parsedRemotePort ||
        remotePort ||
        (primaryProtocol === "https" ? "8443" : "8080");
    const routeTarget = routeTargetForQuery;
    const resolvedRouteTarget = routeTarget || targetHost || "";

    const isSameAsTargetHost = (): boolean => {
        if (!routeTarget || !targetHost) return true;
        const normalizedRouteTarget = routeTarget.trim().toLowerCase();
        const normalizedTargetHost = targetHost.trim().toLowerCase();
        if (!normalizedRouteTarget || !normalizedTargetHost) return true;
        if (normalizedRouteTarget === normalizedTargetHost) return true;
        if (normalizedRouteTarget === `l-${normalizedTargetHost}`) return true;
        return false;
    };

    const buildHandshakeForCandidate = (candidate: WSConnectCandidate) => {
        const url = candidate.url;
        const authToken = getAuthToken();
        const clientId = getClientId();
        const peerInstanceId = getAirPadPeerInstanceId().trim();
        const handshakeAuth: Record<string, string> = {};
        if (authToken) {
            handshakeAuth.token = authToken;
            handshakeAuth.airpadToken = authToken;
        }
        if (clientId) {
            handshakeAuth.clientId = clientId;
        }
        if (peerInstanceId) {
            handshakeAuth.peerInstanceId = peerInstanceId;
            handshakeAuth.deviceInstanceId = peerInstanceId;
        }

        const queryParams: Record<string, string> = {};
        const cleanedClientId = clientId.trim();
        if (authToken) {
            queryParams.token = authToken;
            queryParams.airpadToken = authToken;
        }
        if (cleanedClientId) {
            queryParams.clientId = cleanedClientId;
            queryParams.__airpad_src = cleanedClientId;
            queryParams.__airpad_client = cleanedClientId;
        }
        if (peerInstanceId) {
            queryParams.peerInstanceId = peerInstanceId;
            queryParams.deviceInstanceId = peerInstanceId;
        }
        queryParams.__airpad_hop = candidate.host || remoteHost || "unknown";
        queryParams.__airpad_host = candidate.host || remoteHost || "";
        queryParams.__airpad_target = targetHost || "";
        queryParams.connectionType = AIRPAD_CONNECTION_TYPE;
        queryParams.archetype = AIRPAD_ARCHETYPE;
        queryParams.__airpad_via = !isSameAsTargetHost() ? "tunnel" : candidate.source || "unknown";
        queryParams.__airpad_endpoint = isSameAsTargetHost() ? "1" : "0";
        queryParams.__airpad_target_port = targetPort;
        queryParams.__airpad_via_port = candidate.port || "";
        queryParams.__airpad_protocol = candidate.protocol || "https";
        if (resolvedRouteTarget) {
            queryParams.__airpad_route = resolvedRouteTarget;
            if (!routeTarget) {
                queryParams.__airpad_route_target = targetHost || "";
            }
        }

        return { url, authToken, clientId, peerInstanceId, handshakeAuth, queryParams };
    };

    const finalizeConnectedSocket = (
        probeSocket: Socket,
        candidate: WSConnectCandidate,
        index: number,
        url: string,
        authToken: string,
        clientId: string,
        peerInstanceId: string,
        engine: EngineLike | undefined,
        onEngineClose: (code?: number, reason?: unknown) => void,
        onEngineError: (error: unknown) => void
    ) => {
        socket = probeSocket;
        logWsState(
            "connected",
            `candidate=${index + 1}/${uniqueCandidates.length} candidate_url=${url} transport=${candidate.protocol} parallel=${AIRPAD_CANDIDATE_PARALLEL}`
        );
        isConnecting = false;
        autoReconnectAttempts = 0;
        setWsStatus(true);
        socket.emit("hello", {
            id: peerInstanceId || clientId,
            byId: clientId,
            from: clientId,
            peerInstanceId: peerInstanceId || undefined,
            token: authToken || undefined,
            nodes: getCoordinatorNodes()
        });

        socket.on("disconnect", (reason?: string) => {
            logWsState(
                "disconnected",
                `candidate=${index + 1}/${uniqueCandidates.length} candidate_url=${url} reason=${reason || "unknown"}`
            );
            engine?.off?.("close", onEngineClose);
            engine?.off?.("error", onEngineError);
            isConnecting = false;
            setWsStatus(false);
            updateButtonLabel();

            const manual = manualDisconnectRequested;
            manualDisconnectRequested = false;
            for (const [uuid, pending] of coordinatorPending.entries()) {
                clearTimeout(pending.timeoutId);
                pending.reject({ ok: false, error: `Disconnected before response for ${uuid}` });
                coordinatorPending.delete(uuid);
            }
            socket = null;
            if (manual) {
                autoReconnectAttempts = 0;
                return;
            }

            if (shouldRotateCandidateOnDisconnect(reason)) {
                rotateCandidate();
                if (lastWsCandidates.length > 1) {
                    log(`Socket.IO disconnect reason "${reason || "unknown"}", trying next candidate on reconnect`);
                }
            }

            const attempt = autoReconnectAttempts + 1;
            const hasMaxAttemptLimit = AUTO_RECONNECT_MAX_ATTEMPTS > 0;
            if (!shouldAutoReconnectAfterDisconnect(reason) || (hasMaxAttemptLimit && attempt > AUTO_RECONNECT_MAX_ATTEMPTS)) {
                return;
            }

            autoReconnectAttempts = attempt;
            const delay = Math.min(AUTO_RECONNECT_BASE_DELAY_MS * attempt, 5000);
            setTimeout(() => {
                if (isConnecting || wsConnected || (socket && socket.connected) || (socket as any)?.connecting) {
                    return;
                }
                const attemptLabel = hasMaxAttemptLimit
                    ? `${attempt}/${AUTO_RECONNECT_MAX_ATTEMPTS}`
                    : `${attempt}/unlimited`;
                logWsState("auto-reconnect", `attempt=${attemptLabel} reason=${reason || "unknown reason"}`);
                connectWS();
            }, delay);
        });

        socket.on("hello-ack", (data: any) => {
            if (data?.id) {
                log(`Socket.IO hello ack: ${String(data.id)}`);
            }
        });

        socket.on("connect_error", (error) => {
            logWsState(
                "socket-connect-error",
                `candidate=${index + 1}/${uniqueCandidates.length} candidate_url=${url} reason=${error?.message || "unknown"}`
            );
            isConnecting = false;
            updateButtonLabel();
        });

        socket.on("voice_result", async (msg: any) => {
            const decoded = await unwrapIncomingPayload(msg);
            handleServerMessage(decoded);
        });
        socket.on("voice_error", async (msg: any) => {
            const decoded = await unwrapIncomingPayload(msg);
            handleServerMessage(decoded);
        });

        socket.on("clipboard:update", async (msg: any) => {
            const decoded = await unwrapIncomingPayload(msg);
            const text = typeof decoded?.text === "string" ? decoded.text : "";
            lastServerClipboardText = text;
            notifyClipboardHandlers(text, { source: decoded?.source });
        });
        socket.on("data", async (packet: any) => {
            const decoded = await unwrapIncomingPayload(packet);
            if (!isCoordinatorPacket(decoded)) return;
            handleCoordinatorPacket(decoded);
        });
        socket.on("message", async (packet: any) => {
            const decoded = await unwrapIncomingPayload(packet);
            if (!isCoordinatorPacket(decoded)) return;
            handleCoordinatorPacket(decoded);
        });
        socket.on("network.fetch", async (request: NetworkFetchRequest, ack?: (value: NetworkFetchResponse | Error) => void) => {
            const response = await handleServerNetworkFetchRequest(request);
            if (typeof ack === "function") {
                ack(response);
            }
        });

        (window as any).__socket = socket;
    };

    const probeBatch = (startIndex: number, round: number): Promise<boolean> =>
        new Promise((resolve) => {
            if (attemptId !== connectAttemptId) {
                resolve(false);
                return;
            }
            const batch = uniqueCandidates.slice(startIndex, startIndex + AIRPAD_CANDIDATE_PARALLEL);
            if (!batch.length) {
                resolve(false);
                return;
            }

            if (startIndex === 0 && round === 0) {
                const el = getWsStatusEl();
                if (el) {
                    el.classList.remove(WS_STATUS_TLS_HINT_CLASS);
                    el.textContent = "connecting…";
                }
            }

            let won = false;
            let settled = false;
            let deadCount = 0;
            const batchSize = batch.length;
            let batchTlsCertUrl: string | null = null;
            let batchTlsHostname: string | null = null;

            const finishWin = (
                winner: Socket,
                candidate: WSConnectCandidate,
                index: number,
                url: string,
                hs: ReturnType<typeof buildHandshakeForCandidate>,
                engine: EngineLike | undefined,
                oec: (code?: number, reason?: unknown) => void,
                oee: (error: unknown) => void
            ) => {
                if (settled) return;
                settled = true;
                won = true;
                const clearProbeTimer = (s: Socket) => {
                    const t = (s as unknown as { __airpadProbeTimer?: ReturnType<typeof globalThis.setTimeout> }).__airpadProbeTimer;
                    if (t) globalThis.clearTimeout(t);
                    delete (s as unknown as { __airpadProbeTimer?: ReturnType<typeof globalThis.setTimeout> }).__airpadProbeTimer;
                };
                for (const s of [...activeProbeSockets]) {
                    if (s !== winner) {
                        clearProbeTimer(s);
                        s.removeAllListeners();
                        s.close();
                        activeProbeSockets.delete(s);
                    }
                }
                clearProbeTimer(winner);
                activeProbeSockets.delete(winner);
                finalizeConnectedSocket(winner, candidate, index, url, hs.authToken, hs.clientId, hs.peerInstanceId, engine, oec, oee);
                resolve(true);
            };

            const finishAllDead = () => {
                if (settled || won) return;
                deadCount++;
                if (deadCount < batchSize) return;
                settled = true;
                if (batchTlsCertUrl) {
                    setWsStatusTlsHint(batchTlsCertUrl);
                } else if (batchTlsHostname) {
                    setWsStatusTlsHostnameHint(batchTlsHostname);
                }
                resolve(false);
            };

            for (let localIdx = 0; localIdx < batch.length; localIdx++) {
                const candidate = batch[localIdx];
                const index = startIndex + localIdx;
                const hs = buildHandshakeForCandidate(candidate);
                const { url, handshakeAuth, queryParams } = hs;
                logWsState(
                    "connecting",
                    `batch=${startIndex}-${startIndex + batchSize - 1} candidate=${index + 1}/${uniqueCandidates.length} candidate_url=${url} ` +
                        `transport=${candidate.protocol} source=${candidate.source} host=${candidate.host}:${candidate.port} target=${targetHost}:${targetPort}`
                );

                const probeSocket = io(url, {
                    auth: handshakeAuth,
                    query: queryParams,
                    transports: candidate.useWebSocketOnly
                        ? ["websocket"]
                        : candidate.preferPollingFirst
                          ? ["polling", "websocket"]
                          : ["websocket", "polling"],
                    upgrade: !candidate.useWebSocketOnly,
                    reconnection: false,
                    timeout: AIRPAD_PROBE_IO_TIMEOUT_MS,
                    secure: candidate.protocol === "https",
                    forceNew: true
                });
                const engine = (probeSocket as any).io?.engine as EngineLike | undefined;
                const onEngineClose = (code?: number, reason?: unknown) => {
                    logWsState(
                        "engine-close",
                        `candidate=${index + 1}/${uniqueCandidates.length} candidate_url=${url} ` +
                            `code=${code ?? "n/a"} reason=${typeof reason === "string" ? reason : safeJson(reason)} transport=${engine?.transport?.name || "unknown"}`
                    );
                };
                const onEngineError = (error: unknown) => {
                    logWsState(
                        "engine-error",
                        `candidate=${index + 1}/${uniqueCandidates.length} candidate_url=${url} reason=${describeError(error)}`
                    );
                };
                engine?.on?.("close", onEngineClose);
                engine?.on?.("error", onEngineError);
                activeProbeSockets.add(probeSocket);

                const hardTimer = globalThis.setTimeout(() => {
                    if (won || settled || probeSocket.connected) return;
                    probeSocket.removeAllListeners();
                    probeSocket.close();
                    activeProbeSockets.delete(probeSocket);
                    engine?.off?.("close", onEngineClose);
                    engine?.off?.("error", onEngineError);
                    logWsState("connect-failed", `candidate=${index + 1}/${uniqueCandidates.length} candidate_url=${url} reason=probe-hard-timeout`);
                    finishAllDead();
                }, AIRPAD_PROBE_HARD_CAP_MS);
                (probeSocket as unknown as { __airpadProbeTimer?: ReturnType<typeof globalThis.setTimeout> }).__airpadProbeTimer =
                    hardTimer;

                probeSocket.on("connect", () => {
                    globalThis.clearTimeout(hardTimer);
                    if (attemptId !== connectAttemptId) {
                        probeSocket.removeAllListeners();
                        probeSocket.close();
                        activeProbeSockets.delete(probeSocket);
                        engine?.off?.("close", onEngineClose);
                        engine?.off?.("error", onEngineError);
                        return;
                    }
                    if (won || settled) {
                        probeSocket.removeAllListeners();
                        probeSocket.close();
                        activeProbeSockets.delete(probeSocket);
                        engine?.off?.("close", onEngineClose);
                        engine?.off?.("error", onEngineError);
                        return;
                    }
                    finishWin(probeSocket, candidate, index, url, hs, engine, onEngineClose, onEngineError);
                });

                probeSocket.on("connect_error", (error) => {
                    globalThis.clearTimeout(hardTimer);
                    activeProbeSockets.delete(probeSocket);
                    engine?.off?.("close", onEngineClose);
                    engine?.off?.("error", onEngineError);
                    if (won || settled) {
                        probeSocket.removeAllListeners();
                        probeSocket.close();
                        return;
                    }
                    probeSocket.removeAllListeners();
                    probeSocket.close();
                    const details = (error as any)?.description || (error as any)?.context || "";
                    const errorMessage = String((error as any)?.message || error || "");
                    const certLikely =
                        candidate.protocol === "https" &&
                        isPrivateIp(candidate.host) &&
                        /xhr poll error|websocket error/i.test(errorMessage);
                    if (certLikely && !batchTlsCertUrl) {
                        batchTlsCertUrl = url;
                    }
                    const publicIpv4Https =
                        candidate.protocol === "https" &&
                        isIpv4Literal(candidate.host) &&
                        !isPrivateIp(candidate.host) &&
                        candidate.host !== "127.0.0.1";
                    const combinedErr = `${errorMessage} ${String(details)}`;
                    const publicIpTlsLikely =
                        publicIpv4Https &&
                        /xhr poll error|websocket error|certificate|CERT|common name|ssl|tls|failed to fetch|name invalid/i.test(combinedErr);
                    if (publicIpTlsLikely && !batchTlsHostname) {
                        const suggested =
                            pageHost && !isIpv4Literal(pageHost) && pageHost !== "localhost" ? pageHost : "";
                        if (suggested) {
                            batchTlsHostname = suggested;
                        }
                    }
                    if (
                        candidate.useWebSocketOnly &&
                        /xhr poll error|cors|private network|address space|failed fetch/i.test(errorMessage)
                    ) {
                        logWsState(
                            "connect-failed",
                            `candidate=${index + 1}/${uniqueCandidates.length} candidate_url=${url} reason=${errorMessage} hint=private-network-cors`
                        );
                    }
                    logWsState(
                        "connect-failed",
                        `candidate=${index + 1}/${uniqueCandidates.length} candidate_url=${url} reason=${errorMessage} details=${details ? safeJson(details) : "none"}`
                    );
                    finishAllDead();
                });
            }
        });

    void (async () => {
        for (let round = 0; round < maxRounds; round++) {
            for (let start = 0; start < uniqueCandidates.length; start += AIRPAD_CANDIDATE_PARALLEL) {
                if (attemptId !== connectAttemptId) {
                    return;
                }
                const ok = await probeBatch(start, round);
                if (ok) {
                    return;
                }
            }
            if (round + 1 < maxRounds) {
                logWsState("retry", `round=${round + 2}/${maxRounds} next=0`);
                await new Promise((r) => globalThis.setTimeout(r, retryDelayMs));
            }
        }
        if (attemptId !== connectAttemptId) {
            return;
        }
        logWsState("failed", `round=${maxRounds}/${maxRounds} all-candidates`);
        isConnecting = false;
        setWsStatus(false);
        updateButtonLabel();
    })();
}

export function disconnectWS() {
    connectAttemptId += 1;
    manualDisconnectRequested = true;
    for (const probe of [...activeProbeSockets]) {
        probe.removeAllListeners();
        probe.close();
        activeProbeSockets.delete(probe);
    }
    isConnecting = false;
    if (!socket) {
        setWsStatus(false);
        updateButtonLabel();
        return;
    }
    log('Disconnecting Socket.IO...');
    socket.disconnect();
    socket = null;
    (window as any).__socket = null;
    setWsStatus(false);
}

export function initWebSocket(btnConnect: HTMLElement | null) {
    btnEl = btnConnect;
    updateButtonLabel();
    if (!btnConnect) return;

    if (wsConnectButton === btnConnect) return;
    if (wsConnectButton) {
        wsConnectButton.removeEventListener('click', handleWsConnectButtonClick);
    }
    wsConnectButton = btnConnect;
    wsConnectButton.addEventListener('click', handleWsConnectButtonClick);
}

function handleWsConnectButtonClick() {
    if (isConnecting || wsConnected || (socket && socket.connected) || (socket as any)?.connecting) {
        disconnectWS();
    } else {
        connectWS();
    }
}

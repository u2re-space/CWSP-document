// =========================
// Socket.IO with Binary Messages
// =========================

import { io, Socket } from 'socket.io-client';
import { log, getWsStatusEl, getVoiceTextEl } from '../utils/utils';
import {
    getRemoteHost,
    getRemoteProtocol,
    getRemoteRouteTarget,
    getAirPadAuthToken,
    getAirPadTransportMode,
    getAirPadTransportSecret,
    getAirPadSigningSecret,
    getAirPadClientId,
} from '../config/config';

let socket: Socket | null = null;
let wsConnected = false;
let isConnecting = false;
let btnEl: HTMLElement | null = null;
let wsConnectButton: HTMLElement | null = null;
let connectAttemptId = 0;
let activeProbeSocket: Socket | null = null;
let manualDisconnectRequested = false;
let autoReconnectAttempts = 0;
type WSConnectCandidate = {
    url: string;
    protocol: 'http' | 'https';
    host: string;
    source: 'remote' | 'page';
    port: string;
    useWebSocketOnly: boolean;
};
let lastWsCandidates: WSConnectCandidate[] = [];
let nextWsCandidateOffset = 0;
const localNetworkPermissionProbeDone = new Set<string>();
// Keep retrying across NAT/Wi-Fi transitions; 0 means unlimited retries.
const AUTO_RECONNECT_MAX_ATTEMPTS = 0;
const AUTO_RECONNECT_BASE_DELAY_MS = 800;
const AIRPAD_CONNECTION_TYPE = "exchanger-initiator";
const AIRPAD_ARCHETYPE = "first-order";
type WSConnectionHandler = (connected: boolean) => void;
const wsConnectionHandlers = new Set<WSConnectionHandler>();

// Clipboard state + listeners (PC clipboard as seen by backend)
let lastServerClipboardText = '';
type ClipboardUpdateHandler = (text: string, meta?: { source?: string }) => void;
const clipboardHandlers = new Set<ClipboardUpdateHandler>();

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

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
let aesKeyCache = new Map<string, CryptoKey>();
let hmacKeyCache = new Map<string, CryptoKey>();

// Binary message format constants
export const MSG_TYPE_MOVE = 0;
export const MSG_TYPE_CLICK = 1;
export const MSG_TYPE_SCROLL = 2;
export const MSG_TYPE_MOUSE_DOWN = 3;
export const MSG_TYPE_MOUSE_UP = 4;
export const MSG_TYPE_VOICE_COMMAND = 5;
export const MSG_TYPE_KEYBOARD = 6;

const BUTTON_LEFT = 0;
const BUTTON_RIGHT = 1;
const BUTTON_MIDDLE = 2;
const FLAG_DOUBLE = 0x80;

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

export function requestClipboardGet(): Promise<{ ok: boolean; text?: string; error?: string }> {
    return new Promise((resolve) => {
        if (!socket || !socket.connected) return resolve({ ok: false, error: 'WS not connected' });
        socket.emit('clipboard:get', (res: any) => resolve(res || { ok: false }));
    });
}

export function requestClipboardCopy(): Promise<{ ok: boolean; text?: string; error?: string }> {
    return new Promise((resolve) => {
        if (!socket || !socket.connected) return resolve({ ok: false, error: 'WS not connected' });
        socket.emit('clipboard:copy', (res: any) => resolve(res || { ok: false }));
    });
}

export function requestClipboardCut(): Promise<{ ok: boolean; text?: string; error?: string }> {
    return new Promise((resolve) => {
        if (!socket || !socket.connected) return resolve({ ok: false, error: 'WS not connected' });
        socket.emit('clipboard:cut', (res: any) => resolve(res || { ok: false }));
    });
}

export function requestClipboardPaste(text: string): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
        if (!socket || !socket.connected) return resolve({ ok: false, error: 'WS not connected' });
        socket.emit('clipboard:paste', { text }, (res: any) => resolve(res || { ok: false }));
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

function setWsStatus(connected: boolean) {
    wsConnected = connected;
    const wsStatusEl = getWsStatusEl();
    if (wsStatusEl) {
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

// Create binary message buffer for mouse/scroll (8 bytes)
// Format: [dx: 2][dy: 2][type: 1][flags: 1][reserved: 2]
function createMouseMessage(type: number, dx: number = 0, dy: number = 0, flags: number = 0): ArrayBuffer {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);

    view.setInt16(0, Math.round(dx), true);   // dx (signed int16, little-endian)
    view.setInt16(2, Math.round(dy), true);   // dy (signed int16, little-endian)
    view.setUint8(4, type);                   // message type
    view.setUint8(5, flags);                  // flags/button
    view.setUint16(6, 0, true);               // reserved

    return buffer;
}

// Create binary message for keyboard (8 bytes)
// Format: [codePoint: 4][type: 1][flags: 1][reserved: 2]
export function createKeyboardMessage(codePoint: number, flags: number = 0): ArrayBuffer {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);

    view.setUint32(0, codePoint, true);       // Full Unicode codePoint (little-endian)
    view.setUint8(4, MSG_TYPE_KEYBOARD);      // message type
    view.setUint8(5, flags);                  // flags
    view.setUint16(6, 0, true);               // reserved

    return buffer;
}

// Helper to determine keyboard flags from character
function getKeyboardFlags(char: string): number {
    if (char === '\b' || char === '\u007F') return 1;  // backspace
    if (char === '\n' || char === '\r') return 2;       // enter
    if (char === ' ') return 3;                         // space
    if (char === '\t') return 4;                        // tab
    return 0;                                           // normal character
}

// Send keyboard character (exported for use by other modules)
export function sendKeyboardChar(char: string) {
    if (!socket || !socket.connected) return;

    const codePoint = char.codePointAt(0) || 0;
    const flags = getKeyboardFlags(char);
    const buffer = createKeyboardMessage(codePoint, flags);

    socket.emit('message', new Uint8Array(buffer));
}

// Send raw binary message (for direct use)
export function sendBinaryMessage(buffer: ArrayBuffer | Uint8Array) {
    if (!socket || !socket.connected) return;

    const data = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
    socket.emit('message', data);
}

export function sendWS(obj: any) {
    if (!socket || !socket.connected) return;

    let buffer: ArrayBuffer;

    switch (obj.type) {
        case 'move': {
            const dx = obj.dx || 0;
            const dy = obj.dy || 0;
            buffer = createMouseMessage(MSG_TYPE_MOVE, dx, dy);
            socket.emit('message', new Uint8Array(buffer));
            break;
        }
        case 'click': {
            let flags = BUTTON_LEFT;
            if (obj.button === 'right') flags = BUTTON_RIGHT;
            else if (obj.button === 'middle') flags = BUTTON_MIDDLE;
            if (obj.double || obj.count === 2) flags |= FLAG_DOUBLE;
            buffer = createMouseMessage(MSG_TYPE_CLICK, 0, 0, flags);
            socket.emit('message', new Uint8Array(buffer));
            break;
        }
        case 'scroll': {
            const dx = obj.dx || 0;
            const dy = obj.dy || 0;
            buffer = createMouseMessage(MSG_TYPE_SCROLL, dx, dy);
            socket.emit('message', new Uint8Array(buffer));
            break;
        }
        case 'mouse_down': {
            let flags = BUTTON_LEFT;
            if (obj.button === 'right') flags = BUTTON_RIGHT;
            else if (obj.button === 'middle') flags = BUTTON_MIDDLE;
            buffer = createMouseMessage(MSG_TYPE_MOUSE_DOWN, 0, 0, flags);
            socket.emit('message', new Uint8Array(buffer));
            break;
        }
        case 'mouse_up': {
            let flags = BUTTON_LEFT;
            if (obj.button === 'right') flags = BUTTON_RIGHT;
            else if (obj.button === 'middle') flags = BUTTON_MIDDLE;
            buffer = createMouseMessage(MSG_TYPE_MOUSE_UP, 0, 0, flags);
            socket.emit('message', new Uint8Array(buffer));
            break;
        }
        case 'voice_command': {
            // Voice commands still need text, so send as JSON
            socket.emit('message', JSON.stringify(obj));
            break;
        }
        case 'keyboard': {
            // Use the proper keyboard message format with full Unicode support
            const char = obj.char || '';
            const codePoint = obj.codePoint || char.codePointAt(0) || 0;
            const flags = obj.flags ?? getKeyboardFlags(char);
            buffer = createKeyboardMessage(codePoint, flags);
            socket.emit('message', new Uint8Array(buffer));
            break;
        }
        default:
            // Fallback to JSON for unknown types
            void emitSignedObjectMessage(obj);
            break;
    }
}

function handleServerMessage(msg: any) {
    if (msg.type === 'voice_result' || msg.type === 'voice_error') {
        const text =
            msg.error ||
            msg.message ||
            ('Actions: ' + JSON.stringify(msg.actions || []));
        const voiceTextEl = getVoiceTextEl();
        if (voiceTextEl) {
            voiceTextEl.textContent = text;
        }
        log('Voice result: ' + text);
    }
}

export function connectWS() {
    if (isConnecting) return;
    if (socket && (socket.connected || (socket as any).connecting)) return;
    if (activeProbeSocket) return;
    connectAttemptId += 1;
    const attemptId = connectAttemptId;
    manualDisconnectRequested = false;

    const remoteHost = getRemoteHost().trim();
    const resolvedRemoteHost = remoteHost || location.hostname;
    const remoteProtocol = getRemoteProtocol();
    const isPrivateIp = (host: string): boolean => {
        if (!host) return false;
        if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return false;
        return (
            host.startsWith('10.') ||
            host.startsWith('192.168.') ||
            /^172\.(1[6-9]|2\d|3[01])\./.test(host)
        );
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
    const defaultPortByProtocol = {
        http: '8080',
        https: '8443',
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
        ports.push(defaultPortByProtocol[protocol]);
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

    const candidates: WSConnectCandidate[] = [];
    for (const protocol of protocolOrder) {
        // Browsers block active mixed content from HTTPS pages to HTTP endpoints.
        if (location.protocol === 'https:' && protocol === 'http') continue;
        for (const hostEntry of candidateHostEntries) {
            const { host, source, preferPort } = hostEntry;
            const hostPortOverride = preferPort;
            for (const port of getPortsForProtocol(protocol, hostPortOverride)) {
                const useWebSocketOnly = location.protocol === "https:" && isPrivateIp(host) && !isLocalPageHost;
                candidates.push({
                    url: `${protocol}://${host}:${port}`,
                    protocol,
                    host,
                    source,
                    port,
                    useWebSocketOnly
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
    const tryConnect = (index: number, round: number) => {
        if (attemptId !== connectAttemptId) return;

        if (index >= uniqueCandidates.length) {
            if (round + 1 < maxRounds) {
                logWsState("retry", `round=${round + 2}/${maxRounds} next=0`);
                globalThis.setTimeout(() => tryConnect(0, round + 1), retryDelayMs);
                return;
            }
            logWsState("failed", `round=${round + 1}/${maxRounds} all-candidates`);
            isConnecting = false;
            setWsStatus(false);
            updateButtonLabel();
            return;
        }

        const candidate = uniqueCandidates[index];
        const url = candidate.url;
        const targetHost = parsedRemoteHost || remoteHost;
        const targetPort =
            routeTargetPortForQuery ||
            parsedRemotePort ||
            remotePort ||
            (primaryProtocol === 'https' ? '8443' : '8080');
        const routeTarget = routeTargetForQuery;
        const resolvedRouteTarget = routeTarget || targetHost || "";
        logWsState(
            "connecting",
            `candidate=${index + 1}/${uniqueCandidates.length} candidate_url=${url} transport=${candidate.protocol} ` +
            `source=${candidate.source} host=${candidate.host}:${candidate.port} target=${targetHost}:${targetPort}`
        );
        const authToken = getAirPadAuthToken().trim();
        const clientId = getAirPadClientId().trim();
        const handshakeAuth: Record<string, string> = {};
        if (authToken) {
            handshakeAuth.token = authToken;
            handshakeAuth.airpadToken = authToken;
        }
        if (clientId) {
            handshakeAuth.clientId = clientId;
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
        queryParams.__airpad_hop = candidate.host || remoteHost || 'unknown';
        queryParams.__airpad_host = candidate.host || remoteHost || '';
        queryParams.__airpad_target = targetHost || '';
        // Exchanger is the primary AirPad identity; first-order is retained as compatibility archetype.
        queryParams.connectionType = AIRPAD_CONNECTION_TYPE;
        queryParams.archetype = AIRPAD_ARCHETYPE;
        const isSameAsTargetHost = () => {
            if (!routeTarget || !targetHost) return true;
            const normalizedRouteTarget = routeTarget.trim().toLowerCase();
            const normalizedTargetHost = targetHost.trim().toLowerCase();
            if (!normalizedRouteTarget || !normalizedTargetHost) return true;
            if (normalizedRouteTarget === normalizedTargetHost) return true;
            if (normalizedRouteTarget === `l-${normalizedTargetHost}`) return true;
            return false;
        };
        queryParams.__airpad_via = !isSameAsTargetHost() ? "tunnel" : (candidate.source || 'unknown');
        queryParams.__airpad_endpoint = isSameAsTargetHost() ? "1" : "0";
        queryParams.__airpad_target_port = targetPort;
        queryParams.__airpad_via_port = candidate.port || '';
        queryParams.__airpad_protocol = candidate.protocol || 'https';
        if (resolvedRouteTarget) {
            queryParams.__airpad_route = resolvedRouteTarget;
            if (!routeTarget) {
                queryParams.__airpad_route_target = targetHost || "";
            }
        }

        const probeSocket = io(url, {
            auth: handshakeAuth,
            query: queryParams,
            // For public->private HTTPS (PNA), polling triggers fetch preflight restrictions.
            // Prefer WS-only in that scenario.
            transports: candidate.useWebSocketOnly ? ['websocket'] : ['websocket', 'polling'],
            upgrade: !candidate.useWebSocketOnly,
            reconnection: false,
            timeout: 10000,
            secure: candidate.protocol === 'https',
            forceNew: true,
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
            logWsState("engine-error", `candidate=${index + 1}/${uniqueCandidates.length} candidate_url=${url} reason=${describeError(error)}`);
        };
        engine?.on?.("close", onEngineClose);
        engine?.on?.("error", onEngineError);
        activeProbeSocket = probeSocket;

        probeSocket.on('connect', () => {
            if (attemptId !== connectAttemptId) {
                probeSocket.removeAllListeners();
                probeSocket.close();
                if (activeProbeSocket === probeSocket) activeProbeSocket = null;
                return;
            }
            if (activeProbeSocket === probeSocket) activeProbeSocket = null;
            socket = probeSocket;
            logWsState("connected", `candidate=${index + 1}/${uniqueCandidates.length} candidate_url=${url} transport=${candidate.protocol}`);
            isConnecting = false;
            autoReconnectAttempts = 0;
            setWsStatus(true);
            socket.emit('hello', { id: getClientId() });

            socket.on('disconnect', (reason?: string) => {
                logWsState("disconnected", `candidate=${index + 1}/${uniqueCandidates.length} candidate_url=${url} reason=${reason || "unknown"}`);
                engine?.off?.("close", onEngineClose);
                engine?.off?.("error", onEngineError);
                isConnecting = false;
                setWsStatus(false);
            updateButtonLabel();

            const manual = manualDisconnectRequested;
            manualDisconnectRequested = false;
            socket = null;
            if (manual) {
                autoReconnectAttempts = 0;
                return;
            }

            if (shouldRotateCandidateOnDisconnect(reason)) {
                rotateCandidate();
                if (lastWsCandidates.length > 1) {
                    log(`Socket.IO disconnect reason "${reason || 'unknown'}", trying next candidate on reconnect`);
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

            socket.on('hello-ack', (data: any) => {
                if (data?.id) {
                    const id = String(data.id);
                    log(`Socket.IO hello ack: ${id}`);
                }
            });

            socket.on('connect_error', (error) => {
                logWsState("socket-connect-error", `candidate=${index + 1}/${uniqueCandidates.length} candidate_url=${url} reason=${error?.message || "unknown"}`);
                isConnecting = false;
                updateButtonLabel();
            });

            socket.on('voice_result', async (msg: any) => {
                const decoded = await unwrapIncomingPayload(msg);
                handleServerMessage(decoded);
            });
            socket.on('voice_error', async (msg: any) => {
                const decoded = await unwrapIncomingPayload(msg);
                handleServerMessage(decoded);
            });

            socket.on('clipboard:update', async (msg: any) => {
                const decoded = await unwrapIncomingPayload(msg);
                const text = typeof decoded?.text === 'string' ? decoded.text : '';
                lastServerClipboardText = text;
                notifyClipboardHandlers(text, { source: decoded?.source });
            });
            socket.on("network.fetch", async (request: NetworkFetchRequest, ack?: (value: NetworkFetchResponse | Error) => void) => {
                const response = await handleServerNetworkFetchRequest(request);
                if (typeof ack === "function") {
                    ack(response);
                }
            });

            // Expose socket for virtual keyboard
            (window as any).__socket = socket;
        });

        probeSocket.on('connect_error', (error) => {
            if (attemptId !== connectAttemptId) {
                probeSocket.removeAllListeners();
                probeSocket.close();
                if (activeProbeSocket === probeSocket) activeProbeSocket = null;
                return;
            }
            probeSocket.removeAllListeners();
            probeSocket.close();
            if (activeProbeSocket === probeSocket) activeProbeSocket = null;
            const details = (error as any)?.description || (error as any)?.context || '';
            const errorMessage = String((error as any)?.message || error || '');
            const certLikely =
                candidate.protocol === 'https' &&
                isPrivateIp(candidate.host) &&
                /xhr poll error|websocket error/i.test(errorMessage);

            if (certLikely) {
                logWsState(
                    "connect-failed",
                    `candidate=${index + 1}/${uniqueCandidates.length} candidate_url=${url} reason=${errorMessage} hint=tls-certificate`
                );
                tryConnect(index + 1, round);
                return;
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

            tryConnect(index + 1, round);
            logWsState(
                "connect-failed",
                `candidate=${index + 1}/${uniqueCandidates.length} candidate_url=${url} reason=${errorMessage} details=${details ? safeJson(details) : "none"}`
            );
        });
    };

    tryConnect(0, 0);
}

export function disconnectWS() {
    connectAttemptId += 1;
    manualDisconnectRequested = true;
    if (activeProbeSocket) {
        activeProbeSocket.removeAllListeners();
        activeProbeSocket.close();
        activeProbeSocket = null;
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

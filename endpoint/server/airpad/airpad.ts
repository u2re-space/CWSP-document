import type { Socket } from "socket.io";
import type { IncomingMessage } from "node:http";

import { parsePayload, verifyWithoutDecrypt } from "../network/stack/crypto-utils.ts";
import { normalizeSocketFrame } from "../network/stack/messages.ts";
import { pickEnvBoolLegacy, pickEnvStringLegacy } from "../lib/env.ts";

export type AirpadClipHistoryEntry = {
    from: string;
    to: string;
    ts: number;
    data: any;
};

type AirpadSignedEnvelope = { cipher: string; sig: string; from?: string };

type HasSignedEnvelope = (payload: unknown) => payload is AirpadSignedEnvelope;

const hasSignedEnvelope: HasSignedEnvelope = (payload: unknown): payload is AirpadSignedEnvelope => typeof payload === "object" && payload !== null && typeof (payload as any).cipher === "string" && typeof (payload as any).sig === "string";

const extractPayload = (payload: unknown, requiresSecureEnvelope: boolean): unknown => {
    if (!hasSignedEnvelope(payload)) return payload as unknown;
    if (!requiresSecureEnvelope) return payload;
    const parsed = parsePayload(payload);
    return parsed.inner;
};

export const getAirPadTokens = () =>
    (pickEnvStringLegacy("CWS_AIRPAD_AUTH_TOKENS", { allowEmpty: true }) || pickEnvStringLegacy("CWS_AIRPAD_TOKENS", { allowEmpty: true }) || "")
        .split(",")
        .map((token) => token.trim())
        .filter(Boolean);

const extractTokenFromRequestQuery = (rawUrl: string | undefined): string => {
    if (!rawUrl) return "";
    if (!rawUrl.includes("?")) return "";
    const queryIndex = rawUrl.indexOf("?");
    const query = rawUrl.slice(queryIndex + 1);
    try {
        const params = new URLSearchParams(query);
        return params.get("token")?.trim() || params.get("airpadToken")?.trim() || "";
    } catch {
        return "";
    }
};

const readRequestHeaderToken = (value: string | string[] | undefined): string => {
    if (!value) return "";
    const raw = Array.isArray(value) ? value[0] : value;
    return typeof raw === "string" ? raw.trim() : "";
};

const extractAirPadTokenFromRequestHeaders = (headers: IncomingMessage["headers"]): string => {
    const rawAuthorization = readRequestHeaderToken(headers.authorization);
    if (rawAuthorization.toLowerCase().startsWith("bearer ")) {
        return rawAuthorization.slice(7).trim();
    }

    return readRequestHeaderToken(headers["x-airpad-token"]) || readRequestHeaderToken(headers["x-airpad-client-token"]) || "";
};

export const getAirPadTokenFromRequest = (request?: IncomingMessage): string => {
    if (!request) return "";
    const tokenFromQuery = extractTokenFromRequestQuery(request.url);
    if (tokenFromQuery) return tokenFromQuery;
    return extractAirPadTokenFromRequestHeaders(request.headers as IncomingMessage["headers"]);
};

export const isAirPadRequestAuthorized = (request?: IncomingMessage): boolean => {
    const tokens = getAirPadTokens();
    if (!tokens.length) return true;
    const token = getAirPadTokenFromRequest(request);
    return !!token && tokens.includes(token);
};

export const getAirPadTokenFromSocket = (socket: Socket) => {
    const handshake: any = (socket as any).handshake || {};
    const auth = handshake.auth || {};
    const query = handshake.query || {};
    const pick = (value: unknown) => {
        if (typeof value === "string") return value;
        if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : "";
        return "";
    };

    return pick(auth.token) || pick(auth.airpadToken) || pick(query.token) || pick(query.airpadToken);
};

export const isAirPadAuthorized = (socket: Socket) => {
    const allowed = getAirPadTokens();
    if (!allowed.length) return true;
    const provided = getAirPadTokenFromSocket(socket);
    return !!provided && allowed.includes(provided);
};

export type AirpadConnectionMeta = {
    clientId?: string;
    sourceId?: string;
    remoteAddress?: string;
    remotePort?: number;
    hopHint?: string;
    hostHint?: string;
    routeTarget?: string;
    targetHost?: string;
    targetPort?: string;
    routeHint?: string;
    viaPort?: string;
    protocolHint?: string;
    isEndpoint?: boolean;
    connectionType?: string;
    xForwardedFor?: unknown;
    xForwardedHost?: unknown;
    xForwardedProto?: unknown;
    xRealIp?: unknown;
    xRealHost?: unknown;
};

const pickString = (value: unknown): string | undefined => {
    if (typeof value === "string") {
        const normalized = value.trim();
        return normalized.length ? normalized : undefined;
    }
    if (Array.isArray(value)) {
        return typeof value[0] === "string" ? value[0].trim() || undefined : undefined;
    }
    return undefined;
};

const stripRouteTargetProtocol = (value: string): string => {
    const withoutProtocol = value.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split("/")[0];
    return withoutProtocol.trim();
};

const isLikelyPort = (value: string): boolean => /^\d{1,5}$/.test(value);

const stripRouteTargetPort = (value: string): string => {
    const hostSpec = stripRouteTargetProtocol(value);
    if (!hostSpec) return "";

    if (hostSpec.startsWith("[") && hostSpec.includes("]")) {
        const close = hostSpec.lastIndexOf("]");
        const after = hostSpec.slice(close + 1);
        if (after.startsWith(":")) {
            const candidatePort = after.slice(1);
            if (isLikelyPort(candidatePort)) {
                return hostSpec.slice(0, close + 1);
            }
        }
    }

    const at = hostSpec.lastIndexOf(":");
    if (at <= 0) return hostSpec;
    const candidatePort = hostSpec.slice(at + 1);
    if (isLikelyPort(candidatePort)) {
        return hostSpec.slice(0, at);
    }
    return hostSpec;
};

const parseBooleanLike = (value: unknown): boolean | undefined => {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value !== "string") return undefined;
    const normalized = value.trim().toLowerCase();
    if (!normalized) return undefined;
    if (["1", "true", "yes", "on", "enabled", "enable", "y"].includes(normalized)) return true;
    if (["0", "false", "no", "off", "disabled", "disable", "n"].includes(normalized)) return false;
    return undefined;
};

const isRouteEndpoint = (query: Record<string, unknown>): boolean | undefined => {
    const candidates = [
        query.__airpad_endpoint,
        query.__airpad_is_endpoint,
        query.endpoint,
        query.endpoint_flag,
        query.endpointFlag,
        query.__airpad_endpoint_flag,
        query.isEndpoint
    ];
    const parsed = candidates
        .map(parseBooleanLike)
        .find((value) => typeof value === "boolean");
    if (typeof parsed === "boolean") return parsed;
    return undefined;
};

const normalizeAirPadRouteTarget = (value: string | undefined): string | undefined => {
    const normalized = stripRouteTargetPort(String(value || ""));
    return normalized || undefined;
};

export const describeAirPadConnectionMeta = (socket: Socket): AirpadConnectionMeta => {
    const auth: Record<string, unknown> = (socket as any).handshake?.auth || {};
    const headers: Record<string, unknown> = (socket as any).handshake?.headers || {};
    const query: Record<string, unknown> = (socket as any).handshake?.query || {};
    const remoteAddress = (socket.handshake as any)?.address || (socket as any)?.request?.socket?.remoteAddress;
    const remotePort = (socket as any)?.request?.socket?.remotePort;

    return {
        remoteAddress: pickString(remoteAddress),
        remotePort: typeof remotePort === "number" ? remotePort : undefined,
        clientId: pickString(auth.clientId) || pickString(query.clientId),
        sourceId: pickString(query.__airpad_src) || pickString(query.__airpad_source) || pickString(query.sourceId) || pickString(query.source) || pickString(query.peerId) || pickString(auth.clientId) || pickString(query.clientId),
        hopHint: pickString(query.__airpad_hop),
        hostHint: pickString(query.__airpad_host),
        targetHost: pickString(query.__airpad_target),
        targetPort: pickString(query.__airpad_target_port),
        routeHint: pickString(query.__airpad_via),
        routeTarget: normalizeAirPadRouteTarget(
            pickString(query.__airpad_route) ||
            pickString(query.__airpad_route_target) ||
            pickString(query.routeTarget)
        ),
        viaPort: pickString(query.__airpad_via_port),
        protocolHint: pickString(query.__airpad_protocol),
        isEndpoint: isRouteEndpoint(query),
        connectionType: pickString(query.connectionType) || pickString(query.archetype) || pickString(query.connectionRole),
        xForwardedFor: headers["x-forwarded-for"] || headers["X-Forwarded-For"],
        xForwardedHost: headers["x-forwarded-host"] || headers["X-Forwarded-Host"],
        xForwardedProto: headers["x-forwarded-proto"] || headers["X-Forwarded-Proto"],
        xRealIp: headers["x-real-ip"] || headers["X-Real-IP"],
        xRealHost: headers["x-real-host"] || headers["X-Real-Host"]
    };
};

export const isAirPadMessageAuthRequired = () => pickEnvBoolLegacy("CWS_REQUIRE_SIGNED_MESSAGE") ?? false;

export type AirpadObjectMessageDeps = {
    routeMessage: (sourceSocket: Socket, msg: any) => void;
    requiresAirpadMessageAuth: boolean;
    getSourceId: (socket: Socket) => string;
    clipHistory: AirpadClipHistoryEntry[];
    maxHistory: number;
    logMsg: (prefix: string, msg: any) => void;
    emitError: (socket: Socket, message: string) => void;
};

export const createAirpadObjectMessageHandler = (socket: Socket, deps: AirpadObjectMessageDeps) => {
    return async (msg: any): Promise<void> => {
        const normalized = normalizeSocketFrame(msg, deps.getSourceId(socket));
        const signed = hasSignedEnvelope(normalized.payload);
        const envelopeRequired = deps.requiresAirpadMessageAuth || normalized.mode === "secure";

        if (envelopeRequired) {
            if (!signed) {
                console.warn(`[Server] AirPad signed payload required for mode=${normalized.mode}, from=${normalized.from}`);
                deps.emitError(socket, "Signed payload required");
                return;
            }
            const ok = verifyWithoutDecrypt(normalized.payload);
            if (!ok) {
                console.warn(`[Server] Signed payload validation failed for from=${normalized.from}`);
                deps.emitError(socket, "Signed payload validation failed");
                return;
            }
        }

        const parsed = hasSignedEnvelope(normalized.payload) ? parsePayload(normalized.payload) : null;
        if (parsed) {
            normalized.from = normalized.from || parsed.from;
            normalized.payload = extractPayload(normalized.payload, deps.requiresAirpadMessageAuth);
        }

        deps.logMsg("IN ", normalized);

        try {
            if (normalized.mode === "blind") {
                if (!deps.requiresAirpadMessageAuth && !envelopeRequired) {
                    const ok = verifyWithoutDecrypt(normalized.payload);
                    if (!ok) {
                        console.warn(`[Server] Signature verification failed (blind mode) for from=${normalized.from}`);
                        deps.emitError(socket, "Signature verification failed");
                        return;
                    }
                }

                deps.routeMessage(socket, normalized);
                return;
            }

            if (normalized.mode === "inspect") {
                const { from, inner } = parsePayload(normalized.payload);
                console.log(`[Server] INSPECT from=${from} to=${normalized.to} type=${normalized.type} action=${normalized.action} data=<hidden>`);

                if (normalized.type === "clip") {
                    deps.clipHistory.push({
                        from,
                        to: normalized.to,
                        ts: inner?.ts || Date.now(),
                        data: inner?.data ?? null
                    });
                    if (deps.clipHistory.length > deps.maxHistory) deps.clipHistory.shift();
                }

                deps.routeMessage(socket, normalized);
                return;
            }

            console.warn(`[Server] Unknown mode: ${normalized.mode}`);
            deps.emitError(socket, `Unknown mode: ${normalized.mode}`);
        } catch (error: any) {
            console.error(`[Server] Error handling message:`, error);
            deps.emitError(socket, `Error processing message: ${error?.message || String(error)}`);
        }
    };
};

export const requiresAirpadMessageAuth = isAirPadMessageAuthRequired();

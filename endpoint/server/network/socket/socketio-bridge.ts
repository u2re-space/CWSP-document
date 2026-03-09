import type { FastifyInstance } from "fastify";
import { Server as SocketIOServer, type Socket } from "socket.io";
import { randomUUID } from "node:crypto";

import { applySocketIoPrivateNetworkHeaders, buildSocketIoOptions, describeHandshake, isPrivateNetworkCorsEnabled } from "./socketio-security.ts";
import { applyMessageHooks, isBroadcast, normalizeSocketFrame, type SocketMessageHook } from "../stack/messages.ts";
import {
    createAirpadRouter,
    registerAirpadSocketHandlers,
    AirpadClipHistoryEntry,
    describeAirPadConnectionMeta,
    isAirPadAuthorized,
    requiresAirpadMessageAuth,
    createAirpadObjectMessageHandler
} from "../../airpad/index.ts";
import { getAirPadTokenFromSocket } from "../../airpad/airpad.ts";
import { pickEnvBoolLegacy, pickEnvNumberLegacy } from "../../lib/env.ts";
import { parsePortableInteger } from "../../lib/parsing.ts";
import config from "../../config/config.ts";
import { areConnectionTypesCompatible, describeDisplayConnectionType, inferExpectedRemoteConnectionType, parseWsConnectionType, supportsForwardServerConnectionType, toDisplayTopology } from "../stack/connection-types.ts";
import { normalizeEndpointPolicies, resolveEndpointIdPolicyStrict, resolveEndpointTransportPreference } from "../stack/endpoint-policy.ts";
type ClipHistoryEntry = AirpadClipHistoryEntry;

export type SocketIoBridge = {
    addMessageHook: (hook: SocketMessageHook) => void;
    getConnectedDevices: () => string[];
    getConnectionRegistry?: (scope?: string) => Array<{
        id: string;
        direction: string;
        scope: string;
        role: string;
        localRoleSet?: string[];
        transport: "socketio";
        state: string;
        userId: string;
        sourceId: string;
        namespace: string;
        connectionType?: string;
        localConnectionType?: string;
        remoteConnectionType?: string;
        localDisplayConnectionType?: string;
        remoteDisplayConnectionType?: string;
        displayTopology?: string;
        remoteAddress?: string;
        remotePort?: number;
        connectedAt: number;
        alias: string;
    }>;
    getClipboardHistory: (limit?: number) => ClipHistoryEntry[];
    sendToDevice: (userId: string, deviceId: string, payload: any) => boolean;
    requestToDevice?: (userId: string, deviceId: string, payload: any, waitMs?: number) => Promise<any>;
    io: SocketIOServer;
};

type SocketIoBridgeNetworkContext = {
    sendToBridge?: (payload: any) => boolean;
    bridgeUserId?: string;
    sendToReverse?: (userId: string, deviceId: string, payload: any) => boolean;
};

export type SocketIoBridgeOptions = {
    maxHistory?: number;
    networkContext?: SocketIoBridgeNetworkContext;
};

const MAX_HISTORY_DEFAULT = 100;

const sensitiveBridgeKeys = new Set(["text", "body", "payload", "data", "clipboard", "content"]);

const sanitizeBridgeLogValue = (value: unknown): unknown => {
    if (value === null || typeof value === "undefined") return value;
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
        return value.map((entry) => sanitizeBridgeLogValue(entry));
    }
    if (typeof value === "object") {
        const input = value as Record<string, unknown>;
        const output: Record<string, unknown> = {};
        for (const key of Object.keys(input)) {
            if (sensitiveBridgeKeys.has(key.toLowerCase())) {
                const raw = input[key];
                if (typeof raw === "string") {
                    output[key] = raw.length ? `<redacted ${raw.length} chars>` : "";
                } else if (Array.isArray(raw)) {
                    output[key] = raw.map((entry) => (typeof entry === "string" ? (entry.length ? `<redacted ${entry.length} chars>` : "") : sanitizeBridgeLogValue(entry)));
                } else {
                    output[key] = raw === null || typeof raw === "undefined" ? raw : sanitizeBridgeLogValue(raw);
                }
                continue;
            }
            output[key] = sanitizeBridgeLogValue(input[key]);
        }
        return output;
    }
    return value;
};

const formatBridgeSocketLog = (prefix: string, payload: Record<string, unknown>): string => {
    try {
        return `${prefix}\n${JSON.stringify(sanitizeBridgeLogValue(payload), null, 2)}`;
    } catch {
        return `${prefix}\n${String(payload)}`;
    }
};

type SocketIoLogActor = {
    id: string;
    sourceId: string;
    userId: string;
    ip: string;
    token: string;
};

const normalizeSocketIoActorValue = (value: unknown): string => {
    const normalized = String(value || "").trim();
    return normalized || "-";
};

const resolveSocketIoActor = (socket?: Socket): SocketIoLogActor => {
    const sourceId = normalizeSocketIoActorValue((socket as any)?.airpadSourceId || (socket as any)?.userId || socket?.id);
    const userId = normalizeSocketIoActorValue((socket as any)?.userId || sourceId || socket?.id);
    const remoteAddress = (socket as any)?.conn?.remoteAddress || (socket as any)?.handshake?.address;
    const ip = normalizeSocketIoActorValue(typeof remoteAddress === "string" ? remoteAddress : remoteAddress ? String(remoteAddress) : "-");
    return {
        id: normalizeSocketIoActorValue(socket?.id || sourceId),
        sourceId,
        userId,
        ip,
        token: sourceId
    };
};

const logMsg = (prefix: string, msg: any, targetSource = "explicit", sourceSocket?: Socket, targetSocket?: Socket): void => {
    const source = resolveSocketIoActor(sourceSocket);
    const destination = targetSocket ? resolveSocketIoActor(targetSocket) : undefined;
    const targetHint = normalizeSocketIoActorValue(msg?.to);
    const dst = destination || {
        id: targetHint || "-",
        sourceId: targetHint || "-",
        userId: targetHint || "-",
        ip: "-",
        token: targetHint || "-"
    };
    const payloadLen = msg?.payload ? (typeof msg.payload === "string" ? msg.payload.length : JSON.stringify(msg.payload).length) : 0;
    const summary = {
        when: new Date().toISOString(),
        type: msg?.type,
        from: msg?.from,
        fromId: source.id,
        fromIp: source.ip,
        fromToken: source.token,
        to: msg?.to,
        toId: dst.id,
        toIp: dst.ip,
        toToken: dst.token,
        srcId: source.id,
        srcIp: source.ip,
        srcToken: source.token,
        dstId: dst.id,
        dstIp: dst.ip,
        dstToken: dst.token,
        byToken: source.token,
        targetSource,
        mode: msg?.mode || "blind",
        action: msg?.action || "N/A",
        payloadLen,
        kind: typeof msg?.target === "string" ? "string" : typeof msg?.target
    };
    console.log(formatBridgeSocketLog(`[bridge] ${prefix}`, summary));
};
const isTunnelDebug = pickEnvBoolLegacy("CWS_TUNNEL_DEBUG") === true;
const NETWORK_FETCH_TIMEOUT_MS = Math.max(
    500,
    (() => {
        const configured = pickEnvNumberLegacy("CWS_NETWORK_FETCH_TIMEOUT_MS", 15000);
        return parsePortableInteger(configured) ?? 15000;
    })()
);

const mapHookPayload = (hooks: SocketMessageHook[], msg: any, socket: Socket) => applyMessageHooks(hooks, msg, socket);

export const createSocketIoBridge = (app: FastifyInstance, opts: SocketIoBridgeOptions = {}): SocketIoBridge => {
    const maxHistory = opts?.maxHistory ?? MAX_HISTORY_DEFAULT;
    const networkContext = opts.networkContext;
    const endpointPolicyMap = normalizeEndpointPolicies((config as any)?.endpointIDs || {});
    const io = new SocketIOServer(app.server, buildSocketIoOptions(app.log as any));
    const allowPrivateNetwork = isPrivateNetworkCorsEnabled();
    const applyPrivateNetworkHeaders = (headers: Record<string, any>, req: any): void => {
        if (allowPrivateNetwork) applySocketIoPrivateNetworkHeaders(headers as any, req);
    };
    io.engine.on("initial_headers", (headers, req) => {
        applyPrivateNetworkHeaders(headers as any, req);
    });
    io.engine.on("headers", (headers, req) => {
        applyPrivateNetworkHeaders(headers as any, req);
    });
    io.engine.on("connection_error", (err: any) => {
        app.log?.warn?.(
            {
                code: err?.code,
                message: err?.message,
                context: err?.context
            },
            "[socket.io] Engine connection error"
        );
    });

    // AirPad routing state and helpers
    const airpadRouter = createAirpadRouter({
        logger: app.log,
        networkContext,
        isTunnelDebug
    });
    const pendingFetchReplies = new Map<
        string,
        {
            resolve: (value: any) => void;
            reject: (error: any) => void;
            timer?: ReturnType<typeof setTimeout>;
        }
    >();
    const requestToDeviceKey = (userId: string, deviceId: string, requestId: string) => `${userId}:${deviceId}:${requestId}`;
    const normalizeHint = (value: unknown): string => airpadRouter.normalizeHint(value);
    const normalizePolicyTokenLiteral = (value: unknown): string => {
        const raw = normalizeHint(value);
        if (!raw) return "";
        if (raw.startsWith("inline:")) return normalizeHint(raw.slice("inline:".length));
        if (raw.startsWith("token:")) return normalizeHint(raw.slice("token:".length));
        if (raw.startsWith("env:") || raw.startsWith("fs:")) return "";
        return raw;
    };
    const resolvePolicyOriginIps = (target: string): string[] => {
        const normalizedTarget = normalizeHint(target);
        if (!normalizedTarget) return [];
        const policy = resolveEndpointIdPolicyStrict(endpointPolicyMap, normalizedTarget);
        if (!policy) return [];
        const ips = new Set<string>();
        const origins = Array.isArray(policy.origins) ? policy.origins : [];
        for (const rawOrigin of origins) {
            const origin = normalizeHint(String(rawOrigin || "").replace(/:\d+$/, ""));
            if (origin) ips.add(origin);
        }
        return Array.from(ips);
    };
    const resolvePolicyAliases = (target: string): Set<string> => {
        const normalizedTarget = normalizeHint(target);
        const aliases = new Set<string>();
        if (!normalizedTarget) return aliases;
        const policy = resolveEndpointIdPolicyStrict(endpointPolicyMap, normalizedTarget);
        const policyId = normalizeHint(policy?.id || normalizedTarget);
        if (policyId) aliases.add(policyId);
        const origins = Array.isArray(policy?.origins) ? policy.origins : [];
        for (const rawOrigin of origins) {
            const origin = normalizeHint(String(rawOrigin || "").replace(/:\d+$/, ""));
            if (!origin) continue;
            aliases.add(origin);
            aliases.add(`l-${origin}`);
            aliases.add(`h-${origin}`);
            aliases.add(`p-${origin}`);
        }
        return aliases;
    };
    const resolveSocketCandidates = (targetHint: string, frame?: Record<string, unknown>, sourceSocket?: Socket): Array<{ socket: Socket; score: number; reasons: string[] }> => {
        const normalizedTarget = normalizeHint(String(targetHint || "").replace(/:\d+$/, ""));
        if (!normalizedTarget) return [];
        const targetIpHint = normalizeHint(normalizedTarget.replace(/^[hlp]-/, ""));
        const frameTokenHints = new Set<string>([
            normalizeHint((frame as any)?.toToken),
            normalizeHint((frame as any)?.dstToken),
            normalizeHint((frame as any)?.token),
            normalizeHint((frame as any)?.fromToken)
        ].filter(Boolean));
        const sourceToken = sourceSocket ? normalizeHint(getAirPadTokenFromSocket(sourceSocket)) : "";
        if (sourceToken) frameTokenHints.add(sourceToken);

        const strictPolicy = resolveEndpointIdPolicyStrict(endpointPolicyMap, normalizedTarget);
        const policyTokens = new Set<string>(
            (Array.isArray(strictPolicy?.tokens) ? strictPolicy.tokens : [])
                .map((value) => normalizePolicyTokenLiteral(value))
                .filter(Boolean)
        );
        const policyAliases = resolvePolicyAliases(normalizedTarget);
        const policyOriginIps = new Set(resolvePolicyOriginIps(normalizedTarget));
        const targetAliases = new Set<string>([normalizedTarget].filter(Boolean));
        if (targetIpHint) {
            targetAliases.add(targetIpHint);
            targetAliases.add(`l-${targetIpHint}`);
            targetAliases.add(`h-${targetIpHint}`);
            targetAliases.add(`p-${targetIpHint}`);
        }
        for (const alias of policyAliases) targetAliases.add(alias);

        const candidates: Array<{ socket: Socket; score: number; reasons: string[] }> = [];
        for (const socket of io.sockets.sockets.values()) {
            if (!socket?.connected) continue;
            if (sourceSocket && socket.id === sourceSocket.id) continue;
            const meta = airpadRouter.getConnectionMeta(socket);
            const socketToken = normalizeHint(getAirPadTokenFromSocket(socket));
            const remoteAddress = normalizeHint(meta?.remoteAddress || (socket as any)?.conn?.remoteAddress || (socket as any)?.handshake?.address);
            const aliasSet = new Set<string>(
                [
                    normalizeHint(socket.id),
                    normalizeHint((socket as any).airpadSourceId),
                    normalizeHint(meta?.clientId),
                    normalizeHint(meta?.sourceId),
                    normalizeHint(meta?.routeTarget),
                    normalizeHint(meta?.targetHost),
                    normalizeHint(meta?.hostHint)
                ].filter(Boolean)
            );
            const expandedAliasSet = new Set<string>(aliasSet);
            for (const alias of aliasSet) {
                const noPrefix = normalizeHint(alias.replace(/^[hlp]-/, ""));
                if (noPrefix) {
                    expandedAliasSet.add(noPrefix);
                    expandedAliasSet.add(`l-${noPrefix}`);
                    expandedAliasSet.add(`h-${noPrefix}`);
                    expandedAliasSet.add(`p-${noPrefix}`);
                }
            }
            if (remoteAddress) expandedAliasSet.add(remoteAddress);

            let score = 0;
            const reasons: string[] = [];
            const hasDirectAlias = Array.from(targetAliases).some((alias) => expandedAliasSet.has(alias));
            if (hasDirectAlias) {
                score += 100;
                reasons.push("direct-alias");
            }
            if (targetIpHint && remoteAddress && remoteAddress === targetIpHint) {
                score += 70;
                reasons.push("target-ip");
            }
            let hasStrongSignal = hasDirectAlias || reasons.includes("target-ip");
            if (remoteAddress && policyOriginIps.has(remoteAddress)) {
                score += 50;
                reasons.push("policy-origin-ip");
                hasStrongSignal = true;
            }
            if (socketToken && policyTokens.has(socketToken)) {
                score += 35;
                reasons.push("policy-token");
                hasStrongSignal = true;
            }
            if (socketToken && frameTokenHints.has(socketToken) && hasStrongSignal) {
                score += 20;
                reasons.push("frame-token");
            }
            if (score <= 0) continue;
            candidates.push({ socket, score, reasons });
        }

        candidates.sort((a, b) => b.score - a.score);
        if (candidates.length === 0 && frameTokenHints.size > 0) {
            for (const socket of io.sockets.sockets.values()) {
                if (!socket?.connected) continue;
                if (sourceSocket && socket.id === sourceSocket.id) continue;
                const socketToken = normalizeHint(getAirPadTokenFromSocket(socket));
                if (!socketToken || !frameTokenHints.has(socketToken)) continue;
                candidates.push({ socket, score: 10, reasons: ["token-fanout"] });
            }
        }
        const deduped = new Map<string, { socket: Socket; score: number; reasons: string[] }>();
        for (const candidate of candidates) {
            if (!deduped.has(candidate.socket.id)) deduped.set(candidate.socket.id, candidate);
        }
        return Array.from(deduped.values());
    };

    const removeSocketRequestPendings = (userId: string, deviceId: string): void => {
        const normalizedUser = normalizeHint(userId);
        const normalizedDevice = normalizeHint(deviceId);
        for (const key of Array.from(pendingFetchReplies.keys())) {
            if (!normalizedDevice) continue;
            const prefixWithUser = `${normalizedUser}:${normalizedDevice}:`;
            if (normalizedUser && key.startsWith(prefixWithUser)) {
                const pending = pendingFetchReplies.get(key);
                if (pending) {
                    if (pending.timer) clearTimeout(pending.timer);
                    pending.reject(new Error("socket disconnected"));
                }
                pendingFetchReplies.delete(key);
            } else if (!normalizedUser && key.includes(`:${normalizedDevice}:`)) {
                const pending = pendingFetchReplies.get(key);
                if (pending) {
                    if (pending.timer) clearTimeout(pending.timer);
                    pending.reject(new Error("socket disconnected"));
                }
                pendingFetchReplies.delete(key);
            }
        }
    };

    const buildSocketIoBridgePayload = (
        sourceSocket: Socket,
        frame: Record<string, unknown> | null | undefined,
        explicitTarget = "",
        targetSource: "explicit" | "fallback" = "explicit"
    ): Record<string, unknown> | null => {
        if (!frame || typeof frame !== "object") return null;
        const target = normalizeHint(explicitTarget || frame.target || frame.to || frame.deviceId || frame.targetId || frame.target_id || "");
        if (!target) return null;
        const sourceForPolicy = normalizeHint(String(frame.source || frame.from || (sourceSocket as any).airpadSourceId || sourceSocket.id));
        const transportPref = resolveEndpointTransportPreference(sourceForPolicy, target, endpointPolicyMap);
        const supportsBridge = transportPref.transports.includes("ws") || transportPref.transports.includes("socketio");
        if (!supportsBridge) return null;
        const sourceMeta = airpadRouter.getConnectionMeta(sourceSocket);
        const bridgeFrom = normalizeHint(
            sourceMeta?.routeTarget ||
                sourceMeta?.sourceId ||
                (networkContext?.bridgeUserId as string | undefined) ||
                (sourceSocket as any).airpadSourceId ||
                sourceSocket.id
        );
        const bridgeUser = normalizeHint(sourceMeta?.routeTarget) || normalizeHint(sourceMeta?.sourceId) || normalizeHint(networkContext?.bridgeUserId) || sourceSocket.id;
        return {
            ...(frame as Record<string, unknown>),
            type: String((frame as Record<string, unknown>).type || "dispatch"),
            data: (frame as Record<string, unknown>).payload ?? (frame as Record<string, unknown>).data,
            from: bridgeFrom || sourceForPolicy || sourceSocket.id,
            source: bridgeFrom || sourceForPolicy || sourceSocket.id,
            userId: bridgeUser,
            to: target,
            target,
            targetId: target,
            route: "socketio-forward-fallback",
            routeSource: sourceForPolicy || sourceMeta?.sourceId || "",
            routeTarget: target,
            targetSource
        };
    };

    const getHandshakeClientId = (socket: Socket): string | undefined => {
        const handshake: Record<string, unknown> = (socket as any).handshake || {};
        const auth = handshake.auth && typeof handshake.auth === "object" ? (handshake.auth as Record<string, unknown>) : {};
        const query = handshake.query && typeof handshake.query === "object" ? (handshake.query as Record<string, unknown>) : {};
        const raw = typeof auth.clientId === "string" ? auth.clientId : typeof query.clientId === "string" ? query.clientId : typeof query.__airpad_src === "string" ? query.__airpad_src : typeof query.__airpad_source === "string" ? query.__airpad_source : typeof query.src === "string" ? query.src : typeof query.source === "string" ? query.source : typeof query.sourceId === "string" ? query.sourceId : typeof query.peerId === "string" ? query.peerId : "";
        const normalized = normalizeHint(raw);
        return normalized || undefined;
    };

    const getSocketIoRemoteConnectionType = (socket: Socket): { raw: string | undefined; parsed?: ReturnType<typeof parseWsConnectionType> } => {
        const meta = describeAirPadConnectionMeta(socket);
        const raw = (meta as any)?.connectionType || (meta as any)?.archetype;
        const normalized = typeof raw === "string" ? raw.trim() : "";
        if (!normalized) return { raw: undefined };
        return { raw: normalized, parsed: parseWsConnectionType(normalized) };
    };

    const socketConnectionRegistry = new Map<
        string,
        {
            sourceId: string;
            userId: string;
            namespace: string;
            connectionType: string | undefined;
            localConnectionType: string;
            remoteConnectionType: string;
            localDisplayConnectionType?: string;
            remoteDisplayConnectionType?: string;
            displayTopology?: string;
            remoteAddress: string | undefined;
            remotePort: number | undefined;
            connectedAt: number;
        }
    >();

    const buildSocketConnectionTypeLogPayload = (socket: Socket, remoteConnectionType: { raw?: string; parsed?: ReturnType<typeof parseWsConnectionType> }) => {
        const parsed = remoteConnectionType.parsed || inferExpectedRemoteConnectionType(false);
        return {
            socketId: socket.id,
            requestedConnectionType: remoteConnectionType.raw ?? "none",
            transport: socket?.conn?.transport?.name,
            sourceHint: normalizeHint((socket as any)?.airpadSourceId),
            transportAcceptedConnectionType: "responser-initiated",
            remoteDisplayConnectionType: describeDisplayConnectionType(parsed as any),
            transportDisplayTopology: toDisplayTopology("responser-initiated", parsed as any)
        };
    };

    const requestToDevice = async (userId: string, deviceId: string, payload: any, waitMs = NETWORK_FETCH_TIMEOUT_MS) => {
        const normalizedDevice = normalizeHint(deviceId);
        if (!normalizedDevice) return undefined;
        const targetSocket = airpadRouter.getSocket(normalizedDevice) || resolveSocketCandidates(normalizedDevice, payload as Record<string, unknown>)[0]?.socket;
        if (!targetSocket?.connected) return undefined;
        const requestId = String(payload?.requestId || randomUUID()).trim() || randomUUID();
        const envelope = { ...payload, requestId };
        return new Promise<any>((resolve, reject) => {
            const key = requestToDeviceKey(normalizeHint(userId), normalizedDevice, requestId);
            const timeout = parsePortableInteger(waitMs) ?? NETWORK_FETCH_TIMEOUT_MS;
            const timer = setTimeout(
                () => {
                    pendingFetchReplies.delete(key);
                    reject(new Error(`network.fetch timeout: ${requestId}`));
                },
                Math.max(500, timeout)
            );
            pendingFetchReplies.set(key, { resolve, reject, timer });
            try {
                targetSocket.emit("network.fetch", envelope, (response: any) => {
                    const pending = pendingFetchReplies.get(key);
                    if (!pending) return;
                    pendingFetchReplies.delete(key);
                    if (pending.timer) clearTimeout(pending.timer);
                    pending.resolve(response);
                });
            } catch (error) {
                pendingFetchReplies.delete(key);
                if (timer) clearTimeout(timer);
                reject(error);
            }
        });
    };

    // Message history for inspection mode
    const clipHistory: ClipHistoryEntry[] = [];

    // Message hooks for translation/routing
    const messageHooks: SocketMessageHook[] = [];

    const routeMessage = (sourceSocket: Socket, msg: any): void => {
        const hasExplicitTarget = msg && typeof msg === "object" && ("to" in msg || "target" in msg || "targetId" in msg || "target_id" in msg || "deviceId" in msg);
        const routeHint = airpadRouter.getRouteHint(sourceSocket);
        const isEndpoint = airpadRouter.isEndpoint(sourceSocket);
        const normalized = normalizeSocketFrame(msg, sourceSocket.id, {
            nodeId: (sourceSocket as any).userId,
            peerId: sourceSocket.id,
            via: "socketio",
            surface: "external"
        });
        const resolvedTo = airpadRouter.resolveAirpadTarget(sourceSocket, normalized.to, hasExplicitTarget);
        if (resolvedTo) {
            normalized.to = resolvedTo;
            normalized.target = resolvedTo;
        }
        const processed = mapHookPayload(messageHooks, normalized, sourceSocket) as any;
        if (processed === null) {
            console.log(formatBridgeSocketLog("[Router] Message skipped by hook", { socket: sourceSocket.id }));
            return;
        }
        const incomingTargetSource = String((processed as Record<string, any>)?.targetSource || "").trim().toLowerCase() === "fallback" ? "fallback" : "explicit";
        const targetSource = incomingTargetSource === "fallback" ? "fallback" : (hasExplicitTarget ? "explicit" : "fallback");

        const tunnelTargets = airpadRouter.resolveTunnelTargets(sourceSocket, processed);
        if (tunnelTargets.length > 0) {
            if (isTunnelDebug) {
                console.log(
                    formatBridgeSocketLog("[Router] Tunnel route attempt", {
                        socket: sourceSocket.id,
                        from: processed.from,
                        to: processed.to,
                        targets: tunnelTargets.join(","),
                        via: airpadRouter.getRouteHint(sourceSocket) || "?",
                        targetSource
                    })
                );
            }
            if (airpadRouter.forwardToAirpadTargets(sourceSocket, processed, processed)) {
                logMsg("OUT(tunnel)", processed, targetSource, sourceSocket);
                if (isTunnelDebug) {
                    console.log(
                        formatBridgeSocketLog("[Router] OUT(tunnel) forwarded", {
                            socket: sourceSocket.id,
                            target: processed.to,
                            targetSource
                        })
                    );
                }
                return;
            }
            if (airpadRouter.forwardToBridge(sourceSocket, processed)) {
                logMsg("OUT(tunnel-bridge)", processed, "fallback", sourceSocket);
                return;
            }
            const knownTunnelTargets = airpadRouter.getTunnelTargets();
            if (routeHint === "tunnel" || routeHint === "remote") {
                if (isTunnelDebug) {
                    console.warn(
                        formatBridgeSocketLog("[Router] Tunnel target not found; bridge/bridge fallback not enabled for routed socket", {
                            socket: sourceSocket.id,
                            requested: tunnelTargets.join(","),
                            known: knownTunnelTargets.join(","),
                            targetSource
                        })
                    );
                }
                return;
            }
            if (isTunnelDebug) {
                console.warn(
                    formatBridgeSocketLog("[Router] Tunnel target not found", {
                        socket: sourceSocket.id,
                        requested: tunnelTargets.join(","),
                        known: knownTunnelTargets.join(","),
                        targetSource
                    })
                );
            } else {
                console.warn(formatBridgeSocketLog("[Router] Tunnel target not found", { socket: sourceSocket.id, targetSource }));
            }
        }
        if (!isEndpoint) {
            if (isTunnelDebug) {
                console.warn(
                    formatBridgeSocketLog("[Router] Local handling skipped for non-endpoint socket", {
                        socket: sourceSocket.id,
                        from: processed.from,
                        to: processed.to,
                        via: routeHint || "?",
                        targetSource
                    })
                );
            }
            return;
        }

        if (isBroadcast(processed)) {
            sourceSocket.broadcast.emit("message", processed);
            logMsg("OUT(broadcast)", processed, targetSource, sourceSocket);
            
            const userIdForReverse = (sourceSocket as any).userId || "";
            networkContext?.sendToReverse?.(userIdForReverse, "broadcast", processed);
            
            const bridgePayload = buildSocketIoBridgePayload(sourceSocket, processed, "broadcast", targetSource);
            if (bridgePayload) {
                networkContext?.sendToBridge?.(bridgePayload);
            }
            
            return;
        }

        const targetSocket = airpadRouter.getSocket(processed.to);
        const candidateTargets = targetSocket ? [{ socket: targetSocket, score: 100, reasons: ["direct"] }] : resolveSocketCandidates(String(processed.to || ""), processed as Record<string, unknown>, sourceSocket);
        if (candidateTargets.length > 0) {
            let sent = 0;
            for (const candidate of candidateTargets) {
                candidate.socket.emit("message", processed);
                sent += 1;
                logMsg(`OUT(to=${processed.to})`, processed, targetSource, sourceSocket, candidate.socket);
                if (isTunnelDebug) {
                    console.log(
                        formatBridgeSocketLog("[Router] Socket.IO route match", {
                            to: processed.to,
                            socketId: candidate.socket.id,
                            score: candidate.score,
                            reasons: candidate.reasons.join("|") || "-"
                        })
                    );
                }
            }
            if (sent > 0) return;
        }

        const policyTarget = (() => {
            const rawTarget = normalizeHint(processed.to);
            const strictPolicy = resolveEndpointIdPolicyStrict(endpointPolicyMap, rawTarget);
            return normalizeHint(strictPolicy?.id || rawTarget);
        })();
        if (policyTarget && policyTarget !== normalizeHint(processed.to)) {
            const policyCandidates = resolveSocketCandidates(policyTarget, processed as Record<string, unknown>, sourceSocket);
            if (policyCandidates.length > 0) {
                for (const candidate of policyCandidates) {
                    candidate.socket.emit("message", { ...processed, to: policyTarget, target: policyTarget, targetId: policyTarget });
                    logMsg(`OUT(to=${policyTarget})`, { ...processed, to: policyTarget }, targetSource, sourceSocket, candidate.socket);
                }
                return;
            }
        }
        
        const userIdForReverse = (sourceSocket as any).userId || "";
        if (networkContext?.sendToReverse?.(userIdForReverse, String(processed.to || ""), processed) === true) {
            logMsg(`OUT(wsHub to=${processed.to})`, processed, targetSource, sourceSocket);
            return;
        }

        const bridgePayload = buildSocketIoBridgePayload(sourceSocket, processed, String(processed.to || ""), targetSource);
        if (bridgePayload && networkContext?.sendToBridge?.(bridgePayload) === true) {
            logMsg(`OUT(socketio-bridge to=${processed.to})`, processed, targetSource, sourceSocket);
            if (isTunnelDebug) {
                console.log(
                    formatBridgeSocketLog("[Router] OUT(socketio-bridge)", {
                        socket: sourceSocket.id,
                        target: processed.to,
                        targetSource
                    })
                );
            }
            return;
        }
        if (!bridgePayload && isTunnelDebug) {
            console.log(
                formatBridgeSocketLog("[Router] Socket.IO bridge payload skipped", {
                    socket: sourceSocket.id,
                    target: processed.to,
                    targetSource,
                    policyTransports:
                        resolveEndpointTransportPreference(targetSource === "explicit" ? String(processed.from || sourceSocket.id) : String(sourceSocket.id), String(processed.to || ""), endpointPolicyMap).transports.join("|") || "none"
                })
            );
        }
        console.warn(
            formatBridgeSocketLog("[Router] No target client for deviceId", {
                deviceId: processed.to,
                targetSource
            })
        );
    };

    const multicastMessage = (sourceSocket: Socket, msg: any, deviceIds?: string[]): void => {
        const normalized = normalizeSocketFrame(msg, sourceSocket.id, {
            nodeId: (sourceSocket as any).userId,
            peerId: sourceSocket.id,
            via: "socketio",
            surface: "external"
        });
        const processed = mapHookPayload(messageHooks, normalized, sourceSocket) as any;
        if (processed === null) return;

        if (!deviceIds || deviceIds.length === 0) {
            sourceSocket.broadcast.emit("message", processed);
            logMsg("OUT(multicast-all)", processed, "explicit", sourceSocket);
            
            const userIdForReverse = (sourceSocket as any).userId || "";
            networkContext?.sendToReverse?.(userIdForReverse, "broadcast", processed);
            
            const bridgePayload = buildSocketIoBridgePayload(sourceSocket, processed, "broadcast", "explicit");
            if (bridgePayload) {
                networkContext?.sendToBridge?.(bridgePayload);
            }
            return;
        }

        let sentCount = 0;
        for (const deviceId of deviceIds) {
            const targetSocket = airpadRouter.getSocket(deviceId);
            if (targetSocket && targetSocket !== sourceSocket) {
                targetSocket.emit("message", processed);
                sentCount++;
            }
        }
        logMsg(`OUT(multicast-${sentCount})`, processed, sentCount > 0 ? "explicit" : "fallback", sourceSocket);
    };

    io.on("connection", (socket: Socket) => {
        let deviceId: string | null = null;

        if (!isAirPadAuthorized(socket)) {
            console.warn(`[Server] AirPad socket rejected due to missing/invalid token`);
            socket.emit("error", { message: "Unauthorized AirPad token" });
            socket.disconnect(true);
            return;
        }
        const connectionMeta = describeAirPadConnectionMeta(socket);
        const remoteConnectionType = getSocketIoRemoteConnectionType(socket);
        const localConnectionType: "responser-initiated" = "responser-initiated";
        const expectedRemoteConnectionType = inferExpectedRemoteConnectionType(false);
        const supportsLocalForwardServer = supportsForwardServerConnectionType((config as any)?.roles);
        if (!supportsLocalForwardServer) {
            console.warn(`[Server] AirPad socket rejected: responser-initiated role is disabled`, buildSocketConnectionTypeLogPayload(socket, remoteConnectionType));
            socket.emit("error", { message: "Server role mismatch for Socket.IO clients" });
            socket.disconnect(true);
            return;
        }
        if (remoteConnectionType.raw && remoteConnectionType.parsed == null) {
            console.warn(`[Server] AirPad socket rejected: invalid connectionType`, buildSocketConnectionTypeLogPayload(socket, remoteConnectionType));
            socket.emit("error", { message: `Invalid AirPad connectionType: ${remoteConnectionType.raw}` });
            socket.disconnect(true);
            return;
        }
        if (!areConnectionTypesCompatible(localConnectionType, remoteConnectionType.parsed || expectedRemoteConnectionType)) {
            console.warn(`[Server] AirPad socket rejected: incompatible connectionType`, buildSocketConnectionTypeLogPayload(socket, remoteConnectionType));
            socket.emit("error", {
                message: `Incompatible connection types: local=${localConnectionType}, remote=${remoteConnectionType.parsed || expectedRemoteConnectionType}`
            });
            socket.disconnect(true);
            return;
        }
        
        let activeConnectionType = remoteConnectionType.parsed || expectedRemoteConnectionType;
        if (activeConnectionType === "first-order") {
            activeConnectionType = localConnectionType === "requestor-initiated" ? "responser-initiator" : "requestor-initiator";
            console.log(`[Server] AirPad socket accepted first-order connection, acting as ${activeConnectionType}`);
        }
        const resolvedLocalConnectionType = localConnectionType;
        const resolvedRemoteConnectionType = activeConnectionType;
        
        const sourceAlias = normalizeHint(connectionMeta.sourceId);
        if (sourceAlias) {
            (socket as any).airpadSourceId = sourceAlias;
        }
        if (!sourceAlias) {
            (socket as any).airpadSourceId = normalizeHint(connectionMeta.clientId);
        }
        const connectionSourceId = normalizeHint((socket as any).airpadSourceId);
        const now = Date.now();
        socketConnectionRegistry.set(socket.id, {
            sourceId: connectionSourceId,
            userId: connectionSourceId || normalizeHint(connectionMeta.clientId) || socket.id,
            namespace: normalizeHint(connectionMeta.routeTarget) || normalizeHint(connectionMeta.targetHost) || connectionSourceId || normalizeHint(connectionMeta.clientId) || socket.id,
            connectionType: connectionMeta.connectionType || activeConnectionType || undefined,
            localConnectionType: resolvedLocalConnectionType,
            remoteConnectionType: resolvedRemoteConnectionType,
            localDisplayConnectionType: describeDisplayConnectionType(resolvedLocalConnectionType as any),
            remoteDisplayConnectionType: describeDisplayConnectionType(resolvedRemoteConnectionType as any),
            displayTopology: toDisplayTopology(resolvedLocalConnectionType as any, resolvedRemoteConnectionType as any),
            remoteAddress: normalizeHint(connectionMeta.remoteAddress),
            remotePort: connectionMeta.remotePort,
            connectedAt: now
        });
        airpadRouter.registerConnection(socket, connectionMeta);
        const isEndpoint = airpadRouter.isEndpoint(socket);

        app.log?.info?.(
            {
                socketId: socket.id,
                transport: socket?.conn?.transport?.name,
                handshake: {
                    ...describeHandshake(socket.request),
                    ...describeAirPadConnectionMeta(socket)
                }
            },
            "[socket.io] New connection"
        );

        socket.on("hello", (data: any) => {
            const handshakeClientId = getHandshakeClientId(socket);
            deviceId = normalizeHint(data?.id as string) || handshakeClientId || sourceAlias || socket.id;
            airpadRouter.registerAlias(socket, deviceId);
            if (deviceId) {
                airpadRouter.registerTunnelAlias(socket, deviceId);
            }
            console.log(`[Server] HELLO from ${deviceId}, socket.id=${socket.id}`);
            socket.emit("hello-ack", { id: deviceId, status: "connected" });
            socket.broadcast.emit("device-connected", { id: deviceId });
        });

        const onObjectMessage = createAirpadObjectMessageHandler(socket, {
            routeMessage,
            requiresAirpadMessageAuth,
            getSourceId: (targetSocket) => deviceId || normalizeHint((targetSocket as any).airpadSourceId) || targetSocket.id,
            clipHistory,
            maxHistory,
            logMsg,
            emitError: (targetSocket, message) => {
                targetSocket.emit("error", { message });
            }
        });

        registerAirpadSocketHandlers(socket, {
            logger: app.log,
            allowLocalInput: isEndpoint,
            onObjectMessage,
            onBinaryMessage: async (raw: any, sourceSocket) => {
                const isEndpoint = airpadRouter.isEndpoint(sourceSocket);
                if (!(raw instanceof Uint8Array) && !Buffer.isBuffer(raw) && !(raw instanceof ArrayBuffer)) {
                    if (isTunnelDebug) {
                    console.log(
                        formatBridgeSocketLog("[Router] Binary tunnel skipped: unsupported payload type", {
                            socket: sourceSocket.id,
                            type: typeof raw
                        })
                    );
                    }
                    return false;
                }
                const tunnelTargets = airpadRouter.resolveTunnelTargets(sourceSocket, { to: "broadcast" });
                if (!tunnelTargets.length) {
                    if (!isEndpoint) {
                        if (isTunnelDebug) {
                        console.log(
                            formatBridgeSocketLog("[Router] Binary local handling skipped for non-endpoint socket", {
                                socket: sourceSocket.id,
                                via: airpadRouter.getRouteHint(sourceSocket) || "?"
                            })
                        );
                        }
                        return false;
                    }
                    if (isTunnelDebug) {
                    console.log(
                        formatBridgeSocketLog("[Router] Binary tunnel target unavailable", {
                            socket: sourceSocket.id,
                            via: airpadRouter.getRouteHint(sourceSocket) || "?"
                        })
                    );
                    }
                    return false;
                }
                for (const target of tunnelTargets) {
                    const targetDelivered = airpadRouter.forwardToAirpadTargets(sourceSocket, raw, { to: target, type: "binary" });
                    if (targetDelivered) {
                        if (isTunnelDebug) {
                        console.log(
                            formatBridgeSocketLog("[Router] OUT(tunnel-binary)", {
                                socket: sourceSocket.id,
                                target,
                                targetSource: "explicit"
                            })
                        );
                        }
                        return true;
                    }
                    if (airpadRouter.forwardBinaryToBridge(sourceSocket, raw, target)) {
                        if (isTunnelDebug) {
                        console.log(
                            formatBridgeSocketLog("[Router] OUT(tunnel-bridge-binary)", {
                                socket: sourceSocket.id,
                                target,
                                targetSource: "fallback"
                            })
                        );
                        }
                        return true;
                    }
                    if (airpadRouter.forwardBinaryToBridge(sourceSocket, raw, target)) {
                    if (isTunnelDebug) {
                        console.log(
                            formatBridgeSocketLog("[Router] OUT(tunnel-binary-bridge)", {
                                socket: sourceSocket.id,
                                target,
                                targetSource: "explicit"
                            })
                        );
                    }
                        return true;
                    }
                }
                if (isTunnelDebug) {
                    const knownTunnelTargets = airpadRouter.getTunnelTargets().filter((key) => key);
                console.log(
                    formatBridgeSocketLog("[Router] Binary tunnel attempt", {
                        socket: sourceSocket.id,
                        forwarded: false,
                        target: tunnelTargets.join("|"),
                        known: knownTunnelTargets.join(",")
                    })
                );
                }
                if (isTunnelDebug) {
                    const bridgeEnabled = networkContext?.sendToBridge instanceof Function;
                console.warn(
                    formatBridgeSocketLog("[Router] Binary tunnel target not found", {
                        socket: sourceSocket.id,
                        target: tunnelTargets.join("|"),
                        bridgeEnabled,
                        targetSource: "explicit"
                    })
                );
                    if (!bridgeEnabled) {
                    console.warn(
                        formatBridgeSocketLog("[Router] Binary tunnel dropped", {
                            reason: "no bridge connector available",
                            socket: sourceSocket.id,
                            via: airpadRouter.getRouteHint(sourceSocket) || "?"
                        })
                    );
                    }
                }
                if (!isTunnelDebug) {
                    console.warn(formatBridgeSocketLog("[Router] Binary tunnel target not found", { socket: sourceSocket.id, targetSource: "explicit" }));
                }
                return false;
            },
            onDisconnect: (reason) => {
                console.log(`[Server] Disconnected: ${deviceId || socket.id}, reason: ${reason}`);
                airpadRouter.unregisterConnection(socket);
                socketConnectionRegistry.delete(socket.id);
                const currentDeviceId = normalizeHint(deviceId);
                removeSocketRequestPendings("", currentDeviceId);
                if (deviceId && airpadRouter.getSocket(deviceId) === socket) {
                    socket.broadcast.emit("device-disconnected", { id: deviceId });
                }
            }
        });

        socket.on("network.fetch", (request: any, ack?: (value: any) => void) => {
            const userId = normalizeHint(request?.userId || "");
            const deviceId = normalizeHint(request?.to || request?.deviceId || request?.target || "");
            const requestId = normalizeHint(String(request?.requestId || ""));
            if (!request || typeof request !== "object" || !requestId || !deviceId) return;

            let pending = pendingFetchReplies.get(requestToDeviceKey(userId, deviceId, requestId));
            if (!pending) {
                const fallbackKeySuffix = `:${deviceId}:${requestId}`;
                for (const [pendingKey, pendingValue] of pendingFetchReplies.entries()) {
                    if (pendingKey.endsWith(fallbackKeySuffix)) {
                        pending = pendingValue;
                        pendingFetchReplies.delete(pendingKey);
                        break;
                    }
                }
            } else {
                pendingFetchReplies.delete(requestToDeviceKey(userId, deviceId, requestId));
            }
            if (!pending) return;
            if (pending.timer) clearTimeout(pending.timer);
            pending.resolve(request);
            if (typeof ack === "function") {
                ack({ ok: true, requestId: String(request?.requestId || ""), status: 200 });
            }
        });

        socket.on("multicast", (data: { message: any; deviceIds?: string[] }) => {
            if (!data?.message) {
                socket.emit("error", { message: "Invalid multicast request" });
                return;
            }
            multicastMessage(socket, data.message, data.deviceIds);
        });

        socket.on("error", (error: Error) => {
            app.log?.error?.(
                {
                    socketId: deviceId || socket.id,
                    message: error?.message,
                    stack: (error as any)?.stack
                },
                "[socket.io] Socket error"
            );
        });
    });

    const getConnectionRegistry = (): Array<{
        id: string;
        direction: string;
        scope: string;
        role: string;
        transport: "socketio";
        state: string;
        userId: string;
        sourceId: string;
        namespace: string;
        connectionType?: string;
        localConnectionType?: string;
        remoteConnectionType?: string;
        localDisplayConnectionType?: string;
        remoteDisplayConnectionType?: string;
        displayTopology?: string;
        localRoleSet?: string[];
        remoteAddress?: string;
        remotePort?: number;
        connectedAt: number;
        alias: string;
    }> => {
        const rows: Array<{
            id: string;
            direction: string;
            scope: string;
            role: string;
            transport: "socketio";
            state: string;
            userId: string;
            sourceId: string;
            namespace: string;
            connectionType?: string;
            localConnectionType?: string;
            remoteConnectionType?: string;
        localDisplayConnectionType?: string;
        remoteDisplayConnectionType?: string;
        displayTopology?: string;
            remoteAddress?: string;
            remotePort?: number;
            connectedAt: number;
            alias: string;
            localRoleSet?: string[];
        }> = [];
        for (const [socketId, state] of socketConnectionRegistry) {
            const socket = io.sockets.sockets.get(socketId);
            if (!socket?.connected) continue;
            const isEndpointSocket = airpadRouter.isEndpoint(socket);
            const meta = airpadRouter.getConnectionMeta(socket);
            const userId = state.userId || state.sourceId || socket.id;
            rows.push({
                id: socketId,
                direction: "to-server",
                scope: "socketio",
                role: isEndpointSocket ? "airpad-endpoint" : "airpad-client",
                transport: "socketio",
                state: "connected",
                userId,
                sourceId: state.sourceId || userId,
                namespace: state.namespace || "",
                connectionType: state.connectionType || meta?.connectionType || undefined,
                localConnectionType: state.localConnectionType,
                remoteConnectionType: state.remoteConnectionType,
                localDisplayConnectionType: state.localDisplayConnectionType,
                remoteDisplayConnectionType: state.remoteDisplayConnectionType,
                displayTopology: state.displayTopology,
                localRoleSet: [state.localConnectionType, state.remoteConnectionType, state.connectionType].filter(Boolean) as string[],
                remoteAddress: state.remoteAddress,
                remotePort: state.remotePort,
                connectedAt: state.connectedAt,
                alias: state.sourceId || state.userId || socket.id
            });
        }
        return rows;
    };

    // Minimal debug endpoints (optional but handy)
    app.get("/core/bridge/devices", async () => {
        const tunnelTargets = airpadRouter.getTunnelTargets().filter(Boolean);
        const devices = airpadRouter.getDebugDevices();
        return {
            ok: true,
            bridgeConnected: networkContext?.sendToBridge != null,
            bridgeUserId: networkContext?.bridgeUserId,
            connectedCount: devices.length,
            devices,
            tunnelTargets
        };
    });
    app.get("/core/bridge/history", async (req: any) => {
        const limit = Math.max(1, Math.min(500, parsePortableInteger(req?.query?.limit) ?? maxHistory));
        return { ok: true, limit, entries: clipHistory.slice(-limit) };
    });

    return {
        io,
        addMessageHook: (hook) => messageHooks.push(hook),
        getConnectedDevices: () => airpadRouter.getConnectedDevices(),
        getConnectionRegistry,
        getClipboardHistory: (limit = maxHistory) => clipHistory.slice(-limit),
        sendToDevice: (userId: string, deviceId: string, payload: any) => {
            const normalizedDevice = normalizeHint(deviceId);
            if (!normalizedDevice) return false;
            if (airpadRouter.sendToDevice(userId, normalizedDevice, payload)) return true;
            const matches = resolveSocketCandidates(normalizedDevice, payload as Record<string, unknown>);
            let sent = false;
            for (const match of matches) {
                try {
                    match.socket.emit("message", payload);
                    sent = true;
                } catch {
                    // no-op
                }
            }
            return sent;
        },
        requestToDevice
    };
};

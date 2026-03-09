import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { SocketIoBridge } from "../network/socket/socketio-bridge.ts";

import { loadUserSettings, verifyUser } from "../lib/users.ts";
import type { WsHub } from "./websocket.ts";
import { executeActions, executeCopyHotkey, executeCutHotkey, executePasteHotkey } from "./actions.ts";
import { readClipboard, writeClipboard } from "./clipboard.ts";
import { Settings } from "@rs-server/lib/config.ts";
import config from "../config/config.ts";
import { inferNetworkSurface, normalizeNetworkAliasMap, makeTargetTokenSet, resolveNetworkAlias, resolveDispatchAudience, resolveDispatchPlan, resolvePeerIdentity, type PeerIdentityInput, type DispatchRouteDecision } from "../network/index.ts";
import { resolveEndpointForwardTarget, resolveEndpointPolicyRoute, resolveEndpointIdPolicyStrict, resolveEndpointTransportPreference, type EndpointIdPolicyMap, type EndpointTransportPreference, normalizeEndpointPolicies } from "../network/stack/endpoint-policy.ts";
import { pickEnvBoolLegacy } from "../lib/env.ts";
import { parsePortableBoolean, parsePortableInteger, safeParseBoolean } from "../lib/parsing.ts";

type HttpDispatchRequest = {
    url?: string;
    ip?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    unencrypted?: boolean;
    deviceId?: string;
    targetId?: string;
    type?: string;
    data?: any;
    broadcastForceHttps?: boolean;
};
type HttpDispatchBody = {
    userId?: string;
    userKey?: string;
    clientId?: string;
    token?: string;
    text?: string;
    targetDeviceId?: string;
    targets?: string[];
    requests?: HttpDispatchRequest[];
    addresses?: Array<string | HttpDispatchRequest>;
    urls?: string[];
    ips?: string[];
};
type HttpRequestBody = {
    userId: string;
    userKey: string;
    targetId?: string;
    targetDeviceId?: string;
    url?: string;
    ip?: string;
    address?: string;
    host?: string;
    protocol?: "http" | "https";
    secure?: boolean;
    https?: boolean;
    port?: number;
    path?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    unencrypted?: boolean;
    type?: string;
    data?: any;
    namespace?: string;
    broadcastForceHttps?: boolean;
};
type DeviceFeatureRequestBody = HttpRequestBody & {
    text?: string;
    limit?: number;
    targets?: string[];
    query?: string;
};
type WsSendBody = { userId: string; userKey: string; namespace?: string; type?: string; data?: any };
type ReverseSendBody = {
    userId: string;
    userKey: string;
    deviceId: string;
    type?: string;
    data?: any;
    action?: string;
};
type ActionBody = {
    userId: string;
    userKey: string;
    type?: string;
    action?: string;
    data?: any;
    text?: string;
    actions?: any[];
    namespace?: string;
};

type BridgeTopologyStatus = {
    running: boolean;
    connected: boolean;
    bridgeEnabled: boolean;
    bridgeRole?: "active-connector" | "passive-connector" | "gateway-origin";
    endpointUrl?: string;
    userId?: string;
    deviceId?: string;
    namespace?: string;
    bridgeMode?: "active" | "passive";
    bridgeClientId?: string;
    bridgePeerId?: string;
    surface?: string;
    origin?: {
        originId?: string;
        originHosts?: string[];
        originDomains?: string[];
        originMasks?: string[];
        surface?: string;
    };
};

type NetworkContextProvider = {
    getBridgeStatus?: () => BridgeTopologyStatus | null;
    sendToBridge?: (payload: any) => boolean;
    getNodeId?: () => string | null;
};

type NetworkDispatchBody = {
    userId: string;
    userKey: string;
    route?: "auto" | "local" | "bridge" | "both";
    target?: string;
    targetId?: string;
    deviceId?: string;
    peerId?: string;
    namespace?: string;
    ns?: string;
    type?: string;
    action?: string;
    data?: any;
    payload?: any;
    broadcast?: boolean;
    targets?: string[];
};
type NetworkFetchBody = {
    userId: string;
    userKey: string;
    route?: "auto" | "local" | "bridge" | "both";
    target?: string;
    targetId?: string;
    deviceId?: string;
    peerId?: string;
    namespace?: string;
    ns?: string;
    method?: string;
    url?: string;
    headers?: Record<string, string>;
    data?: any;
    payload?: any;
    body?: string;
    timeoutMs?: number;
};

const BROADCAST_HTTPS_PORTS = new Set(["443", "8443"]);
const BROADCAST_PROTO_RE = /^https?:\/\//i;
const isTunnelDebug = pickEnvBoolLegacy("CWS_TUNNEL_DEBUG") === true;
let resolvePeerIdentityHub: WsHub | null = null;

const hasProtocol = (value: string): boolean => BROADCAST_PROTO_RE.test(value);

const looksLikeAliasedHostTarget = (value: string): boolean => {
    const trimmed = value.trim();
    if (!trimmed) return false;

    if (/^\[[^\]]+\](?::\d{1,5})?$/.test(trimmed)) return true;
    if (/^\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?$/.test(trimmed)) return true;
    if (/^[a-zA-Z0-9._-]+(?::\d{1,5})?$/.test(trimmed)) return true;
    return false;
};
const NETWORK_ALIAS_MAP = normalizeNetworkAliasMap((config as any)?.networkAliases || {});
const endpointPolicyMap: EndpointIdPolicyMap = normalizeEndpointPolicies((config as any)?.endpointIDs || (config as any)?.core?.endpointIDs || {});
const DEFAULT_NETWORK_FETCH_TIMEOUT_MS = 15000;

const resolveDispatchTarget = (input: string): string => {
    const trimmed = input.trim();
    if (!trimmed) return "";
    const withPrefixStripped = stripAliasPrefix(trimmed);
    return resolveNetworkAlias(NETWORK_ALIAS_MAP, withPrefixStripped) || withPrefixStripped;
};

const resolveEndpointRouteTarget = (rawTarget: string, sourceId: string): string => {
    return resolveEndpointForwardTarget(rawTarget, sourceId, endpointPolicyMap);
};

const checkEndpointRoutePermission = (sourceId: string, targetId: string) => {
    if (!targetId) return { allowed: true, reason: "no-target" };
    if (!sourceId) return { allowed: true, reason: "no-source" };
    return resolveEndpointPolicyRoute(sourceId, targetId, endpointPolicyMap);
};

type RouteSourceResolution = {
    sourceId: string;
    sourceHint?: string;
    isKnown: boolean;
};

const resolveRouteSourceId = (sourceHint: string | undefined, fallbackUserId?: string): RouteSourceResolution => {
    const fallback = (fallbackUserId || "").trim().toLowerCase();
    if (!sourceHint || !sourceHint.trim()) return { sourceId: fallback, isKnown: true };

    const trimmedHint = sourceHint.trim();
    const lowerHint = trimmedHint.toLowerCase();
    const policyResolved = resolveEndpointRouteTarget(trimmedHint, trimmedHint);
    const peerIdentityResolved = resolveNetworkTargetWithPeerIdentity(trimmedHint, fallbackUserId);
    const sourceId = (policyResolved || peerIdentityResolved || trimmedHint).trim().toLowerCase();
    const strictPolicy = resolveEndpointIdPolicyStrict(endpointPolicyMap, lowerHint) || (sourceId ? resolveEndpointIdPolicyStrict(endpointPolicyMap, sourceId) : undefined);
    const isKnown = strictPolicy != null || sourceId === fallback;
    return {
        sourceId,
        sourceHint: trimmedHint,
        isKnown
    };
};

const extractRoutingSourceId = (body: Record<string, any> | undefined, fallbackUserId?: string): RouteSourceResolution => {
    if (!body) return { sourceId: (fallbackUserId || "").trim().toLowerCase(), isKnown: true };
    const sourceHint = body.from || body.source || body.sourceId || body.src || body.suggestedSource || body.routeSource || body._routeSource;
    return resolveRouteSourceId(typeof sourceHint === "string" ? sourceHint : undefined, fallbackUserId);
};

const resolveDispatchIdentity = (body: { userId?: string; userKey?: string; clientId?: string; token?: string }) => {
    return {
        userId: (body.userId || body.clientId || "").trim(),
        userKey: (body.userKey || body.token || "").trim()
    };
};

const isRouteDebugLoggingEnabled = (): boolean => {
    return pickEnvBoolLegacy("CWS_TUNNEL_DEBUG") === true;
};

const normalizeRouteText = (value: unknown): string => {
    if (typeof value !== "string") return "";
    return value.trim().toLowerCase();
};

const resolveRouteTokenFromPayload = (payload: any): string => {
    if (!payload || typeof payload !== "object") return "";
    if (typeof payload.userKey === "string" && payload.userKey.trim()) return payload.userKey.trim().toLowerCase();
    if (typeof payload.token === "string" && payload.token.trim()) return payload.token.trim().toLowerCase();
    if (typeof payload.clientKey === "string" && payload.clientKey.trim()) return payload.clientKey.trim().toLowerCase();
    if (typeof payload.accessToken === "string" && payload.accessToken.trim()) return payload.accessToken.trim().toLowerCase();
    if (typeof payload.authorization === "string" && payload.authorization.trim()) {
        const match = payload.authorization.match(/^bearer\s+(.+)$/i);
        return (match?.[1] || payload.authorization).trim().toLowerCase();
    }
    return "";
};

const resolveRouteSourceFromPayload = (payload: any): string => {
    if (!payload || typeof payload !== "object") return "";
    const sourceValue = payload.from || payload.source || payload.sourceId || payload.src || payload.suggestedSource || payload.routeSource || payload._routeSource;
    return normalizeRouteText(sourceValue);
};

const logDispatchRoute = (prefix: string, payload: Record<string, any>): void => {
    if (!isRouteDebugLoggingEnabled()) return;
    try {
        console.log(`[route] ${prefix}\n${JSON.stringify(payload, null, 2)}`);
    } catch {
        console.log(`[route] ${prefix}`, payload);
    }
};

const ensureKnownRoutingSource = (routeSource: RouteSourceResolution): { allowed: boolean; reason: string } => {
    if (routeSource.sourceHint && !routeSource.isKnown) {
        return { allowed: false, reason: "unknown source identity" };
    }
    return { allowed: true, reason: "" };
};

type EndpointDeliveryCandidates = {
    direct: string[];
    fallback: string[];
    ordered: string[];
    policy?: EndpointIdPolicyMap[keyof EndpointIdPolicyMap];
};

const normalizeDeliveryTarget = (value: string): string =>
    String(value || "")
        .trim()
        .toLowerCase();
const appendDeliveryTarget = (target: string, seen: Set<string>) => {
    const normalized = normalizeDeliveryTarget(target);
    if (!normalized) return;
    seen.add(normalized);
};
const collectDeliveryTargets = (values: string[] | undefined, userId: string, targetSet: Set<string>) => {
    if (!Array.isArray(values)) return;
    for (const entry of values) {
        const normalized = normalizeDeliveryTarget(entry);
        if (!normalized) continue;
        const resolved = resolveNetworkTargetWithPeerIdentity(normalized, userId);
        if (resolved && normalizeDeliveryTarget(resolved)) {
            appendDeliveryTarget(resolved, targetSet);
            continue;
        }
        appendDeliveryTarget(normalized, targetSet);
    }
};

const resolveEndpointDeliveryTargets = (rawTarget: string, userId: string): EndpointDeliveryCandidates => {
    const normalizedTarget = normalizeDeliveryTarget(rawTarget);
    if (!normalizedTarget) return { direct: [], fallback: [], ordered: [] };
    const strictPolicy = resolveEndpointIdPolicyStrict(endpointPolicyMap, normalizedTarget);
    if (!strictPolicy) return { direct: [], fallback: [], ordered: [normalizedTarget], policy: undefined };

    const directEnabled = strictPolicy.flags?.direct !== false;
    const direct = new Set<string>();
    if (directEnabled) {
        collectDeliveryTargets(strictPolicy.origins, userId, direct);
    }

    const fallback = new Set<string>();
    collectDeliveryTargets(strictPolicy.tokens, userId, fallback);
    appendDeliveryTarget(strictPolicy.id || normalizedTarget, fallback);
    appendDeliveryTarget(normalizedTarget, fallback);
    const directList = Array.from(direct);
    const fallbackList = Array.from(fallback).filter((entry) => !direct.has(entry));
    const ordered = directList.length ? [...directList, ...fallbackList] : [...fallbackList, ...directList];
    return {
        policy: strictPolicy,
        direct: directList,
        fallback: fallbackList,
        ordered
    };
};

const sendToTargetsWithFallback = async (
    userId: string,
    targetHint: string,
    payload: any,
    options?: { waitMs?: number; mode?: "request" | "dispatch" },
    bridges?: {
        wsHub: WsHub;
        socketIoBridge?: Pick<SocketIoBridge, "requestToDevice" | "sendToDevice">;
        networkContext?: {
            sendToBridge?: (payload: any) => boolean;
            getNodeId?: () => string | null | undefined;
        };
    }
): Promise<{
    delivered: boolean;
    responses: any[];
    attemptedTargets: string[];
}> => {
    const deliveryPlan = resolveEndpointDeliveryTargets(targetHint, userId);
    const orderedTargets = deliveryPlan.ordered;
    const responses: any[] = [];
    const attemptedTargets: string[] = [];
    if (!orderedTargets.length) return { delivered: false, responses, attemptedTargets };

    const isRequestMode = options?.mode === "request";
    const sourceHint = typeof payload?.from === "string" && payload.from.trim()
        ? payload.from.trim()
        : typeof payload?.source === "string" && payload.source.trim()
            ? payload.source.trim()
            : userId;
    const routeSource = resolveRouteSourceFromPayload(payload) || normalizeRouteText(sourceHint);
    const routeToken = resolveRouteTokenFromPayload(payload);
    const bridgeSenderId = typeof bridges?.networkContext?.getNodeId === "function" ? (bridges.networkContext.getNodeId() || "").trim() : "";
    const bridgeFrom = bridgeSenderId || sourceHint || userId;
    const routeTraceBase = {
        mode: isRequestMode ? "request" : "dispatch",
        userId,
        sourceHint,
        routeSource: routeSource || sourceHint,
        token: routeToken || "-",
        targetHint: targetHint?.trim() || "",
        bridgeFrom,
        orderedTargets: deliveryPlan.ordered.join("|") || "none",
        directTargets: deliveryPlan.direct.join("|") || "none"
    };
    logDispatchRoute("route-plan", routeTraceBase);
    const attemptBridgeDelivery = async (target: string, deliveryPayload: any): Promise<boolean> => {
        const sendToBridge = bridges?.networkContext?.sendToBridge;
        if (!sendToBridge) return false;
        const preference = getTransportPreference(target);
        const hasRelationRestriction = preference.hasExplicitRelation;
        const hasMessageTransport =
            preference.transports.includes("ws") ||
            preference.transports.includes("socketio") ||
            preference.transports.includes("tcp");
        if (hasRelationRestriction && !hasMessageTransport) return false;
        logDispatchRoute("attempt", {
            action: "bridge-fallback",
            userId,
            sourceHint,
            routeSource,
            token: routeToken || "-",
            target,
            transport: "bridge",
            allowedTransports: preference.transports.join("|") || "none"
        });
        const bridgePayload =
            deliveryPayload && typeof deliveryPayload === "object" && !Array.isArray(deliveryPayload)
                ? { ...deliveryPayload } as Record<string, any>
                : { type: "dispatch", data: deliveryPayload };
        if (!bridgePayload.type && !bridgePayload.action) bridgePayload.type = "dispatch";
        if (!bridgePayload.from) bridgePayload.from = bridgeFrom;
        if (!bridgePayload.source) bridgePayload.source = bridgeFrom;
        if (!bridgePayload.to) bridgePayload.to = target;
        if (!bridgePayload.target) bridgePayload.target = target;
        if (!bridgePayload.targetId) bridgePayload.targetId = target;
        if (!bridgePayload.userId) bridgePayload.userId = bridgeSenderId || userId;
        if (!bridgePayload.route) bridgePayload.route = "bridge-fallback";
        try {
            const delivered = !!sendToBridge(bridgePayload);
            logDispatchRoute("result", {
                action: "bridge-fallback",
                userId,
                target,
                delivered,
                routeSource,
                token: routeToken || "-"
            });
            return delivered;
        } catch {
            logDispatchRoute("bridge-error", {
                action: "bridge-fallback",
                userId,
                target,
                routeSource,
                token: routeToken || "-"
            });
            return false;
        }
    };

    let gotDirectDelivery = false;
    const directTargets = new Set(deliveryPlan.direct);

    const getTransportPreference = (target: string): EndpointTransportPreference => {
        return resolveEndpointTransportPreference(sourceHint, target, endpointPolicyMap);
    };

    const tryRequestFromTarget = async (target: string): Promise<{ transport: string; response: any } | undefined> => {
        const preference = getTransportPreference(target);
        for (const transport of preference.transports) {
            if (transport === "ws" && bridges?.wsHub?.requestToDevice) {
                try {
                    logDispatchRoute("attempt", {
                        action: "request",
                        userId,
                        sourceHint,
                        routeSource,
                        token: routeToken || "-",
                        target,
                        transport
                    });
                    const response = await bridges.wsHub.requestToDevice(userId, target, payload, options?.waitMs);
                    if (response !== undefined) {
                        logDispatchRoute("hit", {
                            action: "request",
                            userId,
                            target,
                            transport,
                            sourceHint,
                            routeSource,
                            token: routeToken || "-"
                        });
                        return { transport, response };
                    }
                } catch {
                    // ignored
                }
                continue;
            }
            if (transport === "socketio" && bridges?.socketIoBridge?.requestToDevice) {
                try {
                    logDispatchRoute("attempt", {
                        action: "request",
                        userId,
                        sourceHint,
                        routeSource,
                        token: routeToken || "-",
                        target,
                        transport
                    });
                    const response = await bridges.socketIoBridge.requestToDevice(userId, target, payload, options?.waitMs);
                    if (response !== undefined) {
                        logDispatchRoute("hit", {
                            action: "request",
                            userId,
                            target,
                            transport,
                            sourceHint,
                            routeSource,
                            token: routeToken || "-"
                        });
                        return { transport, response };
                    }
                } catch {
                    // ignored
                }
            }
        }
        return undefined;
    };

    const trySendToTarget = async (target: string): Promise<{ transport: string; delivered: boolean } | undefined> => {
        const preference = getTransportPreference(target);
        for (const transport of preference.transports) {
            if (transport === "ws" && bridges?.wsHub.sendToDevice) {
                logDispatchRoute("attempt", {
                    action: "dispatch",
                    userId,
                    sourceHint,
                    routeSource,
                    token: routeToken || "-",
                    target,
                    transport
                });
                const wsResult = bridges.wsHub.sendToDevice(userId, target, payload);
                if (wsResult) {
                    logDispatchRoute("hit", {
                        action: "dispatch",
                        userId,
                        target,
                        transport,
                        sourceHint,
                        routeSource,
                        token: routeToken || "-"
                    });
                    return { transport, delivered: true };
                }
                continue;
            }
            if (transport === "socketio" && bridges?.socketIoBridge?.sendToDevice) {
                logDispatchRoute("attempt", {
                    action: "dispatch",
                    userId,
                    sourceHint,
                    routeSource,
                    token: routeToken || "-",
                    target,
                    transport
                });
                const socketResult = bridges.socketIoBridge.sendToDevice(userId, target, payload);
                if (socketResult) {
                    logDispatchRoute("hit", {
                        action: "dispatch",
                        userId,
                        target,
                        transport,
                        sourceHint,
                        routeSource,
                        token: routeToken || "-"
                    });
                    return { transport, delivered: true };
                }
            }
        }
        return undefined;
    };

    for (const target of orderedTargets) {
        attemptedTargets.push(target);
        let bridgeDelivered = false;
        if (directTargets.has(target)) {
            if (isRequestMode) {
                const response = await tryRequestFromTarget(target);
                if (response !== undefined) {
                    responses.push({
                        target,
                        response: response.response,
                        via: response.transport,
                        transport: response.transport
                    });
                    return { delivered: true, responses, attemptedTargets };
                }
            } else {
                const delivered = await trySendToTarget(target);
                gotDirectDelivery = gotDirectDelivery || !!delivered?.delivered;
                if (delivered?.delivered) {
                    responses.push({
                        target,
                        response: true,
                        via: delivered.transport,
                        transport: delivered.transport
                    });
                } else {
                    bridgeDelivered = await attemptBridgeDelivery(target, payload);
                    if (bridgeDelivered) responses.push({ target, viaBridge: true, via: "bridge", transport: "bridge" });
                }
            }
            continue;
        }

        if (!isRequestMode && gotDirectDelivery) continue;

        if (isRequestMode) {
            const response = await tryRequestFromTarget(target);
            if (response !== undefined) {
                responses.push({
                    target,
                    response: response.response,
                    via: response.transport,
                    transport: response.transport
                });
                return { delivered: true, responses, attemptedTargets };
            }
            continue;
        }
        const delivered = await trySendToTarget(target);
        if (delivered?.delivered) {
            responses.push({
                target,
                response: true,
                via: delivered.transport,
                transport: delivered.transport
            });
        } else {
            bridgeDelivered = await attemptBridgeDelivery(target, payload);
            if (bridgeDelivered) responses.push({ target, viaBridge: true, via: "bridge", transport: "bridge" });
        }
    }

    if (isRequestMode) {
        return { delivered: responses.length > 0, responses, attemptedTargets };
    }

    return {
        delivered: responses.length > 0 || gotDirectDelivery,
        responses,
        attemptedTargets
    };
};

const normalizePeerProfilesForResolution = (profiles: Array<{ id: string; label: string; peerId?: string }>): Array<PeerIdentityInput> => {
    return profiles.map((peer) => ({
        id: peer.id,
        label: peer.label,
        peerId: peer.peerId
    }));
};

const buildPeerIdentityContext = (userId: string) => {
    const staticTopology = (config as any)?.topology;
    const topologyEntries = Array.isArray(staticTopology?.nodes) ? (staticTopology.nodes as Array<Record<string, any>>).filter((node) => node && typeof node === "object" && !Array.isArray(node)) : [];
    const peers = resolvePeerIdentityHub?.getConnectedPeerProfiles(userId) ?? [];
    return {
        peers: normalizePeerProfilesForResolution(peers),
        aliases: NETWORK_ALIAS_MAP,
        topology: topologyEntries
    };
};

const resolveNetworkTargetWithPeerIdentity = (input: string, userId: string): string => {
    const resolution = resolvePeerIdentity(input, buildPeerIdentityContext(userId));
    if (!resolution || !resolution.peerId) return resolveDispatchTarget(input);
    return resolution.peerId;
};

const stripAliasPrefix = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return trimmed;

    const match = trimmed.match(/^([A-Za-z][A-Za-z0-9_-]*):(.*)$/);
    if (!match) return trimmed;

    const prefix = match[1].toLowerCase();
    const prefixMapped = resolveNetworkAlias(NETWORK_ALIAS_MAP, prefix);
    if (prefixMapped) return prefixMapped;

    const aliasTarget = match[2].trim();
    if (looksLikeAliasedHostTarget(aliasTarget)) return aliasTarget;
    return resolveNetworkAlias(NETWORK_ALIAS_MAP, trimmed) || trimmed;
};

const normalizeNetworkFetchResponse = (requestId: string, response: any): { ok: boolean; status: number; statusText?: string; body?: string; headers?: Record<string, string>; requestId?: string; error?: string; raw: any } => {
    if (response == null) {
        return {
            ok: false,
            status: 504,
            statusText: "No response",
            requestId,
            body: "No response",
            raw: response
        };
    }

    if (typeof response !== "object") {
        return {
            ok: true,
            status: 200,
            statusText: "OK",
            requestId,
            body: typeof response === "string" ? response : JSON.stringify(response),
            raw: response
        };
    }

    const responseRequestId = typeof response?.requestId === "string" && response.requestId ? String(response.requestId) : requestId;
    const normalizedHeaders = (() => {
        const source = response?.headers;
        if (!source || typeof source !== "object") return undefined;
        if (Array.isArray(source)) return undefined;
        return Object.entries(source as Record<string, unknown>).reduce(
            (acc, [headerName, headerValue]) => {
                if (typeof headerValue === "string" || typeof headerValue === "number") {
                    acc[headerName] = String(headerValue);
                } else if (Array.isArray(headerValue) && headerValue.every((item) => typeof item === "string")) {
                    acc[headerName] = headerValue.join(", ");
                }
                return acc;
            },
            {} as Record<string, string>
        );
    })();

    const status = typeof response.status === "number" ? response.status : undefined;
    const bodySource = response.body ?? response.data ?? response.text ?? response.payload ?? response.response;
    return {
        ok: response.ok !== undefined ? response.ok === true : status === undefined || (status >= 200 && status < 400),
        status: typeof status === "number" ? status : 200,
        statusText: typeof response.statusText === "string" ? response.statusText : response.error ? "Error" : "OK",
        headers: normalizedHeaders,
        body: typeof bodySource === "string" ? bodySource : bodySource == null ? undefined : JSON.stringify(bodySource),
        requestId: responseRequestId,
        error: typeof response.error === "string" ? response.error : undefined,
        raw: response
    };
};

const normalizeBroadcastTarget = (target: string): { normalized: string; hasExplicitProtocol: boolean } | undefined => {
    const trimmed = target.trim();
    if (!trimmed) return undefined;

    const protocolMatch = trimmed.match(BROADCAST_PROTO_RE);
    if (!protocolMatch) {
        const normalized = stripAliasPrefix(trimmed);
        return { normalized: `http://${normalized}`, hasExplicitProtocol: false };
    }

    const protocol = protocolMatch[0].toLowerCase();
    if (protocol !== "http://" && protocol !== "https://") {
        return { normalized: trimmed, hasExplicitProtocol: false };
    }

    const rawTarget = trimmed.slice(protocol.length);
    const splitIndex = rawTarget.search(/[/?#]/);
    const hostWithPort = splitIndex === -1 ? rawTarget : rawTarget.slice(0, splitIndex);
    const suffix = splitIndex === -1 ? "" : rawTarget.slice(splitIndex);
    const normalizedHostWithPort = stripAliasPrefix(hostWithPort);
    return {
        normalized: `${protocol}${normalizedHostWithPort}${suffix}`,
        hasExplicitProtocol: true
    };
};

const parseBroadcastTarget = (target: string): { url: URL; hasExplicitProtocol: boolean; normalized: string } | undefined => {
    const normalized = normalizeBroadcastTarget(target);
    if (!normalized) return undefined;
    try {
        return {
            url: new URL(normalized.normalized),
            hasExplicitProtocol: normalized.hasExplicitProtocol,
            normalized: normalized.normalized
        };
    } catch {
        return undefined;
    }
};

const resolveBroadcastProtocol = (
    source: string,
    opts: {
        allowUnencrypted?: boolean;
        forceHttps?: boolean;
    }
): { protocol: "http" | "https"; sourceWithoutProtocol: string } | undefined => {
    const trimmed = source.trim();
    if (!trimmed) return undefined;

    const parsed = parseBroadcastTarget(trimmed);
    if (!parsed) return undefined;
    const { url: parsedUrl, hasExplicitProtocol, normalized } = parsed;
    const isLikelySecurePort = BROADCAST_HTTPS_PORTS.has(parsedUrl.port);
    const hasForceHttps = opts.forceHttps && isLikelySecurePort;
    const denyUnencrypted = opts.allowUnencrypted === false && isLikelySecurePort;
    const forcedProtocol = hasForceHttps || denyUnencrypted ? "https" : undefined;
    const sourceWithoutProtocol = hasExplicitProtocol ? normalized.replace(BROADCAST_PROTO_RE, "") : `${parsedUrl.host}${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;

    if (hasExplicitProtocol) {
        return {
            protocol: forcedProtocol || (trimmed.toLowerCase().startsWith("https://") ? "https" : "http"),
            sourceWithoutProtocol
        };
    }

    return {
        protocol: hasForceHttps || denyUnencrypted ? "https" : "http",
        sourceWithoutProtocol
    };
};

const resolveBroadcastUrl = (entry: HttpDispatchRequest, allowUnencrypted: boolean, broadcastForceHttps: boolean): string | undefined => {
    const source = entry.url?.trim() || entry.ip?.trim();
    if (!source) return undefined;

    const explicitForceHttps = parsePortableBoolean(entry.broadcastForceHttps) ?? broadcastForceHttps;
    const resolved = resolveBroadcastProtocol(source, {
        allowUnencrypted,
        forceHttps: explicitForceHttps
    });
    if (!resolved) return undefined;
    return `${resolved.protocol}://${resolved.sourceWithoutProtocol}`;
};

const buildPolicyDirectDispatchUrls = (targetHint: string, userId: string, broadcastForceHttps: boolean, allowUnencrypted: boolean): string[] => {
    const fallbackHttpPorts = [8080];
    const fallbackHttpsPorts = [8443];
    const normalizeDispatchHost = (rawHost: string): string => {
        const noAlias = stripAliasPrefix(String(rawHost || "").trim());
        if (!noAlias) return "";
        if (/^https?:\/\//i.test(noAlias)) return noAlias.replace(/^https?:\/\//i, "");
        if (noAlias.includes("/")) return noAlias.split("/")[0].trim();
        return noAlias;
    };

    const collectHostCandidates = (rawValues: unknown, out: Set<string>, defaultHttpsPorts: number[], defaultHttpPorts: number[]) => {
        if (!Array.isArray(rawValues)) return;
        for (const rawValue of rawValues) {
            const host = normalizeDispatchHost(String(rawValue || "").trim().toLowerCase());
            if (!host || !looksLikeAliasedHostTarget(host)) continue;
            const hasPort = hasExplicitPort(host);
            const pushPorts = (protocol: "http" | "https", ports: number[]) => {
                if (hasPort) {
                    addCandidate(out, protocol, host);
                } else {
                    for (const port of ports) {
                        addCandidate(out, protocol, host, port);
                    }
                }
            };
            pushPorts("https", defaultHttpsPorts);
            pushPorts("http", defaultHttpPorts);
        }
    };

    const collectTargetHostFallbacks = (value: string, out: Set<string>, defaultHttpsPorts: number[], defaultHttpPorts: number[]) => {
        const lower = value.toLowerCase().trim();
        if (!lower) return;
        const asAliasTrim = normalizeDispatchHost(lower.replace(/^id[:\-]/i, "").replace(/^[a-z]+-/i, ""));
        if (!asAliasTrim || !looksLikeAliasedHostTarget(asAliasTrim)) return;
        const hasPort = hasExplicitPort(asAliasTrim);
        const pushPorts = (protocol: "http" | "https", ports: number[]) => {
            if (hasPort) {
                addCandidate(out, protocol, asAliasTrim);
            } else {
                for (const port of ports) {
                    addCandidate(out, protocol, asAliasTrim, port);
                }
            }
        };
        pushPorts("https", defaultHttpsPorts);
        pushPorts("http", defaultHttpPorts);
    };

    const normalizeUrlPortList = (policy: Record<string, any> | undefined, key: "http" | "https"): number[] => {
        const raw = policy?.ports;
        if (!raw || typeof raw !== "object") return [];
        const values = (raw as Record<string, unknown>)[key];
        if (!Array.isArray(values)) return [];
        return values
            .map((entry) => parsePortableInteger(entry))
            .filter((value): value is number => value !== undefined && value > 0 && value <= 65535)
            .filter((value, index, list) => list.indexOf(value) === index);
    };

    const hasExplicitPort = (value: string): boolean => {
        const trimmed = value.trim();
        if (!trimmed) return false;
        const hostPort = trimmed.split("/")[0];
        const idx = hostPort.lastIndexOf(":");
        if (idx <= 0) return false;
        const port = parsePortableInteger(hostPort.slice(idx + 1));
        return port !== undefined;
    };

    const addCandidate = (out: Set<string>, force: "http" | "https", host: string, port?: number) => {
        const trimmed = host.trim();
        if (!trimmed) return;
        const base = hasExplicitPort(trimmed) ? trimmed : port ? `${trimmed}:${port}` : trimmed;
        const url = `${force}://${base}/clipboard`;
        const resolved = resolveBroadcastProtocol(url, { allowUnencrypted, forceHttps: broadcastForceHttps });
        if (!resolved) return;
        out.add(`${resolved.protocol}://${resolved.sourceWithoutProtocol}`);
    };

    const appendFromTarget = (target: string, out: Set<string>) => {
        const policy = resolveEndpointIdPolicyStrict(endpointPolicyMap, target) || resolveEndpointIdPolicy(endpointPolicyMap, target);
        if (!policy) return;
        const strictPolicy = policy as Record<string, any>;
        const directPorts = {
            https: normalizeUrlPortList(strictPolicy, "https"),
            http: normalizeUrlPortList(strictPolicy, "http")
        };
        const httpPorts = directPorts.http.length ? directPorts.http : [8080];
        const httpsPorts = directPorts.https.length ? directPorts.https : [8443];
        const origins = Array.isArray(strictPolicy.origins) ? strictPolicy.origins : [];
        const tokens = Array.isArray(strictPolicy.tokens) ? strictPolicy.tokens : [];

        collectHostCandidates(origins, out, httpsPorts, httpPorts);
        collectHostCandidates(tokens, out, httpsPorts, httpPorts);
    };

    const normalizedHint = resolveEndpointRouteTarget(targetHint, userId).trim().toLowerCase();
    if (!normalizedHint) return [];
    const out = new Set<string>();
    const deliveryPlan = resolveEndpointDeliveryTargets(normalizedHint, userId);
    const targets = Array.from(new Set([...deliveryPlan.direct, ...deliveryPlan.fallback, ...deliveryPlan.ordered]));
    targets.forEach((target) => appendFromTarget(target, out));
    if (out.size === 0) appendFromTarget(normalizedHint, out);
    if (out.size === 0) {
        const hostHint = stripAliasPrefix(normalizedHint).trim();
        if (looksLikeAliasedHostTarget(hostHint)) {
            const hasPort = hasExplicitPort(hostHint);
            if (hasPort) {
                addCandidate(out, "https", hostHint);
                addCandidate(out, "http", hostHint);
            } else {
                for (const port of [8443, 8080]) {
                    addCandidate(out, port === 8443 ? "https" : "http", hostHint, port);
                }
            }
        }
        collectTargetHostFallbacks(normalizedHint, out, fallbackHttpsPorts, fallbackHttpPorts);
    }
    return Array.from(out);
};

const normalizeDispatchRequests = (body: HttpDispatchBody): HttpDispatchRequest[] => {
    const out: HttpDispatchRequest[] = [];
    const pushEntry = (entry: string | HttpDispatchRequest | undefined | null) => {
        if (!entry) return;
        if (typeof entry === "string") {
            const trimmed = entry.trim();
            if (!trimmed) return;
            const hasProtocolInValue = BROADCAST_PROTO_RE.test(trimmed);
            out.push(hasProtocolInValue ? { url: trimmed } : { ip: trimmed });
            return;
        }
        const normalized: HttpDispatchRequest = {
            ...entry,
            url: entry.url?.trim() || undefined,
            ip: entry.ip?.trim() || undefined
        };
        const parsedBroadcastForceHttps = parsePortableBoolean((entry as any).broadcastForceHttps);
        if (parsedBroadcastForceHttps !== undefined) {
            normalized.broadcastForceHttps = parsedBroadcastForceHttps;
        }
        const parsedUnencrypted = parsePortableBoolean((entry as any).unencrypted);
        if (parsedUnencrypted !== undefined) {
            normalized.unencrypted = parsedUnencrypted;
        }
        if (normalized.url || normalized.ip || normalized.deviceId || normalized.targetId || (normalized as any).peerId) {
            out.push(normalized);
        }
    };

    (body.requests || []).forEach((r) => pushEntry(r));
    (body.addresses || []).forEach((a) => pushEntry(a));
    (body.urls || []).forEach((u) => pushEntry({ url: u }));
    (body.ips || []).forEach((ip) => pushEntry({ ip }));
    return out;
};

const collectBroadcastTopLevelTargets = (body: HttpDispatchBody): string[] => {
    const normalizedBody = body as any;
    const out = new Set<string>();
    const push = (value: unknown) => {
        if (typeof value !== "string") return;
        const list = value
            .split(/[;,]/)
            .map((entry) => entry.trim())
            .filter(Boolean);
        for (const target of list) {
            out.add(target);
        }
    };
    push(body.targetDeviceId);
    push(normalizedBody.targetId);
    push(normalizedBody.deviceId);
    push(normalizedBody.target);
    push(normalizedBody.to);
    if (Array.isArray(normalizedBody.targets)) {
        for (const target of normalizedBody.targets) push(target);
    }
    return Array.from(out);
};

const buildBroadcastRequestsFromTargets = (body: HttpDispatchBody): HttpDispatchRequest[] => {
    const payloadText = typeof body.text === "string" ? body.text.trim() : "";
    if (!payloadText) return [];
    const targets = collectBroadcastTopLevelTargets(body);
    return targets.map((target) => ({
        deviceId: target,
        body: payloadText,
        method: "POST"
    }));
};

const readFeatureLimit = (body: DeviceFeatureRequestBody): number => {
    const limit = parsePortableInteger((body as any).limit);
    return Math.max(1, Math.min(200, limit ?? 50));
};

const readTextPayload = (body: DeviceFeatureRequestBody): string => {
    const textFromBody = (body as any).text;
    if (textFromBody == null) return "";
    if (typeof textFromBody === "string") return textFromBody.trim();
    return String(textFromBody).trim();
};

const collectFeatureTargets = (body: DeviceFeatureRequestBody): string[] => {
    const out = new Set<string>();
    const normalized = body as Record<string, any>;
    const push = (value: unknown) => {
        if (typeof value !== "string") return;
        const list = value
            .split(/[;,]/)
            .map((entry) => entry.trim())
            .filter(Boolean);
        for (const target of list) {
            out.add(target);
        }
    };
    push(body.targetDeviceId);
    push(body.targetId);
    push(normalized.deviceId);
    push(normalized.target);
    push(normalized.to);
    if (Array.isArray(normalized.targets)) {
        for (const target of normalized.targets) push(target);
    }
    return Array.from(out);
};

const resolveFeatureTarget = (body: DeviceFeatureRequestBody, userId: string) => resolveNetworkTargetWithPeerIdentity(body.targetDeviceId?.trim() || body.targetId?.trim() || (body as any).deviceId?.trim(), userId);

const resolveFeatureTargets = (body: DeviceFeatureRequestBody, userId: string): string[] => {
    const explicitTargets = collectFeatureTargets(body);
    if (explicitTargets.length > 0) return explicitTargets;
    const fallback = resolveFeatureTarget(body, userId);
    return fallback ? [fallback] : [];
};

type FeatureTargetDelivery = {
    target?: string;
    delivered: boolean;
    reason?: string;
};

const dispatchFeatureToTargets = async (
    userId: string,
    routeSource: RouteSourceResolution,
    targets: string[],
    feature: string,
    payload: any,
    bridges: {
        wsHub: WsHub;
        socketIoBridge?: Pick<SocketIoBridge, "requestToDevice" | "sendToDevice">;
        networkContext?: {
            sendToBridge?: (payload: any) => boolean;
            getNodeId?: () => string | null | undefined;
        };
    }
): Promise<{ delivered: boolean; responses: any[]; attemptedTargets: string[]; targetResults: FeatureTargetDelivery[] }> => {
    const deliveredTargetSet = new Set<string>();
    const responses: any[] = [];
    const attemptedTargets: string[] = [];
    const targetResults: FeatureTargetDelivery[] = [];
    let anyDelivered = false;

    for (const target of targets) {
        if (!target.trim()) continue;
        const resolvedTarget = resolveEndpointRouteTarget(target, userId);
        if (!resolvedTarget) {
            targetResults.push({ target, delivered: false, reason: "No target" });
            continue;
        }
        const permission = checkEndpointRoutePermission(routeSource.sourceId, resolvedTarget);
        if (!permission.allowed) {
            targetResults.push({ target: resolvedTarget, delivered: false, reason: `Route denied by endpoint policy: ${permission.reason || "policy-blocked"}` });
            continue;
        }

        const response = await sendToTargetsWithFallback(
            userId,
            resolvedTarget,
            reverseDispatchPayload(feature, payload),
            { mode: "dispatch" },
            bridges
        );
        const isDelivered = !!response.delivered;
        if (isDelivered) {
            anyDelivered = true;
            deliveredTargetSet.add(resolvedTarget);
            attemptedTargets.push(resolvedTarget);
        }
        for (const entry of response.responses) {
            responses.push({ ...entry, target: resolvedTarget });
        }
        targetResults.push({ target: resolvedTarget, delivered: isDelivered });
    }

    return {
        delivered: anyDelivered,
        responses,
        attemptedTargets: Array.from(deliveredTargetSet),
        targetResults
    };
};

const withFeatureUrl = (baseUrl: string, featurePath: string, query: Record<string, string | number | undefined>) => {
    const normalizedBase = baseUrl.trim().replace(/\/+$/, "");
    const cleanPath = featurePath.startsWith("/") ? featurePath : `/${featurePath}`;
    const queryItems = Object.entries(query)
        .filter(([, value]) => value !== undefined && value !== null && value !== "")
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    const urlWithPath = `${normalizedBase}${cleanPath}`;
    if (queryItems.length === 0) return urlWithPath;
    const joiner = urlWithPath.includes("?") ? "&" : "?";
    return `${urlWithPath}${joiner}${queryItems.join("&")}`;
};

const reverseDispatchPayload = (feature: string, payload: any) => ({
    type: feature,
    action: feature,
    ...payload,
    data: payload
});

type AuthContext = {
    record: Awaited<ReturnType<typeof verifyUser>> | null;
    settings?: Settings;
};

const resolveAuthContext = async (userId: string, userKey: string): Promise<AuthContext> => {
    const [record, settings] = await Promise.all([verifyUser(userId, userKey).catch(() => null), loadUserSettings(userId, userKey).catch(() => undefined as Settings | undefined)]);
    return { record, settings };
};

const toTargetUrl = (body: HttpRequestBody, targetUrlFromSettings?: string, forceHttps = false): string | undefined => {
    const explicitUrl = body.url?.trim();
    if (explicitUrl) {
        if (forceHttps && explicitUrl.startsWith("http://")) {
            return `https://${explicitUrl.slice("http://".length)}`;
        }
        return explicitUrl;
    }

    if (targetUrlFromSettings) {
        if (forceHttps && targetUrlFromSettings.startsWith("http://")) {
            return `https://${targetUrlFromSettings.slice("http://".length)}`;
        }
        return targetUrlFromSettings;
    }

    const host = resolveDispatchTarget(body.ip?.trim() || body.address?.trim() || body.host?.trim() || "");
    if (!host) return undefined;
    if (/^https?:\/\//i.test(host)) {
        return forceHttps && host.startsWith("http://") ? `https://${host.slice("http://".length)}` : host;
    }

    const protocolFromBody = parsePortableBoolean(body.https) === true || parsePortableBoolean(body.secure) === true;
    const protocol = forceHttps || protocolFromBody ? "https" : body.protocol || "http";
    const portNumber = parsePortableInteger(body.port);
    const port = portNumber === undefined ? "" : `:${portNumber}`;
    const nextPath = (body.path || "").trim();
    const normalizedPath = nextPath ? (nextPath.startsWith("/") ? nextPath : `/${nextPath}`) : "";
    return `${protocol}://${host}${port}${normalizedPath}`;
};

export const registerOpsRoutes = async (
    app: FastifyInstance,
    wsHub: WsHub,
    networkContext?: NetworkContextProvider,
    socketIoBridge?: Pick<SocketIoBridge, "requestToDevice" | "sendToDevice" | "getConnectedDevices">
) => {
    resolvePeerIdentityHub = wsHub;

    const requestHandler = async (request: FastifyRequest<{ Body: HttpRequestBody }>) => {
        const payload = (request.body || {}) as HttpRequestBody;
        const { targetId, targetDeviceId, method, headers, body } = payload;
        const { userId, userKey } = resolveDispatchIdentity(payload as { userId?: string; userKey?: string; clientId?: string; token?: string });
        const parsedRequestHttps = parsePortableBoolean(payload.https);
        const parsedRequestSecure = parsePortableBoolean(payload.secure);
        const forceHttpsRoute = (request.url || "").startsWith("/core/ops/https") || parsedRequestHttps === true || parsedRequestSecure === true;
        const hasCredentials = !!(userId && userKey);
        const settings = hasCredentials ? (await resolveAuthContext(userId, userKey)).settings : undefined;
        if (hasCredentials) {
            const { record } = await resolveAuthContext(userId, userKey);
            if (!record) {
                return { ok: false, error: "Invalid credentials" };
            }
        }

        const ops = settings?.core?.ops || {};
        const httpTargets = ops.httpTargets || [];
        const resolvedTargetId = targetId?.trim() ? resolveNetworkTargetWithPeerIdentity(targetId, userId) : targetId;
        const target = targetId?.trim() ? httpTargets.find((t) => t.id === targetId || t.id === resolvedTargetId) : undefined;
        const resolvedUrl = toTargetUrl(payload, target?.url, forceHttpsRoute);

        const routeTargetHint = targetDeviceId || (payload as any).deviceId || targetId || "";
        const reverseTarget = resolveEndpointRouteTarget(routeTargetHint, userId);
        const reverseTargetPeer = resolveNetworkTargetWithPeerIdentity(routeTargetHint, userId);
        const routeSource = extractRoutingSourceId(payload as any, userId);
        const routeSourceCheck = ensureKnownRoutingSource(routeSource);
        if (!routeSourceCheck.allowed) {
            return {
                ok: false,
                error: "Unknown source. I don't know you",
                route: "source-unknown",
                reason: routeSourceCheck.reason
            };
        }
        const routeDecision = checkEndpointRoutePermission(routeSource.sourceId, reverseTarget);
        if (!routeDecision.allowed) {
            return {
                ok: false,
                error: "Route denied by endpoint policy",
                delivered: "policy-blocked",
                reason: routeDecision.reason
            };
        }
        const reverseTargetForSend = reverseTargetPeer || reverseTarget;
        if (!resolvedUrl && reverseTargetForSend && typeof reverseTargetForSend === "string" && reverseTargetForSend.trim()) {
            const delivery = await sendToTargetsWithFallback(
                userId,
                reverseTargetForSend,
                {
                    type: (payload as any).type || "dispatch",
                    data: (payload as any).data ?? payload
                },
                { mode: "dispatch" },
                { wsHub, socketIoBridge, networkContext }
            );
            const delivered = delivery.delivered;
            return {
                ok: !!delivered,
                delivered: delivered ? "ws-reverse" : "ws-reverse-missing",
                mode: delivered ? "request-fallback-reverse" : "request-fallback-reverse",
                targetDeviceId: reverseTargetForSend
            };
        }

        // Partial legacy notify compatibility: accept notify-like payloads via /api/request.
        if (!resolvedUrl && payload.type) {
            wsHub.notify(userId, String(payload.type), payload.data ?? payload);
            return { ok: true, delivered: "ws-notify", mode: "request-notify-fallback" };
        }
        if (!resolvedUrl) return { ok: false, error: "No URL" };

        const isHttps = resolvedUrl.startsWith("https://");
        if (!isHttps && !(ops.allowUnencrypted || target?.unencrypted)) {
            return { ok: false, error: "Unencrypted HTTP is not allowed" };
        }

        const finalHeaders = { ...(target?.headers || {}), ...(headers || {}) };
        const finalMethod = (method || target?.method || "POST").toUpperCase();

        try {
            const res = await fetch(resolvedUrl, {
                method: finalMethod,
                headers: finalHeaders,
                body: body ?? null
            });
            const text = await res.text();
            return { ok: true, status: res.status, data: text };
        } catch (e) {
            return { ok: false, error: String(e) };
        }
    };

    const broadcastHandler = async (request: FastifyRequest<{ Body: HttpDispatchBody }>) => {
        const body = (request.body || {}) as HttpDispatchBody;
        const { targetDeviceId } = body;
        const { userId, userKey } = resolveDispatchIdentity(body);
        const routeSource = extractRoutingSourceId(body as Record<string, any>, userId);
        const routeSourceCheck = ensureKnownRoutingSource(routeSource);
        if (!routeSourceCheck.allowed) {
            return {
                ok: false,
                error: "Unknown source. I don't know you",
                route: "source-unknown",
                reason: routeSourceCheck.reason
            };
        }
        const defaultDeviceId = targetDeviceId && targetDeviceId.trim() ? targetDeviceId.trim() : undefined;
        const legacyRequests = normalizeDispatchRequests(body);
        const requests = legacyRequests.length > 0 ? legacyRequests : buildBroadcastRequestsFromTargets(body);
        // console.log(requests); // Disabled to prevent logging JSON/payload content
        if (requests.length === 0) {
            const notifyType = (request.body as any)?.type;
            if (notifyType) {
                wsHub.multicast(userId, { type: String(notifyType), data: (request.body as any)?.data ?? request.body }, (request.body as any)?.namespace);
                return { ok: true, delivered: "ws-multicast", mode: "broadcast-notify-fallback" };
            }
            return { ok: false, error: "No requests" };
        }

        const hasCredentials = !!(userId || userKey);
        const authContext = hasCredentials ? await resolveAuthContext(userId, userKey) : { record: null, settings: undefined };
        // if (hasCredentials && !authContext.record) {
        //     return { ok: false, error: "Invalid credentials" };
        // }
        const settings = authContext.settings;

        const ops = settings?.core?.ops || {};
        const allowUnencrypted = ops.allowUnencrypted !== false;
        const configBroadcastForceHttps = safeParseBoolean((config as any)?.broadcastForceHttps, safeParseBoolean((config as any)?.ops?.broadcastForceHttps, safeParseBoolean((config as any)?.core?.ops?.broadcastForceHttps, false)));
        const requestBroadcastForceHttps = parsePortableBoolean((body as any).broadcastForceHttps);
        const opsBroadcastForceHttps = parsePortableBoolean((ops as any).broadcastForceHttps);
        const forceBroadcastHttps = requestBroadcastForceHttps ?? opsBroadcastForceHttps ?? configBroadcastForceHttps;
        const execOne = async (entry: HttpDispatchRequest) => {
            const reverseDeviceId = (entry as any).deviceId || (entry as any).targetId || defaultDeviceId;
            const resolvedUrl = resolveBroadcastUrl(entry, allowUnencrypted, forceBroadcastHttps);
            const executeUrlRequest = async (overrideUrl?: string) => {
                const source = overrideUrl || resolvedUrl;
                if (!source) {
                    return { target: entry.ip || entry.url, ok: false, error: "No URL" };
                }

                const isHttps = source.startsWith("https://");
                if (!isHttps && !(allowUnencrypted || entry.unencrypted)) return { target: source, ok: false, error: "Unencrypted HTTP is not allowed" };

                const finalMethod = (entry.method || "POST").toUpperCase();
                const headers: Record<string, string> = { ...((entry.headers as Record<string, string>) || {}) };
                if (typeof entry.body === "string" && !Object.keys(headers).some(k => k.toLowerCase() === "content-type")) {
                    headers["Content-Type"] = "text/plain; charset=utf-8";
                }
                
                console.log(source, finalMethod, headers, "<body hidden>");
                try {
                    const fetchOptions: RequestInit = {
                        method: finalMethod,
                        headers,
                        body: entry.body ?? null
                    };
                    
                    // Use native Node.js dispatchers if available
                    if (!isHttps || allowUnencrypted || entry.unencrypted || forceBroadcastHttps) {
                        try {
                            const { Agent } = await import("undici");
                            fetchOptions.dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
                        } catch(e) {
                            try {
                                const https = await import("https");
                                fetchOptions.dispatcher = new https.Agent({ rejectUnauthorized: false }) as any;
                            } catch (err) {}
                        }
                    }
                    
                    const res = await fetch(source, fetchOptions);
                    const text = await res.text();
                    return { target: source, ok: true, status: res.status, data: text };
                } catch (e) {
                    return { target: source, ok: false, error: String(e) };
                }
            };

            if (typeof reverseDeviceId === "string" && reverseDeviceId.trim()) {
                const resolvedReverseDeviceId = resolveEndpointRouteTarget(reverseDeviceId, userId);
                const routeDecision = checkEndpointRoutePermission(routeSource.sourceId, resolvedReverseDeviceId);
                if (!routeDecision.allowed) {
                    return {
                        target: reverseDeviceId,
                        ok: false,
                        delivered: "policy-blocked",
                        mode: "reverse",
                        reason: routeDecision.reason
                    };
                }
                const delivery = await sendToTargetsWithFallback(
                    userId,
                    resolvedReverseDeviceId.trim(),
                    {
                        type: (entry as any).type || "dispatch",
                        data: (entry as any).data ?? (entry as any).body,
                        to: resolvedReverseDeviceId,
                        target: resolvedReverseDeviceId,
                        targetId: resolvedReverseDeviceId,
                        targetDeviceId: resolvedReverseDeviceId,
                        deviceId: resolvedReverseDeviceId
                    },
                    { mode: "dispatch" },
                    { wsHub, socketIoBridge, networkContext }
                );
                const delivered = delivery.delivered;
                if (delivered) {
                    return {
                        target: reverseDeviceId,
                        ok: true,
                        delivered: "ws-reverse",
                        mode: "reverse"
                    };
                }
                const directCandidates = [resolvedUrl, ...buildPolicyDirectDispatchUrls(reverseDeviceId || "", userId, forceBroadcastHttps, allowUnencrypted)];
                for (const candidate of directCandidates) {
                    if (!candidate) continue;
                    const directResult = await executeUrlRequest(candidate);
                    if (directResult.ok) {
                        return {
                            ...directResult,
                            target: candidate,
                            mode: "hybrid",
                            delivered: "http-fallback"
                        };
                    }
                }
                return {
                    target: reverseDeviceId,
                    ok: !!delivered,
                    delivered: delivered ? "ws-reverse" : "ws-reverse-missing",
                    mode: "reverse"
                };
            }
            return executeUrlRequest();
        };

        const results = await Promise.all(requests.map(execOne));
        const failed = results.find((r) => !r.ok);
        const summary = {
            target: routeSource.sourceId,
            targets: results.length,
            failed: results.filter((r) => !r.ok).length,
            results: results.map((r) => ({
                target: (r as any).target,
                delivered: (r as any).delivered,
                mode: (r as any).mode,
                ok: r.ok,
                status: (r as any).status,
                error: (r as any).error,
                transport: (r as any).via || (r as any).viaBridge ? (r as any).via || "bridge" : (r as any).transport || (r as any).via
            }))
        };
        console.log(`[broadcast] client=${routeSource.sourceId} targets=${summary.targets} failed=${summary.failed} results=${JSON.stringify(summary, null, 2)}`);
        return { ok: !failed, results };
    };

    const networkFetchHandler = async (request: FastifyRequest<{ Body: NetworkFetchBody }>) => {
        const { route = "auto", target, targetId, deviceId, peerId, namespace, ns, method, url, headers, data, payload, body, timeoutMs } = request.body || {};
        const { userId, userKey } = resolveDispatchIdentity(request.body || {});
        const routeSource = extractRoutingSourceId(request.body as Record<string, any>, userId);
        const routeSourceCheck = ensureKnownRoutingSource(routeSource);
        if (!routeSourceCheck.allowed) {
            return {
                ok: false,
                error: "Unknown source. I don't know you",
                route: "source-unknown",
                reason: routeSourceCheck.reason
            };
        }
        const record = await verifyUser(userId, userKey);
        if (!record) return { ok: false, error: "Invalid credentials" };

        const rawDestination = resolveNetworkTargetWithPeerIdentity(targetId || deviceId || peerId || target || "", userId);
        const destination = resolveEndpointRouteTarget(rawDestination, userId);
        const requestTarget = typeof destination === "string" ? destination.trim() : "";
        if (!requestTarget) return { ok: false, error: "Missing target" };
        const routingPolicy = checkEndpointRoutePermission(routeSource.sourceId, requestTarget);
        if (!routingPolicy.allowed) {
            return {
                ok: false,
                error: "Route denied by endpoint policy",
                route: "policy-block",
                target: requestTarget,
                reason: routingPolicy.reason
            };
        }
        const timeoutValue = parsePortableInteger(timeoutMs);
        const effectiveTimeoutMs = timeoutValue === undefined ? undefined : Math.max(250, timeoutValue);
        const normalizedNamespace = typeof namespace === "string" && namespace.trim() ? namespace.trim() : typeof ns === "string" && ns.trim() ? ns.trim() : undefined;

        const peerProfiles = wsHub.getConnectedPeerProfiles(userId);
        const localPeers = makeTargetTokenSet(wsHub.getConnectedDevices(userId));
        const localLabels = makeTargetTokenSet(peerProfiles.map((peer) => peer.label));
        const localIds = makeTargetTokenSet(peerProfiles.map((peer) => peer.id));
        const localPeerIds = makeTargetTokenSet(peerProfiles.map((peer) => String((peer as any).peerId || peer.id)));
        const allLocalTargets = new Set([...localPeers, ...localLabels, ...localIds, ...localPeerIds]);
        const isPolicyKnownTarget = (value: string) => resolveEndpointIdPolicyStrict(endpointPolicyMap, value) != null;
        const isLocalTarget = (value: string) => allLocalTargets.has(value.trim().toLowerCase()) || isPolicyKnownTarget(value);
        const surface = inferNetworkSurface(request.socket?.remoteAddress || (request.headers?.["x-forwarded-for"] as string | undefined));
        const plan = resolveDispatchPlan({
            route,
            target: requestTarget,
            hasBridgeTransport: typeof networkContext?.sendToBridge === "function",
            isLocalTarget,
            surface
        });
        if (!plan.local && !plan.bridge) {
            return { ok: false, error: "Target unknown and no available route", route: "none", target: requestTarget };
        }

        const requestId = randomUUID();
        const requestPayload = {
            type: "network.fetch",
            requestId,
            from: routeSource.sourceId,
            to: requestTarget,
            namespace: normalizedNamespace,
            method: (method || "GET").toUpperCase(),
            url: typeof url === "string" ? url.trim() : undefined,
            headers: headers || {},
            body: payload ?? data ?? body
        };

        const requestPayloadWithTimeout = requestPayload;
        const unifiedResult = async () => {
            if (!plan.local) return undefined;
            const delivery = await sendToTargetsWithFallback(
                userId,
                requestTarget,
                requestPayloadWithTimeout,
                {
                    mode: "request",
                    waitMs: effectiveTimeoutMs ?? DEFAULT_NETWORK_FETCH_TIMEOUT_MS
                },
                { wsHub, socketIoBridge, networkContext }
            );
            if (delivery.responses.length > 0) {
                const hit = delivery.responses[0];
                return {
                    ok: true,
                    route: plan.route,
                    requestId,
                    target: hit.target,
                    result: normalizeNetworkFetchResponse(requestId, hit.response)
                };
            }
            return {
                ok: false,
                requestId,
                route: plan.route,
                target: requestTarget,
                mode: delivery.delivered ? "fallback-one-way" : "local-delivery-missing",
                delivered: delivery.delivered ? "ws-reverse" : "ws-reverse-missing",
                attemptedTargets: delivery.attemptedTargets
            };
        };

        const localResult = await unifiedResult();
        if (localResult) return localResult;

        if (plan.bridge && networkContext?.sendToBridge) {
            const bridgePayload = {
                ...requestPayload,
                to: requestTarget,
                target: requestTarget,
                targetId: requestTarget,
                route,
                namespace: normalizedNamespace
            };
            const sent = networkContext.sendToBridge({
                ...bridgePayload,
                from: routeSource.sourceId
            });
            return {
                ok: sent === true,
                route: plan.route,
                requestId,
                target: requestTarget,
                mode: sent ? "bridge-fire-and-forget" : "bridge-not-available"
            };
        }

        const fallbackDelivery = await sendToTargetsWithFallback(userId, requestTarget, requestPayload, { mode: "dispatch" }, { wsHub, socketIoBridge });
        const delivered = fallbackDelivery.delivered;
        return {
            ok: !!delivered,
            route: plan.route,
            requestId,
            target: requestTarget,
            mode: delivered ? "legacy-forward" : "missing-target",
            delivered: delivered ? "ws-reverse" : "ws-reverse-missing"
        };
    };

    const legacyNetworkFetchAlias = async (request: FastifyRequest<{ Body: NetworkFetchBody }>) => networkFetchHandler(request);

    const wsSendHandler = async (request: FastifyRequest<{ Body: WsSendBody }>) => {
        const { userId, userKey, namespace, type, data } = request.body || {};
        const record = await verifyUser(userId, userKey);
        if (!record) return { ok: false, error: "Invalid credentials" };
        wsHub.multicast(userId, { type: type || "dispatch", data }, namespace);
        return { ok: true };
    };

    const reverseSendHandler = async (request: FastifyRequest<{ Body: ReverseSendBody }>) => {
        const { userId, userKey, deviceId, type, data, action } = request.body || {};
        const record = await verifyUser(userId, userKey);
        if (!record) return { ok: false, error: "Invalid credentials" };
        if (!deviceId?.trim()) return { ok: false, error: "Missing deviceId" };
        const routeSource = extractRoutingSourceId(request.body as Record<string, any>, userId);
        const routeSourceCheck = ensureKnownRoutingSource(routeSource);
        if (!routeSourceCheck.allowed) {
            return { ok: false, error: "Unknown source. I don't know you", route: "source-unknown", reason: routeSourceCheck.reason };
        }
        const resolvedDeviceId = resolveEndpointRouteTarget(deviceId, userId);
        const permission = checkEndpointRoutePermission(routeSource.sourceId, resolvedDeviceId);
        if (!permission.allowed) {
            return { ok: false, error: "Route denied by endpoint policy", delivered: "policy-blocked", reason: permission.reason };
        }

        const delivery = await sendToTargetsWithFallback(
            userId,
            resolvedDeviceId,
            {
                type: type || action || "dispatch",
                data
            },
            { mode: "dispatch" },
            { wsHub, socketIoBridge, networkContext }
        );
        const delivered = delivery.delivered;
        return { ok: !!delivered, delivered: delivered ? "ws-reverse" : "ws-reverse-missing", deviceId: resolvedDeviceId };
    };

    const notifyHandler = async (request: FastifyRequest<{ Body: { userId: string; userKey: string; type: string; data?: any } }>) => {
        const { userId, userKey, type, data } = request.body || {};
        const record = await verifyUser(userId, userKey);
        if (!record) return { ok: false, error: "Invalid credentials" };
        wsHub.notify(userId, type, data);
        return { ok: true };
    };

    const featureDevicesHandler = async (request: FastifyRequest<{ Body: { userId: string; userKey: string } }>) => {
        const { userId, userKey } = request.body || {};
        const { record, settings } = await resolveAuthContext(userId, userKey);
        if (!record) return { ok: false, error: "Invalid credentials" };

        const ops = settings?.core?.ops || {};
        const configuredTargets = Array.isArray((ops as any).httpTargets) ? (ops as any).httpTargets.map((target: any) => String(target?.id || target?.name || "").trim()).filter(Boolean) : [];

        const reverseDevices = wsHub.getConnectedDevices(userId);
        const reverseDeviceProfiles = wsHub.getConnectedPeerProfiles(userId).map((peer) => ({ id: peer.id, label: peer.label }));
        return {
            ok: true,
            reverseDevices,
            reverseDeviceProfiles,
            configuredTargets,
            features: ["/sms", "/notifications", "/notifications/speak", "/contacts"]
        };
    };

    const smsFeatureHandler = async (request: FastifyRequest<{ Body: DeviceFeatureRequestBody }>) => {
        const body = (request.body || {}) as DeviceFeatureRequestBody;
        const { userId, userKey, headers, targetId } = body;
        const limit = readFeatureLimit(body);
        const routeSource = extractRoutingSourceId(body as Record<string, any>, userId);
        const routeSourceCheck = ensureKnownRoutingSource(routeSource);
        if (!routeSourceCheck.allowed) {
            return { ok: false, error: "Unknown source. I don't know you", route: "source-unknown", reason: routeSourceCheck.reason };
        }

        const { record, settings } = await resolveAuthContext(userId, userKey);
        if (!record) return { ok: false, error: "Invalid credentials" };
        const ops = settings?.core?.ops || {};
        const target = Array.isArray((ops as any).httpTargets) ? (ops as any).httpTargets.find((entry: any) => entry?.id === targetId) : undefined;
        const resolvedBase = toTargetUrl(body, target?.url, false);
        const resolvedTargets = resolveFeatureTargets(body, userId);
        const payloadData = { ...((body as any).data || {}), method: body.method || "POST", limit };
        if ((body as any).number) payloadData.number = (body as any).number;
        if ((body as any).content) payloadData.content = (body as any).content;
        if ((body as any).text) payloadData.text = (body as any).text;
        const useReverseDispatch = !resolvedBase || resolvedTargets.length > 1;

        if (useReverseDispatch) {
            if (resolvedTargets.length === 0) return { ok: false, error: "No target", feature: "sms" };
            const dispatchResult = await dispatchFeatureToTargets(userId, routeSource, resolvedTargets, "sms", payloadData, { wsHub, socketIoBridge, networkContext });
            if (dispatchResult.targetResults.length === 1 && !dispatchResult.delivered) {
                const singleResult = dispatchResult.targetResults[0];
                if (singleResult.reason?.includes("Route denied")) {
                    return { ok: false, error: "Route denied by endpoint policy", delivered: "policy-blocked", reason: singleResult.reason };
                }
            }
            const targetIds = dispatchResult.targetResults.map((entry) => entry.target).filter((value): value is string => typeof value === "string");
            if (resolvedTargets.length === 1) {
                return {
                    ok: !!dispatchResult.delivered,
                    delivered: dispatchResult.delivered ? "ws-reverse" : "ws-reverse-missing",
                    targetDeviceId: targetIds[0],
                    mode: "reverse",
                    feature: "sms",
                    limit
                };
            }
            return {
                ok: !!dispatchResult.delivered,
                delivered: dispatchResult.delivered ? "ws-reverse-multi" : "ws-reverse-missing",
                targetDeviceIds: targetIds,
                mode: "reverse",
                feature: "sms",
                limit,
                targets: dispatchResult.targetResults,
                responses: dispatchResult.responses,
                attemptedTargets: dispatchResult.attemptedTargets
            };
        }

        const reverseDeviceId = resolvedTargets[0];
        const resolvedReverseDeviceId = reverseDeviceId ? resolveEndpointRouteTarget(reverseDeviceId, userId) : reverseDeviceId;
        const permission = resolvedReverseDeviceId ? checkEndpointRoutePermission(routeSource.sourceId, resolvedReverseDeviceId) : { allowed: true, reason: "" };

        if (resolvedReverseDeviceId && permission.allowed) {
            const payloadData = { ...((body as any).data || {}), method: body.method || "POST", limit };
            if ((body as any).number) payloadData.number = (body as any).number;
            if ((body as any).content) payloadData.content = (body as any).content;
            if ((body as any).text) payloadData.text = (body as any).text;
            
            const delivery = await sendToTargetsWithFallback(userId, resolvedReverseDeviceId, reverseDispatchPayload("sms", payloadData), { mode: "dispatch" }, { wsHub, socketIoBridge, networkContext });
            const delivered = delivery.delivered;
            return {
                ok: !!delivered,
                delivered: delivered ? "ws-reverse" : "ws-reverse-missing",
                targetDeviceId: resolvedReverseDeviceId,
                mode: "reverse",
                feature: "sms",
                limit
            };
        }
        if (!resolvedReverseDeviceId) return { ok: false, error: "No target", feature: "sms" };
        if (!permission.allowed) {
            return { ok: false, error: "Route denied by endpoint policy", delivered: "policy-blocked", reason: permission.reason };
        }

        if (!resolvedBase) return { ok: false, error: "No URL" };
        const finalHeaders = { ...(target?.headers || {}), ...(headers || {}) };
        try {
            const targetUrl = withFeatureUrl(resolvedBase, "/sms", {
                limit
            });
            const res = await fetch(targetUrl, {
                method: "GET",
                headers: finalHeaders
            });
            const text = await res.text();
            return { ok: true, status: res.status, data: text };
        } catch (e) {
            return { ok: false, error: String(e) };
        }
    };

    const notificationsFeatureHandler = async (request: FastifyRequest<{ Body: DeviceFeatureRequestBody }>) => {
        const body = (request.body || {}) as DeviceFeatureRequestBody;
        const { userId, userKey, headers, targetId } = body;
        const limit = readFeatureLimit(body);
        const routeSource = extractRoutingSourceId(body as Record<string, any>, userId);
        const routeSourceCheck = ensureKnownRoutingSource(routeSource);
        if (!routeSourceCheck.allowed) {
            return { ok: false, error: "Unknown source. I don't know you", route: "source-unknown", reason: routeSourceCheck.reason };
        }

        const { record, settings } = await resolveAuthContext(userId, userKey);
        if (!record) return { ok: false, error: "Invalid credentials" };
        const ops = settings?.core?.ops || {};
        const target = Array.isArray((ops as any).httpTargets) ? (ops as any).httpTargets.find((entry: any) => entry?.id === targetId) : undefined;
        const resolvedBase = toTargetUrl(body, target?.url, false);
        const resolvedTargets = resolveFeatureTargets(body, userId);
        const payloadData = { ...((body as any).data || {}), method: body.method || "GET", limit };
        const useReverseDispatch = !resolvedBase || resolvedTargets.length > 1;

        if (useReverseDispatch) {
            if (resolvedTargets.length === 0) return { ok: false, error: "No target", feature: "notifications" };
            const dispatchResult = await dispatchFeatureToTargets(
                userId,
                routeSource,
                resolvedTargets,
                "notifications",
                payloadData,
                { wsHub, socketIoBridge, networkContext }
            );
            if (dispatchResult.targetResults.length === 1 && !dispatchResult.delivered) {
                const singleResult = dispatchResult.targetResults[0];
                if (singleResult.reason?.includes("Route denied")) {
                    return { ok: false, error: "Route denied by endpoint policy", delivered: "policy-blocked", reason: singleResult.reason };
                }
            }
            const targetIds = dispatchResult.targetResults.map((entry) => entry.target).filter((value): value is string => typeof value === "string");
            if (resolvedTargets.length === 1) {
                return {
                    ok: !!dispatchResult.delivered,
                    delivered: dispatchResult.delivered ? "ws-reverse" : "ws-reverse-missing",
                    targetDeviceId: targetIds[0],
                    mode: "reverse",
                    feature: "notifications",
                    limit
                };
            }
            return {
                ok: !!dispatchResult.delivered,
                delivered: dispatchResult.delivered ? "ws-reverse-multi" : "ws-reverse-missing",
                targetDeviceIds: targetIds,
                mode: "reverse",
                feature: "notifications",
                limit,
                targets: dispatchResult.targetResults,
                responses: dispatchResult.responses,
                attemptedTargets: dispatchResult.attemptedTargets
            };
        }

        const reverseDeviceId = resolvedTargets[0];
        const resolvedReverseDeviceId = reverseDeviceId ? resolveEndpointRouteTarget(reverseDeviceId, userId) : reverseDeviceId;
        const permission = resolvedReverseDeviceId ? checkEndpointRoutePermission(routeSource.sourceId, resolvedReverseDeviceId) : { allowed: true, reason: "" };

        if (resolvedReverseDeviceId && permission.allowed) {
            const delivery = await sendToTargetsWithFallback(userId, resolvedReverseDeviceId, reverseDispatchPayload("notifications", payloadData), { mode: "dispatch" }, { wsHub, socketIoBridge, networkContext });
            const delivered = delivery.delivered;
            return {
                ok: !!delivered,
                delivered: delivered ? "ws-reverse" : "ws-reverse-missing",
                targetDeviceId: resolvedReverseDeviceId,
                mode: "reverse",
                feature: "notifications",
                limit
            };
        }
        if (!resolvedReverseDeviceId) return { ok: false, error: "No target", feature: "notifications" };
        if (!permission.allowed) {
            return { ok: false, error: "Route denied by endpoint policy", delivered: "policy-blocked", reason: permission.reason };
        }

        if (!resolvedBase) return { ok: false, error: "No URL" };
        const finalHeaders = { ...(target?.headers || {}), ...(headers || {}) };
        try {
            const targetUrl = withFeatureUrl(resolvedBase, "/notifications", {
                limit
            });
            const res = await fetch(targetUrl, {
                method: "GET",
                headers: finalHeaders
            });
            const text = await res.text();
            return { ok: true, status: res.status, data: text };
        } catch (e) {
            return { ok: false, error: String(e) };
        }
    };

    const notificationsSpeakHandler = async (request: FastifyRequest<{ Body: DeviceFeatureRequestBody }>) => {
        const body = (request.body || {}) as DeviceFeatureRequestBody;
        const { userId, userKey, headers, targetId, text } = body;
        const message = readTextPayload(body);
        const routeSource = extractRoutingSourceId(body as Record<string, any>, userId);
        const routeSourceCheck = ensureKnownRoutingSource(routeSource);
        if (!routeSourceCheck.allowed) {
            return { ok: false, error: "Unknown source. I don't know you", route: "source-unknown", reason: routeSourceCheck.reason };
        }

        const { record, settings } = await resolveAuthContext(userId, userKey);
        if (!record) return { ok: false, error: "Invalid credentials" };
        if (!message) return { ok: false, error: "Missing text" };
        const ops = settings?.core?.ops || {};
        const target = Array.isArray((ops as any).httpTargets) ? (ops as any).httpTargets.find((entry: any) => entry?.id === targetId) : undefined;
        const resolvedBase = toTargetUrl(body, target?.url, false);
        const resolvedTargets = resolveFeatureTargets(body, userId);
        const useReverseDispatch = !resolvedBase || resolvedTargets.length > 1;
        const payload = { text: message };
        if (useReverseDispatch) {
            if (resolvedTargets.length === 0) return { ok: false, error: "No target", feature: "notifications.speak" };
            const dispatchResult = await dispatchFeatureToTargets(
                userId,
                routeSource,
                resolvedTargets,
                "notifications.speak",
                payload,
                { wsHub, socketIoBridge, networkContext }
            );
            if (dispatchResult.targetResults.length === 1 && !dispatchResult.delivered) {
                const singleResult = dispatchResult.targetResults[0];
                if (singleResult.reason?.includes("Route denied")) {
                    return { ok: false, error: "Route denied by endpoint policy", delivered: "policy-blocked", reason: singleResult.reason };
                }
            }
            const targetIds = dispatchResult.targetResults.map((entry) => entry.target).filter((value): value is string => typeof value === "string");
            if (resolvedTargets.length === 1) {
                return {
                    ok: !!dispatchResult.delivered,
                    delivered: dispatchResult.delivered ? "ws-reverse" : "ws-reverse-missing",
                    targetDeviceId: targetIds[0],
                    mode: "reverse",
                    feature: "notifications.speak"
                };
            }
            return {
                ok: !!dispatchResult.delivered,
                delivered: dispatchResult.delivered ? "ws-reverse-multi" : "ws-reverse-missing",
                targetDeviceIds: targetIds,
                mode: "reverse",
                feature: "notifications.speak",
                targets: dispatchResult.targetResults,
                responses: dispatchResult.responses,
                attemptedTargets: dispatchResult.attemptedTargets
            };
        }

        const reverseDeviceId = resolvedTargets[0];
        const resolvedReverseDeviceId = reverseDeviceId ? resolveEndpointRouteTarget(reverseDeviceId, userId) : reverseDeviceId;
        const permission = resolvedReverseDeviceId ? checkEndpointRoutePermission(routeSource.sourceId, resolvedReverseDeviceId) : { allowed: true, reason: "" };

        if (resolvedReverseDeviceId && permission.allowed) {
            const delivery = await sendToTargetsWithFallback(userId, resolvedReverseDeviceId, reverseDispatchPayload("notifications.speak", payload), { mode: "dispatch" }, { wsHub, socketIoBridge, networkContext });
            const delivered = delivery.delivered;
            return {
                ok: !!delivered,
                delivered: delivered ? "ws-reverse" : "ws-reverse-missing",
                targetDeviceId: resolvedReverseDeviceId,
                mode: "reverse",
                feature: "notifications.speak"
            };
        }
        if (!resolvedReverseDeviceId) return { ok: false, error: "No target", feature: "notifications.speak" };
        if (!permission.allowed) {
            return { ok: false, error: "Route denied by endpoint policy", delivered: "policy-blocked", reason: permission.reason };
        }

        if (!resolvedBase) return { ok: false, error: "No URL" };
        const finalHeaders = { ...(target?.headers || {}), ...(headers || {}), "Content-Type": "text/plain; charset=utf-8" };
        try {
            const targetUrl = withFeatureUrl(resolvedBase, "/notifications/speak", {});
            const res = await fetch(targetUrl, {
                method: "POST",
                headers: finalHeaders,
                body: text?.toString() || message
            });
            const responseText = await res.text();
            return { ok: true, status: res.status, data: responseText };
        } catch (e) {
            return { ok: false, error: String(e) };
        }
    };

    const contactsFeatureHandler = async (request: FastifyRequest<{ Body: DeviceFeatureRequestBody }>) => {
        const body = (request.body || {}) as DeviceFeatureRequestBody;
        const { userId, userKey, headers, targetId, query } = body;
        const routeSource = extractRoutingSourceId(body as Record<string, any>, userId);
        const routeSourceCheck = ensureKnownRoutingSource(routeSource);
        if (!routeSourceCheck.allowed) {
            return { ok: false, error: "Unknown source. I don't know you", route: "source-unknown", reason: routeSourceCheck.reason };
        }

        const { record, settings } = await resolveAuthContext(userId, userKey);
        if (!record) return { ok: false, error: "Invalid credentials" };
        const ops = settings?.core?.ops || {};
        const target = Array.isArray((ops as any).httpTargets) ? (ops as any).httpTargets.find((entry: any) => entry?.id === targetId) : undefined;
        const resolvedBase = toTargetUrl(body, target?.url, false);
        const resolvedTargets = resolveFeatureTargets(body, userId);
        const payloadData = { ...((body as any).data || {}), method: body.method || "GET" };
        if ((body as any).query) payloadData.query = (body as any).query;
        const useReverseDispatch = !resolvedBase || resolvedTargets.length > 1;

        if (useReverseDispatch) {
            if (resolvedTargets.length === 0) return { ok: false, error: "No target", feature: "contacts" };
            const dispatchResult = await dispatchFeatureToTargets(
                userId,
                routeSource,
                resolvedTargets,
                "contacts",
                payloadData,
                { wsHub, socketIoBridge, networkContext }
            );
            if (dispatchResult.targetResults.length === 1 && !dispatchResult.delivered) {
                const singleResult = dispatchResult.targetResults[0];
                if (singleResult.reason?.includes("Route denied")) {
                    return { ok: false, error: "Route denied by endpoint policy", delivered: "policy-blocked", reason: singleResult.reason };
                }
            }
            const targetIds = dispatchResult.targetResults.map((entry) => entry.target).filter((value): value is string => typeof value === "string");
            if (resolvedTargets.length === 1) {
                return {
                    ok: !!dispatchResult.delivered,
                    delivered: dispatchResult.delivered ? "ws-reverse" : "ws-reverse-missing",
                    targetDeviceId: targetIds[0],
                    mode: "reverse",
                    feature: "contacts"
                };
            }
            return {
                ok: !!dispatchResult.delivered,
                delivered: dispatchResult.delivered ? "ws-reverse-multi" : "ws-reverse-missing",
                targetDeviceIds: targetIds,
                mode: "reverse",
                feature: "contacts",
                targets: dispatchResult.targetResults,
                responses: dispatchResult.responses,
                attemptedTargets: dispatchResult.attemptedTargets
            };
        }

        const reverseDeviceId = resolvedTargets[0];
        const resolvedReverseDeviceId = reverseDeviceId ? resolveEndpointRouteTarget(reverseDeviceId, userId) : reverseDeviceId;
        const permission = resolvedReverseDeviceId ? checkEndpointRoutePermission(routeSource.sourceId, resolvedReverseDeviceId) : { allowed: true, reason: "" };

        if (resolvedReverseDeviceId && permission.allowed) {
            const delivery = await sendToTargetsWithFallback(
                userId,
                resolvedReverseDeviceId,
                reverseDispatchPayload("contacts", payloadData),
                { mode: "dispatch" },
            { wsHub, socketIoBridge, networkContext }
            );
            const delivered = delivery.delivered;
            return {
                ok: !!delivered,
                delivered: delivered ? "ws-reverse" : "ws-reverse-missing",
                targetDeviceId: resolvedReverseDeviceId,
                mode: "reverse",
                feature: "contacts"
            };
        }
        if (!resolvedReverseDeviceId) return { ok: false, error: "No target", feature: "contacts" };
        if (!permission.allowed) {
            return { ok: false, error: "Route denied by endpoint policy", delivered: "policy-blocked", reason: permission.reason };
        }

        if (!resolvedBase) return { ok: false, error: "No URL", feature: "contacts" };
        const finalHeaders = { ...(target?.headers || {}), ...(headers || {}) };
        const directMethod = (body.method || "GET").toUpperCase();
        const requestBody = (body as any).body;
        const requestData = (body as any).data;
        const requestPayload = requestBody ?? requestData;
        const payload = (directMethod === "GET" || directMethod === "HEAD")
            ? undefined
            : requestPayload == null
                ? undefined
                : typeof requestPayload === "string"
                    ? requestPayload
                    : JSON.stringify(requestPayload);

        try {
            const targetUrl = withFeatureUrl(
                resolvedBase,
                "/contacts",
                { query: query?.trim() }
            );
            const res = await fetch(targetUrl, {
                method: directMethod,
                headers: finalHeaders,
                body: payload
            });
            const responseText = await res.text();
            return { ok: true, status: res.status, data: responseText, feature: "contacts" };
        } catch (e) {
            return { ok: false, error: String(e), feature: "contacts" };
        }
    };

    const reverseDevicesHandler = async (request: FastifyRequest<{ Body: { userId: string; userKey: string } }>) => {
        const { userId, userKey } = request.body || {};
        const record = await verifyUser(userId, userKey);
        if (!record) return { ok: false, error: "Invalid credentials" };
        const profiles = wsHub.getConnectedPeerProfiles(userId);
        return {
            ok: true,
            devices: profiles.map((peer) => peer.id),
            deviceProfiles: profiles.map((peer) => ({ id: peer.id, label: peer.label }))
        };
    };

    const actionHandler = async (request: FastifyRequest<{ Body: ActionBody }>) => {
        const { userId, userKey, action, type, data, text } = request.body || {};
        const record = await verifyUser(userId, userKey);
        if (!record) return { ok: false, error: "Invalid credentials" };

        const requestedAction = (action || type || "").toString().trim().toLowerCase();
        const actionsBatch = Array.isArray(request.body?.actions) ? request.body!.actions : Array.isArray(data?.actions) ? data.actions : null;

        if (actionsBatch && actionsBatch.length > 0) {
            await executeActions(actionsBatch, app);
            return { ok: true, action: "actions", count: actionsBatch.length };
        }

        if (
            requestedAction === "clipboard" ||
            requestedAction === "clipboard.write" ||
            requestedAction === "clipboard:set" ||
            requestedAction === "clipboard/paste" ||
            requestedAction === "clipboard.insert" ||
            requestedAction === "clipboard.request" ||
            requestedAction === "clipboard.request.write" ||
            requestedAction === "clipboard.request.set" ||
            requestedAction === "clipboard.request.paste" ||
            requestedAction === "clipboard.request.insert"
        ) {
            const nextText = typeof text === "string" ? text : typeof data?.text === "string" ? data.text : "";
            if (!nextText) return { ok: false, error: "Missing clipboard text" };
            await writeClipboard(nextText);
            return { ok: true, action: "clipboard.write" };
        }

        if (
            requestedAction === "clipboard.read" ||
            requestedAction === "clipboard:get" ||
            requestedAction === "clipboard.request.read" ||
            requestedAction === "clipboard.request.get"
        ) {
            const current = await readClipboard();
            return { ok: true, action: "clipboard.read", text: current };
        }

        if (
            requestedAction === "copy" ||
            requestedAction === "clipboard.copy" ||
            requestedAction === "clipboard.request.copy"
        ) {
            executeCopyHotkey();
            return { ok: true, action: "copy" };
        }

        if (
            requestedAction === "cut" ||
            requestedAction === "clipboard.cut" ||
            requestedAction === "clipboard.request.cut"
        ) {
            executeCutHotkey();
            return { ok: true, action: "cut" };
        }

        if (
            requestedAction === "paste" ||
            requestedAction === "clipboard.paste" ||
            requestedAction === "clipboard.request.paste" ||
            requestedAction === "clipboard.request.insert"
        ) {
            const nextText = typeof text === "string" ? text : typeof data?.text === "string" ? data.text : "";
            if (nextText) await writeClipboard(nextText);
            executePasteHotkey();
            return { ok: true, action: "paste" };
        }

        // Fallback action transport: use websocket notifications for legacy notify-like behavior.
        const notifyType = (type || action || "action").toString();
        wsHub.notify(userId, notifyType, data ?? request.body);
        return { ok: true, action: notifyType, delivered: "ws-notify" };
    };

    const rootCompatHandler = async (request: FastifyRequest<{ Body: any }>) => {
        const payload = (request.body || {}) as Record<string, unknown>;
        const isBroadcastLike = Array.isArray(payload.requests) || Array.isArray(payload.addresses) || Array.isArray(payload.urls) || Array.isArray(payload.ips);

        if (isBroadcastLike) {
            return broadcastHandler(request as FastifyRequest<{ Body: HttpDispatchBody }>);
        }
        return requestHandler(request as FastifyRequest<{ Body: HttpRequestBody }>);
    };

    const normalizeScopeFilter = (value: unknown): string[] => {
        if (!value) return [];
        if (Array.isArray(value)) {
            return value
                .map((entry) => String(entry || "").trim().toLowerCase())
                .filter(Boolean)
                .filter((entry) => entry === "ws" || entry === "socketio" || entry === "bridge");
        }
        return String(value)
            .split(",")
            .map((entry) => entry.trim().toLowerCase())
            .filter(Boolean)
            .filter((entry) => entry === "ws" || entry === "socketio" || entry === "bridge");
    };

    const normalizeTextFilter = (value: unknown): string[] => {
        if (!value) return [];
        if (Array.isArray(value)) {
            return value.map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean);
        }
        return String(value)
            .split(",")
            .map((entry) => entry.trim().toLowerCase())
            .filter(Boolean);
    };

    const normalizeSocketUser = (value: unknown): string => String(value || "").trim().toLowerCase();

    const makeCanonicalNodeIds = (params: {
        direction: "to-server" | "initiated-by-server" | string;
        localNode: string;
        peerNode: string;
    }) => {
        const localNode = params.localNode || "endpoint";
        const peerNode = params.peerNode || "peer";
        if (params.direction === "initiated-by-server") {
            return {
                nodeId: peerNode,
                peerNodeId: localNode,
                source: peerNode,
                target: localNode
            };
        }
        return {
            nodeId: localNode,
            peerNodeId: peerNode,
            source: localNode,
            target: peerNode
        };
    };

const KNOWN_CONNECTION_TYPE_ROLES = new Set([
    "requestor-initiator",
    "requestor-initiated",
    "responser-initiator",
    "responser-initiated",
    "exchanger-initiator",
    "exchanger-initiated",
    "server-forward",
    "server-reverse",
    "client-forward",
    "client-reverse"
]);

const normalizeConnectionTypeRole = (value: unknown): string => String(value || "").trim().toLowerCase();

const buildConnectionRoleSet = (values: Array<unknown>): string[] => {
    const result = new Set<string>();
    for (const raw of values) {
        const value = normalizeConnectionTypeRole(raw);
        if (!value || !KNOWN_CONNECTION_TYPE_ROLES.has(value)) continue;
        result.add(value);
    }
    return Array.from(result);
};

const buildConnectionLogicalRoles = (entry: { localConnectionType?: unknown; remoteConnectionType?: unknown; role?: unknown; connectionType?: unknown }): string[] => {
    const fromRemoteConnectionType = entry.remoteConnectionType;
    const fromLocalConnectionType = entry.localConnectionType;
    const fallback = normalizeConnectionTypeRole(entry.role);
    const fallbackFromLegacy = KNOWN_CONNECTION_TYPE_ROLES.has(fallback) ? [fallback] : [];
    const fallbackFromConnectionType = normalizeConnectionTypeRole(entry.connectionType);
    const fallbackFromLegacyConnectionType = KNOWN_CONNECTION_TYPE_ROLES.has(fallbackFromConnectionType) ? [fallbackFromConnectionType] : [];
    return buildConnectionRoleSet([fromLocalConnectionType, fromRemoteConnectionType, ...fallbackFromLegacy, ...fallbackFromLegacyConnectionType]);
};

    const collectSocketIoConnectionRows = (userId: string) => {
        if (!socketIoBridge?.getConnectionRegistry || typeof socketIoBridge.getConnectionRegistry !== "function") {
            const socketIoDevices = Array.from(new Set(Array.isArray(socketIoBridge?.getConnectedDevices?.() ) ? socketIoBridge.getConnectedDevices() : []));
            return socketIoDevices.map((deviceId) => ({
                id: `socketio:${String(deviceId)}`,
                transport: "socketio" as const,
                scope: "socketio" as const,
                direction: "to-server",
                role: "airpad-client",
                state: "connected",
                userId: normalizeSocketUser(userId),
                sourceId: String(deviceId),
                namespace: "socketio",
                alias: String(deviceId),
                connectionNodeId: normalizeSocketUser(userId),
                targetNodeId: String(deviceId),
                remoteAddress: undefined,
                remotePort: undefined,
                connectionType: undefined,
                connectedAt: Date.now(),
                nodeId: normalizeSocketUser(userId),
                peerNodeId: String(deviceId),
                fromNodeId: normalizeSocketUser(userId),
                toNodeId: String(deviceId)
            }));
        }
        const rows = socketIoBridge.getConnectionRegistry();
        return rows.map((entry) => {
            const localNode = normalizeSocketUser(userId);
            const direction = (entry.direction as any) === "initiated-by-server" ? "initiated-by-server" : "to-server";
            const peerNode = entry.sourceId || entry.alias || entry.userId || entry.id;
            const canonical = makeCanonicalNodeIds({
                direction: direction as "to-server" | "initiated-by-server",
                localNode,
                peerNode
            });
            const localRoleSet = buildConnectionLogicalRoles({
                localConnectionType: entry.localConnectionType,
                remoteConnectionType: entry.remoteConnectionType,
                role: entry.role,
                connectionType: entry.connectionType
            });
            return {
                id: entry.id,
                transport: "socketio" as const,
                scope: "socketio" as const,
                direction,
                role: entry.role,
                state: entry.state,
                userId: entry.userId || localNode || "socketio",
                sourceId: entry.sourceId,
                namespace: entry.namespace || "socketio",
                localConnectionType: entry.localConnectionType,
                remoteConnectionType: entry.remoteConnectionType,
                localRoleSet,
                alias: entry.alias || entry.sourceId || entry.userId || entry.id,
                remoteAddress: entry.remoteAddress,
                remotePort: entry.remotePort,
                connectionType: entry.connectionType,
                connectedAt: entry.connectedAt || Date.now(),
                nodeId: canonical.nodeId,
                peerNodeId: canonical.peerNodeId,
                connectionNodeId: canonical.nodeId,
                targetNodeId: canonical.peerNodeId,
                fromNodeId: canonical.source,
                toNodeId: canonical.target
            };
        });
    };

    const collectWsConnectionRows = (userId: string) => {
        if (!wsHub?.getConnectionRegistry || typeof wsHub.getConnectionRegistry !== "function") return [];
        const localNode = normalizeSocketUser(userId);
        return wsHub.getConnectionRegistry(userId).map((entry) => {
            const direction = "to-server" as const;
            const peerNode = entry.peerId || entry.deviceId || entry.id;
            const canonical = makeCanonicalNodeIds({
                direction,
                localNode,
                peerNode
            });
            const localRoleSet = buildConnectionLogicalRoles({
                localConnectionType: entry.localConnectionType,
                remoteConnectionType: entry.remoteConnectionType,
                role: entry.reverse ? "server-reverse" : "server-forward",
                connectionType: entry.remoteConnectionType
            });
            return {
                id: entry.id,
                transport: "ws" as const,
                scope: "ws" as const,
                direction,
                role: entry.reverse ? "reverse-client" : "server-side-peer",
                state: "connected",
                userId: entry.userId || localNode || "ws",
                sourceId: entry.peerId || entry.deviceId || entry.id,
                namespace: entry.namespace || "ws",
                alias: entry.peerId || entry.deviceId || entry.id,
                localConnectionType: entry.localConnectionType,
                remoteConnectionType: entry.remoteConnectionType,
                localRoleSet,
                connectionNodeId: canonical.nodeId,
                targetNodeId: canonical.peerNodeId,
                remoteAddress: entry.remoteAddress,
                remotePort: undefined,
                connectionType: entry.remoteConnectionType || entry.localConnectionType,
                connectedAt: entry.connectedAt,
                nodeId: canonical.nodeId,
                peerNodeId: canonical.peerNodeId,
                fromNodeId: canonical.source,
                toNodeId: canonical.target
            };
        });
    };

    const collectBridgeRows = (userId: string, bridgeStatus: any) => {
        if (!bridgeStatus || !(bridgeStatus.connected || bridgeStatus.running)) return [];
        const localNode = normalizeSocketUser(userId || bridgeStatus.userId || "endpoint");
        const remoteNode = bridgeStatus.bridgePeerId || bridgeStatus.bridgeClientId || bridgeStatus.userId || bridgeStatus.bridgeMode || "bridge";
        const canonical = makeCanonicalNodeIds({
            direction: "initiated-by-server",
            localNode,
            peerNode: remoteNode
        });
        return [{
            id: `bridge:${bridgeStatus.bridgeClientId || bridgeStatus.bridgePeerId || bridgeStatus.userId || "default"}`,
            transport: "ws" as const,
            scope: "bridge" as const,
            direction: "initiated-by-server" as const,
            role: "bridge-connector",
            state: bridgeStatus.connected ? "connected" : "attempting",
            userId: localNode,
            sourceId: remoteNode,
            namespace: "bridge",
            alias: remoteNode,
                connectionNodeId: canonical.nodeId,
                targetNodeId: canonical.peerNodeId,
            remoteAddress: undefined,
            remotePort: undefined,
            connectionType: bridgeStatus.bridgeMode,
            connectedAt: Date.now(),
            nodeId: canonical.nodeId,
            peerNodeId: canonical.peerNodeId,
            fromNodeId: canonical.source,
            toNodeId: canonical.target
        }];
    };

    const collectSharedConnections = ({
        requestUserId,
        bridgeStatus,
        filters
    }: {
        requestUserId: string;
        bridgeStatus: any;
        filters?: {
            scope?: string[];
            direction?: string[];
            userId?: string[];
            role?: string[];
            state?: string[];
        };
    }) => {
        const normalizedUser = normalizeSocketUser(requestUserId);
        const allRows = [
            ...collectWsConnectionRows(normalizedUser),
            ...collectSocketIoConnectionRows(normalizedUser),
            ...collectBridgeRows(normalizedUser, bridgeStatus)
        ];
        const scopeFilter = normalizeScopeFilter(filters?.scope);
        const directionFilter = normalizeTextFilter(filters?.direction);
        const userIdFilter = normalizeTextFilter(filters?.userId);
        const roleFilter = normalizeTextFilter(filters?.role);
        const stateFilter = normalizeTextFilter(filters?.state);
        const filteredRows = allRows.filter((row) => {
            if (scopeFilter.length && !scopeFilter.includes(row.scope)) return false;
            if (directionFilter.length && !directionFilter.includes(String(row.direction).toLowerCase())) return false;
            if (userIdFilter.length && !userIdFilter.includes(String(row.userId).toLowerCase())) return false;
            if (roleFilter.length && !roleFilter.includes(String(row.role).toLowerCase())) return false;
            if (stateFilter.length && !stateFilter.includes(String(row.state).toLowerCase())) return false;
            return true;
        });
        return {
            allRows: filteredRows
        };
    };

    const summarizeSharedConnectionRoles = (rows: Array<{
        nodeId?: unknown;
        localConnectionType?: unknown;
        remoteConnectionType?: unknown;
        connectionType?: unknown;
        role?: unknown;
        scope?: string;
    }>) => {
        const byNode = new Map<string, Set<string>>();
        for (const row of rows) {
            const nodeId = normalizeSocketUser(row.nodeId || row.scope || "");
            if (!nodeId) continue;
            const set = byNode.get(nodeId) || new Set<string>();
            const roles = buildConnectionLogicalRoles({
                localConnectionType: row.localConnectionType,
                remoteConnectionType: row.remoteConnectionType,
                connectionType: row.connectionType,
                role: row.role
            });
            for (const role of roles) set.add(role);
            byNode.set(nodeId, set);
        }
        return Array.from(byNode.entries()).map(([nodeId, roles]) => ({
            nodeId,
            roles: Array.from(roles),
            rolesText: Array.from(roles).join(" + ") || "none"
        }));
    };

    const buildSharedConnectionGraph = (rows: Array<{
        id: string;
        scope: string;
        direction: string;
        role: string;
        state: string;
        userId: string;
        fromNodeId: string;
        toNodeId: string;
    }>) => {
        const nodeSet = new Map<string, { id: string; label: string; degree: number }>();
        const linkSet = new Map<string, {
            id: string;
            source: string;
            target: string;
            scope: string;
            direction: string;
            role: string;
            state: string;
            count: number;
        }>();

        for (const row of rows) {
            if (row.fromNodeId) {
                const from = String(row.fromNodeId).trim() || row.userId || "endpoint";
                const to = String(row.toNodeId || "").trim() || row.userId || "endpoint";
                nodeSet.set(from, {
                    id: from,
                    label: from,
                    degree: (nodeSet.get(from)?.degree || 0) + 1
                });
                nodeSet.set(to, {
                    id: to,
                    label: to,
                    degree: (nodeSet.get(to)?.degree || 0) + 1
                });
                const key = `link:${from}->${to}:${row.scope}:${row.direction}:${row.role}`;
                const existing = linkSet.get(key);
                if (existing) {
                    existing.count += 1;
                    continue;
                }
                linkSet.set(key, {
                    id: `shared-link:${from}->${to}:${row.scope}`,
                    source: from,
                    target: to,
                    scope: row.scope,
                    direction: row.direction,
                    role: row.role,
                    state: row.state,
                    count: 1
                });
            }
        }
        return {
            nodes: Array.from(nodeSet.values()).map((entry) => ({ ...entry })),
            links: Array.from(linkSet.values())
        };
    };

    const topologyHandler = async (request: FastifyRequest<{
        Body: {
            userId: string;
            userKey: string;
            scope?: unknown;
            direction?: unknown;
            userIdFilter?: unknown;
            filterUserId?: unknown;
            sharedRealTimeRegistry?: unknown;
            role?: unknown;
            state?: unknown;
        };
    }>) => {
        const { userId, userKey } = request.body || {};
        const record = await verifyUser(userId, userKey);
        if (!record) return { ok: false, error: "Invalid credentials" };

        const peers = wsHub.getConnectedDevices(userId);
        const peerProfiles = wsHub.getConnectedPeerProfiles(userId);
        const bridgeStatus = networkContext?.getBridgeStatus?.() || null;
        const sharedRealTimeRegistryEnabled = parsePortableBoolean(request.body?.sharedRealTimeRegistry);
        const includeSharedRealTimeRegistry = sharedRealTimeRegistryEnabled === false ? false : true;
        const sharedFilters = {
            scope: normalizeScopeFilter(request.body?.scope),
            direction: normalizeTextFilter(request.body?.direction),
            userId: normalizeTextFilter(request.body?.userIdFilter || request.body?.filterUserId),
            role: normalizeTextFilter(request.body?.role),
            state: normalizeTextFilter(request.body?.state)
        };
        const sharedConnections = collectSharedConnections({
            requestUserId: userId,
            bridgeStatus,
            filters: sharedFilters
        }).allRows;
        const sharedNodeRoles = summarizeSharedConnectionRoles(sharedConnections);
        const wsConnections = sharedConnections.filter((entry) => entry.scope === "ws");
        const socketIoConnections = sharedConnections.filter((entry) => entry.scope === "socketio");
        const bridgeConnections = sharedConnections.filter((entry) => entry.scope === "bridge");
        const sharedTopologyGraph = includeSharedRealTimeRegistry ? buildSharedConnectionGraph(sharedConnections) : { nodes: [], links: [] };
        const isGateway = bridgeStatus?.running === true || bridgeStatus?.connected === true;
        const configuredTopology = (config as any)?.topology;
        const configuredEndpointIds = (config as any)?.endpointIDs;
        const staticTopologyEnabled = configuredTopology && typeof configuredTopology === "object" ? (configuredTopology as Record<string, any>).enabled !== false : true;
        const staticTopologyNodes = staticTopologyEnabled
            ? Array.isArray((configuredTopology as Record<string, any>)?.nodes)
                ? ((configuredTopology as Record<string, any>).nodes as Array<Record<string, any>>)
                    .filter((node) => node && typeof node === "object" && !Array.isArray(node) && typeof (node as Record<string, any>).id === "string" && (node as Record<string, any>).id.trim())
                    .map((node) => ({
                        ...node
                    }))
                : []
            : [];
        const normalizedStaticTopologyNodes = staticTopologyNodes.map((node) => {
            const normalizedNode = node as Record<string, any>;
            return {
                ...normalizedNode,
                peerId:
                    String(normalizedNode.peerId || normalizedNode.id || "")
                        .trim()
                        .toLowerCase() || undefined,
                id: String(normalizedNode.id).trim(),
                kind: normalizedNode.kind || "node",
                surface: normalizedNode.surface || "external"
            };
        });
        const staticTopologyLinks = staticTopologyEnabled
            ? Array.isArray((configuredTopology as Record<string, any>)?.links)
                ? ((configuredTopology as Record<string, any>).links as Array<Record<string, any>>)
                    .filter((link) => {
                        if (!link || typeof link !== "object" || Array.isArray(link)) return false;
                        const source = String((link as Record<string, any>).source || "").trim();
                        const target = String((link as Record<string, any>).target || "").trim();
                        if (!source || !target) return false;
                        return true;
                    })
                    .map((link) => ({
                        id: String((link as Record<string, any>).id || `${(link as Record<string, any>).source || "unknown"}->${(link as Record<string, any>).target || "unknown"}`),
                        type: String((link as Record<string, any>).type || "topology-link"),
                        ...link
                    }))
                : []
            : [];
        const endpointIdNodes =
            typeof configuredEndpointIds === "object" && configuredEndpointIds !== null
                ? Object.entries(configuredEndpointIds).map(([id, entry]) => {
                    const peerPolicy = entry && typeof entry === "object" ? (entry as Record<string, any>) : {};
                    return {
                        id: String(id || "").trim(),
                        kind: "peer",
                        peerId: String(id || "")
                            .trim()
                            .toLowerCase(),
                        role: peerPolicy?.flags?.gateway === true ? "gateway" : "endpoint-peer",
                        surface: "external",
                        origin: {
                            hosts: Array.isArray(peerPolicy.origins) ? peerPolicy.origins : [],
                            forward: typeof peerPolicy.forward === "string" ? peerPolicy.forward : "self",
                            flags: peerPolicy.flags || {}
                        },
                        forward: typeof peerPolicy.forward === "string" ? peerPolicy.forward : "self",
                        tokens: peerPolicy.tokens || [],
                        allowedIncoming: peerPolicy.allowedIncoming || ["*"],
                        allowedOutcoming: peerPolicy.allowedOutcoming || ["*"]
                    };
                })
                : [];

        const localNodes = [
            {
                id: `${userId}`,
                kind: "node",
                role: isGateway ? "gateway+endpoint" : "endpoint",
                peers: peers.length,
                peerId: userId,
                surface: "local",
                origin: undefined
            },
            ...peerProfiles.map((peer) => ({
                id: `${userId}:${peer.id}`,
                peerId: (peer as any).peerId || peer.id,
                kind: "peer",
                parent: `${userId}`,
                deviceId: peer.id,
                label: peer.label,
                surface: "local",
                origin: undefined
            }))
        ];

        const staticNodeKeys = new Set(
            normalizedStaticTopologyNodes.map((node) =>
                String(node.peerId || node.id || "")
                    .trim()
                    .toLowerCase()
            )
        );
        for (const endpointNode of endpointIdNodes) {
            const key = String(endpointNode.peerId || endpointNode.id || "")
                .trim()
                .toLowerCase();
            if (!key) continue;
            if (!staticNodeKeys.has(key)) {
                staticNodeKeys.add(key);
                normalizedStaticTopologyNodes.push(endpointNode);
            }
        }
        const mergedTopologyNodes: Array<Record<string, any>> = [...normalizedStaticTopologyNodes];
        for (const node of localNodes) {
            const key = String(node.peerId || node.id || "")
                .trim()
                .toLowerCase();
            if (!key) continue;
            if (!staticNodeKeys.has(key)) {
                mergedTopologyNodes.push(node);
                staticNodeKeys.add(key);
            }
        }

        if (bridgeStatus) {
            const bridgeKey = bridgeStatus.bridgeClientId || bridgeStatus.bridgePeerId || bridgeStatus.userId || `bridge:${userId}`;
            mergedTopologyNodes.push({
                id: `bridge:${bridgeKey}`,
                kind: "node",
                role: bridgeStatus.connected ? "gateway" : bridgeStatus.running ? "gateway-passive" : "gateway-offline",
                parent: isGateway ? `${userId}` : undefined,
                connected: bridgeStatus.connected,
                peerId: bridgeStatus.bridgePeerId || bridgeStatus.userId || bridgeKey,
                bridgeMode: bridgeStatus.bridgeMode || undefined,
                bridgeRole: bridgeStatus.bridgeRole,
                origin: bridgeStatus.origin || {
                    originId: bridgeStatus.bridgeClientId || bridgeStatus.userId
                },
                surface: bridgeStatus.bridgeMode === "passive" ? "local" : "external"
            });
        }

        const links = [
            ...peerProfiles.map((peer) => ({
                id: `link:${userId}:${peer.id}`,
                source: `${userId}`,
                target: `${userId}:${peer.id}`,
                type: "ws-peer"
            }))
        ];

        if (bridgeStatus && (bridgeStatus.connected || bridgeStatus.running || bridgeStatus.bridgeEnabled)) {
            links.push({
                id: `link:${userId}:bridge`,
                source: `${userId}`,
                target: `bridge:${bridgeStatus.bridgeClientId || bridgeStatus.bridgePeerId || bridgeStatus.userId || "default"}`,
                type: "client-reverse"
            });
        }

        const staticLinkIds = new Set(staticTopologyLinks.map((link) => String(link.id).toLowerCase()));
        for (const link of links) {
            if (!staticLinkIds.has(String(link.id).toLowerCase())) {
                staticTopologyLinks.push(link);
            }
        }

        return {
            ok: true,
            nodes: mergedTopologyNodes,
            links: staticTopologyLinks,
            connections: {
                total: wsConnections.length + socketIoConnections.length + bridgeConnections.length,
                incoming: wsConnections.length + socketIoConnections.length,
                outgoing: bridgeConnections.length,
                list: [...wsConnections, ...socketIoConnections, ...bridgeConnections]
            },
            sharedRealTimeRegistry: {
                enabled: includeSharedRealTimeRegistry,
                scope: includeSharedRealTimeRegistry ? ["ws", "socketio", "bridge"] : [],
                filters: {
                    scope: sharedFilters.scope,
                    direction: sharedFilters.direction,
                    userId: sharedFilters.userId,
                    role: sharedFilters.role,
                    state: sharedFilters.state
                },
                grouped: {
                    ws: includeSharedRealTimeRegistry ? wsConnections : [],
                    socketio: includeSharedRealTimeRegistry ? socketIoConnections : [],
                    bridge: includeSharedRealTimeRegistry ? bridgeConnections : []
                },
                nodeRoles: sharedNodeRoles,
                totals: {
                    total: includeSharedRealTimeRegistry ? sharedConnections.length : 0,
                    toServer: includeSharedRealTimeRegistry ? wsConnections.length + socketIoConnections.length : 0,
                    initiated: includeSharedRealTimeRegistry ? bridgeConnections.length : 0
                },
                graph: sharedTopologyGraph
            },
            topology: {
                enabled: staticTopologyEnabled,
                nodes: Array.isArray(mergedTopologyNodes) ? mergedTopologyNodes.length : 0,
                links: Array.isArray(staticTopologyLinks) ? staticTopologyLinks.length : 0,
                source: "config+runtime"
            },
            peers,
            units: [
                {
                    id: userId,
                    kind: "unit",
                    nodes: peers.map((peer) => `${userId}:${peer}`).concat(userId)
                },
                {
                    id: "bridge",
                    kind: "unit",
                    active: !!bridgeStatus
                }
            ],
            bridge: bridgeStatus || null
        };
    };

    const connectionRegistryHandler = async (request: FastifyRequest<{
        Body: {
            userId: string;
            userKey: string;
            scope?: unknown;
            direction?: unknown;
            userIdFilter?: unknown;
            filterUserId?: unknown;
            sharedRealTimeRegistry?: unknown;
            role?: unknown;
            state?: unknown;
        };
    }>) => {
        const { userId, userKey } = request.body || {};
        const record = await verifyUser(userId, userKey);
        if (!record) return { ok: false, error: "Invalid credentials" };
        const bridgeStatus = networkContext?.getBridgeStatus?.() || null;
        const sharedRealTimeRegistryEnabled = parsePortableBoolean(request.body?.sharedRealTimeRegistry);
        const includeSharedRealTimeRegistry = sharedRealTimeRegistryEnabled === false ? false : true;
        const registryFilters = {
            scope: normalizeScopeFilter(request.body?.scope),
            direction: normalizeTextFilter(request.body?.direction),
            userId: normalizeTextFilter(request.body?.userIdFilter || request.body?.filterUserId),
            role: normalizeTextFilter(request.body?.role),
            state: normalizeTextFilter(request.body?.state)
        };
        const sharedConnections = collectSharedConnections({
            requestUserId: userId,
            bridgeStatus,
            filters: registryFilters
        }).allRows;
        const sharedNodeRoles = summarizeSharedConnectionRoles(sharedConnections);
        const sharedTopologyGraph = includeSharedRealTimeRegistry ? buildSharedConnectionGraph(sharedConnections) : { nodes: [], links: [] };
        const wsConnectionRows = sharedConnections.filter((entry) => entry.scope === "ws");
        const socketIoRows = sharedConnections.filter((entry) => entry.scope === "socketio");
        const bridgeRows = sharedConnections.filter((entry) => entry.scope === "bridge");

        const peers = Array.from(new Set(wsHub.getConnectedDevices(userId)));

        return {
            ok: true,
            userId,
            totals: {
                total: wsConnectionRows.length + socketIoRows.length + bridgeRows.length,
                toServer: wsConnectionRows.length + socketIoRows.length,
                initiated: bridgeRows.length
            },
            peerCount: peers.length,
            connections: {
                ws: wsConnectionRows.map((row) => ({ ...row, startedAt: row.connectedAt ? new Date(row.connectedAt).toISOString() : null })),
                socketio: socketIoRows.map((row) => ({ ...row, startedAt: row.connectedAt ? new Date(row.connectedAt).toISOString() : null })),
                bridge: bridgeRows.map((row) => ({
                    ...row,
                    startedAt: row.connectedAt ? new Date(row.connectedAt).toISOString() : null
                }))
            },
            list: [...wsConnectionRows, ...socketIoRows, ...bridgeRows].map((row) => ({
                ...row,
                startedAt: row.connectedAt ? new Date(row.connectedAt).toISOString() : null
            })),
            sharedRealTimeRegistry: {
                enabled: includeSharedRealTimeRegistry,
                scope: includeSharedRealTimeRegistry ? ["ws", "socketio", "bridge"] : [],
                filters: {
                    scope: registryFilters.scope,
                    direction: registryFilters.direction,
                    userId: registryFilters.userId,
                    role: registryFilters.role,
                    state: registryFilters.state
                },
                grouped: {
                    ws: includeSharedRealTimeRegistry ? wsConnectionRows.map((row) => ({ ...row, startedAt: row.connectedAt ? new Date(row.connectedAt).toISOString() : null })) : [],
                    socketio: includeSharedRealTimeRegistry ? socketIoRows.map((row) => ({ ...row, startedAt: row.connectedAt ? new Date(row.connectedAt).toISOString() : null })) : [],
                    bridge: includeSharedRealTimeRegistry ? bridgeRows.map((row) => ({ ...row, startedAt: row.connectedAt ? new Date(row.connectedAt).toISOString() : null })) : []
                },
                nodeRoles: sharedNodeRoles,
                graph: sharedTopologyGraph
            },
        };
    };

    const protocolStatusHandler = async (request: FastifyRequest<{ Body: { userId: string; userKey: string } }>) => {
        const { userId, userKey } = request.body || {};
        const record = await verifyUser(userId, userKey);
        if (!record) return { ok: false, error: "Invalid credentials" };

        const bridgeStatus = networkContext?.getBridgeStatus?.() || null;
        const wsPeers = Array.isArray(wsHub?.getConnectedDevices?.(userId)) ? wsHub.getConnectedDevices(userId).length : 0;
        const wsPeerProfiles = Array.isArray(wsHub?.getConnectedPeerProfiles?.(userId)) ? wsHub.getConnectedPeerProfiles(userId) : [];
        const socketIoClients = typeof socketIoBridge?.getConnectedDevices === "function"
            ? socketIoBridge.getConnectedDevices().map(String)
            : [];

        return {
            ok: true,
            timestamp: new Date().toISOString(),
            protocolStatus: {
                websocket: {
                    available: true,
                    active: wsPeers > 0,
                    peers: wsPeers,
                    profiles: wsPeerProfiles.length
                },
                socketio: {
                    available: true,
                    active: socketIoClients.length > 0,
                    clients: socketIoClients.length
                },
                bridge: {
                    running: !!bridgeStatus?.running,
                    connected: !!bridgeStatus?.connected,
                    bridgeEnabled: !!bridgeStatus?.bridgeEnabled,
                    bridgeMode: bridgeStatus?.bridgeMode || null,
                    bridgeRole: bridgeStatus?.bridgeRole || null,
                    bridgeSurface: bridgeStatus?.surface || null
                },
                endpoint: {
                    topologyEnabled: true,
                    hasTopology: true,
                    hasBridgeStatus: !!bridgeStatus
                }
            }
        };
    };

    const networkDispatchHandler = async (request: FastifyRequest<{ Body: NetworkDispatchBody }>) => {
        const { userId, userKey, route = "auto", target, targetId, deviceId, peerId, namespace, ns, type, action, data, payload, broadcast, targets } = request.body || {};
        const parsedBroadcast = parsePortableBoolean(broadcast);
        const routeSource = extractRoutingSourceId(request.body as Record<string, any>, userId);
        const routeSourceCheck = ensureKnownRoutingSource(routeSource);
        if (!routeSourceCheck.allowed) {
            return { ok: false, error: "Unknown source. I don't know you", route: "source-unknown", reason: routeSourceCheck.reason };
        }
        const record = await verifyUser(userId, userKey);
        if (!record) return { ok: false, error: "Invalid credentials" };
        const dispatchHub = wsHub;
        if (!dispatchHub || typeof dispatchHub.getConnectedPeerProfiles !== "function" || typeof dispatchHub.multicast !== "function") {
            return { ok: false, error: "Internal server error: wsHub unavailable" };
        }

        const messagePayload = payload ?? data ?? {};
        const destination = resolveEndpointRouteTarget(targetId || deviceId || peerId || target || "", userId);
        const normalizedTargets = Array.isArray(targets) ? targets.map((item) => resolveEndpointRouteTarget(String(item || "").trim(), userId)).filter(Boolean) : [];
        const normalizedNamespace = typeof namespace === "string" && namespace.trim() ? namespace.trim() : typeof ns === "string" && ns.trim() ? ns.trim() : undefined;

        const peerProfiles = dispatchHub.getConnectedPeerProfiles(userId);
        const localPeers = makeTargetTokenSet(dispatchHub.getConnectedDevices(userId));
        const localLabels = makeTargetTokenSet(peerProfiles.map((peer) => peer.label));
        const localIds = makeTargetTokenSet(peerProfiles.map((peer) => peer.id));
        const localPeerIds = makeTargetTokenSet(peerProfiles.map((peer) => String((peer as any).peerId || peer.id)));
        const allLocalTargets = new Set([...localPeers, ...localLabels, ...localIds, ...localPeerIds]);
        const isLocalTarget = (value: string) => {
            const normalized = value.trim().toLowerCase();
            return allLocalTargets.has(normalized) || resolveEndpointIdPolicyStrict(endpointPolicyMap, normalized) != null;
        };
        const surface = inferNetworkSurface(request.socket?.remoteAddress || (request.headers?.["x-forwarded-for"] as string | undefined));
        const configuredBroadcastTargets = Array.isArray((config as any)?.broadcastTargets) ? (config as any).broadcastTargets.map((entry: any) => resolveDispatchTarget(String(entry || ""))) : [];
        const audience = resolveDispatchAudience({
            target: destination,
            targets: normalizedTargets,
            broadcast: parsedBroadcast,
            implicitTargets: configuredBroadcastTargets.map((target) => resolveNetworkTargetWithPeerIdentity(target, userId))
        });

        const requestedTargets = audience.targets.length > 0 ? audience.targets : [destination];
        type DispatchPolicyCheckedTarget = {
            target: string;
            localDeliveryTargets: string[];
        };
        const policyCheckedTargets = requestedTargets
            .map((targetValue) => {
                if (!targetValue) return undefined;
                const resolved = resolveNetworkTargetWithPeerIdentity(targetValue, userId) || targetValue;
                const resolvedForward = resolveEndpointRouteTarget(resolved, userId);
                const permission = checkEndpointRoutePermission(routeSource.sourceId, resolvedForward);
                if (!permission.allowed) {
                    console.warn("[network/dispatch] route denied by endpoint policy", `source=${routeSource.sourceId}`, `target=${resolvedForward}`, permission.reason);
                    return undefined;
                }
                const delivery = resolveEndpointDeliveryTargets(resolvedForward, userId);
                const resolvedTargets = delivery.ordered.length ? delivery.ordered : [resolvedForward];
                return {
                    target: resolvedForward,
                    localDeliveryTargets: resolvedTargets
                };
            })
            .filter((entry): entry is DispatchPolicyCheckedTarget => entry !== undefined && entry !== null);
        if (requestedTargets.length > 0 && policyCheckedTargets.length === 0) {
            return {
                ok: false,
                error: "Route denied by endpoint policy",
                route: "policy-block",
                target: typeof destination === "string" ? destination : "",
                targets: requestedTargets,
                reason: "all requested targets denied by endpoint policy"
            };
        }

        const audienceDecisions = policyCheckedTargets.map(({ target, localDeliveryTargets }) => {
            const targetValue = typeof target === "string" ? target.trim() : "";
            return {
                target: targetValue,
                localDeliveryTargets,
                plan: resolveDispatchPlan({
                    route,
                    target: targetValue || undefined,
                    hasBridgeTransport: typeof networkContext?.sendToBridge === "function",
                    isLocalTarget,
                    surface
                })
            };
        });

        const bridgeDecisionTargets = audienceDecisions.filter((entry) => entry.plan.bridge && entry.plan.route !== "none").map((entry) => entry.target);

        const shouldBroadcastLocally = audience.source === "implicit-local-broadcast" || (!audience.targets.length && (typeof destination !== "string" || !destination.trim()));
        const audienceRouteHints = audienceDecisions.map((entry) => entry.plan.route);
        const localPlan = audienceRouteHints.some((entry) => entry === "local" || entry === "both");
        const bridgePlan = audienceRouteHints.some((entry) => entry === "bridge" || entry === "both");
        const aggregateRoute: DispatchRouteDecision["route"] = localPlan && bridgePlan ? "both" : localPlan ? "local" : bridgePlan ? "bridge" : "none";
        const reasonSet = new Set(audienceDecisions.map((entry) => entry.plan.reason));
        const aggregateReason = reasonSet.size === 1 ? Array.from(reasonSet)[0] : Array.from(reasonSet).join("; ");

        const payloadEnvelope = {
            type: String(type || action || "dispatch"),
            from: routeSource.sourceId,
            namespace: normalizedNamespace,
            data: messagePayload
        };

        const targetValue = destination.trim ? destination.trim() : destination;
        const localDeliveryPromise = (async () => {
            if (!localPlan) return false;
            const localDecisionEntries = audienceDecisions.filter((entry) => entry.plan.local && entry.target);

            if (shouldBroadcastLocally || localDecisionEntries.length === 0) {
                dispatchHub.multicast(userId, payloadEnvelope, normalizedNamespace);
                return true;
            }

            const results = await Promise.all(localDecisionEntries.map((entry) => sendToTargetsWithFallback(userId, entry.target, payloadEnvelope, { mode: "dispatch" }, { wsHub: dispatchHub, socketIoBridge })));
            return results.some((result) => result.delivered);
        })();

        const bridgeDispatchPromise = (async () => {
            if (!bridgePlan || !networkContext?.sendToBridge) return false;
            const bridgeTargets = Array.from(new Set(bridgeDecisionTargets.filter(Boolean)));
            const bridgePayloads = bridgeTargets.length > 0 ? bridgeTargets.map((item) => ({ ...payloadEnvelope, targetId: item, target: item, to: item })) : [payloadEnvelope];

            const results = await Promise.all(bridgePayloads.map((bridgePayload) => networkContext?.sendToBridge?.(bridgePayload) || false));
            return results.some(Boolean);
        })();

        const [localDelivered, bridgeDispatched] = await Promise.all([localDeliveryPromise, bridgeDispatchPromise]);

        if (!localPlan && !bridgePlan) {
            return {
                ok: false,
                error: aggregateReason,
                route: aggregateRoute,
                delivered: {
                    local: localDelivered,
                    bridge: bridgeDispatched,
                    target: targetValue || null
                },
                routePlan: {
                    decided: aggregateRoute,
                    reason: aggregateReason,
                    local: localPlan,
                    bridge: bridgePlan,
                    audience
                }
            };
        }

        return {
            ok: true,
            route: aggregateRoute,
            delivered: {
                local: localDelivered,
                bridge: bridgeDispatched,
                target: targetValue || null,
                targets: policyCheckedTargets.map((entry) => entry.target)
            },
            routePlan: {
                decided: aggregateRoute,
                reason: aggregateReason,
                local: localPlan,
                bridge: bridgePlan,
                audience,
                decisions: audienceDecisions.map((entry) => ({
                    target: entry.target,
                    route: entry.plan.route,
                    local: entry.plan.local,
                    bridge: entry.plan.bridge,
                    reason: entry.plan.reason
                }))
            }
        };
    };

    // Legacy and new aliases:
    // - /api/request: targeted request delivery (legacy /core/ops/http)
    //   plus legacy secure variant (/core/ops/https) and partial notify fallback
    // - /api/broadcast: multi-peer dispatch (legacy /core/ops/http/dispatch and /core/ops/http/disp)
    //   plus partial notify multicast fallback
    // - /api/ws: ws send operation (legacy /core/ops/ws/send)
    // - /api/action: host/device action endpoint (legacy /clipboard, /sms, partial notify)
    // - /api/devices, /api/sms, /api/contacts, /api/notifications and /api/notifications/speak:
    //   feature mirrors for device capability requests
    app.post("/core/ops/http", requestHandler);
    app.post("/core/ops/https", requestHandler);
    app.post("/api/request", requestHandler);
    app.post("/", rootCompatHandler);

    app.post("/core/ops/devices", featureDevicesHandler);
    app.post("/api/devices", featureDevicesHandler);
    app.post("/core/ops/sms", smsFeatureHandler);
    app.post("/api/sms", smsFeatureHandler);
    app.post("/core/ops/contacts", contactsFeatureHandler);
    app.post("/api/contacts", contactsFeatureHandler);
    app.post("/core/ops/notifications", notificationsFeatureHandler);
    app.post("/api/notifications", notificationsFeatureHandler);
    app.post("/core/ops/notifications/speak", notificationsSpeakHandler);
    app.post("/api/notifications/speak", notificationsSpeakHandler);

    app.post("/core/ops/http/dispatch", broadcastHandler);
    app.post("/core/ops/http/disp", broadcastHandler);
    app.post("/api/broadcast", broadcastHandler);

    app.post("/core/ops/ws/send", wsSendHandler);
    app.post("/api/ws", wsSendHandler);
    app.post("/core/reverse/send", reverseSendHandler);
    app.post("/api/reverse/send", reverseSendHandler);
    app.post("/core/reverse/devices", reverseDevicesHandler);
    app.post("/api/reverse/devices", reverseDevicesHandler);
    app.post("/core/network/topology", topologyHandler);
    app.post("/api/network/topology", topologyHandler);
    app.post("/core/network/connections", connectionRegistryHandler);
    app.post("/api/network/connections", connectionRegistryHandler);
    app.post("/core/network/status", protocolStatusHandler);
    app.post("/api/network/status", protocolStatusHandler);
    app.post("/core/network/dispatch", networkDispatchHandler);
    app.post("/api/network/dispatch", networkDispatchHandler);
    app.post("/core/network/fetch", networkFetchHandler);
    app.post("/api/network/fetch", networkFetchHandler);
    app.post("/core/request/fetch", legacyNetworkFetchAlias);
    app.post("/api/request/fetch", legacyNetworkFetchAlias);

    app.post("/core/ops/notify", notifyHandler);
    app.post("/api/action", actionHandler);
};

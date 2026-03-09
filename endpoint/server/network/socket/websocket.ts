import { WebSocketServer, type WebSocket } from "ws";
import type { FastifyInstance } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { connect as createTcpConnection, type Socket as NetSocket } from "node:net";

import config from "../../config/config.ts";
import { loadUserSettings } from "../../lib/users.ts";
import { isBroadcast, normalizeSocketFrame } from "../stack/messages.ts";
import { inferNetworkSurface } from "../stack/topology.ts";
import { pickEnvBoolLegacy, pickEnvStringLegacy } from "../../lib/env.ts";
import { parsePortableInteger, safeJsonParse } from "../../lib/parsing.ts";
import { normalizeEndpointPolicies, resolveEndpointIdPolicyStrict } from "../stack/endpoint-policy.ts";
import {
    type WsConnectionType,
    type WsConnectionIntent,
    areConnectionTypesCompatible,
    inferExpectedRemoteConnectionType,
    inferServerSideConnectionType,
    parseWsConnectionType,
    describeDisplayConnectionType,
    toDisplayTopology,
    supportsConnectorRole,
    supportsReverseServerConnectionType,
    supportsForwardServerConnectionType
} from "../stack/connection-types.ts";

type TcpPassthroughFrame = {
    type: string;
    sessionId?: string;
    host?: string;
    target?: string;
    port?: number | string;
    data?: string;
    targetPort?: number | string;
    timeoutMs?: number;
    payload?: any;
    protocol?: "tcp" | "tcp4" | "tcp6";
};

type TcpSession = {
    id: string;
    host: string;
    port: number;
    socket: NetSocket;
};

const parsePrivateNetworkHosts = (): Set<string> => {
    const raw = pickEnvStringLegacy("CWS_WS_TCP_ALLOW_HOSTS", { allowEmpty: true }) ?? pickEnvStringLegacy("WS_TCP_ALLOW_HOSTS", { allowEmpty: true }) ?? "";
    if (!raw.trim()) return new Set<string>();
    return new Set(
        raw
            .split(",")
            .map((value) => value.trim().toLowerCase())
            .filter(Boolean)
    );
};

const isLocalHost = (value: string): boolean => {
    const lower = value.toLowerCase();
    return lower === "localhost" || lower === "127.0.0.1" || lower === "::1";
};

const isPrivateIpv4 = (value: string): boolean => {
    if (value.startsWith("10.")) return true;
    if (value.startsWith("192.168.")) return true;
    if (value.startsWith("172.")) {
        const second = parsePortableInteger(value.split(".")[1] || 0);
        return second !== undefined && second >= 16 && second <= 31;
    }
    return false;
};

const isPrivateIpv6 = (value: string): boolean => {
    return value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80");
};

const isIpAddress = (value: string): boolean => {
    return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) || /^[0-9a-fA-F:]+$/.test(value);
};

const isWebSocketTunnelDebug = (): boolean => {
    return pickEnvBoolLegacy("CWS_TUNNEL_DEBUG") === true;
};

const getWebSocketProtocol = (req: any): "ws" | "wss" => {
    return req?.socket?.encrypted === true ? "wss" : "ws";
};

type WebSocketFrameActor = {
    id?: string;
    token?: string;
    ip?: string;
    raw?: string;
    source?: "socket-id" | "device" | "user" | "unknown";
};

const isSocketUuid = (value: string): boolean => {
    const candidate = String(value || "").trim().toLowerCase();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(candidate);
};

const stripFramePort = (value: string): string => {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (raw.startsWith("[") && raw.includes("]:")) {
        const close = raw.lastIndexOf("]:");
        return raw.slice(1, close);
    }
    if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(raw)) {
        return raw.replace(/:\d+$/, "");
    }
    const colon = raw.lastIndexOf(":");
    if (colon <= 0) return raw;
    return raw.substring(0, colon);
};

const buildWsActor = (raw: string, clients: Map<WebSocket, ClientInfo>, fallbackClient: ClientInfo): WebSocketFrameActor => {
    const rawTrimmed = String(raw || "").trim();
    if (!rawTrimmed) {
        return { raw: "", source: "unknown" };
    }
    const normalized = normalizeSocketPeer(rawTrimmed);
    const byConnection = Array.from(clients.values()).find((entry) => {
        if (normalizeSocketPeer(entry.id) === normalized) return true;
        if (normalizeSocketPeer(entry.deviceId || "") === normalized) return true;
        if (normalizeSocketPeer(entry.peerId || "") === normalized) return true;
        if (normalizeSocketPeer(entry.userId || "") === normalized) return true;
        const aliases = [
            ...resolveTargetAlias(entry.deviceId || ""),
            ...resolveTargetAlias(entry.peerId || ""),
            normalizeSocketPeer(entry.userId || ""),
            normalizeSocketPeer(entry.id)
        ];
        return aliases.some((alias) => alias === normalized);
    });
    if (!byConnection) {
        return {
            raw: rawTrimmed,
            source: isSocketUuid(rawTrimmed) ? "socket-id" : "unknown",
            id: isSocketUuid(rawTrimmed) ? rawTrimmed : undefined,
            ip: byConnection?.remoteAddress
        };
    }
    const isCurrent = byConnection.id === fallbackClient.id;
    return {
        raw: rawTrimmed,
        source: isSocketUuid(rawTrimmed) ? "socket-id" : byConnection.deviceId ? "device" : "user",
        id: byConnection.deviceId || byConnection.peerId || byConnection.id,
        token: byConnection.userKey || (isCurrent ? fallbackClient.userKey : undefined),
        ip: byConnection.remoteAddress
    };
};

const actorToken = (actor: WebSocketFrameActor, fallbackClient: ClientInfo): string => {
    return actor.token || fallbackClient.userKey || "-";
};

const normalizeOptionalIp = (value: string | undefined): string => {
    const trimmed = String(value || "").trim();
    return trimmed || "-";
};

const resolvePolicyKnownIpHint = (rawTarget: string): string => {
    const policyMap = normalizeEndpointPolicies((config as any)?.endpointIDs || {});
    const normalizedTarget = normalizeSocketPeer(stripFramePort(rawTarget).replace(/^[hlp]-/, ""));
    if (!normalizedTarget) return "";
    const candidateTargets = [rawTarget, normalizedTarget, `l-${normalizedTarget}`, `h-${normalizedTarget}`, `p-${normalizedTarget}`];
    for (const candidate of candidateTargets) {
        const policy = resolveEndpointIdPolicyStrict(policyMap, normalizeSocketPeer(candidate));
        if (!policy) continue;
        const origins = Array.isArray(policy.origins) ? policy.origins : [];
        for (const origin of origins) {
            const normalizedOrigin = normalizeSocketPeer(stripFramePort(String(origin || "")));
            if (normalizedOrigin) return normalizedOrigin;
        }
    }
    return "";
};

const formatWsFrameLog = (
    direction: string,
    req: any,
    info: ClientInfo,
    frame: any,
    clients: Map<WebSocket, ClientInfo>,
    target?: string,
    targetClient?: ClientInfo,
    sourceClient?: ClientInfo,
    delivered = false
): string => {
    const localAddress = req?.socket?.localAddress || "unknown";
    const localPort = req?.socket?.localPort || "";
    const remoteAddress = req?.socket?.remoteAddress || "unknown";
    const remotePort = req?.socket?.remotePort || "";
    const resolvedFrameSource = buildWsActor(String(frame?.from || ""), clients, info);
    const resolvedTarget = buildWsActor(String(target || frame?.to || ""), clients, info);
    const directionTarget = String(target || frame?.to || "").trim();
    const targetKind = isIpLike(stripFramePort(directionTarget)) ? "ip" : "id";
    const type = String(frame?.type || "").trim();
    const fromToken = actorToken(resolvedFrameSource, info);
    const toToken = actorToken(resolvedTarget, targetClient ? targetClient : info);
    const byToken = info.userKey || fromToken;
    const fromId = resolvedFrameSource.id || (isSocketUuid(resolvedFrameSource.raw || "") ? resolvedFrameSource.raw : "-");
    const toId = targetClient?.deviceId || targetClient?.peerId || targetClient?.id || targetClient?.userId || resolvedTarget.id || "-";
    const fromIp = sourceClient?.remoteAddress || resolvedFrameSource.ip || "-";
    const toIp = targetClient?.remoteAddress || (targetKind === "ip" ? stripFramePort(directionTarget) : resolvedTarget.ip || "-");
    const fromIpKnown = resolvePolicyKnownIpHint(fromId || resolvedFrameSource.raw || "") || fromIp;
    const toIpKnown = resolvePolicyKnownIpHint(toId || directionTarget || "") || toIp;
    const fromKind = resolvedFrameSource.source || "unknown";
    const toKind = targetKind === "ip" ? "ip" : targetClient ? "id" : resolvedTarget.source || "unknown";
    const srcId = fromId;
    const dstId = toId;
    const srcIp = fromIp;
    const dstIp = toIp;
    const srcToken = fromToken;
    const dstToken = toToken;
    const lines: string[] = [
        `[ws] ${direction}`,
        `  proto=${getWebSocketProtocol(req)}`,
        `  local=${localAddress}:${localPort}`,
        `  remote=${remoteAddress}:${remotePort}`,
        `  userId=${info.userId || "unknown"}`,
        `  deviceId=${info.deviceId || "unknown"}`,
        `  byToken=${byToken}`,
        `  from=${resolvedFrameSource.raw || "-"}`,
        `  fromKind=${fromKind}`,
        `  fromId=${fromId}`,
        `  fromIp=${fromIp}`,
        `  fromIpKnown=${fromIpKnown}`,
        `  fromToken=${fromToken}`,
        `  srcId=${srcId}`,
        `  srcIp=${srcIp}`,
        `  srcIpKnown=${fromIpKnown}`,
        `  srcToken=${srcToken}`,
        `  toToken=${toToken}`,
        `  dstId=${dstId}`,
        `  dstIp=${normalizeOptionalIp(dstIp)}`,
        `  dstIpKnown=${normalizeOptionalIp(toIpKnown)}`,
        `  dstToken=${dstToken}`,
        `  type=${type || "unknown"}`,
        `  to=${directionTarget || "-"}`,
        `  toKind=${toKind}`
    ];
    if (targetKind === "ip") {
        lines.push(`  toIp=${stripFramePort(directionTarget)}`);
        lines.push(`  toIpKnown=${toIpKnown}`);
    } else {
        lines.push(`  toId=${toId}`);
        lines.push(`  toIp=${toIp}`);
        lines.push(`  toIpKnown=${toIpKnown}`);
    }
    lines.push(`  delivered=${delivered ? "yes" : "no"}`);
    return lines.join("\n");
};

const parsePort = (raw?: unknown): number | undefined => {
    if (typeof raw === "number" || typeof raw === "string") {
        const parsed = parsePortableInteger(raw);
        return parsed !== undefined && parsed > 0 && parsed <= 65535 ? parsed : undefined;
    }
    return undefined;
};

const parseTcpEndpoint = (frame: TcpPassthroughFrame): { host: string; port?: number } | undefined => {
    const hostInput = typeof frame.target === "string" && frame.target.trim() ? frame.target.trim() : typeof frame.host === "string" && frame.host.trim() ? frame.host.trim() : undefined;
    if (!hostInput) return undefined;

    try {
        const maybeUrl = hostInput.includes("://") ? new URL(hostInput) : new URL(`tcp://${hostInput}`);
        const host = maybeUrl.hostname?.toLowerCase();
        if (!host) return undefined;
        const port = parsePort(maybeUrl.port || frame.port || frame.targetPort);
        return { host, port };
    } catch {
        const directPortMatch = hostInput.match(/^(.*):(\d{1,5})$/);
        if (directPortMatch) {
            const host = directPortMatch[1].trim().toLowerCase();
            return { host, port: parsePort(directPortMatch[2]) };
        }
        return { host: hostInput.toLowerCase(), port: parsePort(frame.port || frame.targetPort) };
    }
};

const isTcpTargetAllowed = (host: string, explicitPort: number | undefined): boolean => {
    const explicitAllowed = parsePrivateNetworkHosts();
    if (explicitAllowed.has(host)) return true;
    if (explicitAllowed.has(host.replace(/^www\./, ""))) return true;

    if (pickEnvBoolLegacy("CWS_WS_TCP_ALLOW_ALL", false) === true || pickEnvBoolLegacy("WS_TCP_ALLOW_ALL", false) === true) return true;

    if (isLocalHost(host) || isPrivateIpv4(host) || isPrivateIpv6(host)) return true;
    if (isIpAddress(host)) return false;

    if (explicitAllowed.size > 0) return false;

    return !!explicitPortHostOverride(host, explicitPort);
};

const formatInboundWsConnection = (
    req: any,
    userId: string,
    deviceId: string,
    activeConnectionType: string,
    localConnectionType: string,
    mode: string,
    requestedPeerId: string,
    peerLabel: string
): string => {
    const localAddress = req?.socket?.localAddress || "unknown";
    const localPort = req?.socket?.localPort || "";
    const remoteAddress = req?.socket?.remoteAddress || "unknown";
    const remotePort = req?.socket?.remotePort || "";
    return [
        "[bridge.connector] inbound ws connection",
        `  proto=${getWebSocketProtocol(req)}`,
        `  local=${localAddress}:${localPort}`,
        `  remote=${remoteAddress}:${remotePort}`,
        `  mode=${mode}`,
        `  userId=${userId || "unknown"}`,
        `  deviceId=${deviceId || "unknown"}`,
        `  peerId=${requestedPeerId || "-"}`,
        `  peerLabel=${peerLabel || "-"}`,
        `  connectionType(local=${localConnectionType}, remote=${activeConnectionType})`
    ].join("\n");
};

const explicitPortHostOverride = (host: string, explicitPort?: number): boolean => {
    if (!explicitPort) return false;
    const raw = pickEnvStringLegacy("CWS_WS_TCP_ALLOWED_HOSTS_WITH_PORT", { allowEmpty: true }) ?? pickEnvStringLegacy("WS_TCP_ALLOWED_HOSTS_WITH_PORT", { allowEmpty: true }) ?? "";
    const entries = raw
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
    if (!entries.length) return false;
    const key = `${host}:${explicitPort}`;
    return entries.includes(key);
};

const encodeTcpData = (chunk: Buffer | Uint8Array): string => Buffer.from(chunk).toString("base64");
const decodeTcpData = (payload: unknown): Buffer | null => {
    if (typeof payload !== "string") return null;
    try {
        return Buffer.from(payload, "base64");
    } catch {
        return null;
    }
};

type ClientInfo = {
    userId: string;
    userIdKey: string;
    userKey: string;
    ws: WebSocket;
    id: string;
    namespace: string;
    remoteAddress?: string;
    reverse: boolean;
    localConnectionType: WsConnectionType;
    remoteConnectionType?: WsConnectionIntent;
    topology?: string;
    requestedTopology?: string;
    deviceId?: string;
    peerLabel?: string;
    peerId?: string;
    connectedAt: number;
};

type ResolvedTargetMatch = {
    client: ClientInfo;
    score: number;
    reasons: string[];
};

export type WsHub = {
    broadcast: (userId: string, payload: any) => void;
    multicast: (userId: string, payload: any, namespace?: string, excludeId?: string) => void;
    notify: (userId: string, type: string, data?: any) => void;
    sendTo: (clientId: string, payload: any) => void;
    sendToDevice: (userId: string, deviceId: string, payload: any) => boolean;
    requestToDevice?: (userId: string, deviceId: string, payload: any, waitMs?: number) => Promise<any>;
    getConnectedDevices: (userId?: string) => string[];
    getConnectedPeerProfiles: (userId?: string) => Array<{ id: string; label: string }>;
    close: () => Promise<void>;
    onUnknownTarget?: (userId: string, deviceId: string, frame: any) => boolean;
    getConnectionRegistry?: (userId?: string) => Array<{
        id: string;
        userId: string;
        userKey?: string;
        namespace?: string;
        deviceId?: string;
        peerId?: string;
        peerLabel?: string;
        reverse: boolean;
        localConnectionType: WsConnectionType;
        remoteConnectionType?: WsConnectionIntent;
        localDisplayConnectionType?: string;
        remoteDisplayConnectionType?: string;
        displayTopology?: string;
        requestedTopology?: string;
        remoteAddress?: string;
        connectedAt: number;
        surface: string;
    }>;
    getUserId?: () => string;
};

const isIpLike = (value: string): boolean => {
    return /^(\d{1,3}\.){3}\d{1,3}$/.test(value) || /^[0-9a-fA-F:]+$/.test(value);
};

const hashSuffix = (value: string): string => createHash("sha1").update(value).digest("hex").slice(0, 8);
const normalizeSocketUser = (value: string | undefined): string => String(value || "").trim().toLowerCase();
const normalizeSocketPeer = (value: string | undefined): string => String(value || "").trim().toLowerCase();
const resolveTargetAlias = (value: string): string[] => {
    const raw = normalizeSocketPeer(value);
    if (!raw) return [];

    const stripPort = (input: string): string => {
        if (!input.includes(":")) return input;
        if (/^\[[^\]]+\]:\d{1,5}$/.test(input)) {
            return input.slice(0, input.lastIndexOf("]") + 1);
        }
        if (/^[^:]+:\d{1,5}$/.test(input)) {
            return input.slice(0, input.lastIndexOf(":"));
        }
        return input;
    };

    const stripRolePrefix = (input: string): string => {
        const colon = input.indexOf(":");
        if (colon <= 0) return input;
        return input.slice(colon + 1);
    };

    const stripLanPrefix = (input: string): string => input.replace(/^(?:l|p|h)-/, "");

    const items = new Set<string>();
    const add = (entry: string | undefined) => {
        const normalized = String(entry || "").trim().toLowerCase();
        if (!normalized) return;
        items.add(normalized);
    };

    const variants = [raw];
    add(raw);
    variants.push(stripPort(raw));
    const withoutRolePrefix = stripRolePrefix(raw);
    if (withoutRolePrefix !== raw) variants.push(withoutRolePrefix);
    const noRoleNoPort = stripPort(withoutRolePrefix);
    if (noRoleNoPort !== withoutRolePrefix) variants.push(noRoleNoPort);

    variants.forEach((candidate) => {
        add(candidate);
        add(stripLanPrefix(candidate));
    });

    return Array.from(items);
};

const normalizePeerLabel = (userId: string, rawDeviceId: string, rawLabel: string | null): string => {
    const userPart = (userId || "user").trim().slice(0, 16);
    const labelSource = (rawLabel || rawDeviceId || "peer").trim();
    if (!labelSource) return `${userPart}-peer`;
    if (isIpLike(labelSource)) return `${userPart}-peer-${hashSuffix(`${userId}|${labelSource}`)}`;
    const sanitized = labelSource
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);
    return sanitized || `${userPart}-peer-${hashSuffix(labelSource)}`;
};

const expandClientAlias = (value: string): string[] => {
    const raw = normalizeSocketPeer(value);
    if (!raw) return [];
    const candidates = new Set<string>();
    const add = (entry: string | undefined) => {
        const normalized = String(entry || "").trim().toLowerCase();
        if (!normalized) return;
        candidates.add(normalized);
    };

    const stripPort = (input: string): string => {
        if (!input.includes(":")) return input;
        if (/^\[[^\]]+\]:\d{1,5}$/.test(input)) {
            return input.slice(0, input.lastIndexOf("]") + 1);
        }
        if (/^[^:]+:\d{1,5}$/.test(input)) {
            return input.slice(0, input.lastIndexOf(":"));
        }
        return input;
    };

    const stripRolePrefix = (input: string): string => {
        const normalized = input.toLowerCase();
        if (/^[hlp]-/.test(normalized)) return normalized.slice(2);
        if (/^l_/.test(normalized)) return normalized.slice(2);
        if (/^p_/.test(normalized)) return normalized.slice(2);
        if (/^h_/.test(normalized)) return normalized.slice(2);
        return normalized;
    };

    const rawNoPort = stripPort(raw);
    add(raw);
    add(rawNoPort);
    const noRole = stripRolePrefix(raw);
    add(noRole);
    add(stripPort(noRole));
    add(raw.replace(/^[hlp]-/, "l-"));
    add(raw.replace(/^[hlp]-/, "p-"));
    add(raw.replace(/^[hlp]-/, "h-"));
    return Array.from(candidates);
};

const normalizePolicyTokenLiteral = (value: string): string => {
    const raw = normalizeSocketPeer(value);
    if (!raw) return "";
    if (raw.startsWith("inline:")) return raw.slice("inline:".length).trim();
    if (raw.startsWith("token:")) return raw.slice("token:".length).trim();
    if (raw.startsWith("env:") || raw.startsWith("fs:")) return "";
    return raw;
};

const toNormalizedTokenSet = (values: Array<string | undefined>): Set<string> => {
    const out = new Set<string>();
    for (const value of values) {
        const normalized = normalizeSocketPeer(value);
        if (normalized) out.add(normalized);
    }
    return out;
};

const resolvePolicyAliases = (policyId: string, origins: string[]): Set<string> => {
    const aliases = new Set<string>();
    const addAlias = (value: string | undefined) => {
        for (const alias of resolveTargetAlias(String(value || ""))) {
            aliases.add(alias);
        }
    };
    addAlias(policyId);
    for (const origin of origins) {
        const normalizedOrigin = normalizeSocketPeer(stripFramePort(String(origin || "")));
        if (!normalizedOrigin) continue;
        addAlias(normalizedOrigin);
        addAlias(`l-${normalizedOrigin}`);
        addAlias(`h-${normalizedOrigin}`);
        addAlias(`p-${normalizedOrigin}`);
    }
    return aliases;
};

export const createWsServer = (app: FastifyInstance): WsHub => {
    const server = app.server;
    const wss = new WebSocketServer({ noServer: true });
    const clients = new Map<WebSocket, ClientInfo>();
    const namespaces = new Map<string, Map<string, ClientInfo>>();
    const reverseClients = new Map<string, ClientInfo>();
    const reversePeerProfiles = new Map<string, Map<string, { label: string; peerId: string }>>();
    const pendingFetchReplies = new Map<
        string,
        {
            resolve: (value: any) => void;
            reject: (error: any) => void;
            timer?: ReturnType<typeof setTimeout>;
        }
    >();
    const tcpSessions = new Map<WebSocket, Map<string, TcpSession>>();
    const endpointPolicyMap = normalizeEndpointPolicies((config as any)?.endpointIDs || {});
    const resolvePolicyOriginIps = (target: string): string[] => {
        const normalizedTarget = normalizeSocketPeer(stripFramePort(target));
        if (!normalizedTarget) return [];
        const policy = resolveEndpointIdPolicyStrict(endpointPolicyMap, normalizedTarget);
        if (!policy) return [];
        const ips = new Set<string>();
        const rawOrigins = Array.isArray(policy.origins) ? policy.origins : [];
        for (const origin of rawOrigins) {
            const normalized = normalizeSocketPeer(stripFramePort(String(origin || "")));
            if (normalized) ips.add(normalized);
        }
        return Array.from(ips);
    };
    const resolveTargetsForFrame = (frameTo: string, frame: any, source: ClientInfo): ResolvedTargetMatch[] => {
        const normalizedFrameTo = normalizeSocketPeer(stripFramePort(frameTo));
        const frameAliases = new Set(resolveTargetAlias(normalizedFrameTo));
        const frameIpHint = normalizeSocketPeer(stripFramePort(normalizedFrameTo.replace(/^[hlp]-/, "")));
        const frameTokenHints = toNormalizedTokenSet([
            String(frame?.toToken || ""),
            String(frame?.dstToken || ""),
            String(frame?.token || "")
        ]);
        if (source.userKey) frameTokenHints.add(normalizeSocketPeer(source.userKey));

        const strictPolicy = resolveEndpointIdPolicyStrict(endpointPolicyMap, normalizedFrameTo);
        const policyAliases = resolvePolicyAliases(strictPolicy?.id || normalizedFrameTo, Array.isArray(strictPolicy?.origins) ? strictPolicy.origins : []);
        const policyOrigins = new Set(resolvePolicyOriginIps(normalizedFrameTo));
        const policyTokens = new Set(
            (Array.isArray(strictPolicy?.tokens) ? strictPolicy.tokens : [])
                .map((entry) => normalizePolicyTokenLiteral(String(entry || "")))
                .filter(Boolean)
        );

        const matches: ResolvedTargetMatch[] = [];
        for (const candidate of clients.values()) {
            if (candidate.id === source.id) continue;
            const candidateAliases = new Set<string>([
                ...resolveTargetAlias(candidate.id),
                ...resolveTargetAlias(candidate.deviceId || ""),
                ...resolveTargetAlias(candidate.peerId || ""),
                ...resolveTargetAlias(candidate.userId || "")
            ]);
            if (candidate.remoteAddress) {
                candidateAliases.add(normalizeSocketPeer(candidate.remoteAddress));
            }

            let score = 0;
            const reasons: string[] = [];
            const hasExactAlias = Array.from(frameAliases).some((alias) => candidateAliases.has(alias));
            if (hasExactAlias) {
                score += 100;
                reasons.push("direct-alias");
            }
            if (frameIpHint && candidate.remoteAddress && normalizeSocketPeer(candidate.remoteAddress) === frameIpHint) {
                score += 70;
                reasons.push("target-ip");
            }
            const hasPolicyAlias = policyAliases.size > 0 && Array.from(policyAliases).some((alias) => candidateAliases.has(alias));
            if (hasPolicyAlias) {
                score += 50;
                reasons.push("policy-alias");
            }
            if (candidate.remoteAddress && policyOrigins.has(normalizeSocketPeer(candidate.remoteAddress))) {
                score += 40;
                reasons.push("policy-origin-ip");
            }
            const candidateToken = normalizeSocketPeer(candidate.userKey || "");
            let hasStrongSignal = hasExactAlias || hasPolicyAlias || reasons.includes("target-ip") || reasons.includes("policy-origin-ip");
            if (candidateToken && policyTokens.has(candidateToken)) {
                score += 30;
                reasons.push("policy-token");
                hasStrongSignal = true;
            }
            if (candidateToken && frameTokenHints.has(candidateToken) && hasStrongSignal) {
                score += 20;
                reasons.push("frame-token");
            }

            if (score <= 0) continue;
            matches.push({ client: candidate, score, reasons });
        }

        matches.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return b.client.connectedAt - a.client.connectedAt;
        });

        if (matches.length === 0 && frameTokenHints.size > 0) {
            for (const candidate of clients.values()) {
                if (candidate.id === source.id) continue;
                const candidateToken = normalizeSocketPeer(candidate.userKey || "");
                if (!candidateToken || !frameTokenHints.has(candidateToken)) continue;
                matches.push({ client: candidate, score: 10, reasons: ["token-fanout"] });
            }
        }

        const deduped = new Map<string, ResolvedTargetMatch>();
        for (const match of matches) {
            if (!deduped.has(match.client.id)) deduped.set(match.client.id, match);
        }
        return Array.from(deduped.values());
    };
    const reverseClientKey = (userId: string, deviceId: string) => `${userId}:${deviceId}`;
    const requestKey = (userId: string, deviceId: string, requestId: string) => `${userId}:${deviceId}:${requestId}`;
    const resolveReverseClientByTarget = (userId: string, target: string): ClientInfo | undefined => {
        const normalizedUser = normalizeSocketUser(userId);
        const normalizedTargets = resolveTargetAlias(target);
        for (const candidate of normalizedTargets) {
            const direct = reverseClients.get(reverseClientKey(normalizedUser, candidate));
            if (direct) return direct;
        }
        for (const entry of reverseClients.values()) {
            if (!entry.userId) continue;
            if (normalizeSocketUser(entry.userId) !== normalizedUser) continue;
            const candidateDevices = resolveTargetAlias(entry.deviceId || "");
            const candidatePeers = resolveTargetAlias(entry.peerId || "");
            const hasMatch =
                candidateDevices.some((device) => normalizedTargets.includes(device)) ||
                candidatePeers.some((peer) => normalizedTargets.includes(peer)) ||
                normalizedTargets.some((targetAlias) => targetAlias === (entry.deviceId || "").toLowerCase() || targetAlias === (entry.peerId || "").toLowerCase());
            if (hasMatch) return entry;
        }
        return undefined;
    };

    const upgradeHandler = (req: any, socket: any, head: Buffer) => {
        let pathname = "";
        try {
            pathname = new URL(req.url || "", "http://localhost").pathname;
        } catch {
            pathname = "";
        }
        if (pathname !== "/ws") return;

        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit("connection", ws, req);
        });
    };
    server.on("upgrade", upgradeHandler);

    const isPolicyKnownClient = (userId: string, userKey: string): boolean => {
        const normalizedUserId = normalizeSocketPeer(userId);
        const normalizedUserKey = String(userKey || "").trim().toLowerCase();
        if (!normalizedUserId || !normalizedUserKey) return false;
        const endpointIds = (config as any)?.endpointIDs;
        if (!endpointIds || typeof endpointIds !== "object") return false;

        const userAliases = new Set(expandClientAlias(normalizedUserId));
        for (const [policyIdRaw, policyRaw] of Object.entries(endpointIds)) {
            const policy = (policyRaw || {}) as Record<string, any>;
            const policyId = String(policyIdRaw || "").trim().toLowerCase();
            if (!policyId) continue;

            const policyAliases = new Set<string>(expandClientAlias(policyId));
            const policyOrigins = Array.isArray(policy.origins) ? policy.origins : [];
            for (const origin of policyOrigins) {
                for (const originAlias of expandClientAlias(String(origin || ""))) {
                    policyAliases.add(originAlias);
                    policyAliases.add(`l-${originAlias}`);
                    policyAliases.add(`h-${originAlias}`);
                    policyAliases.add(`p-${originAlias}`);
                }
            }

            const policyTokens = Array.isArray(policy.tokens) ? policy.tokens : [];
            const normalizedTokens = policyTokens.map((token: unknown) => String(token || "").trim().toLowerCase()).filter(Boolean);
            const wildcardToken = normalizedTokens.includes("*");
            const tokenMatches = wildcardToken || normalizedTokens.includes(normalizedUserKey) || normalizedTokens.length === 0;

            let aliasMatch = false;
            for (const userAlias of userAliases) {
                if (policyAliases.has(userAlias)) {
                    aliasMatch = true;
                    break;
                }
            }
            if (aliasMatch && tokenMatches) return true;
        }
        return false;
    };

    const verify = async (userId?: string, userKey?: string) => {
        if (!userId || !userKey) return null;
        try {
            const settings = await loadUserSettings(userId, userKey);
            return settings;
        } catch {
            if (isPolicyKnownClient(userId, userKey)) {
                return {} as any;
            }
            return null;
        }
    };

    const closeAllTcpSessions = (socket: WebSocket) => {
        const sessions = tcpSessions.get(socket);
        if (!sessions) return;
        sessions.forEach((session) => {
            try {
                session.socket.destroy();
            } catch {
                // no-op
            }
        });
        tcpSessions.delete(socket);
    };

    const sendTcpFrame = (socket: WebSocket, payload: Record<string, any>) => {
        try {
            socket.send(JSON.stringify(payload));
        } catch {
            // no-op
        }
    };

    const closeTcpSession = (socket: WebSocket, sessionId: string): boolean => {
        const sessions = tcpSessions.get(socket);
        const session = sessions?.get(sessionId);
        if (!sessions || !session) return false;
        sessions.delete(sessionId);
        try {
            session.socket.destroy();
        } catch {
            // no-op
        }
        if (sessions.size === 0) tcpSessions.delete(socket);
        return true;
    };

    const handleTcpPassthroughFrame = (socket: WebSocket, frame: TcpPassthroughFrame, userId: string, source: ClientInfo) => {
        const payloadType = String(frame.type || "").trim();
        if (!payloadType || !payloadType.startsWith("tcp.")) return false;
        const sessionId = typeof frame.sessionId === "string" && frame.sessionId.trim() ? frame.sessionId.trim() : randomUUID();

        if (payloadType === "tcp.connect") {
            const parsedEndpoint = parseTcpEndpoint(frame);
            if (!parsedEndpoint?.host) {
                sendTcpFrame(socket, {
                    type: "tcp.error",
                    sessionId,
                    reason: "invalid-target",
                    error: "Missing host"
                });
                return true;
            }

            if (!isTcpTargetAllowed(parsedEndpoint.host, parsedEndpoint.port)) {
                sendTcpFrame(socket, {
                    type: "tcp.error",
                    sessionId,
                    reason: "forbidden-target",
                    error: `Target ${parsedEndpoint.host}:${parsedEndpoint.port ?? "auto"} is blocked`
                });
                return true;
            }

            const port = parsedEndpoint.port || 80;
            if (!parsePort(port)) {
                sendTcpFrame(socket, {
                    type: "tcp.error",
                    sessionId,
                    reason: "invalid-target",
                    error: "Invalid port"
                });
                return true;
            }

            if ((tcpSessions.get(socket)?.size || 0) >= 16) {
                sendTcpFrame(socket, {
                    type: "tcp.error",
                    sessionId,
                    reason: "limit-exceeded",
                    error: "Too many active passthrough sessions"
                });
                return true;
            }

            const targetSessions = tcpSessions.get(socket) || new Map<string, TcpSession>();
            if (targetSessions.has(sessionId)) {
                sendTcpFrame(socket, {
                    type: "tcp.error",
                    sessionId,
                    reason: "session-exists",
                    error: "Session id already exists"
                });
                return true;
            }

            const remoteSocket = createTcpConnection({
                host: parsedEndpoint.host,
                port
            }) as NetSocket;
            const session: TcpSession = { id: sessionId, host: parsedEndpoint.host, port, socket: remoteSocket };
            targetSessions.set(sessionId, session);
            tcpSessions.set(socket, targetSessions);
            remoteSocket.setKeepAlive(true, 30_000);

            remoteSocket.once("connect", () => {
                sendTcpFrame(socket, {
                    type: "tcp.connected",
                    sessionId,
                    userId,
                    host: parsedEndpoint.host,
                    port,
                    via: "ws",
                    surface: source.reverse ? "external" : "private"
                });
            });
            remoteSocket.on("data", (chunk) => {
                sendTcpFrame(socket, {
                    type: "tcp.data",
                    sessionId,
                    data: encodeTcpData(chunk as Buffer | Uint8Array),
                    encoding: "base64"
                });
            });
            remoteSocket.once("error", (error) => {
                sendTcpFrame(socket, {
                    type: "tcp.error",
                    sessionId,
                    reason: "socket-error",
                    error: String((error as Error)?.message || error)
                });
                closeTcpSession(socket, sessionId);
            });
            remoteSocket.once("close", () => {
                sendTcpFrame(socket, {
                    type: "tcp.closed",
                    sessionId
                });
                closeTcpSession(socket, sessionId);
            });
            remoteSocket.setTimeout(Math.max(120_000, parsePortableInteger(frame.timeoutMs) ?? 120_000));
            return true;
        }

        if (payloadType === "tcp.send") {
            const targetSessions = tcpSessions.get(socket);
            if (!targetSessions?.has(sessionId)) {
                sendTcpFrame(socket, {
                    type: "tcp.error",
                    sessionId,
                    reason: "unknown-session",
                    error: "Session not found"
                });
                return true;
            }

            const session = targetSessions.get(sessionId)!;
            const rawPayload = frame.data ?? frame.payload;
            const binary = decodeTcpData(rawPayload);
            if (!binary) {
                sendTcpFrame(socket, {
                    type: "tcp.error",
                    sessionId,
                    reason: "invalid-payload",
                    error: "Payload must be base64"
                });
                return true;
            }

            if (!session.socket.writable) {
                sendTcpFrame(socket, {
                    type: "tcp.error",
                    sessionId,
                    reason: "not-ready",
                    error: "Target socket is not writable"
                });
                return true;
            }

            session.socket.write(binary);
            return true;
        }

        if (payloadType === "tcp.close") {
            const ok = closeTcpSession(socket, sessionId);
            sendTcpFrame(socket, {
                type: ok ? "tcp.closed" : "tcp.error",
                sessionId,
                reason: ok ? "closed" : "unknown-session",
                ...(ok ? {} : { error: "Session not found" })
            });
            return true;
        }

        return false;
    };

    wss.on("connection", async (ws, req) => {
        const params = new URL(req.url || "", "http://localhost").searchParams;
        const userId = params.get("userId") || undefined;
        const userKey = params.get("userKey") || undefined;
        const namespace = params.get("ns") || params.get("namespace") || userId;
        const mode = params.get("mode") || "push";
        const deviceId = params.get("deviceId") || "";
        const isReverse = mode === "reverse";
        const remoteConnectionTypeRaw = params.get("connectionType") || params.get("archetype") || params.get("connectionRole");
        const topology = params.get("topology") || params.get("rolePair") || undefined;
        const parsedRemoteConnectionType = parseWsConnectionType(remoteConnectionTypeRaw);
        const localConnectionType = inferServerSideConnectionType(isReverse);
        const remoteConnectionType = parsedRemoteConnectionType || inferExpectedRemoteConnectionType(isReverse);
        const userIdKey = normalizeSocketUser(userId);
        const normalizedDeviceId = normalizeSocketPeer(deviceId);
        const settings = await verify(userId, userKey);
        const requestedLabel = (params.get("label") || params.get("name") || params.get("clientId") || "").trim();
        const requestedPeerId = normalizeSocketPeer(params.get("clientId") || params.get("peerId") || requestedLabel || deviceId);
        if (!settings || !userId || !userKey) {
            ws.close(4001, "Invalid credentials");
            return;
        }
        if (isReverse && !deviceId) {
            ws.close(4002, "Missing deviceId");
            return;
        }
        if (remoteConnectionTypeRaw && !parsedRemoteConnectionType) {
            ws.close(4005, `Invalid websocket connectionType: ${remoteConnectionTypeRaw}`);
            return;
        }
        const runtimeRoles = config.roles as string[] | undefined;
        const roleAllowed = isReverse
            ? supportsReverseServerConnectionType(runtimeRoles) || ((remoteConnectionType === "responser-initiator" || remoteConnectionType === "first-order") && supportsConnectorRole(runtimeRoles))
            : supportsForwardServerConnectionType(runtimeRoles);
        if (!roleAllowed) {
            ws.close(4003, `Unsupported websocket connectionType for this node: ${localConnectionType}`);
            return;
        }
        if (!areConnectionTypesCompatible(localConnectionType, remoteConnectionType)) {
            ws.close(4004, `Incompatible websocket connection types: local=${localConnectionType}, remote=${remoteConnectionType}`);
            return;
        }
        
        let activeConnectionType = remoteConnectionType;
        if (activeConnectionType === "first-order") {
            activeConnectionType = localConnectionType === "requestor-initiated" ? "responser-initiator" : "requestor-initiator";
            console.log(`[Server] Raw WS accepted first-order connection, acting as ${activeConnectionType}`);
        }
        
        const peerLabel = isReverse ? normalizePeerLabel(userId || "", normalizedDeviceId, requestedPeerId) : undefined;
        const info: ClientInfo = {
            userId,
            userIdKey,
            userKey,
            ws,
            id: randomUUID(),
            namespace: normalizeSocketUser(namespace || userId),
            remoteAddress: req.socket?.remoteAddress,
            reverse: isReverse,
            localConnectionType,
            remoteConnectionType: activeConnectionType,
            topology,
            requestedTopology: topology,
            deviceId: isReverse ? normalizedDeviceId : undefined,
            peerLabel,
            peerId: isReverse ? requestedPeerId : undefined,
            connectedAt: Date.now()
        };
        if (isReverse) {
            console.log(
                formatInboundWsConnection(
                    req,
                    userId || "",
                    normalizedDeviceId || "",
                    String(activeConnectionType || ""),
                    String(localConnectionType || ""),
                    mode,
                    requestedPeerId || "",
                    peerLabel || ""
                )
            );
            console.log(
                `[Server] WS role pair`,
                `display=${toDisplayTopology(localConnectionType, activeConnectionType)}`,
                `legacy=${localConnectionType}<->${activeConnectionType}`
            );
        }
        clients.set(ws, info);
        if (!namespaces.has(info.userIdKey)) namespaces.set(info.userIdKey, new Map());
        namespaces.get(info.userIdKey)!.set(info.id, info);
        if (isReverse && normalizedDeviceId) {
            reverseClients.set(reverseClientKey(info.userIdKey, normalizedDeviceId), info);
            if (requestedPeerId && requestedPeerId !== normalizedDeviceId) {
                reverseClients.set(reverseClientKey(info.userIdKey, requestedPeerId), info);
            }
            const labels = reversePeerProfiles.get(info.userIdKey) ?? new Map<string, { label: string; peerId: string }>();
            labels.set(normalizedDeviceId, {
                label: peerLabel || deviceId,
                peerId: requestedPeerId
            });
            reversePeerProfiles.set(info.userIdKey, labels);
            ws.send(JSON.stringify({
                type: "welcome",
                id: info.id,
                userId,
                deviceId,
                peerLabel,
                peerId: requestedPeerId,
                connectionType: info.localConnectionType,
                remoteConnectionType: info.remoteConnectionType,
                topology: info.requestedTopology
            }));
        } else {
            ws.send(JSON.stringify({
                type: "welcome",
                id: info.id,
                userId,
                connectionType: info.localConnectionType,
                remoteConnectionType: info.remoteConnectionType,
                topology: info.requestedTopology
            }));
        }

        ws.on("message", async (data) => {
            let parsed: any;
            parsed = safeJsonParse<Record<string, any>>(data.toString());
            if (!parsed) return;
            if (handleTcpPassthroughFrame(ws, parsed as TcpPassthroughFrame, userId, info)) {
                return;
            }
            if (info.reverse) {
                const requestId = String(parsed?.payload?.requestId || parsed?.requestId || "").trim();
                if (requestId) {
                    const pendingKeyUser = String(info.userId || "").toLowerCase();
                    const pendingDevice = String(info.deviceId || "").toLowerCase();
                    const keyByDevice = requestKey(pendingKeyUser, pendingDevice, requestId);
                    const keyByAnyTarget = Array.from(pendingFetchReplies.keys()).find((key) => {
                        const parts = key.split(":");
                        return parts[0] === pendingKeyUser && parts[2] === requestId;
                    });
                    const key = pendingFetchReplies.has(keyByDevice) ? keyByDevice : keyByAnyTarget;
                    if (key) {
                        const pending = pendingFetchReplies.get(key);
                        if (pending) {
                            pendingFetchReplies.delete(key);
                            if (pending.timer) clearTimeout(pending.timer);
                            pending.resolve(parsed);
                            return;
                        }
                    }
                }
            }
            const frameType = String(parsed?.type || "")
                .trim()
                .toLowerCase();
            if (frameType === "pong" || frameType === "hello" || frameType === "ping") {
                return;
            }
            const frameSource = info.deviceId || info.id;
            const frame = normalizeSocketFrame(parsed, frameSource, {
                nodeId: info.userId,
                peerId: info.deviceId,
                via: "ws",
                gatewayId: info.reverse ? "reverse-gateway" : undefined,
                surface: info.reverse ? "external" : inferNetworkSurface(req.socket?.remoteAddress)
            });
            const type = frame.type;
            const payload = frame.payload;
            const shouldBroadcast = isBroadcast(frame);
            // Simple forwarding: if targetId matches a client, relay
            if (!shouldBroadcast) {
                const normalizedFrameTo = normalizeSocketPeer(frame.to);
                const targetMatches = resolveTargetsForFrame(normalizedFrameTo || frame.to || "", frame, info);
                const primaryTarget = targetMatches[0]?.client;
                if (isWebSocketTunnelDebug()) {
                    console.log(
                        formatWsFrameLog("IN", req, info, frame, clients, normalizedFrameTo || frame.to || "", primaryTarget, info, false)
                    );
                }
                if (targetMatches.length > 0) {
                    const frameFrom = frame.from || frameSource;
                    for (const match of targetMatches) {
                        const target = match.client;
                        const frameTo = target?.deviceId || target?.peerId || frame.to;
                        const envelope = {
                            type,
                            payload,
                            data: payload,
                            from: frameFrom,
                            source: frameFrom,
                            via: "ws",
                            to: frameTo,
                            target: frameTo,
                            targetId: frameTo,
                            targetDeviceId: frameTo,
                            deviceId: frameTo,
                            userId: target?.userId || info.userId
                        };
                        target.ws?.send?.(JSON.stringify(envelope));
                        if (isWebSocketTunnelDebug()) {
                            console.log(
                                formatWsFrameLog("OUT", req, info, { ...frame, from: frameFrom, to: frameTo }, clients, frameTo, target, info, true)
                            );
                            console.log(
                                `[ws] ROUTE score=${match.score} reasons=${match.reasons.join("|") || "-"} target=${frameTo || target.id || "-"}`
                            );
                        }
                    }
                } else {
                    if (isWebSocketTunnelDebug()) {
                        console.log(
                            formatWsFrameLog("MISS", req, info, frame, clients, normalizedFrameTo || frame.to || "", undefined, info, false)
                        );
                    }
                    if (api.onUnknownTarget) {
                        api.onUnknownTarget(info.userIdKey, normalizedFrameTo || frame.to, frame);
                    }
                }
            } else {
                // broadcast to same userId
                const frameFrom = frame.from || frameSource;
                multicast(info.userIdKey, { type, payload, from: frameFrom, via: "ws" }, normalizeSocketUser(frame.namespace || info.namespace), info.id);
                if (isWebSocketTunnelDebug()) {
                    console.log(
                        formatWsFrameLog("BROADCAST", req, info, { ...frame, from: frameFrom, to: "broadcast" }, clients, "broadcast", undefined, info, true)
                    );
                }
            }
        });

        ws.on("close", () => {
            closeAllTcpSessions(ws);
            clients.delete(ws);
            namespaces.get(info.userIdKey)?.delete(info.id);
            if (namespaces.get(info.userIdKey)?.size === 0) namespaces.delete(info.userIdKey);
            for (const pendingKey of Array.from(pendingFetchReplies.keys())) {
                if (pendingKey.startsWith(`${info.userIdKey}:${info.deviceId || ""}:`)) {
                    const pending = pendingFetchReplies.get(pendingKey);
                    if (pending) {
                        if (pending.timer) clearTimeout(pending.timer);
                        pending.reject(new Error("device disconnected"));
                    }
                    pendingFetchReplies.delete(pendingKey);
                }
            }
            if (info.reverse && info.deviceId) {
                reverseClients.delete(reverseClientKey(info.userIdKey, info.deviceId));
                const peerAwareKey = reverseClientKey(info.userIdKey, normalizeSocketPeer(info.peerId));
                reverseClients.delete(peerAwareKey);
                const labels = reversePeerProfiles.get(info.userIdKey);
                if (labels) {
                    labels.delete(info.deviceId);
                    if (labels.size === 0) reversePeerProfiles.delete(info.userIdKey);
                }
            }
        });
    });

    const multicast = (userId: string, payload: any, namespace?: string, excludeId?: string) => {
        const targetNamespace = namespace || userId;
        const byUser = namespaces.get(normalizeSocketUser(userId));
        if (!byUser) return;
        byUser.forEach((client) => {
            if ((client.namespace || "").toLowerCase() === normalizeSocketUser(targetNamespace) && client.id !== excludeId) {
                client.ws.send(JSON.stringify(payload));
            }
        });
    };

    const broadcast = (userId: string, payload: any) => {
        multicast(userId, payload, undefined);
    };

    const notify = (userId: string, type: string, data?: any) => {
        broadcast(userId, { type, data });
    };

    const sendTo = (clientId: string, payload: any) => {
        const target = [...clients.values()].find((c) => c.id === clientId);
        target?.ws?.send?.(JSON.stringify(payload));
    };

    const sendToDevice = (userId: string, deviceId: string, payload: any): boolean => {
        const normalizedUser = normalizeSocketUser(userId);
        const normalizedTarget = normalizeSocketPeer(deviceId);
        const target = resolveReverseClientByTarget(normalizedUser, normalizedTarget);
        if (!target?.ws) return false;
        try {
            if (Buffer.isBuffer(payload) || payload instanceof Uint8Array || payload instanceof ArrayBuffer) {
                target.ws.send(payload);
            } else {
                target.ws.send(JSON.stringify(payload));
            }
            return true;
        } catch {
            return false;
        }
    };

    const requestToDevice = async (userId: string, deviceId: string, payload: any, waitMs = 15000) => {
        const requestId = String(payload?.requestId || randomUUID()).trim() || randomUUID();
        const envelope = { ...payload, requestId };
        const normalizedUser = normalizeSocketUser(userId);
        const normalizedTarget = normalizeSocketPeer(deviceId);
        const target = resolveReverseClientByTarget(normalizedUser, normalizedTarget);
        if (!target?.ws) return undefined;
        const pendingTarget = normalizeSocketPeer(target.deviceId || normalizedTarget);
        return new Promise<any>((resolve, reject) => {
            const key = requestKey(normalizedUser, pendingTarget, requestId);
            const timeout = parsePortableInteger(waitMs) ?? 15000;
            const timer = setTimeout(
                () => {
                    pendingFetchReplies.delete(key);
                    reject(new Error(`network.fetch timeout: ${requestId}`));
                },
                Math.max(500, timeout)
            );
            pendingFetchReplies.set(key, { resolve, reject, timer });
            try {
                target.ws.send(JSON.stringify(envelope));
            } catch (error) {
                pendingFetchReplies.delete(key);
                if (timer) clearTimeout(timer);
                reject(error);
            }
        });
    };

    const getConnectedDevices = (userId?: string): string[] => {
        const keys = Array.from(reverseClients.keys());
        const asDevice = (key: string) => key.split(":")[1];
        if (!userId) return Array.from(new Set(keys.map(asDevice)));
        const prefix = `${normalizeSocketUser(userId)}:`;
        return Array.from(new Set(keys.filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length))));
    };

    const getConnectedPeerProfiles = (userId?: string): Array<{ id: string; label: string; peerId?: string }> => {
        if (!userId) {
            return Array.from(reversePeerProfiles.values()).flatMap((labelsByDevice) => Array.from(labelsByDevice.entries()).map(([id, profile]) => ({ id, label: profile.label, peerId: profile.peerId })));
        }
        const profile = reversePeerProfiles.get(normalizeSocketUser(userId));
        if (!profile) return [];
        return Array.from(profile.entries()).map(([id, profileEntry]) => ({ id, label: profileEntry.label, peerId: profileEntry.peerId }));
    };
    const getConnectionRegistry = (userId?: string): Array<{
        id: string;
        userId: string;
        userKey: string;
        namespace: string;
        deviceId?: string;
        peerId?: string;
        peerLabel?: string;
        reverse: boolean;
        localConnectionType: WsConnectionType;
        remoteConnectionType?: WsConnectionIntent;
        localDisplayConnectionType?: string;
        remoteDisplayConnectionType?: string;
        displayTopology?: string;
        requestedTopology?: string;
        remoteAddress?: string;
        connectedAt: number;
        surface: string;
    }> => {
        const requestedUser = userId ? normalizeSocketUser(userId) : "";
        return Array.from(clients.values()).flatMap((entry) => {
            if (requestedUser && entry.userIdKey !== requestedUser) return [];
            return [{
                id: entry.id,
                userId: entry.userId,
                userKey: entry.userKey,
                namespace: entry.namespace,
                deviceId: entry.deviceId,
                peerId: entry.peerId,
                peerLabel: entry.peerLabel,
                reverse: entry.reverse,
                localConnectionType: entry.localConnectionType,
                remoteConnectionType: entry.remoteConnectionType,
                localDisplayConnectionType: describeDisplayConnectionType(entry.localConnectionType),
                remoteDisplayConnectionType: describeDisplayConnectionType(entry.remoteConnectionType || inferExpectedRemoteConnectionType(entry.reverse)),
                displayTopology: toDisplayTopology(entry.localConnectionType, entry.remoteConnectionType || inferExpectedRemoteConnectionType(entry.reverse)),
                requestedTopology: entry.requestedTopology || entry.topology,
                remoteAddress: entry.remoteAddress,
                connectedAt: entry.connectedAt,
                surface: entry.reverse ? "requestor-initiated" : "endpoint-server"
            }];
        });
    };

    const close = async () => {
        clients.forEach((c) => c.ws.close());
        server.off("upgrade", upgradeHandler);
        await new Promise<void>((resolve) => {
            wss.close(() => resolve());
        });
    };

    const getUserId = () => {
        return (config as any)?.bridge?.userId || "";
    };

    const api: WsHub = {
        broadcast,
        multicast,
        notify,
        sendTo,
        sendToDevice,
        requestToDevice,
        getConnectedDevices,
        getConnectedPeerProfiles,
        getConnectionRegistry,
        close,
        getUserId
    };

    return api;
};

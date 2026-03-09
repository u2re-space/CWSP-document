import net from "node:net";
import { networkInterfaces } from "node:os";

import Fastify, { type FastifyInstance } from "fastify";

import { isMainModule, moduleDirname, runtimeArgs } from "../../lib/runtime.ts";
import { loadHttpsOptions as loadTlsOptions } from "../../lib/TLS.ts";
import { parsePortableBoolean, parsePortableInteger, resolvePortableTextValue } from "../../lib/parsing.ts";
import { createWsServer } from "../socket/websocket.ts";
import type { WsHub } from "../socket/websocket.ts";
import { createSocketIoBridge } from "../socket/socketio-bridge.ts";
import { registerOpsRoutes } from "../../io/ops.ts";
import { startBridgePeerClient } from "../stack/bridge.ts";
import { resolveTunnelTarget } from "../stack/messages.ts";
import { normalizeNetworkAliasMap, resolveNetworkAlias } from "../stack/topology.ts";
import config from "../../config/config.ts";
import { registerRoutes } from "../../routing/routes.ts";
import { registerApiFallback, registerCoreApp } from "../../routing/core-app.ts";
import { createHttpClient } from "../stack/https.ts";
import { setApp as setClipboardApp, setHttpClient, startClipboardPolling } from "../../io/clipboard.ts";
import { startMouseFlushInterval } from "../../io/mouse.ts";
import { setApp as setPythonApp } from "../../gpt/python.ts";
import { resolvePeerIdentity } from "../stack/peer-identity.ts";
import { pickEnvBoolLegacy, pickEnvNumberLegacy, pickEnvStringLegacy } from "../../lib/env.ts";
import { normalizeEndpointPolicies, resolveEndpointIdPolicyStrict, resolveEndpointPolicyRoute } from "../stack/endpoint-policy.ts";

const resolvePortableConfigBoolean = (value: string | undefined): boolean | undefined => {
    if (typeof value === "undefined") return undefined;
    return parsePortableBoolean(resolvePortableTextValue(value, moduleDirname(import.meta)));
};

const loadHttpsOptions = async () => {
    const httpsConfig = ((config as any)?.https as Record<string, any>) || {};
    const enabledCandidate = pickEnvStringLegacy("CWS_HTTPS_ENABLED") ?? (httpsConfig.enabled === true ? "true" : httpsConfig.enabled === false ? "false" : undefined);
    if (resolvePortableConfigBoolean(enabledCandidate) === false) {
        return undefined;
    }
    return loadTlsOptions({
        httpsConfig,
        moduleDir: moduleDirname(import.meta)
    });
};

const parseCli = (args: string[]) => {
    const out: { port?: number; host?: string; httpPort?: number; httpsPort?: number } = {};
    const eat = (i: number) => (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined);
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "--port") {
            const v = eat(i);
            const parsedPort = parsePortableInteger(v);
            if (parsedPort !== undefined) out.port = parsedPort;
        } else if (a.startsWith("--port=")) {
            const parsedPort = parsePortableInteger(a.split("=", 2)[1]);
            if (parsedPort !== undefined) out.port = parsedPort;
        } else if (a === "--http-port") {
            const v = eat(i);
            const parsedPort = parsePortableInteger(v);
            if (parsedPort !== undefined) out.httpPort = parsedPort;
        } else if (a.startsWith("--http-port=")) {
            const parsedPort = parsePortableInteger(a.split("=", 2)[1]);
            if (parsedPort !== undefined) out.httpPort = parsedPort;
        } else if (a === "--https-port") {
            const v = eat(i);
            const parsedPort = parsePortableInteger(v);
            if (parsedPort !== undefined) out.httpsPort = parsedPort;
        } else if (a.startsWith("--https-port=")) {
            const parsedPort = parsePortableInteger(a.split("=", 2)[1]);
            if (parsedPort !== undefined) out.httpsPort = parsedPort;
        } else if (a === "--host" || a === "--address") {
            const v = eat(i);
            if (v) out.host = v;
        } else if (a.startsWith("--host=") || a.startsWith("--address=")) {
            out.host = a.split("=", 2)[1];
        }
    }
    return out;
};

const isPortAvailable = async (host: string, port: number): Promise<boolean> => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    return await new Promise<boolean>((resolve) => {
        const srv = net.createServer();
        srv.unref();
        srv.once("error", () => resolve(false));
        srv.once("listening", () => {
            srv.close(() => resolve(true));
        });
        srv.listen({ host, port });
    });
};

const pickHttpPort = async (host: string): Promise<number> => {
    const preferred = 8080;
    const fallback = 8081;
    return (await isPortAvailable(host, preferred)) ? preferred : fallback;
};

const makeUnifiedWsHub = (hubs: WsHub[]): WsHub => {
    return {
        broadcast: (userId, payload) => {
            hubs.forEach((hub) => hub.broadcast(userId, payload));
        },
        multicast: (userId, payload, namespace, excludeId) => {
            hubs.forEach((hub) => hub.multicast(userId, payload, namespace, excludeId));
        },
        notify: (userId, type, data) => {
            hubs.forEach((hub) => hub.notify(userId, type, data));
        },
        sendTo: (clientId, payload) => {
            hubs.forEach((hub) => hub.sendTo(clientId, payload));
        },
        sendToDevice: (userId, deviceId, payload) => {
            for (const hub of hubs) {
                const ok = hub.sendToDevice(userId, deviceId, payload);
                if (ok) return true;
            }
            return false;
        },
        getConnectedDevices: (userId) => {
            const set = new Set<string>();
            for (const hub of hubs) {
                hub.getConnectedDevices(userId).forEach((id) => set.add(id));
            }
            return Array.from(set);
        },
        getConnectedPeerProfiles: (userId) => {
            const seen = new Map<string, { id: string; label: string }>();
            for (const hub of hubs) {
                const peerProfiles = hub.getConnectedPeerProfiles(userId);
                for (const peer of peerProfiles) {
                    const key = peer.id;
                    if (!seen.has(key)) seen.set(key, { id: peer.id, label: peer.label });
                }
            }
            return Array.from(seen.values());
        },
        close: async () => {
            await Promise.all(hubs.map((hub) => hub.close()));
        }
    } as any;
};

// Receives messages from bridge gateway/origin and dispatches them into local peer hub.
const resolveLocalEndpointIds = (endpointPolicyMap: ReturnType<typeof normalizeEndpointPolicies>, fallbackUserId: string): Set<string> => {
    const localHosts = new Set<string>(["localhost", "127.0.0.1", "::1"]);
    const hostName = ((config as any)?.host || "").toString().trim().toLowerCase();
    if (hostName) localHosts.add(hostName);
    const hostname = (typeof process?.env?.HOSTNAME === "string" && process.env.HOSTNAME.trim()) ? process.env.HOSTNAME.trim().toLowerCase() : "";
    if (hostname) localHosts.add(hostname);

    const interfaces = networkInterfaces();
    for (const list of Object.values(interfaces)) {
        if (!list) continue;
        for (const iface of list) {
            if (!iface || !(typeof iface.address === "string")) continue;
            const normalizedAddress = iface.address.trim().toLowerCase();
            if (normalizedAddress) localHosts.add(normalizedAddress);
            if (!normalizedAddress) continue;
            if (normalizedAddress.startsWith("[") && normalizedAddress.endsWith("]")) {
                localHosts.add(normalizedAddress.slice(1, -1));
            }
        }
    }

    const normalizePolicyHost = (value: string): string => {
        const trimmed = value.trim().toLowerCase();
        if (!trimmed) return "";
        const withoutPort = trimmed.split("#")[0];
        if (!withoutPort) return "";
        const protocolSplit = withoutPort.includes("://") ? withoutPort.split("://")[1] : withoutPort;
        const hostOnly = protocolSplit.split("/")[0];
        if (!hostOnly) return "";
        const withoutBrackets = hostOnly.startsWith("[") && hostOnly.includes("]") ? hostOnly.slice(1, hostOnly.indexOf("]")) : hostOnly;
        const host = withoutBrackets.split(":")[0];
        return host.trim().toLowerCase();
    };

    const selfIds = new Set<string>();
    const addEndpointIdVariants = (policyId: string) => {
        const normalized = String(policyId || "").trim().toLowerCase();
        if (!normalized) return;
        selfIds.add(normalized);
        if (normalized.startsWith("l-")) {
            selfIds.add(normalized.slice(2));
            return;
        }
        selfIds.add(`l-${normalized}`);
    };
    const normalizedFallback = fallbackUserId.trim().toLowerCase();
    if (normalizedFallback) {
        addEndpointIdVariants(normalizedFallback);
    }
    for (const [rawPolicyId, policy] of Object.entries(endpointPolicyMap || {})) {
        const policyId = rawPolicyId.trim().toLowerCase();
        if (!policyId || policyId === "*") continue;
        const rawOrigins = (policy as any).origins;
        if (!Array.isArray(rawOrigins)) continue;
        for (const rawOrigin of rawOrigins) {
            const normalizedOriginHost = normalizePolicyHost(String(rawOrigin || ""));
            if (!normalizedOriginHost) continue;
            if (localHosts.has(normalizedOriginHost)) {
                addEndpointIdVariants(policyId);
                break;
            }
        }
    }
    return selfIds;
};

const normalizeTargetForLocalRouting = (rawTarget: string): string[] => {
    const normalized = String(rawTarget || "").trim().toLowerCase();
    if (!normalized) return [];
    if (normalized.startsWith("l-")) return [normalized, normalized.slice(2)];
    return [normalized, `l-${normalized}`];
};

const isLocalEndpointTarget = (requestedTarget: string, localEndpointIds: Set<string>): boolean => {
    const normalized = String(requestedTarget || "").trim().toLowerCase();
    if (!normalized) return false;
    return normalizeTargetForLocalRouting(normalized).some((candidate) => localEndpointIds.has(candidate));
};

const buildBridgeRouter = (app: FastifyInstance, hub: WsHub, fallbackUserId: string) => {
    const bridgeAliasMap = normalizeNetworkAliasMap((config as any)?.networkAliases || {});
    const endpointPolicyMap = normalizeEndpointPolicies((config as any)?.endpointIDs || {});
    const isTunnelDebug = pickEnvBoolLegacy("CWS_TUNNEL_DEBUG") === true;
    const defaultUserId = fallbackUserId || "";
    const localEndpointIds = resolveLocalEndpointIds(endpointPolicyMap, defaultUserId);
    const resolveSourceForPolicy = (msg: Record<string, unknown>, fallback: string): { sourceId: string; isKnown: boolean } => {
        const sourceHint = typeof msg.from === "string" && msg.from.trim() ? msg.from : typeof (msg as any).source === "string" && (msg as any).source.trim() ? (msg as any).source : typeof (msg as any).sourceId === "string" && (msg as any).sourceId.trim() ? (msg as any).sourceId : typeof (msg as any).src === "string" && (msg as any).src.trim() ? (msg as any).src : fallback;
        const trimmed = typeof sourceHint === "string" ? sourceHint.trim() : "";
        const fallbackSource = fallback.trim();
        if (!trimmed) return { sourceId: fallbackSource, isKnown: true };
        const normalizedPolicyHint = resolvePolicyTarget(trimmed);
        const policyResolved = normalizedPolicyHint ? resolveEndpointPolicyRoute(normalizedPolicyHint, normalizedPolicyHint, endpointPolicyMap).targetPolicy : undefined;
        const strictPolicy = normalizedPolicyHint ? resolveEndpointIdPolicyStrict(endpointPolicyMap, normalizedPolicyHint) : undefined;
        const fallbackSourceId = fallback.trim();
        const sourceId = (policyResolved?.id && policyResolved.id !== "*" ? policyResolved.id : normalizedPolicyHint) || fallbackSource;
        const known = strictPolicy != null || sourceId === fallbackSourceId;
        return { sourceId, isKnown: known };
    };
    const stripPort = (value: string): string => {
        const trimmed = String(value || "").trim();
        const at = trimmed.lastIndexOf(":");
        if (at <= 0) return trimmed;
        const candidate = trimmed.slice(at + 1);
        if (/^\d+$/.test(candidate)) return trimmed.slice(0, at);
        return trimmed;
    };
    const resolvePolicyTarget = (rawTarget: string): string => {
        const normalized = stripPort(
            String(rawTarget || "")
                .trim()
                .toLowerCase()
        );
        if (!normalized) return "";
        const directMatch = endpointPolicyMap[normalized];
        if (directMatch && directMatch.id) return directMatch.id;
        const policyCandidate = resolveEndpointPolicyRoute(normalized, normalized, endpointPolicyMap);
        return policyCandidate?.targetPolicy?.id && policyCandidate.targetPolicy.id !== "*" && policyCandidate.targetPolicy.id !== normalized ? policyCandidate.targetPolicy.id : rawTarget.trim();
    };
    const resolveTargetWithPeerIdentity = (resolvedUserId: string, rawTarget: string) => {
        const normalized = String(rawTarget || "").trim();
        if (!normalized) return "";
        const policyResolvedTarget = resolvePolicyTarget(normalized);
        const aliasInput = policyResolvedTarget !== normalized ? policyResolvedTarget : normalized;
        const aliasResolved = resolveNetworkAlias(bridgeAliasMap, aliasInput) || aliasInput;
        const topology = (config as any)?.topology;
        const topologyNodes = Array.isArray(topology?.nodes) ? topology.nodes.filter((node: any) => node && typeof node === "object" && !Array.isArray(node)) : [];
        const peers = hub.getConnectedPeerProfiles(resolvedUserId).map((peer) => ({
            id: peer.id,
            label: peer.label,
            peerId: (peer as any).peerId || peer.id
        }));
        const resolution = resolvePeerIdentity(aliasResolved, {
            peers,
            aliases: bridgeAliasMap,
            topology: topologyNodes
        });
        return resolution?.peerId || aliasResolved;
    };
    return (message: any) => {
        if (!message || typeof message !== "object") return;
        const msg = message as Record<string, unknown>;
        const target = msg.targetId || msg.deviceId || msg.target || msg.to || msg.target_id;
        const resolvedUserIdRaw = typeof msg.userId === "string" && msg.userId.trim() ? (msg.userId as string).trim() : defaultUserId;
        if (!resolvedUserIdRaw) return;
        const resolvedUserId = resolvedUserIdRaw.toLowerCase();
        const normalizedRequestedTarget = String(target ?? "");
        const resolvedRequestedTarget = resolveTargetWithPeerIdentity(resolvedUserId, normalizedRequestedTarget.trim());
        const sourceForPolicy = resolveSourceForPolicy(msg, resolvedUserId);
        if (!sourceForPolicy.isKnown && sourceForPolicy.sourceId !== resolvedUserId) {
            app.log?.warn?.(
                {
                    source: sourceForPolicy.sourceId,
                    rawSource: msg.source || msg.sourceId || msg.from || msg.src || msg.suggestedSource || msg.routeSource || msg._routeSource,
                    target: resolvedRequestedTarget || "-",
                    userId: resolvedUserId
                },
                "[bridge] route denied by unknown source"
            );
            return;
        }
        if (normalizedRequestedTarget.trim()) {
            const policyDecision = resolveEndpointPolicyRoute(sourceForPolicy.sourceId, resolvedRequestedTarget, endpointPolicyMap);
            if (!policyDecision.allowed) {
                app.log?.warn?.(
                    {
                        source: sourceForPolicy.sourceId,
                        target: resolvedRequestedTarget,
                        reason: policyDecision.reason,
                        userId: resolvedUserId
                    },
                    "[bridge] route denied by endpoint policy"
                );
                return;
            }
        }

        const payload = msg.payload ?? msg.data ?? msg.body ?? msg;
        const airpadBinary = tryDecodeBridgeBinary(payload);
        const hasAirpadBinaryPayload = airpadBinary instanceof Buffer;
        if (isTunnelDebug) {
            const payloadKeys = payload && typeof payload === "object" ? Object.keys(payload as Record<string, unknown>).join("|") : typeof payload;
            console.info(`[bridge] IN`, `userId=${resolvedUserId}`, `from=${sourceForPolicy.sourceId}`, `target=${resolvedRequestedTarget ? resolvedRequestedTarget : "-"}`, `type=${String(msg.type || msg.action || "dispatch")}`, `kind=${payloadKeys}`);
        }
        const namespace = typeof msg.namespace === "string" && msg.namespace ? msg.namespace : typeof msg.ns === "string" ? msg.ns : undefined;
        const type = String(msg.type || msg.action || "dispatch");
        const routed = {
            type,
            data: payload,
            namespace,
            from: typeof msg.from === "string" ? msg.from.toLowerCase().trim() : resolvedUserId,
            ts: parsePortableInteger(msg.ts) ?? Date.now()
        };
        if (type.toLowerCase() === "welcome") {
            if (isTunnelDebug) {
                app.log?.debug?.(
                    {
                        userId: resolvedUserId,
                        target: resolvedRequestedTarget,
                        from: sourceForPolicy.sourceId
                    },
                    "[bridge] ignored welcome event from bridge"
                );
            }
            return;
        }

        if (typeof resolvedRequestedTarget === "string" && resolvedRequestedTarget.trim()) {
            const requestedTarget = resolvedRequestedTarget.trim();
            const requestedTargetUser = requestedTarget.toLowerCase();
            const candidateUsers = Array.from(
                new Set<string>([
                    resolvedUserId,
                    ...(requestedTargetUser && requestedTargetUser !== resolvedUserId ? [requestedTargetUser] : [])
                ])
            );

            let resolved = false;
            let resolvedUserForDelivery = "";
            let resolvedTarget = "";
            let resolvedKind: "id" | "exactLabel" | "containsLabel" | undefined;
            let matchedLabel: string | undefined;
            let matchedUserPeers: string[] = [];
            let resolvedRequestLabel = "";

            for (const candidateUser of candidateUsers) {
                const peerProfiles = hub.getConnectedPeerProfiles(candidateUser);
                const resolvedTargetHint = resolveTunnelTarget(peerProfiles, requestedTarget);
                const candidateTarget = resolvedTargetHint?.profile.id || requestedTarget;
                const resolvedTo = hub.sendToDevice(candidateUser, candidateTarget, routed);
                if (resolvedTo) {
                    resolved = true;
                    resolvedUserForDelivery = candidateUser;
                    resolvedTarget = candidateTarget;
                    resolvedKind = resolvedTargetHint?.source;
                    matchedLabel = resolvedTargetHint?.profile.label;
                    matchedUserPeers = peerProfiles.map((entry) => `${entry.label}(${entry.id})`);
                    break;
                }
                if (!resolvedRequestLabel) {
                    resolvedRequestLabel = candidateTarget;
                }
            }
            const fallbackTarget =
                requestedTarget.toLowerCase() === "self" || requestedTarget.toLowerCase() === resolvedUserId.toLowerCase();
            const fallbackSent =
                !resolved && hub.getConnectedPeerProfiles(resolvedUserId).length > 0 && fallbackTarget
                    ? (() => {
                          hub.multicast(resolvedUserId, routed, namespace);
                          return true;
                      })()
                    : false;
            const shouldFallbackToLocalAirpad =
                hasAirpadBinaryPayload &&
                !resolved &&
                !fallbackSent &&
                (requestedTarget.toLowerCase() === "self" || isLocalEndpointTarget(requestedTarget, localEndpointIds));
            const decodedAirpadBinary = hasAirpadBinaryPayload ? (airpadBinary as Buffer) : undefined;
            const forcedLocalAirpad = shouldFallbackToLocalAirpad && !!decodedAirpadBinary ? handleAirpadBinaryMessage(app.log as any, decodedAirpadBinary) : false;
            const delivered = resolved || fallbackSent || forcedLocalAirpad;
            if (shouldFallbackToLocalAirpad && isTunnelDebug) {
                console.info(
                    `[bridge] airpad binary forced local fallback`,
                    `userId=${resolvedUserId}`,
                    `target=${requestedTarget}`,
                    `handled=${forcedLocalAirpad}`,
                    `from=${sourceForPolicy.sourceId}`
                );
            }

            if (!delivered) {
                const requestedPeers = hub.getConnectedPeerProfiles(resolvedUserId).map((entry) => `${entry.label}(${entry.id})`);
                const targetPeers = hub.getConnectedPeerProfiles(requestedTargetUser).map((entry) => `${entry.label}(${entry.id})`);
                if (isTunnelDebug) {
                    console.warn(
                        `[bridge] target resolve failed`,
                        `userId=${resolvedUserId}`,
                        `requested=${requestedTarget}`,
                        `resolved=${resolvedTarget || "-"}`,
                        `kind=${resolvedKind || "-"}`,
                        `known=${requestedPeers.join(",")}`,
                        `candidateUsers=${candidateUsers.join("|")}`,
                        `targetUsers=${targetPeers.join(",")}`
                    );
                }
                app.log?.warn?.(
                    {
                        userId: resolvedUserId,
                        target: resolvedRequestedTarget,
                        matchedLabel,
                        resolutionKind: resolvedKind,
                        resolvedTarget: resolvedRequestLabel || requestedTarget,
                        knownTargets: requestedPeers,
                        candidateUsers,
                        targetUserPeers: targetPeers,
                        payloadType: type
                    },
                    "[bridge] failed to route command to reverse target"
                );
            } else if (forcedLocalAirpad) {
                app.log?.debug?.(
                    {
                        userId: resolvedUserId,
                        requestedTarget,
                        payloadType: type,
                        source: sourceForPolicy.sourceId
                    },
                    "[bridge] forced airpad binary execution on local endpoint"
                );
            } else {
                app.log?.debug?.(
                    {
                        userId: resolvedUserId,
                        requestedTarget,
                        resolvedTarget,
                        resolvedUserForDelivery,
                        matchedLabel,
                        resolutionKind: resolvedKind,
                        payloadType: type,
                        knownTargets: matchedUserPeers,
                        fallbackToSelf: fallbackSent,
                        resolvedUserId
                    },
                    "[bridge] routed command to reverse target"
                );
                if (isTunnelDebug) {
                    console.info(
                        `[bridge] target resolved`,
                        `userId=${resolvedUserId}`,
                        `requested=${requestedTarget}`,
                        `deliveryUser=${resolvedUserForDelivery}`,
                        `resolved=${resolvedTarget}`,
                        `kind=${resolvedKind || "-"}`,
                        `delivered=${delivered}`,
                        `fallback=${fallbackSent}`
                    );
                }
            }
            app.log?.debug?.(
                {
                    delivered,
                    target: resolvedRequestedTarget,
                    userId: resolvedUserId,
                    deliveryUser: resolvedUserForDelivery || resolvedUserId,
                    resolvedTarget,
                    knownPeers: hub.getConnectedPeerProfiles(resolvedUserId).map((entry) => `${entry.label}(${entry.id})`)
                },
                "[bridge] routed command to device"
            );
            return;
        }

        hub.multicast(resolvedUserId, routed, namespace);
    };
};

const buildNetworkContext = (bridgeConnector: ReturnType<typeof startBridgePeerClient> | null) => {
    if (!bridgeConnector) return undefined;
    return {
        getBridgeStatus: () => bridgeConnector.getStatus(),
        sendToBridge: (payload: any) => bridgeConnector.send(payload),
        getNodeId: () => String(((config as any)?.bridge?.clientId || (config as any)?.bridge?.userId || "").trim() || (config as any)?.bridge?.origin?.originId || "").trim() || null
    };
};

export const buildCoreServer = async (opts: { logger?: boolean; httpsOptions?: any } = {}): Promise<FastifyInstance> => {
    const httpsOptions = typeof opts.httpsOptions !== "undefined" ? opts.httpsOptions : await loadHttpsOptions();

    const app = Fastify({
        logger: opts.logger ?? true,
        ...(httpsOptions ? { https: httpsOptions } : {})
    }) as unknown as FastifyInstance;

    const httpClient = createHttpClient(httpsOptions);
    setClipboardApp(app);
    setHttpClient(httpClient);
    setPythonApp(app);
    registerRoutes(app);
    await registerCoreApp(app);
    const wsHub = createWsServer(app);
    // Bridge connector: this node opens reverse sessions to an origin/gateway.
    const bridgeConnector = startBridgePeerClient(config as any, {
        onMessage: buildBridgeRouter(app, wsHub, (config as any)?.bridge?.userId || "")
    });
    const networkContext = buildNetworkContext(bridgeConnector);
    if (bridgeConnector) {
        app.addHook("onClose", async () => {
            bridgeConnector.stop();
        });
        app.log?.info?.("Bridge peer bridge started");
    }

    const socketIoBridge = createSocketIoBridge(app, {
        networkContext: networkContext
            ? {
                sendToBridge: networkContext.sendToBridge,
                bridgeUserId: networkContext.getNodeId() || (config as any)?.bridge?.userId
            }
            : undefined
    });
    await registerOpsRoutes(app, wsHub, networkContext, socketIoBridge);
    registerApiFallback(app);

    return app;
};

export const buildCoreServers = async (opts: { logger?: boolean; httpsOptions?: any } = {}): Promise<{ http: FastifyInstance; https?: FastifyInstance }> => {
    const httpsOptions = typeof opts.httpsOptions !== "undefined" ? opts.httpsOptions : await loadHttpsOptions();
    const http = Fastify({ logger: opts.logger ?? true }) as unknown as FastifyInstance;
    const https = Fastify({
        logger: opts.logger ?? true,
        https: httpsOptions
    }) as unknown as FastifyInstance;

    const sharedHttpClient = createHttpClient(httpsOptions);
    setHttpClient(sharedHttpClient);
    registerRoutes(http);
    const primaryApp = httpsOptions ? https : http;
    setClipboardApp(primaryApp);
    setPythonApp(primaryApp);

    const fallbackUserId = String((config as any)?.bridge?.userId || "").trim();
    const httpWsHub = createWsServer(http);
    const httpWsHubs: WsHub[] = [httpWsHub];
    const unifiedHub = makeUnifiedWsHub(httpWsHubs);
    // Bridge connector: HTTP-side bootstrap also reuses outbound reverse transport.
    const bridgeConnector = startBridgePeerClient(config as any, {
        onMessage: buildBridgeRouter(http, unifiedHub, fallbackUserId)
    });
    const networkContext = buildNetworkContext(bridgeConnector);

    await registerCoreApp(http);
    if (bridgeConnector) {
        http.addHook("onClose", async () => {
            bridgeConnector.stop();
        });
    }
    const httpSocketIoBridge = createSocketIoBridge(http, {
        networkContext: networkContext
            ? {
                sendToBridge: networkContext.sendToBridge,
                bridgeUserId: networkContext.getNodeId() || fallbackUserId
            }
            : undefined
    });
    await registerOpsRoutes(http, unifiedHub, networkContext, httpSocketIoBridge);
    registerApiFallback(http);

    if (!httpsOptions) return { http };
    const httpsWsHub = createWsServer(https);
    httpWsHubs.push(httpsWsHub);
    await registerCoreApp(https);
    registerRoutes(https);
    if (bridgeConnector) {
        https.addHook("onClose", async () => {
            bridgeConnector.stop();
        });
    }
    const httpsSocketIoBridge = createSocketIoBridge(https, {
        networkContext: networkContext
            ? {
                sendToBridge: networkContext.sendToBridge,
                bridgeUserId: networkContext.getNodeId() || fallbackUserId
            }
            : undefined
    });
    await registerOpsRoutes(https, unifiedHub, networkContext, httpsSocketIoBridge);
    registerApiFallback(https);

    return { http, https };
};

export const startCoreBackend = async (opts: { logger?: boolean; httpsOptions?: any } = {}): Promise<void> => {
    const args = parseCli(runtimeArgs());
    const httpsOptions = typeof opts.httpsOptions !== "undefined" ? opts.httpsOptions : await loadHttpsOptions();
    const configHttpsEnabled = (config as any)?.https?.enabled;
    const configHttpsEnabledText = typeof configHttpsEnabled === "boolean" ? (configHttpsEnabled ? "true" : "false") : undefined;
    const envHttpsEnabled = resolvePortableConfigBoolean(pickEnvStringLegacy("CWS_HTTPS_ENABLED") ?? configHttpsEnabledText);
    const httpsEnabled = httpsOptions !== undefined && envHttpsEnabled !== false && configHttpsEnabled !== false;
    const httpEnabled = resolvePortableConfigBoolean(pickEnvStringLegacy("CWS_HTTP_ENABLED")) !== false;

    const host = args.host ?? pickEnvStringLegacy("HOST") ?? "0.0.0.0";
    const defaultHttpsPort = 8443;

    // Backwards-compatible behavior:
    // - if only --port/PORT is provided:
    //   - when HTTPS is available -> treat as HTTPS port
    //   - when HTTPS is unavailable -> treat as HTTP port
    const envPort = pickEnvNumberLegacy("PORT");
    const legacyPort = args.port != null ? parsePortableInteger(args.port) : parsePortableInteger(envPort);
    const hasLegacyPort = legacyPort !== undefined;

    const httpPortRaw = args.httpPort ?? pickEnvNumberLegacy("HTTP_PORT") ?? pickEnvNumberLegacy("PORT_HTTP") ?? (!httpsEnabled && hasLegacyPort ? legacyPort : undefined);

    const httpsPort = parsePortableInteger(args.httpsPort ?? pickEnvNumberLegacy("HTTPS_PORT") ?? pickEnvNumberLegacy("PORT_HTTPS") ?? (httpsEnabled && hasLegacyPort ? legacyPort : defaultHttpsPort)) ?? defaultHttpsPort;

    const { http, https } = await buildCoreServers({ logger: opts.logger ?? true, httpsOptions });

    if (httpEnabled) {
        const parsedHttpPort = parsePortableInteger(httpPortRaw);
        const httpPort = parsedHttpPort === undefined ? await pickHttpPort(host) : parsedHttpPort;
        await http.listen({ port: httpPort, host });
        console.log(`[core-backend] listening on http://${host}:${httpPort}`);
    }
    if (!httpsEnabled) {
        console.log("[core-backend] HTTPS disabled: no valid certificates found or HTTPS disabled by env.");
    }
    if (httpsEnabled && https) {
        await https.listen({ port: httpsPort, host });
        console.log(`[core-backend] listening on https://${host}:${httpsPort}`);
    }

    startMouseFlushInterval();
    startClipboardPolling();
};

if (isMainModule(import.meta)) {
    startCoreBackend().catch((err) => {
        console.error("[core-backend] failed to start", err);
        process.exit(1);
    });
}

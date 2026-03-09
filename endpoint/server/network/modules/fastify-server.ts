import net from "node:net";

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
import config, { getConfigLoadReportSnapshot } from "../../config/config.ts";
import { registerRoutes } from "../../routing/routes.ts";
import { registerApiFallback, registerCoreApp } from "../../routing/core-app.ts";
import { createHttpClient } from "../stack/https.ts";
import { setApp as setClipboardApp, setHttpClient, startClipboardPolling } from "../../io/clipboard.ts";
import { startMouseFlushInterval } from "../../io/mouse.ts";
import { setApp as setPythonApp } from "../../gpt/python.ts";
import { resolvePeerIdentity } from "../stack/peer-identity.ts";
import { pickEnvBoolLegacy, pickEnvNumberLegacy, pickEnvStringLegacy } from "../../lib/env.ts";
import { normalizeEndpointPolicies, resolveEndpointIdPolicyStrict, resolveEndpointPolicyRoute, resolveEndpointTransportPreference } from "../stack/endpoint-policy.ts";
import { handleMouseBinaryAction, handleKeyboardBinaryAction } from "../../airpad/index.ts";
import { parseBinaryMessage } from "../../io/message.ts";

const shouldSuppressFastifyStartupLog = (msg: string | undefined): boolean => {
    if (!msg) return false;
    return msg.startsWith("Server listening at ");
};

const formatLoggerValue = (value: unknown): string => {
    if (typeof value === "undefined") return "";
    if (typeof value === "string") return value;
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
};

const formatLoggerPayload = (payload: Record<string, any> | undefined): string => {
    if (!payload || Object.keys(payload).length === 0) return "";
    const entries = Object.entries(payload).filter(([key]) => key !== "msg" && key !== "hostname" && key !== "pid" && key !== "time" && key !== "level");
    if (entries.length === 0) return "";
    return entries
        .map(([key, value]) => `  ${key}: ${formatLoggerValue(value)}`)
        .join("\n");
};

const makeReadableFastifyLogger = () => {
    const write = (chunk: unknown): void => {
        let payload: Record<string, any> = {};
        let messageText = "";
        if (typeof chunk === "string") {
            try {
                const parsed = JSON.parse(chunk);
                if (parsed && typeof parsed === "object") {
                    payload = parsed as Record<string, any>;
                    messageText = String(parsed.msg || "");
                } else {
                    messageText = String(chunk);
                }
            } catch {
                messageText = String(chunk);
            }
        } else {
            messageText = String(chunk);
        }

        if (!messageText) return;
        const level = String(payload?.level ?? "info");
        if (shouldSuppressFastifyStartupLog(messageText)) return;
        const detail = formatLoggerPayload(payload);
        const line = `[${level}] ${messageText}`;
        console.log(detail ? `${line}\n${detail}` : line);
    };
    return {
        level: "info",
        stream: { write }
    };
};

const handleLocalAirpadPayload = (app: FastifyInstance, frame: any): boolean => {
    const payload = frame?.payload || frame?.data || frame;
    const frameType = String(frame?.type || payload?.type || "").toLowerCase();
    if (!payload) return false;
    
    const action = String(payload.action || payload.type || "").toLowerCase();
    // Accept plain "clipboard" tunnel frames where payload can be a string/object.
    if (frameType === "clipboard" || action === "clipboard") {
        const text =
            (typeof frame?.text === "string" && frame.text) ||
            (typeof payload?.text === "string" && payload.text) ||
            (typeof payload?.body === "string" && payload.body) ||
            (typeof payload?.data === "string" && payload.data) ||
            (typeof payload === "string" ? payload : "");
        if (typeof text === "string" && text.trim()) {
            app.log?.info?.("Clipboard write via tunnel");
            import("../../io/clipboard.ts").then(({ writeClipboard }) => {
                writeClipboard(text).catch(err => {
                    app.log?.error?.({ err }, "Failed to write clipboard");
                });
            });
            return true;
        }
    }

    if (
        action === "clipboard" ||
        action === "clipboard.write" ||
        action === "clipboard:set" ||
        action === "clipboard.request" ||
        action === "clipboard.read" ||
        action === "clipboard.get" ||
        action === "clipboard.request.read" ||
        action === "clipboard.request.get" ||
        action === "copy" ||
        action === "paste" ||
        action === "clipboard.copy" ||
        action === "clipboard.paste" ||
        action === "clipboard.request.paste" ||
        action === "clipboard.request.insert" ||
        action === "clipboard.insert"
    ) {
        const text = payload.text || payload.data?.text || payload.body || (typeof payload.data === "string" ? payload.data : "");
        if (typeof text === "string" && text) {
            app.log?.info?.("Clipboard write via tunnel");
            import("../../io/clipboard.ts").then(({ writeClipboard }) => {
                writeClipboard(text).catch(err => {
                    app.log?.error?.({ err }, "Failed to write clipboard");
                });
            });
            return true;
        }
    }
    
    if (action === "dispatch" || action === "network.dispatch" || action === "http") {
        const requestsRaw = payload.requests || payload.data?.requests || (Array.isArray(payload.data) ? payload.data : [payload.data || payload]);
        const requests = Array.isArray(requestsRaw) ? requestsRaw : [requestsRaw];
        if (requests.length > 0) {
            app.log?.info?.(`Network dispatch via tunnel (${requests.length} requests)`);
            requests.forEach((req: any) => {
                if (!req || !req.url) return;
                const url = req.url;
                const method = req.method || "POST";
                const headers = req.headers || {};
                const body = req.body;
                
                try {
                    fetch(url, {
                        method,
                        headers,
                        body: typeof body === "string" ? body : (body ? JSON.stringify(body) : undefined)
                    }).catch(err => {
                        app.log?.error?.({ err, url }, "Tunnel dispatch failed");
                    });
                } catch (e) {
                    app.log?.error?.({ err: e, url }, "Tunnel dispatch error");
                }
            });
            return true;
        }
    }
    
    if (action === "voice_command") {
        const text = String(payload.text || "");
        if (text) {
            app.log?.info?.("Voice command via tunnel");
            import("../../gpt/python.ts").then(({ sendVoiceToPython }) => {
                sendVoiceToPython(null, text).catch((err: any) => {
                    app.log?.error?.({ err }, "Failed to send voice command to python");
                });
            });
            return true;
        }
        return false;
    }

    if (!payload.__airpadBinary) return false;
    try {
        const raw = Buffer.from(payload.data, "base64");
        const msg = parseBinaryMessage(raw);
        if (!msg) return false;
        const handledByMouse = handleMouseBinaryAction(app.log, msg);
        const handledByKeyboard = handleKeyboardBinaryAction(app.log, msg);
        return handledByMouse || handledByKeyboard;
    } catch {
        return false;
    }
};

const stripPolicyTargetPort = (value: string): string => {
    const normalized = String(value || "").trim();
    if (!normalized) return "";
    const colonIndex = normalized.lastIndexOf(":");
    if (colonIndex < 0) return normalized;
    const suffix = normalized.slice(colonIndex + 1);
    return /^\d+$/.test(suffix) ? normalized.slice(0, colonIndex) : normalized;
};

const resolveEndpointPolicyTarget = (endpointPolicyMap: ReturnType<typeof normalizeEndpointPolicies>, rawTarget: string): string => {
    const normalized = stripPolicyTargetPort(String(rawTarget || "").trim().toLowerCase());
    if (!normalized) return "";
    const directMatch = endpointPolicyMap[normalized];
    if (directMatch && directMatch.id) {
        return directMatch.id === "*" ? normalized : directMatch.id;
    }
    const policyDecision = resolveEndpointPolicyRoute(normalized, normalized, endpointPolicyMap);
    const candidate = policyDecision?.targetPolicy?.id || "";
    return candidate && candidate !== "*" && candidate !== normalized ? candidate : normalized;
};

const buildBridgeForwardPayload = (
    app: FastifyInstance,
    userId: string,
    fallbackUserId: string,
    deviceId: string,
    frame: Record<string, unknown> | null | undefined,
    sourceForPolicy: string,
    endpointPolicyMap: ReturnType<typeof normalizeEndpointPolicies>
): Record<string, unknown> | null => {
    if (!frame || typeof frame !== "object") return null;
    const rawTarget = String(deviceId || frame?.target || frame?.to || frame?.targetId || "").trim();
    const target = resolveEndpointPolicyTarget(endpointPolicyMap, rawTarget);
    if (!target) return null;
    const preference = resolveEndpointTransportPreference(sourceForPolicy, target, endpointPolicyMap);
    const supportsBridge = preference.transports.includes("ws") || preference.transports.includes("socketio");
    if (!supportsBridge) {
        app.log?.debug?.(
            {
                userId,
                target,
                source: sourceForPolicy,
                route: preference.hasExplicitRelation ? "policy-blocked" : "policy-unset",
                transports: preference.transports.join("|")
            },
            "[bridge] skipping forward fallback by transport policy"
        );
        return null;
    }

    const payload = {
        ...(frame as Record<string, unknown>),
        type: String((frame as Record<string, unknown>).type || "dispatch"),
        data: (frame as Record<string, unknown>).payload ?? (frame as Record<string, unknown>).data,
        from: String(sourceForPolicy || (frame as Record<string, unknown>).from || frame?.source || userId || fallbackUserId || "unknown"),
        source: String(sourceForPolicy || (frame as Record<string, unknown>).source || (frame as Record<string, unknown>).from || userId || fallbackUserId || "unknown"),
        userId,
        to: target,
        target: target,
        targetId: target,
        targetSource: "fallback",
        route: "ws-forward-fallback",
        routeSource: sourceForPolicy || String((frame as Record<string, unknown>).source || ""),
        routeTarget: target
    };
    if (!payload.from) {
        delete payload.from;
    }
    return payload;
};

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
        getConnectionRegistry: (userId?: string) => {
            const seen = new Map<string, any>();
            for (const hub of hubs) {
                const entries = hub.getConnectionRegistry ? hub.getConnectionRegistry(userId) : [];
                for (const entry of entries) {
                    if (!entry?.id) continue;
                    if (!seen.has(entry.id)) {
                        seen.set(entry.id, entry);
                    }
                }
            }
            return Array.from(seen.values());
        },
        close: async () => {
            await Promise.all(hubs.map((hub) => hub.close()));
        },
        getUserId: () => {
            for (const hub of hubs) {
                if (hub.getUserId) {
                    const id = hub.getUserId();
                    if (id) return id;
                }
            }
            return "";
        },
        onUnknownTarget: (userId: string, deviceId: string, frame: any) => {
            for (const hub of hubs) {
                if (hub.onUnknownTarget && hub.onUnknownTarget(userId, deviceId, frame)) {
                    return true;
                }
            }
            return false;
        }
    } as any;
};

// Receives messages from bridge gateway/origin and dispatches them into local peer hub.
const sensitiveBridgeKeys = new Set(["text", "body", "payload", "data", "clipboard", "content"]);

const sanitizeBridgeLogValue = (value: unknown): unknown => {
    if (value === null || typeof value === "undefined") return value;
    if (typeof value === "string") {
        return value;
    }
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

const formatBridgeLog = (prefix: string, payload: Record<string, any>): string => {
    try {
        return `${prefix}\n${JSON.stringify(sanitizeBridgeLogValue(payload), null, 2)}`;
    } catch {
        return `${prefix}\n${String(payload)}`;
    }
};

const buildBridgeRouter = (app: FastifyInstance, hub: WsHub, fallbackUserId: string) => {
    const bridgeAliasMap = normalizeNetworkAliasMap((config as any)?.networkAliases || {});
    const endpointPolicyMap = normalizeEndpointPolicies((config as any)?.endpointIDs || {});
    const isTunnelDebug = pickEnvBoolLegacy("CWS_TUNNEL_DEBUG") === true;
    const defaultUserId = fallbackUserId || "";
    
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
        const messageType = String(msg.type || msg.action || "").trim().toLowerCase();
        if (messageType === "welcome") {
            if (isTunnelDebug) {
                console.debug(
                    formatBridgeLog("[bridge] ignored welcome event from bridge", {
                        userId: (typeof msg.userId === "string" && msg.userId.trim()) || defaultUserId || "unknown",
                        type: messageType || "dispatch",
                        from:
                            (typeof msg.from === "string" && msg.from.trim()) ||
                            (typeof msg.source === "string" && msg.source.trim()) ||
                            (typeof msg.sourceId === "string" && msg.sourceId.trim()) ||
                            (typeof msg.src === "string" && msg.src.trim()) ||
                            "unknown",
                        target: typeof msg.target === "string" && msg.target.trim() ? msg.target : typeof msg.to === "string" && msg.to.trim() ? msg.to : typeof msg.targetId === "string" && msg.targetId.trim() ? msg.targetId : "-"
                    })
                );
            }
            return;
        }
        const target = msg.targetId || msg.deviceId || msg.target || msg.to || msg.target_id;
        const resolvedUserIdRaw = typeof msg.userId === "string" && msg.userId.trim() ? (msg.userId as string).trim() : defaultUserId;
        if (!resolvedUserIdRaw) return;
        const resolvedUserId = resolvedUserIdRaw.toLowerCase();
        const normalizedRequestedTarget = String(target ?? "");
        const resolvedRequestedTarget = resolveTargetWithPeerIdentity(resolvedUserId, normalizedRequestedTarget.trim());
        const sourceForPolicy = resolveSourceForPolicy(msg, resolvedUserId);
        if (!sourceForPolicy.isKnown && sourceForPolicy.sourceId !== resolvedUserId) {
            if (isTunnelDebug) {
                console.warn(
                    formatBridgeLog("[bridge] route denied by unknown source", {
                        source: sourceForPolicy.sourceId,
                        rawSource: msg.source || msg.sourceId || msg.from || msg.src || msg.suggestedSource || msg.routeSource || msg._routeSource,
                        target: resolvedRequestedTarget || "-",
                        userId: resolvedUserId,
                        targetSource: "explicit"
                    })
                );
            }
            return;
        }
        if (normalizedRequestedTarget.trim()) {
            const policyDecision = resolveEndpointPolicyRoute(sourceForPolicy.sourceId, resolvedRequestedTarget, endpointPolicyMap);
            if (!policyDecision.allowed) {
                if (isTunnelDebug) {
                    console.warn(
                        formatBridgeLog("[bridge] route denied by endpoint policy", {
                            source: sourceForPolicy.sourceId,
                            target: resolvedRequestedTarget,
                            reason: policyDecision.reason,
                            userId: resolvedUserId,
                            targetSource: "explicit"
                        })
                    );
                }
                return;
            }
        }

        const payload = msg.payload ?? msg.data ?? msg.body ?? msg;
        const incomingTargetSource =
            String((msg as Record<string, unknown>).targetSource).trim().toLowerCase() === "fallback" ? "fallback" : "explicit";
        if (isTunnelDebug) {
            const payloadKeys = payload && typeof payload === "object" ? Object.keys(payload as Record<string, unknown>).join("|") : typeof payload;
            console.info(
                formatBridgeLog("[bridge] IN", {
                    userId: resolvedUserId,
                    from: sourceForPolicy.sourceId,
                    target: resolvedRequestedTarget ? resolvedRequestedTarget : "-",
                    type: String(msg.type || msg.action || "dispatch"),
                    kind: payloadKeys,
                    targetSource: incomingTargetSource,
                    route: "bridge-router"
                })
            );
        }
        const namespace = typeof msg.namespace === "string" && msg.namespace ? msg.namespace : typeof msg.ns === "string" ? msg.ns : undefined;
        const type = String(msg.type || msg.action || "dispatch");
        const routed = {
            type,
            data: payload,
            namespace,
            targetSource: incomingTargetSource,
            from: typeof msg.from === "string" ? msg.from.toLowerCase().trim() : resolvedUserId,
            source: sourceForPolicy.sourceId,
            route: "bridge-router",
            hops: [sourceForPolicy.sourceId, resolvedUserId].filter((value) => Boolean(value)),
            ts: parsePortableInteger(msg.ts) ?? Date.now()
        };
        if (typeof resolvedRequestedTarget === "string" && resolvedRequestedTarget.trim()) {
            const requestedTarget = resolvedRequestedTarget.trim();
            const peerProfiles = hub.getConnectedPeerProfiles(resolvedUserId);
            const resolvedTargetHint = resolveTunnelTarget(peerProfiles, requestedTarget);
            const resolvedTarget = resolvedTargetHint?.profile.id || requestedTarget;
            const resolvedKind = resolvedTargetHint?.source;
            
            const transportPref = resolveEndpointTransportPreference(sourceForPolicy.sourceId, resolvedTarget, endpointPolicyMap);
            const canWs = transportPref.transports.includes("ws");
            
            const resolved = canWs ? hub.sendToDevice(resolvedUserId, resolvedTarget, routed) : false;
            const requestedTargetLower = requestedTarget.toLowerCase();
            const fallbackTarget =
                requestedTargetLower === "self" || 
                requestedTargetLower === resolvedUserId.toLowerCase() || 
                requestedTarget === "broadcast" || 
                requestedTarget === "all" || 
                requestedTarget === "*" || 
                requestedTargetLower === (hub.getUserId?.() || "").toLowerCase() || 
                requestedTargetLower === ((config as any)?.bridge?.deviceId || "").toLowerCase() || 
                requestedTargetLower === ((config as any)?.bridge?.userId || "").toLowerCase();
            const fallbackSent =
                !resolved && peerProfiles.length > 0 && fallbackTarget
                    ? (() => {
                          hub.multicast(resolvedUserId, routed, namespace);
                          return true;
                      })()
                    : false;
            let delivered = resolved || fallbackSent;

            if (!delivered) {
                if (hub.onUnknownTarget && hub.onUnknownTarget(resolvedUserId, requestedTarget, routed)) {
                    delivered = true;
                }
            }

            const knownPeers = peerProfiles.map((entry) => `${entry.label}(${entry.id})`);

            if (!delivered) {
                if (isTunnelDebug) {
                    console.warn(
                        formatBridgeLog("[bridge] target resolve failed", {
                            userId: resolvedUserId,
                            requested: requestedTarget,
                            resolved: resolvedTarget || "-",
                            kind: resolvedKind || "-",
                            known: knownPeers,
                            targetSource: incomingTargetSource
                        })
                    );
                }
                app.log?.warn?.(
                    {
                        userId: resolvedUserId,
                        target: resolvedRequestedTarget,
                        matchedLabel: resolvedTargetHint?.profile.label,
                        resolutionKind: resolvedKind,
                        resolvedTarget,
                        knownTargets: knownPeers,
                        payloadType: type
                    },
                    "[bridge] failed to route command to reverse target"
                );
            } else {
                app.log?.debug?.(
                    {
                        userId: resolvedUserId,
                        requestedTarget: requestedTarget,
                        resolvedTarget,
                        matchedLabel: resolvedTargetHint?.profile.label,
                        resolutionKind: resolvedKind,
                        payloadType: type,
                        knownTargets: knownPeers,
                        fallbackToSelf: fallbackSent,
                        resolvedUserId
                    },
                    "[bridge] routed command to reverse target"
                );
                if (isTunnelDebug) {
                    console.info(
                        formatBridgeLog("[bridge] target resolved", {
                            userId: resolvedUserId,
                            requested: requestedTarget,
                            resolved: resolvedTarget,
                            kind: resolvedKind || "-",
                            delivered,
                            fallback: fallbackSent,
                            targetSource: incomingTargetSource
                        })
                    );
                }
            }
            app.log?.debug?.(
                {
                    delivered,
                    target: resolvedRequestedTarget,
                    userId: resolvedUserId,
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

const formatShortList = (items: string[] | undefined, limit = 8) => {
    if (!Array.isArray(items) || !items.length) return "none";
    const normalized = items.map((entry) => String(entry)).filter(Boolean);
    if (!normalized.length) return "none";
    if (normalized.length <= limit) return normalized.join(", ");
    return `${normalized.slice(0, limit).join(", ")} ... (+${normalized.length - limit})`;
};

const toSortedUniqueStringList = (items: string[] | undefined): string[] => {
    if (!Array.isArray(items)) return [];
    return [...new Set(items.map((entry) => String(entry || "").trim()).filter(Boolean))].sort();
};

const formatValueList = (values: string[] | undefined, limit = 20) => {
    const normalized = toSortedUniqueStringList(values);
    if (!normalized.length) return "none";
    return normalized.length <= limit ? normalized.join(", ") : `${normalized.slice(0, limit).join(", ")} ... (+${normalized.length - limit})`;
};

const inferEndpointIdentityKind = (policyId: string, aliasCandidates: string[], policy: Record<string, any> | undefined): string => {
    const kindHints = new Set<string>();
    const normalizedPolicyRoles = toSortedUniqueStringList((policy?.roles as string[] | undefined)).map((role) => role.toLowerCase());
    for (const role of normalizedPolicyRoles) {
        if (!role) continue;
        if (role.includes("gateway") || role === "hub") kindHints.add("gateway");
        if (role.includes("mobile") || role === "client") kindHints.add("mobile-client");
        if (role === "endpoint" || role === "server") kindHints.add("endpoint");
    }

    const normalizedFlags = (policy?.flags as Record<string, unknown>) || {};
    if (normalizedFlags.gateway === true) kindHints.add("gateway");
    if (normalizedFlags.mobile === true) kindHints.add("mobile-client");
    if (normalizedFlags.direct === true) kindHints.add("endpoint");

    const allIds = [...aliasCandidates, policyId].map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean);
    if (allIds.some((entry) => entry.startsWith("h-"))) kindHints.add("hub");
    if (allIds.some((entry) => entry.startsWith("l-"))) kindHints.add("local-endpoint");
    if (allIds.some((entry) => entry.startsWith("p-"))) kindHints.add("private-endpoint");

    if (!kindHints.size) kindHints.add("endpoint");
    return Array.from(kindHints).sort().join("|");
};

const logStartupConfigOverview = () => {
    const endpointIds = ((config as any)?.endpointIDs || {}) as Record<string, any>;
    const endpointIdKeys = Object.keys(endpointIds).filter((value) => value !== "*").sort();
    const endpointIdPreview = endpointIdKeys.slice(0, 20);
    const policyMap = normalizeEndpointPolicies(endpointIds);
    const policyKeys = Object.keys(policyMap).filter((value) => value !== "*").sort();
    const policyIdPreview = policyKeys.slice(0, 20);
    const candidatePayload = typeof getConfigLoadReportSnapshot === "function" ? getConfigLoadReportSnapshot() : undefined;
    const usedPortable = candidatePayload?.selectedPortableConfig || "not selected";
    const selectedConfig = candidatePayload?.selectedEndpointConfig || "default config fallback";
    const availableClientsSource = candidatePayload?.portableImplicitClients?.source || "not_checked";
    const availableGatewaysSource = candidatePayload?.portableImplicitGateways?.source || "not_checked";
    const registeredCount = policyKeys.length;
    const registrationRows = (candidatePayload?.endpointIdDefinitions || [])
        .filter((entry) => typeof entry?.actualId === "string")
        .filter((entry) => entry.actualId !== "*");
    const byActualId = new Map<string, { papers: string[]; paperOrigins: string[]; paperTokens: string[]; actualOrigins: string[]; actualTokens: string[] }>();
    for (const entry of registrationRows) {
        const actualId = entry.actualId.trim().toLowerCase();
        const bucket = byActualId.get(actualId) ?? { papers: [], paperOrigins: [], paperTokens: [], actualOrigins: [], actualTokens: [] };
        if (entry.paperId) bucket.papers.push(entry.paperId);
        bucket.paperOrigins.push(...toSortedUniqueStringList(entry.paperOrigins));
        bucket.paperTokens.push(...toSortedUniqueStringList(entry.paperTokens));
        byActualId.set(actualId, bucket);
    }
    for (const policyId of policyKeys) {
        const policy = policyMap[policyId];
        const bucket = byActualId.get(policyId) ?? { papers: [], paperOrigins: [], paperTokens: [], actualOrigins: [], actualTokens: [] };
        bucket.actualOrigins.push(...toSortedUniqueStringList(policy?.origins as string[] | undefined));
        bucket.actualTokens.push(...toSortedUniqueStringList(policy?.tokens as string[] | undefined));
        byActualId.set(policyId, bucket);
    }

    const printIdRows = (label: string, ids: string[]) => {
        console.log(`[core-startup] ${label}:`);
        if (!ids.length) {
            console.log("  none");
            return;
        }
        for (const policyId of ids) {
            const row = byActualId.get(policyId) ?? { papers: [policyId], paperOrigins: [], paperTokens: [], actualOrigins: [], actualTokens: [] };
            const papers = toSortedUniqueStringList(row.papers);
            const actualOrigins = formatValueList(row.actualOrigins);
            const paperOrigins = formatValueList(row.paperOrigins);
            const actualTokens = formatValueList(row.actualTokens);
            const paperTokens = formatValueList(row.paperTokens);
            const identityKind = inferEndpointIdentityKind(policyId, papers, policyMap[policyId]);
            const responseAliases = papers.filter((entry) => entry.toLowerCase() !== policyId);
            const identityValues = toSortedUniqueStringList([policyId, ...papers]);
            console.log(
                `  - [identity: ${formatValueList(identityValues, 8)}] [kind: ${identityKind}] [ip_actual: ${actualOrigins}] [ip_paper: ${paperOrigins}] [token_actual: ${actualTokens}] [token_paper: ${paperTokens}]`
            );
            console.log(`    aliases: ${formatValueList(responseAliases, 12)}`);
        }
    };

    console.log("[core-startup] endpoint configuration:");
    console.log(`[core-startup] selected core config: ${selectedConfig}`);
    console.log(`[core-startup] portable config candidates: ${formatShortList(candidatePayload?.portableCandidatesChecked, 6)}`);
    console.log(`[core-startup] selected portable config: ${usedPortable}`);
    console.log(`[core-startup] portable modules: ${formatShortList(candidatePayload?.portableModules, 6)}`);
    console.log(
        `[core-startup] implicit fs clients: source=${availableClientsSource} loaded=${candidatePayload?.portableImplicitClients?.loaded ? "yes" : "no"} entries=${candidatePayload?.portableImplicitClients?.entries ?? 0} exists=${candidatePayload?.portableImplicitClients?.exists ? "yes" : "no"} ids=${formatShortList(candidatePayload?.portableImplicitClients?.ids as string[] | undefined, 12)}`
    );
    console.log(
        `[core-startup] implicit fs gateways: source=${availableGatewaysSource} loaded=${candidatePayload?.portableImplicitGateways?.loaded ? "yes" : "no"} entries=${candidatePayload?.portableImplicitGateways?.entries ?? 0} exists=${candidatePayload?.portableImplicitGateways?.exists ? "yes" : "no"} ids=${formatShortList(candidatePayload?.portableImplicitGateways?.ids as string[] | undefined, 12)}`
    );
    console.log(`[core-startup] legacy clients sources: ${formatShortList(candidatePayload?.legacyClientsSources as string[] | undefined, 6)}`);
    console.log(`[core-startup] legacy gateways sources: ${formatShortList(candidatePayload?.legacyGatewaysSources as string[] | undefined, 6)}`);
    console.log(`[core-startup] endpointIDs available in config: ${endpointIdKeys.length}; registered for routing: ${registeredCount}`);
    printIdRows("endpointID preview", endpointIdPreview);
    printIdRows("registered endpointID preview", policyIdPreview);
};

export const buildCoreServer = async (opts: { logger?: boolean; httpsOptions?: any } = {}): Promise<FastifyInstance> => {
    const httpsOptions = typeof opts.httpsOptions !== "undefined" ? opts.httpsOptions : await loadHttpsOptions();
    const loggerEnabled = opts.logger ?? true;
    const logger = loggerEnabled ? makeReadableFastifyLogger() : false;

    const app = Fastify({
        logger,
        disableRequestLogging: true,
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
                bridgeUserId: networkContext.getNodeId() || (config as any)?.bridge?.userId,
                sendToReverse: (userId: string, deviceId: string, payload: any) => wsHub.sendToDevice(userId, deviceId, payload)
            }
            : undefined
    });
    wsHub.onUnknownTarget = (userId, deviceId, frame) => {
        const sourceForPolicy = frame?.from || (config as any)?.bridge?.userId || "";
        const endpointPolicyMap = normalizeEndpointPolicies((config as any)?.endpointIDs || {});
        const targetSource = String((frame as Record<string, any>)?.targetSource || "").trim().toLowerCase() === "fallback" ? "fallback" : "explicit";
        const resolvedDeviceId = resolveEndpointPolicyTarget(endpointPolicyMap, String(deviceId || ""));
        const targetForRoute = resolvedDeviceId || deviceId;
        const transportPref = resolveEndpointTransportPreference(sourceForPolicy, targetForRoute, endpointPolicyMap);
        const canSocketIo = transportPref.transports.includes("socketio");
        const sent = canSocketIo ? socketIoBridge.sendToDevice(userId, targetForRoute, frame) : false;
        const bridgePayload = !sent && targetSource !== "fallback" && networkContext?.sendToBridge
            ? buildBridgeForwardPayload(
                app,
                userId,
                ((config as any)?.bridge?.userId || ""),
                targetForRoute,
                frame,
                String(sourceForPolicy || ""),
                endpointPolicyMap
            )
            : null;
        const sentViaBridge = !sent && bridgePayload ? networkContext?.sendToBridge?.(bridgePayload) === true : false;
        
        if (!sent && handleLocalAirpadPayload(app, frame)) {
            console.log(
                formatBridgeLog("[bridge] unknown ws target handled locally", {
                    userId,
                    deviceId: targetForRoute,
                    type: frame?.type,
                    from: frame?.from,
                    targetSource
                })
            );
            return true;
        }
        if (!sent && !sentViaBridge && app.log) {
            console.warn(
                formatBridgeLog("[bridge] unknown ws target not handled", {
                    userId,
                    deviceId: targetForRoute,
                    type: frame?.type,
                    from: frame?.from,
                    targetSource
                })
            );
        } else if (!sent && sentViaBridge && app.log) {
            console.log(
                formatBridgeLog("[bridge] unknown ws target forwarded via bridge", {
                    userId,
                    deviceId: targetForRoute,
                    type: frame?.type,
                    from: bridgePayload?.from,
                    route: bridgePayload?.route,
                    targetSource: "fallback"
                })
            );
        }
        return sent || sentViaBridge;
    };
    await registerOpsRoutes(app, wsHub, networkContext, socketIoBridge);
    registerApiFallback(app);

    return app;
};

export const buildCoreServers = async (opts: { logger?: boolean; httpsOptions?: any } = {}): Promise<{ http: FastifyInstance; https?: FastifyInstance }> => {
    const httpsOptions = typeof opts.httpsOptions !== "undefined" ? opts.httpsOptions : await loadHttpsOptions();
    const loggerEnabled = opts.logger ?? true;
    const logger = loggerEnabled ? makeReadableFastifyLogger() : false;
    const http = Fastify({ logger, disableRequestLogging: true }) as unknown as FastifyInstance;
    const https = Fastify({
        logger,
        disableRequestLogging: true,
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
                bridgeUserId: networkContext.getNodeId() || fallbackUserId,
                sendToReverse: (userId: string, deviceId: string, payload: any) => unifiedHub.sendToDevice(userId, deviceId, payload)
            }
            : undefined
    });
    httpWsHub.onUnknownTarget = (userId, deviceId, frame) => {
        const sourceForPolicy = frame?.from || fallbackUserId;
        const endpointPolicyMap = normalizeEndpointPolicies((config as any)?.endpointIDs || {});
        const targetSource = String((frame as Record<string, any>)?.targetSource || "").trim().toLowerCase() === "fallback" ? "fallback" : "explicit";
        const resolvedDeviceId = resolveEndpointPolicyTarget(endpointPolicyMap, String(deviceId || ""));
        const targetForRoute = resolvedDeviceId || deviceId;
        const transportPref = resolveEndpointTransportPreference(sourceForPolicy, targetForRoute, endpointPolicyMap);
        const canSocketIo = transportPref.transports.includes("socketio");
        const sent = canSocketIo ? httpSocketIoBridge.sendToDevice(userId, targetForRoute, frame) : false;
        const bridgePayload = !sent && targetSource !== "fallback" && networkContext?.sendToBridge
            ? buildBridgeForwardPayload(
                http,
                userId,
                fallbackUserId,
                targetForRoute,
                frame,
                String(sourceForPolicy || ""),
                endpointPolicyMap
            )
            : null;
        const sentViaBridge = !sent && bridgePayload ? networkContext?.sendToBridge?.(bridgePayload) === true : false;
        
        if (!sent && handleLocalAirpadPayload(http, frame)) {
            console.log(
                formatBridgeLog("[bridge] unknown ws target handled locally", {
                    userId,
                    deviceId: targetForRoute,
                    type: frame?.type,
                    from: frame?.from,
                    targetSource
                })
            );
            return true;
        }
        if (!sent && !sentViaBridge && http.log) {
            console.warn(
                formatBridgeLog("[bridge] unknown ws target not handled", {
                    userId,
                    deviceId: targetForRoute,
                    type: frame?.type,
                    from: frame?.from,
                    targetSource
                })
            );
        } else if (!sent && sentViaBridge && http.log) {
            console.log(
                formatBridgeLog("[bridge] unknown ws target forwarded via bridge", {
                    userId,
                    deviceId: targetForRoute,
                    type: frame?.type,
                    from: bridgePayload?.from,
                    route: bridgePayload?.route,
                    targetSource: "fallback"
                })
            );
        }
        return sent || sentViaBridge;
    };
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
                bridgeUserId: networkContext.getNodeId() || fallbackUserId,
                sendToReverse: (userId: string, deviceId: string, payload: any) => unifiedHub.sendToDevice(userId, deviceId, payload)
            }
            : undefined
    });
    httpsWsHub.onUnknownTarget = (userId, deviceId, frame) => {
        const sourceForPolicy = frame?.from || fallbackUserId;
        const endpointPolicyMap = normalizeEndpointPolicies((config as any)?.endpointIDs || {});
        const targetSource = String((frame as Record<string, any>)?.targetSource || "").trim().toLowerCase() === "fallback" ? "fallback" : "explicit";
        const resolvedDeviceId = resolveEndpointPolicyTarget(endpointPolicyMap, String(deviceId || ""));
        const targetForRoute = resolvedDeviceId || deviceId;
        const transportPref = resolveEndpointTransportPreference(sourceForPolicy, targetForRoute, endpointPolicyMap);
        const canSocketIo = transportPref.transports.includes("socketio");
        const sent = canSocketIo ? httpsSocketIoBridge.sendToDevice(userId, targetForRoute, frame) : false;
        const bridgePayload = !sent && targetSource !== "fallback" && networkContext?.sendToBridge
            ? buildBridgeForwardPayload(
                https,
                userId,
                fallbackUserId,
                targetForRoute,
                frame,
                String(sourceForPolicy || ""),
                endpointPolicyMap
            )
            : null;
        const sentViaBridge = !sent && bridgePayload ? networkContext?.sendToBridge?.(bridgePayload) === true : false;
        
        if (!sent && handleLocalAirpadPayload(https, frame)) {
            console.log(
                formatBridgeLog("[bridge] unknown ws target handled locally", {
                    userId,
                    deviceId: targetForRoute,
                    type: frame?.type,
                    from: frame?.from,
                    targetSource
                })
            );
            return true;
        }
        if (!sent && !sentViaBridge && https.log) {
            console.warn(
                formatBridgeLog("[bridge] unknown ws target not handled", {
                    userId,
                    deviceId: targetForRoute,
                    type: frame?.type,
                    from: frame?.from,
                    targetSource
                })
            );
        } else if (!sent && sentViaBridge && https.log) {
            console.log(
                formatBridgeLog("[bridge] unknown ws target forwarded via bridge", {
                    userId,
                    deviceId: targetForRoute,
                    type: frame?.type,
                    from: bridgePayload?.from,
                    route: bridgePayload?.route,
                    targetSource: "fallback"
                })
            );
        }
        return sent || sentViaBridge;
    };
    await registerOpsRoutes(https, unifiedHub, networkContext, httpsSocketIoBridge);
    registerApiFallback(https);

    return { http, https };
};

export const startCoreBackend = async (opts: { logger?: boolean; httpsOptions?: any } = {}): Promise<void> => {
    logStartupConfigOverview();
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
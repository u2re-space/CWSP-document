import type { Socket } from "socket.io";

import type { AirpadConnectionMeta } from "./airpad.ts";

type NetworkContext = {
    sendToBridge?: (payload: any) => boolean;
    bridgeUserId?: string;
    sendToReverse?: (userId: string, deviceId: string, payload: any) => boolean;
};

type Logger = {
    debug?: (obj: any, msg: string) => void;
    warn?: (obj: any, msg: string) => void;
    error?: (obj: any, msg: string) => void;
};

export type AirpadRouterDebugDevice = {
    deviceId: string;
    socketId: string;
    clientId?: string;
    sourceId?: string;
    routeTarget?: string;
    routeHint?: string;
    targetHost?: string;
    hostHint?: string;
    targetPort?: string;
    viaPort?: string;
    protocolHint?: string;
};

type AirpadRouterOptions = {
    networkContext?: NetworkContext;
    isTunnelDebug?: boolean;
    logger?: Logger;
};

export interface AirpadSocketRouter {
    registerConnection: (socket: Socket, meta: AirpadConnectionMeta) => void;
    unregisterConnection: (socket: Socket) => void;
    registerAlias: (socket: Socket, value: unknown) => void;
    registerTunnelAlias: (socket: Socket, value: unknown) => void;
    getConnectionMeta: (socket: Socket) => AirpadConnectionMeta | undefined;
    getRouteHint: (socket: Socket) => string | undefined;
    isEndpoint: (socket: Socket) => boolean;
    resolveAirpadTarget: (sourceSocket: Socket, rawTarget: string, hasExplicitTarget: boolean) => string;
    resolveTunnelTargets: (sourceSocket: Socket, frame: any) => string[];
    forwardToAirpadTargets: (sourceSocket: Socket, payload: any, frame: any) => boolean;
    forwardBinaryToBridge: (sourceSocket: Socket, raw: Buffer | Uint8Array | ArrayBuffer, target: string) => boolean;
    forwardToBridge: (sourceSocket: Socket, frame: any) => boolean;
    getSocket: (deviceId: string) => Socket | undefined;
    sendToDevice: (userId: string, deviceId: string, payload: any) => boolean;
    getConnectedDevices: () => string[];
    getTunnelTargets: () => string[];
    getDebugDevices: () => AirpadRouterDebugDevice[];
    normalizeHint: (value: unknown) => string;
}

const isBroadcastTarget = (value: string): boolean => value === "broadcast" || value === "all" || value === "*";

export const createAirpadRouter = (options: AirpadRouterOptions = {}): AirpadSocketRouter => {
    const networkContext = options.networkContext;
    const isTunnelDebug = options.isTunnelDebug === true;
    const logger = options.logger;

    const clients = new Map<string, Set<Socket>>();
    const airpadConnectionMeta = new Map<Socket, AirpadConnectionMeta>();
    const airpadTargets = new Map<string, Set<Socket>>();
    const socketAliases = new Map<Socket, Set<string>>();

    const normalizeHint = (value: unknown): string => {
        if (typeof value !== "string") return "";
        const normalized = value.trim().toLowerCase();
        return normalized;
    };

    const encodeBinaryForTunnel = (raw: Buffer | Uint8Array | ArrayBuffer): string => {
        try {
            return Buffer.from(raw as any).toString("base64");
        } catch {
            return "";
        }
    };

    const addClientAlias = (socket: Socket, value: unknown): void => {
        const normalized = normalizeHint(value);
        if (!normalized) return;
        const existing = clients.get(normalized) ?? new Set<Socket>();
        existing.add(socket);
        clients.set(normalized, existing);
        const aliases = socketAliases.get(socket) ?? new Set<string>();
        aliases.add(normalized);
        socketAliases.set(socket, aliases);
    };

    const addTunnelAlias = (socket: Socket, value: unknown): void => {
        const normalized = normalizeHint(value);
        if (!normalized) return;
        const existing = airpadTargets.get(normalized) || new Set<Socket>();
        existing.add(socket);
        airpadTargets.set(normalized, existing);
        const aliases = socketAliases.get(socket) ?? new Set<string>();
        aliases.add(normalized);
        socketAliases.set(socket, aliases);
    };

    const removeSocketAliases = (socket: Socket): void => {
        const aliases = socketAliases.get(socket);
        if (!aliases) return;
        aliases.forEach((alias) => {
            const direct = clients.get(alias);
            if (direct) {
                direct.delete(socket);
                if (direct.size === 0) clients.delete(alias);
            }
            const tunnelSet = airpadTargets.get(alias);
            if (tunnelSet) {
                tunnelSet.delete(socket);
                if (tunnelSet.size === 0) {
                    airpadTargets.delete(alias);
                }
            }
        });
        socketAliases.delete(socket);
    };

    const registerConnection = (socket: Socket, meta: AirpadConnectionMeta): void => {
        airpadConnectionMeta.set(socket, meta);
        if (meta.targetHost) addTunnelAlias(socket, meta.targetHost);
        if (meta.targetHost) addClientAlias(socket, meta.targetHost);
        if (meta.hostHint) addTunnelAlias(socket, meta.hostHint);
        if (meta.hostHint) addClientAlias(socket, meta.hostHint);
        if (meta.clientId) addTunnelAlias(socket, meta.clientId);
        if (meta.clientId) addClientAlias(socket, meta.clientId);
        if (meta.sourceId) addClientAlias(socket, meta.sourceId);
        if (meta.sourceId) addTunnelAlias(socket, meta.sourceId);
        if (meta.routeTarget) addClientAlias(socket, meta.routeTarget);
        if (meta.routeTarget) addTunnelAlias(socket, meta.routeTarget);
    };

    const unregisterConnection = (socket: Socket): void => {
        const meta = airpadConnectionMeta.get(socket);
        if (!meta) {
            removeSocketAliases(socket);
            return;
        }
        const removeAlias = (target: unknown): void => {
            const normalized = normalizeHint(target);
            if (!normalized) return;
            const existing = airpadTargets.get(normalized);
            if (!existing) return;
            existing.delete(socket);
            if (existing.size === 0) {
                airpadTargets.delete(normalized);
            }
        };
        removeAlias(meta.targetHost);
        removeAlias(meta.hostHint);
        removeAlias(meta.clientId);
        removeAlias(meta.sourceId);
        removeAlias(meta.routeTarget);
        removeSocketAliases(socket);
        airpadConnectionMeta.delete(socket);
    };

    const resolveTunnelTargets = (sourceSocket: Socket, frame: any): string[] => {
        const next = new Set<string>();
        const meta = airpadConnectionMeta.get(sourceSocket);
        const routeHint = normalizeHint(meta?.routeHint);
        if (routeHint !== "tunnel" && routeHint !== "remote") return [];

        const frameTarget = normalizeHint(frame?.to);
        if (frameTarget && !isBroadcastTarget(frameTarget)) {
            next.add(frameTarget);
            return Array.from(next).filter(Boolean);
        }
        if (!frameTarget || isBroadcastTarget(frameTarget)) {
            const routeTarget = normalizeHint(meta?.routeTarget);
            if (routeTarget) {
                next.add(routeTarget);
                return Array.from(next).filter(Boolean);
            }
            if (meta?.targetHost) {
                next.add(normalizeHint(meta.targetHost));
            }
            if (meta?.hostHint) {
                next.add(normalizeHint(meta.hostHint));
            }
            return Array.from(next).filter(Boolean);
        }
        return Array.from(next).filter(Boolean);
    };

    const isEndpointConnection = (socket: Socket): boolean => {
        const meta = airpadConnectionMeta.get(socket);
        if (typeof meta?.isEndpoint === "boolean") return meta.isEndpoint;
        const routeHint = normalizeHint(meta?.routeHint);
        if (routeHint === "tunnel" || routeHint === "remote") return false;
        const routeTarget = normalizeHint(meta?.routeTarget);
        const hostHint = normalizeHint(meta?.targetHost) || normalizeHint(meta?.hostHint);
        if (routeTarget && hostHint && routeTarget !== hostHint && routeTarget !== `l-${hostHint}`) {
            return false;
        }
        return true;
    };

    const resolveAirpadTarget = (sourceSocket: Socket, rawTarget: string, hasExplicitTarget: boolean): string => {
        const target = normalizeHint(rawTarget);
        const meta = airpadConnectionMeta.get(sourceSocket);
        const hasRouteTarget = normalizeHint(meta?.routeTarget) || normalizeHint(meta?.targetHost) || "";
        if (!target) return hasRouteTarget || target;
        if (isBroadcastTarget(target)) {
            return hasExplicitTarget ? target : hasRouteTarget || target;
        }
        const directSockets = clients.get(target);
        const directSocket = directSockets?.values().next().value;
        if (directSocket && directSocket.connected) return target;
        if (hasExplicitTarget) return target;
        return hasRouteTarget || target;
    };

    const forwardToAirpadTargets = (sourceSocket: Socket, payload: any, frame: any): boolean => {
        const targets = resolveTunnelTargets(sourceSocket, frame);
        if (!targets.length) return false;
        let delivered = false;
        for (const rawTarget of targets) {
            const targetSockets = airpadTargets.get(rawTarget);
            if (targetSockets && targetSockets.size > 0) {
                for (const targetSocket of targetSockets) {
                    if (targetSocket === sourceSocket) continue;
                    targetSocket.emit("message", payload);
                    delivered = true;
                }
            }
            if (!delivered && networkContext?.sendToReverse) {
                const bridgeUser = normalizeHint(airpadConnectionMeta.get(sourceSocket)?.routeTarget) || normalizeHint(networkContext.bridgeUserId);
                
                let reversePayload = payload;
                if (Buffer.isBuffer(payload) || payload instanceof Uint8Array || payload instanceof ArrayBuffer) {
                    const meta = airpadConnectionMeta.get(sourceSocket);
                    const bridgeFrom = normalizeHint(meta?.routeTarget) || normalizeHint(meta?.sourceId) || normalizeHint(networkContext.bridgeUserId) || sourceSocket.id;
                    reversePayload = {
                        type: "dispatch",
                        from: bridgeFrom,
                        to: rawTarget,
                        target: rawTarget,
                        targetId: rawTarget,
                        namespace: "default",
                        mode: "blind",
                        payload: {
                            __airpadBinary: true,
                            encoding: "base64",
                            data: encodeBinaryForTunnel(payload)
                        },
                        userId: bridgeUser,
                        routeTarget: normalizeHint(meta?.routeTarget) || rawTarget,
                        via: normalizeHint(meta?.routeHint),
                        surface: "socketio"
                    };
                }

                if (networkContext.sendToReverse(bridgeUser || "", rawTarget, reversePayload)) {
                    delivered = true;
                } else if (logger) {
                    logger.debug?.({ sourceSocket: sourceSocket.id, target: rawTarget }, "[Router] sendToReverse failed or returned false");
                }
            }
        }
        return delivered;
    };

    const forwardToBridge = (sourceSocket: Socket, frame: any): boolean => {
        if (!networkContext?.sendToBridge) {
            if (isTunnelDebug) {
                logger?.debug?.(
                    { socketId: sourceSocket.id, to: normalizeHint(frame?.to), via: airpadConnectionMeta.get(sourceSocket)?.routeHint },
                    `[Router] Tunnel bridge unavailable`
                );
            }
            return false;
        }
        if (!frame || typeof frame !== "object") return false;
        const meta = airpadConnectionMeta.get(sourceSocket);
        const routeHint = normalizeHint(meta?.routeHint);
        if (routeHint !== "tunnel" && routeHint !== "remote") return false;
        const rawTarget = normalizeHint(frame.to);
        if (!rawTarget || isBroadcastTarget(rawTarget)) return false;
        const bridgeUserId = normalizeHint(networkContext.bridgeUserId);
        const bridgeFrom = normalizeHint(meta?.routeTarget) || normalizeHint(meta?.sourceId) || bridgeUserId || normalizeHint((sourceSocket as any).userId) || sourceSocket.id;
        const bridgeUser = normalizeHint(meta?.routeTarget) || bridgeUserId || normalizeHint(meta?.targetHost) || normalizeHint(meta?.hostHint);
        const accepted = networkContext.sendToBridge({
            ...frame,
            from: bridgeFrom,
            userId: bridgeUser,
            target: rawTarget,
            targetId: rawTarget,
            to: rawTarget,
            routeTarget: normalizeHint(meta?.routeTarget) || rawTarget
        });
        if (!accepted && isTunnelDebug) {
            logger?.warn?.(
                {
                    socketId: sourceSocket.id,
                    to: rawTarget,
                    via: airpadConnectionMeta.get(sourceSocket)?.routeHint || "?"
                },
                `[Router] Tunnel bridge rejected`
            );
        }
        return accepted;
    };

    const forwardBinaryToBridge = (sourceSocket: Socket, raw: Buffer | Uint8Array | ArrayBuffer, target: string): boolean => {
        if (!networkContext?.sendToBridge) {
            if (isTunnelDebug) {
                logger?.debug?.(
                    { socketId: sourceSocket.id, target, via: airpadConnectionMeta.get(sourceSocket)?.routeHint || "?" },
                    `[Router] Binary tunnel bridge unavailable`
                );
            }
            return false;
        }
        const meta = airpadConnectionMeta.get(sourceSocket);
        const bridgeTarget = normalizeHint(target);
        if (!bridgeTarget || isBroadcastTarget(bridgeTarget)) return false;

        const bridgeUserId = normalizeHint(networkContext.bridgeUserId);
        const bridgeFrom = normalizeHint(meta?.routeTarget) || normalizeHint(meta?.sourceId) || bridgeUserId || normalizeHint((sourceSocket as any).userId) || sourceSocket.id;
        const bridgeUser = normalizeHint(meta?.routeTarget) || bridgeUserId || normalizeHint(meta?.targetHost) || normalizeHint(meta?.hostHint);
        const bridgePayload = {
            type: "dispatch",
            from: bridgeFrom,
            to: bridgeTarget,
            target: bridgeTarget,
            targetId: bridgeTarget,
            namespace: "default",
            mode: "blind",
            payload: {
                __airpadBinary: true,
                encoding: "base64",
                data: encodeBinaryForTunnel(raw)
            },
            userId: bridgeUser,
            routeTarget: normalizeHint(meta?.routeTarget) || bridgeTarget,
            via: normalizeHint(meta?.routeHint),
            surface: "socketio"
        };
        const accepted = networkContext.sendToBridge(bridgePayload);
        if (accepted && isTunnelDebug) {
            logger?.debug?.(
                { socketId: sourceSocket.id, target: bridgeTarget },
                `[Router] OUT(tunnel-bridge-binary)`
            );
        } else if (isTunnelDebug) {
            logger?.debug?.(
                { socketId: sourceSocket.id, target: bridgeTarget, via: airpadConnectionMeta.get(sourceSocket)?.routeHint || "?" },
                `[Router] Binary tunnel bridge rejected`
            );
        }
        return accepted;
    };

    const getSocket = (deviceId: string): Socket | undefined => clients.get(normalizeHint(deviceId))?.values().next().value;

    const sendToDevice = (_userId: string, deviceId: string, payload: any): boolean => {
        const targets = clients.get(normalizeHint(deviceId));
        if (!targets?.size) return false;
        let sent = false;
        for (const target of targets) {
            if (!target.connected) continue;
            try {
                target.emit("message", payload);
                sent = true;
            } catch {
                // no-op
            }
        }
        return sent;
    };

    const getConnectedDevices = () => Array.from(new Set(clients.keys()));

    const getDebugDevices = (): AirpadRouterDebugDevice[] => {
        const items: AirpadRouterDebugDevice[] = [];
        for (const [deviceId, sockets] of clients.entries()) {
            for (const socket of sockets) {
                const meta = airpadConnectionMeta.get(socket);
                if (!meta) continue;
                items.push({
                    deviceId,
                    socketId: socket.id,
                    clientId: meta?.clientId,
                    sourceId: meta?.sourceId,
                    routeTarget: meta?.routeTarget,
                    routeHint: meta?.routeHint,
                    targetHost: meta?.targetHost,
                    hostHint: meta?.hostHint,
                    targetPort: meta?.targetPort,
                    viaPort: meta?.viaPort,
                    protocolHint: meta?.protocolHint
                });
            }
        }
        return items;
    };

    return {
        registerConnection,
        unregisterConnection,
        registerAlias: addClientAlias,
        registerTunnelAlias: addTunnelAlias,
        getConnectionMeta: (socket) => airpadConnectionMeta.get(socket),
        getRouteHint: (socket) => airpadConnectionMeta.get(socket)?.routeHint,
        isEndpoint: (socket) => isEndpointConnection(socket),
        resolveAirpadTarget,
        resolveTunnelTargets,
        forwardToAirpadTargets,
        forwardBinaryToBridge,
        forwardToBridge,
        getSocket,
        sendToDevice,
        getConnectedDevices,
        getTunnelTargets: () => Array.from(airpadTargets.keys()).filter(Boolean),
        getDebugDevices,
        normalizeHint
    };
};

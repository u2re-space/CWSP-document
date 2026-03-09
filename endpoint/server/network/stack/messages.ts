import { isBroadcastFrame, NormalizedNetworkFrame, normalizeFrame } from "./protocol.ts";
import { normalizeTunnelFrame } from "./protocol/tunnel.ts";

export type SocketMessageHook = (msg: NormalizedNetworkFrame, ctx?: any) => unknown | null | undefined;
type SocketRoutingContext = {
    nodeId?: string;
    peerId?: string;
    gatewayId?: string;
    via?: string;
    surface?: string;
};

export const normalizeSocketFrame = (raw: unknown, sourceId: string, context: SocketRoutingContext = {}): NormalizedNetworkFrame => {
    return {
        ...normalizeFrame(raw, sourceId),
        ...context
    };
};

export const applyMessageHooks = <T>(hooks: SocketMessageHook[], message: NormalizedNetworkFrame, ctx?: T): NormalizedNetworkFrame | null => {
    let current = message as NormalizedNetworkFrame;
    for (const hook of hooks) {
        const result = hook(current, ctx);
        if (result === null) return null;
        if (result === undefined) continue;
        current = result as NormalizedNetworkFrame;
    }
    return current;
};

export const isBroadcast = (message: NormalizedNetworkFrame): boolean => {
    return isBroadcastFrame(message);
};

type TunnelRouteMeta = {
    hopId?: string;
    via?: string;
};

export type TunnelMessageHook = (msg: NormalizedNetworkFrame, ctx?: any) => unknown | null | undefined;
export type TunnelPeerProfile = {
    id: string;
    label?: string;
};

type TunnelPeerResolution = {
    profile: TunnelPeerProfile;
    source: "id" | "exactLabel" | "containsLabel";
};

export const resolveTunnelTarget = (peers: TunnelPeerProfile[] | undefined | null, requestedTarget: string): TunnelPeerResolution | undefined => {
    const target = requestedTarget.trim();
    if (!target) return undefined;

    const exact = peers?.find((peer) => peer.id.toLowerCase() === target.toLowerCase());
    if (exact) return { profile: exact, source: "id" };

    const exactLabel = peers?.find((peer) => peer.label && peer.label.toLowerCase() === target.toLowerCase());
    if (exactLabel) return { profile: exactLabel, source: "exactLabel" };

    const containsLabel = peers?.find((peer) => {
        if (typeof peer.label !== "string") return false;
        const peerLabel = peer.label.toLowerCase();
        const targetLabel = target.toLowerCase();
        return peerLabel.includes(targetLabel) || targetLabel.includes(peerLabel);
    });
    if (containsLabel) return { profile: containsLabel, source: "containsLabel" };

    return undefined;
};

export const normalizeTunnelRoutingFrame = (raw: unknown, sourceId: string, routeMeta?: TunnelRouteMeta): NormalizedNetworkFrame => {
    return normalizeTunnelFrame(raw, sourceId, routeMeta);
};

export const applyTunnelMessageHooks = <T>(hooks: TunnelMessageHook[], message: NormalizedNetworkFrame, ctx?: T): NormalizedNetworkFrame | null => {
    let current = message as NormalizedNetworkFrame;
    for (const hook of hooks) {
        const result = hook(current, ctx);
        if (result === null) return null;
        if (result === undefined) continue;
        current = result as NormalizedNetworkFrame;
    }
    return current;
};

export const isTunnelBroadcast = (message: NormalizedNetworkFrame): boolean => {
    return isBroadcastFrame(message);
};

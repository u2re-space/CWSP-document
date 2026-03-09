import { NetworkFrame, NormalizedNetworkFrame, normalizeFrame } from "../protocol.ts";

export interface TunnelFrame extends NetworkFrame {
    transport?: "tunnel";
    hopId?: string;
    via?: string;
}

export const normalizeTunnelFrame = (raw: unknown, sourceId: string, routeMeta?: { hopId?: string; via?: string }): NormalizedNetworkFrame & TunnelFrame => {
    return {
        ...normalizeFrame(raw, sourceId),
        transport: "tunnel",
        hopId: routeMeta?.hopId,
        via: routeMeta?.via
    };
};

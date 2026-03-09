import { type NetworkFrame, type NormalizedNetworkFrame, normalizeFrame } from "../protocol.ts";

export interface WsFrame extends NetworkFrame {
    transport?: "ws";
    reverse?: boolean;
    clientId?: string;
}

export const normalizeWsFrame = (raw: unknown, sourceId: string): NormalizedNetworkFrame & { transport: "ws" } => {
    return {
        ...normalizeFrame(raw, sourceId),
        transport: "ws"
    };
};

import { type NetworkFrame, type NormalizedNetworkFrame, normalizeFrame } from "../protocol.ts";

export interface HttpFrame extends NetworkFrame {
    transport?: "http";
    requestPath?: string;
    requestMethod?: string;
}

export const normalizeHttpFrame = (raw: unknown, sourceId: string, requestMeta?: { requestPath?: string; requestMethod?: string }): NormalizedNetworkFrame & HttpFrame => {
    return {
        ...normalizeFrame(raw, sourceId),
        transport: "http",
        requestPath: requestMeta?.requestPath,
        requestMethod: requestMeta?.requestMethod
    };
};

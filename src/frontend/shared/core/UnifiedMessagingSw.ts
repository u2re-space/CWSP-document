/**
 * MV3 service worker–safe unified messaging: BroadcastChannel only.
 * Avoids `fest/uniform` (IndexedDB queue, worker bootstrap, import() side effects).
 */

import { BROADCAST_CHANNELS, DESTINATIONS } from "@rs-com/config/Names";

/** Shape-compatible with `fest/uniform` UnifiedMessage; kept local to avoid pulling uniform into the SW graph. */
export type SwUnifiedMessage = {
    id: string;
    type: string;
    source: string;
    destination?: string;
    contentType?: string;
    data: unknown;
    metadata?: Record<string, unknown>;
    purpose?: ("invoke" | "mail" | "attach" | "deliver" | "defer")[];
    protocol?: string;
    transport?: string;
    redirect?: boolean;
    flags?: Record<string, unknown>;
    op?: string;
    sender?: string;
    destinations?: string[];
    ids?: Record<string, unknown>;
    urls?: string[];
    tokens?: string[];
    toRoles?: string[];
    status?: number;
    results?: unknown;
    timestamp?: number;
    uuid?: string;
    srcChannel?: string;
    dstChannel?: string | string[];
};

const SW_CANONICAL_PROTOCOL = "worker";
const SW_LEGACY_TRANSPORT = "service-worker:http";

const inferCanonicalOp = (type: string, explicit?: string): string => {
    const op = String(explicit || "").trim().toLowerCase();
    if (op) return op;
    const normalizedType = String(type || "").trim().toLowerCase();
    if (normalizedType.startsWith("request:")) return "request";
    if (normalizedType.startsWith("response:")) return "response";
    if (normalizedType.startsWith("notify:")) return "notify";
    return "request";
};

const CHANNEL_BY_DESTINATION: Record<string, string> = {
    [DESTINATIONS.WORKCENTER]: BROADCAST_CHANNELS.WORK_CENTER,
    [DESTINATIONS.CLIPBOARD]: BROADCAST_CHANNELS.CLIPBOARD,
    [DESTINATIONS.MARKDOWN_VIEWER]: BROADCAST_CHANNELS.MARKDOWN_VIEWER,
    [DESTINATIONS.SETTINGS]: BROADCAST_CHANNELS.SETTINGS,
    [DESTINATIONS.FILE_EXPLORER]: BROADCAST_CHANNELS.FILE_EXPLORER,
    [DESTINATIONS.PRINT_VIEWER]: BROADCAST_CHANNELS.PRINT_VIEWER,
};

async function postToBroadcast(name: string, message: SwUnifiedMessage): Promise<boolean> {
    try {
        const bc = new BroadcastChannel(name);
        bc.postMessage(message);
        bc.close();
        return true;
    } catch {
        return false;
    }
}

function toSwProtocolEnvelope(
    message: Omit<SwUnifiedMessage, "id" | "source"> & { id?: string; source?: string }
): SwUnifiedMessage {
    const source = message.source ?? "crx-service-worker";
    const id = message.id?.trim() || crypto.randomUUID();
    const destination = String(message.destination ?? "").trim() || undefined;
    const destinations = destination ? [destination] : [];
    const op = inferCanonicalOp(String(message.type || ""), message.op);
    const now = Date.now();

    return {
        ...message,
        id,
        uuid: id,
        source,
        sender: message.sender ?? source,
        srcChannel: source,
        destination,
        destinations,
        dstChannel: destination,
        purpose: Array.isArray(message.purpose) && message.purpose.length > 0 ? message.purpose : ["mail"],
        protocol: message.protocol ?? SW_CANONICAL_PROTOCOL,
        transport: message.transport ?? SW_LEGACY_TRANSPORT,
        redirect: Boolean(message.redirect),
        flags: message.flags ?? {},
        op,
        ids: message.ids ?? {
            byId: source,
            from: source,
            sender: source,
            destinations,
        },
        urls: message.urls ?? [],
        tokens: message.tokens ?? [],
        toRoles: message.toRoles ?? [],
        timestamp: Number(message.timestamp ?? now),
        metadata: {
            timestamp: now,
            ...(message.metadata ?? {})
        }
    };
}

export const unifiedMessaging = {
    async sendMessage(message: Omit<SwUnifiedMessage, "id" | "source"> & { id?: string; source?: string }): Promise<boolean> {
        const envelope = toSwProtocolEnvelope(message);
        const dest = String(envelope.destination ?? "").trim();
        const channelName = CHANNEL_BY_DESTINATION[dest];
        if (!channelName) return false;

        return postToBroadcast(channelName, envelope);
    },
};

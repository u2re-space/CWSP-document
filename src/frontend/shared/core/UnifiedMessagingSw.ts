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

export const unifiedMessaging = {
    async sendMessage(message: Omit<SwUnifiedMessage, "id" | "source"> & { id?: string; source?: string }): Promise<boolean> {
        const dest = String(message.destination ?? "").trim();
        const channelName = CHANNEL_BY_DESTINATION[dest];
        if (!channelName) return false;

        const full: SwUnifiedMessage = {
            ...message,
            id: message.id?.trim() || crypto.randomUUID(),
            source: message.source ?? "crx-service-worker",
        };

        return postToBroadcast(channelName, full);
    },
};

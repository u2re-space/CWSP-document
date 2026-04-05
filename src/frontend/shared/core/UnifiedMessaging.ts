/**
 * Unified Messaging System for CrossWord
 * Extends fest/uniform messaging with app-specific configuration
 */

import {
    UnifiedMessagingManager,
    getUnifiedMessaging as getBaseMessaging,
    sendMessage as baseSendMessage,
    type UnifiedMessage,
    type MessageHandler,
    type WorkerChannelConfig,
    type PipelineConfig,
    type PipelineStage,
    type UnifiedMessagingConfig
} from 'fest/uniform';

import {
    BROADCAST_CHANNELS,
    CONTENT_TYPES,
    DESTINATIONS,
} from '@rs-com/config/Names';

import { resolveAssociation, resolveAssociationPipeline } from './ContentAssociations';

// Re-export types for consumers
export type {
    UnifiedMessage,
    MessageHandler,
    WorkerChannelConfig,
    PipelineConfig,
    PipelineStage,
    UnifiedMessagingConfig
};

// ============================================================================
// APP-SPECIFIC CHANNEL MAPPINGS
// ============================================================================

const APP_CHANNEL_MAPPINGS: Record<string, string> = {
    [DESTINATIONS.WORKCENTER]: BROADCAST_CHANNELS.WORK_CENTER,
    [DESTINATIONS.CLIPBOARD]: BROADCAST_CHANNELS.CLIPBOARD,
    [DESTINATIONS.MARKDOWN_VIEWER]: BROADCAST_CHANNELS.MARKDOWN_VIEWER,
    [DESTINATIONS.SETTINGS]: BROADCAST_CHANNELS.SETTINGS,
    [DESTINATIONS.FILE_EXPLORER]: BROADCAST_CHANNELS.FILE_EXPLORER,
    [DESTINATIONS.PRINT_VIEWER]: BROADCAST_CHANNELS.PRINT_VIEWER
};

// ============================================================================
// APP-SPECIFIC MESSAGING MANAGER
// ============================================================================

let appMessagingInstance: UnifiedMessagingManager | null = null;

/**
 * Get the app-configured UnifiedMessagingManager
 */
export function getUnifiedMessaging(): UnifiedMessagingManager {
    if (!appMessagingInstance) {
        appMessagingInstance = getBaseMessaging({
            channelMappings: APP_CHANNEL_MAPPINGS,
            queueOptions: {
                dbName: 'CrossWordMessageQueue',
                storeName: 'messages',
                maxRetries: 3,
                defaultExpirationMs: 24 * 60 * 60 * 1000 // 24 hours
            },
            pendingStoreOptions: {
                storageKey: 'rs-unified-messaging-pending',
                maxMessages: 200,
                defaultTTLMs: 24 * 60 * 60 * 1000 // 24 hours
            }
        });
    }
    return appMessagingInstance;
}

// Singleton instance for backward compatibility
export const unifiedMessaging = getUnifiedMessaging();

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Send a message using the app-configured manager
 */
export function sendMessage(message: Omit<UnifiedMessage, 'id' | 'source'> & { source?: string }): Promise<boolean> {
    return unifiedMessaging.sendMessage({
        ...message,
        source: message.source ?? 'unified-messaging'
    } as UnifiedMessage);
}

/**
 * Register a handler using the app-configured manager
 */
export function registerHandler(destination: string, handler: MessageHandler): void {
    unifiedMessaging.registerHandler(destination, handler);
}

export function unregisterHandler(destination: string, handler: MessageHandler): void {
    unifiedMessaging.unregisterHandler(destination, handler);
}

/**
 * Get a worker channel from the app manager
 */
export function getWorkerChannel(viewHash: string, workerName: string) {
    return unifiedMessaging.getWorkerChannel(viewHash, workerName);
}

/**
 * Get a broadcast channel from the app manager
 */
export function getBroadcastChannel(channelName: string): BroadcastChannel {
    return unifiedMessaging.getBroadcastChannel(channelName);
}

// ============================================================================
// BACKWARD COMPATIBILITY FUNCTIONS
// ============================================================================

export function sendToWorkCenter(data: unknown, options?: Record<string, unknown>): Promise<boolean> {
    return sendMessage({
        type: 'content-share',
        source: 'unified-messaging',
        destination: DESTINATIONS.WORKCENTER,
        data,
        metadata: options
    });
}

export function sendToClipboard(data: unknown, options?: Record<string, unknown>): Promise<boolean> {
    return sendMessage({
        type: 'clipboard-copy',
        source: 'unified-messaging',
        destination: DESTINATIONS.CLIPBOARD,
        data,
        metadata: options
    });
}

export function navigateToView(view: string): Promise<boolean> {
    return sendMessage({
        type: 'navigation',
        source: 'unified-messaging',
        destination: 'router',
        data: { view },
        metadata: { priority: 'high' }
    });
}

export function initializeComponent(componentId: string): UnifiedMessage[] {
    return unifiedMessaging.initializeComponent(componentId);
}

export function hasPendingMessages(destination: string): boolean {
    return unifiedMessaging.hasPendingMessages(destination);
}

export function enqueuePendingMessage(destination: string, message: UnifiedMessage): void {
    const dest = String(destination ?? '').trim();
    if (!dest || !message) return;
    unifiedMessaging.enqueuePendingMessage(dest, message);
}

export function registerComponent(componentId: string, destination: string): void {
    unifiedMessaging.registerComponent(componentId, destination);
}

// ============================================================================
// CONTENT PROCESSING (APP-SPECIFIC)
// ============================================================================

export function processInitialContent(content: Record<string, unknown>): Promise<void> {
    const contentType = String(content?.contentType ?? content?.type ?? CONTENT_TYPES.OTHER);
    const resolved = resolveAssociationPipeline({
        contentType,
        context: content?.context as string | undefined,
        processingSource: content?.processingSource as string | undefined,
        overrideFactors: (content?.overrideFactors ?? content?.metadata?.overrideFactors) as string[] | undefined
    });

    const payload = content?.content ?? content?.data ?? content;
    const meta = (content?.metadata ?? {}) as Record<string, unknown>;

    const source = String(content?.source ?? meta?.source ?? 'content-association');
    const tasks = resolved.pipeline.map((dest) => {
        if (dest === "basic-viewer") {
            return sendMessage({
                type: 'content-view',
                source,
                destination: 'basic-viewer',
                contentType: resolved.normalizedContentType,
                data: {
                    content: (payload as Record<string, unknown>)?.text ?? (payload as Record<string, unknown>)?.content ?? payload,
                    text: (payload as Record<string, unknown>)?.text,
                    filename: (payload as Record<string, unknown>)?.filename ?? meta?.filename,
                },
                metadata: {
                    ...meta,
                    overrideFactors: resolved.overrideFactors,
                    context: content?.context,
                    processingSource: content?.processingSource
                }
            });
        }

        if (dest === "basic-explorer") {
            return sendMessage({
                type: 'content-explorer',
                source,
                destination: 'basic-explorer',
                contentType: resolved.normalizedContentType,
                data: {
                    action: 'save',
                    ...(payload as Record<string, unknown>),
                },
                metadata: {
                    ...meta,
                    overrideFactors: resolved.overrideFactors,
                    context: content?.context,
                    processingSource: content?.processingSource
                }
            });
        }

        // Default: attach into workcenter
        return sendMessage({
            type: 'content-share',
            source,
            destination: 'basic-workcenter',
            contentType: resolved.normalizedContentType,
            data: payload,
            metadata: {
                ...meta,
                overrideFactors: resolved.overrideFactors,
                context: content?.context,
                processingSource: content?.processingSource
            }
        });
    });

    return Promise.allSettled(tasks).then(() => {});
}

// ============================================================================
// MESSAGE CREATION HELPERS
// ============================================================================

export function createMessageWithOverrides(
    type: string,
    source: string,
    contentType: string,
    data: unknown,
    overrideFactors: string[] = [],
    processingSource?: string
): UnifiedMessage {
    const resolved = resolveAssociation({
        contentType,
        context: processingSource,
        processingSource,
        overrideFactors
    });

    return {
        id: crypto.randomUUID(),
        type,
        source,
        destination: resolved.destination === "basic-viewer"
            ? 'basic-viewer'
            : resolved.destination === "basic-explorer"
                ? 'basic-explorer'
                : 'basic-workcenter',
        contentType,
        data,
        metadata: {
            timestamp: Date.now(),
            overrideFactors,
            processingSource,
            priority: 'normal'
        }
    };
}

/**
 * Chrome Extension Messaging Adapter
 * Integrates fest/uniform with Chrome extension messaging APIs
 * Provides unified messaging across content scripts, popup, background, and service worker
 */

import {
    createWorkerChannel,
    createQueuedOptimizedWorkerChannel,
    OptimizedWorkerChannel,
    detectExecutionContext,
    supportsDedicatedWorkers,
    QueuedWorkerChannel,
    createChromeExtensionRuntimeChannel,
    createChromeExtensionBroadcast
} from 'fest/uniform';

import { createDeferred } from 'fest/core';

// ============================================================================
// CHROME EXTENSION MESSAGING INTERFACES
// ============================================================================

export interface CrxMessage {
    id: string;
    type: string;
    source: 'content-script' | 'popup' | 'background' | 'service-worker' | 'offscreen';
    target?: 'content-script' | 'popup' | 'background' | 'service-worker' | 'offscreen';
    tabId?: number;
    frameId?: number;
    data: any;
    metadata?: {
        timestamp?: number;
        correlationId?: string;
        priority?: 'low' | 'normal' | 'high';
        [key: string]: any;
    };
}

// ============================================================================
// CHROME EXTENSION CONTEXT DETECTION
// ============================================================================

export const getCrxContext = (): CrxMessage['source'] => {
    // Detect execution context in Chrome extension
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
        if (typeof document !== 'undefined' && document.contentType) {
            return 'content-script';
        }
        if (typeof chrome.runtime.getBackgroundPage !== 'undefined') {
            return 'background';
        }
        if (typeof chrome.offscreen !== 'undefined') {
            return 'offscreen';
        }
        // Check for service worker
        if (typeof ServiceWorkerGlobalScope !== 'undefined' &&
            self instanceof ServiceWorkerGlobalScope) {
            return 'service-worker';
        }
        // Default to popup/offscreen
        return 'popup';
    }
    return 'content-script'; // fallback
};

export const isCrxEnvironment = (): boolean => {
    return typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
};

// ============================================================================
// CHROME RUNTIME MESSAGING ADAPTER
// ============================================================================

export class CrxRuntimeChannel implements OptimizedWorkerChannel {
    public festUniformChannel?: ReturnType<typeof createChromeExtensionRuntimeChannel>;
    public broadcastChannel?: BroadcastChannel;
    public listeners = new Map<string, (message: any) => void>();
    public pendingRequests = new Map<string, { resolve: (value: any) => void; reject: (error: any) => void; timeout: NodeJS.Timeout }>();
    public context: CrxMessage['source'];
    public isCrxEnv: boolean;

    constructor(private target?: CrxMessage['target']) {
        this.context = getCrxContext();
        this.isCrxEnv = isCrxEnvironment();

        if (this.isCrxEnv) {
            // Create broadcast-like channel for chrome extension messaging
            this.broadcastChannel = createChromeExtensionBroadcast(target || 'background');
        }

        // Always try to create the channel - it will return a no-op channel if not in CRX
        this.festUniformChannel = createChromeExtensionRuntimeChannel(target || 'background');

        // Set up message forwarding from fest/uniform to our listeners
        this.setupMessageForwarding();
    }

    private setupMessageForwarding(): void {
        if (this.isCrxEnv && this.broadcastChannel) {
            // Use broadcast channel for CRX messaging
            this.broadcastChannel.addEventListener('message', (event) => {
                const message = event.data;
                const sender = event.source || {};
                const sendResponse = (response: any) => {
                    // Send response back via broadcast channel
                    this.broadcastChannel?.postMessage({
                        id: message.id,
                        type: 'response',
                        result: response,
                        source: this.context
                    });
                };

                this.handleIncomingMessage(message, sender, sendResponse);
                return true; // Indicate async response
            });
        } else if (!this.isCrxEnv && chrome.runtime && chrome.runtime.onMessage) {
            // Fallback for non-CRX environments
            chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
                this.handleIncomingMessage(message, sender, sendResponse);
                // Return true to indicate async response will be sent
                return true;
            });
        }
    }

    private handleIncomingMessage(message: any, sender: chrome.runtime.MessageSender, sendResponse: (response: any) => void): void {

        // Only handle messages if in CRX environment
        if (!this.isCrxEnv) {
            console.log('[CrxRuntimeChannel] Not in CRX environment, rejecting message');
            sendResponse({
                success: false,
                error: 'Not in Chrome extension environment',
                source: this.context
            });
            return;
        }

        try {
            // Handle unified message format
            if (message && typeof message === 'object' && message.id && message.type) {
                const unifiedMessage: CrxMessage = message;

                // Note: Response messages are handled via sendMessage callback, not here

                // Check if this message is for us
                if (!unifiedMessage.target || unifiedMessage.target === this.context) {
                    // Handle request-response pattern
                    if (unifiedMessage.type.startsWith('request:')) {
                        const actualType = unifiedMessage.type.replace('request:', '');
                        const listener = this.listeners.get(actualType);

                        if (listener) {
                            // Handle async listener with guaranteed sendResponse
                            listener(unifiedMessage.data)
                                ?.then(result => {
                                    sendResponse({
                                        id: unifiedMessage.id,
                                        type: `response:${actualType}`,
                                        success: true,
                                        result,
                                        source: this.context
                                    });
                                })
                                ?.catch(error => {
                                    sendResponse({
                                        id: unifiedMessage.id,
                                        type: `response:${actualType}`,
                                        success: false,
                                        error: error instanceof Error ? error.message : String(error),
                                        source: this.context
                                    });
                                });
                        } else {
                            sendResponse({
                                id: unifiedMessage.id,
                                type: `response:${unifiedMessage.type}`,
                                success: false,
                                error: `No handler for type: ${actualType}`,
                                source: this.context
                            });
                        }
                    }
                } else {
                    // Message not for us, but we still need to respond to avoid the async error
                    sendResponse({
                        id: unifiedMessage.id,
                        type: 'response:not-targeted',
                        success: false,
                        error: 'Message not targeted at this context',
                        source: this.context
                    });
                }
            } else {
                // Not a unified message format
                sendResponse({
                    success: false,
                    error: 'Invalid message format',
                    source: this.context
                });
            }
        } catch (error) {
            console.error('[CrxRuntimeChannel] Error handling message:', error);
            sendResponse({
                success: false,
                error: error instanceof Error ? error.message : String(error),
                source: this.context
            });
        }
    }

    async request(method: string, args: any[] = [], options?: { timeout?: number }): Promise<any> {

        if (!this.isCrxEnv) {
            throw new Error('CrxRuntimeChannel: Chrome extension messaging is only available in Chrome extension context. Current context: ' + this.context);
        }

        const timeout = options?.timeout || 30000;
        const messageId = `crx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        return new Promise((resolve, reject) => {
            const timeoutHandle = setTimeout(() => {
                this.pendingRequests.delete(messageId);
                reject(new Error(`Request timeout: ${method}`));
            }, timeout);

            this.pendingRequests.set(messageId, { resolve, reject, timeout: timeoutHandle });

            const message: CrxMessage = {
                id: messageId,
                type: `request:${method}`,
                source: this.context,
                target: this.target,
                data: args.length === 1 ? args[0] : args,
                metadata: { timestamp: Date.now() }
            };

            // Use callback version of sendMessage to properly handle responses
            chrome.runtime.sendMessage(message, (response) => {

                if (chrome.runtime.lastError) {
                    clearTimeout(timeoutHandle);
                    this.pendingRequests.delete(messageId);
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }

                // Handle the direct response from sendMessage callback
                if (response && response.id === messageId) {
                    clearTimeout(timeoutHandle);
                    this.pendingRequests.delete(messageId);
                    if (response.success) {
                        resolve(response.result);
                    } else {
                        reject(new Error(response.error || 'Request failed'));
                    }
                } else {
                    console.warn('[CrxRuntimeChannel] Unexpected response format:', response);
                }
            });
        });
    }

    registerHandler(type: string, handler: (message: any) => Promise<any> | any): void {
        this.listeners.set(type, handler);
    }

    unregisterHandler(type: string): void {
        this.listeners.delete(type);
    }

    close(): void {
        this.listeners.clear();
        this.festUniformChannel?.close();

        // Clear all pending requests
        for (const [id, pending] of this.pendingRequests) {
            clearTimeout(pending.timeout);
            pending.reject(new Error('Channel closed'));
        }
        this.pendingRequests.clear();
    }

    getQueueStatus(): any {
        return {
            registeredHandlers: this.listeners.size,
            pendingRequests: this.pendingRequests.size,
            festUniformStatus: this.festUniformChannel ? 'active' : 'inactive'
        };
    }
}

// ============================================================================
// CRX UNIFIED MESSAGING MANAGER
// ============================================================================

export class CrxUnifiedMessaging {
    private static instance: CrxUnifiedMessaging;
    private runtimeChannel?: CrxRuntimeChannel;
    private workerChannels = new Map<string, QueuedWorkerChannel>();
    private context: CrxMessage['source'];
    private isCrxEnv: boolean;

    constructor() {
        this.context = getCrxContext();
        this.isCrxEnv = isCrxEnvironment();

        // Always create runtime channel - it will be a no-op channel if not in CRX
        this.runtimeChannel = new CrxRuntimeChannel();
    }

    static getInstance(): CrxUnifiedMessaging {
        if (!CrxUnifiedMessaging.instance) {
            CrxUnifiedMessaging.instance = new CrxUnifiedMessaging();
        }
        return CrxUnifiedMessaging.instance;
    }

    /**
     * Send message via Chrome runtime
     */
    async sendRuntimeMessage(message: Omit<CrxMessage, 'id' | 'source'>): Promise<any> {
        const fullMessage: CrxMessage = {
            id: `crx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            source: this.context,
            ...message
        };

        return this.runtimeChannel?.request?.( 'sendMessage', [fullMessage]);
    }

    /**
     * Register handler for runtime messages
     */
    registerRuntimeHandler(type: string, handler: (data: any) => Promise<any> | any): void {
        this.runtimeChannel?.registerHandler(type, handler);
    }

    /**
     * Create worker channel for background processing
     */
    createWorkerChannel(name: string, workerScript: string): QueuedWorkerChannel {
        if (this.workerChannels.has(name)) {
            return this.workerChannels.get(name)! as QueuedWorkerChannel;
        }

        const channel: QueuedWorkerChannel = createQueuedOptimizedWorkerChannel({
            name,
            script: workerScript,
            context: 'chrome-extension'
        }, {
            timeout: 30000,
            retries: 2,
            batching: true,
            compression: false
        });

        this.workerChannels.set(name, channel as QueuedWorkerChannel);
        return channel as QueuedWorkerChannel;
    }

    /**
     * Get worker channel
     */
    getWorkerChannel(name: string): QueuedWorkerChannel | null {
        return this.workerChannels.get(name) || null;
    }

    /**
     * Send message to specific tab
     */
    async sendToTab(tabId: number, message: Omit<CrxMessage, 'id' | 'source'>): Promise<any> {
        if (!this.isCrxEnv) {
            console.warn('CrxUnifiedMessaging: Tab messaging not available - not in Chrome extension context');
            return Promise.reject(new Error('Tab messaging is not available in this context'));
        }

        return new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(tabId, {
                ...message,
                id: `crx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                source: this.context,
                tabId
            }, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(response);
                }
            });
        });
    }

    /**
     * Broadcast message to all tabs
     */
    async broadcastToTabs(message: Omit<CrxMessage, 'id' | 'source'>): Promise<any[]> {
        if (!this.isCrxEnv) {
            console.warn('CrxUnifiedMessaging: Tab broadcasting not available - not in Chrome extension context');
            return Promise.resolve([]);
        }

        return new Promise((resolve) => {
            chrome.tabs.query({}, (tabs) => {
                const promises = tabs.map(tab => {
                    if (tab.id) {
                        return this.sendToTab(tab.id, message).catch(() => null); // Ignore errors
                    }
                    return Promise.resolve(null);
                });

                Promise.all(promises).then(resolve);
            });
        });
    }

    /**
     * Get current context
     */
    getContext(): CrxMessage['source'] {
        return this.context;
    }

    /**
     * Check if running in CRX environment
     */
    isCrxEnvironment(): boolean {
        return this.isCrxEnv;
    }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

// Singleton instance
export const crxMessaging = CrxUnifiedMessaging.getInstance();

// Convenience functions
export function sendCrxMessage(message: Omit<CrxMessage, 'id' | 'source'>): Promise<any> {
    return crxMessaging.sendRuntimeMessage(message);
}

export function registerCrxHandler(type: string, handler: (data: any) => Promise<any> | any): void {
    crxMessaging.registerRuntimeHandler(type, handler);
}

export function createCrxWorkerChannel(name: string, workerScript: string): QueuedWorkerChannel {
    return crxMessaging.createWorkerChannel(name, workerScript);
}

export function sendToCrxTab(tabId: number, message: Omit<CrxMessage, 'id' | 'source'>): Promise<any> {
    return crxMessaging.sendToTab(tabId, message);
}

export function broadcastToCrxTabs(message: Omit<CrxMessage, 'id' | 'source'>): Promise<any[]> {
    return crxMessaging.broadcastToTabs(message);
}
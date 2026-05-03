import { sendMessage as sendUnifiedMessage } from "com/core/UnifiedMessaging";
import { consumeCachedShareTargetPayload, fetchCachedShareFiles } from "com/core/ShareTargetGateway";
import { summarizeForLog } from "com/core/LogSanitizer";
import { normalizeDataAsset } from "fest/lure";
import type { WorkCenterState, WorkCenterDependencies } from "./WorkCenterState";
import type { WorkCenterFileOps } from "./WorkCenterFileOps";

export class WorkCenterShareTarget {
    private deps: WorkCenterDependencies;
    private _fileOps: WorkCenterFileOps;

    constructor(dependencies: WorkCenterDependencies, fileOps: WorkCenterFileOps) {
        this.deps = dependencies;
        this._fileOps = fileOps;
        // Keep a stable constructor contract while migration is in progress.
        void this._fileOps;
    }

    initShareTargetListener(_state: WorkCenterState): void {
        // Unified messaging handles channel setup and pending delivery.
        console.log('[WorkCenter] Share target result listener initialized via unified messaging');
    }

    async processQueuedMessages(_state: WorkCenterState): Promise<void> {
        try {
            // Unified messaging drains pending messages when the component is ready.
            console.log('[WorkCenter] Queued message processing handled by unified messaging');

            // Startup fallback: consume share-target cache in case message delivery was missed
            // while the shell/view was still mounting.
            const payload = await consumeCachedShareTargetPayload({ clear: true });
            if (payload) {
                const meta = (payload.meta && typeof payload.meta === 'object')
                    ? payload.meta as Record<string, unknown>
                    : {};

                await this.addShareTargetInput(_state, {
                    files: payload.files,
                    title: typeof meta.title === 'string' ? meta.title : '',
                    text: typeof meta.text === 'string' ? meta.text : '',
                    url: typeof meta.url === 'string' ? meta.url : '',
                    timestamp: typeof meta.timestamp === 'number' ? meta.timestamp : Date.now(),
                    source: 'share-target-cache'
                });
            }
        } catch (error) {
            console.error('[WorkCenter] Failed to process queued messages:', error);
        }
    }

    handleShareTargetMessage(state: WorkCenterState, event: MessageEvent): void {
        const { type, data, pingId } = event.data || {};

        if (type === 'ping' && pingId) {
            // Legacy ping messages are no longer required with unified messaging.
            return;
        } else if (type === 'share-target-result' && data) {
            console.log('[WorkCenter] Received share target result:', summarizeForLog(data));
            this.addShareTargetResult(state, data);
        } else if (type === 'share-target-input' && data) {
            console.log('[WorkCenter] Received share target input:', summarizeForLog(data));
            this.addShareTargetInput(state, data);
        } else if (type === 'ai-result' && data) {
            console.log('[WorkCenter] Received AI processing result:', summarizeForLog(data));
            this.handleAIResult(state, data);
        } else if (type === 'content-cached' && data) {
            console.log('[WorkCenter] Received cached content from SW:', summarizeForLog(data));
            this.handleCachedContent(state, data);
        } else if (type === 'content-received' && data) {
            console.log('[WorkCenter] Received content from SW:', summarizeForLog(data));
            this.handleReceivedContent(state, data);
        }
    }

    async addShareTargetResult(state: WorkCenterState, resultData: any): Promise<void> {
        // Add to processedData pipeline
        const processedEntry = {
            content: resultData.content || '',
            timestamp: resultData.timestamp || Date.now(),
            action: resultData.action || 'Share Target Processing',
            sourceData: resultData.rawData,
            metadata: {
                source: resultData.source || 'share-target',
                ...resultData.metadata
            }
        };

        // Import the state manager function
        const { WorkCenterStateManager } = await import('./WorkCenterState');
        WorkCenterStateManager.addProcessedStep(state, processedEntry);

        // Also set lastRawResult so output area can render/copy/view it.
        state.lastRawResult = resultData.rawData ?? resultData.content ?? null;

        // Save state
        WorkCenterStateManager.saveState(state);

        // Show notification
        this.deps.showMessage?.(`Share target result added to work center`);

        // Re-render to update output + pipeline
        this.deps.render?.();
    }

    async addShareTargetInput(state: WorkCenterState, inputData: any): Promise<void> {
        console.log('[WorkCenter] Adding share target input:', summarizeForLog(inputData));

        try {
            let filesAdded = 0;
            let textAdded = false;
            const fileFingerprint = (file: File): string =>
                `${String(file.name || '').trim().toLowerCase()}::${Number(file.size || 0)}::${String(file.type || '').trim().toLowerCase()}`;
            const seenFingerprints = new Set<string>((state.files || []).map(fileFingerprint));
            const pushUniqueFile = (file: File): boolean => {
                const key = fileFingerprint(file);
                if (seenFingerprints.has(key)) return false;
                seenFingerprints.add(key);
                state.files.push(file);
                return true;
            };
            const normalizeIncomingFile = async (raw: unknown): Promise<File | null> => {
                if (!raw) return null;
                if (raw instanceof File) return raw;
                if (raw instanceof Blob) {
                    return new File([raw], `shared-${Date.now()}`, { type: raw.type || 'application/octet-stream' });
                }
                const candidate = raw as Record<string, unknown>;
                if (candidate?.blob instanceof Blob) {
                    const blob = candidate.blob as Blob;
                    const name = typeof candidate.name === 'string' && candidate.name.trim()
                        ? candidate.name
                        : `shared-${Date.now()}`;
                    const lastModified = Number(candidate.lastModified || Date.now());
                    return new File([blob], name, {
                        type: String(candidate.type || blob.type || 'application/octet-stream'),
                        lastModified: Number.isFinite(lastModified) ? lastModified : Date.now()
                    });
                }
                return null;
            };

            // Handle files/images from share target
            const attachmentFiles = Array.isArray(inputData.attachments)
                ? inputData.attachments
                    .map((entry: any) => entry?.data)
                    .filter((entry: unknown) => entry instanceof File || entry instanceof Blob)
                : [];
            const incomingFiles = [
                ...(Array.isArray(inputData.files) ? inputData.files : []),
                ...attachmentFiles
            ];
            if (incomingFiles.length > 0) {
                for (const file of inputData.files) {
                    const normalized = await normalizeIncomingFile(file);
                    if (normalized && pushUniqueFile(normalized)) {
                        filesAdded++;
                    }
                }
            }

            // Fallback hydration: metadata says files exist but payload has no usable File objects.
            if (filesAdded === 0 && Number(inputData?.fileCount || 0) > 0) {
                try {
                    const cached = await consumeCachedShareTargetPayload({ clear: false });
                    const cachedFiles = Array.isArray(cached?.files) ? cached.files : [];
                    if (cachedFiles.length > 0) {
                        for (const cachedFile of cachedFiles) {
                            if (cachedFile instanceof File && pushUniqueFile(cachedFile)) {
                                filesAdded++;
                            }
                        }
                    }
                } catch (cacheError) {
                    console.warn('[WorkCenter] Failed to hydrate cached share files:', cacheError);
                }
            }

            // Handle text content
            if (inputData.text && typeof inputData.text === 'string' && inputData.text.trim()) {
                // Create a text file from the shared text
                const textBlob = new Blob([inputData.text], { type: 'text/plain' });
                const textFile = new File([textBlob], 'shared-text.txt', { type: 'text/plain' });
                if (pushUniqueFile(textFile)) {
                    filesAdded++;
                    textAdded = true;
                }
            }

            // Handle URLs
            if (inputData.url && typeof inputData.url === 'string') {
                // Create a text file containing the URL
                const urlBlob = new Blob([inputData.url], { type: 'text/plain' });
                const urlFile = new File([urlBlob], 'shared-url.txt', { type: 'text/plain' });
                if (pushUniqueFile(urlFile)) {
                    filesAdded++;
                }
            }

            // Handle base64 encoded data
            if (inputData.base64Data && typeof inputData.base64Data === 'string') {
                try {
                    const asset = await normalizeDataAsset(inputData.base64Data, {
                        namePrefix: "shared",
                        uriComponent: true
                    });
                    if (pushUniqueFile(asset.file)) {
                        filesAdded++;
                    }
                } catch (error) {
                    console.warn('[WorkCenter] Failed to decode base64 data:', error);
                }
            }

            // Clear recognized data when new inputs are added
            const { WorkCenterStateManager: StateManager } = await import('./WorkCenterState');
            StateManager.clearRecognizedData(state);

            // Save state
            StateManager.saveState(state);

            // Notify about file changes for toolbar updates
            if (filesAdded > 0 || textAdded) {
                // Bring attachments tab to front for share-target/launch-queue inputs.
                state.activeInputTab = 'attachments';
                this.deps.onFilesChanged?.();
            }

            // Show notification
            let message = '';
            if (filesAdded > 0) {
                message += `${filesAdded} file(s) added to work center`;
            }
            if (textAdded) {
                message += (message ? ' and ' : '') + 'text content added';
            }
            if (message) {
                this.deps.showMessage?.(message);
            }

            // Re-render so attachment list/count reflects new inputs.
            if (filesAdded > 0 || textAdded) {
                this.deps.render?.();
            }

        } catch (error) {
            console.error('[WorkCenter] Failed to add share target input:', error);
            this.deps.showMessage?.('Failed to add share target input');
        }
    }

    sendShareTargetResult(resultData: any): void {
        void sendUnifiedMessage({
            type: 'share-target-result',
            source: 'workcenter',
            destination: 'workcenter',
            data: resultData,
            metadata: { priority: 'high' }
        }).catch((error) => {
            console.error('[WorkCenter] Failed to send share target result:', error);
        });
    }

    sendShareTargetInput(inputData: any): void {
        void sendUnifiedMessage({
            type: 'share-target-input',
            source: 'workcenter',
            destination: 'workcenter',
            data: inputData,
            metadata: { priority: 'high' }
        }).catch((error) => {
            console.error('[WorkCenter] Failed to send share target input:', error);
        });
    }

    private async handleCachedContent(state: WorkCenterState, data: any): Promise<void> {
        const { cacheKey, context, content } = data;

        if (context === 'share-target' && content) {
            console.log('[WorkCenter] Processing cached share-target content:', summarizeForLog(content));

            // Add the content to work center
            await this.addShareTargetInput(state, content);

            // Try to retrieve additional cached files if any
            await this.retrieveCachedFiles(state, cacheKey);
        }
    }

    private async handleReceivedContent(state: WorkCenterState, data: any): Promise<void> {
        const { content, context } = data;

        if (context === 'share-target' && content) {
            console.log('[WorkCenter] Processing received share-target content:', summarizeForLog(content));

            // Add the content to work center
            await this.addShareTargetInput(state, content);
        }
    }

    async handleAIResult(state: WorkCenterState, resultData: any): Promise<void> {
        const { success, data, error } = resultData;

        if (!success) {
            console.warn('[WorkCenter] AI processing failed:', error);
            this.deps.showMessage?.('AI processing failed: ' + (error || 'Unknown error'));
            return;
        }

        if (!data) {
            console.warn('[WorkCenter] No data in AI result');
            return;
        }

        console.log('[WorkCenter] Adding AI processing result to work center');

        try {
            // Add to processedData pipeline as an AI processing result
            const processedEntry = {
                content: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
                timestamp: Date.now(),
                action: 'AI Processing (Share Target)',
                sourceData: { aiResult: data, source: 'share-target' },
                metadata: {
                    source: 'share-target-ai',
                    processingType: 'ai',
                    resultType: typeof data
                }
            };

            // Import the state manager function
            const { WorkCenterStateManager } = await import('./WorkCenterState');
            WorkCenterStateManager.addProcessedStep(state, processedEntry);

            // Set last result for output actions
            state.lastRawResult = data;

            // Save state
            WorkCenterStateManager.saveState(state);

            // Re-render to show output/pipeline updates
            this.deps.render?.();

            // Show notification
            this.deps.showMessage?.('AI processing result added to work center');

            // Trigger UI update if needed
            if (this.deps.render) {
                this.deps.render();
            }

        } catch (error) {
            console.error('[WorkCenter] Failed to add AI result:', error);
            this.deps.showMessage?.('Failed to add AI processing result');
        }
    }

    private async retrieveCachedFiles(state: WorkCenterState, cacheKey: string): Promise<void> {
        try {
            const files = await fetchCachedShareFiles(cacheKey || "latest");
            if (files.length > 0) {
                const fileFingerprint = (file: File): string =>
                    `${String(file.name || '').trim().toLowerCase()}::${Number(file.size || 0)}::${String(file.type || '').trim().toLowerCase()}`;
                const seenFingerprints = new Set<string>((state.files || []).map(fileFingerprint));
                let added = 0;
                for (const file of files) {
                    if (!(file instanceof File)) continue;
                    const key = fileFingerprint(file);
                    if (seenFingerprints.has(key)) continue;
                    seenFingerprints.add(key);
                    console.log("[WorkCenter] Adding cached file:", file.name);
                    state.files.push(file);
                    added++;
                }
                if (added > 0) {
                    this.deps.onFilesChanged?.();
                    this.deps.showMessage?.(`Added ${added} cached file(s) from share-target`);
                }
            }
        } catch (error) {
            console.warn('[WorkCenter] Failed to retrieve cached files:', error);
        }
    }
}
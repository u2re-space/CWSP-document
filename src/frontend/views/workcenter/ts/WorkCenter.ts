// Configure marked with KaTeX extension for HTML output with proper delimiters
import { marked, type MarkedExtension } from "marked";
import markedKatex from "marked-katex-extension";
import renderMathInElement from "katex/dist/contrib/auto-render.mjs";


const MATH_DELIMITER_PATTERN = /\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|(?<!\$)\$[^$\n]+\$|\\\([\s\S]*?\\\)/;
const FENCED_CODE_PATTERN = /(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2(?=\n|$)/g;
const INLINE_CODE_PATTERN = /`[^`\n]+`/g;
const SANITIZE_OPTIONS = {
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "applet", "link", "meta", "base", "form", "noscript", "template"],
    FORBID_CONTENTS: ["script", "style", "iframe", "object", "embed", "applet", "noscript", "template"]
};

function maskCodeSegments(markdown: string): { masked: string; restore: (value: string) => string } {
    const maskedValues: string[] = [];
    const tokenPrefix = "__MD_MASK_";
    const tokenSuffix = "__";

    const mask = (value: string): string => value.replace(FENCED_CODE_PATTERN, (segment) => {
        const token = `${tokenPrefix}${maskedValues.length}${tokenSuffix}`;
        maskedValues.push(segment);
        return token;
    });

    const maskInline = (value: string): string => value.replace(INLINE_CODE_PATTERN, (segment) => {
        const token = `${tokenPrefix}${maskedValues.length}${tokenSuffix}`;
        maskedValues.push(segment);
        return token;
    });

    const masked = maskInline(mask(markdown));

    return {
        masked,
        restore: (value: string): string => value.replace(/__MD_MASK_(\d+)__/g, (_, index) => maskedValues[Number(index)] ?? "")
    };
}

// Configure marked with KaTeX extension for HTML output with proper delimiters
marked?.use?.(markedKatex({
    throwOnError: false,
    nonStandard: true,
    output: "mathml",
    strict: false,
}) as unknown as MarkedExtension,
{
    hooks: {
        preprocess: (markdown: string): string => {
            if (!MATH_DELIMITER_PATTERN.test(markdown)) {
                return markdown;
            }

            const { masked, restore } = maskCodeSegments(markdown);
            const katexNode = document.createElement("div");
            katexNode.textContent = masked;
            renderMathInElement(katexNode, {
                throwOnError: false,
                nonStandard: true,
                output: "mathml",
                strict: false,
                delimiters: [
                    { left: "$$", right: "$$", display: true },
                    { left: "\\[", right: "\\]", display: true },
                    { left: "$", right: "$", display: false },
                    { left: "\\(", right: "\\)", display: false }
                ]
            });

            return restore(katexNode.innerHTML);
        },
    },
});

// Re-export state and dependencies interfaces for backward compatibility
export type { WorkCenterState, WorkCenterDependencies } from "./WorkCenterState";

import type { WorkCenterState, WorkCenterDependencies } from "./WorkCenterState";
import { WorkCenterStateManager } from "./WorkCenterState";
import { WorkCenterUI } from "./WorkCenterUI";
import { WorkCenterFileOps } from "./WorkCenterFileOps";
import { WorkCenterShareTarget } from "./WorkCenterShareTarget";
import { WorkCenterTemplates } from "./WorkCenterTemplates";
import { WorkCenterVoice } from "./WorkCenterVoice";
import { WorkCenterActions } from "./WorkCenterActions";
import { WorkCenterDataProcessing } from "./WorkCenterDataProcessing";
import { WorkCenterEvents } from "./WorkCenterEvents";

// Import component registration system
import { registerComponent, initializeComponent } from "com/core/UnifiedMessaging";
import { WorkCenterResults } from "./WorkCenterResults";
import { WorkCenterAttachments } from "./WorkCenterAttachments";
import { WorkCenterPrompts } from "./WorkCenterPrompts";
import { WorkCenterHistory } from "./WorkCenterHistory";

export class WorkCenterManager {
    private state: WorkCenterState;
    private deps: WorkCenterDependencies;

    // Sub-modules
    private ui: WorkCenterUI;
    private fileOps: WorkCenterFileOps;
    private shareTarget: WorkCenterShareTarget;
    private templates: WorkCenterTemplates;
    private voice: WorkCenterVoice;
    private actions: WorkCenterActions;
    private dataProcessing: WorkCenterDataProcessing;
    private attachments: WorkCenterAttachments;
    private prompts: WorkCenterPrompts;
    private results: WorkCenterResults;
    private history: WorkCenterHistory;
    private events: WorkCenterEvents;
    private processedMessageIds = new Set<string>();

    constructor(dependencies: WorkCenterDependencies) {
        this.deps = dependencies;
        this.state = WorkCenterStateManager.createDefaultState();

        // Initialize sub-modules
        this.dataProcessing = new WorkCenterDataProcessing();
        this.templates = new WorkCenterTemplates(dependencies);
        this.voice = new WorkCenterVoice(dependencies);
        this.fileOps = new WorkCenterFileOps(dependencies);
        this.history = new WorkCenterHistory(dependencies);
        this.attachments = new WorkCenterAttachments(dependencies, this.fileOps);
        this.prompts = new WorkCenterPrompts(dependencies, this.templates, this.voice);
        this.results = new WorkCenterResults(dependencies, this.dataProcessing);
        this.ui = new WorkCenterUI(dependencies, this.attachments, this.prompts, this.results, this.history);
        this.shareTarget = new WorkCenterShareTarget(dependencies, this.fileOps);
        this.actions = new WorkCenterActions(dependencies, this.ui, this.fileOps, this.dataProcessing, this.results, this.history, this.templates);
        this.events = new WorkCenterEvents(
            dependencies,
            this.ui,
            this.fileOps,
            this.actions,
            this.templates,
            this.voice,
            this.shareTarget,
            this.history,
            this.attachments,
            this.prompts,
            this.state
        );

        // Initialize share target result listener
        this.shareTarget.initShareTargetListener(this.state);

        // Register component for catch-up messaging
        registerComponent('workcenter-core', 'workcenter');

        // Process any queued messages that were sent before work center was available
        this.shareTarget.processQueuedMessages(this.state);

        // Process pending messages from component registry
        const pendingMessages = initializeComponent('workcenter-core');
        for (const message of pendingMessages) {
            console.log(`[WorkCenter] Processing pending message:`, message);
            this.handleExternalMessage(message);
        }

        // Listen for hash changes to update UI elements like drop hints
        if (typeof globalThis !== 'undefined') {
            globalThis?.addEventListener?.('hashchange', () => {
                // Update drop hints when hash changes
                this.attachments.updateDropHint?.();
            });
        }
    }

    // File handling methods - delegate to fileOps module
    async handleDroppedContent(content: string, sourceType: string): Promise<void> {
        return this.fileOps.handleDroppedContent(this.state, content, sourceType);
    }

    async handlePastedContent(content: string, sourceType: string): Promise<void> {
        return this.fileOps.handlePastedContent(this.state, content, sourceType);
    }

    // Handle incoming content from unified messaging system
    private async handleIncomingContent(data: any, contentType: string): Promise<void> {
        try {
            let fileToAttach: File | null = null;

            if (data.file instanceof File) {
                fileToAttach = data.file;
            } else if (data.blob instanceof Blob) {
                const filename = data.filename || `attachment-${Date.now()}.${contentType === 'markdown' ? 'md' : 'txt'}`;
                fileToAttach = new File([data.blob], filename, { type: data.blob.type });
            } else if (data.text || data.content) {
                const content = data.text || data.content;
                const textContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
                const filename = data.filename || `content-${Date.now()}.${contentType === 'markdown' ? 'md' : 'txt'}`;
                const mimeType = contentType === 'markdown' ? 'text/markdown' : 'text/plain';
                fileToAttach = new File([textContent], filename, { type: mimeType });
            }

            if (fileToAttach) {
                this.state.files.push(fileToAttach);
                // Update UI to reflect new file
                this.ui.updateFileList(this.state);
                this.ui.updateFileCounter(this.state);
                this.deps.showMessage(`Attached ${fileToAttach.name} to Work Center`);
            }
        } catch (error) {
            console.warn('[WorkCenter] Failed to handle incoming content:', error);
            this.deps.showMessage('Failed to attach content');
        }
    }

    /**
     * Public entry for Basic/Main unified-messaging handler and pending inbox replay.
     * Handles share-target inputs/results and general content-share attachment.
     */
    async handleExternalMessage(message: any): Promise<void> {
        if (!message) return;
        const messageId = typeof message?.id === "string" ? message.id : "";
        if (messageId) {
            if (this.processedMessageIds.has(messageId)) {
                return;
            }
            this.processedMessageIds.add(messageId);
            if (this.processedMessageIds.size > 256) {
                const [first] = this.processedMessageIds;
                if (first) this.processedMessageIds.delete(first);
            }
        }

        // Share-target messages should update both attachments and results pipeline.
        if (message.type === 'share-target-input' && message.data) {
            await this.shareTarget.addShareTargetInput(this.state, message.data);
            this.ui.updateFileList(this.state);
            this.ui.updateFileCounter(this.state);
            this.ui.updateDataPipeline(this.state);
            return;
        }

        if (message.type === 'share-target-result' && message.data) {
            await this.shareTarget.addShareTargetResult(this.state, message.data);
            this.ui.updateDataPipeline(this.state);
            return;
        }

        if (message.type === 'ai-result' && message.data) {
            await this.shareTarget.handleAIResult(this.state, message.data);
            this.ui.updateDataPipeline(this.state);
            return;
        }

        // Generic content attachment
        if (message.type === 'content-share' && message.data) {
            await this.handleIncomingContent(message.data, message.contentType || 'text');
        }
    }


    getState(): WorkCenterState {
        return this.state;
    }

    destroy(): void {
        // Clear container references
        this.ui.setContainer(null);
        this.attachments.setContainer(null);
        this.prompts.setContainer(null);
        this.results.setContainer(null);
        this.history.setContainer(null);

        // The WorkCenterCommunicator handles its own cleanup
        // No need to manually close channels here
        console.log('[WorkCenter] WorkCenterManager destroyed');
    }

    renderWorkCenterView(): HTMLElement {
        const container = this.ui.renderWorkCenterView(this.state);

        // Set up event listeners
        this.events.setContainer(container);
        this.events.setupWorkCenterEvents();

        // Update file list, file counter, and recent history
        this.ui.updateFileList(this.state);
        this.ui.updateFileCounter(this.state);
        this.history.updateRecentHistory(this.state);

        return container;
    }

}

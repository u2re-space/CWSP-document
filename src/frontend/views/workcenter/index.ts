/**
 * Work Center View
 *
 * Shell adapter for the module-based WorkCenter implementation.
 */

import { loadAsAdopted, removeAdopted } from "fest/dom";
import type { View, ViewOptions, ViewLifecycle, ShellContext } from "../../shells/types";
import { type BaseViewOptions } from "../types";
import { WorkCenterManager } from "./ts/WorkCenter";
import type { WorkCenterDependencies } from "./ts/WorkCenterState";

// @ts-ignore - SCSS import
import workcenterStyles from "./scss/_index.scss?inline";
import BaseElement from "../base/BaseElement";
import { defineElement, type CustomElementLifecycle } from "fest/lure";

export interface WorkCenterOptions extends BaseViewOptions {
    initialFiles?: File[];
    initialPrompt?: string;
    onProcessComplete?: (result: string) => void;
    onFilesChange?: (files: File[]) => void;
}

type WorkCenterMessageData = {
    file?: File;
    files?: File[];
    text?: string;
    content?: string;
    url?: string;
    filename?: string;
    source?: string;
};

type WorkCenterInboundMessage = {
    type?: string;
    contentType?: string;
    data?: WorkCenterMessageData;
};

// @ts-ignore
@defineElement("cw-workcenter-view")
export class WorkCenterView extends BaseElement implements View {
    id = "workcenter" as const;
    name = "Work Center";
    icon = "lightning";

    private options: WorkCenterOptions;
    private shellContext?: ShellContext;
    private element: HTMLElement | null = null;
    private manager: WorkCenterManager | null = null;
    private deps: WorkCenterDependencies;
    private initializedFromOptions = false;
    private lastOutputText = "";
    private pendingRenderAfterMount = false;
    private resultObserver: MutationObserver | null = null;
    private _sheet: CSSStyleSheet | null = null;
    private readonly autoFileFingerprints = new Set<string>();
    private pendingMessages: WorkCenterInboundMessage[] = [];

    lifecycle: ViewLifecycle = {
        onMount: () => this.onMount(),
        onUnmount: () => this.onUnmount(),
        onShow: () => this.onShow(),
        onHide: () => this.onHide()
    };

    constructor(options: WorkCenterOptions = {}) {
        super();
        this.options = options;
        this.shellContext = options.shellContext;

        this.deps = {
            state: {},
            history: [],
            getSpeechPrompt: async () => null,
            showMessage: (message: string) => this.showMessage(message),
            render: () => this.requestRender(),
            navigate: (viewId: string) => this.shellContext?.navigate(viewId as Parameters<ShellContext["navigate"]>[0]),
            onFilesChanged: () => this.emitFilesChanged()
        };
    }

    /**
     * GLitElement calls `render(weakRef)` when the host is connected; the shell calls `render(options?)`.
     * Only merge real view options — never a WeakRef from GLit.
     */
    private isGlitterWeakRef(arg: unknown): arg is WeakRef<HTMLElement> {
        return Boolean(arg && typeof (arg as WeakRef<HTMLElement>).deref === "function");
    }

    private ensureWorkCenterStylesOnShadow(): void {
        const sheet = loadAsAdopted(workcenterStyles) as CSSStyleSheet | null;
        if (sheet) this._sheet = sheet;
        const root = this.shadowRoot;
        if (!sheet || !root?.adoptedStyleSheets) return;
        if (!root.adoptedStyleSheets.includes(sheet)) {
            root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
        }
    }

    override onInitialize(): this {
        const self = super.onInitialize();
        this.ensureWorkCenterStylesOnShadow();
        return (self ?? this) as this;
    }

    /** Shell passes `ViewOptions`; GLitElement passes a `WeakRef` — ignore the latter for option merging. */
    render = (weakOrOptions?: unknown): HTMLElement => {
        const options = this.isGlitterWeakRef(weakOrOptions) ? undefined : (weakOrOptions as ViewOptions | undefined);
        if (options) {
            this.options = { ...this.options, ...options };
            this.shellContext = options.shellContext || this.shellContext;
        }

        this._sheet = loadAsAdopted(workcenterStyles) as CSSStyleSheet;
        this.ensureWorkCenterStylesOnShadow();

        this.manager ??= new WorkCenterManager(this.deps);
        if (!this.initializedFromOptions) {
            this.applyInitialOptions();
            this.initializedFromOptions = true;
        }

        this.element = this.manager.renderWorkCenterView();
        this.syncPromptInputFromState();
        this.setupProcessResultObserver();
        this.emitFilesChanged();
        void this.flushPendingMessages();
        return this.element;
    };
    
    getToolbar(): HTMLElement | null {
        return null;
    }

    private normalizeInitialDataMessage(initialData: unknown): WorkCenterInboundMessage | null {
        if (!initialData) return null;

        if (typeof initialData === "string") {
            return {
                type: "content-share",
                contentType: "text",
                data: {
                    text: initialData,
                    content: initialData
                }
            };
        }

        if (initialData instanceof File) {
            return {
                type: "content-share",
                contentType: initialData.type || "application/octet-stream",
                data: {
                    file: initialData,
                    filename: initialData.name
                }
            };
        }

        if (Array.isArray(initialData)) {
            const files = initialData.filter((entry): entry is File => entry instanceof File);
            if (files.length > 0) {
                return {
                    type: "content-share",
                    contentType: files[0]?.type || "application/octet-stream",
                    data: {
                        file: files[0],
                        files,
                        filename: files[0]?.name
                    }
                };
            }
            return null;
        }

        if (typeof initialData !== "object") return null;

        const record = initialData as Record<string, unknown>;
        const nestedData = (record.data && typeof record.data === "object")
            ? (record.data as Record<string, unknown>)
            : record;
        const files = Array.isArray(nestedData.files)
            ? nestedData.files.filter((entry): entry is File => entry instanceof File)
            : undefined;
        const file = nestedData.file instanceof File ? nestedData.file : files?.[0];
        const text = typeof nestedData.text === "string" ? nestedData.text : undefined;
        const content = typeof nestedData.content === "string" ? nestedData.content : undefined;
        const url = typeof nestedData.url === "string" ? nestedData.url : undefined;
        const filename = typeof nestedData.filename === "string" ? nestedData.filename : file?.name;
        const source = typeof nestedData.source === "string" ? nestedData.source : undefined;

        if (!file && !(files?.length) && !text && !content && !url) return null;

        return {
            type: typeof record.type === "string" ? record.type : "content-share",
            contentType: typeof record.contentType === "string"
                ? record.contentType
                : (file?.type || "text"),
            data: {
                file,
                files,
                text,
                content,
                url,
                filename,
                source
            }
        };
    }

    addFiles(files: File[]): void {
        const state = this.manager?.getState();
        if (!state || files.length === 0) return;
        const added = this.appendUniqueAutoFiles(state.files, files);
        if (added <= 0) return;
        this.requestRender();
        this.emitFilesChanged();
    }

    setPrompt(prompt: string): void {
        const state = this.manager?.getState();
        if (!state) return;
        state.currentPrompt = prompt;
        this.syncPromptInputFromState();
    }

    getFiles(): File[] {
        return [...(this.manager?.getState().files || [])];
    }

    canHandleMessage(messageType: string): boolean {
        return [
            "content-attach",
            "content-process",
            "file-attach",
            "share-target-input",
            "share-target-result",
            "ai-result",
            "content-share"
        ].includes(messageType);
    }

    async handleMessage(message: unknown): Promise<void> {
        const msg = message as WorkCenterInboundMessage;

        if (!this.manager) {
            if (this.pendingMessages.length >= 64) this.pendingMessages.shift();
            this.pendingMessages.push(msg);
            return;
        }
        await this.handleMessageWithManager(msg);
    }

    private async handleMessageWithManager(msg: WorkCenterInboundMessage): Promise<void> {
        if (!this.manager) return;

        if (msg.type === "share-target-input" || msg.type === "share-target-result" || msg.type === "ai-result" || msg.type === "content-share") {
            await this.manager.handleExternalMessage(msg);
            this.emitFilesChanged();
            return;
        }

        if (msg.data?.file) {
            this.addFiles([msg.data.file]);
        }
        if (msg.data?.files?.length) {
            this.addFiles(msg.data.files);
        }

        const prompt = msg.data?.text || msg.data?.content || msg.data?.url || "";
        if (prompt.trim()) {
            this.setPrompt(prompt);
        }

        if (msg.type === "content-process") {
            const executeBtn = this.element?.querySelector('[data-action="execute"]') as HTMLButtonElement | null;
            executeBtn?.click();
        }
    }

    private async flushPendingMessages(): Promise<void> {
        if (!this.manager || this.pendingMessages.length === 0) return;
        const queue = this.pendingMessages.splice(0, this.pendingMessages.length);
        for (const message of queue) {
            const msg = message as WorkCenterInboundMessage;
            await this.handleMessageWithManager(msg);
        }
    }

    private applyInitialOptions(): void {
        const state = this.manager?.getState();
        if (!state) return;

        if (Array.isArray(this.options.initialFiles) && this.options.initialFiles.length > 0) {
            this.appendUniqueAutoFiles(state.files, this.options.initialFiles);
        }
        if (typeof this.options.initialPrompt === "string" && this.options.initialPrompt.trim()) {
            state.currentPrompt = this.options.initialPrompt;
        }

        const initialMessage = this.normalizeInitialDataMessage(this.options.initialData);
        if (initialMessage) {
            this.pendingMessages.unshift(initialMessage);
        }
    }

    private appendUniqueAutoFiles(target: File[], incoming: File[]): number {
        let added = 0;
        for (const file of incoming) {
            if (!(file instanceof File)) continue;
            const key = `${String(file.name || "").trim().toLowerCase()}::${Number(file.size || 0)}::${String(file.type || "").trim().toLowerCase()}`;
            if (this.autoFileFingerprints.has(key)) continue;
            this.autoFileFingerprints.add(key);
            target.push(file);
            added++;
        }
        return added;
    }

    private syncPromptInputFromState(): void {
        const state = this.manager?.getState();
        if (!state || !this.element) return;
        const promptInput = this.element.querySelector(".prompt-input") as HTMLTextAreaElement | null;
        if (promptInput) {
            promptInput.value = state.currentPrompt || "";
        }
    }

    private setupProcessResultObserver(): void {
        this.resultObserver?.disconnect();
        if (!this.element || !this.options.onProcessComplete) return;

        const output = this.element.querySelector("[data-output]") as HTMLElement | null;
        if (!output) return;

        this.resultObserver = new MutationObserver(() => {
            const resultNode = output.querySelector(".result-content") as HTMLElement | null;
            const text = resultNode?.textContent?.trim() || "";
            if (!text || text === this.lastOutputText) return;
            this.lastOutputText = text;
            this.options.onProcessComplete?.(text);
        });

        this.resultObserver.observe(output, { childList: true, subtree: true, characterData: true });
    }

    private emitFilesChanged(): void {
        const files = this.manager?.getState().files || [];
        this.options.onFilesChange?.([...files]);
    }

    private requestRender(): void {
        if (!this.manager || !this.element) return;
        const currentElement = this.element;
        const parent = currentElement.parentElement;
        if (!parent) {
            // During cold-start share/launch bootstrap, messages can arrive before the
            // rendered node is actually attached by the shell. Re-rendering now would
            // rebind manager containers to a detached tree and make visible UI inert.
            this.pendingRenderAfterMount = true;
            return;
        }
        const next = this.manager.renderWorkCenterView();

        // Preserve shell visibility markers on root replacement.
        const activeViewMarker = currentElement.getAttribute("data-view");
        if (activeViewMarker) {
            next.setAttribute("data-view", activeViewMarker);
        }
        next.hidden = currentElement.hidden;

        parent.replaceChild(next, currentElement);
        this.element = next;
        this.syncPromptInputFromState();
        this.setupProcessResultObserver();
    }

    private showMessage(message: string): void {
        this.shellContext?.showMessage(message);
    }

    private onMount(): void {
        this._sheet ??= loadAsAdopted(workcenterStyles) as CSSStyleSheet;
    }

    private onUnmount(): void {
        this.resultObserver?.disconnect();
        this.resultObserver = null;
        this.manager?.destroy();
        this.manager = null;
        if (this._sheet) {
            removeAdopted(this._sheet);
        }
        this._sheet = null;
    }

    private onShow(): void {
        this._sheet ??= loadAsAdopted(workcenterStyles) as CSSStyleSheet;
        if (this.pendingRenderAfterMount) {
            this.pendingRenderAfterMount = false;
            this.requestRender();
        }
        void this.flushPendingMessages();
    }

    private onHide(): void {
        // Keep DOM and manager state alive while hidden.
    }

}

export function createView(options?: WorkCenterOptions): WorkCenterView {
    return new WorkCenterView(options);
}

export const createWorkCenterView = createView;
export default createView;
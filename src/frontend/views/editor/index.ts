/**
 * Editor View
 *
 * Shell-agnostic markdown editor component.
 */

import { H } from "fest/lure";
import { ref, affected } from "fest/object";
import { loadAsAdopted, removeAdopted } from "fest/dom";
import type { View, ViewOptions, ViewLifecycle, ShellContext } from "shells/types";
import type { BaseViewOptions } from "views/types";
import { createViewState } from "views/types";
import { EditorChannelAction } from "views/apis/channel-actions";
import { writeText as writeClipboardText } from "core/modules/Clipboard";

// @ts-ignore
import style from "./editor.scss?inline";

// ============================================================================
// EDITOR STATE
// ============================================================================

interface EditorState {
    content: string;
    filename?: string;
}

const STORAGE_KEY = "rs-editor-state";
const DEFAULT_CONTENT = "# New Document\n\nStart writing here...";

// ============================================================================
// EDITOR VIEW
// ============================================================================

export interface EditorOptions extends BaseViewOptions {
    initialContent?: string;
    filename?: string;
    onSave?: (content: string) => void;
    onContentChange?: (content: string) => void;
}

export class EditorView implements View {
    id = "editor" as const;
    name = "Editor";
    icon = "pencil";

    private options: EditorOptions;
    private shellContext?: ShellContext;
    private element: HTMLElement | null = null;
    private contentRef = ref("");
    private stateManager = createViewState<EditorState>(STORAGE_KEY);
    private textarea: HTMLTextAreaElement | null = null;

    private _sheet: CSSStyleSheet | null = null;

    lifecycle: ViewLifecycle = {
        onMount: () => this.onMount(),
        onUnmount: () => this.saveState(),
        onShow: () => { this._sheet = loadAsAdopted(style) as CSSStyleSheet; },
        onHide: () => { removeAdopted(this._sheet); this.saveState(); },
    };

    constructor(options: EditorOptions = {}) {
        this.options = options;
        this.shellContext = options.shellContext;

        const saved = this.stateManager.load();
        this.contentRef.value = options.initialContent || saved?.content || DEFAULT_CONTENT;
    }

    render(options?: ViewOptions): HTMLElement {
        if (options) {
            this.options = { ...this.options, ...options };
            this.shellContext = options.shellContext || this.shellContext;
        }

        this._sheet = loadAsAdopted(style) as CSSStyleSheet;

        this.element = H`
            <div class="view-editor">
                <div class="view-editor__toolbar">
                    <div class="view-editor__toolbar-left">
                        <button class="view-editor__btn" data-action="open" type="button" title="Open file">
                            <ui-icon icon="folder-open" icon-style="duotone"></ui-icon>
                            <span>Open</span>
                        </button>
                        <button class="view-editor__btn" data-action="save" type="button" title="Save file">
                            <ui-icon icon="floppy-disk" icon-style="duotone"></ui-icon>
                            <span>Save</span>
                        </button>
                    </div>
                    <div class="view-editor__toolbar-right">
                        <button class="view-editor__btn" data-action="preview" type="button" title="Preview">
                            <ui-icon icon="eye" icon-style="duotone"></ui-icon>
                            <span>Preview</span>
                        </button>
                        <button class="view-editor__btn" data-action="copy" type="button" title="Copy all">
                            <ui-icon icon="copy" icon-style="duotone"></ui-icon>
                            <span>Copy</span>
                        </button>
                    </div>
                </div>
                <div class="view-editor__content">
                    <textarea
                        class="view-editor__textarea"
                        placeholder="Start writing markdown..."
                        data-editor-input
                    >${this.contentRef.value}</textarea>
                </div>
            </div>
        ` as HTMLElement;

        this.textarea = this.element.querySelector("[data-editor-input]") as HTMLTextAreaElement;
        this.setupEventHandlers();

        return this.element;
    }

    getToolbar(): HTMLElement | null {
        return null;
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    setContent(content: string): void {
        this.contentRef.value = content;
        if (this.textarea) {
            this.textarea.value = content;
        }
    }

    getContent(): string {
        return this.contentRef.value;
    }

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

    private setupEventHandlers(): void {
        if (!this.element) return;

        // Text input
        this.textarea?.addEventListener("input", () => {
            this.contentRef.value = this.textarea?.value || "";
            this.options.onContentChange?.(this.contentRef.value);
        });

        // Toolbar actions
        this.element.addEventListener("click", async (e) => {
            const target = e.target as HTMLElement;
            const button = target.closest("[data-action]") as HTMLButtonElement | null;
            if (!button) return;

            const action = button.dataset.action;
            switch (action) {
                case "open":
                    this.handleOpen();
                    break;
                case "save":
                    this.handleSave();
                    break;
                case "preview":
                    this.handlePreview();
                    break;
                case "copy":
                    await this.handleCopy();
                    break;
            }
        });
    }

    private handleOpen(): void {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".md,.markdown,.txt,text/markdown,text/plain";
        input.onchange = async () => {
            const file = input.files?.[0];
            if (file) {
                try {
                    const content = await file.text();
                    this.setContent(content);
                    this.options.filename = file.name;
                    this.showMessage(`Opened ${file.name}`);
                } catch {
                    this.showMessage("Failed to open file");
                }
            }
        };
        input.click();
    }

    private handleSave(): void {
        const content = this.contentRef.value;
        const filename = this.options.filename || "document.md";

        const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 250);

        this.options.onSave?.(content);
        this.showMessage(`Saved ${filename}`);
    }

    private handlePreview(): void {
        this.shellContext?.navigate("viewer");
    }

    private async handleCopy(): Promise<void> {
        try {
            const result = await writeClipboardText(this.contentRef.value);
            if (!result.ok) throw new Error(result.error || "Clipboard write failed");
            this.showMessage("Copied to clipboard");
        } catch {
            this.showMessage("Failed to copy");
        }
    }

    private saveState(): void {
        this.stateManager.save({
            content: this.contentRef.value,
            filename: this.options.filename
        });
    }

    private onMount(): void {
        console.log("[Editor] Mounted");
    }

    private showMessage(message: string): void {
        this.shellContext?.showMessage(message);
    }

    async invokeChannelApi(action: string, payload?: unknown): Promise<unknown> {
        const p =
            payload != null && typeof payload === "object" && !Array.isArray(payload)
                ? (payload as Record<string, unknown>)
                : {};
        const text =
            typeof p.text === "string"
                ? p.text
                : typeof p.content === "string"
                    ? p.content
                    : typeof payload === "string"
                        ? payload
                        : "";

        if (
            action === EditorChannelAction.SetContent ||
            action === EditorChannelAction.ContentLoad ||
            action === EditorChannelAction.ContentEdit
        ) {
            if (text) this.setContent(text);
            return true;
        }

        await this.handleMessage({ type: action, data: { text, content: text } });
        return true;
    }

    canHandleMessage(messageType: string): boolean {
        return ["content-edit", "content-load"].includes(messageType);
    }

    async handleMessage(message: unknown): Promise<void> {
        const msg = message as { data?: { text?: string; content?: string } };
        if (msg.data?.text || msg.data?.content) {
            this.setContent(msg.data.text || msg.data.content || "");
        }
    }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createView(options?: EditorOptions): EditorView {
    return new EditorView(options);
}

/** Alias for createView */
export const createEditorView = createView;

export default createView;

import { H } from "fest/lure";
import { loadAsAdopted } from "fest/dom";
import { marked, type MarkedExtension } from "marked";
import markedKatex from "marked-katex-extension";
import DOMPurify from 'dompurify';
import renderMathInElement from "katex/dist/contrib/auto-render.mjs";
import { downloadMarkdownAsDocx } from "@rs-core/document/DocxExport";
import { getWorkCenterComm } from "@rs-com/core/AppCommunicator";

// Import component registration system
import { registerComponent, initializeComponent } from "@rs-com/core/UnifiedMessaging";
import { UIPhosphorIcon } from "fest/icon";
console.log(UIPhosphorIcon);

//
import style from "./viewer.scss?inline";

//
try {
    loadAsAdopted(style);
    console.log("[MarkdownViewer] Style loaded");
} catch (error) {
    console.warn("[MarkdownViewer] Failed to load style:", error);
}


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
            // Code fragments are masked above, so HTML here is only from non-code markdown.
            katexNode.innerHTML = masked;
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

            return restore(katexNode.innerHTML)
                .replace(/&gt;/g, ">")
                .replace(/&lt;/g, "<")
                .replace(/&amp;/g, "&");
        },
    },
    });

export interface MarkdownViewerOptions {
    content?: string;
    title?: string;
    showTitle?: boolean;
    showActions?: boolean;
    onCopy?: (content: string) => void;
    onDownload?: (content: string) => void;
    onPrint?: (content: string) => void;
    onOpen?: () => void;
    onAttachToWorkCenter?: (content: string) => void;
}

export class MarkdownViewer {
    private options: MarkdownViewerOptions;
    private view: any = null;
    private container: HTMLElement | null = null;
    private content: string = "";
    private showRaw = false;
    private rawElement: HTMLPreElement | null = null;
    private renderedElement: HTMLElement | null = null;

    constructor(options: MarkdownViewerOptions = {}) {
        this.options = {
            content: "",
            title: "Markdown Viewer",
            showTitle: true,
            showActions: true,
            ...options
        };
        this.content = this.options.content || "";

        // Register component for catch-up messaging
        registerComponent('markdown-viewer-instance', 'viewer');

        // Process any pending messages
        const pendingMessages = initializeComponent('markdown-viewer-instance');
        for (const message of pendingMessages) {
            console.log(`[MarkdownViewer] Processing pending message:`, message);
            if (message.data?.text || message.data?.content) {
                const content = message.data.text || message.data.content;
                this.content = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
            }
        }
    }

    /**
     * Render the markdown viewer
     */
    render(): HTMLElement {
        this.container = H`<div class="markdown-viewer-container">
      ${this.options.showTitle ? H`<div class="viewer-header">
        <h3>${this.options.title}</h3>
        ${this.options.showActions ? H`<div class="viewer-actions">
          <button class="btn btn-icon" data-action="open" title="Open markdown file" aria-label="Open markdown file">
            <ui-icon icon="folder-open" size="20" icon-style="duotone"></ui-icon>
            <span class="btn-text">Open</span>
          </button>
          <button class="btn btn-icon" data-action="copy" title="Copy content" aria-label="Copy content">
            <ui-icon icon="copy" size="20" icon-style="duotone"></ui-icon>
            <span class="btn-text">Copy</span>
          </button>
          <button class="btn btn-icon" data-action="toggle-raw" title="Toggle raw view" aria-label="Toggle raw view">
            <ui-icon icon="code" size="20" icon-style="duotone"></ui-icon>
            <span class="btn-text">Raw</span>
          </button>
          <button class="btn btn-icon" data-action="copy-rendered" title="Copy rendered text" aria-label="Copy rendered text">
            <ui-icon icon="text-t" size="20" icon-style="duotone"></ui-icon>
            <span class="btn-text">Copy text</span>
          </button>
          <button class="btn btn-icon" data-action="download" title="Download as markdown" aria-label="Download as markdown">
            <ui-icon icon="download" size="20" icon-style="duotone"></ui-icon>
            <span class="btn-text">Download</span>
          </button>
          <button class="btn btn-icon" data-action="export-docx" title="Export as DOCX" aria-label="Export as DOCX">
            <ui-icon icon="file-doc" size="20" icon-style="duotone"></ui-icon>
            <span class="btn-text">DOCX</span>
          </button>
          <button class="btn btn-icon" data-action="print" title="Print content" aria-label="Print content">
            <ui-icon icon="printer" size="20" icon-style="duotone"></ui-icon>
            <span class="btn-text">Print</span>
          </button>
          <button class="btn btn-icon" data-action="attach-workcenter" title="Attach to Work Center" aria-label="Attach to Work Center">
            <ui-icon icon="lightning" size="20" icon-style="duotone"></ui-icon>
            <span class="btn-text">Work Center</span>
          </button>
        </div>` : ''}
      </div>` : ''}

      <div class="viewer-content"></div>
    </div>` as HTMLElement;

        // Initialize viewer
        this.initializeViewer(this.container);

        return this.container;
    }

    /**
     * Set content to display
     */
    setContent(content: string): void {
        this.content = content;
        if (this.view) {
            this.view.setMarkdown(content);
        }
        // Cache content for persistence
        this.writeToCache(content).catch(console.warn.bind(console));
    }

    /**
     * Load content from cache
     */
    async loadFromCache(): Promise<string | null> {
        try {
            if (navigator?.storage) {
                const cachedFile = await import("fest/lure").then(m => m.provide("/user/cache/last.md"));
                return cachedFile?.text?.() || null;
            }
            return localStorage.getItem("$cached-md$");
        } catch (error) {
            console.warn('[MarkdownViewer] Failed to load from cache:', error);
            return null;
        }
    }

    /**
     * Write content to cache
     */
    async writeToCache(content: string): Promise<void> {
        try {
            if (navigator?.storage) {
                const forWrite = await import("fest/lure").then(m => m.provide("/user/cache/last.md", true));
                await forWrite?.write?.(content);
                await forWrite?.close?.();
            } else {
                localStorage.setItem("$cached-md$", content);
            }
        } catch (error) {
            console.warn('[MarkdownViewer] Failed to write to cache:', error);
        }
    }

    /**
     * Get current content
     */
    getContent(): string {
        return this.content;
    }

    /**
     * Copy content to clipboard
     */
    async copyContent(): Promise<void> {
        try {
            await navigator.clipboard.writeText(this.content);
            this.options.onCopy?.(this.content);
        } catch (error) {
            console.warn('Failed to copy content:', error);
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = this.content;
            document.body.append(textArea);
            textArea.select();
            textArea.remove();
            this.options.onCopy?.(this.content);
        }
    }

    /**
     * Download content as markdown file
     */
    downloadContent(): void {
        const blob = new Blob([this.content], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        link.download = `markdown-content-${new Date().toISOString().split('T')[0]}.md`;
        document.body.append(link);
        link.click();
        link.remove();

        URL.revokeObjectURL(url);
        this.options.onDownload?.(this.content);
    }

    /**
     * Export content as DOCX file
     */
    async exportDocx(): Promise<void> {
        const md = this.content || "";
        if (!md.trim()) return;
        await downloadMarkdownAsDocx(md, {
            title: this.options.title || "Markdown Content",
            filename: `markdown-content-${new Date().toISOString().split('T')[0]}.docx`,
        });
    }

    /**
     * Print content
     */
    printContent(): void {
        try {
            // Get the rendered HTML content
            const viewElement = this.container?.querySelector('.markdown-viewer-content') as HTMLElement;
            if (!viewElement) {
                console.error('[MarkdownViewer] Could not find markdown content for printing');
                return;
            }

            // Try to use the server-side print route first
            const printUrl = new URL('/print', globalThis?.location?.origin);
            printUrl.searchParams.set('content', viewElement.innerHTML);
            printUrl.searchParams.set('title', this.options.title || 'Markdown Content');

            // Open print URL in new window
            const printWindow = globalThis?.open(printUrl.toString(), '_blank', 'width=800,height=600');
            if (!printWindow) {
                console.warn('[MarkdownViewer] Failed to open print window - popup blocked?');
                // Fallback: trigger browser print dialog on current content
                this.printCurrentContent();
                return;
            }

            this.options.onPrint?.(this.content);
        } catch (error) {
            console.error('[MarkdownViewer] Error printing content:', error);
            // Fallback to current content printing
            this.printCurrentContent();
        }
    }

    /**
     * Print current content using browser's print dialog
     */
    private printCurrentContent(): void {
        // Add print styles to current content
        const viewElement = this.container?.querySelector('.markdown-viewer-content') as HTMLElement;
        if (viewElement) {
            viewElement.setAttribute('data-print', 'true');
            // Trigger print dialog
            globalThis?.print?.();
            // Remove print attribute after printing
            setTimeout(() => {
                viewElement.removeAttribute('data-print');
            }, 1000);
        }
    }

    private initializeViewer(container: HTMLElement): void {
        const contentContainer = container.querySelector('.viewer-content') as HTMLElement;

        if (!contentContainer) {
            console.error('[MarkdownViewer] Content container not found');
            return;
        }

        // Create a properly themed markdown viewer with CSS classes
        const viewElement = document.createElement('div');
        viewElement.className = 'markdown-body markdown-viewer-content result-content';
        viewElement.setAttribute('data-print', 'true');
        this.renderedElement = viewElement;

        const rawElement = document.createElement("pre");
        rawElement.className = "markdown-viewer-raw";
        rawElement.setAttribute("aria-label", "Raw content");
        rawElement.hidden = true;
        this.rawElement = rawElement;

        contentContainer.innerHTML = '';
        contentContainer.append(viewElement, rawElement);

        const looksLikeHtmlDocument = (text: string): boolean => {
            const t = (text || "").trimStart().toLowerCase();
            if (t.startsWith("<!doctype html")) return true;
            if (t.startsWith("<html")) return true;
            if (t.startsWith("<head")) return true;
            if (t.startsWith("<body")) return true;
            if (t.startsWith("<?xml") && t.includes("<html")) return true;
            return false;
        };

        const applyViewMode = (showRaw: boolean) => {
            this.showRaw = showRaw;
            if (this.rawElement) this.rawElement.hidden = !showRaw;
            if (this.renderedElement) this.renderedElement.hidden = showRaw;
            container.toggleAttribute("data-raw", showRaw);
        };

        // Create a simple markdown renderer function
        this.view = {
            setMarkdown: async (text: string = "") => {
                try {
                    // Always update raw view text
                    if (this.rawElement) this.rawElement.textContent = text || "";

                    // Auto-switch to raw when this looks like a full HTML document
                    if (!this.showRaw && looksLikeHtmlDocument(text || "")) {
                        applyViewMode(true);
                    }

                    const html = await marked.parse((text || "")?.trim?.() || "");
                    const sanitized = DOMPurify?.sanitize?.((html || "")?.trim?.() || "", SANITIZE_OPTIONS) || "";
                    viewElement.innerHTML = sanitized;

                    console.log('[MarkdownViewer] Markdown rendered successfully:', {
                        inputLength: text?.length ?? 0,
                        outputLength: sanitized?.length ?? 0,
                        hasContent: !!sanitized
                    });
                } catch (error) {
                    console.error('[MarkdownViewer] Error rendering markdown:', error);
                    viewElement.innerHTML = `<div style="color: red; padding: 1rem; background: #fee; border: 1px solid #fcc; border-radius: 4px;">Error parsing markdown: ${(error as any)?.message}</div>`;
                }
            }
        } as any;

        console.log('[MarkdownViewer] Created simple div-based viewer');

        // Set initial content immediately
        if (this.content) {
            console.log('[MarkdownViewer] Setting initial content:', this.content.substring(0, 100) + '...');
            this.view.setMarkdown(this.content);
        }

        // Set up event listeners
        container.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const btn = target?.closest?.('[data-action]') as HTMLElement | null;
            const action = btn?.getAttribute('data-action');

            if (action === 'open') {
                this.options.onOpen?.();
            } else if (action === 'copy') {
                this.copyContent();
            } else if (action === 'toggle-raw') {
                applyViewMode(!this.showRaw);
            } else if (action === 'copy-rendered') {
                const text = (this.renderedElement?.innerText || "").trim();
                if (!text) return;
                navigator.clipboard.writeText(text).catch(() => {
                    const ta = document.createElement("textarea");
                    ta.value = text;
                    document.body.append(ta);
                    ta.select();
                    ta.remove();
                });
            } else if (action === 'download') {
                this.downloadContent();
            } else if (action === 'export-docx') {
                void this.exportDocx();
            } else if (action === 'print') {
                this.printContent();
            } else if (action === 'attach-workcenter') {
                this.attachToWorkCenter();
            }
        });
    }

    /**
     * Attach content to work center
     */
    private async attachToWorkCenter(): Promise<void> {
        if (this.options.onAttachToWorkCenter) {
            this.options.onAttachToWorkCenter(this.content);
        } else {
            // Fallback: broadcast to work center via WorkCenterCommunicator
            try {
                const workCenterComm = getWorkCenterComm();
                await workCenterComm.sendMessage('share-target-input', {
                    text: this.content,
                    timestamp: Date.now(),
                    metadata: {
                        source: 'markdown-viewer',
                        title: this.options.title || 'Markdown Content'
                    }
                }, { priority: 'normal' });
                console.log('[MarkdownViewer] Attached content to work center via WorkCenterComm');
            } catch (error) {
                console.warn('[MarkdownViewer] Failed to attach to work center:', error);
            }
        }
    }
}

/**
 * Create a markdown viewer instance
 */
export function createMarkdownViewer(options?: MarkdownViewerOptions): MarkdownViewer {
    return new MarkdownViewer(options);
}

/**
 * Custom element wrapper for MarkdownViewer
 */
export class MarkdownViewerElement extends HTMLElement {
    private viewer: MarkdownViewer | null = null;
    private content: string = "";

    constructor() {
        super();
    }

    connectedCallback() {
        this.style.setProperty("pointer-events", "auto");
        this.style.setProperty("touch-action", "manipulation");
        this.style.setProperty("user-select", "text");

        // Create content when element is connected to DOM
        if (!this.viewer) {
            this.createContent();
        }
    }

    setContent(content: string): void {
        this.content = content;
        if (this.viewer) {
            this.viewer.setContent(content);
        }
    }

    getContent(): string {
        return this.content;
    }

    private createContent(): void {
        // Use regular DOM instead of shadow root for now to avoid styling issues
        this.innerHTML = '';

        // Create the viewer instance
        this.viewer = new MarkdownViewer({
            content: this.content,
            showTitle: false,
            showActions: false
        });

        const viewerElement = this.viewer.render();
        this.append(viewerElement);
        this.shadowRoot?.adoptedStyleSheets.push(style as CSSStyleSheet);

        console.log('[MarkdownViewerElement] Content created successfully');
    }
}

/**
 * Define the markdown-viewer custom element
 */
export const defineMarkdownViewerElement = () => {
    if (!customElements.get("markdown-viewer")) {
        customElements.define("markdown-viewer", MarkdownViewerElement);
    }
};

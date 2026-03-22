/**
 * Markdown Viewer View
 *
 * Shell-agnostic markdown viewer component.
 * Can be used in any shell to display markdown content.
 * Uses the <md-view> web component for encapsulated rendering.
 */

import { H, normalizeDataAsset, parseDataUrl, isBase64Like, openDirectory, provide } from "fest/lure";
import { ref, affected } from "fest/object";
import { loadAsAdopted, removeAdopted } from "fest/dom";
import DOMPurify from 'dompurify';
import renderMathInElement from "katex/dist/contrib/auto-render.mjs";
import type { View, ViewOptions, ViewLifecycle, ShellContext } from "../../shells/types";
import type { BaseViewOptions } from "../types";
import { createViewState } from "../types";
import { writeText as writeClipboardText } from "@rs-core/modules/Clipboard";
import { loadSettings } from "@rs-com/config/Settings";
import type { MarkdownExtensionRule } from "@rs-com/config/SettingsTypes";

// Import the md-view web component from fl.ui
import "fest/fl-ui";

// @ts-ignore - SCSS import
import style from "./index.scss?inline";
import type { MarkedExtension } from "marked";

let markedParserPromise: Promise<(markdown: string) => Promise<string>> | null = null;


const MATH_DELIMITER_PATTERN = /\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|(?<!\$)\$[^$\n]+\$|\\\([\s\S]*?\\\)/;
const FENCED_CODE_PATTERN = /(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2(?=\n|$)/g;
const INLINE_CODE_PATTERN = /`[^`\n]+`/g;
const SANITIZE_OPTIONS = {
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "applet", "link", "meta", "base", "form", "noscript", "template"],
    FORBID_CONTENTS: ["script", "style", "iframe", "object", "embed", "applet", "noscript", "template"]
};
const DEFAULT_MARKDOWN_EXTENSION_FLAGS = "g";
const VIEWER_CSS_LAYER_ORDER = [
    "rs-md-base",
    "rs-md-system",
    "rs-md-modules",
    "rs-md-user",
    "rs-md-print",
    "rs-md-user-print"
] as const;

type ViewerMarkdownSettings = {
    preset: "default" | "classic" | "compact" | "paper";
    fontFamily: "system" | "sans" | "serif" | "mono";
    fontSizePx: number;
    lineHeight: number;
    contentMaxWidthPx: number;
    printScale: number;
    page: {
        size: "auto" | "A4" | "Letter" | "Legal" | "A5";
        orientation: "portrait" | "landscape";
        marginMm: number;
    };
    modules: {
        typography: boolean;
        tables: boolean;
        codeBlocks: boolean;
        blockquotes: boolean;
        media: boolean;
        printBreaks: boolean;
    };
    plugins: {
        smartTypography: boolean;
        softBreaksAsBr: boolean;
        externalLinksNewTab: boolean;
    };
    customCss: string;
    printCss: string;
    extensions: MarkdownExtensionRule[];
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

const getMarkedParser = async (): Promise<(markdown: string) => Promise<string>> => {
    if (markedParserPromise) return markedParserPromise;
    markedParserPromise = (async () => {
        const [{ marked }, { default: markedKatex }] = await Promise.all([
            import("marked"),
            import("marked-katex-extension"),
        ]);
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
        return async (markdown: string) => {
            return await marked.parse(markdown ?? "");
        };
    })();
    return markedParserPromise;
};

/** Warm marked + KaTeX chunk from the app entry; safe no-op if import fails. */
export function warmViewerMarkdownEngine(): void {
    void getMarkedParser().catch(() => { /* optional */ });
}

// ============================================================================
// VIEWER STATE
// ============================================================================

interface ViewerState {
    content: string;
    filename?: string;
    scrollPosition?: number;
}

const STORAGE_KEY = "rs-viewer-state";
const DEFAULT_CONTENT = `# 🤖 U2RE.space 🤖

🌳 Here is our project land... 🌳

## ⛑️ CrossWord i1 ⛑️

> 💡 *Open a markdown file or paste content here.*

**Welcome to CrossWord i1.**

### Features

- Advanced markdown viewer
- AI processing (work-center)
- File explorer (experimental)
- AirPad (experimental)
- Print (experimental)
- DOCX-export (experimental)
- PWA share target
- Drop and paste events

### Github

- [CrossWord](https://github.com/u2re-space/crossword) (source code)
- [Fest Live](https://github.com/fest-live) (libraries, frameworks)

### Components

- [Endpoint](https://github.com/u2re-space/crossword/src/endpoint) (nodejs, source code)
- [PWA-APP](https://u2re.space/) (public)

### Coming soon

- CRX extension in public release
- Endpoint for AirPad

### Developers

- [Fest Live](https://github.com/fest-live) (libraries, frameworks)
- [L2NE](https://github.com/L2NE-dev) (developer profile)

---

## 📱 Mobile Agent 📱

😔 **Coming soon...** 😔

### Features

- AI assistance
- Remote control
- User defined API
- Synchronizations
- Clipboard sharing
- Data storage
- Tunneling
- WebView
`;

// ============================================================================
// VIEWER OPTIONS
// ============================================================================

export interface ViewerOptions extends BaseViewOptions {
    /** Initial markdown content */
    initialContent?: string;
    /** Filename for display */
    filename?: string;
    /** Enable editing mode */
    editable?: boolean;
    /** Enable print view */
    content?: string;
    /** Title for display */
    title?: string;
    /** Callback when content changes */
    onContentChange?: (content: string) => void;
    /** Callback when copy action is triggered */
    onCopy?: (content: string) => void;
    /** Callback when download action is triggered */
    onDownload?: (content: string, filename?: string) => void;
    /** Callback to attach content to work center */
    onAttachToWorkCenter?: (content: string) => void;
    /** Callback to print content */
    onPrint?: (content: string) => void;
    /** Callback to open file */
    onOpen?: () => void;
    /** Source URL/path used to resolve relative markdown resources */
    source?: string;
}

// ============================================================================
// VIEWER VIEW IMPLEMENTATION
// ============================================================================

export class ViewerView implements View {
    id = "viewer" as const;
    name = "Viewer";
    icon = "eye";

    private options: ViewerOptions;
    private shellContext?: ShellContext;
    private element: HTMLElement | null = null;
    private contentRef = ref("");
    private stateManager = createViewState<ViewerState>(STORAGE_KEY);
    private _sheet: CSSStyleSheet | null = null;
    private pasteController: AbortController | null = null;
    private isViewVisible = false;
    private isPointerInView = false;
    private sourceUrl: string | null = null;
    private customSheet: CSSStyleSheet | null = null;
    private userStyleModules: { screenCss: string; printCss: string } = { screenCss: "", printCss: "" };
    private markdownSettings: ViewerMarkdownSettings = {
        preset: "default",
        fontFamily: "system",
        fontSizePx: 16,
        lineHeight: 1.7,
        contentMaxWidthPx: 860,
        printScale: 1,
        page: {
            size: "auto",
            orientation: "portrait",
            marginMm: 12
        },
        modules: {
            typography: true,
            tables: true,
            codeBlocks: true,
            blockquotes: true,
            media: true,
            printBreaks: true
        },
        plugins: {
            smartTypography: false,
            softBreaksAsBr: false,
            externalLinksNewTab: true
        },
        customCss: "",
        printCss: "",
        extensions: []
    };
    private markdownSettingsPromise: Promise<void> | null = null;

    lifecycle: ViewLifecycle = {
        onMount: () => this.onMount(),
        onUnmount: () => this.onUnmount(),
        onShow: () => this.onShow(),
        onHide: () => this.onHide(),
        onRefresh: () => this.onRefresh()
    };

    constructor(options: ViewerOptions = {}) {
        this.options = options;
        this.shellContext = options.shellContext;
        this.sourceUrl = this.normalizeSourceUrl(options.source);
        this.markdownSettingsPromise = this.loadMarkdownSettings();

        // Load initial content
        const savedState = this.stateManager.load();
        this.contentRef.value = options.initialContent || savedState?.content || DEFAULT_CONTENT;
    }

    render(options?: ViewOptions): HTMLElement {
        // Merge options
        if (options) {
            this.options = { ...this.options, ...options };
            this.shellContext = options.shellContext || this.shellContext;
        }

        // Load styles (idempotent — returns cached sheet)
        this._sheet = loadAsAdopted(style) as CSSStyleSheet;

        // Create main element with md-view web component
        this.element = H`
            <div class="view-viewer">
                <div class="view-viewer__toolbar" data-viewer-toolbar>
                    <div class="view-viewer__toolbar-left">
                        
                        <button class="view-viewer__btn" data-action="toggle-raw" type="button" title="Toggle raw/rendered view">
                            <ui-icon icon="code" icon-style="duotone"></ui-icon>
                            <span>Raw</span>
                        </button>
                        <button class="view-viewer__btn" data-action="copy" type="button" title="Copy raw content">
                            <ui-icon icon="copy" icon-style="duotone"></ui-icon>
                            <span>Copy</span>
                        </button>
                        <button class="view-viewer__btn" data-action="download" type="button" title="Download as markdown">
                            <ui-icon icon="download" icon-style="duotone"></ui-icon>
                            <span>Download</span>
                        </button>
                    </div>
                    <div class="view-viewer__toolbar-right">
                        
                        <button class="view-viewer__btn" data-action="attach" type="button" title="Attach to Work Center">
                            <ui-icon icon="lightning" icon-style="duotone"></ui-icon>
                            <span>Attach</span>
                        </button>
                        <button class="view-viewer__btn" data-action="open-style-settings" type="button" title="Markdown styling, modules, plugins">
                            <ui-icon icon="paint-roller" icon-style="duotone"></ui-icon>
                            <span>Style</span>
                        </button>
                        <button class="view-viewer__btn" data-action="open" type="button" title="Open file">
                            <ui-icon icon="folder-open" icon-style="duotone"></ui-icon>
                            <span>Open</span>
                        </button>
                        <button class="view-viewer__btn" data-action="copy-rendered" type="button" title="Copy rendered text">
                            <ui-icon icon="text-t" icon-style="duotone"></ui-icon>
                            <span>Copy text</span>
                        </button>
                        <button class="view-viewer__btn" data-action="export-docx" type="button" title="Export as DOCX">
                            <ui-icon icon="file-doc" icon-style="duotone"></ui-icon>
                            <span>DOCX</span>
                        </button>
                        <button class="view-viewer__btn" data-action="print" type="button" title="Print content">
                            <ui-icon icon="printer" icon-style="duotone"></ui-icon>
                            <span>Print</span>
                        </button>
                    </div>
                </div>
                <div class="view-viewer__content" data-viewer-content>
                    <div class="markdown-body markdown-viewer-content result-content" data-render-target></div>
                    <pre class="markdown-viewer-raw" data-raw-target aria-label="Raw content" hidden></pre>
                </div>
            </div>
        ` as HTMLElement;

        // Get references to render and raw targets
        const renderTarget = this.element.querySelector("[data-render-target]") as HTMLElement | null;
        const rawTarget = this.element.querySelector("[data-raw-target]") as HTMLPreElement | null;

        // Setup event handlers
        this.setupEventHandlers(rawTarget || undefined);

        // Set initial content
        if (renderTarget && rawTarget) {
            this.renderMarkdown(this.contentRef.value, renderTarget, rawTarget);
        }

        // Setup reactive updates
        affected(this.contentRef, () => {
            if (renderTarget && rawTarget) {
                this.renderMarkdown(this.contentRef.value, renderTarget, rawTarget);
            }
            this.saveState();
        });

        return this.element;
    }

    getToolbar(): HTMLElement | null {
        // The viewer has its own embedded toolbar
        // Return null to not use shell's toolbar slot
        return null;
    }

    /**
     * Update the displayed content
     */
    setContent(content: string, filename?: string, source?: string | null): void {
        this.contentRef.value = content;
        if (filename) {
            this.options.filename = filename;
        }
        if (source !== undefined) {
            this.sourceUrl = this.normalizeSourceUrl(source);
            this.options.source = source || undefined;
        }
    }

    /**
     * Get current content
     */
    getContent(): string {
        return this.contentRef.value;
    }

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

    private renderMarkdown(content: string, renderTarget: HTMLElement, rawTarget: HTMLPreElement): void {
        if (!renderTarget) return;

        const looksLikeHtmlDocument = (text: string): boolean => {
            const t = (text || "").trimStart().toLowerCase();
            if (t.startsWith("<!doctype html")) return true;
            if (t.startsWith("<html")) return true;
            if (t.startsWith("<head")) return true;
            if (t.startsWith("<body")) return true;
            if (t.startsWith("<?xml") && t.includes("<html")) return true;
            return false;
        };

        const endBusy = (): void => {
            renderTarget.removeAttribute("aria-busy");
            renderTarget.removeAttribute("data-md-state");
        };

        // Update raw view (sync; cheap path for "see source immediately")
        if (rawTarget) {
            rawTarget.textContent = content || "";
        }

        // Auto-switch to raw if it looks like HTML
        const container = this.element?.querySelector(".view-viewer__content");
        if (container && looksLikeHtmlDocument(content || "")) {
            container.toggleAttribute("data-raw", true);
            if (rawTarget) rawTarget.hidden = false;
            renderTarget.hidden = true;
            endBusy();
            return;
        }

        if (container) {
            container.removeAttribute("data-raw");
        }
        renderTarget.hidden = false;
        if (rawTarget) rawTarget.hidden = true;

        // Paint a placeholder first, then do plugin work + marked off the critical stack.
        renderTarget.setAttribute("aria-busy", "true");
        renderTarget.setAttribute("data-md-state", "preparing");
        renderTarget.innerHTML = `<div class="view-viewer__md-loading" role="status">Rendering preview…</div>`;

        queueMicrotask(() => {
            try {
                const handleParsed = (html: string) => {
                    const sanitized = DOMPurify?.sanitize?.((html || "")?.trim?.() || "", SANITIZE_OPTIONS) || "";
                    renderTarget.innerHTML = sanitized;
                    this.resolveRelativeResourceUrls(renderTarget);
                    this.applyRenderedLinkBehavior(renderTarget);
                    endBusy();
                    console.log("[ViewerView] Markdown rendered successfully");
                };

                const handleError = (error: unknown) => {
                    console.error("[ViewerView] Error rendering markdown:", error);
                    renderTarget.innerHTML = `<div style="color: red; padding: 1rem; background: #fee; border: 1px solid #fcc; border-radius: 4px;">Error parsing markdown: ${(error as any)?.message}</div>`;
                    endBusy();
                };

                const pluginProcessed = this.applyMarkdownPlugins((content || "")?.trim?.() || "");
                const processedContent = this.applyCustomMarkdownExtensions(pluginProcessed);
                getMarkedParser()
                    .then((parse) => parse(processedContent))
                    .then(handleParsed)
                    .catch(handleError);
            } catch (error) {
                console.error("[ViewerView] Error rendering markdown:", error);
                renderTarget.innerHTML = `<div style="color: red; padding: 1rem; background: #fee; border: 1px solid #fcc; border-radius: 4px;">Error parsing markdown: ${(error as any)?.message}</div>`;
                endBusy();
            }
        });
    }

    private normalizeSourceUrl(source?: string | null): string | null {
        const raw = (source || "").trim();
        if (!raw) return null;
        try {
            return new URL(raw, globalThis.location.href).toString();
        } catch {
            return null;
        }
    }

    private isUnsafeProtocol(value: string): boolean {
        return /^(?:javascript|vbscript|data:text\/html)/i.test((value || "").trim());
    }

    private resolveUrlAgainstSource(rawValue: string): string | null {
        const value = (rawValue || "").trim();
        if (!value) return null;
        if (value.startsWith("#")) return value;
        if (this.isUnsafeProtocol(value)) return null;

        const hasScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(value);
        if (hasScheme || value.startsWith("//")) {
            try {
                return new URL(value, globalThis.location.href).toString();
            } catch {
                return value;
            }
        }

        if (!this.sourceUrl) {
            return value;
        }

        try {
            return new URL(value, this.sourceUrl).toString();
        } catch {
            return value;
        }
    }

    private resolveRelativeResourceUrls(root: HTMLElement): void {
        const apply = (selector: string, attr: "src" | "href") => {
            const nodes = Array.from(root.querySelectorAll(selector)) as HTMLElement[];
            for (const node of nodes) {
                const current = (node.getAttribute(attr) || "").trim();
                if (!current) continue;
                const resolved = this.resolveUrlAgainstSource(current);
                if (!resolved) {
                    node.removeAttribute(attr);
                    continue;
                }
                if (resolved !== current) node.setAttribute(attr, resolved);
            }
        };

        apply("img[src]", "src");
        apply("source[src]", "src");
        apply("a[href]", "href");
    }

    private isLikelyMarkdownUrl(value: string): boolean {
        const raw = (value || "").trim();
        if (!raw) return false;
        const noHash = raw.split("#")[0];
        const noQuery = noHash.split("?")[0];
        return /\.(?:md|markdown|mdown|mkd|mkdn|mdtxt|mdtext)$/i.test(noQuery);
    }

    private isLikelyBinaryAssetUrl(value: string): boolean {
        const raw = (value || "").trim();
        if (!raw) return false;
        const noHash = raw.split("#")[0];
        const noQuery = noHash.split("?")[0];
        return /\.(?:png|jpe?g|gif|webp|bmp|svg|ico|pdf|zip|rar|7z|gz|mp4|webm|mp3|wav|ogg|avi|mov)$/i.test(noQuery);
    }

    private async fetchMarkdownFromUrl(source: string): Promise<string | null> {
        const src = (source || "").trim();
        if (!src) return null;
        try {
            const response = await fetch(src, { credentials: "include", cache: "no-store" });
            if (!response.ok) return null;
            const text = await response.text();
            const lowered = (text || "").trimStart().toLowerCase();
            if (lowered.startsWith("<!doctype html") || lowered.startsWith("<html") || lowered.startsWith("<head") || lowered.startsWith("<body")) {
                return null;
            }
            return text;
        } catch (error) {
            console.warn("[ViewerView] Failed to load markdown URL:", error);
            return null;
        }
    }

    private async openMarkdownSource(source: string, filename?: string): Promise<boolean> {
        const renderTarget = this.element?.querySelector("[data-render-target]") as HTMLElement | null;
        if (renderTarget) {
            renderTarget.setAttribute("aria-busy", "true");
            renderTarget.setAttribute("data-md-state", "fetching");
            renderTarget.innerHTML = `<div class="view-viewer__md-loading" role="status">Loading document…</div>`;
        }

        const normalizedSource = this.normalizeSourceUrl(source);
        if (!normalizedSource) return false;
        const markdown = await this.fetchMarkdownFromUrl(normalizedSource);
        if (markdown === null) return false;
        this.setContent(markdown, filename, normalizedSource);
        this.showMessage(filename ? `Opened ${filename}` : "Opened markdown link");
        return true;
    }

    private setupEventHandlers(rawElement?: HTMLPreElement): void {
        if (!this.element) return;

        const toolbar = this.element.querySelector("[data-viewer-toolbar]");
        const content = this.element.querySelector("[data-viewer-content]");
        const renderTarget = this.element.querySelector("[data-render-target]") as HTMLElement | null;

        let showRaw = false;

        toolbar?.addEventListener("click", (e) => {
            const target = e.target as HTMLElement;
            const button = target.closest("[data-action]") as HTMLButtonElement | null;
            if (!button) return;

            const action = button.dataset.action;
            switch (action) {
                case "open":
                    this.handleOpen();
                    break;
                case "copy":
                    this.handleCopy();
                    break;
                case "toggle-raw":
                    showRaw = !showRaw;
                    if (renderTarget) renderTarget.hidden = showRaw;
                    if (rawElement) rawElement.hidden = !showRaw;
                    content?.toggleAttribute("data-raw", showRaw);
                    break;
                case "copy-rendered":
                    if (renderTarget) {
                        void this.handleCopyRendered(renderTarget);
                    }
                    break;
                case "download":
                    this.handleDownload();
                    break;
                case "export-docx":
                    void this.handleExportDocx();
                    break;
                case "print":
                    if (renderTarget) {
                        this.handlePrint(renderTarget);
                    }
                    break;
                case "open-style-settings":
                    this.handleOpenStyleSettings();
                    break;
                case "attach":
                    this.handleAttachToWorkCenter();
                    break;
            }
        });

        // Setup drag and drop
        if (content) {
            content.addEventListener("mouseenter", () => {
                this.isPointerInView = true;
            });

            content.addEventListener("mouseleave", () => {
                this.isPointerInView = false;
            });

            content.addEventListener("dragover", (e) => {
                e.preventDefault();
                (e.currentTarget as HTMLElement).classList.add("dragover");
            });

            content.addEventListener("dragleave", () => {
                (content as HTMLElement).classList.remove("dragover");
            });

            content.addEventListener("drop", (e) => {
                e.preventDefault();
                (content as HTMLElement).classList.remove("dragover");
                this.handleFileDrop(e as DragEvent);
            });
        }

        // Setup paste handling
        this.pasteController?.abort();
        this.pasteController = new AbortController();
        document.addEventListener("paste", (e) => {
            void this.handlePaste(e as ClipboardEvent);
        }, { signal: this.pasteController.signal });

        renderTarget?.addEventListener("click", (e) => {
            const target = e.target as HTMLElement | null;
            const link = target?.closest?.("a[href]") as HTMLAnchorElement | null;
            if (!link) return;

            const href = (link.getAttribute("href") || "").trim();
            if (!href || href.startsWith("#")) return;
            if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || (e as MouseEvent).button !== 0) return;

            const resolved = this.resolveUrlAgainstSource(href);
            if (!resolved) return;

            const rawLinkLooksRelative = !/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(href) && !href.startsWith("//");
            const shouldOpenAsMarkdown =
                this.isLikelyMarkdownUrl(resolved) ||
                (rawLinkLooksRelative && !this.isLikelyBinaryAssetUrl(resolved));
            if (!shouldOpenAsMarkdown) return;

            e.preventDefault();
            void this.openMarkdownSource(resolved).then((ok) => {
                if (!ok) {
                    this.showMessage("Failed to open markdown link");
                }
            });
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
                    this.setContent(content, file.name, null);
                    this.showMessage(`Opened ${file.name}`);
                } catch (error) {
                    console.error("[ViewerView] Failed to read file:", error);
                    this.showMessage("Failed to read file");
                }
            }
        };
        input.click();
    }

    private async handleCopy(): Promise<void> {
        try {
            const result = await writeClipboardText(this.contentRef.value);
            if (!result.ok) throw new Error(result.error || "Clipboard write failed");
            this.showMessage("Copied raw content to clipboard");
            this.options.onCopy?.(this.contentRef.value);
        } catch (error) {
            console.error("[ViewerView] Failed to copy:", error);
            this.showMessage("Failed to copy to clipboard");
        }
    }

    private async handleCopyRendered(renderTarget: HTMLElement): Promise<void> {
        const text = (renderTarget?.innerText || "").trim();
        if (!text) {
            this.showMessage("No content to copy");
            return;
        }
        try {
            const result = await writeClipboardText(text);
            if (!result.ok) throw new Error(result.error || "Clipboard write failed");
            this.showMessage("Copied rendered text to clipboard");
        } catch {
            this.showMessage("Failed to copy rendered text");
        }
    }

    private handleDownload(): void {
        const content = this.contentRef.value;
        const filename = this.options.filename || `document-${Date.now()}.md`;

        const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();

        setTimeout(() => URL.revokeObjectURL(url), 250);

        this.showMessage(`Downloaded ${filename}`);
        this.options.onDownload?.(content, filename);
    }

    private async handleExportDocx(): Promise<void> {
        const content = this.contentRef.value;
        if (!content.trim()) {
            this.showMessage("No content to export");
            return;
        }
        try {
            const { downloadMarkdownAsDocx } = await import("../../../core/document/DocxExport");
            await downloadMarkdownAsDocx(content, {
                title: this.options.filename || "Markdown Content",
                filename: `document-${Date.now()}.docx`,
            });
            this.showMessage("Exported as DOCX successfully");
        } catch (error) {
            console.error("[ViewerView] Failed to export DOCX:", error);
            this.showMessage("Failed to export as DOCX");
        }
    }

    private handlePrint(renderTarget: HTMLElement): void {
        try {
            const rawTarget = this.element?.querySelector("[data-raw-target]") as HTMLPreElement | null;
            const isRawVisible = Boolean(rawTarget && !rawTarget.hidden);
            const printTarget = isRawVisible ? rawTarget : renderTarget;

            if (!printTarget || !(printTarget.textContent || "").trim()) {
                this.showMessage("No content to print");
                return;
            }

            printTarget.setAttribute("data-print", "true");
            globalThis?.print?.();
            setTimeout(() => {
                printTarget.removeAttribute("data-print");
            }, 1000);

            this.options.onPrint?.(this.contentRef.value);
        } catch (error) {
            console.error("[ViewerView] Error printing content:", error);
            this.showMessage("Failed to print");
        }
    }

    private handleAttachToWorkCenter(): void {
        this.options.onAttachToWorkCenter?.(this.contentRef.value);
        this.shellContext?.navigate("workcenter");
        this.showMessage("Content attached to Work Center");
    }

    private handleOpenStyleSettings(): void {
        try {
            this.shellContext?.navigate("settings", {
                tab: "markdown",
                focus: "style"
            });
            this.showMessage("Opened Markdown style settings");
        } catch (error) {
            console.warn("[Viewer] Failed to open style settings:", error);
            this.showMessage("Failed to open style settings");
        }
    }

    private handleFileDrop(e: DragEvent): void {
        const file = e.dataTransfer?.files?.[0];
        if (file && (file.type.includes("text") || file.name.endsWith(".md"))) {
            file.text().then(content => {
                this.setContent(content);
                this.showMessage(`Loaded ${file.name}`);
            }).catch(() => {
                this.showMessage("Failed to read dropped file");
            });
        }
    }

    private async handlePaste(e: ClipboardEvent): Promise<void> {
        if (!this.shouldHandlePaste(e)) return;
        if (!e.clipboardData) return;

        const itemFiles = Array.from(e.clipboardData.items || [])
            .map((item) => item.kind === "file" && item.getAsFile ? item.getAsFile() : null)
            .filter((file): file is File => !!file);
        const files = itemFiles.length > 0 ? itemFiles : Array.from(e.clipboardData.files || []);

        if (files.length > 0) {
            const textFile = files.find((file) => this.isTextLikeFile(file)) || files[0];
            e.preventDefault();
            e.stopPropagation();
            try {
                if (!this.isTextLikeFile(textFile)) {
                    this.showMessage(`Unsupported file type for viewer: ${textFile.name || textFile.type || "binary file"}`);
                    return;
                }
                const content = await textFile.text();
                this.setContent(content, textFile.name);
                this.showMessage(`Opened ${textFile.name || "pasted document"}`);
                return;
            } catch (error) {
                console.error("[ViewerView] Failed to read pasted file:", error);
                this.showMessage("Failed to read pasted file");
                return;
            }
        }

        const text = e.clipboardData.getData("text/plain");
        if (!text || !text.trim()) return;

        e.preventDefault();
        e.stopPropagation();

        try {
            const raw = text.trim();
            if (parseDataUrl(raw) || isBase64Like(raw)) {
                const asset = await normalizeDataAsset(raw, {
                    namePrefix: "pasted-doc",
                    uriComponent: true
                });
                if (!this.isTextLikeFile(asset.file)) {
                    this.showMessage("Pasted data is not a text/markdown document");
                    return;
                }
                const content = await asset.file.text();
                this.setContent(content, asset.file.name, null);
                this.showMessage("Opened pasted encoded document");
                return;
            }

            this.setContent(raw, undefined, null);
            this.showMessage("Content pasted");
        } catch (error) {
            console.error("[ViewerView] Failed to process pasted data:", error);
            this.showMessage("Failed to process pasted content");
        }
    }

    private isTextLikeFile(file: File): boolean {
        const name = (file.name || "").toLowerCase();
        const type = (file.type || "").toLowerCase();

        if (!type || type.startsWith("text/")) return true;
        if (type.includes("markdown") || type.includes("json") || type.includes("xml")) return true;

        return [
            ".md",
            ".markdown",
            ".txt",
            ".json",
            ".xml",
            ".html",
            ".htm",
            ".css",
            ".js",
            ".ts",
            ".tsx",
            ".yml",
            ".yaml"
        ].some((ext) => name.endsWith(ext));
    }

    private shouldHandlePaste(e: ClipboardEvent): boolean {
        if (!this.element || !this.isViewVisible) return false;
        if (document.visibilityState !== "visible") return false;
        if (this.shellContext?.navigationState?.currentView && this.shellContext.navigationState.currentView !== this.id) return false;

        const target = e.target as HTMLElement | null;
        if (!target) return false;

        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
            return false;
        }

        const hasFocusWithinView = this.element.contains(document.activeElement);
        const targetInView = this.element.contains(target);
        const hoverWithinView = this.isPointerInView || this.element.matches(":hover");

        return targetInView || hasFocusWithinView || hoverWithinView;
    }

    private saveState(): void {
        this.stateManager.save({
            content: this.contentRef.value,
            filename: this.options.filename
        });
    }

    private showMessage(message: string): void {
        if (this.shellContext) {
            this.shellContext.showMessage(message);
        } else {
            console.log(`[Viewer] ${message}`);
        }
    }

    private normalizeMarkdownExtensionFlags(rawFlags?: string): string {
        const normalized = (rawFlags || DEFAULT_MARKDOWN_EXTENSION_FLAGS)
            .split("")
            .filter((flag, index, array) =>
                /[dgimsuvy]/.test(flag) && array.indexOf(flag) === index)
            .join("");
        return normalized || DEFAULT_MARKDOWN_EXTENSION_FLAGS;
    }

    private applyCustomMarkdownExtensions(markdown: string): string {
        const source = markdown || "";
        const rules = Array.isArray(this.markdownSettings.extensions)
            ? this.markdownSettings.extensions
            : [];
        if (rules.length === 0 || !source) return source;

        let result = source;
        for (const rule of rules) {
            if (!rule || rule.enabled === false) continue;
            const pattern = (rule.pattern || "").trim();
            if (!pattern) continue;
            try {
                const regex = new RegExp(pattern, this.normalizeMarkdownExtensionFlags(rule.flags));
                result = result.replace(regex, rule.replacement ?? "");
            } catch (error) {
                console.warn("[Viewer] Skipping invalid markdown extension rule:", {
                    id: rule.id,
                    pattern,
                    flags: rule.flags,
                    error
                });
            }
        }
        return result;
    }

    private applyMarkdownPlugins(markdown: string): string {
        let result = markdown || "";
        if (!result) return result;

        if (this.markdownSettings.plugins.smartTypography) {
            result = result
                .replace(/\.\.\./g, "&hellip;")
                .replace(/(^|[^\-])---([^\-]|$)/g, "$1&mdash;$2")
                .replace(/(^|[^\-])--([^\-]|$)/g, "$1&ndash;$2");
        }

        if (this.markdownSettings.plugins.softBreaksAsBr) {
            result = result.replace(/([^\n])\n(?!\n)/g, "$1  \n");
        }

        return result;
    }

    private getFontFamilyFromPreset(): string {
        const preset = this.markdownSettings.fontFamily;
        if (preset === "serif") return "Georgia, Cambria, 'Times New Roman', Times, serif";
        if (preset === "mono") return "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace";
        if (preset === "sans") return "Inter, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
        return "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
    }

    private applyRenderedLinkBehavior(root: HTMLElement): void {
        const links = Array.from(root.querySelectorAll("a[href]")) as HTMLAnchorElement[];
        for (const link of links) {
            const href = (link.getAttribute("href") || "").trim();
            if (!href) continue;
            const isHash = href.startsWith("#");
            const isExternal = /^(https?:)?\/\//i.test(href);
            if (this.markdownSettings.plugins.externalLinksNewTab && isExternal && !isHash) {
                link.target = "_blank";
                link.rel = "noopener noreferrer";
            } else {
                if (link.target === "_blank") link.removeAttribute("target");
                if (link.rel === "noopener noreferrer") link.removeAttribute("rel");
            }
        }
    }

    private createLayerBlock(layerName: string, cssText: string): string {
        const body = (cssText || "").trim();
        if (!body) return "";
        return `@layer ${layerName} {\n${body}\n}`;
    }

    private normalizeUserCssForLayer(layerName: string, cssText: string): string {
        const trimmed = (cssText || "").trim();
        if (!trimmed) return "";
        if (trimmed.startsWith("@layer")) return trimmed;
        return this.createLayerBlock(layerName, trimmed);
    }

    private getPresetVariablesCss(): string {
        const preset = this.markdownSettings.preset;
        if (preset === "classic") {
            return `
                --md-letter-spacing: 0;
                --md-h1-size: 2.05em;
                --md-h2-size: 1.65em;
                --md-p-margin: 1.05em;
            `;
        }
        if (preset === "compact") {
            return `
                --md-letter-spacing: -0.01em;
                --md-h1-size: 1.8em;
                --md-h2-size: 1.45em;
                --md-p-margin: 0.72em;
            `;
        }
        if (preset === "paper") {
            return `
                --md-letter-spacing: 0.005em;
                --md-h1-size: 2em;
                --md-h2-size: 1.6em;
                --md-p-margin: 0.95em;
            `;
        }
        return `
            --md-letter-spacing: 0;
            --md-h1-size: 1.95em;
            --md-h2-size: 1.55em;
            --md-p-margin: 0.9em;
        `;
    }

    private buildCustomStyleText(): string {
        const pageSize = this.markdownSettings.page.size || "auto";
        const pageOrientation = this.markdownSettings.page.orientation || "portrait";
        const pageMargin = Number.isFinite(this.markdownSettings.page.marginMm)
            ? Math.max(5, Math.min(40, this.markdownSettings.page.marginMm))
            : 12;
        const printScale = Number.isFinite(this.markdownSettings.printScale)
            ? Math.max(0.5, Math.min(1.5, this.markdownSettings.printScale))
            : 1;
        const fontSizePx = Number.isFinite(this.markdownSettings.fontSizePx)
            ? Math.max(12, Math.min(26, this.markdownSettings.fontSizePx))
            : 16;
        const lineHeight = Number.isFinite(this.markdownSettings.lineHeight)
            ? Math.max(1.1, Math.min(2.2, this.markdownSettings.lineHeight))
            : 1.7;
        const maxWidth = Number.isFinite(this.markdownSettings.contentMaxWidthPx)
            ? Math.max(500, Math.min(1400, this.markdownSettings.contentMaxWidthPx))
            : 860;

        const systemCss = `
            .view-viewer .markdown-viewer-content {
                font-family: ${this.getFontFamilyFromPreset()};
                font-size: ${fontSizePx}px;
                line-height: ${lineHeight};
                letter-spacing: var(--md-letter-spacing, 0);
                max-width: ${maxWidth}px;
                margin-inline: auto;
                padding: 1rem 1.1rem 3rem;
            }

            .view-viewer .markdown-viewer-content h1 { font-size: var(--md-h1-size, 1.95em); }
            .view-viewer .markdown-viewer-content h2 { font-size: var(--md-h2-size, 1.55em); }
            .view-viewer .markdown-viewer-content p,
            .view-viewer .markdown-viewer-content li {
                margin-block: var(--md-p-margin, 0.9em);
            }

            .view-viewer .markdown-viewer-content {
                ${this.getPresetVariablesCss()}
            }
        `;

        const modulesCss = `
            ${this.markdownSettings.modules.typography ? "" : `
            .view-viewer .markdown-viewer-content p,
            .view-viewer .markdown-viewer-content li {
                margin-block: 0.35em;
            }
            .view-viewer .markdown-viewer-content h1,
            .view-viewer .markdown-viewer-content h2,
            .view-viewer .markdown-viewer-content h3 {
                margin-block: 0.45em;
            }`}

            ${this.markdownSettings.modules.codeBlocks ? `
            .view-viewer .markdown-viewer-content pre {
                border-radius: 10px;
                padding: 0.8rem 1rem;
                overflow-x: auto;
            }
            .view-viewer .markdown-viewer-content code {
                font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
                font-size: 0.92em;
            }` : ""}

            ${this.markdownSettings.modules.tables ? `
            .view-viewer .markdown-viewer-content table {
                inline-size: 100%;
                border-collapse: collapse;
                margin: 1rem 0;
            }
            .view-viewer .markdown-viewer-content th,
            .view-viewer .markdown-viewer-content td {
                border: 1px solid color-mix(in oklab, currentColor 18%, transparent);
                padding: 0.45rem 0.6rem;
                text-align: left;
                vertical-align: top;
            }` : ""}

            ${this.markdownSettings.modules.blockquotes ? `
            .view-viewer .markdown-viewer-content blockquote {
                border-inline-start: 4px solid color-mix(in oklab, currentColor 30%, transparent);
                padding-inline: 1rem;
                margin-inline: 0;
            }` : ""}

            ${this.markdownSettings.modules.media ? `
            .view-viewer .markdown-viewer-content img,
            .view-viewer .markdown-viewer-content video {
                max-inline-size: 100%;
                border-radius: 8px;
                display: block;
                margin-inline: auto;
            }` : ""}
        `;

        const builtInPrintCss = `
            @media print {
                .view-viewer .markdown-viewer-content {
                    zoom: ${printScale};
                }
                ${this.markdownSettings.modules.printBreaks ? `
                .view-viewer .markdown-viewer-content h1,
                .view-viewer .markdown-viewer-content h2,
                .view-viewer .markdown-viewer-content h3 {
                    break-after: avoid-page;
                    break-inside: avoid;
                }
                .view-viewer .markdown-viewer-content pre,
                .view-viewer .markdown-viewer-content table,
                .view-viewer .markdown-viewer-content blockquote {
                    break-inside: avoid;
                }` : ""}
            }
        `;

        const screenCss = [this.userStyleModules.screenCss, (this.markdownSettings.customCss || "").trim()]
            .map((value) => (value || "").trim())
            .filter(Boolean)
            .join("\n\n");
        const userPrintCss = [this.userStyleModules.printCss, (this.markdownSettings.printCss || "").trim()]
            .map((value) => (value || "").trim())
            .filter(Boolean)
            .join("\n\n");
        const pageCss = pageSize !== "auto"
            ? `@page { size: ${pageSize} ${pageOrientation}; margin: ${pageMargin}mm; }`
            : "";

        const chunks: string[] = [
            `@layer ${VIEWER_CSS_LAYER_ORDER.join(", ")};`,
            this.createLayerBlock("rs-md-system", systemCss),
            this.createLayerBlock("rs-md-modules", modulesCss),
            this.normalizeUserCssForLayer("rs-md-user", screenCss),
            this.createLayerBlock("rs-md-print", `${builtInPrintCss}\n${pageCss}`),
            this.normalizeUserCssForLayer(
                "rs-md-user-print",
                userPrintCss ? `@media print {\n${userPrintCss}\n}` : ""
            )
        ].filter(Boolean);

        return chunks.join("\n\n");
    }

    private async loadUserStyleModules(): Promise<void> {
        const result = { screenCss: "", printCss: "" };
        try {
            const dir = openDirectory(null, "/user/styles/", { create: true });
            await dir;
            const entries = await Array.fromAsync(dir.entries?.() ?? []);
            const names = entries
                .map((entry: any) => String(entry?.[0] || "").trim())
                .filter((name) => !!name && name.toLowerCase().endsWith(".css"))
                .sort((a, b) => a.localeCompare(b));

            const screenChunks: string[] = [];
            const printChunks: string[] = [];
            for (const name of names) {
                const file = await provide(`/user/styles/${name}`).catch(() => null);
                const cssText = file ? await file.text().catch(() => "") : "";
                if (!cssText.trim()) continue;
                if (name.toLowerCase().endsWith(".print.css")) {
                    printChunks.push(`/* ${name} */\n${cssText}`);
                } else {
                    screenChunks.push(`/* ${name} */\n${cssText}`);
                }
            }

            result.screenCss = screenChunks.join("\n\n").trim();
            result.printCss = printChunks.join("\n\n").trim();
        } catch (error) {
            console.warn("[Viewer] Failed to load /user/styles modules:", error);
        }
        this.userStyleModules = result;
    }

    private applyCustomStyles(): void {
        if (this.customSheet) {
            removeAdopted(this.customSheet);
            this.customSheet = null;
        }

        const styleText = this.buildCustomStyleText();
        if (!styleText) return;

        try {
            this.customSheet = loadAsAdopted(styleText) as CSSStyleSheet;
        } catch (error) {
            console.warn("[Viewer] Failed to load custom markdown styles:", error);
            this.customSheet = null;
        }
    }

    private async loadMarkdownSettings(): Promise<void> {
        try {
            const settings = await loadSettings();
            const markdown = settings?.appearance?.markdown;
            this.markdownSettings = {
                preset: (markdown?.preset || "default") as ViewerMarkdownSettings["preset"],
                fontFamily: (markdown?.fontFamily || "system") as ViewerMarkdownSettings["fontFamily"],
                fontSizePx: Number(markdown?.fontSizePx ?? 16),
                lineHeight: Number(markdown?.lineHeight ?? 1.7),
                contentMaxWidthPx: Number(markdown?.contentMaxWidthPx ?? 860),
                printScale: Number(markdown?.printScale ?? 1),
                page: {
                    size: (markdown?.page?.size || "auto") as ViewerMarkdownSettings["page"]["size"],
                    orientation: (markdown?.page?.orientation || "portrait") as ViewerMarkdownSettings["page"]["orientation"],
                    marginMm: Number(markdown?.page?.marginMm ?? 12)
                },
                modules: {
                    typography: (markdown?.modules?.typography ?? true) !== false,
                    tables: (markdown?.modules?.tables ?? true) !== false,
                    codeBlocks: (markdown?.modules?.codeBlocks ?? true) !== false,
                    blockquotes: (markdown?.modules?.blockquotes ?? true) !== false,
                    media: (markdown?.modules?.media ?? true) !== false,
                    printBreaks: (markdown?.modules?.printBreaks ?? true) !== false
                },
                plugins: {
                    smartTypography: Boolean(markdown?.plugins?.smartTypography),
                    softBreaksAsBr: Boolean(markdown?.plugins?.softBreaksAsBr),
                    externalLinksNewTab: (markdown?.plugins?.externalLinksNewTab ?? true) !== false
                },
                customCss: (markdown?.customCss || "").trim(),
                printCss: (markdown?.printCss || "").trim(),
                extensions: Array.isArray(markdown?.extensions)
                    ? markdown.extensions
                    : []
            };
            await this.loadUserStyleModules();
            this.applyCustomStyles();
            this.onRefresh();
        } catch (error) {
            console.warn("[Viewer] Failed to load markdown settings:", error);
        }
    }

    // ========================================================================
    // LIFECYCLE METHODS
    // ========================================================================

    private onMount(): void {
        console.log("[Viewer] Mounted");
        this._sheet ??= loadAsAdopted(style) as CSSStyleSheet;
        this.applyCustomStyles();
        void this.markdownSettingsPromise;
        this.isViewVisible = true;
    }

    private onUnmount(): void {
        console.log("[Viewer] Unmounting");
        this.saveState();
        this.isViewVisible = false;
        this.isPointerInView = false;
        this.pasteController?.abort();
        this.pasteController = null;
        if (this.customSheet) {
            removeAdopted(this.customSheet);
            this.customSheet = null;
        }
        removeAdopted(this._sheet!);
        this.element = null;
    }

    private onShow(): void {
        this._sheet ??= loadAsAdopted(style) as CSSStyleSheet;
        this.applyCustomStyles();
        this.markdownSettingsPromise = this.loadMarkdownSettings();
        this.isViewVisible = true;
        console.log("[Viewer] Shown");
    }

    private onHide(): void {
        //removeAdopted(this._sheet);
        this.saveState();
        this.isViewVisible = false;
        this.isPointerInView = false;
        console.log("[Viewer] Hidden");
    }

    private onRefresh(): void {
        const renderTarget = this.element?.querySelector("[data-render-target]") as HTMLElement | null;
        const rawTarget = this.element?.querySelector("[data-raw-target]") as HTMLPreElement | null;
        if (renderTarget && rawTarget) {
            this.renderMarkdown(this.contentRef.value, renderTarget, rawTarget);
        }
    }

    // ========================================================================
    // MESSAGE HANDLING
    // ========================================================================

    canHandleMessage(messageType: string): boolean {
        return ["content-view", "content-load", "markdown-content", "content-share", "share-target-input"].includes(messageType);
    }

    async handleMessage(message: unknown): Promise<void> {
        const msg = message as {
            type?: string;
            data?: {
                text?: string;
                content?: string;
                filename?: string;
                url?: string;
                source?: string;
                path?: string;
                src?: string;
                file?: File;
                files?: File[];
            };
        };

        if (msg.data?.text || msg.data?.content) {
            const content = msg.data.text || msg.data.content || "";
            const source = msg.data.source || msg.data.src || msg.data.path;
            this.setContent(content, msg.data.filename, source);
            return;
        }

        if (msg.data?.url) {
            const source = msg.data.source || msg.data.src || msg.data.path || msg.data.url;
            const opened = await this.openMarkdownSource(source, msg.data.filename);
            if (!opened) {
                const fallbackContent = `> Failed to load markdown from:\n> ${source}`;
                this.setContent(fallbackContent, msg.data.filename, source);
            }
            return;
        }

        const fileCandidate = (msg.data?.file instanceof File
            ? msg.data.file
            : (Array.isArray(msg.data?.files) ? msg.data?.files.find((f): f is File => f instanceof File) : null));
        if (fileCandidate) {
            try {
                const text = await fileCandidate.text();
                const source = msg.data?.source || msg.data?.src || msg.data?.path || fileCandidate.name;
                this.setContent(text || "", msg.data?.filename || fileCandidate.name, source);
            } catch (error) {
                console.warn("[Viewer] Failed to read markdown file payload:", error);
            }
        }
    }
}

// ============================================================================
// TYPE EXPORTS
// ============================================================================

/**
 * Document type for viewer (content + metadata)
 */
export interface ViewerDocument {
    content: string;
    filename?: string;
    mimeType?: string;
    lastModified?: number;
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a viewer view instance
 */
export function createView(options?: ViewerOptions): ViewerView {
    return new ViewerView(options);
}

/** Alias for createView */
export const createMarkdownView = createView;

export default createView;

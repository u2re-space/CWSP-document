/**
 * Markdown Viewer View
 *
 * Shell-agnostic markdown viewer component.
 * **Standalone** `render()`: shell in light DOM (legacy editor preview).
 * **`cw-view-viewer` host** (`renderIntoWebComponentHost`): shadow = mount → shell → view-viewer (toolbar +
 *   `__content` wrapping `<slot name="raw">` + default `<slot>`); light DOM = `<pre slot="raw">` + prose `[data-render-target]`.
 */

import { H, normalizeDataAsset, parseDataUrl, isBase64Like, decodeBase64ToBytes, openDirectory, provide } from "fest/lure";
import { ref, affected } from "fest/object";
import { loadAsAdopted, removeAdopted } from "fest/dom";
import DOMPurify from 'dompurify';
import renderMathInElement from "katex/dist/contrib/auto-render.mjs";
import type { View, ViewOptions, ViewLifecycle, ShellContext } from "../../shells/types";
import type { CwViewViewerHostElement } from "../base/UIElement";
import type { BaseViewOptions } from "../types";
import { createViewState } from "../types";
import { writeText as writeClipboardText } from "@rs-core/modules/Clipboard";
import { loadSettings } from "@rs-com/config/Settings";
import type { MarkdownExtensionRule } from "@rs-com/config/SettingsTypes";

// Import fest/fl-ui (e.g. shared markdown utilities elsewhere)
import "fest/fl-ui";
import "fest/icon";

// @ts-ignore - SCSS import
import style from "./index.scss?inline";
import type { MarkedExtension } from "marked";
import { createViewerToolbar } from "./ts/toolbar";

let markedParserPromise: Promise<(markdown: string) => Promise<string>> | null = null;

const VIEWER_OUTLINE_SESSION_KEY = "rs-viewer-outline";


const MATH_DELIMITER_PATTERN = /\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|(?<!\$)\$[^$\n]+\$|\\\([\s\S]*?\\\)/;

/** KaTeX preprocess: keep markdown as text (not innerHTML) before auto-render — HTML parsing breaks `{`, `\\`, `<` in math. */
const VIEWER_MAX_KATEX_PREPROCESS_CHARS = 350_000;
/** Assigning multi‑MB strings to a <pre> synchronously freezes the tab; defer past this threshold. */
const VIEWER_RAW_TEXTCONTENT_DEFER_CHARS = 96_000;
/** Raw panel cap (content still fully in memory via ref; only DOM text is truncated). */
const VIEWER_RAW_DISPLAY_MAX_CHARS = 1_200_000;
/** Clipboard read / paste file construction — avoid reading multi‑MB blobs on the main thread. */
const VIEWER_CLIPBOARD_READ_TEXT_MAX_BYTES = 2 * 1024 * 1024;
/** `isBase64Like` / `parseDataUrl` on megabyte strings can stall; plain paste above this skips probe. */
const VIEWER_INGEST_BASE64_PROBE_MAX = 480_000;
/** `innerText` on a huge rendered DOM is extremely expensive. */
const VIEWER_MAX_RENDERED_COPY_CHARS = 600_000;
const FENCED_CODE_PATTERN = /(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2(?=\n|$)/g;
const INLINE_CODE_PATTERN = /`[^`\n]+`/g;
const SANITIZE_OPTIONS = {
    /** KaTeX `output: "mathml"` emits `<math>` + SVG; default DOMPurify HTML-only config strips them → raw LaTeX in the UI. */
    USE_PROFILES: { html: true, mathMl: true, svg: true },
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
        lists: boolean;
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
                    if (markdown.length > VIEWER_MAX_KATEX_PREPROCESS_CHARS) {
                        return markdown;
                    }
                    if (!MATH_DELIMITER_PATTERN.test(markdown)) {
                        return markdown;
                    }

                    const { masked, restore } = maskCodeSegments(markdown);
                    const katexNode = document.createElement("div");
                    // Text node only: innerHTML would parse `<`, `{`, `\\rightarrow`, etc. and corrupt LaTeX.
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
const DEFAULT_CONTENT = `# Welcome to the Viewer\n\nThis is a markdown viewer component.`;

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
    /** When mounted under `cw-view-viewer`, slotted raw/prose are light children of this host. */
    private slotProjectingHost: HTMLElement | null = null;
    private contentRef = ref("");
    private renderSeq = 0;
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
            lists: true,
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
    /** Table of contents for rendered markdown; persisted for the tab session. */
    private outlineVisible = false;

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
        this.applyRouteParams(options.params);
        this.markdownSettingsPromise = this.loadMarkdownSettings();
        try {
            this.outlineVisible = globalThis.sessionStorage?.getItem(VIEWER_OUTLINE_SESSION_KEY) === "1";
        } catch {
            this.outlineVisible = false;
        }

        // Load initial content
        const savedState = this.stateManager.load();
        this.contentRef.value = options.initialContent || savedState?.content || DEFAULT_CONTENT;
        if (!options.initialContent) {
            const fromParams = (options.params?.content || "").trim();
            if (fromParams) {
                this.contentRef.value = fromParams;
            }
        }
    }

    render(options?: ViewOptions): HTMLElement {
        this.slotProjectingHost = null;

        // Merge options
        if (options) {
            this.options = { ...this.options, ...options };
            this.shellContext = options.shellContext || this.shellContext;
            this.applyRouteParams(options.params);
        }

        // Load styles (idempotent — returns cached sheet)
        this._sheet = loadAsAdopted(style) as CSSStyleSheet;

        this.element = H`
            <div class="cw-view-viewer-shell">
                <div class="view-viewer">
                    ${createViewerToolbar()}
                    <div class="view-viewer__content" data-viewer-content>
                        <pre class="markdown-viewer-raw" data-raw-target aria-label="Raw content" hidden></pre>
                    </div>
                </div>
                <div
                    class="cw-view-viewer__prose markdown-body markdown-viewer-content result-content"
                    data-render-target
                    data-cw-viewer-prose
                ></div>
            </div>
        ` as HTMLElement;

        // Get references to render and raw targets
        const renderTarget = this.element.querySelector("[data-render-target]") as HTMLElement | null;
        const rawTarget = this.element.querySelector("[data-raw-target]") as HTMLPreElement | null;

        // Setup event handlers
        this.setupEventHandlers(rawTarget || undefined);
        this.syncOutlineToolbarState();

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

    /**
     * Mount under `<cw-view-viewer>`: chrome in shadow, raw + rendered bodies in light DOM (slotted).
     */
    renderIntoWebComponentHost(host: CwViewViewerHostElement, options?: ViewOptions): void {
        if (options) {
            this.options = { ...this.options, ...options };
            this.shellContext = options.shellContext || this.shellContext;
        }

        this.slotProjectingHost = host;
        this._sheet ??= loadAsAdopted(style) as CSSStyleSheet;

        let shadow = host.shadowRoot;
        if (!shadow) {
            shadow = host.attachShadow({ mode: "open" });
            const hostCss = document.createElement("style");
            hostCss.textContent = `
                :host {
                    display: block;
                    box-sizing: border-box;
                    block-size: 100%;
                    inline-size: 100%;
                    min-block-size: 0;
                    min-inline-size: 0;
                    overflow: hidden;
                }

                .cw-view-element__mount {
                    display: block;
                    box-sizing: border-box;
                    block-size: 100%;
                    inline-size: 100%;
                    min-block-size: 0;
                    min-inline-size: 0;
                    overflow: hidden;
                }

                .cw-view-viewer-shell,
                .view-viewer {
                    box-sizing: border-box;
                    block-size: 100%;
                    inline-size: 100%;
                    min-block-size: 0;
                    min-inline-size: 0;
                }
            `;
            shadow.appendChild(hostCss);

            const mount = document.createElement("div");
            mount.className = "cw-view-element__mount";
            const shell = document.createElement("div");
            shell.className = "cw-view-viewer-shell";
            const viewViewer = this.buildViewViewerChromeForShadow();
            shell.append(viewViewer);
            mount.appendChild(shell);
            shadow.appendChild(mount);
            this.adoptViewerStylesIntoShadowRoot(shadow);
        }

        this.element = shadow!.querySelector(".cw-view-viewer-shell") as HTMLElement;

        let pre = host.querySelector(":scope > pre[data-raw-target]") as HTMLPreElement | null;
        let prose = host.querySelector(":scope > [data-render-target]") as HTMLElement | null;
        if (!pre) {
            pre = document.createElement("pre");
            pre.className = "markdown-viewer-raw";
            pre.setAttribute("data-raw-target", "");
            pre.setAttribute("aria-label", "Raw content");
            pre.slot = "raw";
        } else if (!pre.slot) {
            pre.slot = "raw";
        }
        if (!prose) {
            prose = document.createElement("div");
            prose.className = "cw-view-viewer__prose markdown-body markdown-viewer-content result-content";
            prose.toggleAttribute("data-render-target", true);
            prose.toggleAttribute("data-cw-viewer-prose", true);
        }
        host.replaceChildren(pre, prose);

        this.syncAdoptedSheetsToShadow();

        const renderTarget = prose;
        const rawTarget = pre;
        this.setupEventHandlers(rawTarget);
        this.syncOutlineToolbarState();

        if (renderTarget && rawTarget) {
            this.renderMarkdown(this.contentRef.value, renderTarget, rawTarget);
        }

        affected(this.contentRef, () => {
            if (renderTarget && rawTarget) {
                this.renderMarkdown(this.contentRef.value, renderTarget, rawTarget);
            }
            this.saveState();
        });
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

    private buildViewViewerChromeForShadow(): HTMLElement {
        return H`
            <div class="view-viewer">
                ${createViewerToolbar()}
                <div class="view-viewer__content" data-viewer-content>
                    <div class="cw-view-viewer__slot-raw">
                        <slot name="raw"></slot>
                    </div>
                    <div class="cw-view-viewer__slot-default">
                        <slot></slot>
                    </div>
                </div>
            </div>
        ` as HTMLElement;
    }

    private adoptViewerStylesIntoShadowRoot(shadow: ShadowRoot): void {
        const sheet = this._sheet as CSSStyleSheet | null;
        if (!sheet || typeof shadow.adoptedStyleSheets === "undefined") return;
        if (!shadow.adoptedStyleSheets.includes(sheet)) {
            shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sheet];
        }
    }

    private syncAdoptedSheetsToShadow(): void {
        const shadow = this.slotProjectingHost?.shadowRoot;
        if (!shadow || typeof shadow.adoptedStyleSheets === "undefined") return;
        const push = (s: CSSStyleSheet | null | undefined) => {
            if (!s) return;
            if (!shadow!.adoptedStyleSheets.includes(s)) {
                shadow!.adoptedStyleSheets = [...shadow!.adoptedStyleSheets, s];
            }
        };
        push(this._sheet as CSSStyleSheet | null);
        push(this.customSheet ?? null);
    }

    private queryViewerSlotted(sel: string): HTMLElement | null {
        const fromHost = this.slotProjectingHost?.querySelector(sel);
        if (fromHost) return fromHost as HTMLElement;
        return (this.element?.querySelector(sel) ?? null) as HTMLElement | null;
    }

    private viewBranchesContain(node: Node | null): boolean {
        if (!node) return false;
        if (this.slotProjectingHost?.contains(node)) return true;
        return Boolean(this.element?.contains(node));
    }

    private viewBranchesHover(): boolean {
        return (
            Boolean(this.slotProjectingHost?.matches(":hover")) ||
            Boolean(this.element?.matches(":hover"))
        );
    }

    /** Syncs raw/rendered layout: shell + content `data-raw` drives CSS (toolbar + raw vs slotted markdown). */
    private syncViewerRawMode(raw: boolean): void {
        const shell = this.element;
        if (!shell?.classList.contains("cw-view-viewer-shell")) return;
        shell.toggleAttribute("data-raw", raw);
        this.slotProjectingHost?.toggleAttribute("data-raw", raw);
        const content = shell.querySelector("[data-viewer-content]");
        if (raw) {
            content?.setAttribute("data-raw", "");
        } else {
            content?.removeAttribute("data-raw");
        }
    }

    private syncOutlineToolbarState(): void {
        const toolbar = this.element?.querySelector("[data-viewer-toolbar]");
        const btn = toolbar?.querySelector<HTMLButtonElement>('[data-action="toggle-outline"]');
        if (btn) {
            btn.setAttribute("aria-pressed", this.outlineVisible ? "true" : "false");
        }
    }

    private slugifyHeadingId(text: string, used: Set<string>): string {
        const base =
            (text || "")
                .trim()
                .toLowerCase()
                .replace(/\s+/g, "-")
                .replace(/[^a-z0-9\u00c0-\u024f-]+/gi, "-")
                .replace(/^-+|-+$/g, "") || "section";
        let id = base;
        let n = 0;
        while (used.has(id)) {
            n += 1;
            id = `${base}-${n}`;
        }
        used.add(id);
        return id;
    }

    private refreshDocumentOutline(nav: HTMLElement, proseRoot: HTMLElement): void {
        nav.hidden = !this.outlineVisible;
        nav.innerHTML = "";
        if (!this.outlineVisible) return;

        const headings = Array.from(proseRoot.querySelectorAll("h1,h2,h3,h4,h5,h6")) as HTMLElement[];
        if (headings.length === 0) {
            nav.innerHTML = `<div class="view-viewer__outline-empty" role="status">No headings in document</div>`;
            return;
        }

        const used = new Set<string>();
        const list = document.createElement("ul");
        list.className = "view-viewer__outline-list";

        for (const h of headings) {
            let id = (h.id || "").trim();
            if (!id) {
                id = this.slugifyHeadingId(h.textContent || "", used);
                h.id = id;
            } else {
                used.add(id);
            }
            const li = document.createElement("li");
            li.className = `view-viewer__outline-item view-viewer__outline--h${h.tagName.slice(1)}`;
            const a = document.createElement("a");
            a.href = `#${id}`;
            a.textContent = (h.textContent || "").trim() || id;
            li.appendChild(a);
            list.appendChild(li);
        }
        nav.appendChild(list);
    }

    private setOutlineVisible(visible: boolean): void {
        this.outlineVisible = visible;
        try {
            if (visible) {
                globalThis.sessionStorage?.setItem(VIEWER_OUTLINE_SESSION_KEY, "1");
            } else {
                globalThis.sessionStorage?.removeItem(VIEWER_OUTLINE_SESSION_KEY);
            }
        } catch {
            /* ignore */
        }
        const renderTarget = this.queryViewerSlotted("[data-render-target]");
        if (renderTarget) {
            const nav = renderTarget.querySelector(":scope > nav.view-viewer__outline") as HTMLElement | null;
            const root = renderTarget.querySelector(":scope > .view-viewer__md-root") as HTMLElement | null;
            if (nav && root) {
                this.refreshDocumentOutline(nav, root);
            } else if (nav) {
                nav.hidden = !visible;
            }
        }
        this.syncOutlineToolbarState();
    }

    private renderMarkdown(content: string, renderTarget: HTMLElement, rawTarget: HTMLPreElement): void {
        if (!renderTarget) return;
        const seq = ++this.renderSeq;

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
            if (seq !== this.renderSeq) return;
            renderTarget.removeAttribute("aria-busy");
            renderTarget.removeAttribute("data-md-state");
        };

        // Raw source: huge strings synchronously block layout; defer and cap DOM text.
        if (rawTarget) {
            const c = content || "";
            const assignRaw = (): void => {
                if (seq !== this.renderSeq) return;
                if (c.length > VIEWER_RAW_DISPLAY_MAX_CHARS) {
                    rawTarget.textContent =
                        `${c.slice(0, VIEWER_RAW_DISPLAY_MAX_CHARS)}\n\n… [truncated — open in editor for full source]`;
                } else {
                    rawTarget.textContent = c;
                }
            };
            if (c.length > VIEWER_RAW_TEXTCONTENT_DEFER_CHARS) {
                globalThis.setTimeout(assignRaw, 0);
            } else {
                assignRaw();
            }
        }

        // Fast path: empty/whitespace content should never run marked/DOMPurify (avoids hangs + flicker).
        const normalized = String(content ?? "");
        if (!normalized.trim()) {
            if (seq !== this.renderSeq) return;
            this.syncViewerRawMode(false);
            renderTarget.hidden = false;
            if (rawTarget) rawTarget.hidden = true;
            renderTarget.removeAttribute("aria-busy");
            renderTarget.setAttribute("data-md-state", "empty");
            renderTarget.innerHTML =
                `<div class="view-viewer__md-empty" role="status">Empty document</div>`;
            return;
        }

        // Auto-switch to raw if it looks like HTML
        const container = this.element?.querySelector(".view-viewer__content");
        if (container && looksLikeHtmlDocument(content || "")) {
            this.syncViewerRawMode(true);
            if (rawTarget) rawTarget.hidden = false;
            renderTarget.hidden = true;
            endBusy();
            return;
        }

        this.syncViewerRawMode(false);
        renderTarget.hidden = false;
        if (rawTarget) rawTarget.hidden = true;

        // Paint a placeholder first, then do plugin work + marked off the critical stack.
        renderTarget.setAttribute("aria-busy", "true");
        renderTarget.setAttribute("data-md-state", "preparing");
        renderTarget.innerHTML = `<div class="view-viewer__md-loading" role="status">Rendering preview…</div>`;

        queueMicrotask(() => {
            if (seq !== this.renderSeq) return;
            try {
                const handleParsed = (html: string) => {
                    if (seq !== this.renderSeq) return;
                    const sanitized = DOMPurify?.sanitize?.((html || "")?.trim?.() || "", SANITIZE_OPTIONS) || "";
                    renderTarget.replaceChildren();
                    const outlineNav = document.createElement("nav");
                    outlineNav.className = "view-viewer__outline";
                    outlineNav.setAttribute("aria-label", "Document outline");
                    const mdRoot = document.createElement("div");
                    mdRoot.className = "view-viewer__md-root";
                    mdRoot.innerHTML = sanitized;
                    renderTarget.append(outlineNav, mdRoot);
                    this.resolveRelativeResourceUrls(mdRoot);
                    this.applyRenderedLinkBehavior(mdRoot);
                    this.refreshDocumentOutline(outlineNav, mdRoot);
                    this.syncOutlineToolbarState();
                    endBusy();
                    console.log("[ViewerView] Markdown rendered successfully");
                };

                const handleError = (error: unknown) => {
                    if (seq !== this.renderSeq) return;
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

    private applyRouteParams(params?: Record<string, string>): void {
        if (!params) return;
        const detachKey = String(params.detachKey || "").trim();
        if (detachKey) {
            try {
                const payloadRaw = globalThis?.sessionStorage?.getItem?.(detachKey) || "";
                if (payloadRaw) {
                    const payload = JSON.parse(payloadRaw) as {
                        content?: string;
                        filename?: string;
                        source?: string;
                    };
                    const detachedContent = String(payload?.content || "");
                    if (detachedContent.trim()) {
                        this.contentRef.value = detachedContent;
                    }
                    if (payload?.filename) {
                        this.options.filename = String(payload.filename);
                    }
                    const detachedSource = String(payload?.source || "");
                    if (detachedSource) {
                        this.sourceUrl = this.normalizeSourceUrl(detachedSource);
                        this.options.source = detachedSource;
                    }
                }
                globalThis?.sessionStorage?.removeItem?.(detachKey);
            } catch (error) {
                console.warn("[Viewer] Failed to restore detached payload:", error);
            }
        }
        const sourceParam = params.source || params.src || params.path || params.url;
        if (sourceParam) {
            this.sourceUrl = this.normalizeSourceUrl(sourceParam);
            this.options.source = sourceParam;
        }
        const filenameParam = params.filename || params.name;
        if (filenameParam) {
            this.options.filename = filenameParam;
        }
        const contentParam = String(params.content || "");
        if (contentParam.trim()) {
            this.contentRef.value = contentParam;
        }
    }

    private isUnsafeProtocol(value: string): boolean {
        return /^(?:javascript|vbscript|data:text\/html)/i.test((value || "").trim());
    }

    /**
     * Markdown/HTML sometimes emits bare base64 (no `data:` scheme). Resolving that against
     * `chrome-extension://…/viewer.html` produces bogus URLs and net::ERR_FILE_NOT_FOUND.
     */
    private normalizeBareBase64Candidate(raw: string): string | null {
        const trimmed = (raw || "").trim();
        if (!trimmed || parseDataUrl(trimmed)) return null;

        const candidates = [
            trimmed,
            trimmed.replace(/[\s>]+$/g, ""),
            trimmed.replace(/[^A-Za-z0-9+/=_-]/g, ""),
        ];
        for (const c of candidates) {
            const t = c.trim();
            if (t.length >= 8 && isBase64Like(t)) return t;
        }
        return null;
    }

    private sniffImageMimeFromBytes(bytes: Uint8Array): string {
        const n = bytes.byteLength;
        if (n >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
            return "image/png";
        }
        if (n >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
            return "image/jpeg";
        }
        if (n >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
            return "image/gif";
        }
        if (n >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
            return "image/webp";
        }
        if (n >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
            return "image/bmp";
        }
        const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, Math.min(400, n)));
        const t = head.trimStart();
        if (t.startsWith("<svg") || t.startsWith("<?xml")) return "image/svg+xml";
        return "image/png";
    }

    /** `undefined` = not bare base64; `null` = looked like base64 but decode failed (do not resolve as path). */
    private coerceBareBase64ToDataUrl(value: string): string | null | undefined {
        const bare = this.normalizeBareBase64Candidate(value);
        if (!bare) return undefined;
        try {
            const bytes = decodeBase64ToBytes(bare);
            const mime = this.sniffImageMimeFromBytes(bytes);
            const compact = bare.replace(/\s/g, "");
            return `data:${mime};base64,${compact}`;
        } catch {
            return null;
        }
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

        const dataFromBare = this.coerceBareBase64ToDataUrl(value);
        if (dataFromBare !== undefined) return dataFromBare;

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
        const extPage = globalThis.location?.protocol === "chrome-extension:";
        const fileBacked = Boolean(this.sourceUrl?.startsWith("file:"));

        const apply = (selector: string, attr: "src" | "href", mode: "link" | "media") => {
            const nodes = Array.from(root.querySelectorAll(selector)) as HTMLElement[];
            for (const node of nodes) {
                const current = (node.getAttribute(attr) || "").trim();
                if (!current) continue;
                const resolved = this.resolveUrlAgainstSource(current);
                if (!resolved) {
                    node.removeAttribute(attr);
                    continue;
                }
                // Extension viewer + file-backed source: do not inject file:// into the DOM.
                // Chromium blocks nested/opaque file loads; keep relative hrefs for link clicks.
                if (extPage && fileBacked && /^file:/i.test(resolved)) {
                    if (mode === "link") {
                        const hadAbsoluteScheme =
                            /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(current) || current.startsWith("//");
                        if (!hadAbsoluteScheme) {
                            continue;
                        }
                        node.removeAttribute(attr);
                        continue;
                    }
                    node.removeAttribute(attr);
                    continue;
                }
                if (resolved !== current) node.setAttribute(attr, resolved);
            }
        };

        apply("img[src]", "src", "media");
        apply("source[src]", "src", "media");
        apply("video[src]", "src", "media");
        apply("audio[src]", "src", "media");
        apply("track[src]", "src", "media");
        apply("a[href]", "href", "link");
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
        if (/^file:/i.test(src)) {
            // file:// is a unique origin; direct fetch from viewer context is blocked in Chromium.
            return null;
        }
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
        const renderTarget = this.queryViewerSlotted("[data-render-target]");
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
        const shell =
            this.element.classList.contains("cw-view-viewer-shell") ? this.element : null;
        const renderTarget = this.queryViewerSlotted("[data-render-target]");

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
                case "paste":
                    void this.handlePasteFromToolbar();
                    break;
                case "copy":
                    this.handleCopy();
                    break;
                case "toggle-raw":
                    showRaw = !showRaw;
                    if (renderTarget) renderTarget.hidden = showRaw;
                    if (rawElement) rawElement.hidden = !showRaw;
                    this.syncViewerRawMode(showRaw);
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
                case "toggle-outline":
                    this.setOutlineVisible(!this.outlineVisible);
                    break;
                case "attach":
                    void this.handleAttachToWorkCenter();
                    break;
            }
        });

        // Setup drag and drop (shell includes toolbar + raw + slotted markdown)
        const dropZone = shell || content;
        if (dropZone) {
            dropZone.addEventListener("mouseenter", () => {
                this.isPointerInView = true;
            });

            dropZone.addEventListener("mouseleave", () => {
                this.isPointerInView = false;
            });

            dropZone.addEventListener("dragover", (e) => {
                e.preventDefault();
                const mark = shell ?? content;
                mark?.classList.add("dragover");
            });

            dropZone.addEventListener("dragleave", () => {
                const mark = shell ?? content;
                mark?.classList.remove("dragover");
            });

            dropZone.addEventListener("drop", (e) => {
                e.preventDefault();
                const mark = shell ?? content;
                mark?.classList.remove("dragover");
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
        const raw = this.contentRef.value || "";
        if (!raw.trim()) {
            this.showMessage("No content to copy");
            return;
        }
        try {
            const result = await Promise.race([
                writeClipboardText(raw),
                new Promise<{ ok: false; error: string }>((resolve) =>
                    globalThis.setTimeout(() => resolve({ ok: false, error: "Clipboard timeout" }), 3500)
                )
            ]);
            if (!result.ok) throw new Error(result.error || "Clipboard write failed");
            this.showMessage("Copied raw content to clipboard");
            this.options.onCopy?.(raw);
        } catch (error) {
            console.error("[ViewerView] Failed to copy:", error);
            this.showMessage("Failed to copy to clipboard");
        }
    }

    private async handleCopyRendered(renderTarget: HTMLElement): Promise<void> {
        await new Promise<void>((r) => {
            if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => r());
            else globalThis.setTimeout(() => r(), 0);
        });
        // textContent avoids full layout flush that innerText can trigger on large docs.
        const proseRoot = renderTarget.querySelector(":scope > .view-viewer__md-root") as HTMLElement | null;
        const text = (proseRoot?.textContent || renderTarget?.textContent || "").trim();
        if (!text) {
            this.showMessage("No content to copy");
            return;
        }
        if (text.length > VIEWER_MAX_RENDERED_COPY_CHARS) {
            this.showMessage("Rendered page is too large to copy as text — use Copy (raw) instead");
            return;
        }
        try {
            const result = await Promise.race([
                writeClipboardText(text),
                new Promise<{ ok: false; error: string }>((resolve) =>
                    globalThis.setTimeout(() => resolve({ ok: false, error: "Clipboard timeout" }), 3500)
                )
            ]);
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
            const rawTarget = this.queryViewerSlotted("[data-raw-target]") as HTMLPreElement | null;
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

    private async handleAttachToWorkCenter(): Promise<void> {
        const content = this.contentRef.value || "";
        if (!content.trim()) {
            this.showMessage("No content to attach");
            return;
        }

        await Promise.resolve(this.shellContext?.navigate("workcenter"));

        const filename = this.options.filename || `viewer-${Date.now()}.md`;
        const payload = {
            text: content,
            content,
            filename,
            source: "viewer-attach"
        };

        try {
            const { ViewRegistry } = await import("../../shared/ui/registry");
            const workcenter =
                ViewRegistry.getLoaded("workcenter") ||
                await ViewRegistry.load("workcenter", { shellContext: this.shellContext });
            if (workcenter?.handleMessage) {
                await workcenter.handleMessage({
                    type: "content-share",
                    contentType: "markdown",
                    data: payload
                });
                this.showMessage("Content attached to Work Center");
                return;
            }
        } catch (error) {
            console.warn("[Viewer] direct workcenter attach failed:", error);
        }

        this.showMessage("Attach failed — open Work Center and try again");
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

        const text = e.clipboardData.getData("text/plain");
        if (files.length === 0 && (!text || !text.trim())) return;

        e.preventDefault();
        e.stopPropagation();

        await this.ingestPastedPayload(files, text);
    }

    /**
     * Mobile / no-keyboard: read clipboard via Async Clipboard API (user gesture from toolbar tap).
     */
    private async handlePasteFromToolbar(): Promise<void> {
        if (!this.element || !this.isViewVisible) {
            this.showMessage("Open the Viewer tab to paste");
            return;
        }
        if (document.visibilityState !== "visible") return;
        if (
            this.shellContext?.navigationState?.currentView &&
            this.shellContext.navigationState.currentView !== this.id
        ) {
            this.showMessage("Open the Viewer tab to paste");
            return;
        }

        try {
            const { files, text } = await this.readSystemClipboard();
            if (files.length === 0 && (!text || !text.trim())) {
                this.showMessage("Clipboard is empty or access denied");
                return;
            }
            await this.ingestPastedPayload(files, text);
        } catch (error) {
            console.error("[ViewerView] Paste from toolbar failed:", error);
            this.showMessage("Could not read clipboard — check permissions");
        }
    }

    private async readSystemClipboard(): Promise<{ files: File[]; text?: string }> {
        const files: File[] = [];
        let text: string | undefined;

        if (typeof navigator === "undefined" || !navigator.clipboard) {
            return { files, text };
        }

        try {
            if (typeof navigator.clipboard.read === "function") {
                const items = await Promise.race([
                    navigator.clipboard.read(),
                    new Promise<ClipboardItem[]>((resolve) =>
                        globalThis.setTimeout(() => resolve([]), 3500)
                    )
                ]);
                let mdNameIndex = 0;

                for (const item of items) {
                    for (const type of item.types) {
                        const lower = type.toLowerCase();
                        if (lower === "text/html") continue;

                        let blob: Blob;
                        try {
                            blob = await item.getType(type);
                        } catch {
                            continue;
                        }
                        if (!blob || blob.size === 0) continue;

                        if (lower === "text/plain") {
                            if (blob.size > VIEWER_CLIPBOARD_READ_TEXT_MAX_BYTES) continue;
                            const t = await blob.text();
                            if (t) text = text ?? t;
                            continue;
                        }

                        if (lower.startsWith("image/")) {
                            const ext = lower.split("/")[1] || "img";
                            files.push(new File([blob], `paste.${ext}`, { type }));
                            continue;
                        }

                        // Markdown / text documents as file (OS often exposes copied .md this way)
                        if (
                            lower === "text/markdown" ||
                            lower === "text/x-markdown" ||
                            lower === "text/md" ||
                            lower.includes("markdown")
                        ) {
                            if (blob.size > VIEWER_CLIPBOARD_READ_TEXT_MAX_BYTES) continue;
                            files.push(
                                new File([blob], `pasted-${mdNameIndex++}.md`, {
                                    type: "text/markdown"
                                })
                            );
                            continue;
                        }

                        if (lower.startsWith("text/")) {
                            if (blob.size > VIEWER_CLIPBOARD_READ_TEXT_MAX_BYTES) continue;
                            files.push(
                                new File([blob], `pasted-${mdNameIndex++}.md`, {
                                    type
                                })
                            );
                            continue;
                        }

                        // Opaque MIME (e.g. copied file) — if it looks like UTF-8 text, treat as .md
                        const sniffed = await this.sniffBlobAsUtf8MarkdownFile(blob, mdNameIndex);
                        if (sniffed) {
                            files.push(sniffed);
                            mdNameIndex++;
                        }
                    }
                }

                if (files.length > 0 || (text && text.trim())) {
                    return { files, text };
                }
            }
        } catch {
            // Fall through to readText()
        }

        try {
            const t = await navigator.clipboard.readText();
            if (t) text = text ?? t;
        } catch {
            /* ignore */
        }

        return { files, text };
    }

    /**
     * Clipboard sometimes exposes a copied file as application/octet-stream; if bytes look like UTF-8 text, open as .md.
     */
    private async sniffBlobAsUtf8MarkdownFile(blob: Blob, nameIndex: number): Promise<File | null> {
        const maxBytes = 4 * 1024 * 1024;
        if (blob.size > maxBytes) return null;

        const sampleSize = Math.min(blob.size, 24576);
        const sample = blob.slice(0, sampleSize);
        const buf = new Uint8Array(await sample.arrayBuffer());
        if (buf.length === 0) return null;
        if (buf.includes(0)) return null;

        let printable = 0;
        for (let i = 0; i < buf.length; i++) {
            const c = buf[i]!;
            if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127) || c >= 160) printable++;
        }
        if (printable / buf.length < 0.9) return null;

        return new File([blob], `pasted-${nameIndex}.md`, { type: "text/markdown" });
    }

    private async ingestPastedPayload(files: File[], textPlain: string | undefined): Promise<void> {
        if (files.length > 0) {
            const textFile = files.find((file) => this.isTextLikeFile(file)) || files[0];
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

        const text = textPlain;
        if (!text || !text.trim()) {
            return;
        }

        try {
            const raw = text.trim();
            if (
                raw.length <= VIEWER_INGEST_BASE64_PROBE_MAX &&
                (parseDataUrl(raw) || isBase64Like(raw))
            ) {
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

        const hasFocusWithinView = this.viewBranchesContain(document.activeElement);
        const targetInView = this.viewBranchesContain(target);
        const hoverWithinView = this.isPointerInView || this.viewBranchesHover();

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
            .cw-view-viewer-shell .markdown-viewer-content {
                font-family: ${this.getFontFamilyFromPreset()};
                font-size: ${fontSizePx}px;
                line-height: ${lineHeight};
                letter-spacing: var(--md-letter-spacing, 0);
                max-width: ${maxWidth}px;
                margin-inline: auto;
                padding: 1rem 1.1rem 3rem;
            }

            .cw-view-viewer-shell .markdown-viewer-content h1 { font-size: var(--md-h1-size, 1.95em); }
            .cw-view-viewer-shell .markdown-viewer-content h2 { font-size: var(--md-h2-size, 1.55em); }
            .cw-view-viewer-shell .markdown-viewer-content p,
            .cw-view-viewer-shell .markdown-viewer-content li {
                margin-block: var(--md-p-margin, 0.9em);
            }

            .cw-view-viewer-shell .markdown-viewer-content {
                ${this.getPresetVariablesCss()}
            }
        `;

        const modulesCss = `
            ${this.markdownSettings.modules.typography ? "" : `
            .cw-view-viewer-shell .markdown-viewer-content .view-viewer__md-root p,
            .cw-view-viewer-shell .markdown-viewer-content .view-viewer__md-root li,
            .cw-view-viewer-shell .markdown-viewer-content p,
            .cw-view-viewer-shell .markdown-viewer-content li {
                margin-block: 0.35em;
            }
            .cw-view-viewer-shell .markdown-viewer-content .view-viewer__md-root h1,
            .cw-view-viewer-shell .markdown-viewer-content .view-viewer__md-root h2,
            .cw-view-viewer-shell .markdown-viewer-content .view-viewer__md-root h3,
            .cw-view-viewer-shell .markdown-viewer-content h1,
            .cw-view-viewer-shell .markdown-viewer-content h2,
            .cw-view-viewer-shell .markdown-viewer-content h3 {
                margin-block: 0.45em;
            }`}

            ${this.markdownSettings.modules.lists ? `
            .cw-view-viewer-shell .markdown-viewer-content .view-viewer__md-root ul,
            .cw-view-viewer-shell .markdown-viewer-content .view-viewer__md-root ol {
                margin-block: 0.65em;
                padding-inline-start: 1.35em;
            }
            .cw-view-viewer-shell .markdown-viewer-content .view-viewer__md-root li {
                margin-block: 0.28em;
            }
            .cw-view-viewer-shell .markdown-viewer-content .view-viewer__md-root li > ul,
            .cw-view-viewer-shell .markdown-viewer-content .view-viewer__md-root li > ol {
                margin-block: 0.4em;
            }` : `
            .cw-view-viewer-shell .markdown-viewer-content .view-viewer__md-root ul,
            .cw-view-viewer-shell .markdown-viewer-content .view-viewer__md-root ol {
                padding-inline-start: 1.15em;
            }`}

            ${this.markdownSettings.modules.codeBlocks ? `
            .cw-view-viewer-shell .markdown-viewer-content pre {
                border-radius: 10px;
                padding: 0.8rem 1rem;
                overflow-x: auto;
            }
            .cw-view-viewer-shell .markdown-viewer-content code {
                font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
                font-size: 0.92em;
            }` : ""}

            ${this.markdownSettings.modules.tables ? `
            .cw-view-viewer-shell .markdown-viewer-content table {
                inline-size: 100%;
                border-collapse: collapse;
                margin: 1rem 0;
            }
            .cw-view-viewer-shell .markdown-viewer-content th,
            .cw-view-viewer-shell .markdown-viewer-content td {
                border: 1px solid color-mix(in oklab, currentColor 18%, transparent);
                padding: 0.45rem 0.6rem;
                text-align: left;
                vertical-align: top;
            }` : ""}

            ${this.markdownSettings.modules.blockquotes ? `
            .cw-view-viewer-shell .markdown-viewer-content blockquote {
                border-inline-start: 4px solid color-mix(in oklab, currentColor 30%, transparent);
                padding-inline: 1rem;
                margin-inline: 0;
            }` : ""}

            ${this.markdownSettings.modules.media ? `
            .cw-view-viewer-shell .markdown-viewer-content img,
            .cw-view-viewer-shell .markdown-viewer-content video {
                max-inline-size: 100%;
                border-radius: 8px;
                display: block;
                margin-inline: auto;
            }` : ""}
        `;

        const builtInPrintCss = `
            @media print {
                .cw-view-viewer-shell .markdown-viewer-content {
                    zoom: ${printScale};
                }
                ${this.markdownSettings.modules.printBreaks ? `
                .cw-view-viewer-shell .markdown-viewer-content h1,
                .cw-view-viewer-shell .markdown-viewer-content h2,
                .cw-view-viewer-shell .markdown-viewer-content h3 {
                    break-after: avoid-page;
                    break-inside: avoid;
                }
                .cw-view-viewer-shell .markdown-viewer-content pre,
                .cw-view-viewer-shell .markdown-viewer-content table,
                .cw-view-viewer-shell .markdown-viewer-content blockquote {
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
        this.syncAdoptedSheetsToShadow();
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
                    lists: (markdown?.modules?.lists ?? true) !== false,
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
        this.slotProjectingHost = null;
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
        const renderTarget = this.queryViewerSlotted("[data-render-target]");
        const rawTarget = this.queryViewerSlotted("[data-raw-target]") as HTMLPreElement | null;
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


import { H, provide } from "fest/lure";
import { createMarkdownViewer } from "fest/fl-ui";

// View
export const MakeMarkdownView = async (path: string, id: string) => {
    // Load content from path
    let content = "";
    try {
        if (path.startsWith("/user/") || path.startsWith("./") || path.startsWith("../")) {
            const file = await provide(path);
            if (file) {
                content = await file.text();
            }
        } else if (URL.canParse(path)) {
            const response = await fetch(path);
            content = await response.text();
        } else {
            content = path; // Direct content
        }
    } catch (error) {
        console.warn('[FaintMarkdown] Failed to load content:', error);
        content = `# Error loading content\n\nFailed to load: ${path}`;
    }

    // Create markdown viewer
    const viewer = createMarkdownViewer({
        content,
        showTitle: false,
        showActions: false
    });

    const viewElement = viewer.render();
    viewElement.style.cssText = "block-size: 100%; overflow: auto; display: block;";
    viewElement.classList.add("viewer-section");

    const section = H`<section id=${id} class="data-view c2-surface" style="grid-column: 2 / -1; grid-row: 2 / -1;">${viewElement}</section>`;
    return section;
}


/**
 * <md-view> Web Component and MarkdownViewer API
 *
 * Unified markdown rendering service that provides both:
 * - Web Component API: <md-view src="..." content="..."></md-view>
 *   Parsed HTML is rendered into a light-DOM `.markdown-body` child (default slot); shadow DOM holds layout/chrome only.
 * - Class-based API: createMarkdownViewer({ content: "...", ... })
 *
 * Usage:
 *   // Web Component
 *   <md-view content="# Hello World"></md-view>
 *   <md-view src="/path/to/file.md"></md-view>
 *
 *   // Class-based API
 *   import { createMarkdownViewer } from "fest/fl-ui/services/markdown-view";
 *   const viewer = createMarkdownViewer({ content: "# Hello", showActions: true });
 *   document.body.append(viewer.render());
 *
 * See fest/fl-ui/services/markdown-view/Markdown for implementation.
 */

// Re-export MarkdownView component (Web Component)
export { MarkdownView as MdViewElement, MarkdownView as default } from "./ts/Markdown";

// Re-export MarkdownViewer class and factory function (Class-based API)
export { MarkdownViewer, createMarkdownViewer, type MarkdownViewerOptions } from "./ts/Markdown";

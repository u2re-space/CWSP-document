/**
 * Print View — Unified with MarkdownView Component
 *
 * Shell-agnostic print view for rendering and printing markdown content.
 * This view leverages the canonical MarkdownView component from fest/fl-ui
 * for all markdown parsing, caching, sanitization, and styling.
 *
 * Features:
 * - Reuses MarkdownView web component for markdown rendering
 * - KaTeX math rendering (via MarkdownView)
 * - DOMPurify sanitization (via MarkdownView)
 * - OPFS and localStorage caching (via MarkdownView)
 * - DOCX export support
 * - Auto-print on load
 * - Print-optimized styles
 */

import { H } from "fest/lure";
import type { View, ViewOptions } from "../../shells/types";
import { MdViewElement } from "fest/fl-ui/services/markdown-view";

// ============================================================================
// PRINT VIEW OPTIONS
// ============================================================================

export interface PrintViewOptions extends ViewOptions {
    /** Initial markdown content to display */
    initialMarkdown?: string;
    /** Title for the document */
    title?: string;
    /** Whether to auto-print when loaded */
    autoPrint?: boolean;
    /** Custom CSS class for styling */
    className?: string;
    /** Print delay in ms */
    printDelay?: number;
    /** Export format */
    exportFormat?: "print" | "docx";
}

// ============================================================================
// PRINT VIEW CLASS
// ============================================================================

export class PrintView implements View {
    readonly id = "print";
    readonly name = "Print";

    private element: HTMLElement | null = null;
    private options: PrintViewOptions;
    private mdView: MdViewElement | null = null;

    constructor(options: PrintViewOptions = {}) {
        this.options = {
            ...options,
            initialData: options.initialData || options.initialMarkdown
        };
    }

    render(options?: ViewOptions): HTMLElement {
        // Merge options from constructor and render call
        const mergedOptions = { ...this.options, ...options };

        // Load styles (async, but we'll trigger it without awaiting)
        this.loadStyles().catch(e => console.warn("[PrintView] Failed to load print styles:", e));

        // Get content from options or URL parameters
        const urlParams = new URLSearchParams(globalThis?.location?.search);
        const content = (mergedOptions as PrintViewOptions).initialMarkdown ||
            urlParams.get('content') ||
            urlParams.get('markdown-content') ||
            urlParams.get('text') ||
            (mergedOptions.initialData as string) || '';
        const title = (mergedOptions as PrintViewOptions).title || urlParams.get('title') || 'Document';
        const wantsDocx = (mergedOptions as PrintViewOptions).exportFormat === 'docx' ||
            urlParams.get('export') === 'docx' ||
            urlParams.get('format') === 'docx';
        const autoPrint = ((mergedOptions as PrintViewOptions).autoPrint ?? (urlParams.get('auto-print') !== 'false')) && !wantsDocx;
        const className = (mergedOptions as PrintViewOptions).className || 'print-view';

        // Handle DOCX export (fire and forget)
        if (wantsDocx && content.trim()) {
            this.handleDocxExport(content, title).catch(e => console.error('[PrintView] DOCX export error:', e));
        }

        // Create print layout using MarkdownView web component
        this.mdView = new MdViewElement() as MdViewElement;

        this.element = H`
            <div class="${className}">
                <div class="print-content">
                    ${this.mdView}
                </div>
            </div>
        ` as HTMLElement;

        // Set markdown content via the component (async, but non-blocking)
        if (content.trim()) {
            (this.mdView as any).setContent?.(content).catch((e: any) => {
                console.warn('[PrintView] Failed to set markdown content:', e);
            });
        }

        // Auto-print if enabled (scheduled for later)
        if (autoPrint && content.trim() && typeof globalThis !== 'undefined' && 'print' in globalThis) {
            const printDelay = (mergedOptions as PrintViewOptions).printDelay ||
                (urlParams.get('print-delay') ? parseInt(urlParams.get('print-delay')!) : 1500);

            setTimeout(() => {
                console.log('[PrintView] Auto-printing document');
                globalThis?.print?.();
            }, printDelay);
        }

        console.log('[PrintView] Rendered', {
            title,
            contentLength: content.length,
            autoPrint,
        });

        return this.element;
    }

    private async loadStyles(): Promise<void> {
        try {
            // Use the styles from MarkdownView component via fest/fl-ui
            // Print-specific styles can be added via print media queries in CSS
            // No additional styles needed since MarkdownView handles all rendering
            console.log("[PrintView] Using MarkdownView component styles");
        } catch (e) {
            console.warn("[PrintView] Error during style setup:", e);
        }
    }

    private async handleDocxExport(content: string, title: string): Promise<void> {
        const { downloadHtmlAsDocx, downloadMarkdownAsDocx } = await import("../../../core/document/DocxExport");
        const filename = `${(title || 'document').replace(/[\\/:*?"<>|\u0000-\u001F]+/g, '-').slice(0, 180)}.docx`;
        const looksLikeHtml = content.trim().startsWith('<');

        if (looksLikeHtml) {
            await downloadHtmlAsDocx(content, { title, filename });
        } else {
            await downloadMarkdownAsDocx(content, { title, filename });
        }

        // Close window if requested
        const urlParams = new URLSearchParams(globalThis?.location?.search);
        if (urlParams.get('close') === 'true') {
            try {
                globalThis?.close?.();
            } catch {
                // ignore
            }
        }
    }

    getElement(): HTMLElement {
        return this.element || document.createElement('div');
    }

    getToolbar?(): HTMLElement | null {
        return null; // Print view has no toolbar
    }

    lifecycle? = {
        onMount: (): void => {
            console.log('[PrintView] Mounted');
        },

        onUnmount: (): void => {
            console.log('[PrintView] Unmounted');
            this.element = null;
            this.mdView = null;
        },

        onShow: (): void => {
            console.log('[PrintView] Shown');
        },

        onHide: (): void => {
            console.log('[PrintView] Hidden');
        }
    };
}

// ============================================================================
// VIEW FACTORY
// ============================================================================

export function createView(options?: PrintViewOptions): PrintView {
    return new PrintView(options);
}

/** Alias for createView */
export const createPrintView = createView;

export default createView;

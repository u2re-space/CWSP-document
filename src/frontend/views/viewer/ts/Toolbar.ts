/**
 * Single source for markdown viewer toolbar chrome (standalone + shadow/slot modes).
 */

import { H } from "fest/lure";

export function createViewerToolbar(): HTMLElement {
    return H`
        <div
            class="view-viewer__toolbar"
            data-viewer-toolbar
            role="toolbar"
            aria-label="Markdown document actions"
        >
            <div class="view-viewer__toolbar-left" role="group" aria-label="Document">
                <button class="view-viewer__btn" data-action="open" type="button" title="Open file">
                    <ui-icon class="view-viewer__toolbar-icon" icon="folder-open" icon-style="duotone" size="20" aria-hidden="true"></ui-icon>
                    <span>Open</span>
                </button>
                <button class="view-viewer__btn" data-action="toggle-raw" type="button" title="Toggle raw/rendered view">
                    <ui-icon class="view-viewer__toolbar-icon" icon="code" icon-style="duotone" size="20" aria-hidden="true"></ui-icon>
                    <span>Raw</span>
                </button>
                <button class="view-viewer__btn" data-action="copy" type="button" title="Copy raw content">
                    <ui-icon class="view-viewer__toolbar-icon" icon="copy" icon-style="duotone" size="20" aria-hidden="true"></ui-icon>
                    <span>Copy</span>
                </button>
                <button class="view-viewer__btn" data-action="paste" type="button" title="Paste from clipboard (mobile-friendly)" aria-label="Paste from clipboard">
                    <ui-icon class="view-viewer__toolbar-icon" icon="clipboard-text" icon-style="duotone" size="20" aria-hidden="true"></ui-icon>
                    <span>Paste</span>
                </button>
                <button class="view-viewer__btn" data-action="download" type="button" title="Download as markdown">
                    <ui-icon class="view-viewer__toolbar-icon" icon="download" icon-style="duotone" size="20" aria-hidden="true"></ui-icon>
                    <span>Download</span>
                </button>
            </div>
            <div class="view-viewer__toolbar-center" role="presentation">
                <span class="view-viewer__toolbar-title" data-viewer-toolbar-title></span>
            </div>
            <div class="view-viewer__toolbar-right" role="group" aria-label="Output and workspace">
                <button class="view-viewer__btn" data-action="attach" type="button" title="Attach to Work Center">
                    <ui-icon class="view-viewer__toolbar-icon" icon="paperclip" icon-style="duotone" size="20" aria-hidden="true"></ui-icon>
                    <span>Attach</span>
                </button>
                <button class="view-viewer__btn" data-action="open-style-settings" type="button" title="Markdown styling, modules, plugins">
                    <ui-icon class="view-viewer__toolbar-icon" icon="paint-roller" icon-style="duotone" size="20" aria-hidden="true"></ui-icon>
                    <span>Style</span>
                </button>
                <button class="view-viewer__btn" data-action="copy-rendered" type="button" title="Copy rendered text">
                    <ui-icon class="view-viewer__toolbar-icon" icon="text-t" icon-style="duotone" size="20" aria-hidden="true"></ui-icon>
                    <span>Copy text</span>
                </button>
                <button class="view-viewer__btn" data-action="export-docx" type="button" title="Export as DOCX">
                    <ui-icon class="view-viewer__toolbar-icon" icon="file-doc" icon-style="duotone" size="20" aria-hidden="true"></ui-icon>
                    <span>DOCX</span>
                </button>
                <button class="view-viewer__btn" data-action="print" type="button" title="Print content">
                    <ui-icon class="view-viewer__toolbar-icon" icon="printer" icon-style="duotone" size="20" aria-hidden="true"></ui-icon>
                    <span>Print</span>
                </button>
            </div>
        </div>
    ` as HTMLElement;
}

const TOOLBAR_TAG = "cw-markdown-toolbar-frame";
const TOOLBAR_SLOT = "toolbar";

export class MarkdownToolbarFrameElement extends HTMLElement {
    ensureReady(): this {
        const self = this as HTMLElement & { dataset: DOMStringMap };
        if (self.dataset.ready === "1") return this;
        self.dataset.ready = "1";
        self.classList?.add?.("cw-markdown-toolbar-frame");

        let toolbar = self.querySelector(`:scope > [slot="${TOOLBAR_SLOT}"][data-viewer-toolbar]`) as HTMLElement | null;
        if (!toolbar) {
            toolbar = createViewerToolbar();
            toolbar.slot = TOOLBAR_SLOT;
            self.appendChild(toolbar);
        } else if (!toolbar.slot) {
            toolbar.slot = TOOLBAR_SLOT;
        }

        const shadow = self.shadowRoot ?? self.attachShadow({ mode: "open" });
        if (!shadow.querySelector("[data-toolbar-panel]")) {
            const styleEl = document.createElement("style");
            styleEl.textContent = `
                :host {
                    display: block;
                    box-sizing: border-box;
                    min-inline-size: 0;
                    min-block-size: 0;
                    inline-size: 100%;
                }

                .cw-markdown-toolbar-frame__panel {
                    display: block;
                    box-sizing: border-box;
                    inline-size: 100%;
                    min-inline-size: 0;
                    min-block-size: 0;
                }

                .cw-markdown-toolbar-frame__panel > slot {
                    display: block;
                }
            `;
            const panel = document.createElement("div");
            panel.className = "cw-markdown-toolbar-frame__panel";
            panel.toggleAttribute("data-toolbar-panel", true);
            panel.innerHTML = `<slot name="${TOOLBAR_SLOT}"></slot>`;
            shadow.replaceChildren(styleEl, panel);
        }

        return this;
    }

    connectedCallback(): this {
        return this.ensureReady();
    }
}

export function ensureMarkdownToolbarFrame(): string {
    if (!customElements.get(TOOLBAR_TAG)) {
        customElements.define(TOOLBAR_TAG, MarkdownToolbarFrameElement);
    }
    return TOOLBAR_TAG;
}


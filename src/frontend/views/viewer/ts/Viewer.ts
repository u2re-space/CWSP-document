/**
 * Custom element wrapper used by the markdown/viewer surface.
 *
 * It creates the shadow-shell that toggles between rendered prose and raw
 * source output while keeping the light-DOM render targets stable for the rest
 * of the viewer pipeline.
 */
import { H } from "fest/lure";

const FRAME_TAG = "cw-markdown-view-frame";

/** Build the shadow-panel structure that hosts the raw and rendered viewer slots. */
export function createMarkdownViewFrame(): HTMLElement {
    return H`
        <div class="view-viewer__content" data-viewer-content>
            <div class="cw-view-viewer__slot-raw">
                <slot name="raw"></slot>
            </div>
            <div class="cw-view-viewer__slot-default">
                <slot></slot>
            </div>
        </div>
    ` as HTMLElement;
}

/** Lightweight host element for viewer content that can switch between raw and prose modes. */
export class MarkdownViewFrameElement extends HTMLElement {
    ensureReady(): this {
        const self = this as HTMLElement & { dataset: DOMStringMap };
        if (self.dataset.ready === "1") return this;
        self.dataset.ready = "1";
        self.classList.add("cw-markdown-view-frame");

        let pre = self.querySelector(":scope > pre[data-raw-target]") as HTMLPreElement | null;
        if (!pre) {
            pre = document.createElement("pre");
            pre.className = "markdown-viewer-raw";
            pre.toggleAttribute("data-raw-target", true);
            pre.setAttribute("aria-label", "Raw content");
            pre.slot = "raw";
            self.appendChild(pre);
        } else if (!pre.slot) {
            pre.slot = "raw";
        }

        let prose = self.querySelector(":scope > [data-render-target]") as HTMLElement | null;
        if (!prose) {
            prose = document.createElement("div");
            prose.className = "cw-view-viewer__prose markdown-body markdown-viewer-content result-content";
            prose.toggleAttribute("data-render-target", true);
            prose.toggleAttribute("data-cw-viewer-prose", true);
            self.appendChild(prose);
        }

        const shadow = self.shadowRoot ?? self.attachShadow({ mode: "open" });
        if (!shadow.querySelector("[data-view-frame-panel]")) {
            const styleEl = document.createElement("style");
            styleEl.textContent = `
                :host {
                    display: block;
                    box-sizing: border-box;
                    inline-size: 100%;
                    block-size: 100%;
                    min-inline-size: 0;
                    min-block-size: 0;
                    overflow: hidden;
                }

                .view-viewer__content {
                    display: flex;
                    flex-direction: column;
                    box-sizing: border-box;
                    inline-size: 100%;
                    block-size: 100%;
                    min-inline-size: 0;
                    min-block-size: 0;
                    overflow: hidden;
                }

                .cw-view-viewer__slot-raw,
                .cw-view-viewer__slot-default {
                    flex: 1 1 auto;
                    box-sizing: border-box;
                    min-inline-size: 0;
                    min-block-size: 0;
                    overflow-block: auto;
                    overflow-inline: hidden;
                    overscroll-behavior: contain;
                }

                .cw-view-viewer__slot-default > slot {
                    display: block;
                    block-size: 100%;
                    min-block-size: 0;
                }

                .cw-view-viewer__slot-default > slot::slotted([data-render-target]) {
                    display: block;
                    box-sizing: border-box;
                    inline-size: 100%;
                    block-size: 100%;
                    max-block-size: 100%;
                    min-inline-size: 0;
                    min-block-size: 0;
                    overflow-block: auto;
                    overflow-inline: hidden;
                    overscroll-behavior: contain;
                }

                :host(:not([data-raw])) .cw-view-viewer__slot-raw {
                    display: none !important;
                }

                :host([data-raw]) .cw-view-viewer__slot-default {
                    display: none !important;
                }
            `;
            const panel = createMarkdownViewFrame();
            panel.toggleAttribute("data-view-frame-panel", true);
            shadow.replaceChildren(styleEl, panel);
        }

        return this;
    }

    connectedCallback(): this {
        return this.ensureReady();
    }
}

/** Define the viewer frame element once and return its tag name for callers. */
export function ensureMarkdownViewFrame(): string {
    if (!customElements.get(FRAME_TAG)) {
        customElements.define(FRAME_TAG, MarkdownViewFrameElement);
    }
    return FRAME_TAG;
}

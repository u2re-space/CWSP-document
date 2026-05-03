/**
 * Minimal window chrome host for `AppWindowShell` — registers `cw-window-frame-v2`.
 * Full draggable/resizable chrome can replace this later.
 */

export interface WindowFrameElement extends HTMLElement {
    setTitle(title: string): void;
    setPidLabel(pid: string): void;
}

export class CwWindowFrameV2 extends HTMLElement implements WindowFrameElement {
    constructor() {
        super();
        const root = this.attachShadow({ mode: "open" });
        root.innerHTML = `
            <style>
                :host {
                    display: block;
                    box-sizing: border-box;
                    position: relative;
                    contain: layout style;
                }
                .cw-window-frame-v2__shell {
                    display: flex;
                    flex-direction: column;
                    block-size: 100%;
                    inline-size: 100%;
                    min-block-size: 0;
                    min-inline-size: 0;
                    overflow: hidden;
                    border-radius: var(--window-frame-radius, 0.5rem);
                    border: 1px solid color-mix(in oklab, var(--color-outline-variant, #888) 55%, transparent);
                    background: var(--color-surface, #1a1a1a);
                }
                ::slotted([slot="window-view"]) {
                    flex: 1 1 auto;
                    min-block-size: 0;
                    min-inline-size: 0;
                    overflow: auto;
                }
            </style>
            <div class="cw-window-frame-v2__shell" part="shell">
                <slot name="window-view"></slot>
            </div>
        `;
    }

    setTitle(title: string): void {
        this.setAttribute("data-title", title);
    }

    setPidLabel(pid: string): void {
        this.setAttribute("data-pid", pid);
    }
}

const TAG = "cw-window-frame-v2";
if (typeof customElements !== "undefined" && !customElements.get(TAG)) {
    customElements.define(TAG, CwWindowFrameV2);
}

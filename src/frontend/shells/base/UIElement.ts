import type { ShellId } from "../types";

const SHELL_ELEMENT_TAG_PREFIX = "cw-shell";
const shellElementCtorByTag = new Map<string, CustomElementConstructor>();
const HTMLElementBase = ((globalThis as unknown as { HTMLElement?: typeof HTMLElement }).HTMLElement ?? class { }) as typeof HTMLElement;
const SHELL_ELEMENT_TAG_ALIAS: Partial<Record<ShellId, string>> = {
    window: "cw-shell-container",
};

export class ShellElement extends HTMLElementBase {
    private initialized = false;

    connectedCallback(): void {
        this.ensureShadowLayout();
    }

    mountShellLayout(layout: HTMLElement): void {
        this.ensureShadowLayout();
        layout.slot = "content";
        this.replaceChildren(layout);
    }

    private ensureShadowLayout(): void {
        if (this.initialized) return;
        const shadow = this.shadowRoot || this.attachShadow({ mode: "open" });
        shadow.innerHTML = `
            <style>
                :host {
                    display: block;
                    inline-size: 100%;
                    block-size: 100%;
                    container-type: size;
                    /* `contain: strict` (size) can break % sizing for slotted shell vs extension grid. */
                    contain: layout paint;
                    isolation: isolate;
                    overflow: clip;
                    pointer-events: none;
                }

                .cw-shell-frame {
                    display: grid;
                    grid-template-rows: minmax(0, max-content) minmax(0, 1fr) minmax(0, max-content);
                    inline-size: 100%;
                    block-size: 100%;
                    container-type: size;
                    contain: layout paint;
                    isolation: isolate;
                }

                .cw-shell-toolbar,
                .cw-shell-status {
                    display: contents;
                }

                .cw-shell-content {
                    min-inline-size: 0;
                    min-block-size: 0;
                    overflow: clip;
                }

                @media print {
                    :host {
                        overflow: visible !important;
                        contain: none !important;
                        container-type: normal !important;
                        content-visibility: visible !important;
                        block-size: auto !important;
                        max-block-size: none !important;
                    }

                    .cw-shell-frame,
                    .cw-shell-toolbar,
                    .cw-shell-content,
                    .cw-shell-status {
                        display: contents !important;
                        overflow: visible !important;
                        contain: none !important;
                        container-type: normal !important;
                        content-visibility: visible !important;
                        block-size: auto !important;
                        max-block-size: none !important;
                    }

                    ::slotted(*) {
                        overflow: visible !important;
                        contain: none !important;
                        container-type: normal !important;
                        content-visibility: visible !important;
                        position: static !important;
                        inset: auto !important;
                        block-size: auto !important;
                        max-block-size: none !important;
                    }
                }
            </style>
            <section class="cw-shell-frame" data-shell-frame>
                <header class="cw-shell-toolbar" data-shell-toolbar-slot>
                    <slot name="toolbar"></slot>
                </header>
                <main class="cw-shell-content" data-shell-content-slot>
                    <slot name="content"></slot>
                </main>
                <footer class="cw-shell-status" data-shell-status-slot>
                    <slot name="status"></slot>
                </footer>
            </section>
        `;
        this.initialized = true;
    }
}

export const getShellElementTagName = (shellId: ShellId | string): string => {
    const sid = String(shellId || "unknown").toLowerCase() as ShellId;
    return SHELL_ELEMENT_TAG_ALIAS[sid] || `${SHELL_ELEMENT_TAG_PREFIX}-${sid}`;
};

export const ensureShellElementDefined = (shellId: ShellId | string): string => {
    const tagName = getShellElementTagName(shellId);
    const ce = (globalThis as unknown as { customElements?: CustomElementRegistry | null }).customElements;
    if (ce && typeof ce.get === "function" && typeof ce.define === "function" && !ce.get(tagName)) {
        let ctor = shellElementCtorByTag.get(tagName);
        if (!ctor) {
            ctor = class extends ShellElement { };
            shellElementCtorByTag.set(tagName, ctor);
        }
        ce.define(tagName, ctor);
    }
    return tagName;
};

import type { ShellId } from "./types";

const SHELL_ELEMENT_TAG_PREFIX = "cw-shell";
const shellElementCtorByTag = new Map<string, CustomElementConstructor>();

const MINIMAL_SHELL_HOST_STYLES = `
:host {
    display: block;
    inline-size: 100%;
    block-size: 100%;
    container-type: size;
    contain: strict;
    isolation: isolate;
    overflow: hidden;
}

.app-shell__content > slot[name="view"]::slotted([data-view]) {
    position: absolute;
    inset: 0;
    overflow: auto;
    scrollbar-width: thin;
    inline-size: stretch;
    block-size: stretch;
    min-inline-size: 0;
    min-block-size: 0;
    display: block;
    container-type: size;
}

::slotted([data-cw-view-host="true"]) {
    display: block;
    inline-size: 100%;
    block-size: 100%;
    min-block-size: 0;
    min-inline-size: 0;
    container-type: size;
}

@media print {
    :host {
        overflow: visible !important;
        contain: none !important;
        container-type: normal !important;
        block-size: auto !important;
        max-block-size: none !important;
    }

    ::slotted(*) {
        overflow: visible !important;
        contain: none !important;
        container-type: normal !important;
        block-size: auto !important;
        max-block-size: none !important;
    }
}
`;

/**
 * Minimal shell: full `app-shell` chrome lives in shadow DOM; active view (`cw-view-*`) is a
 * light-DOM child with `slot="view"` projected into `<main>`.
 */
export class MinimalShellHostElement extends HTMLElement {
    private chromeMounted = false;

    mountShellLayout(layout: HTMLElement): void {
        if (this.chromeMounted) return;

        const shadow = this.shadowRoot ?? this.attachShadow({ mode: "open" });

        const hostStyle = document.createElement("style");
        hostStyle.textContent = MINIMAL_SHELL_HOST_STYLES;
        shadow.appendChild(hostStyle);

        const main = layout.querySelector("[data-shell-content]");
        if (main) {
            const loading = main.querySelector(":scope > .app-shell__loading");
            const frag = document.createDocumentFragment();
            if (loading) {
                frag.appendChild(loading);
            }
            const viewSlot = document.createElement("slot");
            viewSlot.name = "view";
            frag.appendChild(viewSlot);
            main.replaceChildren(frag);
        }

        const statusEl = layout.querySelector("[data-shell-status]");
        if (statusEl) {
            statusEl.replaceChildren();
            const stSlot = document.createElement("slot");
            stSlot.name = "shell-status";
            statusEl.appendChild(stSlot);
        }

        shadow.appendChild(layout);
        this.chromeMounted = true;
    }
}

export class ShellElement extends HTMLElement {
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
                    contain: strict;
                    isolation: isolate;
                    overflow: clip;
                }

                .cw-shell-frame {
                    display: grid;
                    grid-template-rows: minmax(0, max-content) minmax(0, 1fr) minmax(0, max-content);
                    inline-size: 100%;
                    block-size: 100%;
                    container-type: size;
                    contain: strict;
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

export const getShellElementTagName = (shellId: ShellId | string): string =>
    `${SHELL_ELEMENT_TAG_PREFIX}-${String(shellId || "unknown").toLowerCase()}`;

export const ensureShellElementDefined = (shellId: ShellId | string): string => {
    const tagName = getShellElementTagName(shellId);
    if (!customElements.get(tagName)) {
        let ctor = shellElementCtorByTag.get(tagName);
        if (!ctor) {
            const sid = String(shellId || "").toLowerCase();
            ctor =
                sid === "minimal"
                    ? MinimalShellHostElement
                    : class extends ShellElement { };
            shellElementCtorByTag.set(tagName, ctor);
        }
        customElements.define(tagName, ctor);
    }
    return tagName;
};

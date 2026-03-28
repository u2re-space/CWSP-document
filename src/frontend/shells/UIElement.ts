import type { ShellId } from "./types";

const SHELL_ELEMENT_TAG_PREFIX = "cw-shell";
const shellElementCtorByTag = new Map<string, CustomElementConstructor>();

const WEBTOP_ENV_TAG = "cw-webtop-environment";

/**
 * Web desktop / home-tab host: full `app-shell` chrome in the **light DOM** (no shadow).
 * Replaces legacy `cw-shell-minimal` shadow host; views mount as direct children of `[data-shell-content]`.
 */
export class WebtopEnvironmentHostElement extends HTMLElement {
    mountShellLayout(layout: HTMLElement): void {
        this.replaceChildren(layout);
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

export const getShellElementTagName = (shellId: ShellId | string): string => {
    const sid = String(shellId || "unknown").toLowerCase();
    if (sid === "minimal" || sid === "environment") {
        return WEBTOP_ENV_TAG;
    }
    return `${SHELL_ELEMENT_TAG_PREFIX}-${sid}`;
};

export const ensureShellElementDefined = (shellId: ShellId | string): string => {
    const tagName = getShellElementTagName(shellId);
    if (!customElements.get(tagName)) {
        let ctor = shellElementCtorByTag.get(tagName);
        if (!ctor) {
            const sid = String(shellId || "").toLowerCase();
            ctor =
                sid === "minimal" || sid === "environment"
                    ? WebtopEnvironmentHostElement
                    : class extends ShellElement { };
            shellElementCtorByTag.set(tagName, ctor);
        }
        customElements.define(tagName, ctor);
    }
    return tagName;
};

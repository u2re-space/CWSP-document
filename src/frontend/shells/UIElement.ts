import type { ShellId } from "./types";

const SHELL_ELEMENT_TAG_PREFIX = "cw-shell";
const shellElementCtorByTag = new Map<string, CustomElementConstructor>();
const SHELL_ELEMENT_TAG_ALIAS: Partial<Record<ShellId, string>> = {
    window: "cw-shell-container",
};
const WINDOW_FRAME_TAG_NAME = "cw-window-frame";
const WINDOW_SHELL_HOST_STYLES = `
:host {
    display: block;
    inline-size: 100%;
    block-size: 100%;
    container-type: size;
    contain: strict;
    isolation: isolate;
    overflow: hidden;
}

[data-shell-content] > slot[name="window-frame"]::slotted(cw-window-frame) {
    position: absolute;
}
`;
const WINDOW_FRAME_STYLES = `
:host {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-inline-size: 360px;
    min-block-size: 240px;
    overflow: hidden;
}

.app-window-shell__frame-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    min-block-size: 38px;
    padding-inline: 0.55rem;
    border-block-end: 1px solid rgba(255, 255, 255, 0.08);
    cursor: move;
    background: var(--window-frame-header, #24324f);
}

.app-window-shell__frame-title {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-inline-size: 0;
}

.app-window-shell__frame-title-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 600;
    font-size: 0.86rem;
}

.app-window-shell__frame-pid {
    opacity: 0.72;
    font-size: 0.72rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.app-window-shell__frame-actions {
    display: inline-flex;
    gap: 0.35rem;
}

.app-window-shell__frame-actions > button {
    inline-size: 1.65rem;
    block-size: 1.45rem;
    border: none;
    border-radius: 8px;
    color: inherit;
    background: rgba(255, 255, 255, 0.12);
    cursor: pointer;
    font-size: 0.95rem;
    line-height: 1;
}

.app-window-shell__frame-actions > button:hover {
    background: rgba(255, 255, 255, 0.24);
}

.app-window-shell__frame-body {
    position: relative;
    overflow: auto;
    min-inline-size: 0;
    min-block-size: 0;
    background: color-mix(in oklab, #0e1524 88%, #ffffff 12%);
}

.app-window-shell__frame-body > slot[name="window-view"]::slotted(*) {
    display: block;
    inline-size: 100%;
    block-size: 100%;
    min-inline-size: 0;
    min-block-size: 0;
}

.app-window-shell__resize {
    position: absolute;
    inset-inline-end: 0;
    inset-block-end: 0;
    inline-size: 14px;
    block-size: 14px;
    border: none;
    padding: 0;
    margin: 0;
    cursor: nwse-resize;
    background:
        linear-gradient(135deg, transparent 45%, rgba(255, 255, 255, 0.35) 46%, rgba(255, 255, 255, 0.35) 54%, transparent 55%);
}
`;

const MINIMAL_SHELL_HOST_STYLES = `
:host {
    display: block;
    inline-size: 100%;
    block-size: 100%;
    container-type: size;
    contain: strict;
    isolation: isolate;
    overflow: hidden;
    /* Minimal shell: align with .app-shell__nav via --shell-nav-bg (set in minimal.scss) */
    background-color: var(--shell-nav-bg, var(--color-surface-container-high, var(--color-background, Canvas)));
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

export class WindowShellHostElement extends HTMLElement {
    private chromeMounted = false;

    mountShellLayout(layout: HTMLElement): void {
        if (this.chromeMounted) return;

        const shadow = this.shadowRoot ?? this.attachShadow({ mode: "open" });
        const hostStyle = document.createElement("style");
        hostStyle.textContent = WINDOW_SHELL_HOST_STYLES;
        shadow.appendChild(hostStyle);

        const stage = layout.querySelector("[data-shell-content]");
        if (stage) {
            const slot = document.createElement("slot");
            slot.name = "window-frame";
            stage.replaceChildren(slot);
        }

        const statusEl = layout.querySelector("[data-shell-status]");
        if (statusEl) {
            statusEl.replaceChildren();
            const statusSlot = document.createElement("slot");
            statusSlot.name = "shell-status";
            statusEl.appendChild(statusSlot);
        }

        shadow.appendChild(layout);
        this.chromeMounted = true;
    }
}

export class WindowFrameElement extends HTMLElement {
    private initialized = false;

    connectedCallback(): void {
        this.ensureShadowLayout();
        this.syncHeaderMeta();
    }

    setTitle(title: string): void {
        this.dataset.title = title || "";
        this.syncHeaderMeta();
    }

    setPidLabel(pid: string): void {
        this.dataset.pid = pid || "";
        this.syncHeaderMeta();
    }

    getDragHandle(): HTMLElement | null {
        return this.shadowRoot?.querySelector("[data-window-drag]") as HTMLElement | null;
    }

    getResizeHandle(): HTMLElement | null {
        return this.shadowRoot?.querySelector("[data-window-resize]") as HTMLElement | null;
    }

    private ensureShadowLayout(): void {
        if (this.initialized) return;
        const shadow = this.shadowRoot ?? this.attachShadow({ mode: "open" });
        shadow.innerHTML = `
            <style>${WINDOW_FRAME_STYLES}</style>
            <header class="app-window-shell__frame-header" data-window-drag>
                <div class="app-window-shell__frame-title">
                    <span class="app-window-shell__frame-title-text" data-window-title></span>
                    <span class="app-window-shell__frame-pid" data-window-pid></span>
                </div>
                <div class="app-window-shell__frame-actions">
                    <button type="button" data-window-action="minimize" aria-label="Minimize">−</button>
                    <button type="button" data-window-action="close" aria-label="Close">×</button>
                </div>
            </header>
            <div class="app-window-shell__frame-body" data-window-body>
                <slot name="window-view"></slot>
            </div>
            <button type="button" class="app-window-shell__resize" data-window-resize aria-label="Resize window"></button>
        `;

        const actionButtons = shadow.querySelectorAll("[data-window-action]");
        actionButtons.forEach((button) => {
            button.addEventListener("click", () => {
                const action = (button as HTMLElement).dataset.windowAction || "";
                this.dispatchEvent(new CustomEvent("window-action", {
                    detail: { action },
                    bubbles: true,
                    composed: true
                }));
            });
        });

        this.initialized = true;
    }

    private syncHeaderMeta(): void {
        const title = this.shadowRoot?.querySelector("[data-window-title]");
        const pid = this.shadowRoot?.querySelector("[data-window-pid]");
        if (title) title.textContent = this.dataset.title || "View";
        if (pid) pid.textContent = this.dataset.pid ? `#${this.dataset.pid}` : "";
    }
}

const ensureWindowFrameElementDefined = (): void => {
    if (!customElements.get(WINDOW_FRAME_TAG_NAME)) {
        customElements.define(WINDOW_FRAME_TAG_NAME, WindowFrameElement);
    }
};

export const getShellElementTagName = (shellId: ShellId | string): string => {
    const sid = String(shellId || "unknown").toLowerCase() as ShellId;
    return SHELL_ELEMENT_TAG_ALIAS[sid] || `${SHELL_ELEMENT_TAG_PREFIX}-${sid}`;
};

export const ensureShellElementDefined = (shellId: ShellId | string): string => {
    const tagName = getShellElementTagName(shellId);
    ensureWindowFrameElementDefined();
    if (!customElements.get(tagName)) {
        let ctor = shellElementCtorByTag.get(tagName);
        if (!ctor) {
            const sid = String(shellId || "").toLowerCase();
            ctor =
                sid === "minimal"
                    ? MinimalShellHostElement
                    : sid === "window"
                      ? WindowShellHostElement
                    : class extends ShellElement { };
            shellElementCtorByTag.set(tagName, ctor);
        }
        customElements.define(tagName, ctor);
    }
    return tagName;
};

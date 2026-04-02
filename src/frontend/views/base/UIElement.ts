import type { View, ViewLifecycle, ViewOptions } from "../../shells/types";

const VIEW_ELEMENT_TAG_PREFIX = "cw-view";
const viewElementCtorByTag = new Map<string, CustomElementConstructor>();
const HTMLElementBase = ((globalThis as unknown as { HTMLElement?: typeof HTMLElement }).HTMLElement ?? class { }) as typeof HTMLElement;

type ViewElementLifecycleEvent = "before-mount" | "after-mount" | "before-update" | "after-update";

const dispatchCwViewLifecycle = (
    host: HTMLElement,
    type: ViewElementLifecycleEvent,
    viewId: string | undefined
): void => {
    host.dispatchEvent(
        new CustomEvent("cw-view-lifecycle", {
            bubbles: true,
            composed: true,
            detail: { type, viewId }
        })
    );
};

/**
 * Markdown viewer host: open shadow with mount → shell → view-viewer (toolbar + empty __content) → slots.
 * Raw `<pre slot="raw">` and default-slot prose live in light DOM (assigned nodes).
 */
export class CwViewViewerHostElement extends HTMLElementBase {
    private initialized = false;

    mountView(view: View, options?: ViewOptions): void {
        const isFirstMount = !this.initialized;
        this.dataset.viewId = String(view.id || "");
        this.dataset.cwViewHost = "true";

        dispatchCwViewLifecycle(this, isFirstMount ? "before-mount" : "before-update", view.id);

        const anyView = view as unknown as {
            renderIntoWebComponentHost?: (host: CwViewViewerHostElement, options?: ViewOptions) => void;
        };
        if (typeof anyView.renderIntoWebComponentHost === "function") {
            anyView.renderIntoWebComponentHost(this, options);
        } else {
            console.warn("[cw-view-viewer] View has no renderIntoWebComponentHost; skipping mount.");
        }

        this.initialized = true;
        dispatchCwViewLifecycle(this, isFirstMount ? "after-mount" : "after-update", view.id);
    }
}

export class ViewElement extends HTMLElementBase {
    private innerView: View | null = null;
    private mountRoot: HTMLElement | null = null;
    private initialized = false;

    constructor() {
        super();
    }

    connectedCallback(): void {
        this.ensureMountRoot();
    }

    mountView(view: View, options?: ViewOptions): void {
        const mountRoot = this.ensureMountRoot();
        const isFirstMount = !this.initialized;
        this.innerView = view;
        this.dataset.viewId = String(view.id || "");
        this.dataset.cwViewHost = "true";

        this.dispatchLifecycleEvent(isFirstMount ? "before-mount" : "before-update", view);
        const rendered = view.render(options);
        mountRoot.replaceChildren(rendered);
        this.initialized = true;
        this.dispatchLifecycleEvent(isFirstMount ? "after-mount" : "after-update", view);
    }

    private ensureMountRoot(): HTMLElement {
        if (this.mountRoot && this.mountRoot.isConnected) {
            return this.mountRoot;
        }

        const existing = this.querySelector(":scope > .cw-view-element__mount") as HTMLElement | null;
        if (existing) {
            this.mountRoot = existing;
            return existing;
        }

        const next = document.createElement("div");
        next.className = "cw-view-element__mount";
        this.append(next);
        this.mountRoot = next;
        return next;
    }

    private dispatchLifecycleEvent(type: ViewElementLifecycleEvent, view: View): void {
        this.dispatchEvent(new CustomEvent("cw-view-lifecycle", {
            bubbles: true,
            composed: true,
            detail: {
                type,
                viewId: view.id
            }
        }));
    }
}

const ensureViewElementStyle = (): void => {
    if (document.querySelector('style[data-cw-view-element-style="true"]')) return;
    const style = document.createElement("style");
    style.dataset.cwViewElementStyle = "true";
    style.textContent = `
        [data-cw-view-host="true"] {
            display: block;
            block-size: 100%;
            inline-size: 100%;
            container-type: size;
            contain: strict;
            isolation: isolate;
            overflow: auto;
        }

        [data-cw-view-host="true"] > .cw-view-element__mount {
            display: block;
            block-size: 100%;
            inline-size: 100%;
            container-type: size;
        }

        cw-view-viewer[data-cw-view-host="true"] {
            box-sizing: border-box;
            display: block;
            block-size: 100%;
            inline-size: 100%;
            min-block-size: 0;
            min-inline-size: 0;
            container-type: inline-size;
            contain: layout style paint;
            overflow: hidden;
        }
    `;
    document.head.append(style);
};

export const getViewElementTagName = (viewId: string): string =>
    `${VIEW_ELEMENT_TAG_PREFIX}-${String(viewId || "unknown").toLowerCase()}`;

export const ensureViewElementDefined = (viewId: string): string => {
    const tagName = getViewElementTagName(viewId);
    const ce = (globalThis as unknown as { customElements?: CustomElementRegistry | null }).customElements;
    if (ce && typeof ce.get === "function" && typeof ce.define === "function" && !ce.get(tagName)) {
        let ctor: CustomElementConstructor;
        if (viewId === "viewer") {
            ctor = CwViewViewerHostElement;
        } else {
            ctor = viewElementCtorByTag.get(tagName) ?? class extends ViewElement { };
            if (!viewElementCtorByTag.has(tagName)) {
                viewElementCtorByTag.set(tagName, ctor);
            }
        }
        ce.define(tagName, ctor);
    }
    ensureViewElementStyle();
    return tagName;
};

export interface ViewWebComponentFactory {
    create(options?: ViewOptions): HTMLElement;
}

export const createViewWebComponentFactory = (view: View): ViewWebComponentFactory => {
    let element: (HTMLElement & { mountView(v: View, o?: ViewOptions): void }) | null = null;
    return {
        create(options?: ViewOptions): HTMLElement {
            const tagName = ensureViewElementDefined(String(view.id || "unknown"));
            if (!element) {
                element = document.createElement(tagName) as HTMLElement & {
                    mountView(v: View, o?: ViewOptions): void;
                };
            }
            element.mountView(view, options);
            return element;
        }
    };
};

export const createWebComponentViewAdapter = (view: View): View => {
    const componentFactory = createViewWebComponentFactory(view);
    const lifecycle: ViewLifecycle | undefined = view.lifecycle
        ? {
            onMount: async () => {
                await view.lifecycle?.onMount?.();
            },
            onUnmount: async () => {
                await view.lifecycle?.onUnmount?.();
            },
            onShow: () => {
                view.lifecycle?.onShow?.();
            },
            onHide: () => {
                view.lifecycle?.onHide?.();
            },
            onRefresh: async () => {
                await view.lifecycle?.onRefresh?.();
            }
        }
        : undefined;

    return {
        ...view,
        lifecycle,
        render(options?: ViewOptions): HTMLElement {
            return componentFactory.create(options);
        },
        getToolbar: view.getToolbar ? () => view.getToolbar?.() || null : undefined,
        canHandleMessage: view.canHandleMessage ? (type: string) => Boolean(view.canHandleMessage?.(type)) : undefined,
        handleMessage: view.handleMessage ? (message: unknown) => view.handleMessage?.(message) || Promise.resolve() : undefined
    };
};

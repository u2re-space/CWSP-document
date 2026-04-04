import { defineElement, Q, H, makeClickOutsideTrigger, M, property, registerSidebar } from "fest/lure"
import { preloadStyle } from "fest/dom"
import { $trigger, booleanRef, conditional, observableByMap, propRef, stringRef, affected } from "fest/object"
import { UIElement } from "@fl-ui/base/UIElement"

// @ts-ignore
import styles from "./TabbedSidebar.scss?inline"
const styled = preloadStyle(styles);



//
const renderTabName = (tabName: any) => {
    if (tabName == "home") { return H`<ui-icon icon="house-line"></ui-icon>`; };

    //
    if (typeof tabName != "string") { return tabName; }
    if (tabName == null || tabName == "") return "";

    // split _ as spaces
    tabName = tabName?.replace?.(/_/g, " ") || tabName;

    // capitalize first word letter
    tabName = (tabName?.charAt?.(0)?.toUpperCase?.() + tabName?.slice?.(1)) || tabName;

    //
    return tabName;
}

//
const addPartProperty = (element: HTMLElement | string, name: string = "") => {
    if (typeof element == "string") { return element; }
    if (element instanceof HTMLElement) {
        element?.setAttribute?.(`data-tab`, name);
        element?.setAttribute?.(`part`, "tab");
    }
    return element;
}

//
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

//
const normalizeTabPosition = (value?: string): "top" | "bottom" => {
    const normalized = String(value || "top").trim().toLowerCase();
    return normalized === "bottom" ? "bottom" : "top";
};

//
const parseBooleanOption = (value: unknown): boolean => {
    if (typeof value === "boolean") { return value; }
    if (typeof value === "number") { return value !== 0; }
    if (value == null) { return false; }
    const normalized = String(value).trim().toLowerCase();
    if (!normalized.length) { return true; }
    if (["false", "0", "no", "off", "null", "undefined"].includes(normalized)) { return false; }
    return true;
};


//
class TabChangedEvent extends Event {
    newTab?: string;
    constructor(name, options, newTab) {
        super(name, options);
        this.newTab = newTab;
    }
}

//
class TabCloseEvent extends Event {
    tabName?: string;
    constructor(name, options, tabName) {
        super(name, options);
        this.tabName = tabName;
    }
}

// @ts-ignore
@defineElement("ui-tabbed-with-sidebar")
export class TabbedSidebar extends UIElement {
    @property({ source: "attr", name: "current-tab" }) currentTab?: string = ""; //@ts-ignore
    @property({ source: "attr", name: "tab-position" }) tabPosition?: string = "top"; //@ts-ignore
    @property({ source: "attr", name: "sidebar-drop-menu" }) sidebarAsDropMenu?: string | boolean = null; //@ts-ignore
    @property({ source: "attr", name: "sidebar-opened" }) sidebarOpened?: string | boolean = false; //@ts-ignore
    @property({ source: "attr", name: "toolbar-opened" }) toolbarOpened?: string | boolean = false; //@ts-ignore

    //
    setTabs(tabs: Map<string, HTMLElement | string | any>) {
        const self: any = this;
        self.tabs ??= tabs ?? self.tabs;
    }

    //
    createTab(tabName: string, idx?: number) {
        if (!tabName) return;
        // Never render internal keys as tabs
        if (typeof tabName === "string" && tabName.startsWith("_")) { return; }
        const self: any = this; if (self?.shadowRoot?.querySelector(`[data-tab-name="${tabName}"]`)) return;
        const renderLabel = self?.renderTabName?.bind?.(self) ?? renderTabName;
        const rawLabel = renderLabel?.(tabName) ?? tabName;
        const readableLabel = typeof rawLabel === "string" ? rawLabel : renderTabName?.(String(tabName ?? "")) ?? String(tabName ?? "");

        //
        const tabLabel = H`<span class="ui-tabbed-box-tab-label">${rawLabel}</span>`;
        const closeButton = tabName != "home" ? H`<button type="button" on:click=${(ev: Event) => {
            ev?.preventDefault?.();
            ev?.stopPropagation?.();
            if (ev?.target == ev?.currentTarget) {
                self?.dispatchEvent?.(new TabCloseEvent("tab-close", { bubbles: true, composed: true }, tabName));
            }
        }} class="ui-tabbed-box-tab-close" aria-label=${`Close ${readableLabel}`} part="tab-close">
            <ui-icon icon="x"></ui-icon>
        </button>` : null;

        //
        const tabButton = H`<div on:click=${(ev: Event) => {
            ev?.preventDefault?.();
            ev?.stopPropagation?.();
            if (ev?.target == ev?.currentTarget) {
                self?.openTab?.(tabName, ev);
            }
        }} class="ui-tabbed-box-tab" role="tab" data-tab-name=${tabName}>${tabLabel}${closeButton}</div>`;
        addPartProperty(tabButton, tabName);
        propRef(self as any, "currentTab")?.[$trigger]?.();
        return tabButton; //@ts-ignore
    }

    //
    // Prevent recursive tab operations
    private isOpeningTab = false;
    private openingTabName = "";

    openTab(tabName: string, ev?: any) {
        if (!tabName) return;

        // Prevent recursive calls for the same tab
        if (this.isOpeningTab && this.openingTabName === tabName) {
            return;
        }

        this.isOpeningTab = true;
        this.openingTabName = tabName;

        try {
            const self: any = this;
            if (tabName && tabName != self?.currentTab)
                { self.currentTab = tabName ?? self?.currentTab; }
            self?.dispatchEvent?.(new TabChangedEvent("tab-changed", { bubbles: true, composed: true }, self.currentTab));
        } finally {
            this.isOpeningTab = false;
        }
    }

    //
    constructor() { super(); }
    onInitialize() {
        super.onInitialize?.(); const self = this as any;
        self.removeAttribute("sidebar-opened");
        self.removeAttribute("toolbar-opened");
        self.removeAttribute("sidebar-drop-menu");

        //
        requestAnimationFrame(() => {
            self.removeAttribute("sidebar-drop-menu");
            self.removeAttribute("sidebar-opened");
            self.removeAttribute("toolbar-opened");
        });

        //
        self.addEventListener("keydown", (e: KeyboardEvent) => {
            const target  = e?.composedPath?.()?.[0] as HTMLElement;
            const isInput = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
            if (isInput) { return; }

            //
            if (e?.ctrlKey && (e?.key === "ArrowLeft" || e?.key === "ArrowRight") && self?.checkVisibility({
                contentVisibilityAuto: true,
                opacityProperty: true,
                visibilityProperty: true
            })) {
                e?.preventDefault?.();
                e?.stopPropagation?.();

                //
                const rawTabs = Array.from(self?.tabs?.keys?.() ?? []);
                const tabs = rawTabs?.filter?.(k => k !== "home" && !(typeof k === "string" && k.startsWith("_")));

                //
                const currentIndex = tabs?.indexOf?.(self?.currentTab ?? "");
                let newIndex = currentIndex;

                //
                if (newIndex === -1) { newIndex = 0; }

                //
                if (e?.key === "ArrowLeft") {
                    newIndex = currentIndex - 1;
                    if (newIndex < 0) { newIndex = tabs?.length - 1; }
                } else {
                    newIndex = currentIndex + 1;
                    if (newIndex >= tabs?.length) { newIndex = 0; }
                }

                //
                const newTab = tabs?.[newIndex];
                self?.openTab?.(newTab);
            }
        });
    }

    //
    onRender() {
        const self: any = this;
        const sidebarOpenedRef = propRef(self as any, "sidebarOpened") ?? self.sidebarOpened;

        makeClickOutsideTrigger(
            sidebarOpenedRef,
            Q("button.open-sidebar", self?.shadowRoot),
            Q(".sidebar", self?.shadowRoot)
        );

        //
        Q("a")?.addEventListener?.("click", ()=>{
            self.sidebarOpened = false;
        });

        //
        self.sidebarOpened = false;

        // Register sidebar with back navigation for mobile back gesture support
        const sidebarEl = self?.shadowRoot?.querySelector?.(".sidebar") as HTMLElement;
        if (sidebarEl && sidebarOpenedRef) {
            (sidebarEl as any)._backUnreg = registerSidebar(sidebarEl as HTMLElement, sidebarOpenedRef, () => {
                self.sidebarOpened = false;
            });
        }

        if (!self.tabs || !self.currentTab) return;
        this.observeTabsOverflow?.();
    }

    //
    protected readonly sidebarUniqueId = `tabbed-sidebar-${Math.random().toString(36).slice(2)}`;
    protected tabsBox!: HTMLElement
    protected detachTabsOverflow!: () => void
    protected resizeObserver!: ResizeObserver
    protected observeTabsOverflow() {
        const self: any = this;
        self.tabsBox = self.shadowRoot?.querySelector?.(".ui-tabbed-box-tabs") ?? "";
        if (!self.tabsBox) return;

        self.detachTabsOverflow?.();
        self.resizeObserver?.disconnect();

        const updateIndicators = () => {
            queueMicrotask(() => {
                if (self.tabsBox) {
                    const maxScrollLeft = self.tabsBox.scrollWidth - self.tabsBox.clientWidth;
                    const hasOverflow = maxScrollLeft > 1;
                    const startOverflow = self.tabsBox.scrollLeft > 1;
                    const endOverflow = self.tabsBox.scrollLeft < maxScrollLeft - 1;

                    if (self.tabsBox.hasAttribute("data-scrollable") !== hasOverflow) {
                        self.tabsBox.toggleAttribute("data-scrollable", hasOverflow);
                    }
                    if (self.tabsBox.hasAttribute("data-scrollable-start") !== startOverflow) {
                        self.tabsBox.toggleAttribute("data-scrollable-start", startOverflow);
                    }
                    if (self.tabsBox.hasAttribute("data-scrollable-end") !== endOverflow) {
                        self.tabsBox.toggleAttribute("data-scrollable-end", endOverflow);
                    }
                }
            });
        };

        const onWheel = (event: WheelEvent) => {
            if (Math.abs(event.deltaX) < Math.abs(event.deltaY)) {
                const delta = clamp(event.deltaY, -80, 80);
                self.tabsBox.scrollLeft += delta;
                event.preventDefault();
            }
        };

        const onPointerUp = () => updateIndicators();

        self.tabsBox.addEventListener("wheel", onWheel, { passive: false });
        self.tabsBox.addEventListener("scroll", updateIndicators, { passive: true });
        self.tabsBox.addEventListener("pointerup", onPointerUp, { passive: true });

        self.detachTabsOverflow = () => {
            self.tabsBox.removeEventListener("wheel", onWheel);
            self.tabsBox.removeEventListener("scroll", updateIndicators);
            self.tabsBox.removeEventListener("pointerup", onPointerUp);
        };

        updateIndicators();
        queueMicrotask(updateIndicators);

        if (typeof ResizeObserver !== "undefined") {
            self.resizeObserver = new ResizeObserver(updateIndicators);
            self.resizeObserver.observe(self.tabsBox);
        }
    }

    //
    styles = () => styled;
    render = function () {
        const openedProperty = propRef(this as any, "sidebarOpened") ?? this.sidebarOpened;
        const toolbarOpenedProperty = propRef(this as any, "toolbarOpened") ?? this.toolbarOpened;
        return H`<div part="bar" class="bar">
            <button
                part="open-sidebar"
                class="open-sidebar c2-surface"
                aria-haspopup="menu"
                aria-controls=${this.sidebarUniqueId}
                aria-expanded=${conditional(openedProperty, "true", "false")}
                on:click=${() => { this.sidebarOpened = !this.sidebarOpened; }}
            ><ui-icon icon="${conditional(openedProperty, 'text-outdent', 'list')}"></ui-icon></button>
            <form class="ui-tabbed-box-tabs pinned" part="pinned">${this.createTab("home")}</form>
            <div class="toolbar-slot" toolbar-opened=${conditional(toolbarOpenedProperty, "true", "false")}><slot name="bar"></slot></div>
            <form class="ui-tabbed-box-tabs" part="tabs">${M(observableByMap(this.tabs ?? new Map()), ([key, _], idx) => (key != "home" && (typeof key == "string") && !key.startsWith("_") ? this.createTab(key) : null))}
            </form>

            <button
                type="button"
                part="toggle-toolbar"
                class="toggle-toolbar c2-surface"
                aria-label="Toggle toolbar"
                aria-expanded=${conditional(toolbarOpenedProperty, "true", "false")}
                on:click=${(ev: Event) => {
                    ev?.preventDefault?.();
                    ev?.stopPropagation?.();
                    if (ev?.target == ev?.currentTarget) {
                        this.toolbarOpened = !this.toolbarOpened;
                    }
                }}
            ><ui-icon icon="${conditional(toolbarOpenedProperty, 'caret-right', 'caret-left')}"></ui-icon></button>
        </div>
        <div part="backdrop" class="ui-backdrop"><slot name="backdrop"></slot></div>
        <div part="underlay" class="ui-underlay"><slot name="underlay"></slot></div>
        <div part="content-box" class="content-box">
            <div part="sidebar" class="sidebar" id=${this.sidebarUniqueId} sidebar-opened=${conditional(openedProperty, "true", "false")}><slot name="sidebar"></slot></div>
            <div part="content" class="content"><slot></slot></div>
        </div>`;
    }
}

//
export default TabbedSidebar;

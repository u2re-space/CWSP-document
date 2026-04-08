import { defineElement, H, E, M, I, property } from "fest/lure"
import { preloadStyle } from "fest/dom"
import { $trigger, observableByMap, propRef, affected } from "fest/object";

//
import { UIElement } from "@fl-ui/base/UIElement"

// @ts-ignore
import styles from "./TabbedBox.scss?inline"
const styled = preloadStyle(styles);



//
const renderTabName = (tabName: any) => {
    if (typeof tabName != "string") { return tabName; }
    if (tabName == null || tabName == "") { return ""; }

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
        element?.setAttribute?.(`tab`, name);
        element?.setAttribute?.(`part`, "tab");
    }
    return element;
}

//
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

//
class TabChangedEvent extends Event {
    newTab?: string;
    constructor(name, options, newTab) {
        super(name, options);
        this.newTab = newTab;
    }
}


//
const normalizeOrient = (value?: string | number): 0 | 2 => {
    if (typeof value === "number") {
        const numeric = Number.isFinite(value) ? Math.trunc(value) : 0;
        return numeric === 2 ? 2 : 0;
    }
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (!normalized.length) { return 0; }
        if (normalized === "2" || normalized === "top") { return 2; }
        if (normalized === "0" || normalized === "bottom") { return 0; }
        const parsed = Number.parseInt(normalized, 10);
        if (Number.isFinite(parsed) && parsed === 2) { return 2; }
        return 0;
    }
    return 0;
}

// @ts-ignore
@defineElement("ui-tabbed-box")
export class TabbedBox extends UIElement {
    @property({ source: "attr", name: "current-tab" }) currentTab?: string = "";
    @property({ source: "attr", name: "orient" }) orient?: string | number = 1;

    //
    constructor() { super(); const self: any = this; self.currentTab ??= ""; }
    onInitialize() {
        const self: any = this;
        super.onInitialize?.();

        //
        self.currentTab ||= [...self?.tabs?.keys?.() ?? []]?.[0] || "";

        //
        E(self, {}, [I({ current: propRef(self as any, "currentTab"), mapped: self.tabs })])

        //
        affected(propRef(self as any, "currentTab"), (_newVal)=>{
            self.dispatchEvent(new TabChangedEvent("tab-changed", { bubbles: true }, self.currentTab));
        });

        //
        /*requestAnimationFrame(() => {
            self.setAttribute("orient", "1");
        });*/

        //
        self.addEventListener("keydown", (e: KeyboardEvent) => {
            const target  = e?.composedPath?.()?.[0] as HTMLElement;
            const isInput = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
            if (isInput) { return; }

            //
            if ((e?.key === "ArrowLeft" || e?.key === "ArrowRight") && self?.checkVisibility({
                contentVisibilityAuto: true,
                opacityProperty: true,
                visibilityProperty: true
            })) {
                e?.preventDefault?.();
                e?.stopPropagation?.();

                //
                const tabs = Array.from(self?.tabs?.keys?.() ?? []);
                if (!tabs?.length) { return; }

                //
                const currentIndex = tabs?.indexOf?.(self?.currentTab ?? "");
                let newIndex = currentIndex;

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
    setTabs(tabs: Map<string, HTMLElement | string | any>) {
        const self: any = this;
        self.tabs ??= tabs ?? self.tabs;
    }

    //
    onRender() {
        const self: any = this;
        if (!self.tabs || !self.currentTab) return;
        this.observeTabsOverflow?.();
    }

    //
    createTab(tabName: string, idx?: number) {
        if (!tabName) return;
        const self: any = this;
        const tabLabel  = H`<span part="tab-label" class="ui-tabbed-box-tab-label">${(self?.renderTabName?.bind?.(self) ?? renderTabName)?.(tabName) ?? tabName}</span>`;
        const tabButton = H`<button part="tab" slot="tabs" type="button" on:click=${(ev: Event)=>self.openTab(tabName, ev)} class="ui-tabbed-box-tab" role="tab" tab-name=${tabName} tab-index=${idx}>${tabLabel}</button>`;
        addPartProperty(tabButton, tabName);
        propRef(self as any, "currentTab")?.[$trigger]?.();
        return tabButton; //@ts-ignore
    }

    //
    openTab(tabName: string, ev?: any) {
        if (!tabName) return;
        const self: any = this;
        if (tabName) {
            const btn = self.shadowRoot?.querySelector(`[tab-name="${tabName}"]`);
            if (btn instanceof HTMLElement) (btn as HTMLElement)?.focus?.();

            //
            self.currentTab = tabName ?? self.currentTab;
            self.dispatchEvent(new TabChangedEvent("tab-changed", { bubbles: true }, self.currentTab));
        }
    }

    //
    styles = () => styled;
    render = function () {
        const self: any = this;
        const root = H`
        <div class="ui-tabbed-box-tabs-container"><form class="ui-tabbed-box-tabs" part="tabs">${M(observableByMap(self.tabs ?? new Map()), ([key, _], idx) => this.createTab(key, idx))}</form></div>
        <div class="ui-tabbed-box-content" part="content"><slot></slot></div>`
        return root;
    }

    //
    private tabsBox?: HTMLElement
    private detachTabsOverflow?: () => void
    private resizeObserver?: ResizeObserver
    private observeTabsOverflow() {
        const self: any = this;
        this.tabsBox = self.shadowRoot?.querySelector?.(".ui-tabbed-box-tabs") ?? undefined;
        const tabsBox = this.tabsBox;
        if (!tabsBox) return;

        this.detachTabsOverflow?.();
        this.resizeObserver?.disconnect();

        const updateIndicators = () => {
            queueMicrotask(() => {
                if (tabsBox) {
                    const maxScrollLeft = tabsBox.scrollWidth - tabsBox.clientWidth;
                    const hasOverflow = maxScrollLeft > 1;
                    const startOverflow = tabsBox.scrollLeft > 1;
                    const endOverflow = tabsBox.scrollLeft < maxScrollLeft - 1;

                    if (tabsBox.hasAttribute("scrollable") !== hasOverflow) {
                        tabsBox.toggleAttribute("scrollable", hasOverflow);
                    }
                    if (tabsBox.hasAttribute("scrollable-start") !== startOverflow) {
                        tabsBox.toggleAttribute("scrollable-start", startOverflow);
                    }
                    if (tabsBox.hasAttribute("scrollable-end") !== endOverflow) {
                        tabsBox.toggleAttribute("scrollable-end", endOverflow);
                    }
                }
            });
        };

        const onWheel = (event: WheelEvent) => {
            if (Math.abs(event.deltaX) < Math.abs(event.deltaY)) {
                const delta = clamp(event.deltaY, -80, 80);
                tabsBox.scrollLeft += delta;
                event.preventDefault();
            }
        };

        const onPointerUp = () => updateIndicators();

        tabsBox.addEventListener("wheel", onWheel, { passive: false });
        tabsBox.addEventListener("scroll", updateIndicators, { passive: true });
        tabsBox.addEventListener("pointerup", onPointerUp, { passive: true });

        this.detachTabsOverflow = () => {
            tabsBox.removeEventListener("wheel", onWheel);
            tabsBox.removeEventListener("scroll", updateIndicators);
            tabsBox.removeEventListener("pointerup", onPointerUp);
        };

        updateIndicators();
        queueMicrotask(updateIndicators);

        if (typeof ResizeObserver !== "undefined") {
            this.resizeObserver = new ResizeObserver(updateIndicators);
            this.resizeObserver.observe(tabsBox);
        }
    }
}

//
export default TabbedBox;

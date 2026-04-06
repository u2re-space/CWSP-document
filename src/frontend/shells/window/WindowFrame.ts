import { defineElement, property, H, E, DragHandler, ResizeHandler, ITask  } from "fest/lure";
import { handleAttribute, preloadStyle, setStyleProperty } from "fest/dom";

//
import { UIElement } from "@fl-ui/base/UIElement";
import { TaskStateReflect } from "@fl-ui/navigation/misc/TaskStateReflect";

// @ts-ignore
import styles from "./WindowFrame.scss?inline"
const styled  = preloadStyle(styles);



// @ts-ignore
@defineElement("ui-window-frame")
export class WindowFrame extends UIElement {
    /* Attributes */
    @property({ source: "attr", name: "name" }) name?: string = "";
    @property({ source: "attr", name: "icon" }) icon?: string = "app-window";
    @property({ source: "attr", name: "title" }) title?: string = "WINDOW_FRAME_TITLE";
    @property({ source: "attr", name: "subtitle" }) subtitle?: string = "WINDOW_FRAME_SUBTITLE";

    /* Public Attributes */
    @property({ source: "attr", name: "close-icon" }) closeIcon?: string = "x";
    @property({ source: "attr", name: "minimize-icon" }) minimizeIcon?: string = "minus";
    @property({ source: "attr", name: "maximize-icon" }) maximizeIcon?: string = "corners-out";

    /* Shadow DOM Elements */
    @property({ source: "query-shadow", name: ".ui-window-frame-content" }) contentEl?: HTMLElement;
    @property({ source: "query-shadow", name: ".ui-window-frame-titlebar" }) titlebarEl?: HTMLElement;
    @property({ source: "query-shadow", name: ".ui-window-frame-titlebar-handle" }) titlebarHandleEl?: HTMLElement;
    @property({ source: "query-shadow", name: ".ui-window-frame-titlebar-app-icon" }) appIconEl?: HTMLSpanElement;
    @property({ source: "query-shadow", name: ".ui-window-frame-resize-handle" }) resizeHandleEl?: HTMLElement;
    @property({ source: "query-shadow", name: ".ui-window-frame-titlebar-title-text" }) titleTextEl?: HTMLSpanElement;
    @property({ source: "query-shadow", name: ".ui-window-frame-titlebar-title-text-sub" }) titleTextSubEl?: HTMLSpanElement;
    @property({ source: "query-shadow", name: ".ui-window-frame-titlebar-control-close" }) closeEl?: HTMLButtonElement;
    @property({ source: "query-shadow", name: ".ui-window-frame-titlebar-control-minimize" }) minimizeEl?: HTMLButtonElement;
    @property({ source: "query-shadow", name: ".ui-window-frame-titlebar-control-maximize" }) maximizeEl?: HTMLButtonElement;

    //
    task: ITask|null = null;
    reflect?: TaskStateReflect|null;

    //
    constructor() { super(); }
    onInitialize() {
        super.onInitialize();  // @ts-ignore
        new DragHandler(this as any, { handler: this.titlebarHandleEl });  // @ts-ignore
        new ResizeHandler(this as any, { handler: this.resizeHandleEl });
        E(this as any, { classList: new Set(["c2-surface"]) })

        //
        const self: any = this;
        const weak = new WeakRef(self);

        //
        const withDispatch = (name)=>((ev)=>{
            ev.preventDefault();
            weak.deref?.().dispatchEvent(new CustomEvent(name, { bubbles: true, cancelable: true, }));
        })

        //
        this.closeEl?.addEventListener("click", withDispatch("close"));
        this.minimizeEl?.addEventListener("click", withDispatch("minimize"));
        this.maximizeEl?.addEventListener("click", withDispatch("maximize"));

        //
        self.addEventListener("maximize", ()=>{ handleAttribute(self, "data-maximized", self.getAttribute("data-maximized") != null ? false : true); });
        self.setAttribute("data-dragging", "");

        //
        //this.doCenter();
        this.bindWithTask();
    }



    //
    bindWithTask(task: ITask|null = null) {
        if (this.task != task) {
            if (this.task && task) { this.reflect?.unbind(); this.reflect = null; this.task = null; }
            if (this.task = task ?? this.task) { this.reflect ??= new TaskStateReflect(this.task, this as any); this.reflect?.bind(this as any); }
        }
        return this;
    }

    //
    onRender() {
        // @ts-ignore
        super.onRender(); //this.doCenter();
        queueMicrotask(()=>{ this.doCenter(); });
    }

    //
    doCenter () {
        const holder: any = this;
        const box = holder.getBoundingClientRect();
        const parent = holder.parentElement;
        const parentBox = parent?.getBoundingClientRect();
        const cX = (parentBox?.width || 0) / 2 - (box?.width || 0) / 2;
        const cY = (parentBox?.height || 0) / 2 - (box?.height || 0) / 2;
        setStyleProperty(holder, "--shift-x", cX - (parentBox?.left || 0));
        setStyleProperty(holder, "--shift-y", cY - (parentBox?.top || 0));
        holder.removeAttribute("data-dragging");
    }

    //
    styles = function () { return styled; }
    render = function () { return H`
        <div class="ui-window-frame-titlebar" part="titlebar">
            <span class="ui-window-frame-titlebar-handle" part="handle">
                <span class="ui-window-frame-titlebar-app-icon" part="app-icon">
                    <ui-icon name="window-frame-app-icon" icon=${this.icon ?? "window-frame-app-icon"}></ui-icon>
                </span>
                <span class="ui-window-frame-titlebar-title-text" part="title-text">
                    ${this.title || H`<slot name="title"></slot>`}
                </span>
                <span class="ui-window-frame-titlebar-title-text-sub" part="title-text-sub">
                    ${this.subtitle || H`<slot name="subtitle"></slot>`}
                </span>
            </span>
            <span class="ui-window-frame-titlebar-controls" part="controls">
                <button class="ui-window-frame-titlebar-control-minimize" part="control-minimize">
                    <ui-icon name="window-frame-minimize" icon=${this.minimizeIcon ?? "minus"}></ui-icon>
                </button>
                <button class="ui-window-frame-titlebar-control-maximize" part="control-maximize">
                    <ui-icon name="window-frame-maximize" icon=${this.maximizeIcon ?? "corners-out"}></ui-icon>
                </button>
                <button class="ui-window-frame-titlebar-control-close" part="control-close">
                    <ui-icon name="window-frame-close" icon=${this.closeIcon ?? "x"}></ui-icon>
                </button>
            </span>
        </div>
        <div class="ui-window-frame-content ui-window-frame-anchor-box" part="content">
            <slot></slot>
        </div>
        <span class="ui-window-frame-resize-handle" part="resize-handle"></span>`; }
}

//
export default WindowFrame;

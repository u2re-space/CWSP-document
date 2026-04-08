import { defineElement, Q, H, makeClickOutsideTrigger, registerSidebar } from "fest/lure"
import { preloadStyle } from "fest/dom"
import { booleanRef, conditional, affected } from "fest/object"
import { UIElement } from "@fl-ui/base/UIElement"

/*
 * Used for mobile applications
 * In desktop or widescreen sidebar can be statically visible
 * In mobile applications sidebar is hidden by default and can be opened by clicking on the button
 *
 * <ui-box-with-sidebar>
 *   <div slot="bar">
 *     <button part="open-sidebar" class="open-sidebar" on:click=${()=>{this.sidebarOpened.value = true;}}></button>
 *     <button class="open-sidebar" on:click=${()=>{this.sidebarOpened.value = true;}}></button>
 *     <slot name="bar"></slot>
 *   </div>
 *   <div part="sidebar" class="sidebar c2-surface" visibility="${this.sidebarOpened}"><slot name="sidebar"></slot></div>
 *   <div part="content" class="content"><slot></slot></div>
 * </ui-box-with-sidebar>
 */

// @ts-ignore
import styles from "./BoxWithSidebar.scss?inline"
const styled = preloadStyle(styles);

// @ts-ignore
@defineElement("ui-box-with-sidebar")
export class BoxWithSidebar extends UIElement {
    sidebarOpened = booleanRef(false); //@ts-ignore

    //
    constructor() { super(); }
    onInitialize() { super.onInitialize?.(); }
    onRender() {
        const self: any = this;
        makeClickOutsideTrigger(self.sidebarOpened, Q("button", self?.shadowRoot), Q(".sidebar", self?.shadowRoot));

        //
        Q("a")?.addEventListener?.("click", ()=>{
            self.sidebarOpened.value = false;
        });

        //
        self.sidebarOpened.value = false;

        // Register sidebar with back navigation for mobile back gesture support
        /*const sidebarEl = Q(".sidebar", self?.shadowRoot);
        if (sidebarEl) {
            registerSidebar(sidebarEl as HTMLElement, self.sidebarOpened);
        }*/
    }

    //
    styles = () => styled;
    render = function () {
        return H`<div part="bar" class="bar c2-surface"><button part="open-sidebar" class="open-sidebar c2-surface" on:click=${() => { this.sidebarOpened.value = !this.sidebarOpened.value; }}><ui-icon icon="${conditional(this.sidebarOpened, 'text-outdent', 'list')}"></ui-icon></button><slot name="bar"></slot></div>
    <div part="content-box" class="content-box"><div part="sidebar" class="sidebar" data-visible=${this.sidebarOpened}><slot name="sidebar"></slot></div><div part="content" class="content"><slot></slot></div></div>`;
    }
}

//
export default BoxWithSidebar;

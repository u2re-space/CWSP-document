/**
 * Desktop-style window frame web component.
 *
 * It exposes a title bar, window action events, and drag/resize behavior for
 * shells that render views inside movable process-like windows.
 */
import { defineElement, property, H } from "fest/lure";
import { preloadStyle } from "fest/dom";
import { UIElement } from "@fl-ui/base/UIElement";

// @ts-ignore
import styles from "./WindowFrame.scss?inline";
const styled = preloadStyle(styles);

@defineElement("cw-window-frame-v2")
/** Window shell frame element with built-in drag/resize interaction. */
export class WindowFrameV2 extends UIElement {
    @property({ source: "attr", name: "data-title" }) windowTitle: string = "Window";
    @property({ source: "attr", name: "data-pid" }) windowPid: string = "";

    @property({ source: "query-shadow", name: "[data-title]" }) titleEl?: HTMLElement;
    @property({ source: "query-shadow", name: "[data-pid]" }) pidEl?: HTMLElement;
    @property({ source: "query-shadow", name: "[data-drag-handle]" }) dragHandle?: HTMLElement;
    @property({ source: "query-shadow", name: "[data-resize-handle]" }) resizeHandle?: HTMLElement;

    private _initialized = false;

    constructor() {
        super();
    }

    onRender() {
        super.onRender();

        if (this._initialized) return;
        this._initialized = true;

        const self = this as unknown as HTMLElement;

        // Bind window action buttons
        this.shadowRoot?.querySelectorAll("[data-window-action]").forEach((button) => {
            button.addEventListener("click", (event) => {
                const action = (event.currentTarget as HTMLElement).dataset.windowAction || "";
                this.dispatchEvent(new CustomEvent("window-action", { detail: { action }, bubbles: true }));
            });
        });

        // Initialize drag and resize
        if (this.dragHandle) this.initDrag(self, this.dragHandle);
        if (this.resizeHandle) this.initResize(self, this.resizeHandle);

        this.setTitle(this.windowTitle || "Window");
        this.setPidLabel(this.windowPid || "");
    }

    setTitle(title: string): void {
        this.windowTitle = title;
        if (this.titleEl) this.titleEl.textContent = title;
    }

    setPidLabel(pid: string): void {
        this.windowPid = pid;
        if (this.pidEl) this.pidEl.textContent = pid ? `#${pid}` : "";
    }

    /** Wire title-bar dragging while clamping movement to the visible parent stage. */
    private initDrag(frame: HTMLElement, handle: HTMLElement): void {
        handle.addEventListener("pointerdown", (event: PointerEvent) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest("[data-window-action]")) return;
            if (frame.classList.contains("is-maximized")) return;
            
            event.preventDefault();
            const pointerId = event.pointerId;
            handle.setPointerCapture(pointerId);
            frame.setAttribute("data-dragging", "");

            const startX = event.clientX;
            const startY = event.clientY;
            
            const rect = frame.getBoundingClientRect();
            const parent = frame.offsetParent as HTMLElement || document.body;
            const parentRect = parent.getBoundingClientRect();
            
            const stageW = parent.clientWidth || globalThis.innerWidth || 1920;
            const stageH = parent.clientHeight || globalThis.innerHeight || 1080;
            
            const frameW = rect.width;
            const frameH = rect.height;
            
            const currentShiftX = rect.left - parentRect.left;
            const currentShiftY = rect.top - parentRect.top;
            
            const minX = 0;
            const minY = 0;
            const maxX = Math.max(minX, stageW - frameW);
            const maxY = Math.max(minY, stageH - frameH);

            const onMove = (moveEvent: PointerEvent) => {
                const dx = moveEvent.clientX - startX;
                const dy = moveEvent.clientY - startY;
                const newX = Math.min(maxX, Math.max(minX, currentShiftX + dx));
                const newY = Math.min(maxY, Math.max(minY, currentShiftY + dy));
                frame.style.setProperty("--drag-x", `${newX - currentShiftX}px`);
                frame.style.setProperty("--drag-y", `${newY - currentShiftY}px`);
            };

            const onEnd = (endEvent: PointerEvent) => {
                if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
                handle.removeEventListener("pointermove", onMove);
                handle.removeEventListener("pointerup", onEnd);
                handle.removeEventListener("pointercancel", onEnd);
                frame.removeAttribute("data-dragging");

                const dx = endEvent.clientX - startX;
                const dy = endEvent.clientY - startY;
                const newX = Math.min(maxX, Math.max(minX, currentShiftX + dx));
                const newY = Math.min(maxY, Math.max(minY, currentShiftY + dy));
                frame.style.setProperty("--shift-x", `${newX}px`);
                frame.style.setProperty("--shift-y", `${newY}px`);
                frame.style.setProperty("--drag-x", "0px");
                frame.style.setProperty("--drag-y", "0px");
            };

            handle.addEventListener("pointermove", onMove);
            handle.addEventListener("pointerup", onEnd);
            handle.addEventListener("pointercancel", onEnd);
        });
    }

    /** Wire corner-resize interaction while preserving minimum and stage-bounded size. */
    private initResize(frame: HTMLElement, handle: HTMLElement): void {
        handle.addEventListener("pointerdown", (event: PointerEvent) => {
            event.preventDefault();
            const pointerId = event.pointerId;
            handle.setPointerCapture(pointerId);
            frame.setAttribute("data-resizing", "");

            const rect = frame.getBoundingClientRect();
            const startW = rect.width;
            const startH = rect.height;
            const startX = event.clientX;
            const startY = event.clientY;
            
            const computed = getComputedStyle(frame);
            const minW = parseFloat(computed.minInlineSize) || 640;
            const minH = parseFloat(computed.minBlockSize) || 480;
            
            const parent = frame.offsetParent as HTMLElement || document.body;
            const parentRect = parent.getBoundingClientRect();
            
            const currentShiftX = rect.left - parentRect.left;
            const currentShiftY = rect.top - parentRect.top;
            
            const stageW = parent.clientWidth || globalThis.innerWidth || 1920;
            const stageH = parent.clientHeight || globalThis.innerHeight || 1080;
            
            const maxW = Math.max(minW, stageW - currentShiftX);
            const maxH = Math.max(minH, stageH - currentShiftY);

            const onMove = (moveEvent: PointerEvent) => {
                const dx = moveEvent.clientX - startX;
                const dy = moveEvent.clientY - startY;
                
                const clampedDx = Math.min(maxW - startW, Math.max(minW - startW, dx));
                const clampedDy = Math.min(maxH - startH, Math.max(minH - startH, dy));
                
                frame.style.setProperty("--resize-x", `${clampedDx}px`);
                frame.style.setProperty("--resize-y", `${clampedDy}px`);
            };

            const onEnd = (endEvent: PointerEvent) => {
                if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
                handle.removeEventListener("pointermove", onMove);
                handle.removeEventListener("pointerup", onEnd);
                handle.removeEventListener("pointercancel", onEnd);
                frame.removeAttribute("data-resizing");

                const dx = endEvent.clientX - startX;
                const dy = endEvent.clientY - startY;
                const clampedDx = Math.min(maxW - startW, Math.max(minW - startW, dx));
                const clampedDy = Math.min(maxH - startH, Math.max(minH - startH, dy));
                
                const nextW = startW + clampedDx;
                const nextH = startH + clampedDy;
                
                frame.style.setProperty("--initial-inline-size", `${nextW}px`);
                frame.style.setProperty("--initial-block-size", `${nextH}px`);
                frame.style.setProperty("--resize-x", "0px");
                frame.style.setProperty("--resize-y", "0px");
            };

            handle.addEventListener("pointermove", onMove);
            handle.addEventListener("pointerup", onEnd);
            handle.addEventListener("pointercancel", onEnd);
        });
    }

    styles = function () { return styled; }
    
    render = function () { 
        return H`
            <div class="window-frame-wrapper" style="display: contents;">
                <div class="frame">
                    <div class="bar" data-drag-handle>
                        <span class="title" data-title></span>
                        <span class="pid" data-pid></span>
                        <span class="btns">
                            <button type="button" data-window-action="popout" title="Open in new tab">&#8599;</button>
                            <button type="button" data-window-action="minimize" title="Minimize">&minus;</button>
                            <button type="button" data-window-action="maximize" title="Maximize">&#9633;</button>
                            <button type="button" data-window-action="close" title="Close">&#10005;</button>
                        </span>
                    </div>
                    <div class="content">
                        <slot name="window-view"></slot>
                    </div>
                </div>
                <span class="resize" data-resize-handle></span>
            </div>
        `; 
    }
}

export default WindowFrameV2;
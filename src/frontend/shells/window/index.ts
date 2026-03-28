/**
 * Window Shell
 *
 * Desktop-like shell with process windows (pID), hash-focus support,
 * and frame controls (drag, resize, minimize, close).
 */

import { H } from "fest/lure";
import type { ShellId, ShellLayoutConfig, ViewId } from "../types";
import { ShellBase } from "../shell";
import { isEnabledView } from "../../config/views";
import type { WindowFrameElement } from "../UIElement";

// @ts-ignore - SCSS import
import style from "./frame.scss?inline";

type WindowState = "open" | "minimized" | "hidden";

interface WindowProcess {
    pid: string;
    viewId: ViewId;
    params?: Record<string, string>;
    state: WindowState;
    frame: HTMLElement;
    body: HTMLElement | null;
    frameEl: WindowFrameElement | null;
    dockItem: HTMLButtonElement;
}

const toTitle = (viewId: ViewId): string => {
    const raw = String(viewId || "view").trim();
    if (!raw) return "View";
    return raw.charAt(0).toUpperCase() + raw.slice(1);
};

const sanitizePid = (value: string): string => value.replace(/[^a-z0-9_-]/gi, "");

export class WindowShell extends ShellBase {
    id: ShellId = "window";
    name = "Window";

    layout: ShellLayoutConfig = {
        hasSidebar: false,
        hasToolbar: false,
        hasTabs: false,
        supportsMultiView: true,
        supportsWindowing: true
    };

    private stageElement: HTMLElement | null = null;
    private dockElement: HTMLElement | null = null;
    private homeFrameElement: HTMLElement | null = null;
    private processes = new Map<string, WindowProcess>();
    private zCounter = 10;
    private pidCounter = 0;
    private activePid: string | null = null;
    private popstateHandler: ((event: PopStateEvent) => void) | null = null;
    private hashHandler: (() => void) | null = null;
    private openRequestHandler: ((event: Event) => void) | null = null;

    protected createLayout(): HTMLElement {
        return H`
            <div class="app-window-shell" data-shell="window">
                <main class="app-window-shell__stage" data-shell-content role="main"></main>
                <cw-shell-dock class="app-window-shell__dock" data-window-dock aria-label="Window dock"></cw-shell-dock>
                <div class="app-window-shell__status" data-shell-status hidden aria-live="polite"></div>
            </div>
        ` as HTMLElement;
    }

    protected getStylesheet(): string | null {
        return style;
    }

    async mount(container: HTMLElement): Promise<void> {
        await super.mount(container);
        this.stageElement = this.rootElement?.querySelector("[data-shell-content]") as HTMLElement | null;
        this.homeFrameElement = this.rootElement?.querySelector("[data-window-home-frame]") as HTMLElement | null;
        this.dockElement = this.rootElement?.shadowRoot?.querySelector("[data-window-dock]") as HTMLElement | null;

        this.bindBrowserNavigation();
        await this.syncInitialRoute();
    }

    unmount(): void {
        if (this.popstateHandler) {
            globalThis?.removeEventListener?.("popstate", this.popstateHandler);
            this.popstateHandler = null;
        }
        if (this.hashHandler) {
            globalThis?.removeEventListener?.("hashchange", this.hashHandler);
            this.hashHandler = null;
        }
        if (this.openRequestHandler) {
            globalThis?.removeEventListener?.("cw:view-open-request", this.openRequestHandler);
            this.openRequestHandler = null;
        }
        this.processes.clear();
        this.activePid = null;
        super.unmount();
    }

    async navigate(viewId: ViewId, params?: Record<string, string>): Promise<void> {
        if (!isEnabledView(String(viewId))) {
            this.showMessage(`Unknown view: ${String(viewId)}`);
            return;
        }

        if (viewId === "home") {
            await this.mountHomeSurface(params);
            this.navigationState.previousView = this.navigationState.currentView;
            this.navigationState.currentView = "home";
            this.navigationState.params = params;
            this.currentView.value = "home";
            this.activePid = null;
            this.updateUrlState("home", null, params, false);
            return;
        }

        const pid = await this.openWindowProcess(viewId, params);
        const proc = this.processes.get(pid);
        if (!proc) return;
        this.focusProcess(proc.pid, true);
    }

    private async syncInitialRoute(): Promise<void> {
        const state = (globalThis?.history?.state || {}) as {
            viewId?: ViewId;
            pid?: string;
            params?: Record<string, string>;
        };
        const pathname = (globalThis?.location?.pathname || "").replace(/^\/+|\/+$/g, "").toLowerCase();
        const fromPath = pathname && isEnabledView(pathname) ? (pathname as ViewId) : null;
        const fromState = state?.viewId && isEnabledView(String(state.viewId)) ? state.viewId : null;
        const initialView = fromState || fromPath || "home";
        await this.navigate(initialView, state?.params);

        const hashPid = sanitizePid((globalThis?.location?.hash || "").replace(/^#/, ""));
        if (hashPid) {
            this.focusProcess(hashPid, false);
        }
    }

    private bindBrowserNavigation(): void {
        this.popstateHandler = (event: PopStateEvent) => {
            const state = (event.state || {}) as {
                viewId?: ViewId;
                pid?: string;
                params?: Record<string, string>;
            };
            const viewId = state?.viewId && isEnabledView(String(state.viewId)) ? state.viewId : "home";
            void this.navigate(viewId, state?.params).then(() => {
                if (state?.pid) {
                    this.focusProcess(state.pid, false);
                }
            });
        };
        globalThis?.addEventListener?.("popstate", this.popstateHandler);

        this.hashHandler = () => {
            const pid = sanitizePid((globalThis?.location?.hash || "").replace(/^#/, ""));
            if (!pid) return;
            this.focusProcess(pid, false);
        };
        globalThis?.addEventListener?.("hashchange", this.hashHandler);

        this.openRequestHandler = (event: Event) => {
            const detail = (event as CustomEvent).detail as {
                viewId?: ViewId;
                target?: string;
                params?: Record<string, string>;
                pid?: string | null;
            };
            const viewId = detail?.viewId ? String(detail.viewId).toLowerCase() : "";
            if (!viewId || !isEnabledView(viewId)) return;
            const params = { ...(detail?.params || {}) };
            if (detail?.pid) params.pid = String(detail.pid);
            void this.navigate(viewId as ViewId, params);
        };
        globalThis?.addEventListener?.("cw:view-open-request", this.openRequestHandler);
    }

    private async mountHomeSurface(params?: Record<string, string>): Promise<void> {
        if (!this.homeFrameElement) {
            this.homeFrameElement = H`
                <cw-window-frame
                    class="app-window-shell__frame app-window-shell__frame--home"
                    data-window-home-frame
                    data-title="Settings"
                    data-pid="home"
                    style="left:40px;top:32px;width:min(920px,calc(100% - 80px));height:min(640px,calc(100% - 96px));z-index:2;"
                >
                </cw-window-frame>
            ` as HTMLElement;
            this.homeFrameElement.slot = "window-frame";
            this.rootElement?.appendChild(this.homeFrameElement);
        }
        // Temporary test target requested by user: mount settings inside cw-window-frame.
        const homeEl = await this.loadView("settings", params);
        homeEl.dataset.view = "settings";
        homeEl.classList.add("app-window-shell__home-view");
        homeEl.slot = "window-view";
        for (const child of Array.from(this.homeFrameElement.children)) {
            const childEl = child as HTMLElement;
            if (childEl.slot === "window-view") {
                childEl.remove();
            }
        }
        this.homeFrameElement.appendChild(homeEl);
        this.homeFrameElement.hidden = false;
    }

    private async openWindowProcess(viewId: ViewId, params?: Record<string, string>): Promise<string> {
        if (!this.stageElement || !this.dockElement) {
            throw new Error("[window] Shell stage is not mounted");
        }

        const requestedPid = sanitizePid(String(params?.pid || ""));
        if (requestedPid && this.processes.has(requestedPid)) {
            const existing = this.processes.get(requestedPid)!;
            existing.state = "open";
            existing.frame.hidden = false;
            return existing.pid;
        }

        for (const proc of this.processes.values()) {
            if (proc.viewId === viewId && proc.state !== "hidden") {
                proc.params = params;
                proc.state = "open";
                proc.frame.hidden = false;
                return proc.pid;
            }
        }

        const pid = requestedPid || this.generatePid(viewId);
        const frame = this.createFrame(pid, viewId);
        const frameEl = frame as unknown as WindowFrameElement;
        const dockItem = this.createDockItem(pid, viewId);
        const element = await this.loadView(viewId, params);
        element.dataset.view = String(viewId);
        element.slot = "window-view";
        for (const child of Array.from(frame.children)) {
            const childEl = child as HTMLElement;
            if (childEl.slot === "window-view") {
                childEl.remove();
            }
        }
        frame.appendChild(element);
        frameEl?.setTitle?.(toTitle(viewId));
        frameEl?.setPidLabel?.(pid);

        frame.slot = "window-frame";
        this.rootElement?.appendChild(frame);
        this.dockElement.appendChild(dockItem);

        const proc: WindowProcess = {
            pid,
            viewId,
            params,
            state: "open",
            frame,
            body: null,
            frameEl,
            dockItem
        };
        this.processes.set(pid, proc);
        this.installWindowInteractions(proc);
        this.mountHomeSurface().catch(() => undefined);
        return pid;
    }

    private createFrame(pid: string, viewId: ViewId): HTMLElement {
        const title = toTitle(viewId);
        const offset = 32 * Math.min(this.processes.size, 6);
        const frame = H`
            <cw-window-frame
                class="app-window-shell__frame"
                data-window-frame
                data-pid="${pid}"
                data-title="${title}"
                style="left:${96 + offset}px;top:${72 + offset}px;width:780px;height:520px;z-index:${this.zCounter};"
            >
            </cw-window-frame>
        ` as HTMLElement;
        return frame;
    }

    private createDockItem(pid: string, viewId: ViewId): HTMLButtonElement {
        return H`
            <button type="button" class="app-window-shell__dock-item" data-window-dock-item data-pid="${pid}">
                <span>${toTitle(viewId)}</span>
                <small>#${pid}</small>
            </button>
        ` as HTMLButtonElement;
    }

    private installWindowInteractions(proc: WindowProcess): void {
        const { frame, dockItem } = proc;
        const frameEl = frame as unknown as WindowFrameElement;
        const dragHandle = frameEl?.getDragHandle?.() || null;
        const resizeHandle = frameEl?.getResizeHandle?.() || null;

        frame.addEventListener("pointerdown", () => this.focusProcess(proc.pid, true));
        dockItem.addEventListener("click", () => {
            proc.state = "open";
            proc.frame.hidden = false;
            this.focusProcess(proc.pid, true);
        });

        frame.addEventListener("window-action", (event) => {
            const action = (event as CustomEvent<{ action?: string }>).detail?.action;
            if (!action) return;
            if (action === "minimize") {
                proc.state = "minimized";
                proc.frame.hidden = true;
                proc.frame.classList.remove("is-active");
                proc.dockItem.classList.remove("is-active");
                if (this.activePid === proc.pid) {
                    this.activePid = null;
                    this.updateUrlState(this.navigationState.currentView, null, proc.params, true);
                }
            }
            if (action === "close") {
                proc.state = "hidden";
                proc.frame.remove();
                proc.dockItem.remove();
                this.processes.delete(proc.pid);
                if (this.activePid === proc.pid) {
                    this.activePid = null;
                    void this.navigate("home");
                }
            }
        });

        if (dragHandle) {
            this.installDrag(frame, dragHandle);
        }
        if (resizeHandle) {
            this.installResize(frame, resizeHandle);
        }
    }

    private installDrag(frame: HTMLElement, handle: HTMLElement): void {
        handle.addEventListener("pointerdown", (event: PointerEvent) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest("[data-window-action]")) return;
            event.preventDefault();

            const rect = frame.getBoundingClientRect();
            const startX = event.clientX;
            const startY = event.clientY;
            const startLeft = rect.left;
            const startTop = rect.top;

            const pointerId = event.pointerId;
            handle.setPointerCapture(pointerId);

            const onMove = (moveEvent: PointerEvent) => {
                const nextLeft = Math.max(0, startLeft + (moveEvent.clientX - startX));
                const nextTop = Math.max(0, startTop + (moveEvent.clientY - startY));
                frame.style.left = `${nextLeft}px`;
                frame.style.top = `${nextTop}px`;
            };

            const onUp = () => {
                handle.releasePointerCapture(pointerId);
                handle.removeEventListener("pointermove", onMove);
                handle.removeEventListener("pointerup", onUp);
                handle.removeEventListener("pointercancel", onUp);
            };

            handle.addEventListener("pointermove", onMove);
            handle.addEventListener("pointerup", onUp);
            handle.addEventListener("pointercancel", onUp);
        });
    }

    private installResize(frame: HTMLElement, handle: HTMLElement): void {
        handle.addEventListener("pointerdown", (event: PointerEvent) => {
            event.preventDefault();

            const rect = frame.getBoundingClientRect();
            const startX = event.clientX;
            const startY = event.clientY;
            const startW = rect.width;
            const startH = rect.height;
            const pointerId = event.pointerId;
            handle.setPointerCapture(pointerId);

            const onMove = (moveEvent: PointerEvent) => {
                const nextW = Math.max(360, startW + (moveEvent.clientX - startX));
                const nextH = Math.max(240, startH + (moveEvent.clientY - startY));
                frame.style.width = `${nextW}px`;
                frame.style.height = `${nextH}px`;
            };

            const onUp = () => {
                handle.releasePointerCapture(pointerId);
                handle.removeEventListener("pointermove", onMove);
                handle.removeEventListener("pointerup", onUp);
                handle.removeEventListener("pointercancel", onUp);
            };

            handle.addEventListener("pointermove", onMove);
            handle.addEventListener("pointerup", onUp);
            handle.addEventListener("pointercancel", onUp);
        });
    }

    private focusProcess(pid: string, syncUrl: boolean): void {
        const proc = this.processes.get(pid);
        if (!proc) return;

        proc.state = "open";
        proc.frame.hidden = false;
        this.activePid = proc.pid;
        this.zCounter += 1;
        proc.frame.style.zIndex = String(this.zCounter);
        this.navigationState.previousView = this.navigationState.currentView;
        this.navigationState.currentView = proc.viewId;
        this.navigationState.params = proc.params;
        this.currentView.value = proc.viewId;
        proc.frameEl?.setTitle?.(toTitle(proc.viewId));

        for (const item of this.processes.values()) {
            const active = item.pid === proc.pid;
            item.frame.classList.toggle("is-active", active);
            item.dockItem.classList.toggle("is-active", active);
        }

        if (syncUrl) {
            this.updateUrlState(proc.viewId, proc.pid, proc.params, true);
        }
    }

    private updateUrlState(
        viewId: ViewId,
        pid: string | null,
        params?: Record<string, string>,
        replace = false
    ): void {
        if (typeof window === "undefined" || typeof window == "undefined") return;
        const search = params && Object.keys(params).length > 0
            ? `?${new URLSearchParams(params).toString()}`
            : "";
        const nextUrl = `/${search}${pid ? `#${pid}` : ""}`;
        const nextState = { viewId, pid, params };
        const writer = replace ? globalThis?.history?.replaceState : globalThis?.history?.pushState;
        writer?.call(globalThis.history, nextState, "", nextUrl);
    }

    private generatePid(viewId: ViewId): string {
        this.pidCounter += 1;
        const prefix = String(viewId || "view").slice(0, 3).toLowerCase().replace(/[^a-z0-9]/g, "") || "pid";
        return `${prefix}-${this.pidCounter}`;
    }
}

export function createShell(_container: HTMLElement): WindowShell {
    return new WindowShell();
}

export default createShell;

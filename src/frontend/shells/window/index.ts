/**
 * Window Shell
 *
 * Desktop-like shell with process windows (pID), hash-focus support,
 * and frame controls (drag, resize, minimize, close).
 */

import { H } from "fest/lure";
import type { ShellId, ShellLayoutConfig, ViewId } from "../types";
import { ShellBase } from "../shell";
import { isEnabledView } from "../../views/config/views";
import type { WindowFrameElement } from "../UIElement";
import { subscribeViewChannel } from "../../shared/view-api";

// @ts-ignore - SCSS import
import style from "./frame.scss?inline";

type WindowState = "open" | "minimized" | "hidden";

interface WindowProcess {
    pid: string;
    processId: string;
    viewId: ViewId;
    params?: Record<string, string>;
    state: WindowState;
    frame: HTMLElement;
    body: HTMLElement | null;
    frameEl: WindowFrameElement | null;
    disposeView?: (() => void) | null;
}

interface ProcessTask {
    processId: string;
    viewId: ViewId;
    params?: Record<string, string>;
    instances: Set<string>;
    dockItem: HTMLButtonElement;
    pinned: boolean;
    headless: boolean;
    lastActivePid: string | null;
    unsubscribeChannel: (() => void) | null;
}

const toTitle = (viewId: ViewId): string => {
    const raw = String(viewId || "view").trim();
    if (!raw) return "View";
    return raw.charAt(0).toUpperCase() + raw.slice(1);
};

const sanitizePid = (value: string): string => value.replace(/[^a-z0-9_-]/gi, "");
const processKeyOf = (viewId: ViewId, params?: Record<string, string>): string =>
    sanitizePid(String(params?.processId || viewId || "process")) || String(viewId || "process");
const iconForView = (viewId: ViewId): string => ({
    home: "house",
    viewer: "article",
    explorer: "books",
    settings: "gear-six",
    airpad: "paper-plane-tilt",
    history: "clock-counter-clockwise",
    editor: "note-pencil",
    workcenter: "circles-three-plus"
}[viewId] || "app-window");

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
    private processTasks = new Map<string, ProcessTask>();
    private zCounter = 10;
    private pidCounter = 0;
    private activePid: string | null = null;
    private popstateHandler: ((event: PopStateEvent) => void) | null = null;
    private hashHandler: (() => void) | null = null;
    private openRequestHandler: ((event: Event) => void) | null = null;
    private statusTimer: ReturnType<typeof setInterval> | null = null;
    private dockAppsElement: HTMLElement | null = null;
    private dockStartElement: HTMLElement | null = null;
    private dockQuickElement: HTMLElement | null = null;
    private pinnedViews: ViewId[] = [];

    private async loadWindowView(
        viewId: ViewId,
        params?: Record<string, string>
    ): Promise<{ element: HTMLElement; disposeView?: (() => void) | null }> {
        // Explorer needs true per-window instances in window shell.
        if (viewId === "explorer") {
            const mod = await import("../../views/explorer");
            const factory = (mod as any).createExplorerView || (mod as any).createView || (mod as any).default;
            if (typeof factory === "function") {
                const view = factory({
                    shellContext: this.getContext(),
                    params
                }) as any;
                const element = view.render({
                    shellContext: this.getContext(),
                    params
                }) as HTMLElement;
                if (view.lifecycle?.onMount) {
                    await view.lifecycle.onMount();
                }
                return {
                    element,
                    disposeView: () => {
                        try {
                            view.lifecycle?.onUnmount?.();
                        } catch {
                            // ignore lifecycle cleanup errors
                        }
                    }
                };
            }
        }
        const element = await this.loadView(viewId, params);
        return { element, disposeView: null };
    }

    protected createLayout(): HTMLElement {
        return H`
            <div class="app-window-shell" data-shell="window">
                <main class="app-window-shell__stage" data-shell-content role="main"></main>
            </div>
        ` as HTMLElement;
    }

    protected getStylesheet(): string | null {
        return style;
    }

    async mount(container: HTMLElement): Promise<void> {
        await super.mount(container);
        this.stageElement = this.rootElement?.shadowRoot?.querySelector("[data-shell-content]") as HTMLElement | null;
        this.homeFrameElement = this.rootElement?.querySelector("[data-window-home-frame]") as HTMLElement | null;
        if (this.rootElement) {
            this.rootElement.style.gridColumn = "content-column";
            this.rootElement.style.gridRow = "content-row";
            this.rootElement.style.minInlineSize = "0";
            this.rootElement.style.minBlockSize = "0";
            this.rootElement.style.pointerEvents = "none";
            this.rootElement.style.position = "relative";
            this.rootElement.style.zIndex = "1";
        }
        this.bindOverlayChrome();

        this.initStatusBar();
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
        if (this.statusTimer) {
            clearInterval(this.statusTimer);
            this.statusTimer = null;
        }
        for (const task of this.processTasks.values()) {
            task.unsubscribeChannel?.();
        }
        for (const proc of this.processes.values()) {
            proc.disposeView?.();
        }
        this.processTasks.clear();
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
            for (const item of this.processes.values()) {
                item.frame.classList.remove("is-active");
            }
            for (const task of this.processTasks.values()) {
                task.dockItem.classList.remove("is-active");
                this.syncDockItemState(task.processId);
            }
            this.updateUrlState("home", null, params, false);
            this.updateStatusBar();
            return;
        }

        const pid = await this.openWindowProcess(viewId, params);
        const proc = this.processes.get(pid);
        if (!proc) return;
        this.focusProcess(proc.pid, true);
        this.updateStatusBar();
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
            if (detail?.target === "base") {
                this.openProcessInBaseShell(viewId as ViewId, params);
                return;
            }
            if (detail?.target === "headless") {
                void this.openWindowProcess(viewId as ViewId, { ...params, headless: "1" });
                return;
            }
            void this.navigate(viewId as ViewId, params);
        };
        globalThis?.addEventListener?.("cw:view-open-request", this.openRequestHandler);
    }

    private async mountHomeSurface(params?: Record<string, string>): Promise<void> {
        // Home should be desktop/icons layer, not a shell window/process.
        if (this.homeFrameElement?.isConnected) {
            this.homeFrameElement.remove();
        }
        this.homeFrameElement = null;
        this.updateStatusBar();
    }

    private async openWindowProcess(viewId: ViewId, params?: Record<string, string>): Promise<string> {
        if (!this.rootElement || !this.dockElement || !this.dockAppsElement) {
            throw new Error("[window] Shell host/dock is not mounted");
        }

        const processId = processKeyOf(viewId, params);
        const isHeadless = params?.headless === "1";
        let task = this.processTasks.get(processId);
        if (!task) {
            const dockItem = this.createProcessDockItem(processId, viewId, params);
            task = {
                processId,
                viewId,
                params,
                instances: new Set<string>(),
                dockItem,
                pinned: this.pinnedViews.includes(viewId),
                headless: isHeadless,
                lastActivePid: null,
                unsubscribeChannel: subscribeViewChannel(viewId, () => {
                    const t = this.processTasks.get(processId);
                    if (!t) return;
                    t.headless = false;
                    this.updateStatusBar();
                })
            };
            this.processTasks.set(processId, task);
            this.dockAppsElement.appendChild(dockItem);
            this.syncDockItemState(processId);
        } else {
            task.params = params || task.params;
            task.headless = task.headless || isHeadless;
            this.syncDockItemState(processId);
        }

        if (isHeadless) {
            this.syncDockItemState(processId);
            this.updateStatusBar();
            return task.lastActivePid || "";
        }

        const requestedPid = sanitizePid(String(params?.pid || ""));
        if (requestedPid && this.processes.has(requestedPid)) {
            const existing = this.processes.get(requestedPid)!;
            existing.state = "open";
            existing.frame.hidden = false;
            task.lastActivePid = existing.pid;
            this.syncDockItemState(processId);
            return existing.pid;
        }

        const pid = requestedPid || this.generatePid(viewId);
        const frame = this.createFrame(pid, viewId);
        const frameEl = frame as unknown as WindowFrameElement;
        const viewPayload = await this.loadWindowView(viewId, params);
        const element = viewPayload.element;
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

        const proc: WindowProcess = {
            pid,
            processId,
            viewId,
            params,
            state: "open",
            frame,
            body: null,
            frameEl,
            disposeView: viewPayload.disposeView || null
        };
        this.processes.set(pid, proc);
        task.instances.add(pid);
        task.lastActivePid = pid;
        task.headless = false;
        this.installWindowInteractions(proc);
        if (params?.minimized === "1") {
            proc.state = "minimized";
            proc.frame.hidden = true;
        }
        this.syncDockItemState(processId);
        this.updateStatusBar();
        return pid;
    }

    private createFrame(pid: string, viewId: ViewId): HTMLElement {
        const title = toTitle(viewId);
        const frameWidth = 780;
        const frameHeight = 520;
        const stageRect = this.stageElement?.getBoundingClientRect?.();
        const viewportWidth = stageRect?.width || globalThis?.innerWidth || frameWidth;
        const viewportHeight = stageRect?.height || globalThis?.innerHeight || frameHeight;
        const centerX = Math.max(0, Math.round((viewportWidth - frameWidth) / 2));
        const centerY = Math.max(0, Math.round((viewportHeight - frameHeight) / 2));
        const frame = H`
            <cw-window-frame
                class="app-window-shell__frame"
                data-window-frame
                data-pid="${pid}"
                data-title="${title}"
                style="pointer-events:auto;--shift-x:${centerX};--shift-y:${centerY};--initial-inline-size:${frameWidth}px;--initial-block-size:${frameHeight}px;z-index:${this.zCounter};"
            >
            </cw-window-frame>
        ` as HTMLElement;
        return frame;
    }

    private createProcessDockItem(processId: string, viewId: ViewId, _params?: Record<string, string>): HTMLButtonElement {
        return H`
            <button
                type="button"
                class="app-window-shell__dock-item app-window-shell__dock-item--icon"
                data-window-dock-item
                data-process-id="${processId}"
                data-window-state="idle"
                title="${toTitle(viewId)}"
                aria-label="${toTitle(viewId)}"
                aria-pressed="false"
            >
                <ui-icon icon="${iconForView(viewId)}"></ui-icon>
            </button>
        ` as HTMLButtonElement;
    }

    private installWindowInteractions(proc: WindowProcess): void {
        const { frame } = proc;
        const frameEl = frame as unknown as WindowFrameElement;
        const dragHandle = frameEl?.getDragHandle?.() || null;
        const resizeHandle = frameEl?.getResizeHandle?.() || null;

        frame.addEventListener("pointerdown", () => this.focusProcess(proc.pid, true));
        frame.addEventListener("window-action", (event) => {
            const action = (event as CustomEvent<{ action?: string }>).detail?.action;
            if (!action) return;
            if (action === "minimize") {
                proc.state = "minimized";
                proc.frame.hidden = true;
                proc.frame.classList.remove("is-active");
                if (this.activePid === proc.pid) {
                    this.activePid = null;
                    this.updateUrlState(this.navigationState.currentView, null, proc.params, true);
                }
                this.syncDockItemState(proc.processId);
                this.updateStatusBar();
            }
            if (action === "maximize") {
                this.toggleMaximize(proc.frame);
                this.updateStatusBar();
            }
            if (action === "close") {
                proc.state = "hidden";
                proc.disposeView?.();
                proc.frame.remove();
                this.processes.delete(proc.pid);
                const task = this.processTasks.get(proc.processId);
                task?.instances.delete(proc.pid);
                if (task && task.lastActivePid === proc.pid) {
                    task.lastActivePid = [...task.instances][0] || null;
                }
                if (task && task.instances.size === 0 && !task.pinned && !task.headless) {
                    task.unsubscribeChannel?.();
                    task.dockItem.remove();
                    this.processTasks.delete(task.processId);
                } else if (task) {
                    this.syncDockItemState(task.processId);
                }
                if (this.activePid === proc.pid) {
                    this.activePid = null;
                    void this.navigate("home");
                }
                this.updateStatusBar();
            }
            if (action === "detach") {
                this.openProcessInBaseShell(proc.viewId, proc.params, proc);
            }
        });

        if (dragHandle) this.installPointerDrag(frame, dragHandle);
        if (resizeHandle) this.installPointerResize(frame, resizeHandle);
    }

    private installPointerDrag(frame: HTMLElement, handle: HTMLElement): void {
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
            const shiftX = parseFloat(frame.style.getPropertyValue("--shift-x") || "0") || 0;
            const shiftY = parseFloat(frame.style.getPropertyValue("--shift-y") || "0") || 0;

            const onMove = (moveEvent: PointerEvent) => {
                const dx = moveEvent.clientX - startX;
                const dy = moveEvent.clientY - startY;
                frame.style.setProperty("--drag-x", String(dx));
                frame.style.setProperty("--drag-y", String(dy));
            };

            const onEnd = (endEvent: PointerEvent) => {
                if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
                handle.removeEventListener("pointermove", onMove);
                handle.removeEventListener("pointerup", onEnd);
                handle.removeEventListener("pointercancel", onEnd);
                frame.removeAttribute("data-dragging");

                const dx = endEvent.clientX - startX;
                const dy = endEvent.clientY - startY;
                frame.style.setProperty("--shift-x", String(Math.max(0, shiftX + dx)));
                frame.style.setProperty("--shift-y", String(Math.max(0, shiftY + dy)));
                frame.style.setProperty("--drag-x", "0");
                frame.style.setProperty("--drag-y", "0");
            };

            handle.addEventListener("pointermove", onMove);
            handle.addEventListener("pointerup", onEnd);
            handle.addEventListener("pointercancel", onEnd);
        });
    }

    private installPointerResize(frame: HTMLElement, handle: HTMLElement): void {
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

            const onMove = (moveEvent: PointerEvent) => {
                const dx = moveEvent.clientX - startX;
                const dy = moveEvent.clientY - startY;
                const nextW = Math.max(360, startW + dx);
                const nextH = Math.max(240, startH + dy);
                frame.style.setProperty("--initial-inline-size", `${nextW}px`);
                frame.style.setProperty("--initial-block-size", `${nextH}px`);
                frame.style.setProperty("--resize-x", "0");
                frame.style.setProperty("--resize-y", "0");
            };

            const onEnd = () => {
                if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
                handle.removeEventListener("pointermove", onMove);
                handle.removeEventListener("pointerup", onEnd);
                handle.removeEventListener("pointercancel", onEnd);
                frame.removeAttribute("data-resizing");
            };

            handle.addEventListener("pointermove", onMove);
            handle.addEventListener("pointerup", onEnd);
            handle.addEventListener("pointercancel", onEnd);
        });
    }

    private focusProcess(pid: string, syncUrl: boolean): void {
        const proc = this.processes.get(pid);
        if (!proc) return;

        proc.state = "open";
        proc.frame.hidden = false;
        this.activePid = proc.pid;
        const task = this.processTasks.get(proc.processId);
        if (task) task.lastActivePid = proc.pid;
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
        }
        for (const taskItem of this.processTasks.values()) {
            const active = taskItem.lastActivePid === proc.pid;
            taskItem.dockItem.classList.toggle("is-active", active);
        }
        this.syncDockItemState(proc.processId);

        if (syncUrl) {
            this.updateUrlState(proc.viewId, proc.pid, proc.params, true);
        }
        this.updateStatusBar();
    }

    private minimizeProcess(pid: string, syncUrl: boolean): void {
        const proc = this.processes.get(pid);
        if (!proc) return;
        proc.state = "minimized";
        proc.frame.hidden = true;
        proc.frame.classList.remove("is-active");
        if (this.activePid === pid) {
            this.activePid = null;
            if (syncUrl) {
                this.updateUrlState(this.navigationState.currentView, null, proc.params, true);
            }
        }
        this.syncDockItemState(proc.processId);
        this.updateStatusBar();
    }

    private syncDockItemState(processId: string): void {
        const task = this.processTasks.get(processId);
        if (!task) return;
        const dockItem = task.dockItem;
        const pids = [...task.instances];
        const windows = pids
            .map((pid) => this.processes.get(pid))
            .filter((entry): entry is WindowProcess => Boolean(entry));
        const openCount = windows.filter((entry) => entry.state === "open").length;
        const minimizedCount = windows.filter((entry) => entry.state === "minimized").length;
        const hasAny = windows.length > 0;
        const active = !!task.lastActivePid && this.activePid === task.lastActivePid;
        const state = task.headless && !hasAny
            ? "headless"
            : active
                ? "active"
                : openCount > 0
                    ? "open"
                    : minimizedCount > 0
                        ? "minimized"
                        : "idle";
        dockItem.dataset.windowState = state;
        dockItem.dataset.windowCount = String(windows.length);
        dockItem.setAttribute("aria-pressed", state === "active" || state === "open" ? "true" : "false");
        dockItem.classList.toggle("is-active", state === "active");
        dockItem.classList.toggle("is-open", state === "open" || state === "active");
        dockItem.classList.toggle("is-minimized", state === "minimized");
        dockItem.classList.toggle("is-headless", state === "headless");
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

    private buildBaseViewUrl(viewId: ViewId, params?: Record<string, string>): string {
        const query = new URLSearchParams();
        query.set("shell", "base");
        for (const [key, value] of Object.entries(params || {})) {
            if (value == null) continue;
            if (key === "pid" || key === "minimized" || key === "headless") continue;
            query.set(String(key), String(value));
        }
        const suffix = query.toString();
        return `/${String(viewId || "home")}${suffix ? `?${suffix}` : ""}`;
    }

    private createViewerDetachParams(proc: WindowProcess): Record<string, string> {
        const nextParams: Record<string, string> = { ...(proc.params || {}) };
        const rawTarget = proc.frame.querySelector("[data-raw-target]") as HTMLElement | null;
        const content = String(rawTarget?.textContent || "").trim();
        if (!content) return nextParams;

        const token = `cw:detach:viewer:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
        try {
            globalThis?.sessionStorage?.setItem?.(token, JSON.stringify({
                content,
                filename: String(nextParams.filename || ""),
                source: String(nextParams.source || nextParams.src || nextParams.path || "")
            }));
            nextParams.detachKey = token;
            delete nextParams.content;
        } catch {
            // Fallback when sessionStorage is blocked: pass inline content.
            nextParams.content = content;
        }
        return nextParams;
    }

    private openProcessInBaseShell(
        viewId: ViewId,
        params?: Record<string, string>,
        procForDetach?: WindowProcess | null
    ): void {
        let nextParams = { ...(params || {}) };
        const viewerProc = procForDetach?.viewId === "viewer"
            ? procForDetach
            : (this.activePid ? this.processes.get(this.activePid) : null);
        if (viewId === "viewer" && viewerProc?.viewId === "viewer") {
            nextParams = this.createViewerDetachParams(viewerProc);
        }
        const url = this.buildBaseViewUrl(viewId, nextParams);
        try {
            globalThis?.open?.(url, "_blank", "noopener,noreferrer");
        } catch (error) {
            console.warn("[window] Failed to open base shell tab:", error);
            this.showMessage("Unable to open separate tab");
        }
    }

    private initStatusBar(): void {
        if (!this.statusContainer) {
            this.bindOverlayChrome();
        }
        if (!this.statusContainer) return;
        this.statusContainer.hidden = false;
        this.statusContainer.setAttribute("role", "status");
        this.updateStatusBar();
        if (this.statusTimer) {
            clearInterval(this.statusTimer);
        }
        this.statusTimer = setInterval(() => this.updateStatusBar(), 1000);
    }

    private updateStatusBar(): void {
        if (!this.statusContainer) return;
        const processes = [...this.processes.values()];
        const total = processes.length;
        const minimized = processes.filter((proc) => proc.state === "minimized").length;
        const processCount = this.processTasks.size;
        const active = this.activePid
            ? `${this.navigationState.currentView} #${this.activePid}`
            : String(this.navigationState.currentView || "home");
        const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

        this.statusContainer.innerHTML = `
            <span class="app-window-shell__status-item"><b>Active:</b> ${active}</span>
            <span class="app-window-shell__status-item"><b>Processes:</b> ${processCount}</span>
            <span class="app-window-shell__status-item"><b>Windows:</b> ${total}</span>
            <span class="app-window-shell__status-item"><b>Minimized:</b> ${minimized}</span>
            <span class="app-window-shell__status-spacer"></span>
            <span class="app-window-shell__status-item">${time}</span>
        `;
    }

    private toggleMaximize(frame: HTMLElement): void {
        const isMaximized = frame.classList.contains("is-maximized");
        if (isMaximized) {
            const prevShiftX = frame.dataset.prevShiftX || "0";
            const prevShiftY = frame.dataset.prevShiftY || "0";
            const prevWidth = frame.dataset.prevWidth || "780px";
            const prevHeight = frame.dataset.prevHeight || "520px";
            frame.style.setProperty("--shift-x", prevShiftX);
            frame.style.setProperty("--shift-y", prevShiftY);
            frame.style.setProperty("--initial-inline-size", prevWidth);
            frame.style.setProperty("--initial-block-size", prevHeight);
            frame.style.setProperty("--resize-x", "0");
            frame.style.setProperty("--resize-y", "0");
            frame.classList.remove("is-maximized");
            return;
        }
        frame.dataset.prevShiftX = frame.style.getPropertyValue("--shift-x") || "0";
        frame.dataset.prevShiftY = frame.style.getPropertyValue("--shift-y") || "0";
        frame.dataset.prevWidth = frame.style.getPropertyValue("--initial-inline-size") || "780px";
        frame.dataset.prevHeight = frame.style.getPropertyValue("--initial-block-size") || "520px";
        frame.style.setProperty("--shift-x", "0");
        frame.style.setProperty("--shift-y", "0");
        frame.style.setProperty("--initial-inline-size", "100%");
        frame.style.setProperty("--initial-block-size", "100%");
        frame.style.setProperty("--resize-x", "0");
        frame.style.setProperty("--resize-y", "0");
        frame.classList.add("is-maximized");
    }

    private bindOverlayChrome(): void {
        const overlayLayer = document.querySelector('[data-app-layer="overlay"]') as HTMLElement | null;
        if (overlayLayer) {
            overlayLayer.querySelector("cw-app-dock[data-window-dock]")?.remove();
            overlayLayer.querySelector("cw-status-bar[data-window-status]")?.remove();
        }
        const shellLayer = document.querySelector('[data-app-layer="shell"]') as HTMLElement | null;
        if (!shellLayer) return;
        shellLayer.style.pointerEvents = shellLayer.style.pointerEvents || "none";

        if (!this.dockElement) {
            let dock = shellLayer.querySelector("cw-app-dock[data-window-dock]") as HTMLElement | null;
            if (!dock) {
                dock = document.createElement("cw-app-dock");
                dock.setAttribute("data-window-dock", "true");
                dock.className = "app-window-shell__dock";
                dock.setAttribute("aria-label", "Window dock");
                dock.style.pointerEvents = "auto";
                shellLayer.appendChild(dock);
            }
            dock.style.display = "flex";
            dock.style.position = "relative";
            dock.style.gridColumn = "content-column";
            dock.style.gridRow = "dock-row";
            dock.style.zIndex = "3";
            dock.style.minBlockSize = "48px";
            dock.style.padding = "0.45rem 0.55rem";
            dock.style.alignItems = "center";
            dock.style.gap = "0.45rem";
            dock.style.flexWrap = "wrap";
            dock.style.background = "var(--window-dock-bg, rgba(9,12,20,0.78))";
            dock.style.borderBlockStart = "1px solid var(--window-dock-border, rgba(130,160,235,0.32))";
            dock.style.backdropFilter = "blur(8px)";
            dock.innerHTML = `
                <div class="app-window-shell__dock-start" data-dock-start></div>
                <div class="app-window-shell__dock-apps" data-dock-apps></div>
                <div class="app-window-shell__dock-quick" data-dock-quick></div>
            `;
            this.dockStartElement = dock.querySelector("[data-dock-start]") as HTMLElement | null;
            this.dockAppsElement = dock.querySelector("[data-dock-apps]") as HTMLElement | null;
            this.dockQuickElement = dock.querySelector("[data-dock-quick]") as HTMLElement | null;
            this.renderDockControls();
            this.dockElement = dock;
        }

        if (!this.statusContainer) {
            let status = shellLayer.querySelector("cw-status-bar[data-window-status]") as HTMLElement | null;
            if (!status) {
                status = document.createElement("cw-status-bar");
                status.setAttribute("data-window-status", "true");
                status.className = "app-window-shell__status";
                status.setAttribute("aria-live", "polite");
                status.style.pointerEvents = "auto";
                shellLayer.appendChild(status);
            }
            status.style.pointerEvents = "none";
            status.style.display = "flex";
            status.style.position = "relative";
            status.style.gridColumn = "content-column";
            status.style.gridRow = "status-row";
            status.style.zIndex = "3";
            status.style.minBlockSize = "30px";
            status.style.padding = "0.25rem 0.65rem";
            status.style.alignItems = "center";
            status.style.gap = "0.55rem";
            status.style.fontSize = "0.75rem";
            status.style.color = "var(--window-shell-fg, #e8eefc)";
            //status.style.background = "color-mix(in oklab, #03060c 82%, #1f2a44 18%)";
            status.style.background = "transparent";
            status.style.borderBlockStart = "1px solid rgba(130, 160, 235, 0.24)";
            this.statusContainer = status;
        }
    }

    private renderDockControls(): void {
        if (!this.dockStartElement || !this.dockQuickElement || !this.dockAppsElement) return;

        this.dockStartElement.innerHTML = `
            <button type="button" class="app-window-shell__dock-item app-window-shell__dock-item--icon app-window-shell__dock-item--start" data-dock-action="start" title="Start" aria-label="Start">
                <ui-icon icon="squares-four"></ui-icon>
            </button>
        `;
        this.dockQuickElement.innerHTML = `
            <button type="button" class="app-window-shell__dock-item app-window-shell__dock-item--icon app-window-shell__dock-item--quick" data-dock-action="quick-settings" title="Quick settings" aria-label="Quick settings">
                <ui-icon icon="sliders-horizontal"></ui-icon>
            </button>
        `;
        const pinned = this.pinnedViews.map((viewId) => `
            <button
                type="button"
                class="app-window-shell__dock-item app-window-shell__dock-item--icon app-window-shell__dock-item--pinned"
                data-dock-action="open-pinned"
                data-view-id="${viewId}"
                title="${toTitle(viewId)}"
                aria-label="${toTitle(viewId)}"
            >
                <ui-icon icon="${iconForView(viewId)}"></ui-icon>
            </button>
        `).join("");
        this.dockAppsElement.insertAdjacentHTML("afterbegin", pinned);

        this.dockElement?.addEventListener("click", (event) => {
            const target = (event.target as HTMLElement | null)?.closest?.("[data-dock-action], [data-window-dock-item]") as HTMLElement | null;
            if (!target) return;
            const action = target.dataset.dockAction || "";
            if (action === "start") {
                void this.navigate("home");
                return;
            }
            if (action === "quick-settings") {
                this.showMessage("Quick settings: WIP");
                return;
            }
            if (action === "open-pinned") {
                const viewId = (target.dataset.viewId || "home") as ViewId;
                void this.navigate(viewId);
                return;
            }
            const processId = target.dataset.processId || "";
            if (!processId) return;
            const task = this.processTasks.get(processId);
            if (!task) return;
            const pid = task.lastActivePid || [...task.instances][0];
            if (pid && this.processes.has(pid)) {
                const proc = this.processes.get(pid)!;
                const isActive = this.activePid === pid && proc.state === "open" && !proc.frame.hidden;
                if (isActive) {
                    this.minimizeProcess(pid, true);
                    return;
                }
                proc.state = "open";
                proc.frame.hidden = false;
                this.focusProcess(pid, true);
            } else {
                void this.openWindowProcess(task.viewId, task.params || {});
            }
        });
    }
}

export function createShell(_container: HTMLElement): WindowShell {
    return new WindowShell();
}

export default createShell;

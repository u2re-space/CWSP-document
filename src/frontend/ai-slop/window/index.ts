/**
 * Window Shell
 *
 * Desktop-like shell with process windows (pID), hash-focus support,
 * frame controls (drag, resize, minimize, close), inter-process channels,
 * parameterized view opening (GET query / POST body), and cross-window
 * drag-and-drop attach system.
 *
 * URL contract (environment/window/tabbed shells):
 *   GET /{view}?key=val  → opens process for that view with query params
 *                          → silently redirects to /?key=val#pid
 *   location.hash        → #pid of the currently focused process
 *   history.state         → { viewId, pid, params }
 */

import { H } from "fest/lure";
import type { ShellId, ShellLayoutConfig, ShellTheme, ViewId } from "shells/types";
import { isEnabledView } from "shared/routing/views";

// @ts-ignore - SCSS import
import style from "./index.scss?inline";
import { normalizeIpcAttachments, sendViewProtocolMessage, type ViewAttachmentInput } from "com/core/UniformViewTransport";
import "./components/WindowFrame";

// ============================================================================
// TYPES
// ============================================================================

type WindowState = "open" | "minimized" | "hidden";
type WindowKind = "regular" | "tabbed";

/**
 * Parameters for opening a view process.
 * Supports both GET (query) and POST (body) semantics.
 */
interface ProcessOpenParams {
    /** GET-style query parameters forwarded from URL or explicit request */
    query: Record<string, string>;
    /** POST-style body payload (JSON data, options, etc.) */
    body?: unknown;
    /** MIME type hint for body payload */
    contentType?: string;
    /** Named channel for this process to join */
    channel?: string;
    /** Attached data assets (files, blobs) passed from another process */
    attachments?: ProcessAttachment[];
}

interface ProcessAttachment {
    name: string;
    type: string;
    size: number;
    data: File | Blob | string;
    source?: string;
}

const destinationForView = (viewId: ViewId): string => {
    if (viewId === "workcenter") return "workcenter";
    if (viewId === "viewer") return "viewer";
    if (viewId === "explorer") return "explorer";
    if (viewId === "editor") return "editor";
    if (viewId === "settings") return "settings";
    if (viewId === "history") return "history";
    if (viewId === "airpad") return "airpad";
    if (viewId === "print") return "print";
    return "home";
};

const protocolTypeForDestination = (destination: string): string => {
    if (destination === "workcenter") return "content-attach";
    if (destination === "viewer") return "content-view";
    if (destination === "explorer") return "content-explorer";
    return "content-share";
};

/**
 * Per-process messaging channel.
 */
interface ProcessChannel {
    /** Send a message to this process from outside */
    post(message: unknown): void;
    /** Subscribe to messages sent to this process */
    onMessage(handler: (msg: unknown) => void): () => void;
    /** Dispose the channel */
    close(): void;
}

interface WindowProcess {
    pid: string;
    processId: string;
    viewId: ViewId;
    windowKind: WindowKind;
    openParams: ProcessOpenParams;
    state: WindowState;
    frame: HTMLElement;
    body: HTMLElement | null;
    frameEl: WindowFrameElement | null;
    channel: ProcessChannel;
    acceptsDrop: boolean;
    disposeView?: (() => void) | null;
}

interface ProcessTask {
    processId: string;
    viewId: ViewId;
    defaultWindowKind: WindowKind;
    openParams: ProcessOpenParams;
    instances: Set<string>;
    dockItem: HTMLButtonElement;
    pinned: boolean;
    headless: boolean;
    lastActivePid: string | null;
    unsubscribeChannel: (() => void) | null;
}

// ============================================================================
// HELPERS
// ============================================================================

const toTitle = (viewId: ViewId): string => {
    const raw = String(viewId || "view").trim();
    if (!raw) return "View";
    return raw.charAt(0).toUpperCase() + raw.slice(1);
};

const sanitizePid = (value: string): string => value.replace(/[^a-z0-9_-]/gi, "");
const normalizeWindowKind = (value?: string): WindowKind => {
    const normalized = String(value || "").trim().toLowerCase();
    return normalized === "tabbed" ? "tabbed" : "regular";
};
const parseBooleanParam = (value?: string): boolean => {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized) return false;
    return !["0", "false", "no", "off", "null", "undefined"].includes(normalized);
};
const parseLocationParams = (): Record<string, string> => {
    try {
        return Object.fromEntries(new URLSearchParams(globalThis?.location?.search || ""));
    } catch {
        return {};
    }
};
const processKeyOf = (viewId: ViewId, query?: Record<string, string>): string =>
    sanitizePid(String(query?.processId || viewId || "process")) || String(viewId || "process");
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

/** Views whose windows accept drop events (file attach, etc.) */
const DROP_ACCEPTING_VIEWS = new Set<string>(["workcenter", "viewer", "editor", "airpad"]);

/**
 * Build a ProcessOpenParams from flat key-value params (legacy compat)
 * and optional structured fields.
 */
function buildOpenParams(
    flatParams?: Record<string, string>,
    extra?: Partial<ProcessOpenParams>
): ProcessOpenParams {
    const query = { ...(flatParams || {}) };
    // Strip internal routing keys from the query forwarded to view
    delete query.pid;
    delete query.minimized;
    delete query.headless;
    delete query.newTask;
    delete query.windowType;
    delete query.window;
    delete query.shell;
    delete query.processId;
    return {
        query,
        body: extra?.body,
        contentType: extra?.contentType,
        channel: extra?.channel,
        attachments: extra?.attachments,
    };
}

/**
 * Create a lightweight per-process message channel backed by EventTarget.
 */
function createProcessChannel(pid: string): ProcessChannel {
    const target = new EventTarget();
    const handlers = new Set<(msg: unknown) => void>();

    return {
        post(message: unknown): void {
            target.dispatchEvent(new CustomEvent("msg", { detail: message }));
        },
        onMessage(handler: (msg: unknown) => void): () => void {
            const wrapper = (e: Event) => handler((e as CustomEvent).detail);
            target.addEventListener("msg", wrapper);
            handlers.add(handler);
            return () => {
                target.removeEventListener("msg", wrapper);
                handlers.delete(handler);
            };
        },
        close(): void {
            handlers.clear();
        },
    };
}

// ============================================================================
// WINDOW SHELL
// ============================================================================

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

    protected shouldRenderDesktopChrome(): boolean {
        return false;
    }

    protected getPinnedViews(): ViewId[] {
        return [];
    }

    protected applyTheme(theme: ShellTheme): void {
        const inner = this.rootElement?.shadowRoot?.querySelector(".app-window-shell") as HTMLElement | null;
        if (inner) {
            const resolved = this.resolveShellColorScheme(theme);
            inner.dataset.theme = resolved;
            inner.style.colorScheme = resolved;
        }
        super.applyTheme(theme);
    }

    protected getDefaultWindowKind(): WindowKind {
        return this.id === "tabbed" ? "tabbed" : "regular";
    }

    protected resolveWindowKind(query?: Record<string, string>): WindowKind {
        return normalizeWindowKind(query?.windowType || query?.window || this.getDefaultWindowKind());
    }

    private isForcedNewTask(query?: Record<string, string>): boolean {
        return parseBooleanParam(query?.newTask) || String(query?.instance || "").toLowerCase() === "new";
    }

    private resolveProcessId(viewId: ViewId, query?: Record<string, string>): string {
        const baseKey = processKeyOf(viewId, query);
        if (!this.isForcedNewTask(query)) {
            return baseKey;
        }
        const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
        return `${baseKey}::${nonce}`;
    }

    // ========================================================================
    // PUBLIC API: open a view as process with structured params
    // ========================================================================

    /**
     * Open a view as a window process with full parameter support.
     * This is the canonical API used by external code and routing.
     */
    async openView(
        viewId: ViewId,
        options?: {
            query?: Record<string, string>;
            body?: unknown;
            contentType?: string;
            channel?: string;
            attachments?: ProcessAttachment[];
            windowKind?: WindowKind;
            pid?: string;
            headless?: boolean;
            newTask?: boolean;
        }
    ): Promise<string> {
        if (!isEnabledView(String(viewId))) {
            this.showMessage(`Unknown view: ${String(viewId)}`);
            return "";
        }

        const flatParams: Record<string, string> = { ...(options?.query || {}) };
        if (options?.pid) flatParams.pid = options.pid;
        if (options?.windowKind) flatParams.windowType = options.windowKind;
        if (options?.headless) flatParams.headless = "1";
        if (options?.newTask) flatParams.newTask = "1";

        const openParams = buildOpenParams(flatParams, {
            body: options?.body,
            contentType: options?.contentType,
            channel: options?.channel,
            attachments: options?.attachments,
        });

        if (viewId === "home") {
            await this.mountHomeSurface(openParams);
            return "";
        }

        const pid = await this.openWindowProcess(viewId, flatParams, openParams);
        const proc = this.processes.get(pid);
        if (!proc) return "";
        this.focusProcess(proc.pid, true);
        this.updateStatusBar();

        // If body was provided (POST semantics), relay it to the view's BroadcastChannel
        if (openParams.body != null) {
            const bodyText = typeof openParams.body === "string"
                ? openParams.body
                : JSON.stringify(openParams.body);
            postViewChannelPayload(String(viewId), {
                type: "view-post",
                viewId: String(viewId),
                bodyText,
                contentType: openParams.contentType || "application/json",
                pid,
            });
        }

        // If attachments were provided, relay them to the process channel
        if (openParams.attachments?.length) {
            proc.channel.post({
                type: "process-attach",
                attachments: openParams.attachments.map(a => ({
                    name: a.name,
                    type: a.type,
                    size: a.size,
                    source: a.source,
                    data: a.data,
                })),
            });
            void this.relayAttachmentsToView(proc, openParams.attachments, "open-view");
        }

        return pid;
    }

    /**
     * Get a process's channel for external messaging.
     */
    getProcessChannel(pid: string): ProcessChannel | null {
        return this.processes.get(pid)?.channel || null;
    }

    /**
     * Send a message to a process by PID.
     */
    postToProcess(pid: string, message: unknown): void {
        this.processes.get(pid)?.channel.post(message);
    }

    /**
     * Send attachments to a process (drag-and-drop or programmatic attach).
     */
    attachToProcess(pid: string, attachments: ProcessAttachment[]): void {
        const proc = this.processes.get(pid);
        if (!proc) return;
        proc.channel.post({
            type: "process-attach",
            attachments: attachments.map(a => ({
                name: a.name,
                type: a.type,
                size: a.size,
                source: a.source,
                data: a.data,
            })),
        });
        void this.relayAttachmentsToView(proc, attachments, "programmatic-attach");
    }

    private async relayAttachmentsToView(
        proc: WindowProcess,
        attachments: ProcessAttachment[],
        source: string
    ): Promise<void> {
        if (!attachments.length) return;
        const normalized = await normalizeIpcAttachments(
            attachments.map((entry) => ({ data: entry.data, source: entry.source || source })) as ViewAttachmentInput[],
            source
        );
        if (!normalized.length) return;

        const destination = destinationForView(proc.viewId);
        const type = protocolTypeForDestination(destination);
        const first = normalized[0];
        const sent = await sendViewProtocolMessage({
            type,
            source: `window-shell:${proc.pid}`,
            destination,
            contentType: first?.mimeType || "application/octet-stream",
            attachments: normalized.map((entry) => ({ data: entry.data, source: entry.source })),
            data: {
                path: proc.openParams.query?.path || proc.openParams.query?.src || "/",
                filename: first?.name,
                action: destination === "explorer" ? "save" : undefined,
                originView: proc.viewId,
                pid: proc.pid
            },
            metadata: {
                processId: proc.processId,
                shell: "window",
                from: source
            }
        });
        if (!sent) {
            console.warn(`[window] Failed to relay attachments to ${destination}`);
        }
    }

    // ========================================================================
    // LAYOUT
    // ========================================================================

    private clearDesktopChrome(): void {
        document.querySelector('[data-app-layer="shell"]')?.querySelector("cw-app-dock[data-window-dock]")?.remove();
        document.querySelector('[data-app-layer="shell"]')?.querySelector("cw-status-bar[data-window-status]")?.remove();
        this.statusContainer = null;
    }

    private ensureProcessHost(): void {
        if (this.shouldRenderDesktopChrome()) {
            this.bindOverlayChrome();
            return;
        }

        if (this.dockElement && this.dockAppsElement) {
            return;
        }

        const virtualDock = document.createElement("div");
        const virtualApps = document.createElement("div");
        virtualDock.appendChild(virtualApps);
        this.dockElement = virtualDock;
        this.dockAppsElement = virtualApps;
        this.dockStartElement = null;
        this.dockQuickElement = null;
    }

    /**
     * Load a view for a window process. Each window gets a fresh view
     * instance and DOM tree (not shared with ShellBase's view cache).
     */
    private async loadWindowView(
        viewId: ViewId,
        openParams: ProcessOpenParams
    ): Promise<{ element: HTMLElement; disposeView?: (() => void) | null }> {
        const viewOptions = {
            shellContext: this.getContext(),
            params: { ...openParams.query },
            initialData: openParams.body,
        };

        try {
            const { ViewRegistry } = await import("shared/routing/registry");
            const registration = ViewRegistry.get(viewId);
            if (registration) {
                const mod = await registration.loader();
                const moduleObj = mod as Record<string, unknown>;
                const factory = this.resolveViewFactory(moduleObj);
                if (factory) {
                    const view = await factory(viewOptions) as any;
                    if (view?.render) {
                        const element = view.render(viewOptions) as HTMLElement;
                        if (view.lifecycle?.onMount) {
                            await view.lifecycle.onMount();
                        }
                        return {
                            element,
                            disposeView: () => {
                                try { view.lifecycle?.onUnmount?.(); } catch { /* noop */ }
                            }
                        };
                    }
                }
            }
        } catch (e) {
            console.warn(`[window] View registry load failed for ${viewId}:`, e);
        }

        const cached = this.loadedViews.get(viewId);
        if (cached) {
            const freshElement = cached.view.render({
                shellContext: this.getContext(),
                params: openParams.query,
                initialData: openParams.body,
            });
            if (cached.view.lifecycle?.onMount) {
                await cached.view.lifecycle.onMount();
            }
            return {
                element: freshElement,
                disposeView: () => {
                    try { cached.view.lifecycle?.onUnmount?.(); } catch { /* noop */ }
                },
            };
        }
        const element = await this.loadView(viewId, openParams.query);
        const justCached = this.loadedViews.get(viewId);
        return {
            element,
            disposeView: justCached ? () => {
                try { justCached.view.lifecycle?.onUnmount?.(); } catch { /* noop */ }
            } : null,
        };
    }

    private resolveViewFactory(mod: Record<string, unknown>): ((opts?: unknown) => unknown) | null {
        const names = [
            "default", "createView",
            "createViewerView", "createExplorerView", "createWorkCenterView",
            "createSettingsView", "createHistoryView", "createAirpadView",
            "createEditorView", "createHomeView",
        ];
        for (const name of names) {
            if (typeof mod[name] === "function") return mod[name] as (opts?: unknown) => unknown;
        }
        for (const value of Object.values(mod)) {
            if (typeof value === "function" && (value as any).prototype?.render) {
                const Ctor = value as new (opts?: unknown) => any;
                return (opts?: unknown) => new Ctor(opts);
            }
        }
        return null;
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

    // ========================================================================
    // LIFECYCLE
    // ========================================================================

    async mount(container: HTMLElement): Promise<void> {
        this.pinnedViews = this.getPinnedViews();
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
        if (this.shouldRenderDesktopChrome()) {
            this.bindOverlayChrome();
            this.initStatusBar();
        } else {
            this.clearDesktopChrome();
            this.ensureProcessHost();
        }
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
            proc.channel.close();
            proc.disposeView?.();
        }
        this.processTasks.clear();
        this.processes.clear();
        this.activePid = null;
        this.dockElement = null;
        this.dockAppsElement = null;
        this.dockStartElement = null;
        this.dockQuickElement = null;
        super.unmount();
    }

    // ========================================================================
    // NAVIGATION
    // ========================================================================

    async navigate(viewId: ViewId, params?: Record<string, string>): Promise<void> {
        if (!isEnabledView(String(viewId))) {
            this.showMessage(`Unknown view: ${String(viewId)}`);
            return;
        }

        const openParams = buildOpenParams(params);

        if (viewId === "home") {
            await this.mountHomeSurface(openParams);
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

        const pid = await this.openWindowProcess(viewId, params, openParams);
        const proc = this.processes.get(pid);
        if (!proc) return;
        this.focusProcess(proc.pid, true);
        this.updateStatusBar();
    }

    // ========================================================================
    // ROUTING
    // ========================================================================

    /**
     * Parse entry URL, open the initial view as a process, and normalize
     * the URL to `/#pid` so back/forward operates on process focus.
     */
    private async syncInitialRoute(): Promise<void> {
        const state = (globalThis?.history?.state || {}) as {
            viewId?: ViewId;
            pid?: string;
            params?: Record<string, string>;
            redirectedFrom?: string;
        };
        const pathname = (globalThis?.location?.pathname || "").replace(/^\/+|\/+$/g, "").toLowerCase();
        const fromPath = pathname && isEnabledView(pathname) ? (pathname as ViewId) : null;
        const fromState = state?.viewId && isEnabledView(String(state.viewId)) ? state.viewId : null;
        const initialView = fromState || fromPath || "home";
        const locationQuery = parseLocationParams();
        const params = {
            ...locationQuery,
            ...(state?.params || {})
        };

        await this.navigate(initialView, params);

        // If we entered via /{view} path, silently normalize to /#pid
        if (fromPath && fromPath !== "home") {
            const proc = this.activePid ? this.processes.get(this.activePid) : null;
            if (proc) {
                this.updateUrlState(proc.viewId, proc.pid, params, true);
            }
        }

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
            const params = {
                ...parseLocationParams(),
                ...(state?.params || {})
            };
            void this.navigate(viewId, params).then(() => {
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
                windowType?: WindowKind | string;
                newTask?: boolean;
                body?: unknown;
                contentType?: string;
                channel?: string;
                attachments?: ProcessAttachment[];
            };
            const viewId = detail?.viewId ? String(detail.viewId).toLowerCase() : "";
            if (!viewId || !isEnabledView(viewId)) return;

            if (detail?.target === "base" || detail?.target === "minimal") {
                this.openProcessAsDedicatedWindow(
                    viewId as ViewId,
                    detail?.params,
                    detail?.target as "base" | "minimal",
                    null,
                    detail?.body,
                );
                return;
            }

            // Use structured openView for full parameter support
            void this.openView(viewId as ViewId, {
                query: detail?.params,
                body: detail?.body,
                contentType: detail?.contentType,
                channel: detail?.channel,
                attachments: detail?.attachments,
                windowKind: detail?.windowType ? normalizeWindowKind(detail.windowType) : undefined,
                pid: detail?.pid ? String(detail.pid) : undefined,
                headless: detail?.target === "headless",
                newTask: detail?.newTask,
            });
        };
        globalThis?.addEventListener?.("cw:view-open-request", this.openRequestHandler);
    }

    // ========================================================================
    // HOME
    // ========================================================================

    private async mountHomeSurface(_openParams?: ProcessOpenParams): Promise<void> {
        if (this.homeFrameElement?.isConnected) {
            this.homeFrameElement.remove();
        }
        this.homeFrameElement = null;
        this.updateStatusBar();
    }

    // ========================================================================
    // PROCESS MANAGEMENT
    // ========================================================================

    private async openWindowProcess(
        viewId: ViewId,
        flatParams?: Record<string, string>,
        openParams?: ProcessOpenParams
    ): Promise<string> {
        this.ensureProcessHost();
        if (!this.rootElement || !this.dockAppsElement) {
            throw new Error("[window] Shell host/dock is not mounted");
        }

        const resolvedOpenParams = openParams || buildOpenParams(flatParams);
        const allFlat = { ...(flatParams || {}), ...resolvedOpenParams.query };

        const processId = this.resolveProcessId(viewId, allFlat);
        const isHeadless = allFlat?.headless === "1";
        const windowKind = this.resolveWindowKind(allFlat);
        let task = this.processTasks.get(processId);
        if (!task) {
            const isPinned = this.pinnedViews.includes(viewId);
            const existingPinnedBtn = isPinned
                ? this.dockAppsElement.querySelector<HTMLButtonElement>(
                    `[data-dock-action="open-pinned"][data-view-id="${viewId}"]`
                  )
                : null;
            let dockItem: HTMLButtonElement;
            if (existingPinnedBtn) {
                existingPinnedBtn.setAttribute("data-window-dock-item", "true");
                existingPinnedBtn.setAttribute("data-process-id", processId);
                existingPinnedBtn.setAttribute("data-window-kind", windowKind);
                existingPinnedBtn.setAttribute("data-window-state", "idle");
                dockItem = existingPinnedBtn;
            } else {
                dockItem = this.createProcessDockItem(processId, viewId, windowKind, allFlat);
                this.dockAppsElement.appendChild(dockItem);
            }
            task = {
                processId,
                viewId,
                defaultWindowKind: windowKind,
                openParams: resolvedOpenParams,
                instances: new Set<string>(),
                dockItem,
                pinned: isPinned,
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
            this.syncDockItemState(processId);
        } else {
            task.openParams = resolvedOpenParams;
            task.headless = task.headless || isHeadless;
            task.defaultWindowKind = windowKind;
            this.syncDockItemState(processId);
        }

        if (isHeadless) {
            this.syncDockItemState(processId);
            this.updateStatusBar();
            return task.lastActivePid || "";
        }

        const requestedPid = sanitizePid(String(allFlat?.pid || ""));
        if (requestedPid && this.processes.has(requestedPid)) {
            const existing = this.processes.get(requestedPid)!;
            existing.state = "open";
            existing.frame.hidden = false;
            task.lastActivePid = existing.pid;
            this.syncDockItemState(processId);
            return existing.pid;
        }

        const pid = requestedPid || this.generatePid(viewId);
        const channel = createProcessChannel(pid);
        const frame = this.createFrame(pid, viewId, windowKind);
        const frameEl = frame as unknown as WindowFrameElement;
        const viewPayload = await this.loadWindowView(viewId, resolvedOpenParams);
        const element = viewPayload.element;
        const viewHost = this.createWindowViewHost(viewId, pid, windowKind, element);
        viewHost.dataset.view = String(viewId);
        viewHost.slot = "window-view";
        for (const child of Array.from(frame.children)) {
            const childEl = child as HTMLElement;
            if (childEl.slot === "window-view") {
                childEl.remove();
            }
        }
        frame.appendChild(viewHost);
        frameEl?.setTitle?.(toTitle(viewId));
        frameEl?.setPidLabel?.(pid);

        frame.slot = "window-frame";
        this.rootElement?.appendChild(frame);

        const acceptsDrop = DROP_ACCEPTING_VIEWS.has(String(viewId).toLowerCase());
        const proc: WindowProcess = {
            pid,
            processId,
            viewId,
            windowKind,
            openParams: resolvedOpenParams,
            state: "open",
            frame,
            body: null,
            frameEl,
            channel,
            acceptsDrop,
            disposeView: viewPayload.disposeView || null
        };
        this.processes.set(pid, proc);
        task.instances.add(pid);
        task.lastActivePid = pid;
        task.headless = false;
        this.installWindowInteractions(proc);
        if (acceptsDrop) {
            this.installDropTarget(proc);
        }
        if (allFlat?.minimized === "1") {
            proc.state = "minimized";
            proc.frame.hidden = true;
        }
        this.syncDockItemState(processId);
        this.updateStatusBar();
        return pid;
    }

    // ========================================================================
    // FRAME CONSTRUCTION
    // ========================================================================

    private createFrame(pid: string, viewId: ViewId, windowKind: WindowKind): HTMLElement {
        const title = toTitle(viewId);
        const stageRect = this.stageElement?.getBoundingClientRect?.();
        const stageW = stageRect?.width || globalThis?.innerWidth || 1280;
        const stageH = stageRect?.height || globalThis?.innerHeight || 720;
        const stageL = stageRect?.left || 0;
        const stageT = stageRect?.top || 0;
        const frameWidth = Math.min(640, stageW);
        const frameHeight = Math.min(480, stageH);
        const centerX = Math.max(0, Math.round((stageW - frameWidth) / 2));
        const centerY = Math.max(0, Math.round((stageH - frameHeight) / 2));
        const frame = H`
            <cw-window-frame-v2
                class="app-window-shell__frame"
                data-window-frame
                data-window-kind="${windowKind}"
                data-pid="${pid}"
                data-title="${title}"
            >
            </cw-window-frame-v2>
        ` as HTMLElement;

        frame.style.setProperty("pointer-events", "auto");
        frame.style.setProperty("--shift-x", `${centerX || 0}px`);
        frame.style.setProperty("--shift-y", `${centerY || 0}px`);
        frame.style.setProperty("--initial-inline-size", `${frameWidth || 640}px`);
        frame.style.setProperty("--initial-block-size", `${frameHeight || 480}px`);
        frame.style.setProperty("--min-inline-size", `${frameWidth || 640}px`);
        frame.style.setProperty("--min-block-size", `${frameHeight || 480}px`);


        return frame;
    }

    private createWindowViewHost(viewId: ViewId, pid: string, windowKind: WindowKind, element: HTMLElement): HTMLElement {
        if (windowKind !== "tabbed") {
            element.dataset.view = String(viewId);
            return element;
        }

        const host = document.createElement("div");
        host.className = "app-window-shell__tabbed-host";
        host.setAttribute("data-window-tabbed-host", "true");
        host.setAttribute("data-window-pid", pid);
        host.innerHTML = `
            <div class="app-window-shell__tabbed-tabs" role="tablist" aria-label="Window tabs">
                <button type="button" class="app-window-shell__tabbed-tab is-active" role="tab" aria-selected="true">
                    <ui-icon icon="${iconForView(viewId)}"></ui-icon>
                    <span>${toTitle(viewId)}</span>
                </button>
            </div>
            <div class="app-window-shell__tabbed-content" data-window-tabbed-content></div>
        `;
        const content = host.querySelector("[data-window-tabbed-content]") as HTMLElement | null;
        if (content) {
            element.dataset.view = String(viewId);
            content.appendChild(element);
        }
        return host;
    }

    // ========================================================================
    // DOCK
    // ========================================================================

    private createProcessDockItem(
        processId: string,
        viewId: ViewId,
        windowKind: WindowKind,
        _params?: Record<string, string>
    ): HTMLButtonElement {
        return H`
            <button
                type="button"
                class="app-window-shell__dock-item app-window-shell__dock-item--icon"
                data-window-dock-item
                data-process-id="${processId}"
                data-window-kind="${windowKind}"
                data-window-state="idle"
                title="${toTitle(viewId)}"
                aria-label="${toTitle(viewId)}"
                aria-pressed="false"
            >
                <ui-icon icon="${iconForView(viewId)}"></ui-icon>
            </button>
        ` as HTMLButtonElement;
    }

    // ========================================================================
    // WINDOW INTERACTIONS (actions)
    // ========================================================================

    private installWindowInteractions(proc: WindowProcess): void {
        const { frame } = proc;

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
                    this.updateUrlState(this.navigationState.currentView, null, undefined, true);
                }
                this.syncDockItemState(proc.processId);
                this.updateStatusBar();
            }
            if (action === "maximize") {
                this.toggleMaximize(proc.frame);
                this.updateStatusBar();
            }
            if (action === "close") {
                this.closeProcess(proc);
            }
            if (action === "detach") {
                this.openProcessAsDedicatedWindow(
                    proc.viewId, proc.openParams.query, "base", proc, proc.openParams.body,
                );
            }
            if (action === "popout") {
                this.openProcessAsDedicatedWindow(
                    proc.viewId, proc.openParams.query, "minimal", proc, proc.openParams.body,
                );
            }
        });
    }

    private closeProcess(proc: WindowProcess): void {
        proc.state = "hidden";
        proc.channel.close();
        proc.disposeView?.();
        proc.frame.remove();
        this.processes.delete(proc.pid);
        const task = this.processTasks.get(proc.processId);
        task?.instances.delete(proc.pid);
        if (task && task.lastActivePid === proc.pid) {
            task.lastActivePid = [...task.instances][0] || null;
        }
        if (task && task.instances.size === 0) {
            if (task.pinned) {
                task.lastActivePid = null;
                task.headless = false;
                this.syncDockItemState(task.processId);
            } else if (!task.headless) {
                task.unsubscribeChannel?.();
                task.dockItem.remove();
                this.processTasks.delete(task.processId);
            } else {
                this.syncDockItemState(task.processId);
            }
        } else if (task) {
            this.syncDockItemState(task.processId);
        }
        if (this.activePid === proc.pid) {
            this.activePid = null;
            void this.navigate("home");
        }
        this.updateStatusBar();
    }

    // ========================================================================
    // DRAG-AND-DROP ATTACH SYSTEM
    // ========================================================================

    /**
     * Install drop zone on a process frame's body. Accepts files and
     * serialized DataTransfer items from other process windows.
     */
    private installDropTarget(proc: WindowProcess): void {
        const body = proc.frame.querySelector("[slot='window-view']") || proc.frame;

        body.addEventListener("dragover", (e) => {
            const event = e as DragEvent;
            if (!event.dataTransfer) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            proc.frame.classList.add("is-drop-target");
        });

        body.addEventListener("dragleave", (e) => {
            const event = e as DragEvent;
            const related = event.relatedTarget as Node | null;
            if (related && proc.frame.contains(related)) return;
            proc.frame.classList.remove("is-drop-target");
        });

        body.addEventListener("drop", async (e) => {
            const event = e as DragEvent;
            event.preventDefault();
            proc.frame.classList.remove("is-drop-target");
            if (!event.dataTransfer) return;

            const attachments: ProcessAttachment[] = [];

            // File drops
            if (event.dataTransfer.files.length > 0) {
                for (const file of Array.from(event.dataTransfer.files)) {
                    attachments.push({
                        name: file.name,
                        type: file.type,
                        size: file.size,
                        data: file,
                        source: "file-drop",
                    });
                }
            }

            // JSON transfer from another process (e.g. explorer → workcenter)
            const jsonPayload = event.dataTransfer.getData("application/json");
            if (jsonPayload) {
                try {
                    const parsed = JSON.parse(jsonPayload);
                    if (Array.isArray(parsed)) {
                        for (const item of parsed) {
                            attachments.push({
                                name: String(item.name || "transfer"),
                                type: String(item.type || "application/octet-stream"),
                                size: Number(item.size || 0),
                                data: item.data || item.content || "",
                                source: String(item.source || "process-transfer"),
                            });
                        }
                    } else if (parsed && typeof parsed === "object") {
                        attachments.push({
                            name: String(parsed.name || "transfer"),
                            type: String(parsed.type || "application/octet-stream"),
                            size: Number(parsed.size || 0),
                            data: parsed.data || parsed.content || "",
                            source: String(parsed.source || "process-transfer"),
                        });
                    }
                } catch {
                    // ignore malformed JSON
                }
            }

            // Text/URL fallback
            if (attachments.length === 0) {
                const text = event.dataTransfer.getData("text/plain")
                    || event.dataTransfer.getData("text/uri-list");
                if (text) {
                    attachments.push({
                        name: "drop",
                        type: "text/plain",
                        size: text.length,
                        data: text,
                        source: "text-drop",
                    });
                }
            }

            if (attachments.length > 0) {
                proc.channel.post({
                    type: "process-attach",
                    pid: proc.pid,
                    viewId: proc.viewId,
                    attachments,
                });
                await this.relayAttachmentsToView(proc, attachments, "drop");
            }
        });
    }

    // ========================================================================
    // PROCESS FOCUS / MINIMIZE
    // ========================================================================

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
        this.navigationState.params = proc.openParams.query;
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
            this.updateUrlState(proc.viewId, proc.pid, proc.openParams.query, true);
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
                this.updateUrlState(this.navigationState.currentView, null, undefined, true);
            }
        }
        this.syncDockItemState(proc.processId);
        this.updateStatusBar();
    }

    // ========================================================================
    // DOCK STATE
    // ========================================================================

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

    // ========================================================================
    // URL STATE
    // ========================================================================

    private updateUrlState(
        viewId: ViewId,
        pid: string | null,
        params?: Record<string, string>,
        replace = false
    ): void {
        if (typeof window === "undefined" || typeof window == "undefined") return;
        const urlParams = new URLSearchParams();
        for (const [key, value] of Object.entries(params || {})) {
            if (value == null) continue;
            if (key === "pid" || key === "minimized" || key === "headless" || key === "newTask") continue;
            urlParams.set(String(key), String(value));
        }
        const search = urlParams.size > 0
            ? `?${urlParams.toString()}`
            : "";
        const nextUrl = `/${search}${pid ? `#${pid}` : ""}`;
        const nextState = { viewId, pid, params };
        const writer = replace ? globalThis?.history?.replaceState : globalThis?.history?.pushState;
        writer?.call(globalThis.history, nextState, "", nextUrl);
    }

    // ========================================================================
    // HELPERS
    // ========================================================================

    private generatePid(viewId: ViewId): string {
        this.pidCounter += 1;
        const prefix = String(viewId || "view").slice(0, 3).toLowerCase().replace(/[^a-z0-9]/g, "") || "pid";
        return `${prefix}-${this.pidCounter}`;
    }

    /**
     * Build a URL that loads a view in a dedicated shell (base or minimal).
     * Carries GET query params; POST body is stashed in sessionStorage.
     */
    private buildDedicatedViewUrl(
        viewId: ViewId,
        shell: "base" | "minimal",
        params?: Record<string, string>,
        bodyToken?: string | null,
    ): string {
        const query = new URLSearchParams();
        query.set("shell", shell);
        for (const [key, value] of Object.entries(params || {})) {
            if (value == null) continue;
            if (["pid", "minimized", "headless", "newTask", "windowType", "processId"].includes(key)) continue;
            query.set(String(key), String(value));
        }
        if (bodyToken) query.set("_bodyToken", bodyToken);
        const suffix = query.toString();
        return `/${String(viewId || "home")}${suffix ? `?${suffix}` : ""}`;
    }

    /**
     * Stash process state (POST body, viewer content, etc.) into sessionStorage
     * so the new browser window can hydrate the view with full context.
     */
    private stashProcessState(
        proc: WindowProcess | null,
        viewId: ViewId,
        body?: unknown,
    ): { params: Record<string, string>; bodyToken: string | null } {
        const nextParams: Record<string, string> = { ...(proc?.openParams.query || {}) };
        let bodyToken: string | null = null;

        // Viewer: capture rendered content from the frame DOM
        if (viewId === "viewer" && proc?.viewId === "viewer") {
            const rawTarget = proc.frame.querySelector("[data-raw-target]") as HTMLElement | null;
            const content = String(rawTarget?.textContent || "").trim();
            if (content) {
                const token = `cw:detach:${viewId}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
                try {
                    globalThis?.sessionStorage?.setItem?.(token, JSON.stringify({
                        content,
                        filename: String(nextParams.filename || ""),
                        source: String(nextParams.source || nextParams.src || nextParams.path || ""),
                    }));
                    nextParams.detachKey = token;
                    delete nextParams.content;
                } catch {
                    nextParams.content = content;
                }
            }
        }

        // Stash POST body / initialData so the dedicated window can pick it up
        const bodyPayload = body ?? proc?.openParams.body;
        if (bodyPayload != null) {
            const token = `cw:body:${viewId}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
            try {
                const serialized = typeof bodyPayload === "string"
                    ? bodyPayload
                    : JSON.stringify(bodyPayload);
                globalThis?.sessionStorage?.setItem?.(token, serialized);
                bodyToken = token;
            } catch {
                // sessionStorage blocked — body won't transfer
            }
        }

        return { params: nextParams, bodyToken };
    }

    /**
     * Open a view as a dedicated browser window/tab in base or minimal shell.
     * Transfers full process state (query params + POST body via sessionStorage).
     */
    private openProcessAsDedicatedWindow(
        viewId: ViewId,
        params?: Record<string, string>,
        shell: "base" | "minimal" = "base",
        procForDetach?: WindowProcess | null,
        body?: unknown,
    ): void {
        const proc = procForDetach
            ?? (this.activePid ? this.processes.get(this.activePid) : null);
        const { params: nextParams, bodyToken } = this.stashProcessState(
            proc?.viewId === viewId ? proc : null,
            viewId,
            body,
        );
        // Merge explicit params (from open request) on top of stashed process params
        Object.assign(nextParams, params || {});
        const url = this.buildDedicatedViewUrl(viewId, shell, nextParams, bodyToken);
        try {
            globalThis?.open?.(url, "_blank", "noopener,noreferrer");
        } catch (error) {
            console.warn(`[window] Failed to open ${shell} shell tab:`, error);
            this.showMessage("Unable to open separate tab");
        }
    }

    // ========================================================================
    // STATUS BAR
    // ========================================================================

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

    // ========================================================================
    // MAXIMIZE
    // ========================================================================

    private toggleMaximize(frame: HTMLElement): void {
        const isMaximized = frame.classList.contains("is-maximized");
        if (isMaximized) {
            const prevShiftX = frame.dataset.prevShiftX || "0px";
            const prevShiftY = frame.dataset.prevShiftY || "0px";
            const prevWidth = frame.dataset.prevWidth || "640px";
            const prevHeight = frame.dataset.prevHeight || "480px";
            frame.style.setProperty("--shift-x", prevShiftX);
            frame.style.setProperty("--shift-y", prevShiftY);
            frame.style.setProperty("--initial-inline-size", prevWidth);
            frame.style.setProperty("--initial-block-size", prevHeight);
            frame.style.setProperty("--resize-x", "0px");
            frame.style.setProperty("--resize-y", "0px");
            frame.classList.remove("is-maximized");
            return;
        }
        frame.dataset.prevShiftX = frame.style.getPropertyValue("--shift-x") || "0px";
        frame.dataset.prevShiftY = frame.style.getPropertyValue("--shift-y") || "0px";
        frame.dataset.prevWidth = frame.style.getPropertyValue("--initial-inline-size") || "640px";
        frame.dataset.prevHeight = frame.style.getPropertyValue("--initial-block-size") || "480px";
        frame.style.setProperty("--shift-x", "0px");
        frame.style.setProperty("--shift-y", "0px");
        frame.style.setProperty("--initial-inline-size", "100%");
        frame.style.setProperty("--initial-block-size", "100%");
        frame.style.setProperty("--resize-x", "0px");
        frame.style.setProperty("--resize-y", "0px");
        frame.classList.add("is-maximized");
    }

    // ========================================================================
    // OVERLAY CHROME (dock + status bar)
    // ========================================================================

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
            dock.style.minBlockSize = "50px";
            dock.style.padding = "0.35rem 0.6rem 0.4rem";
            dock.style.alignItems = "center";
            dock.style.gap = "0.45rem";
            dock.style.flexWrap = "nowrap";
            dock.style.justifyContent = "center";
            dock.style.background = "light-dark(rgba(245,247,252,0.75), rgba(12,16,28,0.55))";
            dock.style.borderBlockStart = "1px solid light-dark(rgba(0,0,0,0.08), rgba(130,160,235,0.1))";
            dock.style.backdropFilter = "blur(24px) saturate(1.25)";
            dock.style.color = "light-dark(var(--color-on-surface, #1a1c2b), var(--color-on-surface, #e8eefc))";
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
            status.style.minBlockSize = "26px";
            status.style.padding = "0.2rem 0.65rem";
            status.style.alignItems = "center";
            status.style.gap = "0.55rem";
            status.style.fontSize = "0.72rem";
            status.style.color = "light-dark(color-mix(in oklab, var(--color-on-surface, #1a1c2b) 75%, transparent), color-mix(in oklab, var(--color-on-surface, #e8eefc) 75%, transparent))";
            status.style.background = "light-dark(rgba(245,247,252,0.6), rgba(12,16,28,0.35))";
            status.style.backdropFilter = "blur(16px) saturate(1.1)";
            status.style.borderBlockStart = "1px solid light-dark(rgba(0,0,0,0.06), rgba(255,255,255,0.04))";
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
                const linkedProcessId = target.dataset.processId;
                if (linkedProcessId) {
                    const linkedTask = this.processTasks.get(linkedProcessId);
                    if (linkedTask) {
                        const pid = linkedTask.lastActivePid || [...linkedTask.instances][0];
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
                            return;
                        }
                    }
                }
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
                void this.openWindowProcess(task.viewId, task.openParams.query || {});
            }
        });
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

export type { ProcessOpenParams, ProcessAttachment, ProcessChannel, WindowProcess };

export function createShell(_container: HTMLElement): WindowShell {
    return new WindowShell();
}

export default createShell;

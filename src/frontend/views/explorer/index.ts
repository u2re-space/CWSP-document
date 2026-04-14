/**
 * Explorer View
 *
 * Shell-agnostic file explorer component.
 * Uses the <view-explorer> web component for encapsulated rendering.
 */

import { H } from "fest/lure";
import { loadAsAdopted, removeAdopted } from "fest/dom";
import type { View, ViewOptions, ViewLifecycle, ShellContext } from "@shells/types";
import type { BaseViewOptions } from "@views/types";
import { getString, setString } from "@rs-core/storage";
import { sendViewProtocolMessage } from "@rs-com/core/UniformViewTransport";
import {
    addSpeedDialItem,
    ensureSpeedDialMeta,
    persistSpeedDialItems,
    persistSpeedDialMeta,
    createEmptySpeedDialItem,
    speedDialItems
} from "@rs-core/storage/StateStorage";
import "../../../../shared/fest/fl-ui/services/file-manager";
import { ensureCwViewExplorerDefined } from "./CwViewExplorer";

/** Re-export for lazy-loaded routes that expect `FileManager` on the explorer module. */
export { FileManager, FileManagerContent } from "../../../../shared/fest/fl-ui/services/file-manager";

ensureCwViewExplorerDefined();

// @ts-ignore
import style from "./scss/index.scss?inline";
export type ExplorerOptions = BaseViewOptions;
type WorkCenterAttachMode = "active" | "queued" | "headless";

type FileItem = {
    name?: string;
    kind?: "file" | "directory";
    file?: File;
};

type LocalFileManager = HTMLElement & {
    path: string;
    navigate(path: string): void;
};

type ContextMenuItem = {
    id: string;
    label: string;
    icon?: string;
    action: () => void;
};

const openExplorerContextMenu = (x: number, y: number, items: ContextMenuItem[]): void => {
    const menu = document.createElement("div");
    menu.className = "rs-explorer-context-menu";
    menu.setAttribute("role", "menu");

    const closeMenu = () => {
        document.removeEventListener("click", onDocClick, true);
        document.removeEventListener("keydown", onKey, true);
        menu.remove();
    };

    const onDocClick = (ev: MouseEvent) => {
        if (!menu.contains(ev.target as Node)) closeMenu();
    };

    const onKey = (ev: KeyboardEvent) => {
        if (ev.key === "Escape") {
            ev.preventDefault();
            closeMenu();
        }
    };

    for (const item of items) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "rs-explorer-context-menu__item";
        button.textContent = item.label;
        button.addEventListener("click", () => {
            item.action();
            closeMenu();
        });
        menu.append(button);
    }

    document.body.append(menu);

    const pad = 8;
    const vw = globalThis.innerWidth;
    const vh = globalThis.innerHeight;
    let left = x;
    let top = y;
    const rect = menu.getBoundingClientRect();
    if (left + rect.width > vw - pad) left = Math.max(pad, vw - rect.width - pad);
    if (top + rect.height > vh - pad) top = Math.max(pad, vh - rect.height - pad);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    requestAnimationFrame(() => {
        const r2 = menu.getBoundingClientRect();
        let l2 = left;
        let t2 = top;
        if (l2 + r2.width > vw - pad) l2 = Math.max(pad, vw - r2.width - pad);
        if (t2 + r2.height > vh - pad) t2 = Math.max(pad, vh - r2.height - pad);
        menu.style.left = `${l2}px`;
        menu.style.top = `${t2}px`;
    });

    queueMicrotask(() => {
        document.addEventListener("click", onDocClick, true);
    });
    document.addEventListener("keydown", onKey, true);
};

const requestOpenView = (request: {
    viewId: string;
    target?: "window" | "frame" | "shell" | "base" | "headless";
    params?: Record<string, string>;
}): void => {
    const viewId = String(request?.viewId || "").trim().toLowerCase();
    if (!viewId) return;
    globalThis?.dispatchEvent?.(new CustomEvent("cw:view-open-request", {
        detail: {
            viewId,
            target: request?.target || "window",
            params: request?.params || {}
        }
    }));
};

const TEXT_FILE_EXTENSIONS = new Set([
    "md", "markdown", "txt", "text", "json", "xml", "yml", "yaml",
    "html", "htm", "css", "js", "mjs", "cjs", "ts", "tsx", "jsx",
    "log", "ini", "conf", "cfg", "csv"
]);

const buildExplorerProcessId = (path?: string): string => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const stamp = Date.now().toString(36);
    const key = String(path || "root").replace(/[^a-z0-9_-]/gi, "-").slice(0, 18) || "root";
    return `explorer-${key}-${stamp}-${suffix}`;
};

const extOf = (filename = ""): string => {
    const next = String(filename).trim().toLowerCase();
    const idx = next.lastIndexOf(".");
    if (idx <= 0 || idx >= next.length - 1) return "";
    return next.slice(idx + 1);
};

const isTextLikeFile = (file?: File | null): boolean => {
    if (!file) return false;
    const type = String(file.type || "").toLowerCase();
    if (!type || type.startsWith("text/")) return true;
    if (type.includes("markdown") || type.includes("json") || type.includes("xml")) return true;
    return TEXT_FILE_EXTENSIONS.has(extOf(file.name || ""));
};

const buildViewerProcessId = (path?: string): string => {
    const suffix = Math.random().toString(36).slice(2, 8);
    const stamp = Date.now().toString(36);
    const key = String(path || "viewer").replace(/[^a-z0-9_-]/gi, "-").slice(0, 18) || "viewer";
    return `viewer-${key}-${stamp}-${suffix}`;
};

const guessNextShortcutCell = (): [number, number] => {
    const occupied = new Set(
        (speedDialItems || []).map((item) => `${Math.round(item?.cell?.[0] || 0)}:${Math.round(item?.cell?.[1] || 0)}`)
    );
    const maxRows = 12;
    const maxCols = 8;
    for (let row = 0; row < maxRows; row += 1) {
        for (let col = 0; col < maxCols; col += 1) {
            const key = `${col}:${row}`;
            if (!occupied.has(key)) return [col, row];
        }
    }
    return [0, 0];
};

// ============================================================================
// EXPLORER VIEW
// ============================================================================

export class ExplorerView implements View {
    id = "explorer" as const;
    name = "Explorer";
    icon = "folder";

    private options: BaseViewOptions;
    private shellContext?: ShellContext;
    private element: HTMLElement | null = null;
    private explorer: LocalFileManager | null = null;
    private initialPath: string | null = null;

    private _sheet: CSSStyleSheet | null = null;

    lifecycle: ViewLifecycle = {
        onMount: () => { this.loadLastPath(); this._sheet ??= loadAsAdopted(style) as CSSStyleSheet; },
        onUnmount: () => { removeAdopted(this._sheet); this.saveCurrentPath(); },
        onShow: () => { this._sheet ??= loadAsAdopted(style) as CSSStyleSheet; },
        onHide: () => { this.saveCurrentPath(); },
    };

    constructor(options: BaseViewOptions = {}) {
        this.options = options;
        this.shellContext = options.shellContext;
        this.initialPath = options.params?.path ? String(options.params.path) : null;
    }

    render(options?: ViewOptions): HTMLElement {
        if (options) {
            this.options = { ...this.options, ...options };
            this.shellContext = options.shellContext || this.shellContext;
            if (options.params?.path) {
                this.initialPath = String(options.params.path);
            }
        }

        this._sheet = loadAsAdopted(style) as CSSStyleSheet;

        const hasFileManager = Boolean(customElements.get("ui-file-manager"));
        this.element = hasFileManager
            ? H`
                <cw-view-explorer></cw-view-explorer>
            ` as HTMLElement
            : H`
                <div class="view-explorer">
                    <div class="view-explorer__content" data-explorer-content>
                        <div class="view-explorer__fallback">
                            <h3>Explorer fallback mode</h3>
                            <p>File manager component is unavailable; use local files below.</p>
                            <div class="view-explorer__fallback-actions">
                                <button type="button" data-action="pick-files">Open files</button>
                                <button type="button" data-action="open-workcenter">Open Work Center</button>
                            </div>
                            <ul class="view-explorer__fallback-files" data-fallback-files></ul>
                        </div>
                    </div>
                </div>
            ` as HTMLElement;

        this.explorer = this.element.querySelector("ui-file-manager") as LocalFileManager | null;
        if (this.explorer) {
            this.explorer.removeAttribute("hidden");
            this.explorer.style.display = "block";
            this.setupExplorerEvents();
        } else {
            this.setupFallbackExplorerEvents();
        }

        return this.element;
    }

    getToolbar(): HTMLElement | null {
        return null;
    }

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

    private setupExplorerEvents(): void {
        if (!this.explorer) return;
        const explorer = this.explorer as LocalFileManager & HTMLElement;
        const readFileDetail = (event: Event): { item?: FileItem; path?: string } => {
            const detail = (event as CustomEvent<{ item?: FileItem; path?: string }>).detail || {};
            return { item: detail?.item, path: detail?.path };
        };
        const openFileInViewer = async (
            item: FileItem | undefined,
            fullPath: string | undefined,
            target: "window" | "base" = "window"
        ) => {
            const file = item?.file as File | undefined;
            if (!file || !isTextLikeFile(file)) return false;
            const sourcePath = String(fullPath || "");
            if (target === "base") {
                requestOpenView({
                    viewId: "viewer",
                    target: "base",
                    params: {
                        src: sourcePath,
                        filename: file.name || "",
                        processId: buildViewerProcessId(sourcePath)
                    }
                });
                return true;
            }

            const processId = buildViewerProcessId(sourcePath);
            requestOpenView({
                viewId: "viewer",
                target: "window",
                params: {
                    processId,
                    src: sourcePath,
                    filename: file.name || ""
                }
            });

            try {
                const sent = await sendViewProtocolMessage({
                    type: "content-view",
                    source: "explorer",
                    destination: "viewer",
                    contentType: file.type || "text/plain",
                    attachments: [{ data: file, source: "explorer-viewer-open" }],
                    data: {
                        filename: file.name,
                        path: sourcePath,
                        source: sourcePath
                    },
                    metadata: {
                        processId,
                        openTarget: "window"
                    }
                });
                if (!sent) {
                    this.showMessage("Viewer is not ready yet, retrying in background");
                }
            } catch (error) {
                console.warn("[Explorer] Failed to send viewer payload:", error);
            }
            return true;
        };
        const attachToWorkCenter = async (item: FileItem | undefined, mode: WorkCenterAttachMode) => {
            const file = item?.file as File | undefined;
            if (!file) {
                this.showMessage("No file selected");
                return;
            }
            const sourcePath = `${this.explorer?.path || "/"}${item?.name || file.name}`;
            if (mode === "headless") {
                requestOpenView({
                    viewId: "workcenter",
                    target: "headless",
                    params: {
                        queue: "1",
                        mode: "headless",
                        sourcePath
                    }
                });
            } else if (mode === "active") {
                requestOpenView({ viewId: "workcenter", target: "window" });
            } else {
                requestOpenView({
                    viewId: "workcenter",
                    target: "window",
                    params: { minimized: "1", queue: "1", sourcePath }
                });
            }

            const sent = await sendViewProtocolMessage({
                type: "content-share",
                source: "explorer",
                destination: "workcenter",
                contentType: file.type || "application/octet-stream",
                attachments: [{ data: file, source: "explorer-workcenter-attach" }],
                data: {
                    filename: file.name,
                    path: sourcePath,
                    source: "explorer-attach",
                    queued: mode !== "active"
                },
                metadata: {
                    queueState: mode === "active" ? "awaiting" : mode === "queued" ? "pending" : "queued",
                    mode,
                    sourcePath
                }
            });
            if (sent) {
                this.showMessage(mode === "active"
                    ? `Attached ${file.name} to Work Center`
                    : `Queued ${file.name} for Work Center (${mode})`);
            } else {
                this.showMessage("Work Center queue is unavailable");
            }
        };
        const pinToHome = (item: FileItem | undefined) => {
            const file = item?.file as File | undefined;
            const name = String(item?.name || file?.name || "").trim();
            if (!name) {
                this.showMessage("Nothing to pin");
                return;
            }
            const path = `${this.explorer?.path || "/"}${name}`;
            const cell = guessNextShortcutCell();
            const shortcut = createEmptySpeedDialItem(cell);
            shortcut.label.value = name;
            shortcut.icon.value = item?.kind === "directory" ? "folder" : "file-text";
            shortcut.action = "open-link";
            addSpeedDialItem(shortcut);
            const meta = ensureSpeedDialMeta(shortcut.id, { action: "open-link" });
            meta.action = "open-link";
            meta.href = path;
            meta.description = `Pinned from Explorer: ${path}`;
            persistSpeedDialItems();
            persistSpeedDialMeta();
            this.showMessage(`Pinned ${name} to Home`);
        };

        // Handle file open
        const onFileOpen = async (e: Event) => {
            const { item, path } = readFileDetail(e);
            if (item?.kind !== "file" || !item?.file) return;
            const opened = await openFileInViewer(item, path, "window");
            if (!opened) {
                requestOpenView({ viewId: "workcenter", target: "window" });
            }
        };
        explorer.addEventListener("open-item", onFileOpen);
        explorer.addEventListener("open", onFileOpen);
        explorer.addEventListener("rs-open", onFileOpen);

        // Handle path changes
        explorer.addEventListener("rs-navigate", () => {
            this.saveCurrentPath();
        });
        const getItemPath = (item?: FileItem): string => `${this.explorer?.path || "/"}${item?.name || ""}`;
        const contextActionHandlers: Record<string, (item?: FileItem) => Promise<void> | void> = {
            view: async (item) => { await openFileInViewer(item, getItemPath(item), "window"); },
            "view-base": async (item) => { await openFileInViewer(item, getItemPath(item), "base"); },
            "attach-workcenter": (item) => attachToWorkCenter(item, "active"),
            "attach-workcenter-queued": (item) => attachToWorkCenter(item, "queued"),
            "attach-workcenter-headless": (item) => attachToWorkCenter(item, "headless"),
            "pin-home": (item) => pinToHome(item)
        };
        explorer.addEventListener("context-action", async (event: Event) => {
            const detail = (event as CustomEvent<{ action?: string; item?: FileItem }>).detail || {};
            const action = String(detail.action || "");
            const item = detail.item;
            if (!action) return;
            const handler = contextActionHandlers[action];
            if (!handler) return;
            await handler(item);
        });

        explorer.addEventListener("contextmenu", (event: MouseEvent) => {
            const pathItems = event.composedPath?.() || [];
            const inFileItem = pathItems.some((node) => {
                const el = node as HTMLElement | null;
                if (!el || typeof el.classList?.contains !== "function") return false;
                return el.classList.contains("row")
                    || el.classList.contains("action-btn")
                    || el.classList.contains("ctx-menu");
            });
            if (inFileItem) {
                // Keep file-manager native row context menu/actions intact.
                return;
            }
            event.preventDefault();
            const path = this.explorer?.path || "/";
            openExplorerContextMenu(event.clientX, event.clientY, [
                    {
                        id: "refresh",
                        label: "Refresh",
                        icon: "arrows-clockwise",
                        action: () => {
                            if (!this.explorer) return;
                            this.explorer.navigate(path);
                        }
                    },
                    {
                        id: "open-new-explorer",
                        label: "New Explorer window",
                        icon: "books",
                        action: () => requestOpenView({
                            viewId: "explorer",
                            target: "window",
                            params: {
                                path,
                                processId: buildExplorerProcessId(path)
                            }
                        })
                    },
                    {
                        id: "open-home",
                        label: "Go to Home",
                        icon: "house",
                        action: () => this.shellContext?.navigate("home")
                    }
                ]);
        });
    }

    private setupFallbackExplorerEvents(): void {
        if (!this.element) return;
        const filesList = this.element.querySelector('[data-fallback-files]') as HTMLUListElement | null;
        const pickBtn = this.element.querySelector('[data-action="pick-files"]') as HTMLButtonElement | null;
        const workBtn = this.element.querySelector('[data-action="open-workcenter"]') as HTMLButtonElement | null;
        if (!pickBtn || !filesList) return;

        const input = document.createElement("input");
        input.type = "file";
        input.multiple = true;
        input.accept = ".md,.markdown,.txt,.json,.xml,.yaml,.yml,.csv,.log,text/*";
        input.style.display = "none";
        this.element.append(input);

        pickBtn.addEventListener("click", () => input.click());
        workBtn?.addEventListener("click", () => requestOpenView({ viewId: "workcenter", target: "window" }));

        input.addEventListener("change", async () => {
            const files = Array.from(input.files || []);
            filesList.replaceChildren();
            if (files.length === 0) return;

            for (const file of files) {
                const li = document.createElement("li");
                li.textContent = file.name;
                filesList.append(li);
            }

            const firstTextLike = files.find((file) => isTextLikeFile(file));
            if (firstTextLike) {
                requestOpenView({ viewId: "viewer", target: "window" });
                const sent = await sendViewProtocolMessage({
                    type: "content-view",
                    source: "explorer-fallback",
                    destination: "viewer",
                    contentType: firstTextLike.type || "text/plain",
                    attachments: [{ data: firstTextLike, source: "explorer-fallback" }],
                    data: {
                        filename: firstTextLike.name,
                        source: "explorer-fallback"
                    }
                });
                if (!sent) {
                    this.showMessage("Viewer is not ready yet");
                }
            }
        });
    }

    private loadLastPath(): void {
        if (this.explorer) {
            if (this.initialPath && this.initialPath.trim()) {
                this.explorer.path = this.initialPath.trim();
                return;
            }
            const persisted = String(getString("view-explorer-path", "/user/") || "").trim();
            // Recover old readonly default "/" from previous builds.
            const nextPath = !persisted || persisted === "/" ? "/user/" : persisted;
            this.explorer.path = nextPath;
        }
    }

    private saveCurrentPath(): void {
        if (this.explorer) {
            const currentPath = this.explorer.path || "/user/";
            setString("view-explorer-path", currentPath);
        }
    }

    private showMessage(message: string): void {
        this.shellContext?.showMessage(message);
    }

    canHandleMessage(messageType: string): boolean {
        return ["file-save", "navigate-path", "content-explorer"].includes(messageType);
    }

    async handleMessage(message: unknown): Promise<void> {
        const msg = message as { data?: { path?: string; into?: string } };
        const targetPath = msg.data?.path || msg.data?.into;
        if (targetPath && this.explorer) {
            this.explorer.navigate(targetPath);
        }
    }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createView(options?: ExplorerOptions): ExplorerView {
    return new ExplorerView(options);
}

/** Alias for createView */
export const createExplorerView = createView;

export default createView;

/**
 * Explorer View
 *
 * Shell-agnostic file explorer component.
 * Uses the <view-explorer> web component for encapsulated rendering.
 */

import { H } from "fest/lure";
import { loadAsAdopted, removeAdopted } from "fest/dom";
import type { View, ViewOptions, ViewLifecycle, ShellContext } from "../../shells/types";
import type { BaseViewOptions } from "../types";
import { getString, setString } from "../../../core/storage";
import { ViewRegistry } from "../../shared/registry";

// Import the view-explorer web component from fl.ui
import { FileManager, type FileItem } from "fest/fl-ui";

// Re-export FileManager for backwards compatibility
export { FileManager, FileManagerContent } from "fest/fl-ui";

// @ts-ignore
import style from "./index.scss?inline";

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
    private explorer: FileManager | null = null;

    private _sheet: CSSStyleSheet | null = null;
    private readonly imageExtensions = new Set([
        "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "avif"
    ]);
    private readonly markdownExtensions = new Set([
        "md", "markdown", "mdown", "mkd", "mkdn", "txt", "json", "yml", "yaml", "html", "htm", "css", "js", "ts", "tsx"
    ]);

    lifecycle: ViewLifecycle = {
        onMount: () => { this.loadLastPath(); this._sheet ??= loadAsAdopted(style) as CSSStyleSheet; },
        onUnmount: () => { removeAdopted(this._sheet); this.saveCurrentPath(); },
        onShow: () => { this._sheet ??= loadAsAdopted(style) as CSSStyleSheet; },
        onHide: () => { this.saveCurrentPath(); },
    };

    constructor(options: BaseViewOptions = {}) {
        this.options = options;
        this.shellContext = options.shellContext;
    }

    render(options?: ViewOptions): HTMLElement {
        if (options) {
            this.options = { ...this.options, ...options };
            this.shellContext = options.shellContext || this.shellContext;
        }

        this._sheet = loadAsAdopted(style) as CSSStyleSheet;

        // Create element with view-explorer web component
        this.element = H`
            <div class="view-explorer">
                <div class="view-explorer__content" data-explorer-content>
                    <ui-file-manager view-mode="list"></ui-file-manager>
                </div>
            </div>
        ` as HTMLElement;

        // Get reference to view-explorer component
        this.explorer = this.element.querySelector("ui-file-manager") as unknown as FileManager;

        // Setup event listeners
        this.setupExplorerEvents();

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
        const explorer = this.explorer as unknown as FileManager & HTMLElement;

        const handleOpenEvent = async (e: Event) => {
            const detail = (e as CustomEvent<{ item: FileItem; path?: string }>).detail;
            const item = detail?.item;
            if (!item) return;
            await this.openByAssociation(item, detail?.path);
        };
        explorer.addEventListener("open", handleOpenEvent as EventListener);
        explorer.addEventListener("rs-open", handleOpenEvent as EventListener);

        explorer.addEventListener("context-action", async (e: Event) => {
            const detail = (e as CustomEvent<{ action?: string; item?: FileItem }>).detail || {};
            const item = detail.item;
            if (!item || item.kind !== "file") return;
            if (detail.action === "view") {
                await this.openInViewer(item);
                return;
            }
            if (detail.action === "attach-workcenter") {
                await this.attachToWorkCenter(item);
                return;
            }
            if (detail.action === "pin-home") {
                await this.pinToHomeScreen(item);
                return;
            }
        });

        // Handle path changes
        explorer.addEventListener("rs-navigate", () => {
            this.saveCurrentPath();
        });
    }

    private normalizePath(path?: string): string {
        const raw = (path || "").trim();
        if (!raw) return "/";
        return raw.startsWith("/") ? raw : `/${raw}`;
    }

    private joinPath(dirPath?: string, name?: string): string {
        const dir = this.normalizePath(dirPath || this.explorer?.path || "/");
        const base = dir.endsWith("/") ? dir : `${dir}/`;
        return `${base}${name || ""}`;
    }

    private extensionFor(item: FileItem): string {
        const name = String(item?.name || "").toLowerCase();
        const idx = name.lastIndexOf(".");
        if (idx < 0) return "";
        return name.slice(idx + 1);
    }

    private async resolveFile(item: FileItem, explicitPath?: string): Promise<{ file: File | null; path: string }> {
        const path = this.normalizePath(explicitPath || this.joinPath(this.explorer?.path || "/", item?.name || ""));
        if (item?.file instanceof File) return { file: item.file, path };
        try {
            const { provide } = await import("fest/lure");
            const file = await provide(path).catch(() => null);
            return { file: file instanceof File ? file : null, path };
        } catch {
            return { file: null, path };
        }
    }

    private async openInViewer(item: FileItem): Promise<void> {
        const { file, path } = await this.resolveFile(item);
        const ext = this.extensionFor(item);
        const isImage = this.imageExtensions.has(ext) || (file?.type || "").startsWith("image/");
        try {
            await this.shellContext?.navigate("viewer");
            const viewer = ViewRegistry.getLoaded("viewer") || await ViewRegistry.load("viewer", { shellContext: this.shellContext });
            if (!viewer?.handleMessage) {
                this.showMessage("Viewer is unavailable");
                return;
            }
            if (isImage) {
                const markdown = `![${item.name || "image"}](${path})`;
                await viewer.handleMessage({
                    type: "content-view",
                    data: { text: markdown, filename: item.name, source: path, path, src: path }
                });
            } else if (file) {
                const content = await file.text();
                await viewer.handleMessage({
                    type: "content-view",
                    data: { text: content, filename: item.name, source: path, path, src: path }
                });
            } else {
                await viewer.handleMessage({
                    type: "content-view",
                    data: { url: path, filename: item.name, source: path, path, src: path }
                });
            }
            this.showMessage(`Opened ${item.name || "file"} in viewer`);
        } catch (error) {
            console.warn("[Explorer] Failed to view file:", error);
            this.showMessage("Failed to open in viewer");
        }
    }

    private async attachToWorkCenter(item: FileItem): Promise<void> {
        const { file, path } = await this.resolveFile(item);
        try {
            await this.shellContext?.navigate("workcenter");
            const workcenter =
                ViewRegistry.getLoaded("workcenter") ||
                await ViewRegistry.load("workcenter", { shellContext: this.shellContext });
            if (!workcenter?.handleMessage) {
                this.showMessage("Work Center is unavailable");
                return;
            }
            if (file) {
                await workcenter.handleMessage({
                    type: "content-share",
                    contentType: file.type || "application/octet-stream",
                    data: {
                        file,
                        files: [file],
                        filename: file.name,
                        path,
                        source: "explorer-attach"
                    }
                });
            } else {
                await workcenter.handleMessage({
                    type: "content-share",
                    contentType: "text/uri-list",
                    data: { url: path, path, source: "explorer-attach" }
                });
            }
            this.showMessage(`Attached ${item.name || "file"} to Work Center`);
        } catch (error) {
            console.warn("[Explorer] Failed to attach file:", error);
            this.showMessage("Failed to attach to Work Center");
        }
    }

    private async pinToHomeScreen(item: FileItem): Promise<void> {
        const { file, path } = await this.resolveFile(item);
        const ext = this.extensionFor(item);
        const isImage = this.imageExtensions.has(ext) || (file?.type || "").startsWith("image/");
        const action = isImage ? "open-link" : "open-view";
        const shortcut = {
            state: {
                icon: isImage ? "image" : (this.markdownExtensions.has(ext) ? "file-text" : "file"),
                label: item.name || "File shortcut",
                action
            },
            desc: {
                action,
                meta: isImage
                    ? { href: path, description: `Pinned from Explorer: ${path}` }
                    : { view: "viewer", source: path, path, src: path, description: `Pinned from Explorer: ${path}` }
            }
        };
        try {
            await navigator.clipboard?.writeText?.(JSON.stringify(shortcut));
            this.showMessage("Shortcut copied. Go Home and paste to pin.");
        } catch (error) {
            console.warn("[Explorer] Failed to copy pin shortcut:", error);
            this.showMessage("Failed to copy shortcut payload");
        }
    }

    private async openByAssociation(item: FileItem, explicitPath?: string): Promise<void> {
        if (item.kind === "directory") {
            return;
        }
        const ext = this.extensionFor(item);
        const { file } = await this.resolveFile(item, explicitPath);
        const isImage = this.imageExtensions.has(ext) || (file?.type || "").startsWith("image/");
        const isMarkdownLike = this.markdownExtensions.has(ext) || (file?.type || "").startsWith("text/") || (file?.type || "").includes("json");

        if (isImage || isMarkdownLike) {
            await this.openInViewer(item);
            return;
        }
        await this.attachToWorkCenter(item);
    }

    private loadLastPath(): void {
        if (this.explorer) {
            const lastPath = getString("view-explorer-path", "/");
            this.explorer.path = lastPath;
        }
    }

    private saveCurrentPath(): void {
        if (this.explorer) {
            const currentPath = this.explorer.path || "/";
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

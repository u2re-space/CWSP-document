/**
 * Explorer View
 *
 * Shell-agnostic file explorer. Shell mounts `render()` output (light DOM); wires FL-UI
 * `<ui-file-manager>` via `runtime.ts` on lifecycle mount (matches AirPad/Simplified CE pattern).
 */

import type { ViewOptions as ShellViewOptions, ViewLifecycle } from "shells/types";
import type { BaseViewOptions } from "views/types";
import type { ViewOptions as RegistryViewOptions } from "../registry";
import { createViewConstructor, ViewBase } from "../registry";
import { loadAsAdopted, removeAdopted } from "fest/dom";
import type { ExplorerInjectApi } from "./inject";
import type { LocalFileManager } from "./runtime";
import { wireExplorerSubtree } from "./runtime";

/** Re-export + ensure `ui-file-manager` is defined when this module loads. */
export { FileManager, FileManagerContent } from "fest/fl-ui";

export type { ExplorerInjectApi } from "./inject";
export { registerExplorerInject, mergeExplorerInject } from "./inject";
export { wireExplorerSubtree } from "./runtime";

// @ts-ignore — Vite inline SCSS
import style from "./index.scss?inline";

export type ExplorerOptions = BaseViewOptions & { explorerInject?: ExplorerInjectApi };

function buildExplorerShell(): HTMLElement {
    const shell = document.createElement("div");
    shell.className = "view-explorer";
    shell.setAttribute("aria-label", "File explorer");
    const content = document.createElement("div");
    content.className = "view-explorer__content";
    content.setAttribute("data-explorer-content", "");
    const fm = document.createElement("ui-file-manager");
    fm.setAttribute("view-mode", "list");
    content.append(fm);
    shell.append(content);
    return shell;
}

function buildFallbackShell(): HTMLElement {
    const shell = document.createElement("div");
    shell.className = "view-explorer";
    shell.setAttribute("aria-label", "File explorer (fallback)");
    const content = document.createElement("div");
    content.className = "view-explorer__content";
    content.setAttribute("data-explorer-content", "");
    content.innerHTML = `
        <div class="view-explorer__fallback">
            <h3>Explorer fallback mode</h3>
            <p>File manager component is unavailable; use local files below.</p>
            <div class="view-explorer__fallback-actions">
                <button type="button" data-action="pick-files">Open files</button>
                <button type="button" data-action="open-workcenter">Open Work Center</button>
            </div>
            <ul class="view-explorer__fallback-files" data-fallback-files></ul>
        </div>`;
    shell.append(content);
    return shell;
}

//
export const TAG = "cw-view-explorer";

export const CwViewExplorer = createViewConstructor(TAG, (Base: typeof ViewBase) => {
    return class ExplorerView extends Base {
        id = "explorer" as const;
        name = "Explorer";
        icon = "folder";

        private explorerRoot: HTMLElement | null = null;
        private explorerCleanup: (() => void) | null = null;
        private wiredFileManager: LocalFileManager | null = null;
        private initialPath: string | null = null;
        private explorerInject?: ExplorerInjectApi;

        private _sheet: CSSStyleSheet | null = null;

        lifecycle: ViewLifecycle = {
            onMount: () => {
                this._sheet ??= loadAsAdopted(style) as CSSStyleSheet;
                this.attachExplorerWire();
            },
            onUnmount: () => {
                this.detachExplorerWire();
                removeAdopted(this._sheet);
                this._sheet = null;
            },
            onShow: () => {
                this._sheet ??= loadAsAdopted(style) as CSSStyleSheet;
                if (!this.explorerCleanup && this.explorerRoot) {
                    this.attachExplorerWire();
                }
            },
            onHide: () => {
                this.detachExplorerWire();
                removeAdopted(this._sheet);
                this._sheet = null;
            }
        };

        constructor(options?: ExplorerOptions) {
            super();
            if (options) {
                this.options = options as unknown as RegistryViewOptions;
                this.explorerInject = options.explorerInject;
                if (options.params?.path) {
                    this.initialPath = String(options.params.path);
                }
            }
        }

        render = (options?: ShellViewOptions): HTMLElement => {
            if (options) {
                this.options = {
                    ...(this.options as object),
                    ...(options as object)
                } as RegistryViewOptions;
                const p = (options as BaseViewOptions)?.params?.path;
                if (p) {
                    this.initialPath = String(p);
                }
                const inj = (options as ExplorerOptions)?.explorerInject;
                if (inj !== undefined) {
                    this.explorerInject = inj;
                }
            }

            if (this.explorerCleanup) {
                this.detachExplorerWire();
            }

            this._sheet = loadAsAdopted(style) as CSSStyleSheet;

            const hasFileManager = Boolean(customElements.get("ui-file-manager"));
            this.explorerRoot = hasFileManager ? buildExplorerShell() : buildFallbackShell();

            return this.explorerRoot;
        };

        getToolbar(): HTMLElement | null {
            return null;
        }

        canHandleMessage(messageType: string): boolean {
            return ["file-save", "navigate-path", "content-explorer"].includes(messageType);
        }

        async handleMessage(message: unknown): Promise<void> {
            const msg = message as { data?: { path?: string; into?: string } };
            const targetPath = msg.data?.path || msg.data?.into;
            if (targetPath && this.wiredFileManager) {
                void this.wiredFileManager.navigate(targetPath);
            }
        }

        private attachExplorerWire(): void {
            if (!this.explorerRoot) return;
            const shellOpts = this.options as unknown as BaseViewOptions;
            const { cleanup, fileManager } = wireExplorerSubtree(this.explorerRoot, {
                shellContext: shellOpts?.shellContext,
                initialPath: this.initialPath,
                inject: this.explorerInject
            });
            this.explorerCleanup = cleanup;
            this.wiredFileManager = fileManager;
        }

        private detachExplorerWire(): void {
            this.explorerCleanup?.();
            this.explorerCleanup = null;
            this.wiredFileManager = null;
        }
    };
}) as CustomElementConstructor;

// Registry default factory (non-CE — avoids double-wrap when registry detects HTMLElement subclasses).
export function createExplorerView(options?: ExplorerOptions) {
    const Ctor = CwViewExplorer as unknown as {
        new (opts?: ExplorerOptions): HTMLElement;
    };
    return new Ctor(options);
}

export default createExplorerView;

/**
 * Environment shell — web desktop model:
 * - `home` (wallpaper + speed dial) stays in `[data-shell-desktop]` as the bottom layer.
 * - Other views mount in `[data-shell-window-stage]` as maximized overlays.
 *
 * NOTE:
 * `src/frontend/shells/environment` is a symlink to this directory in this repo.
 * Use import aliases so this file resolves correctly regardless of path identity.
 */

import { H } from "fest/lure";
import type { ShellId, ShellLayoutConfig, ViewId } from "@rs-frontend/shells/types";
import { MinimalShell } from "@rs-frontend/shells/minimal";

export class EnvironmentShell extends MinimalShell {
    override id: ShellId = "environment";
    override name = "Environment";

    override layout: ShellLayoutConfig = {
        hasSidebar: false,
        hasToolbar: true,
        hasTabs: false,
        supportsMultiView: true,
        supportsWindowing: true
    };

    protected desktopContainer: HTMLElement | null = null;
    protected windowStage: HTMLElement | null = null;
    private frameByViewId = new Map<ViewId, HTMLElement>();
    protected getHomeLayerTarget(): HTMLElement | null {
        if (typeof document !== "undefined") {
            const globalHome = document.querySelector<HTMLElement>("[data-cw-app-home-layer]");
            if (globalHome) return globalHome;
        }
        return this.desktopContainer;
    }

    protected override createLayout(): HTMLElement {
        const root = H`
            <div class="app-shell" data-shell="environment" data-env-surface-mode="desktop">
                <header class="app-shell__window-titlebar" data-shell-window-titlebar>
                    <div class="app-shell__window-title">CrossWord</div>
                    <div class="app-shell__window-controls" role="toolbar" aria-label="Window controls">
                        <button class="app-shell__window-btn" type="button" data-shell-win-action="minimize" title="Minimize">
                            <ui-icon icon="minus"></ui-icon>
                        </button>
                        <button class="app-shell__window-btn" type="button" data-shell-win-action="maximize" title="Maximize">
                            <ui-icon icon="arrows-out"></ui-icon>
                        </button>
                        <button class="app-shell__window-btn danger" type="button" data-shell-win-action="close" title="Close">
                            <ui-icon icon="x"></ui-icon>
                        </button>
                    </div>
                </header>
                <nav class="app-shell__nav" role="navigation" aria-label="Main navigation">
                    <div class="app-shell__nav-left" data-nav-left>
                        ${this.renderNavButtons()}
                    </div>
                    <div class="app-shell__nav-right" data-shell-toolbar>
                    </div>
                </nav>
                <main class="app-shell__content app-shell__content--environment" data-shell-content role="main">
                    <div class="app-shell__desktop" data-shell-desktop aria-label="Home desktop"></div>
                    <div class="app-shell__window-stage" data-shell-window-stage hidden aria-label="Application window"></div>
                    <div class="app-shell__loading">
                        <div class="loading-spinner"></div>
                        <span>Loading...</span>
                    </div>
                </main>
                <div class="app-shell__status" data-shell-status hidden aria-live="polite"></div>
            </div>
        ` as HTMLElement;

        this.desktopContainer = root.querySelector("[data-shell-desktop]");
        this.windowStage = root.querySelector("[data-shell-window-stage]");
        root.dataset.shellWindowMode = "maximized";

        this.setupNavClickHandlers(root);
        this.setupWindowControls(root);
        root.dataset.shellWindowMode = "maximized";
        globalThis.addEventListener?.("resize", () => {
            // MinimalShell defaults desktop to "windowed"; environment keeps fullscreen desktop semantics.
            root.dataset.shellWindowMode = "maximized";
        }, { passive: true });
        return root;
    }

    private getShellInnerRoot(): HTMLElement | null {
        const host = this.rootElement as HTMLElement | null;
        if (!host) return null;
        return host.querySelector<HTMLElement>(".app-shell");
    }

    private setEnvironmentSurfaceMode(mode: "desktop" | "window"): void {
        const root = this.getShellInnerRoot();
        if (!root) return;
        root.dataset.envSurfaceMode = mode;
    }

    private createWindowFrame(viewId: ViewId): HTMLElement {
        const frame = H`
            <section class="app-shell__window-frame" data-shell-window-frame data-view-frame="${String(viewId)}" aria-label="Window frame">
                <header class="app-shell__window-frame-titlebar">
                    <div class="app-shell__window-frame-title">${String(viewId)}</div>
                </header>
                <div class="app-shell__window-frame-content" data-shell-window-frame-content></div>
            </section>
        ` as HTMLElement;
        return frame;
    }

    private ensureWindowFrame(viewId: ViewId): HTMLElement {
        const existing = this.frameByViewId.get(viewId);
        if (existing) return existing;
        const frame = this.createWindowFrame(viewId);
        this.frameByViewId.set(viewId, frame);
        return frame;
    }

    override async navigate(viewId: ViewId, params?: Record<string, string>): Promise<void> {
        if (viewId !== "home") {
            await this.ensureHomeOnDesktop();
        }
        return super.navigate(viewId, params);
    }

    private async ensureHomeOnDesktop(): Promise<void> {
        const target = this.getHomeLayerTarget();
        if (!target) return;
        const homeEl = await this.loadView("home", {});
        homeEl.setAttribute("data-view", "home");
        homeEl.hidden = false;
        if (!target.contains(homeEl)) {
            target.appendChild(homeEl);
        }
    }

    protected override renderView(element: HTMLElement): void {
        if (!this.contentContainer || !this.windowStage) {
            super.renderView(element);
            return;
        }

        const vid = this.currentView.value;
        this.contentContainer.setAttribute("data-current-view", String(vid));

        if (vid === "home") {
            this.setEnvironmentSurfaceMode("desktop");
            this.windowStage.hidden = true;
            this.windowStage.replaceChildren();
            this.frameByViewId.clear();

            element.setAttribute("data-view", "home");
            element.hidden = false;
            const homeTarget = this.getHomeLayerTarget();
            if (homeTarget && !homeTarget.contains(element)) {
                homeTarget.appendChild(element);
            }
            this.currentViewElement = element;
            return;
        }

        this.setEnvironmentSurfaceMode("window");
        this.windowStage.hidden = false;

        const previousId = this.navigationState.previousView;
        if (previousId && previousId !== "home" && previousId !== vid && this.loadedViews.has(previousId)) {
            const prev = this.loadedViews.get(previousId)!;
            if (this.windowStage.contains(prev.element)) {
                prev.element.removeAttribute("data-view");
                prev.element.hidden = true;
                prev.element.remove();
            }
        }

        element.setAttribute("data-view", String(vid));
        element.hidden = false;
        const frame = this.ensureWindowFrame(vid);
        const frameContent = frame.querySelector<HTMLElement>("[data-shell-window-frame-content]");
        if (frameContent && !frameContent.contains(element)) {
            frameContent.replaceChildren(element);
        }
        if (!this.windowStage.contains(frame)) {
            this.windowStage.replaceChildren(frame);
        }
        this.currentViewElement = element;
    }
}

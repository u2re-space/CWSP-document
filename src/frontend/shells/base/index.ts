/**
 * Base Shell
 *
 * Base shell with no frames, navigation UI, or chrome.
 * Just a content container with theme support.
 *
 * Use cases:
 * - Fullscreen views
 * - Print layouts
 * - Embedded views
 * - Single-component rendering
 */

import { H } from "fest/lure";
import type { ShellId, ShellLayoutConfig, ShellTheme } from "shells/types";

// @ts-ignore - SCSS import
import style from "./base.scss?inline";
import { ShellBase } from "frontend/shells/core/shells";

// ============================================================================
// BASE SHELL IMPLEMENTATION
// ============================================================================

export class BaseShell extends ShellBase {
    id: ShellId = "base";
    name = "Base";

    layout: ShellLayoutConfig = {
        hasSidebar: false,
        hasToolbar: false,
        hasTabs: false,
        supportsMultiView: false,
        supportsWindowing: false
    };
    private wcoGeometryHandler: (() => void) | null = null;
    private wcoResizeHandler: (() => void) | null = null;

    protected createLayout(): HTMLElement {
        const root = H`
            <div class="app-shell" data-shell="base" data-style="base">
                <div class="app-shell__viewport">
                    <main class="app-shell__content" data-shell-content role="main">
                        <div class="app-shell__loading">
                            <div class="loading-spinner"></div>
                            <span>Loading...</span>
                        </div>
                        <slot name="view"></slot>
                    </main>
                    <div class="app-shell__overlays" data-shell-overlays></div>
                </div>
                <div class="app-shell__status" data-shell-status hidden aria-live="polite"></div>
            </div>
        ` as HTMLElement;

        return root;
    }

    protected getStylesheet(): string | null {
        return style;
    }

    /**
     * Theme lives on `cw-shell-*` in `applyTheme`; inner `.app-shell` needs the same `data-theme`
     * so shell SCSS `&[data-theme="light"|"dark"]` and token rules apply (matches MinimalShell).
     */
    protected applyTheme(theme: ShellTheme): void {
        const inner = this.rootElement?.shadowRoot?.querySelector(".app-shell") as HTMLElement | null;
        if (inner) {
            inner.dataset.theme = this.resolveShellColorScheme(theme);
        }
        super.applyTheme(theme);
    }

    /**
     * Match MinimalShell: assign `slot="view"` and append the view to the shell host (light DOM).
     * Document-level view CSS (`views.scss`, adopted view sheets) does not pierce shadow roots; views
     * must not live only under `.app-shell__content` inside the shadow tree.
     */
    protected renderView(element: HTMLElement): void {
        if (!this.contentContainer || !this.rootElement) {
            console.warn(`[${this.id}] No content container available`);
            return;
        }

        this.contentContainer.setAttribute("data-current-view", this.currentView.value);

        const previousId = this.navigationState.previousView;
        if (previousId && previousId !== this.currentView.value && this.loadedViews.has(previousId)) {
            const prev = this.loadedViews.get(previousId)!;
            prev.element.removeAttribute("data-view");
            prev.element.hidden = true;
            if (this.rootElement.contains(prev.element)) {
                prev.element.remove();
            }
        }

        element.setAttribute("data-view", this.currentView.value);
        element.hidden = false;
        element.slot = "view";

        if (!this.rootElement.contains(element)) {
            this.rootElement.appendChild(element);
        }

        const loading = this.contentContainer.querySelector(".app-shell__loading") as HTMLElement | null;
        if (loading) loading.hidden = true;

        this.currentViewElement = element;
    }

    async mount(container: HTMLElement): Promise<void> {
        await super.mount(container);

        // Base shell uses simplified navigation
        this.setupHashNavigation();
        this.setupPopstateNavigation();
        this.bindWindowControlsOverlay();
    }

    unmount(): void {
        this.unbindWindowControlsOverlay();
        super.unmount();
    }

    private bindWindowControlsOverlay(): void {
        const nav = (globalThis?.navigator as any) || {};
        const overlay = nav?.windowControlsOverlay;
        const host = this.rootElement as HTMLElement | null;
        if (!host || !overlay) return;

        const update = () => {
            const isVisible = Boolean(overlay?.visible);
            host.setAttribute("data-wco-visible", isVisible ? "true" : "false");
            const rect = overlay?.getTitlebarAreaRect?.();
            if (isVisible && rect) {
                host.style.setProperty("--wco-titlebar-x", `${Math.max(0, Number(rect.x) || 0)}px`);
                host.style.setProperty("--wco-titlebar-y", `${Math.max(0, Number(rect.y) || 0)}px`);
                host.style.setProperty("--wco-titlebar-width", `${Math.max(0, Number(rect.width) || 0)}px`);
                host.style.setProperty("--wco-titlebar-height", `${Math.max(0, Number(rect.height) || 0)}px`);
            } else {
                host.style.setProperty("--wco-titlebar-x", "0px");
                host.style.setProperty("--wco-titlebar-y", "0px");
                host.style.setProperty("--wco-titlebar-width", "0px");
                host.style.setProperty("--wco-titlebar-height", "0px");
            }
        };

        this.wcoGeometryHandler = () => update();
        this.wcoResizeHandler = () => update();
        try {
            overlay?.addEventListener?.("geometrychange", this.wcoGeometryHandler);
        } catch {
            // ignore unsupported implementations
        }
        globalThis?.addEventListener?.("resize", this.wcoResizeHandler);
        update();
    }

    private unbindWindowControlsOverlay(): void {
        const nav = (globalThis?.navigator as any) || {};
        const overlay = nav?.windowControlsOverlay;
        if (overlay && this.wcoGeometryHandler) {
            try {
                overlay?.removeEventListener?.("geometrychange", this.wcoGeometryHandler);
            } catch {
                // ignore unsupported implementations
            }
        }
        if (this.wcoResizeHandler) {
            globalThis?.removeEventListener?.("resize", this.wcoResizeHandler);
        }
        this.wcoGeometryHandler = null;
        this.wcoResizeHandler = null;
    }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a base shell instance
 */
export function createShell(_container: HTMLElement): BaseShell {
    return new BaseShell();
}

export default createShell;

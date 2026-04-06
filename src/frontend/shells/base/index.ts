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
import type { ShellId, ShellLayoutConfig } from "@shells/types";

// @ts-ignore - SCSS import
import style from "./base.scss?inline";
import { ShellBase } from "@shells/shell";

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
            <div class="app-shell" data-shell="base">
                <div class="app-shell__status" data-shell-status hidden aria-live="polite"></div>
                <div class="app-shell__viewport">
                    <div class="app-shell__content" data-shell-content></div>
                    <div class="app-shell__overlays" data-shell-overlays></div>
                </div>
            </div>
        ` as HTMLElement;

        return root;
    }

    protected getStylesheet(): string | null {
        return style;
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

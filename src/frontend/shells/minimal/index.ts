/**
 * Minimal Shell
 *
 * Simple toolbar-based single-view shell.
 * Features:
 * - Top navigation toolbar with view buttons
 * - Status bar for messages
 * - Single content area for one active view
 * - NO split view, NO sidebar, NO tabs
 */

import { H } from "fest/lure";
import { affected } from "fest/object";
import type { ShellId, ShellLayoutConfig, ViewId } from "../types";

// @ts-ignore - SCSS import
import style from "./minimal.scss?inline";

// Side effect: register icon component
import "fest/icon";
import { ShellBase } from "../shell";
import { isEnabledView } from "../../config/views";
import type { ShellTheme } from "../types";
import { requestOpenViewInTarget } from "../../shared/view-api";

// ============================================================================
// NAVIGATION ITEMS
// ============================================================================

/** Navigation item configuration */
interface NavItem {
    readonly id: ViewId;
    readonly name: string;
    readonly icon: string;
}

/** Main navigation items shown in the toolbar */
const ALL_NAV_ITEMS = [
    { id: "viewer", name: "Viewer", icon: "eye" },
    { id: "explorer", name: "Explorer", icon: "folder" },
    { id: "workcenter", name: "Work Center", icon: "lightning" },
    { id: "airpad", name: "Airpad", icon: "hand-pointing" },
    { id: "settings", name: "Settings", icon: "gear" },
    { id: "history", name: "History", icon: "clock-counter-clockwise" }
] as const satisfies readonly NavItem[];
const MAIN_NAV_ITEMS = ALL_NAV_ITEMS.filter((item) => isEnabledView(item.id));

/** Set of valid nav view IDs for fast lookup */
const VALID_NAV_VIEW_IDS = new Set(MAIN_NAV_ITEMS.map(item => item.id));

/** Type guard for valid navigation view IDs */
function isValidNavViewId(id: string): id is typeof MAIN_NAV_ITEMS[number]["id"] {
    return VALID_NAV_VIEW_IDS.has(id as any);
}

// ============================================================================
// BASIC SHELL IMPLEMENTATION
// ============================================================================

export class MinimalShell extends ShellBase {
    id: ShellId = "minimal";
    name = "Minimal";

    layout: ShellLayoutConfig = {
        hasSidebar: false,
        hasToolbar: true,
        hasTabs: false,
        supportsMultiView: false,
        supportsWindowing: false
    };

    protected createLayout(): HTMLElement {
        const root = H`
            <div class="app-shell" data-shell="minimal">
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
                        <!-- View-specific toolbar actions go here -->
                    </div>
                </nav>
                <main class="app-shell__content" data-shell-content role="main">
                    <div class="app-shell__loading">
                        <div class="loading-spinner"></div>
                        <span>Loading...</span>
                    </div>
                </main>
                <div class="app-shell__status" data-shell-status hidden aria-live="polite"></div>
            </div>
        ` as HTMLElement;

        this.setupNavClickHandlers(root);
        this.setupWindowControls(root);
        return root;
    }

    protected renderNavButtons(): DocumentFragment {
        const fragment = document.createDocumentFragment();

        for (const item of MAIN_NAV_ITEMS) {
            const button = H`
                <button
                    class="app-shell__nav-btn"
                    data-view="${item.id}"
                    type="button"
                    title="${item.name}"
                >
                    <ui-icon icon="${item.icon}" icon-style="duotone"></ui-icon>
                    <span class="app-shell__nav-label">${item.name}</span>
                </button>
            ` as HTMLButtonElement;

            fragment.appendChild(button);
        }

        return fragment;
    }

    protected setupNavClickHandlers(root: HTMLElement): void {
        const navLeft = root.querySelector("[data-nav-left]");
        if (!navLeft) return;

        // Handle nav button clicks
        navLeft.addEventListener("click", (e) => {
            const target = e.target as HTMLElement;
            const button = target.closest("[data-view]") as HTMLButtonElement | null;
            if (!button) return;

            const viewId = button.dataset.view;
            if (viewId && isValidNavViewId(viewId)) {
                this.navigate(viewId);
            }
        });

        // Update active state reactively
        affected(this.currentView, (viewId) => {
            this.updateActiveNavButton(navLeft, viewId);
        });
    }

    protected setupWindowControls(root: HTMLElement): void {
        const titlebar = root.querySelector("[data-shell-window-titlebar]") as HTMLElement | null;
        if (!titlebar) return;
        const updateMobileMode = () => {
            const mobile = globalThis.matchMedia?.("(max-width: 860px)")?.matches ?? false;
            root.dataset.shellWindowMode = mobile ? "maximized" : "windowed";
        };
        updateMobileMode();
        globalThis.addEventListener?.("resize", updateMobileMode, { passive: true });

        titlebar.addEventListener("click", (event) => {
            const target = event.target as HTMLElement | null;
            const action = target?.closest?.("[data-shell-win-action]")?.getAttribute?.("data-shell-win-action");
            if (!action) return;
            if (action === "minimize") {
                root.classList.add("is-minimized");
                setTimeout(() => root.classList.remove("is-minimized"), 220);
                this.setActiveTaskState("minimized");
                return;
            }
            if (action === "maximize") {
                const mode = root.dataset.shellWindowMode === "maximized" ? "windowed" : "maximized";
                root.dataset.shellWindowMode = mode;
                this.setActiveTaskState("active");
                return;
            }
            if (action === "close") {
                this.setActiveTaskState("background");
                requestOpenViewInTarget("home", { target: "shell" });
            }
        });
    }

    protected updateActiveNavButton(navContainer: Element, activeViewId: ViewId): void {
        const buttons = navContainer.querySelectorAll("[data-view]");
        buttons.forEach(btn => {
            const isActive = (btn as HTMLElement).dataset.view === activeViewId;
            btn.classList.toggle("active", isActive);
            btn.setAttribute("aria-current", isActive ? "page" : "false");
        });
    }

    protected getStylesheet(): string | null {
        return style;
    }

    /**
     * Views mount in `[data-shell-content]` (light DOM under `cw-webtop-environment`).
     */
    protected applyTheme(theme: ShellTheme): void {
        const inner =
            (this.rootElement?.querySelector(".app-shell") as HTMLElement | null) ||
            (this.rootElement?.shadowRoot?.querySelector(".app-shell") as HTMLElement | null);
        if (inner) {
            inner.dataset.theme = this.resolveShellColorScheme(theme);
        }
        super.applyTheme(theme);
    }

    async mount(container: HTMLElement): Promise<void> {
        await super.mount(container);

        // Setup path-based navigation
        this.setupPopstateNavigation();
        globalThis.addEventListener?.("cw:view-open-request", ((event: Event) => {
            const detail = (event as CustomEvent).detail || {};
            const viewId = String(detail?.viewId || "").trim();
            if (!viewId) return;
            void this.navigate(viewId as ViewId, (detail?.query || {}) as Record<string, string>);
        }) as EventListener);
    }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Factory function for creating MinimalShell instances.
 * 
 * Note: The container parameter is required by ShellRegistration interface
 * but not used here - the shell is mounted later via shell.mount(container).
 */
export function createShell(_container: HTMLElement): MinimalShell {
    return new MinimalShell();
}

export default createShell;

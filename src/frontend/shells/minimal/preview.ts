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
import type { ShellId, ShellLayoutConfig, ViewId } from "shells/types";

// @ts-ignore - SCSS import
import style from "./minimal.scss?inline";

// Side effect: register icon component
import "fest/icon";
import { isEnabledView } from "shared/routing/views";
import type { ShellTheme } from "shells/types";
import { ShellBase } from "../core/shells";

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
                    <slot name="view"></slot>
                </main>
                <div class="app-shell__status" data-shell-status hidden aria-live="polite"></div>
            </div>
        ` as HTMLElement;

        this.setupNavClickHandlers(root);
        return root;
    }

    private renderNavButtons(): DocumentFragment {
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

    private setupNavClickHandlers(root: HTMLElement): void {
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

    private updateActiveNavButton(navContainer: Element, activeViewId: ViewId): void {
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
     * View hosts (`cw-view-*`) stay in the shell host's light DOM with `slot="view"` so they project
     * into shadow `<main>` (see `MinimalShellHostElement`).
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

    protected applyTheme(theme: ShellTheme): void {
        const inner = this.rootElement?.shadowRoot?.querySelector(".app-shell") as HTMLElement | null;
        if (inner) {
            inner.dataset.theme = this.resolveShellColorScheme(theme);
        }
        super.applyTheme(theme);
    }

    async mount(container: HTMLElement): Promise<void> {
        await super.mount(container);

        // Setup path-based navigation
        this.setupPopstateNavigation();
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

/**
 * Faint Shell
 *
 * Experimental tabbed interface with sidebar navigation.
 * Features:
 * - Collapsible sidebar with icons
 * - Tabbed view management
 * - Speed dial home view
 * - Dynamic view creation
 * - Theme support with wallpapers
 */

import { ShellBase } from "./shell";
import { H } from "fest/lure";
import { ref, observe, affected } from "fest/object";
import { ViewRegistry } from "../../shared/ui/registry";
import type { ShellId, ShellLayoutConfig, ViewId } from "./types";

// @ts-ignore - SCSS import
import style from "./faint.scss?inline";

// Side effect: register icon component
import "fest/icon";
// Side effect: register fl-ui components
import "fest/fl-ui";

// ============================================================================
// FAINT SHELL IMPLEMENTATION
// ============================================================================

export class FaintShell extends ShellBase {
    id: ShellId = "faint";
    name = "Faint";

    layout: ShellLayoutConfig = {
        hasSidebar: true,
        hasToolbar: true,
        hasTabs: true,
        supportsMultiView: true,
        supportsWindowing: false
    };

    // UI State
    private sidebarCollapsed = ref(false);
    private openTabs = observe(new Map<ViewId, { name: string; icon: string }>());
    private activeTab = ref<ViewId>("home");

    // UI Elements (used for future extensions)
    // @ts-expect-error - kept for future use
    private sidebarElement: HTMLElement | null = null;
    // @ts-expect-error - kept for future use
    private tabBarElement: HTMLElement | null = null;

    protected createLayout(): HTMLElement {
        const root = H`
            <div class="app-shell" data-shell="faint">
                ${this.createSidebar()}
                <div class="app-shell__main">
                    ${this.createTabBar()}
                    <div class="app-shell__toolbar" data-shell-toolbar>
                        <!-- View-specific toolbar -->
                    </div>
                    <main class="app-shell__content" data-shell-content role="main">
                        ${this.createHomeView()}
                    </main>
                </div>
                <div class="app-shell__status" data-shell-status hidden aria-live="polite"></div>
            </div>
        ` as HTMLElement;

        return root;
    }

    private createSidebar(): HTMLElement {
        const mainViews: Array<{ id: ViewId; name: string; icon: string; category?: string }> = [
            { id: "home", name: "Home", icon: "house" },
            { id: "viewer", name: "Viewer", icon: "eye" },
            { id: "editor", name: "Editor", icon: "pencil" },
            { id: "workcenter", name: "Work Center", icon: "lightning" },
            { id: "explorer", name: "Explorer", icon: "folder" },
            { id: "airpad", name: "Airpad", icon: "hand-pointing" },
            { id: "settings", name: "Settings", icon: "gear" },
            { id: "history", name: "History", icon: "clock-counter-clockwise" }
        ];

        const sidebar = H`
            <aside class="app-shell__sidebar" data-collapsed="${this.sidebarCollapsed.value}">
                <div class="app-shell__sidebar-header">
                    <button
                        class="app-shell__sidebar-toggle"
                        type="button"
                        title="Toggle sidebar"
                        aria-label="Toggle sidebar"
                    >
                        <ui-icon icon="sidebar" icon-style="duotone"></ui-icon>
                    </button>
                </div>
                <nav class="app-shell__sidebar-nav" role="navigation">
                    ${mainViews.map(item => H`
                        <button
                            class="app-shell__sidebar-item"
                            data-view="${item.id}"
                            type="button"
                            title="${item.name}"
                        >
                            <ui-icon icon="${item.icon}" icon-style="duotone"></ui-icon>
                            <span class="app-shell__sidebar-label">${item.name}</span>
                        </button>
                    `)}
                </nav>
            </aside>
        ` as HTMLElement;

        // Toggle sidebar
        const toggleBtn = sidebar.querySelector(".app-shell__sidebar-toggle");
        toggleBtn?.addEventListener("click", () => {
            this.sidebarCollapsed.value = !this.sidebarCollapsed.value;
            sidebar.dataset.collapsed = String(this.sidebarCollapsed.value);
        });

        // Navigation click handler
        sidebar.addEventListener("click", (e) => {
            const target = e.target as HTMLElement;
            const button = target.closest("[data-view]") as HTMLButtonElement | null;
            if (!button) return;

            const viewId = button.dataset.view as ViewId;
            if (viewId) {
                this.navigate(viewId);
            }
        });

        // Update active state
        affected(this.activeTab, (viewId) => {
            const buttons = sidebar.querySelectorAll("[data-view]");
            buttons.forEach(btn => {
                const isActive = (btn as HTMLElement).dataset.view === viewId;
                btn.classList.toggle("active", isActive);
            });
        });

        this.sidebarElement = sidebar;
        return sidebar;
    }

    private createTabBar(): HTMLElement {
        const tabBar = H`
            <div class="app-shell__tabs" role="tablist">
                <div class="app-shell__tabs-list" data-tabs-list>
                    <!-- Tabs render here -->
                </div>
                <div class="app-shell__tabs-actions">
                    <button class="app-shell__tabs-add" type="button" title="New tab" aria-label="New tab">
                        <ui-icon icon="plus" icon-style="bold"></ui-icon>
                    </button>
                </div>
            </div>
        ` as HTMLElement;

        // Re-render tabs when openTabs changes
        affected(this.openTabs as any, () => {
            this.renderTabs(tabBar);
        });

        // Also re-render when active tab changes
        affected(this.activeTab, () => {
            this.renderTabs(tabBar);
        });

        this.tabBarElement = tabBar;
        return tabBar;
    }

    private renderTabs(tabBar: HTMLElement): void {
        const tabsList = tabBar.querySelector("[data-tabs-list]");
        if (!tabsList) return;

        tabsList.replaceChildren();

        // Always show home tab
        const homeTab = this.createTabElement("home", "Home", "house");
        tabsList.appendChild(homeTab);

        // Add open tabs
        for (const [viewId, info] of this.openTabs) {
            if (viewId === "home") continue;
            const tab = this.createTabElement(viewId, info.name, info.icon);
            tabsList.appendChild(tab);
        }
    }

    private createTabElement(viewId: ViewId, name: string, icon: string): HTMLElement {
        const isActive = this.activeTab.value === viewId;
        const isCloseable = viewId !== "home";

        const tab = H`
            <div
                class="app-shell__tab ${isActive ? "active" : ""}"
                data-tab="${viewId}"
                role="tab"
                aria-selected="${isActive}"
            >
                <ui-icon icon="${icon}" icon-style="duotone"></ui-icon>
                <span class="app-shell__tab-label">${name}</span>
                ${isCloseable ? H`
                    <button
                        class="app-shell__tab-close"
                        type="button"
                        title="Close tab"
                        data-close="${viewId}"
                    >
                        <ui-icon icon="x" icon-style="bold" size="12"></ui-icon>
                    </button>
                ` : ""}
            </div>
        ` as HTMLElement;

        // Tab click handler
        tab.addEventListener("click", (e) => {
            const target = e.target as HTMLElement;
            const closeBtn = target.closest("[data-close]");

            if (closeBtn) {
                // Close tab
                const closeId = (closeBtn as HTMLElement).dataset.close as ViewId;
                this.closeTab(closeId);
            } else {
                // Activate tab
                this.navigate(viewId);
            }
        });

        return tab;
    }

    private closeTab(viewId: ViewId): void {
        if (viewId === "home") return;

        // Remove from open tabs
        this.openTabs.delete(viewId);

        // If closing active tab, switch to another
        if (this.activeTab.value === viewId) {
            const remaining = Array.from(this.openTabs.keys());
            const nextTab = remaining[remaining.length - 1] || "home";
            this.navigate(nextTab);
        }

        // Unload view
        ViewRegistry.unload(viewId);
    }

    private createHomeView(): HTMLElement {
        // Simple home/speed dial view
        const home = H`
            <div class="app-shell__home" data-view-id="home">
                <div class="app-shell__home-content">
                    <h1 class="app-shell__home-title">CrossWord</h1>
                    <p class="app-shell__home-subtitle">Select a view from the sidebar to get started</p>
                    <div class="app-shell__home-quick-actions">
                        <button class="app-shell__home-action" data-view="viewer" type="button">
                            <ui-icon icon="eye" icon-style="duotone" size="32"></ui-icon>
                            <span>Viewer</span>
                        </button>
                        <button class="app-shell__home-action" data-view="workcenter" type="button">
                            <ui-icon icon="lightning" icon-style="duotone" size="32"></ui-icon>
                            <span>Work Center</span>
                        </button>
                        <button class="app-shell__home-action" data-view="explorer" type="button">
                            <ui-icon icon="folder" icon-style="duotone" size="32"></ui-icon>
                            <span>Explorer</span>
                        </button>
                    </div>
                </div>
            </div>
        ` as HTMLElement;

        // Quick action clicks
        home.addEventListener("click", (e) => {
            const target = e.target as HTMLElement;
            const button = target.closest("[data-view]") as HTMLButtonElement | null;
            if (!button) return;

            const viewId = button.dataset.view as ViewId;
            if (viewId) {
                this.navigate(viewId);
            }
        });

        return home;
    }

    protected getStylesheet(): string | null {
        return style;
    }

    async navigate(viewId: ViewId, params?: Record<string, string>): Promise<void> {
        console.log(`[Faint] Navigating to: ${viewId}`);

        // Update active tab
        this.activeTab.value = viewId;

        // Add to open tabs if not home
        if (viewId !== "home" && !this.openTabs.has(viewId)) {
            const registration = ViewRegistry.get(viewId);
            this.openTabs.set(viewId, {
                name: registration?.name || viewId,
                icon: registration?.icon || "circle"
            });
        }

        // Call parent navigation
        await super.navigate(viewId, params);
    }

    async mount(container: HTMLElement): Promise<void> {
        await super.mount(container);

        // Setup path-based navigation
        this.setupPopstateNavigation();

        // Navigate based on pathname
        const pathname = globalThis?.location?.pathname?.replace(/^\//, "").toLowerCase();
        if (pathname && pathname !== "home") {
            await this.navigate(pathname as ViewId);
        } else {
            this.activeTab.value = "home";
        }
    }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a faint shell instance
 */
export function createShell(_container: HTMLElement): FaintShell {
    return new FaintShell();
}

export default createShell;

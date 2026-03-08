import { ref } from "fest/object";
import type { Shell, ShellContext, ShellId, ShellLayoutConfig, ShellNavigationState, ShellTheme, View, ViewId } from "./types";
import { loadInlineStyle, preloadStyle } from "fest/dom";
import { ViewRegistry } from "../shared/registry";
import { showToast } from "@rs-frontend/items/Toast";
import { withViewTransition, getTransitionDirection } from "../shared/view-transitions";
import { loadSettings, saveSettings } from "@rs-com/config/Settings";
import { applyTheme as applyAppTheme } from "@rs-core/utils/Theme";

//
import "fest/fl-ui";

//@ts-ignore
import style from "../shared/_views.scss?inline";


/**
 * Abstract base shell with common functionality
 */
export abstract class ShellBase implements Shell {
    // Shell properties
    abstract id: ShellId;
    abstract name: string;
    abstract layout: ShellLayoutConfig;

    // State (using any to work around fest/object type inference issue)
    theme = ref<ShellTheme>({ id: "auto", name: "Auto", colorScheme: "auto" });
    currentView = ref<ViewId>("home");
    protected navigationState: ShellNavigationState = {
        currentView: "home",
        viewHistory: []
    };

    // DOM elements
    protected container: HTMLElement | null = null;
    protected rootElement: HTMLElement | null = null;
    protected contentContainer: HTMLElement | null = null;
    protected toolbarContainer: HTMLElement | null = null;
    protected toolbarViewSlot: HTMLElement | null = null;
    protected toolbarThemeSlot: HTMLElement | null = null;
    protected statusContainer: HTMLElement | null = null;

    // View cache
    protected loadedViews = new Map<ViewId, { view: View; element: HTMLElement }>();
    protected currentViewElement: HTMLElement | null = null;

    // Mounted state
    protected mounted = false;
    protected themeSelectElement: HTMLSelectElement | null = null;

    // ========================================================================
    // ABSTRACT METHODS (to be implemented by concrete shells)
    // ========================================================================

    /**
     * Create the shell's root layout element
     */
    protected abstract createLayout(): HTMLElement;

    /**
     * Get shell-specific stylesheet (optional)
     */
    protected abstract getStylesheet(): string | null;

    // ========================================================================
    // SHELL INTERFACE IMPLEMENTATION
    // ========================================================================

    async mount(container: HTMLElement): Promise<void> {
        if (this.mounted) {
            console.warn(`[${this.id}] Shell already mounted`);
            return;
        }

        this.container = container;

        // Load stylesheet if provided
        const stylesheet = this.getStylesheet();
        if (stylesheet) {
            const styled = await preloadStyle(stylesheet);
            if (styled) {
                await loadInlineStyle(stylesheet);
            }
        }

        // Create layout
        this.rootElement = this.createLayout();

        // CRITICAL: Set data-shell attribute for context-based CSS selectors
        // This enables :has([data-shell="...""]) selectors to cascade automatically
        this.rootElement.setAttribute('data-shell', this.id);

        // Find containers
        this.contentContainer = this.rootElement.querySelector("[data-shell-content]") || this.rootElement;
        this.toolbarContainer = this.rootElement.querySelector("[data-shell-toolbar]");
        this.statusContainer = this.rootElement.querySelector("[data-shell-status]");
        this.ensureToolbarChrome();

        // Apply initial theme
        this.applyTheme(this.getThemeRefValue());

        // Mount to container
        container.replaceChildren(this.rootElement);
        this.mounted = true;

        console.log(`[${this.id}] Shell mounted with data-shell="${this.id}"`);
    }

    unmount(): void {
        if (!this.mounted) return;

        // Cleanup views
        for (const [viewId, { view }] of this.loadedViews) {
            if (view.lifecycle?.onUnmount) {
                try {
                    view.lifecycle.onUnmount();
                } catch (e) {
                    console.warn(`[${this.id}] View ${viewId} unmount error:`, e);
                }
            }
        }
        this.loadedViews.clear();

        // Clear DOM
        this.rootElement?.remove();
        this.rootElement = null;
        this.contentContainer = null;
        this.toolbarContainer = null;
        this.statusContainer = null;
        this.container = null;
        this.mounted = false;

        console.log(`[${this.id}] Shell unmounted`);
    }

    async navigate(viewId: ViewId, params?: Record<string, string>): Promise<void> {
        console.log(`[${this.id}] Navigating to: ${viewId}`, params);

        // Capture previous view BEFORE updating state (needed for direction + onHide)
        const previousView = this.navigationState.currentView;

        // Update navigation state
        this.navigationState.previousView = previousView;
        this.navigationState.currentView = viewId;
        this.navigationState.params = params;

        // Add to history (avoid duplicates)
        if (this.navigationState.viewHistory[this.navigationState.viewHistory.length - 1] !== viewId) {
            this.navigationState.viewHistory.push(viewId);
            // Limit history size
            if (this.navigationState.viewHistory.length > 50) {
                this.navigationState.viewHistory.shift();
            }
        }

        // Update reactive state
        this.currentView.value = viewId;

        // Update URL pathname (path-based routing, no hash)
        if (typeof window !== "undefined" && typeof window != "undefined") {
            const pathname = `/${viewId}`;
            const search = params ? "?" + new URLSearchParams(params).toString() : "";
            const newUrl = pathname + search;

            if (globalThis?.location?.pathname !== pathname) {
                globalThis?.history?.pushState?.({ viewId, params }, "", newUrl);
            }
        }

        // Load and render view (load happens outside the transition to avoid blocking it)
        try {
            const element = await this.loadView(viewId, params);
            await this.renderViewWithTransition(element);
        } catch (error) {
            console.error(`[${this.id}] Failed to load view ${viewId}:`, error);
            this.showMessage(`Failed to load ${viewId}`);
        }
    }

    async loadView(viewId: ViewId, params?: Record<string, string>): Promise<HTMLElement> {
        // Check cache first
        const cached = this.loadedViews.get(viewId);
        if (cached) {
            // Call onShow lifecycle
            if (cached.view.lifecycle?.onShow) {
                cached.view.lifecycle.onShow();
            }
            // Update toolbar if view has one
            if (cached.view.getToolbar && this.toolbarContainer) {
                const toolbar = cached.view.getToolbar();
                this.setViewToolbar(toolbar);
            }
            return cached.element;
        }

        // Load view from registry
        const view = await ViewRegistry.load(viewId, {
            shellContext: this.getContext(),
            params
        });

        // Render view
        const element = view.render({
            shellContext: this.getContext(),
            params
        });

        // Cache view
        this.loadedViews.set(viewId, { view, element });

        // Set toolbar if view has one
        if (view.getToolbar && this.toolbarContainer) {
            const toolbar = view.getToolbar();
            this.setViewToolbar(toolbar);
        }

        // Call lifecycle
        if (view.lifecycle?.onMount) {
            await view.lifecycle.onMount();
        }
        if (view.lifecycle?.onShow) {
            view.lifecycle.onShow();
        }

        return element;
    }

    setTheme(theme: ShellTheme): void {
        (this.theme as any).value = theme;
        this.applyTheme(theme);
        this.syncThemeToolbarControls();
    }

    getContext(): ShellContext {
        return {
            shellId: this.id,
            navigate: (viewId, params) => this.navigate(viewId, params),
            goBack: () => this.goBack(),
            showMessage: (msg, duration) => this.showMessage(msg, duration),
            navigationState: this.navigationState,
            theme: this.getThemeRefValue(),
            layout: this.layout,
            getContentContainer: () => this.contentContainer!,
            getToolbarContainer: () => this.toolbarContainer,
            setViewToolbar: (toolbar) => this.setViewToolbar(toolbar)
        };
    }

    getElement(): HTMLElement {
        if (!this.rootElement) {
            throw new Error(`[${this.id}] Shell not mounted`);
        }
        return this.rootElement;
    }

    // ========================================================================
    // PROTECTED METHODS
    // ========================================================================

    /**
     * Perform the raw DOM swap for a view change (no transition animation).
     *
     * This is the synchronous inner mutation used both as a standalone call
     * and as the update callback inside `renderViewWithTransition`.
     * `onHide` must be called by the caller BEFORE invoking this when using
     * a view transition so the old view's final state is captured correctly.
     */
    protected renderView(element: HTMLElement): void {
        if (!this.contentContainer) {
            console.warn(`[${this.id}] No content container available`);
            return;
        }

        this.contentContainer.setAttribute("data-current-view", this.currentView.value);

        // Detach previous view from DOM and keep it cached in loadedViews.
        const previousId = this.navigationState.previousView;
        if (previousId && previousId !== this.currentView.value && this.loadedViews.has(previousId)) {
            const prev = this.loadedViews.get(previousId)!;
            prev.element.removeAttribute("data-view");
            prev.element.hidden = true;
            if (this.contentContainer.contains(prev.element)) {
                prev.element.remove();
            }
        }

        // Show active view and mark it for :has() context selectors.
        element.setAttribute("data-view", this.currentView.value);
        element.hidden = false;

        // Add to content if not already there
        if (!this.contentContainer.contains(element)) {
            this.contentContainer.appendChild(element);
        }

        this.currentViewElement = element;
    }

    /**
     * Render a view with a View Transition animation.
     *
     * Calls `onHide` on the outgoing view BEFORE the transition starts so the
     * browser captures the old view in its final settled state.  The actual
     * DOM swap runs inside `document.startViewTransition()` so the browser can
     * capture before/after snapshots and cross-fade (or slide) between them.
     *
     * Falls back to a plain `renderView` call on browsers that do not support
     * the View Transition API.
     */
    protected async renderViewWithTransition(element: HTMLElement): Promise<void> {
        if (!this.contentContainer) {
            this.renderView(element);
            return;
        }

        const previousId = this.navigationState.previousView;
        const prevEntry =
            previousId && previousId !== this.currentView.value
                ? this.loadedViews.get(previousId)
                : undefined;

        // Fire onHide BEFORE the transition so the old view's state is stable
        // when the browser captures the "old" snapshot.
        if (prevEntry?.view.lifecycle?.onHide) {
            prevEntry.view.lifecycle.onHide();
        }

        const direction = getTransitionDirection(previousId ?? "", this.currentView.value);

        await withViewTransition(
            () => this.renderView(element),
            {
                direction,
                // Level 2 type labels for richer CSS targeting via
                // :active-view-transition-type() (Chrome 125+).
                types: [direction, `to-${this.currentView.value}`],
            },
        );
    }

    /**
     * Apply theme to the shell
     */
    protected applyTheme(theme: ShellTheme): void {
        if (!this.rootElement) return;

        // Set color scheme
        const prefersDark = globalThis?.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
        const resolved = theme.colorScheme === "dark" ? "dark"
            : theme.colorScheme === "light" ? "light"
            : prefersDark ? "dark" : "light";

        this.rootElement.dataset.theme = resolved;
        this.rootElement.style.colorScheme = resolved;

        // Apply CSS variables if provided
        if (theme.cssVariables) {
            for (const [key, value] of Object.entries(theme.cssVariables)) {
                this.rootElement.style.setProperty(key, value);
            }
        }
    }

    protected getThemeRefValue(): ShellTheme {
        return (this.theme as any)?.value as ShellTheme;
    }

    /**
     * Go back in navigation history
     */
    protected goBack(): void {
        const history = this.navigationState.viewHistory;
        if (history.length > 1) {
            // Remove current
            history.pop();
            // Navigate to previous
            const previous = history[history.length - 1];
            if (previous) {
                this.navigate(previous);
            }
        }
    }

    /**
     * Show a status message
     */
    protected showMessage(message: string, duration = 3000): void {
        /*if (!this.statusContainer) {
            console.log(`[${this.id}] Status: ${message}`);
            return;
        }

        this.statusContainer.textContent = message;
        this.statusContainer.hidden = false;

        setTimeout(() => {
            if (this.statusContainer?.textContent === message) {
                this.statusContainer.textContent = "";
                this.statusContainer.hidden = true;
            }
        }, duration);*/

        showToast({ message, duration, kind: "info" });
    }

    /**
     * Set the current view's toolbar
     */
    protected setViewToolbar(toolbar: HTMLElement | null): void {
        this.ensureToolbarChrome();
        if (!this.toolbarViewSlot) return;
        this.toolbarViewSlot.replaceChildren();
        if (toolbar) this.toolbarViewSlot.appendChild(toolbar);
    }

    private ensureToolbarChrome(): void {
        if (!this.toolbarContainer) return;
        if (this.toolbarViewSlot && this.toolbarThemeSlot) return;

        this.toolbarContainer.replaceChildren();
        this.toolbarContainer.style.display = "flex";
        this.toolbarContainer.style.alignItems = "center";
        this.toolbarContainer.style.justifyContent = "space-between";
        this.toolbarContainer.style.gap = "0.5rem";
        this.toolbarContainer.style.flexWrap = "wrap";

        const themeSlot = document.createElement("div");
        themeSlot.className = "shell-theme-controls";
        themeSlot.setAttribute("data-shell-toolbar-theme", "true");
        themeSlot.style.display = "inline-flex";
        themeSlot.style.alignItems = "center";
        themeSlot.style.gap = "0.35rem";

        const label = document.createElement("span");
        label.textContent = "Theme";
        label.style.fontSize = "0.8rem";
        label.style.opacity = "0.8";

        const select = document.createElement("select");
        select.setAttribute("aria-label", "Theme mode");
        select.innerHTML = `
            <option value="auto">Auto</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
        `;
        select.addEventListener("change", () => {
            void this.applyThemeMode(select.value as "auto" | "light" | "dark");
        });

        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.textContent = "Toggle";
        toggle.title = "Quick toggle light/dark";
        toggle.setAttribute("aria-label", "Toggle light or dark mode");
        toggle.addEventListener("click", () => {
            const current = this.getThemeModeFromShellTheme();
            const next = current === "dark" ? "light" : "dark";
            void this.applyThemeMode(next);
        });

        themeSlot.append(/*label,*/ select/*, toggle*/);

        const viewSlot = document.createElement("div");
        viewSlot.className = "shell-view-toolbar-slot";
        viewSlot.setAttribute("data-shell-toolbar-view", "true");
        viewSlot.style.display = "inline-flex";
        viewSlot.style.alignItems = "center";
        viewSlot.style.gap = "0.5rem";
        viewSlot.style.flex = "1 1 auto";
        viewSlot.style.justifyContent = "flex-end";

        this.toolbarContainer.append(themeSlot, viewSlot);
        this.toolbarThemeSlot = themeSlot;
        this.toolbarViewSlot = viewSlot;
        this.themeSelectElement = select;
        this.syncThemeToolbarControls();
    }

    private getThemeModeFromShellTheme(): "auto" | "light" | "dark" {
        const theme = this.getThemeRefValue();
        const id = (theme?.id || "").toLowerCase();
        if (id === "dark" || theme?.colorScheme === "dark") return "dark";
        if (id === "light" || theme?.colorScheme === "light") return "light";
        return "auto";
    }

    private createShellTheme(mode: "auto" | "light" | "dark"): ShellTheme {
        if (mode === "dark") return { id: "dark", name: "Dark", colorScheme: "dark" };
        if (mode === "light") return { id: "light", name: "Light", colorScheme: "light" };
        return { id: "auto", name: "Auto", colorScheme: "auto" };
    }

    private syncThemeToolbarControls(): void {
        const mode = this.getThemeModeFromShellTheme();
        if (this.themeSelectElement) this.themeSelectElement.value = mode;
    }

    private async applyThemeMode(mode: "auto" | "light" | "dark"): Promise<void> {
        this.setTheme(this.createShellTheme(mode));
        try {
            const current = await loadSettings();
            const saved = await saveSettings({
                ...current,
                appearance: {
                    ...(current.appearance || {}),
                    theme: mode
                }
            });
            applyAppTheme(saved);
            this.showMessage(`Theme: ${mode}`);
        } catch (error) {
            console.warn(`[${this.id}] Failed to save theme mode:`, error);
            this.showMessage("Theme updated for current session");
        }
    }

    // ========================================================================
    // PATH-BASED NAVIGATION
    // ========================================================================

    /**
     * Setup path-based navigation (listen to route-change events)
     * @deprecated Use setupPopstateNavigation instead
     */
    protected setupHashNavigation(): void {
        // No-op for backwards compatibility
        // Path-based routing doesn't use hash changes
    }

    /**
     * Setup popstate navigation (back/forward buttons)
     */
    protected setupPopstateNavigation(): void {
        if (typeof window === "undefined" || typeof window == "undefined") return;

        globalThis?.addEventListener?.("popstate", (event) => {
            // Get view from pathname
            const pathname = globalThis?.location?.pathname?.replace(/^\//, "").toLowerCase();
            const viewId = (event.state?.viewId || pathname || "viewer") as ViewId;

            if (viewId !== this.currentView.value) {
                const previousViewId = this.navigationState.currentView;

                // Update state before loading so renderViewWithTransition has
                // correct previousView and currentView values.
                this.navigationState.previousView = previousViewId;
                this.navigationState.currentView = viewId;
                this.currentView.value = viewId;

                this.loadView(viewId, event.state?.params).then(element => {
                    return this.renderViewWithTransition(element);
                }).catch(console.error);
            }
        });
    }

    /**
     * Get view ID from current pathname
     */
    protected getViewFromPathname(): ViewId | null {
        if (typeof window === "undefined" || typeof window == "undefined") return null;

        const pathname = globalThis?.location?.pathname?.replace(/^\//, "").toLowerCase();
        if (!pathname || pathname === "/") {
            return null; // Root route
        }
        return pathname as ViewId;
    }
}


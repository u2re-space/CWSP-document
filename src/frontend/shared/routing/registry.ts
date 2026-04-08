/**
 * Shell and View Registry
 *
 * Central registry for shell and view components.
 * Supports lazy loading and caching.
 */

import type {
    ShellId,
    ViewId,
    ShellRegistration,
    ViewRegistration,
    BootConfig,
    Shell,
    View,
    ViewFactory,
    ShellTheme,
    ViewLifecycle,
    ViewOptions
} from "../../shells/types";
import { 
    serviceChannels, 
    affectedToChannel,
    sendToChannel,
    type ServiceChannelId,
    type ChannelMessage 
} from "@rs-com/core/ServiceChannels";
import { BROADCAST_CHANNELS, MESSAGE_TYPES } from "@rs-com/config/Names";
import {
    registerHandler,
    unregisterHandler,
    registerComponent,
    initializeComponent,
    type UnifiedMessage
} from "@rs-com/core/UnifiedMessaging";
import { bindViewReceiveChannel } from "./channel-mixin";
import { createWebComponentViewAdapter } from "../../views/base/UIElement";
import {
    VIEW_ENABLED_VIEWER,
    VIEW_ENABLED_WORKCENTER,
    VIEW_ENABLED_SETTINGS,
    VIEW_ENABLED_HISTORY,
    VIEW_ENABLED_EXPLORER,
    VIEW_ENABLED_AIRPAD,
    VIEW_ENABLED_EDITOR,
    VIEW_ENABLED_HOME,
    VIEW_ENABLED_PRINT
} from "./views";
import { ensureViewElementDefined, getViewElementTagName } from "@fl-ui/items/BaseElement.ts";


// ============================================================================
// SHELL REGISTRY
// ============================================================================

/**
 * Registry for shell components
 */
class ShellRegistryClass {
    private shells = new Map<ShellId, ShellRegistration>();
    private loadedShells = new Map<ShellId, Shell>();

    /**
     * Register a shell
     */
    register(registration: ShellRegistration): void {
        this.shells.set(registration.id, registration);
    }

    /**
     * Get a shell registration
     */
    get(id: ShellId): ShellRegistration | undefined {
        return this.shells.get(id);
    }

    /**
     * Get all registered shells
     */
    getAll(): ShellRegistration[] {
        return Array.from(this.shells.values());
    }

    /**
     * Load and instantiate a shell
     */
    async load(id: ShellId, container: HTMLElement): Promise<Shell> {
        // Return cached instance if available
        const cached = this.loadedShells.get(id);
        if (cached) {
            return cached;
        }

        const registration = this.shells.get(id);
        if (!registration) {
            throw new Error(`Shell not found: ${id}`);
        }

        const module = await registration.loader();
        const factory = (module as any).default || (module as any).createShell;

        if (typeof factory !== "function") {
            throw new Error(`Invalid shell module: ${id}`);
        }

        const shell = factory(container);
        this.loadedShells.set(id, shell);
        return shell;
    }

    /**
     * Unload a shell
     */
    unload(id: ShellId): void {
        const shell = this.loadedShells.get(id);
        if (shell) {
            shell.unmount();
            this.loadedShells.delete(id);
        }
    }

    /**
     * Check if a shell is loaded
     */
    isLoaded(id: ShellId): boolean {
        return this.loadedShells.has(id);
    }

    /**
     * Get a loaded shell instance
     */
    getLoaded(id: ShellId): Shell | undefined {
        return this.loadedShells.get(id);
    }
}

export const ShellRegistry = new ShellRegistryClass();

// ============================================================================
// VIEW REGISTRY
// ============================================================================

/**
 * Registry for view components
 */
class ViewRegistryClass {
    private resolveViewFactory(module: Record<string, unknown>): ViewFactory | null {
        const candidates = [
            module?.default,
            module?.createView,
            module?.createAirpadView,
            module?.createWorkCenterView,
            module?.createViewerView,
            module?.createExplorerView,
            module?.createSettingsView,
            module?.createHistoryView
        ];

        for (const candidate of candidates) {
            if (typeof candidate === "function") {
                return candidate as ViewFactory;
            }
        }

        const values = Object.values(module || {});
        for (const value of values) {
            // Support class exports like `export class AirpadView implements View`
            if (typeof value === "function" && value.prototype && typeof (value as any).prototype.render === "function") {
                const ViewClass = value as new (options?: Parameters<ViewFactory>[0]) => View;
                return (options?: Parameters<ViewFactory>[0]) => new ViewClass(options);
            }
        }

        return null;
    }

    private views = new Map<ViewId, ViewRegistration>();
    private loadedViews = new Map<ViewId, View>();
    private viewReceiveCleanup = new Map<ViewId, () => void>();

    /**
     * Register a view
     */
    register(registration: ViewRegistration): void {
        this.views.set(registration.id, registration);
    }

    /**
     * Get a view registration
     */
    get(id: ViewId): ViewRegistration | undefined {
        return this.views.get(id);
    }

    /**
     * Get all registered views
     */
    getAll(): ViewRegistration[] {
        return Array.from(this.views.values());
    }

    /**
     * Load and instantiate a view
     */
    async load(id: ViewId, options?: Parameters<ViewFactory>[0]): Promise<View> {
        // One live instance per view id. Shell also caches DOM roots; recreating here
        // duplicated receive-channel bindings and dropped in-flight state.
        const cached = this.loadedViews.get(id);
        if (cached) {
            return cached;
        }

        const registration = this.views.get(id);
        if (!registration) {
            throw new Error(`View not found: ${id}`);
        }

        const module = await registration.loader();
        const factory = this.resolveViewFactory(module as unknown as Record<string, unknown>);

        if (!factory) {
            throw new Error(`Invalid view module: ${id}`);
        }

        const viewInstance = await factory(options);
        const view = createWebComponentViewAdapter(viewInstance);

        const previousCleanup = this.viewReceiveCleanup.get(id);
        if (previousCleanup) {
            previousCleanup();
            this.viewReceiveCleanup.delete(id);
        }

        this.loadedViews.set(id, view);
        this.viewReceiveCleanup.set(id, bindViewReceiveChannel(view, {
            destination: String(id),
            componentId: `view:${id}`
        }));
        return view;
    }

    /**
     * Unload a view (clear cache)
     */
    unload(id: ViewId): void {
        const view = this.loadedViews.get(id);
        if (view?.lifecycle?.onUnmount) {
            view.lifecycle.onUnmount();
        }
        const receiveCleanup = this.viewReceiveCleanup.get(id);
        if (receiveCleanup) {
            receiveCleanup();
            this.viewReceiveCleanup.delete(id);
        }
        this.loadedViews.delete(id);
    }

    /**
     * Check if a view is loaded
     */
    isLoaded(id: ViewId): boolean {
        return this.loadedViews.has(id);
    }

    /**
     * Get a loaded view instance
     */
    getLoaded(id: ViewId): View | undefined {
        return this.loadedViews.get(id);
    }

    /**
     * Warm the dynamic import for a view module (no instance, no receive-channel bind).
     * Safe to call from idle prefetch; failures are ignored.
     */
    prefetchModule(id: ViewId): void {
        const registration = this.views.get(id);
        if (!registration) return;
        void registration.loader().catch(() => {
            /* ignore prefetch errors */
        });
    }
}

export const ViewRegistry = new ViewRegistryClass();

// ============================================================================
// DEFAULT REGISTRATIONS
// ============================================================================

/**
 * Register default shells
 */
export function registerDefaultShells(): void {
    // Raw shell (minimal, no frames)
    ShellRegistry.register({
        id: "base",
        name: "Base",
        description: "Base shell with no frames or navigation",
        loader: () => import("../../shells/base/index")
    });

    // Minimalshell (simple toolbar-based navigation)
    ShellRegistry.register({
        id: "minimal",
        name: "Minimal",
        description: "Minimal toolbar-based navigation",
        loader: () => import("../../shells/minimal/preview")
    });

    ShellRegistry.register({
        id: "window",
        name: "Window",
        description: "Desktop-like multi-window shell",
        loader: () => import("../../shells/window/index")
    });

    ShellRegistry.register({
        id: "tabbed",
        name: "Tabbed",
        description: "Tabbed window variant for focused multi-tasking",
        loader: () => import("../../shells/tabbed/index")
    });

    ShellRegistry.register({
        id: "environment",
        name: "Environment",
        description: "Desktop/webtop environment shell",
        loader: () => import("../../shells/environment/index")
    });

    ShellRegistry.register({
        id: "content",
        name: "Content",
        description: "CRX content shell with overlay-focused layering",
        loader: () => import("../../shells/content/index")
    });

    // Legacy faint alias (kept for compatibility)
    ShellRegistry.register({
        id: "faint",
        name: "Faint (legacy)",
        description: "Legacy alias redirected to tabbed shell",
        loader: () => import("../../shells/tabbed/index")
    });
}

/**
 * Register default views
 */
export function registerDefaultViews(): void {
    if (VIEW_ENABLED_VIEWER) {
        ViewRegistry.register({
            id: "viewer",
            name: "Viewer",
            icon: "eye",
            loader: () => import("../../views/viewer")
        });
    }

    if (VIEW_ENABLED_WORKCENTER) {
        ViewRegistry.register({
            id: "workcenter",
            name: "Work Center",
            icon: "lightning",
            loader: () => import("../../views/workcenter")
        });
    }

    if (VIEW_ENABLED_SETTINGS) {
        ViewRegistry.register({
            id: "settings",
            name: "Settings",
            icon: "gear",
            loader: () => import("../../views/settings")
        });
    }

    if (VIEW_ENABLED_HISTORY) {
        ViewRegistry.register({
            id: "history",
            name: "History",
            icon: "clock-counter-clockwise",
            loader: () => import("../../views/history")
        });
    }

    if (VIEW_ENABLED_EXPLORER) {
        ViewRegistry.register({
            id: "explorer",
            name: "Explorer",
            icon: "folder",
            loader: () => import("../../views/explorer")
        });
    }

    if (VIEW_ENABLED_AIRPAD) {
        ViewRegistry.register({
            id: "airpad",
            name: "Airpad",
            icon: "hand-pointing",
            loader: () => import("../../views/airpad")
        });
    }

    if (VIEW_ENABLED_EDITOR) {
        ViewRegistry.register({
            id: "editor",
            name: "Editor",
            icon: "pencil",
            loader: () => import("../../views/editor")
        });
    }

    if (VIEW_ENABLED_HOME) {
        ViewRegistry.register({
            id: "home",
            name: "Home",
            icon: "house",
            loader: () => import("../../views/home/ts/outdated")
        });
    }

    if (VIEW_ENABLED_PRINT) {
        ViewRegistry.register({
            id: "print",
            name: "Print",
            icon: "printer",
            loader: () => import("../../shells/print")
        });
    }
}

// ============================================================================
// DEFAULT THEME
// ============================================================================

export const defaultTheme: ShellTheme = {
    id: "auto",
    name: "Auto",
    colorScheme: "auto"
};

export const lightTheme: ShellTheme = {
    id: "light",
    name: "Light",
    colorScheme: "light"
};

export const darkTheme: ShellTheme = {
    id: "dark",
    name: "Dark",
    colorScheme: "dark"
};

// ============================================================================
// BOOT CONFIGURATION
// ============================================================================

/**
 * Get default boot configuration
 */
export function getDefaultBootConfig(): BootConfig {
    return {
        defaultShell: "minimal",
        defaultView: "home",
        theme: defaultTheme,
        rememberShellChoice: true,
        availableShells: ShellRegistry.getAll(),
        availableViews: ViewRegistry.getAll()
    };
}

/**
 * Initialize registries with default shells and views
 */
export function initializeRegistries(): void {
    registerDefaultShells();
    registerDefaultViews();
}

// ============================================================================
// TYPES
// ============================================================================

/**
 * Message handler function type
 */
export type ViewMessageHandler<T = unknown> = (message: ChannelMessage<T>) => void | Promise<void>;

/**
 * Channel-connected view interface
 */
export interface ChannelConnectedView extends View {
    /** Channel ID for this view */
    channelId: ServiceChannelId;
    /** Connect to the service channel */
    connectChannel(): Promise<void>;
    /** Disconnect from the service channel */
    disconnectChannel(): void;
    /** Send a message through the channel */
    sendMessage<T>(type: string, data: T): Promise<void>;
    /** Check if connected */
    isChannelConnected(): boolean;
}

/**
 * Options for channel-connected views
 */
export interface ChannelViewOptions extends ViewOptions {
    /** Channel ID to connect to */
    channelId?: ServiceChannelId;
    /** Auto-connect on mount */
    autoConnect?: boolean;
    /** Message handlers */
    messageHandlers?: Map<string, ViewMessageHandler>;
}


// ============================================================================
// SHARE TARGET HANDLER MIXIN
// ============================================================================

/**
 * Share target handler interface
 */
export interface ShareTargetHandler {
    /** Handle incoming share target data */
    handleShareTarget(data: ShareTargetData): Promise<void>;
    /** Check if view can handle share target */
    canHandleShareTarget(data: ShareTargetData): boolean;
}

/**
 * Share target data structure
 */
export interface ShareTargetData {
    title?: string;
    text?: string;
    url?: string;
    files?: File[];
    timestamp: number;
    source: "share-target" | "launch-queue" | "clipboard";
}

export interface ViewComponentEntryPoint {
    viewId: string;
    tagName: string;
    define: () => string;
    create: (view: View, options?: ViewOptions) => HTMLElement;
}

export const createViewComponentEntryPoint = (viewId: string): ViewComponentEntryPoint => ({
    viewId,
    tagName: getViewElementTagName(viewId),
    define: () => ensureViewElementDefined(viewId),
    create: (view: View, options?: ViewOptions) => {
        const tagName = ensureViewElementDefined(viewId);
        const element = document.createElement(tagName) as HTMLElement & {
            mountView?: (view: View, options?: ViewOptions) => void;
        };
        element.mountView?.(view, options);
        return element;
    }
});

export type ShellAnatomyId = "base" | "window" | "tabbed" | "minimal" | "environment" | "content";

export type ShellAnatomySpec = {
    id: ShellAnatomyId;
    nestedShells: ShellAnatomyId[];
    layers: string[];
    overlays: string[];
};

export const SHELL_ANATOMY_SPECS: Record<ShellAnatomyId, ShellAnatomySpec> = {
    base: {
        id: "base",
        nestedShells: [],
        layers: [],
        overlays: ["toasts", "modals"]
    },
    minimal: {
        id: "minimal",
        nestedShells: ["base"],
        layers: [],
        overlays: ["modals", "toasts"]
    },
    window: {
        id: "window",
        nestedShells: ["base", "minimal"],
        layers: [],
        overlays: ["modals", "toasts"]
    },
    tabbed: {
        id: "tabbed",
        nestedShells: ["window", "minimal", "base"],
        layers: [],
        overlays: ["modals", "toasts"]
    },
    content: {
        id: "content",
        nestedShells: ["window", "base", "minimal"],
        layers: [],
        overlays: ["sniping", "tools", "toasts"]
    },
    environment: {
        id: "environment",
        nestedShells: ["minimal", "window", "base"],
        layers: ["underlying", "background", "wallpaper", "canvas"],
        overlays: ["taskbar", "statusbar", "modals", "toasts"]
    }
};

export const normalizeShellAnatomyId = (shell: string | null | undefined): ShellAnatomyId => {
    const value = String(shell || "minimal").toLowerCase();
    if (value === "faint") return "tabbed";
    if (value in SHELL_ANATOMY_SPECS) return value as ShellAnatomyId;
    return "minimal";
};

export const canShellNest = (parentShell: string, nestedShell: string): boolean => {
    const parent = SHELL_ANATOMY_SPECS[normalizeShellAnatomyId(parentShell)];
    const nested = normalizeShellAnatomyId(nestedShell);
    return parent.nestedShells.includes(nested);
};

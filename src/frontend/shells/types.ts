/**
 * Shell System Types
 * 
 * Shells are UI/UX layout systems that provide frame, window, and view management.
 * They do NOT contain application logic - only layout structure and navigation.
 */

import type { CustomElementLifecycle } from "fest-src/fest/lure/lure/misc/Glit";
import type { refType } from "fest/object";

// ============================================================================
// CORE SHELL TYPES
// ============================================================================

/**
 * Available shell identifiers
 */
export type ShellId = "base" | "window" | "tabbed" | "minimal" | "environment" | "content" | "faint";

/**
 * Available view identifiers
 */
export type ViewId = 
    | "viewer" 
    | "workcenter" 
    | "airpad" 
    | "settings" 
    | "history" 
    | "explorer" 
    | "editor"
    | "home"
    | string; // Allow custom views

/**
 * Theme configuration for shells
 */
export interface ShellTheme {
    id: string;
    name: string;
    colorScheme: "light" | "dark" | "auto";
    cssVariables?: Record<string, string>;
    stylesheetUrl?: string;
}

/**
 * Navigation state within a shell
 */
export interface ShellNavigationState {
    currentView: ViewId;
    previousView?: ViewId;
    viewHistory: ViewId[];
    params?: Record<string, string>;
}

/**
 * Shell layout configuration
 */
export interface ShellLayoutConfig {
    /** Whether shell has a sidebar */
    hasSidebar: boolean;
    /** Whether shell has a toolbar/header */
    hasToolbar: boolean;
    /** Whether shell has a tabbed interface */
    hasTabs: boolean;
    /** Whether shell supports multiple simultaneous views */
    supportsMultiView: boolean;
    /** Whether shell supports window/frame management */
    supportsWindowing: boolean;
}

// ============================================================================
// SHELL INTERFACE
// ============================================================================

/**
 * Shell lifecycle events
 */
export interface ShellEvents {
    onMount?: (shell: Shell) => void | Promise<void>;
    onUnmount?: (shell: Shell) => void | Promise<void>;
    onViewChange?: (viewId: ViewId, shell: Shell) => void | Promise<void>;
    onThemeChange?: (theme: ShellTheme, shell: Shell) => void | Promise<void>;
}

/**
 * Shell context passed to views
 */
export interface ShellContext {
    /** Shell identifier */
    shellId: ShellId;
    /** Navigate to a view */
    navigate: (viewId: ViewId, params?: Record<string, string>) => void | Promise<void>;
    /** Go back in navigation history */
    goBack: () => void;
    /** Show a status/toast message */
    showMessage: (message: string, duration?: number) => void;
    /** Current navigation state */
    navigationState: ShellNavigationState;
    /** Current theme */
    theme: ShellTheme;
    /** Shell layout configuration */
    layout: ShellLayoutConfig;
    /** Get the content container for views */
    getContentContainer: () => HTMLElement;
    /**
     * Optional stacking root above main content (modals, dialogs).
     * Base shell exposes a dedicated layer; others return null (use document / app overlay).
     */
    getOverlayContainer: () => HTMLElement | null;
    /** Get the toolbar container (if shell supports it) */
    getToolbarContainer: () => HTMLElement | null;
    /** Register a view toolbar */
    setViewToolbar: (toolbar: HTMLElement | null) => void;
}

/**
 * Core Shell interface
 * 
 * Shells provide the visual frame/layout and navigation,
 * but delegate actual content rendering to Views.
 */
export interface Shell {
    /** Unique identifier */
    id: ShellId;
    
    /** Display name */
    name: string;
    
    /** Layout configuration */
    layout: ShellLayoutConfig;
    
    /** Current theme */
    theme: refType<ShellTheme>;
    
    /** Current view */
    currentView: refType<ViewId>;
    
    /** Mount the shell into a container */
    mount(container: HTMLElement): Promise<void>;
    
    /** Unmount and cleanup */
    unmount(): void;
    
    /** Navigate to a specific view */
    navigate(viewId: ViewId, params?: Record<string, string>): Promise<void>;
    
    /** Load and render a view */
    loadView(viewId: ViewId, params?: Record<string, string>): Promise<HTMLElement>;
    
    /** Set theme */
    setTheme(theme: ShellTheme): void;
    
    /** Get shell context for views */
    getContext(): ShellContext;
    
    /** Get the root element */
    getElement(): HTMLElement;
}

// ============================================================================
// VIEW INTERFACE
// ============================================================================

/**
 * View component options
 */
export interface ViewOptions {
    /** Initial content/data */
    initialData?: unknown;
    /** Shell context */
    shellContext?: ShellContext;
    /** Additional parameters */
    params?: Record<string, string>;
}

/**
 * View lifecycle events
 */
export interface ViewLifecycle {
    /** Called when view is mounted */
    onMount?: () => void | Promise<void>;
    /** Called when view is about to unmount */
    onUnmount?: () => void | Promise<void>;
    /** Called when view becomes visible */
    onShow?: () => void;
    /** Called when view becomes hidden */
    onHide?: () => void;
    /** Called when view should refresh its content */
    onRefresh?: () => void | Promise<void>;
}

/**
 * View component interface
 * 
 * Views are content components that can be loaded into any shell.
 * They should be shell-agnostic and render their own content.
 */
export interface View extends HTMLElement, CustomElementLifecycle {
    /** Unique identifier */
    id: ViewId;
    
    /** Display name */
    name: string;
    
    /** Icon name (from fest/icon) */
    icon?: string;
    
    /** Render the view */
    render(options?: ViewOptions): HTMLElement;
    
    /** Get toolbar element for this view (optional) */
    getToolbar?(): HTMLElement | null;
    
    /** View lifecycle */
    lifecycle?: ViewLifecycle;
    
    /** Whether this view can handle external messages */
    canHandleMessage?(messageType: string): boolean;
    
    /** Handle external message */
    handleMessage?(message: unknown): Promise<void>;
}

/**
 * View factory function type
 */
export type ViewFactory = (options?: ViewOptions) => View | Promise<View>;

// ============================================================================
// VIEW REGISTRY
// ============================================================================

/**
 * View registration entry
 */
export interface ViewRegistration {
    id: ViewId;
    name: string;
    icon?: string;
    /** Dynamic import function for lazy loading */
    loader: () => Promise<{ default: ViewFactory } | { createView: ViewFactory }>;
    /** Pre-loaded view instance (if already loaded) */
    instance?: View;
}

/**
 * Shell registration entry
 */
export interface ShellRegistration {
    id: ShellId;
    name: string;
    description?: string;
    /** Dynamic import function for lazy loading */
    loader: () => Promise<{ default: (container: HTMLElement) => Shell } | { createShell: (container: HTMLElement) => Shell }>;
    /** Pre-loaded shell instance */
    instance?: Shell;
}

// ============================================================================
// BOOT CONFIGURATION
// ============================================================================

/**
 * Boot configuration for app initialization
 */
export interface BootConfig {
    /** Default shell to use */
    defaultShell: ShellId;
    /** Default view to load */
    defaultView: ViewId;
    /** Theme to apply */
    theme?: ShellTheme;
    /** Whether to remember user's shell preference */
    rememberShellChoice: boolean;
    /** Available shells */
    availableShells: ShellRegistration[];
    /** Available views */
    availableViews: ViewRegistration[];
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * Result type for async operations
 */
export interface ShellResult<T> {
    ok: boolean;
    data?: T;
    error?: string;
}

/**
 * View content types
 */
export type ContentType = "markdown" | "text" | "html" | "file" | "image" | "json" | "unknown";

/**
 * Content context for view loading
 */
export interface ContentContext {
    type: ContentType;
    data: unknown;
    filename?: string;
    mimeType?: string;
    source?: string;
}

/**
 * Main Boot Module
 *
 * Provides the shell/style initialization system for CrossWord.
 *
 * Exports:
 * - BootLoader: Main boot system for styles → shell → view → channels
 * - Routing: URL-based navigation for shells and views
 * - Boot Menu: Choice screen for shell selection
 * - Overlay & Toast: UI utilities
 * - App initialization helpers
 *
 * Usage:
 *   import { bootLoader, quickBoot, initializeApp } from "@rs-frontend/main";
 *   import { navigate, parseCurrentRoute, onRouteChange } from "@rs-frontend/main";
 */

// ============================================================================
// BOOT LOADER
// ============================================================================

export {
    BootLoader,
    bootLoader,
    bootLoader as default,
    quickBoot,
    bootFaint,
    bootMinimal,
    bootWindow,
    bootBase,
    getRecommendedStyle,
    type StyleSystem,
    type BootConfig,
    type BootState,
    type BootPhaseHandler
} from "./BootLoader";

// ============================================================================
// ROUTING (Path-based)
// ============================================================================

export {
    // Route parsing
    parseCurrentRoute,
    buildUrl,
    buildRootUrl,
    isRootRoute,
    isValidView,
    getViewFromPath,
    VALID_VIEWS,

    // Navigation
    navigate,
    navigateToView,
    navigateToRoot,
    goBack,
    goForward,

    // Route listeners
    onRouteChange,
    initRouteListening,

    // Shell loading
    loadSubAppWithShell,
    loadBootMenu,
    getSavedShellPreference,
    resolvePathToView,
    parseRoutingParams,
    createBootConfigFromUrl,

    // Deprecated (backwards compatibility)
    navigateToShell,
    getViewFromHash,
    setViewHash,
    resolvePathToChoice,

    // Types
    type Route,
    type RouteConfig,
    type NavigateOptions,
    type RouteHandler,
    type AppLoaderResult,
    type RoutingMode
} from "./routing";

// ============================================================================
// BOOT MENU
// ============================================================================

export {
    ChoiceScreen,
    type FrontendChoice,
    type ChoiceScreenOptions,
    type ChoiceScreenResult
} from "./boot-menu";

// ============================================================================
// TOAST SYSTEM
// ============================================================================

export {
    showToast,
    showSuccess,
    showError,
    showWarning,
    showInfo,
    clearToasts,
    listenForToasts,
    initToastReceiver,
    type ToastKind,
    type ToastPosition,
    type ToastOptions,
    type ToastLayerConfig
} from "../items/Toast";

// ============================================================================
// OVERLAY SYSTEM
// ============================================================================

export {
    getOverlayElements,
    getOverlay,
    getBox,
    getHint,
    getSizeBadge,
    getToast,
    showSelection,
    hideSelection,
    updateBox,
    setHint,
    initOverlay,
    overlay,
    box,
    hint,
    sizeBadge,
    type OverlayConfig,
    type OverlayElements
} from "./overlay";

// ============================================================================
// FRONTEND ENTRY POINTS
// ============================================================================

export { default as frontend, frontend as mountFrontend } from "./frontend-entry";
export type { MinimalAppOptions } from "./frontend-entry";

// CRX-specific entry (raw shell, no toolbar/tabs)
export { default as crxFrontend, crxFrontend as mountCrxFrontend } from "./crx-entry";
export type { CrxAppOptions } from "./crx-entry";

// ============================================================================
// APP INITIALIZATION
// ============================================================================

import { bootLoader, type BootConfig } from "./BootLoader";
import { createBootConfigFromUrl, loadSubAppWithShell } from "./routing";
import type { Shell } from "../shells/types";
import { isEnabledView, pickEnabledView } from "../config/views";

/**
 * Execution context types
 */
export type ExecutionContext = "web" | "pwa" | "extension";

/**
 * Detect current execution context
 */
export function getExecutionContext(): ExecutionContext {
    // Check for Chrome extension
    if (typeof chrome !== "undefined" && chrome.runtime?.id) {
        return "extension";
    }

    // Check for PWA (standalone mode)
    if (globalThis?.matchMedia?.("(display-mode: standalone)").matches ||
        (globalThis.navigator as any).standalone === true) {
        return "pwa";
    }

    return "web";
}

/**
 * Check if running as PWA
 */
export function isPWA(): boolean {
    return getExecutionContext() === "pwa";
}

/**
 * Check if running as extension
 */
export function isExtension(): boolean {
    return getExecutionContext() === "extension";
}

/**
 * Initialize the application with automatic configuration
 */
export async function initializeApp(
    container: HTMLElement,
    config?: Partial<BootConfig>
): Promise<Shell> {
    // Try to load saved preferences
    const savedConfig = bootLoader.loadPreferences();
    const urlConfig = createBootConfigFromUrl();

    // Merge configs with priority: explicit > URL > saved > defaults
    const finalConfig: BootConfig = {
        styleSystem: config?.styleSystem ?? urlConfig.styleSystem ?? savedConfig?.styleSystem ?? "vl-basic",
        shell: config?.shell ?? urlConfig.shell ?? savedConfig?.shell ?? "minimal",
        defaultView: pickEnabledView(config?.defaultView ?? urlConfig.defaultView ?? savedConfig?.defaultView ?? "home"),
        channels: config?.channels ?? ["home", "workcenter", "settings", "viewer"].filter((channelId) => isEnabledView(channelId)),
        rememberChoice: config?.rememberChoice ?? true,
        theme: config?.theme
    };

    return bootLoader.boot(container, finalConfig);
}

/**
 * Initialize app with legacy loader (for backward compatibility)
 * @deprecated Use initializeApp instead
 */
export async function initializeLegacy(
    container: HTMLElement,
    choice?: string
): Promise<void> {
    const loader = await loadSubAppWithShell(choice as any);
    await loader.mount(container);
}

/**
 * Quick initialization with minimal config
 */
export async function quickInit(
    container: HTMLElement,
    shell: "minimal" | "faint" | "window" | "base" = "minimal",
    view: string = "home"
): Promise<Shell> {
    return initializeApp(container, {
        shell,
        defaultView: view as any
    });
}

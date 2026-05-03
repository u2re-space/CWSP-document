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
 *   import { bootLoader, quickBoot, initializeApp } from "frontend/main";
 *   import { navigate, parseCurrentRoute, onRouteChange } from "frontend/main";
 */

/**
 * Shell System - Main Entry Point
 *
 * Provides shell management, view registry, and initialization utilities.
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
    bootTabbed,
    bootMinimal,
    bootWindow,
    bootEnvironment,
    bootBase,
    bootContent,
    getRecommendedStyle,
    type StyleSystem,
    type BootConfig,
    type BootState,
    type BootPhaseHandler
} from "./ts/BootLoader";

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
    getShellFromQuery,
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
} from "./ts/routing";

export {
    coerceShellForBootViewport,
    isMobileBootShellViewport,
    readLastActiveBootShell,
    recordBootShellWindowActivity,
    initBootShellWindowActivity,
    LS_BOOT_SHELL_LAST_ACTIVE
} from "./ts/shell-preference";

// ============================================================================
// BOOT MENU
// ============================================================================

export {
    ChoiceScreen,
    type FrontendChoice,
    type ChoiceScreenOptions,
    type ChoiceScreenResult
} from "./ts/boot-menu";

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
} from "fest/fl-ui";

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
} from "./ts/overlay";

// ============================================================================
// FRONTEND ENTRY POINTS
// ============================================================================

export { default as frontend, frontend as mountFrontend } from "./ts/frontend-entry";
export type { MinimalAppOptions } from "./ts/frontend-entry";

// CRX-specific entry (content shell, no toolbar/tabs)
export { default as crxFrontend, crxFrontend as mountCrxFrontend } from "./ts/crx-entry";
export type { CrxAppOptions } from "./ts/crx-entry";

// ============================================================================
// APP INITIALIZATION
// ============================================================================

import { bootLoader, type BootConfig } from "./ts/BootLoader";
import { createBootConfigFromUrl, loadSubAppWithShell } from "./ts/routing";
import type { Shell } from "shells/types";
import type { ServiceChannelId } from "com/core/ServiceChannels";
import { isEnabledView, pickEnabledView } from "shared/routing/views";

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
        defaultView: pickEnabledView(config?.defaultView ?? urlConfig.defaultView ?? savedConfig?.defaultView ?? "viewer"),
        channels: config?.channels ?? (["workcenter", "settings", "viewer"] as ServiceChannelId[])
            .filter((channelId) => isEnabledView(channelId)),
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
    shell: "base" | "window" | "tabbed" | "minimal" | "environment" | "content" | "faint" = "window",
    view: string = "home"
): Promise<Shell> {
    return initializeApp(container, {
        shell,
        defaultView: view as any
    });
}


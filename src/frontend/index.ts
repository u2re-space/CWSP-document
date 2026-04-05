/**
 * CrossWord Frontend Module
 *
 * Unified entry point for the CrossWord frontend application.
 *
 * Subsystems:
 * - shells/  : Layout containers (base, window, tabbed, minimal, environment, content)
 * - views/   : Content components (workcenter, settings, viewer, etc.)
 * - styles/  : Style systems (vl-core, vl-basic, vl-advanced, vl-beercss, base)
 * - shared/  : Shared utilities (clipboard, storage, markdown)
 * - main/    : Boot, routing, and UI utilities
 * - pwa/     : Progressive Web App features
 */

// ============================================================================
// SHELLS - Layout containers
// ============================================================================

export * from "./shells";
export type {
    Shell,
    ShellId,
    ViewId,
    ShellTheme,
    ShellContext,
    ShellNavigationState,
    ShellLayoutConfig,
    View,
    ViewOptions,
    ViewLifecycle,
    ViewFactory,
    ViewRegistration,
    ShellRegistration,
    BootConfig as ShellBootConfig
} from "./shells/types";

// ============================================================================
// VIEWS - Content components
// ============================================================================

export * from "./views";
export type {
    BaseViewOptions,
    MarkdownContent,
    FileContent,
    ViewState,
    ContentChangeEvent,
    ViewActionEvent
} from "./views/types";

// ============================================================================
// STYLES - Style systems
// ============================================================================

export * from "./shared/styles";
export type {
    StyleSystemId,
    StyleConfig
} from "./shared/styles";

// ============================================================================
// SHARED - Utilities
// ============================================================================

export * from "../core";
export type { StorageKey } from "../core";

// ============================================================================
// MAIN - Boot, routing, and UI utilities
// ============================================================================

export * from "./shells/boot";
export type {
    BootConfig,
    BootState,
    StyleSystem,
    AppLoaderResult,
    RoutingMode,
    FrontendChoice,
    ExecutionContext,
    MinimalAppOptions
} from "./shells/boot";

// Default boot loader
export { default as bootLoader } from "./shells/boot";

// Frontend entry points
export { frontend, mountFrontend } from "./shells/boot";
// CRX-specific entry (raw shell, no toolbar/tabs)
export { crxFrontend, mountCrxFrontend } from "./shells/boot";

// ============================================================================
// PWA - Progressive Web App features
// ============================================================================

export {
    initPWA,
    registerServiceWorker,
    checkForUpdates,
    showInstallPrompt,
    isInstallPromptAvailable,
    applyUpdate,
    isOnline,
    onConnectivityChange,
    isStandalone,
    onDisplayModeChange
} from "./pwa";

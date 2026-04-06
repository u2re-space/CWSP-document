/**
 * Views Module
 * 
 * Central export point for all view components.
 * Views are shell-agnostic content components that can be
 * loaded into any shell.
 */

// ============================================================================
// VIEW TYPES
// ============================================================================

export * from "./types";
export * from "./base/UIElement";

// ============================================================================
// VIEW UTILITIES
// ============================================================================

// Channel mixin for view connectivity
export * from "@rs-frontend/shared/routing/channel-mixin";
import { ENABLED_VIEW_IDS } from "@shared/routing/views";

// ============================================================================
// VIEW COMPONENTS
// ============================================================================

// WorkCenter - AI processing view
export { WorkCenterView, createWorkCenterView } from "./workcenter";
export type { WorkCenterOptions } from "./workcenter";

// Settings - Application configuration view
export { SettingsView, createView as createSettingsView } from "./settings";
export type { SettingsOptions } from "./settings";

// Viewer - Document viewer
export { ViewerView, createMarkdownView as createViewerView } from "./viewer";
export type { ViewerOptions, ViewerDocument } from "./viewer";

// Editor - Document editor
export { EditorView, createEditorView } from "./editor";
export type { EditorOptions } from "./editor";

// Explorer - File browser
export { ExplorerView, createExplorerView } from "./explorer";

// History - View history
export { HistoryView, createHistoryView } from "./history";

// Home - Landing/dashboard view  
export { HomeView, createHomeView } from "./home/ts/outdated";
export type { HomeViewOptions } from "./home/ts/outdated";

// Print - Print-optimized view
export { PrintView, createPrintView } from "../shells/print";
export type { PrintViewOptions } from "../shells/print";

// Airpad - Quick note view
export { AirpadView, createAirpadView } from "./airpad";

// ============================================================================
// VIEW REGISTRY HELPERS
// ============================================================================

/**
 * Get all available view IDs
 */
export function getAvailableViews(): string[] {
    return [...ENABLED_VIEW_IDS];
}

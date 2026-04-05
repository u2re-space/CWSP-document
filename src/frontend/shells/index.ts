/**
 * Shells module public surface.
 *
 * Keep this file as the canonical shell barrel so shell implementations
 * can import shared shell symbols without creating circular self-exports.
 */

export * from "./types";
export * from "./base/shell";
export * from "@fl-ui/items/BaseElement.ts";

export * from "@shared/routing/registry";
export { ShellRegistry, ViewRegistry, getDefaultBootConfig } from "@shared/routing/registry";

export { BaseShell, createShell as createBaseShell } from "./base";
export { MinimalShell, createShell as createMinimalShell } from "./minimal";
export { WindowShell, createShell as createWindowShell } from "./window";
export { TabbedShell, createShell as createTabbedShell } from "./tabbed";
export { EnvironmentShell, createShell as createEnvironmentShell } from "./environment";
export { ContentShell, createShell as createContentShell } from "./content";

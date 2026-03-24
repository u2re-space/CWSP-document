import "fest/fl-ui";

/**
 * Shell System - Main Entry Point
 *
 * Provides shell management, view registry, and initialization utilities.
 */
export * from "./types";
export * from "../shared/registry";
export * from "./shell";
export * from "./UIElement";
export { ShellRegistry, ViewRegistry, getDefaultBootConfig } from "../shared/registry";

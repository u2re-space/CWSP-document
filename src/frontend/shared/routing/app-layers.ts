/**
 * Shared app-layer entry point.
 *
 * Keep layer orchestration sourced from the environment shell implementation,
 * but expose it through shared/routing for stable imports used by app entries.
 */

export { ensureAppLayers, type AppLayers } from "../../shells/environment/app-layers";

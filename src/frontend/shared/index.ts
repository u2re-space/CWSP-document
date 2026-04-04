/**
 * CrossWord Shared Frontend Module
 *
 * Split layout:
 * - `shell-bridge/` — registries, routing, channels, layers (shell ↔ view glue)
 * - `ui/` — toasts, menus, items/cards, canvas helpers
 * - `policies/` — DOM/event timing guards
 *
 * Root `*.ts` files re-export for stable `@rs-frontend/shared/<Name>` imports.
 *
 * @module frontend/shared
 */

export * from "./routing/registry";
export * from "./routing/channel-mixin";
export * from "./routing/view-message-routing";

export {
    initializeLayers,
    resetLayers,
    getShellLayer,
    getViewLayer,
    getLayerOrder,
    getLayersByCategory,
    areLayersInitialized,
    getLayerElement,
    LAYERS,
    LAYER_HIERARCHY,
    type LayerCategory,
    type LayerDefinition,
    type LayerName,
    type ShellId,
    type ViewId,
} from "./routing/layer-manager";

export { default as LayerManager } from "./routing/layer-manager";

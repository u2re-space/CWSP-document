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

export * from "./shell-bridge/registry";
export * from "./shell-bridge/channel-mixin";
export * from "./shell-bridge/view-message-routing";

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
} from "./shell-bridge/layer-manager";

export { default as LayerManager } from "./shell-bridge/layer-manager";

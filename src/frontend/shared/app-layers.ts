/**
 * App shell / canvas / overlay stacking under #app (or another mount root).
 * The shell layer defines named grid lines (`content-row`, `content-column`) that
 * `ShellBase.mount()` targets; CRX must use the same structure as the PWA entry.
 */

import { fixOrientToScreen } from "fest/dom";
import { initializeAppCanvasLayer } from "../items/Canvas";
import { initializeOrientedDesktop } from "../views/home/OrientedDesktop";

export type AppLayers = {
    canvasLayer: HTMLElement;
    orientLayer: HTMLElement | null;
    shellLayer: HTMLElement;
    overlayLayer: HTMLElement;
};

export const ensureAppLayers = (
    mountElement: HTMLElement,
    options: { enableOrientLayer?: boolean } = {},
): AppLayers => {
    const enableOrientLayer = options.enableOrientLayer !== false;
    const existingCanvas = mountElement.querySelector<HTMLElement>('[data-app-layer="canvas"]');
    const existingOrient = mountElement.querySelector<HTMLElement>('[data-app-layer="orient"]');
    const existingShell = mountElement.querySelector<HTMLElement>('[data-app-layer="shell"]');
    const existingOverlay = mountElement.querySelector<HTMLElement>('[data-app-layer="overlay"]');

    if (existingCanvas && existingShell && existingOverlay) {
        if (enableOrientLayer && !existingOrient) {
            const orientLayer = document.createElement("div");
            orientLayer.dataset.appLayer = "orient";
            orientLayer.className = "app-layer app-layer--orient";
            orientLayer.style.position = "absolute";
            orientLayer.style.inset = "0";
            orientLayer.style.zIndex = "5";
            orientLayer.style.pointerEvents = "none";
            orientLayer.style.background = "transparent";
            const orientBox = document.createElement("cw-oriented-box");
            orientBox.className = "ui-orientbox app-oriented-box";
            orientBox.setAttribute("data-mixin", "ui-orientbox");
            (orientBox as HTMLElement).style.position = "absolute";
            (orientBox as HTMLElement).style.inset = "0";
            (orientBox as HTMLElement).style.pointerEvents = "auto";
            (orientBox as HTMLElement).style.background = "transparent";
            orientLayer.appendChild(orientBox);
            fixOrientToScreen(orientBox as any);
            initializeOrientedDesktop(orientBox as HTMLElement);
            mountElement.insertBefore(orientLayer, existingShell);
            return { canvasLayer: existingCanvas, orientLayer, shellLayer: existingShell, overlayLayer: existingOverlay };
        }
        if (!enableOrientLayer && existingOrient) {
            existingOrient.remove();
            return { canvasLayer: existingCanvas, orientLayer: null, shellLayer: existingShell, overlayLayer: existingOverlay };
        }
        return {
            canvasLayer: existingCanvas,
            orientLayer: enableOrientLayer ? (existingOrient || null) : null,
            shellLayer: existingShell,
            overlayLayer: existingOverlay,
        };
    }

    mountElement.replaceChildren();
    mountElement.style.position = "relative";
    mountElement.style.overflow = "hidden";
    mountElement.dataset.appLayerRoot = "true";

    const canvasLayer = document.createElement("div");
    canvasLayer.dataset.appLayer = "canvas";
    canvasLayer.className = "app-layer app-layer--canvas";
    canvasLayer.style.position = "absolute";
    canvasLayer.style.inset = "0";
    canvasLayer.style.zIndex = "0";
    canvasLayer.style.pointerEvents = "none";

    const orientLayer = enableOrientLayer ? document.createElement("div") : null;
    if (orientLayer) {
        orientLayer.dataset.appLayer = "orient";
        orientLayer.className = "app-layer app-layer--orient";
        orientLayer.style.position = "absolute";
        orientLayer.style.inset = "0";
        orientLayer.style.zIndex = "5";
        orientLayer.style.pointerEvents = "none";
        orientLayer.style.background = "transparent";

        const orientBox = document.createElement("cw-oriented-box");
        orientBox.className = "ui-orientbox app-oriented-box";
        orientBox.setAttribute("data-mixin", "ui-orientbox");
        (orientBox as HTMLElement).style.position = "absolute";
        (orientBox as HTMLElement).style.inset = "0";
        (orientBox as HTMLElement).style.pointerEvents = "auto";
        (orientBox as HTMLElement).style.background = "transparent";
        orientLayer.appendChild(orientBox);
        fixOrientToScreen(orientBox as any);
        initializeOrientedDesktop(orientBox as HTMLElement);
    }

    const shellLayer = document.createElement("div");
    shellLayer.dataset.appLayer = "shell";
    shellLayer.className = "app-layer app-layer--shell";
    shellLayer.style.position = "absolute";
    shellLayer.style.inset = "0";
    shellLayer.style.zIndex = "10";
    shellLayer.style.pointerEvents = "none";
    shellLayer.style.display = "grid";
    shellLayer.style.gridTemplateColumns = "[content-column] minmax(0px, 1fr)";
    shellLayer.style.gridTemplateRows =
        "[status-row] minmax(0px, max-content) [content-row] minmax(0px, 1fr) [dock-row] minmax(0px, max-content)";
    shellLayer.style.overflow = "hidden";
    shellLayer.style.background = "transparent";
    shellLayer.style.backgroundColor = "transparent";

    const overlayLayer = document.createElement("div");
    overlayLayer.dataset.appLayer = "overlay";
    overlayLayer.className = "app-layer app-layer--overlay";
    overlayLayer.style.position = "absolute";
    overlayLayer.style.inset = "0";
    overlayLayer.style.zIndex = "1000";
    overlayLayer.style.pointerEvents = "none";
    overlayLayer.style.background = "transparent";
    overlayLayer.style.backgroundColor = "transparent";

    if (orientLayer) {
        mountElement.append(canvasLayer, orientLayer, shellLayer, overlayLayer);
    } else {
        mountElement.append(canvasLayer, shellLayer, overlayLayer);
    }
    initializeAppCanvasLayer(canvasLayer);
    return { canvasLayer, orientLayer, shellLayer, overlayLayer };
};

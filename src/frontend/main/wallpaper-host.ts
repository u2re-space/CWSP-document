/** Global wallpaper slot: below shell chrome and view stacks (fixed, non-interactive). */

const WALLPAPER_ATTR = "data-cw-app-wallpaper";
const HOME_LAYER_ATTR = "data-cw-app-home-layer";
const SHELL_LAYER_ATTR = "data-cw-app-shell-layer";
const OVERLAY_LAYER_ATTR = "data-cw-app-overlay-layer";
const STYLE_ID = "cw-app-wallpaper-host-style";

const ensureWallpaperHostStyles = (): void => {
    if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
    const s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = `
#app {
    position: relative;
    isolation: isolate;
    overflow: clip;
}

.cw-app-wallpaper[${WALLPAPER_ATTR}] {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    overflow: hidden;
}

[${HOME_LAYER_ATTR}] {
    position: absolute;
    inset: 0;
    z-index: 10;
    pointer-events: auto;
}

[${SHELL_LAYER_ATTR}] {
    position: absolute;
    inset: 0;
    z-index: 20;
    isolation: isolate;
    pointer-events: auto;
}

[${OVERLAY_LAYER_ATTR}] {
    position: fixed;
    inset: 0;
    z-index: 1000;
    pointer-events: none;
}

[${OVERLAY_LAYER_ATTR}] > * {
    pointer-events: auto;
}

[${HOME_LAYER_ATTR}] > * {
    pointer-events: auto;
}

[${SHELL_LAYER_ATTR}] > cw-webtop-environment,
[${SHELL_LAYER_ATTR}] > cw-shell-base {
    position: relative;
    display: block;
    inline-size: 100%;
    block-size: 100%;
    z-index: 1;
    isolation: isolate;
    pointer-events: auto;
}
`;
    document.head.appendChild(s);
};

/**
 * Ensure `#app` (or boot container) has a wallpaper host as its first child.
 * `makeWallpaper()` mounts into this node when present.
 */
export function ensureAppWallpaperHost(container: HTMLElement): HTMLElement {
    let host = container.querySelector<HTMLElement>(`[${WALLPAPER_ATTR}]`);
    if (!host) {
        host = document.createElement("div");
        host.className = "cw-app-wallpaper";
        host.setAttribute(WALLPAPER_ATTR, "true");
        host.setAttribute("aria-hidden", "true");
        container.prepend(host);
    }
    ensureWallpaperHostStyles();
    return host;
}

const ensureLayer = (container: HTMLElement, attr: string): HTMLElement => {
    let node = container.querySelector<HTMLElement>(`[${attr}]`);
    if (!node) {
        node = document.createElement("div");
        node.setAttribute(attr, "true");
        container.appendChild(node);
    }
    return node;
};

export function ensureAppLayerRoots(container: HTMLElement): {
    wallpaper: HTMLElement;
    home: HTMLElement;
    shell: HTMLElement;
    overlay: HTMLElement;
} {
    const wallpaper = ensureAppWallpaperHost(container);
    const home = ensureLayer(container, HOME_LAYER_ATTR);
    const shell = ensureLayer(container, SHELL_LAYER_ATTR);
    const overlay = ensureLayer(container, OVERLAY_LAYER_ATTR);
    // Always keep strict order.
    container.replaceChildren(wallpaper, home, shell, overlay);
    ensureWallpaperHostStyles();
    return { wallpaper, home, shell, overlay };
}

export const getAppOverlayRoot = (doc: Document = document): HTMLElement | null =>
    doc.querySelector<HTMLElement>(`[${OVERLAY_LAYER_ATTR}]`);

export function isWallpaperOnGlobalHost(el: HTMLElement | null | undefined): boolean {
    return Boolean(el?.parentElement?.hasAttribute(WALLPAPER_ATTR));
}

/** Remove all children except the global wallpaper host, then append `root` (installer / splash). */
export function replaceMountContentPreservingWallpaper(container: HTMLElement, root: Node): void {
    const layers = ensureAppLayerRoots(container);
    layers.home.replaceChildren();
    layers.shell.replaceChildren(root);
}

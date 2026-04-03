/**
 * Underlying app canvas layer.
 *
 * Hosts background/image surface under shell windows.
 */

import "fest/dom";

const WALLPAPER_STORAGE_KEY = "rs-wallpaper-image";
const DEFAULT_WALLPAPER_URL = "/assets/wallpaper.jpg";

export type CanvasLayerState = {
    root: HTMLElement;
    canvas: HTMLCanvasElement;
    glow: HTMLDivElement;
};

export const initializeAppCanvasLayer = (container: HTMLElement): CanvasLayerState => {
    const root = container;
    root.replaceChildren();
    root.style.position = "absolute";
    root.style.inset = "0";
    root.style.overflow = "hidden";
    root.style.background = "radial-gradient(circle at 18% 12%, #1b2a45 0%, #0f1728 42%, #060910 100%)";

    const glow = document.createElement("div");
    glow.className = "app-canvas__glow";
    glow.style.position = "absolute";
    glow.style.inset = "-20%";
    glow.style.pointerEvents = "none";
    glow.style.opacity = "0.7";
    glow.style.background =
        "radial-gradient(circle at 15% 20%, rgba(145,185,255,0.45) 0%, transparent 40%), radial-gradient(circle at 75% 72%, rgba(91,134,235,0.35) 0%, transparent 43%)";

    const canvas = document.createElement("canvas", { is: "ui-canvas" }) as HTMLCanvasElement;
    canvas.className = "app-canvas__image";
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.pointerEvents = "none";
    canvas.style.inlineSize = "100%";
    canvas.style.blockSize = "100%";
    canvas.style.maxInlineSize = "100%";
    canvas.style.maxBlockSize = "100%";
    canvas.style.opacity = "0.88";
    canvas.style.mixBlendMode = "normal";
    canvas.setAttribute("is", "ui-canvas");

    root.append(glow, canvas);

    const wallpaper = loadWallpaperUrl();
    canvas.setAttribute("data-src", wallpaper);

    return { root, canvas, glow };
};

export const setAppWallpaper = (wallpaperUrl: string): void => {
    const value = String(wallpaperUrl || "").trim() || DEFAULT_WALLPAPER_URL;
    try {
        localStorage.setItem(WALLPAPER_STORAGE_KEY, value);
    } catch {
        // ignore storage errors
    }

    const canvases = document.querySelectorAll<HTMLCanvasElement>('[data-app-layer="canvas"] canvas[is="ui-canvas"]');
    canvases.forEach((canvas) => canvas.setAttribute("data-src", value));
};

const loadWallpaperUrl = (): string => {
    try {
        const value = localStorage.getItem(WALLPAPER_STORAGE_KEY);
        return value && value.trim() ? value.trim() : DEFAULT_WALLPAPER_URL;
    } catch {
        return DEFAULT_WALLPAPER_URL;
    }
};

/**
 * Home View
 *
 * Desktop/webtop home surface.
 */

import { loadAsAdopted, removeAdopted } from "fest/dom";
import type { View, ViewOptions, ViewLifecycle, ShellContext } from "../../shells/types";
import type { BaseViewOptions } from "../types";
import { createWebTopEnvironment } from "../../environment";
import { isWallpaperOnGlobalHost } from "../../main/wallpaper-host";

// @ts-ignore
import style from "./home.scss?inline";
// @ts-ignore
import speedDialStyle from "../from-faint/scss/_SpeedDial.scss?inline";

// ============================================================================
// HOME VIEW
// ============================================================================

export class HomeView implements View {
    id = "home" as const;
    name = "Home";
    icon = "house";

    private options: BaseViewOptions;
    private shellContext?: ShellContext;
    private element: HTMLElement | null = null;
    private _sheet: CSSStyleSheet | null = null;
    private _speedDialSheet: CSSStyleSheet | null = null;

    lifecycle: ViewLifecycle = {
        onShow: () => {
            this._sheet = loadAsAdopted(style) as CSSStyleSheet;
            this._speedDialSheet = loadAsAdopted(speedDialStyle) as CSSStyleSheet;
        },
        onHide: () => {
            removeAdopted(this._sheet);
            removeAdopted(this._speedDialSheet);
        },
    };

    constructor(options: BaseViewOptions = {}) {
        this.options = options;
        this.shellContext = options.shellContext;
    }

    render(options?: ViewOptions): HTMLElement {
        if (options) {
            this.options = { ...this.options, ...options };
            this.shellContext = options.shellContext || this.shellContext;
        }

        this._sheet = loadAsAdopted(style) as CSSStyleSheet;
        this._speedDialSheet = loadAsAdopted(speedDialStyle) as CSSStyleSheet;
        const makeView = (viewId: string, payload?: Record<string, unknown>) => {
            const params = payload
                ? Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, String(v)]))
                : undefined;
            void this.shellContext?.navigate(viewId, params);
        };
        const env = createWebTopEnvironment(makeView);
        this.element = document.createElement("div");
        this.element.className = "view-home view-home--webtop";
        if (isWallpaperOnGlobalHost(env.wallpaper)) {
            this.element.append(env.desktop, env.contextMenu);
        } else {
            this.element.append(env.wallpaper, env.desktop, env.contextMenu);
        }
        return this.element;
    }

    getToolbar(): HTMLElement | null {
        return null;
    }

    canHandleMessage(): boolean {
        return false;
    }

    async handleMessage(): Promise<void> {}
}

// ============================================================================
// TYPE EXPORTS
// ============================================================================

/** Options for HomeView */
export interface HomeViewOptions extends BaseViewOptions {
    /** Show subtitle */
    showSubtitle?: boolean;
}

// ============================================================================
// FACTORY
// ============================================================================

export function createView(options?: HomeViewOptions): HomeView {
    return new HomeView(options);
}

/** Alias for createView */
export const createHomeView = createView;

export default createView;

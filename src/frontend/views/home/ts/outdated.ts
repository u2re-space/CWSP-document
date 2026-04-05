/**
 * Home View
 * 
 * Shell-agnostic home/dashboard component.
 * Provides quick access to main features.
 */

import { H } from "fest/lure";
import { loadAsAdopted, removeAdopted } from "fest/dom";
import type { View, ViewOptions, ViewLifecycle, ShellContext } from "@rs-frontend/shells/types";
import type { BaseViewOptions } from "../../types";
import { isEnabledView } from "@rs-frontend/shared/routing/views";
import { SpeedDial, createCtxMenu } from "./SpeedDial";

// @ts-ignore
import style from "../scss/SpeedDial.scss?inline";

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

    lifecycle: ViewLifecycle = {
        onShow: () => { this._sheet ??= loadAsAdopted(style) as CSSStyleSheet; },
        onHide: () => {
            removeAdopted(this._sheet);
            this._sheet = null;
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

        this._sheet ??= loadAsAdopted(style) as CSSStyleSheet;

        const shellId = String(this.shellContext?.shellId || "").toLowerCase();
        const renderAsDesktopGrid = shellId === "window" || shellId === "base" || shellId === "minimal";

        if (renderAsDesktopGrid) {
            const navigateHomeView = (view: string, params?: Record<string, string>) => {
                if (!view) return;
                this.shellContext?.navigate?.(view as any, params);
            };
            const desktop = H`
                <div class="view-home view-home--grid" data-home-layout="grid"></div>
            ` as HTMLElement;
            const speedDial = SpeedDial(navigateHomeView);
            desktop.append(speedDial);
            createCtxMenu(navigateHomeView);
            this.element = desktop;
            return desktop;
        }

        this.element = H`
            <div class="view-home">
                <div class="view-home__content">
                    <div class="view-home__header">
                        <h1 class="view-home__title">CrossWord</h1>
                        <p class="view-home__subtitle">Markdown viewer, editor, and AI assistant</p>
                    </div>
                    
                    <div class="view-home__actions">
                        <button class="view-home__action" data-view="viewer" type="button">
                            <ui-icon icon="eye" icon-style="duotone" size="32"></ui-icon>
                            <span class="view-home__action-title">Viewer</span>
                            <span class="view-home__action-desc">View markdown documents</span>
                        </button>
                        
                        <button class="view-home__action" data-view="editor" type="button">
                            <ui-icon icon="pencil" icon-style="duotone" size="32"></ui-icon>
                            <span class="view-home__action-title">Editor</span>
                            <span class="view-home__action-desc">Write and edit markdown</span>
                        </button>
                        
                        <button class="view-home__action" data-view="workcenter" type="button">
                            <ui-icon icon="lightning" icon-style="duotone" size="32"></ui-icon>
                            <span class="view-home__action-title">Work Center</span>
                            <span class="view-home__action-desc">AI-powered processing</span>
                        </button>
                        
                        <button class="view-home__action" data-view="explorer" type="button">
                            <ui-icon icon="folder" icon-style="duotone" size="32"></ui-icon>
                            <span class="view-home__action-title">Explorer</span>
                            <span class="view-home__action-desc">Browse local files</span>
                        </button>
                        
                        <button class="view-home__action" data-view="airpad" type="button">
                            <ui-icon icon="hand-pointing" icon-style="duotone" size="32"></ui-icon>
                            <span class="view-home__action-title">Airpad</span>
                            <span class="view-home__action-desc">Remote trackpad control</span>
                        </button>
                        
                        <button class="view-home__action" data-view="settings" type="button">
                            <ui-icon icon="gear" icon-style="duotone" size="32"></ui-icon>
                            <span class="view-home__action-title">Settings</span>
                            <span class="view-home__action-desc">Configure the app</span>
                        </button>
                    </div>
                </div>
            </div>
        ` as HTMLElement;

        this.setupEventHandlers();
        return this.element;
    }

    getToolbar(): HTMLElement | null {
        return null;
    }

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

    private setupEventHandlers(): void {
        if (!this.element) return;

        const actionButtons = this.element.querySelectorAll("[data-view]");
        actionButtons.forEach((button) => {
            const viewId = (button as HTMLElement).dataset.view || "";
            if (!isEnabledView(viewId)) {
                button.remove();
            }
        });

        this.element.addEventListener("click", (e) => {
            const target = e.target as HTMLElement;
            const button = target.closest("[data-view]") as HTMLButtonElement | null;
            if (!button) return;

            const viewId = button.dataset.view;
            if (viewId && isEnabledView(viewId)) {
                this.shellContext?.navigate(viewId);
            }
        });
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

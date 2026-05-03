/**
 * Home view — lightweight landing / shortcuts shell when `home` is the default view.
 */

import { H } from "fest/lure";
import type { View, ViewOptions, ViewLifecycle, ShellContext } from "shells/types";
import type { BaseViewOptions } from "views/types";

export type HomeViewOptions = BaseViewOptions;

export class HomeView implements View {
    id = "home" as const;
    name = "Home";
    icon = "house";

    private options: HomeViewOptions;
    private shellContext?: ShellContext;
    private element: HTMLElement | null = null;

    lifecycle: ViewLifecycle = {
        onMount: () => undefined,
        onUnmount: () => undefined,
        onShow: () => undefined,
        onHide: () => undefined,
    };

    constructor(options: HomeViewOptions = {}) {
        this.options = options;
        this.shellContext = options.shellContext;
    }

    render(options?: ViewOptions): HTMLElement {
        if (options) {
            this.options = { ...this.options, ...options };
            this.shellContext = options.shellContext || this.shellContext;
        }

        const navigate = (viewId: string) => this.shellContext?.navigate(viewId as never);

        this.element = H`
            <div class="view-home" data-view="home">
                <header class="view-home__header">
                    <h1 class="view-home__title">CrossWord</h1>
                    <p class="view-home__subtitle">Pick a workspace to continue.</p>
                </header>
                <nav class="view-home__nav" aria-label="Quick open">
                    <button type="button" class="view-home__btn" data-open="workcenter">Work Center</button>
                    <button type="button" class="view-home__btn" data-open="viewer">Viewer</button>
                    <button type="button" class="view-home__btn" data-open="explorer">Explorer</button>
                    <button type="button" class="view-home__btn" data-open="settings">Settings</button>
                </nav>
            </div>
        `;

        this.element.querySelectorAll("[data-open]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const id = (btn as HTMLElement).dataset.open;
                if (id) navigate(id);
            });
        });

        return this.element;
    }

    canHandleMessage(): boolean {
        return false;
    }

    async handleMessage(): Promise<void> {}
}

export function createView(options?: HomeViewOptions): HomeView {
    return new HomeView(options);
}

export const createHomeView = createView;

export default createView;

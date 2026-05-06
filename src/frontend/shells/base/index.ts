/**
 * Raw/base shell: chromeless content host with slot-projected views. Registry id: `base`.
 *
 * WHY: `ShellRegistry.load` requires `default` or `createShell` on this module. Re-exporting only
 * {@link ShellBase} breaks `bootBase` / print flows and yields an invalid shell module error or
 * a stuck `.app-shell__loading` row.
 */
import { H } from "fest/lure";
import { ShellBase } from "../../../shared/boot/shells";
import type { ShellId, ShellLayoutConfig, ShellTheme } from "shells/types";

// @ts-ignore
import style from "./base-shell.scss?inline";

/** Re-export for barrels / subclasses outside this package. */
export { ShellBase } from "../../../shared/boot/shells";

export class BaseChromeShell extends ShellBase {
    id: ShellId = "base";
    name = "Base";

    layout: ShellLayoutConfig = {
        hasSidebar: false,
        hasToolbar: false,
        hasTabs: false,
        supportsMultiView: false,
        supportsWindowing: false
    };

    protected createLayout(): HTMLElement {
        return H`
            <div class="app-shell app-shell--base" data-shell="base">
                <main class="app-shell__content" data-shell-content role="main">
                    <div class="app-shell__loading">
                        <div class="loading-spinner"></div>
                        <span>Loading...</span>
                    </div>
                    <slot name="view"></slot>
                </main>
            </div>
        ` as HTMLElement;
    }

    protected getStylesheet(): string | null {
        return style;
    }

    /**
     * Same projection model as {@link MinimalShell}: view roots stay in the shell host light DOM
     * with `slot="view"` so document-level view CSS applies.
     */
    protected renderView(element: HTMLElement): void {
        if (!this.contentContainer || !this.rootElement) {
            console.warn(`[${this.id}] No content container available`);
            return;
        }

        this.contentContainer.setAttribute("data-current-view", this.currentView.value);

        const previousId = this.navigationState.previousView;
        if (previousId && previousId !== this.currentView.value && this.loadedViews.has(previousId)) {
            const prev = this.loadedViews.get(previousId)!;
            prev.element.removeAttribute("data-view");
            prev.element.hidden = true;
            if (this.rootElement.contains(prev.element)) {
                prev.element.remove();
            }
        }

        element.setAttribute("data-view", this.currentView.value);
        element.hidden = false;
        element.slot = "view";

        if (!this.rootElement.contains(element)) {
            this.rootElement.appendChild(element);
        }

        const loading = this.contentContainer.querySelector(".app-shell__loading") as HTMLElement | null;
        if (loading) loading.hidden = true;

        this.currentViewElement = element;

        try {
            const vid = this.currentView.value;
            document.documentElement.dataset.activeView = vid;
            if (this.rootElement) this.rootElement.dataset.activeView = vid;
        } catch {
            /* ignore */
        }
    }

    protected applyTheme(theme: ShellTheme): void {
        const inner = this.rootElement?.shadowRoot?.querySelector(".app-shell") as HTMLElement | null;
        if (inner) {
            inner.dataset.theme = this.resolveShellColorScheme(theme);
        }
        super.applyTheme(theme);
    }

    async mount(container: HTMLElement): Promise<void> {
        await super.mount(container);
        this.setupPopstateNavigation();
    }
}

export function createShell(_container: HTMLElement): BaseChromeShell {
    return new BaseChromeShell();
}

export default createShell;

/**
 * Base shell: single content region, no toolbar/sidebar/tabs (raw frame).
 */
import { H } from "fest/lure";
import type { ShellId, ShellLayoutConfig, ShellTheme } from "shells/types";
import { ShellBase } from "boot/ts/shells";

export class BaseShell extends ShellBase {
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
        return H`<div class="app-shell app-shell--base" data-shell="base">
            <div class="app-shell__content" data-content></div>
        </div>`;
    }

    protected getStylesheet(): string | null {
        return null;
    }

    protected applyTheme(theme: ShellTheme): void {
        const inner = this.rootElement?.shadowRoot?.querySelector(".app-shell--base") as HTMLElement | null;
        if (inner) {
            inner.dataset.theme = this.resolveShellColorScheme(theme);
        }
        super.applyTheme(theme);
    }
}

export function createShell(_container: HTMLElement): BaseShell {
    return new BaseShell();
}

export default createShell;

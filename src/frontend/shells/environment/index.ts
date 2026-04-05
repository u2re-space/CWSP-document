import type { ShellId, ShellLayoutConfig } from "@shells/types";
import { WindowShell } from "@shells/window";

/**
 * Environment shell: desktop/webtop orchestrator identity.
 * Current implementation inherits window mechanics until dedicated
 * environment layers/chrome are fully split.
 */
export class EnvironmentShell extends WindowShell {
    id: ShellId = "environment";
    name = "Environment";

    layout: ShellLayoutConfig = {
        hasSidebar: true,
        hasToolbar: true,
        hasTabs: true,
        supportsMultiView: true,
        supportsWindowing: true
    };

    protected shouldRenderDesktopChrome(): boolean {
        return true;
    }
}

export function createShell(_container: HTMLElement): EnvironmentShell {
    return new EnvironmentShell();
}

export default createShell;

import type { ShellId, ShellLayoutConfig } from "shells/types";
import { WindowShell } from "shells/window";

/**
 * Content shell: CRX/content-script focused host.
 * It keeps window/task behavior but never mounts desktop chrome bars.
 */
export class ContentShell extends WindowShell {
    layout: ShellLayoutConfig = {
        hasSidebar: false,
        hasToolbar: false,
        hasTabs: false,
        supportsMultiView: true,
        supportsWindowing: true
    };

    id: ShellId = "content";
    name = "Content";

    protected shouldRenderDesktopChrome(): boolean {
        return false;
    }
}

export function createShell(_container: HTMLElement): ContentShell {
    return new ContentShell();
}

export default createShell;

import type { ShellId, ShellLayoutConfig, ViewId } from "shells/types";
import { WindowShell } from "shells/window";
import { ENABLED_VIEW_IDS } from "shared/routing/views";

/**
 * Environment shell: canonical desktop/webtop orchestrator.
 *
 * Inherits the full window process system (processes, PIDs, channels,
 * drag-and-drop attach, parameterized view opening) and enables
 * desktop chrome (dock bar + status bar) rendered into the shell layer.
 *
 * Entry URLs like `/{view}?key=val` are normalized to `/#pid` on boot,
 * making the environment the primary desktop experience for PWA.
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

    protected override getPinnedViews(): ViewId[] {
        const preferred: ViewId[] = ["viewer", "explorer", "workcenter", "editor", "airpad", "settings"];
        return preferred.filter((v) => ENABLED_VIEW_IDS.includes(v));
    }
}

export function createShell(_container: HTMLElement): EnvironmentShell {
    return new EnvironmentShell();
}

export default createShell;

import type { ShellId, ShellLayoutConfig } from "@shells/types";
import { WindowShell } from "../../index";

/**
 * Tabbed shell: window-style host with tab-oriented identity.
 * This keeps runtime behavior aligned with window shell while boot/routing
 * can target an explicit "tabbed" anatomy slot.
 */
export class TabbedShell extends WindowShell {
    id: ShellId = "tabbed";
    name = "Tabbed";

    layout: ShellLayoutConfig = {
        hasSidebar: false,
        hasToolbar: false,
        hasTabs: true,
        supportsMultiView: true,
        supportsWindowing: true
    };
}

export function createShell(_container: HTMLElement): TabbedShell {
    return new TabbedShell();
}

export default createShell;

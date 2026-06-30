/**
 * `shells/window` path target: window / tabbed / environment hosts (extends {@link MinimalShell}).
 * Each needs a distinct {@link ShellId} so routing, `cw-shell-*` tags, and path-based URL rules stay consistent.
 */
import { MinimalShell } from "../../../../../../modules/shells/minimal-shell/src/preview";
import type { ShellId, ShellLayoutConfig } from "shells/types";

const windowLikeLayout: ShellLayoutConfig = {
    hasSidebar: false,
    hasToolbar: true,
    hasTabs: false,
    supportsMultiView: true,
    supportsWindowing: true,
};

export class WindowShell extends MinimalShell {
    id: ShellId = "window";
    name = "Window";
    layout: ShellLayoutConfig = windowLikeLayout;
}

export class TabbedShell extends WindowShell {
    id: ShellId = "tabbed";
    name = "Tabbed";
    layout: ShellLayoutConfig = {
        ...windowLikeLayout,
        hasTabs: true,
    };
}

export class EnvironmentShell extends WindowShell {
    id: ShellId = "environment";
    name = "Environment";
}

export function createWindowShell(_container: HTMLElement): WindowShell {
    return new WindowShell();
}

export function createTabbedShell(_container: HTMLElement): TabbedShell {
    return new TabbedShell();
}

export function createEnvironmentShell(_container: HTMLElement): EnvironmentShell {
    return new EnvironmentShell();
}

export default createWindowShell;

import { makeWallpaper, SpeedDial, createCtxMenu } from "../views/from-faint/SpeedDial";
import { initializeEnvironmentChannels } from "./channels";
import {
    registerEnvironmentAction,
    registerEnvironmentTrigger,
    emitEnvironmentEvent
} from "./registries";

export interface WebTopEnvironmentLayers {
    wallpaper: HTMLElement;
    desktop: HTMLElement;
    contextMenu: HTMLElement;
}

export const createWebTopEnvironment = (makeView: (viewId: string, payload?: Record<string, unknown>) => void): WebTopEnvironmentLayers => {
    void initializeEnvironmentChannels();
    registerEnvironmentAction("open-settings", () => makeView?.("settings", { focus: true }));
    registerEnvironmentAction("open-explorer", () => makeView?.("explorer", { focus: true }));
    registerEnvironmentTrigger("refresh-status", () => emitEnvironmentEvent("cw:env-status-refresh"));
    return {
        wallpaper: makeWallpaper(),
        desktop: SpeedDial(makeView),
        contextMenu: createCtxMenu()
    };
};

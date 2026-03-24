import type { View, ViewOptions } from "../../shells/types";
import { ensureViewElementDefined, getViewElementTagName } from "../base/UIElement";

export interface ViewComponentEntryPoint {
    viewId: string;
    tagName: string;
    define: () => string;
    create: (view: View, options?: ViewOptions) => HTMLElement;
}

export const createViewComponentEntryPoint = (viewId: string): ViewComponentEntryPoint => ({
    viewId,
    tagName: getViewElementTagName(viewId),
    define: () => ensureViewElementDefined(viewId),
    create: (view: View, options?: ViewOptions) => {
        const tagName = ensureViewElementDefined(viewId);
        const element = document.createElement(tagName) as HTMLElement & {
            mountView?: (view: View, options?: ViewOptions) => void;
        };
        element.mountView?.(view, options);
        return element;
    }
});

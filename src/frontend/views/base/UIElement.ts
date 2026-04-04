import type { View, ViewOptions } from "../../shells/types";

export interface CwViewViewerHostElement extends HTMLElement {
    shadowRoot: ShadowRoot | null;
}

type ViewWithWebComponentHost = View & {
    renderIntoWebComponentHost?: (host: CwViewViewerHostElement, options?: ViewOptions) => void;
};

/**
 * Keep registry integration stable while allowing per-view web-component mounting.
 * If a view does not expose host-aware rendering, it is returned as-is.
 */
export function createWebComponentViewAdapter(view: View): View {
    const candidate = view as ViewWithWebComponentHost;
    if (typeof candidate.renderIntoWebComponentHost !== "function") {
        return view;
    }
    return candidate;
}


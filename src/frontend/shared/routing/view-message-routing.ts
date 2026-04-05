import type { View } from "../../shells/types";
import type { UnifiedMessage } from "@rs-com/core/UnifiedMessaging";

const VIEW_MESSAGE_FALLBACKS: Record<string, string[]> = {
    viewer: ["content-view", "content-load", "markdown-content"],
    workcenter: ["content-attach", "file-attach", "share-target-input", "content-share"],
    explorer: ["file-save", "navigate-path", "content-explorer"],
    editor: ["content-load", "content-edit"],
    settings: ["settings-update"],
    history: ["history-update"],
    home: ["home-update"],
    airpad: ["content-load"],
    print: ["content-view"]
};

export const inferViewDestination = (viewId: string): string => {
    if (viewId === "viewer") return "viewer";
    if (viewId === "workcenter") return "workcenter";
    if (viewId === "explorer") return "explorer";
    if (viewId === "editor") return "editor";
    if (viewId === "settings") return "settings";
    if (viewId === "history") return "history";
    if (viewId === "print") return "print";
    if (viewId === "airpad") return "airpad";
    return viewId || "viewer";
};

const selectMessageTypeForView = (view: View, incomingType: string): string | null => {
    const checks = [incomingType, ...(VIEW_MESSAGE_FALLBACKS[view.id] || [])];
    for (const type of checks) {
        if (!type) continue;
        if (!view.canHandleMessage || view.canHandleMessage(type)) {
            return type;
        }
    }
    return null;
};

export const mapUnifiedMessageToView = (
    view: View,
    message: UnifiedMessage
): { type: string; data: unknown; metadata?: unknown } | null => {
    const selectedType = selectMessageTypeForView(view, message.type);
    if (!selectedType) return null;
    return {
        type: selectedType,
        data: message.data,
        metadata: message.metadata
    };
};

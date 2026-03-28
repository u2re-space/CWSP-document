/**
 * View-scoped POST API + BroadcastChannel bridge.
 * - Production: service worker intercepts POST /{view} and fans out to clients.
 * - Dev (no SW): Vite middleware returns devRelay JSON; this module posts to rs-view-* locally.
 */

import { viewBroadcastChannelName } from "@rs-com/config/Names";

export type ViewPostChannelPayload = {
    type: "view-post";
    viewId: string;
    bodyText: string;
    contentType: string;
};

export type ViewTransferChannelPayload = {
    type: "view-transfer";
    message: unknown;
};

export type ViewApiMethod = "GET" | "POST";
export type ViewApiFormat = "json" | "text";
export type ViewApiTarget = "shell" | "window" | "frame" | "screen";

export interface ViewApiRequestOptions {
    query?: Record<string, string | number | boolean | null | undefined>;
    headers?: Record<string, string>;
    responseFormat?: ViewApiFormat;
    target?: ViewApiTarget;
    frameId?: string;
}

export function postViewChannelPayload(viewId: string, payload: unknown): void {
    if (typeof BroadcastChannel === "undefined") return;
    try {
        const bc = new BroadcastChannel(viewBroadcastChannelName(viewId));
        bc.postMessage(payload);
        bc.close();
    } catch (e) {
        console.warn("[view-api] Broadcast to view channel failed:", e);
    }
}

/**
 * Preferred API: POST body to /{viewId}. Shell / web components listen on {@link viewBroadcastChannelName}.
 */
export async function postViewApi(
    viewId: string,
    body: BodyInit,
    init: RequestInit = {}
): Promise<Response> {
    const id = String(viewId || "").replace(/^\/+|\/+$/g, "").toLowerCase();
    const res = await fetch(`/${id}`, {
        method: "POST",
        credentials: "same-origin",
        ...init,
        body
    });

    const ct = String(res.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("application/json")) {
        try {
            const data = (await res.clone().json()) as {
                devRelay?: boolean;
                bodyText?: string;
                contentType?: string;
            };
            if (data?.devRelay === true && typeof data.bodyText === "string") {
                postViewChannelPayload(id, {
                    type: "view-post",
                    viewId: id,
                    bodyText: data.bodyText,
                    contentType: String(data.contentType || "")
                } satisfies ViewPostChannelPayload);
            }
        } catch {
            // ignore JSON parse errors
        }
    }

    return res;
}

const toQueryString = (query?: ViewApiRequestOptions["query"]): string => {
    if (!query) return "";
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value == null) continue;
        params.set(key, String(value));
    }
    const text = params.toString();
    return text ? `?${text}` : "";
};

export async function getViewApi(
    viewId: string,
    options: ViewApiRequestOptions = {}
): Promise<Response> {
    const id = String(viewId || "").replace(/^\/+|\/+$/g, "").toLowerCase();
    const queryString = toQueryString({
        format: options.responseFormat || "json",
        target: options.target || "shell",
        frame: options.frameId,
        ...(options.query || {})
    });
    return fetch(`/${id}${queryString}`, {
        method: "GET",
        credentials: "same-origin",
        headers: {
            Accept: options.responseFormat === "text" ? "text/plain" : "application/json, text/plain;q=0.9",
            ...(options.headers || {})
        }
    });
}

const VIEW_MODULE_LOADERS: Record<string, () => Promise<unknown>> = {
    viewer: () => import("@rs-frontend/views/viewer"),
    workcenter: () => import("@rs-frontend/views/workcenter"),
    settings: () => import("@rs-frontend/views/settings"),
    explorer: () => import("@rs-frontend/views/explorer"),
    history: () => import("@rs-frontend/views/history"),
    editor: () => import("@rs-frontend/views/editor"),
    airpad: () => import("@rs-frontend/views/airpad"),
    print: () => import("@rs-frontend/views/print"),
    home: () => import("@rs-frontend/views/home")
};

export async function loadViewModule(viewId: string): Promise<unknown> {
    const id = String(viewId || "").trim().toLowerCase();
    const loader = VIEW_MODULE_LOADERS[id];
    if (!loader) {
        throw new Error(`No module loader for view: ${id}`);
    }
    return loader();
}

export function requestOpenViewInTarget(
    viewId: string,
    options: ViewApiRequestOptions = {}
): void {
    globalThis.dispatchEvent(new CustomEvent("cw:view-open-request", {
        detail: {
            viewId: String(viewId || "").trim().toLowerCase(),
            target: options.target || "shell",
            frameId: options.frameId,
            query: options.query || {}
        }
    }));
}

export function subscribeViewChannel(
    viewId: string,
    handler: (event: MessageEvent) => void
): () => void {
    if (typeof BroadcastChannel === "undefined") return () => {};

    const bc = new BroadcastChannel(viewBroadcastChannelName(viewId));
    bc.addEventListener("message", handler);
    return () => {
        bc.removeEventListener("message", handler);
        bc.close();
    };
}

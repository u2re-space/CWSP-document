import { crxFrontend } from "shells/boot";
import type { ViewId } from "../../frontend/shells/types";

const rawPre = document.getElementById("raw-md") as HTMLPreElement | null;
const appDiv = document.getElementById("app") as HTMLDivElement | null;

const VIRTUAL_VIEW_TOKEN = "${view}";
const markdownFallbackStorageKey = (key: string) => `md-fallback:${key}`;

const loadFromSessionKey = async (key: string): Promise<string | null> => {
    try {
        const data = await chrome.storage?.session?.get?.(key);
        const text = data?.[key];
        if (typeof text === "string" && text.trim()) return text;
    } catch (e) {
        console.warn("[Viewer] session storage read failed:", e);
    }
    try {
        const fallbackKey = markdownFallbackStorageKey(key);
        const data = await chrome.storage?.local?.get?.(fallbackKey);
        const payload = data?.[fallbackKey];
        const text = typeof payload === "string" ? payload : payload?.text;
        if (typeof text === "string" && text.trim()) return text;
    } catch (e) {
        console.warn("[Viewer] local fallback read failed:", e);
    }
    return null;
};

const fetchViaServiceWorker = (src: string): Promise<{ ok: boolean; key?: string; src?: string; error?: string }> => {
    return new Promise((resolve) => {
        try {
            if (!chrome?.runtime?.id) {
                resolve({ ok: false, error: "runtime-unavailable" });
                return;
            }
            chrome.runtime.sendMessage({ type: "md:load", src }, (response) => {
                if (chrome.runtime.lastError) {
                    console.warn("[Viewer] SW fetch failed:", chrome.runtime.lastError);
                    resolve({ ok: false, error: chrome.runtime.lastError.message || "runtime-error" });
                    return;
                }
                resolve(response || { ok: false });
            });
        } catch (error) {
            console.warn("[Viewer] sendMessage failed:", error);
            resolve({ ok: false, error: "runtime-invalidated" });
        }
    });
};

const fetchDirect = async (src: string): Promise<string | null> => {
    if (/^file:/i.test(src)) {
        // file:// pages are unique origins in Chromium; direct fetch is often blocked.
        return null;
    }
    try {
        const res = await fetch(src, { credentials: "include", cache: "no-store" });
        if (!res.ok) return null;
        const text = await res.text();
        const trimmed = text.trimStart().toLowerCase();
        if (trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html") || trimmed.startsWith("<head") || trimmed.startsWith("<body")) {
            return null;
        }
        return text;
    } catch {
        return null;
    }
};

const loadMarkdown = async (src: string, sessionKey?: string | null): Promise<string> => {
    if (sessionKey) {
        const text = await loadFromSessionKey(sessionKey);
        if (text) return text;
    }

    const swResult = await fetchViaServiceWorker(src);
    if (swResult.ok && swResult.key) {
        const text = await loadFromSessionKey(swResult.key);
        if (text) return text;
    }
    if (!swResult.ok && swResult.error === "not-markdown") {
        return "> Skipped loading: source appears to be HTML or is not confidently Markdown.";
    }

    const text = await fetchDirect(src);
    if (text) return text;

    return `> Failed to load markdown from:\n> ${src}`;
};

const isVirtualViewValue = (value?: string | null): boolean => {
    const normalized = (value || "").trim().toLowerCase();
    return !normalized || normalized === VIRTUAL_VIEW_TOKEN || normalized === "view" || normalized === "current" || normalized === "active";
};

const isBrowsableUrl = (url?: string): boolean => {
    if (!url) return false;
    return !url.startsWith("chrome-extension:")
        && !url.startsWith("chrome://")
        && !url.startsWith("about:")
        && !url.startsWith("edge://");
};

const looksLikeMarkdownSourceUrl = (url: string): boolean =>
    /\.(?:md|markdown|mdown|mkd|mkdn|mdtxt|mdtext)(?:$|[?#])/i.test(url);

const resolveSourceFromOpenTabs = async (): Promise<string | null> => {
    try {
        const currentTab = await chrome.tabs.getCurrent();
        const currentTabId = currentTab?.id;
        const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
        const candidates = tabs
            .filter((tab) => typeof tab.id === "number" && tab.id !== currentTabId)
            .map((tab) => tab.url)
            .filter((url): url is string => Boolean(url && isBrowsableUrl(url)));

        const markdownCandidate = candidates.find(looksLikeMarkdownSourceUrl);
        return markdownCandidate || candidates[0] || null;
    } catch {
        return null;
    }
};

const resolveSource = async (params: URLSearchParams): Promise<string | null> => {
    const explicitSource = params.get("src");
    if (explicitSource && !isVirtualViewValue(explicitSource)) {
        return explicitSource;
    }

    // For file:// opens, service worker preloads markdown into session storage.
    // Avoid probing open tabs, which can re-introduce file:// fetch attempts.
    if (params.get("mdk")) {
        return null;
    }
    // Session-less file open (preload failed): never put file:// in ?src; ?origin=file only.
    if (params.get("origin") === "file") {
        return null;
    }

    const sourceFromView = params.get("view-src") || params.get("view");
    if (sourceFromView && !isVirtualViewValue(sourceFromView)) {
        return sourceFromView;
    }

    return resolveSourceFromOpenTabs();
};

const resolveTargetView = (params: URLSearchParams): ViewId | "markdown" | "markdown-viewer" => {
    const requestedView = params.get("launch-view") || params.get("view") || "viewer";
    if (isVirtualViewValue(requestedView)) {
        return "viewer";
    }
    return requestedView as ViewId;
};

const collectViewParams = (params: URLSearchParams): Record<string, string> => {
    const collected: Record<string, string> = {};
    for (const [key, value] of params.entries()) {
        collected[key] = value;
    }
    return collected;
};

const hideRawLayer = (): void => {
    if (rawPre) rawPre.style.display = "none";
};

const showRawState = (message: string): void => {
    if (!rawPre) return;
    rawPre.style.display = "";
    rawPre.hidden = false;
    rawPre.textContent = message;
};

const init = async () => {
    if (!appDiv) {
        throw new Error("Missing #app mount element");
    }

    showRawState("Loading...");

    const params = new URLSearchParams(location.search);
    const mdk = params.get("mdk");
    const filename = params.get("filename") || undefined;
    const appendContent = params.get("append") || params.get("extra") || "";
    const directContent = params.get("content") || params.get("text");
    const source = await resolveSource(params);

    let markdown = "";
    if (directContent) {
        markdown = directContent;
    } else if (source) {
        markdown = await loadMarkdown(source, mdk);
    } else if (mdk) {
        markdown = (await loadFromSessionKey(mdk)) || "";
    }

    if (appendContent) {
        markdown = markdown ? `${markdown}\n\n${appendContent}` : appendContent;
    }

    if (!markdown.trim()) {
        markdown = "# No content\n\nOpen a markdown file or navigate to a `.md` URL.";
    }

    await crxFrontend(appDiv, {
        initialView: resolveTargetView(params),
        viewParams: collectViewParams(params),
        viewPayload: {
            text: markdown,
            content: markdown,
            filename,
            source: source || undefined,
            args: collectViewParams(params)
        }
    });

    hideRawLayer();
};

void init().catch((e) => {
    console.error("[Viewer] init failed:", e);
    showRawState(`Failed to initialize viewer: ${e}`);
});

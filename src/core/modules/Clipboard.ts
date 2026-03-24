/**
 * Standalone Clipboard API
 * Works independently in any context: PWA, Chrome Extension, service worker, vanilla JS
 * Provides unified clipboard operations with fallbacks
 */

export type ClipboardDataType = "text" | "html" | "image" | "blob";

export interface ClipboardWriteOptions {
    type?: ClipboardDataType;
    mimeType?: string;
    fallbackToLegacy?: boolean;
    showFeedback?: boolean;
    /** If true, don't show error toast on failure (for background operations) */
    silentOnError?: boolean;
}

export interface ClipboardResult {
    ok: boolean;
    data?: unknown;
    error?: string;
    method?: "clipboard-api" | "legacy" | "broadcast" | "offscreen";
}

// BroadcastChannel for cross-context clipboard operations
const CLIPBOARD_CHANNEL = "rs-clipboard";
const scheduleClipboardFrame = (cb: FrameRequestCallback | (() => void)): void => {
    if (typeof globalThis.requestAnimationFrame === "function") {
        globalThis.requestAnimationFrame(cb as FrameRequestCallback);
        return;
    }
    if (typeof MessageChannel !== "undefined") {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => (cb as () => void)();
        channel.port2.postMessage(undefined);
        return;
    }
    if (typeof setTimeout === "function") {
        // Approximate a frame boundary when RAF is unavailable.
        setTimeout(() => (cb as () => void)(), 16);
        return;
    }
    if (typeof queueMicrotask === "function") {
        queueMicrotask(() => (cb as () => void)());
        return;
    }
    (cb as () => void)();
};

/**
 * Convert data to string safely
 */
export const toText = (data: unknown): string => {
    if (data == null) return "";
    if (typeof data === "string") return data;
    try {
        return JSON.stringify(data, null, 2);
    } catch {
        return String(data);
    }
};

/**
 * Write text to clipboard using modern API
 */
export const writeText = async (text: string): Promise<ClipboardResult> => {
    const trimmed = toText(text).trim();
    if (!trimmed) return { ok: false, error: "Empty content" };

    return new Promise<ClipboardResult>((resolve) => {
        scheduleClipboardFrame(() => {
            // Ensure document has focus for clipboard API
            if (typeof document !== 'undefined' && document.hasFocus && !document.hasFocus()) {
                globalThis?.focus?.();
            }

            // Try direct clipboard API first
            const tryClipboardAPI = async () => {
                try {
                    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
                        await navigator.clipboard.writeText(trimmed);
                        return resolve({ ok: true, data: trimmed, method: "clipboard-api" });
                    }
                } catch (err) {
                    console.warn("[Clipboard] Direct write failed:", err);
                }

                // Try with permissions query
                try {
                    if (typeof navigator !== "undefined" && navigator.permissions) {
                        const result = await navigator.permissions.query({ name: "clipboard-write" } as unknown as PermissionDescriptor);
                        if (result.state === "granted" || result.state === "prompt") {
                            await navigator.clipboard.writeText(trimmed);
                            return resolve({ ok: true, data: trimmed, method: "clipboard-api" });
                        }
                    }
                } catch (err) {
                    console.warn("[Clipboard] Permission check failed:", err);
                }

                // Fallback: legacy execCommand (deprecated but works in some contexts)
                try {
                    if (typeof document !== "undefined") {
                        const textarea = document.createElement("textarea");
                        textarea.value = trimmed;
                        textarea.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0;pointer-events:none;";
                        document.body.appendChild(textarea);
                        textarea.select();
                        const success = document.execCommand("copy");
                        textarea.remove();
                        if (success) {
                            return resolve({ ok: true, data: trimmed, method: "legacy" });
                        }
                    }
                } catch (err) {
                    console.warn("[Clipboard] Legacy execCommand failed:", err);
                }

                resolve({ ok: false, error: "All clipboard methods failed" });
            };

            tryClipboardAPI();
        });
    });
};

/**
 * Write HTML content to clipboard (with text fallback)
 */
export const writeHTML = async (html: string, plainText?: string): Promise<ClipboardResult> => {
    const htmlContent = html.trim();
    const textContent = (plainText ?? htmlContent).trim();

    if (!htmlContent) return { ok: false, error: "Empty content" };

    return new Promise<ClipboardResult>((resolve) => {
        scheduleClipboardFrame(() => {
            // Ensure document has focus for clipboard API
            if (typeof document !== 'undefined' && document.hasFocus && !document.hasFocus()) {
                globalThis?.focus?.();
            }

            const tryHTMLClipboard = async () => {
                try {
                    if (typeof navigator !== "undefined" && navigator.clipboard?.write) {
                        const htmlBlob = new Blob([htmlContent], { type: "text/html" });
                        const textBlob = new Blob([textContent], { type: "text/plain" });
                        await navigator.clipboard.write([
                            new ClipboardItem({
                                "text/html": htmlBlob,
                                "text/plain": textBlob
                            })
                        ]);
                        return resolve({ ok: true, data: htmlContent, method: "clipboard-api" });
                    }
                } catch (err) {
                    console.warn("[Clipboard] HTML write failed:", err);
                }

                // Fallback to text-only
                const textResult = await writeText(textContent);
                resolve(textResult);
            };

            tryHTMLClipboard();
        });
    });
};

/**
 * Write image to clipboard
 */
export const writeImage = async (blob: Blob | string): Promise<ClipboardResult> => {
    return new Promise<ClipboardResult>((resolve) => {
        scheduleClipboardFrame(async () => {
            // Ensure document has focus for clipboard API
            if (typeof document !== 'undefined' && document.hasFocus && !document.hasFocus()) {
                globalThis?.focus?.();
            }

            try {
                let imageBlob: Blob;

                if (typeof blob === "string") {
                    // Convert data URL or URL to blob
                    if (blob.startsWith("data:")) {
                        const response = await fetch(blob);
                        imageBlob = await response.blob();
                    } else {
                        const response = await fetch(blob);
                        imageBlob = await response.blob();
                    }
                } else {
                    imageBlob = blob;
                }

                if (typeof navigator !== "undefined" && navigator.clipboard?.write) {
                    // Ensure PNG format for clipboard compatibility
                    const pngBlob = imageBlob.type === "image/png"
                        ? imageBlob
                        : await convertToPng(imageBlob);

                    await navigator.clipboard.write([
                        new ClipboardItem({
                            [pngBlob.type]: pngBlob
                        })
                    ]);
                    resolve({ ok: true, method: "clipboard-api" });
                    return;
                }
            } catch (err) {
                console.warn("[Clipboard] Image write failed:", err);
            }

            resolve({ ok: false, error: "Image clipboard not supported" });
        });
    });
};

/**
 * Convert image blob to PNG
 */
const convertToPng = async (blob: Blob): Promise<Blob> => {
    return new Promise((resolve, reject) => {
        if (typeof document === "undefined") {
            reject(new Error("No document context"));
            return;
        }

        const img = new Image();
        const url = URL.createObjectURL(blob);

        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;

            const ctx = canvas.getContext("2d");
            if (!ctx) {
                URL.revokeObjectURL(url);
                reject(new Error("Canvas context failed"));
                return;
            }

            ctx.drawImage(img, 0, 0);
            canvas.toBlob(
                (pngBlob) => {
                    URL.revokeObjectURL(url);
                    if (pngBlob) {
                        resolve(pngBlob);
                    } else {
                        reject(new Error("PNG conversion failed"));
                    }
                },
                "image/png"
            );
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("Image load failed"));
        };

        img.src = url;
    });
};

/**
 * Read text from clipboard
 */
export const readText = async (): Promise<ClipboardResult> => {
    return new Promise<ClipboardResult>((resolve) => {
        scheduleClipboardFrame(() => {
            const tryReadClipboard = async () => {
                try {
                    if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
                        const text = await navigator.clipboard.readText();
                        resolve({ ok: true, data: text, method: "clipboard-api" });
                        return;
                    }
                } catch (err) {
                    console.warn("[Clipboard] Read failed:", err);
                }

                resolve({ ok: false, error: "Clipboard read not available" });
            };

            tryReadClipboard();
        });
    });
};

/**
 * Unified copy function with automatic type detection
 */
export const copy = async (
    data: unknown,
    options: ClipboardWriteOptions = {}
): Promise<ClipboardResult> => {
    const { type, showFeedback = false, silentOnError = false } = options;

    return new Promise<ClipboardResult>((resolve) => {
        scheduleClipboardFrame(async () => {
            let result: ClipboardResult;

            // Determine type and copy
            if (data instanceof Blob) {
                if (data.type.startsWith("image/")) {
                    result = await writeImage(data);
                } else {
                    const text = await data.text();
                    result = await writeText(text);
                }
            } else if (type === "html" || (typeof data === "string" && data.trim().startsWith("<"))) {
                result = await writeHTML(String(data));
            } else if (type === "image") {
                result = await writeImage(data as Blob | string);
            } else {
                result = await writeText(toText(data));
            }

            // Optionally show feedback via toast broadcast
            // Skip error toast if silentOnError is true (e.g., background clipboard operations)
            if (showFeedback && (result.ok || !silentOnError)) {
                broadcastClipboardFeedback(result);
            }

            resolve(result);
        });
    });
};

/**
 * Broadcast clipboard feedback for toast display
 */
const broadcastClipboardFeedback = (result: ClipboardResult): void => {
    try {
        const channel = new BroadcastChannel("rs-toast");
        channel.postMessage({
            type: "show-toast",
            options: {
                message: result.ok ? "Copied to clipboard" : (result.error || "Copy failed"),
                kind: result.ok ? "success" : "error",
                duration: 2000
            }
        });
        channel.close();
    } catch (e) {
        console.warn("[Clipboard] Feedback broadcast failed:", e);
    }
};

/**
 * Request clipboard operation via broadcast (for service worker → client)
 */
export const requestCopy = (data: unknown, options?: ClipboardWriteOptions): void => {
    try {
        const channel = new BroadcastChannel(CLIPBOARD_CHANNEL);
        channel.postMessage({ type: "copy", data, options });
        channel.close();
    } catch (e) {
        console.warn("[Clipboard] Request broadcast failed:", e);
    }
};

/**
 * Listen for clipboard operation requests
 */
export const listenForClipboardRequests = (): (() => void) => {
    if (typeof BroadcastChannel === "undefined") return () => {};

    const channel = new BroadcastChannel(CLIPBOARD_CHANNEL);
    const handler = async (event: MessageEvent) => {
        if (event.data?.type === "copy") {
            const opts = event.data.options || {};
            await copy(event.data.data, {
                ...opts,
                showFeedback: opts.showFeedback !== false,
                silentOnError: opts.silentOnError === true
            });
        }
    };
    channel.addEventListener("message", handler);
    return () => {
        channel.removeEventListener("message", handler);
        channel.close();
    };
};

/**
 * Initialize clipboard listener for receiving copy requests
 */
export const initClipboardReceiver = (): (() => void) => {
    return listenForClipboardRequests();
};

/**
 * Check if clipboard API is available
 */
export const isClipboardAvailable = (): boolean => {
    return typeof navigator !== "undefined" && !!navigator.clipboard;
};

/**
 * Check if clipboard write is available
 */
export const isClipboardWriteAvailable = (): boolean => {
    return typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function";
};

/**
 * Check if running in Chrome extension context
 */
export const isChromeExtension = (): boolean => {
    try {
        return typeof chrome !== "undefined" && !!chrome?.runtime?.id;
    } catch {
        return false;
    }
};

export interface CRXCopyOptions {
    tabId?: number;
    /** Optional fallback function for offscreen document copy */
    offscreenFallback?: (data: unknown) => Promise<boolean>;
}

/**
 * Request copy via Chrome extension message (for CRX service worker → content script)
 * Falls back to offscreen document or BroadcastChannel if content script fails
 */
export const requestCopyViaCRX = async (
    data: unknown,
    tabIdOrOptions?: number | CRXCopyOptions
): Promise<ClipboardResult> => {
    const options: CRXCopyOptions = typeof tabIdOrOptions === "number"
        ? { tabId: tabIdOrOptions }
        : (tabIdOrOptions || {});

    const { tabId, offscreenFallback } = options;
    const text = toText(data).trim();
    if (!text) return { ok: false, error: "Empty content" };

    // If in extension context with tabs API
    if (isChromeExtension() && typeof chrome?.tabs?.sendMessage === "function") {
        try {
            // Send to specific tab or active tab
            if (typeof tabId === "number" && tabId >= 0) {
                const response = await chrome.tabs.sendMessage(tabId, {
                    type: "COPY_HACK",
                    data: text
                });
                if (response?.ok) {
                    return {
                        ok: true,
                        data: response?.data,
                        method: response?.method ?? "broadcast"
                    };
                }
            } else {
                // Query active tab
                const tabs = await chrome.tabs.query({ currentWindow: true, active: true });
                for (const tab of tabs || []) {
                    if (tab?.id != null && tab.id >= 0) {
                        try {
                            const response = await chrome.tabs.sendMessage(tab.id, {
                                type: "COPY_HACK",
                                data: text
                            });
                            if (response?.ok) {
                                return {
                                    ok: true,
                                    data: response?.data,
                                    method: response?.method ?? "broadcast"
                                };
                            }
                        } catch {
                            // Tab may not have content script, continue to next
                        }
                    }
                }
            }
        } catch (err) {
            console.warn("[Clipboard] CRX content script message failed:", err);
        }

        // Fallback to offscreen document if provided
        if (offscreenFallback) {
            try {
                const ok = await offscreenFallback(text);
                if (ok) {
                    return { ok: true, data: text, method: "offscreen" };
                }
            } catch (err) {
                console.warn("[Clipboard] Offscreen fallback failed:", err);
            }
        }
    }

    // Final fallback to BroadcastChannel
    requestCopy(data, { showFeedback: true });
    return { ok: false, error: "Broadcast sent, result pending", method: "broadcast" };
};

/**
 * COPY_HACK - Legacy API for Chrome extension clipboard operations
 * Now delegates to unified Clipboard module
 */
export const COPY_HACK = async (data: unknown): Promise<boolean> => {
    const result = await writeText(toText(data));
    return result.ok;
};

/**
 * Copy with result - returns full ClipboardResult for more control
 */
export const copyWithResult = async (data: unknown): Promise<ClipboardResult> => {
    return writeText(toText(data));
};


// Default export for convenience
export default {
    copy,
    writeText,
    writeHTML,
    writeImage,
    readText,
    toText,
    request: requestCopy,
    requestViaCRX: requestCopyViaCRX,
    listen: listenForClipboardRequests,
    init: initClipboardReceiver,
    isAvailable: isClipboardAvailable,
    isWriteAvailable: isClipboardWriteAvailable,
    isChromeExtension
};


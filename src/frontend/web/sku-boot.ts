/*
 * Filename: sku-boot.ts
 * FullPath: apps/CWSP-document/src/frontend/web/sku-boot.ts
 * FIND:sku
 * Change date: 12.00.00_21.10.2026
 * Reason: Document SKU keeps the native Android nav bar visible (no SystemBars.hide).
 */

import { applyCwspSku } from "com/config/ecosystem-skus";

export type DocumentHostKind = "capacitor" | "web" | "crx";

const ENABLED_VIEWS = "viewer,editor,print,settings,history";

const detectHostKind = (explicit?: DocumentHostKind): DocumentHostKind => {
    if (explicit) return explicit;
    try {
        const proto = String(globalThis.location?.protocol || "").toLowerCase();
        if (proto === "chrome-extension:" || proto === "moz-extension:") return "crx";
        const g = globalThis as { Capacitor?: { isNativePlatform?: () => boolean } };
        if (typeof g.Capacitor?.isNativePlatform === "function" && g.Capacitor.isNativePlatform()) {
            return "capacitor";
        }
    } catch {
        /* fall through */
    }
    return "web";
};

export const stampDocumentSku = (kind: DocumentHostKind): void => {
    applyCwspSku("document");
    const root = document.documentElement;
    root.dataset.cwspSku = "document";
    root.dataset.cwspApp = "document";
    root.dataset.cwspSurface =
        kind === "crx" ? "cw-document-crx" : kind === "capacitor" ? "cw-document" : "cw-markdown";
    root.dataset.cwspEnabledViews = ENABLED_VIEWS;
    root.dataset.cwspDefaultView = "viewer";
    if (kind === "capacitor") root.dataset.cwspNativeShell = "capacitor";
    else if (kind === "crx") root.dataset.cwspNativeShell = "crx";
    try {
        const host = String(location.hostname || "").toLowerCase();
        const dedicated = host === "md.u2re.space" || host === "www.md.u2re.space";
        if (!dedicated) {
            const m = String(location.pathname || "").match(/^(\/(?:markdown|document|viewer))(?:\/|$)/i);
            if (m) root.dataset.cwspRouterBase = m[1].toLowerCase();
        }
    } catch {
        /* ignore */
    }
};

export const showDocumentBootFailure = (error: unknown, mount: HTMLElement = document.body): void => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error("[CWSP-document] boot failed", error);
    mount.replaceChildren();
    mount.style.cssText =
        "margin:0;padding:16px;font:14px/1.4 ui-monospace,monospace;background:#111;color:#f66;white-space:pre-wrap;";
    mount.textContent = `[CWSP-document] boot failed\n\n${message}`;
};

/**
 * WHY: install the share bridge before `bootMinimal` so cold-start SEND/VIEW
 * is not dropped while BootLoader is still loading. PWA share-target and
 * launch-queue stay on `initIngressPWA` plus `InstallEvent.addRoutes`.
 */
export const installDocumentShareIngress = (): void => {
    try {
        const g = globalThis as { Capacitor?: { isNativePlatform?: () => boolean } };
        const native = typeof g.Capacitor?.isNativePlatform === "function" && g.Capacitor.isNativePlatform();
        if (native) {
            void import("boot/capacitor-share-intent")
                .then((mod) => mod.installCapacitorShareIntentBridge())
                .catch(() => undefined);
            return;
        }
        void import("core/pwa/sw-handling")
            .then((mod) => mod.initIngressPWA())
            .catch(() => undefined);
    } catch {
        /* web / preview */
    }
};

export const bootDocumentSku = async (
    container: HTMLElement,
    kind?: DocumentHostKind,
    view: "viewer" | "editor" | "print" = "viewer"
): Promise<void> => {
    const host = detectHostKind(kind);
    stampDocumentSku(host);
    installDocumentShareIngress();

    const { bootMinimal } = await import("boot/BootLoader");
    await bootMinimal(container, view);
    try {
        globalThis.dispatchEvent?.(new CustomEvent("cwsp:document-open", { detail: { source: "sku-boot" } }));
    } catch {
        /* viewer listens on show */
    }
};

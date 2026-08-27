/*
 * Filename: sku-boot.ts
 * FullPath: apps/CWSP-document/src/frontend/web/sku-boot.ts
 * FIND:sku
 * Change date: 14.05.00_27.08.2026
 * Reason: One document SKU stamp for PWA, Capacitor, and CRX (viewer + editor).
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
 * WHY: Capacitor `cws:shareIntent` is ingested by `installCapacitorShareIntentBridge`
 * (viewer for image / document / text / files). This stamp-only hook stays for callers.
 */
export const installDocumentShareIngress = (): void => {
    /* share pipeline lives in capacitor-share-intent + initIngressPWA */
};

export const bootDocumentSku = async (
    container: HTMLElement,
    kind?: DocumentHostKind,
    view: "viewer" | "editor" | "print" = "viewer"
): Promise<void> => {
    const host = detectHostKind(kind);
    stampDocumentSku(host);
    installDocumentShareIngress();

    if (host === "capacitor") {
        try {
            const { SystemBarType, SystemBars } = await import("@capacitor/core");
            await SystemBars.hide({ bar: SystemBarType.NavigationBar });
        } catch {
            /* web preview */
        }
    }

    const { bootMinimal } = await import("boot/BootLoader");
    await bootMinimal(container, view);
};

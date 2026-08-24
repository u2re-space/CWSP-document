/*
 * Filename: entry.ts
 * FullPath: apps/CWSP-document/src/frontend/web/capacitor/entry.ts
 * FIND:sku
 * Change date and time: 13.50.00_24.08.2026
 * Reason for changes: Document SKU — print / read / edit markdown+images; AI lives on process.
 */

import { SystemBarType, SystemBars } from "@capacitor/core";
import { bootMinimal } from "boot/BootLoader";
import { applyCwspSku } from "com/config/ecosystem-skus";

const enabledViews = ["minimal", "viewer", "editor", "print", "settings"] as const;

applyCwspSku("document");
document.documentElement.dataset.cwspSurface = "cw-document";
document.documentElement.dataset.cwspNativeShell = "capacitor";
document.documentElement.dataset.cwspEnabledViews = enabledViews.join(",");
document.documentElement.dataset.cwspDefaultView = "viewer";

void SystemBars.hide({ bar: SystemBarType.NavigationBar }).catch(() => {
    /* native-only; web preview ignores */
});

function showBootFailure(error: unknown): void {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error("[CWSP-document] boot failed", error);
    const root = document.body;
    root.replaceChildren();
    root.style.cssText =
        "margin:0;padding:16px;font:14px/1.4 ui-monospace,monospace;background:#111;color:#f66;white-space:pre-wrap;";
    root.textContent = `[CWSP-document] boot failed\n\n${message}`;
}

void bootMinimal(document.body, "viewer").catch(showBootFailure);

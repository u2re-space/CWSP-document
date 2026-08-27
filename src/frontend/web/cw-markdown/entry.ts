/*
 * Filename: entry.ts
 * FullPath: apps/CWSP-document/src/frontend/web/cw-markdown/entry.ts
 * Change date and time: 08.45.00_29.07.2026
 * Reason for changes: VDS md.u2re.space / /markdown/ SPA entry for CWSP-document (was missing after CRX split).
 */

/**
 * CWSP-document Markdown host entry (Fastify apps/cw-markdown).
 * INVARIANT: history base auto-detects `/markdown` on IP mounts; md.u2re.space stays `/`.
 */

import { stampDocumentSku } from "../sku-boot";

try {
    stampDocumentSku("web");
} catch {
    /* ignore */
}

const mount = document.getElementById("app");
if (!mount) {
    console.error("[cw-markdown] #app missing");
} else {
    void import("../../../index.ts")
        .then(async (mod) => {
            const run = mod?.default;
            if (typeof run !== "function") {
                throw new Error("CWSP-document default export is not a boot function");
            }
            await run(mount);
        })
        .catch((error: unknown) => {
            console.error("[cw-markdown] boot failed", error);
            mount.textContent =
                error instanceof Error ? error.message : "Failed to start CWSP-document Markdown";
        });
}

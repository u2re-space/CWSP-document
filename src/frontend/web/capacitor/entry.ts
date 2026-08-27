/*
 * Filename: entry.ts
 * FullPath: apps/CWSP-document/src/frontend/web/capacitor/entry.ts
 * FIND:sku
 * Change date: 14.05.00_27.08.2026
 * Reason: Capacitor document SKU — shared sku-boot (viewer + editor + print).
 */

import { bootDocumentSku, showDocumentBootFailure } from "../sku-boot";

void bootDocumentSku(document.body, "capacitor", "viewer").catch((error) => {
    showDocumentBootFailure(error, document.body);
});

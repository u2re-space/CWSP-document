/*
 * Filename: capacitor.config.ts
 * FullPath: apps/CWSP-document/src/frontend/web/capacitor/capacitor.config.ts
 * FIND:sku
 * Change date and time: 13.50.00_24.08.2026
 * Reason for changes: Document Capacitor SKU — space.u2re.document, books icon.
 */

import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
    appId: "space.u2re.document",
    appName: "CWSP Document",
    webDir: "../../../../build/capacitor/web",
    android: {
        path: "../../../../platforms/android"
    },
    plugins: {
        SystemBars: {
            style: "DARK",
            insetsHandling: "disable"
        }
    },
    server: {
        androidScheme: process.env.CWSP_ANDROID_SCHEME || "https",
        cleartext: process.env.CWSP_ALLOW_CLEARTEXT === "1"
    }
};

export default config;

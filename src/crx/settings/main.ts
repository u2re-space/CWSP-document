/*
 * Filename: main.ts
 * FullPath: apps/CrossWord/src/crx/settings/main.ts
 * Change date and time: 15.10.00_19.07.2026
 * Reason for changes: Single Extension settings tab — merge NTP + device prefs
 *   + CRX capture options; drop duplicate Extension / Chrome Extension tabs.
 */

import { crxFrontend } from "shells/boot";
import { registerSettingsContribution } from "com/config/SettingsContributions";

/**
 * One CRX-only tab. WHY: built-in `extension` (NTP) + contributed `device`
 * ("Extension") + this panel ("Chrome Extension") used to stack three near-
 * identical tabs on the options page.
 */
registerSettingsContribution({
    id: "crx",
    label: "Extension",
    order: 80,
    surfaces: ["crx"],
    render: () => {
        const el = document.createElement("div");
        el.className = "settings-group";
        el.setAttribute("data-group", "views.crx");
        el.innerHTML = `
            <h3 class="settings-group__title">Extension</h3>
            <p class="settings-hint">
                CWSP hub default: <code>https://127.0.0.1:8434</code> as
                <code>L-110-crx</code> (same token seed as Neutralino).
                Trust the cert once in Chrome if needed. WAN relay:
                <code>https://45.147.121.152:8434</code> under CWSP → Relay.
                Context menu: Copy &amp; Share by CWSP / Paste by CWSP.
            </p>
            <label class="settings-field">
                <span class="settings-field__label">Enable New Tab Page (offline Basic)</span>
                <input type="checkbox" data-field="core.ntpEnabled" />
            </label>
            <label class="settings-field">
                <span class="settings-field__label">Capture selection via context menu</span>
                <input type="checkbox" data-field="views.crx.contextMenuCapture" />
            </label>
            <label class="settings-field">
                <span class="settings-field__label">Auto-open results in side panel</span>
                <input type="checkbox" data-field="views.crx.openInSidePanel" />
            </label>
            <h3 class="settings-group__title">Clipboard bridge</h3>
            <label class="settings-field">
                <span class="settings-field__label">Enable remote clipboard bridge</span>
                <input type="checkbox" data-field="shell.enableRemoteClipboardBridge" />
            </label>
            <label class="settings-field">
                <span class="settings-field__label">Accept contacts bridge</span>
                <input type="checkbox" data-field="shell.acceptContactsBridgeData" />
            </label>
            <p class="settings-hint">Hub identity and share targets live under the CWSP tab.</p>`;
        return el;
    }
});

const mount = document.getElementById("app") as HTMLElement | null;
crxFrontend(mount ?? document.body, {
    shell: "immersive",
    initialView: "settings"
});

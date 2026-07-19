import { crxFrontend } from "shells/boot";
import { registerSettingsContribution } from "com/config/SettingsContributions";

// CRX-specific contributed settings panel. Registered before the settings view
// mounts so it appears as its own tab in the extension options page. Other
// surfaces (web/Capacitor) never register this, demonstrating per-surface
// settings contribution.
registerSettingsContribution({
    id: "crx",
    label: "Chrome Extension",
    order: 85,
    render: () => {
        const el = document.createElement("div");
        el.className = "settings-group";
        el.setAttribute("data-group", "views.crx");
        el.innerHTML = `
            <h3 class="settings-group__title">Chrome Extension</h3>
            <p class="settings-hint">
                CWSP: default hub is <code>https://127.0.0.1:8434</code> (same backend as Neutralino)
                as client <code>L-110-crx</code> with ecosystem token (seeded on first run).
                Open <code>https://127.0.0.1:8434</code> once in Chrome if the cert is not trusted.
                For WAN, set CWSP → Relay to <code>https://45.147.121.152:8434</code>.
                Context menu: Copy &amp; Share by CWSP / Paste by CWSP.
            </p>
            <label class="settings-field">
                <span class="settings-field__label">Capture selection via context menu</span>
                <input type="checkbox" data-field="views.crx.contextMenuCapture" />
            </label>
            <label class="settings-field">
                <span class="settings-field__label">Auto-open results in side panel</span>
                <input type="checkbox" data-field="views.crx.openInSidePanel" />
            </label>`;
        return el;
    }
});

const mount = document.getElementById("app") as HTMLElement | null;
crxFrontend(mount ?? document.body, {
    shell: "immersive",
    initialView: "settings"
});

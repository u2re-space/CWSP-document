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

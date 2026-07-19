/*
 * Filename: main.ts
 * FullPath: apps/CrossWord/src/crx/settings/main.ts
 * Change date and time: 22.00.00_19.07.2026
 * Reason for changes: Extension tab layout — reuse CWSP settings field helpers
 *   (.field / form-checkbox) instead of unstyled settings-field HTML.
 */

import { crxFrontend } from "shells/boot";
import { registerSettingsContribution } from "com/config/SettingsContributions";
import {
    settingsCheckboxField,
    settingsHint,
    settingsPanel,
    settingsSelectField,
    settingsTextField,
    type SettingsPanelChild
} from "com/config/settings/settings-contribution-ui";
import { CRX_WIRE_CLIENT_ID, registerCrxNeutralinoSettingsSync } from "./neutralino-settings-arm";

/**
 * Extension tab — CRX-only CWSP identity + chrome prefs.
 * WHY: shared gateway/token/clipboard live under CWSP (Neutralino SoT);
 * wire id must stay L-110-crx and must not overwrite desk L-110 in portable.config.
 */
registerSettingsContribution({
    id: "crx",
    label: "Extension",
    order: 80,
    surfaces: ["crx"],
    render: () => {
        const children: SettingsPanelChild[] = [
            settingsHint(
                `Chrome wire peer for this extension (${CRX_WIRE_CLIENT_ID}). Desk Neutralino / backend client id is edited under CWSP (shell.clientId → /service/config, including PNA). Do not set this field to bare L-110.`
            ),
            "CWSP identity",
            settingsTextField("CRX client id", "core.userId", CRX_WIRE_CLIENT_ID),
            settingsTextField("Socket self id", "core.socket.selfId", CRX_WIRE_CLIENT_ID),
            settingsCheckboxField(
                "Maintain hub socket connection",
                "shell.maintainHubSocketConnection"
            ),
            settingsSelectField("Wire protocol", "core.socket.protocol", [
                ["https", "https (force wss)"],
                ["auto", "auto"],
                ["http", "http"]
            ]),
            settingsHint(
                "Hub default: https://127.0.0.1:8434. WAN relay under CWSP → Relay. Context menu: Copy & Share by CWSP / Paste by CWSP."
            ),
            "Chrome",
            settingsCheckboxField("Enable New Tab Page (offline Basic)", "core.ntpEnabled"),
            settingsCheckboxField(
                "Capture selection via context menu",
                "views.crx.contextMenuCapture"
            ),
            settingsCheckboxField("Auto-open results in side panel", "views.crx.openInSidePanel"),
            "Clipboard bridge",
            settingsCheckboxField(
                "Enable remote clipboard bridge",
                "shell.enableRemoteClipboardBridge"
            ),
            settingsCheckboxField("Accept contacts bridge", "shell.acceptContactsBridgeData"),
            settingsHint(
                "Gateway, ecosystem token, destinations, and clipboard modes live under CWSP (synced to Neutralino /service/config when the desk host is up)."
            )
        ];
        return settingsPanel("crx", "Extension", children);
    },
    load: (settings, panel) => {
        const userId =
            String(settings.core?.userId || "").trim() || CRX_WIRE_CLIENT_ID;
        const selfId =
            String(settings.core?.socket?.selfId || "").trim() || userId;
        const userInput = panel.querySelector(
            '[data-field="core.userId"]'
        ) as HTMLInputElement | null;
        const selfInput = panel.querySelector(
            '[data-field="core.socket.selfId"]'
        ) as HTMLInputElement | null;
        if (userInput && !userInput.value.trim()) userInput.value = userId;
        if (selfInput && !selfInput.value.trim()) selfInput.value = selfId;
    },
    save: (settings) => {
        // INVARIANT: never persist bare L-110 from a mistaken paste — collide with Neutralino.
        const uid = String(settings.core?.userId || "").trim();
        if (!uid || /^L-110$/i.test(uid)) {
            settings.core = { ...(settings.core || {}), userId: CRX_WIRE_CLIENT_ID };
        }
        const selfId = String(settings.core?.socket?.selfId || "").trim();
        if (!selfId || /^L-110$/i.test(selfId)) {
            settings.core = {
                ...(settings.core || {}),
                socket: {
                    ...(settings.core?.socket || {}),
                    selfId: String(settings.core?.userId || CRX_WIRE_CLIENT_ID)
                }
            };
        }
    }
});

const mount = document.getElementById("app") as HTMLElement | null;

void (async () => {
    // WHY: arm must register before Settings hydrate (settings:get → /service/config).
    const live = await registerCrxNeutralinoSettingsSync();
    console.log(
        `[CRX settings] Neutralino /service/config ${live ? "live" : "offline (chrome.storage only)"}`
    );
    crxFrontend(mount ?? document.body, {
        shell: "immersive",
        initialView: "settings"
    });
})();

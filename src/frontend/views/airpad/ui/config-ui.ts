// =========================
// Configuration UI for Airpad
// =========================

import {
    getAirPadQuickConnectTarget,
    getAccessToken,
    setAirPadQuickConnectTarget,
    setAccessToken,
} from '../config/config';
import { reconnectAirPadSessionAfterConfigChange } from '../network/session';
import { hideKeyboard } from '../input/keyboard/handlers';
import { getAirpadOwnerDocument } from '../utils/utils';

/** Marker for teardown; do not reuse generic `.config-overlay` alone (other features could add one). */
const AIRPAD_CONFIG_MARKER = 'airpad-config-overlay';

/**
 * Mount on the owner `document.body` (not `cw-shell-minimal` / task-tab host).
 * Minimal shell uses `contain: strict` + `overflow: hidden`; children with `position: fixed`
 * are still clipped to that host, so the dialog stays in the DOM but is not visible.
 */
function getConfigOverlayMountParent(): HTMLElement {
    const doc = getAirpadOwnerDocument() ?? document;
    return (doc.body ?? doc.documentElement ?? document.body) as HTMLElement;
}

/** Body-portaled overlay is not under `[data-shell][data-theme]`, so copy theme for SCSS tokens. */
function syncAirpadConfigOverlayShellTheme(overlay: HTMLElement, doc: Document): void {
    const shell =
        (doc.querySelector("cw-shell-minimal[data-theme]") as HTMLElement | null) ??
        (doc.querySelector("[data-shell-system=\"task-tab\"][data-theme]") as HTMLElement | null) ??
        (doc.querySelector("[data-shell][data-theme]") as HTMLElement | null);
    const theme = shell?.getAttribute("data-theme");
    if (theme === "light" || theme === "dark") {
        overlay.setAttribute("data-theme", theme);
    } else {
        overlay.removeAttribute("data-theme");
    }
}

// Create configuration overlay
export function createConfigUI(): HTMLElement {
    const doc = getAirpadOwnerDocument() ?? document;
    const overlay = doc.createElement('div');
    overlay.className = `config-overlay ${AIRPAD_CONFIG_MARKER}`;
    overlay.innerHTML = `
        <div class="config-panel">
            <h3>Airpad Configuration</h3>
            <div class="config-panel__body">
                <div class="config-group">
                    <label for="airpadQuickConnect"><strong>Where to connect</strong>:</label>
                    <input
                        type="text"
                        id="airpadQuickConnect"
                        name="airpad-quick-connect"
                        placeholder="L-192.168.0.110 or https://192.168.0.110:8443/"
                    />
                    <label for="airpadAuthPass"><strong>Auth pass token</strong> (optional):</label>
                    <input
                        type="password"
                        id="airpadAuthPass"
                        name="airpad-auth-pass"
                        autocomplete="off"
                        placeholder="If the remote requires a control token for input/mouse"
                    />
                    <div class="field-hint">
                        Target device ID or URL:port. Default identity and tokens stay in Settings → Server; set an auth pass here when the peer rejects control without it.
                    </div>
                </div>
            </div>

            <div class="config-actions">
                <button id="saveConfig" type="button" name="airpad-config-save">Save & Reconnect</button>
                <button id="cancelConfig" type="button" name="airpad-config-cancel">Cancel</button>
            </div>
        </div>
    `;

    // Add event listeners
    const quickConnectInput = overlay.querySelector('#airpadQuickConnect') as HTMLInputElement;
    const authPassInput = overlay.querySelector('#airpadAuthPass') as HTMLInputElement;
    const saveButton = overlay.querySelector('#saveConfig') as HTMLButtonElement;
    const cancelButton = overlay.querySelector('#cancelConfig') as HTMLButtonElement;

    quickConnectInput.value = getAirPadQuickConnectTarget();
    authPassInput.value = getAccessToken();

    const closeOverlay = () => {
        overlay.classList.remove('flex');
        overlay.style.display = 'none';
        overlay.setAttribute('aria-hidden', 'true');
    };

    saveButton.addEventListener('click', () => {
        setAirPadQuickConnectTarget(quickConnectInput.value);
        setAccessToken(authPassInput.value);
        reconnectAirPadSessionAfterConfigChange({ delayMs: 100 });
        closeOverlay();
    });

    cancelButton.addEventListener('click', closeOverlay);

    // Click outside to close
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            closeOverlay();
        }
    });

    return overlay;
}

// Show configuration overlay
export function showConfigUI(): void {
    // Hide virtual keyboard when opening config dialog
    try {
        hideKeyboard();
    } catch {
        /* non-fatal */
    }

    const doc = getAirpadOwnerDocument() ?? document;
    const host = getConfigOverlayMountParent();
    let overlay = doc.querySelector(`.${AIRPAD_CONFIG_MARKER}`) as HTMLElement | null;
    if (overlay && overlay.parentElement !== host) {
        overlay.remove();
        overlay = null;
    }
    if (!overlay) {
        overlay = createConfigUI();
        host.appendChild(overlay);
    } else {
        const quickConnectInput = overlay.querySelector('#airpadQuickConnect') as HTMLInputElement | null;
        const authPassInput = overlay.querySelector('#airpadAuthPass') as HTMLInputElement | null;
        if (quickConnectInput) quickConnectInput.value = getAirPadQuickConnectTarget();
        if (authPassInput) authPassInput.value = getAccessToken();
    }
    syncAirpadConfigOverlayShellTheme(overlay, doc);
    overlay.classList.add('flex');
    overlay.style.display = 'flex';
    overlay.style.zIndex = '120000';
    overlay.setAttribute('aria-hidden', 'false');
}

/** Remove portaled overlay when Airpad unmounts (avoids stale node on body/shell). */
export function teardownAirpadConfigOverlay(): void {
    const doc = getAirpadOwnerDocument() ?? document;
    doc.querySelectorAll(`.${AIRPAD_CONFIG_MARKER}`).forEach((el) => el.remove());
}
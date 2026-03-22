// =========================
// Configuration UI for Airpad
// =========================

import {
    getRemoteHost,
    getRemoteProtocol,
    getRemoteRouteTarget,
    getAirPadTransportMode,
    getAirPadAuthToken,
    getAirPadClientId,
    getAirPadTransportSecret,
    getAirPadSigningSecret,
    applyAirpadRemoteConfig,
} from '../config/config';
import { reconnectAirPadSessionAfterConfigChange } from '../network/session';
import { hideKeyboard } from '../input/keyboard/handlers';

/** Marker for teardown; do not reuse generic `.config-overlay` alone (other features could add one). */
const AIRPAD_CONFIG_MARKER = 'airpad-config-overlay';

/**
 * Mount outside `.view-airpad`: ancestors use `contain: strict` (minimal shell), which clips
 * `position: fixed` overlays and makes the dialog invisible.
 */
function getConfigOverlayMountParent(): HTMLElement {
    const shell = document.querySelector('.app-shell');
    if (shell instanceof HTMLElement) {
        return shell;
    }
    return document.body;
}

// Create configuration overlay
export function createConfigUI(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = `config-overlay ${AIRPAD_CONFIG_MARKER}`;
    overlay.innerHTML = `
        <div class="config-panel">
            <h3>Airpad Configuration</h3>
            <div class="config-panel__body">
                <div class="config-group">
                    <strong>Connect URL</strong>
                </div>
                <div class="config-group">
                    <label for="remoteHost">Connect URL / Relay Host (optional, comma separated):</label>
                    <input type="text" id="remoteHost" />
                </div>

                <div class="config-group">
                    <label for="remoteRouteTarget">Remote Host [optional] (peerId/deviceId/alias/IP):</label>
                    <input type="text" id="remoteRouteTarget" placeholder="optional target after connect" />
                </div>

                <div class="config-group">
                    <strong>Routing / identifiers</strong>
                </div>

                <div class="config-group">
                    <label for="remoteProtocol">Remote Protocol:</label>
                    <select id="remoteProtocol">
                        <option value="auto">Auto (recommended)</option>
                        <option value="https">HTTPS / WSS</option>
                        <option value="http">HTTP / WS</option>
                    </select>
                </div>
                <div class="config-group">
                    <label for="airpadTransportMode">Transport:</label>
                    <select id="airpadTransportMode">
                        <option value="plaintext">Plaintext</option>
                        <option value="secure">Secure (signed envelope)</option>
                    </select>
                </div>
                <div class="config-group">
                    <label for="airpadAuthToken">Airpad Auth Token:</label>
                    <input type="text" id="airpadAuthToken" />
                </div>
                <div class="config-group">
                    <label for="airpadClientId">Airpad Client ID:</label>
                    <input type="text" id="airpadClientId" />
                </div>
                <div class="config-group">
                    <label for="airpadTransportSecret">Secure Transport Secret:</label>
                    <input type="text" id="airpadTransportSecret" />
                </div>
                <div class="config-group">
                    <label for="airpadSigningSecret">Signing Secret (HMAC):</label>
                    <input type="password" id="airpadSigningSecret" />
                </div>
            </div>

            <div class="config-actions">
                <button id="saveConfig" type="button" name="airpad-config-save">Save & Reconnect</button>
                <button id="cancelConfig" type="button" name="airpad-config-cancel">Cancel</button>
            </div>
        </div>
    `;

    // Add event listeners
    const hostInput = overlay.querySelector('#remoteHost') as HTMLInputElement;
    const routeTargetInput = overlay.querySelector('#remoteRouteTarget') as HTMLInputElement;
    const protocolInput = overlay.querySelector('#remoteProtocol') as HTMLSelectElement;
    const transportModeInput = overlay.querySelector('#airpadTransportMode') as HTMLSelectElement;
    const authTokenInput = overlay.querySelector('#airpadAuthToken') as HTMLInputElement;
    const clientIdInput = overlay.querySelector('#airpadClientId') as HTMLInputElement;
    const transportSecretInput = overlay.querySelector('#airpadTransportSecret') as HTMLInputElement;
    const signingSecretInput = overlay.querySelector('#airpadSigningSecret') as HTMLInputElement;
    const saveButton = overlay.querySelector('#saveConfig') as HTMLButtonElement;
    const cancelButton = overlay.querySelector('#cancelConfig') as HTMLButtonElement;
    hostInput.value = getRemoteHost();
    routeTargetInput.value = getRemoteRouteTarget();
    protocolInput.value = getRemoteProtocol();
    transportModeInput.value = getAirPadTransportMode();
    authTokenInput.value = getAirPadAuthToken();
    clientIdInput.value = getAirPadClientId();
    transportSecretInput.value = getAirPadTransportSecret();
    signingSecretInput.value = getAirPadSigningSecret();

    saveButton.addEventListener('click', () => {
        applyAirpadRemoteConfig({
            host: hostInput.value,
            routeTarget: routeTargetInput.value,
            protocol: protocolInput.value,
            transportMode: transportModeInput.value,
            authToken: authTokenInput.value,
            clientId: clientIdInput.value,
            transportSecret: transportSecretInput.value,
            signingSecret: signingSecretInput.value,
        });
        reconnectAirPadSessionAfterConfigChange({ delayMs: 100 });
        overlay.classList.remove('flex');
        overlay.style.display = 'none';
    });

    cancelButton.addEventListener('click', () => {
        overlay.classList.remove('flex');
        overlay.style.display = 'none';
    });

    // Click outside to close
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.classList.remove('flex');
            overlay.style.display = 'none';
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

    const host = getConfigOverlayMountParent();
    let overlay = document.querySelector(`.${AIRPAD_CONFIG_MARKER}`) as HTMLElement | null;
    if (overlay && overlay.parentElement !== host) {
        overlay.remove();
        overlay = null;
    }
    if (!overlay) {
        overlay = createConfigUI();
        host.appendChild(overlay);
    } else {
        const hostInput = overlay.querySelector('#remoteHost') as HTMLInputElement | null;
        const routeTargetInput = overlay.querySelector('#remoteRouteTarget') as HTMLInputElement | null;
        const protocolInput = overlay.querySelector('#remoteProtocol') as HTMLSelectElement | null;
        const transportModeInput = overlay.querySelector('#airpadTransportMode') as HTMLSelectElement | null;
        const authTokenInput = overlay.querySelector('#airpadAuthToken') as HTMLInputElement | null;
        const clientIdInput = overlay.querySelector('#airpadClientId') as HTMLInputElement | null;
        const transportSecretInput = overlay.querySelector('#airpadTransportSecret') as HTMLInputElement | null;
        const signingSecretInput = overlay.querySelector('#airpadSigningSecret') as HTMLInputElement | null;
        if (hostInput) hostInput.value = getRemoteHost();
        if (routeTargetInput) routeTargetInput.value = getRemoteRouteTarget();
        if (protocolInput) protocolInput.value = getRemoteProtocol();
        if (transportModeInput) transportModeInput.value = getAirPadTransportMode();
        if (authTokenInput) authTokenInput.value = getAirPadAuthToken();
        if (clientIdInput) clientIdInput.value = getAirPadClientId();
        if (transportSecretInput) transportSecretInput.value = getAirPadTransportSecret();
        if (signingSecretInput) signingSecretInput.value = getAirPadSigningSecret();
    }
    overlay.classList.add('flex');
    overlay.style.display = 'flex';
    overlay.style.zIndex = '120000';
}

/** Remove portaled overlay when Airpad unmounts (avoids stale node on body/shell). */
export function teardownAirpadConfigOverlay(): void {
    document.querySelectorAll(`.${AIRPAD_CONFIG_MARKER}`).forEach((el) => el.remove());
}
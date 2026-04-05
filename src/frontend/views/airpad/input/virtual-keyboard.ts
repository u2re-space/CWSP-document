// =========================
// Virtual Keyboard Component
// =========================

import { log, getVkStatusEl, getAirpadDomRoot } from '../utils/utils';
import { initVirtualKeyboardAPI, hasVirtualKeyboardAPI } from './keyboard/api';
import {
    setKeyboardElement,
    setToggleButton,
    setRemoteKeyboardEnabled as setRemoteKeyboardEnabledState,
    getToggleButton,
} from './keyboard/state';
import { createKeyboardHTML } from './keyboard/ui';
import {
    hideKeyboard,
    setupToggleButtonHandler,
    setupVirtualKeyboardAPIHandlers,
    setupKeyboardUIHandlers,
} from './keyboard/handlers';

function updateToggleButtonEnabledState(enabled: boolean) {
    const toggleButton = getToggleButton();
    if (!(toggleButton instanceof HTMLButtonElement)) return;
    // Keep pointer hit-testing active even when remote keyboard is unavailable.
    // Using native "disabled" can cause click-through on some mobile browsers.
    toggleButton.disabled = false;
    toggleButton.setAttribute('aria-disabled', String(!enabled));
    toggleButton.classList.toggle('is-disabled', !enabled);

    const vkStatusEl = getVkStatusEl();
    if (vkStatusEl) {
        const base = (vkStatusEl.textContent || 'overlay:off').replace(/\s*\/\s*remote:(on|off)\s*$/i, '');
        vkStatusEl.textContent = `${base} / remote:${enabled ? 'on' : 'off'}`;
    }
}

export function setRemoteKeyboardEnabled(enabled: boolean) {
    setRemoteKeyboardEnabledState(enabled);
    updateToggleButtonEnabledState(enabled);
    if (!enabled) {
        hideKeyboard();
    }
}

/**
 * @param mountRoot — node under which Airpad markup was mounted (e.g. `[data-airpad-content]`).
 *   Resolves `.view-airpad` for portal placement; prefers mount root / `getAirpadDomRoot()` over global document queries.
 */
export function initVirtualKeyboard(mountRoot?: HTMLElement | null) {
    // Initialize VirtualKeyboard API if available
    initVirtualKeyboardAPI();
    const hasAPI = hasVirtualKeyboardAPI();
    const vkStatusEl = getVkStatusEl();
    if (vkStatusEl) {
        vkStatusEl.textContent = hasAPI ? 'overlay:on / policy:auto' : 'overlay:off';
    }

    // Mount keyboard inside airpad root so it inherits airpad styles/tokens.
    const scoped = getAirpadDomRoot();
    const container =
        mountRoot?.closest?.('.view-airpad') ??
        mountRoot ??
        scoped?.closest?.('.view-airpad') ??
        scoped ??
        document.body;

    // Reuse existing instance if already mounted.
    let keyboardElement = container.querySelector('.virtual-keyboard-container') as HTMLElement | null;
    if (!keyboardElement) {
        const keyboardHTML = createKeyboardHTML();
        container.insertAdjacentHTML('beforeend', keyboardHTML);
        keyboardElement = container.querySelector('.virtual-keyboard-container') as HTMLElement | null;
    }

    if (!keyboardElement) {
        log('Failed to create keyboard element');
        return;
    }

    // Ensure keyboard is hidden by default
    keyboardElement.classList.remove('visible');

    setKeyboardElement(keyboardElement);

    // Create toggle button in corner
    const toggleContainer = ((container.querySelector('.bottom-toolbar') ?? container) as HTMLElement);
    let toggleButton = toggleContainer.querySelector('.keyboard-toggle') as HTMLElement | null;
    if (!toggleButton) {
        const toggleHTML = hasAPI
            ? '<button type="button" name="airpad-keyboard-toggle" tabindex="-1" contenteditable="false" virtualkeyboardpolicy="manual" class="keyboard-toggle keyboard-toggle-editable" aria-label="Toggle keyboard">⌨️</button>'
            : '<button type="button" name="airpad-keyboard-toggle" tabindex="-1" class="keyboard-toggle" aria-label="Toggle keyboard">⌨️</button>';
        toggleContainer.insertAdjacentHTML('beforeend', toggleHTML);
        toggleButton = toggleContainer.querySelector('.keyboard-toggle') as HTMLElement | null;
    }

    if (!toggleButton) {
        log('Failed to create toggle button');
        return;
    }

    toggleButton.autofocus = false;
    toggleButton.removeAttribute('autofocus');
    if (toggleButton instanceof HTMLElement) {
        toggleButton.setAttribute('autocapitalize', 'off');
        toggleButton.setAttribute('autocorrect', 'off');
        toggleButton.setAttribute('spellcheck', 'false');
    }
    setToggleButton(toggleButton);
    setRemoteKeyboardEnabled(false);

    // Setup event handlers
    setupToggleButtonHandler();
    setupVirtualKeyboardAPIHandlers();
    setupKeyboardUIHandlers();

    log('Virtual keyboard initialized');
}

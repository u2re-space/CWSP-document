// =========================
// Keyboard State Management
// =========================

let keyboardVisible = false;
let keyboardElement: HTMLElement | null = null;
let toggleButton: HTMLElement | null = null;
let remoteKeyboardEnabled = false;

export function setKeyboardVisible(visible: boolean) {
    keyboardVisible = visible;
}

export function isKeyboardVisible(): boolean {
    return keyboardVisible;
}

export function setKeyboardElement(element: HTMLElement | null) {
    keyboardElement = element;
}

export function getKeyboardElement(): HTMLElement | null {
    return keyboardElement;
}

export function setToggleButton(button: HTMLElement | null) {
    toggleButton = button;
}

export function getToggleButton(): HTMLElement | null {
    return toggleButton;
}

export function setRemoteKeyboardEnabled(enabled: boolean) {
    remoteKeyboardEnabled = enabled;
}

export function isRemoteKeyboardEnabled(): boolean {
    return remoteKeyboardEnabled;
}

if ('visualViewport' in globalThis) {
    const VIEWPORT_VS_CLIENT_HEIGHT_RATIO = 0.75;
    globalThis?.visualViewport?.addEventListener?.('resize', function (event) {
        if (
            (event.target.height * event.target.scale) / globalThis?.screen?.height <
            VIEWPORT_VS_CLIENT_HEIGHT_RATIO
        ) keyboardVisible = true;
        else keyboardVisible = false;
    });
}

if ('virtualKeyboard' in globalThis?.navigator) {
    // Tell the browser you are taking care of virtual keyboard occlusions yourself.
    navigator.virtualKeyboard.overlaysContent = true;
    navigator.virtualKeyboard.addEventListener('geometrychange', (event) => {
        const { x, y, width, height } = event.target.boundingRect;
        if (height > 0) keyboardVisible = true;
        else keyboardVisible = false;
    });
}

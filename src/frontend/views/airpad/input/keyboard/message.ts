// =========================
// Keyboard Message Sending
// =========================

import {
    createAirPadKeyboardMessage,
    isAirPadSessionConnected,
    sendAirPadBinaryMessage,
    sendAirPadKeyboardChar
} from '../../network/session';

// Re-export for backward compatibility and direct binary sending
export function sendKeyboardChar(char: string) {
    if (!isAirPadSessionConnected()) return;

    sendAirPadKeyboardChar(char);
}

// For sending pre-built binary messages (optimization)
export function sendKeyboardBinary(codePoint: number, flags: number) {
    if (!isAirPadSessionConnected()) return;

    const buffer = createAirPadKeyboardMessage(codePoint, flags);
    sendAirPadBinaryMessage(buffer);
}

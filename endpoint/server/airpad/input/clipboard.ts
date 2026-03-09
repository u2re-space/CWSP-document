import clipboardy from "clipboardy";

import { pickEnvBoolLegacy } from "../../lib/env.ts";
import type { Socket } from "socket.io";

export type AirpadClipboardSource = "local" | "network";

const airpadClipboardEnabled = pickEnvBoolLegacy("CWS_AIRPAD_CLIPBOARD_ENABLED", true) ?? pickEnvBoolLegacy("CWS_CLIPBOARD_ENABLED", true) ?? true;

export const readAirpadClipboard = async (): Promise<string> => {
    if (!airpadClipboardEnabled) return "";
    try {
        const text = await clipboardy.read();
        return String(text ?? "");
    } catch (_err) {
        return "";
    }
};

export const writeAirpadClipboard = async (text: string): Promise<void> => {
    if (!airpadClipboardEnabled) return;
    const value = String(text ?? "");
    if (!value) return;
    try {
        await clipboardy.write(value);
    } catch (_err) {
        return;
    }
};

export const emitClipboardUpdateToSockets = (sockets: Set<Socket>, text: string, source: AirpadClipboardSource): void => {
    const payload = { text, source };
    for (const client of sockets) {
        if (!client || client.disconnected) continue;
        client.emit("clipboard:update", payload);
    }
};

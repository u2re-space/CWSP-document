import { loadSettings } from "./Settings";
import type { AppSettings } from "./SettingsTypes";
import { DEFAULT_SETTINGS } from "./SettingsTypes";

export type RuntimeSettingsProvider = () => Promise<AppSettings> | AppSettings;

let provider: RuntimeSettingsProvider = loadSettings;//async () => DEFAULT_SETTINGS;

/**
 * Allows non-browser runtimes (Node/Deno backend) to supply settings without IndexedDB/chrome storage.
 * Frontend apps can also set this to bridge to their existing settings storage.
 */
export const setRuntimeSettingsProvider = (next: RuntimeSettingsProvider) => {
    provider = next;
};

export const getRuntimeSettings = async (): Promise<AppSettings> => {
    try {
        const value = await provider();
        return value || DEFAULT_SETTINGS;
    } catch {
        return DEFAULT_SETTINGS;
    }
};

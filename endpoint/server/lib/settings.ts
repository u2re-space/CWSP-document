import { readFile, writeFile } from "node:fs/promises";

import { SETTINGS_FILE, ensureDataDirs } from "./paths.ts";
import { safeJsonParse } from "./parsing.ts";

export interface CustomInstruction {
    id: string;
    instruction: string;
}

export type CoreMode = "native" | "web" | "desktop" | "mobile" | "server" | "daemon" | "client" | "daemon-client" | "endpoint";

export interface CoreSettings {
    mode?: CoreMode;
    roles?: string[];
    bridge?: {
        enabled?: boolean;
        mode?: "active" | "passive";
        origin?: {
            originId?: string;
            originHosts?: string[];
            originDomains?: string[];
            originMasks?: string[];
            surface?: string;
        };
        endpointUrl?: string;
        userId?: string;
        userKey?: string;
        bridgeMasterKey?: string;
        bridgeSigningPrivateKeyPem?: string;
        bridgePeerPublicKeyPem?: string;
        deviceId?: string;
        clientId?: string;
        namespace?: string;
        reconnectMs?: number;
    };
    topology?: {
        enabled?: boolean;
        nodes?: Array<Record<string, any>>;
        links?: Array<Record<string, any>>;
    };
    endpointIDs?: Record<string, Record<string, any>>;
}

export interface AiSettings {
    customInstructions?: CustomInstruction[];
    activeInstructionId?: string;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    customModel?: string;
    mcp?: Array<{
        id?: string;
        serverLabel?: string;
        origin?: string;
    }>;
}

export interface WebdavSettings {
    url?: string;
    username?: string;
    password?: string;
    token?: string;
}

export interface TimelineSettings {
    enabled?: boolean;
}

export interface AppearanceSettings {
    theme?: string;
    language?: string;
}

export interface SpeechSettings {
    voice?: string;
}

export interface GridSettings {
    columns?: number;
    rows?: number;
}

export interface Settings {
    core: CoreSettings;
    ai: AiSettings;
    webdav: WebdavSettings;
    timeline: TimelineSettings;
    appearance: AppearanceSettings;
    speech: SpeechSettings;
    grid: GridSettings;
}

export interface AppSettings extends Omit<Settings, "core"> {}

export type SettingsStore = {
    readCoreSettings: () => Promise<Settings>;
    writeCoreSettings: (patch: Partial<Settings>) => Promise<Settings>;
};

export const makeSettingsMerger = (defaults: Settings) => {
    return (current: Settings, patch: Partial<Settings>): Settings => ({
        core: {
            ...(defaults.core || {}),
            ...(current.core || {}),
            ...(patch.core || {})
        },
        ai: {
            ...(defaults.ai || {}),
            ...(current.ai || {}),
            ...(patch.ai || {})
        },
        webdav: {
            ...(defaults.webdav || {}),
            ...(current.webdav || {}),
            ...(patch.webdav || {})
        },
        timeline: {
            ...(defaults.timeline || {}),
            ...(current.timeline || {}),
            ...(patch.timeline || {})
        },
        appearance: {
            ...(defaults.appearance || {}),
            ...(current.appearance || {}),
            ...(patch.appearance || {})
        },
        speech: {
            ...(defaults.speech || {}),
            ...(current.speech || {}),
            ...(patch.speech || {})
        },
        grid: {
            ...(defaults.grid || {}),
            ...(current.grid || {}),
            ...(patch.grid || {})
        }
    });
};

export const mergeSettings = (defaults: Settings, current: Partial<Settings> = {}, patch: Partial<Settings> = {}): Settings => {
    const merge = makeSettingsMerger(defaults);
    return merge({
        ...(defaults as Settings),
        ...(current as Partial<Settings> || {})
    } as Settings, patch);
};

const loadJson = async <T>(filePath: string, fallback: T): Promise<T> => {
    try {
        const raw = await readFile(filePath, "utf-8");
        return safeJsonParse<T>(raw, fallback);
    } catch {
        return fallback;
    }
};

export const createSettingsStore = (
    filePath = SETTINGS_FILE,
    fallback: Settings
): SettingsStore => {
    return {
        readCoreSettings: async () => {
            const parsed = await loadJson<Settings>(filePath, fallback);
            return mergeSettings(fallback, parsed || {}, {});
        },
        writeCoreSettings: async (patch: Partial<Settings>): Promise<Settings> => {
            await ensureDataDirs();
            const current = await loadJson<Settings>(filePath, fallback);
            const next = mergeSettings(fallback, current || fallback, patch);
            await writeFile(filePath, JSON.stringify(next, null, 2), "utf-8");
            return next;
        }
    };
};

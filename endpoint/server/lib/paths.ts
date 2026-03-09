import path from "node:path";
import { mkdir } from "node:fs/promises";

import { moduleDirname } from "./runtime.ts";
import { pickEnvStringLegacy } from "./env.ts";

const ROOT = moduleDirname(import.meta);

const getCliArg = (flag: string): string | undefined => {
    const args = typeof process !== "undefined" && Array.isArray(process.argv) ? process.argv : [];
    for (let idx = args.length - 1; idx >= 0; idx--) {
        const current = args[idx];
        if (current === flag && args.length > idx + 1 && !args[idx + 1].startsWith("--")) {
            return args[idx + 1];
        }
        if (current.startsWith(`${flag}=`)) {
            return current.slice(flag.length + 1);
        }
    }
    return undefined;
};

const dataArg = getCliArg("--data");
const configArg = getCliArg("--config");

const explicitDataDir = dataArg || pickEnvStringLegacy("CWS_PORTABLE_DATA_PATH") || pickEnvStringLegacy("CWS_DATA_DIR");
const explicitConfigFile = configArg || pickEnvStringLegacy("CWS_PORTABLE_CONFIG_PATH") || pickEnvStringLegacy("ENDPOINT_CONFIG_JSON_PATH") || pickEnvStringLegacy("PORTABLE_CONFIG_PATH");
const explicitConfigDir = pickEnvStringLegacy("CWS_CONFIG_DIR");

export const DATA_DIR = explicitDataDir 
    ? path.resolve(explicitDataDir) 
    : path.resolve(ROOT, "../../.data");

export const CONFIG_DIR = explicitConfigDir 
    ? path.resolve(explicitConfigDir) 
    : explicitConfigFile 
        ? path.dirname(path.resolve(explicitConfigFile)) 
        : path.resolve(ROOT, "../../config");

export const SETTINGS_FILE = path.join(DATA_DIR, "core-settings.json");
export const USERS_FILE = path.join(DATA_DIR, "users.json");
export const USER_STORAGE_DIR = path.join(DATA_DIR, "users");
export const ADMIN_PREFS_FILE = path.join(CONFIG_DIR, "admin-prefs.json");
export const ADMIN_DIR = path.resolve(ROOT, "../admin");

export const ensureDataDirs = async () => {
    await mkdir(DATA_DIR, { recursive: true });
    await mkdir(CONFIG_DIR, { recursive: true });
    await mkdir(USER_STORAGE_DIR, { recursive: true });
};

export const safeJoin = (base: string, target: string) => {
    const normalized = path.normalize(target).replace(/^(\.\.(\/|\\|$))+/g, "");
    return path.join(base, normalized);
};

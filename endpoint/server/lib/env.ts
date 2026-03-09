type RawEnvValue = string | number | boolean | undefined;

const normalizeEnvValue = (raw: RawEnvValue, allowEmpty: boolean): string | undefined => {
    if (raw === undefined) return undefined;
    if (typeof raw === "string") {
        const normalized = raw.trim();
        if (!allowEmpty && normalized.length === 0) return undefined;
        return normalized;
    }
    if (typeof raw === "boolean" || typeof raw === "number") {
        const normalized = String(raw).trim();
        if (!allowEmpty && normalized.length === 0) return undefined;
        return normalized;
    }
    return undefined;
};

export const pickFirstEnv = (candidates: string[], options: { allowEmpty?: boolean } = {}): string | undefined => {
    const allowEmpty = options.allowEmpty === true;
    for (const key of candidates) {
        const raw = process.env[key] as unknown as RawEnvValue;
        const normalized = normalizeEnvValue(raw, allowEmpty);
        if (normalized === undefined) continue;
        return normalized;
    }
    return undefined;
};

const toBoolean = (value: string): boolean | undefined => {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
    return undefined;
};

export const pickEnvBool = (keys: string[], defaultValue?: boolean): boolean | undefined => {
    const value = pickFirstEnv(keys);
    if (value === undefined) return defaultValue;
    const parsed = toBoolean(value);
    return parsed === undefined ? defaultValue : parsed;
};

export const pickEnvNumber = (keys: string[], defaultValue?: number): number | undefined => {
    const value = pickFirstEnv(keys);
    if (value === undefined) return defaultValue;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : defaultValue;
};

export const pickEnvList = (keys: string[], separatorPattern = /[;,]/): string[] | undefined => {
    const value = pickFirstEnv(keys, { allowEmpty: true });
    if (value === undefined) return undefined;
    const list = value
        .split(separatorPattern)
        .map((item) => item.trim())
        .filter(Boolean);
    return list.length ? list : undefined;
};

export const pickEnvString = (keys: string[], options: { allowEmpty?: boolean } = {}): string | undefined => {
    const value = pickFirstEnv(keys, options);
    if (value === undefined) return undefined;
    return options.allowEmpty ? value : value.trim();
};

const expandLegacyNames = (name: string): string[] => {
    const candidates = [name];
    if (!name.startsWith("CWS_")) return candidates;

    const stripped = name.slice(4);
    const legacyAirPadPrefixed = `AIRPAD_${stripped}`;
    if (legacyAirPadPrefixed !== name) candidates.push(legacyAirPadPrefixed);
    if (stripped && stripped !== legacyAirPadPrefixed) candidates.push(stripped);

    return Array.from(new Set(candidates));
};

export const pickEnvBoolLegacy = (name: string, defaultValue?: boolean): boolean | undefined => {
    return pickEnvBool(expandLegacyNames(name), defaultValue);
};

export const pickEnvNumberLegacy = (name: string, defaultValue?: number): number | undefined => {
    return pickEnvNumber(expandLegacyNames(name), defaultValue);
};

export const pickEnvStringLegacy = (name: string, options: { allowEmpty?: boolean } = {}): string | undefined => {
    return pickEnvString(expandLegacyNames(name), options);
};

export const pickEnvListLegacy = (name: string, separatorPattern = /[;,]/): string[] | undefined => {
    return pickEnvList(expandLegacyNames(name), separatorPattern);
};

export const pickEnvEntriesByPrefix = (namePrefix: string): Record<string, string> => {
    const prefixes = expandLegacyNames(namePrefix);
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(process.env)) {
        if (typeof value !== "string") continue;
        let matchedPrefix: string | undefined;
        for (const prefix of prefixes) {
            if (key.startsWith(prefix)) {
                matchedPrefix = prefix;
                break;
            }
        }
        if (!matchedPrefix) continue;
        const tail = key.slice(matchedPrefix.length);
        if (!tail) continue;
        if (result[tail] === undefined) {
            result[tail] = value;
        }
    }

    return result;
};

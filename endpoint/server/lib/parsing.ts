import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export type PortableTextValue = string;

const trimOptional = (value: string): string => (value == null ? "" : String(value).trim());

export const parsePortableBoolean = (value: unknown): boolean | undefined => {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") {
        if (value === 1) return true;
        if (value === 0) return false;
        return undefined;
    }
    if (typeof value !== "string") return undefined;
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
    return undefined;
};

export const parsePortableBooleanLoose = (value: unknown): boolean | undefined => {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") {
        if (value === 1) return true;
        if (value === 0) return false;
        return true;
    }
    if (typeof value !== "string") return undefined;
    const normalized = value.trim().toLowerCase();
    if (!normalized) return undefined;
    if (["0", "false", "off", "no", "disabled"].includes(normalized)) return false;
    if (["1", "true", "on", "yes", "enabled"].includes(normalized)) return true;
    return true;
};

export const safeParseBoolean = (value: unknown, fallback: boolean = false): boolean => {
    const parsed = parsePortableBoolean(value);
    return parsed === undefined ? fallback : parsed;
};

export const parsePortableNumber = (value: unknown): number | undefined => {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value !== "string") return undefined;
    const normalized = value.trim();
    if (!normalized) return undefined;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
};

export const parsePortableInteger = (value: unknown): number | undefined => {
    const parsed = parsePortableNumber(value);
    if (parsed === undefined) return undefined;
    return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
};

export const safeJsonParse = <T = unknown>(value: string | null | undefined, fallback: T | undefined = undefined): T | undefined => {
    if (typeof value !== "string") return fallback;
    try {
        return JSON.parse(value) as T;
    } catch {
        return fallback;
    }
};

export const readTextFile = (filePath: string): string | undefined => {
    try {
        return fs.readFileSync(filePath, "utf-8");
    } catch {
        return undefined;
    }
};

export const unquotePortableValue = (value: string): string => {
    const trimmed = value.trim();
    if (trimmed.length < 2) return trimmed;
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first !== "'" && first !== '"') || last !== first) return trimmed;
    const body = trimmed.slice(1, -1);
    if (first === "'") return body.replace(/\\\\/g, "\\").replace(/\\'/g, "'");
    return body.replace(/\\\\/g, "\\").replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t");
};

const decodeDataValue = (value: string): string => {
    const trimmed = trimOptional(value);
    if (!trimmed) return "";
    const commaIndex = trimmed.indexOf(",");
    if (commaIndex < 0) return trimmed;
    const meta = trimmed.slice(0, commaIndex).toLowerCase();
    const rawPayload = trimmed.slice(commaIndex + 1);
    try {
        if (!meta.includes(";base64")) return decodeURIComponent(rawPayload);
        const decoded = decodeURIComponent(rawPayload);
        return Buffer.from(decoded, "base64").toString("utf8");
    } catch {
        if (meta.includes(";base64")) {
            return Buffer.from(rawPayload.replace(/\s/g, ""), "base64").toString("utf8");
        }
        return rawPayload;
    }
};

const resolveUserPath = (value: string): string => {
    const trimmed = trimOptional(value);
    if (!trimmed) return "";
    if (trimmed === "~" || /^~[\\/]/.test(trimmed)) {
        const home = os.homedir();
        if (!home) return trimmed;
        const suffix = trimmed.slice(1).replace(/^[/\\]+/, "");
        return suffix ? path.join(home, suffix) : home;
    }
    return trimmed;
};

const isAbsolutePathLike = (value: string): boolean => {
    if (path.isAbsolute(value)) return true;
    if (/^[a-zA-Z]:[\\/]/.test(value)) return true;
    return /^\\\\/.test(value);
};

const resolvePortablePathReference = (rawPath: string, baseDir = process.cwd()): string => {
    const expanded = resolveUserPath(rawPath);
    if (!expanded) return "";
    if (isAbsolutePathLike(expanded)) return expanded;
    const fromModule = path.resolve(baseDir, expanded);
    if (readTextFile(fromModule) !== undefined) return fromModule;
    const fromCwd = path.resolve(process.cwd(), expanded);
    if (readTextFile(fromCwd) !== undefined) return fromCwd;
    return fromModule;
};

const resolvePortablePrefixValue = (value: PortableTextValue): string => {
    const envExpanded = value.replace(/\$\{env:([^}]+)\}/g, (_, envName) => process.env[envName.trim()] ?? "");
    const trimmed = envExpanded.trim();
    if (!trimmed) return "";
    const sep = trimmed.indexOf(":");
    if (sep <= 0) return trimmed;
    const prefix = trimmed.slice(0, sep).toLowerCase();
    const payload = unquotePortableValue(trimmed.slice(sep + 1));
    if (prefix === "env") return process.env[payload] ?? "";
    if (prefix === "inline") return payload;
    if (prefix === "data") return decodeDataValue(payload);
    return trimmed;
};

export const resolvePortableTextValuePath = (raw: PortableTextValue, baseDir = process.cwd()): string => {
    const envExpanded = raw.replace(/\$\{env:([^}]+)\}/g, (_, envName) => process.env[envName.trim()] ?? "");
    const trimmed = envExpanded.trim();
    if (!trimmed) return "";

    const sep = trimmed.indexOf(":");
    if (sep <= 0) return trimmed;

    const prefix = trimmed.slice(0, sep).toLowerCase();
    const payload = unquotePortableValue(trimmed.slice(sep + 1));

    if (prefix === "env") return process.env[payload] ?? "";
    if (prefix === "inline") return payload;
    if (prefix === "data") return decodeDataValue(payload);
    if (prefix === "fs" || prefix === "file") {
        if (!payload) return "";
        const resolvedPayload = resolvePortablePathReference(resolvePortablePrefixValue(payload), baseDir);
        return resolvedPayload;
    }

    return trimmed;
};

export const resolvePortableTextValue = (raw: PortableTextValue, baseDir = process.cwd()): string => {
    const envExpanded = raw.replace(/\$\{env:([^}]+)\}/g, (_, envName) => process.env[envName.trim()] ?? "");
    const trimmed = envExpanded.trim();
    if (!trimmed) return "";

    const sep = trimmed.indexOf(":");
    if (sep <= 0) return trimmed;

    const prefix = trimmed.slice(0, sep).toLowerCase();
    const payload = unquotePortableValue(trimmed.slice(sep + 1));

    if (prefix === "env") return process.env[payload] ?? "";
    if (prefix === "inline") return payload;
    if (prefix === "data") return decodeDataValue(payload);
    if (prefix === "fs" || prefix === "file") {
        const filePath = resolvePortableTextValuePath(raw, baseDir);
        if (!filePath) return "";
        const fileContent = readTextFile(filePath);
        if (fileContent !== undefined) return fileContent;
        return "";
    }

    return trimmed;
};

export const resolvePortablePayload = (value: unknown, baseDir: string, seen: Set<string> = new Set()): unknown => {
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return "";

        const sep = trimmed.indexOf(":");
        if (sep <= 0) return resolvePortableTextValue(trimmed);

        const prefix = trimmed.slice(0, sep).toLowerCase();
        const payload = unquotePortableValue(trimmed.slice(sep + 1));
        if (prefix === "fs" || prefix === "file") {
            if (!payload) return "";
            const resolvedPathValue = resolvePortableTextValuePath(payload, baseDir);
            if (!resolvedPathValue) return {};
            const resolvedPath = resolvePortablePathReference(resolvedPathValue, baseDir);
            if (seen.has(resolvedPath)) return {};
            const rawPayload = readTextFile(resolvedPath);
            if (!rawPayload) return {};
            const normalizedPayload = rawPayload.trim();
            if (!normalizedPayload) return "";
            const parsed = safeJsonParse<unknown>(normalizedPayload);
            if (typeof parsed === "object" && parsed !== null) {
                if (seen.has(resolvedPath)) return {};
                seen.add(resolvedPath);
                return resolvePortablePayload(parsed, path.dirname(resolvedPath), seen);
            }
            return parsed === undefined ? normalizedPayload : parsed;
        }

        return resolvePortableTextValue(trimmed);
    }

    if (Array.isArray(value)) {
        return value.map((entry) => resolvePortablePayload(entry, baseDir, seen));
    }

    if (!value || typeof value !== "object") return value;

    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(source)) {
        out[key] = resolvePortablePayload(entry, baseDir, seen);
    }
    return out;
};

export const resolveMaybeTextBoolean = (value: string | undefined): boolean | undefined => {
    if (typeof value === "undefined") return undefined;
    return parsePortableBoolean(resolvePortableTextValue(value));
};

import { readFile } from "node:fs/promises";
import path from "node:path";

import { parsePortableBoolean, resolveMaybeTextBoolean, resolvePortableTextValue } from "./parsing.ts";

const KEY_FILE_NAME = "multi.key";
const CRT_FILE_NAME = "multi.crt";

const unique = (items: string[]) => [...new Set(items.map((item) => path.resolve(item)))];

const isLikelyBase64 = (value: string): boolean => {
    const normalized = value.replace(/\s/g, "");
    if (!normalized) return false;
    if (!/^[A-Za-z0-9+/=]+$/.test(normalized)) return false;
    return normalized.length >= 12;
};

type Kind = "key" | "cert" | "ca" | "auto";

const inferPemKindTag = (kind: Kind): "CERTIFICATE" | "PRIVATE KEY" => {
    if (kind === "key") return "PRIVATE KEY";
    return "CERTIFICATE";
};

const wrapAsPem = (value: string, kind: Kind): string => {
    const trimmed = value.trim();
    if (!trimmed) return "";
    const beginTag = `-----BEGIN ${inferPemKindTag(kind)}-----`;
    const endTag = `-----END ${inferPemKindTag(kind)}-----`;
    const compact = trimmed.replace(/\s+/g, "");
    if (!compact) return "";
    if (trimmed.includes("-----BEGIN ")) return trimmed;
    const normalizedBody = trimmed.replace(/[ \t]+/g, "");
    const body = normalizedBody.replace(/(.{64})(?!$)/g, "$1\n");
    return `${beginTag}\n${body}\n${endTag}`;
};

const normalizePemMaterial = (value: string, kind: Kind): string => {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (trimmed.includes("-----BEGIN ") && trimmed.includes("-----END ")) return trimmed;
    if (isLikelyBase64(trimmed)) {
        const decoded = Buffer.from(trimmed.replace(/\s/g, ""), "base64").toString("utf8");
        if (decoded.includes("-----BEGIN ")) return decoded.trim();
    }
    return wrapAsPem(trimmed, kind);
};

const readCertificateMaterial = async (candidate: string | undefined, kind: Kind = "auto"): Promise<string | Buffer | undefined> => {
    if (typeof candidate !== "string") return undefined;
    const trimmed = candidate.trim();
    if (!trimmed) return undefined;
    if (trimmed.includes("\n") || trimmed.startsWith("-----BEGIN ")) return normalizePemMaterial(trimmed, kind);
    try {
        const fileMaterial = await readFile(trimmed);
        if (!fileMaterial.length) return undefined;
        return normalizePemMaterial(fileMaterial.toString("utf8"), kind);
    } catch {
        const normalized = normalizePemMaterial(trimmed, kind);
        return normalized.includes("-----BEGIN ") ? normalized : undefined;
    }
};

export const buildHttpsCandidateFiles = (moduleDir: string, cwd = process.cwd()) => {
    const configDir = path.resolve(cwd, "config");
    return {
        keys: unique([path.resolve(cwd, "./https/local/" + KEY_FILE_NAME), path.resolve(cwd, "./" + KEY_FILE_NAME), path.resolve(configDir, "./https/local/" + KEY_FILE_NAME), path.resolve(configDir, "./" + KEY_FILE_NAME), path.resolve(moduleDir, "./https/local/" + KEY_FILE_NAME), path.resolve(moduleDir, "../https/local/" + KEY_FILE_NAME), path.resolve(moduleDir, "../" + KEY_FILE_NAME), path.resolve(moduleDir, "../../https/local/" + KEY_FILE_NAME), path.resolve(moduleDir, "../../" + KEY_FILE_NAME), path.resolve(moduleDir, "../../../" + KEY_FILE_NAME)]),
        certs: unique([path.resolve(cwd, "./https/local/" + CRT_FILE_NAME), path.resolve(cwd, "./" + CRT_FILE_NAME), path.resolve(configDir, "./https/local/" + CRT_FILE_NAME), path.resolve(configDir, "./" + CRT_FILE_NAME), path.resolve(moduleDir, "./https/local/" + CRT_FILE_NAME), path.resolve(moduleDir, "../https/local/" + CRT_FILE_NAME), path.resolve(moduleDir, "../" + CRT_FILE_NAME), path.resolve(moduleDir, "../../https/local/" + CRT_FILE_NAME), path.resolve(moduleDir, "../../" + CRT_FILE_NAME), path.resolve(moduleDir, "../../../" + CRT_FILE_NAME)])
    };
};

export const resolveHttpsPaths = (moduleDir: string, cwd = process.cwd()) => {
    const candidates = buildHttpsCandidateFiles(moduleDir, cwd);
    return {
        key: candidates.keys[0] || path.resolve(moduleDir, "./https/local/" + KEY_FILE_NAME),
        cert: candidates.certs[0] || path.resolve(moduleDir, "./https/local/" + CRT_FILE_NAME),
        candidates
    };
};

const resolveHttpsConfigValue = (source: Record<string, any>, sourceKeys: string[], envCandidates: string[], fallback?: string, baseDir = process.cwd()) => {
    for (const name of envCandidates) {
        const value = process.env[name];
        if (typeof value === "string" && value.trim()) return resolvePortableTextValue(value, baseDir);
    }
    for (const key of sourceKeys) {
        const value = source[key];
        if (typeof value === "string" && value.trim()) return resolvePortableTextValue(String(value), baseDir);
    }
    return fallback;
};

export const loadHttpsOptions = async (params: { httpsConfig: Record<string, any>; moduleDir: string; cwd?: string }) => {
    const { httpsConfig, moduleDir, cwd = process.cwd() } = params;
    const envEnabled = process.env.CWS_HTTPS_ENABLED ?? process.env.HTTPS_ENABLED;
    if (typeof envEnabled === "string" && resolveMaybeTextBoolean(envEnabled) === false) return undefined;
    if (httpsConfig.enabled === false) return undefined;

    const defaultHttpsPaths = resolveHttpsPaths(moduleDir, cwd);
    const { key: keyPath, cert: certPath, candidates } = defaultHttpsPaths;
    const keySource = resolveHttpsConfigValue(
        httpsConfig,
        ["key", "keyFile", "keyPath"],
        ["CWS_HTTPS_KEY", "CWS_HTTPS_KEY_FILE", "HTTPS_KEY", "HTTPS_KEY_FILE"],
        keyPath,
        moduleDir
    );
    const certSource = resolveHttpsConfigValue(
        httpsConfig,
        ["cert", "certFile", "certPath"],
        ["CWS_HTTPS_CERT", "CWS_HTTPS_CERT_FILE", "HTTPS_CERT", "HTTPS_CERT_FILE"],
        certPath,
        moduleDir
    );
    const caSource = resolveHttpsConfigValue(
        httpsConfig,
        ["ca", "caFile", "caPath"],
        ["CWS_HTTPS_CA", "CWS_HTTPS_CA_FILE", "HTTPS_CA", "HTTPS_CA_FILE"],
        undefined,
        moduleDir
    );

    const keyCandidates = [keySource, ...candidates.keys];
    const certCandidates = [certSource, ...candidates.certs];

    try {
        const keyFile = keyCandidates.find((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
        const certFile = certCandidates.find((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
        const caFile = caSource && typeof caSource === "string" && caSource.trim().length > 0 ? caSource : undefined;

        const [key, cert] = await Promise.all([readCertificateMaterial(keyFile, "key"), readCertificateMaterial(certFile, "cert")]);
        const ca = caFile ? await readCertificateMaterial(caFile, "ca") : undefined;

        if (!key || !cert) {
            throw new Error("[core-backend] HTTPS disabled: missing key or cert material");
        }

        const requestClientCerts = parsePortableBoolean(
            process.env.CWS_HTTPS_REQUEST_CLIENT_CERTS ??
            process.env.HTTPS_REQUEST_CLIENT_CERTS ??
            resolvePortableTextValue(String(httpsConfig.requestClientCerts ?? "false"), moduleDir)
        ) ?? false;

        const allowUntrustedClientCerts = parsePortableBoolean(
            process.env.CWS_HTTPS_ALLOW_UNTRUSTED_CLIENT_CERTS ??
            process.env.HTTPS_ALLOW_UNTRUSTED_CLIENT_CERTS ??
            resolvePortableTextValue(String(httpsConfig.allowUntrustedClientCerts ?? "false"), moduleDir)
        ) ?? false;

        return {
            key,
            cert,
            allowHTTP1: true,
            ...(ca ? { ca } : {}),
            ...(requestClientCerts ? (allowUntrustedClientCerts ? { requestCert: true, rejectUnauthorized: false } : { requestCert: true }) : {})
        };
    } catch (error) {
        const details = String((error as any)?.message || error || "unknown");
        console.warn(`[core-backend] HTTPS disabled: failed to load certificate files ` + `key=${keyCandidates[0] || keyPath}, cert=${certCandidates[0] || certPath}. ${details}`);
        return undefined;
    }
};

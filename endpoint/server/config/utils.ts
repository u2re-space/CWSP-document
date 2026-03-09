import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parsePortableBoolean, parsePortableInteger, safeJsonParse, resolvePortablePayload, resolvePortableTextValue } from "../lib/parsing.ts";
import { pickEnvBoolLegacy, pickEnvNumberLegacy, pickEnvStringLegacy } from "../lib/env.ts";
import { SETTINGS_FILE, CONFIG_DIR } from "../lib/paths.ts";
import type { EndpointConfig, EndpointIdPolicy, PortableConfigSeed } from "./schema.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const toStringArray = (value: unknown): string[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    const list = value.map((item) => String(item ?? "").trim()).filter(Boolean);
    return list.length ? list : undefined;
};

type ConfigFileLoadInfo = {
    source: string;
    exists: boolean;
    usedAs: "portable-config" | "clients" | "gateways" | "legacy-clients" | "legacy-gateways";
    loaded: boolean;
    entries: number;
    ids?: string[];
    reason?: string;
};

type ConfigEndpointIdEntry = {
    source: string;
    paperId: string;
    actualId: string;
    paperOrigins: string[];
    paperTokens: string[];
};

type ConfigLoadReport = {
    portableCandidatesChecked: string[];
    selectedPortableConfig?: string;
    portableModules: string[];
    portableImplicitClients?: ConfigFileLoadInfo;
    portableImplicitGateways?: ConfigFileLoadInfo;
    configSourcesChecked?: string[];
    selectedEndpointConfig?: string;
    legacyClientsSources: string[];
    legacyGatewaysSources: string[];
    legacyClientsMergedEntries: number;
    legacyGatewaysMergedEntries: number;
    endpointIdDefinitions: ConfigEndpointIdEntry[];
};

const initialReport: ConfigLoadReport = {
    portableCandidatesChecked: [],
    portableModules: [],
    legacyClientsSources: [],
    legacyGatewaysSources: [],
    legacyClientsMergedEntries: 0,
    legacyGatewaysMergedEntries: 0,
    endpointIdDefinitions: []
};

const configLoadReport = {
    ...initialReport,
    reset: () => {
        configLoadReport.portableCandidatesChecked = [];
        configLoadReport.portableModules = [];
        configLoadReport.legacyClientsSources = [];
        configLoadReport.legacyGatewaysSources = [];
        configLoadReport.legacyClientsMergedEntries = 0;
        configLoadReport.legacyGatewaysMergedEntries = 0;
        configLoadReport.selectedPortableConfig = undefined;
        configLoadReport.portableImplicitClients = undefined;
        configLoadReport.portableImplicitGateways = undefined;
        configLoadReport.configSourcesChecked = [];
        configLoadReport.selectedEndpointConfig = undefined;
        configLoadReport.endpointIdDefinitions = [];
    },
    collect: (): ConfigLoadReport => {
        return {
            portableCandidatesChecked: [...configLoadReport.portableCandidatesChecked],
            portableModules: [...configLoadReport.portableModules],
            legacyClientsSources: [...configLoadReport.legacyClientsSources],
            legacyGatewaysSources: [...configLoadReport.legacyGatewaysSources],
            legacyClientsMergedEntries: configLoadReport.legacyClientsMergedEntries,
            legacyGatewaysMergedEntries: configLoadReport.legacyGatewaysMergedEntries,
            selectedPortableConfig: configLoadReport.selectedPortableConfig,
            portableImplicitClients: configLoadReport.portableImplicitClients ? { ...configLoadReport.portableImplicitClients } : undefined,
            portableImplicitGateways: configLoadReport.portableImplicitGateways ? { ...configLoadReport.portableImplicitGateways } : undefined,
            configSourcesChecked: configLoadReport.configSourcesChecked ? [...configLoadReport.configSourcesChecked] : undefined,
            selectedEndpointConfig: configLoadReport.selectedEndpointConfig,
            endpointIdDefinitions: configLoadReport.endpointIdDefinitions.map((entry) => ({ ...entry }))
        };
    }
};

const asLowerCaseId = (value: string): string => String(value || "").trim().toLowerCase();

const collectAsStringList = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => resolvePortableTextValue(String(entry || "")).trim())
        .filter(Boolean);
};

const collectEndpointIdEntries = (source: string, rawEndpointIds: unknown): ConfigEndpointIdEntry[] => {
    if (!rawEndpointIds || typeof rawEndpointIds !== "object" || Array.isArray(rawEndpointIds)) return [];
    const sourceObject = rawEndpointIds as Record<string, any>;
    const rows: ConfigEndpointIdEntry[] = [];
    for (const [paperIdRaw, policyRaw] of Object.entries(sourceObject)) {
        const paperId = String(paperIdRaw || "").trim();
        if (!paperId) continue;
        const policy = policyRaw && typeof policyRaw === "object" ? (policyRaw as Record<string, unknown>) : {};
        rows.push({
            source,
            paperId,
            actualId: asLowerCaseId(paperIdRaw),
            paperOrigins: collectAsStringList(policy.origins),
            paperTokens: collectAsStringList(policy.tokens)
        });
    }
    return rows;
};

const appendEndpointIdDefinitions = (source: string, rawEndpointIds: unknown): void => {
    if (!rawEndpointIds || typeof rawEndpointIds !== "object" || Array.isArray(rawEndpointIds)) return;
    const entries = collectEndpointIdEntries(source, rawEndpointIds);
    if (entries.length > 0) {
        configLoadReport.endpointIdDefinitions.push(...entries);
    }
};

const countPortableEntries = (payload: unknown): number => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return 0;
    return Object.keys(payload as Record<string, unknown>).length;
};

const payloadKeysPreview = (payload: unknown): string[] | undefined => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
    const keys = Object.keys(payload as Record<string, unknown>);
    return keys.length ? keys.sort().slice(0, 25) : undefined;
};

export const normalizeNumber = (value: unknown, fallback: number): number => {
    return parsePortableInteger(value) ?? fallback;
};

export const asRecord = (value: unknown): Record<string, any> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value as Record<string, any>;
};

export const readJson = (candidate: string): Record<string, any> | undefined => {
    try {
        const raw = fs.readFileSync(candidate, "utf-8");
        const parsed = safeJsonParse<Record<string, any>>(raw);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, any>) : {};
    } catch {
        return undefined;
    }
};

export const mergePortableConfigPayload = (base: Record<string, any>, patch?: Record<string, any>): Record<string, any> => {
    if (!patch) return { ...base };
    const result = { ...base };
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
            result[key] = [...value];
            continue;
        }
        if (value && typeof value === "object" && typeof base?.[key] === "object" && !Array.isArray(base[key])) {
            result[key] = mergePortableConfigPayload(base[key], value as Record<string, any>);
            continue;
        }
        result[key] = value;
    }
    return result;
};

export const collectPortableModules = (portableConfig: Record<string, any>, baseDir: string): string[] => {
    const out: string[] = [];
    const modulesValue = portableConfig.portableModules ?? portableConfig.configModules;
    const pushModule = (value: unknown) => {
        if (typeof value === "string" && value.trim()) {
            out.push(path.resolve(baseDir, value.trim()));
        }
        if (Array.isArray(value)) {
            for (const entry of value) {
                if (typeof entry === "string" && entry.trim()) {
                    out.push(path.resolve(baseDir, entry.trim()));
                }
            }
        }
    };

    if (Array.isArray(modulesValue)) {
        pushModule(modulesValue);
    } else if (typeof modulesValue === "string") {
        pushModule(modulesValue);
    } else if (modulesValue && typeof modulesValue === "object") {
        for (const rawPath of Object.values(modulesValue)) {
            pushModule(rawPath);
        }
    }

    const legacyModuleMap = asRecord(portableConfig.portableModulePaths);
    for (const rawPath of Object.values(legacyModuleMap)) {
        pushModule(rawPath);
    }

    const legacyFlatKeys = ["portableCorePath", "portableEndpointPath", "portableTopologyPath", "portableRuntimePath", "portableRolesPath", "portableBridgePath"];
    for (const key of legacyFlatKeys) pushModule(portableConfig[key]);

    return out;
};

export const loadPortableConfig = (): Record<string, any> => {
    const candidates = [pickEnvStringLegacy("CWS_PORTABLE_CONFIG_PATH"), pickEnvStringLegacy("ENDPOINT_CONFIG_JSON_PATH"), pickEnvStringLegacy("PORTABLE_CONFIG_PATH"), path.resolve(CONFIG_DIR, "portable.config.json"), path.resolve(process.cwd(), "portable.config.json"), path.resolve(__dirname, "../../portable.config.json"), path.resolve(__dirname, "../portable.config.json")].filter(Boolean);
    configLoadReport.portableCandidatesChecked = candidates;
    configLoadReport.portableModules = [];
    configLoadReport.portableImplicitClients = undefined;
    configLoadReport.portableImplicitGateways = undefined;
    configLoadReport.selectedPortableConfig = undefined;

    for (const candidate of candidates) {
        const selectedPortableConfig = path.resolve(candidate);
        const baseDir = path.dirname(candidate);
        const base = readJson(candidate);
        if (!base || Object.keys(base).length === 0) continue;
        configLoadReport.selectedPortableConfig = selectedPortableConfig;
        appendEndpointIdDefinitions(`portable:${selectedPortableConfig}`, base.endpointIDs || (base as Record<string, any>).endpointIDs || (base as Record<string, any>).clients || (base as Record<string, any>).gateways);
        configLoadReport.portableModules = collectPortableModules(base, baseDir);
        let merged = configLoadReport.portableModules.reduce((seed, modulePath) => {
            const modulePayload = readJson(modulePath);
            return modulePayload ? mergePortableConfigPayload(seed, modulePayload) : seed;
        }, base);

        // Also proactively check for clients.json / gateways.json as implicit modules in baseDir if they exist
        const defaultGatewaysPath = path.resolve(baseDir, "gateways.json");
        const defaultClientsPath = path.resolve(baseDir, "clients.json");
        
        if (fs.existsSync(defaultGatewaysPath)) {
            const gatewaysPayload = readJson(defaultGatewaysPath);
            configLoadReport.portableImplicitGateways = {
                source: defaultGatewaysPath,
                exists: true,
                loaded: Boolean(gatewaysPayload),
                usedAs: "gateways",
                entries: countPortableEntries(gatewaysPayload),
                ids: payloadKeysPreview(gatewaysPayload),
                reason: gatewaysPayload ? undefined : "empty_or_unparseable"
            };
            if (gatewaysPayload) {
                appendEndpointIdDefinitions(`portable:${defaultGatewaysPath}`, gatewaysPayload);
                merged = mergePortableConfigPayload(merged, { 
                    gateways: gatewaysPayload.gateways ?? gatewaysPayload.destinations ?? gatewaysPayload,
                    endpointIDs: gatewaysPayload.gateways ?? gatewaysPayload.destinations ?? gatewaysPayload
                });
            }
        } else {
            configLoadReport.portableImplicitGateways = {
                source: defaultGatewaysPath,
                exists: false,
                loaded: false,
                usedAs: "gateways",
                entries: 0,
                ids: [],
                reason: "not_found"
            }
        }
        
        if (fs.existsSync(defaultClientsPath)) {
            const clientsPayload = readJson(defaultClientsPath);
            configLoadReport.portableImplicitClients = {
                source: defaultClientsPath,
                exists: true,
                loaded: Boolean(clientsPayload),
                usedAs: "clients",
                entries: countPortableEntries(clientsPayload),
                ids: payloadKeysPreview(clientsPayload),
                reason: clientsPayload ? undefined : "empty_or_unparseable"
            };
            if (clientsPayload) {
                appendEndpointIdDefinitions(`portable:${defaultClientsPath}`, clientsPayload);
                merged = mergePortableConfigPayload(merged, {
                    clients: clientsPayload,
                    endpointIDs: clientsPayload
                });
            }
        } else {
            configLoadReport.portableImplicitClients = {
                source: defaultClientsPath,
                exists: false,
                loaded: false,
                usedAs: "clients",
                entries: 0,
                ids: [],
                reason: "not_found"
            }
        }

        return merged;
    }

    return {};
};

export const resolvePortablePayloadWithBase = (value: unknown, baseDir: string, seen: Set<string> = new Set()): unknown => {
    return resolvePortablePayload(value, baseDir, seen);
};

export const legacyPolicyForward = (value: unknown): string => {
    if (typeof value === "string") {
        const normalized = resolvePortableTextValue(value).trim();
        return normalized || "self";
    }
    if (Array.isArray(value)) {
        for (const entry of value) {
            if (typeof entry === "string") {
                const normalized = entry.trim();
                if (normalized) return normalized;
            }
            if (entry && typeof entry === "object") {
                const candidate = String((entry as Record<string, any>).id || (entry as Record<string, any>).target || "").trim();
                if (candidate) return candidate;
            }
        }
    }
    return "self";
};

export const parseLegacyAllowedForwardList = (value: unknown): string[] => {
    if (Array.isArray(value)) {
        return value.map((entry) => resolvePortableTextValue(String(entry || "")).trim()).filter(Boolean);
    }
    if (typeof value === "string") {
        return value
            .split(/[;,]/)
            .map((entry) => resolvePortableTextValue(entry).trim())
            .filter(Boolean);
    }
    return [];
};

const parseAliasPolicyTarget = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined;
    const candidate = resolvePortableTextValue(value).trim();
    if (!candidate) return undefined;
    const aliasPrefix = "alias:";
    if (candidate.toLowerCase().startsWith(aliasPrefix)) {
        const rest = candidate.slice(aliasPrefix.length).trim();
        return rest || undefined;
    }
    return candidate || undefined;
};

const cloneEndpointPolicyAsAlias = (alias: string, policy: EndpointIdPolicy): EndpointIdPolicy => ({
    ...policy,
    id: alias
});

export const normalizeLegacyEndpointIds = (value: unknown): Record<string, EndpointIdPolicy> => {
    const source = asRecord(value);
    const out: Record<string, EndpointIdPolicy> = {};
    const aliasToTarget = new Map<string, string>();

    for (const [rawPolicyId, rawPolicySource] of Object.entries(source)) {
        const policyId = String(rawPolicyId || "")
            .trim()
            .toLowerCase();
        if (!policyId) continue;

        if (!rawPolicySource) {
            continue;
        }

        if (typeof rawPolicySource === "string") {
            const aliasTarget = parseAliasPolicyTarget(rawPolicySource);
            if (aliasTarget) {
                aliasToTarget.set(policyId, aliasTarget.toLowerCase());
            }
            continue;
        }

        if (typeof rawPolicySource !== "object" || Array.isArray(rawPolicySource)) continue;
        const policy = rawPolicySource as Record<string, unknown>;
        const legacyOutgoing = parseLegacyAllowedForwardList(policy.allowedOutgoing);
        const legacyForwards = parseLegacyAllowedForwardList(policy.allowedForwards);
        const allowedOutgoing = legacyOutgoing.length ? legacyOutgoing : legacyForwards.length ? legacyForwards : ["*"];
        const allowedIncoming = parseLegacyAllowedForwardList(policy.allowedIncoming);
        out[policyId] = normalizeEndpointIdPolicy(policyId, {
            origins: policy.origins,
            tokens: policy.tokens,
            forward: legacyPolicyForward(policy.forward),
            flags: policy.flags,
            allowedIncoming: allowedIncoming.length ? allowedIncoming : ["*"],
            allowedOutcoming: allowedOutgoing
        });
    }

    const resolveAliasTarget = (aliasId: string, seen = new Set<string>()) => {
        if (seen.has(aliasId)) return undefined;
        seen.add(aliasId);

        const direct = aliasToTarget.get(aliasId);
        if (!direct) return undefined;

        const normalizedDirect = direct.trim();
        if (out[normalizedDirect]) return normalizedDirect;
        if (aliasToTarget.has(normalizedDirect)) return resolveAliasTarget(normalizedDirect, seen);
        return undefined;
    };

    for (const [aliasId] of Array.from(aliasToTarget.entries())) {
        const resolvedTarget = resolveAliasTarget(aliasId);
        if (!resolvedTarget) continue;
        const basePolicy = out[resolvedTarget];
        if (!basePolicy) continue;
        if (!out[aliasId]) {
            out[aliasId] = cloneEndpointPolicyAsAlias(aliasId, basePolicy);
            continue;
        }
        const aliasPolicy = out[aliasId];
        if (aliasPolicy.id !== aliasId || aliasPolicy !== basePolicy) {
            out[aliasId] = cloneEndpointPolicyAsAlias(aliasId, basePolicy);
        }
    }

    return out;
};

export const loadLegacyEndpointIds = (): Record<string, EndpointIdPolicy> => {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const cwd = process.cwd();
    const candidates = [
        pickEnvStringLegacy("CWS_CLIENTS_JSON_PATH"),
        pickEnvStringLegacy("ENDPOINT_CLIENTS_JSON_PATH"),
        pickEnvStringLegacy("CLIENTS_JSON_PATH"),
        pickEnvStringLegacy("CWS_GATEWAYS_JSON_PATH"),
        pickEnvStringLegacy("ENDPOINT_GATEWAYS_JSON_PATH"),
        pickEnvStringLegacy("GATEWAYS_JSON_PATH"),
        path.resolve(CONFIG_DIR, "clients.json"),
        path.resolve(CONFIG_DIR, "gateways.json"),
        path.resolve(cwd, "./config/clients.json"),
        path.resolve(cwd, "./config/gateways.json"),
        path.resolve(moduleDir, "../config/clients.json"),
        path.resolve(moduleDir, "../config/gateways.json"),
        path.resolve(moduleDir, "../../config/clients.json"),
        path.resolve(moduleDir, "../../config/gateways.json")
    ].filter(Boolean) as string[];

    const merged: Record<string, EndpointIdPolicy> = {};
    configLoadReport.legacyClientsSources = [];
    configLoadReport.legacyGatewaysSources = [];
    configLoadReport.legacyClientsMergedEntries = 0;
    configLoadReport.legacyGatewaysMergedEntries = 0;

    for (const candidate of candidates) {
        const parsed = readJson(candidate);
        if (!parsed) continue;
        const normalized = normalizeLegacyEndpointIds(parsed);
        appendEndpointIdDefinitions(`legacy:${candidate}`, parsed);
        Object.assign(merged, normalized);
        const normalizedCount = Object.keys(merged).length;
        const normalizedCandidate = candidate.toLowerCase();
        if (normalizedCandidate.includes("clients")) {
            if (!configLoadReport.legacyClientsSources.includes(candidate)) {
                configLoadReport.legacyClientsSources.push(candidate);
            }
            configLoadReport.legacyClientsMergedEntries = normalizedCount;
        }
        if (normalizedCandidate.includes("gateway")) {
            if (!configLoadReport.legacyGatewaysSources.includes(candidate)) {
                configLoadReport.legacyGatewaysSources.push(candidate);
            }
            configLoadReport.legacyGatewaysMergedEntries = normalizedCount;
        }
    }
    return merged;
};

const collectPortableConfigSources = (): string[] => {
    const args = typeof process !== "undefined" && Array.isArray(process.argv) ? process.argv : [];
    let configArg: string | undefined;
    for (let idx = args.length - 1; idx >= 0; idx--) {
        const arg = args[idx];
        if (arg === "--config" && args.length > idx + 1 && !args[idx + 1].startsWith("--")) {
            configArg = args[idx + 1];
            break;
        }
        if (arg.startsWith("--config=")) {
            configArg = arg.slice("--config=".length);
            break;
        }
    }

    const explicit = configArg || pickEnvStringLegacy("CWS_PORTABLE_CONFIG_PATH") || pickEnvStringLegacy("ENDPOINT_CONFIG_JSON_PATH") || pickEnvStringLegacy("PORTABLE_CONFIG_PATH");
    const cwd = process.cwd();
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));

    return [
        explicit,
        path.resolve(CONFIG_DIR, "portable.config.json"),
        path.resolve(cwd, "portable.config.json"),
        path.resolve(moduleDir, "../../portable.config.json"),
        path.resolve(moduleDir, "../portable.config.json")
    ].filter(Boolean) as string[];
};

export const loadPortableEndpointSeed = (): PortableConfigSeed => {
    for (const candidate of collectPortableConfigSources()) {
        const base = readJson(candidate);
        if (!base) continue;
        const merged = collectPortableModules(resolvePortablePayloadWithBase(base, path.dirname(candidate)) as Record<string, any>, path.dirname(candidate)).reduce(
            (seed, modulePath) => {
                const modulePayload = readJson(modulePath);
                const resolvedPayload = modulePayload ? resolvePortablePayloadWithBase(modulePayload, path.dirname(modulePath)) : undefined;
                return resolvedPayload ? mergePortableConfigPayload(seed, resolvedPayload as Record<string, any>) : seed;
            },
            resolvePortablePayloadWithBase(base, path.dirname(candidate)) as Record<string, any>
        ) as Record<string, any>;
        const normalized = resolvePortablePayloadWithBase(merged, path.dirname(candidate)) as Record<string, any>;
        if (!normalized || !Object.keys(normalized).length) continue;
        const normalizedCore = asRecord(normalized.core);
        const normalizedNetwork = asRecord(normalized.network || normalizedCore.network);
        const endpointIDsFromCore = {
            ...asRecord(normalizedCore.endpointIDs),
            ...asRecord(normalizedCore.gateways),
            ...asRecord(normalized.endpointIDs)
        };
        return {
            endpoint: asRecord(normalized.endpoint),
            core: asRecord(normalized.core),
            network: normalizedNetwork,
            runtime: asRecord(normalized.runtime || normalized.endpointRuntimeDefaults || {}),
            endpointDefaults: asRecord(normalized.endpointDefaults),
            endpointRuntimeDefaults: asRecord(normalized.endpointRuntimeDefaults),
            endpointTopology: normalized.endpointTopology,
            networkAliases: normalized.networkAliases,
            networkAliasMap: normalized.networkAliasMap,
            topology: normalized.topology,
            bridge: normalized.bridge,
            roles: normalized.roles,
            peers: normalized.peers,
            broadcastTargets: normalized.broadcastTargets,
            clipboardPeerTargets: normalized.clipboardPeerTargets,
            listenPort: normalized.listenPort,
            httpPort: normalized.httpPort,
            broadcastForceHttps: normalized.broadcastForceHttps,
            pollInterval: normalized.pollInterval,
            httpTimeoutMs: normalized.httpTimeoutMs,
            secret: normalized.secret,
            endpointIDs: endpointIDsFromCore
        } as PortableConfigSeed;
    }
    return {};
};

export const getConfigSources = (): string[] => {
    const explicit = pickEnvStringLegacy("CWS_CONFIG_JSON_PATH") || pickEnvStringLegacy("ENDPOINT_CONFIG_JSON_PATH");
    const cwd = process.cwd();
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const npmPackageJson = pickEnvStringLegacy("npm_package_json");
    const npmPackageRoot = npmPackageJson ? path.dirname(npmPackageJson) : undefined;

    return [
        explicit,
        path.resolve(CONFIG_DIR, "config.json"),
        path.resolve(CONFIG_DIR, "portable.config.json"),
        path.resolve(cwd, ".endpoint.config.json"),
        path.resolve(cwd, ".config.endpoint.json"),
        path.resolve(cwd, "data", "config.json"),
        path.resolve(cwd, ".data", "config.json"),
        path.resolve(moduleDir, "admin-config.json"),
        npmPackageRoot ? path.resolve(npmPackageRoot, "data", "config.json") : undefined,
        npmPackageRoot ? path.resolve(npmPackageRoot, ".data", "config.json") : undefined,
        path.resolve(SETTINGS_FILE),
        path.resolve(moduleDir, "./runtime.json"),
        path.resolve(moduleDir, "../.endpoint.config.json"),
        path.resolve(moduleDir, "../..", ".endpoint.config.json"),
        path.resolve(moduleDir, "../../.endpoint.config.json"),
        path.resolve(moduleDir, "../../../.endpoint.config.json")
    ].filter(Boolean) as string[];
};

export const loadJsonFile = (filePath: string): Record<string, any> | undefined => {
    try {
        const raw = fs.readFileSync(filePath, "utf-8");
        return safeJsonParse<Record<string, any>>(raw);
    } catch {
        return undefined;
    }
};

export const normalizeTopologyCollection = (value: unknown): unknown[] => {
    if (!Array.isArray(value)) return [];
    return value.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry));
};

export const normalizeTopologyConfig = (
    raw: unknown
): {
    enabled: boolean;
    nodes: Array<Record<string, any>>;
    links: Array<Record<string, any>>;
} => {
    const topology = (raw && typeof raw === "object" ? (raw as Record<string, any>) : {}) as Record<string, any>;
    const enabledRaw = topology.enabled;
    const enabled = typeof enabledRaw === "boolean" ? enabledRaw : true;
    const nodes = Array.isArray(topology.nodes) ? topology.nodes.filter((item) => item && typeof item === "object" && !Array.isArray(item)).map((item) => item as Record<string, any>) : [];
    const links = Array.isArray(topology.links) ? topology.links.filter((item) => item && typeof item === "object" && !Array.isArray(item)).map((item) => item as Record<string, any>) : [];
    return {
        enabled,
        nodes,
        links
    };
};

export const normalizeUrlList = (raw: unknown): string[] | undefined => {
    if (!Array.isArray(raw)) return undefined;
    const items = raw.map((v) => String(v ?? "").trim()).filter(Boolean);
    return items.length ? items : undefined;
};

export const normalizeOptionalUrlList = (raw: unknown): string[] | undefined => {
    if (Array.isArray(raw)) return normalizeUrlList(raw);
    if (typeof raw === "string") {
        const items = raw
            .split(/[;,]/)
            .map((entry) => entry.trim())
            .filter(Boolean);
        return items.length ? items : undefined;
    }
    return undefined;
};

export const normalizePeerTargets = (raw: unknown): string[] | undefined => {
    if (Array.isArray(raw)) {
        const list = raw.map((v) => String(v ?? "").trim()).filter(Boolean);
        return list.length ? list : undefined;
    }
    if (typeof raw !== "string") return undefined;
    const list = raw
        .split(/[;,]/)
        .map((v) => v.trim())
        .filter(Boolean);
    return list.length ? list : undefined;
};

export const normalizePeerSource = (value: unknown): string[] | undefined => {
    if (typeof value !== "string") return undefined;
    const split = value
        .split(/[;,]/)
        .map((item) => item.trim())
        .filter(Boolean);
    return split.length ? split : undefined;
};

export const normalizeOriginCollection = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.map((entry) => String(entry || "").trim()).filter(Boolean);
    if (typeof value === "string")
        return value
            .split(/[;,]/)
            .map((entry) => entry.trim())
            .filter(Boolean);
    return [];
};

export const normalizeOriginConfig = (value: unknown): Record<string, any> | undefined => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const source = value as Record<string, any>;
    const normalized: Record<string, any> = {
        originId: typeof source.originId === "string" ? source.originId.trim() : "",
        surface: typeof source.surface === "string" ? source.surface.trim().toLowerCase() : "external",
        originHosts: normalizeOriginCollection(source.originHosts || source.hosts || source.host),
        originDomains: normalizeOriginCollection(source.originDomains || source.domains || source.domain),
        originMasks: normalizeOriginCollection(source.originMasks || source.masks || source.mask)
    };
    if (!normalized.originId) delete normalized.originId;
    if (!normalized.surface) normalized.surface = "external";
    return normalized;
};

export const normalizeTextField = (value: unknown, fallback: string): string => {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
};

export const normalizeAliasKey = (value: string): string => value.trim().toLowerCase();
export const normalizeAliasTarget = (value: string): string => value.trim();

export const normalizeAliasEntries = (raw: unknown): Array<[string, string]> => {
    const out: Array<[string, string]> = [];
    if (typeof raw === "string") {
        const trimmed = raw.trim();
        if (!trimmed) return out;
        try {
            const parsed = safeJsonParse<Record<string, any>>(trimmed);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                for (const [rawAlias, rawTarget] of Object.entries(parsed as Record<string, unknown>)) {
                    const alias = normalizeAliasKey(String(rawAlias || ""));
                    const target = normalizeAliasTarget(String(rawTarget || ""));
                    if (alias && target) out.push([alias, target]);
                }
                return out;
            }
        } catch {
            // fallthrough to text parser
        }
        const parts = trimmed.split(/[;,]/);
        for (const part of parts) {
            const idxEq = part.indexOf("=");
            const idxColon = part.indexOf(":");
            const idx = idxEq >= 0 && (idxColon < 0 || idxEq < idxColon) ? idxEq : idxColon;
            if (idx <= 0) continue;
            const alias = normalizeAliasKey(part.slice(0, idx));
            const target = normalizeAliasTarget(part.slice(idx + 1));
            if (alias && target) out.push([alias, target]);
        }
        return out;
    }

    if (Array.isArray(raw)) {
        for (const row of raw) {
            if (typeof row === "string") {
                const idxEq = row.indexOf("=");
                const idxColon = row.indexOf(":");
                const idx = idxEq >= 0 && (idxColon < 0 || idxEq < idxColon) ? idxEq : idxColon;
                if (idx <= 0) continue;
                const alias = normalizeAliasKey(row.slice(0, idx));
                const target = normalizeAliasTarget(row.slice(idx + 1));
                if (alias && target) out.push([alias, target]);
                continue;
            }
            if (row && typeof row === "object") {
                const entry = row as Record<string, unknown>;
                const alias = normalizeAliasKey(String(entry.alias || entry.id || ""));
                const target = normalizeAliasTarget(String(entry.target || ""));
                if (alias && target) out.push([alias, target]);
            }
        }
        return out;
    }

    if (raw && typeof raw === "object") {
        for (const [aliasKey, rawTarget] of Object.entries(raw as Record<string, unknown>)) {
            const alias = normalizeAliasKey(aliasKey);
            const target = normalizeAliasTarget(String(rawTarget || ""));
            if (alias && target) out.push([alias, target]);
        }
    }

    return out;
};

export const normalizeNetworkAliases = (raw: unknown): Record<string, string> => {
    const entries = normalizeAliasEntries(raw);
    const out: Record<string, string> = {};
    for (const [alias, target] of entries) out[alias] = target;
    return out;
};

export const normalizeEndpointPolicyList = (raw: unknown, preserveEmpty = true): string[] => {
    const normalizeToken = (value: string): string => {
        const normalized = resolvePortableTextValue(String(value || ""))
            .trim()
            .toLowerCase();
        return normalized.startsWith("{") && normalized.endsWith("}") ? normalized.slice(1, -1).trim() : normalized;
    };
    if (raw === undefined) return preserveEmpty ? ["*"] : [];
    if (Array.isArray(raw)) {
        const list = raw.map((entry) => normalizeToken(String(entry || ""))).filter(Boolean);
        return list.length ? list : preserveEmpty ? [] : ["*"];
    }
    if (typeof raw === "string") {
        const list = raw
            .split(/[;,]/)
            .map((entry) => normalizeToken(entry))
            .filter(Boolean);
        return list.length ? list : preserveEmpty ? [] : ["*"];
    }
    if (raw == null) return preserveEmpty ? ["*"] : [];
    if (raw === true) return ["*"];
    if (raw === false) return [];
    return preserveEmpty ? ["*"] : [];
};

export function normalizeEndpointIdPolicy(policyId: string, source: unknown): EndpointIdPolicy {
    const raw = source && typeof source === "object" ? (source as Record<string, unknown>) : {};
    const normalizedId = String(policyId || "")
        .trim()
        .toLowerCase();
    const flags = raw.flags && typeof raw.flags === "object" ? (raw.flags as Record<string, unknown>) : {};
    const forwardRaw = raw.forward;
    const allowedOutgoingRaw = (raw as Record<string, unknown>).allowedOutcoming ?? (raw as Record<string, unknown>).allowedOutgoing ?? (raw as Record<string, unknown>).allowedForwards;
    return {
        id: normalizedId,
        origins: normalizeEndpointPolicyList(raw.origins, true),
        tokens: normalizeEndpointPolicyList(raw.tokens, false),
        forward: legacyPolicyForward(forwardRaw),
        flags: {
            mobile: typeof flags.mobile === "boolean" ? flags.mobile : undefined,
            gateway: typeof flags.gateway === "boolean" ? flags.gateway : undefined,
            direct: typeof flags.direct === "boolean" ? flags.direct : undefined
        },
        allowedIncoming: normalizeEndpointPolicyList(raw.allowedIncoming, true),
        allowedOutcoming: normalizeEndpointPolicyList(allowedOutgoingRaw, true)
    };
}

export const normalizeEndpointIds = (raw: unknown): Record<string, EndpointIdPolicy> => {
    const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const out: Record<string, EndpointIdPolicy> = {};
    for (const [policyId, policySource] of Object.entries(source)) {
        const normalizedId = String(policyId || "")
            .trim()
            .toLowerCase();
        if (!normalizedId) continue;
        out[normalizedId] = normalizeEndpointIdPolicy(normalizedId, policySource);
    }
    return out;
};

export const mergeEndpointPolicies = (...sources: Array<Record<string, any> | undefined>): Record<string, EndpointIdPolicy> => {
    const merged: Record<string, EndpointIdPolicy> = {};
    for (const source of sources) {
        if (!source) continue;
        const normalized = normalizeEndpointIds(source);
        Object.assign(merged, normalized);
    }
    return merged;
};

export const createEndpointConfigSanitizer = (params: {
    defaultConfig: Record<string, any>;
    portableSeed: PortableConfigSeed;
    legacyEndpointIDs: Record<string, EndpointIdPolicy>;
}) => {
    const { defaultConfig, portableSeed, legacyEndpointIDs } = params;

    return (value: Record<string, any>): EndpointConfig => {
        const source = value && typeof value === "object" ? value : {};
        const coreSource = source.core && typeof source.core === "object" ? (source.core as Record<string, any>) : {};
        const aiSource = source.ai && typeof source.ai === "object" ? (source.ai as Record<string, any>) : {};
        const seedCore = asRecord(portableSeed.core);
        const seedEndpoint = asRecord(portableSeed.endpoint);
        const seedRuntime = asRecord(portableSeed.runtime);
        const seedEndpointDefaults = asRecord(portableSeed.endpointDefaults);
        const seedTopology = asRecord(portableSeed.topology);
        const seedEndpointTopology = asRecord(portableSeed.endpointTopology as unknown as Record<string, any>);
        const seedEndpointIDs = asRecord(portableSeed.endpointIDs || seedCore.endpointIDs || {});
        const seedNetwork = asRecord(portableSeed.network);
        const coreNetwork = asRecord(coreSource.network);
        const sourceNetwork = asRecord((source as Record<string, any>).network);
        const seedNetworkEndpoints = normalizeOptionalUrlList(sourceNetwork.endpoints || coreNetwork.endpoints || seedNetwork.endpoints);
        const seedBridge = asRecord(seedCore.bridge || seedEndpoint.bridge || seedEndpointDefaults.bridge || {});
        const seedBridgeWithNetwork = {
            ...seedBridge,
            ...(seedNetworkEndpoints && !Array.isArray(seedBridge.endpoints) ? { endpoints: seedNetworkEndpoints } : {})
        };

        const seedEndpointConfig = {
            ...seedEndpointDefaults,
            ...seedRuntime,
            ...seedEndpoint
        };

        const mergedBridge = {
            ...defaultConfig.bridge,
            ...seedBridgeWithNetwork,
            ...(coreSource.bridge as Record<string, any>),
            ...(source.core?.bridge as Record<string, any>),
            ...(source.bridge as Record<string, any>)
        };

        const mergedBridgeWithFallback = {
            ...mergedBridge,
            origin: normalizeOriginConfig((coreSource as Record<string, any>).bridge?.origin || (source as Record<string, any>).bridge?.origin || (source.core?.bridge as Record<string, any>)?.origin),
            userId: normalizeTextField(mergedBridge.userId, normalizeTextField((defaultConfig.bridge as Record<string, any>).userId, "")),
            userKey: normalizeTextField(mergedBridge.userKey, normalizeTextField((defaultConfig.bridge as Record<string, any>).userKey, "")),
            endpoints: normalizeUrlList(coreSource.bridge?.endpoints || source.core?.bridge?.endpoints || source.bridge?.endpoints) ?? normalizeUrlList(mergedBridge.endpoints) ?? []
        };

        const mergedTopologySource = {
            ...seedTopology,
            ...seedEndpointTopology,
            ...(coreSource.topology as Record<string, any>),
            ...(source.core?.topology as Record<string, any>),
            ...(source.topology as Record<string, any>)
        };
        const mergedTopology = normalizeTopologyConfig(mergedTopologySource);

        if (!mergedBridgeWithFallback.endpointUrl && mergedBridgeWithFallback.endpoints?.length) {
            mergedBridgeWithFallback.endpointUrl = mergedBridgeWithFallback.endpoints[0];
        }

        const envPeers = normalizePeerSource(pickEnvStringLegacy("CWS_PEERS") || pickEnvStringLegacy("CLIPBOARD_PEERS") || "");
        const envRoles = (() => {
            const raw = pickEnvStringLegacy("CWS_ROLES");
            if (!raw) return undefined;
            if (typeof raw === "string") {
                const list = raw
                    .split(/[;,]/)
                    .map((entry) => entry.trim())
                    .filter(Boolean);
                return list.length ? list : undefined;
            }
            return undefined;
        })();
        const envBroadcastForceHttps = pickEnvBoolLegacy("CWS_BROADCAST_FORCE_HTTPS");
        const envHttpsEnabled = parsePortableBoolean(pickEnvStringLegacy("CWS_HTTPS_ENABLED") ?? pickEnvStringLegacy("HTTPS_ENABLED"));
        const envHttpsKey = pickEnvStringLegacy("CWS_HTTPS_KEY") || pickEnvStringLegacy("CWS_HTTPS_KEY_FILE") || pickEnvStringLegacy("HTTPS_KEY") || pickEnvStringLegacy("HTTPS_KEY_FILE");
        const envHttpsCert = pickEnvStringLegacy("CWS_HTTPS_CERT") || pickEnvStringLegacy("CWS_HTTPS_CERT_FILE") || pickEnvStringLegacy("HTTPS_CERT") || pickEnvStringLegacy("HTTPS_CERT_FILE");
        const envHttpsCa = pickEnvStringLegacy("CWS_HTTPS_CA") || pickEnvStringLegacy("CWS_HTTPS_CA_FILE") || pickEnvStringLegacy("HTTPS_CA") || pickEnvStringLegacy("HTTPS_CA_FILE");
        const envRequestClientCerts = pickEnvBoolLegacy("CWS_HTTPS_REQUEST_CLIENT_CERTS");
        const envAllowUntrusted = pickEnvBoolLegacy("CWS_HTTPS_ALLOW_UNTRUSTED_CLIENT_CERTS");
        const envNetworkAliases = pickEnvStringLegacy("CWS_NETWORK_ALIAS_MAP") || pickEnvStringLegacy("CWS_NETWORK_ALIASES") || pickEnvStringLegacy("NETWORK_ALIAS_MAP") || pickEnvStringLegacy("NETWORK_ALIASES");
        const envBroadcastTargets = pickEnvStringLegacy("CWS_BROADCAST_TARGETS");
        const envClipboardPeerTargets = pickEnvStringLegacy("CWS_CLIPBOARD_PEER_TARGETS") || pickEnvStringLegacy("CLIPBOARD_PEER_TARGETS");
        const envListenPort = pickEnvNumberLegacy("CWS_LISTEN_PORT");
        const envHttpPort = pickEnvNumberLegacy("CWS_HTTP_PORT");
        const envPollInterval = pickEnvNumberLegacy("CWS_POLL_INTERVAL");
        const envHttpTimeoutMs = pickEnvNumberLegacy("CWS_HTTP_TIMEOUT_MS");
        const envSecret = pickEnvStringLegacy("CWS_SECRET");
        const sourceHttps = asRecord(source.https);
        const networkSourceHttps = asRecord(sourceNetwork.https);
        const coreSourceHttps = asRecord(coreSource.https);
        const seedHttps = asRecord(seedEndpointConfig.https || seedEndpointDefaults.https || (source as Record<string, any>).https || coreSource.https || sourceNetwork.https || seedNetwork.https || seedCore.https);

        return {
            ...(defaultConfig as Record<string, any>),
            ...source,
            ...coreSource,
            networkAliases: normalizeNetworkAliases(source.networkAliases ?? source.networkAliasMap ?? envNetworkAliases ?? seedEndpointConfig.networkAliases ?? seedEndpointConfig.networkAliasMap ?? (coreSource as Record<string, any>).networkAliases ?? (coreSource as Record<string, any>).networkAliasMap),
            peers: normalizeUrlList(source.peers ?? coreSource.peers ?? sourceNetwork.peers ?? coreNetwork.peers ?? seedNetwork.peers ?? seedEndpointConfig.peers ?? envPeers) ?? defaultConfig.peers,
            broadcastTargets: normalizeUrlList(source.broadcastTargets ?? coreSource.broadcastTargets ?? sourceNetwork.broadcastTargets ?? coreNetwork.broadcastTargets ?? seedNetwork.broadcastTargets ?? seedEndpointConfig.broadcastTargets ?? envBroadcastTargets) ?? defaultConfig.broadcastTargets,
            clipboardPeerTargets: normalizePeerTargets(source.clipboardPeerTargets ?? coreSource.clipboardPeerTargets ?? sourceNetwork.clipboardPeerTargets ?? coreNetwork.clipboardPeerTargets ?? seedNetwork.clipboardPeerTargets ?? seedEndpointConfig.clipboardPeerTargets ?? (seedEndpointDefaults as Record<string, any>).clipboardPeerTargets ?? envClipboardPeerTargets) ?? defaultConfig.clipboardPeerTargets,
            listenPort: parsePortableInteger(envListenPort) ?? source.listenPort ?? coreSource.listenPort ?? sourceNetwork.listenPort ?? coreNetwork.listenPort ?? seedEndpointConfig.listenPort ?? defaultConfig.listenPort,
            httpPort: parsePortableInteger(envHttpPort) ?? source.httpPort ?? coreSource.httpPort ?? sourceNetwork.httpPort ?? coreNetwork.httpPort ?? seedEndpointConfig.httpPort ?? defaultConfig.httpPort,
            broadcastForceHttps: envBroadcastForceHttps ?? source.broadcastForceHttps ?? coreSource.broadcastForceHttps ?? sourceNetwork.broadcastForceHttps ?? coreNetwork.broadcastForceHttps ?? seedEndpointConfig.broadcastForceHttps ?? defaultConfig.broadcastForceHttps,
            https: {
                ...(seedHttps ?? {}),
                ...(sourceHttps ?? {}),
                ...(coreSourceHttps ?? {}),
                ...(networkSourceHttps ?? {}),
                ...(envHttpsEnabled !== undefined ? { enabled: envHttpsEnabled } : {}),
                ...(envHttpsKey ? { key: envHttpsKey } : {}),
                ...(envHttpsCert ? { cert: envHttpsCert } : {}),
                ...(envHttpsCa ? { ca: envHttpsCa } : {}),
                ...(envRequestClientCerts !== undefined ? { requestClientCerts: envRequestClientCerts } : {}),
                ...(envAllowUntrusted !== undefined ? { allowUntrustedClientCerts: envAllowUntrusted } : {})
            },
            pollInterval: parsePortableInteger(envPollInterval) ?? source.pollInterval ?? sourceNetwork.pollInterval ?? coreNetwork.pollInterval ?? seedEndpointConfig.pollInterval ?? defaultConfig.pollInterval,
            httpTimeoutMs: parsePortableInteger(envHttpTimeoutMs) ?? source.httpTimeoutMs ?? sourceNetwork.httpTimeoutMs ?? coreNetwork.httpTimeoutMs ?? seedEndpointConfig.httpTimeoutMs ?? defaultConfig.httpTimeoutMs,
            secret: envSecret || (source.secret ?? sourceNetwork.secret ?? coreNetwork.secret ?? seedEndpointConfig.secret ?? defaultConfig.secret),
            roles: Array.isArray(coreSource.roles) ? coreSource.roles : Array.isArray(source.roles) ? source.roles : Array.isArray(seedEndpointConfig.roles) ? seedEndpointConfig.roles : Array.isArray(seedEndpoint.roles) ? seedEndpoint.roles : envRoles ? envRoles : defaultConfig.roles,
            bridge: mergedBridgeWithFallback,
            topology: {
                ...mergedTopology,
                ...normalizeTopologyConfig(mergedTopology)
            },
            endpointIDs: mergeEndpointPolicies(seedEndpointIDs, legacyEndpointIDs, coreSource.endpointIDs as Record<string, any>, source.core?.endpointIDs as Record<string, any>, source.endpointIDs as Record<string, any>),
            ai: {
                ...(defaultConfig as Record<string, any>).ai,
                ...aiSource,
                ...(source.ai as Record<string, any>)
            }
        };
    };
};

export const discoverEndpointConfig = (params: {
    defaultConfig: Record<string, any>;
    sanitizeConfig: (value: Record<string, any>) => EndpointConfig;
}): EndpointConfig => {
    const { defaultConfig, sanitizeConfig } = params;
    const configSources = getConfigSources();
    configLoadReport.configSourcesChecked = configSources;
    configLoadReport.selectedEndpointConfig = undefined;
    for (const candidate of configSources) {
        const loaded = loadJsonFile(candidate);
        if (loaded && typeof loaded === "object" && !Array.isArray(loaded)) {
            configLoadReport.selectedEndpointConfig = candidate;
            appendEndpointIdDefinitions(`core-config:${candidate}`, loaded.endpointIDs || (loaded as Record<string, any>).core?.endpointIDs || (loaded as Record<string, any>).endpointIDs);
            appendEndpointIdDefinitions(`core-config:${candidate}:clients`, (loaded as Record<string, any>).clients || (loaded as Record<string, any>).core?.clients);
            appendEndpointIdDefinitions(`core-config:${candidate}:gateways`, (loaded as Record<string, any>).gateways || (loaded as Record<string, any>).core?.gateways);
            return sanitizeConfig(loaded);
        }
    }
    return sanitizeConfig(defaultConfig);
};

export const getConfigLoadReport = (): ConfigLoadReport => {
    return configLoadReport.collect();
};

import { parsePortableInteger } from "../../lib/parsing.ts";

export type NetworkSurface = "local" | "private" | "public" | "external" | "unknown";
export type PeerNodeRole = "endpoint" | "gateway" | "peer" | "bridge";
export type DispatchRouteHint = "local" | "bridge" | "both" | "none";
export type DispatchRouteMode = "local" | "bridge" | "both" | "auto";
export type DispatchTargetHint = "explicit" | "implicit-config" | "implicit-local-broadcast" | "implicit-empty";
export type NetworkAliasMap = Record<string, string>;

export type DispatchAudiencePlan = {
    targets: string[];
    fanout: boolean;
    source: DispatchTargetHint;
    reason: string;
};

export type DispatchRouteDecision = {
    route: DispatchRouteHint;
    local: boolean;
    bridge: boolean;
    reason: string;
    surface: NetworkSurface;
};

const isPrivateV4 = (value: string): boolean => {
    if (value.startsWith("10.")) return true;
    if (value.startsWith("192.168.")) return true;
    if (value.startsWith("172.")) {
        const second = parsePortableInteger(value.split(".")[1] || 0);
        return second !== undefined && second >= 16 && second <= 31;
    }
    return false;
};

const isPrivateV6 = (value: string): boolean => {
    return value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80");
};

const normalizeAddress = (value: string): string => value.trim().toLowerCase();

export const normalizeNetworkAliasMap = (value: unknown): NetworkAliasMap => {
    const out: NetworkAliasMap = {};
    if (!value || typeof value !== "object") return out;
    for (const [alias, rawTarget] of Object.entries(value as Record<string, unknown>)) {
        const normalizedAlias = normalizeAddress(alias);
        const normalizedTarget = normalizeAddress(String(rawTarget || ""));
        if (normalizedAlias && normalizedTarget) {
            out[normalizedAlias] = normalizedTarget;
        }
    }
    return out;
};

export const resolveNetworkAlias = (aliasMap: NetworkAliasMap | undefined, token: string): string => {
    const normalizedToken = token.trim().toLowerCase();
    if (!normalizedToken) return "";
    const mapped = aliasMap && Object.prototype.hasOwnProperty.call(aliasMap, normalizedToken) ? aliasMap[normalizedToken] : undefined;
    if (!mapped) return normalizedToken;
    const trimmed = mapped.trim();
    return trimmed || normalizedToken;
};

export const inferNetworkSurface = (remoteAddress?: string | null): NetworkSurface => {
    if (!remoteAddress) return "unknown";
    const value = normalizeAddress(remoteAddress);
    if (value === "127.0.0.1" || value === "::1" || value === "localhost") return "local";
    if (isPrivateV4(value) || isPrivateV6(value)) return "private";
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return "public";
    return "external";
};

export const looksLikeExternalHost = (target: string): boolean => {
    const value = normalizeAddress(target);
    if (!value) return false;
    if (value.includes("://")) return true;
    return /\./.test(value) || value.startsWith("ws") || value.startsWith("wss") || /^\d{1,3}(?:\.\d{1,3}){3}/.test(value);
};

export const makeTargetTokenSet = (values: readonly string[]): Set<string> => new Set(values.map((value) => normalizeAddress(value)).filter(Boolean));

export const resolveDispatchPlan = (options: { route?: DispatchRouteMode; broadcast?: boolean; target?: string; hasBridgeTransport?: boolean; isLocalTarget?: (target: string) => boolean; surface?: NetworkSurface }): DispatchRouteDecision => {
    const route = options.route ?? "auto";
    const target = normalizeAddress(options.target ?? "");
    const hasBridge = options.hasBridgeTransport === true;

    if (route === "local") {
        return {
            route: "local",
            local: true,
            bridge: false,
            surface: options.surface || "unknown",
            reason: "route forced local via api/network/dispatch"
        };
    }

    if (route === "bridge") {
        return {
            route: hasBridge ? "bridge" : "none",
            local: false,
            bridge: hasBridge,
            surface: options.surface || "unknown",
            reason: hasBridge ? "route forced bridge via api/network/dispatch" : "bridge not available for forced route"
        };
    }

    if (route === "both") {
        const hasLocal = target ? options.isLocalTarget?.(target) === true : false;
        return {
            route: hasBridge || hasLocal ? "both" : hasLocal ? "local" : "none",
            local: hasLocal,
            bridge: hasBridge,
            surface: options.surface || "unknown",
            reason: hasBridge && hasLocal ? "route forced both local + bridge" : hasBridge ? "bridge enabled; local target not matched" : "bridge disabled; local requested only"
        };
    }

    if (options.broadcast || !target || target === "broadcast") {
        return {
            route: hasBridge ? "both" : "local",
            local: true,
            bridge: hasBridge,
            surface: options.surface || "unknown",
            reason: hasBridge ? "broadcast/default dispatch routed to local + bridge" : "broadcast/default dispatch is local-only"
        };
    }

    if (looksLikeExternalHost(target)) {
        return {
            route: hasBridge ? "bridge" : "none",
            local: false,
            bridge: hasBridge,
            surface: options.surface || "unknown",
            reason: "target looks like external host; prefer bridge"
        };
    }

    const localTarget = options.isLocalTarget?.(target);
    if (localTarget) {
        return {
            route: "local",
            local: true,
            bridge: false,
            surface: options.surface || "unknown",
            reason: "target resolved as connected local reverse peer/device"
        };
    }

    return {
        route: hasBridge ? "bridge" : "none",
        local: false,
        bridge: hasBridge,
        surface: options.surface || "unknown",
        reason: hasBridge ? "target unknown locally; relay via bridge" : "target unknown and no bridge transport"
    };
};

export const resolveDispatchAudience = (options: { target?: string; targets?: readonly string[]; broadcast?: boolean; implicitTargets?: readonly string[] }): DispatchAudiencePlan => {
    const explicitTargets = new Set<string>();
    if (typeof options.target === "string") {
        const normalized = options.target.trim().toLowerCase();
        if (normalized) explicitTargets.add(normalized);
    }

    if (Array.isArray(options.targets)) {
        for (const rawTarget of options.targets) {
            if (typeof rawTarget !== "string") continue;
            const normalized = rawTarget.trim().toLowerCase();
            if (normalized) explicitTargets.add(normalized);
        }
    }

    if (explicitTargets.size > 0) {
        return {
            targets: Array.from(explicitTargets),
            fanout: explicitTargets.size > 1,
            source: "explicit",
            reason: "dispatch via explicit destination list"
        };
    }

    const implicit = Array.isArray(options.implicitTargets) ? Array.from(new Set(options.implicitTargets.map((value) => value?.trim().toLowerCase()).filter(Boolean))) : [];

    if (options.broadcast === true && implicit.length > 0) {
        return {
            targets: implicit,
            fanout: implicit.length > 1,
            source: "implicit-config",
            reason: "dispatch via implicit configured destination list"
        };
    }

    return {
        targets: [],
        fanout: false,
        source: options.broadcast ? "implicit-local-broadcast" : "implicit-empty",
        reason: options.broadcast ? "dispatch fallback to local fanout" : "dispatch as single target"
    };
};

export type WsConnectionType =
    | "requestor-initiator"
    | "requestor-initiated"
    | "responser-initiator"
    | "responser-initiated"
    | "exchanger-initiator"
    | "exchanger-initiated";
export type WsConnectionIntent = WsConnectionType | "first-order";
export type WsConnectionDisplayRole = WsConnectionType;
export type WsConnectionDisplay = WsConnectionDisplayRole | "first-order";

const LEGACY_TO_CANONICAL_TYPE: Record<string, WsConnectionType> = {
    "client-reverse": "responser-initiator",
    "client-forward": "requestor-initiator",
    "server-forward": "responser-initiated",
    "server-reverse": "requestor-initiated",
    "forward-server": "responser-initiated",
    "forward-client": "requestor-initiator",
    "reverse-server": "requestor-initiated",
    "reverse-client": "responser-initiator",
    "client-bridge": "responser-initiator",
    "server-bridge": "responser-initiated",
    "requestor": "requestor-initiator",
    "responser": "responser-initiator",
    "exchanger": "exchanger-initiator",
    "first-order": "exchanger-initiator",
    "firstorder": "exchanger-initiator",
    "fo": "exchanger-initiator"
};

const DISPLAY_TO_CANONICAL_TYPE: Record<string, WsConnectionType | undefined> = {
    "requestor-initiator": "requestor-initiator",
    "requestor-initiated": "requestor-initiated",
    "responser-initiator": "responser-initiator",
    "responser-initiated": "responser-initiated",
    "exchanger-initiator": "exchanger-initiator",
    "exchanger-initiated": "exchanger-initiated"
};

const LEGACY_ROLE_ALIASES = new Set(["endpoint", "server", "peer", "client", "node", "hub"]);
const CLIENT_CONNECTOR_ROLES = new Set([
    "requestor-initiator",
    "responser-initiator",
    "responser-initiated",
    "requestor-initiated",
    "exchanger-initiator",
    "exchanger-initiated",
    "client-forward",
    "client-reverse",
    "server-forward",
    "server-reverse",
    "forward-client",
    "reverse-client",
    "client-bridge",
    "server-bridge",
    "forward-server",
    "reverse-server",
    "client-downstream",
    "server-downstream",
    "client-upstream",
    "server-upstream"
]);

const FORWARD_SERVER_ROLES = new Set([
    "responser-initiated",
    "responser-initiator",
    "server-forward",
    "server-bridge",
    "forward-server",
    "client-forward",
    "requestor-initiator"
]);
const REVERSE_SERVER_ROLES = new Set([
    "requestor-initiated",
    "requestor-initiator",
    "server-reverse",
    "server-downstream",
    "reverse-server",
    "client-reverse",
    "responser-initiator"
]);

const REVERSE_MODE = "requestor-initiated";
const DIRECT_MODE = "responser-initiated";

const resolveClientRole = (input: string): WsConnectionIntent | undefined => {
    const value = (input || "").trim().toLowerCase();
    if (!value) return undefined;
    if (value === "first-order" || value === "firstorder" || value === "fo" || value === "exchanger-initiator" || value === "exchanger-initiated") {
        return "first-order";
    }
    if (value === "requestor-initiator" || value === "requestor" || value === "forward-client" || value === "client-forward" || value === "client-upstream") {
        return "requestor-initiator";
    }
    if (value === "requestor-initiated" || value === "rs" || value === "sd" || value === "s-down" || value === "server-reverse" || value === "reverse-server") {
        return "requestor-initiated";
    }
    if (value === "responser-initiator" || value === "responser" || value === "client-reverse" || value === "reverse-client" || value === "cu" || value === "c-up" || value === "cr" || value === "server-downstream" || value === "server-upstream" || value === "client-bridge") {
        return "responser-initiator";
    }
    if (value === "responser-initiated" || value === "fs" || value === "su" || value === "s-up" || value === "server-forward" || value === "forward-server" || value === "server-bridge") {
        return "responser-initiated";
    }
    const legacyFallback = LEGACY_TO_CANONICAL_TYPE[value];
    if (legacyFallback) return legacyFallback;
    return DISPLAY_TO_CANONICAL_TYPE[value];
};

export const normalizeRoleSet = (roles: unknown): Set<string> => {
    if (!Array.isArray(roles)) return new Set<string>();
    const normalized = roles.map((value) => (typeof value === "string" ? value.trim().toLowerCase() : "")).filter((value) => value.length > 0);
    return new Set(normalized);
};

export const parseWsConnectionType = (value: unknown): WsConnectionIntent | undefined => {
    if (typeof value !== "string") return undefined;
    return resolveClientRole(value);
};

export const describeDisplayConnectionType = (connectionType: WsConnectionIntent): WsConnectionDisplay => {
    if (connectionType === "first-order") return "exchanger-initiator";
    return connectionType;
};

export const toDisplayTopology = (
    localConnectionType: WsConnectionType,
    remoteConnectionType?: WsConnectionIntent
): string => {
    const left = describeDisplayConnectionType(localConnectionType);
    const right = remoteConnectionType ? describeDisplayConnectionType(remoteConnectionType) : left;
    return `${left} ↔ ${right}`;
};

export const toCanonicalConnectionType = (value: string | undefined): WsConnectionIntent | undefined => {
    return parseWsConnectionType(value);
};

export const toCanonicalFromDisplayConnectionType = (value: string | undefined): WsConnectionIntent | undefined => {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized) return undefined;
    if (normalized === "first-order" || normalized === "firstorder" || normalized === "fo" || normalized === "exchanger-initiator" || normalized === "exchanger-initiated") {
        return "first-order";
    }
    return DISPLAY_TO_CANONICAL_TYPE[normalized] || LEGACY_TO_CANONICAL_TYPE[normalized];
};

export const inferServerSideConnectionType = (isReverse: boolean): WsConnectionType => {
    return isReverse ? REVERSE_MODE : DIRECT_MODE;
};

export const inferExpectedRemoteConnectionType = (isReverse: boolean): WsConnectionType => {
    return isReverse ? "responser-initiator" : "requestor-initiator";
};

const hasLegacyRoleMarker = (roles: Set<string>): boolean => {
    for (const role of roles) {
        if (LEGACY_ROLE_ALIASES.has(role)) return true;
    }
    return false;
};

export const supportsConnectorRole = (rawRoles: unknown): boolean => {
    const roles = normalizeRoleSet(rawRoles);
    if (roles.size === 0) return true;
    if (hasLegacyRoleMarker(roles)) return true;
    for (const role of CLIENT_CONNECTOR_ROLES) {
        if (roles.has(role)) return true;
    }
    return false;
};

export const supportsForwardServerConnectionType = (rawRoles: unknown): boolean => {
    const roles = normalizeRoleSet(rawRoles);
    if (roles.size === 0) return true;
    if (hasLegacyRoleMarker(roles)) return true;
    for (const role of FORWARD_SERVER_ROLES) {
        if (roles.has(role)) return true;
    }
    return false;
};

export const supportsReverseServerConnectionType = (rawRoles: unknown): boolean => {
    const roles = normalizeRoleSet(rawRoles);
    if (roles.size === 0) return true;
    if (hasLegacyRoleMarker(roles)) return true;
    for (const role of REVERSE_SERVER_ROLES) {
        if (roles.has(role)) return true;
    }
    return false;
};

export const areConnectionTypesCompatible = (
    localConnectionType: WsConnectionType,
    remoteConnectionType: WsConnectionIntent | undefined
): boolean => {
    if (remoteConnectionType == null) return true;
    if (remoteConnectionType === "first-order") return true;
    const compatibility: Record<WsConnectionType, WsConnectionType> = {
        "responser-initiator": "requestor-initiated",
        "requestor-initiated": "responser-initiator",
        "requestor-initiator": "responser-initiated",
        "responser-initiated": "requestor-initiator",
        "exchanger-initiator": "exchanger-initiated",
        "exchanger-initiated": "exchanger-initiator"
    };
    return compatibility[localConnectionType] === remoteConnectionType;
};

export const describeConnectionType = (connectionType: WsConnectionIntent): string => connectionType;

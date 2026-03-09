export type EndpointIdFlags = {
    mobile?: boolean;
    gateway?: boolean;
    direct?: boolean;
    [key: string]: boolean | undefined;
};

export type EndpointTransportMode = "http" | "ws" | "socketio" | "tcp";
export type EndpointTransportDirection = "both" | "outbound" | "inbound";

export type EndpointTransportHint = {
    transports: EndpointTransportMode[];
    direction: EndpointTransportDirection;
};

export type EndpointIdPolicy = {
    id: string;
    origins: string[];
    tokens: string[];
    forward: string;
    ports?: Record<string, unknown>;
    flags: EndpointIdFlags;
    relations?: Record<string, EndpointTransportHint>;
    allowedIncoming: string[];
    allowedOutcoming: string[];
    roles: string[];
};

export type EndpointIdPolicyMap = Record<string, EndpointIdPolicy>;
type NormalizedPolicyValue = Record<string, EndpointIdPolicy>;

type EndpointRouteDecision = {
    allowed: boolean;
    sourcePolicy?: EndpointIdPolicy;
    targetPolicy?: EndpointIdPolicy;
    source: string;
    target: string;
    reason?: string;
};

const normalizeEndpointToken = (value: string): string => {
    const normalized = String(value || "")
        .trim()
        .toLowerCase();
    if (!normalized) return "";
    return normalized.startsWith("{") && normalized.endsWith("}") ? normalized.slice(1, -1).trim() : normalized;
};

const normalizePolicyList = (raw: unknown, useWildcard = true): string[] => {
    if (raw === undefined) return useWildcard ? ["*"] : [];
    if (raw === null) return useWildcard ? ["*"] : [];
    if (Array.isArray(raw)) {
        const list = raw.map((entry) => normalizeEndpointToken(String(entry || ""))).filter(Boolean);
        if (list.length === 0) return [];
        return list;
    }
    if (typeof raw === "string") {
        const list = raw
            .split(/[;,]/)
            .map((entry) => normalizeEndpointToken(entry))
            .filter(Boolean);
        return list.length ? list : [];
    }
    return useWildcard ? ["*"] : [];
};

const normalizePolicyForward = (raw: unknown): string => {
    const normalized = normalizeEndpointToken(String(raw || ""));
    if (!normalized || normalized === "self") return "self";
    return normalized;
};

const normalizePolicyFlags = (raw: unknown): EndpointIdFlags => {
    const flags = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const out: EndpointIdPolicy["flags"] = {};
    if (typeof flags.mobile === "boolean") out.mobile = flags.mobile;
    if (typeof flags.gateway === "boolean") out.gateway = flags.gateway;
    if (typeof flags.direct === "boolean") out.direct = flags.direct;
    return out;
};

const normalizePolicyPortList = (raw: unknown): number[] => {
    if (!Array.isArray(raw)) return [];
    const normalized = raw
        .map((entry) => {
            const parsed = Number(String(entry).trim());
            return Number.isFinite(parsed) && parsed > 0 && parsed <= 65535 ? Math.trunc(parsed) : undefined;
        })
        .filter((entry): entry is number => entry !== undefined);
    const unique: number[] = [];
    for (const port of normalized) {
        if (!unique.includes(port)) unique.push(port);
    }
    return unique;
};

const normalizePolicyPorts = (raw: unknown): Record<string, number[]> => {
    if (!raw || typeof raw !== "object") return {};
    const source = raw as Record<string, unknown>;
    const out: Record<string, number[]> = {};
    Object.keys(source).forEach((key) => {
        const normalized = normalizePolicyPortList(source[key]);
        if (normalized.length > 0) {
            out[key.trim()] = normalized;
        }
    });
    return out;
};

const normalizeTransportMode = (raw: string): EndpointTransportMode | undefined => {
    const normalized = normalizeEndpointToken(raw);
    if (!normalized) return undefined;
    if (normalized === "ws" || normalized === "websocket") return "ws";
    if (normalized === "socketio" || normalized === "socket.io" || normalized === "io") return "socketio";
    if (normalized === "tcp" || normalized === "tcp4" || normalized === "tcp6") return "tcp";
    if (normalized === "http" || normalized === "https") return "http";
    return undefined;
};

const normalizeTransportDirection = (raw: string): EndpointTransportDirection | undefined => {
    const normalized = normalizeEndpointToken(raw);
    if (!normalized) return undefined;
    if (normalized === "both" || normalized === "bidi" || normalized === "bidirectional") return "both";
    if (normalized === "outbound" || normalized === "out" || normalized === "source" || normalized === "send" || normalized === "to-target") return "outbound";
    if (normalized === "inbound" || normalized === "in" || normalized === "target" || normalized === "target-to-source" || normalized === "reverse") return "inbound";
    return undefined;
};

const normalizeTransportHint = (value: unknown): EndpointTransportHint | undefined => {
    if (value == null) return undefined;

    if (typeof value === "string") {
        const tokens = value
            .split(/[,\s;|]+/)
            .map((entry) => entry.trim())
            .filter(Boolean);
        const transports: EndpointTransportMode[] = [];
        let direction: EndpointTransportDirection = "both";
        for (const token of tokens) {
            const normalizedTransport = normalizeTransportMode(token);
            if (normalizedTransport) {
                if (!transports.includes(normalizedTransport)) transports.push(normalizedTransport);
                continue;
            }
            const normalizedDirection = normalizeTransportDirection(token);
            if (normalizedDirection) direction = normalizedDirection;
        }
        if (transports.length === 0) return undefined;
        return { transports, direction };
    }

    if (Array.isArray(value)) {
        const transports: EndpointTransportMode[] = [];
        for (const transportRaw of value) {
            const transport = normalizeTransportMode(String(transportRaw || "").trim());
            if (transport && !transports.includes(transport)) transports.push(transport);
        }
        if (!transports.length) return undefined;
        return { transports, direction: "both" };
    }

    if (typeof value === "object") {
        const source = value as Record<string, unknown>;
        const rawDirection = typeof source.direction === "string" ? source.direction : typeof source.dir === "string" ? source.dir : "";
        const direction = normalizeTransportDirection(rawDirection) || "both";
        const transportEntries = [
            ...([source.transport] as unknown[]),
            ...([source.transports] as unknown[]),
            ...([source.via] as unknown[])
        ].filter((entry) => entry != null);
        const transports = new Set<EndpointTransportMode>();
        for (const transportEntry of transportEntries) {
            if (Array.isArray(transportEntry)) {
                for (const transportRaw of transportEntry) {
                    const transport = normalizeTransportMode(String(transportRaw || "").trim());
                    if (transport) transports.add(transport);
                }
            } else {
                const transport = normalizeTransportMode(String(transportEntry || "").trim());
                if (transport) transports.add(transport);
            }
        }
        if (!transports.size) return undefined;
        return { transports: Array.from(transports), direction };
    }

    return undefined;
};

const normalizePolicyRelations = (raw: unknown): Record<string, EndpointTransportHint> => {
    const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    if (!source || Array.isArray(source)) return {};
    const out: Record<string, EndpointTransportHint> = {};
    for (const [rawTarget, rawHint] of Object.entries(source)) {
        const normalizedTarget = normalizeEndpointToken(rawTarget);
        if (!normalizedTarget) continue;
        const hint = normalizeTransportHint(rawHint);
        if (!hint) continue;
        out[normalizedTarget] = {
            direction: hint.direction,
            transports: hint.transports
        };
    }
    return out;
};

const findRelationForTarget = (
    relations: Record<string, EndpointTransportHint> | undefined,
    target: string
): { key: string; hint: EndpointTransportHint } | undefined => {
    if (!relations) return undefined;
    const normalizedTarget = normalizeEndpointToken(target);
    if (!normalizedTarget) return undefined;
    if (relations[normalizedTarget]) {
        return { key: normalizedTarget, hint: relations[normalizedTarget] };
    }
    for (const [key, hint] of Object.entries(relations)) {
        if (hasRuleMatch(key, normalizedTarget) || hasRuleMatch(normalizedTarget, key)) {
            return { key, hint };
        }
    }
    return undefined;
};

const isOwnerToPeerTransport = (direction: EndpointTransportDirection): boolean =>
    direction === "both" || direction === "outbound";
const isPeerToOwnerTransport = (direction: EndpointTransportDirection): boolean =>
    direction === "both" || direction === "inbound";

const DEFAULT_TRANSPORT_PLAN: EndpointTransportMode[] = ["ws", "socketio", "http", "tcp"];

export const normalizeEndpointPolicy = (id: string, raw: unknown): EndpointIdPolicy => {
    const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const normalizedId = normalizeEndpointToken(id);
    return {
        id: normalizedId,
        origins: normalizePolicyList(source.origins),
        tokens: normalizePolicyList(source.tokens, false),
        forward: normalizePolicyForward(source.forward),
        ports: normalizePolicyPorts(source.ports),
        flags: normalizePolicyFlags(source.flags),
        relations: normalizePolicyRelations(source.relations),
        allowedIncoming: normalizePolicyList(source.allowedIncoming, true),
        allowedOutcoming: normalizePolicyList(source.allowedOutcoming, true),
        roles: normalizePolicyList(source.roles, false)
    };
};

export const normalizeEndpointPolicies = (raw: unknown): EndpointIdPolicyMap => {
    const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const out: NormalizedPolicyValue = {};
    const entries = Object.entries(source);
    for (const [policyId, policySource] of entries) {
        const normalizedId = normalizeEndpointToken(policyId);
        if (!normalizedId) continue;
        if (normalizedId === "*") {
            out["*"] = normalizeEndpointPolicy("*", policySource);
            continue;
        }
        out[normalizedId] = normalizeEndpointPolicy(normalizedId, policySource);
    }
    if (!Object.prototype.hasOwnProperty.call(out, "*")) {
        out["*"] = normalizeEndpointPolicy("*", {
            forward: "self",
            allowedIncoming: ["*"],
            allowedOutcoming: ["*"]
        });
    }
    return out;
};

const hasRuleMatch = (ruleValue: string, candidate: string): boolean => {
    if (!ruleValue) return false;
    if (ruleValue === "*") return true;
    if (ruleValue === candidate) return true;
    if (ruleValue.includes(candidate) || candidate.includes(ruleValue)) return true;
    return false;
};

const isAllowedByRules = (rules: readonly string[], candidate: string): boolean => {
    if (!rules || rules.length === 0) return false;
    const normalized = normalizeEndpointToken(candidate);
    const denies = rules
        .filter((entry) => entry.startsWith("!"))
        .map((entry) => normalizeEndpointToken(entry.slice(1)))
        .filter(Boolean);
    if (denies.some((entry) => hasRuleMatch(entry, normalized))) return false;

    const allows = rules
        .filter((entry) => !entry.startsWith("!"))
        .map((entry) => normalizeEndpointToken(entry))
        .filter(Boolean);
    return allows.some((entry) => entry === "*" || hasRuleMatch(entry, normalized));
};

export const resolveEndpointIdPolicy = (policies: EndpointIdPolicyMap, raw: string): EndpointIdPolicy | undefined => {
    const normalized = normalizeEndpointToken(raw);
    if (!normalized) return undefined;
    if (policies[normalized]) return policies[normalized];

    for (const entry of Object.values(policies)) {
        const normalizedTokens = [...entry.tokens, ...entry.origins];
        for (const token of normalizedTokens) {
            if (!token) continue;
            if (hasRuleMatch(token, normalized) || hasRuleMatch(normalized, token)) {
                return entry;
            }
        }
    }
    return policies["*"];
};

export const resolveEndpointIdPolicyStrict = (policies: EndpointIdPolicyMap, raw: string): EndpointIdPolicy | undefined => {
    const normalized = normalizeEndpointToken(raw);
    if (!normalized) return undefined;
    if (policies[normalized] && normalized !== "*") return policies[normalized];

    const entries = Object.entries(policies).filter(([id]) => id !== "*" && id);
    for (const [, policy] of entries) {
        const normalizedTokens = [...(policy.tokens || []), ...(policy.origins || [])];
        for (const token of normalizedTokens) {
            if (!token) continue;
            if (hasRuleMatch(token, normalized) || hasRuleMatch(normalized, token)) {
                return policy;
            }
        }
    }

    return undefined;
};

const stripPort = (value: string): string => {
    const trimmed = normalizeEndpointToken(value);
    const at = trimmed.lastIndexOf(":");
    if (at <= 0) return trimmed;
    const host = trimmed.slice(0, at);
    const candidate = trimmed.slice(at + 1);
    if (/^\d+$/.test(candidate)) return host;
    return trimmed;
};

export const resolveEndpointForwardTarget = (raw: string, sourceId: string, policies: EndpointIdPolicyMap): string => {
    const requested = stripPort(normalizeEndpointToken(raw));
    if (requested) {
        const matched = resolveEndpointIdPolicy(policies, requested);
        return matched && matched.id !== "*" ? matched.id : requested;
    }
    let current = normalizeEndpointToken(sourceId);
    if (!current) return "";
    const visited = new Set<string>();
    for (let i = 0; i < 8; i++) {
        if (visited.has(current)) break;
        visited.add(current);
        const policy = resolveEndpointIdPolicy(policies, current);
        const forward = normalizePolicyForward(policy?.forward || "self");
        if (!forward || forward === "self") return current;
        current = forward === "self" ? sourceId : forward;
    }
    return current;
};

export const resolveEndpointPolicyRoute = (sourceRaw: string, targetRaw: string, policies: EndpointIdPolicyMap): EndpointRouteDecision => {
    const source = resolveEndpointIdPolicy(policies, sourceRaw) || policies["*"];
    const target = resolveEndpointIdPolicy(policies, targetRaw) || policies["*"];
    const sourceToken = normalizeEndpointToken(sourceRaw);
    const targetToken = normalizeEndpointToken(targetRaw);
    const outgoing = isAllowedByRules(source?.allowedOutcoming || ["*"], targetToken);
    const incoming = isAllowedByRules(target?.allowedIncoming || ["*"], sourceToken);
    const allowed = outgoing && incoming;
    const reason = allowed ? "routing allowed by endpoint policy" : sourceToken && targetToken && sourceRaw && targetRaw ? `routing denied by endpoint policy source=${sourceToken},target=${targetToken}` : "routing denied by endpoint policy";
    return {
        allowed,
        sourcePolicy: source,
        targetPolicy: target,
        source: sourceToken,
        target: targetToken,
        reason
    };
};

export type EndpointTransportPreference = {
    transports: EndpointTransportMode[];
    hasExplicitRelation: boolean;
    sourceMatchedRule?: string;
    targetMatchedRule?: string;
};

export const resolveEndpointTransportPreference = (
    sourceRaw: string,
    targetRaw: string,
    policies: EndpointIdPolicyMap
): EndpointTransportPreference => {
    const normalizedSource = normalizeEndpointToken(sourceRaw);
    const normalizedTarget = normalizeEndpointToken(targetRaw);
    if (!normalizedSource || !normalizedTarget) {
        return { transports: [...DEFAULT_TRANSPORT_PLAN], hasExplicitRelation: false };
    }

    const sourcePolicy = resolveEndpointIdPolicyStrict(policies, normalizedSource) || resolveEndpointIdPolicy(policies, normalizedSource);
    const targetPolicy = resolveEndpointIdPolicyStrict(policies, normalizedTarget) || resolveEndpointIdPolicy(policies, normalizedTarget);
    const sourceRelation = findRelationForTarget(sourcePolicy?.relations, normalizedTarget);
    const targetRelation = findRelationForTarget(targetPolicy?.relations, normalizedSource);

    const hasExplicitRelation = Boolean(sourceRelation || targetRelation);
    if (!hasExplicitRelation) {
        return {
            transports: [...DEFAULT_TRANSPORT_PLAN],
            hasExplicitRelation: false
        };
    }

    const selected = new Set<EndpointTransportMode>();

    if (sourceRelation && isOwnerToPeerTransport(sourceRelation.hint.direction)) {
        sourceRelation.hint.transports.forEach((transport) => selected.add(transport));
    }

    if (targetRelation && isPeerToOwnerTransport(targetRelation.hint.direction)) {
        targetRelation.hint.transports.forEach((transport) => selected.add(transport));
    }

    if (selected.size === 0) {
        return {
            transports: [],
            hasExplicitRelation: true,
            sourceMatchedRule: sourceRelation?.key,
            targetMatchedRule: targetRelation?.key
        };
    }

    const ordered = DEFAULT_TRANSPORT_PLAN.filter((transport) => selected.has(transport));
    return {
        transports: ordered,
        hasExplicitRelation: true,
        sourceMatchedRule: sourceRelation?.key,
        targetMatchedRule: targetRelation?.key
    };
};

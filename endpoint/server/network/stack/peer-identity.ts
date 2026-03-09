import { resolveNetworkAlias, type NetworkAliasMap } from "./topology.ts";

type TopologyPeerAliasEntry = {
    id?: unknown;
    peerId?: unknown;
    label?: unknown;
    aliases?: unknown;
    alias?: unknown;
    host?: unknown;
    ip?: unknown;
    ips?: unknown;
    originId?: unknown;
    originHost?: unknown;
    originHosts?: unknown;
    originDomain?: unknown;
    originDomains?: unknown;
    originMask?: unknown;
    originMasks?: unknown;
};

const normalizeToken = (value: string): string => value.trim().toLowerCase();
const looksLikeAliasedHostTarget = (value: string): boolean => {
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (/^\[[^\]]+\](?::\d{1,5})?$/.test(trimmed)) return true;
    if (/^\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?$/.test(trimmed)) return true;
    if (/^[a-zA-Z0-9._-]+(?::\d{1,5})?$/.test(trimmed)) return true;
    return false;
};

const normalizeAliasStringList = (value: unknown): string[] => {
    if (Array.isArray(value))
        return value
            .map((item) => String(item || "").trim())
            .filter(Boolean)
            .map(normalizeToken)
            .filter(Boolean);

    if (typeof value === "string") {
        return value
            .split(/[;,]/)
            .map((item) => String(item || "").trim())
            .filter(Boolean)
            .map(normalizeToken)
            .filter(Boolean);
    }

    return [];
};

const stripAliasPrefix = (value: string, aliases?: NetworkAliasMap): string => {
    const trimmed = value.trim();
    if (!trimmed) return trimmed;

    const match = trimmed.match(/^([A-Za-z][A-Za-z0-9_-]*):(.*)$/);
    if (!match || !aliases) return trimmed;

    const prefix = match[1].toLowerCase();
    const aliasMapped = resolveNetworkAlias(aliases, prefix);
    if (aliasMapped) return aliasMapped;

    const aliasTarget = match[2].trim();
    if (looksLikeAliasedHostTarget(aliasTarget)) return aliasTarget;
    return resolveNetworkAlias(aliases, trimmed) || trimmed;
};

const collectTopologyAliases = (source: TopologyPeerAliasEntry): string[] => {
    const out: string[] = [];
    const multi = normalizeAliasStringList(source.aliases);
    if (multi.length) out.push(...multi);
    const singleAlias = normalizeToken(String(source.alias || "").trim());
    if (singleAlias) out.push(singleAlias);
    return out;
};

const getTopologyCandidateList = (source: TopologyPeerAliasEntry): string[] => {
    const peers = normalizeAliasStringList([source.id, source.peerId, source.label]);
    return Array.from(new Set(peers));
};

const getTopologyOriginList = (source: TopologyPeerAliasEntry): string[] => {
    const out: string[] = [];
    out.push(...normalizeAliasStringList(source.host));
    out.push(...normalizeAliasStringList(source.ip));
    out.push(...normalizeAliasStringList(source.ips));
    out.push(...normalizeAliasStringList(source.originHost));
    out.push(...normalizeAliasStringList(source.originHosts));
    out.push(...normalizeAliasStringList(source.originDomain));
    out.push(...normalizeAliasStringList(source.originDomains));
    out.push(...normalizeAliasStringList(source.originMask));
    out.push(...normalizeAliasStringList(source.originMasks));
    return out;
};

export type PeerIdentitySourceKind = "device-id" | "peer-label" | "label-contains" | "alias" | "topology-peer-id" | "topology-id" | "topology-label" | "topology-origin" | "topology-alias" | "fallback";

export type PeerIdentityResolution = {
    peerId: string;
    raw: string;
    sourceKind: PeerIdentitySourceKind;
    source?: string;
};

export type PeerIdentityInput = {
    id: string;
    label?: string;
    peerId?: string;
};

export type TopologyPeerProfile = {
    peerId?: string;
    id?: string;
    label?: string;
    peerLabel?: string;
    aliases?: string[];
};

export type PeerIdentityResolutionContext = {
    peers: PeerIdentityInput[];
    aliases?: NetworkAliasMap;
    topology?: Array<Record<string, any>>;
};

const isPeerAliasMatch = (source: string, target: string): boolean => {
    if (!source || !target) return false;
    const value = normalizeToken(source);
    return value === target || value.includes(target) || target.includes(value);
};

const readFromTopologyNode = (node: TopologyPeerProfile, target: string): { peerId: string; kind: PeerIdentitySourceKind } | undefined => {
    const nodeRecord = node as unknown as TopologyPeerAliasEntry;
    const aliases = collectTopologyAliases(nodeRecord);
    const candidates = getTopologyCandidateList(nodeRecord);
    const label = normalizeToken(node.label || node.peerLabel || "").trim();

    for (const alias of aliases) {
        if (alias && isPeerAliasMatch(alias, target)) {
            const peerId = normalizeToken(String(node.peerId || node.id || alias).trim());
            if (!peerId) continue;
            return { peerId, kind: "topology-alias" };
        }
    }

    const candidate = candidates.find((value) => value === target);
    if (candidate) {
        const peerId = normalizeToken(String(node.peerId || node.id || candidate).trim());
        if (!peerId) return undefined;
        const isPeerIdSource = normalizeToken(node.peerId || "").trim() === candidate;
        return {
            peerId,
            kind: isPeerIdSource ? "topology-peer-id" : "topology-id"
        };
    }

    if (label && isPeerAliasMatch(label, target)) {
        const peerId = normalizeToken(String(node.peerId || node.id || "").trim());
        if (peerId) return { peerId, kind: "topology-label" };
    }

    const nodeOrigins = getTopologyOriginList(nodeRecord);
    if (nodeOrigins.length > 0 && nodeOrigins.includes(target)) {
        const peerId = normalizeToken(String(node.peerId || node.id || "").trim());
        if (peerId) return { peerId, kind: "topology-origin" };
    }

    return undefined;
};

export const resolvePeerIdentity = (rawInput: string, context: PeerIdentityResolutionContext): PeerIdentityResolution | undefined => {
    const raw = normalizeToken(rawInput || "");
    if (!raw) return undefined;

    const aliases = context?.aliases || {};
    const aliasNormalized = stripAliasPrefix(rawInput || "", aliases);
    const resolvedAlias = resolveNetworkAlias(aliases, aliasNormalized) || aliasNormalized;
    const normalized = normalizeToken(resolvedAlias || raw);

    const peers = Array.isArray(context?.peers) ? context.peers : [];
    const exactPeer = peers.find((peer) => normalizeToken(peer.id) === normalized);
    if (exactPeer) {
        const peerId = normalizeToken((exactPeer.peerId || exactPeer.id || "").trim());
        if (peerId) return { peerId, raw: normalized, sourceKind: "device-id", source: exactPeer.id };
    }

    const exactLabel = peers.find((peer) => normalizeToken(peer.label || "") === normalized);
    if (exactLabel) {
        const peerId = normalizeToken((exactLabel.peerId || exactLabel.id || "").trim());
        if (peerId) return { peerId, raw: normalized, sourceKind: "peer-label", source: exactLabel.label };
    }

    const containsLabel = peers.find((peer) => {
        const label = normalizeToken(peer.label || "");
        return typeof label === "string" && label.length > 0 && (label.includes(normalized) || normalized.includes(label));
    });
    if (containsLabel) {
        const peerId = normalizeToken((containsLabel.peerId || containsLabel.id || "").trim());
        if (peerId) return { peerId, raw: normalized, sourceKind: "label-contains", source: containsLabel.label };
    }

    if (resolvedAlias && resolvedAlias !== raw) {
        const aliasPeer = peers.find((peer) => normalizeToken(peer.id) === normalizeToken(resolvedAlias)) || peers.find((peer) => normalizeToken(peer.label || "") === normalizeToken(resolvedAlias));
        if (aliasPeer) {
            const peerId = normalizeToken((aliasPeer.peerId || aliasPeer.id || "").trim());
            if (peerId) return { peerId, raw: normalizeToken(resolvedAlias), sourceKind: "alias", source: resolvedAlias };
        }
    }

    const topologyNodes = Array.isArray(context?.topology) ? (context.topology as TopologyPeerProfile[]) : [];
    for (const node of topologyNodes) {
        const nodeHit = readFromTopologyNode(node, normalized);
        if (nodeHit) return { peerId: nodeHit.peerId, raw: normalized, sourceKind: nodeHit.kind, source: (node as TopologyPeerAliasEntry).id as string | undefined };
    }

    return { peerId: normalized, raw: normalized, sourceKind: "fallback" };
};

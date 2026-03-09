// =========================
// HTTP Routes
// =========================

import { writeClipboard, setBroadcasting } from "../io/clipboard.ts";
import config from "../config/config.ts";
import { pickEnvBoolLegacy } from "../lib/env.ts";
import { normalizeEndpointPolicies, resolveEndpointIdPolicyStrict } from "../network/stack/endpoint-policy.ts";
import { readFileSync } from "node:fs";

function setUtf8Plain(reply: any) {
    reply.header("Content-Type", "text/plain; charset=utf-8");
}

function isAuthorized(request: any): boolean {
    const secret = (config as any)?.secret || "";
    if (!secret) return true;

    const headerToken = request?.headers?.["x-auth-token"] || request?.headers?.["X-Auth-Token"] || request?.headers?.["x-auth_token"];

    if (typeof headerToken === "string" && headerToken === secret) return true;

    const auth = request?.headers?.authorization || request?.headers?.Authorization;
    if (typeof auth === "string") {
        const m = auth.match(/^Bearer\s+(.+)$/i);
        if (m && m[1] === secret) return true;
    }

    return false;
}

const isClipboardLoggingEnabled = () => {
    return pickEnvBoolLegacy("CWS_CLIPBOARD_LOGGING", true) !== false;
};

const normalizeClipboardText = (body: any): string => {
    if (typeof body === "string") return body.trim();
    if (Buffer.isBuffer(body)) return body.toString("utf8").trim();
    if (body instanceof Uint8Array) return Buffer.from(body).toString("utf8").trim();
    if (!body || typeof body !== "object") return "";
    const candidates = [
        body.text,
        body.body,
        body.payload,
        body.data,
        body.content,
        body.clipboard,
        body.value,
        body.message
    ];
    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim()) {
            return candidate.trim();
        }
        if (Buffer.isBuffer(candidate)) {
            const decoded = candidate.toString("utf8").trim();
            if (decoded) return decoded;
        }
        if (candidate instanceof Uint8Array) {
            const decoded = Buffer.from(candidate).toString("utf8").trim();
            if (decoded) return decoded;
        }
    }
    return "";
};

const normalizeClipboardTarget = (value: any): string[] => {
    if (typeof value !== "string") return [];
    const normalized = value.trim();
    if (!normalized) return [];
    return normalized
        .split(/[;,]/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
};

const summarizeClipboardText = (text: string): { len: number; preview: string } => {
    const value = String(text ?? "");
    const compact = value.replace(/\s+/g, " ").trim();
    const previewLimit = 64;
    return {
        len: value.length,
        preview: compact.length > previewLimit ? `${compact.slice(0, previewLimit)}...` : compact
    };
};

const normalizeClipboardId = (value: any): string => String(value || "").trim().toLowerCase();
const rawClientsPolicyFallback = (() => {
    try {
        const clientsPath = new URL("../config/clients.json", import.meta.url);
        const text = readFileSync(clientsPath, "utf8");
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === "object" ? (parsed as Record<string, any>) : {};
    } catch {
        return {} as Record<string, any>;
    }
})();

const normalizeClipboardToken = (value: any): string => {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) return "";
    const bearer = raw.match(/^bearer\s+(.+)$/i);
    if (bearer?.[1]) return bearer[1].trim();
    if (raw.startsWith("inline:")) return raw.slice("inline:".length).trim();
    if (raw.startsWith("token:")) return raw.slice("token:".length).trim();
    if (raw.startsWith("env:") || raw.startsWith("fs:")) return "";
    return raw;
};

const normalizeIpForMatch = (value: string): string => {
    const trimmed = String(value || "").trim().toLowerCase();
    if (!trimmed) return "";
    const first = trimmed.split(",")[0]?.trim() || trimmed;
    const noZone = first.split("%")[0];
    const noBrackets = noZone.replace(/^\[(.*)\]$/, "$1");
    const noV4Prefix = noBrackets.replace(/^::ffff:/, "");
    if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(noV4Prefix)) {
        return noV4Prefix.replace(/:\d+$/, "");
    }
    return noV4Prefix;
};

const extractRequestIps = (request: any): string[] => {
    const out = new Set<string>();
    const push = (raw: any) => {
        const normalized = normalizeIpForMatch(String(raw || ""));
        if (normalized) out.add(normalized);
    };
    const forwarded = String(request?.headers?.["x-forwarded-for"] || "").trim();
    if (forwarded) {
        forwarded
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean)
            .forEach(push);
    }
    push(request?.ip);
    push(request?.socket?.remoteAddress);
    return Array.from(out);
};

const extractPrimaryRequestIp = (request: any): string => {
    const ips = extractRequestIps(request);
    return ips[0] || "";
};

const extractClipboardShareTargets = (policy: any): string[] => {
    const modules = policy?.modules;
    if (!modules || typeof modules !== "object") return [];
    const clipboard = (modules as any).clipboard;
    if (!Array.isArray(clipboard)) return [];
    const out = new Set<string>();
    for (const entry of clipboard) {
        if (!entry || typeof entry !== "object") continue;
        const shareTo = Array.isArray((entry as any).shareTo) ? (entry as any).shareTo : [];
        for (const target of shareTo) {
            const normalized = normalizeClipboardId(target);
            if (normalized) out.add(normalized);
        }
    }
    return Array.from(out);
};

const extractClipboardAcceptFromTargets = (policy: any): string[] => {
    const modules = policy?.modules;
    if (!modules || typeof modules !== "object") return [];
    const clipboard = (modules as any).clipboard;
    if (!Array.isArray(clipboard)) return [];
    const out = new Set<string>();
    for (const entry of clipboard) {
        if (!entry || typeof entry !== "object") continue;
        const acceptFrom = Array.isArray((entry as any).acceptFrom) ? (entry as any).acceptFrom : [];
        for (const source of acceptFrom) {
            const normalized = normalizeClipboardId(source);
            if (normalized) out.add(normalized);
        }
    }
    return Array.from(out);
};

const getRawEndpointPolicy = (rawPolicyMap: Record<string, any>, normalizedId: string): any | undefined => {
    if (!normalizedId) return undefined;
    const visited = new Set<string>();
    let current = normalizedId;
    for (let depth = 0; depth < 8; depth++) {
        if (!current || visited.has(current)) break;
        visited.add(current);
        const matchingKeys = Object.keys(rawPolicyMap).filter((key) => normalizeClipboardId(key) === current);
        if (!matchingKeys.length) return undefined;

        // Prefer real object policy over alias-string entry when both keys normalize to same id.
        for (const key of matchingKeys) {
            const candidate = rawPolicyMap[key];
            if (candidate && typeof candidate === "object") {
                return candidate;
            }
        }

        // No direct object among normalized matches; follow alias if present.
        let followed = false;
        for (const key of matchingKeys) {
            const candidate = rawPolicyMap[key];
            if (typeof candidate !== "string") continue;
            const aliasMatch = candidate.match(/^alias:(.+)$/i);
            if (!aliasMatch) continue;
            const aliasRaw = String(aliasMatch[1] || "").trim();
            if (!aliasRaw) continue;
            if (rawPolicyMap[aliasRaw] && typeof rawPolicyMap[aliasRaw] === "object") {
                return rawPolicyMap[aliasRaw];
            }
            const next = normalizeClipboardId(aliasRaw);
            if (!next || next === current) continue;
            current = next;
            followed = true;
            break;
        }
        if (followed) continue;
        return undefined;
    }
    return undefined;
};

const resolveSourceEndpointPolicy = (requestBody: any, request: any): { sourceId: string; targets: string[] } | null => {
    const runtimeRaw = (((config as any)?.endpointIDs || {}) as Record<string, any>);
    const rawPolicyMap = Object.keys(rawClientsPolicyFallback).length ? { ...runtimeRaw, ...rawClientsPolicyFallback } : runtimeRaw;
    const policyMap = normalizeEndpointPolicies(rawPolicyMap);
    const requestIps = extractRequestIps(request);
    const requestToken = normalizeClipboardToken(request?.headers?.["x-auth-token"] || request?.headers?.authorization || requestBody?.token || requestBody?.userKey);
    const sourceHints = [
        requestBody?.from,
        requestBody?.source,
        requestBody?.sourceId,
        requestBody?.src,
        requestBody?.userId,
        requestBody?.clientId
    ]
        .map((value) => normalizeClipboardId(value))
        .filter(Boolean);

    for (const hint of sourceHints) {
        if (hint === "*") continue;
        const normalizedPolicy = resolveEndpointIdPolicyStrict(policyMap, hint);
        const sourceId = normalizeClipboardId(normalizedPolicy?.id || hint);
        if (!sourceId || sourceId === "*") continue;
        const rawPolicy = getRawEndpointPolicy(rawPolicyMap, sourceId);
        const targets = extractClipboardShareTargets(rawPolicy);
        if (targets.length > 0) {
            return { sourceId, targets };
        }
    }

    for (const [policyId, rawPolicy] of Object.entries(policyMap as Record<string, any>)) {
        if (!policyId || policyId === "*") continue;
        const policy = rawPolicy || {};
        const origins = Array.isArray(policy.origins) ? policy.origins.map((value: any) => normalizeIpForMatch(String(value || ""))).filter(Boolean) : [];
        const tokens = Array.isArray(policy.tokens) ? policy.tokens.map((value: any) => normalizeClipboardToken(value)).filter(Boolean) : [];
        const hasIpMatch = requestIps.some((ip) => origins.includes(ip));
        const wildcardToken = tokens.includes("*");
        const hasTokenMatch = !!requestToken && (tokens.includes(requestToken) || wildcardToken);
        if (!hasIpMatch && !hasTokenMatch) continue;
        const policySourceId = normalizeClipboardId(policy.id || policyId);
        const sourcePolicyRaw = getRawEndpointPolicy(rawPolicyMap, policySourceId);
        const targets = extractClipboardShareTargets(sourcePolicyRaw);
        if (targets.length > 0) {
            return { sourceId: policySourceId, targets };
        }
    }

    // Fallback: if shareTo is missing in runtime policy, route to peers that explicitly accept clipboard from this source.
    for (const [policyId, rawPolicy] of Object.entries(rawPolicyMap)) {
        const normalizedTargetId = normalizeClipboardId(policyId);
        if (!normalizedTargetId || normalizedTargetId === "*") continue;
        const policyObject = rawPolicy && typeof rawPolicy === "object" ? rawPolicy : getRawEndpointPolicy(rawPolicyMap, normalizedTargetId);
        if (!policyObject || typeof policyObject !== "object") continue;
        const accepts = extractClipboardAcceptFromTargets(policyObject);
        if (!accepts.length) continue;
        const sourceByHint = sourceHints.some((hint) => accepts.includes(hint));
        const sourceByIp = requestIps.some((ip) => accepts.includes(ip));
        if (!sourceByHint && !sourceByIp) continue;
        const flags = policyObject.flags && typeof policyObject.flags === "object" ? policyObject.flags : {};
        if ((flags as any).gateway === true) continue;
        return { sourceId: sourceHints[0] || requestIps[0] || "unknown", targets: [normalizedTargetId] };
    }

    // Final deterministic safety net for this lab topology:
    // route plain clipboard from 192.168.0.110 toward Android endpoint id if unresolved.
    if (requestIps.includes("192.168.0.110")) {
        return { sourceId: "l-192.168.0.110", targets: ["l-192.168.0.196"] };
    }

    return null;
};

const collectClipboardTargets = (requestBody: any): string[] => {
    if (!requestBody || typeof requestBody !== "object") return [];
    const out = new Set<string>();
    const pushTargets = (value: any) => {
        for (const entry of normalizeClipboardTarget(value)) {
            out.add(entry);
        }
    };

    pushTargets(requestBody.targetDeviceId);
    pushTargets(requestBody.deviceId);
    pushTargets(requestBody.targetId);
    pushTargets(requestBody.target);
    pushTargets(requestBody.to);
    if (Array.isArray(requestBody.targets)) {
        for (const target of requestBody.targets) {
            pushTargets(target);
        }
    }
    return Array.from(out);
};

const buildClipboardBroadcastPayload = (requestBody: any, text: string, request: any) => {
    let targets = collectClipboardTargets(requestBody);
    let sourceId = "";
    if (!targets.length) {
        const resolvedSource = resolveSourceEndpointPolicy(requestBody, request);
        if (resolvedSource) {
            targets = resolvedSource.targets;
            sourceId = resolvedSource.sourceId;
        }
    }
    if (!targets.length || !text) return null;
    const resolvedClientId = typeof requestBody.clientId === "string" ? requestBody.clientId.trim() : "";
    const resolvedToken = typeof requestBody.token === "string" ? requestBody.token.trim() : "";
    const requests = targets.map((target) => ({
        deviceId: target,
        body: text,
        method: "POST"
    }));
    const payload: any = {
        requests
    };
    if (resolvedClientId) payload.clientId = resolvedClientId;
    if (resolvedToken) payload.token = resolvedToken;
    if (sourceId) {
        payload.userId = sourceId;
        payload.from = sourceId;
        payload.source = sourceId;
    }
    if (typeof request.headers?.["x-auth-token"] === "string") {
        payload.token = payload.token || String(request.headers["x-auth-token"]).trim();
    }
    return payload;
};

export function registerRoutes(app: any) {
    // POST /clipboard  (Fastify-style)
    app.post("/clipboard", async (request: any, reply: any) => {
        if (!isAuthorized(request)) {
            setUtf8Plain(reply);
            return reply.code(401).send("Unauthorized");
        }

        try {
            const text = normalizeClipboardText(request.body);
            const relayPayload = buildClipboardBroadcastPayload(request.body, text, request);
            const source = String(
                request?.headers?.["x-forwarded-for"] ||
                request?.ip ||
                request?.socket?.remoteAddress ||
                ""
            ).trim() || "unknown";
            const sourceIp = extractPrimaryRequestIp(request) || source;

            if (!text) {
                setUtf8Plain(reply);
                return reply.code(400).send("No text provided");
            }

            if (relayPayload) {
                if (isClipboardLoggingEnabled()) {
                    app.log.info(
                        {
                            source,
                            sourceIp,
                            via: "http:/clipboard->dispatch",
                            targets: relayPayload.requests?.map((item: any) => item?.deviceId).filter(Boolean),
                            text: summarizeClipboardText(text)
                        },
                        "Clipboard relay request accepted"
                    );
                }
                const relayResponse = await app.inject({
                    method: "POST",
                    url: "/core/ops/http/dispatch",
                    headers: {
                        "content-type": "application/json"
                    },
                    payload: relayPayload
                });
                const relayBody = typeof relayResponse.body === "string" ? relayResponse.body : JSON.stringify(relayResponse.body ?? {});
                return reply.code(relayResponse.statusCode || 200).send(relayBody);
            }
            if (isClipboardLoggingEnabled()) {
                app.log.warn(
                    {
                        source,
                            sourceIp,
                        via: "http:/clipboard->local-write",
                        reason: "relay-targets-unresolved",
                        bodyType: typeof request.body,
                        text: summarizeClipboardText(text)
                    },
                    "Clipboard relay skipped; fallback to local write"
                );
            }

            setBroadcasting(true);
            const written = await writeClipboard(text);
            if (written) {
                if (isClipboardLoggingEnabled()) {
                    app.log.info(
                        {
                            source,
                            via: "http:/clipboard->local-write",
                            text: summarizeClipboardText(text)
                        },
                        "Copied to clipboard"
                    );
                }
            } else {
                if (isClipboardLoggingEnabled()) {
                    app.log.warn("Clipboard backend unavailable, request accepted without local write");
                }
                setUtf8Plain(reply);
                return reply.code(204).send("Clipboard unavailable");
            }
            setUtf8Plain(reply);
            return reply.code(200).send("OK");
        } catch (err) {
            if (isClipboardLoggingEnabled()) {
                app.log.error({ err }, "Clipboard error");
            }
            setUtf8Plain(reply);
            return reply.code(500).send("Clipboard error");
        } finally {
            setBroadcasting(false);
        }
    });
}

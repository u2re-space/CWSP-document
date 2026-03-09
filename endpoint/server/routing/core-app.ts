import { readFile } from "node:fs/promises";
import path from "node:path";

import { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import compress from "@fastify/compress";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import formbody from "@fastify/formbody";

import { ADMIN_DIR } from "../lib/paths.ts";
import { registerAuthRoutes } from "./auth.ts";
import { registerStorageRoutes } from "./storage.ts";
import { registerGptRoutes } from "../gpt/index.ts";
import { loadEndpointDotenv } from "../gpt/provider.ts";
import { pickEnvBoolLegacy, pickEnvNumberLegacy } from "../lib/env.ts";
import { parsePortableInteger } from "../lib/parsing.ts";
import { registerCoreSettingsEndpoints,registerCoreSettingsRoutes } from "./userSettings.ts";

const BOOT_AT_MS = Date.now();
const SERVICE_NAME = "cws";
const SERVICE_VERSION = String(process.env.npm_package_version || "unknown");

const PHOSPHOR_STYLES = ["thin", "light", "regular", "bold", "fill", "duotone"] as const;
type PhosphorStyle = (typeof PHOSPHOR_STYLES)[number];

const ADMIN_FALLBACK_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M12 2a2.6 2.6 0 0 1 2.6 2.6V7.4l4.1 2.1c.6.3 1 1 1 1.7v4.6c0 .7-.4 1.4-1 1.7l-4.1 2.1v1.6c0 1.4-1.2 2.6-2.6 2.6H6.6C5.2 21 4 19.8 4 18.4V13.2c0-.7.4-1.4 1-1.7l4.2-2.1V4.6A2.6 2.6 0 0 1 11.8 2H12Zm-1 12.1v4.8c0 .5.4.9.9.9h6.1c.5 0 .9-.4.9-.9V13l-.2-.1l-3.6-1.8V11h-4v3.1Zm-1-8.5V19c0 .4-.3.7-.7.7h-.6c-.4 0-.7-.3-.7-.7v-1.6L4.4 14.7A.6.6 0 0 1 4 14.1V8.9a.6.6 0 0 1 .4-.6L10 5.3V8h2V3.6c0-.4-.3-.8-.8-.8H11.7c-.4 0-.7.3-.7.7Z"/>
</svg>`;

const isValidPhosphorStyle = (value: string): value is PhosphorStyle => {
    return (PHOSPHOR_STYLES as readonly string[]).includes(value);
};

const isValidPhosphorIconName = (value: string): boolean => /^[a-z0-9-]+$/i.test(value);

const withStyleSuffix = (style: PhosphorStyle, iconName: string): string => {
    if (style === "duotone") return `${iconName}-duotone`;
    if (style === "regular") return iconName;
    return `${iconName}-${style}`;
};

const phosphorCdnUrl = (style: PhosphorStyle, iconName: string): string => {
    const fileName = withStyleSuffix(style, iconName);
    return `https://cdn.jsdelivr.net/npm/@phosphor-icons/core@2/assets/${style}/${fileName}.svg`;
};

const proxyPhosphorIcon = async (reply: FastifyReply, style: string, iconRaw: string) => {
    const iconName = iconRaw.replace(/\.svg$/i, "").trim().toLowerCase();
    const normalizedStyle = style.trim().toLowerCase();

    if (!isValidPhosphorStyle(normalizedStyle)) {
        return reply.code(400).send({ ok: false, error: `Invalid phosphor style: ${style}` });
    }
    if (!isValidPhosphorIconName(iconName)) {
        return reply.code(400).send({ ok: false, error: `Invalid icon name: ${iconRaw}` });
    }

    const upstreamUrl = phosphorCdnUrl(normalizedStyle, iconName);
    try {
        const res = await fetch(upstreamUrl, {
            method: "GET",
            headers: { accept: "image/svg+xml,text/plain,*/*" }
        });

        if (!res.ok) {
            return reply.code(res.status).send({
                ok: false,
                error: `Icon not found in upstream source`,
                style: normalizedStyle,
                icon: iconName
            });
        }

        const svg = await res.text();
        reply.header("Content-Type", "image/svg+xml; charset=utf-8");
        reply.header("Cache-Control", "public, max-age=604800");
        return reply.send(svg);
    } catch (error) {
        return reply.code(502).send({
            ok: false,
            error: "Failed to fetch upstream icon",
            details: String(error)
        });
    }
};

const sendAdminIcon = (reply: FastifyReply) => {
    return reply
        .type("image/svg+xml; charset=utf-8")
        .header("Cache-Control", "public, max-age=604800")
        .send(ADMIN_FALLBACK_ICON);
};

const debugRequestLoggingEnabled = (): boolean =>
    pickEnvBoolLegacy("REQUEST_DEBUG_LOGGING", true) !== false;

const hasClipboardPayloadHint = (body: unknown, url?: string): boolean => {
    if (typeof url === "string" && url.toLowerCase() === "/api/broadcast" && typeof body === "object" && body !== null) {
        const payload = body as Record<string, any>;
        if (Array.isArray(payload.requests)) return true;
        if (typeof (payload as any).action === "string" && String((payload as any).action).toLowerCase().includes("clipboard")) return true;
        return false;
    }
    if (typeof url === "string" && url.toLowerCase() === "/clipboard") return true;
    return false;
};

const sanitizeLogValue = (value: unknown): unknown => {
    if (value === null || typeof value === "undefined") return value;
    if (Array.isArray(value)) {
        return value.map((entry) => sanitizeLogValue(entry));
    }
    if (typeof value === "object") {
        if (Buffer.isBuffer(value)) {
            return `<buffer:${value.length}>`;
        }
        if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
            const bytes = value instanceof ArrayBuffer ? value.byteLength : value.byteLength;
            return `<binary:${bytes}>`;
        }
        const input = value as Record<string, any>;
        const output: Record<string, any> = {};
        const sensitiveKeys = new Set(["text", "body", "payload", "data", "clipboard", "content"]);
        for (const key of Object.keys(input)) {
            if (sensitiveKeys.has(key.toLowerCase())) {
                const raw = input[key];
                if (typeof raw === "string") {
                    output[key] = raw.length ? `<redacted ${raw.length} chars>` : "";
                } else if (Array.isArray(raw)) {
                    output[key] = raw.map((entry) =>
                        typeof entry === "string" && entry.length ? `<redacted ${entry.length} chars>` : sanitizeLogValue(entry)
                    );
                } else {
                    output[key] = raw === null || typeof raw === "undefined" ? raw : sanitizeLogValue(raw);
                }
                continue;
            }
            output[key] = sanitizeLogValue(input[key]);
        }
        return output;
    }
    return value;
};

const tryPrettyJson = (body: unknown, maxChars: number): string => {
    try {
        if (typeof body === "string") {
            const parsed = body.trim().startsWith("{") || body.trim().startsWith("[") ? JSON.parse(body) : undefined;
            if (typeof parsed === "undefined") return body.length > maxChars ? `${body.slice(0, maxChars)}…(truncated)` : body;
            const pretty = JSON.stringify(parsed, null, 2);
            return pretty.length > maxChars ? `${pretty.slice(0, maxChars)}…(truncated)` : pretty;
        }
        const pretty = JSON.stringify(body, null, 2);
        return pretty.length > maxChars ? `${pretty.slice(0, maxChars)}…(truncated)` : pretty;
    } catch {
        const fallback = safeBodyPreview(body, maxChars);
        return fallback || "";
    }
};

const safeBodyPreview = (body: unknown, maxChars: number): string | undefined => {
    if (typeof body === "undefined") return undefined;
    if (body === null) return "null";
    if (typeof body === "string") return body.length > maxChars ? `${body.slice(0, maxChars)}…(truncated)` : body;
    if (Buffer.isBuffer(body)) {
        const s = body.toString("utf8", 0, Math.min(body.length, maxChars));
        return body.length > maxChars ? `${s}…(truncated)` : s;
    }
    if (body instanceof ArrayBuffer) {
        const buf = Buffer.from(body);
        const s = buf.toString("utf8", 0, Math.min(buf.length, maxChars));
        return buf.length > maxChars ? `${s}…(truncated)` : s;
    }
    if (ArrayBuffer.isView(body)) {
        const buf = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
        const s = buf.toString("utf8", 0, Math.min(buf.length, maxChars));
        return buf.length > maxChars ? `${s}…(truncated)` : s;
    }
    try {
        const s = JSON.stringify(body);
        return s.length > maxChars ? `${s.slice(0, maxChars)}…(truncated)` : s;
    } catch {
        const s = String(body);
        return s.length > maxChars ? `${s.slice(0, maxChars)}…(truncated)` : s;
    }
};

const formatBodyPreview = (req: FastifyRequest, maxChars: number): string | undefined => {
    const url = String((req as any).url || "").trim().toLowerCase();
    const rawBody = (req as any).body;
    if (typeof rawBody === "undefined") return undefined;

    if (!debugRequestLoggingEnabled()) return undefined;
    if (url === "/clipboard") {
        if (typeof rawBody === "string") return "<clipboard text omitted>";
        return tryPrettyJson(sanitizeLogValue(rawBody), maxChars);
    }
    if (url === "/api/broadcast" && hasClipboardPayloadHint(rawBody, url)) {
        return tryPrettyJson(sanitizeLogValue(rawBody), maxChars);
    }
    if (typeof rawBody === "string") {
        const asString = rawBody.trim();
        if (asString.startsWith("{") || asString.startsWith("[")) {
            return tryPrettyJson(asString, maxChars);
        }
    }
    if (typeof rawBody === "object") {
        return tryPrettyJson(sanitizeLogValue(rawBody), maxChars);
    }
    return safeBodyPreview(rawBody, maxChars);
};

const REQUEST_IDENTITY = Symbol("requestIdentity");

const readHeaderValue = (headers: Record<string, unknown> | undefined, key: string): string => {
    const value = headers?.[key];
    if (typeof value === "string") return value.trim();
    if (Array.isArray(value)) return String(value[0] || "").trim();
    return "";
};

const normalizeTokenFromAuthorization = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return "";
    const bearerMatch = trimmed.match(/^bearer\s+(.+)$/i);
    return bearerMatch?.[1]?.trim() || trimmed;
};

const resolveProtocolHint = (headers: Record<string, unknown> | undefined): string => {
    const fromForwardedProto = readHeaderValue(headers, "x-forwarded-proto");
    if (fromForwardedProto) return fromForwardedProto;
    const fromForwardedProtocol = readHeaderValue(headers, "x-forwarded-protocol");
    if (fromForwardedProtocol) return fromForwardedProtocol;
    const fromForwardedScheme = readHeaderValue(headers, "x-forwarded-scheme");
    if (fromForwardedScheme) return fromForwardedScheme;
    const via = readHeaderValue(headers, "via");
    return via ? "via-proxy" : "";
};

const resolveForwardedFromRequest = (headers: Record<string, unknown> | undefined): string => {
    const forwardedFor = readHeaderValue(headers, "x-forwarded-for");
    if (forwardedFor) return forwardedFor.split(",")[0].trim();
    const realIp = readHeaderValue(headers, "x-real-ip");
    if (realIp) return realIp;
    return "";
};

const extractRequestIdentity = (req: FastifyRequest): {
    userId: string;
    clientId: string;
    routeHint: string;
    sourceHint: string;
    token: string;
    forwarded: string;
    protocol: string;
    sourceHeaderHint: string;
} => {
    const body = ((req as any).body || {}) as Record<string, any>;
    const headers = (req.headers || {}) as Record<string, any>;
    const userId = String(body.userId || body.clientId || "").trim();
    const clientId = String(body.clientId || body.deviceId || "").trim();
    const routeHint = String(body.route || body.to || body.targetId || body.targetDeviceId || "").trim();
    const sourceHint = String(
        body.from || body.source || body.sourceId || body.src || body.suggestedSource || body.routeSource || body._routeSource || ""
    ).trim();
    const headerAuth = normalizeTokenFromAuthorization(readHeaderValue(headers, "authorization"));
    const token = String(
        body.userKey || body.token || body.clientKey || readHeaderValue(headers, "x-auth-token") || headerAuth || ""
    ).trim();
    const protocolHint = resolveProtocolHint(headers);
    const routeFromHeaders = readHeaderValue(headers, "x-route-source") || readHeaderValue(headers, "x-source-id") || readHeaderValue(headers, "x-source");
    return {
        userId,
        clientId,
        routeHint,
        sourceHint,
        token,
        forwarded: resolveForwardedFromRequest(headers),
        protocol: protocolHint,
        sourceHeaderHint: routeFromHeaders
    };
};

const formatRequestLog = (
    req: FastifyRequest,
    proto: string,
    localPort: number | string | undefined,
    remoteAddr: string | undefined,
    bodyPreview: string | undefined,
    identity: {
        userId: string;
        clientId: string;
        routeHint: string;
        sourceHint: string;
        token: string;
        forwarded: string;
        protocol: string;
        sourceHeaderHint: string;
    }
): string => {
    const lines = [
        `[req] ${proto}:${localPort || "?"} ${req.method} ${(req as any).url} from=${remoteAddr || "unknown"}`
    ];
    if (identity.userId || identity.clientId || identity.token || identity.sourceHint || identity.routeHint || identity.forwarded) {
        lines.push(
                `identity user=${identity.userId || "-"} client=${identity.clientId || "-"} source=${identity.sourceHint || "-"} route=${identity.routeHint || "-"} token=${identity.token || "-"} forwarded=${identity.forwarded || "none"} protocol=${identity.protocol || "na"} sourceHeader=${identity.sourceHeaderHint || "-"}`
        );
    }
    if (bodyPreview) {
        lines.push(`body=${bodyPreview}`);
    }
    return lines.join("\n");
};

const REQUEST_START_TIME = Symbol("requestStartTime");

const formatResponseLog = (req: FastifyRequest, reply: any): string => {
    const identity = (req as any)[REQUEST_IDENTITY] || {};
    const socket: any = (req as any).socket;
    const proto = socket?.encrypted ? "https" : "http";
    const localPort = socket?.localPort;
    const remoteAddr = (req as any).ip || socket?.remoteAddress;
    const elapsedMs = (() => {
        const start = (req as any)[REQUEST_START_TIME];
        if (typeof start === "number") return `${(Date.now() - start).toFixed(2)}ms`;
        return undefined;
    })();
    const status = typeof reply?.statusCode === "number" ? reply.statusCode : 0;
    const reqId = (req as any).id ? ` reqId=${(req as any).id}` : "";
    const timeLine = elapsedMs ? ` in ${elapsedMs}` : "";
    const userId = String(identity.userId || "").trim() || "unknown";
    return `[res] ${proto}:${localPort || "?"} ${req.method} ${(req as any).url} status=${status}${timeLine}${reqId} from=${remoteAddr || "unknown"} user=${userId}`;
};

const registerDebugRequestLogging = async (app: FastifyInstance): Promise<void> => {
    if (!debugRequestLoggingEnabled()) return;
        const configuredMaxChars = pickEnvNumberLegacy("REQUEST_DEBUG_LOG_BODY_MAX_CHARS", 64 * 1024);
        const resolvedMaxChars = parsePortableInteger(configuredMaxChars) ?? 64 * 1024;
        const maxChars = Math.max(256, Math.min(1024 * 1024, resolvedMaxChars));

    app.addHook("onRequest", async (req) => {
        (req as any)[REQUEST_START_TIME] = Date.now();
    });

    app.addHook("preHandler", async (req: FastifyRequest, _reply) => {
        const socket: any = (req as any).socket;
        const proto = socket?.encrypted ? "https" : "http";
        const localPort = socket?.localPort;
        const remoteAddr = (req as any).ip || socket?.remoteAddress;
        const bodyPreview = formatBodyPreview(req as any, maxChars);
        const identity = extractRequestIdentity(req);
        (req as any)[REQUEST_IDENTITY] = identity;
        const msg = formatRequestLog(req, proto, localPort, remoteAddr, bodyPreview, identity);
        console.log(msg);
    });

    app.addHook("onResponse", async (req, reply) => {
        console.log(formatResponseLog(req as any, reply));
    });
};

const noStore = (reply: FastifyReply): void => {
    reply.header("Cache-Control", "no-store");
    reply.header("Pragma", "no-cache");
    reply.header("Expires", "0");
};

export const registerCoreApp = async (app: FastifyInstance): Promise<void> => {
    loadEndpointDotenv();
    await registerDebugRequestLogging(app);
    await app.register(formbody);
    await app.register(cors, {
        origin: true,
        credentials: true,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    });
    app.addHook("onSend", async (req, reply, payload) => {
        const allowPrivateNetwork = pickEnvBoolLegacy("CORS_ALLOW_PRIVATE_NETWORK", true) !== false;
        if (!allowPrivateNetwork) return payload;

        const pnaHeader = String(req.headers["access-control-request-private-network"] || "").toLowerCase();
        if (pnaHeader === "true") {
            reply.header("Access-Control-Allow-Private-Network", "true");
            const existingVary = String(reply.getHeader("Vary") || "");
            const varyParts = existingVary
                .split(",")
                .map((part) => part.trim())
                .filter(Boolean);
            if (!varyParts.includes("Access-Control-Request-Private-Network")) {
                varyParts.push("Access-Control-Request-Private-Network");
            }
            if (varyParts.length > 0) {
                reply.header("Vary", varyParts.join(", "));
            }
        }
        return payload;
    });

    app.addContentTypeParser("text/plain", { parseAs: "string" }, async (_req: any, body: any) => {
        return body;
    });
    await app.register(compress, { global: true });
    await app.register(fastifyStatic, {
        list: true,
        root: ADMIN_DIR,
        prefix: "/admin/",
        decorateReply: true
    });

    app.get("/admin", async (_req, reply) => {
        reply.header("Content-Type", "text/html");
        reply.header("Cache-Control", "public, max-age=3600");
        reply.status(200);
        return reply?.send?.(await readFile(path.resolve(ADMIN_DIR, "index.html"), { encoding: "utf-8" })) as unknown as string;
    }) as unknown as FastifyReply;

    app.get("/admin/icon.svg", async (_req, reply) => {
        return sendAdminIcon(reply);
    });

    app.get("/icon.svg", async (_req, reply) => {
        return sendAdminIcon(reply);
    });

    app.get("/assets/icons/phosphor", async () => ({
        ok: true,
        source: "@phosphor-icons/core@2",
        styles: PHOSPHOR_STYLES
    }));

    app.get("/assets/icons/phosphor/:style/:icon", async (request: FastifyRequest<{ Params: { style: string; icon: string } }>, reply) => {
        return proxyPhosphorIcon(reply, request.params.style, request.params.icon);
    });

    app.get("/assets/icons/duotone", async () => ({
        ok: true,
        aliasOf: "/assets/icons/phosphor/duotone/:icon",
        styles: ["duotone"]
    }));

    app.get("/assets/icons/duotone/:icon", async (request: FastifyRequest<{ Params: { icon: string } }>, reply) => {
        return proxyPhosphorIcon(reply, "duotone", request.params.icon);
    });

    app.get("/assets/icons", async () => ({
        ok: true,
        source: "@phosphor-icons/core@2",
        defaultStyle: "duotone",
        styles: PHOSPHOR_STYLES,
        aliases: {
            duotone: "/assets/icons/duotone/:icon",
            style: "/assets/icons/:style/:icon",
            default: "/assets/icons/:icon"
        }
    }));

    app.get("/assets/icons/:style/:icon", async (request: FastifyRequest<{ Params: { style: string; icon: string } }>, reply) => {
        return proxyPhosphorIcon(reply, request.params.style, request.params.icon);
    });

    app.get("/assets/icons/:icon", async (request: FastifyRequest<{ Params: { icon: string } }>, reply) => {
        return proxyPhosphorIcon(reply, "duotone", request.params.icon);
    });

    app.get("/api", async () => ({
        ok: true,
        endpoints: [
            "/api/processing",
            "/api/request",
            "/api/broadcast",
            "/api/action",
            "/api/storage",
            "/api/ws",
            "/api/system/status"
        ]
    }));

    app.get("/healthz", async (_req, reply) => {
        noStore(reply);
        return reply.code(200).send({
            ok: true,
            service: SERVICE_NAME,
            status: "healthy",
            version: SERVICE_VERSION,
            timestamp: new Date().toISOString()
        });
    });

    app.get("/readyz", async (_req, reply) => {
        const diagnostics = {
            hasFetch: typeof fetch === "function",
            hasBroadcastChannel: typeof BroadcastChannel !== "undefined",
            hasCacheApi: typeof caches !== "undefined"
        };
        const ready = diagnostics.hasFetch;
        noStore(reply);
        return reply.code(ready ? 200 : 503).send({
            ok: ready,
            service: SERVICE_NAME,
            status: ready ? "ready" : "degraded",
            version: SERVICE_VERSION,
            diagnostics,
            timestamp: new Date().toISOString()
        });
    });

    app.get("/api/system/status", async (_req, reply) => {
        const now = Date.now();
        noStore(reply);
        return reply.code(200).send({
            ok: true,
            service: SERVICE_NAME,
            version: SERVICE_VERSION,
            uptimeMs: now - BOOT_AT_MS,
            pid: process.pid,
            node: process.version,
            timestamp: new Date(now).toISOString()
        });
    });

    app.options("/lna-probe", async (req, reply) => {
        const origin = String((req.headers as any)?.origin || "");
        if (origin) reply.header("Access-Control-Allow-Origin", origin);
        reply.header("Access-Control-Allow-Methods", "GET, OPTIONS");
        reply.header("Access-Control-Allow-Headers", "Content-Type");
        reply.header("Access-Control-Max-Age", "600");
        if (String((req.headers as any)?.["access-control-request-private-network"] || "").toLowerCase() === "true") {
            reply.header("Access-Control-Allow-Private-Network", "true");
            reply.header("Vary", "Origin, Access-Control-Request-Private-Network");
        } else if (origin) {
            reply.header("Vary", "Origin");
        }
        return reply.code(204).send();
    });

    app.get("/lna-probe", async (req, reply) => {
        const origin = String((req.headers as any)?.origin || "");
        if (origin) {
            reply.header("Access-Control-Allow-Origin", origin);
            reply.header("Vary", "Origin");
        }
        reply.header("Cache-Control", "no-store");
        return reply.code(204).send();
    });

    await registerCoreSettingsEndpoints(app);
    await registerAuthRoutes(app);
    await registerCoreSettingsRoutes(app);
    await registerStorageRoutes(app);
    await registerGptRoutes(app);
};

export const registerApiFallback = (app: FastifyInstance) => {
    app.all("/api/*", async (request: FastifyRequest, reply: FastifyReply) => {
        return reply.code(404).send({
            ok: false,
            error: "Unknown API endpoint",
            path: (request as any).url || null
        });
    });
};

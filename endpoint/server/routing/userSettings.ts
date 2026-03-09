import type { FastifyInstance, FastifyRequest } from "fastify";
import { readFile, writeFile } from "node:fs/promises";

import { AiSettings, mergeSettings, readCoreSettings, WebdavSettings, SpeechSettings, TimelineSettings, AppearanceSettings, GridSettings, DEFAULT_SETTINGS, type Settings as StoredSettings } from "../config/config.ts";
import { verifyUser, readUserFile, writeUserFile, loadUserSettings } from "../lib/users.ts";
import { safeJsonParse } from "../lib/parsing.ts";
import { ADMIN_PREFS_FILE, CONFIG_DIR } from "../lib/paths.ts";
import path from "node:path";

export type HttpTarget = {
    id: string;
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string;
    unencrypted: boolean;
};

export type CoreSettings = {
    mode: "native" | "web" | "desktop" | "mobile" | "server" | "daemon" | "client" | "daemon-client" | "endpoint";
    roles?: string[];
    bridge?: {
        enabled?: boolean;
        mode?: "active" | "passive";
        origin?: {
            originId?: string;
            originHosts?: string[];
            originDomains?: string[];
            originMasks?: string[];
            surface?: string;
        };
        endpointUrl?: string;
        userId?: string;
        userKey?: string;
        bridgeMasterKey?: string;
        bridgeSigningPrivateKeyPem?: string;
        bridgePeerPublicKeyPem?: string;
        deviceId?: string;
        clientId?: string;
        namespace?: string;
        reconnectMs?: number;
    };
    topology?: {
        enabled?: boolean;
        nodes?: Array<Record<string, any>>;
        links?: Array<Record<string, any>>;
    };
    endpointIDs?: Record<string, Record<string, any>>;
    ops?: {
        httpTargets?: HttpTarget[];
        allowUnencrypted?: boolean;
        allowInsecureTls?: boolean;
        logLevel?: "debug" | "info" | "warn" | "error";
    };
};

export type Settings = {
    core?: CoreSettings;
    ai?: AiSettings;
    webdav?: WebdavSettings;
    timeline?: TimelineSettings;
    appearance?: AppearanceSettings;
    speech?: SpeechSettings;
    grid?: GridSettings;
};

export const registerCoreSettingsRoutes = async (app: FastifyInstance) => {
    app.get("/core/user/settings", async (request: FastifyRequest<{ Querystring: { userId: string; userKey: string } }>) => {
        const { userId, userKey } = request.query || {};
        const record = await verifyUser(userId, userKey);
        if (!record) return { ok: false, error: "Invalid credentials" };
        try {
            const buf = await readUserFile(userId, "settings.json", record.encrypt, userKey);
            const parsed = safeJsonParse<StoredSettings>(buf.toString("utf-8"), DEFAULT_SETTINGS as StoredSettings);
            if (!parsed || typeof parsed !== "object") {
                return { ok: true, settings: DEFAULT_SETTINGS, encrypt: record.encrypt };
            }
            return { ok: true, settings: mergeSettings(DEFAULT_SETTINGS, parsed), encrypt: record.encrypt };
        } catch {
            return { ok: true, settings: DEFAULT_SETTINGS, encrypt: record.encrypt };
        }
    });

    app.post("/core/user/settings", async (request: FastifyRequest<{ Body: { userId: string; userKey: string; settings: Partial<StoredSettings> } }>) => {
        const { userId, userKey, settings } = request.body || {};
        const record = await verifyUser(userId, userKey);
        if (!record) return { ok: false, error: "Invalid credentials" };
        const merged = mergeSettings(DEFAULT_SETTINGS, (settings as Partial<StoredSettings>) || {});
        await writeUserFile(userId, "settings.json", Buffer.from(JSON.stringify(merged, null, 2)), record.encrypt, userKey);
        return { ok: true, settings: merged };
    });
};

export const registerCoreSettingsEndpoints = async (app: FastifyInstance) => {
    app.get("/health", async () => {
        const settings = await readCoreSettings();
        return {
            ok: true,
            mode: (settings.core?.mode ?? "endpoint") as "native" | "web" | "desktop" | "mobile" | "server" | "daemon" | "client" | "daemon-client" | "endpoint",
            roles: settings.core?.roles ?? (DEFAULT_SETTINGS.core?.roles || ["server", "endpoint"]),
            bridgeEnabled: settings.core?.bridge?.enabled === true
        };
    });

    app.get("/core/admin/prefs", async () => {
        try {
            const data = await readFile(ADMIN_PREFS_FILE, "utf-8");
            const parsed = JSON.parse(data);
            return { ok: true, prefs: parsed };
        } catch {
            return { ok: true, prefs: {} };
        }
    });

    app.post("/core/admin/prefs", async (request: FastifyRequest<{ Body: { prefs: any } }>) => {
        try {
            const prefs = request.body?.prefs || {};
            await writeFile(ADMIN_PREFS_FILE, JSON.stringify(prefs, null, 2), "utf-8");
            return { ok: true };
        } catch (e) {
            return { ok: false, error: String(e) };
        }
    });

    app.get("/api/config/:filename", async (request: FastifyRequest<{ Params: { filename: string } }>, reply) => {
        const { filename } = request.params;
        if (!filename || filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
            return reply.code(400).send({ ok: false, error: "Bad Request" });
        }
        try {
            const targetPath = path.join(CONFIG_DIR, filename);
            const data = await readFile(targetPath, "utf-8");
            if (filename.endsWith(".json")) {
                reply.header("Content-Type", "application/json");
            } else {
                reply.header("Content-Type", "text/plain");
            }
            return reply.send(data);
        } catch {
            return reply.code(404).send({ ok: false, error: "Not Found" });
        }
    });
};

export const registerOpsSettingsRoutes = async (app: FastifyInstance) => {
    app.post("/core/ops/http", async (request: FastifyRequest<{ Body: { userId: string; userKey: string; targetId?: string; url?: string; method?: string; headers?: Record<string, string>; body?: string } }>) => {
        const { userId, userKey, targetId, url: overrideUrl, method, headers, body } = request.body || {};
        let settings: StoredSettings;
        try {
            settings = await loadUserSettings(userId, userKey);
        } catch (e) {
            return { ok: false, error: (e as Error)?.message || "Invalid credentials" };
        }

        const ops = settings.core?.ops || { httpTargets: [], allowUnencrypted: false, allowInsecureTls: false, logLevel: "info" };
        const httpTargets = ops.httpTargets || ([] as HttpTarget[]);
        const target = httpTargets.find((t: HttpTarget) => t.id === targetId);
        const resolvedUrl = overrideUrl || target?.url;
        if (!resolvedUrl) return { ok: false, error: "No URL" };

        const isHttps = resolvedUrl.startsWith("https://");
        if (!isHttps && !(ops.allowUnencrypted || target?.unencrypted)) {
            return { ok: false, error: "Unencrypted HTTP is not allowed" };
        }

        const finalHeaders = { ...(target?.headers || {}), ...(headers || {}) };
        const finalMethod = (method || target?.method || "POST").toUpperCase();

        try {
            const res = await fetch(resolvedUrl, {
                method: finalMethod,
                headers: finalHeaders,
                body: body ?? null
            });
            const text = await res.text();
            return { ok: true, status: res.status, data: text };
        } catch (e) {
            return { ok: false, error: String(e) };
        }
    });
};

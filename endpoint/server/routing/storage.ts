import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { readdir, stat, rm } from "node:fs/promises";

import { ensureUserDir, readUserFile, verifyUser, writeUserFile } from "../lib/users.ts";
import { safeJoin } from "../lib/paths.ts";
import { pickEnvBoolLegacy, pickEnvStringLegacy } from "../lib/env.ts";

export const registerStorageRoutes = async (app: FastifyInstance) => {
    type Operation = "list" | "get" | "put" | "delete";
    type SyncProvider = "backend" | "webdav";
    type SyncScope = "file" | "settings" | "data";
    type SyncRequest = {
        userId?: string;
        userKey?: string;
        provider?: SyncProvider;
        scope?: SyncScope;
        op?: string;
        path?: string;
        remotePath?: string;
        data?: string;
        encoding?: "base64" | "utf8";
        webdav?: {
            url?: string;
            username?: string;
            password?: string;
            token?: string;
            allowInsecureTls?: boolean;
        };
    };
    type WebDavCreateClient = (remoteUrl: string, options?: Record<string, unknown>) => unknown;

    let cachedWebDavCreateClient: WebDavCreateClient | null = null;
    let webdavAttempted = false;

    const normalizeOperation = (op?: string): Operation | "unknown" => {
        const normalized = (op || "list").toString().trim().toLowerCase();
        if (normalized === "ls" || normalized === "list") return "list";
        if (normalized === "read" || normalized === "get") return "get";
        if (normalized === "set" || normalized === "write" || normalized === "put") return "put";
        if (normalized === "delete" || normalized === "remove" || normalized === "rm") return "delete";
        return "unknown";
    };

    const normalizeSyncProvider = (provider?: string): SyncProvider => {
        const resolved = (provider || "backend").toString().trim().toLowerCase();
        return resolved === "webdav" || resolved === "remote" ? "webdav" : "backend";
    };

    const normalizeSyncScope = (scope?: string): SyncScope => {
        const resolved = (scope || "file").toString().trim().toLowerCase();
        if (resolved === "settings") return "settings";
        if (resolved === "data") return "data";
        return "file";
    };

    const resolveLocalSyncPath = (scope: SyncScope, inputPath?: string) => {
        if (scope === "settings") return "settings.json";
        if (!inputPath) return scope === "data" ? path.join("data") : ".";
        return scope === "data" ? path.join("data", inputPath) : inputPath;
    };

    const resolveRemoteSyncPath = (value?: string, fallback = "/") => {
        const normalized = (value || fallback || "").toString().trim();
        if (!normalized) return "/";
        return normalized.startsWith("/") ? normalized : `/${normalized}`;
    };

    const resolveWebdavClient = async (settings: {
        url?: string;
        username?: string;
        password?: string;
        token?: string;
        allowInsecureTls?: boolean;
    }) => {
        if (!settings?.url) return null;

        if (!webdavAttempted) {
            webdavAttempted = true;
            const candidates = ["webdav/web", "webdav"];
            for (const spec of candidates) {
                const mod = await import(spec).catch(() => null);
                if (!mod) continue;
                if (typeof (mod as any).createClient === "function") {
                    cachedWebDavCreateClient = (mod as any).createClient as WebDavCreateClient;
                    break;
                }
                if (typeof (mod as any)?.default?.createClient === "function") {
                    cachedWebDavCreateClient = (mod as any).default.createClient as WebDavCreateClient;
                    break;
                }
            }
        }

        if (!cachedWebDavCreateClient) return null;

        const headers: Record<string, string> = {};
        if (settings.token) headers.Authorization = `Bearer ${settings.token}`;

        return cachedWebDavCreateClient(
            settings.url,
            {
                ...(settings.username ? { username: settings.username } : {}),
                ...(settings.password ? { password: settings.password } : {}),
                ...(Object.keys(headers).length > 0 ? { headers } : {}),
                ...(settings.allowInsecureTls ? { allowInsecure: true } : {})
            }
        );
    };

    const resolveWebdavConfig = (body: SyncRequest) => {
        const envConfig = {
            url: pickEnvStringLegacy("WEBDAV_SYNC_URL") || pickEnvStringLegacy("WEBDAV_URL"),
            username: pickEnvStringLegacy("WEBDAV_SYNC_USERNAME") || pickEnvStringLegacy("WEBDAV_USERNAME"),
            password: pickEnvStringLegacy("WEBDAV_SYNC_PASSWORD") || pickEnvStringLegacy("WEBDAV_PASSWORD"),
            token: pickEnvStringLegacy("WEBDAV_SYNC_TOKEN") || pickEnvStringLegacy("WEBDAV_TOKEN")
        };
        return {
            url: body.webdav?.url ?? envConfig.url,
            username: body.webdav?.username ?? envConfig.username,
            password: body.webdav?.password ?? envConfig.password,
            token: body.webdav?.token ?? envConfig.token,
            allowInsecureTls:
                body.webdav?.allowInsecureTls === true || pickEnvBoolLegacy("WEBDAV_ALLOW_INSECURE") === true
        };
    };

    const toSyncError = (message: string) => ({ ok: false, error: message });

    const listHandler = async (request: FastifyRequest<{ Body: { userId: string; userKey: string; dir?: string } }>) => {
        const { userId, userKey, dir = "." } = request.body || {};
        const record = await verifyUser(userId, userKey);
        if (!record) return { ok: false, error: "Invalid credentials" };
        const base = await ensureUserDir(userId);
        const target = safeJoin(base, dir);
        const entries = await readdir(target, { withFileTypes: true }).catch(() => []);
        const files = await Promise.all(entries.map(async (entry) => {
            const full = path.join(target, entry.name);
            const st = await stat(full).catch(() => null);
            return {
                name: entry.name,
                type: entry.isDirectory() ? "dir" : "file",
                size: st?.size ?? 0,
                mtime: st?.mtimeMs ?? 0
            };
        }));
        return { ok: true, dir, files };
    };

    const getHandler = async (request: FastifyRequest<{ Body: { userId: string; userKey: string; path: string; encoding?: "base64" | "utf8" } }>) => {
        const { userId, userKey, path: filePath, encoding = "base64" } = request.body || {};
        const record = await verifyUser(userId, userKey);
        if (!record) return { ok: false, error: "Invalid credentials" };
        const buffer = await readUserFile(userId, filePath, record.encrypt, userKey).catch(() => null);
        if (!buffer) return { ok: false, error: "Not found" };
        const payload = encoding === "utf8" ? buffer.toString("utf8") : buffer.toString("base64");
        return { ok: true, path: filePath, encoding, data: payload, encrypt: record.encrypt };
    };

    const putHandler = async (request: FastifyRequest<{ Body: { userId: string; userKey: string; path: string; data: string; encoding?: "base64" | "utf8" } }>) => {
        const { userId, userKey, path: filePath, data, encoding = "base64" } = request.body || {};
        const record = await verifyUser(userId, userKey);
        if (!record) return { ok: false, error: "Invalid credentials" };
        if (!filePath) return { ok: false, error: "Missing path" };
        const buffer = encoding === "utf8" ? Buffer.from(data ?? "", "utf8") : Buffer.from(data ?? "", "base64");
        await writeUserFile(userId, filePath, buffer, record.encrypt, userKey);
        return { ok: true, path: filePath };
    };

    const deleteHandler = async (request: FastifyRequest<{ Body: { userId: string; userKey: string; path: string } }>) => {
        const { userId, userKey, path: filePath } = request.body || {};
        const record = await verifyUser(userId, userKey);
        if (!record) return { ok: false, error: "Invalid credentials" };
        const base = await ensureUserDir(userId);
        const target = safeJoin(base, filePath);
        await rm(target, { recursive: true, force: true });
        return { ok: true, path: filePath };
    };

    const syncHandler = async (request: FastifyRequest<{ Body: SyncRequest }>) => {
        const body = (request.body || {}) as SyncRequest;
        const { userId, userKey, path: targetPath, remotePath, data, encoding = "base64", op: rawOp, provider: rawProvider, scope: rawScope } = body;
        const record = await verifyUser(userId, userKey);
        if (!record) return toSyncError("Invalid credentials");

        const op = normalizeOperation(rawOp);
        if (op === "unknown") return toSyncError("Unknown op. Use list/get/put/delete.");

        const scope = normalizeSyncScope(rawScope);
        const provider = normalizeSyncProvider(rawProvider);
        const localPath = resolveLocalSyncPath(scope, targetPath);

        if (provider === "backend") {
            if (op === "list") return listHandler({ body: { userId, userKey, dir: localPath } } as any);
            if (op === "get") return getHandler({ body: { userId, userKey, path: localPath, encoding } } as any);
            if (op === "put") {
                if (!data) return toSyncError("Missing data");
                return putHandler({ body: { userId, userKey, path: localPath, data, encoding } } as any);
            }
            return deleteHandler({ body: { userId, userKey, path: localPath } } as any);
        }

        const webdav = resolveWebdavConfig(body);
        if (!webdav.url) return toSyncError("Missing webdav.url");

        const client = await resolveWebdavClient(webdav);
        if (!client) {
            return {
                ok: false,
                disabled: true,
                error: "WebDAV module is unavailable. Install optional dependency 'webdav' to use webdav sync."
            };
        }

        const remoteTarget = resolveRemoteSyncPath(
            remotePath ?? targetPath,
            scope === "settings" ? "/settings.json" : scope === "data" ? "/data" : "/"
        );

        if (op === "list") {
            const raw = await (client as any).getDirectoryContents(remoteTarget, { deep: false }).catch((error: unknown) => {
                throw new Error(String(error));
            });
            const entries = Array.isArray(raw) ? raw : [];
            return {
                ok: true,
                provider: "webdav",
                path: remoteTarget,
                files: entries.map((entry: any) => ({
                    name: entry?.basename || entry?.filename || "",
                    type: entry?.type === "directory" ? "dir" : "file",
                    size: typeof entry?.size === "number" ? entry.size : 0,
                    mtime: typeof entry?.lastmod === "string" ? Date.parse(entry.lastmod) : 0
                }))
            };
        }

        if (op === "get") {
            const raw = await (client as any).getFileContents(remoteTarget, { format: encoding === "utf8" ? "text" : "binary" }).catch((error: unknown) => {
                throw new Error(String(error));
            });
            const buffer = Buffer.isBuffer(raw)
                ? raw
                : raw instanceof ArrayBuffer
                    ? Buffer.from(raw)
                    : Buffer.from(typeof raw === "string" ? raw : JSON.stringify(raw || ""), "utf8");
            return {
                ok: true,
                provider: "webdav",
                path: remoteTarget,
                encoding,
                data: encoding === "utf8" ? buffer.toString("utf8") : buffer.toString("base64")
            };
        }

        if (op === "put") {
            if (!data) return toSyncError("Missing data");
            const payload = encoding === "utf8" ? Buffer.from(data, "utf8") : Buffer.from(data, "base64");
            await (client as any).putFileContents(remoteTarget, payload, { overwrite: true }).catch((error: unknown) => {
                throw new Error(String(error));
            });
            return { ok: true, provider: "webdav", path: remoteTarget };
        }

        await (client as any).deleteFile(remoteTarget).catch((error: unknown) => {
            throw new Error(String(error));
        });
        return { ok: true, provider: "webdav", path: remoteTarget };
    };

    app.post("/core/storage/list", listHandler);
    app.post("/core/storage/get", getHandler);
    app.post("/core/storage/put", putHandler);
    app.post("/core/storage/delete", deleteHandler);
    app.post("/core/storage/sync", syncHandler);

    // New aliases under /api/storage
    app.post("/api/storage/list", listHandler);
    app.post("/api/storage/get", getHandler);
    app.post("/api/storage/put", putHandler);
    app.post("/api/storage/delete", deleteHandler);
    app.post("/api/storage/sync", syncHandler);

    app.post("/api/storage", async (request: FastifyRequest<{ Body: any }>) => {
        const body = (request.body || {}) as any;
        const operation = (body.op || body.operation || body.action || "").toString().trim().toLowerCase();
        if (operation === "list") return listHandler(request as any);
        if (operation === "get") return getHandler(request as any);
        if (operation === "put" || operation === "set" || operation === "write") return putHandler(request as any);
        if (operation === "delete" || operation === "remove" || operation === "rm") return deleteHandler(request as any);
        return {
            ok: false,
            error: "Unknown storage op. Use list/get/put/delete via op|operation|action field."
        };
    });
};

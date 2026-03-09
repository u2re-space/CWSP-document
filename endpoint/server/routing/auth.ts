import type { FastifyInstance, FastifyRequest } from "fastify";

import { registerUser, rotateUserKey, listUsers, deleteUser, verifyUser } from "../lib/users.ts";
import { parsePortableBoolean } from "../lib/parsing.ts";

export const registerAuthRoutes = async (app: FastifyInstance) => {
    app.post("/core/auth/register", async (request: FastifyRequest<{ Body: { userId?: string; userKey?: string; encrypt?: boolean } }>) => {
        const { userId, userKey, encrypt } = request.body || {};
        const encrypted = parsePortableBoolean(encrypt) ?? false;
        const res = await registerUser(userId, encrypted, userKey);
        return { ok: true, ...res };
    });

    app.post("/core/auth/rotate", async (request: FastifyRequest<{ Body: { userId: string; userKey: string; encrypt?: boolean } }>) => {
        const { userId, userKey, encrypt } = request.body || {};
        if (!userId || !userKey) return { ok: false, error: "Missing credentials" };
        const encrypted = parsePortableBoolean(encrypt);
        const res = await rotateUserKey(userId, userKey, encrypted);
        if (!res) return { ok: false, error: "Invalid credentials" };
        return { ok: true, ...res };
    });

    app.get("/core/auth/users", async (request: FastifyRequest<{ Querystring: { userId?: string; userKey?: string } }>) => {
        const { userId, userKey } = request.query || {};
        // Require valid credentials to list users
        const valid = userId && userKey ? await verifyUser(userId, userKey) : null;
        if (!valid) return { ok: false, error: "Invalid credentials" };
        return { ok: true, users: await listUsers() };
    });

    app.post("/core/auth/delete", async (request: FastifyRequest<{ Body: { userId: string; userKey: string; targetId?: string } }>) => {
        const { userId, userKey, targetId } = request.body || {};
        const valid = await verifyUser(userId, userKey);
        if (!valid) return { ok: false, error: "Invalid credentials" };
        const target = targetId || userId;
        const ok = await deleteUser(target);
        return { ok, targetId: target };
    });
};

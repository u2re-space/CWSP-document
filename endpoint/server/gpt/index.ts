import type { FastifyInstance, FastifyRequest } from "fastify";

import { createAiContext } from "./context.ts";
import { registerAiRoutes } from "./ai.ts";
import { pickGptApiAuthHeader } from "./provider.ts";

export type ApiProxyBody = {
    userId?: string;
    userKey?: string;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    bearerToken?: string;
    path?: string;
    method?: string;
    headers?: Record<string, string>;
    proxyPath?: string;
    body?: unknown;
    payload?: unknown;
    request?: any;
    provider?: any;
};

const parseResponseBody = async (raw: Response): Promise<any> => {
    const text = await raw.text();
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
};

const resolveProxyUrl = (baseUrl: string, targetPath?: string): string => {
    const normalizedBase = baseUrl.replace(/\/+$/, "");
    const normalizedPath = targetPath ? (targetPath.startsWith("/") ? targetPath : `/${targetPath}`) : "/responses";
    return `${normalizedBase}${normalizedPath}`;
};

const executeGptProxy = async (body: ApiProxyBody & any): Promise<any> => {
    const contextResult = await createAiContext(body);
    if (!contextResult.ok) return { ok: false, error: contextResult.error };

    const { provider } = contextResult.value;
    const targetPath = body.path || body.proxyPath || provider.proxyPath || "/responses";
    const targetUrl = resolveProxyUrl(provider.baseUrl, targetPath);
    const method = String((body as any)?.method || "POST").toUpperCase();

    const requestBody = body.request || body.payload || body.body || body.data;
    const requestHeaders: Record<string, string> = {
        "content-type": "application/json",
        ...(body.headers || {})
    };
    const authHeader = pickGptApiAuthHeader(provider);
    if (authHeader) requestHeaders.authorization = authHeader;

    const targetPayload =
        typeof requestBody === "undefined"
            ? JSON.stringify({
                model: provider.model,
                input: body.input || body.text || body.query || ""
            })
            : typeof requestBody === "string"
                ? requestBody
                : JSON.stringify(requestBody);

    const upstreamResponse = await fetch(targetUrl, {
        method,
        headers: requestHeaders,
        body: method === "GET" || method === "HEAD" ? undefined : targetPayload
    });

    const parsedBody = await parseResponseBody(upstreamResponse);
    return {
        ok: upstreamResponse.ok,
        status: upstreamResponse.status,
        upstream: {
            targetUrl,
            method,
            model: provider.model,
            baseUrl: provider.baseUrl
        },
        headers: Object.fromEntries(upstreamResponse.headers.entries()),
        data: parsedBody
    };
};

const registerGptPassthroughRoutes = async (app: FastifyInstance): Promise<void> => {
    const handlers = ["proxy", "passthrough"];

    for (const suffix of handlers) {
        app.post(`/core/ai/${suffix}`, async (request: FastifyRequest<{ Body: ApiProxyBody & any }>) => {
            const body = (request.body || {}) as ApiProxyBody & any;
            return executeGptProxy(body);
        });

        app.post(`/api/ai/${suffix}`, async (request: FastifyRequest<{ Body: ApiProxyBody & any }>) => {
            const body = (request.body || {}) as ApiProxyBody & any;
            return executeGptProxy(body);
        });
    }
};

export const registerGptRoutes = async (app: FastifyInstance): Promise<void> => {
    await registerAiRoutes(app);
    await registerGptPassthroughRoutes(app);
};

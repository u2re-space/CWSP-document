import type { FastifyInstance, FastifyRequest } from "fastify";

import { createAiContext, toAiCustomInstruction } from "./context.ts";
import { buildLegacyAiResponse, buildProcessingAiResponse, executeAiPipeline, normalizeAiMode, type AiMode } from "./response-adapter.ts";

export const registerAiRoutes = async (app: FastifyInstance) => {
    const withAiContext = async (body: any, handler: (context: any) => Promise<any>) => {
        const contextResult = await createAiContext(body);
        if (!contextResult.ok) return { ok: false, error: contextResult.error };
        return handler(contextResult.value);
    };

    const runCoreAiRoute = async (kind: "recognize" | "analysis", body: any, input: string, mode: AiMode = "smartRecognize", routeHints: { hints?: any; context?: any; title?: string; legacyRecognize?: boolean } = {}) => {
        return withAiContext(body, async (ctx) => {
            const effectiveInstruction = toAiCustomInstruction(body, ctx.settings);
            const result = await executeAiPipeline(ctx, {
                mode,
                input,
                hints: routeHints.hints,
                contextData: routeHints.context,
                customInstruction: effectiveInstruction,
                legacyRecognizeMode: routeHints.legacyRecognize
            });

            return buildLegacyAiResponse({
                kind,
                result,
                title: routeHints.title,
                customInstruction: Boolean(effectiveInstruction)
            });
        });
    };

    const runProcessingRoute = async (body: any, input: string, mode: AiMode) => {
        return withAiContext(body, async (ctx) => {
            const effectiveInstruction = toAiCustomInstruction(body, ctx.settings);
            const hints = mode === "recognize" ? { context: body?.context || {} } : body?.hints || body?.hint;
            const result = await executeAiPipeline(ctx, {
                mode,
                input,
                hints,
                customInstruction: effectiveInstruction
            });

            return buildProcessingAiResponse({
                mode,
                result,
                provider: ctx.provider,
                customInstruction: Boolean(effectiveInstruction),
                hasExplicitCredential: ctx.hasExplicitCredential
            });
        });
    };

    app.post("/core/ai/recognize", async (request: FastifyRequest<{ Body: { userId: string; userKey: string; title?: string; text?: string; url?: string; customInstruction?: string } }>) => {
        const body = request.body as any;
        const { title, text, url, ...rest } = body || {};
        const input = (text || url || "").toString();
        if (!input.trim()) return { ok: false, error: "Missing text/url" };

        const mode = "smartRecognize";
        return runCoreAiRoute("recognize", body, input, mode, {
            hints: rest?.hints || rest?.hint,
            title
        });
    });

    app.post("/core/ai/analyze", async (request: FastifyRequest<{ Body: { userId: string; userKey: string; text?: string; url?: string; customInstruction?: string } }>) => {
        const body = request.body as any;
        const { text, url, ...rest } = body || {};
        const input = (text || url || "").toString();
        if (!input.trim()) return { ok: false, error: "Missing text/url" };

        const mode = normalizeAiMode(rest?.mode, "extract");
        return runCoreAiRoute("analysis", body, input, mode, {
            hints: rest?.hints || rest?.hint,
            context: { ...(rest?.context || {}) },
            legacyRecognize: true
        });
    });

    app.post("/core/ai/timeline", async (request: FastifyRequest<{ Body: { userId: string; userKey: string; source?: string } }>) => {
        const body = request.body as any;
        return withAiContext(body, async () => ({
            ok: false,
            error: "Timeline generation is not backend-enabled yet (depends on browser/OPFS workers in current core implementation).",
            source: body?.source || null
        }));
    });

    app.post("/api/processing", async (request: FastifyRequest<{ Body: any }>) => {
        const body = (request.body || {}) as any;
        const input = (body.input || body.text || body.url || "").toString();
        if (!input.trim()) return { ok: false, error: "Missing input (text/url/input)" };

        const mode = normalizeAiMode((body.mode || body.action || "smartRecognize") as AiMode, "smartRecognize");

        if (mode === "timeline") {
            return {
                ok: false,
                error: "Timeline generation is not backend-enabled yet (depends on browser/OPFS workers in current core implementation)."
            };
        }

        return runProcessingRoute(body, input, mode);
    });
};

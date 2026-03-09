export type AiMode = "recognize" | "analyze" | "extract" | "smartRecognize" | "smart" | "timeline";

export type LegacyAiKind = "recognize" | "analysis";

export type AiExecutionOptions = {
    mode: AiMode;
    input: string;
    hints?: any;
    contextData?: Record<string, any>;
    customInstruction?: string;
    legacyRecognizeMode?: boolean;
};

export const normalizeAiMode = (raw: unknown, fallback: AiMode = "smartRecognize"): AiMode => {
    const value = String(raw || "").trim();
    if (value === "recognize") return "recognize";
    if (value === "analyze") return "analyze";
    if (value === "extract") return "extract";
    if (value === "smart") return "smartRecognize";
    if (value === "smartRecognize") return "smartRecognize";
    if (value === "timeline") return "timeline";
    return fallback;
};

export const executeAiPipeline = async (ctx: any, options: AiExecutionOptions): Promise<any> => {
    const mode = normalizeAiMode(options.mode, "smartRecognize");
    const orchestrator = ctx.orchestrator;
    const instructionOptions = options.customInstruction ? { customInstruction: options.customInstruction } : undefined;

    if (mode === "recognize") {
        if (options.legacyRecognizeMode) {
            return orchestrator.recognize(options.input, {
                context: options.contextData || {},
                ...instructionOptions
            });
        }
        return orchestrator.smartRecognize(options.input, options.hints, instructionOptions);
    }

    if (mode === "analyze" || mode === "extract") {
        return orchestrator.extractEntitiesFromData(options.input, instructionOptions);
    }

    return orchestrator.smartRecognize(options.input, options.hints, instructionOptions);
};

export const buildLegacyAiResponse = (opts: { kind: LegacyAiKind; result: any; title?: string; customInstruction: boolean }): { ok: boolean; results: any[] } => {
    if (opts.kind === "recognize") {
        const subId = Date.now();
        const directory = "/docs/preferences/";
        const name = `recognized-${subId}.json`;
        return {
            ok: Boolean(opts.result?.ok),
            results: [
                {
                    status: opts.result?.ok ? "done" : "failed",
                    data: opts.result,
                    path: `${directory}${name}`,
                    name,
                    subId,
                    directory,
                    dataType: "json",
                    title: opts.title || undefined,
                    detection: { hints: ["backend-ai"], aiProcessed: true, customInstruction: Boolean(opts.customInstruction) }
                }
            ]
        };
    }

    return {
        ok: Boolean(opts.result?.ok),
        results: [
            {
                status: opts.result?.ok ? "done" : "failed",
                data: opts.result,
                name: `analysis-${Date.now()}.json`,
                dataType: "json",
                customInstruction: Boolean(opts.customInstruction)
            }
        ]
    };
};

export const buildProcessingAiResponse = (opts: {
    mode: string;
    result: any;
    provider: any;
    customInstruction: boolean;
    hasExplicitCredential?: boolean;
}): {
    ok: boolean;
    mode: string;
    customInstruction: boolean;
    provider: { baseUrl: string | null; model: string | null; apiKeySource: "request" | "configured" };
    result: any;
} => {
    return {
        ok: Boolean((opts.result as any)?.ok ?? true),
        mode: opts.mode,
        customInstruction: Boolean(opts.customInstruction),
        provider: {
            baseUrl: opts.provider?.baseUrl || null,
            model: opts.provider?.model || null,
            apiKeySource: opts.hasExplicitCredential ? "request" : "configured"
        },
        result: opts.result
    };
};

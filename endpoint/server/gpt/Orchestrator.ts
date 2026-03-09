type OrchestratorConfig = {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    mcp?: Array<{
        id?: string;
        serverLabel?: string;
        origin?: string;
        clientKey?: string;
        secretKey?: string;
    }>;
};

type McpTool = {
    type: string;
    server_label: string;
    server_url: string;
    headers: {
        authorization: string;
    };
    require_approval: string;
};

type RecognizeOptions = {
    context?: Record<string, any>;
    customInstruction?: string;
};

type SmartHints = {
    expectedType?: string;
    language?: string;
    domain?: string;
    extractEntities?: boolean;
};

type InstructionOptions = {
    customInstruction?: string;
};

type RecognitionResult = {
    ok: boolean;
    recognized_data: string[];
    keywords_and_tags: string[];
    verbose_data: string;
    suggested_type: string | null;
    confidence: number;
    source_kind: string;
    processing_time_ms: number;
    errors: string[];
    warnings: string[];
};

const DEFAULT_API_URL = "https://api.proxyapi.ru/openai/v1";
const DEFAULT_MODEL = "gpt-5.2";

const resolveMcpTools = (mcp: Array<any> | undefined) => {
    if (!Array.isArray(mcp)) return [];
    return mcp
        .map((entry) => {
            const origin = String(entry?.origin || "").trim();
            const clientKey = String(entry?.clientKey || "").trim();
            const secretKey = String(entry?.secretKey || "").trim();
            if (!origin || !clientKey || !secretKey) return null;

            const serverLabel = String(entry?.serverLabel || entry?.label || origin).trim() || origin;
            return {
                type: "mcp",
                server_label: serverLabel,
                server_url: origin,
                headers: {
                    authorization: `Bearer ${clientKey}:${secretKey}`
                },
                require_approval: "never"
            };
        })
        .filter((item): item is McpTool => item !== null);
};

const extractContent = (payload: any): string => {
    if (!payload) return "";
    if (typeof payload === "string") return payload;
    if (Array.isArray(payload?.output_text)) return payload.output_text.join("\n\n");
    if (payload?.choices?.[0]?.message?.content) return String(payload.choices[0].message.content);

    const output = payload?.output;
    if (Array.isArray(output)) {
        const parts: string[] = [];
        for (const item of output) {
            if (typeof item?.content === "string") {
                parts.push(item.content);
                continue;
            }
            if (Array.isArray(item?.content)) {
                for (const part of item.content) {
                    if (typeof part?.text === "string") parts.push(part.text);
                    else if (typeof part?.text?.value === "string") parts.push(part.text.value);
                }
            }
        }
        return parts.join("\n\n");
    }

    return "";
};

const parseJsonFromText = (text: string): any => {
    const input = (text || "").trim();
    if (!input) return null;

    try {
        return JSON.parse(input);
    } catch {
        // ignore direct parse errors
    }

    const fenced = input.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) {
        try {
            return JSON.parse(fenced[1].trim());
        } catch {
            // ignore fenced parse errors
        }
    }

    const objStart = input.indexOf("{");
    const objEnd = input.lastIndexOf("}");
    if (objStart >= 0 && objEnd > objStart) {
        try {
            return JSON.parse(input.slice(objStart, objEnd + 1));
        } catch {
            // ignore object slice parse errors
        }
    }

    const arrStart = input.indexOf("[");
    const arrEnd = input.lastIndexOf("]");
    if (arrStart >= 0 && arrEnd > arrStart) {
        try {
            return JSON.parse(input.slice(arrStart, arrEnd + 1));
        } catch {
            // ignore array slice parse errors
        }
    }

    return null;
};

export class AIOrchestrator {
    private readonly apiKey: string;
    private readonly baseUrl: string;
    private readonly model: string;
    private readonly mcp: Array<any>;

    constructor(config: OrchestratorConfig = {}) {
        this.apiKey = config.apiKey || "";
        this.baseUrl = (config.baseUrl || DEFAULT_API_URL).replace(/\/$/, "");
        this.model = config.model || DEFAULT_MODEL;
        this.mcp = resolveMcpTools(config.mcp);
    }

    private async runPrompt(input: string, prompt: string): Promise<{ ok: boolean; text: string; error?: string }> {
        if (!this.apiKey) return { ok: false, text: "", error: "No API key available" };
        if (!input.trim()) return { ok: false, text: "", error: "No input provided" };

        try {
            const response = await fetch(`${this.baseUrl}/responses`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: this.model,
                    ...(this.mcp.length ? { tools: this.mcp } : {}),
                    input: [
                        {
                            type: "message",
                            role: "user",
                            content: [{ type: "input_text", text: `${prompt}\n\nINPUT:\n${input}` }]
                        }
                    ],
                    reasoning: { effort: "low" },
                    text: { verbosity: "low" }
                })
            });

            if (!response.ok) {
                const raw = await response.text().catch(() => "");
                return { ok: false, text: "", error: `AI request failed: HTTP ${response.status} ${raw}`.trim() };
            }

            const payload = await response.json().catch(() => null);
            const text = extractContent(payload).trim();
            if (!text) return { ok: false, text: "", error: "Empty AI response" };
            return { ok: true, text };
        } catch (error: any) {
            return { ok: false, text: "", error: error?.message || String(error) };
        }
    }

    async recognize(data: string, options?: RecognizeOptions): Promise<RecognitionResult> {
        const started = Date.now();
        const instructionAddon = options?.customInstruction ? `\n\nCUSTOM INSTRUCTION:\n${options.customInstruction}` : "";
        const prompt = `Recognize and extract structured information from the provided content.${instructionAddon}`;
        const result = await this.runPrompt(String(data || ""), prompt);

        return {
            ok: result.ok,
            recognized_data: result.ok ? [result.text] : [],
            keywords_and_tags: [],
            verbose_data: result.text || "",
            suggested_type: options?.context?.expectedType || null,
            confidence: result.ok ? 0.85 : 0,
            source_kind: "text",
            processing_time_ms: Date.now() - started,
            errors: result.ok ? [] : [result.error || "Recognition failed"],
            warnings: []
        };
    }

    async extractEntitiesFromData(data: string, instructionOptions?: InstructionOptions): Promise<{ ok: boolean; data?: any[]; error?: string }> {
        const instructionAddon = instructionOptions?.customInstruction ? `\n\nCUSTOM INSTRUCTION:\n${instructionOptions.customInstruction}` : "";
        const prompt = `Extract entities from the input as JSON array. Use concise schema with id/type/title/props when possible.${instructionAddon}`;
        const result = await this.runPrompt(String(data || ""), prompt);
        if (!result.ok) return { ok: false, error: result.error || "Entity extraction failed" };

        const parsed = parseJsonFromText(result.text);
        if (Array.isArray(parsed)) return { ok: true, data: parsed };
        if (Array.isArray(parsed?.entities)) return { ok: true, data: parsed.entities };
        if (parsed && typeof parsed === "object") return { ok: true, data: [parsed] };

        return { ok: true, data: [] };
    }

    async smartRecognize(data: string, hints?: SmartHints, instructionOptions?: InstructionOptions): Promise<RecognitionResult & { entities?: any[] }> {
        const expected = hints?.expectedType ? `\nExpected type: ${hints.expectedType}` : "";
        const domain = hints?.domain ? `\nDomain: ${hints.domain}` : "";
        const language = hints?.language ? `\nLanguage: ${hints.language}` : "";
        const context = `${expected}${domain}${language}`.trim();

        const recognized = await this.recognize(String(data || ""), {
            context: context ? { expectedType: hints?.expectedType } : {},
            customInstruction: instructionOptions?.customInstruction
        });

        if (!recognized.ok || !hints?.extractEntities) return recognized;

        const entities = await this.extractEntitiesFromData(data, instructionOptions);
        return {
            ...recognized,
            entities: entities.ok ? entities.data : []
        };
    }
}

export const createOrchestrator = (config?: OrchestratorConfig): AIOrchestrator => {
    return new AIOrchestrator(config);
};

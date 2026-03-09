import { resolveGptProvider, type GptProviderConfig, hasExplicitCredentialInRequest } from "./provider.ts";
import { loadUserSettings, verifyUser } from "../lib/users.ts";
import { createOrchestrator } from "./Orchestrator.ts";

type AiSettingsContext = {
    userId: string;
    userKey: string;
    settings: any | null;
    provider: GptProviderConfig;
    orchestrator: ReturnType<typeof createOrchestrator>;
    hasExplicitCredential: boolean;
};

export type AiContextResult = { ok: false; error: string } | { ok: true; value: AiSettingsContext };

export const createAiContext = async (body: any): Promise<AiContextResult> => {
    const userId = String(body?.userId || "").trim();
    const userKey = String(body?.userKey || "").trim();
    if (!userId || !userKey) return { ok: false, error: "Missing credentials" };

    const record = await verifyUser(userId, userKey);
    if (!record) return { ok: false, error: "Invalid credentials" };

    const settings = await loadUserSettings(userId, userKey).catch(() => null);
    const provider = resolveGptProvider(body, settings as any);
    if (!provider.apiKey && !provider.bearerToken) {
        return { ok: false, error: "Missing AI api key or bearer token in request, settings, config, or env." };
    }

    return {
        ok: true,
        value: {
            userId,
            userKey,
            settings,
            provider,
            orchestrator: createOrchestrator({
                apiKey: provider.apiKey || provider.bearerToken || "",
                baseUrl: provider.baseUrl,
                model: provider.model,
                mcp: provider?.mcp
            }),
            hasExplicitCredential: hasExplicitCredentialInRequest(body)
        }
    };
};

export const toAiCustomInstruction = (body: any, settings: any): string => {
    const instructions = settings?.customInstructions || [];
    const activeId = settings?.activeInstructionId;
    if (!activeId) return String(body?.customInstruction || "").trim();
    const active = instructions.find((item: any) => item.id === activeId);
    const activeInstruction = active?.instruction || "";
    return String(body?.customInstruction || activeInstruction || "").trim();
};

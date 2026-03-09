import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import type { Settings, AiSettings } from "../config/config.ts";

import config from "../config/config.ts";

type RawProvider = {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    mcp?: any;
    bearerToken?: string;
    proxyPath?: string;
};

export type GptProviderConfig = {
    apiKey?: string;
    baseUrl: string;
    model: string;
    mcp?: Array<any>;
    bearerToken?: string;
    proxyPath?: string;
};

const DEFAULT_BASE_URL = "https://api.proxyapi.ru/openai/v1";
const DEFAULT_PROXY_PATH = "/responses";
const DEFAULT_MODEL = "gpt-5.2";
let dotenvLoaded = false;

export const loadEndpointDotenv = (): void => {
    if (dotenvLoaded) return;
    dotenvLoaded = true;

    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), ".env.local"), path.resolve(moduleDir, "../../.env"), path.resolve(moduleDir, "../../.env.local"), path.resolve(moduleDir, "../../../.env"), path.resolve(moduleDir, "../../../.env.local"), path.resolve(moduleDir, "../../../../.env")];

    for (const candidate of candidates) {
        dotenv.config({ path: candidate });
    }
};

const pickString = (...values: Array<unknown>): string | undefined => {
    for (const value of values) {
        if (typeof value === "string") {
            const trimmed = value.trim();
            if (trimmed) return trimmed;
        }
    }
    return undefined;
};

const normalizePath = (value?: string): string | undefined => {
    if (!value) return undefined;
    const normalized = value.trim();
    if (!normalized) return undefined;
    return normalized.startsWith("/") ? normalized : `/${normalized}`;
};

const asProviderFromConfig = (raw: unknown): RawProvider | undefined => {
    if (!raw || typeof raw !== "object") return undefined;
    const source = raw as Record<string, unknown>;
    const provider: RawProvider = {};

    const apiKey = pickString(source.apiKey, source.api_key, source.key, source.accessToken);
    if (apiKey) provider.apiKey = apiKey;

    const baseUrl = pickString(source.baseUrl, source.base_url, source.endpoint, source.url);
    if (baseUrl) provider.baseUrl = baseUrl;

    const model = pickString(source.model, source.customModel, source.modelName);
    if (model) provider.model = model;

    const bearerToken = pickString(source.bearerToken, source.bearer_token, source.token, source.authToken);
    if (bearerToken) provider.bearerToken = bearerToken;

    const proxyPath = pickString(source.proxyPath, source.path, source.endpointPath);
    if (proxyPath) provider.proxyPath = proxyPath;

    if (Array.isArray(source.mcp)) provider.mcp = source.mcp;

    return provider;
};

export const resolveEnvironmentGptProvider = (): GptProviderConfig => {
    loadEndpointDotenv();

    const cfg = (config as any)?.ai || (config as any)?.core?.ai || {};

    const env = asProviderFromConfig({
        apiKey: pickString(process.env.GPT_API_KEY, process.env.AI_API_KEY, process.env.OPENAI_API_KEY, process.env.API_KEY),
        baseUrl: pickString(process.env.GPT_BASE_URL, process.env.AI_BASE_URL, process.env.OPENAI_BASE_URL, process.env.ENDPOINT_AI_BASE_URL),
        model: pickString(process.env.GPT_MODEL, process.env.AI_MODEL, process.env.OPENAI_MODEL),
        bearerToken: pickString(process.env.GPT_BEARER_TOKEN, process.env.AI_BEARER_TOKEN, process.env.AUTH_TOKEN),
        proxyPath: pickString(process.env.GPT_PROXY_PATH, process.env.AI_PROXY_PATH),
        mcp: undefined
    });

    const provider: GptProviderConfig = {
        apiKey: pickString((cfg as any).apiKey, env.apiKey),
        baseUrl: pickString((cfg as any).baseUrl, env.baseUrl, DEFAULT_BASE_URL) || DEFAULT_BASE_URL,
        model: pickString((cfg as any).model, (cfg as any).customModel, env.model, DEFAULT_MODEL) || DEFAULT_MODEL,
        bearerToken: pickString((cfg as any).bearerToken, (cfg as any).token, env.bearerToken),
        proxyPath: normalizePath(pickString((cfg as any).proxyPath, env.proxyPath, DEFAULT_PROXY_PATH)),
        mcp: Array.isArray((cfg as any).mcp) ? (cfg as any).mcp : undefined
    };

    return provider;
};

export const resolveGptProvider = (body: unknown, settings?: Settings | null): GptProviderConfig => {
    const settingsAi = (settings?.ai as AiSettings | undefined) || {};
    const userProvider = asProviderFromConfig(body);
    const provider = asProviderFromConfig((body as Record<string, unknown>)?.provider);
    const bodyProvider = provider || undefined;
    const passthrough = asProviderFromConfig((body as any)?.passthrough || (body as any)?.throughput);
    const settingsProvider = asProviderFromConfig(settingsAi);
    const envProvider = resolveEnvironmentGptProvider();

    const fallbackProvider = asProviderFromConfig((config as any)?.ai || (config as any)?.core?.ai);

    const apiKey = pickString(bodyProvider?.apiKey, userProvider?.apiKey, (body as any)?.apiKey, (body as any)?.provider?.apiKey, passthrough?.apiKey, settingsProvider?.apiKey, fallbackProvider?.apiKey, envProvider.apiKey);

    const baseUrl = pickString(bodyProvider?.baseUrl, (body as any)?.baseUrl, (body as any)?.provider?.baseUrl, passthrough?.baseUrl, settingsProvider?.baseUrl, fallbackProvider?.baseUrl, envProvider.baseUrl);

    const model = pickString(bodyProvider?.model, (body as any)?.model, (body as any)?.provider?.model, passthrough?.model, settingsProvider?.model, (settingsAi as any)?.customModel, fallbackProvider?.model, envProvider.model);

    const bearerToken = pickString(bodyProvider?.bearerToken, (body as any)?.bearerToken, (body as any)?.provider?.bearerToken, passthrough?.bearerToken, (settingsAi as any)?.bearerToken, envProvider.bearerToken);

    const proxyPath = normalizePath(pickString(bodyProvider?.proxyPath, (body as any)?.proxyPath, passthrough?.proxyPath, (settingsAi as any)?.proxyPath, fallbackProvider?.proxyPath, envProvider.proxyPath, DEFAULT_PROXY_PATH));

    const providerMcp = (bodyProvider?.mcp as Array<any> | undefined) || (userProvider?.mcp as Array<any> | undefined) || ((body as any)?.mcp as Array<any> | undefined) || (passthrough?.mcp as Array<any> | undefined) || (settingsProvider as any)?.mcp || (fallbackProvider as any)?.mcp || envProvider.mcp;

    return {
        apiKey,
        baseUrl: baseUrl || DEFAULT_BASE_URL,
        model: model || DEFAULT_MODEL,
        bearerToken,
        proxyPath,
        mcp: Array.isArray(providerMcp) ? providerMcp : envProvider.mcp
    };
};

export const pickGptApiAuthHeader = (provider: GptProviderConfig): string | undefined => {
    const token = pickString(provider.bearerToken, provider.apiKey);
    if (!token) return undefined;
    return `Bearer ${token}`;
};

export const hasExplicitCredentialInRequest = (body: any): boolean => {
    if (!body || typeof body !== "object") return false;
    const hasPlainCredential = Boolean(body.apiKey) || Boolean(body.bearerToken) || Boolean(body.token) || Boolean(body.authToken) || Boolean((body as any).provider?.apiKey) || Boolean((body as any).provider?.bearerToken) || Boolean((body as any).provider?.token);

    const hasPassthroughCredential = Boolean((body as any).passthrough?.apiKey) || Boolean((body as any).passthrough?.bearerToken) || Boolean((body as any).passthrough?.token);

    return hasPlainCredential || hasPassthroughCredential;
};

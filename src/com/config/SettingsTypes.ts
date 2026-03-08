export type FieldType = "text" | "password" | "select" | "color-palette" | "shape-palette" | "number-select" | "textarea";

export type FieldOption = {
    value: string;
    label: string;
    color?: string;
    shape?: string;
};

export type FieldConfig = {
    path: string;
    label: string;
    type: FieldType;
    placeholder?: string;
    helper?: string;
    options?: FieldOption[];
};

export type GroupConfig = {
    key?: string;
    label: string;
    description?: string;
    collapsible?: boolean;
    startOpen?: boolean;
    fields: FieldConfig[];
};

export type SectionKey = "runtime" | "core" | "app" | "ai" | "mcp" | "webdav" | "timeline" | "additional";

export type SectionConfig = {
    key: SectionKey;
    title: string;
    icon: string;
    description: string;
    groups: GroupConfig[];
};

export type CoreMode = "native" | "endpoint";

export type RemoteTarget = {
    id: string;
    label?: string;
    url: string;
    method?: string;
    headers?: Record<string, string>;
    unencrypted?: boolean;
};

export type MCPConfig = {
    id: string;
    serverLabel: string;
    origin: string;
    clientKey: string;
    secretKey: string;
};

export type GridShape =
    | "square" | "squircle" | "circle" | "rounded" | "blob"     // Border-radius based
    | "hexagon" | "diamond" | "star" | "badge" | "heart"        // Clip-path polygonal
    | "clover" | "flower"                                        // Clip-path decorative
    | "egg" | "tear" | "wavy";                                           // Asymmetric / procedural

export type CustomInstruction = {
    id: string;
    label: string;
    instruction: string;
    enabled?: boolean;
    order?: number;
};

export type ResponseLanguage = "en" | "ru" | "auto" | "follow";
export type SpeechRecognitionLanguage = "ru" | "en" | "en-GB" | "en-US";
export type ReasoningEffort = "low" | "medium" | "high";
export type ResponseVerbosity = "low" | "medium" | "high";
export type ContextTruncation = "disabled" | "auto";
export type PromptCacheRetention = "in-memory" | "24h";
export type MarkdownStylePreset = "default" | "classic" | "compact" | "paper";
export type MarkdownFontFamilyPreset = "system" | "sans" | "serif" | "mono";
export type MarkdownPageSize = "auto" | "A4" | "Letter" | "Legal" | "A5";
export type MarkdownPageOrientation = "portrait" | "landscape";
export type MarkdownExtensionRule = {
    id?: string;
    pattern: string;
    replacement: string;
    flags?: string;
    enabled?: boolean;
};
export type MarkdownStyleModules = {
    typography?: boolean;
    tables?: boolean;
    codeBlocks?: boolean;
    blockquotes?: boolean;
    media?: boolean;
    printBreaks?: boolean;
};
export type MarkdownStylePlugins = {
    smartTypography?: boolean;
    softBreaksAsBr?: boolean;
    externalLinksNewTab?: boolean;
};

export const BUILTIN_AI_MODELS = [
    "gpt-5.1",
    "gpt-5.2",
    "gpt-5.3",
    "gpt-5.4",
    "gpt-5.2-chat-latest",
    "gpt-5.3-chat-latest",
    "gpt-5.3-instant"
] as const;

const defaultSpeechLanguage = (): SpeechRecognitionLanguage => {
    const fallback: SpeechRecognitionLanguage = "en-US";
    if (typeof navigator === "undefined") return fallback;
    const normalized = (navigator.language || "").trim();
    if (normalized === "ru" || normalized.startsWith("ru-")) return "ru";
    if (normalized === "en-GB") return "en-GB";
    if (normalized === "en-US") return "en-US";
    if (normalized === "en" || normalized.startsWith("en-")) return "en";
    return fallback;
};

export type AppSettings = {
    core?: {
        mode?: CoreMode;
        endpointUrl?: string;
        userId?: string;
        userKey?: string;
        encrypt?: boolean;
        preferBackendSync?: boolean;
        ntpEnabled?: boolean;
        ops?: {
            allowUnencrypted?: boolean;
            httpTargets?: RemoteTarget[];
            wsTargets?: RemoteTarget[];
            syncTargets?: RemoteTarget[];
        };
    };
    ai?: {
        apiKey?: string;
        baseUrl?: string;
        model?: string;
        customModel?: string;
        defaultReasoningEffort?: ReasoningEffort;
        defaultVerbosity?: ResponseVerbosity;
        maxOutputTokens?: number;
        contextTruncation?: ContextTruncation;
        promptCacheRetention?: PromptCacheRetention;
        maxToolCalls?: number;
        parallelToolCalls?: boolean;
        mcp?: MCPConfig[];
        shareTargetMode?: "analyze" | "recognize";
        /** When true (default), share-target / launch-queue will auto run AI and copy result to clipboard. */
        autoProcessShared?: boolean;
        customInstructions?: CustomInstruction[];
        activeInstructionId?: string;
        // Language and translation settings
        responseLanguage?: ResponseLanguage;
        translateResults?: boolean;
        // Graphics generation settings
        generateSvgGraphics?: boolean;
        // Request timeout settings (in seconds)
        requestTimeout?: {
            low?: number;    // Default: 60
            medium?: number; // Default: 300
            high?: number;   // Default: 900
        };
        maxRetries?: number; // Default: 2
    };
    webdav?: {
        url?: string;
        username?: string;
        password?: string;
        token?: string;
    };
    timeline?: {
        source?: string;
    };
    appearance?: {
        theme?: "light" | "dark" | "auto";
        fontSize?: "small" | "medium" | "large";
        color?: string;
        markdown?: {
            customCss?: string;
            printCss?: string;
            extensions?: MarkdownExtensionRule[];
            preset?: MarkdownStylePreset;
            fontFamily?: MarkdownFontFamilyPreset;
            fontSizePx?: number;
            lineHeight?: number;
            contentMaxWidthPx?: number;
            printScale?: number;
            page?: {
                size?: MarkdownPageSize;
                orientation?: MarkdownPageOrientation;
                marginMm?: number;
            };
            modules?: MarkdownStyleModules;
            plugins?: MarkdownStylePlugins;
        };
    };
    speech?: {
        language?: SpeechRecognitionLanguage;
    };
    grid?: {
        columns?: number;
        rows?: number;
        shape?: GridShape;
    };
};

export const DEFAULT_SETTINGS: AppSettings = {
    core: {
        mode: "native",
        endpointUrl: "http://localhost:6065",
        userId: "",
        userKey: "",
        encrypt: false,
        preferBackendSync: true,
        ntpEnabled: false,
        ops: {
            allowUnencrypted: false,
            httpTargets: [],
            wsTargets: [],
            syncTargets: []
        }
    },
    ai: {
        apiKey: "",
        baseUrl: "",
        model: "gpt-5.2",
        customModel: "",
        defaultReasoningEffort: "medium",
        defaultVerbosity: "medium",
        maxOutputTokens: 400000,
        contextTruncation: "disabled",
        promptCacheRetention: "in-memory",
        maxToolCalls: 8,
        parallelToolCalls: true,
        mcp: [],
        shareTargetMode: "recognize",
        autoProcessShared: true,
        customInstructions: [],
        activeInstructionId: "",
        responseLanguage: "auto",
        translateResults: false,
        generateSvgGraphics: false,
        requestTimeout: {
            low: 60,      // 1 minute
            medium: 300,  // 5 minutes
            high: 900     // 15 minutes
        },
        maxRetries: 2
    },
    webdav: {
        url: "http://localhost:6065",
        username: "",
        password: "",
        token: ""
    },
    timeline: {
        source: ""
    },
    appearance: {
        theme: "auto",
        fontSize: "medium",
        color: "",
        markdown: {
            customCss: "",
            printCss: "",
            extensions: [],
            preset: "default",
            fontFamily: "system",
            fontSizePx: 16,
            lineHeight: 1.7,
            contentMaxWidthPx: 860,
            printScale: 1,
            page: {
                size: "auto",
                orientation: "portrait",
                marginMm: 12
            },
            modules: {
                typography: true,
                tables: true,
                codeBlocks: true,
                blockquotes: true,
                media: true,
                printBreaks: true
            },
            plugins: {
                smartTypography: false,
                softBreaksAsBr: false,
                externalLinksNewTab: true
            }
        }
    },
    speech: {
        language: defaultSpeechLanguage()
    },
    grid: {
        columns: 4,
        rows: 8,
        shape: "square"
    }
};

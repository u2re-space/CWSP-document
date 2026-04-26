const SUPPORTED_SPEECH_LANGUAGES = ["en", "ru", "en-GB", "en-US"] as const;
export type SupportedSpeechLanguage = (typeof SUPPORTED_SPEECH_LANGUAGES)[number];

export const speechLanguageLabel = (lang: SupportedSpeechLanguage): string => {
    if (lang === "en") return "English (generic)";
    if (lang === "ru") return "Russian";
    if (lang === "en-GB") return "English (UK)";
    return "English (US)";
};

const normalizeSpeechLanguage = (lang: string | undefined): SupportedSpeechLanguage | null => {
    const value = (lang || "").trim();
    if (!value) return null;
    if (value === "ru" || value.startsWith("ru-")) return "ru";
    if (value === "en-GB") return "en-GB";
    if (value === "en-US") return "en-US";
    if (value === "en" || value.startsWith("en-")) return "en";
    return null;
};

export const buildSpeechLanguageOptions = (): SupportedSpeechLanguage[] => {
    const ordered = new Set<SupportedSpeechLanguage>();
    const navLanguages = typeof navigator !== "undefined"
        ? [...(navigator.languages || []), navigator.language]
        : [];

    for (const navLanguage of navLanguages) {
        const normalized = normalizeSpeechLanguage(navLanguage);
        if (normalized) ordered.add(normalized);
    }
    for (const fallback of SUPPORTED_SPEECH_LANGUAGES) {
        ordered.add(fallback);
    }
    return Array.from(ordered);
};

export const buildResponseLanguageOptions = (): string[] => {
    const baseline = ["ru", "en"];
    const ordered = new Set<string>(baseline);
    const navLanguages = typeof navigator !== "undefined"
        ? [...(navigator.languages || []), navigator.language]
        : [];

    for (const navLanguage of navLanguages) {
        const value = (navLanguage || "").trim();
        if (!value || value === "en" || value === "ru") continue;
        ordered.add(value);
    }

    return Array.from(ordered);
};

export const parseNumberOrDefault = (value: string | undefined, fallback: number): number => {
    const parsed = Number((value || "").trim());
    if (!Number.isFinite(parsed)) return fallback;
    return parsed;
};

export const parseFloatInRange = (value: string | undefined, fallback: number, min: number, max: number): number => {
    const parsed = Number.parseFloat((value || "").trim());
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
};

export const readTrimmedControlValue = (
    control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null | undefined,
    fallback = ""
): string => {
    return control ? control.value.trim() : fallback;
};

export const readCheckboxValue = (control: HTMLInputElement | null | undefined, fallback: boolean): boolean => {
    return control ? Boolean(control.checked) : fallback;
};

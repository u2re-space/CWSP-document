/**
 * Text Utilities
 *
 * Text formatting and manipulation utilities.
 */

import { writeText } from "@rs-core/modules/Clipboard";
import { parseDateCorrectly, getISOWeekNumber, getTimeZone, formatDateTime } from "@rs-core/time";

// ============================================================================
// STRING UTILITIES
// ============================================================================

/**
 * Check if fragment is not empty
 */
export const isNotEmpty = (frag: any): boolean => {
    return !!(typeof frag == "string" ? frag?.trim?.() : frag);
};

/**
 * Convert to string safely
 */
export const toStringSafe = (value: unknown): string => {
    return typeof value === "string" ? value : value == null ? "" : String(value);
};

/**
 * Collapse whitespace to single spaces
 */
export const collapseWhitespace = (value: string): string => {
    return value.replace(/\s+/g, " ").trim();
};

/**
 * Convert label (capitalize first, replace _ with space)
 */
export const MAKE_LABEL = (label: string): string => {
    return label?.charAt?.(0)?.toUpperCase?.() + label?.slice?.(1)?.replace?.(/_/g, " ");
};

/**
 * Crop first letter (uppercase)
 */
export const cropFirstLetter = (text: string | any): string => {
    return text?.charAt?.(0)?.toUpperCase?.() || "C";
};

/**
 * Convert to start case (Title Case)
 */
export const startCase = (value: string): string => {
    return value
        .replace(/[_\-]+/g, " ")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^./, char => char.toUpperCase());
};

/**
 * Render tab name (capitalize, replace _ with space)
 */
export const renderTabName = (tabName: string): string => {
    if (!tabName) return "";
    tabName = tabName?.replace?.(/_/g, " ") || tabName;
    tabName = (tabName?.charAt?.(0)?.toUpperCase?.() + tabName?.slice?.(1)) || tabName;
    return tabName;
};

// ============================================================================
// MULTILINE UTILITIES
// ============================================================================

/**
 * Convert value to multiline string
 */
export const toMultiline = (value: unknown): string => {
    if (!value) return "";
    if (Array.isArray(value)) {
        return value.map(item => (item ?? "").toString().trim()).filter(Boolean).join("\n");
    }
    return String(value ?? "");
};

/**
 * Convert multiline string to array
 */
export const fromMultiline = (value: string): string[] => {
    if (!value) return [];
    return value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
};

/**
 * Count lines in text
 */
export const countLines = (text: string | any): number => {
    if (!text) return 0;
    return Array.isArray(text) ? text.length : text?.split?.(/\r\n|\r|\n/)?.length;
};

/**
 * Wrap text in span
 */
export const wrapBySpan = (text: string | any): string => {
    if (!text) return "";
    return `<span>${Array.isArray(text) ? text?.join?.(",") : text}</span>`;
};

/**
 * Card render options
 */
export interface CardRenderOptions {
    order?: number | null | undefined;
}

// ============================================================================
// PATH UTILITIES
// ============================================================================

/**
 * Split path by dots
 */
export const splitPath = (path: string): string[] => path.split(".").filter(Boolean);

/**
 * Get value by path
 */
export const getByPath = (source: any, path: string): any => {
    return splitPath(path).reduce((acc, key) => (acc == null ? acc : acc[key]), source);
};

/**
 * Set value by path
 */
export const setByPath = (target: any, path: string, value: any): void => {
    const keys = splitPath(path);
    if (!keys.length) return;

    let current = target;
    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (typeof current[key] !== "object" || current[key] === null) {
            current[key] = {};
        }
        current = current[key];
    }
    current[keys[keys.length - 1]] = value;
};

/**
 * Unset value by path
 */
export const unsetByPath = (target: any, path: string): void => {
    const keys = splitPath(path);
    if (!keys.length) return;

    const parents: Array<[any, string]> = [];
    let current = target;

    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (current?.[key] === undefined) return;
        parents.push([current, key]);
        current = current[key];
        if (typeof current !== "object" || current === null) return;
    }

    const lastKey = keys[keys.length - 1];
    if (current && Object.prototype.hasOwnProperty.call(current, lastKey)) {
        delete current[lastKey];
        // Clean up empty parent objects
        for (let i = parents.length - 1; i >= 0; i--) {
            const [parent, key] = parents[i];
            const value = parent[key];
            if (value && typeof value === "object" && !Array.isArray(value) && !Object.keys(value).length) {
                delete parent[key];
            } else {
                break;
            }
        }
    }
};

/**
 * Make object entries
 */
export const makeObjectEntries = (object: any): [string, any][] => {
    if (!object) return [];
    if (typeof object == "object" || typeof object == "function") {
        return [...Object.entries(object)];
    }
    return [];
};

// ============================================================================
// MARKDOWN STRIPPING
// ============================================================================

/**
 * Strip markdown syntax from text
 */
export const stripMarkdown = (value: unknown): string => {
    const input = toStringSafe(value);
    if (!input) return "";

    return input
        .replace(/```[\s\S]*?```/g, " ")           // code blocks
        .replace(/`([^`]+)`/g, "$1")               // inline code
        .replace(/!\[[^\]]*\]\([^\)]+\)/g, " ")    // images
        .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")  // links
        .replace(/(^|\n)\s{0,3}>\s?/g, "$1")       // blockquotes
        .replace(/(^|\n)\s{0,3}#{1,6}\s+/g, "$1")  // headers
        .replace(/(^|\n)\s{0,3}[-*+]\s+/g, "$1")   // unordered lists
        .replace(/(^|\n)\s{0,3}\d+\.\s+/g, "$1")   // ordered lists
        .replace(/(^|\n)---[\s\S]*?---(?=\n|$)/g, "$1") // front matter
        .replace(/[\\*_~]/g, "")                   // emphasis chars
        .replace(/`/g, "")                         // remaining backticks
        .replace(/&nbsp;/gi, " ")                  // nbsp entities
        .replace(/<\/?[^>]+>/g, " ");              // HTML tags
};

/**
 * Sanitize document snippet
 */
export const sanitizeDocSnippet = (value: unknown): string => {
    return collapseWhitespace(stripMarkdown(value));
};

/**
 * Truncate document snippet
 */
export const truncateDocSnippet = (value: string, limit = 260): string => {
    const trimmed = value.trim();
    if (!limit || trimmed.length <= limit) return trimmed;
    return `${trimmed.slice(0, Math.max(1, limit - 1)).trimEnd()}…`;
};

// ============================================================================
// DATE TITLE BUILDERS
// ============================================================================

/**
 * Ensure date from various formats
 */
export const ensureDate = (value: any): Date | null => {
    if (!value) return null;
    const parsed = parseDateCorrectly(value);
    if (!parsed) return null;
    const time = parsed.getTime?.();
    return Number.isFinite(time) ? parsed : null;
};

/**
 * Resolve begin date from day descriptor
 */
export const resolveBeginDate = (dayDesc: any): Date | null => {
    return ensureDate(dayDesc?.begin_time ?? dayDesc?.properties?.begin_time ?? dayDesc?.start);
};

/**
 * Build primary day title
 */
export const buildPrimaryDayTitle = (dayDesc: any): string => {
    const preset = dayDesc?.separatorTitle;
    if (typeof preset === "string" && preset.trim()) return preset;

    const date = resolveBeginDate(dayDesc);
    if (!date) return dayDesc?.title || dayDesc?.id || "Day";

    const formatted = date.toLocaleDateString("en-GB", {
        timeZone: getTimeZone(),
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric"
    });

    const week = dayDesc?.weekNumber ?? getISOWeekNumber(date);
    if (week && formatted) return `${formatted} · Week ${week}`;
    return formatted;
};

/**
 * Build secondary day title
 */
export const buildSecondaryDayTitle = (dayDesc: any, primary: string): string | null => {
    const label = dayDesc?.title;
    if (!label) return null;
    if (!primary) return label;
    return label.trim() === primary.trim() ? null : label;
};

// ============================================================================
// DRAG & COPY HANDLERS
// ============================================================================

/**
 * Begin drag as text
 */
export const beginDragAsText = (ev: DragEvent): void => {
    const text = (ev.currentTarget as HTMLElement)?.textContent?.trim?.();
    if (text) {
        ev.dataTransfer!.effectAllowed = "copy";
        ev.dataTransfer?.clearData?.();
        ev.dataTransfer?.setData?.("plain/text", text);
    }
};

/**
 * Copy phone on click
 */
export const copyPhoneClick = (ev: Event): void => {
    const element = ev.currentTarget as HTMLElement;
    const isPhoneElement = element?.matches?.('.phone') ? element : element?.querySelector?.('.phone');

    if (isPhoneElement) {
        ev?.preventDefault?.();
        ev?.stopPropagation?.();
        const phone = isPhoneElement?.textContent?.trim?.() ?? '';
        if (phone) writeText(phone);
    }
};

/**
 * Copy email on click
 */
export const copyEmailClick = (ev: Event): void => {
    const element = ev.currentTarget as HTMLElement;
    const isEmailElement = element?.matches?.('.email') ? element : element?.querySelector?.('.email');

    if (isEmailElement) {
        ev?.preventDefault?.();
        ev?.stopPropagation?.();
        const email = isEmailElement?.textContent?.trim?.() ?? '';
        if (email) writeText(email);
    }
};

// ============================================================================
// RE-EXPORTS
// ============================================================================

export { formatDateTime };

/**
 * Core Module
 *
 * Central module providing core utilities for the CrossWord application.
 *
 * Structure (PWA `dist/core/` chunks group by first directory; api/time/text/phone/workers fold into `main`):
 * - api/      : API client and service communication
 * - storage/  : localStorage, sessionStorage, IndexedDB, OPFS helpers, FS utilities
 * - document/ : Markdown rendering, DOCX export, document tools
 * - time/     : Time/date utilities
 * - text/     : Text formatting utilities
 * - phone/    : Phone number utilities
 * - workers/  : Worker-facing helpers (bundled with main chunk for deploy)
 * - modules/  : Feature modules (clipboard, history, etc.)
 * - utils/    : General utilities (types, theme, etc.)
 *
 * OPFS uniform worker script is emitted under `dist/workers/opfs/` (see fest/lure OPFS bridge).
 */

// ============================================================================
// API
// ============================================================================

export {
    api,
    API_PATHS,
    fetchWithTimeout,
    fetchWithRetry,
    type ApiResponse,
    type ProcessingOptions,
    type AnalyzeOptions,
    type ApiPath
} from "./api";

// ============================================================================
// STORAGE
// ============================================================================

export {
    // Keys
    StorageKeys,
    type StorageKey,

    // LocalStorage
    getItem,
    setItem,
    removeItem,
    getString,
    setString,
    isLocalStorageAvailable,

    // SessionStorage
    getSessionItem,
    setSessionItem,
    removeSessionItem,

    // IndexedDB
    getIDBItem,
    setIDBItem,
    removeIDBItem,
    IDBStorage,

    // Pre-configured instances
    workCenterStorage,
    historyStorage,
    settingsStorage
} from "./storage";

// ============================================================================
// TIME UTILITIES
// ============================================================================

export {
    // Timezone
    getTimeZone,

    // Parsing
    isPureHHMM,
    parseDateCorrectly,
    parseAndGetCorrectTime,
    getComparableTimeValue,
    isDate,

    // Range checks
    checkInTimeRange,
    checkRemainsTime,

    // Day descriptors
    getISOWeekNumber,
    createDayDescriptor,
    insideOfDay,
    notInPast,

    // Timeline
    SplitTimelinesByDays,
    computeTimelineOrderInGeneral,
    computeTimelineOrderInsideOfDay,

    // Formatting
    normalizeSchedule,
    formatAsTime,
    formatAsDate,
    formatDateTime
} from "./time";

// ============================================================================
// TEXT UTILITIES
// ============================================================================

export {
    // String utilities
    isNotEmpty,
    toStringSafe,
    collapseWhitespace,
    MAKE_LABEL,
    cropFirstLetter,
    startCase,
    renderTabName,

    // Multiline
    toMultiline,
    fromMultiline,
    countLines,
    wrapBySpan,

    // Path utilities
    splitPath,
    getByPath,
    setByPath,
    unsetByPath,
    makeObjectEntries,

    // Markdown stripping
    stripMarkdown,
    sanitizeDocSnippet,
    truncateDocSnippet,

    // Date titles
    ensureDate,
    resolveBeginDate,
    buildPrimaryDayTitle,
    buildSecondaryDayTitle,

    // Drag & copy handlers
    beginDragAsText,
    copyPhoneClick,
    copyEmailClick
} from "./text";

// ============================================================================
// PHONE UTILITIES
// ============================================================================

export {
    // Constants
    PHONE_CANDIDATE_RE,
    EXT_CUT_RE,

    // Normalization
    normalizeOne,
    splitCandidates,
    normalizePhones,

    // Row helpers
    getIndexForRow,
    getPhonesFromRow,

    // Duplicate detection
    findDuplicatePhones,

    // Types
    type NormalizeOptions,
    type DuplicateResult
} from "./phone";

// ============================================================================
// DOCUMENT (Markdown & DOCX)
// ============================================================================

export {
    // Markdown
    renderMarkdown,
    renderMarkdownToElement,
    renderMarkdownSync,
    extractTitle,
    isLikelyMarkdown,
    type RenderOptions,
    type MarkdownResult,

    // DOCX
    downloadMarkdownAsDocx,
    downloadHtmlAsDocx,
    createDocxBlobFromHtml,
    createDocxBlobFromMarkdown,
    type DocxExportOptions,

    // Conversion
    convertToHtml,
    convertToMarkdown,
    copyAsMarkdown,
    copyAsHTML,
    copyAsTeX,
    copyAsMathML,
    type CopyOptions,

    // Parsing
    parseMarkdownEntry,
    unique,
    normalizeCollections,
    ensureCollections
} from "./document";

// ============================================================================
// CLIPBOARD
// ============================================================================

export {
    copy,
    writeText,
    writeHTML,
    writeImage,
    readText,
    toText,
    requestCopy,
    listenForClipboardRequests,
    initClipboardReceiver,
    requestCopyViaCRX,
    isChromeExtension,
    isClipboardAvailable,
    isClipboardWriteAvailable,
    COPY_HACK,
    copyWithResult,
    type ClipboardDataType,
    type ClipboardWriteOptions,
    type ClipboardResult,
    type CRXCopyOptions
} from "../../../../modules/projects/lur.e/src/extension/modules/Clipboard";

// Legacy aliases
export { copy as copyToClipboard } from "../../../../modules/projects/lur.e/src/extension/modules/Clipboard";
export { readText as readFromClipboard } from "../../../../modules/projects/lur.e/src/extension/modules/Clipboard";

// ============================================================================
// FILE UTILITIES
// ============================================================================

export {
    // Type detection
    isMarkdownFile,
    isTextFile,
    isImageFile,
    isCodeFile,

    // Reading
    readFileAsText,
    readFileAsDataURL,
    readFileAsArrayBuffer,

    // Creation
    createTextFile,
    createMarkdownFile,
    createJsonFile,

    // Download
    downloadFile,
    downloadTextFile,
    downloadMarkdown,

    // Picking
    pickFile,
    pickFiles,
    pickMarkdownFile,

    // File System Access API
    saveFile,
    openFile
} from "./storage/file-utils";

// ============================================================================
// MODULES (Feature modules)
// ============================================================================

export { getCachedComponent, clearComponentCache, disposeCachedComponents } from "../../../../modules/projects/lur.e/src/extension/modules/LazyLoader";
export { createFileHandler } from "./storage/FileHandling";
export { getSpeechPrompt } from "../../../../modules/projects/lur.e/src/extension/modules/VoiceInput";
export { createTemplateManager } from "../../../../modules/projects/lur.e/src/extension/modules/TemplateManager";
export { HistoryManager, createHistoryManager } from "../../../../modules/projects/lur.e/src/extension/modules/HistoryManager";

// ============================================================================
// GENERAL UTILITIES
// ============================================================================

export * from "./utils";

// ============================================================================
// COMMON HELPER FUNCTIONS
// ============================================================================

/**
 * Create a debounced function
 */
export function debounce<T extends (...args: any[]) => any>(
    fn: T,
    delay: number
): (...args: Parameters<T>) => void {
    let timeoutId: ReturnType<typeof setTimeout>;
    return (...args: Parameters<T>) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), delay);
    };
}

/**
 * Create a throttled function
 */
export function throttle<T extends (...args: any[]) => any>(
    fn: T,
    limit: number
): (...args: Parameters<T>) => void {
    let inThrottle = false;
    return (...args: Parameters<T>) => {
        if (!inThrottle) {
            fn(...args);
            inThrottle = true;
            setTimeout(() => (inThrottle = false), limit);
        }
    };
}

/**
 * Wait for a specific duration
 */
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate a unique ID
 */
export function uniqueId(prefix = ""): string {
    return `${prefix}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Deep clone an object
 */
export function deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== "object") return obj;
    if (obj instanceof Date) return new Date(obj.getTime()) as T;
    if (obj instanceof Array) return obj.map(item => deepClone(item)) as T;
    if (obj instanceof Object) {
        const cloned = {} as T;
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                (cloned as any)[key] = deepClone((obj as any)[key]);
            }
        }
        return cloned;
    }
    return obj;
}

/**
 * Check if value is empty (null, undefined, empty string, empty array/object)
 */
export function isEmpty(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value === "string") return value.trim().length === 0;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "object") return Object.keys(value).length === 0;
    return false;
}

/**
 * Clamp a number between min and max
 */
export function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

/**
 * Check if we're in a browser environment
 */
export function isBrowser(): boolean {
    return typeof window !== "undefined" && typeof document !== "undefined";
}

/**
 * Check if we're in a worker environment
 */
export function isWorker(): boolean {
    return typeof self !== "undefined" && typeof window === "undefined";
}

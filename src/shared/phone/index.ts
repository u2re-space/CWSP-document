/**
 * Phone Utilities
 *
 * Phone number normalization and duplicate detection.
 * Primarily designed for Russian (RF) phone numbers.
 */

// ============================================================================
// CONSTANTS
// ============================================================================

export const PHONE_CANDIDATE_RE = /\+?\d[\d\s().\-]{4,}\d/g;
export const EXT_CUT_RE = /(доб\.?|доп\.?|ext\.?|extension)\s*[:#\-x]*\s*\d+.*/i;

// ============================================================================
// NORMALIZATION OPTIONS
// ============================================================================

export interface NormalizeOptions {
    defaultTrunk?: string;
    countryCode?: string;
    cityCode?: string | null;
    stripExtensions?: boolean;
    minLocal?: number;
    maxLocal?: number;
}

const DEFAULT_OPTIONS: Required<NormalizeOptions> = {
    defaultTrunk: '8',
    countryCode: '7',
    cityCode: null,
    stripExtensions: true,
    minLocal: 5,
    maxLocal: 7
};

// ============================================================================
// NORMALIZATION
// ============================================================================

/**
 * Normalize a single phone number
 * Returns null if cannot be normalized to valid format
 */
export const normalizeOne = (input: string, options: NormalizeOptions = {}): string | null => {
    if (input == null) return null;
    const opts = { ...DEFAULT_OPTIONS, ...options };

    let s = String(input).trim();
    if (!s) return null;

    // Strip extensions
    if (opts.stripExtensions) {
        s = s.replace(EXT_CUT_RE, '');
    }

    // Flag for leading plus (important for +7 → 8)
    const hasPlusInStart = /^\+/.test(s);

    // Remove all non-digit characters
    let digits = s.replace(/\D/g, '');
    if (!digits) return null;

    // Normalization for Russia (RF)
    if (hasPlusInStart && digits.startsWith(opts.countryCode)) {
        // +7xxxxxxxxxx → 8xxxxxxxxxx
        digits = opts.defaultTrunk + digits.slice(opts.countryCode.length);
    } else if (digits.length === 11 && digits.startsWith(opts.countryCode)) {
        // 7xxxxxxxxxx (11 digits) → 8xxxxxxxxxx
        digits = opts.defaultTrunk + digits.slice(1);
    } else if (digits.length === 10) {
        // 10 digits (mobile/local with area code) → prepend defaultTrunk
        digits = opts.defaultTrunk + digits;
    } else if (opts.cityCode && digits.length >= opts.minLocal && digits.length <= opts.maxLocal) {
        // 5–7 digits (local city numbers) → prepend defaultTrunk + cityCode
        digits = opts.defaultTrunk + opts.cityCode + digits;
    } else if (digits.length === 11 && digits.startsWith(opts.defaultTrunk)) {
        // Already 11 digits starting with defaultTrunk (8) — leave as is
    } else if (opts.cityCode && digits.length === opts.cityCode.length + 7) {
        // cityCode + local (no leading 8) — prepend defaultTrunk
        digits = opts.defaultTrunk + digits;
    } else {
        // Could not normalize to 11-digit RF format
        return null;
    }

    // Expect 11 digits starting with defaultTrunk (8)
    return /^\d{11}$/.test(digits) ? digits : null;
};

/**
 * Split string into phone candidates
 */
export const splitCandidates = (value: string): string[] => {
    if (value == null) return [];
    const s = String(value);
    const matches = s.match(PHONE_CANDIDATE_RE);
    if (matches?.length) return matches;
    // Fallback: split by common delimiters
    return s.split(/[;,/|]+/).map(x => x.trim()).filter(Boolean);
};

/**
 * Normalize multiple phone numbers
 */
export const normalizePhones = (value: string | string[], options: NormalizeOptions = {}): string[] => {
    const out = new Set<string>();

    if (Array.isArray(value)) {
        for (const v of value) {
            if (typeof v === 'string') {
                for (const cand of splitCandidates(v)) {
                    const n = normalizeOne(cand, options);
                    if (n) out.add(n);
                }
            } else {
                const n = normalizeOne(v, options);
                if (n) out.add(n);
            }
        }
    } else if (typeof value === 'string') {
        for (const c of splitCandidates(value)) {
            const n = normalizeOne(c, options);
            if (n) out.add(n);
        }
    } else {
        const n = normalizeOne(value, options);
        if (n) out.add(n);
    }

    return [...out];
};

// ============================================================================
// ROW HELPERS
// ============================================================================

/**
 * Get index for row
 */
export const getIndexForRow = (row: any, pos: number): number => {
    if (Array.isArray(row) && typeof row[1] === 'number') return row[1];
    if (row && typeof row === 'object' && typeof row.index === 'number') return row.index;
    return pos;
};

/**
 * Get phones from row
 */
export const getPhonesFromRow = (row: any): any => {
    if (Array.isArray(row)) return row[0];
    if (row && typeof row === 'object') {
        if ('phones' in row) return row.phones;
        if ('phone' in row) return row.phone;
    }
    return row;
};

// ============================================================================
// DUPLICATE DETECTION
// ============================================================================

export interface DuplicateResult {
    duplicatesByNumber: Record<string, number[]>;
    pairs: [number, string[]][];
    duplicatesByIndex: Record<string, string[]>;
    normalize: (s: string) => string | null;
}

/**
 * Find duplicate phone numbers in rows
 */
export function findDuplicatePhones(rows: any[], userOptions: NormalizeOptions = {}): DuplicateResult {
    const options = { ...DEFAULT_OPTIONS, ...userOptions };

    const numberToIndices = new Map<string, Set<number>>();
    const indexToNumbersAll = new Map<number, Set<string>>();

    rows.forEach((row: any, pos: number) => {
        const idx = getIndexForRow(row, pos);
        const phonesRaw = getPhonesFromRow(row);
        const phones = normalizePhones(phonesRaw, options);

        if (!indexToNumbersAll.has(idx)) indexToNumbersAll.set(idx, new Set());
        const setForIndex = indexToNumbersAll.get(idx)!;

        for (const p of phones) {
            setForIndex.add(p);
            if (!numberToIndices.has(p)) numberToIndices.set(p, new Set());
            numberToIndices.get(p)!.add(idx);
        }
    });

    // Keep only duplicates
    const duplicatesByNumber: Record<string, number[]> = {};
    for (const [num, set] of numberToIndices.entries()) {
        if (set.size > 1) {
            duplicatesByNumber[num] = [...set].sort((a, b) => a - b);
        }
    }

    // For each index — which numbers intersect
    const duplicatesByIndex: Record<string, string[]> = {};
    for (const [idx, set] of indexToNumbersAll.entries()) {
        const dups = [...set].filter(n => duplicatesByNumber[n]);
        if (dups.length) duplicatesByIndex[idx] = dups.sort();
    }

    // Pairs [index, phone[]] only where there are intersections
    const pairs = Object.entries(duplicatesByIndex)
        .map(([idx, nums]) => [Number(idx), nums] as [number, string[]])
        .sort((a, b) => a[0] - b[0]);

    return {
        duplicatesByNumber,
        pairs,
        duplicatesByIndex,
        normalize: (s: string) => normalizeOne(s, options)
    };
}

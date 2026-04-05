/**
 * Time Utilities
 *
 * Consolidated time/date handling utilities.
 */

import { observe } from "fest/object";
import type { ChapterDescriptor, DayDescriptor } from "@rs-core/utils/Types";
import type { EntityInterface, TimeType } from "@rs-com/template/EntityInterface";

// ============================================================================
// TIME ZONE
// ============================================================================

/**
 * Get current timezone
 */
export const getTimeZone = (): string => {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
};

// ============================================================================
// DATE PARSING
// ============================================================================

/**
 * Check if string is pure HH:MM format
 */
export function isPureHHMM(str?: TimeType | string | number | null | undefined): boolean {
    if (!str) return false;
    return /^([01]\d|2[0-3]):([0-5]\d)$/.test(String(str).trim());
}

/**
 * Parse date from various formats
 */
export function parseDateCorrectly(str?: Date | TimeType | string | number | null | undefined): Date | null {
    if (!str) return new Date();
    if (str instanceof Date) return new Date(str);
    if (typeof str == "object" && str?.timestamp) return parseDateCorrectly(str.timestamp);
    if (typeof str == "object" && str?.iso_date) return parseDateCorrectly(str.iso_date);
    if (typeof str == "object" && str?.date) return parseDateCorrectly(str.date);

    if (typeof str == "number") {
        if (str >= 1000000000000) return new Date(str);
        const multiplier = Math.pow(10, 11 - (String(str | 0)?.length || 11)) | 0;
        return new Date(str * multiplier);
    }

    if (typeof str == "string" && isPureHHMM(str)) {
        const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(str.trim());
        if (!m) return new Date();
        const [, hh, mm] = m;
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(hh), Number(mm), 0, 0);
    }

    return new Date(String(str));
}

/**
 * Parse and get time as number
 */
export function parseAndGetCorrectTime(str?: Date | TimeType | string | number | null | undefined): number {
    if (!str) return Date.now();
    if (typeof str == "number") {
        if (str >= 1000000000000) return str;
        const multiplier = Math.pow(10, 11 - (String(str | 0)?.length || 11)) | 0;
        return str * multiplier;
    }
    if (str instanceof Date) return str.getTime();
    return parseDateCorrectly(str)?.getTime?.() ?? Date.now();
}

/**
 * Get comparable time value from various formats
 */
export const getComparableTimeValue = (value?: TimeType | Date | string | number | null | undefined): number => {
    if (value == null) return Number.NaN;
    if (typeof value === "number" && Number.isFinite(value)) return value;

    const date = parseDateCorrectly(value);
    if (date && !Number.isNaN(date?.getTime())) return date?.getTime() ?? 0;

    const match = String(value).match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?/);
    if (match) {
        const hours = Number(match[1]) || 0;
        const minutes = Number(match[2]) || 0;
        const seconds = Number(match[3]) || 0;
        return ((hours * 60 + minutes) * 60 + seconds) * 1000;
    }

    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : Number.NaN;
};

// ============================================================================
// DATE VALIDATION
// ============================================================================

/**
 * Check if value is a valid date
 */
export const isDate = (date: any): boolean => {
    const firstStep = date instanceof Date || (typeof date == "string" && date.match(/^\d{4}-\d{2}-\d{2}$/));
    let secondStep = false;
    try {
        secondStep = getComparableTimeValue(date) > 0;
    } catch {
        secondStep = false;
    }
    return firstStep && secondStep;
};

// ============================================================================
// TIME RANGE CHECKS
// ============================================================================

/**
 * Check if time is within range
 */
export const checkInTimeRange = (beginTime: Date, endTime: Date, currentTime: Date): boolean => {
    if (beginTime && endTime) {
        return getComparableTimeValue(beginTime) < getComparableTimeValue(currentTime) &&
               getComparableTimeValue(currentTime) < getComparableTimeValue(endTime);
    }
    if (beginTime) return getComparableTimeValue(beginTime) < getComparableTimeValue(currentTime);
    if (endTime) return getComparableTimeValue(currentTime) < getComparableTimeValue(endTime);
    return false;
};

/**
 * Check remaining time within max days
 */
export const checkRemainsTime = (beginTime: Date, endTime: Date, currentTime: Date, maxDays = 7): boolean => {
    let factorMasked = true;
    if (beginTime) factorMasked &&= getComparableTimeValue(currentTime) <= getComparableTimeValue(beginTime);
    if (endTime) factorMasked &&= getComparableTimeValue(currentTime) < getComparableTimeValue(endTime);
    if (maxDays) {
        const dateLimit = getComparableTimeValue(currentTime) + maxDays * 24 * 60 * 60 * 1000;
        factorMasked &&= getComparableTimeValue(beginTime) < getComparableTimeValue(dateLimit);
    }
    return factorMasked;
};

// ============================================================================
// DAY DESCRIPTORS
// ============================================================================

/**
 * Get ISO week number
 */
export const getISOWeekNumber = (input: Date | null | undefined): number | null => {
    if (!input) return null;
    const target = new Date(Date.UTC(input.getFullYear(), input.getMonth(), input.getDate()));
    const dayNumber = target.getUTCDay() || 7;
    target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
    const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
    return Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
};

/**
 * Create a day descriptor from date
 */
export const createDayDescriptor = (input: Date | null | undefined, partial: Record<string, any> = {}): DayDescriptor | null => {
    if (!input) return null;

    const timeZone = getTimeZone();
    const dayBegin = new Date(input.getTime());
    dayBegin.setHours(0, 0, 0, 0);

    const dayEnd = new Date(input.getTime());
    dayEnd.setHours(23, 59, 59, 999);

    const dayDay = dayBegin.toLocaleDateString("en-GB", { day: "numeric", timeZone });
    const dayWeekday = dayBegin.toLocaleDateString("en-GB", { weekday: "short", timeZone });
    const dayMonth = dayBegin.toLocaleDateString("en-GB", { month: "short", timeZone });
    const dayTitle = `${dayDay} ${dayMonth} ${dayWeekday}`;

    const dayDayForId = dayBegin.toLocaleDateString("en-GB", { day: "numeric", timeZone });
    const dayMonthForId = dayBegin.toLocaleDateString("en-GB", { month: "numeric", timeZone });
    const dayYearForId = dayBegin.toLocaleDateString("en-GB", { year: "numeric", timeZone });
    const dayId = `${dayDayForId}_${dayMonthForId}_${dayYearForId}`;

    const fullDay = dayBegin.toLocaleDateString("en-GB", {
        timeZone,
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric"
    });

    const weekNumber = getISOWeekNumber(dayBegin);
    const separatorTitle = weekNumber ? `${fullDay} · Week ${weekNumber}` : fullDay;

    return {
        id: dayId,
        title: dayTitle,
        begin_time: dayBegin.toISOString(),
        end_time: dayEnd.toISOString(),
        separatorTitle,
        weekNumber,
        ...partial
    };
};

/**
 * Check if entity is inside of day descriptor
 */
export const insideOfDay = <
    E extends EntityInterface<any, any> = EntityInterface<any, any>,
    T extends DayDescriptor = DayDescriptor
>(item: E, dayDesc: T): boolean => {
    const kind = typeof dayDesc == "string" ? dayDesc : (dayDesc as any)?.kind;
    const status = typeof dayDesc == "string" ? dayDesc : dayDesc?.status;
    const begin_time = typeof dayDesc == "string" ? dayDesc : dayDesc?.begin_time;
    const end_time = typeof dayDesc == "string" ? dayDesc : dayDesc?.end_time;

    const inRange = (
        (!begin_time || (getComparableTimeValue(item?.properties?.begin_time) >= getComparableTimeValue(begin_time)) || String(begin_time)?.toLowerCase?.()?.trim?.() == "all") &&
        (!end_time || (getComparableTimeValue(item?.properties?.end_time) <= getComparableTimeValue(end_time)) || String(end_time)?.toLowerCase?.()?.trim?.() == "all")
    );

    const kindMatch = (kind ? (item?.kind == kind || kind == "all") : false) || !item?.kind;
    const statusMatch = (status ? (item?.properties?.status == status || status == "all") : (!kindMatch)) || !item?.properties?.status;

    return inRange || statusMatch || kindMatch;
};

/**
 * Check if entity is not in the past
 */
export const notInPast = <
    E extends EntityInterface<any, any> = EntityInterface<any, any>,
    T extends DayDescriptor = DayDescriptor
>(item: E, dayDesc: T | null = null): boolean => {
    const kind = typeof dayDesc == "string" ? dayDesc : (dayDesc as any)?.kind;
    const status = typeof dayDesc == "string" ? dayDesc : dayDesc?.status;
    const end_time = typeof dayDesc == "string" ? dayDesc : dayDesc?.end_time;
    const now_time = getComparableTimeValue();

    const inRange = !end_time || getComparableTimeValue(end_time) >= now_time;
    const kindMatch = (kind ? (item?.kind == kind || kind == "all") : false) || !item?.kind;
    const statusMatch = (status ? (item?.properties?.status == status || status == "all") : (!kindMatch)) || !item?.properties?.status;
    return inRange || statusMatch || kindMatch;
};

// ============================================================================
// TIMELINE UTILITIES
// ============================================================================

/**
 * Split timelines by days
 */
export const SplitTimelinesByDays = async (timelineMap: any, daysDesc: any[] | null = null) => {
    daysDesc ??= observe([] as any[]) as any[];
    if (!timelineMap) return daysDesc;

    for (const timeline of (await timelineMap) ?? []) {
        if (timeline?.properties?.begin_time && timeline?.properties?.end_time) {
            const beginTime = parseDateCorrectly(timeline?.properties?.begin_time);
            const endTime = parseDateCorrectly(timeline?.properties?.end_time);

            let day = daysDesc?.find?.(day => {
                return getComparableTimeValue(beginTime) >= getComparableTimeValue(day?.begin_time) &&
                       getComparableTimeValue(endTime) <= getComparableTimeValue(day?.end_time);
            }) ?? null;

            if (!day && (getComparableTimeValue(endTime) >= getComparableTimeValue())) {
                const dayDescriptor = createDayDescriptor(beginTime, { status: "" });
                if (dayDescriptor) {
                    daysDesc?.push?.(day ??= dayDescriptor);
                }
            }
        }
    }

    return daysDesc;
};

/**
 * Compute timeline order in general
 */
export const computeTimelineOrderInGeneral = (timeOfDay: TimeType | string | number | null | undefined, minTimestamp?: number): number | null => {
    const dayStart = getComparableTimeValue(timeOfDay) || 0;
    const normalized = (Number.isFinite(dayStart) ? dayStart : 0) - (minTimestamp || 0);
    return Math.round(normalized / (24 * 60 * 60 * 1000));
};

/**
 * Compute timeline order inside of day
 */
export const computeTimelineOrderInsideOfDay = (item: EntityInterface<any, any>, dayDesc?: ChapterDescriptor | null): number | null => {
    const beginTime = getComparableTimeValue(item?.properties?.begin_time) || 0;
    const endTime = getComparableTimeValue(item?.properties?.end_time) || 0;
    const fallback = Number.isFinite(beginTime) ? beginTime : endTime;
    if (!Number.isFinite(fallback)) return 0;

    if (!dayDesc || !(dayDesc as any)?.begin_time) {
        dayDesc = createDayDescriptor(parseDateCorrectly(fallback ?? null));
    }

    const dayStart = getComparableTimeValue((dayDesc as any)?.begin_time) || 0;
    const normalized = (Number.isFinite(dayStart) ? (fallback - dayStart) : fallback);
    return Math.round(normalized / (60 * 1000));
};

// ============================================================================
// FORMATTING
// ============================================================================

/**
 * Normalize schedule to TimeType
 */
export const normalizeSchedule = (value: TimeType | string | number | null | undefined): TimeType | null => {
    if (!value) return null;
    if (typeof value === "object" && (value.date || value.iso_date || value.timestamp)) {
        return value;
    }
    return { iso_date: String(value) };
};

/**
 * Format as time string (HH:MM)
 */
export const formatAsTime = (time: TimeType | string | number | null | undefined): string => {
    const normalized = normalizeSchedule(time);
    if (!normalized) return "";
    return parseDateCorrectly(normalized)?.toLocaleTimeString?.("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: getTimeZone()
    }) || "";
};

/**
 * Format as date string
 */
export const formatAsDate = (date: TimeType | string | number | null | undefined): string => {
    return parseDateCorrectly(date)?.toLocaleDateString?.("en-GB", {
        day: "numeric",
        month: "long",
        weekday: "long",
        year: "numeric",
        timeZone: getTimeZone()
    }) || "";
};

/**
 * Format as date time string
 */
export const formatDateTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });
};

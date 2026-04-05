/**
 * View Component Types
 * 
 * Common types used across all view components.
 */

import type { View, ViewOptions, ShellContext } from "../shells/types";

// ============================================================================
// VIEW BASE TYPES
// ============================================================================

/**
 * Base options for view creation
 */
export interface BaseViewOptions extends ViewOptions {
    shellContext?: ShellContext;
    params?: Record<string, string>;
}

/**
 * Markdown content for viewer/editor
 */
export interface MarkdownContent {
    content: string;
    filename?: string;
    source?: string;
    modified?: boolean;
}

/**
 * File content for file-based views
 */
export interface FileContent {
    file: File;
    filename: string;
    mimeType: string;
    path?: string;
}

export type ViewReceiveSource = "share-target" | "launch-queue" | "pending" | "clipboard";

export interface ViewReceiveHint {
    destination?: string;
    action?: "open" | "attach" | "save" | "process";
    filename?: string;
    contentType?: string;
}

export interface ViewReceivePayload {
    source: ViewReceiveSource;
    route: string;
    title?: string;
    text?: string;
    url?: string;
    files?: File[];
    pending?: boolean;
    hint?: ViewReceiveHint;
    metadata?: Record<string, unknown>;
}

/**
 * View state persistence
 */
export interface ViewState<T = unknown> {
    load(): T | null;
    save(state: T): void;
    clear(): void;
}

// ============================================================================
// VIEW EVENT TYPES
// ============================================================================

/**
 * View content change event
 */
export interface ContentChangeEvent {
    content: string;
    source: string;
    timestamp: number;
}

/**
 * View action event
 */
export interface ViewActionEvent {
    action: string;
    payload?: unknown;
    timestamp: number;
}

// ============================================================================
// VIEW UTILITIES
// ============================================================================

/**
 * Create a simple view state persistence helper
 */
export function createViewState<T>(key: string): ViewState<T> {
    return {
        load(): T | null {
            try {
                const stored = localStorage.getItem(key);
                return stored ? JSON.parse(stored) : null;
            } catch {
                return null;
            }
        },
        save(state: T): void {
            try {
                localStorage.setItem(key, JSON.stringify(state));
            } catch {
                // ignore
            }
        },
        clear(): void {
            try {
                localStorage.removeItem(key);
            } catch {
                // ignore
            }
        }
    };
}

/**
 * Create a loading placeholder element
 */
export function createLoadingElement(message = "Loading..."): HTMLElement {
    const el = document.createElement("div");
    el.className = "view-loading";
    el.innerHTML = `
        <div class="view-loading__spinner"></div>
        <span class="view-loading__text">${message}</span>
    `;
    return el;
}

/**
 * Create an error placeholder element
 */
export function createErrorElement(message: string, retryFn?: () => void): HTMLElement {
    const el = document.createElement("div");
    el.className = "view-error";
    el.innerHTML = `
        <div class="view-error__icon">⚠️</div>
        <h3 class="view-error__title">Error</h3>
        <p class="view-error__message">${message}</p>
        ${retryFn ? '<button class="view-error__retry" type="button">Try Again</button>' : ''}
    `;
    
    if (retryFn) {
        const btn = el.querySelector(".view-error__retry");
        btn?.addEventListener("click", retryFn);
    }
    
    return el;
}

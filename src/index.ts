/**
 * CrossWord Main Entry Point
 *
 * Canonical URL mode:
 * - pathname always `/`
 * - legacy `/${view}` routes are accepted as entry links and normalized to `/`
 * - active view/process is stored in `history.state` and (for focused windows) in `location.hash`
 */

import { initPWA, checkForUpdates, forceRefreshAssets } from "./frontend/pwa/pwa-handling";
import { loadSubAppWithShell, VALID_VIEWS } from "./frontend/main/routing";
import { initializeLayers } from "./frontend/shared/layer-manager";
import type { ViewId } from "./frontend/shells/types";
import { pickEnabledView } from "./frontend/config/views";
import { loadAsAdopted } from "fest/dom";
import { ensureAppLayers } from "./frontend/shared/app-layers";

// @ts-ignore
import viewStyles from "./frontend/views/scss/_views.scss?inline";

// Import PWA handlers
import {
    ensureAppCss,
    initServiceWorker,
    initReceivers,
    handleShareTarget,
    setupLaunchQueueConsumer,
    checkPendingShareData
} from "./frontend/pwa/sw-handling";

// Import uniform channel manager
import { initializeAppChannels } from "./com/core/UniformChannelManager";

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get normalized pathname (remove base href)
 */
const getNormalizedPathname = (): string => {
    const pathname = location.pathname || '';
    const baseElement = document.querySelector('base');
    const baseHref = baseElement?.getAttribute('href') || '/';

    let normalizedPath = pathname;
    if (baseHref !== '/' && pathname.startsWith(baseHref.replace(/\/$/, ''))) {
        normalizedPath = pathname.slice(baseHref.replace(/\/$/, '').length);
    }

    return normalizedPath.replace(/^\/+|\/+$/g, '').toLowerCase();
};

const isExtension = (): boolean => {
    try {
        const location = globalThis.location;
        const chromeApi = (globalThis as any).chrome;
        return location.protocol === "chrome-extension:" || Boolean(chromeApi?.runtime?.id);
    } catch {
        return false;
    }
};

const isPwaDisplayMode = (): boolean => {
    if (isExtension()) return false;
    return matchMedia("(display-mode: standalone)").matches ||
           (globalThis?.navigator as any)?.standalone === true;
};

/**
 * Check if a path is a valid view route (type guard)
 */
const isValidViewPath = (path: string): path is ViewId =>
    (VALID_VIEWS as readonly string[]).includes(path);

/** Valid shell identifiers */
const VALID_SHELLS = ["base", "minimal", "faint", "window"] as const;
type ShellPreference = (typeof VALID_SHELLS)[number] | "window";

const normalizeShellPreference = (shell: ShellPreference | null): "base" | "minimal" | "window" => {
    if (shell === "base") return "base";
    if (shell === "minimal" || shell === "faint") return "minimal";
    return "minimal";
};

const getShellFromQuery = (): ShellPreference | null => {
    try {
        const params = new URLSearchParams(globalThis?.location?.search);
        const shell = (params.get("shell") || "").trim().toLowerCase();
        if ((VALID_SHELLS as readonly string[]).includes(shell)) {
            return normalizeShellPreference(shell as ShellPreference);
        }
    } catch {
        // Ignore query parsing issues
    }
    return null;
};

/**
 * Get saved shell preference from localStorage
 */
const getSavedShell = (): ShellPreference | null => {
    const fromQuery = getShellFromQuery();
    if (fromQuery) {
        try {
            localStorage.setItem("rs-boot-shell", fromQuery);
        } catch {
            // localStorage unavailable
        }
        return fromQuery;
    }

    try {
        const saved = localStorage.getItem("rs-boot-shell");
        if (saved && (VALID_SHELLS as readonly string[]).includes(saved)) {
            const normalized = normalizeShellPreference(saved as ShellPreference);
            if (normalized !== saved) {
                localStorage.setItem("rs-boot-shell", normalized);
            }
            return normalized;
        }
    } catch {
        // localStorage unavailable
    }
    return null;
};

// ============================================================================
// LOADING STATE MANAGEMENT
// ============================================================================

const setLoadingState = (mountElement: HTMLElement, message: string = "Loading...") => {
    mountElement.innerHTML = `
        <div class="app-loading" style="
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            inline-size: 100%;
            block-size: 100%;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 1.1rem;
            color: #666;
            background: #fff;
            position: absolute;
            inset: 0;
            z-index: 10000;
        ">
            <div class="loading-spinner" style="
                inline-size: 32px;
                block-size: 32px;
                border: 3px solid #f3f3f3;
                border-top: 3px solid #007acc;
                border-radius: 50%;
                animation: spin 1s linear infinite;
                margin-bottom: 1rem;
            "></div>
            <div class="loading-text">${message}</div>
            <style>
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            </style>
        </div>
    `;
};

const clearLoadingState = (mountElement: HTMLElement) => {
    const loading = mountElement.querySelector('.app-loading') as HTMLElement | null;
    if (loading) {
        loading.style.transition = 'opacity 0.3s ease-out';
        loading.style.opacity = '0';
        setTimeout(() => loading.remove(), 300);
    }
};

const showErrorState = (mountElement: HTMLElement, error: any, retryFn?: () => void) => {
    const errorMessage = error?.message || error?.toString() || 'Unknown error occurred';
    mountElement.innerHTML = `
        <div class="app-error" style="
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            inline-size: 100%;
            block-size: 100%;
            padding: 2rem;
            font-family: system-ui, sans-serif;
            text-align: center;
            background: #fff;
            color: #333;
        ">
            <div style="font-size: 3rem; margin-bottom: 1rem;">⚠️</div>
            <h2 style="margin: 0 0 1rem 0; color: #d32f2f;">Application Error</h2>
            <p style="margin: 0 0 1.5rem 0; color: #666; max-inline-size: 500px;">${errorMessage}</p>
            ${retryFn ? `<button data-action="retry" style="
                padding: 0.75rem 1.5rem;
                background: #007acc;
                color: white;
                border: none;
                border-radius: 6px;
                font-size: 1rem;
                cursor: pointer;
                margin-bottom: 1rem;
            ">Try Again</button>` : ''}
            <button data-action="reload" style="
                padding: 0.5rem 1rem;
                background: #666;
                color: white;
                border: none;
                border-radius: 4px;
                font-size: 0.9rem;
                cursor: pointer;
            ">Reload Page</button>
        </div>
    `;

    const retryBtn = mountElement.querySelector('[data-action="retry"]') as HTMLButtonElement | null;
    if (retryBtn && retryFn) {
        retryBtn.addEventListener("click", retryFn);
    }

    const reloadBtn = mountElement.querySelector('[data-action="reload"]') as HTMLButtonElement | null;
    if (reloadBtn) {
        reloadBtn.addEventListener("click", () => location.reload());
    }
};

const withTimeout = async <T>(
    task: Promise<T>,
    label: string,
    timeoutMs: number,
    fallback: T,
    options: { warnOnTimeout?: boolean } = {}
): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const warnOnTimeout = options.warnOnTimeout !== false;
    try {
        return await Promise.race<T>([
            task,
            new Promise<T>((resolve) => {
                timer = setTimeout(() => {
                    const log = warnOnTimeout ? console.warn : console.info;
                    log(`[Index] ${label} timed out after ${timeoutMs}ms`);
                    resolve(fallback);
                }, timeoutMs);
            })
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
};

// ============================================================================
// MAIN INDEX FUNCTION
// ============================================================================

export default async function index(mountElement: HTMLElement) {
    // CRITICAL: Initialize CSS layer hierarchy FIRST
    // This must happen before any styles are loaded
    await initializeLayers();
    await loadAsAdopted(viewStyles);

    //
    console.log('[Index] Starting CrossWord frontend loader');

    // Initialize uniform channel manager
    console.log('[Index] Initializing uniform channels...');
    initializeAppChannels();

    setLoadingState(mountElement, 'Initializing CrossWord...');

    try {
        // Initialize PWA features (non-blocking)
        const pwaPromise = initPWA();

        // Load CSS (non-extension only)
        if (!isExtension()) {
            setLoadingState(mountElement, 'Loading styles...');
            await ensureAppCss();
        }

        // Initialize broadcast receivers
        initReceivers();
        handleShareTarget();
        // SW is initialized by initPWA(); avoid dual SW managers causing update loops.
        // Keep pre-shell work short so the shell spinner / first paint stays < ~3s on slow devices.
        const PRE_SHELL_BUDGET_MS = 1200;
        try {
            await Promise.race([
                Promise.all([
                    withTimeout(setupLaunchQueueConsumer(), "setupLaunchQueueConsumer", PRE_SHELL_BUDGET_MS, undefined),
                    withTimeout(checkPendingShareData(), "checkPendingShareData", PRE_SHELL_BUDGET_MS, null)
                ]),
                new Promise<void>((r) => globalThis.setTimeout(r, PRE_SHELL_BUDGET_MS))
            ]);
        } catch (e) {
            console.warn("[Index] Pre-boot share/launch queue failed:", e);
        }

        // Warm viewer markdown engine chunk early when route targets viewer (non-blocking).
        const prePath = getNormalizedPathname();
        if (!prePath || prePath === "viewer" || prePath === "share-target" || prePath === "share_target") {
            void import("./frontend/views/viewer")
                .then((m: { warmViewerMarkdownEngine?: () => void }) => m.warmViewerMarkdownEngine?.())
                .catch(() => { /* optional */ });
        }
        if (prePath === "airpad") {
            void import("./frontend/views/airpad/main").catch(() => { /* optional */ });
        }

        void withTimeout(pwaPromise, "initPWA", 5000, null, { warnOnTimeout: false })
            .then(() => {
                console.log('[Index] PWA initialization complete');
            })
            .catch((error) => {
                console.warn('[Index] PWA initialization failed (non-blocking):', error);
            });

        // Get current route
        const pathname = getNormalizedPathname();
        const urlParams = new URLSearchParams(globalThis?.location?.search);
        const sharedFlag = urlParams.get('shared');
        const markdownContent = urlParams.get('markdown-content');

        console.log('[Index] Route:', pathname || '(root)');

        // ====================================================================
        // ROUTE HANDLING (canonical root)
        // ====================================================================

        // Legacy /{view} links are accepted as entry points.
        const isLegacyViewRoute = Boolean(pathname && isValidViewPath(pathname));
        const explicitRequestedView: ViewId | null = isLegacyViewRoute
            ? pickEnabledView(pathname as ViewId, "home")
            : (sharedFlag === "1" || sharedFlag === "true" || markdownContent)
                ? pickEnabledView("viewer", "home")
                : null;
        const queryShell = getShellFromQuery();
        const savedShell = getSavedShell();
        const preferredShell = queryShell || (
            explicitRequestedView === "print"
                ? "base"
                : (savedShell || "minimal")
        );
        const requestedView = explicitRequestedView || (
            preferredShell === "base" || preferredShell === "minimal"
                ? pickEnabledView("viewer", "home")
                : pickEnabledView("home", "home")
        );
        const allowPathRoutedShell = preferredShell === "base" || preferredShell === "minimal";
        const layers = ensureAppLayers(mountElement, { enableOrientLayer: preferredShell === "window" });
        clearLoadingState(mountElement);

        if (!allowPathRoutedShell && (isLegacyViewRoute || pathname === "share-target" || pathname === "share_target")) {
            const state = {
                ...(globalThis?.history?.state || {}),
                viewId: requestedView,
                redirectedFrom: pathname || null
            };
            const search = globalThis?.location?.search || "";
            const hash = globalThis?.location?.hash || "";
            globalThis?.history?.replaceState?.(state, "", `/${search}${hash}`);
        } else if (!allowPathRoutedShell && pathname && pathname !== "") {
            const state = {
                ...(globalThis?.history?.state || {}),
                viewId: pickEnabledView("home", "home"),
                redirectedFrom: pathname
            };
            globalThis?.history?.replaceState?.(state, "", "/");
        }

        const appLoader = await loadSubAppWithShell(preferredShell as any, requestedView);
        await appLoader.mount(layers.shellLayer);
        return;

    } catch (error) {
        console.error('[Index] Frontend loader failed:', error);
        showErrorState(mountElement, error, () => index(mountElement));
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

export { checkForUpdates, forceRefreshAssets, index };

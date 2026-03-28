/**
 * CrossWord Main Entry Point
 *
 * Path-based routing:
 * - `/` → Home/webtop (default route)
 * - `/viewer` → Viewer (opened automatically for markdown/textual sources)
 * - `/workcenter` → Work Center
 * - `/settings` → Settings
 * - `/explorer` → Explorer
 * - `/history` → History
 * - `/editor` → Editor
 * - `/airpad` → Airpad
 * - `/print` → Print view
 *
 * Shell is saved in localStorage, not in URL.
 */

import { initPWA, checkForUpdates, forceRefreshAssets } from "./frontend/pwa/pwa-handling";
import { loadSubAppWithShell, VALID_VIEWS } from "./frontend/main/routing";
import { initializeLayers } from "./frontend/shared/layer-manager";
import type { ViewId } from "./frontend/shells/types";
import { DEFAULT_VIEW_ID, pickEnabledView } from "./frontend/config/views";
import { isFirstRun, showInstallerWelcome } from "./frontend/main/installer-welcome";

import { loadAsAdopted } from "fest/dom";
import viewStyles from "@rs-frontend/views/scss/_views.scss?inline";


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
        const chrome = (typeof chrome != "undefined") ? chrome : (globalThis as any).chrome;
        return location.protocol === "chrome-extension:" || Boolean(chrome?.runtime?.id);
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
const VALID_SHELLS = ["base", "minimal", "environment", "faint", "window"] as const;
type ShellPreference = (typeof VALID_SHELLS)[number] | "minimal" | "environment";

const normalizeShellPreference = (shell: ShellPreference | null): "base" | "minimal" | "environment" => {
    if (shell === "base") return "base";
    if (shell === "faint") return "minimal";
    if (shell === "window" || shell === "environment") return "environment";
    if (shell === "minimal") return "environment";
    return "environment";
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

/**
 * Check if boot menu should be skipped (has saved preference with remember flag)
 */
const setLoadingState = (
    mountElement: HTMLElement,
    message: string = "Loading...",
    progress: number = 0
) => {
    const safeProgress = Math.max(0, Math.min(100, Number(progress) || 0));
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
            background-image: linear-gradient(180deg, rgba(10, 20, 36, 0.42), rgba(8, 16, 28, 0.68)), url('/assets/wallpaper.jpg');
            background-size: cover;
            background-position: center;
            background-repeat: no-repeat;
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
            <div style="
                inline-size: min(320px, 72vw);
                block-size: 6px;
                border-radius: 999px;
                background: #e7e7e7;
                margin-top: 0.85rem;
                overflow: hidden;
            ">
                <div style="
                    inline-size: ${safeProgress}%;
                    block-size: 100%;
                    background: #007acc;
                    transition: inline-size 180ms ease;
                "></div>
            </div>
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
            background-image: linear-gradient(180deg, rgba(10, 20, 36, 0.42), rgba(8, 16, 28, 0.68)), url('/assets/wallpaper.jpg');
            background-size: cover;
            background-position: center;
            background-repeat: no-repeat;
            color: #333;
        ">
            <div style="font-size: 3rem; margin-bottom: 1rem;"><ui-icon icon="warning-circle" icon-style="duotone"></ui-icon></div>
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

    setLoadingState(mountElement, "Initializing CrossWord...", 8);

    try {
        // Initialize PWA features (non-blocking)
        const pwaPromise = initPWA();

        // Load CSS (non-extension only)
        if (!isExtension()) {
            setLoadingState(mountElement, "Loading styles...", 24);
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
        // ROUTE HANDLING
        // ====================================================================

        // Share target route -> load default shell with viewer
        if (pathname === "share-target" || pathname === "share_target") {
            console.log('[Index] Share target route');
            setLoadingState(mountElement, "Preparing share target...", 66);
            clearLoadingState(mountElement);
            const appLoader = await loadSubAppWithShell(getSavedShell() || "environment", pickEnabledView("viewer"));
            await appLoader.mount(mountElement);
            return;
        }

        // Root with share/markdown params -> load default shell with viewer
        if ((!pathname || pathname === "") && (sharedFlag === "1" || sharedFlag === "true" || markdownContent)) {
            console.log('[Index] Root with share/markdown params');
            setLoadingState(mountElement, "Opening markdown content...", 70);
            clearLoadingState(mountElement);
            const appLoader = await loadSubAppWithShell(getSavedShell() || "environment", pickEnabledView("viewer"));
            await appLoader.mount(mountElement);
            return;
        }

        // View routes: /viewer, /workcenter, /settings, /explorer, /history, /editor, /airpad, /print
        if (pathname && isValidViewPath(pathname)) {
            console.log('[Index] View route:', pathname);
            setLoadingState(mountElement, "Booting webtop shell...", 76);
            try {
                const search = globalThis.location.search || "";
                const hash = globalThis.location.hash || "";
                const canonical = `/${search}${hash}`;
                const current = `${globalThis.location.pathname}${search}${hash}`;
                if (current !== canonical) {
                    globalThis.history.replaceState(
                        {
                            ...(globalThis.history.state || {}),
                            redirectedFromViewPath: pathname
                        },
                        "",
                        canonical
                    );
                }
            } catch {
                // ignore canonical URL normalization issues
            }
            clearLoadingState(mountElement);

            // Print stays on raw shell; other views follow user shell preference.
            const shell = (pathname === "print")
                ? "base"
                : (getSavedShell() || "environment");

            const appLoader = await loadSubAppWithShell(shell, pathname);
            await appLoader.mount(mountElement);
            return;
        }

        // Root route (/): always boot home/webtop.
        // First run shows installer welcome instead of legacy boot menu.
        if (!pathname || pathname === "") {
            console.log('[Index] Root route');
            const defaultHomeView = pickEnabledView("home", DEFAULT_VIEW_ID);
            let targetShell = getSavedShell() || "environment";
            if (isExtension()) {
                targetShell = "base";
            } else if (isFirstRun()) {
                clearLoadingState(mountElement);
                const installer = await showInstallerWelcome(mountElement);
                targetShell = installer.shell;
            } else {
                setLoadingState(mountElement, "Starting webtop...", 80);
            }

            clearLoadingState(mountElement);
            const appLoader = await loadSubAppWithShell(targetShell, defaultHomeView);
            await appLoader.mount(mountElement);
            return;
        }

        // Unknown route -> redirect to root/home.
        console.log("[Index] Unknown route, redirecting to /");
        globalThis.location.href = "/";

    } catch (error) {
        console.error('[Index] Frontend loader failed:', error);
        showErrorState(mountElement, error, () => index(mountElement));
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

export { checkForUpdates, forceRefreshAssets, index };

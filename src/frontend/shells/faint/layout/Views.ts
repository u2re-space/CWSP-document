import { $comment$, $toolbar$, AppLayout, onClose } from "./AppLayout";
import { loadAsAdopted } from "fest/dom";
import { observe, $trigger } from "fest/object";

//
import "fest/fl-ui";

//
import { Sidebar } from "./Sidebar";
import { MakeCardElement } from "../../../shared/ui/Cards";
import { initBackNavigation, registerCloseable, historyViewRef, historyState } from "fest/lure";
import { $byKind, $insideOfDay } from "../../../../core/utils/Utils";
import { createCtxMenu, SpeedDial } from "../../../shared/ui/viewer/SpeedDial";
import { ViewPage } from "../../../shared/ui/viewer/Viewer";

// @ts-ignore
import style from "../scss/index.scss?inline";
import { makeToolbar } from "../../../shared/Actions";
import { Settings } from "../../../shared/ui/viewer/Settings";
import { DataExplorer } from "../../../shared/ui/viewer/DataExplorer";
import { MakeMarkdownView } from "../../../shared/ui/viewer/Markdown";
import { initGlobalClipboard } from "fest/lure";
import initVeela from "fest/veela";

//
import { UIPhosphorIcon } from "fest/icon";
console.log(UIPhosphorIcon);

//
const implementTestDrop = (mountElement: HTMLElement) => {
    //
    mountElement?.addEventListener?.("dragover", (event) => {
        const eventTarget = event?.target as HTMLElement;
        if (eventTarget?.matches?.("#app") || eventTarget?.querySelector?.("#app")) {
            event.preventDefault();
        }
    });

    //
    mountElement?.addEventListener?.("drop", (event) => {
        const eventTarget = event?.target as HTMLElement;
        if (eventTarget?.matches?.("#app") || eventTarget?.querySelector?.("#app")) {
            event.preventDefault();
            // Wallpaper drop moved to SpeedDial view
        }
    });
}



//
const generateId = (path: string)=>{
    const filename = path?.split("/")?.pop()?.replace?.(/[^a-zA-Z0-9-_]/g, "-") || "doc";
    const randHash = Math.random().toString(36).slice(2, 6);
    return `${filename}-${randHash}`;
}

//
const $defaultView = (location?.hash?.replace?.(/^#/, "") || "home");
const checkIsActive = (registryKey: string, closingView: string) => {
    return (registryKey?.replace?.(/^#/, "") == closingView?.replace?.(/^#/, ""));
}

//
console.log("[faint] Creating current view reference");
export const CURRENT_VIEW = historyViewRef(`#${$defaultView}`, { /*ignoreBack: true,*/ withoutHashPrefix: true }) as { value: string };
console.log("[faint] Current view reference created");
import { startGeoTracking } from "@rs-com/service/misc/GeoService";
import { startTimeTracking, requestNotificationPermission } from "@rs-com/service/misc/TimeService";
import { initTheme } from "../../../../core/utils/Theme";

//
export async function frontend(mountElement) {
    console.log("[faint] Starting frontend initialization");

    // Make permissions non-blocking
    console.log("[faint] Requesting permissions");
    Promise.allSettled([
        document.requestStorageAccess?.(),
        navigator.permissions?.query?.({ name: "storage-access" as PermissionName }),
        navigator.permissions?.query?.({ name: "top-level-storage-access" as PermissionName }),
        navigator.permissions?.query?.({ name: "geolocation" as PermissionName }),
        navigator.permissions?.query?.({ name: "clipboard-write" as PermissionName }),
        navigator.permissions?.query?.({ name: "clipboard-read" as PermissionName }),
        navigator.permissions?.query?.({ name: "notifications" as PermissionName }),
        navigator.permissions?.query?.({ name: "microphone" as PermissionName }),
    ]).then((results) => {
        console.log("[faint] Permissions checked", results);
    })?.catch?.((error) => {
        console.log("[faint] Permissions error", error);
    });

    // Re-enable Veela runtime styles in a non-blocking way (async stylesheet parsing).
    // This restores common base tokens/resets without freezing the UI.
    try {
        // Defer to idle time so first paint happens quickly.
        (globalThis as any).requestIdleCallback?.(() => initVeela(document.body), { timeout: 1500 })
            ?? setTimeout(() => initVeela(document.body), 0);
    } catch {
        // ignore
    }

    // (App-specific styles)
    // console.log("[faint] Initializing DOM");
    // console.time("[faint] DOM init time");
    // try {
    //     const domPromise = initDOM(document.body);
    //     if (domPromise) {
    //         await Promise.race([
    //             domPromise,
    //             new Promise((_, reject) => setTimeout(() => reject(new Error("DOM init timeout")), 5000))
    //         ]);
    //     }
    //     console.timeEnd("[faint] DOM init time");
        console.log("[faint] DOM initialized, loading styles");
        console.time("[faint] Style load time");

        await Promise.race([
            loadAsAdopted(style),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Style load timeout")), 3000))
        ]);
        console.timeEnd("[faint] Style load time");
        console.log("[faint] Styles loaded");
    // } catch (error) {
    //     console.error("[faint] Failed to initialize DOM or load styles", error);
    //     // Continue anyway - don't let this block the entire app
    // }

    console.log("[faint] Initializing services");
    console.time("[faint] Services init time");
    // Make services non-blocking and handle errors individually
    [
        () => initTheme(),
        () => initBackNavigation({
            preventDefaultNavigation: false,
            pushInitialState: true
        }),
        () => initGlobalClipboard(),
        () => startGeoTracking(),
        () => startTimeTracking(),
        () => requestNotificationPermission()
    ].forEach((initFn, index) => {
        (initFn?.() as unknown as Promise<any>)?.catch?.((error) => {
            console.warn(`[faint] Service ${index} failed to initialize`, error);
        });
    });
    console.timeEnd("[faint] Services init time");

    console.log("[faint] Creating entity views map");
    const entityViews = new Map([
        ["task", { icon: "calendar-dots", label: "Plan", groupedBy: "days", tabs: ["all", "pending", "in_progress", "completed", "failed", "delayed", "canceled", "other"], availableActions: ["generate", "debug-gen", "add", "paste-and-recognize", "share-clipboard"] }],
        ["event", { icon: "calendar", label: "Event", groupedBy: "days", tabs: ["all","education", "lecture", "conference", "meeting", "seminar", "workshop", "presentation", "celebration", "opening", "other"], availableActions: ["upload", "paste-and-analyze", "add"] }],
        ["action", { icon: "island", label: "Action", tabs: ["all", "other"], availableActions: ["upload", "paste-and-analyze", "add"] }],
        ["service", { icon: "headset", label: "Service", tabs: ["all", "medical", "education", "consultation", "advice", "mentoring", "training", "item", "thing", "other"], availableActions: ["upload", "paste-and-analyze", "add"] }],
        ["item", { icon: "calculator", label: "Item", groupedBy: "usability", tabs: ["all", "currency", "book", "electronics", "furniture", "medicine", "tools", "software", "consumables", "other"], availableActions: ["upload", "paste-and-analyze", "add"] }],
        ["skill", { icon: "hand-palm", label: "Skill", tabs: ["all", "skill", "knowledge", "ability", "trait", "experience", "other"], availableActions: ["upload", "paste-and-analyze", "add"] }],
        ["vendor", { icon: "trademark", label: "Vendor", tabs: ["all", "vendor", "company", "organization", "institution", "other"], availableActions: ["upload", "paste-and-analyze", "add"] }],
        ["place", { icon: "buildings", label: "Place", groupedBy: "country", tabs: ["all", "placement", "place", "school", "university", "service", "clinic", "pharmacy", "hospital", "library", "market", "location", "shop", "restaurant", "cafe", "bar", "hotel", "other"], availableActions: ["upload", "paste-and-analyze", "add"] }],
        ["factor", { icon: "umbrella", label: "Factor", tabs: ["all", "weather", "health", "family", "relationships", "job", "traffic", "business", "economy", "politics", "news", "other"], availableActions: ["upload", "paste-and-analyze", "add"] }],
        ["person", { icon: "address-book", label: "Contact", tabs: ["all", "dear", "specialist", "consultant", "coach", "mentor", "helper", "assistant", "friend", "family", "relative", "other"], availableActions: ["upload", "paste-and-analyze", "add"] }],
        ["bonus", { icon: "ticket", label: "Bonus", groupedBy: "usability", tabs: ["all", "loyalty", "discount", "cashback", "other"], availableActions: ["upload", "paste-and-analyze", "add"] }]
    ])

    //
    const makeEntityView = (entityType: string, entityView?: any) => {
        entityView ??= entityViews.get(entityType);
        if (!entityView) return null;
        const tabOrganizer = entityType == "task" ? $insideOfDay : $byKind;//(item, tab) => true
        return ViewPage({
            label: entityView?.label || entityType,
            type: entityType,
            DIR: (entityType == "task" || entityType == "timeline") ? `/timeline/` : `/data/${entityType}/`
        }, entityView?.tabs || [], tabOrganizer as any, entityView?.availableActions || [], MakeCardElement);
    };

    //registerElement
    const addElement = (registryKey: string, toolbarWithElement: [HTMLElement, HTMLElement], existsViews: Map<string, any>) => {
        registryKey = registryKey?.replace?.(/^#/, "") ?? registryKey;
        if (!registryKey || !toolbarWithElement?.[1]) return null;

        //
        if (existsViews.has(registryKey)) {
            return existsViews.get(registryKey);
        } else {
            existsViews.set(registryKey, toolbarWithElement);
        }

        //
        toolbarWithElement[0]?.setAttribute?.("data-view-id", registryKey);
        toolbarWithElement[1]?.setAttribute?.("data-view-id", registryKey);

        //
        const setupBackNav = (el: HTMLElement) => {
            const options: any = {
                id: registryKey,
                priority: registryKey != "home" ? 10 : 0,
                // Pass element as WeakRef for auto-cleanup when detached
                element: new WeakRef(el),
                close: (closingView: string) => {
                    const isClosed = onClose(registryKey, CURRENT_VIEW, existsViews, closingView);
                    if (isClosed) { unregister?.(); return true; }
                    return false;
                },
                isActive: (closingView: string) => checkIsActive(registryKey, closingView),
                get hashId() { return registryKey; }
            };
            const unregister = registerCloseable(options);
        };

        // also, reassign in array is promise
        if ((toolbarWithElement[0] as any)?.then) {
            (toolbarWithElement[0] as any).then((e) => {
                toolbarWithElement[0] = e;
                e?.setAttribute?.("data-view-id", registryKey);
            });
        }

        // also, reassign in array is promise
        if ((toolbarWithElement[1] as any)?.then) {
            (toolbarWithElement[1] as any).then((e) => {
                toolbarWithElement[1] = e;
                e?.setAttribute?.("data-view-id", registryKey);

                setupBackNav(e);
            });
        } else {
            setupBackNav(toolbarWithElement[1]);
        }

        //
        // Clean up creation flag (kept in a separate Set now)
        return existsViews.get(registryKey);
    }

    console.log("[faint] Creating reactive views registry");
    const existsViews = observe(new Map<string, any>());
    console.log("[faint] Reactive views registry created");

    // Track in-progress creation separately; do NOT leak these markers into the tabs Map.
    const creatingViews = new Set<string>();

    // Track view creation to prevent excessive memory usage
    let viewCreationCount = 0;
    const MAX_VIEWS = 50;

    // Prevent recursive hash navigation
    let isNavigating = false;
    let lastHash = "";
    const makeView = (registryKey, props?: any)=>{
        if (!registryKey) return null; registryKey = registryKey?.replace?.(/^#/, "") ?? registryKey;
        if (!registryKey) return null;

        // Home is a built-in part of the layout (SpeedDial/wallpaper). Do not treat it as a dynamic tab/view.
        if (registryKey === "home") {
            return [$toolbar$, $comment$];
        }

        // Prevent recursive calls that could cause infinite loops
        if (creatingViews.has(registryKey)) {
            console.warn(`[faint] Preventing recursive view creation for ${registryKey}`);
            return null;
        }

        // Prevent rapid successive calls for the same view (debounce)
        const hashNow = location.hash;
        if (isNavigating && hashNow === lastHash && registryKey === hashNow.replace(/^#/, "")) {
            console.warn(`[faint] Preventing rapid navigation to ${registryKey}`);
            return existsViews.get(registryKey) || null;
        }

        // Check view creation limit
        const currentViewCount = Array.from(existsViews.keys()).length;
        if (currentViewCount >= MAX_VIEWS) {
            console.warn(`[faint] View creation limit reached (${MAX_VIEWS}), skipping ${registryKey}`);
            return null;
        }

        // Mark as being created to prevent recursion
        creatingViews.add(registryKey);
        viewCreationCount++;

        //
        let actions: any = {};
        let element: any = null;

        //
        if (existsViews.has(registryKey)) {
            creatingViews.delete(registryKey);
            return existsViews.get(registryKey);
        }

        // exists views
        const entityView = entityViews.get(registryKey);
        if (entityView) {
            // latest LUR.E supports promises for views
            const promised = Promise.withResolvers<any>();
            const toolbarPromise = Promise.withResolvers<any>();

            // Defer heavy view creation with timeout protection
            const timeoutId = setTimeout(() => {
                console.warn(`[faint] View creation timeout for ${registryKey}`);
                if (!element) promised.resolve(element = document.createElement('div'));
                if (!actions) toolbarPromise.resolve(actions = document.createElement('div'));
            }, 10000); // 10 second timeout

            const scheduleIdle = (cb: IdleRequestCallback) => {
                if (typeof globalThis.requestIdleCallback === "function") {
                    return globalThis.requestIdleCallback(cb, { timeout: 1000 });
                }
                return setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 } as IdleDeadline), 0);
            };

            scheduleIdle(async () => {
                try {
                    clearTimeout(timeoutId);
                    promised.resolve(element = await makeEntityView(registryKey, entityView));
                    toolbarPromise.resolve(actions = await makeToolbar(entityView?.availableActions || [], {
                        label: entityView?.label || registryKey,
                        type: registryKey,
                        DIR: (registryKey == "task" || registryKey == "timeline") ? `/timeline/` : `/data/${registryKey}/`
                    }, element));

                    //
                    const cached = existsViews.get(registryKey);
                    if (cached) {
                        cached[0] = actions;
                        cached[1] = element;
                    }

                    //
                    element?.setAttribute?.("data-view-id", registryKey);
                    actions?.setAttribute?.("data-view-id", registryKey);
                } catch (error) {
                    console.error(`[faint] Failed to create view ${registryKey}:`, error);
                    clearTimeout(timeoutId);
                    // Provide fallback elements
                    if (!element) promised.resolve(element = document.createElement('div'));
                    if (!actions) toolbarPromise.resolve(actions = document.createElement('div'));
                } finally {
                    creatingViews.delete(registryKey);
                }
            });

            // use by promise
            element = promised.promise;
            actions = toolbarPromise.promise;
            return addElement(registryKey, [actions, element], existsViews);
        }

        //
        if (registryKey == "settings") {
            element = Settings();
            actions = makeToolbar(["apply-settings", "import-settings", "export-settings", "paste-and-recognize", "share-clipboard"], {
                label: "Settings",
                type: registryKey,
                DIR: `/`
            }, element);
        }

        //
        if (registryKey == "explorer") {
            element = DataExplorer();
            actions = makeToolbar(["file-refresh", "file-upload", "file-mount", "file-download"], {
                label: "File Explorer",
                type: registryKey,
                DIR: `/`
            }, element);
        }

        //
        if (registryKey?.startsWith?.("markdown:")) {
            const path = registryKey.replace("markdown:", "");
            registryKey = generateId(path);
            element = MakeMarkdownView(path, registryKey);
            actions = makeToolbar([], {
                label: path.split("/").pop() || "Markdown",
                type: registryKey,
                DIR: `/`
            }, element);
        }

        //
        if (!element) return;

        //
        if (element && !existsViews.has(registryKey)) {
            const added = addElement(registryKey, [actions, element], existsViews);
            creatingViews.delete(registryKey);
            return added;
        }

        //
        creatingViews.delete(registryKey);
        return;
    }

    console.log("[faint] Creating layout components");
    console.time("[faint] Layout creation time");

    // Add timeout protection for layout creation
    const layoutPromise = Promise.race([
        (async () => {
            console.log("[faint] Creating sidebar");
            const $sidebar = Sidebar(CURRENT_VIEW, entityViews, existsViews, makeView);
            console.log("[faint] Sidebar created, creating main layout");

            const layout = AppLayout(CURRENT_VIEW, existsViews as any, makeView, $sidebar);
            console.log("[faint] Main layout created, mounting to DOM");

            mountElement?.append?.(layout);
            mountElement?.append?.(createCtxMenu());
            return true;
        })(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Layout creation timeout")), 10000))
    ]);

    try {
        await layoutPromise;
        console.timeEnd("[faint] Layout creation time");
        console.log("[faint] Layout components created and mounted");
    } catch (error) {
        console.error("[faint] Failed to create layout:", error);
        console.timeEnd("[faint] Layout creation time");

        // Fallback: create a basic error message
        const errorDiv = document.createElement('div');
        errorDiv.innerHTML = '<h1>Faint App Error</h1><p>Failed to initialize the application layout. Please check the console for details.</p>';
        errorDiv.style.cssText = 'padding: 20px; color: red; font-family: monospace;';
        mountElement?.append?.(errorDiv);
    }

    //
    mountElement?.addEventListener?.("open", (event: CustomEvent) => {
        const { path, item } = event.detail || {};
        const isMd = path?.endsWith?.(".md") || item?.type?.includes?.("markdown") || item?.name?.endsWith?.(".md");
        if (path && isMd) {
            event.preventDefault();
            event.stopPropagation();
            const key = `markdown:${path}`;
            makeView(key, { focus: true });
        }
    });

    //
    implementTestDrop(mountElement);
}

//
export * from "../../../shared/ui/viewer/DataExplorer";
export * from "../../../shared/ui/viewer/Settings";

//
export default frontend;

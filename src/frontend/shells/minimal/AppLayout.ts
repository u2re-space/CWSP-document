/**
 * Minimal-shell layout controller.
 *
 * This module bridges hash/view state, the tabbed sidebar container, and the
 * home wallpaper/speed-dial content. It is responsible for preventing recursive
 * close/setView loops while keeping shell navigation in sync with history.
 */
import { observe, propRef, affected } from "fest/object";
import { H, C } from "fest/lure";
import { navigate, historyState } from "fest/lure";
import { isPrimitive } from "fest/core";
import { scheduleFrame } from "@rs-core/utils/Runtime";

//
let skipCreateNewView = false;

// Prevent recursive onClose calls
let isClosingView = false;
let closingViewKey = "";

/** Close one tab/view safely, avoiding recursive close handling for the same logical view. */
export const onClose = (tabName: string, currentView: any, existsViews: Map<string, any>, closingView?: string) => {
    const viewKey = tabName?.replace?.(/^#/, "") || closingView?.replace?.(/^#/, "");

    // Prevent recursive calls for the same view
    if (isClosingView && closingViewKey === viewKey) {
        return false;
    }

    isClosingView = true;
    closingViewKey = viewKey;

    try {
        let isClosed = false;
        if (tabName?.replace?.(/^#/, "") && (tabName?.replace?.(/^#/, "") == closingView?.replace?.(/^#/, "") || !closingView?.replace?.(/^#/, ""))) {
            tabName = tabName?.replace?.(/^#/, "") ?? tabName;
            if (!tabName || tabName == "home") return false;

            //
            const curView = isPrimitive(currentView) ? (currentView?.replace?.(/^#/, "") ?? currentView) : ((currentView as { value: string })?.value?.replace?.(/^#/, "") ?? (currentView as { value: string })?.value);
            const oldView = (tabName || curView)?.replace?.(/^#/, "");
            const toReplace = [...existsViews?.keys?.()]?.filter?.(k => k != oldView && k != "home")?.[0] || "home";

            // We need to know if we are closing the ACTIVE view
            if (existsViews.has(oldView) && toReplace != oldView && oldView != "home") {
                existsViews.delete(oldView); isClosed = true;
            }

            //
            if ((curView == oldView || toReplace != curView) && isClosed) {
                // Use replaceState to avoid pushing this "close" action as a new navigation step
                navigate(`#${toReplace}`, existsViews.has(toReplace));
            }
        }
        return isClosed;
    } finally {
        isClosingView = false;
    }
}

//
//https://192.168.0.200/#home
const $defaultView = (location?.hash?.replace?.(/^#/, "") || "home");
export const $comment$ = document.createComment("");
export const $toolbar$ = document.createComment("");
/**
 * Create the minimal-shell application layout and keep its current tab synced
 * with view history plus dynamically created views.
 */
export const AppLayout = (currentView: any, existsViews: Map<string, any>, makeView: (key: string) => any, sidebar: HTMLElement) => {
    const rPair = observe([document.createComment(""), document.createComment("")])

    // Prevent recursive setView calls
    let isSettingView = false;
    let currentViewKey = "";

    const setView = async (key: string, forceCreateNewView?: boolean) => {
        key = key?.replace?.(/^#/, "") ?? key;

        // Prevent recursive calls for the same view
        if (isSettingView && currentViewKey === key) {
            return;
        }

        isSettingView = true;
        currentViewKey = key;

        try {
            const $homeView = "home";

            // Home is a built-in view (SpeedDial/wallpaper). Never create/register it as a dynamic tab.
            if (!key || key === $homeView) {
                skipCreateNewView = false;
                rPair[0] = $toolbar$;
                rPair[1] = $comment$;
                return;
            }

            // `skipCreateNewView` should depending on replace or push state happened
            if (!skipCreateNewView && !forceCreateNewView && (historyState as any)?.action != null) {
                skipCreateNewView ||= ["REPLACE", "POP", "BACK"]?.includes?.((historyState as any)?.action);
            }

            //
            //
            const ext = (existsViews?.get?.(key || $homeView) || existsViews?.get?.($homeView)) || [$toolbar$, $comment$];
            const npr = (skipCreateNewView ? ext : (await makeView(key))) || ext;
            skipCreateNewView = false;
            rPair[0] = (await npr?.[0]) || $toolbar$;
            rPair[1] = (await npr?.[1]) || $comment$;
        } finally {
            isSettingView = false;
        }
    }

    //
    (sidebar as any).setView = setView;
    (sidebar as any).skipCreateNewView = (value: boolean = false) => { skipCreateNewView = value; };

    // Initialize current view
    scheduleFrame(() => {
        if (currentView && !currentView?.value?.replace?.(/^#/, "")) {
            (currentView as { value: string }).value = $defaultView;
        }

        //
        setView(currentView?.value?.replace?.(/^#/, "") || "home", true);
        scheduleFrame(() => affected([currentView, "value"], (value: any) => {
            setView(value?.replace?.(/^#/, "") || "home", false);
        }));
    });

    // TODO(shell-layout/async-view-loading): support explicit async view loading
    // hooks once the newer Object.TS/LUR.E integration becomes the canonical path.
    const $layout = H`<ui-tabbed-with-sidebar on:tab-changed=${(ev) => {
        const $homeView = "home";//(location.hash?.replace?.(/^#/, "") || "home");
        const newTab = (ev?.newTab?.replace?.(/^#/, "") || $homeView)?.replace?.(/^#/, "");
        if (ev?.target == $layout) {
            scheduleFrame(() => {
                skipCreateNewView = true;
                navigate(`#${newTab || "home"}`, existsViews.has(newTab || "home"));
            });
        };
    }} on:tab-close=${(ev: any) => {
        scheduleFrame(() => {
            skipCreateNewView = true;
            onClose(ev?.tabName, currentView, existsViews);
        });
    }} prop:currentTab=${currentView} prop:userContent=${true} prop:tabs=${existsViews} class="app-layout">
        ${sidebar}
        ${SpeedDial((view: string, props: any) => { currentView.value = view; })}
        ${makeWallpaper()}
        <div class="toolbar" style="pointer-events: none; will-change: contents; background-color: transparent;" slot="bar">
            ${C(propRef(rPair, 0))}
        </div>
        <div class="content" style="pointer-events: none; will-change: contents;">
            ${C(propRef(rPair, 1))}
        </div>
    </ui-tabbed-with-sidebar>`;

    return $layout;
}

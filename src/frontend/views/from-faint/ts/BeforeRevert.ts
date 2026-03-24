import { H } from "fest/lure";
import { implementDropEvent, implementPasteEvent } from "@rs-core/modules/HookEvent";
import { observe, ref } from "fest/object";
import type { ChapterDescriptor, EntityDescriptor } from "@rs-core/utils/Types";
import type { EntityInterface } from "@rs-com/template/EntityInterface";
import { scheduleFrame } from "@rs-core/utils/Runtime";
import { renderTabName } from "@rs-core/utils/Utils";
import { sendToEntityPipeline } from "@rs-core/storage/FileSystem";
import { CollectItemsForTabPage, MakeItemBy } from "@rs-frontend/items/Items";

// =============================================================================
// View Page Component
// =============================================================================

export const ViewPage = <
    T extends EntityDescriptor = EntityDescriptor,
    E extends EntityInterface<any, any> = EntityInterface<any, any>,
    C extends ChapterDescriptor = ChapterDescriptor
>(
    entityDesc: T,
    chapters: C[] | (() => C[]),
    filtered: (item: E, desc: C) => boolean,
    _availableActions: string[],
    ItemMaker: (entityItem: E, entityDesc: T, options?: any) => any
) => {
    // Simple loading state using refs
    const loadingState = ref<string>('idle');
    const loadedTabs = new Set<string>();

    const viewPage: any = {
        $section: null,
        $refresh: () => {},
        $dispose: () => {}
    };

    // Tab content factory
    const tabsRef = observe(new Map()) as Map<string, HTMLElement | null | string | any>;

    const createTabLoader = (chap: C, key: string) => {
        return () => {
            loadingState.value = 'loading';

            const content = CollectItemsForTabPage<T, E, C>(
                entityDesc,
                chap,
                chap != null ? filtered : () => true,
                (entityItem: E) => MakeItemBy<E, T>(entityItem, entityDesc, ItemMaker, {})
            );

            loadedTabs.add(key);
            loadingState.value = 'loaded';

            return content;
        };
    };

    const reloadTabs = () => {
        const chaptersArray = typeof chapters === "function" ? chapters() : chapters;

        chaptersArray.forEach((chap: C) => {
            const key = (chap as any)?.id || (chap as any)?.title || String(chap);
            if (key && !tabsRef.has(key)) {
                tabsRef.set(key, createTabLoader(chap, key));
            }
        });
    };

    // Debounced refresh for subsequent calls
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    viewPage.$refresh = () => {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
            reloadTabs();
        }, 100);
    };

    // Initial load - call directly to populate tabs before element creation
    reloadTabs();

    // Tabbed box
    const tabbed = H`<ui-tabbed-box
        prop:tabs=${tabsRef}
        prop:renderTabName=${renderTabName}
        currentTab=${"all"}
        style="background-color: transparent;"
        class="all"
    ></ui-tabbed-box>`;

    // Section
    const section = H`<section
        id="${entityDesc.type}"
        class="viewer-section"
    >
        ${tabbed}
    </section>` as HTMLElement;

    viewPage.$section = section;

    // File drop/paste handling
    const intake = async (payload: any) => {
        loadingState.value = 'loading';
        try {
            await sendToEntityPipeline(payload, { entityType: entityDesc.type });
            loadingState.value = 'loaded';
        } catch (e) {
            loadingState.value = 'error';
            console.warn(e);
        }
    };

    implementDropEvent(section, intake);
    implementPasteEvent(section, intake);

    // Event listeners
    const eventListeners: Array<[EventTarget, string, EventListener]> = [];

    const addListener = (target: EventTarget, event: string, handler: EventListener) => {
        target.addEventListener(event, handler);
        eventListeners.push([target, event, handler]);
    };

    addListener(section, 'contentvisibilityautostatechange', () => viewPage.$refresh());
    addListener(section, 'visibilitychange', () => viewPage.$refresh());
    addListener(section, 'focusin', () => viewPage.$refresh());
    addListener(document, 'rs-fs-changed', () => viewPage.$refresh());

    // Cleanup
    viewPage.$dispose = () => {
        eventListeners.forEach(([target, event, handler]) => {
            target.removeEventListener(event, handler);
        });
        if (refreshTimer) clearTimeout(refreshTimer);
    };

    // Initial visibility check
    scheduleFrame(() => {
        if (section?.checkVisibility?.()) {
            viewPage.$refresh();
        }
    });

    return section;
}


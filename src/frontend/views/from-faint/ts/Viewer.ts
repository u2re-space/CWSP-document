import { H } from "fest/lure";
import { implementDropEvent, implementPasteEvent } from "../../../core/modules/HookEvent";
import { observe} from "fest/object";
import type { ChapterDescriptor, EntityDescriptor } from "@rs-core/utils/Types";
import type { EntityInterface } from "@rs-com/template/EntityInterface";
import { renderTabName } from "../../../core/utils/Utils";
import { scheduleFrame } from "@rs-core/utils/Runtime";
import { sendToEntityPipeline } from "@rs-core/storage/FileSystem";
import { CollectItemsForTabPage, MakeItemBy } from "@rs-frontend/shared/Items";
import { orientRef } from "fest/lure";

//
const makeFragment = (children: HTMLElement[]) => {
    const fragment = document.createDocumentFragment();
    children.forEach(child => fragment.appendChild(child));
    return fragment;
}

//
export const ViewPage = <
    T extends EntityDescriptor = EntityDescriptor,
    E extends EntityInterface<any, any> = EntityInterface<any, any>,
    C extends ChapterDescriptor = ChapterDescriptor
>(
    entityDesc: T,
    chapters: C[] | (() => C[]),
    filtered: (item: E, desc: C) => boolean,
    availableActions: string[],
    ItemMaker: (entityItem: E, entityDesc: T, options?: any) => any
) => {

    const viewPage: any = {
        $section: null,
        $refresh: () => { }
    };

    //
    const tabsRef = observe(new Map()) as Map<string, HTMLElement | null | string | any>;
    const reloadTabs = () => {
        // TODO: add reactive chapters support...
        (typeof chapters === "function" ? chapters() : chapters).map((chap: C) => {
            const key = (chap as any)?.id || (chap as any)?.title || String(chap);
            if (key) {
                if (tabsRef.has(key)) { /* currently, unknown action... */ } else {
                    tabsRef.set(key, () => CollectItemsForTabPage<T, E, C>(
                        entityDesc, chap, chap != null ? filtered : () => true,
                        (entityItem: E) => MakeItemBy<E, T>(entityItem, entityDesc, ItemMaker, {})
                    ))
                }
            }
        })
    }

    //
    let refreshCoalesced = false;
    viewPage.$refresh = () => {
        if (refreshCoalesced) return;
        refreshCoalesced = true;
        scheduleFrame(() => {
            refreshCoalesced = false;
            reloadTabs?.();
        });
    };
    viewPage.$refresh?.();

    //
    document.addEventListener("rs-fs-changed", (ev) => viewPage.$refresh?.());

    // TODO: add support for reactive maps of tabs in `ui-tabbed-box`
    const tabbed = H`<ui-tabbed-box
        orient=${orientRef()}
        prop:tabs=${tabsRef}
        prop:renderTabName=${renderTabName}
        currentTab=${"all"}
        style="background-color: transparent;"
        class="all"
    ></ui-tabbed-box>`;

    //
    const section = H`<section id="${entityDesc.type}" class="viewer-section">${tabbed}</section>` as HTMLElement; viewPage.$section = section;
    const intake = (payload) => sendToEntityPipeline(payload, { entityType: entityDesc.type }).catch(console.warn);
    implementDropEvent(section, intake);
    implementPasteEvent(section, intake);

    //
    section.addEventListener('contentvisibilityautostatechange', (e: any) => { viewPage.$refresh?.(); });
    section.addEventListener('visibilitychange', (e: any) => { viewPage.$refresh?.(); });
    section.addEventListener('focusin', (e: any) => { viewPage.$refresh?.(); });

    // after append and appear in pages, try to first signal
    scheduleFrame(() => {
        if (section?.checkVisibility?.()) {
            viewPage.$refresh?.();
        }
    });

    //
    return section;
}
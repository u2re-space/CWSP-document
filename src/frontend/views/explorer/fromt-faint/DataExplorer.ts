import { openDirectory, H, M } from "fest/lure";
import { dataCategories } from "@rs-com/service/misc/Cache";
import { sendToEntityPipeline } from "@rs-core/storage/FileSystem";
import { implementDropEvent, implementPasteEvent } from "@rs-core/modules/HookEvent";

//
// Import the new file manager components
import { FileManager } from "fest/fl-ui";

//
const rowFileMap = new WeakMap<HTMLElement, any>();
export const DataExplorer = () => {

    // make folders of entity types
    const folders = M(dataCategories, (category) => {
        const folder = openDirectory(null, `/data/${category.id}/`, { create: true });
        const row = H`<div class="folder">${category.label}</div>`
        rowFileMap.set(row, folder);
        return row;
    });

    // make file manager using the full implementation
    const viewer = document.createElement("ui-file-manager") as FileManager & HTMLElement;
    viewer.path = "/user/";
    viewer.setAttribute("sidebar", "auto");
    viewer.style.cssText = "grid-column: 1 / -1; grid-row: 1 / -1;";
    const section = H`<section id="explorer" class="data-view c2-surface" style="grid-column: 2 / -1; grid-row: 2 / -1;" id="explorer">${viewer}</section>`;
    const intake  = (payload) => sendToEntityPipeline(payload, { entityType: viewer?.path?.split?.("/")?.at?.(-1) });
    implementDropEvent(section, intake);
    implementPasteEvent(section, intake);
    return section;
};

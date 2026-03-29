import { observe, numberRef, propRef, stringRef, affected } from "fest/object";
import { E, H, orientRef, M, provide, registerModal, handleIncomingEntries, pointerAnchorRef } from "fest/lure";
import { bindInteraction } from "fest/lure";
import { actionRegistry, iconsPerAction, labelsPerAction } from "@rs-core/utils/Actions";
import { showSuccess, showError } from "@rs-frontend/items/Toast";
import { openUnifiedContextMenu, type ContextMenuEntry } from "@rs-frontend/items/ContextMenu";
import {
    speedDialMeta,
    speedDialItems,
    createEmptySpeedDialItem,
    addSpeedDialItem,
    upsertSpeedDialItem,
    removeSpeedDialItem,
    persistSpeedDialItems,
    persistSpeedDialMeta,
    findSpeedDialItem,
    getSpeedDialMeta,
    ensureSpeedDialMeta,
    NAVIGATION_SHORTCUTS,
    wallpaperState,
    persistWallpaper,
    gridLayoutState,
    createSpeedDialItemFromClipboard,
    parseSpeedDialItemFromJSON,
    parseSpeedDialItemFromURL,
    type SpeedDialItem,
    type GridCell
} from "@rs-core/storage/StateStorage";
import { getBoundingOrientRect, isInFocus, MOCElement, orientOf } from "fest/dom";
import { writeFileSmart } from "@rs-core/storage/WriteFileSmart-v2";
import { convertOrientPxToCX, cvt_cs_to_os, type GridItemType } from "fest/core";

let viewMaker: any = null;
let ctxMenuBound = false;
const layout = observe([gridLayoutState.columns ?? 4, gridLayoutState.rows ?? 8]);
const items = speedDialItems;
const meta = speedDialMeta;

// Subscribe to grid layout changes
affected(gridLayoutState, () => {
    layout[0] = gridLayoutState.columns ?? 4;
    layout[1] = gridLayoutState.rows ?? 8;
});
const resolveItemAction = (item: SpeedDialItem, override?: string) => {
    if (override) return override;
    const entry = getSpeedDialMeta(item.id);
    return entry?.action || item?.action || "open-view";
};

const ACTION_OPTIONS = [
    { value: "open-view", label: "Open view" },
    { value: "open-link", label: "Open link" },
    { value: "copy-link", label: "Copy link" },
    { value: "copy-state-desc", label: "Copy state + desc" }
];
const WALLPAPER_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "avif"]);

const getRefValue = (ref: any, fallback = "") => {
    if (ref && typeof ref === "object" && "value" in ref) return ref.value ?? fallback;
    return ref ?? fallback;
};

const buildDescriptor = (item: SpeedDialItem) => {
    const meta = getSpeedDialMeta(item.id);
    return {
        label: getRefValue(item?.label),
        type: meta?.view || "speed-dial",
        DIR: "/",
        href: meta?.href,
        view: meta?.view,
        action: resolveItemAction(item)
    };
};

//
const bindCell = (el: HTMLElement, args: any) => {
    const { item } = args;
    const cell = item?.cell ?? [0, 0];
    E(el, {
        style: {
            "--cell-x": propRef(cell, 0),
            "--cell-y": propRef(cell, 1),
            "--p-cell-x": propRef(cell, 0),
            "--p-cell-y": propRef(cell, 1)
        }
    });
};

//
const runItemAction = (item: SpeedDialItem, actionId?: string, extras: { event?: Event; initiator?: HTMLElement } = {}) => {
    const resolvedAction = resolveItemAction(item, actionId);
    const action = actionRegistry.get(resolvedAction);
    if (!action) { showError("Action is unavailable"); return; }
    //const $meta = getSpeedDialMeta(item.id);
    const context = {
        id: item.id,
        items,
        meta,
        action: resolvedAction,
        viewMaker
    };
    try {
        action(context as any, item, extras?.initiator);
    } catch (error) {
        console.warn(error);
        showError("Failed to run action");
    }
};

const attachItemNode = (item: SpeedDialItem, el?: HTMLElement | null, interactive = true) => {
    if (!el) return;
    const args = { layout, items, item, meta };
    el.dataset.id = item.id;
    el.dataset.speedDialItem = "true";
    el.addEventListener("dragstart", (ev)=>ev.preventDefault());
    if (interactive) {
        let pointerDownAt: [number, number] | null = null;
        let pointerDownTs = 0;
        let suppressClickUntil = 0;
        el.addEventListener("click", (ev)=>{
            if (Date.now() < suppressClickUntil) {
                ev?.preventDefault?.();
                ev?.stopPropagation?.();
                return;
            }
            ev?.preventDefault?.();
            if (!MOCElement(ev?.target as any, "[data-dragging]")) {
                runItemAction(item, undefined, { event: ev, initiator: el });
            }
        });
        el.addEventListener("pointerdown", (ev: PointerEvent)=>{
            pointerDownAt = [ev.clientX, ev.clientY];
            pointerDownTs = Date.now();
        });
        el.addEventListener("pointerup", (ev: PointerEvent)=>{
            if (!pointerDownAt) return;
            const dx = ev.clientX - pointerDownAt[0];
            const dy = ev.clientY - pointerDownAt[1];
            const distance = Math.hypot(dx, dy);
            const elapsed = Date.now() - pointerDownTs;
            pointerDownAt = null;
            if (distance <= 6 && elapsed <= 350) {
                // PointerAPI drag helper may swallow synthetic click even for tap-like gestures.
                suppressClickUntil = Date.now() + 250;
                runItemAction(item, undefined, { event: ev, initiator: el });
            }
        });
        el.addEventListener("dblclick", (ev)=>{
            ev?.preventDefault?.();
            openItemEditor(item);
        });
    }

    if (el.dataset.layer === "labels") {
        el.style.pointerEvents = "none";
        // needs to bind cell
        bindCell(el, args);
    }
    if (el.dataset.layer === "icons") {
        bindInteraction(el, { ...args, immediateDragStyles: true });
        const cell = item?.cell ?? [0, 0];
        E(el, {
            style: {
                "--cell-x": propRef(cell, 0),
                "--cell-y": propRef(cell, 1)
            }
        });
    }
};

const floorCell = (cell: [number, number]): [number, number] => {
    return [Math.floor(cell[0]), Math.floor(cell[1])];
};

const roundCell = (cell: [number, number]): [number, number] => {
    return [Math.round(cell[0]), Math.round(cell[1])];
};

const clampCell = (cell: [number, number]): [number, number] => {
    return [Math.max(0, Math.min(cell[0], layout[0] - 1)), Math.max(0, Math.min(cell[1], layout[1] - 1))];
};

//
const getSpanOffset = (bounds: DOMRect | null, layoutSnapshot: [number, number] | null, size: [number, number] | null, orient: number | null): [number, number] => {
    if (!bounds || !layoutSnapshot || !size || orient == null) { return [0, 0]; }
    const safeLayout: [number, number] = [
        Math.max(layoutSnapshot?.[0] || 0, 1),
        Math.max(layoutSnapshot?.[1] || 0, 1)
    ];
    const orientedSize: [number, number] = orient % 2 ? [size?.[1] || 1, size?.[0] || 1] : [size?.[0] || 1, size?.[1] || 1];
    const cellSize: [number, number] = [
        (orientedSize[0] || 1) / safeLayout[0],
        (orientedSize[1] || 1) / safeLayout[1]
    ];
    const spanX = Math.max((bounds?.width || cellSize[0]) / (cellSize[0] || 1), 1);
    const spanY = Math.max((bounds?.height || cellSize[1]) / (cellSize[1] || 1), 1);
    return [(spanX - 1) / 2, (spanY - 1) / 2];
};

const deriveCellFromEvent = (ev?: MouseEvent): GridCell =>{
    const grid = document.querySelector<HTMLElement>("#home .speed-dial-grid");
    if (!grid || !ev) return [0, 0];
    const rect = grid.getBoundingClientRect();

    //
    const orient = orientOf(grid);
    const coord = cvt_cs_to_os([ev?.clientX - (rect?.left || 0), ev?.clientY - (rect?.top || 0)], [rect?.width || 0, rect?.height || 0], orient)
    const projected = convertOrientPxToCX(coord, { layout: [layout[0], layout[1]] as [number, number], size: [rect?.width || 0, rect?.height || 0] as [number, number], item: {} as GridItemType, list: [], items: new Map() }, orient);
    const spanOffset = getSpanOffset(null, [layout[0], layout[1]] as [number, number], [rect?.width || 0, rect?.height || 0] as [number, number], orient);
    projected[0] += spanOffset[0];
    projected[1] += spanOffset[1];
    return clampCell(floorCell(projected));
};

const deriveCellFromCoordinate = (coordinate: [number, number]): GridCell =>{
    const grid = document.querySelector<HTMLElement>("#home .speed-dial-grid");
    if (!grid || !coordinate) return [0, 0];
    const rect = grid.getBoundingClientRect();

    //
    const orient = orientOf(grid);
    const coord = cvt_cs_to_os([coordinate[0] - (rect?.left || 0), coordinate[1] - (rect?.top || 0)], [rect?.width || 0, rect?.height || 0], orient)
    const projected = convertOrientPxToCX(coord, { layout: [layout[0], layout[1]] as [number, number], size: [rect?.width || 0, rect?.height || 0] as [number, number], item: {} as GridItemType, list: [], items: new Map() }, orient);
    const spanOffset = getSpanOffset(null, [layout[0], layout[1]] as [number, number], [rect?.width || 0, rect?.height || 0] as [number, number], orient);
    projected[0] += spanOffset[0];
    projected[1] += spanOffset[1];
    return clampCell(floorCell(projected));
};

const looksLikeImageFile = (file?: File | null): boolean => {
    if (!file) return false;
    const type = String(file.type || "").toLowerCase();
    if (type.startsWith("image/")) return true;
    const name = String(file.name || "").trim().toLowerCase();
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
    return WALLPAPER_EXTENSIONS.has(ext);
};

const parseUrlFromHtml = (html?: string | null): string | null => {
    const source = String(html || "").trim();
    if (!source) return null;
    const hrefMatch = source.match(/href\s*=\s*["']([^"']+)["']/i);
    const href = String(hrefMatch?.[1] || "").trim();
    if (!href) return null;
    return href;
};

const parseShortcutFromTransfer = (transfer: DataTransfer | null | undefined, suggestedCell: GridCell): SpeedDialItem | null => {
    if (!transfer) return null;
    const plain = String(transfer.getData("text/plain") || "").trim();
    const uriList = String(transfer.getData("text/uri-list") || "").trim();
    const html = String(transfer.getData("text/html") || "").trim();
    const preferred = plain || uriList || parseUrlFromHtml(html) || "";
    if (!preferred) return null;
    return parseSpeedDialItemFromJSON(preferred, suggestedCell)
        || parseSpeedDialItemFromURL(preferred, suggestedCell);
};

const createMenuEntryForAction = (actionId: string, item: SpeedDialItem, fallbackLabel: string = "") => {
    const descriptor = buildDescriptor(item) as any;
    return {
        id: actionId,
        label: labelsPerAction.get(actionId)?.(descriptor) || fallbackLabel,
        icon: iconsPerAction.get(actionId) || "command",
        action: (initiator: HTMLElement, _menuItem: any, ev: MouseEvent)=>runItemAction(item, actionId, { event: ev, initiator })
    };
};

//
export function makeWallpaper() {
    const oRef = orientRef();
    const srcRef = stringRef("./assets/imgs/test.webp");
    affected([wallpaperState, "src"], (s) => provide("/user" + (s?.src || (typeof s == "string" ? s : null)))?.then?.(blob => (srcRef.value = URL.createObjectURL(blob)))?.catch?.(console.warn.bind(console)) || "./assets/imgs/test.webp");
    const CE = H`<canvas slot="backdrop" style="position: absolute; pointer-events: none; min-inline-size: 0px; min-block-size: 0px; inline-size: stretch; block-size: stretch; max-block-size: stretch; max-inline-size: stretch; transform: none; scale: 1; inset: 0; pointer-events: none;" data-orient=${oRef} is="ui-canvas" data-src=${srcRef}></canvas>`;
    return CE;
}

//
const pickWallpaper = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
            const dir = "/images/wallpaper/";
            await writeFileSmart(null, dir, file);
            const path = `${dir}${file.name}`;
            wallpaperState.src = path;
            persistWallpaper();
            showSuccess("Wallpaper updated");
        } catch (e) {
            console.warn(e);
            showError("Failed to set wallpaper");
        }
    };
    input.click();
};

//
const handleSpeedDialPaste = async (event: ClipboardEvent, suggestedCell?: GridCell) => {
    if (!isInFocus(event?.target as HTMLElement, "#home") &&
        !isInFocus(event?.target as HTMLElement, "#home:is(:hover, :focus, :focus-visible), #home:has(:hover, :focus, :focus-visible)", "child")
    ) {
        return false;
    }

    event.preventDefault();
    event.stopPropagation();

    try {
        const targetCell = suggestedCell ?? deriveCellFromCoordinate([coordinateRef[0].value, coordinateRef[1].value]);
        const fromClipboardData = parseShortcutFromTransfer(event.clipboardData, targetCell);
        const item = fromClipboardData || await createSpeedDialItemFromClipboard(targetCell);
        if (!item) {
            return false;
        }

        addSpeedDialItem(item);
        persistSpeedDialItems();
        persistSpeedDialMeta();
        showSuccess("Shortcut created from clipboard");
        return true;
    } catch (e) {
        console.warn("Failed to paste speed dial item:", e);
        return false;
    }
};

//
const coordinateRef = typeof document != "undefined" ? pointerAnchorRef() : [numberRef(0), numberRef(0)];

//
const handleWallpaperDropOrPaste = (event: DragEvent | ClipboardEvent) => {
    if (isInFocus(event?.target as HTMLElement, "#home") ||
        isInFocus(event?.target as HTMLElement, "#home:is(:hover, :focus, :focus-visible), #home:has(:hover, :focus, :focus-visible)", "child")
    ) {
        const isPaste = event instanceof ClipboardEvent;
        const targetEl = event.target as HTMLElement | null;
        const droppedOnItem = !!targetEl?.closest?.("[data-speed-dial-item]");
        const suggestedCell = deriveCellFromCoordinate([coordinateRef[0].value, coordinateRef[1].value]);
        const dataTransfer = isPaste ? (event as ClipboardEvent).clipboardData : (event as DragEvent).dataTransfer;

        if (isPaste) {
            const fromTransfer = parseShortcutFromTransfer(dataTransfer, suggestedCell);
            if (fromTransfer) {
                event.preventDefault();
                event.stopPropagation();
                addSpeedDialItem(fromTransfer);
                persistSpeedDialItems();
                persistSpeedDialMeta();
                showSuccess("Shortcut created from pasted link");
                return;
            }
            void handleSpeedDialPaste(event as ClipboardEvent, suggestedCell);
        }

        if (!isPaste) {
            const parsed = parseShortcutFromTransfer(dataTransfer, suggestedCell);
            if (parsed) {
                event.preventDefault();
                event.stopPropagation();
                addSpeedDialItem(parsed);
                persistSpeedDialItems();
                persistSpeedDialMeta();
                showSuccess("Shortcut created from dropped link");
                return;
            }
        }

        event.preventDefault();
        event.stopPropagation();

        const dt = dataTransfer || ((event as any).clipboardData || (event as any).dataTransfer);
        const hasImageFile = !!Array.from((dt as DataTransfer | null)?.files || []).find((file) => looksLikeImageFile(file));
        if (!hasImageFile || droppedOnItem) {
            return;
        }
        // Defer heavy file/clipboard scanning so the UI thread can process preventDefault first.
        queueMicrotask(() => {
            handleIncomingEntries(dt, "/images/wallpaper/", null, (file, path) => {
                console.log(file, path);
                if (looksLikeImageFile(file)) {
                    wallpaperState.src = path;
                    persistWallpaper();
                    showSuccess("Wallpaper updated");
                }
            });
        });
    }
};


export function SpeedDial(makeView: any) {
    viewMaker = makeView;

    const columnsRef = propRef(gridLayoutState, "columns", 4);
    const rowsRef = propRef(gridLayoutState, "rows", 8);
    const shapeRef = propRef(gridLayoutState, "shape", "square");

    //
    const renderIconItem = (item: SpeedDialItem)=>{
        return H`<div class="ui-ws-item" data-speed-dial-item data-layer="icons" ref=${(el) => attachItemNode(item, el as HTMLElement, true)}>
            <div data-shape=${shapeRef} class="ui-ws-item-icon shaped">
                <ui-icon icon=${item.icon}></ui-icon>
            </div>
        </div>`;
    };

    //
    const renderLabelItem = (item: SpeedDialItem)=>{
        return H`<div style="background-color: transparent;" class="ui-ws-item" data-speed-dial-item data-layer="labels" ref=${(el) => attachItemNode(item, el as HTMLElement, true)}>
            <div class="ui-ws-item-label" style="background-color: transparent;">
                <span style="background-color: transparent;">${getRefValue(item.label)}</span>
            </div>
        </div>`;
    };

    //
    const oRef = orientRef();
    const box = H`<div slot="underlay" style="pointer-events: auto; position: relative; contain: strict; overflow: hidden;" id="home" data-mixin="ui-orientbox" class="speed-dial-root" prop:orient=${oRef} on:dragover=${(ev: DragEvent) => ev.preventDefault()} on:drop=${(ev: DragEvent) => handleWallpaperDropOrPaste(ev)} prop:onPaste=${async (ev: ClipboardEvent) => await handleWallpaperDropOrPaste(ev)}>
        <div style="background-color: transparent; color-scheme: dark; pointer-events: none;" class="speed-dial-grid" data-layer="items" data-mixin="ui-gridbox" data-grid-columns=${columnsRef} data-grid-rows=${rowsRef} data-grid-shape=${shapeRef}>
            ${M(items, renderLabelItem)}
        </div>
        <div style="background-color: transparent; pointer-events: none;" class="speed-dial-grid" data-layer="items" data-mixin="ui-gridbox" data-grid-columns=${columnsRef} data-grid-rows=${rowsRef} data-grid-shape=${shapeRef}>
            ${M(items, renderIconItem)}
        </div>
    </div>`;

    //
    return box;
}

//
const openItemEditor = (item?: SpeedDialItem, opts?: {
    suggestedCell?: GridCell;
    seed?: Partial<{ label: string; icon: string; action: string; view: string; href: string; description: string }>;
})=>{
    const workingItem = item ?? createEmptySpeedDialItem(opts?.suggestedCell ?? deriveCellFromCoordinate([coordinateRef[0].value, coordinateRef[1].value]));
    const isNew = !item;
    const workingMeta = ensureSpeedDialMeta(workingItem.id);
    const seed = opts?.seed || {};
    if (isNew && seed?.action) {
        workingItem.action = seed.action;
        workingMeta.action = seed.action;
    }
    if (isNew && seed?.label) {
        workingItem.label.value = seed.label;
    }
    if (isNew && seed?.icon) {
        workingItem.icon.value = seed.icon;
    }
    if (isNew && seed?.view) {
        workingMeta.view = seed.view;
    }
    if (isNew && seed?.href) {
        workingMeta.href = seed.href;
    }
    if (isNew && seed?.description) {
        workingMeta.description = seed.description;
    }
    const draft = {
        label: getRefValue(workingItem.label, "New shortcut"),
        icon: getRefValue(workingItem.icon, "sparkle"),
        action: resolveItemAction(workingItem),
        href: workingMeta?.href || "",
        view: workingMeta?.view || "",
        description: workingMeta?.description || ""
    };

    const modal = H`<div class="rs-modal-backdrop speed-dial-editor">
        <form class="modal-form speed-dial-editor__form">
            <header class="modal-header">
                <h2 class="modal-title">${isNew ? "Create shortcut" : "Edit shortcut"}</h2>
                <p class="modal-description">Configure quick access tiles for frequently used views or links.</p>
            </header>
            <div class="modal-fields">
                <label class="modal-field">
                    <span>Label</span>
                    <input name="label" type="text" minlength="1" required value="${draft.label}" />
                </label>
                <label class="modal-field">
                    <span>Icon</span>
                    <input name="icon" type="text" placeholder="phosphor icon name" value="${draft.icon}" />
                </label>
                <label class="modal-field">
                    <span>Action</span>
                    <select name="action">
                        ${ACTION_OPTIONS.map((option)=>H`<option selected="${option.value === draft.action}" value="${option.value}">${option.label}</option>`)}
                    </select>
                </label>
                <label class="modal-field" data-field="view">
                    <span>View</span>
                    <select name="view">
                        <option value="">Choose view</option>
                        ${NAVIGATION_SHORTCUTS.map((shortcut)=>H`<option selected="${shortcut.view === draft.view}" value="${shortcut.view}" >${shortcut.label}</option>`)}
                    </select>
                </label>
                <label class="modal-field" data-field="href">
                    <span>Link</span>
                    <input name="href" type="url" placeholder="https://example.com" value="${draft.href}"/>
                </label>
                <label class="modal-field">
                    <span>Description</span>
                    <textarea name="description" rows="2" placeholder="Optional description">${draft.description}</textarea>
                </label>
            </div>
            <footer class="modal-actions">
                <div class="modal-actions-left">
                    ${!isNew ? H`<button type="button" data-action="delete" class="btn danger">Delete</button>` : null}
                </div>
                <div class="modal-actions-right">
                    <button type="button" data-action="cancel" class="btn secondary">Cancel</button>
                    <button type="submit" class="btn save">Save</button>
                </div>
            </footer>
        </form>
    </div>`;

    const form = modal.querySelector("form") as HTMLFormElement;
    const actionSelect = form?.querySelector<HTMLSelectElement>('select[name="action"]');
    const viewField = form?.querySelector<HTMLElement>('[data-field="view"]');
    const hrefField = form?.querySelector<HTMLElement>('[data-field="href"]');

    const toggleFieldVisibility = ()=>{
        const value = actionSelect?.value;
        if (viewField) viewField.hidden = value !== "open-view";
        if (hrefField) hrefField.hidden = !(value === "open-link" || value === "copy-link");
    };

    actionSelect?.addEventListener("change", toggleFieldVisibility);
    toggleFieldVisibility();

    let unregisterBackNav: (() => void) | null = null;

    const closeModal = ()=>{
        unregisterBackNav?.();
        modal?.remove?.();
        document.removeEventListener("keydown", escHandler);
    };

    const escHandler = (ev: KeyboardEvent)=>{
        if (ev.key === "Escape") {
            closeModal();
        }
    };
    document.addEventListener("keydown", escHandler);

    modal.addEventListener("click", (ev: Event)=>{
        if (ev.target === modal) {
            closeModal();
        }
    });

    // Register modal with back navigation system for mobile back gesture support
    unregisterBackNav = registerModal(modal as HTMLElement, undefined, closeModal);

    form?.addEventListener("submit", (ev)=>{
        ev?.preventDefault?.();
        const formData = new FormData(form);
        workingItem.label.value = (formData.get("label") as string || "").trim();
        workingItem.icon.value = (formData.get("icon") as string || "").trim() || "sparkle";
        workingItem.action = (formData.get("action") as string) || "open-view";
        workingMeta.action = workingItem.action;
        workingMeta.view = (formData.get("view") as string || "").trim();
        workingMeta.href = (formData.get("href") as string || "").trim();
        workingMeta.description = (formData.get("description") as string || "").trim();
        if (isNew) {
            addSpeedDialItem(workingItem);
        } else {
            upsertSpeedDialItem(workingItem);
        }
        persistSpeedDialItems();
        persistSpeedDialMeta();
        showSuccess(isNew ? "Shortcut created" : "Shortcut updated");
        closeModal();
    });

    form?.addEventListener("click", (ev: Event)=>{
        const target = ev.target as HTMLElement;
        const action = target?.dataset?.action;
        if (action === "cancel") {
            ev.preventDefault();
            closeModal();
        }
        if (action === "delete" && !isNew) {
            ev.preventDefault();
            removeSpeedDialItem(workingItem.id);
            persistSpeedDialItems();
            persistSpeedDialMeta();
            showSuccess("Shortcut removed");
            closeModal();
        }
    });

    document.body.append(modal);
};

export function createCtxMenu() {
    if (!ctxMenuBound) {
        ctxMenuBound = true;
        document.addEventListener("contextmenu", (event: MouseEvent) => {
            const homeRoot = (event.target as HTMLElement | null)?.closest?.("#home");
            if (!homeRoot) return;
            event.preventDefault();
            const targetEl = (event.target as HTMLElement | null)?.closest?.("[data-speed-dial-item]");
            const itemId = targetEl?.getAttribute?.("data-id");
            const item = findSpeedDialItem(itemId);
            const guessedCell = deriveCellFromEvent(event) ?? deriveCellFromCoordinate([coordinateRef[0].value, coordinateRef[1].value]);
            const toLeaf = (entry: any): ContextMenuEntry => ({
                id: String(entry?.id || "menu-action"),
                label: String(entry?.label || "Action"),
                icon: String(entry?.icon || "command"),
                action: () => entry?.action?.(targetEl as HTMLElement, entry, event)
            });

            const menuItems: ContextMenuEntry[] = item
                ? [
                    {
                        id: "open",
                        label: "Open",
                        icon: "play",
                        action: () => runItemAction(item, undefined, { event, initiator: targetEl as HTMLElement })
                    },
                    {
                        id: "actions",
                        label: "Actions",
                        icon: "dots-three",
                        action: () => {},
                        children: [
                            toLeaf(createMenuEntryForAction(resolveItemAction(item) || "open-view", item, "Run action")),
                            ...(getSpeedDialMeta(item.id)?.href ? [
                                toLeaf(createMenuEntryForAction("open-link", item, "Open link")),
                                toLeaf(createMenuEntryForAction("copy-link", item, "Copy link"))
                            ] : []),
                            toLeaf(createMenuEntryForAction("copy-state-desc", item, "Copy shortcut JSON"))
                        ]
                    },
                    {
                        id: "manage",
                        label: "Manage",
                        icon: "wrench",
                        action: () => {},
                        children: [
                            { id: "edit", label: "Edit Properties", icon: "pencil-simple-line", action: ()=>openItemEditor(item) },
                            {
                                id: "remove",
                                label: "Remove",
                                icon: "trash",
                                danger: true,
                                action: ()=>{
                                    removeSpeedDialItem(item.id);
                                    persistSpeedDialItems();
                                    persistSpeedDialMeta();
                                    showSuccess("Shortcut removed");
                                }
                            }
                        ]
                    }
                ]
                : [
                    {
                        id: "new",
                        label: "New",
                        icon: "plus",
                        action: () => {},
                        children: [
                            {
                                id: "create-shortcut",
                                label: "Create shortcut",
                                icon: "plus",
                                action: ()=>{
                                    openItemEditor(undefined, { suggestedCell: guessedCell });
                                }
                            },
                            {
                                id: "create-link-shortcut",
                                label: "Create link shortcut",
                                icon: "link",
                                action: ()=>{
                                    openItemEditor(undefined, {
                                        suggestedCell: guessedCell,
                                        seed: {
                                            action: "open-link",
                                            icon: "link",
                                            label: "New link",
                                            href: "",
                                            description: ""
                                        }
                                    });
                                }
                            },
                            {
                                id: "paste-shortcut",
                                label: "Paste shortcut",
                                icon: "clipboard",
                                action: async ()=>{
                                    try {
                                        const speedDialItem = await createSpeedDialItemFromClipboard(guessedCell);
                                        if (!speedDialItem) {
                                            showError("Clipboard does not contain a valid URL or shortcut JSON");
                                            return;
                                        }
                                        addSpeedDialItem(speedDialItem);
                                        persistSpeedDialItems();
                                        persistSpeedDialMeta();
                                        showSuccess("Shortcut created from clipboard");
                                    } catch (e) {
                                        console.warn(e);
                                        showError("Failed to paste shortcut");
                                    }
                                }
                            }
                        ]
                    },
                    {
                        id: "open",
                        label: "Open",
                        icon: "squares-four",
                        action: () => {},
                        children: [
                            { id: "open-explorer", label: "Explorer", icon: "books", action: ()=>{
                                actionRegistry.get("open-view-explorer")?.({ id: "", items, meta, viewMaker }, {});
                            } },
                            { id: "open-settings", label: "Settings", icon: "gear-six", action: ()=>{
                                actionRegistry.get("open-view-settings")?.({ id: "", items, meta, viewMaker }, {});
                            } }
                        ]
                    },
                    {
                        id: "wallpaper",
                        label: "Wallpaper",
                        icon: "image",
                        action: () => {},
                        children: [
                            { id: "change-wallpaper", label: "Change wallpaper", icon: "image", action: pickWallpaper }
                        ]
                    }
                ];

            openUnifiedContextMenu({
                x: event.clientX,
                y: event.clientY,
                items: menuItems,
                compact: true
            });
        }, { capture: true });
    }

    return H`<div data-home-ctx-menu style="display:none;"></div>` as HTMLElement;
}

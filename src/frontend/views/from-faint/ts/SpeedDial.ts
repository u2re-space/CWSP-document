import { observe, numberRef, propRef, stringRef, affected } from "fest/object";
import { ctxMenuTrigger, E, H, orientRef, M, Q, provide, registerModal, handleIncomingEntries, pointerAnchorRef } from "fest/lure";
import { bindInteraction } from "fest/lure";
import { actionRegistry, iconsPerAction, labelsPerAction } from "@rs-core/utils/Actions";
import { showSuccess, showError } from "@rs-frontend/items/Toast";
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
    persistGridLayout,
    createSpeedDialItemFromClipboard,
    parseSpeedDialItemFromJSON,
    parseSpeedDialItemFromURL,
    type SpeedDialItem,
    type GridCell
} from "@rs-core/storage/StateStorage";
import { getBoundingOrientRect, isInFocus, MOCElement, orientOf } from "fest/dom";
import { writeFileSmart } from "@rs-core/storage/WriteFileSmart-v2";
import { convertOrientPxToCX, cvt_cs_to_os, type GridItemType } from "fest/core";
import { emitEnvironmentEvent, runEnvironmentTrigger } from "@rs-frontend/environment/registries";
import { getAppOverlayRoot } from "@rs-frontend/main/wallpaper-host";

let viewMaker: any = null;
const layout = observe([gridLayoutState.columns ?? 4, gridLayoutState.rows ?? 8]);
const items = speedDialItems;
const meta = speedDialMeta;

const DESKTOP_DEFAULT_SHORTCUTS = [
    { id: "shortcut-viewer", view: "viewer", label: "Viewer", icon: "eye", cell: [0, 0] as GridCell },
    { id: "shortcut-explorer", view: "explorer", label: "Explorer", icon: "books", cell: [1, 0] as GridCell },
    { id: "shortcut-workcenter", view: "workcenter", label: "Work Center", icon: "lightning", cell: [2, 0] as GridCell },
    { id: "shortcut-airpad", view: "airpad", label: "Airpad", icon: "hand", cell: [3, 0] as GridCell },
    { id: "shortcut-settings", view: "settings", label: "Settings", icon: "gear-six", cell: [0, 1] as GridCell },
    { id: "shortcut-history", view: "history", label: "History", icon: "history", cell: [1, 1] as GridCell }
] as const;

const ensureDesktopShortcuts = () => {
    let changed = false;
    for (const shortcut of DESKTOP_DEFAULT_SHORTCUTS) {
        if (findSpeedDialItem(shortcut.id)) continue;
        const item = observe({
            id: shortcut.id,
            cell: observe([...shortcut.cell] as GridCell),
            icon: stringRef(shortcut.icon),
            label: stringRef(shortcut.label),
            action: "open-view"
        }) as unknown as SpeedDialItem;
        addSpeedDialItem(item);
        ensureSpeedDialMeta(shortcut.id, { action: "open-view", view: shortcut.view });
        changed = true;
    }
    if (changed) {
        persistSpeedDialItems();
        persistSpeedDialMeta();
    }
};

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

const getRefValue = (ref: any, fallback = "") => {
    if (ref && typeof ref === "object" && "value" in ref) return ref.value ?? fallback;
    return ref ?? fallback;
};

const getOverlayRoot = (): HTMLElement | null => {
    if (typeof document === "undefined") return null;
    return getAppOverlayRoot(document);
};

const URL_PASTE_MODE_KEY = "cw::env::url-paste-mode";
const URL_PASTE_TARGET_KEY = "cw::env::url-paste-target";
type UrlPasteMode = "shortcut" | "open-now";
type UrlPasteTarget = "_self" | "_blank";

const getUrlPasteMode = (): UrlPasteMode => {
    const raw = String(localStorage.getItem(URL_PASTE_MODE_KEY) || "").trim();
    return raw === "open-now" ? "open-now" : "shortcut";
};

const setUrlPasteMode = (mode: UrlPasteMode) => {
    localStorage.setItem(URL_PASTE_MODE_KEY, mode);
};

const getUrlPasteTarget = (): UrlPasteTarget => {
    const raw = String(localStorage.getItem(URL_PASTE_TARGET_KEY) || "").trim();
    return raw === "_self" ? "_self" : "_blank";
};

const setUrlPasteTarget = (target: UrlPasteTarget) => {
    localStorage.setItem(URL_PASTE_TARGET_KEY, target);
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
    let lastDragAt = 0;
    el.dataset.id = item.id;
    el.dataset.speedDialItem = "true";
    el.addEventListener("dragstart", (ev)=>ev.preventDefault());
    if (interactive) {
        el.addEventListener("click", (ev)=>{
            ev?.preventDefault?.();
            if (Date.now() - lastDragAt < 250) return;
            if (!MOCElement(ev?.target as any, "[data-dragging]")) {
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
        bindInteraction(el, args);
        const cell = item?.cell ?? [0, 0];
        let prevCell = `${cell?.[0] ?? 0}:${cell?.[1] ?? 0}`;
        let didMove = false;
        E(el, {
            style: {
                "--cell-x": propRef(cell, 0),
                "--cell-y": propRef(cell, 1)
            }
        });
        affected(cell as any, () => {
            const next = `${cell?.[0] ?? 0}:${cell?.[1] ?? 0}`;
            if (next !== prevCell) {
                prevCell = next;
                didMove = true;
                el.classList.remove("speed-dial-item-placed");
                requestAnimationFrame(() => el.classList.add("speed-dial-item-placed"));
            }
        });
        el.addEventListener("m-dragstart", () => {
            didMove = false;
            el.setAttribute("data-dragging", "true");
        });
        el.addEventListener("m-dragend", () => {
            el.removeAttribute("data-dragging");
            if (!didMove) return;
            lastDragAt = Date.now();
            persistSpeedDialItems();
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
    const DEFAULT_WALLPAPER = "/assets/wallpaper.jpg";
    const srcRef = stringRef(DEFAULT_WALLPAPER);
    affected([wallpaperState, "src"], (s) => {
        const raw = String(s?.src || (typeof s == "string" ? s : "") || "").trim();
        if (!raw) {
            srcRef.value = DEFAULT_WALLPAPER;
            return;
        }
        if (/^(https?:|blob:|data:)/.test(raw) || raw.startsWith("/assets/") || raw.startsWith("./assets/")) {
            srcRef.value = raw;
            return;
        }
        const userPath = raw.startsWith("/user/") ? raw : `/user${raw.startsWith("/") ? "" : "/"}${raw}`;
        provide(userPath)
            ?.then?.((blob) => (srcRef.value = URL.createObjectURL(blob)))
            ?.catch?.(() => {
                srcRef.value = DEFAULT_WALLPAPER;
            });
    });
    const CE = H`<canvas
        slot="backdrop"
        class="speed-dial-wallpaper"
        style="position: absolute; pointer-events: none; min-inline-size: 0px; min-block-size: 0px; inline-size: stretch; block-size: stretch; max-block-size: stretch; max-inline-size: stretch; inset: 0;"
        data-orient=${oRef}
        is="ui-canvas"
        data-src=${srcRef}
    ></canvas>`;
    affected(wallpaperState as any, (wallpaper) => {
        const opacity = Math.max(0, Math.min(1, Number(wallpaper?.opacity ?? 1)));
        const blur = Math.max(0, Number(wallpaper?.blur ?? 0));
        const rotate = Number(wallpaper?.rotate ?? 0);
        CE.style.opacity = `${opacity}`;
        CE.style.filter = `blur(${blur}px)`;
        CE.style.transform = `rotate(${rotate}deg) scale(1.08)`;
        CE.style.transformOrigin = "center center";
    });
    const wpHost =
        typeof document !== "undefined" ? document.querySelector("[data-cw-app-wallpaper]") : null;
    if (wpHost) {
        wpHost.appendChild(CE);
    }
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
        const item = await createSpeedDialItemFromClipboard(suggestedCell ?? deriveCellFromCoordinate([coordinateRef[0].value, coordinateRef[1].value]));
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

const rotateWallpaperBy = (angle: number) => {
    const next = (((Number((wallpaperState as any)?.rotate || 0) + angle) % 360) + 360) % 360;
    (wallpaperState as any).rotate = next;
    persistWallpaper();
    emitEnvironmentEvent("cw:env-wallpaper-rotate", { rotate: (wallpaperState as any)?.rotate ?? 0 });
};

const createItemByText = (text: string, suggestedCell?: GridCell): SpeedDialItem | null => {
    const jsonItem = parseSpeedDialItemFromJSON(text, suggestedCell);
    if (jsonItem) return jsonItem;
    const urlItem = parseSpeedDialItemFromURL(text, suggestedCell);
    if (!urlItem) return null;
    const meta = ensureSpeedDialMeta(urlItem.id, {});
    meta.target = getUrlPasteTarget();
    persistSpeedDialMeta();
    return urlItem;
};

//
const handleWallpaperDropOrPaste = (event: DragEvent | ClipboardEvent) => {
    if (isInFocus(event?.target as HTMLElement, "#home") ||
        isInFocus(event?.target as HTMLElement, "#home:is(:hover, :focus, :focus-visible), #home:has(:hover, :focus, :focus-visible)", "child")
    ) {
        const isPaste = event instanceof ClipboardEvent;
        const dataTransfer = isPaste ? (event as ClipboardEvent).clipboardData : (event as DragEvent).dataTransfer;

        if (isPaste) {
            void handleSpeedDialPaste(event as ClipboardEvent);
        }

        event.preventDefault();
        event.stopPropagation();
        const root = Q("#home") as HTMLElement | null;
        root?.classList?.remove?.("speed-dial-dropping");
        requestAnimationFrame(() => root?.classList?.add?.("speed-dial-dropping"));

        const dt = dataTransfer || ((event as any).clipboardData || (event as any).dataTransfer);
        const textPayload = dt?.getData?.("application/json") || dt?.getData?.("text/plain") || "";
        if (textPayload) {
            const suggested = deriveCellFromCoordinate([coordinateRef[0].value, coordinateRef[1].value]);
            const item = createItemByText(String(textPayload), suggested);
            if (item) {
                const itemMeta = getSpeedDialMeta(item.id);
                if (getUrlPasteMode() === "open-now" && itemMeta?.href) {
                    runItemAction(item, "open-link", { event, initiator: root || undefined });
                    showSuccess("URL opened");
                    return;
                }
                addSpeedDialItem(item);
                persistSpeedDialItems();
                persistSpeedDialMeta();
                showSuccess("Shortcut added from drop/paste");
            }
        }
        // Defer heavy file/clipboard scanning so the UI thread can process preventDefault first.
        queueMicrotask(() => {
            handleIncomingEntries(dt, "/images/wallpaper/", null, (file, path) => {
                console.log(file, path);
                if (file.type.startsWith("image/")) {
                    wallpaperState.src = path;
                    persistWallpaper();
                    showSuccess("Wallpaper updated");
                    emitEnvironmentEvent("cw:env-wallpaper-updated", { path });
                }
            });
        });
    }
};


export function SpeedDial(makeView: any) {
    viewMaker = makeView;
    ensureDesktopShortcuts();

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
        <div class="speed-dial-statusbar" aria-label="Environment status bar">
            <div class="speed-dial-statusbar__clock" ref=${(el) => {
                if (!el) return;
                const render = () => {
                    const now = new Date();
                    (el as HTMLElement).textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                };
                render();
                const interval = setInterval(render, 1000 * 15);
                (el as any).__timer = interval;
            }}></div>
            <div class="speed-dial-statusbar__widgets">
                <span class="speed-dial-status-widget" ref=${(el) => {
                    if (!el) return;
                    const render = () => {
                        const anyNav = navigator as any;
                        const conn = anyNav?.connection;
                        const status = navigator.onLine ? (conn?.effectiveType || "online") : "offline";
                        (el as HTMLElement).textContent = `Net: ${status}`;
                    };
                    render();
                    globalThis.addEventListener?.("online", render);
                    globalThis.addEventListener?.("offline", render);
                    (navigator as any)?.connection?.addEventListener?.("change", render);
                    document.addEventListener("cw:env-status-refresh", render as EventListener);
                }}>Net: --</span>
                <span class="speed-dial-status-widget" ref=${(el) => {
                    if (!el) return;
                    const render = async () => {
                        try {
                            const battery = await (navigator as any)?.getBattery?.();
                            if (!battery) { (el as HTMLElement).textContent = "Battery: n/a"; return; }
                            (el as HTMLElement).textContent = `Battery: ${Math.round((battery.level || 0) * 100)}%`;
                        } catch {
                            (el as HTMLElement).textContent = "Battery: n/a";
                        }
                    };
                    render();
                    document.addEventListener("cw:env-status-refresh", render as EventListener);
                }}>Battery: --</span>
            </div>
            <div class="speed-dial-statusbar__actions">
                <button type="button" class="speed-dial-chip" on:click=${() => makeView("settings", { focus: true })}>Settings</button>
                <button type="button" class="speed-dial-chip" on:click=${() => makeView("explorer", { focus: true })}>Explorer</button>
                <button type="button" class="speed-dial-chip" on:click=${() => runEnvironmentTrigger("refresh-status")}>Refresh</button>
            </div>
        </div>
        <div class="speed-dial-dock" aria-label="Launcher dock">
            <button type="button" class="speed-dial-dock__item" on:click=${() => makeView("explorer", { focus: true })}><ui-icon icon="books"></ui-icon></button>
            <button type="button" class="speed-dial-dock__item" on:click=${() => makeView("viewer", { focus: true })}><ui-icon icon="eye"></ui-icon></button>
            <button type="button" class="speed-dial-dock__item" on:click=${() => makeView("settings", { focus: true })}><ui-icon icon="gear-six"></ui-icon></button>
        </div>
    </div>`;

    //
    return box;
}

//
const openItemEditor = (item?: SpeedDialItem, opts?: { suggestedCell?: GridCell })=>{
    const workingItem = item ?? createEmptySpeedDialItem(opts?.suggestedCell ?? deriveCellFromCoordinate([coordinateRef[0].value, coordinateRef[1].value]));
    const isNew = !item;
    const workingMeta = ensureSpeedDialMeta(workingItem.id);
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

    const overlayRoot = getOverlayRoot();
    (overlayRoot || document.body).append(modal);
};

export function createCtxMenu() {
    const ctxMenuDesc = {
        openedWith: null,
        items: [],
        meta: {},
        context: null,
        buildItems(details){
            const targetEl = (details.event?.target as HTMLElement | null)?.closest?.("[data-speed-dial-item]");
            const itemId = targetEl?.getAttribute?.("data-id");
            const item = findSpeedDialItem(itemId);
            const context = {
                items,
                type: item ? "item" : "void",
                item,
                meta,
                event: details.event,
                guessedCell: deriveCellFromEvent(details.event),
                initiator: targetEl as HTMLElement
            };
            (ctxMenuDesc as any).context = context;

            if (item) {
                const currentAction = resolveItemAction(item);
                const sections: any[] = [];
                if (currentAction != "open-link") {
                    sections.push([
                        createMenuEntryForAction(currentAction || "open-view", item, "Run action")
                    ]);
                }
                const utilities: any[] = [];
                const $meta = getSpeedDialMeta(item.id);
                if ($meta?.href) {
                    utilities.push(createMenuEntryForAction("open-link", item, "Open link"));
                    utilities.push(createMenuEntryForAction("copy-link", item, "Copy link"));
                }
                utilities.push(createMenuEntryForAction("copy-state-desc", item, "Copy shortcut JSON"));
                sections.push(utilities);
                sections.push([
                    { id: "edit", label: "Edit shortcut", icon: "pencil-simple-line", action: ()=>openItemEditor(item) },
                    { id: "remove", label: "Remove", icon: "trash", action: ()=>{
                        removeSpeedDialItem(item.id);
                        persistSpeedDialItems();
                        persistSpeedDialMeta();
                        showSuccess("Shortcut removed");
                    } }
                ]);
                sections.push([
                    { id: "open-explorer", label: "Explorer", icon: "books", action: ()=>{
                        actionRegistry.get(`open-view-explorer`)?.({ id: "", items, meta, viewMaker }, {})
                    } },
                    { id: "open-settings", label: "Settings", icon: "gear-six", action: ()=>{
                        actionRegistry.get(`open-view-settings`)?.({ id: "", items, meta, viewMaker }, {})
                    } }
                ]);
                /*sections.push(NAVIGATION_SHORTCUTS.map((shortcut)=>({
                    id: `open-${shortcut.view}`,
                    label: `Open ${shortcut.label}`,
                    icon: shortcut.icon,
                    action: ()=>actionRegistry.get(`open-view-${shortcut.view}`)?.({id: itemId || "", items, meta, shortcut, viewMaker}, item)
                })));*/
                return sections.filter((section)=>section?.length);
            }

            const emptySections = [
                [{
                    id: "create-shortcut",
                    label: "Create shortcut",
                    icon: "plus",
                    action: ()=>{
                        openItemEditor(undefined, { suggestedCell: context.guessedCell ?? deriveCellFromCoordinate([coordinateRef[0].value, coordinateRef[1].value]) });
                    }
                }, {
                    id: "paste-shortcut",
                    label: "Paste shortcut",
                    icon: "clipboard",
                    action: async ()=>{
                        try {
                            const item = await createSpeedDialItemFromClipboard(context.guessedCell ?? deriveCellFromCoordinate([coordinateRef[0].value, coordinateRef[1].value]));
                            if (!item) {
                                showError("Clipboard does not contain a valid URL or shortcut JSON");
                                return;
                            }
                            addSpeedDialItem(item);
                            persistSpeedDialItems();
                            persistSpeedDialMeta();
                            showSuccess("Shortcut created from clipboard");
                        } catch (e) {
                            console.warn(e);
                            showError("Failed to paste shortcut");
                        }
                    }
                }, {
                    id: "new-shortcut-from-url",
                    label: "Add shortcut from URL",
                    icon: "link-simple",
                    action: async ()=>{
                        const input = prompt("Paste URL or shortcut JSON");
                        if (!input?.trim?.()) return;
                        const item = createItemByText(input, context.guessedCell);
                        if (!item) {
                            showError("Not a valid URL or shortcut JSON");
                            return;
                        }
                        addSpeedDialItem(item);
                        persistSpeedDialItems();
                        persistSpeedDialMeta();
                        showSuccess("Shortcut created");
                    }
                }, {
                    id: "url-paste-as-shortcut",
                    label: "URL paste: Create shortcut",
                    icon: "push-pin-simple",
                    action: ()=>{
                        setUrlPasteMode("shortcut");
                        showSuccess("URL paste set to: create shortcut");
                    }
                }, {
                    id: "url-paste-open-now",
                    label: "URL paste: Open directly",
                    icon: "arrow-square-out",
                    action: ()=>{
                        setUrlPasteMode("open-now");
                        showSuccess("URL paste set to: open directly");
                    }
                }, {
                    id: "url-open-target-self",
                    label: "URL target: Same tab",
                    icon: "browser",
                    action: ()=>{
                        setUrlPasteTarget("_self");
                        showSuccess("URL target set to same tab");
                    }
                }, {
                    id: "url-open-target-blank",
                    label: "URL target: New window/tab",
                    icon: "app-window",
                    action: ()=>{
                        setUrlPasteTarget("_blank");
                        showSuccess("URL target set to new window/tab");
                    }
                }, {
                    id: "change-wallpaper",
                    label: "Change wallpaper",
                    icon: "image",
                    action: pickWallpaper
                    }, {
                        id: "rotate-wallpaper-left",
                        label: "Rotate wallpaper left",
                        icon: "arrow-counter-clockwise",
                        action: ()=>rotateWallpaperBy(-90)
                    }, {
                        id: "rotate-wallpaper-right",
                        label: "Rotate wallpaper right",
                        icon: "arrow-clockwise",
                        action: ()=>rotateWallpaperBy(90)
                    }, {
                        id: "reset-wallpaper-rotation",
                        label: "Reset wallpaper rotation",
                        icon: "scan-smiley",
                        action: ()=>{
                            (wallpaperState as any).rotate = 0;
                            persistWallpaper();
                        }
                    }],
                [{
                    id: "layout-compact",
                    label: "Compact icon grid",
                    icon: "squares-four",
                    action: ()=>{
                        gridLayoutState.columns = 6;
                        gridLayoutState.rows = 10;
                        persistGridLayout();
                    }
                }, {
                    id: "layout-comfy",
                    label: "Comfort icon grid",
                    icon: "grid-four",
                    action: ()=>{
                        gridLayoutState.columns = 4;
                        gridLayoutState.rows = 8;
                        persistGridLayout();
                    }
                }],
                [{ id: "open-explorer", label: "Explorer", icon: "books", action: ()=>{
                    actionRegistry.get(`open-view-explorer`)?.({ id: "", items, meta, viewMaker }, {})
                } },
                { id: "open-settings", label: "Settings", icon: "gear-six", action: ()=>{
                    actionRegistry.get(`open-view-settings`)?.({ id: "", items, meta, viewMaker }, {})
                } }]
                /*NAVIGATION_SHORTCUTS.map((shortcut)=>({
                    id: `open-${shortcut.view}`,
                    label: `Open ${shortcut.label}`,
                    icon: shortcut.icon,
                    action: ()=>{
                        actionRegistry.get(`open-view-${shortcut.view}`)?.({ id: "", items, meta, shortcut, viewMaker }, {})
                    }
                }))*/
            ];
            return emptySections;
        }
    };

    const ctxMenu = H`<ul class="grid-rows round-decor ctx-menu ux-anchor"></ul>`;
    const overlayRoot = getOverlayRoot();
    if (overlayRoot) {
        overlayRoot.appendChild(ctxMenu as unknown as Node);
    }
    const triggerEl =
        document.querySelector<HTMLElement>("#home") ??
        ((Q("#home") as any)?.element as HTMLElement | undefined) ??
        document.body;
    ctxMenuTrigger(triggerEl, ctxMenuDesc as any, ctxMenu);
    return ctxMenu;
}

import { convertOrientPxToCX, cvt_cs_to_os } from "fest/core";
import { orientOf } from "fest/dom";
import { requestOpenView } from "../shared/view-api";
import type { ViewId } from "../shells/types";

type DesktopItem = {
    id: string;
    label: string;
    icon: string;
    viewId: ViewId;
    cell: [number, number];
};

type DesktopState = {
    columns: number;
    rows: number;
    items: DesktopItem[];
};

const STORAGE_KEY = "cw-oriented-desktop-layout-v1";
const DRAG_THRESHOLD_PX = 8;
const SUPPRESS_CLICK_MS = 280;

const DEFAULT_STATE: DesktopState = {
    columns: 6,
    rows: 8,
    items: [
        { id: "home", label: "Home", icon: "house", viewId: "home", cell: [0, 0] },
        { id: "viewer", label: "Viewer", icon: "article", viewId: "viewer", cell: [0, 1] },
        { id: "explorer", label: "Explorer", icon: "books", viewId: "explorer", cell: [0, 2] },
        { id: "settings", label: "Settings", icon: "gear-six", viewId: "settings", cell: [0, 3] },
        { id: "airpad", label: "AirPad", icon: "paper-plane-tilt", viewId: "airpad", cell: [1, 0] }
    ]
};

const clampCell = (cell: [number, number], columns: number, rows: number): [number, number] => {
    return [
        Math.max(0, Math.min(columns - 1, Math.round(cell[0]))),
        Math.max(0, Math.min(rows - 1, Math.round(cell[1])))
    ];
};

const readState = (): DesktopState => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULT_STATE, items: [...DEFAULT_STATE.items] };
        const parsed = JSON.parse(raw) as Partial<DesktopState> | null;
        const columns = Math.max(4, Math.min(8, Number(parsed?.columns || DEFAULT_STATE.columns)));
        const rows = Math.max(6, Math.min(12, Number(parsed?.rows || DEFAULT_STATE.rows)));
        const items = (parsed?.items || DEFAULT_STATE.items)
            .map((item: any) => ({
                id: String(item?.id || ""),
                label: String(item?.label || "Item"),
                icon: String(item?.icon || "sparkle"),
                viewId: String(item?.viewId || "home") as ViewId,
                cell: clampCell(
                    [Number(item?.cell?.[0] || 0), Number(item?.cell?.[1] || 0)],
                    columns,
                    rows
                )
            }))
            .filter((item: DesktopItem) => item.id);
        return { columns, rows, items };
    } catch {
        return { ...DEFAULT_STATE, items: [...DEFAULT_STATE.items] };
    }
};

const persistState = (state: DesktopState): void => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        // ignore quota/storage errors
    }
};

const applyCellVars = (node: HTMLElement, cell: [number, number]): void => {
    node.style.setProperty("--cell-x", String(cell[0]));
    node.style.setProperty("--cell-y", String(cell[1]));
    node.style.setProperty("--p-cell-x", String(cell[0]));
    node.style.setProperty("--p-cell-y", String(cell[1]));
};

const resolveCellAtPointer = (
    grid: HTMLElement,
    columns: number,
    rows: number,
    clientX: number,
    clientY: number
): [number, number] => {
    const rect = grid.getBoundingClientRect();
    const orient = orientOf(grid) || 0;
    const local: [number, number] = [
        clientX - (rect.left || 0),
        clientY - (rect.top || 0)
    ];
    const orientedPoint = cvt_cs_to_os(local, [rect.width || 1, rect.height || 1], orient);
    const projected = convertOrientPxToCX(
        orientedPoint,
        {
            layout: [columns, rows],
            size: [rect.width || 1, rect.height || 1],
            item: {} as any,
            list: [],
            items: new Map()
        },
        orient
    );
    return clampCell([projected[0], projected[1]], columns, rows);
};

const makeIconItem = (item: DesktopItem): HTMLElement => {
    const el = document.createElement("div");
    el.className = "ui-ws-item";
    el.dataset.desktopId = item.id;
    el.dataset.layer = "icons";
    el.setAttribute("draggable", "false");
    applyCellVars(el, item.cell);
    el.innerHTML = `
        <div data-shape="square" class="ui-ws-item-icon shaped">
            <ui-icon icon="${item.icon}"></ui-icon>
        </div>
    `;
    return el;
};

const makeLabelItem = (item: DesktopItem): HTMLElement => {
    const el = document.createElement("div");
    el.className = "ui-ws-item";
    el.dataset.desktopId = item.id;
    el.dataset.layer = "labels";
    applyCellVars(el, item.cell);
    el.innerHTML = `
        <div class="ui-ws-item-label">
            <span>${item.label}</span>
        </div>
    `;
    return el;
};

export const initializeOrientedDesktop = (host: HTMLElement): void => {
    if (!host || host.dataset.desktopMounted === "true") return;
    host.dataset.desktopMounted = "true";

    const state = readState();
    const itemById = new Map(state.items.map((item) => [item.id, item] as const));

    const desktopRoot = document.createElement("div");
    desktopRoot.className = "speed-dial-root app-oriented-desktop";
    desktopRoot.style.position = "absolute";
    desktopRoot.style.inset = "0";
    desktopRoot.style.pointerEvents = "auto";
    desktopRoot.style.background = "transparent";

    const labelsGrid = document.createElement("div");
    labelsGrid.className = "speed-dial-grid app-oriented-desktop__grid app-oriented-desktop__grid--labels";
    labelsGrid.setAttribute("data-mixin", "ui-gridbox");
    labelsGrid.dataset.gridColumns = String(state.columns);
    labelsGrid.dataset.gridRows = String(state.rows);
    labelsGrid.style.pointerEvents = "none";

    const iconsGrid = document.createElement("div");
    iconsGrid.className = "speed-dial-grid app-oriented-desktop__grid app-oriented-desktop__grid--icons";
    iconsGrid.setAttribute("data-mixin", "ui-gridbox");
    iconsGrid.dataset.gridColumns = String(state.columns);
    iconsGrid.dataset.gridRows = String(state.rows);
    iconsGrid.style.pointerEvents = "none";

    desktopRoot.append(labelsGrid, iconsGrid);
    host.appendChild(desktopRoot);

    let suppressClickUntil = 0;
    const iconNodeById = new Map<string, HTMLElement>();
    const labelNodeById = new Map<string, HTMLElement>();

    const placeItem = (itemId: string, cell: [number, number]): void => {
        const iconNode = iconNodeById.get(itemId);
        const labelNode = labelNodeById.get(itemId);
        if (iconNode) applyCellVars(iconNode, cell);
        if (labelNode) applyCellVars(labelNode, cell);
        const src = itemById.get(itemId);
        if (src) src.cell = cell;
    };

    for (const item of state.items) {
        const iconNode = makeIconItem(item);
        const labelNode = makeLabelItem(item);
        iconNodeById.set(item.id, iconNode);
        labelNodeById.set(item.id, labelNode);
        iconsGrid.appendChild(iconNode);
        labelsGrid.appendChild(labelNode);

        const iconShape = iconNode.querySelector(".ui-ws-item-icon") as HTMLElement | null;
        if (!iconShape) continue;
        iconShape.style.pointerEvents = "auto";
        iconShape.style.touchAction = "none";

        iconShape.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (performance.now() < suppressClickUntil) return;
            requestOpenView({ viewId: item.viewId, target: "window" });
        });

        iconShape.addEventListener("pointerdown", (downEvent: PointerEvent) => {
            const iconLayerNode = iconNodeById.get(item.id);
            const labelLayerNode = labelNodeById.get(item.id);
            if (!iconLayerNode || !labelLayerNode) return;

            const startX = downEvent.clientX;
            const startY = downEvent.clientY;
            let moved = false;
            let raf = 0;

            const setDragTransform = (dx: number, dy: number) => {
                iconLayerNode.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
                labelLayerNode.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
            };

            const pointerId = downEvent.pointerId;
            iconShape.setPointerCapture(pointerId);
            iconLayerNode.dataset.dragging = "true";
            labelLayerNode.dataset.dragging = "true";

            const onMove = (moveEvent: PointerEvent) => {
                const dx = moveEvent.clientX - startX;
                const dy = moveEvent.clientY - startY;
                if (!moved && Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
                    moved = true;
                }
                if (!moved) return;
                moveEvent.preventDefault();
                if (raf) cancelAnimationFrame(raf);
                raf = requestAnimationFrame(() => setDragTransform(dx, dy));
            };

            const onEnd = (endEvent: PointerEvent) => {
                if (raf) cancelAnimationFrame(raf);
                iconShape.releasePointerCapture(pointerId);
                iconShape.removeEventListener("pointermove", onMove);
                iconShape.removeEventListener("pointerup", onEnd);
                iconShape.removeEventListener("pointercancel", onEnd);

                if (moved) {
                    const nextCell = resolveCellAtPointer(
                        iconsGrid,
                        state.columns,
                        state.rows,
                        endEvent.clientX,
                        endEvent.clientY
                    );
                    placeItem(item.id, nextCell);
                    persistState(state);
                    suppressClickUntil = performance.now() + SUPPRESS_CLICK_MS;
                }

                iconLayerNode.style.transition = "transform 180ms ease-out";
                labelLayerNode.style.transition = "transform 180ms ease-out";
                iconLayerNode.style.transform = "translate3d(0, 0, 0)";
                labelLayerNode.style.transform = "translate3d(0, 0, 0)";
                globalThis.setTimeout(() => {
                    iconLayerNode.style.removeProperty("transition");
                    labelLayerNode.style.removeProperty("transition");
                    iconLayerNode.removeAttribute("data-dragging");
                    labelLayerNode.removeAttribute("data-dragging");
                }, 200);
            };

            iconShape.addEventListener("pointermove", onMove);
            iconShape.addEventListener("pointerup", onEnd);
            iconShape.addEventListener("pointercancel", onEnd);
        });
    }
};


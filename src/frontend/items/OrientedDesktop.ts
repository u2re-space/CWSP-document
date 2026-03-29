import { bindInteraction } from "fest/lure";
import { requestOpenView } from "../shared/view-api";
import type { ViewId } from "../shells/types";
import { openUnifiedContextMenu, closeUnifiedContextMenu, type ContextMenuEntry } from "./ContextMenu";
import { setAppWallpaper } from "./Canvas";

type DesktopAction = "open-view" | "open-link";

type DesktopItem = {
    id: string;
    label: string;
    icon: string;
    iconSrc?: string;
    viewId: ViewId;
    cell: [number, number];
    action?: DesktopAction;
    href?: string;
};

type DesktopState = {
    columns: number;
    rows: number;
    items: DesktopItem[];
};

const STORAGE_KEY = "cw-oriented-desktop-layout-v1";
const SUPPRESS_CLICK_MS = 280;
const ITEM_ENVELOPE_KIND = "cw-speed-dial-item";
const REGISTRY_ENVELOPE_KIND = "cw-speed-dial-registry";
const URL_PATTERN = /(https?:\/\/[^\s<>"']+)/i;

const DEFAULT_STATE: DesktopState = {
    columns: 6,
    rows: 8,
    items: [
        { id: "viewer", label: "Viewer", icon: "article", viewId: "viewer", cell: [0, 0], action: "open-view" },
        { id: "explorer", label: "Explorer", icon: "books", viewId: "explorer", cell: [0, 1], action: "open-view" },
        { id: "settings", label: "Settings", icon: "gear-six", viewId: "settings", cell: [0, 2], action: "open-view" },
        { id: "airpad", label: "AirPad", icon: "paper-plane-tilt", viewId: "airpad", cell: [1, 0], action: "open-view" }
    ]
};

const protectedIds = new Set(DEFAULT_STATE.items.map((item) => item.id));
const createDesktopItemId = (prefix = "item"): string => {
    return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 10000)}`;
};

const clampCell = (cell: [number, number], columns: number, rows: number): [number, number] => {
    return [
        Math.max(0, Math.min(columns - 1, Math.round(cell[0]))),
        Math.max(0, Math.min(rows - 1, Math.round(cell[1])))
    ];
};

const cellKey = (cell: [number, number]): string => `${cell[0]}:${cell[1]}`;

const findNearestFreeCell = (
    preferred: [number, number],
    occupied: Set<string>,
    columns: number,
    rows: number
): [number, number] => {
    const start = clampCell(preferred, columns, rows);
    if (!occupied.has(cellKey(start))) return start;
    const maxRadius = Math.max(columns, rows);
    for (let radius = 1; radius <= maxRadius; radius += 1) {
        for (let y = Math.max(0, start[1] - radius); y <= Math.min(rows - 1, start[1] + radius); y += 1) {
            for (let x = Math.max(0, start[0] - radius); x <= Math.min(columns - 1, start[0] + radius); x += 1) {
                const edge = Math.abs(x - start[0]) === radius || Math.abs(y - start[1]) === radius;
                if (!edge) continue;
                const candidate: [number, number] = [x, y];
                if (!occupied.has(cellKey(candidate))) return candidate;
            }
        }
    }
    return start;
};

const enforceUniqueCells = (items: DesktopItem[], columns: number, rows: number): DesktopItem[] => {
    const occupied = new Set<string>();
    for (const item of items) {
        const nextCell = findNearestFreeCell(item.cell, occupied, columns, rows);
        item.cell = nextCell;
        occupied.add(cellKey(nextCell));
    }
    return items;
};

const normalizeItem = (raw: any, columns: number, rows: number): DesktopItem | null => {
    const id = String(raw?.id || "").trim();
    if (!id) return null;
    if (id === "home") return null;
    const action = String(raw?.action || (raw?.href ? "open-link" : "open-view"));
    const item: DesktopItem = {
        id,
        label: String(raw?.label || "Item"),
        icon: String(raw?.icon || (action === "open-link" ? "link" : "sparkle")),
        iconSrc: raw?.iconSrc ? String(raw.iconSrc) : "",
        viewId: String(raw?.viewId || "home") as ViewId,
        cell: clampCell([Number(raw?.cell?.[0] || 0), Number(raw?.cell?.[1] || 0)], columns, rows),
        action: action === "open-link" ? "open-link" : "open-view",
        href: raw?.href ? String(raw.href) : ""
    };
    if (item.action === "open-link") {
        item.viewId = "home";
    }
    return item;
};

const readState = (): DesktopState => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULT_STATE, items: [...DEFAULT_STATE.items] };
        const parsed = JSON.parse(raw) as Partial<DesktopState> | null;
        const columns = Math.max(4, Math.min(8, Number(parsed?.columns || DEFAULT_STATE.columns)));
        const rows = Math.max(6, Math.min(12, Number(parsed?.rows || DEFAULT_STATE.rows)));
        const fallbackItems = [...DEFAULT_STATE.items];
        const sourceItems = Array.isArray(parsed?.items) && parsed?.items.length ? parsed.items : fallbackItems;
        const items = enforceUniqueCells(sourceItems
            .map((item) => normalizeItem(item, columns, rows))
            .filter((item): item is DesktopItem => Boolean(item)), columns, rows);
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

const readImageFileFromClipboard = (event: ClipboardEvent): File | null => {
    const items = Array.from(event.clipboardData?.items || []);
    for (const item of items) {
        if (item.type?.startsWith("image/")) {
            const file = item.getAsFile();
            if (file) return file;
        }
    }
    return null;
};

const pickDroppedImageFile = (event: DragEvent): File | null => {
    const files = Array.from(event.dataTransfer?.files || []);
    return files.find((file) => file.type?.startsWith("image/")) || null;
};

const readAsDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("Failed to read image"));
        reader.readAsDataURL(file);
    });
};

const applyWallpaperFromFile = async (file: File): Promise<boolean> => {
    if (!file?.type?.startsWith("image/")) return false;
    const dataUrl = await readAsDataUrl(file);
    if (!dataUrl) return false;
    setAppWallpaper(dataUrl);
    return true;
};

const faviconForUrl = (url: URL): string => {
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.hostname)}&sz=128`;
};

const parseUrlFromText = (text: string): URL | null => {
    const value = String(text || "").trim();
    if (!value) return null;
    const direct = (() => {
        try {
            return new URL(value);
        } catch {
            return null;
        }
    })();
    if (direct && /^https?:$/i.test(direct.protocol)) return direct;
    const match = value.match(URL_PATTERN);
    if (!match?.[1]) return null;
    try {
        const parsed = new URL(match[1]);
        if (!/^https?:$/i.test(parsed.protocol)) return null;
        return parsed;
    } catch {
        return null;
    }
};

const parseUrlFromHtml = (html: string): URL | null => {
    const content = String(html || "").trim();
    if (!content) return null;
    try {
        const doc = new DOMParser().parseFromString(content, "text/html");
        const href = doc.querySelector("a[href]")?.getAttribute("href") || "";
        if (!href) return null;
        const parsed = new URL(href, window.location.href);
        if (!/^https?:$/i.test(parsed.protocol)) return null;
        return parsed;
    } catch {
        return null;
    }
};

const createLinkItem = (url: URL, cell: [number, number], labelHint = ""): DesktopItem => {
    const label = String(labelHint || "").trim() || url.hostname.replace(/^www\./, "") || "Link";
    return {
        id: createDesktopItemId("link"),
        label,
        icon: "link",
        iconSrc: faviconForUrl(url),
        viewId: "home",
        cell,
        action: "open-link",
        href: url.href
    };
};

const parseUrlItemFromText = (text: string, cell: [number, number]): DesktopItem | null => {
    const parsed = parseUrlFromText(text);
    if (!parsed) return null;
    return createLinkItem(parsed, cell);
};

const normalizeImportedItems = (
    payload: unknown,
    columns: number,
    rows: number,
    preferredCell: [number, number]
): DesktopItem[] => {
    if (!payload) return [];
    const base = payload as any;
    const sourceList = Array.isArray(base?.items)
        ? base.items
        : Array.isArray(payload)
            ? payload
            : base?.item
                ? [base.item]
                : [payload];
    const normalized = sourceList
        .map((raw, index) => normalizeItem({
            ...(raw || {}),
            id: String(raw?.id || createDesktopItemId("import")),
            cell: raw?.cell ?? [preferredCell[0], preferredCell[1] + index]
        }, columns, rows))
        .filter((item): item is DesktopItem => Boolean(item));
    return normalized;
};

const parseItemsFromTextPayload = (
    textPlain: string,
    textHtml: string,
    columns: number,
    rows: number,
    preferredCell: [number, number]
): DesktopItem[] => {
    const plain = String(textPlain || "").trim();
    const html = String(textHtml || "").trim();
    if (plain.startsWith("{") || plain.startsWith("[")) {
        try {
            const parsed = JSON.parse(plain) as any;
            if (parsed?.kind === ITEM_ENVELOPE_KIND || parsed?.kind === REGISTRY_ENVELOPE_KIND || parsed?.items || parsed?.item || Array.isArray(parsed)) {
                return normalizeImportedItems(parsed, columns, rows, preferredCell);
            }
        } catch {
            // ignore parse errors and continue with URL heuristics
        }
    }
    const htmlUrl = parseUrlFromHtml(html);
    if (htmlUrl) {
        const labelHint = (() => {
            try {
                const doc = new DOMParser().parseFromString(html, "text/html");
                const text = doc.querySelector("a[href]")?.textContent || "";
                return String(text || "").trim();
            } catch {
                return "";
            }
        })();
        return [createLinkItem(htmlUrl, preferredCell, labelHint)];
    }
    const plainItem = parseUrlItemFromText(plain, preferredCell);
    return plainItem ? [plainItem] : [];
};

const serializeItemEnvelope = (item: DesktopItem): string => {
    return JSON.stringify({
        kind: ITEM_ENVELOPE_KIND,
        version: 1,
        item
    }, null, 2);
};

const serializeRegistryEnvelope = (state: DesktopState): string => {
    return JSON.stringify({
        kind: REGISTRY_ENVELOPE_KIND,
        version: 1,
        columns: state.columns,
        rows: state.rows,
        items: state.items
    }, null, 2);
};

const downloadJson = (filename: string, content: string): void => {
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const openDesktopItem = (item: DesktopItem): void => {
    if (item.action === "open-link") {
        if (!item.href) return;
        window.open(item.href, "_blank", "noopener,noreferrer");
        return;
    }
    requestOpenView({
        viewId: item.viewId,
        target: "window",
        params: {
            source: "home",
            itemId: item.id
        }
    });
};

export const initializeOrientedDesktop = (host: HTMLElement): void => {
    if (!host || host.dataset.desktopMounted === "true") return;
    host.dataset.desktopMounted = "true";

    const state = readState();
    const itemById = new Map(state.items.map((item) => [item.id, item] as const));
    const itemIdList = state.items.map((item) => item.id);

    const desktopRoot = document.createElement("div");
    desktopRoot.className = "speed-dial-root app-oriented-desktop";
    desktopRoot.style.position = "absolute";
    desktopRoot.style.inset = "0";
    desktopRoot.style.pointerEvents = "auto";
    desktopRoot.style.background = "transparent";
    desktopRoot.tabIndex = 0;

    const labelsGrid = document.createElement("div");
    labelsGrid.className = "speed-dial-grid app-oriented-desktop__grid app-oriented-desktop__grid--labels";
    labelsGrid.setAttribute("data-mixin", "ui-gridbox");
    labelsGrid.dataset.gridColumns = String(state.columns);
    labelsGrid.dataset.gridRows = String(state.rows);
    labelsGrid.style.background = "transparent";
    labelsGrid.style.pointerEvents = "none";
    labelsGrid.style.zIndex = "1";

    const iconsGrid = document.createElement("div");
    iconsGrid.className = "speed-dial-grid app-oriented-desktop__grid app-oriented-desktop__grid--icons";
    iconsGrid.setAttribute("data-mixin", "ui-gridbox");
    iconsGrid.dataset.gridColumns = String(state.columns);
    iconsGrid.dataset.gridRows = String(state.rows);
    iconsGrid.style.background = "transparent";
    iconsGrid.style.pointerEvents = "none";
    iconsGrid.style.zIndex = "2";

    desktopRoot.append(labelsGrid, iconsGrid);
    host.appendChild(desktopRoot);

    let suppressClickUntil = 0;
    const iconNodeById = new Map<string, HTMLElement>();
    const labelNodeById = new Map<string, HTMLElement>();
    const escapeHtml = (value: string): string => String(value || "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;"
    }[char] || char));
    const occupiedSet = (exceptId = ""): Set<string> => {
        const occupied = new Set<string>();
        for (const entry of state.items) {
            if (exceptId && entry.id === exceptId) continue;
            occupied.add(cellKey(entry.cell));
        }
        return occupied;
    };
    const applyItemCell = (item: DesktopItem, cell: [number, number]): void => {
        item.cell = clampCell(cell, state.columns, state.rows);
        const iconNode = iconNodeById.get(item.id);
        const labelNode = labelNodeById.get(item.id);
        if (iconNode) applyCellVars(iconNode, item.cell);
        if (labelNode) applyCellVars(labelNode, item.cell);
    };
    const placeItemIntoFreeCell = (item: DesktopItem, preferred: [number, number], exceptId = ""): [number, number] => {
        const target = findNearestFreeCell(preferred, occupiedSet(exceptId), state.columns, state.rows);
        applyItemCell(item, target);
        return target;
    };
    const addItems = (items: DesktopItem[], preferredCell: [number, number]): number => {
        let added = 0;
        for (let index = 0; index < items.length; index += 1) {
            const incoming = items[index];
            if (!incoming) continue;
            const item = normalizeItem({
                ...incoming,
                id: incoming.id || createDesktopItemId("item"),
                cell: incoming.cell || [preferredCell[0], preferredCell[1] + index]
            }, state.columns, state.rows);
            if (!item || itemById.has(item.id)) continue;
            item.cell = findNearestFreeCell(item.cell, occupiedSet(), state.columns, state.rows);
            state.items.push(item);
            itemById.set(item.id, item);
            itemIdList.push(item.id);
            mountDesktopItem(item);
            added += 1;
        }
        if (added > 0) persistState(state);
        return added;
    };
    const guessCellFromPoint = (x: number, y: number): [number, number] => {
        const rect = iconsGrid.getBoundingClientRect();
        const localX = Math.max(0, Math.min(rect.width, x - rect.left));
        const localY = Math.max(0, Math.min(rect.height, y - rect.top));
        const cellX = Math.floor(localX / Math.max(1, rect.width / state.columns));
        const cellY = Math.floor(localY / Math.max(1, rect.height / state.rows));
        return clampCell([cellX, cellY], state.columns, state.rows);
    };
    const importFromClipboard = async (cell: [number, number]): Promise<boolean> => {
        try {
            if (navigator.clipboard?.read) {
                const records = await navigator.clipboard.read();
                for (const record of records) {
                    if (record.types.includes("image/png") || record.types.includes("image/jpeg") || record.types.includes("image/webp")) {
                        const imageType = record.types.find((type) => type.startsWith("image/"));
                        if (!imageType) continue;
                        const blob = await record.getType(imageType);
                        const file = new File([blob], "wallpaper", { type: blob.type });
                        const applied = await applyWallpaperFromFile(file);
                        if (applied) return true;
                    }
                    const plainType = record.types.includes("text/plain") ? "text/plain" : "";
                    const htmlType = record.types.includes("text/html") ? "text/html" : "";
                    const plain = plainType ? await (await record.getType(plainType)).text() : "";
                    const html = htmlType ? await (await record.getType(htmlType)).text() : "";
                    const imported = parseItemsFromTextPayload(plain, html, state.columns, state.rows, cell);
                    if (imported.length) {
                        return addItems(imported, cell) > 0;
                    }
                }
            }
            const text = await navigator.clipboard.readText();
            const imported = parseItemsFromTextPayload(text, "", state.columns, state.rows, cell);
            return addItems(imported, cell) > 0;
        } catch {
            return false;
        }
    };

    const makeIconItem = (item: DesktopItem): HTMLElement => {
        const el = document.createElement("div");
        el.className = "ui-ws-item";
        el.dataset.desktopId = item.id;
        el.dataset.layer = "icons";
        el.setAttribute("draggable", "false");
        applyCellVars(el, item.cell);
        const icon = document.createElement("div");
        icon.className = "ui-ws-item-icon shaped";
        icon.dataset.shape = "square";
        if (item.iconSrc) {
            const image = document.createElement("img");
            image.className = "ui-ws-item-icon-image";
            image.alt = "";
            image.loading = "lazy";
            image.decoding = "async";
            image.referrerPolicy = "no-referrer";
            image.src = item.iconSrc;
            image.addEventListener("error", () => image.remove());
            icon.appendChild(image);
        }
        const iconElement = document.createElement("ui-icon");
        iconElement.setAttribute("icon", item.icon || "sparkle");
        icon.appendChild(iconElement);
        el.appendChild(icon);
        return el;
    };

    const makeLabelItem = (item: DesktopItem): HTMLElement => {
        const el = document.createElement("div");
        el.className = "ui-ws-item";
        el.dataset.desktopId = item.id;
        el.dataset.layer = "labels";
        el.style.pointerEvents = "none";
        el.style.background = "transparent";
        applyCellVars(el, item.cell);
        el.innerHTML = `<div class="ui-ws-item-label"><span>${escapeHtml(item.label)}</span></div>`;
        return el;
    };

    const removeDesktopItem = (itemId: string): void => {
        const index = state.items.findIndex((item) => item.id === itemId);
        if (index === -1) return;
        state.items.splice(index, 1);
        itemById.delete(itemId);

        const listIndex = itemIdList.indexOf(itemId);
        if (listIndex >= 0) itemIdList.splice(listIndex, 1);

        iconNodeById.get(itemId)?.remove();
        labelNodeById.get(itemId)?.remove();
        iconNodeById.delete(itemId);
        labelNodeById.delete(itemId);

        enforceUniqueCells(state.items, state.columns, state.rows);
        persistState(state);
    };

    const mountDesktopItem = (item: DesktopItem): void => {
        const iconNode = makeIconItem(item);
        const labelNode = makeLabelItem(item);
        iconNodeById.set(item.id, iconNode);
        labelNodeById.set(item.id, labelNode);
        iconsGrid.appendChild(iconNode);
        labelsGrid.appendChild(labelNode);

        const iconShape = iconNode.querySelector(".ui-ws-item-icon") as HTMLElement | null;
        if (!iconShape) return;

        iconShape.style.pointerEvents = "auto";
        iconShape.style.touchAction = "none";

        bindInteraction(iconNode, {
            layout: [state.columns, state.rows],
            items: itemById,
            list: itemIdList,
            item,
            immediateDragStyles: true
        });

        iconNode.addEventListener("m-dragstart", () => {
            closeUnifiedContextMenu();
            iconNode.dataset.dragging = "true";
            const labelNode = labelNodeById.get(item.id);
            if (labelNode) {
                labelNode.dataset.dragging = "true";
                applyCellVars(labelNode, item.cell);
            }
        });

        iconNode.addEventListener("m-dragging", () => {
            const labelNode = labelNodeById.get(item.id);
            if (labelNode) {
                labelNode.style.setProperty("--drag-x", iconNode.style.getPropertyValue("--drag-x") || "0");
                labelNode.style.setProperty("--drag-y", iconNode.style.getPropertyValue("--drag-y") || "0");
            }
        });

        iconNode.addEventListener("m-dragend", () => {
            suppressClickUntil = performance.now() + SUPPRESS_CLICK_MS;
        });

        iconNode.addEventListener("m-dragsettled", () => {
            const labelNode = labelNodeById.get(item.id);
            if (labelNode) {
                labelNode.removeAttribute("data-dragging");
                labelNode.style.setProperty("--drag-x", "0");
                labelNode.style.setProperty("--drag-y", "0");
                applyCellVars(labelNode, item.cell);
            }
            placeItemIntoFreeCell(item, item.cell, item.id);
            persistState(state);
        });

        iconShape.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (performance.now() < suppressClickUntil) return;
            openDesktopItem(item);
        });
    };

    const createLinkShortcutFromClipboard = async (cell: [number, number]): Promise<boolean> => {
        return importFromClipboard(cell);
    };

    const openDesktopMenu = (event: MouseEvent, item: DesktopItem | null, cellHint: [number, number]): void => {
        const entries: ContextMenuEntry[] = item
            ? [
                {
                    id: "open",
                    label: "Open",
                    icon: item.action === "open-link" ? "arrow-square-out" : "play",
                    action: () => openDesktopItem(item)
                },
                {
                    id: "item-actions",
                    label: "Actions",
                    icon: "dots-three",
                    action: () => {},
                    children: [
                        ...(item.action === "open-link" && item.href ? [{
                            id: "copy-link",
                            label: "Copy link",
                            icon: "link",
                            action: async () => {
                                try {
                                    await navigator.clipboard.writeText(item.href || "");
                                } catch {
                                    // ignore
                                }
                            }
                        }, {
                            id: "open-link-new-window",
                            label: "Open link in new tab",
                            icon: "arrow-square-out",
                            action: () => {
                                if (item.href) {
                                    window.open(item.href, "_blank", "noopener,noreferrer");
                                }
                            }
                        }] : []),
                        {
                            id: "copy-item-json",
                            label: "Copy item JSON",
                            icon: "clipboard-text",
                            action: async () => {
                                try {
                                    await navigator.clipboard.writeText(serializeItemEnvelope(item));
                                } catch {
                                    // ignore
                                }
                            }
                        },
                        {
                            id: "remove",
                            label: "Remove",
                            icon: "trash",
                            danger: true,
                            disabled: protectedIds.has(item.id),
                            action: () => removeDesktopItem(item.id)
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
                            id: "paste-link",
                            label: "Paste from clipboard",
                            icon: "clipboard",
                            action: async () => {
                                const created = await createLinkShortcutFromClipboard(cellHint);
                                if (!created) {
                                    requestOpenView({ viewId: "explorer", target: "window", params: { source: "home" } });
                                }
                            }
                        }
                    ]
                },
                {
                    id: "registry",
                    label: "Registry",
                    icon: "database",
                    action: () => {},
                    children: [
                        {
                            id: "copy-registry-json",
                            label: "Copy registry JSON",
                            icon: "clipboard-text",
                            action: async () => {
                                try {
                                    await navigator.clipboard.writeText(serializeRegistryEnvelope(state));
                                } catch {
                                    // ignore
                                }
                            }
                        },
                        {
                            id: "export-registry-json",
                            label: "Export registry",
                            icon: "download-simple",
                            action: () => {
                                const date = new Date();
                                const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
                                downloadJson(`cw-home-registry-${stamp}.json`, serializeRegistryEnvelope(state));
                            }
                        },
                        {
                            id: "import-registry-json",
                            label: "Import from clipboard",
                            icon: "upload-simple",
                            action: async () => {
                                await importFromClipboard(cellHint);
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
                        {
                            id: "open-explorer",
                            label: "Explorer",
                            icon: "books",
                            action: () => requestOpenView({ viewId: "explorer", target: "window", params: { source: "home" } })
                        },
                        {
                            id: "open-settings",
                            label: "Settings",
                            icon: "gear-six",
                            action: () => requestOpenView({ viewId: "settings", target: "window", params: { source: "home" } })
                        }
                    ]
                },
                {
                    id: "wallpaper",
                    label: "Wallpaper",
                    icon: "image",
                    action: () => {},
                    children: [
                        {
                            id: "change-wallpaper",
                            label: "Choose image",
                            icon: "image",
                            action: async () => {
                                const input = document.createElement("input");
                                input.type = "file";
                                input.accept = "image/*";
                                input.onchange = async () => {
                                    const file = input.files?.[0];
                                    if (!file) return;
                                    await applyWallpaperFromFile(file);
                                };
                                input.click();
                            }
                        }
                    ]
                }
            ];

        openUnifiedContextMenu({
            x: event.clientX,
            y: event.clientY,
            items: entries,
            compact: true
        });
    };

    const handlePaste = async (event: ClipboardEvent): Promise<void> => {
        const image = readImageFileFromClipboard(event);
        if (image) {
            event.preventDefault();
            event.stopPropagation();
            await applyWallpaperFromFile(image);
            return;
        }

        const plain = event.clipboardData?.getData("text/plain") || "";
        const html = event.clipboardData?.getData("text/html") || "";
        const items = parseItemsFromTextPayload(plain, html, state.columns, state.rows, [0, 0]);
        if (!items.length) return;

        event.preventDefault();
        event.stopPropagation();
        addItems(items, [0, 0]);
    };

    desktopRoot.addEventListener("pointerdown", () => desktopRoot.focus());
    desktopRoot.addEventListener("dragover", (event) => {
        event.preventDefault();
    });
    desktopRoot.addEventListener("drop", async (event) => {
        const file = pickDroppedImageFile(event);
        if (file) {
            event.preventDefault();
            event.stopPropagation();
            await applyWallpaperFromFile(file);
            return;
        }
        const plain = event.dataTransfer?.getData("text/plain") || "";
        const html = event.dataTransfer?.getData("text/html") || "";
        const uriList = event.dataTransfer?.getData("text/uri-list") || "";
        const merged = [uriList, plain].filter(Boolean).join("\n").trim();
        let items = parseItemsFromTextPayload(merged, html, state.columns, state.rows, [0, 0]);
        if (!items.length) {
            const droppedTextFile = Array.from(event.dataTransfer?.files || [])
                .find((entry) => entry.type === "text/plain" || entry.type === "text/html");
            if (droppedTextFile) {
                const payload = await droppedTextFile.text();
                items = parseItemsFromTextPayload(payload, droppedTextFile.type === "text/html" ? payload : "", state.columns, state.rows, [0, 0]);
            }
        }
        if (!items.length) return;
        event.preventDefault();
        event.stopPropagation();
        addItems(items, [0, 0]);
    });
    desktopRoot.addEventListener("paste", (event) => {
        void handlePaste(event);
    });

    desktopRoot.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        const target = event.target as HTMLElement | null;
        const itemNode = target?.closest?.(".ui-ws-item[data-desktop-id]") as HTMLElement | null;
        const itemId = itemNode?.dataset.desktopId || "";
        const item = itemId ? itemById.get(itemId) || null : null;
        openDesktopMenu(event, item, guessCellFromPoint(event.clientX, event.clientY));
    });

    for (const item of state.items) {
        mountDesktopItem(item);
    }
};

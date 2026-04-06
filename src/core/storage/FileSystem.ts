import { BASE64_PREFIX, convertImageToJPEG, DEFAULT_ENTITY_TYPE, MAX_BASE64_SIZE } from "@rs-core/workers/ImageProcess";
import { dumpAndClear } from "@rs-com/store/IDBQueue";
import { detectEntityTypeByJSON } from "@rs-com/template/EntityUtils";
import { fixEntityId } from "@rs-com/template/EntityId";
import { TIMELINE_DIR } from "@rs-core/constants/data-paths";
import { opfsModifyJson } from "./OPFSMod";
import { writeFileSmart } from "./WriteFileSmart-v2";
import { JSOX } from "jsox";
import { canParseURL } from "@rs-core/utils/Runtime";

/** Dynamic-only: static `fest/lure` pulls `com-app` into the MV3 service worker graph. */
type LureFs = Pick<
    typeof import("fest/lure"),
    "getDirectoryHandle" | "getFileHandle" | "decodeBase64ToBytes" | "stringToFile" | "parseDataUrl"
>;
let lureFsPromise: Promise<LureFs> | null = null;
const getLureFs = (): Promise<LureFs> => {
    if (!lureFsPromise) {
        lureFsPromise = import("fest/lure").then((m) => ({
            getDirectoryHandle: m.getDirectoryHandle,
            getFileHandle: m.getFileHandle,
            decodeBase64ToBytes: m.decodeBase64ToBytes,
            stringToFile: m.stringToFile,
            parseDataUrl: m.parseDataUrl,
        }));
    }
    return lureFsPromise;
};

const notifyFsToast = async (kind: "success" | "error", message: string) => {
    try {
        const mod = await import(new URL("../../frontend/shared/items/overlay/Toast.ts", import.meta.url).href);
        (kind === "success" ? mod.showSuccess : mod.showError)(message);
    } catch {
        try {
            if (typeof globalThis !== "undefined" && Notification?.permission === "granted") {
                new Notification(message);
            } else {
                console[kind === "success" ? "log" : "warn"](message);
            }
        } catch {
            console[kind === "success" ? "log" : "warn"](message);
        }
    }
};

//
/*
// Always writes by full sanitized path. Accepts a directory or a full path.
export const writeFileSmart = async (
    root: any | null,
    dirOrPath: string,
    file: File | Blob,
    options: WriteSmartOptions = {}
) => {
    const { forceExt, ensureJson, toLower = true, sanitize = true } = options;

    // Determine desired base name and directory
    let raw = String(dirOrPath || "").trim();
    const isDirHint = raw.endsWith('/');
    const hasFileToken = !isDirHint && splitPath(raw).length > 0 && raw.includes('.');

    let dirPath = isDirHint ? raw : (hasFileToken ? raw.split('/').slice(0, -1).join('/') : raw);
    let desiredName = hasFileToken ? raw.split('/').pop() || '' : (file as any)?.name || '';

    // Fallbacks
    dirPath = dirPath || '/';
    desiredName = desiredName || (Date.now() + '');

    // Extract name/ext
    const lastDot = desiredName.lastIndexOf('.');
    let base = lastDot > 0 ? desiredName.slice(0, lastDot) : desiredName;
    let ext = (forceExt || (ensureJson ? 'json' : (lastDot > 0 ? desiredName.slice(lastDot + 1) : inferExtFromMime((file as any)?.type || '')))) || '';

    if (sanitize) {
        dirPath = sanitizePathSegments(dirPath);
        base = toSlug(base, toLower);
    }

    const finalName = ext ? `${base}.${ext}` : base;
    const fullPath = ensureDir(dirPath) + finalName;

    // Ensure File object with correct name
    let toWrite: File;
    if (file instanceof File) {
        // If name matches and type present, keep; else recreate with corrected name
        if (file.name === finalName) {
            toWrite = file;
        } else {
            const type = (file as any).type || (ext ? `application/${ext}` : 'application/octet-stream');
            const buf = await file.arrayBuffer();
            toWrite = new File([buf], finalName, { type });
        }
    } else {
        const type = (file as any).type || (ext ? `application/${ext}` : 'application/octet-stream');
        const blob = file as Blob;
        toWrite = new File([await blob.arrayBuffer()], finalName, { type });
    }

    //
    const promised = writeFile(root, fullPath, toWrite);
    if (typeof document !== "undefined")
        document?.dispatchEvent?.(new CustomEvent("rs-fs-changed", { detail: await promised?.catch?.(console.warn.bind(console)), bubbles: true, composed: true, cancelable: true, }));
    return promised;
};*/

//
export const writeFilesToDir = async (dir: string, files: File[] | FileList) => {
    const items = Array.from(files as any as File[]);
    for (const file of items) {
        dir = dir?.trim?.();
        dir = dir?.endsWith?.('/') ? dir : (dir + '/');
        await writeFileSmart(null, dir, file);
    }
    return items.length;
}

//
export const getMarkDownFromFile = async (handle: any) => {
    const markdown = await handle?.getFile?.();
    return await markdown?.text?.() || "";
}

//
export const getJSONFromFile = async (handle: any) => {
    if (Array.isArray(handle)) handle = handle?.[0];
    if (!handle) return null;
    const json = await handle?.getFile?.();
    return parseJsonSafely(await json?.text?.() || "{}");
}

//
export const hasCriteriaInText = async (text: string, criteria: string[]) => {
    return criteria?.some?.(async (criterion) => text?.includes?.(criterion));
}

//
export const readJSONs = async (dir: any | null) => {
    const { getDirectoryHandle } = await getLureFs();
    const dirHandle = typeof dir === "string" ? await getDirectoryHandle(null, dir) : dir;
    const factors = await Array.fromAsync(dirHandle?.entries?.() ?? []);
    return Promise.all(factors?.map?.((factor) => getJSONFromFile(factor)));
};

//
export const readJSONsFiltered = async (dir: any | null, filterFiles?: string[] | null) => {
    const { getDirectoryHandle } = await getLureFs();
    const dirHandle = typeof dir === "string" ? await getDirectoryHandle(null, dir) : dir;
    const factors = await Array.fromAsync(dirHandle?.entries?.() ?? []);
    return Promise.all(factors?.map?.((factor) => getJSONFromFile(factor)));
};

//
export const readMarkDownsFiltered = async (dir: any | null, filterFiles?: string[] | null) => {
    const { getDirectoryHandle } = await getLureFs();
    const dirHandle = typeof dir === "string" ? await getDirectoryHandle(null, dir) : dir;
    const preferences = await Array.fromAsync(dirHandle?.entries?.() ?? []);
    return Promise.all(preferences?.map?.(async (preferences) => (await getMarkDownFromFile(preferences)))
        ?.filter?.(async (fileData) => (!filterFiles || await hasCriteriaInText(await fileData, filterFiles))));
}

//
export const readMarkDowns = async (dir: any | null) => {
    const { getDirectoryHandle } = await getLureFs();
    const dirHandle = typeof dir === "string" ? await getDirectoryHandle(null, dir) : dir;
    const preferences = await Array.fromAsync(dirHandle?.entries?.() ?? []);
    return Promise.all(preferences?.map?.((preference) => getMarkDownFromFile(preference?.[1])));
}

//
export const readOneMarkDown = async (path: string) => {
    const { getFileHandle } = await getLureFs();
    const markdown = await getFileHandle(null, path);
    if (!markdown) return "";
    if (markdown?.type?.startsWith?.("image/")) return "";
    return await markdown?.text?.();
}

//
export const suitableDirsByEntityTypes = (entityTypes: string[]) => {
    return entityTypes?.map?.((entityType) => {
        return (entityType == "timeline" || entityType == "task") ? "/timeline/" : `/data/${entityType}/`;
    });
}

//
export const writeJSON = async (data: any | any[], dir: any | null = null) => {
    if (!data) return;
    const writeOne = async (obj: any, index = 0) => {
        if (!obj) return;
        obj = parseJsonSafely(obj);
        if (!obj) return;

        // if entity type is not registered, trying to detect it
        const entityType = obj?.type ?? detectEntityTypeByJSON(obj) ?? "unknown";

        // if directory is not provided, using default directory
        if (!dir) dir = suitableDirsByEntityTypes([entityType])?.[0]; dir = dir?.trim?.();
        let fileName = (fixEntityId(obj) || obj?.name || `${Date.now()}`)?.toString?.()?.toLowerCase?.()?.replace?.(/\s+/g, '-')?.replace?.(/[^a-z0-9_\-+#&]/g, '-');
        fileName = fileName?.trim?.(); fileName = fileName?.endsWith?.(".json") ? fileName : (fileName + ".json");
        return writeFileSmart(null, `${dir}${fileName}`, new File([JSOX.stringify(obj as any) as string], fileName, { type: 'application/json' }))?.catch?.(console.warn.bind(console));
    };

    //
    let results: any = await (Array.isArray(data) ? Promise.all(data.map((item, index) => writeOne(item, index))) : writeOne(data, 0))?.catch?.(console.warn.bind(console));
    if (typeof document !== "undefined")
        document?.dispatchEvent?.(new CustomEvent("rs-fs-changed", { detail: results, bubbles: true, composed: true, cancelable: true, }));
    return results;
}

//
export const writeMarkDown = async (data: any, path: any | null = null) => {
    if (!data) return; path = path?.trim?.();
    let filename = (`${Date.now()}`?.toString?.()?.toLowerCase?.()?.replace?.(/\s+/g, '-')?.replace?.(/[^a-z0-9_\-+#&]/g, '-')?.trim?.() || `${Date.now()}`) + ".md";

    //
    if (!path) { path = "/docs/preferences/"; } else { filename = path?.split?.('/')?.pop?.() || filename; }
    filename = filename?.endsWith?.(".md") ? filename : (filename + ".md");

    //
    let results: any = await writeFileSmart(null, path, data instanceof File ? data : new File([data], filename, { type: 'text/markdown' }))?.catch?.(console.warn.bind(console));
    if (typeof document !== "undefined")
        document?.dispatchEvent?.(new CustomEvent("rs-fs-changed", { detail: results, bubbles: true, composed: true, cancelable: true, }));
    return results;
}

//
export interface shareTargetFormData {
    text?: string;
    url?: string;
    file?: File | Blob;
}

//
export const handleDataByType = async (item: File | string | Blob, handler: (payload: shareTargetFormData) => Promise<void>) => {
    if (typeof item === 'string') {
        if (item?.startsWith?.("data:image/") && item?.includes?.(";base64,")) {
            const { parseDataUrl, stringToFile } = await getLureFs();
            const parts = parseDataUrl(item);
            const mimeType = parts?.mimeType || "image/png";
            const file = await stringToFile(item, "clipboard-image", { mimeType, uriComponent: true });
            return handler({ url: item, file } as any);
        } else
            if (canParseURL(item)) { return handler({ url: item } as any); }
    } else
        if (item instanceof File || item instanceof Blob) {
            return handler({ file: item } as any);
        }
}

//
export const handleDataTransferFiles = async (files: (File | Blob)[] | FileList, handler: (payload: shareTargetFormData) => Promise<void>) => {
    // @ts-ignore
    for (const file of files) {
        handleDataByType(file, handler);
    }
}

//
export const handleDataTransferItemList = async (items: DataTransferItemList, handler: (payload: shareTargetFormData) => Promise<void>) => {
    // @ts-ignore
    for (const item of items) {
        handleDataByType(item as any, handler);
    }
}

//
export const handleClipboardItems = async (items: ClipboardItem[], handler: (payload: shareTargetFormData) => Promise<void>) => {
    for (const item of items) {
        for (const type of item?.types ?? []) {
            if (type.startsWith('text/')) {
                const text = await (await item?.getType?.(type))?.text?.();
                return handleDataByType(text, handler);
            }
            if (type.startsWith('image/')) {
                const blob = await item?.getType?.(type);
                return handleDataByType(blob, handler);
            }
        }
    }
}

//
export const handleDataTransferInputEvent = (dataTransfer: DataTransfer | null, handler: (payload: shareTargetFormData) => Promise<void>) => {
    const items = dataTransfer?.items;
    const files = dataTransfer?.files ?? [];

    if (items) {
        handleDataTransferItemList(items, handler);
    }

    if (files && (files?.length > 0)) {
        handleDataTransferFiles(files, handler);
    }
}

//
const parseJsonSafely = (text: string | null | undefined | any) => {
    if (!text) return null;
    if (typeof text != "string") { return text; };
    try {
        return JSOX.parse(text) as any; } catch (_) { try { return JSON.parse(text) as any; } catch (_) { console.warn("Failed to parse JSON", text); return text; } }
}

// one of handler
export const postCommitAnalyze = async (payload: shareTargetFormData, API_ENDPOINT = '/commit-analyze') => {
    const fd = new FormData();
    if (payload.text) fd.append('text', payload.text);
    if (payload.url) fd.append('url', payload.url);
    if (payload.file) fd.append('files', payload.file as any, (payload.file as any)?.name || 'pasted');

    //
    const resp = await fetch(API_ENDPOINT, { method: 'POST', priority: 'auto', keepalive: true, body: fd })?.catch?.(console.warn.bind(console)); if (!resp) return [];
    const json = parseJsonSafely(await resp?.text?.()?.catch?.(console.warn.bind(console)) || "{}"); if (!json) return [];
    return json?.results?.map?.((res) => res?.data)?.filter?.((data) => (!!data?.trim?.()));
};

//
export const postCommitRecognize = (targetDir: string = "/docs/preferences/") => {
    return async (payload: shareTargetFormData, API_ENDPOINT = '/commit-recognize') => {
        const fd = new FormData();
        if (payload.text) fd.append('text', payload.text);
        if (payload.url) fd.append('url', payload.url);
        if (payload.file) fd.append('files', payload.file as any, (payload.file as any)?.name || 'pasted');
        fd.append('targetDir', targetDir);

        //
        const resp = await fetch(API_ENDPOINT, { method: 'POST', priority: 'auto', keepalive: true, body: fd })?.catch?.(console.warn.bind(console));
        if (!resp) return [];
        const json = parseJsonSafely(await resp?.text?.()?.catch?.(console.warn.bind(console)) || "{}");
        if (!json) return [];
        return json?.results?.filter?.((data) => (!!data?.data?.trim?.()))?.map?.((res) => res?.data);
    }
}

//
export type IntakeOptions = {
    entityType?: string;
    beforeSend?: (payload: shareTargetFormData) => Promise<shareTargetFormData> | shareTargetFormData;
};

//
export const normalizePayload = async (payload: shareTargetFormData): Promise<shareTargetFormData> => {
    if (payload.file instanceof File || payload.file instanceof Blob) {
        if (payload.file instanceof File && payload.file.size > MAX_BASE64_SIZE && payload.file.type.startsWith("image/")) {
            return { ...payload, file: await convertImageToJPEG(payload.file) };
        }
        return payload;
    }

    const text = payload.text || payload.url;
    if (typeof text === "string") {
        const match = text.match(BASE64_PREFIX);
        if (match && match.groups) {
            const { mime, data } = match.groups;
            const byteLen = Math.ceil((data.length * 3) / 4);
            if (byteLen > MAX_BASE64_SIZE) {
                const { decodeBase64ToBytes } = await getLureFs();
                const bytes = decodeBase64ToBytes(data, { alphabet: "base64", lastChunkHandling: "loose" });
                const blob = new Blob([bytes as unknown as ArrayBuffer], { type: mime });
                const converted = await convertImageToJPEG(blob);
                return { file: converted };
            }
        }
    }

    return payload;
};

//
const writeTextDependsByPossibleType = async (payload: string | null | undefined, entityType: string) => {
    if (!payload) return;
    if (canParseURL(payload || "")) payload = (await fetch(payload).then(res => res.text())?.catch?.(console.warn.bind(console))) || "";
    if (!payload) return;

    //
    let json = {} as any;
    json = parseJsonSafely(payload || "{}");
    if (!json) return;

    //
    try {
        if (!entityType) entityType = detectEntityTypeByJSON(json);
        return writeJSON(json, (entityType == 'task' || entityType == 'timeline') ? '/timeline/' : `data/${entityType}/`);
    } catch (e) {
        return writeMarkDown(payload, `docs/${entityType}/`);
    }
}

//
export const sendToEntityPipeline = async (payload: shareTargetFormData, options: IntakeOptions = {}) => {
    const entityType = options.entityType || DEFAULT_ENTITY_TYPE;
    const normalized = await normalizePayload(payload);
    const next = options.beforeSend ? await options.beforeSend(normalized) : normalized;
    if (!next.file && (next.text || next.url)) return writeTextDependsByPossibleType(next.text || next.url, entityType);
    return handleDataTransferFiles(next.file ? [next.file] : [], postCommitAnalyze);
};

//
export const loadTimelineSources = async (dir: string = "/docs/preferences") => {
    try {
        const { getDirectoryHandle } = await getLureFs();
        const root = await getDirectoryHandle(null, dir)?.catch(() => null);
        if (!root) return [] as string[];
        const entries = await Array.fromAsync(root.entries?.() ?? []);
        return entries
            .map((entry: any) => entry?.[0])
            .filter((name: string) => typeof name === "string" && name.trim().length)
            .map((name: string) => name.replace(/\.md$/i, ""));
    } catch (e) {
        console.warn(e);
        return [];
    }
};

//
export const extractRecognizedData = (unknownData: any) => {
    // potentially JSON string
    try { unknownData = typeof unknownData == "string" ? JSON.parse(unknownData?.trim?.() || "[]") : unknownData; } catch (e) {}
    if (unknownData?.recognized_data) { return extractRecognizedData(unknownData?.recognized_data); };

    //
    if (typeof unknownData == "string" && unknownData?.trim?.()) {
        return unknownData?.trim?.();
    } else
    if (Array.isArray(unknownData) && unknownData?.length) {
        return unknownData?.map?.((item: any) => extractRecognizedData(item))?.filter?.((item: any) => (item && typeof item === "string"))?.join?.("\n") || "";
    }
    return "";
}

//
export const controlChannel = new BroadcastChannel('rs-sw');
controlChannel.addEventListener('message', (event: MessageEvent) => {
    const payload = event?.data as any;
    if (!payload || (payload?.type !== 'commit-result' && payload?.type !== 'commit-to-clipboard')) return;
    if (payload?.type === 'commit-result') {
        flushQueueIntoOPFS?.()?.then?.(() => {
            void notifyFsToast("success", "Data has been saved to the filesystem.");
        })?.catch?.((e) => {
            console.warn("Failed to save data to filesystem.", e, payload);
            void notifyFsToast("error", "Failed to save data to filesystem.");
        });
    } else
        if (payload?.type === 'commit-to-clipboard') {
            const data = payload?.results
                ?.map?.((result: any) => extractRecognizedData(result?.data?.recognized_data || result?.data))
                ?.filter?.((result: any) => (result && typeof result === "string"))?.join?.("\n") || "";
            if (data?.trim?.()) {
                navigator?.clipboard?.writeText?.(data)?.then?.(() => {
                    void notifyFsToast("success", "Data has been copied to clipboard.");
                })?.catch?.((e) => {
                    console.warn("Failed to copy data to clipboard.", e, data);
                    void notifyFsToast("error", "Failed to copy data to clipboard. Data is not copied.");
                });
            } else
                { void notifyFsToast("error", "Failed to copy data to clipboard. Data is empty."); }
        }
});

// Try recover from previous session
if (typeof navigator !== "undefined" && 'storage' in navigator && typeof navigator.storage.getDirectory === 'function') {
    if (typeof requestIdleCallback === 'function') {
        requestIdleCallback?.(() => {
            flushQueueIntoOPFS();
        });
    } else {
        setTimeout(() => {
            flushQueueIntoOPFS();
        }, 1000);
    }
}

//
export async function flushQueueIntoOPFS() {
    const results = await dumpAndClear();
    return Promise.all(results.map((result) => {
        const { data, name, dataType, directory } = result as any;
        if (dataType === "json") {
            let jsonData = parseJsonSafely(data);
            if (!jsonData) return;
            return writeJSON(jsonData, directory?.trim?.());
        } else {
            return writeMarkDown(data, directory?.trim?.() + name?.trim?.());
        }
    }));
}

//
try {
    opfsModifyJson({
    dirPath: "/data/",
    transform: (data) => {
        if (data && typeof data === "object") { fixEntityId(data, { mutate: true }); };
        return data;
    }
    })?.catch?.(console.warn.bind(console));
} catch (e) {
    console.warn(e);
}

//
try {
    opfsModifyJson({
        dirPath: "/timeline/",
        transform: (data) => {
            if (data && typeof data === "object") { fixEntityId(data, { mutate: true }); };
            return data;
        }
    })?.catch?.(console.warn.bind(console));
} catch (e) {
    console.warn(e);
}



//
export const writeTimelineTask = async (task: any) => {
    const name = task?.id || task?.name || task?.desc?.name || `${Date.now()}`;

    //
    let fileName = name || "timeline.json"
    fileName = fileName?.endsWith?.(".json") ? fileName : (fileName + ".json");

    //
    const filePath = `${TIMELINE_DIR}${fileName}`;
    const file = new File([JSOX.stringify(task as any) as string], fileName, { type: 'application/json' });
    return writeFileSmart(null, filePath, file)?.catch?.(console.error.bind(console));
}

//
export const writeTimelineTasks = async (tasks: any[]) => {
    return Promise.all(tasks?.map?.(async (task) => writeTimelineTask(task)) || []);
}

//
export const loadAllTimelines = async (DIR: string = TIMELINE_DIR) => {
    const { getDirectoryHandle } = await getLureFs();
    const dirHandle = await getDirectoryHandle(null, DIR)?.catch?.(console.warn.bind(console));
    const timelines = await Array.fromAsync(dirHandle?.entries?.() ?? []);
    return (await Promise.all(timelines?.map?.(async ([name, fileHandle]: any) => {
        if (name?.endsWith?.(".crswap")) return;
        if (!name?.trim?.()?.endsWith?.(".json")) return;

        //
        const file = await fileHandle.getFile();
        let item = null
        item = parseJsonSafely(await file?.text?.() || "{}");
        if (!item) return;
        (item as any).__name = name;
        (item as any).__path = `${DIR}${name}`;
        return item;
    })))?.filter?.((e) => e);
}

/**
 * UI-facing filesystem operations.
 *
 * These helpers connect browser picker/clipboard/drop interactions with the
 * higher-level storage and recognition pipelines so views do not have to know
 * about OPFS handles or import-heavy recognition modules directly.
 */
import { getDirectoryHandle, handleIncomingEntries } from "fest/lure";
import { handleDataTransferFiles, postCommitAnalyze, postCommitRecognize, writeFilesToDir } from "core/storage/FileSystem";
import { sanitizeFileName, writeFileSmart } from "core/storage/WriteFileSmart-v2";
type AnalyzeRecognizeUnified = typeof import("com/service/service/RecognizeData").analyzeRecognizeUnified;
let analyzeRecognizeUnifiedRef: AnalyzeRecognizeUnified | null = null;
const getAnalyzeRecognizeUnified = async (): Promise<AnalyzeRecognizeUnified> => {
    if (!analyzeRecognizeUnifiedRef) {
        const m = await import("com/service/service/RecognizeData");
        analyzeRecognizeUnifiedRef = m.analyzeRecognizeUnified;
    }
    return analyzeRecognizeUnifiedRef;
};

let clipboardRw: Pick<typeof import("core/modules/Clipboard"), "readText" | "writeText"> | null = null;
const getClipboardRw = async () => {
    if (!clipboardRw) {
        const m = await import("core/modules/Clipboard");
        clipboardRw = { readText: m.readText, writeText: m.writeText };
    }
    return clipboardRw;
};

/** Bind drag-and-drop ingestion for a directory target and emit a local `dir-dropped` event on success. */
export const bindDropToDir = (host: HTMLElement, dir: string) => {
    const onDragOver = (ev: DragEvent) => {
        ev.preventDefault();
        (host as any).dataset.dragover = 'true';
    };
    const onDragLeave = () => { delete (host as any).dataset.dragover; };
    const onDrop = async (ev: DragEvent) => {
        ev.preventDefault();
        delete (host as any).dataset.dragover;
        try {
            await handleIncomingEntries(ev.dataTransfer, dir);
            const count = (ev.dataTransfer?.items?.length || ev.dataTransfer?.files?.length || 0);
            host.dispatchEvent(new CustomEvent('dir-dropped', { detail: { count }, bubbles: true }));
        } catch (e) { console.warn(e); }
    };
    host.addEventListener('dragover', onDragOver);
    host.addEventListener('dragleave', onDragLeave);
    host.addEventListener('drop', onDrop);
    return () => {
        host.removeEventListener('dragover', onDragOver);
        host.removeEventListener('dragleave', onDragLeave);
        host.removeEventListener('drop', onDrop);
    };
}

/** Open a native file picker and write the selected files into the target directory. */
export const openPickerAndWrite = async (dir: string, accept = "*/*", multiple = true) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    (input as any).multiple = multiple;
    const result = await new Promise<number>((resolve) => {
        input.onchange = async () => {
            dir = dir?.trim?.();
            dir = dir?.endsWith?.('/') ? dir : (dir + '/');
            try { resolve(await writeFilesToDir(dir, input.files || ([] as any))); }
            catch { resolve(0); }
        };
        input.click();
    });
    return result;
}

/** Open a picker and route the selected files into the recognition pipeline. */
export const openPickerAndRecognize = async (dir: string, accept = "*/*", multiple = true) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    (input as any).multiple = multiple;
    const result = await new Promise<void>((resolve) => {
        input.onchange = async () => {
            dir = dir?.trim?.();
            dir = dir?.endsWith?.('/') ? dir : (dir + '/');
            try { resolve(await handleDataTransferFiles(input.files || ([] as any), postCommitRecognize(dir))); }
            catch { resolve(); }
        };
        input.click();
    });
    return result;
}

/** Open a picker and route the selected files into the analyze pipeline. */
export const openPickerAndAnalyze = async (dir: string, accept = "*/*", multiple = true) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    (input as any).multiple = multiple;
    const result = await new Promise<void>((resolve) => {
        input.onchange = async () => {
            dir = dir?.trim?.();
            dir = dir?.endsWith?.('/') ? dir : (dir + '/');
            try { resolve(await handleDataTransferFiles(input.files || ([] as any), postCommitAnalyze)); }
            catch { resolve(); }
        };
        input.click();
    });
    return result;
}

/** Download a file that already exists in OPFS by path. */
export const downloadByPath = async (path: string, suggestedName?: string) => {
    const lastSlash = path.lastIndexOf('/');
    const dir = path.slice(0, Math.max(0, lastSlash + 1));
    const name = suggestedName || path.slice(lastSlash + 1);
    const dirHandle: any = await getDirectoryHandle(null, dir);
    const fileHandle: any = await dirHandle.getFileHandle(name, { create: false });
    const file = await fileHandle.getFile();
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}



/** Try recognition first for non-markdown inputs, then persist the recognized result into the target directory. */
export const writeWithTryRecognize = async (dir: string, file: File) => {
    if (file?.name?.endsWith?.(".md") || file?.type?.includes?.("markdown")) {
        return writeFileSmart(null, dir, file, { sanitize: true });
    }

    //
    const analyzeRecognizeUnified = await getAnalyzeRecognizeUnified();
    const recognized = (await analyzeRecognizeUnified(file)?.catch?.(console.warn.bind(console)))?.data;
    if (recognized) {
        return writeFileSmart(null, dir, new File([recognized], file.name));
    }
}

/** Recognize clipboard content and write the recognized text back to the clipboard. */
export const pasteIntoClipboardWithRecognize = async () => {
    try {
        const analyzeRecognizeUnified = await getAnalyzeRecognizeUnified();
        const { readText, writeText } = await getClipboardRw();
        // clipboard first (read raw items)
        if (typeof navigator !== "undefined" && (navigator.clipboard as any)?.read) {
            const items = await (navigator.clipboard as any).read();
            for (const item of items) {
                for (const type of item.types) {
                    const blob = await item.getType(type);
                    if (blob) {
                        const data = await analyzeRecognizeUnified(blob)?.then?.((res) => res?.data)?.catch?.(console.warn.bind(console));
                        if (data) {
                            const result = await writeText(data);
                            return result.ok;
                        }
                    }
                }
            }
        }

        // text fallback
        const readResult = await readText();
        const text = readResult.ok ? String(readResult.data || "").trim() : "";
        if (text) {
            const data = await analyzeRecognizeUnified(text)?.then?.((res) => res?.data)?.catch?.(console.warn.bind(console));
            if (data) {
                const result = await writeText(data);
                return result.ok;
            }
        }
    } catch (e) { console.warn(e); return false; }
}

//
export const pasteAndAnalyze = async () => {
    try {
        const { readText } = await getClipboardRw();
        // clipboard first (read raw items)
        if (typeof navigator !== "undefined" && (navigator.clipboard as any)?.read) {
            const items = await (navigator.clipboard as any).read();
            for (const item of items) {
                for (const type of item.types) {
                    const blob = await item.getType(type);
                    if (blob) {
                        const data = await postCommitAnalyze({file: blob as any})?.then?.((res) => res?.data)?.catch?.(console.warn.bind(console));
                        if (data) { return true; }
                    }
                }
            }
        }

        // text fallback
        const readResult = await readText();
        const text = readResult.ok ? String(readResult.data || "").trim() : "";
        if (text) {
            const data = await postCommitAnalyze({text})?.then?.((res) => res?.data)?.catch?.(console.warn.bind(console));
            if (data) { return true; }
        }
    } catch (e) { console.warn(e); return false; }
    return false;
}

//
export const pasteIntoDir = async (dir: string) => {
    try {
        const { readText } = await getClipboardRw();
        // Use unified handler for paste
        // We need to get data from clipboard first
        let success = false;
        try {
            // @ts-ignore - clipboard.read() for raw items
            if (typeof navigator !== "undefined" && (navigator.clipboard as any)?.read) {
                const clipboardItems = await (navigator.clipboard as any).read();
                if (clipboardItems && clipboardItems.length > 0) {
                    await handleIncomingEntries(clipboardItems, dir);
                    success = true;
                }
            }
        } catch {}

        if (!success) {
             const readResult = await readText();
             const text = readResult.ok ? String(readResult.data || "") : "";
             if (text) {
                 // Create a simple object that handleIncomingEntries understands for text
                 await handleIncomingEntries({
                     getData: (type: string) => type === "text/plain" ? text : ""
                 }, dir);
                 success = true;
             }
        }
        return success;
    } catch (e) { console.warn(e); }
    return false;
}

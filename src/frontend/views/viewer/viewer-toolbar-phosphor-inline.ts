/**
 * Toolbar Phosphor duotone icons inlined as base64 `data:` URLs for `--view-picon-mask`.
 * Avoids HTTP/CORS/CORP/mask fetch issues (Fastify, static hosts, shadow DOM, offline).
 */
/// <reference types="vite/client" />

import clipboardTextDuotone from "@phosphor-icons/core/assets/duotone/clipboard-text-duotone.svg?raw";
import codeDuotone from "@phosphor-icons/core/assets/duotone/code-duotone.svg?raw";
import copyDuotone from "@phosphor-icons/core/assets/duotone/copy-duotone.svg?raw";
import downloadDuotone from "@phosphor-icons/core/assets/duotone/download-duotone.svg?raw";
import fileDocDuotone from "@phosphor-icons/core/assets/duotone/file-doc-duotone.svg?raw";
import folderOpenDuotone from "@phosphor-icons/core/assets/duotone/folder-open-duotone.svg?raw";
import lightningDuotone from "@phosphor-icons/core/assets/duotone/lightning-duotone.svg?raw";
import paintRollerDuotone from "@phosphor-icons/core/assets/duotone/paint-roller-duotone.svg?raw";
import printerDuotone from "@phosphor-icons/core/assets/duotone/printer-duotone.svg?raw";
import textTDuotone from "@phosphor-icons/core/assets/duotone/text-t-duotone.svg?raw";

const RAW_BY_ICON: Record<string, string> = {
    "clipboard-text": clipboardTextDuotone,
    code: codeDuotone,
    copy: copyDuotone,
    download: downloadDuotone,
    "file-doc": fileDocDuotone,
    "folder-open": folderOpenDuotone,
    lightning: lightningDuotone,
    "paint-roller": paintRollerDuotone,
    printer: printerDuotone,
    "text-t": textTDuotone
};

function svgToBase64CssUrl(svg: string): string {
    let b64: string;
    if (typeof Buffer !== "undefined" && typeof Buffer.from === "function") {
        b64 = Buffer.from(svg, "utf8").toString("base64");
    } else {
        b64 = btoa(unescape(encodeURIComponent(svg)));
    }
    return `url("data:image/svg+xml;base64,${b64}")`;
}

const MASK_URL_BY_ICON: Record<string, string> = Object.fromEntries(
    Object.entries(RAW_BY_ICON).map(([k, raw]) => [k, svgToBase64CssUrl(raw)])
);

/** Full `style` fragment: `--view-picon-mask:url("data:image/svg+xml;base64,...")` */
export function viewerToolbarPiconStyle(iconKebab: string): string {
    const mask = MASK_URL_BY_ICON[iconKebab];
    if (!mask) {
        console.warn(`[ViewerView] missing inline Phosphor for toolbar icon: ${iconKebab}`);
        return `--view-picon-mask:url("data:image/svg+xml;base64,")`;
    }
    return `--view-picon-mask:${mask}`;
}

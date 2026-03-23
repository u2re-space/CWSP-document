/**
 * Rollup chunk → dist/ layout for hot-swappable deploy slices:
 * dist/views, dist/shells, dist/fest, dist/pwa, dist/core/*, dist/com/*, dist/workers/*, dist/vendor, dist/assets.
 *
 * `src/core`, `src/com`, and `fest/lure` (lur.e) are co-located into `com/app.js`
 * to avoid cross-chunk circular init ordering (TDZ: e.g. `makeUIState` / `observe`).
 * Rollup may still warn about circular chunks between slices; the build completes.
 */

/** Merged into consumers / dynamic-only; avoids empty vendor chunks */
const VENDOR_SKIP = new Set([
    "png",
    "jpeg",
    "cbor-x",
    "docx",
    "ico",
    "turndown",
    "temml",
    "mathml-to-latex",
]);

/** modules/projects folder → fest import short name (dist/fest/<name>.js) */
const FEST_DIR_TO_IMPORT = {
    "core.ts": "core",
    "dom.ts": "dom",
    "object.ts": "object",
    "veela.css": "veela",
    "lur.e": "lure",
    "icon.ts": "icon",
    "fl.ui": "fl-ui",
    "uniform.ts": "uniform",
};

const norm = (id) => String(id).split("\\").join("/");

const stripExt = (p) => p.replace(/\.[cm]?[tj]sx?$/i, "");

/** Core and com must stay together for stable init order. */
const CORE_CHUNK_NAME = "com-app";

/**
 * @param {string} rel - path under src/core/ or src/com/ (no leading slash)
 * @param {"core"|"com"} ns
 */
function appSliceChunk(ns, rel) {
    const parts = stripExt(rel).split("/").filter(Boolean);
    if (!parts.length) return undefined;
    if (ns === "core") return CORE_CHUNK_NAME;
    if (parts.length === 1) return `${ns}-main`;
    return `${ns}-${parts[0]}`;
}

/**
 * @param {string} id
 * @returns {string | undefined}
 */
export function manualChunks(id) {
    const p = norm(id);

    if (p.includes("node_modules")) {
        const tail = p.split("node_modules/").pop() || "";
        const parts = tail.split("/");
        const scope = parts[0]?.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
        const skipKey = parts[0]?.startsWith("@") ? parts[1] : parts[0];
        if (!scope || VENDOR_SKIP.has(skipKey)) return undefined;
        const safe = scope.replace(/[^a-zA-Z0-9._@-]/g, "_");
        return `vendor-${safe}`;
    }

    if (p.includes("/src/pwa/")) {
        const rel = p.split("/src/pwa/")[1];
        if (rel) return `pwa-${stripExt(rel).split("/").join("-")}`;
    }

    if (p.includes("/src/core/")) {
        const rel = p.split("/src/core/")[1];
        if (rel) return appSliceChunk("core", rel);
    }
    if (p.includes("/src/com/")) return "com-app";

    const shellSub = p.match(/\/frontend\/shells\/(minimal|base|faint)\//);
    if (shellSub) return `shell-${shellSub[1]}`;

    if (p.includes("/frontend/shells/")) {
        const rel = p.split("/frontend/shells/")[1];
        if (rel) return `shell-${stripExt(rel).split("/").join("-")}`;
    }

    const viewMatch = p.match(/\/frontend\/views\/([^/]+)\//);
    if (viewMatch) {
        const vid = viewMatch[1];
        if (vid === "scss") return undefined;
        return `view-${vid}`;
    }

    const sharedFest = p.match(/\/shared\/fest\/([^/]+)\//);
    if (sharedFest) {
        if (sharedFest[1] === "lure") return "com-app";
        return `fest-${sharedFest[1]}`;
    }

    const proj = p.match(/\/modules\/projects\/([^/]+)\//);
    if (proj) {
        const dir = proj[1];
        if (dir === "lur.e") return "com-app";
        const key = FEST_DIR_TO_IMPORT[dir];
        if (key) return `fest-${key}`;
    }

    return undefined;
}

export function chunkFileNames(chunkInfo) {
    const n = chunkInfo.name || "chunk";

    if (n.startsWith("vendor-")) return `vendor/${n.slice("vendor-".length)}.js`;
    if (n.startsWith("fest-")) return `fest/${n.slice(5)}.js`;
    if (n.startsWith("view-")) return `views/${n.slice(5)}.js`;
    if (n.startsWith("shell-")) return `shells/${n.slice(6)}.js`;
    if (n.startsWith("pwa-")) return `pwa/${n.slice(4)}.js`;
    if (n.startsWith("core-")) return `core/${n.slice(5)}.js`;
    if (n.startsWith("com-")) return `com/${n.slice(4)}.js`;

    const ids = chunkInfo.moduleIds;
    if (ids) {
        for (const id of ids) {
            const tagged = manualChunks(id);
            if (tagged && tagged !== n) {
                return chunkFileNames({ ...chunkInfo, name: tagged });
            }
        }
    }

    return `chunks/${n.replace(/[^a-zA-Z0-9._-]/g, "_")}.js`;
}

/**
 * Vite worker emits often ignore `assetFileNames` heuristics; relocate in generateBundle.
 * @returns {import("vite").Plugin}
 */
export function relocateWorkerBundleAssetsPlugin() {
    return {
        name: "relocate-worker-bundle-assets",
        apply: "build",
        enforce: "post",
        generateBundle(_options, bundle) {
            for (const key of Object.keys(bundle)) {
                const item = bundle[key];
                if (!item || (item.type !== "asset" && item.type !== "chunk")) continue;
                const fn = item.fileName || key;
                if (!/OPFS\.uniform\.worker/i.test(fn)) continue;
                const baseRaw = fn.split("/").pop() || "";
                const base = baseRaw.replace(
                    /(OPFS\.uniform\.worker)-[a-zA-Z0-9_-]+(\.m?js)$/i,
                    "$1$2",
                );
                const next = `workers/opfs/${base}`;
                if (fn === next) continue;
                item.fileName = next;
                bundle[next] = item;
                delete bundle[key];
            }
        },
    };
}

/**
 * @param {string} NAME — app slug for the main emitted CSS file
 */
export function assetFileNames(NAME) {
    return (assetInfo) => {
        const ext = (assetInfo.name || "").split(".").pop()?.toLowerCase() || "";
        if (ext === "css") return `assets/${NAME}[extname]`;
        return "assets/[name][extname]";
    };
}

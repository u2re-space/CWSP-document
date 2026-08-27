/*
 * Filename: vite.config.js
 * FullPath: apps/CWSP-document/vite.config.js
 * Change date and time: 08.40.00_29.07.2026
 * FIND:sku
 * Change date and time: 15.20.00_27.08.2026
 * Reason for changes: Explorer Capacitor HTML must emit as index.html (Rolldown rejects ../web/capacitor).
 */

import { existsSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { loadEnv } from "vite";

import { assetFileNames as distAssetFileNames, chunkFileNames as distChunkFileNames, rewriteVitePreloadPlugin } from "./shared/vite-chunk-placement.mjs";

const importConfig = (url, ...args) => {
    return import(url)?.then?.((m) => m?.default?.(...args));
};

export const NAME = "crossword";
export const __dirname = resolve(import.meta.dirname, "./");

const baseConfig = await importConfig(
    resolve(__dirname, "./shared/vite.config.js"),
    NAME,
    JSON.parse(await readFile(resolve(__dirname, "./tsconfig.json"), { encoding: "utf8" })),
    __dirname
);

const ALL_VIEW_IDS = ["viewer", "editor", "workcenter", "explorer", "settings", "history", "home", "print", "airpad", "network"];
/** Document PWA: print/read/edit only. Explorer + Work Center live on sibling hosts. */
const DOCUMENT_VIEWS = ["viewer", "editor", "print", "settings", "history"];
const DEFAULT_VIEWS_BY_MODE = {
    // VDS md.u2re.space / /markdown/ — markdown workspace (viewer + workcenter tools).
    markdown: DOCUMENT_VIEWS,
    "cw-markdown": DOCUMENT_VIEWS,
    // Regular document PWA (`npm run build` / `dev`) — same document surface, no Network.
    default: DOCUMENT_VIEWS,
};

const parseViewsFromEnv = (rawValue) => {
    if (!rawValue || typeof rawValue !== "string") return null;
    const normalized = rawValue.trim().toLowerCase();
    if (!normalized || normalized === "all" || normalized === "*") {
        return [...ALL_VIEW_IDS];
    }

    const parsed = normalized
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);

    if (!parsed.length) return null;
    const uniqueKnownViews = [...new Set(parsed)].filter((view) => ALL_VIEW_IDS.includes(view));
    return uniqueKnownViews.length ? uniqueKnownViews : null;
};

const resolveEnabledViews = (mode, env) => {
    const defaults =
        mode === "markdown" || mode === "cw-markdown"
            ? DEFAULT_VIEWS_BY_MODE.markdown
            : DEFAULT_VIEWS_BY_MODE.default;
    const explicit = parseViewsFromEnv(env?.VITE_ENABLED_VIEWS);
    const disabled = parseViewsFromEnv(env?.VITE_DISABLED_VIEWS);
    const start = explicit ?? defaults;

    if (!disabled?.length) {
        return [...start];
    }

    const disabledSet = new Set(disabled);
    const filtered = start.filter((view) => !disabledSet.has(view));
    return filtered.length ? filtered : ["viewer"];
};

const toViewDefineEntries = (enabledViews) => {
    const enabledSet = new Set(enabledViews);
    return ALL_VIEW_IDS.reduce((acc, viewId) => {
        const key = `__RS_VIEW_${viewId.toUpperCase()}__`;
        acc[key] = enabledSet.has(viewId);
        return acc;
    }, {});
};

const createViewDefine = (mode) => {
    const env = loadEnv(mode || "production", __dirname, "");
    const enabledViews = resolveEnabledViews(mode, env);
    const defaultView = enabledViews.includes("viewer")
        ? "viewer"
        : enabledViews[0] || "viewer";
    return {
        ...toViewDefineEntries(enabledViews),
        __RS_DEFAULT_VIEW__: JSON.stringify(defaultView),
    };
};

/**
 * VDS host SPA for md.u2re.space and LAN `/markdown/` — real index.html + base "./"
 * (endpoint lib build stays the default `build:pwa` path).
 */
const createMarkdownSpaConfig = async (mode) => {
    const { viteStaticCopy } = await import("vite-plugin-static-copy");
    const { VitePWA } = await import("vite-plugin-pwa");
    const outDir = resolve(__dirname, "./build/cw-markdown");
    const platformRoot = resolve(__dirname, "./src/frontend/web/cw-markdown");

    const isPwaPlugin = (plugin) => {
        const name = plugin?.name;
        return typeof name === "string" && (name === "vite-plugin-pwa" || name.startsWith("vite-plugin-pwa:"));
    };
    const isStaticCopyPlugin = (plugin) => {
        const name = plugin?.name;
        return typeof name === "string" && name.startsWith("vite-plugin-static-copy:");
    };
    const isMcpPlugin = (plugin) => {
        const name = plugin?.name;
        return typeof name === "string" && name.toLowerCase().includes("mcp");
    };

    const basePlugins =
        (baseConfig?.plugins || [])
            .flat?.(Infinity)
            ?.filter?.(
                (plugin) =>
                    plugin?.name !== "vite:singlefile" &&
                    !isPwaPlugin(plugin) &&
                    !isStaticCopyPlugin(plugin) &&
                    !isMcpPlugin(plugin)
            ) ?? [];

    const baseRollup = baseConfig?.build?.rollupOptions ?? {};
    const baseOutput = Array.isArray(baseRollup.output) ? baseRollup.output[0] : (baseRollup.output ?? {});

    return {
        ...baseConfig,
        root: platformRoot,
        base: "./",
        // Keep CrossWord cache + public resolve from the app package.
        cacheDir: resolve(__dirname, "node_modules/.vite-cw-markdown"),
        define: {
            ...(baseConfig?.define ?? {}),
            ...createViewDefine(mode),
            "import.meta.env.VITE_ENABLED_VIEWS": JSON.stringify(
                (DEFAULT_VIEWS_BY_MODE.markdown || []).join(",")
            ),
        },
        plugins: [
            ...basePlugins,
            rewriteVitePreloadPlugin(),
            viteStaticCopy({
                targets: [
                    { src: resolve(__dirname, "./src/pwa/manifest.json"), dest: "pwa" },
                    { src: resolve(__dirname, "./src/pwa/icons/*"), dest: "pwa/icons" },
                    { src: resolve(__dirname, "./src/pwa/screenshots/*"), dest: "pwa/screenshots" },
                    { src: resolve(__dirname, "./assets/wallpaper.jpg"), dest: "assets" },
                    { src: resolve(__dirname, "./assets/stock.jpg"), dest: "assets" },
                ],
            }),
            VitePWA({
                // Absolute sw source — Vite root is nested under frontend/web/cw-markdown.
                srcDir: resolve(__dirname, "./src/pwa"),
                filename: "sw.ts",
                outDir,
                registerType: "autoUpdate",
                strategies: "injectManifest",
                injectRegister: null,
                selfDestroying: false,
                injectManifest: {
                    rollupFormat: "iife",
                    injectionPoint: "self.__WB_MANIFEST",
                    maximumFileSizeToCacheInBytes: 1024 * 1024 * 16,
                    globPatterns: ["**/*.{js,css,html,png,svg,json,jpg,jpeg,webp}"],
                    globIgnores: [
                        "**/node_modules/**/*",
                        "**/*.map",
                        "**/stats.html",
                        "**/report.html",
                        // WHY: unhashed barrels + hashed index desync (`export named 'In'`).
                        "**/com/app.js",
                        "**/com/service.js",
                        "**/fest/*.js",
                        "**/shells/boot-index.js",
                        "**/pwa/screenshots/pwa/**",
                        "**/pwa/icons/pwa/**",
                        "**/pwa/pwa/**"
                    ],
                },
                manifest: false,
                devOptions: { enabled: false },
            }),
        ],
        build: {
            ...(baseConfig?.build ?? {}),
            // CRITICAL: endpoint lib mode must not apply — Fastify apps need index.html SPA.
            lib: false,
            outDir,
            emptyOutDir: true,
            minify: false,
            cssMinify: false,
            terserOptions: undefined,
            cssCodeSplit: false,
            modulePreload: true,
            rollupOptions: {
                ...baseRollup,
                input: resolve(platformRoot, "index.html"),
                output: {
                    ...baseOutput,
                    dir: outDir,
                    entryFileNames: "assets/[name]-[hash].js",
                    chunkFileNames: distChunkFileNames,
                    assetFileNames: distAssetFileNames(NAME),
                },
            },
            rolldownOptions: {
                ...(baseConfig?.build?.rolldownOptions ?? {}),
                input: resolve(platformRoot, "index.html"),
                output: {
                    ...baseOutput,
                    dir: outDir,
                    entryFileNames: "assets/[name]-[hash].js",
                    chunkFileNames: distChunkFileNames,
                    assetFileNames: distAssetFileNames(NAME),
                },
            },
        },
    };
};

const CAPACITOR_SKU_VIEWS = {
    document: ["minimal", "viewer", "editor", "print", "settings", "history"],
    explorer: ["minimal", "explorer", "settings", "history"]
};

const CAPACITOR_SKU_DEFAULT_VIEW = {
    document: "viewer",
    explorer: "explorer"
};

/**
 * Capacitor SKU host — same alias graph as the document PWA, slim views per APK.
 * Explorer output lives in CWSP-explorer; process APK is a separate package.
 */
/** Physical Capacitor HTML — never `src/frontend/web/capacitor` (explorer symlink). */
const resolveCapacitorHtml = (appRoot) => {
    const candidates = [
        resolve(appRoot, "src/frontend/capacitor/index.html"),
        resolve(appRoot, "src/frontend/web/capacitor/index.html")
    ];
    for (const file of candidates) {
        if (!existsSync(file)) continue;
        const htmlFile = realpathSync(file);
        return { htmlFile, platformRoot: dirname(htmlFile) };
    }
    const fallback = resolve(appRoot, "src/frontend/web/capacitor/index.html");
    return { htmlFile: fallback, platformRoot: dirname(fallback) };
};

/**
 * Vite realpaths `config.root` but may keep the HTML module id on a symlink.
 * Then `path.relative(root, id)` is `../web/capacitor/index.html` and Rolldown throws.
 */
const alignCapacitorHtmlPlugin = (htmlFile, platformRoot) => ({
    name: "cwsp-align-capacitor-html",
    enforce: "pre",
    config() {
        return { root: platformRoot };
    },
    configResolved(config) {
        config.build.rollupOptions.input = htmlFile;
        if (config.build.rolldownOptions) config.build.rolldownOptions.input = htmlFile;
        for (const env of Object.values(config.environments || {})) {
            if (env?.build?.rollupOptions) env.build.rollupOptions.input = htmlFile;
        }
    },
    resolveId(id) {
        const clean = String(id || "")
            .split("\0")
            .pop()
            .split("?")[0];
        if (!clean.endsWith(".html")) return null;
        try {
            const abs = clean.startsWith("/") ? clean : resolve(platformRoot, clean);
            if (existsSync(abs) && realpathSync(abs) === htmlFile) return htmlFile;
        } catch {
            /* ignore */
        }
        return null;
    }
});

export const createCapacitorSkuConfig = async (sku = "document") => {
    if (sku === "process") {
        throw new Error("[CWSP-document] Process SKU is apps/CWSP-process — do not emit it from document vite.");
    }
    const workspaceRoot = resolve(__dirname, "../..");
    const siblingName = sku === "explorer" ? "CWSP-explorer" : null;
    const siblingLink = siblingName ? resolve(__dirname, `../${siblingName}`) : null;
    const siblingRoot = siblingLink && existsSync(siblingLink) ? realpathSync(siblingLink) : siblingLink;
    const appRoot = siblingRoot || __dirname;
    const { htmlFile, platformRoot } = resolveCapacitorHtml(appRoot);
    const outDir = resolve(appRoot, "build/capacitor/web");
    const enabledViews = CAPACITOR_SKU_VIEWS[sku] || CAPACITOR_SKU_VIEWS.document;

    const isPwaPlugin = (plugin) => {
        const name = plugin?.name;
        return typeof name === "string" && (name === "vite-plugin-pwa" || name.startsWith("vite-plugin-pwa:"));
    };
    const isStaticCopyPlugin = (plugin) => {
        const name = plugin?.name;
        return typeof name === "string" && name.startsWith("vite-plugin-static-copy:");
    };
    const isMcpPlugin = (plugin) => {
        const name = plugin?.name;
        return typeof name === "string" && name.toLowerCase().includes("mcp");
    };
    const basePlugins =
        (baseConfig?.plugins || [])
            .flat?.(Infinity)
            ?.filter?.(
                (plugin) =>
                    plugin?.name !== "vite:singlefile" &&
                    !isPwaPlugin(plugin) &&
                    !isStaticCopyPlugin(plugin) &&
                    !isMcpPlugin(plugin)
            ) ?? [];
    const baseRollup = baseConfig?.build?.rollupOptions ?? {};
    const baseOutput = Array.isArray(baseRollup.output) ? baseRollup.output[0] : (baseRollup.output ?? {});

    return {
        ...baseConfig,
        root: platformRoot,
        base: "./",
        cacheDir: resolve(__dirname, `node_modules/.vite-capacitor-${sku}`),
        define: {
            ...(baseConfig?.define ?? {}),
            ...toViewDefineEntries(enabledViews),
            __RS_DEFAULT_VIEW__: JSON.stringify(CAPACITOR_SKU_DEFAULT_VIEW[sku] || "viewer"),
            "import.meta.env.VITE_ENABLED_VIEWS": JSON.stringify(enabledViews.join(","))
        },
        plugins: [...basePlugins, rewriteVitePreloadPlugin(), alignCapacitorHtmlPlugin(htmlFile, platformRoot)],
        resolve: {
            ...(baseConfig?.resolve ?? {}),
            alias: [
                ...(Array.isArray(baseConfig?.resolve?.alias) ? baseConfig.resolve.alias : []),
                {
                    find: /^@fest-lib\/lure\/markdown-assets$/,
                    replacement: resolve(workspaceRoot, "modules/projects/lur.e/src/utils/opfs/markdown-assets.ts")
                }
            ]
        },
        build: {
            ...(baseConfig?.build ?? {}),
            lib: false,
            outDir,
            emptyOutDir: true,
            minify: false,
            cssMinify: false,
            modulePreload: true,
            rollupOptions: {
                ...baseRollup,
                input: htmlFile,
                output: {
                    ...baseOutput,
                    dir: outDir,
                    entryFileNames: "assets/[name]-[hash].js",
                    chunkFileNames: distChunkFileNames,
                    assetFileNames: distAssetFileNames(NAME)
                }
            },
            rolldownOptions: {
                ...(baseConfig?.build?.rolldownOptions ?? {}),
                input: htmlFile,
                output: {
                    ...baseOutput,
                    dir: outDir,
                    entryFileNames: "assets/[name]-[hash].js",
                    chunkFileNames: distChunkFileNames,
                    assetFileNames: distAssetFileNames(NAME)
                }
            }
        }
    };
};

export default async ({ mode } = {}) => {
    // WHY: CRX builds moved exclusively to apps/CWSP-crx — refuse leftover --mode crx.
    if (mode === "crx") {
        throw new Error(
            "[CWSP-document] CRX builds live in apps/CWSP-crx (npm run build:crx). This package is PWA/markdown only."
        );
    }
    if (mode === "markdown" || mode === "cw-markdown") {
        return createMarkdownSpaConfig(mode);
    }
    if (mode === "capacitor" || mode === "capacitor-document") {
        return createCapacitorSkuConfig("document");
    }
    if (mode === "capacitor-explorer") {
        return createCapacitorSkuConfig("explorer");
    }
    if (mode === "capacitor-process") {
        throw new Error(
            "[CWSP-document] Process APK builds live in apps/CWSP-process (npm run build:capacitor)."
        );
    }

    const config = {
        ...baseConfig,
        define: {
            ...(baseConfig?.define ?? {}),
            ...createViewDefine(mode),
        },
        build: {
            ...baseConfig.build,
            // Keep PWA/regular build symbols stable (Fastify runtime print route issue).
            minify: false,
            cssMinify: false,
            terserOptions: undefined,
            // NOTE: Fastify imports `/apps/cw/index.js` directly; keep library-style JS output
            // but override the emitted filename from `crossword.js` to `index.js`.
            lib: {
                ...(baseConfig.build?.lib ?? {}),
                entry: resolve(__dirname, "./src/index.ts"),
                fileName: "index",
            },
            rollupOptions: {
                ...baseConfig.build?.rollupOptions,
                input: {
                    index: resolve(__dirname, "./src/index.ts"),
                },
                output: baseConfig.build?.rollupOptions?.output,
            },
        },
    };

    return config;
};

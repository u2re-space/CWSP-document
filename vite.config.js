import { resolve  } from "node:path";
import { readFile } from "node:fs/promises";
import { crx } from "@crxjs/vite-plugin";
import { loadEnv } from "vite";

import { assetFileNames as distAssetFileNames, chunkFileNames as distChunkFileNames } from "./shared/vite-chunk-placement.mjs";

/**
 * CRX MV3 only: keep service-worker-adjacent deps out of `com/app.js`.
 * Otherwise Rolldown merges jsox / `fest/core` / config into the UI chunk and `com/service.js`
 * gains a static `import … from "./app.js"` (customElements in the SW).
 *
 * Use a **non-`com-*`** chunk id so Rolldown does not fold this slice into `com-app`.
 * Many config/service files are hardlinked under `src/frontend/shared/**`; match both trees.
 */
const CRX_SW_SHARED_CHUNK = "crx-sw-shared";

/** Rolldown (Vite 8) uses `output.codeSplitting.groups`; `manualChunks` alone may not isolate chunks. */
const CRX_SW_SHARED_CHUNK_TEST =
    /\/modules\/projects\/core\.ts\/|\/node_modules\/jsox\/|\/node_modules\/@toon-format\/|\/src\/com\/config\/|\/src\/frontend\/shared\/config\/|\/src\/core\/document\/AIResponseParser|\/src\/core\/utils\/Runtime|\/src\/core\/constants\/data-paths|\/src\/core\/storage\/FileSystem|\/src\/(?:com\/template|frontend\/shared\/template)\/Entity(?:Id|Utils)|\/src\/(?:com\/store|frontend\/shared\/store)\/IDBQueue|\/src\/(?:com\/service|frontend\/shared\/service)\/instructions\/(?:core|templates|utils|AIInstructions)|\/src\/(?:com\/service|frontend\/shared\/service)\/model\/GPT-Config/;

const crxRollupOutputChunks = {
    minifyInternalExports: false,
};
const crxRolldownOutputChunks = {
    minifyInternalExports: false,
};

/** Rolldown-only: `manualChunks` alone does not isolate these modules in Vite 8. */
const crxRolldownCodeSplitting = {
    codeSplitting: {
        groups: [
            {
                name: CRX_SW_SHARED_CHUNK,
                test: CRX_SW_SHARED_CHUNK_TEST,
                priority: 100,
            },
        ],
    },
};

const crxChunkFileNames = (chunkInfo) => {
    const n = chunkInfo.name || "";
    if (n === CRX_SW_SHARED_CHUNK || n.startsWith(`${CRX_SW_SHARED_CHUNK}-`)) return "com/sw-lib.js";
    return distChunkFileNames(chunkInfo);
};

//
const importConfig = (url, ...args)=>{ return import(url)?.then?.((m)=>m?.default?.(...args)); }
const objectAssign = (target, ...sources) => {
    if (!sources?.length) return target;
    const source = sources.shift();
    if (source && typeof source === 'object') {
        for (const key in source) {
            if (Object.prototype.hasOwnProperty.call(source, key)) {
                if (source[key] && typeof source[key] === 'object') {
                    if (!target[key] || typeof target[key] !== 'object') {
                        target[key] = Array.isArray(source[key]) ? [] : {};
                    }
                    objectAssign(target[key], source[key]);
                } else {
                    target[key] = source[key];
                }
            }
        }
    }
    return objectAssign(target, ...sources);
}

//
export const NAME = "crossword";
export const __dirname = resolve(import.meta.dirname, "./");
    const baseConfig = await importConfig(
        resolve(__dirname, "./shared/vite.config.js"),
        NAME,
        JSON.parse(await readFile(resolve(__dirname, "./tsconfig.json"), { encoding: "utf8" })),
        __dirname
    );

const manifest = await readFile(resolve(__dirname, "./src/crx/manifest.json"), { encoding: "utf8" }).then(JSON.parse);

const crxRoot = resolve(__dirname, "./src/crx");
const ALL_VIEW_IDS = ["viewer", "editor", "workcenter", "explorer", "airpad", "settings", "history", "home", "print"];
const DEFAULT_VIEWS_BY_MODE = {
    crx: ["viewer", "editor", "settings", "history", "home", "print"],
    default: ALL_VIEW_IDS
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
    const defaults = mode === "crx" ? DEFAULT_VIEWS_BY_MODE.crx : DEFAULT_VIEWS_BY_MODE.default;
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
        : (enabledViews[0] || "viewer");
    return {
        ...toViewDefineEntries(enabledViews),
        __RS_DEFAULT_VIEW__: JSON.stringify(defaultView),
    };
};

// `background` first so Rollup prefers the service-worker graph when placing shared `src/com/*` modules
// (otherwise `view-workcenter` can become the chunk that re-exports com APIs and the SW pulls DOM chunks).
const crxInputs = {
    background: resolve(crxRoot, "./sw.ts"),
    popup: resolve(crxRoot, "./popup/index.html"),
    newtab: resolve(crxRoot, "./newtab/index.html"),
    settings: resolve(crxRoot, "./settings/index.html"),
    "markdown-viewer": resolve(crxRoot, "./markdown/viewer.html"),
    "offscreen-copy": resolve(crxRoot, "./offscreen/copy.html"),
    "offscreen-capture": resolve(crxRoot, "./offscreen/capture.html"),
    content: resolve(crxRoot, "./content/main.ts"),
};

/**
 * Rolldown/Vite alias `{ find: absolutePath }` does not always match `./cache-reactivity` resolutions
 * when `root` is `src/crx`. Force the SW-safe shim so `fest/object` is not merged into `com-app`.
 */
const crxCacheReactivityShimPlugin = (shimPath) => ({
    name: "crx-cache-reactivity-shim",
    enforce: "pre",
    resolveId(id, importer) {
        const clean = String(id).split("?")[0].split("\\").join("/");
        const from = String(importer || "").split("\\").join("/");
        // Relative imports are `./cache-reactivity`, not `.../misc/cache-reactivity.ts`.
        const isBridge =
            clean.endsWith("/misc/cache-reactivity.ts") ||
            clean.endsWith("/misc/cache-reactivity") ||
            clean === "./cache-reactivity" ||
            clean.endsWith("/cache-reactivity.ts") ||
            (clean.includes("cache-reactivity") && from.includes("/service/misc/"));
        if (isBridge) {
            return shimPath;
        }
        return null;
    },
});

/** Forces a single physical module graph for mirrored `src/com/service` ↔ `src/frontend/shared/service`. */
const crxDedupeComServicePlugin = () => ({
    name: "crx-dedupe-com-service",
    enforce: "pre",
    resolveId(id) {
        const s = String(id).split("\\").join("/");
        const needle = "/src/frontend/shared/service/";
        const i = s.indexOf(needle);
        if (i >= 0) {
            return s.slice(0, i) + "/src/com/service/" + s.slice(i + needle.length);
        }
        return null;
    },
});

const createCrxConfig = (mode) => {
    // Diagnostic CRX mode can be enabled explicitly.
    // Production defaults to optimized tree-shaken bundle.
    const env = loadEnv(mode || "crx", __dirname, "");
    const debugCrxBundle = env?.VITE_CRX_DEBUG_BUNDLE === "1";

    const crxPlugin = crx({
        manifest,
        browser: "chrome",
        // Do not inject bundled CSS into arbitrary host pages — it was merging PWA/shell
        // styles (cssCodeSplit: false) and breaking third-party layouts.
        contentScripts: { injectCss: false },
    });
    // CRX build is not a PWA build. Disable PWA-related plugins (PWA + static-copy).
    const isPwaPlugin = (plugin) => {
        const name = plugin?.name;
        return typeof name === "string" && (name === "vite-plugin-pwa" || name.startsWith("vite-plugin-pwa:"));
    };
    const isStaticCopyPlugin = (plugin) => {
        const name = plugin?.name;
        return typeof name === "string" && name.startsWith("vite-plugin-static-copy:");
    };
    const basePlugins = (baseConfig?.plugins || [])
        .flat?.(Infinity)
        ?.filter?.((plugin) => plugin?.name !== "vite:singlefile" && !isPwaPlugin(plugin) && !isStaticCopyPlugin(plugin))
        ?? [];
    const baseRollup = baseConfig?.build?.rollupOptions ?? {};
    const baseOutput = Array.isArray(baseRollup.output) ? baseRollup.output[0] : (baseRollup.output ?? {});

    // Single entry point - client handles all routing
    const entryPoints = {
        choice: resolve(__dirname, './src/choice.ts')
    };

    //
const { manualChunks: _ignoredCrxManualChunks, ...crxOutputBase } = baseOutput;
const crxOutput = objectAssign({}, crxOutputBase, {
        dir: resolve(__dirname, "./dist-crx"),
        entryFileNames: "app/[name].js",
        chunkFileNames: crxChunkFileNames,
        assetFileNames: distAssetFileNames(NAME),
    });

    const comServiceRoot = resolve(__dirname, "src/com/service");
    const cacheReactivityBridge = resolve(__dirname, "src/com/service/misc/cache-reactivity.ts");
    const festObjectCacheShim = resolve(__dirname, "src/crx/shims/fest-object-cache.ts");
    const baseResolve = baseConfig?.resolve ?? {};
    const prevAlias = baseResolve.alias;
    const prevAliasList = Array.isArray(prevAlias) ? prevAlias : prevAlias != null ? [prevAlias] : [];

    // CRX build configuration - avoid conflicts with base config
    return {
        ...baseConfig,
        root: crxRoot,
        base: "./",
        define: {
            ...(baseConfig?.define ?? {}),
            ...createViewDefine(mode)
        },
        resolve: {
            ...baseResolve,
            alias: [
                // `misc/Cache` uses `./cache-reactivity` → real `fest/object` in PWA; stub in CRX so SW
                // does not hoist `observe`/`iterated` next to lure/DOM in `com/app.js`.
                { find: cacheReactivityBridge, replacement: festObjectCacheShim },
                // `src/com/service` mirrors `src/frontend/shared/service`. Treat as one module graph so the
                // service worker does not import duplicated modules via shell/workcenter chunks (DOM in SW).
                { find: "@rs-frontend/shared/service", replacement: comServiceRoot },
                { find: "@shared/service", replacement: comServiceRoot },
                // Relative imports bypass package-style aliases; pin the physical directory too.
                { find: resolve(__dirname, "src/frontend/shared/service"), replacement: comServiceRoot },
                ...prevAliasList,
            ],
        },
        plugins: [crxCacheReactivityShimPlugin(festObjectCacheShim), crxDedupeComServicePlugin(), ...basePlugins, crxPlugin],
        build: {
            ...(baseConfig?.build ?? {}),
            // Per-entry CSS so content scripts do not share one global stylesheet with popup/viewer.
            cssCodeSplit: true,
            cssMinify: "esbuild",
            outDir: resolve(__dirname, "./dist-crx"),
            lib: undefined,
            // Disable modulePreload for CRX - causes broken imports with __vitePreload
            modulePreload: false,
            // Diagnostic mode keeps symbols/sourcemaps for easier debugging.
            minify: debugCrxBundle ? false : (baseConfig?.build?.minify ?? "esbuild"),
            sourcemap: debugCrxBundle,
            terserOptions: undefined,
            ...(debugCrxBundle ? {
                reportCompressedSize: false,
                cssMinify: false,
            } : {}),
            rollupOptions: {
                ...baseRollup,
                ...(debugCrxBundle ? {
                    treeshake: false,
                } : {}),
                input: crxInputs,
                output: {
                    ...crxOutput,
                    ...crxRollupOutputChunks,
                }
            },
            // Vite 8 + Rolldown: chunk placement from `rollupOptions.output` may be ignored; mirror here so
            // `com/service.js` is not forced to static-import `com/app.js` (MV3 SW / customElements).
            rolldownOptions: {
                ...(baseConfig?.build?.rolldownOptions ?? {}),
                ...(debugCrxBundle ? { treeshake: false } : {}),
                input: crxInputs,
                output: {
                    ...crxOutput,
                    ...crxRolldownOutputChunks,
                    ...crxRolldownCodeSplitting,
                },
            },
        },
        esbuild: debugCrxBundle ? {
            target: 'esnext',
            platform: 'chrome',
            keepNames: true,
            minifyIdentifiers: false,
            minifySyntax: false,
            minifyWhitespace: false,
        } : {
            target: 'esnext',
            platform: 'browser',
            keepNames: true,
            minifyIdentifiers: false,
            minifySyntax: false,
            minifyWhitespace: false,
        },
    };
};

export default async ({ mode } = {}) => {
    if (mode === "crx") {
        return createCrxConfig(mode);
    }

    // For regular build, modify base config to use multiple entry points
    const config = {
        ...baseConfig,
        define: {
            ...(baseConfig?.define ?? {}),
            ...createViewDefine(mode)
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
                entry: resolve(__dirname, './src/index.ts'),
                fileName: "index",
            },
            rollupOptions: {
                ...baseConfig.build?.rollupOptions,
                input: {
                    index: resolve(__dirname, './src/index.ts')
                },
                output: baseConfig.build?.rollupOptions?.output,
            }
        }
    };

    return config;
};

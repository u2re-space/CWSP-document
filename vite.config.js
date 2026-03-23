import { resolve  } from "node:path";
import { readFile } from "node:fs/promises";
import { crx } from "@crxjs/vite-plugin";
import { loadEnv } from "vite";

import { assetFileNames as distAssetFileNames, chunkFileNames as distChunkFileNames, manualChunks as distManualChunks } from "./shared/vite-chunk-placement.mjs";

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

const crxInputs = {
    popup: resolve(crxRoot, "./popup/index.html"),
    newtab: resolve(crxRoot, "./newtab/index.html"),
    settings: resolve(crxRoot, "./settings/index.html"),
    "markdown-viewer": resolve(crxRoot, "./markdown/viewer.html"),
    "offscreen-copy": resolve(crxRoot, "./offscreen/copy.html"),
    "offscreen-capture": resolve(crxRoot, "./offscreen/capture.html"),
    content: resolve(crxRoot, "./content/main.ts"),
    background: resolve(crxRoot, "./sw.ts")
};

const createCrxConfig = (mode) => {
    // Diagnostic CRX mode can be enabled explicitly.
    // Production defaults to optimized tree-shaken bundle.
    const env = loadEnv(mode || "crx", __dirname, "");
    const debugCrxBundle = env?.VITE_CRX_DEBUG_BUNDLE === "1";

    const crxPlugin = crx({
        manifest,
        browser: "chrome",
        contentScripts: { injectCss: true },
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
    const crxOutput = objectAssign({}, baseOutput, {
        dir: resolve(__dirname, "./dist-crx"),
        entryFileNames: "app/[name].js",
        chunkFileNames: distChunkFileNames,
        assetFileNames: distAssetFileNames(NAME),
        inlineDynamicImports: false,
    });

    // CRX build configuration - avoid conflicts with base config
    return {
        ...baseConfig,
        root: crxRoot,
        base: "./",
        define: {
            ...(baseConfig?.define ?? {}),
            ...createViewDefine(mode)
        },
        plugins: [...basePlugins, crxPlugin],
        build: {
            ...(baseConfig?.build ?? {}),
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
                    manualChunks: distManualChunks,
                    compact: false,
                    minifyInternalExports: false,
                }
            }
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

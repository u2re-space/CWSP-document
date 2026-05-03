import { existsSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import {
    assetFileNames as distAssetFileNames,
    chunkFileNames as distChunkFileNames,
    manualChunks as distManualChunks,
    relocateWorkerBundleAssetsPlugin,
    rolldownCodeSplittingGroups,
} from "./vite-chunk-placement.mjs";

//
import https from "../private/https/certificate.mjs";
import postcssConfig from "../postcss.config.js";

//
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { VitePWA } from 'vite-plugin-pwa'
import { createLogger, searchForWorkspaceRoot } from "vite";
import { ViteMcp } from 'vite-plugin-mcp'

const viteLogger = createLogger();
const VITE_NOISY_WARNING_PATTERNS = [
    "[INEFFECTIVE_DYNAMIC_IMPORT]",
    "manualChunks option is ignored because the codeSplitting option is specified.",
    "Both `rollupOptions` and `rolldownOptions` were specified by \"crx:content-scripts\" plugin.",
    "`esbuild` option was specified by \"crx:content-scripts\" plugin.",
    "`esbuild` option was specified by \"crx:web-accessible-resources\" plugin.",
    "inlineDynamicImports option is deprecated",
    "`inlineDynamicImports` option is deprecated",
];

const isIgnorableViteWarning = (warning) => {
    const message = String(warning?.message || warning || "");
    return VITE_NOISY_WARNING_PATTERNS.some((pattern) => message.includes(pattern));
};

const isIgnorableRollupWarning = (warning) => {
    if (warning?.code === "INEFFECTIVE_DYNAMIC_IMPORT") {
        return true;
    }
    return isIgnorableViteWarning(warning);
};

/**
 * Drop stale `node_modules/.vite/deps` when old KaTeX pre-bundles linger (missing `katex-*.js` on disk
 * but still referenced) or when hashed `katex-*.js` files exist while `optimizeDeps.exclude` includes katex.
 * Prevents "Pre-transform error ... deps/katex-XXXX.js" + broken optimizer state that can balloon memory.
 */
const evictStaleKatexDepChunksPlugin = () => ({
    name: "cw-evict-stale-katex-dep-chunks",
    enforce: "pre",
    configResolved(config) {
        if (config.command !== "serve") return;
        if (process.env.VITE_SKIP_KATEX_DEPS_EVICTION === "1") return;
        const depsDir = join(config.cacheDir, "deps");
        const metaFile = join(depsDir, "_metadata.json");
        if (!existsSync(depsDir)) return;

        let names;
        try {
            names = readdirSync(depsDir);
        } catch {
            return;
        }

        const hasKatexChunkFiles = names.some((f) => f.startsWith("katex-") && f.endsWith(".js"));

        let metadataReferencesMissingKatex = false;
        if (existsSync(metaFile)) {
            try {
                const text = readFileSync(metaFile, "utf8");
                for (const m of text.matchAll(/"(katex-[A-Za-z0-9_-]+\.js)"/g)) {
                    const chunk = m[1];
                    if (!existsSync(join(depsDir, chunk))) {
                        metadataReferencesMissingKatex = true;
                        break;
                    }
                }
            } catch {
                /* ignore */
            }
        }

        if (!hasKatexChunkFiles && !metadataReferencesMissingKatex) return;

        try {
            rmSync(depsDir, { recursive: true, force: true });
            console.warn(
                "[cw-vite] Cleared node_modules/.vite/deps (stale or missing KaTeX optimizer chunks). Re-scanning dependencies."
            );
        } catch (e) {
            console.warn("[cw-vite] Could not clear .vite/deps:", e);
        }
    },
});

/**
 * Plugin to handle SPA fallback routes (share-target, etc.)
 * Rewrites specific routes to index.html so service worker can intercept
 */
/** Matches `VIEW_POST_API_SEGMENTS` in `src/com/config/Names.ts` (dev POST API relay). */
const VIEW_POST_API_SEGMENTS = new Set([
    'viewer', 'workcenter', 'settings', 'explorer', 'history', 'editor', 'airpad', 'print', 'home',
]);

const spaFallbackPlugin = () => ({
    name: 'spa-fallback-routes',
    configureServer(server) {
        // Must be added before Vite's default middleware
        server.middlewares.use((req, res, next) => {
            const url = req.url || '';
            const pathname = url.split('?')[0];

            // POST /{view} — same contract as PWA SW: JSON ack + devRelay body for local BroadcastChannel.
            if (req.method === 'POST') {
                const seg = pathname.replace(/^\/+|\/+$/g, '').split('/')[0]?.toLowerCase();
                if (seg && VIEW_POST_API_SEGMENTS.has(seg)) {
                    const chunks = [];
                    req.on('data', (c) => chunks.push(c));
                    req.on('end', () => {
                        try {
                            const bodyText = Buffer.concat(chunks).toString('utf8');
                            res.statusCode = 200;
                            res.setHeader('Content-Type', 'application/json; charset=utf-8');
                            res.setHeader('Cache-Control', 'no-store');
                            res.end(JSON.stringify({
                                ok: true,
                                viewId: seg,
                                devRelay: true,
                                bodyText,
                                contentType: String(req.headers['content-type'] || ''),
                            }));
                        } catch (e) {
                            res.statusCode = 500;
                            res.setHeader('Content-Type', 'application/json; charset=utf-8');
                            res.end(JSON.stringify({
                                ok: false,
                                error: String((e && e.message) || e),
                            }));
                        }
                    });
                    return;
                }
            }

            // Legacy GET /{view} deep links should still resolve, but canonical URL is "/".
            if (req.method === 'GET' || req.method === 'HEAD') {
                const seg = pathname.replace(/^\/+|\/+$/g, '').split('/')[0]?.toLowerCase();
                if (seg && VIEW_POST_API_SEGMENTS.has(seg)) {
                    req.url = '/index.html';
                }
            }

            // Never treat /user/* as SPA shell routes.
            // If SW did not intercept on first navigation, return SW handoff page for documents
            // (and explicit 404 for non-document requests) instead of index.html -> /viewer redirect chain.
            if (pathname === '/user' || pathname.startsWith('/user/')) {
                const accept = String(req.headers?.accept || "").toLowerCase();
                const secFetchDest = String(req.headers?.["sec-fetch-dest"] || "").toLowerCase();
                const secFetchMode = String(req.headers?.["sec-fetch-mode"] || "").toLowerCase();
                const isDocumentNav =
                    accept.includes("text/html") ||
                    secFetchDest === "document" ||
                    secFetchMode === "navigate";

                if (!isDocumentNav) {
                    res.statusCode = 404;
                    res.setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.setHeader('Cache-Control', 'no-store');
                    res.end(JSON.stringify({
                        ok: false,
                        error: 'USER_ROUTE_NOT_INTERCEPTED',
                        path: pathname,
                        hint: 'Expected service worker /user handler to intercept this request.'
                    }));
                    return;
                }

                const safePath = JSON.stringify(pathname || "/user");
                res.statusCode = 200;
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.setHeader('Cache-Control', 'no-store');
                res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SW handoff for /user</title>
  <style>
    body { margin:0; min-height:100vh; display:grid; place-items:center; background:#0f1115; color:#d6dbea; font:14px/1.45 ui-monospace,Menlo,Consolas,monospace; }
    .box { max-width:760px; padding:18px; border:1px solid #2b3141; border-radius:10px; background:#151b27; }
    code { color:#a8c8ff; }
  </style>
</head>
<body>
  <div class="box">
    <div><strong>/user SW handoff</strong></div>
    <div id="s">Trying to hand off request to Service Worker...</div>
    <div>Path: <code id="p"></code></div>
  </div>
  <script>
    const targetPath = ${safePath};
    document.getElementById("p").textContent = targetPath;
    const setStatus = (m) => { const el = document.getElementById("s"); if (el) el.textContent = m; };
    const currentUrl = new URL(location.href);
    const alreadyRetried = currentUrl.searchParams.get("__sw_handoff") === "1";
    const renderTextResult = (text, title) => {
      document.body.innerHTML = '<div class="box"><div><strong>' + (title || 'Loaded content') + '</strong></div><pre id="raw" style="white-space:pre-wrap;word-break:break-word;margin-top:10px;"></pre></div>';
      const raw = document.getElementById("raw");
      if (raw) raw.textContent = text;
    };
    const tryFetchFromSw = async () => {
      try {
        const res = await fetch(targetPath, { method: "GET", cache: "no-store", credentials: "same-origin" });
        const source = String(res.headers.get("x-source") || "").toLowerCase();
        const ct = String(res.headers.get("content-type") || "").toLowerCase();
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          setStatus("SW fetch failed: HTTP " + res.status);
          if (body) renderTextResult(body, "SW fetch error response");
          return false;
        }
        // For /user files we expect SW source marker. If absent and html returned, this is still route fallback.
        if (source !== "opfs-user" && ct.includes("text/html")) {
          setStatus("Request still resolved as HTML route, not OPFS file.");
          return false;
        }
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        setStatus("OPFS content loaded via SW. Redirecting to blob URL...");
        location.replace(blobUrl);
        return true;
      } catch (e) {
        setStatus("SW fetch attempt failed: " + String((e && e.message) || e));
        return false;
      }
    };
    const waitForController = async (timeoutMs = 3500) => {
      if (navigator.serviceWorker?.controller) return true;
      return await new Promise((resolve) => {
        let done = false;
        const finish = (v) => { if (done) return; done = true; clearTimeout(timer); resolve(Boolean(v)); };
        const onChange = () => finish(Boolean(navigator.serviceWorker?.controller));
        const timer = setTimeout(() => finish(Boolean(navigator.serviceWorker?.controller)), timeoutMs);
        navigator.serviceWorker?.addEventListener?.("controllerchange", onChange, { once: true });
      });
    };
    (async () => {
      try {
        if (alreadyRetried) {
          setStatus("SW handoff already attempted once; trying direct SW fetch...");
          await tryFetchFromSw();
          return;
        }
        if (!("serviceWorker" in navigator)) { setStatus("Service Worker API unavailable."); return; }
        const candidates = ["/dev-sw.js?dev-sw", "/sw.js"];
        let ok = false;
        for (const url of candidates) {
          try {
            const probe = await fetch(url, { method: "GET", cache: "no-store", credentials: "same-origin" });
            const ct = String(probe.headers.get("content-type") || "").toLowerCase();
            if (!probe.ok || (!ct.includes("javascript") && !ct.includes("ecmascript") && !ct.includes("module"))) continue;
            try { await navigator.serviceWorker.register(url, { scope: "/", type: "module", updateViaCache: "none" }); }
            catch (e) {
              if (url.includes("/dev-sw.js?dev-sw")) throw e;
              await navigator.serviceWorker.register(url, { scope: "/", updateViaCache: "none" });
            }
            ok = true;
            break;
          } catch {}
        }
        if (!ok) { setStatus("SW script probe failed."); return; }
        await navigator.serviceWorker.ready.catch(() => undefined);
        const controlled = await waitForController(3500);
        if (!controlled) { setStatus("SW ready, but this tab is not controlled yet."); return; }
        const next = new URL(location.href);
        next.pathname = targetPath;
        next.search = "";
        next.searchParams.set("__sw_handoff", "1");
        next.hash = "";
        location.replace(next.toString());
      } catch (e) {
        setStatus("SW handoff failed: " + String((e && e.message) || e));
      }
    })();
  </script>
</body>
</html>`);
                return;
            }

            // Handle share-target routes (redirect to index.html for SW to intercept)
            if (pathname === '/share-target' || pathname === '/share_target') {
                console.log(`[SPA Fallback] Rewriting ${pathname} to /index.html`);
                req.url = '/index.html';
            }

            next();
        });
    }
});

//
function normalizeAliasPattern(pattern) {
    return pattern.replace(/\/\*+$/, '');
}

//
const importFromTSConfig = (tsconfig, __dirname) => {
    const paths = tsconfig?.compilerOptions?.paths || {};
    const alias = [];
    for (const key in paths) {
        const normalizedKey = normalizeAliasPattern(key);
        const target = paths[key][0];
        const normalizedTarget = normalizeAliasPattern(target);
        alias.push({
            find: normalizedKey,
            replacement: resolve(__dirname, normalizedTarget),
        });
    }
    return alias;
};

/** Stable real path for `server.fs.allow` (symlinked `shared/fest` → monorepo modules). */
const tryRealpath = (dir) => {
    try {
        return realpathSync(dir);
    } catch {
        return resolve(dir);
    }
};

/**
 * Only real directories — avoid resolve(root, "./star-star-slash-…") style paths (literal glob chars, invalid folders).
 * Lets Vite read fest imports through symlinks without bogus parent entries.
 *
 * Do **not** add the whole `workspaceRoot`: that makes the entire monorepo a legal `fs` target and
 * blows up dev cold start / dep crawl (10+ minute “loading” on large trees). Allow the app, hoisted
 * deps, symlink targets under `modules/projects`, and shared assets only.
 */
const buildDevFsAllowList = (appRoot, workspaceRoot, phosphorCoreRoot) => {
    const out = new Set();
    const add = (p) => {
        const n = tryRealpath(p);
        if (existsSync(n)) out.add(n);
    };
    add(appRoot);
    add(resolve(appRoot, "shared"));
    add(resolve(appRoot, "shared/fest"));
    add(resolve(appRoot, "src"));
    add(phosphorCoreRoot);
    add(resolve(workspaceRoot, "node_modules"));
    add(resolve(workspaceRoot, "modules/projects"));
    add(resolve(workspaceRoot, "modules/shared"));
    add(resolve(workspaceRoot, "assets"));
    for (const rel of ["assets", "../assets", "../../assets"]) {
        add(resolve(appRoot, rel));
    }
    return Array.from(out);
};

//
export const initiate = (NAME = "generic", tsconfig = {}, __dirname = resolve("./", import.meta.dirname))=>{
    const workspaceRoot = searchForWorkspaceRoot(__dirname);
    const phosphorCoreRoot = resolve(workspaceRoot, "node_modules", "@phosphor-icons", "core");
    const devFsAllow = buildDevFsAllowList(__dirname, workspaceRoot, phosphorCoreRoot);
    const $resolve = {
        dedupe: ["katex"],
        // `shared/fest` is symlinked; realpath resolution can duplicate modules vs `fest/*` tsconfig paths.
        preserveSymlinks: process.env.VITE_RESOLVE_PRESERVE_SYMLINKS !== "0",
        alias: [
            { find: "@phosphor-icons/core", replacement: phosphorCoreRoot },
            ...importFromTSConfig(tsconfig, __dirname),
        ],
    };

    const terserOptions = {
        ecma: 2025,
        module: true,
        toplevel: true,
        compress: {
            passes: 3,
            drop_console: false,
            pure_getters: true,
        },
        mangle: {
            // Preserve class names used by custom elements (e.g. MarkdownView).
            keep_classnames: true,
        },
    };

    //
    const argvHas = (word) =>
        Array.isArray(process.argv) && process.argv.some((a) => String(a).toLowerCase() === word);
    const isBuild =
        argvHas("build") ||
        process.env.npm_lifecycle_event === "build" ||
        process.env.npm_lifecycle_event === "build:pwa" ||
        process.env.NODE_ENV === "production";
    /** Set `VITE_PWA_DEV_DISABLE=1` when the dev service worker still causes stale UI (same tab as old precache). */
    const pwaDevServiceWorkerEnabled = process.env.VITE_PWA_DEV_DISABLE !== "1";
    /**
     * Optional absolute origin for generated module / HMR URLs (reverse proxy, odd LAN setups).
     * If unset, Vite uses the browser’s current host:port — required when you open dev via
     * localhost, 127.0.0.1, or a different machine IP than a hardcoded LAN address.
     * Example: VITE_DEV_SERVER_ORIGIN=https://192.168.0.200:5173
     */
    const devServerOrigin = (process.env.VITE_DEV_SERVER_ORIGIN || "").trim();
    const plugins = [
        evictStaleKatexDepChunksPlugin(),
        // SPA fallback for PWA routes (share-target, etc.)
        spaFallbackPlugin(),
        relocateWorkerBundleAssetsPlugin(),
        /*jspmPlugin({
            downloadDeps: true,
            inputMap: true
        }),*/
        // PWA icon/manifest copy targets `dist/` — skip during `vite dev` (saves startup I/O; no dev use).
        ...(isBuild
            ? viteStaticCopy({
                  targets: [
                      { src: resolve(__dirname, "./src/pwa/manifest.json"), dest: resolve(__dirname, "./dist/pwa/") },
                      { src: resolve(__dirname, "./src/pwa/icons/icon.svg"), dest: resolve(__dirname, "./dist/pwa/icons/") },
                      { src: resolve(__dirname, "./src/pwa/icons/icon.png"), dest: resolve(__dirname, "./dist/pwa/icons/") },
                      { src: resolve(__dirname, "./src/pwa/icons/icon.ico"), dest: resolve(__dirname, "./dist/pwa/icons/") },
                  ],
              })
            : []),
        ...(process.env.VITE_MCP_DISABLE === "1"
            ? []
            : [
                  ViteMcp({
                      target: "browser",
                      mode: "development",
                      port: 443,
                      host: "0.0.0.0",
                      ...(devServerOrigin ? { origin: devServerOrigin } : {}),
                      allowedHosts: true,
                  }),
              ]),
        VitePWA({
            srcDir: resolve(__dirname, "./src/pwa/"),
            dstDir: resolve(__dirname, "./dist/"),
            filename: "sw.ts",
            registerType: 'autoUpdate',
            strategies: 'injectManifest',
            injectRegister: 'auto',
            selfDestroying: false,
            mode: 'development',
            // workbox options are ignored when using injectManifest
            injectManifest: {
                injectionPoint: "self.__WB_MANIFEST",
                maximumFileSizeToCacheInBytes: 1024 * 1024 * 16,
                globPatterns: ['**/*.{js,css,html,png,svg,json}'],
                // Smaller precache manifest → faster SW `install` (fewer parallel cache.put + less CPU).
                globIgnores: [
                    "**/node_modules/**/*",
                    "**/*.map",
                    "**/stats.html",
                    "**/report.html",
                ],
            },
            includeAssets: [
                resolve(__dirname, './src/pwa/icons/icon.svg')
            ],
            manifest: false,
            devOptions: {
                type: "module",
                enabled: pwaDevServiceWorkerEnabled,
            }
        })
    ];

    //
    const rollupOptions = {
        shimMissingExports: true,
        treeshake: {
            annotations: false,
            moduleSideEffects: true,
            // Rolldown accepts false | "always" (Rollup also allowed true).
            propertyReadSideEffects: "always",
        },
        onwarn: (warning, defaultHandler) => {
            if (isIgnorableRollupWarning(warning)) return;
            defaultHandler(warning);
        },
        input: resolve(__dirname, './src/index.ts'),
        output: {
            globals: {},
            format: 'es',
            name: NAME,
            dir: resolve(__dirname, './dist'),
            exports: "auto",
            minifyInternalExports: true,
            // Main PWA bundle: dist/index.js (source src/index.ts)
            entryFileNames: (chunkInfo) => {
                if (chunkInfo.isEntry && chunkInfo.name === "index") {
                    return "index.js";
                }
                return "[name].js";
            },
            chunkFileNames: distChunkFileNames,
            assetFileNames: distAssetFileNames(NAME),
            manualChunks: distManualChunks,
        }
    };

    //
    const veelaScssRoot = resolve(workspaceRoot, "modules/projects/veela.css/src/scss");
    const veelaBundledLib = resolve(__dirname, "./shared/fest/veela/scss/lib");
    const css = {
        postcss: postcssConfig,
        preprocessorOptions: {
            scss: {
                api: "modern",
                quietDeps: true,
                charset: false,
                precision: 8,
                // Bundled Veela lib (`@use "core/misc/config"` from fl-ui markdown SCSS) + optional monorepo veela.css tree.
                loadPaths: [
                    ...(existsSync(veelaBundledLib) ? [veelaBundledLib] : []),
                    ...(existsSync(veelaScssRoot) ? [veelaScssRoot] : []),
                ],
            }
        }
    }

    //
    const optimizeDeps = {
        // Avoid a huge eager `include` (pulls most of the graph at dev start and spikes RAM).
        // Do not pin `entries` to a single HTML file: that can shrink dep discovery enough that dev
        // pre-bundling misses reachable imports → stuck loaders / white screen with spinner.
        // KaTeX + marked-katex-extension: pre-bundle often emits split chunks (e.g. katex-*.js) that
        // go missing after optimizer/cache churn → "Pre-transform error ... deps/katex-XXXX.js".
        exclude: ["katex", "marked-katex-extension"],
        // Start the dev server before the full dep crawl finishes; remaining deps pre-bundle on demand.
        holdUntilCrawlEnd: false,
    };

    //
    const server = {
        port: 443,
        open: false,
        host: "0.0.0.0",
        ...(devServerOrigin ? { origin: devServerOrigin } : {}),
        allowedHosts: true,
        appType: 'spa',
        https,
        proxy: {
            // Proxy Phosphor icons to avoid CORS issues
            '/assets/icons/phosphor': {
                target: 'https://cdn.jsdelivr.net',
                changeOrigin: true,
                rewrite: (path) => {
                    // Extract style from path (e.g., /assets/icons/phosphor/duotone/copy.svg)
                    const pathParts = path.replace(/^\/assets\/icons\/phosphor\//, '').split('/');
                    const style = pathParts[0];
                    const iconName = pathParts[1]?.replace(/\.svg$/, '') || '';

                    // Add style suffix for duotone and other styles
                    let finalIconName = iconName;
                    if (style === 'duotone') {
                        finalIconName = `${iconName}-duotone`;
                    } else if (style !== 'regular') {
                        finalIconName = `${iconName}-${style}`;
                    }

                    const rewrittenPath = `/npm/@phosphor-icons/core@2/assets/${style}/${finalIconName}.svg`;
                    if (process.env.VITE_DEBUG_PHOSPHOR_PROXY === "1") {
                        console.log("Proxying Phosphor icon request:", path, "->", rewrittenPath);
                    }
                    return rewrittenPath;
                },
                configure: (proxy, options) => {
                    proxy.on('error', (err, req, res) => {
                        console.log('Phosphor icons proxy error:', err.message);
                    });
                }
            }
        },
        fs: {
            strict: false,
            allow: devFsAllow,
        },
        // Configure route-specific handling for different app entry points
        middlewareMode: false,
        watch: {
            ignored: [
                "**/node_modules/**",
                "**/dist/**",
                "**/dist-crx/**",
                "**/.git/**",
                "**/runtime/**",
                "**/externals/**",
                "**/.cursor/**",
            ],
        },
        configureServer(server) {
            // Handle specific routes to serve appropriate HTML files
            server.middlewares.use((req, res, next) => {
                const url = req.url || '';
                const pathname = url.split('?')[0] || '';

                // Never rewrite service worker requests (must be JS, not HTML)
                if (pathname === '/sw.js' || pathname === '/apps/cw/sw.js') {
                    return next();
                }

                // Handle print route - serve print.html
                // CrossWord uses a single HTML entry in dev; route to index.html.
                if (url.startsWith('/print') || url.startsWith('/basic') || url.startsWith('/faint') || url === '/' || url.startsWith('/?')) {
                    req.url = '/index.html';
                }

                next();
            });
        },
        cors: {
            allowedHeaders: "*",
            preflightContinue: true,
            // Don't combine wildcard origin with credentials=true (browsers will reject it).
            // Echo request Origin instead.
            origin: true,
            credentials: true,
            methods: "PROPFIND,GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
        },
        headers: {
            "Depth": "1",
            "Accept-Language": "*",
            "Content-Security-Policy": "upgrade-insecure-requests",
            "Content-Language": "*",
            "Service-Worker-Allowed": "/",
            "Permissions-Policy": "fullscreen=*, window-management=*",
            "Cross-Origin-Embedder-Policy": "require-corp",
            "Cross-Origin-Opener-Policy": "same-origin",
            "Access-Control-Allow-Methods": "PROPFIND,HEAD,GET,POST,PUT,MOVE,DELETE,PATCH,OPTIONS",
            "Access-Control-Request-Headers": "*",
            // Dev: discourage browser/CDN caching of the module graph (avoids “stuck on old version” after edits).
            "Cache-Control": "no-store"
        }
    };

    if (process.env.VITE_USE_POLLING === "1") {
        server.watch = { usePolling: true, interval: 300 };
    }

    //
    const build = {
        // Prevent stale chunks from being precached by injectManifest.
        emptyOutDir: true,
        target: 'esnext',
        outDir: resolve(__dirname, './dist'),
        // Vite 8 defaults to Lightning CSS; Veela / fl-ui use syntax Lightning cannot minify yet.
        cssMinify: "esbuild",
        cssCodeSplit: false,
        // Ensure CSS file is named after the library
        cssFileName: `assets/${NAME}`,
        chunkSizeWarningLimit: 2048,
        assetsInlineLimit: 1024 * 16,
        minify: isBuild ? "terser" : false,
        sourcemap: false,
        modulePreload: {
            polyfill: true,
            include: [
                "fest/dom",
                "fest/lure",
                "fest/object",
                "fest/uniform",
            ]
        },
        rollupOptions,
        rolldownOptions: {
            checks: {
                pluginTimings: false,
            },
            onwarn: (warning, defaultHandler) => {
                if (isIgnorableRollupWarning(warning)) return;
                defaultHandler(warning);
            },
            // NOTE: Vite 8 uses Rolldown for production builds. Mirror output naming here so
            // chunk placement rules (`views/`, `shells/`, `com/`, `core/`, `chunks/`, etc.)
            // are applied consistently instead of collapsing scripts into the dist root.
            output: {
                ...rollupOptions.output,
                codeSplitting: {
                    groups: rolldownCodeSplittingGroups,
                },
            },
        },
        terserOptions,
        name: NAME,
        lib: {
            formats: ["es"],
            entry: resolve(__dirname, './src/index.ts'),
            name: NAME,
            fileName: NAME,
            // Explicitly set CSS file name
            cssFileName: NAME,
        },
    }

    //
    return {
        "base": "",
        /** Keep Vite cache inside the app; avoids workspace-root .vite clashes when cwd differs. */
        cacheDir: resolve(__dirname, "node_modules/.vite"),
        rollupOptions, plugins, resolve: $resolve, build, css, optimizeDeps, server, worker: {format: 'es'},
        define: { 'process.env': {} },
        customLogger: {
            warn: (message, options) => {
                if (!isIgnorableViteWarning(message)) {
                    viteLogger.warn(message, options);
                }
            },
            info: (...args) => viteLogger.info(...args),
            error: (...args) => viteLogger.error(...args),
        },
    };
}

//
export default initiate;

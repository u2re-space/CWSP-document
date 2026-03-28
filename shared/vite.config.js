import { resolve } from "node:path";

import {
    assetFileNames as distAssetFileNames,
    chunkFileNames as distChunkFileNames,
    manualChunks as distManualChunks,
    relocateWorkerBundleAssetsPlugin,
} from "./vite-chunk-placement.mjs";

//
import https from "../private/https/certificate.mjs";
import postcssConfig from "../postcss.config.js";

//
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { VitePWA } from 'vite-plugin-pwa'
import { searchForWorkspaceRoot } from "vite";
import { ViteMcp } from 'vite-plugin-mcp';

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

//
export const initiate = (NAME = "generic", tsconfig = {}, __dirname = resolve("./", import.meta.dirname))=>{
    const workspaceRoot = searchForWorkspaceRoot(__dirname);
    const phosphorCoreRoot = resolve(workspaceRoot, "node_modules", "@phosphor-icons", "core");
    const $resolve = {
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
    const isBuild = process.env.npm_lifecycle_event === 'build' || process.env.NODE_ENV === 'production';
    const plugins = [
        // SPA fallback for PWA routes (share-target, etc.)
        spaFallbackPlugin(),
        relocateWorkerBundleAssetsPlugin(),
        /*jspmPlugin({
            downloadDeps: true,
            inputMap: true
        }),*/
        //...(isBuild ? [] :
        ...[
            viteStaticCopy({
                targets: [
                    { src: resolve(__dirname, './src/pwa/manifest.json'), dest: resolve(__dirname, './dist/pwa/') },
                    { src: resolve(__dirname, './src/pwa/icons/icon.svg'), dest: resolve(__dirname, './dist/pwa/icons/') },
                    { src: resolve(__dirname, './src/pwa/icons/icon.png'), dest: resolve(__dirname, './dist/pwa/icons/') },
                    { src: resolve(__dirname, './src/pwa/icons/icon.ico'), dest: resolve(__dirname, './dist/pwa/icons/') }
                ]
            })
        ],
        ViteMcp({
            target: "browser",
            mode: "development",
            port: 443,
            host: "0.0.0.0",
            origin: "https://192.168.0.200",
            allowedHosts: ['localhost', '127.0.0.1', '0.0.0.0', '192.168.0.200', '95.188.82.223'],
        }),
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
            },
            includeAssets: [
                resolve(__dirname, './src/pwa/icons/icon.svg')
            ],
            manifest: false,
            devOptions: {
                type: 'module',
                enabled: true
            }
        })
    ];

    //
    const rollupOptions = {
        shimMissingExports: true,
        treeshake: {
            annotations: false,
            moduleSideEffects: true,
            unknownGlobalSideEffects: true,
            correctVarValueBeforeDeclaration: true,
            propertyReadSideEffects: true
        },
        input: resolve(__dirname, './src/index.ts'),
        output: {
            compact: true,
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
    const css = {
        postcss: postcssConfig,
        preprocessorOptions: {
            scss: {
                api: "modern",
                quietDeps: true,
                charset: false,
                precision: 8,
            }
        }
    }

    //
    const optimizeDeps = {
        // List CJS packages by their npm name so Vite pre-bundles them with
        // esbuild during startup — before rollup's WASM parser is involved.
        // This avoids the "parse is not a function" race in vite:import-analysis
        // when @rollup/wasm-node is used as the rollup implementation.
        include: [
            // CJS libraries imported in Conversion.ts
            'turndown',
            'temml',
            'mathml-to-latex',
            // Used via dynamic import() in Conversion.ts
            'marked-katex-extension',
        ],
        entries: [resolve(__dirname, './src/index.ts')],
        force: true,
    }

    //
    const server = {
        port: 443,
        open: false,
        host: "0.0.0.0",
        origin: "https://192.168.0.200",
        allowedHosts: ['localhost', '127.0.0.1', '0.0.0.0', '192.168.0.200', '95.188.82.223'],
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
                    console.log('Proxying Phosphor icon request:', path, '->', rewrittenPath);
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
            allow: [
                searchForWorkspaceRoot(process.cwd()),
                '../**/*', '../*', '..',
                '../assets/**/*', '../assets/*', '../assets',
                '../../assets/**/*', '../../assets/*', '../../assets',
                resolve(__dirname, './**/*'), resolve(__dirname, './*'), __dirname,
                resolve(__dirname, '../../assets/**/*'), resolve(__dirname, '../../assets/*'), resolve(__dirname, '../../assets'),
                resolve(__dirname, '../assets/**/*'), resolve(__dirname, '../assets/*'), resolve(__dirname, '../assets'),
            ]
        },
        // Configure route-specific handling for different app entry points
        middlewareMode: false,
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
            "Access-Control-Request-Headers": "*"
        }
    };

    //
    const build = {
        // Prevent stale chunks from being precached by injectManifest.
        emptyOutDir: true,
        target: 'esnext',
        outDir: resolve(__dirname, './dist'),
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
                "fest/fl-ui",
                "fest/dom",
                "fest/lure",
                "fest/object",
                "fest/uniform",
            ]
        },
        rollupOptions,
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
        rollupOptions, plugins, resolve: $resolve, build, css, optimizeDeps, server, worker: {format: 'es'},
        define: { 'process.env': {} }
    };
}

//
export default initiate;

#!/usr/bin/env node
/*
 * Filename: stage-cw-markdown.mjs
 * FullPath: apps/CWSP-document/scripts/stage-cw-markdown.mjs
 * Change date and time: 13.25.00_20.07.2026
 * Reason for changes: Flatten nested pwa/pwa/manifest.json so md.u2re.space ./pwa/manifest.json resolves.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rewriteVitePreloadBinding } from "../shared/vite-chunk-placement.mjs";
import { hoistSharedSlices } from "../../../runtime/fastify/apps/hoist-shared-slices.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.dirname(path.dirname(root));
const src = path.join(root, "build/cw-markdown");
const dest = path.join(repoRoot, "runtime/fastify/apps/cw-markdown");

if (!fs.existsSync(path.join(src, "index.html"))) {
    console.error(`[stage-cw-markdown] missing ${src}/index.html — run build:cw-markdown first`);
    process.exit(1);
}

fs.mkdirSync(path.dirname(dest), { recursive: true });

const keep = new Set(["README.md"]);
if (fs.existsSync(dest)) {
    for (const name of fs.readdirSync(dest)) {
        if (keep.has(name)) continue;
        fs.rmSync(path.join(dest, name), { recursive: true, force: true });
    }
} else {
    fs.mkdirSync(dest, { recursive: true });
}

for (const name of fs.readdirSync(src)) {
    fs.cpSync(path.join(src, name), path.join(dest, name), { recursive: true });
}

{
    const n = rewriteVitePreloadBinding(dest);
    if (n) console.log(`[stage-cw-markdown] rewrote ${n} vite-preload binding(s)`);
}

// COMPAT: viteStaticCopy + chunk placement can nest manifest under pwa/pwa/.
// HTML expects ./pwa/manifest.json (md.u2re.space installable PWA).
const nestedManifest = path.join(dest, "pwa", "pwa", "manifest.json");
const flatManifest = path.join(dest, "pwa", "manifest.json");
if (fs.existsSync(nestedManifest) && !fs.existsSync(flatManifest)) {
    fs.mkdirSync(path.dirname(flatManifest), { recursive: true });
    fs.renameSync(nestedManifest, flatManifest);
    const nestedDir = path.join(dest, "pwa", "pwa");
    try {
        if (fs.existsSync(nestedDir) && fs.readdirSync(nestedDir).length === 0) {
            fs.rmdirSync(nestedDir);
        }
    } catch {
        /* ignore */
    }
    console.log("[stage-cw-markdown] normalized pwa/pwa/manifest.json → pwa/manifest.json");
}

const flattenNestedPwaDir = (kind) => {
    const nested = path.join(dest, "pwa", kind, "pwa", kind);
    const flat = path.join(dest, "pwa", kind);
    if (!fs.existsSync(nested)) return;
    fs.mkdirSync(flat, { recursive: true });
    for (const name of fs.readdirSync(nested)) {
        const from = path.join(nested, name);
        const to = path.join(flat, name);
        if (fs.existsSync(to)) fs.rmSync(to, { recursive: true, force: true });
        fs.renameSync(from, to);
    }
    const leftover = path.join(dest, "pwa", kind, "pwa");
    try {
        fs.rmSync(leftover, { recursive: true, force: true });
    } catch {
        /* ignore */
    }
    console.log(`[stage-cw-markdown] flattened pwa/${kind}/pwa/${kind} → pwa/${kind}`);
};
flattenNestedPwaDir("icons");
flattenNestedPwaDir("screenshots");

// WHY: browsers request /favicon.svg|/favicon.png|/favicon.ico at host root.
{
    const icons = path.join(dest, "pwa", "icons");
    const copyFav = (fromName, toName) => {
        const from = path.join(icons, fromName);
        if (!fs.existsSync(from)) return;
        fs.cpSync(from, path.join(dest, toName));
    };
    copyFav("icon.svg", "favicon.svg");
    copyFav("icon.png", "favicon.png");
    copyFav("favicon.ico", "favicon.ico");
    if (!fs.existsSync(path.join(dest, "favicon.ico"))) copyFav("icon.ico", "favicon.ico");
}

// WHY: `/assets/wallpaper.jpg` is the default shell wallpaper; Vite host SPA omits app assets/.
const assetsDest = path.join(dest, "assets");
fs.mkdirSync(assetsDest, { recursive: true });
for (const name of ["wallpaper.jpg", "stock.jpg"]) {
    const from = path.join(root, "assets", name);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(assetsDest, name));
}

fs.writeFileSync(
    path.join(dest, ".sync-meta.json"),
    JSON.stringify(
        {
            syncedAt: new Date().toISOString(),
            source: "apps/CWSP-document/build/cw-markdown",
            host: "md.u2re.space",
            debugPath: "/markdown"
        },
        null,
        2
    ) + "\n"
);

hoistSharedSlices(dest, "stage-cw-markdown");
console.log(`[stage-cw-markdown] ${src} → ${dest}`);
